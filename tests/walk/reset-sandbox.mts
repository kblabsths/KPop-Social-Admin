/**
 * Reset the walk sandbox to its seed rows (campaign admin-window/TASK-0036).
 *
 * ## What it is for
 *
 * Ben's exception of 2026-09-03: "a table that always exists which walkers can
 * interact with. After a walk it should be reset for the next walk."
 * `public.walk_sandbox` is that table — staging only, created BY HAND from the
 * DDL in `agenticflow/tracker/for-human/TASK-0034.md` — and this is the reset.
 * Run it and two consecutive walks start from byte-identical rows, however
 * thoroughly the first one edited them.
 *
 * It is **nothing more than that**. It is not a migration runner, not a
 * general staging-fixture tool, and it never emits DDL: the mechanism ruled in
 * `ARCHITECTURE.md` §9.1 is that the table is created once by a human and that
 * kit-side tooling only DELETEs and re-INSERTs rows. PostgREST cannot execute
 * SQL, so that is not a restraint this file exercises — it is the only thing
 * its client is able to do.
 *
 * ## The five properties it is built on
 *
 * 1. **It refuses against anything that is not the declared staging target.**
 *    Through `resolveStagingTarget` (`../live/staging-target.ts`) against the
 *    target a human declared in `agenticflow/docs/SERVICES.md` — the SAME
 *    guard the live suite runs, with this tool's own name in the refusals. No
 *    second host check exists here or anywhere else; a second one would be a
 *    second opinion about what staging is.
 * 2. **It reads its credentials from its OWN process environment**, under the
 *    names the app itself reads (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`),
 *    and **loads no `.env`**. A walker maps the staging names onto those two on
 *    the launching command line, exactly as the walk instance is launched
 *    (STACK.md §5). So `tests/live/setup.ts` stays the one and only reader of
 *    the staging names, and a stale `.env` on somebody's disk can never
 *    silently choose this tool's target.
 * 3. **It prints no key.** The host and the declared target are identifiers
 *    and appear in the output on purpose — a walker has to be able to see
 *    which project was reset. The service-role key appears nowhere, on either
 *    stream, on any path: every byte written to stderr after the key is read
 *    goes through `scrub` first.
 * 4. **It is not reachable from the app.** Nothing under `src/` imports it, it
 *    imports nothing from `src/`, and it builds its own client rather than
 *    going through `src/lib/db/**`.
 * 5. **An absent table is a loud refusal, never a silent success.** Until Ben
 *    pastes the DDL, every read of `walk_sandbox` on staging answers
 *    `PGRST205`. This tool then exits non-zero naming the table and the
 *    paste-ready note, having written nothing — a reset that "succeeded"
 *    against a table that is not there would send a walker to a URL that draws
 *    the not-provisioned card, hunting a bug that is a missing paste.
 *
 * ## Running it
 *
 * The command is written out verbatim in **STACK.md §5, step 3** — the same
 * subshell-and-mapping idiom the walk instance is launched with, and the one
 * place a walker copies it from. It is not repeated here on purpose: this file
 * must not spell the staging names at all (property 2), and a second copy of a
 * launch line is a second thing to keep correct.
 *
 * Cadence, ruled in §9.1 item 4: **immediately before every walk, mandatory**;
 * again after a walk that wrote, when convenient. A before-reset is the only
 * one a crashed or abandoned walk cannot skip.
 *
 * ## `.mts`, and the real extensions in its imports
 *
 * Same reason as `session-cookie.mts`: Node >= 23.6 runs a `.mts` file with no
 * flag, and `.mts` is unambiguously ESM in a package with no `"type":
 * "module"`. Its imports carry their real `.ts`/`.mts` extensions because Node
 * resolves no extensionless TypeScript specifier and does not rewrite a
 * `.mjs` specifier onto a `.mts` file (measured on the Node 26.7.0 this repo
 * runs, 2026-09-04: `import "./dep.mjs"` against a `dep.mts` is
 * `ERR_MODULE_NOT_FOUND`). `tsconfig.json`'s `allowImportingTsExtensions` is
 * what lets `tsc` accept the same spelling; the alternative was a second copy
 * of the staging guard, which property 1 forbids.
 *
 * ## The one window where a failure is visible
 *
 * DELETE and INSERT are two PostgREST requests and there is no transaction
 * across them: if the insert fails, the table is left EMPTY rather than
 * half-seeded. That is stated rather than defended — the fix is to run the tool
 * again, the failure is loud and non-zero, and buying atomicity would cost a
 * Postgres driver and a DSN-shaped credential that §9.1 rejected on purpose.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  LiveGuardError,
  SERVICES_DOC_PATH,
  resolveStagingTarget,
} from "../live/staging-target.ts";
import { scrub } from "./scrub.mts";
import {
  SANDBOX_COLUMNS,
  SANDBOX_FIXTURE,
  SANDBOX_PK,
  SANDBOX_TABLE,
  type SandboxRow,
} from "./sandbox-fixture.ts";

/** How this program is named in the guard's refusals. A name, never a value. */
export const RESET_CALLER_NAME = "the walk-sandbox reset tool";

