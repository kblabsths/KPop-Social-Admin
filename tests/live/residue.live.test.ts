import { describe, expect, it } from "vitest";
import {
  EDITABLE_TABLES,
  EDIT_CONFIG,
  mappedColumns,
  type TableEditConfig,
} from "@/lib/edit/config";
import { codeOf, exactCount } from "./parity";
import { stagingHost } from "./setup";

/**
 * Zero residue — the milestone's closing evidence (campaign
 * admin-window/TASK-0019).
 *
 * Acceptance test 13: "the live suite sweeps what it wrote; staging carries no
 * campaign leftovers after the final run", M1 EC13. Every live test that
 * writes records its undo before the write and runs it in a `finally`
 * (`tests/live/sweep.ts`), and the edit-surface test reads its row back a third
 * time to prove the restore landed. This file is the independent check on all
 * of that: it asks STAGING, without consulting any of those tests, whether
 * anything of this campaign is still there.
 *
 * **What it looks for.** Every value this campaign can write is stamped with
 * the campaign name — `admin-window/<TICKET> probe`
 * (`tests/live/edit.live.test.ts`'s `PROBE`) — so a leftover is findable by
 * that stamp alone, whether it was left in a column that was edited or in a
 * row that was created. The search space is derived from the ONE map that
 * decides what Admin may write (`src/lib/edit/config.ts`): its tables, and the
 * columns those tables actually carry. There is no second write surface in
 * this repo, so there is no second place to look.
 *
 * **How it knows which columns it can scan** (admin-window/BUG-0058). The
 * marker search is `ilike`, and Postgres has no `~~*` for a timestamp, a date,
 * a uuid, a number, an enum, an array or jsonb — such a scan is an ERROR
 * rather than an answer (`42883 operator does not exist`). So the sweep asks
 * the database for each column's DECLARED TYPE and grades only the text ones.
 *
 * The type comes from PostgREST's own schema description (`GET /rest/v1/`,
 * the OpenAPI document it generates from the live catalog), never from the
 * JSON type of a sampled value: PostgREST serialises a `timestamptz`, a
 * `uuid` and a `date` all as JSON STRINGS, so `typeof value === "string"`
 * called `groups.created_at` a text column and the sweep threw on the first
 * table before it graded one single column — every "swept, clean" this
 * campaign reported was an exception, not a zero (admin-window/BUG-0058).
 * Reading the declaration also means a column whose sampled rows were all null
 * is no longer invisible to the sweep.
 *
 * A column the sweep cannot scan is NAMED, never silently dropped: the report
 * this test prints lists every ungraded column with the type that excluded it,
 * and the failure messages carry the same list. And a column the sweep DID
 * decide to grade may never come back as a quiet zero — an error from its scan
 * throws, with the column name and the database's own code.
 *
 * **When it runs.** After the writer. `edit.live.test.ts` sorts before
 * `residue.live.test.ts`, which is the order that matters, and the file is
 * also correct run on its own after a full live pass:
 *
 *     npx vitest run --project=live tests/live/residue.live.test.ts
 *
 * Because the live project may run its files in parallel workers, a value
 * found here could in principle be a write still IN FLIGHT rather than
 * residue. That is why a hit is re-checked before it is reported: a live
 * write's undo runs in a `finally` seconds later, so a value that survives the
 * re-checks is residue and a value that vanishes was someone's in-flight
 * probe. The failure says which it is looking at, so nobody has to guess.
 *
 * It writes NOTHING. Read-only against staging, by name, through the same
 * guard every live test runs (`tests/live/setup.ts`).
 */

/** The stamp every value this campaign writes carries. */
const CAMPAIGN_MARKER = "admin-window";

/** A hit is re-checked this many times before it is called residue. */
const RECHECKS = 3;
const RECHECK_PAUSE_MS = 2000;

/**
 * The declared Postgres types `ilike` accepts — an ALLOWLIST, so a type nobody
 * anticipated is excluded and NAMED rather than scanned and thrown on. These
 * are the spellings PostgREST puts in its description's `format` field, which
 * are Postgres's own type names.
 */
const SWEEPABLE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "character varying",
  "character",
  "citext",
  "name",
]);

