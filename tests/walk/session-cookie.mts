/**
 * Mint the session cookie a walker drives the app with
 * (campaign admin-window/TASK-0033).
 *
 * ## Why this file exists, and why it is here and not under `src/`
 *
 * The M1 endgame — designer walk, user-sims, verifier — drives the real app in
 * a headless browser. Sign-in is Google-only, so a walker cannot get past the
 * gate the way a person does. Ben's ruling of 2026-09-03: a walker gets in with
 * a **minted session cookie** — not a new provider, not a dev flag, not a second
 * sign-in path in the app. next-auth v5 already ships the JWT `encode` its own
 * sign-in uses; this module calls it for a fixed, clearly-labelled walker
 * identity and prints a cookie descriptor a Playwright script can hand to
 * `context.add_cookies([...])`.
 *
 * The blind spot Ben accepted with that ruling, stated so nobody rediscovers it
 * as a bug: **the sign-in flow itself is never walked.**
 *
 * It lives in the TEST tree because `src/` gains nothing from a walker. The
 * layering guard (`tests/offline/db/layering.test.ts`) scans `src/` alone and
 * forbids a credential read outside `src/lib/db/client.ts`; this module reading
 * `AUTH_SECRET` from the test tree is the exact analogue of `tests/live/setup.ts`
 * reading the `STAGING_` names — the ONE place that name is read, refusing
 * rather than falling back. `src/` holds zero mentions of `AUTH_SECRET` and must
 * keep holding zero.
 *
 * ## `.mts`, not `.ts`
 *
 * Measured 2026-09-03 on the Node 26.7.0 this repo runs: `node
 * tests/walk/session-cookie.mts` runs directly (Node >= 23.6 strips types with
 * no flag) and `.mts` is unambiguously ESM, so top-level `await` and
 * `import { encode } from "next-auth/jwt"` both work with no warning. The same
 * file named `.ts` also runs but prints `MODULE_TYPELESS_PACKAGE_JSON` and
 * re-parses, because this package has no `"type": "module"` — noise on the
 * walker's stderr for nothing. A `.ts` test imports this as
 * `"../walk/session-cookie.mjs"`, which is how TypeScript names an ESM import
 * of a `.mts` source under this tsconfig.
 *
 * ## The two rules this file is built around
 *
 * 1. **stdout carries exactly one line: the descriptor as JSON.** Nothing else,
 *    ever — a walker parses it. Diagnostics, warnings and refusals go to stderr.
 * 2. **The only secret-derived value this program emits is the session token.**
 *    `AUTH_SECRET`'s value never appears on stdout or stderr, on any path,
 *    including the refusal path and any thrown error's message (see `scrub`).
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnvFile } from "dotenv";
import { decode, encode } from "next-auth/jwt";
import { scrub } from "./scrub.mts";

/**
 * The cookie Auth.js sets on plain-http localhost.
 *
 * Measured, not guessed: `@auth/core`'s `defaultCookies()` prefixes
 * `__Secure-` only when the resolved URL is `https:`
 * (`node_modules/next-auth/node_modules/@auth/core/lib/utils/cookie.js`), and
 * next-auth resolves that URL from `AUTH_URL` (`node_modules/next-auth/lib/env.js`),
 * which is `http://...` for every walk.
 *
 * This name is ALSO the salt Auth.js binds into the encryption key it derives
 * (`@auth/core/lib/actions/session.js`) — mint with any other salt and the
 * running app refuses the cookie. That is why `salt` defaults to it, and why
 * passing a different `salt` is exactly how the http suite builds a forgery.
 */
export const SESSION_COOKIE_NAME = "authjs.session-token";

/** The one environment name this module reads. A name, never a value. */
export const AUTH_SECRET_ENV_NAME = "AUTH_SECRET";

/**
 * The walker. Deliberately not a real person's address.
 *
 * `.local` is reserved (RFC 6762) and resolves nowhere, so this address cannot
 * be mistaken for, or delivered to, anybody.
 */
export const WALKER_IDENTITY: { sub: string; email: string; name: string } = {
  sub: "endgame-walker",
  email: "walker@admin-window.local",
  name: "Endgame Walker",
};

/** How long a minted session is good for, when the caller does not say. */
export const DEFAULT_MAX_AGE_SECONDS = 7200;

/** The host the descriptor is scoped to, when the caller does not say. */
export const DEFAULT_DOMAIN = "localhost";

/**
 * A cookie in the shape Playwright's `context.add_cookies([...])` takes.
 *
 * `sameSite` is spelled `"Lax"` — Playwright's capitalisation, not the
 * lowercase `"lax"` the Set-Cookie header uses.
 */