/**
 * The two names this program reads, out of its own environment.
 *
 * They are the names the APP reads (`src/lib/db/client.ts`), because a walker
 * maps the staging pair onto them on the launch line and this tool is launched
 * the same way the walk instance is. It deliberately reads no other name, and
 * an unset one is a refusal rather than a fallback.
 */
export const DB_URL_ENV_NAME = "SUPABASE_URL";
export const DB_KEY_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";

/**
 * PostgREST's and Postgres's own codes for "that object is not here".
 *
 * The same two `tests/live/parity.ts` grades absence with (`ABSENCE_CODES`),
 * spelled again here rather than imported: that module reaches `@/lib/format`,
 * an alias bare `node` cannot resolve, and property 4 forbids this file a path
 * into `src/` anyway. Two constants, pinned equal by
 * `tests/offline/walk/sandbox-fixture.test.ts` so the copy is checked rather
 * than trusted.
 */
export const ABSENCE_CODES: readonly string[] = ["PGRST205", "42P01"];

/** The table is not on this project — the reset cannot and must not proceed. */
export class SandboxAbsentError extends Error {
  /** The project the table is missing from. An identifier, never a value. */
  readonly host: string;

  // A field and an assignment rather than a parameter property: Node's
  // strip-only TypeScript refuses `constructor(readonly host: string)` with
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, and this file is run by bare `node`.
  constructor(host: string) {
    super(
      `${RESET_CALLER_NAME} refuses: the table "${SANDBOX_TABLE}" is not on ` +
        `${host}, so there is nothing to reset and nothing was written. This ` +
        `tool never creates it: ${SANDBOX_TABLE} is created BY HAND, once, on ` +
        `the staging project — the paste-ready SQL is in ` +
        `agenticflow/tracker/for-human/TASK-0034.md. Until a human runs it, ` +
        `the sandbox's record page correctly draws the not-provisioned card.`,
    );
    this.name = "SandboxAbsentError";
    this.host = host;
  }
}

/** The reset asked the database for something and the database said no. */
export class SandboxResetError extends Error {
  constructor(message: string) {
    super(`${RESET_CALLER_NAME} refuses: ${message}`);
    this.name = "SandboxResetError";
  }
}

/** What one reset did. Counts, so a caller can print them without re-reading. */
export interface ResetOutcome {
  deleted: number;
  seeded: number;
}

/** The `code` a PostgREST error carries, or `""` when it carries none. */
export function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code ?? "")
    : "";
}

/** A PostgREST error rendered for a human: its code and its message, no more. */
function describe(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const code = codeOf(error);
  const message =
    "message" in error ? String((error as { message: unknown }).message) : "";
  return code.length > 0 ? `${code} ${message}` : message;
}

/**
 * The fixture's own columns, projected out of a row PostgREST returned.
 *
 * `created_at` is outside the map and is re-set by the column default on every
 * insert, so it is the one column two consecutive resets do not leave
 * identical. Comparing the projection rather than the whole row is what makes
 * "run it twice and the rows are identical" a true statement instead of a
 * nearly-true one.
 */
