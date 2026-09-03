import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_SECRET_ENV_NAME,
  COOKIE_DESCRIPTOR_KEYS,
  DEFAULT_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  WALKER_IDENTITY,
  decodeSessionToken,
  isUnset,
  mintSessionCookie,
  planFromArgs,
  scrub,
} from "../../walk/session-cookie.mjs";
import { repoRoot } from "../source-tree";

/**
 * The walker's session cookie, proved OFFLINE (campaign admin-window/TASK-0033).
 *
 * Everything here runs in the default suite with no network and no database:
 * `encode`/`decode` are pure crypto over a supplied secret, and the CLI cases
 * spawn the real program as a child process with the environment they want.
 *
 * The subject that matters most is the REFUSAL. An unset `AUTH_SECRET` must
 * mint nothing and say so — no default, no generated secret, no "assume dev" —
 * because a cookie minted from a guessed secret is not rejected loudly by the
 * app, it is rejected as an ordinary signed-out visitor, and the walker then
 * reports the app as broken.
 *
 * **No real secret value appears in this file.** The sentinel below is a
 * throwaway literal whose whole job is to be searched for in the program's
 * output and not found.
 */

const CLI = path.join(repoRoot, "tests", "walk", "session-cookie.mts");

/**
 * A secret that is trivially greppable and obviously not a credential.
 *
 * Recognisable is the point: criterion 3 is "the sentinel appears nowhere in
 * stdout or stderr", and a sentinel that could plausibly collide with base64
 * token bytes would make that assertion flaky rather than true. This one
 * cannot appear inside a JWE by accident — it holds hyphens and words.
 */
const SENTINEL = "offline-suite-sentinel-secret-not-a-credential";

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the CLI exactly as a walker would, with a chosen `AUTH_SECRET`.
 *
 * `process.execPath` rather than a bare `node`: the child must be the same Node
 * that runs this suite, because running a `.mts` file with no flag is a Node
 * >= 23.6 behaviour and the repo's floor is lower.
 */
