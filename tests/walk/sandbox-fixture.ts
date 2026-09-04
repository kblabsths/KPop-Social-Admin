/**
 * The walk sandbox's seed rows — the state every walk starts from.
 *
 * `public.walk_sandbox` exists on the STAGING project only, created by hand
 * from the DDL in `agenticflow/tracker/for-human/TASK-0034.md`
 * (`ARCHITECTURE.md` §9.1). This module is the checked-in copy of the rows
 * that DDL seeds, and `reset-sandbox.mts` puts the table back to exactly this
 * after a walk has edited it. The two must agree, which is why the values
 * below are the paste's values character for character.
 *
 * ## Three rules this file lives under
 *
 * 1. **No campaign marker anywhere in it.** `tests/live/residue.live.test.ts`
 *    sweeps every mapped table for the campaign's name and calls a hit
 *    residue; a fixture carrying that string would fail that sweep on every
 *    run, for rows that are supposed to be there. So the rows say "sandbox",
 *    and this docstring cites tickets by their `for-human`/doc path rather
 *    than by a campaign-qualified id (§9.1 item 6).
 * 2. **It imports nothing.** `reset-sandbox.mts` is run by bare `node` and
 *    imports this file by its real extension; anything reached from here would
 *    have to survive type-stripping too. It also means nothing under `src/`
 *    is on this path — the sandbox chain touches `src/` in exactly one place,
 *    the `EDIT_CONFIG` entry, and that entry imports nothing from here.
 * 3. **The column list is duplicated here on purpose, and pinned.** Rule 2
 *    forbids importing `EDIT_CONFIG`'s `mappedColumns`, so
 *    `tests/offline/walk/sandbox-fixture.test.ts` asserts the two agree —
 *    the copy is checked by a test rather than trusted.
 *
 * ## Why the keys look like that
 *
 * `sandbox_id` is a `uuid` because `isRecordId` (`src/lib/db/records.ts`)
 * refuses a record-page segment that is not one BEFORE any read: a text key
 * made both of the sandbox's states unreachable at its own address (§9.1
 * item 9). They are zeros to the last digit so that nothing generates a value
 * like them — a row of it in a console or a sweep is unmistakably this
 * fixture.
 */

/** The table, on staging only. Spelled here because rule 2 forbids the import. */
export const SANDBOX_TABLE = "walk_sandbox";

/** Its primary key column. */
export const SANDBOX_PK = "sandbox_id";

/**
 * Every column the record surface deals in, in the map's own order.
 *
 * `created_at` is deliberately absent: it is set by the column default at
 * insert, is outside `EDIT_CONFIG`'s map, and is therefore never read, never
 * drawn and never written. A reset re-seeds it, so it is the one column two
 * consecutive resets do not leave identical — which is why the tool compares
 * these columns and not `select("*")`.
 */
export const SANDBOX_COLUMNS = [
  "sandbox_id",
  "label",
  "note",
  "tally",
  "is_flagged",
  "observed_on",
] as const;

/** One seeded row, in the shape PostgREST takes and returns. */
export interface SandboxRow {
  /** uuid. */
  sandbox_id: string;
  /** `not null` — clearing it is refused by the database, on purpose. */
  label: string;
  /** Nullable text: the em-dash absence a walker fills in. */
  note: string | null;
  /** `not null` integer — the integer coercion, and a second refusable clear. */
  tally: number;
  /** `not null` boolean — the boolean coercion, and the third refusable clear. */
  is_flagged: boolean;
  /** Nullable date, `YYYY-MM-DD` as PostgREST returns it. */
  observed_on: string | null;
}

/**
 * The three rows, in key order.
 *
 * Row 2 carries a null `note` AND a null `observed_on`, so the
 * absence-then-fill path is walkable without disturbing row 1's filled values;
 * row 3 says "leave this one alone" so a walk has an untouched control to
 * compare against. `2026-02-20` and not the 29th: 2026 is not a leap year.
 */
export const SANDBOX_FIXTURE: readonly SandboxRow[] = Object.freeze([
  Object.freeze({
    sandbox_id: "00000000-0000-4000-8000-000000000001",
    label: "First sandbox row",
    note: "A note a walker may rewrite.",
    tally: 7,
    is_flagged: false,
    observed_on: "2026-01-15",
  }),
  Object.freeze({
    sandbox_id: "00000000-0000-4000-8000-000000000002",
    label: "Second sandbox row",
    note: null,
    tally: 0,
    is_flagged: true,
    observed_on: null,
  }),
  Object.freeze({
    sandbox_id: "00000000-0000-4000-8000-000000000003",
    label: "Third sandbox row",
    note: "Leave this one alone.",
    tally: 42,
    is_flagged: false,
    observed_on: "2026-02-20",
  }),
]);

/** The key a recipe deep-links to: the first row. */
export const SANDBOX_WALK_KEY = SANDBOX_FIXTURE[0].sandbox_id;
