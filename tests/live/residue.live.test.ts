import { describe, expect, it } from "vitest";
import { EDITABLE_TABLES, EDIT_CONFIG, type TableEditConfig } from "@/lib/edit/config";
import { independentClient } from "./parity";
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
 * text columns those tables actually carry, sampled from staging itself. There
 * is no second write surface in this repo, so there is no second place to
 * look.
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

/** How many rows are sampled per table to learn which columns hold text. */
const SAMPLE_ROWS = 5;

/** A hit is re-checked this many times before it is called residue. */
const RECHECKS = 3;
const RECHECK_PAUSE_MS = 2000;

type Row = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The text columns of `table`, learned from staging's own rows.
 *
 * Sampled rather than listed: this file must not carry a second copy of the
 * schema, and `ilike` against a non-text column is an error rather than an
 * answer. Several rows, because one row's nulls would hide a column that does
 * hold text.
 */
async function textColumns(config: TableEditConfig): Promise<string[]> {
  const { data, error } = await independentClient()
    .from(config.table)
    .select("*")
    .order(config.pk, { ascending: true })
    .limit(SAMPLE_ROWS);
  if (error) {
    throw new Error(
      `the residue sweep could not read ${config.table} on ${stagingHost}: ` +
        `${error.message}`,
    );
  }
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    throw new Error(
      `staging's ${config.table} holds no row, so the residue sweep cannot ` +
        `tell which of its columns hold text. An empty catalog table is a ` +
        `staging problem, not a clean result.`,
    );
  }
  const columns = new Set<string>();
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (typeof value === "string") columns.add(column);
    }
  }
  return [...columns].sort();
}

/** How many rows of `table.column` carry the marker. Never a guess. */
async function countMarked(table: string, column: string): Promise<number> {
  const { count, error } = await independentClient()
    .from(table)
    .select("*", { head: true, count: "exact" })
    .ilike(column, `%${CAMPAIGN_MARKER}%`);
  if (error) {
    throw new Error(
      `the residue sweep's count of ${table}.${column} failed: ${error.message}`,
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

describe("staging, after the campaign", () => {
  it("carries no value this campaign wrote, in any column it could write", async () => {
    // Derived from the one map, so a table added to the edit surface is swept
    // without anyone remembering to add it here.
    expect(EDITABLE_TABLES.length).toBeGreaterThan(0);

    const found: string[] = [];
    let scanned = 0;

    for (const table of EDITABLE_TABLES) {
      const config = EDIT_CONFIG[table];
      const columns = await textColumns(config);

      // Every column the map lets Admin edit must be among the scanned ones,
      // or the sweep is looking away from the place residue would be.
      const editableText = config.editable.filter((column) => columns.includes(column));
      if (config.regime === "pre_cutover") {
        expect(
          editableText.length,
          `no editable text column of ${config.table} was sampled, so this ` +
            `sweep would not see a leftover in one`,
        ).toBeGreaterThan(0);
      }

      for (const column of columns) {
        scanned += 1;
        const marked = await residueIn(config.table, column);
        if (marked > 0) found.push(`${config.table}.${column}: ${marked} row(s)`);
      }
    }

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

  it("names a target the sweep could actually have written to", () => {
    // The guard in `tests/live/setup.ts` has already refused anything that is
    // not the declared staging project; this states which one was swept, so
    // the evidence names its subject. A host, never a credential.
    expect(stagingHost.length).toBeGreaterThan(0);
  });
});