function runCli(secret: string | undefined, args: string[] = []): CliRun {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Whatever this machine carries is irrelevant; the case decides.
  delete env.AUTH_SECRET;
  if (secret !== undefined) env.AUTH_SECRET = secret;
  const run = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe("the walker's mint, as a program", () => {
  it("prints one line of JSON on stdout and never the secret", () => {
    const run = runCli(SENTINEL);

    expect(run.status, run.stderr).toBe(0);

    // "Exactly one line": one trailing newline, and nothing after it.
    expect(run.stdout.endsWith("\n")).toBe(true);
    expect(run.stdout.trimEnd().includes("\n")).toBe(false);

    const descriptor = JSON.parse(run.stdout) as Record<string, unknown>;
    // The whole key set, not a subset: an extra key is a change to the contract
    // a walker parses, and it should have to come through this assertion.
    expect(Object.keys(descriptor).sort()).toEqual([...COOKIE_DESCRIPTOR_KEYS].sort());
    expect(descriptor.name).toBe(SESSION_COOKIE_NAME);
    expect(descriptor.name).toBe("authjs.session-token");
    expect(descriptor.path).toBe("/");
    expect(descriptor.httpOnly).toBe(true);
    expect(descriptor.sameSite).toBe("Lax");
    expect(descriptor.domain).toBe("localhost");
    expect(typeof descriptor.value).toBe("string");
    expect((descriptor.value as string).length).toBeGreaterThan(0);

    // Criterion 3, on the success path: the only secret-derived value emitted
    // is the token itself.
    expect(run.stdout).not.toContain(SENTINEL);
    expect(run.stderr).not.toContain(SENTINEL);
  });

  it("mints the walker identity, and the token really opens with that secret", async () => {
    const run = runCli(SENTINEL);
    const descriptor = JSON.parse(run.stdout) as { value: string };

    const claims = await decodeSessionToken({ token: descriptor.value, secret: SENTINEL });
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe(WALKER_IDENTITY.sub);
    expect(claims?.email).toBe(WALKER_IDENTITY.email);
    expect(claims?.name).toBe(WALKER_IDENTITY.name);
    // Deliberately not a real person's address — the ruling that put a
    // labelled identity here instead of somebody's inbox.
    expect(WALKER_IDENTITY.email.endsWith(".local")).toBe(true);
  });

  it("refuses an empty secret, names the name, and mints nothing", () => {
    // Present-but-empty rather than deleted: the resolver consults the repo-root
    // `.env` when the name is absent, and `dotenv` never overrides a name that
    // is already present. So an empty value is how this case stays decided by
    // the guard even on a machine whose `.env` carries a real secret — the same
    // trick `tests/offline/live-guard.test.ts` uses for the staging names.
    const run = runCli("");

    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(AUTH_SECRET_ENV_NAME);
    // A refusal, not a fallback: nothing that looks like a minted cookie.
    expect(run.stderr).not.toContain(SESSION_COOKIE_NAME);
    expect(run.stderr).not.toContain(SENTINEL);
  });

  it("refuses a whitespace-only secret the same way", () => {
    const run = runCli("   \t  ");
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(AUTH_SECRET_ENV_NAME);
  });

  it("refuses an argument it does not understand, and mints nothing", () => {
    // A typo'd flag must not be silently ignored: a walker that asked for a
    // 30-second cookie and got a two-hour one has been lied to.
    const run = runCli(SENTINEL, ["--maxage", "30"]);
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("--maxage");
    expect(run.stderr).not.toContain(SENTINEL);

    const missingOperand = runCli(SENTINEL, ["--domain"]);
    expect(missingOperand.status).not.toBe(0);
    expect(missingOperand.stdout).toBe("");
    expect(missingOperand.stderr).not.toContain(SENTINEL);
  });

  it("honours --domain and --email", async () => {
    const run = runCli(SENTINEL, [
      "--domain",
      "127.0.0.1",
      "--email",
      "someone-allowlisted@example.invalid",
    ]);
    expect(run.status, run.stderr).toBe(0);
    const descriptor = JSON.parse(run.stdout) as { domain: string; value: string };
    expect(descriptor.domain).toBe("127.0.0.1");

    const claims = await decodeSessionToken({ token: descriptor.value, secret: SENTINEL });
    expect(claims?.email).toBe("someone-allowlisted@example.invalid");
    // `--email` swaps the address only; the walker is still labelled a walker.
    expect(claims?.sub).toBe(WALKER_IDENTITY.sub);
  });

  it("prints nothing when it is imported rather than run", () => {
    // The http suite imports `mintSessionCookie` from this module while a
    // walker runs the same file as a program. An import that printed a line —
    // or exited — would take the whole http project down with it.
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(CLI)}); process.stdout.write("imported-and-silent");`,
      ],
      { cwd: repoRoot, encoding: "utf8", env: { ...process.env, AUTH_SECRET: SENTINEL } },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe("imported-and-silent");
    expect(run.stderr).toBe("");
  });
});

describe("mintSessionCookie", () => {
  it("round-trips through the app's own decoder", async () => {
    const cookie = await mintSessionCookie({ secret: SENTINEL });
    const claims = await decodeSessionToken({ token: cookie.value, secret: SENTINEL });
    expect(claims?.sub).toBe(WALKER_IDENTITY.sub);
    expect(claims?.email).toBe(WALKER_IDENTITY.email);
  });

  it("does not open under a different secret", async () => {
    // The claim the whole http tier rests on: the app accepts the minted cookie
    // because it was started with the SAME secret, not because the cookie is
    // shaped right.
    const cookie = await mintSessionCookie({ secret: SENTINEL });
    expect(
      await decodeSessionToken({ token: cookie.value, secret: `${SENTINEL}-but-not-really` }),
    ).toBeNull();
  });

  it("does not open under a different salt", async () => {
    // Auth.js binds the cookie NAME into the key it derives, so a token minted
    // for another cookie must not open this one. This is why the salt defaults
    // to the cookie name rather than being left to the caller to remember.
    const cookie = await mintSessionCookie({ secret: SENTINEL, salt: "authjs.csrf-token" });
    expect(await decodeSessionToken({ token: cookie.value, secret: SENTINEL })).toBeNull();
    expect(
      await decodeSessionToken({
        token: cookie.value,
        secret: SENTINEL,
        salt: "authjs.csrf-token",
      }),
    ).not.toBeNull();
  });

  it("mints an already-expired token for a negative lifetime", async () => {
    // The http suite's forged-cookie family needs this shape; a mint that
    // clamped a negative maxAge to zero would quietly turn that forgery valid.
    const cookie = await mintSessionCookie({ secret: SENTINEL, maxAgeSeconds: -60 });
    expect(await decodeSessionToken({ token: cookie.value, secret: SENTINEL })).toBeNull();
  });

  it("takes the caller's claims and never reads the environment", async () => {
    const cookie = await mintSessionCookie({
      secret: SENTINEL,
      claims: { sub: "http-suite", email: "http-suite@example.invalid" },
    });
    const claims = await decodeSessionToken({ token: cookie.value, secret: SENTINEL });
    expect(claims?.sub).toBe("http-suite");
    expect(claims?.email).toBe("http-suite@example.invalid");
    // No walker leakage into a caller's own identity.
    expect(claims?.name).toBeUndefined();
  });
});

describe("the small rules the CLI is built on", () => {
  it("treats unset, empty and whitespace-only alike", () => {
    expect(isUnset(undefined)).toBe(true);
    expect(isUnset("")).toBe(true);
    expect(isUnset("   ")).toBe(true);
    expect(isUnset("\t\n ")).toBe(true);
    expect(isUnset("a")).toBe(false);
    expect(isUnset(" padded ")).toBe(false);
  });

  it("scrubs every occurrence of the secret from a diagnostic", () => {
    expect(scrub(`before ${SENTINEL} between ${SENTINEL} after`, SENTINEL)).toBe(
      "before [redacted] between [redacted] after",
    );
    expect(scrub("nothing to hide", SENTINEL)).toBe("nothing to hide");
    // An empty secret would otherwise split every character apart.
    expect(scrub("untouched", "")).toBe("untouched");
  });

  it("defaults the plan and parses each flag", () => {
    const plain = planFromArgs([]);
    expect(plain).toEqual({
      ok: true,
      domain: "localhost",
      maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
      email: WALKER_IDENTITY.email,
    });
    expect(planFromArgs(["--max-age", "30"])).toMatchObject({ ok: true, maxAgeSeconds: 30 });
    expect(planFromArgs(["--max-age", "soon"])).toMatchObject({ ok: false });
    expect(planFromArgs(["--domain", ""])).toMatchObject({ ok: false });
    expect(planFromArgs(["--email", " "])).toMatchObject({ ok: false });
    expect(planFromArgs(["extra"])).toMatchObject({ ok: false });
  });
});