export function projectFixtureColumns(row: Record<string, unknown>): SandboxRow {
  const projected: Record<string, unknown> = {};
  for (const column of SANDBOX_COLUMNS) projected[column] = row[column];
  return projected as unknown as SandboxRow;
}

/** The fixture's rows, ordered by key — the order a read-back is compared in. */
export function fixtureInKeyOrder(): readonly SandboxRow[] {
  return [...SANDBOX_FIXTURE].sort((left, right) =>
    left.sandbox_id.localeCompare(right.sandbox_id),
  );
}

/**
 * Do these rows carry exactly the fixture, in key order?
 *
 * Compared as JSON over the fixture's columns in the fixture's own column
 * order, so a value that came back with a different type (a `tally` PostgREST
 * decided was a string, a `date` that grew a time) fails rather than passes on
 * a loose equality.
 */
export function matchesFixture(rows: readonly Record<string, unknown>[]): boolean {
  const seen = [...rows]
    .map(projectFixtureColumns)
    .sort((left, right) => left.sandbox_id.localeCompare(right.sandbox_id));
  const wanted = fixtureInKeyOrder();
  if (seen.length !== wanted.length) return false;
  return seen.every(
    (row, index) =>
      JSON.stringify(row, SANDBOX_COLUMNS as unknown as string[]) ===
      JSON.stringify(wanted[index], SANDBOX_COLUMNS as unknown as string[]),
  );
}

/**
 * Delete every row of the sandbox and re-insert the fixture.
 *
 * Takes the client rather than building one, so the DML is provable against a
 * stub PostgREST without a staging project and without going near the guard
 * (which is proved separately, offline, on its refusals). The guard still runs
 * before this is ever called by the CLI below — a client this function is
 * handed has already been pointed at a target a human declared.
 *
 * Order: probe, delete, insert, read back. The probe is what turns an absent
 * table into a refusal before anything is written; the read-back is what turns
 * "the requests returned 2xx" into "the rows are the fixture".
 */
export async function resetSandbox(client: SupabaseClient): Promise<ResetOutcome> {
  const probe = await client.from(SANDBOX_TABLE).select(SANDBOX_PK).limit(1);
  if (probe.error) {
    if (ABSENCE_CODES.includes(codeOf(probe.error))) {
      throw new SandboxAbsentError(hostOfClient(client));
    }
    throw new SandboxResetError(
      `reading ${SANDBOX_TABLE} failed, so nothing was written: ` +
        describe(probe.error),
    );
  }

  // PostgREST has no TRUNCATE and refuses an unfiltered DELETE. `pk is not
  // null` is the filter every row of a primary key satisfies and no row
  // escapes — "every row", written in the only grammar available.
  const deleted = await client
    .from(SANDBOX_TABLE)
    .delete()
    .not(SANDBOX_PK, "is", null)
    .select(SANDBOX_PK);
  if (deleted.error) {
    throw new SandboxResetError(
      `clearing ${SANDBOX_TABLE} failed: ${describe(deleted.error)}`,
    );
  }

  const seeded = await client
    .from(SANDBOX_TABLE)
    .insert(SANDBOX_FIXTURE as SandboxRow[])
    .select(SANDBOX_COLUMNS.join(","));
  if (seeded.error) {
    throw new SandboxResetError(
      `seeding ${SANDBOX_TABLE} failed — the table is now EMPTY, because the ` +
        `delete already ran and PostgREST has no transaction across two ` +
        `requests. Run this again: ${describe(seeded.error)}`,
    );
  }

  const readBack = await client
    .from(SANDBOX_TABLE)
    .select(SANDBOX_COLUMNS.join(","))
    .order(SANDBOX_PK);
  if (readBack.error) {
    throw new SandboxResetError(
      `reading ${SANDBOX_TABLE} back after seeding it failed: ` +
        describe(readBack.error),
    );
  }
  const rows = (readBack.data ?? []) as unknown as Record<string, unknown>[];
  if (!matchesFixture(rows)) {
    throw new SandboxResetError(
      `${SANDBOX_TABLE} does not match the fixture after the reset: seeded ` +
        `${SANDBOX_FIXTURE.length} rows, read back ${rows.length}. The ` +
        `fixture is tests/walk/sandbox-fixture.ts; the table's columns may ` +
        `have drifted from the DDL in ` +
        `agenticflow/tracker/for-human/TASK-0034.md.`,
    );
  }

  return {
    deleted: (deleted.data ?? []).length,
    seeded: (seeded.data ?? []).length,
  };
}

