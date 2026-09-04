import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EDIT_CONFIG, mappedColumns } from "@/lib/edit/config";
import { T } from "@/lib/db/tables";
import {
  SANDBOX_COLUMNS,
  SANDBOX_FIXTURE,
  SANDBOX_PK,
  SANDBOX_TABLE,
  SANDBOX_WALK_KEY,
} from "../../walk/sandbox-fixture";
import { repoRoot } from "../source-tree";

/**
 * The walk sandbox's seed rows, pinned OFFLINE (campaign
 * admin-window/TASK-0036).
 *
 * The fixture is the one part of the sandbox chain that can be graded without
 * a staging project, and it is the part that goes wrong quietly. Three things
 * it must be, none of which the reset tool itself can check:
 *
 *  1. **Free of the campaign marker.** `tests/live/residue.live.test.ts`
 *     derives every mapped table into its search space and reads a hit as
 *     campaign leftovers. A fixture value carrying that string would fail that
 *     sweep on every run, for rows that are supposed to be there
 *     (`ARCHITECTURE.md` §9.1 item 6).
 *  2. **Made of columns the map actually carries.** The fixture cannot import
 *     `EDIT_CONFIG` — it is imported by a bare-`node` program — so its column
 *     list is a copy, and this file is what stops the copy drifting.
 *  3. **Keyed by the three ruled uuids.** `isRecordId`
 *     (`src/lib/db/records.ts`) refuses a record-page segment that is not a
 *     uuid BEFORE any read, so a text key put both of the sandbox's states out
 *     of reach at its own address (§9.1 item 9).
 */

const ENTRY = EDIT_CONFIG[SANDBOX_TABLE];

/** The three keys ARCHITECTURE §9.1 item 9 rules, spelled out. */
const RULED_KEYS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

/** The stamp the live residue sweep hunts for. */
const CAMPAIGN_MARKER = "admin-window";

describe("the sandbox fixture", () => {
  it("names the table the map and the app name", () => {
    // The copy, checked: the fixture spells the table itself because it may
    // not import from `src/`.
    expect(SANDBOX_TABLE).toBe(T.walkSandbox);
    expect(ENTRY).toBeDefined();
    expect(SANDBOX_PK).toBe(ENTRY.pk);
  });

  it("carries no campaign marker in any value", () => {
    // Values first — those are what the sweep reads.
    for (const row of SANDBOX_FIXTURE) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== "string") continue;
        expect(value, `${row.sandbox_id}.${column}`).not.toContain(
          CAMPAIGN_MARKER,
        );
      }
    }
    // And the file, comments included: the check in this ticket greps the
    // whole source, because a marker in a docstring is just as findable by a
    // human hunting residue as one in a value.
    const source = fs.readFileSync(
      path.join(repoRoot, "tests", "walk", "sandbox-fixture.ts"),
      "utf8",
    );
    expect(source).not.toContain(CAMPAIGN_MARKER);
  });

  it("would catch a marker if one were there", () => {
    // The other fixture (LESSONS 3): the check above passes vacuously unless
    // the same predicate rejects something. A row shaped exactly like a
    // fixture row, carrying the marker, must fail it.
    const planted = { ...SANDBOX_FIXTURE[0], note: `${CAMPAIGN_MARKER} probe` };
    const values = Object.values(planted).filter(
      (value): value is string => typeof value === "string",
    );
    expect(values.some((value) => value.includes(CAMPAIGN_MARKER))).toBe(true);
  });

  it("uses only columns the edit map declares for this table", () => {
    const mapped = mappedColumns(ENTRY);
    for (const row of SANDBOX_FIXTURE) {
      for (const column of Object.keys(row)) {
        expect(mapped, `column ${column}`).toContain(column);
      }
    }
    // And the fixture's own column list is that same set, in that same order —
    // it is what the reset tool selects with, so a drift would silently
    // compare a narrower set than the surface reads.
    expect([...SANDBOX_COLUMNS]).toEqual([...mapped]);
  });

  it("declares every editable column, so a walk can edit them all", () => {
    // The sandbox exists so a walk can exercise one column per coercion. A
    // fixture missing one leaves that coercion unwalkable.
    for (const column of ENTRY.editable) {
      for (const row of SANDBOX_FIXTURE) {
        expect(Object.keys(row), `row ${row.sandbox_id}`).toContain(column);
      }
    }
  });

  it("is keyed by the three ruled uuids, in order", () => {
    expect(SANDBOX_FIXTURE.map((row) => row.sandbox_id)).toEqual(RULED_KEYS);
    expect(SANDBOX_WALK_KEY).toBe(RULED_KEYS[0]);
  });

  it("offers a null note and a null observed_on to walk the absence path", () => {
    expect(SANDBOX_FIXTURE.some((row) => row.note === null)).toBe(true);
    expect(SANDBOX_FIXTURE.some((row) => row.observed_on === null)).toBe(true);
    // And a filled one of each, so the em-dash is a state the walk can leave
    // as well as arrive at.
    expect(SANDBOX_FIXTURE.some((row) => row.note !== null)).toBe(true);
    expect(SANDBOX_FIXTURE.some((row) => row.observed_on !== null)).toBe(true);
  });

  it("never leaves a not-null column null", () => {
    // `label`, `tally` and `is_flagged` are `not null` in the DDL, on purpose:
    // clearing one is a database refusal a walk is meant to see. A fixture row
    // that seeded null there would fail the insert instead.
    for (const row of SANDBOX_FIXTURE) {
      expect(row.label, row.sandbox_id).not.toBeNull();
      expect(typeof row.tally, row.sandbox_id).toBe("number");
      expect(typeof row.is_flagged, row.sandbox_id).toBe("boolean");
    }
  });

  it("spells its dates as real calendar days", () => {
    // 2026 is not a leap year; an earlier draft of the paste seeded 02-29 and
    // would have errored on insert.
    for (const row of SANDBOX_FIXTURE) {
      if (row.observed_on === null) continue;
      expect(row.observed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = new Date(`${row.observed_on}T00:00:00Z`);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString().slice(0, 10)).toBe(row.observed_on);
    }
  });

  it("keeps the sandbox out of every surface an operator can reach", () => {
    // §9.1: the entry is in NOTHING else — no nav entry, no Browse row, no
    // link. Reachable only by an agent typing a URL it already knows.
    expect(ENTRY.display).toEqual([]);
    expect(ENTRY.reference).toBeNull();
  });
});