export interface CookieDescriptor {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  sameSite: "Lax";
}

/** Every key a descriptor carries, so a test can assert the set rather than a subset. */
export const COOKIE_DESCRIPTOR_KEYS = [
  "name",
  "value",
  "domain",
  "path",
  "httpOnly",
  "sameSite",
] as const;

/**
 * Is this environment value absent for our purposes?
 *
 * Unset, empty and whitespace-only are all **unset**: a name that is present
 * but blank is the commonest way a secret goes missing (an `AUTH_SECRET=` line
 * left in a file, a shell that exported nothing), and treating it as a value
 * would mint a cookie no server accepts and blame the app.
 *
 * Takes the value rather than the name so a caller can ask the question without
 * this module reaching into the environment, and so a test can exercise the
 * rule without spawning anything.
 */
export function isUnset(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * Remove every occurrence of `secret` from `text`.
 *
 * Belt and braces for rule 2 above. Nothing here is *expected* to echo the
 * secret — `encode` does not put it in its error messages — but "expected" is
 * not a guarantee, and a burned secret is not recoverable by apologising. Every
 * byte this program writes to stderr after the secret is resolved goes through
 * here.
 *
 * The implementation moved to `./scrub.mts` when the walk sandbox's reset tool
 * needed the same guarantee for a different secret (admin-window/TASK-0036);
 * it is re-exported here so this module's importers keep working unchanged.
 */
export { scrub };

/**
 * Mint a session cookie the running app's own `auth()` accepts.
 *
 * The caller supplies the secret; **this function never reads the environment**.
 * That keeps it a pure function of its arguments — the http suite mints with the
 * harness's throwaway literal, the CLI below mints with the resolved
 * `AUTH_SECRET`, and neither has to care what the other does.
 */
export async function mintSessionCookie(params: {
  /** The app's `AUTH_SECRET`. Supplied, never read from the environment here. */
  secret: string;
  /** The session claims. Defaults to the walker identity. */
  claims?: Record<string, unknown>;
  /** Cookie domain. Defaults to `localhost`. */
  domain?: string;
  /** Session lifetime. Defaults to two hours; a negative value mints an expired token. */
  maxAgeSeconds?: number;
  /** The key-derivation salt. Defaults to the cookie name, which is what the app expects. */
  salt?: string;
}): Promise<CookieDescriptor> {
  const {
    secret,
    claims = { ...WALKER_IDENTITY },
    domain = DEFAULT_DOMAIN,
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
    salt = SESSION_COOKIE_NAME,
  } = params;

  const value = await encode({
    token: claims,
    secret,
    salt,
    maxAge: maxAgeSeconds,
  });

  return {
    name: SESSION_COOKIE_NAME,
    value,
    domain,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  };
}

/**
 * Read a minted token back, with the app's own decoder.
 *
 * This module is the ONE place in `tests/` that may import next-auth's JWT
 * module — one mint, one copy (admin-window/TASK-0033, acceptance criterion 6),
 * pinned by a grep in the ticket's checks. So the inverse travels with it:
 * without this, a test that wants to prove the round-trip would have to reach
 * for that import itself and break the rule.
 *
 * Returns `null` when the token does not decrypt — a wrong secret and a wrong
 * salt both land here, which is exactly the negative half of the round-trip
 * proof.
 */
export async function decodeSessionToken(params: {
  token: string;
  secret: string;
  salt?: string;
}): Promise<Record<string, unknown> | null> {
  const { token, secret, salt = SESSION_COOKIE_NAME } = params;
  try {
    return (await decode({ token, secret, salt })) as Record<string, unknown> | null;
  } catch {
    // `decode` throws rather than returning null for some malformed inputs;
    // callers here only ever ask "did this open?", so both are `null`.
    return null;
  }
}

/* ── the CLI ──────────────────────────────────────────────────────────────── */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export const USAGE =
  "usage: node tests/walk/session-cookie.mts " +
  "[--domain <host>] [--max-age <seconds>] [--email <address>]";

/** What the CLI decided to do, before it does anything observable. */
type Plan =
  | { ok: true; domain: string; maxAgeSeconds: number; email: string }
  | { ok: false; message: string };

/**
 * Parse argv into a plan, or into a refusal.
 *
 * Unknown flags and missing operands are refusals rather than silently ignored:
 * a walker that typoed `--maxage` should be told, not handed a two-hour cookie
 * it did not ask for. Exported so the offline suite can assert the rules without
 * a spawn per case.
 */
export function planFromArgs(argv: readonly string[]): Plan {
  let domain = DEFAULT_DOMAIN;
  let maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS;
  let email = WALKER_IDENTITY.email;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const operand = argv[index + 1];
    if (flag === "--domain" || flag === "--max-age" || flag === "--email") {
      if (operand === undefined) {
        return { ok: false, message: `${flag} needs a value\n${USAGE}` };
      }
      index += 1;
      if (flag === "--domain") {
        if (operand.trim().length === 0) {
          return { ok: false, message: `--domain needs a non-empty host\n${USAGE}` };
        }
        domain = operand;
      } else if (flag === "--email") {
        if (operand.trim().length === 0) {
          return { ok: false, message: `--email needs a non-empty address\n${USAGE}` };
        }
        email = operand;
      } else {
        const seconds = Number(operand);
        if (!Number.isFinite(seconds)) {
          return { ok: false, message: `--max-age needs a number of seconds, got ${operand}\n${USAGE}` };
        }
        maxAgeSeconds = seconds;
      }
      continue;
    }
    return { ok: false, message: `unknown argument ${flag}\n${USAGE}` };
  }

  return { ok: true, domain, maxAgeSeconds, email };
}

