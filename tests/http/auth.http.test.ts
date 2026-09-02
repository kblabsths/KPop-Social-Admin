import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { encode } from "next-auth/jwt";
import { describe, expect, it } from "vitest";
import { HTTP_TEST_PORT } from "../suite-globs";
import {
  AUTH_SECRET,
  assertChildOwnsPort,
  base,
  host,
  startServer,
  stopServer,
} from "./server-harness";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * Every route the window offers, plus the two dynamic children — the whole
 * surface the sign-in gate has to cover (campaign admin-window/TASK-0005).
 */
const GATED_ROUTES = [
  "/",
  "/queues",
  "/claims",
  "/sources",
  "/cycles",
  "/browse",
  "/queues/2f0bc11e",
  "/records/groups/2f0bc11e",
];

/** The six pages plus the edit surface: routes that must actually render. */
const RENDERING_ROUTES = [
  "/",
  "/queues",
  "/claims",
  "/sources",
  "/cycles",
  "/browse",
  "/records/groups/2f0bc11e",
];

/**
 * The deprecated surfaces. They are gone from disk, so the app must answer a
 * signed-in visitor with a 404 — not a redirect to a working page, and not a
 * page that still renders.
 */
const RETIRED_ROUTES = [
  "/analytics",
  "/database",
  "/data-management",
  "/data-management/completeness",
];

/**
 * A session cookie the running app accepts.
 *
 * Auth.js JWT sessions are encrypted with a key derived from the secret and
 * the cookie name as salt; `encode` is the same function the app's own sign-in
 * uses. Nothing here reaches a database — the JWT strategy decodes the cookie
 * and never looks a user up, which is why this works against a server started
 * with every Supabase name stripped from its environment.
 */
async function signedInCookie(): Promise<string> {
  const name = "authjs.session-token";
  const token = await encode({
    token: { sub: "http-suite", email: "http-suite@example.invalid" },
    secret: AUTH_SECRET,
    salt: name,
    maxAge: 60 * 60,
  });
  return `${name}=${token}`;
}

/**
 * Session cookies the running app must REFUSE.
 *
 * The whole signed-in half of this suite rests on one claim: the app accepts
 * the minted cookie only because `next start` was given the same throwaway
 * AUTH_SECRET in its environment. If any of these is accepted, that claim is
 * false and the gate is not a gate — so each is asserted against every route,
 * not just the root.
 */
async function forgedCookies(): Promise<ReadonlyArray<readonly [string, string]>> {
  const name = "authjs.session-token";
  const claims = { sub: "http-suite", email: "http-suite@example.invalid" };

  const wrongSecret = await encode({
    token: claims,
    secret: `${AUTH_SECRET}-but-not-really`,
    salt: name,
    maxAge: 60 * 60,
  });
  // Right secret, wrong salt: Auth.js binds the cookie name into the key it
  // derives, so a token minted for another cookie must not open this one.
  const wrongSalt = await encode({
    token: claims,
    secret: AUTH_SECRET,
    salt: "authjs.csrf-token",
    maxAge: 60 * 60,
  });
  const expired = await encode({
    token: claims,
    secret: AUTH_SECRET,
    salt: name,
    maxAge: -60,
  });
  const valid = await encode({ token: claims, secret: AUTH_SECRET, salt: name, maxAge: 60 * 60 });

  return [
    ["a token signed with a different secret", `${name}=${wrongSecret}`],
    ["a token bound to a different cookie name", `${name}=${wrongSalt}`],
    ["an expired token", `${name}=${expired}`],
    ["a structurally broken token", `${name}=not.a.real.token`],
    ["an empty token", `${name}=`],
    // Same bytes, one flipped in the payload: proves the signature is checked
    // rather than the envelope merely parsed.
    ["a tampered token", `${name}=${valid.slice(0, -3)}${valid.slice(-3) === "AAA" ? "BBB" : "AAA"}`],
  ] as const;
}