/**
 * The host a client was built against — for the absent-table refusal, which
 * has to say WHICH project the table is missing from.
 *
 * supabase-js keeps the REST endpoint on the client; a shape change would make
 * this an empty string rather than throw, because a refusal that crashes while
 * composing itself helps nobody.
 */
function hostOfClient(client: SupabaseClient): string {
  const url = (client as unknown as { supabaseUrl?: unknown }).supabaseUrl;
  if (typeof url !== "string") return "this project";
  try {
    return new URL(url).host;
  } catch {
    return "this project";
  }
}

/* ── the CLI ──────────────────────────────────────────────────────────────── */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export const USAGE = "usage: node tests/walk/reset-sandbox.mts";

/** What the CLI decided to do, before it does anything observable. */
export type Plan = { ok: true } | { ok: false; message: string };

/**
 * Parse argv into a plan, or into a refusal.
 *
 * This program takes no flags: it does one thing to one table from one
 * fixture, and every knob it could have grown is a decision §9.1 already made.
 * An unknown argument is therefore a refusal rather than something ignored —
 * a walker who typed `--dry-run` expecting one must be told there isn't one,
 * not handed a real reset.
 */
export function planFromArgs(argv: readonly string[]): Plan {
  if (argv.length === 0) return { ok: true };
  return { ok: false, message: `unknown argument ${argv[0]}\n${USAGE}` };
}

/** The declaration text, or `null` when the doc is not there at all. */
function servicesDoc(): string | null {
  try {
    return readFileSync(path.join(repoRoot, SERVICES_DOC_PATH), "utf8");
  } catch {
    return null;
  }
}

/**
 * The CLI body. Returns the exit code and writes through the two sinks it is
 * given, so a test can drive it without a subprocess.
 *
 * `env` is a parameter for the same reason: a test picks the environment the
 * case is about instead of mutating the one it runs in.
 */
export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  out: (line: string) => void,
  err: (line: string) => void,
): Promise<number> {
  const plan = planFromArgs(argv);
  if (!plan.ok) {
    err(`${plan.message}\n`);
    return 2;
  }

  // Direct member access, the same spelling `src/lib/db/client.ts` uses, and
  // the whole of this program's relationship with the environment.
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  let target;
  try {
    target = resolveStagingTarget({
      url,
      key,
      names: { url: DB_URL_ENV_NAME, key: DB_KEY_ENV_NAME },
      services: servicesDoc(),
      caller: RESET_CALLER_NAME,
    });
  } catch (error) {
    if (error instanceof LiveGuardError) {
      err(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const client = createClient(target.url, target.key, {
    auth: { persistSession: false },
  });

  try {
    const outcome = await resetSandbox(client);
    out(
      `${SANDBOX_TABLE} reset on ${target.host} (declared staging target ` +
        `"${target.declared}"): deleted ${outcome.deleted}, seeded ` +
        `${outcome.seeded}, read back and verified against ` +
        `tests/walk/sandbox-fixture.ts.\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Scrubbed: an exception raised anywhere under `resetSandbox` is the one
    // path whose wording this program does not control, and the key is the one
    // value it must never emit.
    err(`${scrub(message, target.key)}\n`);
    return 1;
  }
}

/**
 * Are we the program, or a module somebody imported?
 *
 * Imported, this file prints nothing, reads no environment and exits nothing —
 * the offline suite imports it for its constants and its pure functions.
 */
const invokedAsMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  process.exitCode = await runCli(
    process.argv.slice(2),
    process.env,
    (line) => process.stdout.write(line),
    (line) => process.stderr.write(line),
  );
}
