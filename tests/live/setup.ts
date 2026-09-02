/**
 * The live suite's setup file (campaign admin-window, admin-window/TASK-0003).
 *
 * Registered as the `live` project's `setupFiles` in `vitest.config.mts`, so
 * it runs before every `tests/live/**\/*.live.test.ts` file and no live test
 * can opt out of it.
 *
 * It is the ONE place `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SERVICE_ROLE_KEY` are read. Nothing under `src/` may
 * mention a `STAGING_` name; the app reads `SUPABASE_URL` /
 * `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/db/client.ts`) and this file is what
 * points those at staging for the live run — in this file, in this process,
 * and nowhere else.
 *
 * Three things happen here, in order:
 *
 *  1. `.env` is loaded explicitly with `dotenv`. Vitest does not read `.env`,
 *     so without this the names are simply absent. `dotenv` never overrides a
 *     name already present in the environment, so an explicit
 *     `STAGING_SUPABASE_URL=` in the caller's environment stays empty — which
 *     is how the offline suite provokes the refusal deterministically.
 *  2. The guard runs (`staging-target.ts`). A missing name, an unparseable
 *     URL, no declared staging target, or a host that is not the declared one
 *     all THROW here — the run fails, non-zero, before a single test body or
 *     network call. No fallback, no default, no "assume staging".
 *  3. Only then are the app's own names set to the staging values.
 *
 * Nothing in this file prints a value. The host and the declared target are
 * identifiers, not credentials, and they appear in refusals because a refusal
 * nobody can act on is not much of a refusal.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnvFile } from "dotenv";
import {
  SERVICES_DOC_PATH,
  resolveStagingTarget,
  type StagingTarget,
} from "./staging-target";

/** The names the live suite reads. Names, never values. */
export const STAGING_URL_ENV_NAME = "STAGING_SUPABASE_URL";
export const STAGING_KEY_ENV_NAME = "STAGING_SUPABASE_SERVICE_ROLE_KEY";

/** The names the APP reads — the ones this file points at staging. */
export const APP_URL_ENV_NAME = "SUPABASE_URL";
export const APP_KEY_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

// `quiet` keeps dotenv's banner out of the suite's output; it never prints a
// value either way.
loadEnvFile({ path: path.join(repoRoot, ".env"), quiet: true });

/** The declaration text, or `null` when the doc is not there at all. */
function servicesDoc(): string | null {
  try {
    return readFileSync(path.join(repoRoot, SERVICES_DOC_PATH), "utf8");
  } catch {
    return null;
  }
}

/**
 * The resolved staging target. Reaching this line at all means both names
 * were set and the host is the declared one — a live test can rely on that
 * without re-checking.
 */
export const stagingTarget: StagingTarget = resolveStagingTarget({
  // Direct member access, and the only read of these two names in the repo.
  url: process.env.STAGING_SUPABASE_URL,
  key: process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  names: { url: STAGING_URL_ENV_NAME, key: STAGING_KEY_ENV_NAME },
  services: servicesDoc(),
});

process.env.SUPABASE_URL = stagingTarget.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = stagingTarget.key;

/** The staging host every live test is talking to. An identifier, not a secret. */
export const stagingHost = stagingTarget.host;

/** The target as `SERVICES.md` declares it. */
export const declaredTarget = stagingTarget.declared;
