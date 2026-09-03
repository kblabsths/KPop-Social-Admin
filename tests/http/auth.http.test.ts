import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { EDITABLE_TABLES } from "@/lib/edit/config";
import { HTTP_TEST_PORT } from "../suite-globs";
import { SESSION_COOKIE_NAME, mintSessionCookie } from "../walk/session-cookie.mjs";
import {
  AUTH_SECRET,
  assertChildOwnsPort,
  base,
  host,
  startServer,
  stopServer,
} from "./server-harness";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/* ── the route inventory, derived from the filesystem ─────────────────────── */

/**
 * Every route this app serves, read off `src/app/**` rather than listed
 * (campaign admin-window/TASK-0019, acceptance test 12: "an unauthenticated
 * request to every new page and route redirects to login").
 *
 * DERIVED is the whole point. A hand-kept list covers the routes someone
 * remembered; the route that escapes the gate is by definition the one nobody
 * remembered. Adding a `page.tsx` or a `route.ts` adds it here, and the sweep
 * below then demands it redirect a stranger — including the API handler, whose
 * gate is the same proxy and whose data is the same service role.
 *
 * The one regression this inventory exists to catch, named because nothing
 * else in the repo would: `src/middleware.ts` is `export { auth as middleware }`
 * and must never become `auth(handler)` — next-auth runs a supplied handler in
 * the branch BEFORE the unauthenticated-redirect branch
 * (`node_modules/next-auth/lib/index.js`, lines 148-156), so wrapping it
 * silently removes the redirect from every route at once.
 */
interface DerivedRoute {
  /** The route as `src/app` spells it: `/records/[table]/[id]`. */
  readonly pattern: string;
  /** A URL of that shape, dynamic segments filled with sample values. */
  readonly url: string;
  readonly kind: "page" | "handler";
}

/** Sample values for dynamic segments, by segment name. Never real ids. */
const SEGMENT_SAMPLE: Readonly<Record<string, string>> = {
  // A table the edit map DOES carry, so the URL reaches the record page rather
  // than `next.config.ts`'s unmapped-table rewrite. The unmapped spelling is
  // asserted separately below.
  table: "groups",
};
const SAMPLE_ID = "2f0bc11e";

function fillSegment(segment: string): string {
  const dynamic = /^\[(?:\.\.\.)?(\w+)\]$/.exec(segment);
  if (dynamic === null) return segment;
  return SEGMENT_SAMPLE[dynamic[1]] ?? SAMPLE_ID;
}

/** Every `page.tsx` and `route.ts` under `src/app`, as routes. */
function derivedRoutes(): DerivedRoute[] {
  const appDir = path.join(repoRoot, "src", "app");
  const routes: DerivedRoute[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const kind =
        entry.name === "page.tsx" ? "page" : entry.name === "route.ts" ? "handler" : null;
      if (kind === null) continue;
      const relative = path.relative(appDir, path.dirname(full));
      const segments =
        relative === ""
          ? []
          : relative
              .split(path.sep)
              // Route groups and private folders never appear in a URL.
              .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
              .filter((segment) => !segment.startsWith("_"));
      routes.push({
        pattern: segments.length === 0 ? "/" : `/${segments.join("/")}`,
        url: segments.length === 0 ? "/" : `/${segments.map(fillSegment).join("/")}`,
        kind,
      });
    }
  };
  walk(appDir);
  return routes.sort((a, b) => (a.pattern < b.pattern ? -1 : 1));
}

/**
 * The paths the app declares PUBLIC, read out of the proxy's own matcher
 * (`src/middleware.ts`) rather than repeated here.
 *
 * Adding a public path is a design change (STACK §3). Reading the exceptions
 * from the matcher means such a change reddens this file instead of quietly
 * shrinking the sweep below it.
 */