describe("the built app over http", () => {
  it("serves health and sends an unauthenticated visitor to the login page", async () => {
    const { child } = await startServer();
    try {
      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);

      const root = await fetch(`${base}/`, { redirect: "manual" });
      expect(root.status).toBeGreaterThanOrEqual(300);
      expect(root.status).toBeLessThan(400);

      const location = root.headers.get("location");
      expect(location).not.toBeNull();
      expect(new URL(location as string, base).pathname).toBe("/login");
    } finally {
      await stopServer(child);
    }
  });
  /**
   * The suite must assert against the app IT started, never against whatever
   * happens to hold the port. Two lanes running `npm run test:http` at once,
   * or an orphaned server from a crashed run, both put a foreign listener on
   * HTTP_TEST_PORT — and a green earned from a stranger is not a green.
   */
  it("refuses to certify a server it did not start when the port is already held", async () => {
    const foreign = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === "/") {
        res.writeHead(307, { location: "/login" });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      foreign.listen(HTTP_TEST_PORT, host, () => resolve()),
    );

    try {
      let started: { child: ChildProcess } | undefined;
      try {
        started = await startServer();
      } catch {
        // Correct behaviour: the harness refused loudly.
        return;
      }
      await stopServer(started.child);
      throw new Error(
        `startServer() reported ready while a foreign listener held port ${HTTP_TEST_PORT}; ` +
          "every assertion in this suite would have been answered by that listener",
      );
    } finally {
      foreign.closeAllConnections();
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });

  /**
   * Lock 1 (the pre-flight bind) refuses before we ever spawn, which means it
   * masks lock 3 on every ordinary run. This exercises lock 3 on its own: a
   * live child that is demonstrably NOT the process holding the port must be
   * rejected. Keeps the OS-ownership path from rotting into dead code.
   */
  it("refuses a listener that is outside the process tree of the child it spawned", async () => {
    const foreign = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) =>
      foreign.listen(HTTP_TEST_PORT, host, () => resolve()),
    );
    // Alive, ours, and binds nothing — a stand-in for a `next start` that
    // survived losing the port.
    const decoy: ChildProcess = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { detached: true, stdio: "ignore" },
    );

    try {
      expect(() => assertChildOwnsPort(decoy, [])).toThrowError(
        /refusing to certify a server it did not start/,
      );
    } finally {
      if (decoy.pid !== undefined) {
        try {
          process.kill(-decoy.pid, "SIGKILL");
        } catch {
          decoy.kill("SIGKILL");
        }
      }
      foreign.closeAllConnections();
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });
});