/**
 * Resolve `AUTH_SECRET`: the process environment first, then the repo-root
 * `.env`.
 *
 * That is precisely the precedence `next dev` itself uses via `@next/env`, which
 * is what makes the minted cookie and the running walk instance agree on the
 * secret; it is the same pattern `tests/live/setup.ts` already uses for the
 * staging names. It is **not** a fallback to some other name — there is exactly
 * one name, and an unset one is a refusal.
 *
 * `dotenv` never overrides a name already present, so an explicit
 * `AUTH_SECRET=` in the caller's environment stays empty. That is how the
 * offline suite provokes the refusal deterministically even on a machine whose
 * `.env` carries a real secret.
 */
function resolveSecret(): string | undefined {
  if (!isUnset(process.env.AUTH_SECRET)) return process.env.AUTH_SECRET;
  loadEnvFile({ path: path.join(repoRoot, ".env"), quiet: true });
  const fromFile = process.env.AUTH_SECRET;
  return isUnset(fromFile) ? undefined : fromFile;
}

/**
 * The CLI body. Returns the exit code; writes through the two sinks it is given
 * so a test can drive it without a subprocess if it ever wants to.
 */
export async function runCli(
  argv: readonly string[],
  out: (line: string) => void,
  err: (line: string) => void,
): Promise<number> {
  const plan = planFromArgs(argv);
  if (!plan.ok) {
    err(`${plan.message}\n`);
    return 2;
  }

  const secret = resolveSecret();
  if (secret === undefined) {
    // Names the name, never a value. No default, no generated secret, no
    // "assume dev" — an unset secret is a refusal.
    err(
      `${AUTH_SECRET_ENV_NAME} is not set (unset, empty or whitespace-only), and the ` +
        `repo-root .env does not supply it. This mints nothing: a walker's cookie is ` +
        `only accepted by an app started with the SAME ${AUTH_SECRET_ENV_NAME}, so ` +
        `there is nothing to fall back to. Set ${AUTH_SECRET_ENV_NAME} in this shell, ` +
        `to the same value the walk instance is started with.\n`,
    );
    return 1;
  }

  try {
    const claims =
      plan.email === WALKER_IDENTITY.email
        ? { ...WALKER_IDENTITY }
        : { ...WALKER_IDENTITY, email: plan.email };
    const descriptor = await mintSessionCookie({
      secret,
      claims,
      domain: plan.domain,
      maxAgeSeconds: plan.maxAgeSeconds,
    });
    // The one line. `JSON.stringify` of a descriptor cannot contain a newline
    // unescaped, so "one line" is a property of the output, not a hope.
    out(`${JSON.stringify(descriptor)}\n`);
    return 0;
  } catch (error) {
    // Scrubbed: an exception's message is the one path where a value could
    // plausibly leak, and this program's whole contract is that it does not.
    const message = error instanceof Error ? error.message : String(error);
    err(`failed to mint a session cookie: ${scrub(message, secret)}\n`);
    return 1;
  }
}

/**
 * Are we the program, or a module somebody imported?
 *
 * Imported, this file prints nothing and exits nothing — `tests/http/*` imports
 * `mintSessionCookie` from it while a walker runs it.
 */
const invokedAsMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  process.exitCode = await runCli(
    process.argv.slice(2),
    (line) => process.stdout.write(line),
    (line) => process.stderr.write(line),
  );
}