function publicPathsFromMatcher(): string[] {
  const source = fs.readFileSync(path.join(repoRoot, "src", "middleware.ts"), "utf8");
  const matcher = /\(\?!([^)]*)\)/.exec(source);
  if (matcher === null) {
    throw new Error("src/middleware.ts carries no negative-lookahead matcher");
  }
  return matcher[1]
    .split("|")
    .map((alternative) => alternative.replace(/\\/g, "").trim())
    .filter((alternative) => alternative.length > 0);
}

/** Asset paths in the matcher that are not routes of this app. */
const NON_ROUTE_EXCEPTIONS = ["_next/static", "_next/image", "favicon.ico"];

/** The route-bearing public paths: what the sweep is allowed to skip. */
function publicRoutePrefixes(): string[] {
  return publicPathsFromMatcher()
    .filter((exception) => !NON_ROUTE_EXCEPTIONS.includes(exception))
    .map((exception) => `/${exception}`);
}

function isPublic(url: string): boolean {
  return publicRoutePrefixes().some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`),
  );
}

/** Every derived route the gate must cover — the sweep's subject. */
const GATED = derivedRoutes().filter((route) => !isPublic(route.url));

/**
 * The URLs of those routes. Named as before so the forgery and gate loops read
 * unchanged; what changed is where the list comes from.
 */
const GATED_ROUTES = GATED.map((route) => route.url);

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

/** The identity this suite signs in as. Not a real address, and not the walker's. */
const SUITE_CLAIMS = { sub: "http-suite", email: "http-suite@example.invalid" };

/** How long every cookie minted in this file is good for. */
const ONE_HOUR = 60 * 60;

/**
 * A session cookie the running app accepts.
 *
 * Auth.js JWT sessions are encrypted with a key derived from the secret and
 * the cookie name as salt. `mintSessionCookie` (`tests/walk/session-cookie.mts`)
 * wraps the same `encode` the app's own sign-in uses and is the ONE copy of
 * that call in `tests/` — a walker mints its cookie with the very same function
 * (admin-window/TASK-0033), so this suite and the endgame walk cannot drift
 * apart on the cookie name, the salt or the shape.
 *
 * Nothing here reaches a database — the JWT strategy decodes the cookie and
 * never looks a user up, which is why this works against a server started with
 * every Supabase name stripped from its environment.
 */
async function signedInCookie(): Promise<string> {
  const { name, value } = await mintSessionCookie({
    secret: AUTH_SECRET,
    claims: SUITE_CLAIMS,
    maxAgeSeconds: ONE_HOUR,
  });
  return `${name}=${value}`;
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
  const name = SESSION_COOKIE_NAME;
  const claims = SUITE_CLAIMS;
  // Every forgery is the SAME mint with one thing wrong — which is the point:
  // if the mint and the forgeries came from different code, a change to the
  // mint could make the forgeries stale and this suite quietly vacuous.
  const mint = (overrides: Parameters<typeof mintSessionCookie>[0]) =>
    mintSessionCookie({ claims, maxAgeSeconds: ONE_HOUR, ...overrides });

  const wrongSecret = (await mint({ secret: `${AUTH_SECRET}-but-not-really` })).value;
  // Right secret, wrong salt: Auth.js binds the cookie name into the key it
  // derives, so a token minted for another cookie must not open this one.
  const wrongSalt = (await mint({ secret: AUTH_SECRET, salt: "authjs.csrf-token" })).value;
  const expired = (await mint({ secret: AUTH_SECRET, maxAgeSeconds: -60 })).value;
  const valid = (await mint({ secret: AUTH_SECRET })).value;

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

describe("the route inventory", () => {
  /**
   * These need no server: they are about what the sweep below is going to
   * ask for. A derivation that quietly returned nothing would make every
   * assertion in this file vacuous, so it is checked before it is used.
   */
  it("finds every page and every handler on disk", () => {
    const routes = derivedRoutes();
    const pages = routes.filter((route) => route.kind === "page").map((r) => r.pattern);
    const handlers = routes
      .filter((route) => route.kind === "handler")
      .map((route) => route.pattern);

    // The six pages of the window, the two dynamic children, and sign-in.
    expect(pages).toEqual([
      "/",
      "/browse",
      "/claims",
      "/cycles",
      "/login",
      "/queues",
      "/queues/[reviewItemId]",
      "/records/[table]/[id]",
      "/sources",
    ]);
    expect(handlers).toEqual([
      "/api/admin/records/[table]/[id]",
      "/api/auth/[...nextauth]",
      "/api/health",
    ]);
  });

  it("skips exactly the three paths the app declares public", () => {
    expect(publicRoutePrefixes().sort()).toEqual(["/api/auth", "/api/health", "/login"]);
    // …and the sweep therefore covers everything else, the API route included.
    expect(GATED_ROUTES).toContain(`/api/admin/records/groups/${SAMPLE_ID}`);
    expect(GATED_ROUTES).not.toContain("/login");
    expect(GATED.filter((route) => route.kind === "handler").length).toBe(1);
    expect(GATED.length).toBe(9);
  });

  it("keeps the gate as an export, never as a wrapped handler", () => {
    /**
     * The one line whose regression the behavioural sweep would catch but no
     * reader would: next-auth runs a SUPPLIED handler in the branch before the
     * unauthenticated-redirect branch, so `export default auth(handler)` turns
     * the gate off for every route at once while still looking like auth.
     */
    const source = fs.readFileSync(path.join(repoRoot, "src", "middleware.ts"), "utf8");
    expect(source).toMatch(/export\s*\{\s*auth as middleware\s*\}/);
    expect(source, "the gate wraps a handler").not.toMatch(/\bauth\s*\(/);
  });
});

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

      // 1b. A route handler is not reached by GET alone. Every method a
      //     caller could send at it is turned away by the same proxy, before
      //     the handler runs — which is what makes "the gate covers every
      //     route" true of the write path as well as the read paths.
      for (const route of GATED.filter((one) => one.kind === "handler")) {
        for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
          const res = await fetch(`${base}${route.url}`, {
            method,
            headers: { "content-type": "application/json" },
            body: method === "GET" ? undefined : JSON.stringify({ field: "name", value: "x" }),
            redirect: "manual",
          });
          const where = `${method} ${route.url}`;
          expect(res.status, where).toBeGreaterThanOrEqual(300);
          expect(res.status, where).toBeLessThan(400);
          expect(
            new URL(res.headers.get("location") as string, base).pathname,
            where,
          ).toBe("/login");
        }
      }

      // 1c. The public paths are public — otherwise "everything else
      //     redirects" would be a claim about an app nobody can sign in to.
      for (const open of ["/login", "/api/health", "/api/auth/session"]) {
        const res = await fetch(`${base}${open}`, { redirect: "manual" });
        expect(res.status, open).toBeLessThan(300);
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
      //    works: to a visitor who is past the gate they are simply 404 —
      //    answered by THIS app's not-found surface, not the framework's
      //    (campaign admin-window/BUG-0014).
      for (const route of RETIRED_ROUTES) {
        const res = await fetch(`${base}${route}`, {
          headers: { cookie },
          redirect: "manual",
        });
        expect(res.status, route).toBe(404);
        expectOurNotFound(route, await res.text());
      }

      // 4. …and a retired path is answered exactly as a path that never
      //    existed is, so none of them kept a special case on the way out.
      const neverExisted = await fetch(`${base}/no-such-surface-here`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(neverExisted.status).toBe(404);
      expectOurNotFound("/no-such-surface-here", await neverExisted.text());

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
 * A record URL for a table the edit map does not carry must reach the operator
 * as the SAME served page an unmatched URL does (campaign
 * admin-window/BUG-0017).
 *
 * `/records/[table]/[id]` calls `notFound()` for such a table, and a thrown
 * `notFound()` cannot produce a server-rendered document AND a 404 status on
 * Next 16 — so `next.config.ts` rewrites the URL to a path no route matches
 * and Next's routing-level 404 answers instead. Everything below asserts that
 * arrangement from the outside: the served bytes, the status, and the two
 * things the rewrite must not have cost — the gate, and the record surfaces
 * the map DOES carry.
 */
describe("a record URL for a table the edit map does not carry", () => {
  it("answers with the app's own 404, server-rendered, without weakening the gate", async () => {
    const { child } = await startServer();
    try {
      const cookie = await signedInCookie();

      // 1. Every unmapped table answers exactly as an unmatched URL does.
      //    `notFound()` used to answer here with an empty document that only
      //    became the 404 page after hydration; these bytes are what a
      //    browser with JavaScript disabled is given.
      const unmapped = [
        "/records/no-such-table/2f0bc11e",
        // The dropped table and the raw archive: two names an operator could
        // plausibly still have bookmarked.
        "/records/artists/2f0bc11e",
        "/records/scraped_events/2f0bc11e",
      ];
      for (const route of unmapped) {
        const res = await fetch(`${base}${route}`, { headers: { cookie }, redirect: "manual" });
        expect(res.status, route).toBe(404);
        expectOurNotFound(route, await res.text());
      }

      // 1b. A spelling Next's own matcher reads as a configured table — it is
      //     case-insensitive where the map is exact — is not claimed by the
      //     rewrite, so it reaches the page and is refused there. What must
      //     hold either way, and is the reason this is asserted rather than
      //     left to the reader: it is a 404 and it is NOT a record surface.
      //     The document it gets is the framework's, which is the residue
      //     admin-window/BUG-0017 could not remove; asserting the shape of
      //     that document would pin a defect in place, so this does not.
      const caseVariant = await fetch(`${base}/records/GROUPS/2f0bc11e`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(caseVariant.status).toBe(404);
      expect(await caseVariant.text()).not.toContain("groups record");

      // 1c. The other half of that trade, and the one with a user behind it:
      //     the rewrite excludes percent-encoded table segments BECAUSE a
      //     percent-encoded spelling of a configured table is the SAME URI as
      //     the plain one (RFC 3986 §6.2.2.2) and serves a real record. Closing
      //     the case-variant gap by claiming `%` segments would 404 a working
      //     bookmark, so this pins the working URL rather than the gap: the
      //     rewrite must never swallow a URI that names a table the map holds.
      //     The read fails here (dead port), so this asserts the surface
      //     RENDERED, framed and not-404 — the same bar as loop 3 below.
      const encodedConfigured = await fetch(`${base}/records/gro%75ps/2f0bc11e`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(encodedConfigured.status, "/records/gro%75ps/<id> is /records/groups/<id>").toBe(200);
      const encodedBody = await encodedConfigured.text();
      expect(encodedBody).toMatch(/<h1[\s>]/);
      expect(encodedBody).not.toContain('id="__next_error__"');

      // 2. The rewrite's destination must stay a path no route matches. If a
      //    later route ever claims it, an unmapped table would silently start
      //    rendering that page instead of the 404 — this is the tripwire.
      const destination = await fetch(`${base}/__no-record-surface__`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(destination.status).toBe(404);
      expectOurNotFound("/__no-record-surface__", await destination.text());

      // 3. …and it cost the map nothing: every table EDIT_CONFIG carries still
      //    has a record surface. Reads fail here (the harness points the app
      //    at a dead port), so these render their error or empty state — the
      //    point is that they render, framed, and are not 404.
      for (const table of EDITABLE_TABLES) {
        const route = `/records/${table}/2f0bc11e`;
        const res = await fetch(`${base}${route}`, { headers: { cookie }, redirect: "manual" });
        expect(res.status, route).toBe(200);
        const body = await res.text();
        expect(body, route).toMatch(/<h1[\s>]/);
        expect(body, `${route} served the client-render error shell`).not.toContain(
          'id="__next_error__"',
        );
      }

      // 4. The API surface under a similar path is not swept up by the rewrite:
      //    it still answers as a route handler, never with the HTML 404.
      const api = await fetch(`${base}/api/admin/records/no-such-table/2f0bc11e`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(api.status).not.toBe(404);
      expect(api.headers.get("content-type") ?? "").not.toContain("text/html");
    } finally {
      await stopServer(child);
    }
  });

  /**
   * The rewrite must not reach past the sign-in gate. A stranger asking for an
   * unmapped record URL gets the sign-in page, exactly as they do for every
   * other route — never a 404, which would confirm what does and does not
   * exist behind the gate.
   */
  it("still sends a stranger to the sign-in page", async () => {
    const { child } = await startServer();
    try {
      for (const route of ["/records/no-such-table/2f0bc11e", "/__no-record-surface__"]) {
        const res = await fetch(`${base}${route}`, { redirect: "manual" });
        expect(res.status, route).toBeGreaterThanOrEqual(300);
        expect(res.status, route).toBeLessThan(400);
        const location = res.headers.get("location");
        expect(location, route).not.toBeNull();
        expect(new URL(location as string, base).pathname, route).toBe("/login");
      }

      for (const [what, forged] of await forgedCookies()) {
        const route = "/records/no-such-table/2f0bc11e";
        const res = await fetch(`${base}${route}`, {
          headers: { cookie: forged },
          redirect: "manual",
        });
        const where = `${route} with ${what}`;
        expect(res.status, where).toBeGreaterThanOrEqual(300);
        expect(res.status, where).toBeLessThan(400);
      }
    } finally {
      await stopServer(child);
    }
  });
});

/**
 * The 404 the built app actually serves is OURS (campaign
 * admin-window/BUG-0014).
 *
 * Without `src/app/not-found.tsx` Next answers every unmatched URL with its
 * built-in `HTTPAccessErrorFallback`, which renders inside our Frame while
 * belonging to another product: `system-ui` type off the scale, and — the part
 * that reaches past itself — an injected stylesheet that paints `body` with
 * literal hexes, overriding the token layer for the whole document.
 *
 * So this asserts the two things that distinguish them, on the built artifact
 * rather than on source: none of the framework fallback's own markers are
 * present, and the token layer is what styled the document. It deliberately
 * pins no wording of ours — the copy is the walk's business.
 */
function expectOurNotFound(route: string, html: string): void {
  // 1. Not the framework's. Its h1 class and its message are its own
  //    literals, not ours, so naming them here churns on no copy edit of ours.
  expect(html, `${route} carries Next's fallback h1`).not.toContain("next-error-h1");
  expect(html, `${route} carries Next's fallback copy`).not.toContain(
    "This page could not be found.",
  );

  // 2. Nothing in the document paints `body` with a literal colour. Our token
  //    layer paints it through `var(--color-page)` / `var(--color-ink)`; the
  //    fallback's injected `body{color:#000;background:#fff;margin:0}` (with a
  //    dark arm of #fff/#000) is what this forbids, in either theme arm.
  const bodyPaintedRaw = /body\s*\{[^}]*(?:^|[;{\s])(?:color|background(?:-color)?)\s*:\s*(?:#|rgb|hsl)/i;
  expect(bodyPaintedRaw.test(html), `${route} ships a raw body colour rule`).toBe(false);

  // 3. Ours: a page heading, styled through the app's own type scale, with a
  //    link back to a route that exists.
  expect(html, route).toMatch(/<h1[\s>]/);
  expect(html, `${route} was not styled by the token layer`).toMatch(
    /class="[^"]*\btype-(figure|title|body|data|micro)\b/,
  );
  expect(html, `${route} offers no way back`).toMatch(/href="\/"/);
}

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