/** What PostgREST's description says about one column. */
interface DescribedColumn {
  readonly column: string;
  /** The declared Postgres type, or `""` when the description gave none. */
  readonly type: string;
  /** Whether `ilike` can be applied to that type at all. */
  readonly sweepable: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How a column's type reads in a report, when the description gave none. */
function typeLabel(type: string): string {
  return type === "" ? "type not declared" : type;
}

/**
 * PostgREST's schema description of the whole staging catalog: for each table,
 * its columns and their declared Postgres types.
 *
 * One request per run (`GET /rest/v1/`, the OpenAPI document PostgREST
 * generates from the live catalog). This is the database's own account of its
 * types — not a second copy of the schema in this file, which the schema truth
 * rule forbids, and not an inference from a sampled value, which is the defect
 * admin-window/BUG-0058 fixed.
 *
 * Reads the APP's names, which `tests/live/setup.ts` has already pointed at
 * staging — like `independentClient()`, this file never touches a `STAGING_`
 * name. Nothing here prints the target or the key: refusals name the host and
 * the HTTP status, which are identifiers rather than credentials.
 */
async function describeStaging(): Promise<Map<string, DescribedColumn[]>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "the residue sweep has no target: SUPABASE_URL / " +
        "SUPABASE_SERVICE_ROLE_KEY are unset, which means tests/live/setup.ts " +
        "did not run. Live tests must run through `npm run test:live`.",
    );
  }

  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/openapi+json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `the residue sweep could not read the schema description of ` +
        `${stagingHost}: HTTP ${response.status}. Without it the sweep does ` +
        `not know which columns hold text, and a sweep that scans nothing is ` +
        `not a clean result.`,
    );
  }

  const body = (await response.json()) as {
    definitions?: Record<string, { properties?: Record<string, { format?: string }> }>;
  };
  const definitions = body.definitions ?? {};
  const described = new Map<string, DescribedColumn[]>();
  for (const [table, definition] of Object.entries(definitions)) {
    const columns = Object.entries(definition.properties ?? {}).map(
      ([column, property]) => {
        const type = property.format ?? "";
        return { column, type, sweepable: SWEEPABLE_TYPES.has(type) };
      },
    );
    described.set(table, columns);
  }
  if (described.size === 0) {
    throw new Error(
      `the schema description of ${stagingHost} named no table at all, so ` +
        `the residue sweep has no columns to scan. A sweep that scans nothing ` +
        `is not a clean result.`,
    );
  }
  return described;
}

/**
 * The described columns of one editable table.
 *
 * A table the description does not carry is a REFUSAL, never an empty sweep:
 * a table in `EDIT_CONFIG` that staging does not expose is either a rename
 * nobody told the map about or a description this sweep failed to read, and
 * both would otherwise pass as "no residue here".
 */
function columnsOf(
  described: Map<string, DescribedColumn[]>,
  config: TableEditConfig,
): DescribedColumn[] {
  const columns = described.get(config.table);
  if (columns === undefined || columns.length === 0) {
    throw new Error(
      `${stagingHost}'s schema description carries no column for ` +
        `${config.table}, a table the edit map names. The sweep cannot scan a ` +
        `table it cannot describe, and skipping it would report clean on a ` +
        `place it never looked.`,
    );
  }
  return columns;
}

/**
 * The vacuity guard, as a function so it can be exercised without a database:
 * a table the sweep graded NO column of is a failure naming what it saw, never
 * a silent zero (the whole defect of admin-window/BUG-0058 was a sweep that
 * counted nothing and was read as clean).
 */
function assertSomethingToSweep(table: string, columns: readonly DescribedColumn[]): void {
  const sweepable = columns.filter((column) => column.sweepable);
  if (sweepable.length > 0) return;
  throw new Error(
    `the residue sweep found no scannable column on ${table}: none of its ` +
      `${columns.length} column(s) holds text ` +
      `(${columns.map((c) => `${c.column} (${typeLabel(c.type)})`).join(", ") || "none described"}). ` +
      `A sweep that scans no column of a table cannot report that table clean.`,
  );
}

/** One table's line of the report: what was scanned, and what was not, and why. */
function reportLine(
  table: string,
  columns: readonly DescribedColumn[],
  marked: ReadonlyMap<string, number>,
): string {
  const scanned = columns.filter((column) => column.sweepable);
  const skipped = columns.filter((column) => !column.sweepable);
  const scannedText = scanned
    .map((column) => `${column.column}=${marked.get(column.column) ?? "?"}`)
    .join(", ");
  const skippedText =
    skipped
      .map((column) => `${column.column} (${typeLabel(column.type)})`)
      .join(", ") || "none";
  return (
    `  ${table}: scanned ${scanned.length} text column(s) for "${CAMPAIGN_MARKER}" ` +
    `[${scannedText}]; not scannable, ilike has no operator for their type: ` +
    `[${skippedText}]`
  );
}