describe("the gate over the whole window", () => {
  /**
   * One server, every route (campaign admin-window/TASK-0005). Starting and
   * stopping `next start` costs seconds, and the file's other tests need the
   * port to themselves, so the whole route sweep lives in one test body rather
   * than a `beforeAll` that would collide with them.
   */
  it("sends a stranger to /login and answers a signed-in visitor honestly", async () => {
    const { child } = await startServer();
    try {
      // 1. Unauthenticated: every route, including the dynamic children,
      //    redirects to the sign-in page. Adding a page adds protection
      //    automatically — this is what asserts that stayed true.
      for (const route of GATED_ROUTES) {
        const res = await fetch(`${base}${route}`, { redirect: "manual" });
        expect(res.status, route).toBeGreaterThanOrEqual(300);
        expect(res.status, route).toBeLessThan(400);
        const location = res.headers.get("location");
        expect(location, route).not.toBeNull();
        expect(new URL(location as string, base).pathname, route).toBe("/login");
      }

      const cookie = await signedInCookie();

      // 2. The cookie has to actually sign us in, or every 404 below would be
      //    a redirect misread as proof. This assertion is that guard.
      for (const route of RENDERING_ROUTES) {
        const res = await fetch(`${base}${route}`, {
          headers: { cookie },
          redirect: "manual",
        });
        expect(res.status, route).toBe(200);
        const body = await res.text();
        // Each page renders its own h1 and a data-surface state; the words are
        // the walk's business, the structure is this suite's.
        expect(body, route).toMatch(/<h1[\s>]/);
      }

      // 3. The retired surfaces are gone, not redirected to something that
      //    works: to a visitor who is past the gate they are simply 404.
      for (const route of RETIRED_ROUTES) {
        const res = await fetch(`${base}${route}`, {
          headers: { cookie },
          redirect: "manual",
        });
        expect(res.status, route).toBe(404);
      }

      // 4. …and a retired path is answered exactly as a path that never
      //    existed is, so none of them kept a special case on the way out.
      const neverExisted = await fetch(`${base}/no-such-surface-here`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(neverExisted.status).toBe(404);

      // 5. Nothing the server hands a browser carries credential material.
      for (const route of ["/login", ...RENDERING_ROUTES]) {
        const res = await fetch(`${base}${route}`, { headers: { cookie } });
        expectNoCredentialMaterial(`response body of ${route}`, await res.text());
      }

      // 6. The minted cookie works only because this server was started with
      //    the harness's throwaway AUTH_SECRET. Every forgery of it — wrong
      //    secret, wrong cookie binding, expired, tampered, malformed — is
      //    turned away on EVERY route, exactly as no cookie at all is.
      for (const [what, forged] of await forgedCookies()) {
        for (const route of GATED_ROUTES) {
          const res = await fetch(`${base}${route}`, {
            headers: { cookie: forged },
            redirect: "manual",
          });
          const where = `${route} with ${what}`;
          expect(res.status, where).toBeGreaterThanOrEqual(300);
          expect(res.status, where).toBeLessThan(400);
          const location = res.headers.get("location");
          expect(location, where).not.toBeNull();
          expect(new URL(location as string, base).pathname, where).toBe("/login");
        }
        // A forged session must not reach past the gate to a retired path
        // either: it gets the sign-in page, never a 404 that would confirm
        // what does and does not exist behind the gate.
        const retired = await fetch(`${base}/analytics`, {
          headers: { cookie: forged },
          redirect: "manual",
        });
        expect(retired.status, `/analytics with ${what}`).toBeLessThan(400);
        expect(retired.status, `/analytics with ${what}`).toBeGreaterThanOrEqual(300);
      }
    } finally {
      await stopServer(child);
    }
  });
});

/**
 * Credential shapes, asserted by NAME and by SHAPE — never by value. A test
 * that compared against the real key would put it in this file, in the run
 * log, and in every transcript that quotes them.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  // The env name itself. Its presence in client output means the build
  // inlined a read of it, which is the leak one step before the value.
  ["a service-role env name", /SUPABASE_[A-Z0-9_]*(?:KEY|SECRET)/],
  // A Supabase key in the legacy JWT form: three base64url segments.
  ["a JWT-shaped key", /eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  // The current secret-key form, and Supabase personal access tokens.
  ["a Supabase secret-key prefix", /\bsb_secret_[A-Za-z0-9_-]{8,}/],
  ["a Supabase access-token prefix", /\bsbp_[A-Za-z0-9]{16,}/],
];

/** Fails naming the pattern and where it hit — never quoting what it matched. */
function expectNoCredentialMaterial(what: string, text: string): void {
  for (const [name, pattern] of CREDENTIAL_PATTERNS) {
    const hit = pattern.exec(text);
    expect(
      hit,
      hit === null ? "" : `${what} contains ${name} at offset ${hit.index}`,
    ).toBeNull();
  }
}

/** Every file under `dir` whose extension is in `extensions`, recursively. */
function filesUnder(dir: string, extensions: readonly string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

describe("the client bundle", () => {
  /**
   * `next build` runs with the repo's real environment — it loads `.env` from
   * the repo root — so anything the build inlined into client output was
   * inlined from real names. That is what makes this scan worth running on the
   * artifact rather than on the source.
   */
  it("ships no service-role name and no key-shaped material", () => {
    const clientFiles = [
      ...filesUnder(path.join(repoRoot, ".next", "static"), [
        ".js",
        ".mjs",
        ".css",
        ".json",
        ".txt",
        ".map",
      ]),
      // Prerendered payloads: these bytes are sent to the browser verbatim.
      ...filesUnder(path.join(repoRoot, ".next", "server", "app"), [".html", ".rsc"]),
    ];

    // A scan that found nothing because it looked at nothing is not a pass.
    expect(clientFiles.length).toBeGreaterThan(5);

    for (const file of clientFiles) {
      const relative = path.relative(repoRoot, file);
      expectNoCredentialMaterial(relative, fs.readFileSync(file, "utf8"));
    }
  });

  /**
   * The scanner guarding itself: a scan whose patterns match nothing would
   * pass this suite forever while a key sat in plain sight.
   */
  it("recognises each shape it claims to scan for", () => {
    // The JWT-shaped sample is assembled here rather than written out: a
    // literal three-segment token in a source file trips every secret scanner
    // that reads this repo, and a blocked handoff is a worse outcome than a
    // two-line helper.
    const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const jwtShaped = [
      segment({ alg: "HS256", typ: "JWT" }),
      segment({ role: "sample-not-a-credential" }),
      "no-signature-this-is-a-test-sample",
    ].join(".");

    const samples = [
      "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;",
      jwtShaped,
      "sb_secret_AAAAAAAAAAAAAAAAAAAA",
      "sbp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ];
    expect(samples.length).toBe(CREDENTIAL_PATTERNS.length);
    samples.forEach((sample, index) => {
      expect(() => expectNoCredentialMaterial("sample", sample)).toThrowError();
      expect(CREDENTIAL_PATTERNS[index][1].test(sample), CREDENTIAL_PATTERNS[index][0]).toBe(true);
    });
  });
});