/**
 * How many rows of `table.column` carry the marker. Never a guess.
 *
 * A GET-shaped count (`exactCount`), because a HEAD response carries no body
 * for supabase-js to parse an error out of — so a refused scan came back as a
 * blank rather than as a code, and a scan that cannot say why it failed is not
 * a clean result (admin-window/TASK-0032).
 *
 * An error is ALWAYS a failure and never a zero, whatever the type sniffing
 * decided: the column and the database's own code go into the message, so a
 * column this sweep graded wrongly is diagnosable from the failure alone
 * (admin-window/BUG-0058).
 */
async function countMarked(table: string, column: string): Promise<number> {
  const { count, error } = await exactCount(table).ilike(
    column,
    `%${CAMPAIGN_MARKER}%`,
  );
  if (error) {
    const code = codeOf(error);
    throw new Error(
      `the residue sweep's count of ${table}.${column} failed ` +
        `(${code === "" ? "the database returned no code" : `code ${code}`}): ` +
        `${error.message}. A scan that refused is a failure, never a zero.`,
    );
  }
  if (typeof count !== "number") {
    throw new Error(
      `the residue sweep's count of ${table}.${column} came back without a ` +
        `count; a scan that cannot count is not a clean result.`,
    );
  }
  return count;
}

/**
 * The marked rows of one column, after the re-checks.
 *
 * Zero on the first look is the normal path and returns immediately — the
 * re-checks only cost time when something was found, which is exactly when
 * spending it is worth it.
 */
async function residueIn(table: string, column: string): Promise<number> {
  let marked = await countMarked(table, column);
  for (let attempt = 0; marked > 0 && attempt < RECHECKS; attempt += 1) {
    await sleep(RECHECK_PAUSE_MS);
    marked = await countMarked(table, column);
  }
  return marked;
}

/**
 * How many rows the table holds at all.
 *
 * The claim this file has always made about an empty table is unchanged: a
 * catalog table with no row is a STAGING problem, not a clean result — a sweep
 * over zero rows finds zero of everything. It is asserted only for the tables
 * this campaign can actually write (`pre_cutover`); a resolver-owned table
 * being empty says nothing about Admin's leftovers.
 */
async function rowCount(table: string): Promise<number> {
  const { count, error } = await exactCount(table);
  if (error) {
    const code = codeOf(error);
    throw new Error(
      `the residue sweep could not count the rows of ${table} on ` +
        `${stagingHost} (${code === "" ? "no code" : `code ${code}`}): ` +
        `${error.message}`,
    );
  }
  if (typeof count !== "number") {
    throw new Error(
      `the residue sweep's row count of ${table} came back without a count.`,
    );
  }
  return count;
}

describe("staging, after the campaign", () => {
  it("carries no value this campaign wrote, in any column it could write", async () => {
    // Derived from the one map, so a table added to the edit surface is swept
    // without anyone remembering to add it here.
    expect(EDITABLE_TABLES.length).toBeGreaterThan(0);

    const described = await describeStaging();
    const found: string[] = [];
    const report: string[] = [];
    let scanned = 0;

    for (const table of EDITABLE_TABLES) {
      const config = EDIT_CONFIG[table];
      const columns = columnsOf(described, config);
      const sweepable = columns.filter((column) => column.sweepable);
      const names = new Set(columns.map((column) => column.column));

      // A column the map names but staging does not describe would be swept by
      // nobody: the map and the database disagree, and the sweep says so
      // rather than reporting clean on a column it never saw.
      const undescribed = mappedColumns(config).filter((column) => !names.has(column));
      expect(
        undescribed,
        `the edit map names column(s) of ${config.table} that ${stagingHost}'s ` +
          `schema description does not carry, so the sweep cannot know their ` +
          `type or scan them`,
      ).toEqual([]);

      // Every column the map lets Admin edit that HOLDS TEXT must be among the
      // scanned ones, or the sweep is looking away from the place residue
      // would be. (An editable column of another type — `member_count`,
      // `debut_date` — cannot carry the marker at all, and is listed in the
      // report as unscannable rather than dropped.)
      const editableText = config.editable.filter((column) =>
        sweepable.some((described) => described.column === column),
      );
      const editableNotSwept = config.editable.filter(
        (column) => !editableText.includes(column),
      );
      expect(
        editableNotSwept.filter((column) =>
          columns.some(
            (described) => described.column === column && described.type === "text",
          ),
        ),
        `these editable column(s) of ${config.table} are declared text by ` +
          `${stagingHost} and were still not scanned — the sweep narrowed ` +
          `itself away from a place residue can be`,
      ).toEqual([]);
      if (config.regime === "pre_cutover") {
        expect(
          editableText.length,
          `no editable text column of ${config.table} was scanned, so this ` +
            `sweep would not see a leftover in one`,
        ).toBeGreaterThan(0);
        expect(
          await rowCount(config.table),
          `staging's ${config.table} holds no row at all, so a clean sweep of ` +
            `it says nothing: this campaign writes that table. An empty ` +
            `catalog table is a staging problem, not a clean result.`,
        ).toBeGreaterThan(0);
      }

      // No table is reported clean on the strength of zero scans.
      assertSomethingToSweep(config.table, columns);

      const marked = new Map<string, number>();
      for (const column of sweepable) {
        scanned += 1;
        const hits = await residueIn(config.table, column.column);
        marked.set(column.column, hits);
        if (hits > 0) found.push(`${config.table}.${column.column}: ${hits} row(s)`);
      }
      report.push(reportLine(config.table, columns, marked));
    }

    // The per-column result, so a pass says what it looked at and what it
    // could not look at — an exclusion nobody can see is a silent skip.
    console.log(
      `residue sweep of ${stagingHost}: ${scanned} column(s) scanned across ` +
        `${EDITABLE_TABLES.length} table(s)\n${report.join("\n")}`,
    );

    // A scan that found nothing because it looked at nothing is not a pass.
    expect(scanned, "the residue sweep examined no column").toBeGreaterThan(
      EDITABLE_TABLES.length,
    );

    expect(
      found,
      found.length === 0
        ? ""
        : `staging (${stagingHost}) still carries values stamped ` +
          `"${CAMPAIGN_MARKER}" after ${RECHECKS} re-checks ${RECHECK_PAUSE_MS}ms ` +
          `apart, so these are leftovers rather than a write in flight: ` +
          `${found.join("; ")}. Each one is a live test whose sweep did not ` +
          `run or did not restore.`,
    ).toEqual([]);
  });

  it("refuses to report a table clean when it could scan none of its columns", () => {
    // The vacuity guard itself, exercised without a database: this is the
    // shape admin-window/BUG-0058 left behind — nothing scanned, read as
    // clean. It must be a loud failure naming the columns and their types.
    const nothingScannable: DescribedColumn[] = [
      { column: "id", type: "uuid", sweepable: false },
      { column: "created_at", type: "timestamp with time zone", sweepable: false },
    ];
    expect(() => assertSomethingToSweep("groups", nothingScannable)).toThrow(
      /found no scannable column on groups/,
    );
    expect(() => assertSomethingToSweep("groups", nothingScannable)).toThrow(
      /created_at \(timestamp with time zone\)/,
    );
    // And the guard passes exactly when there IS something to scan.
    expect(() =>
      assertSomethingToSweep("groups", [
        ...nothingScannable,
        { column: "name", type: "text", sweepable: true },
      ]),
    ).not.toThrow();
  });

  it("treats a refused scan as a failure naming the column and the code", async () => {
    // Against the real database, on the very column that made the sweep throw
    // before it graded anything (admin-window/BUG-0058): scanning it is still
    // an ERROR — the fix is that the sweep no longer CHOOSES it, not that the
    // refusal became a zero. This is the guarantee that a column the sweep
    // grades wrongly in future can never come back as a quiet clean result.
    const refusal = await countMarked("groups", "created_at").then(
      (count) => new Error(`the scan resolved to ${count} instead of refusing`),
      (thrown: unknown) => thrown as Error,
    );
    expect(refusal.message).toContain("groups.created_at");
    expect(refusal.message).toContain("42883");
    expect(refusal.message).toMatch(/never a zero/);
  });

  it("names a target the sweep could actually have written to", () => {
    // The guard in `tests/live/setup.ts` has already refused anything that is
    // not the declared staging project; this states which one was swept, so
    // the evidence names its subject. A host, never a credential.
    expect(stagingHost.length).toBeGreaterThan(0);
  });
});
