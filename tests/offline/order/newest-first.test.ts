import { describe, expect, it } from "vitest";
import { NEWEST_RUN_FIRST } from "@/lib/db/cycles";
import { newestFirst } from "@/lib/order/newest-first";

/**
 * **The app's ONE "newest first" ordering** — campaign admin-window/DEBT-0016.
 *
 * The rule was declared twice under one name, over two column pairs:
 * `created_at`/`verdict_id` in `src/lib/db/verdict.ts` and
 * `started_at`/`run_id` in `src/lib/db/cycles.ts`. It was never two rules —
 * only the two column names differed — so it is one exported thing with the
 * columns handed in, and this file is where the rule itself is graded.
 *
 * Every case below is asserted over BOTH column pairs from one table of
 * inputs, because "the two windows order identically" is the property the
 * de-duplication has to keep true: a change that reordered one pair and not
 * the other would put two surfaces back into disagreement about what "newest
 * first" means, which is what having one function is for.
 *
 * The pair each caller uses is graded beside that caller — the runs pair in
 * `tests/offline/cycles/read.test.ts`, the verdict log's whole rendered order
 * in `tests/offline/queues/verdict-log.test.ts`.
 */

/** The verdict log's column pair, as `src/lib/db/verdict.ts` names it. */
const NEWEST_VERDICT_FIRST = { instant: "created_at", key: "verdict_id" } as const;

/** One row, in whichever pair's spelling — built from an instant and a key. */
type RunShaped = { started_at: string | null; run_id: string; tag: string };
type VerdictShaped = { created_at: string | null; verdict_id: string; tag: string };

/**
 * A table of rows, given once, as both pairs spell it. `tag` is what the
 * assertions read back, so one expectation grades both spellings.
 */
function asRuns(rows: readonly (readonly [string | null, string])[]): RunShaped[] {
  return rows.map(([instant, key]) => ({ started_at: instant, run_id: key, tag: key }));
}

function asVerdicts(rows: readonly (readonly [string | null, string])[]): VerdictShaped[] {
  return rows.map(([instant, key]) => ({ created_at: instant, verdict_id: key, tag: key }));
}

/** The order both pairs produced, as tags — the same list, or the test fails. */
function orderedTags(rows: readonly (readonly [string | null, string])[]): string[] {
  const byRun = newestFirst(asRuns(rows), NEWEST_RUN_FIRST).map((row) => row.tag);
  const byVerdict = newestFirst(asVerdicts(rows), NEWEST_VERDICT_FIRST).map((row) => row.tag);
  expect(byVerdict, "the two column pairs disagreed about newest first").toEqual(byRun);
  return byRun;
}

const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-02T10:00:00.000Z";
const T3 = "2026-09-03T10:00:00.000Z";

describe("the newest-first ordering, over either column pair", () => {
  it("puts the latest instant first, whatever order the rows arrived in", () => {
    expect(
      orderedTags([
        [T1, "oldest"],
        [T3, "newest"],
        [T2, "middle"],
      ]),
    ).toEqual(["newest", "middle", "oldest"]);
  });

  it("breaks a tie on the key column, descending", () => {
    expect(
      orderedTags([
        [T2, "aaa"],
        [T2, "ccc"],
        [T2, "bbb"],
      ]),
    ).toEqual(["ccc", "bbb", "aaa"]);
  });

  it("ranks the instant ahead of the key, so the key never outvotes the clock", () => {
    expect(
      orderedTags([
        [T1, "zzz"],
        [T3, "aaa"],
      ]),
    ).toEqual(["aaa", "zzz"]);
  });

  it("sorts an unreadable instant last, in each of its spellings, and keeps the row", () => {
    // Three ways a stamp fails to be an instant — absent, empty and unparseable
    // — and none of them may poison the comparison for the rows that ARE
    // readable, or a filled window silently reorders around one bad row.
    for (const unreadable of [null, "", "not a timestamp"]) {
      expect(
        orderedTags([
          [unreadable, "junk"],
          [T1, "older"],
          [T3, "newer"],
        ]),
        String(unreadable),
      ).toEqual(["newer", "older", "junk"]);
    }
  });

  it("orders two unreadable instants against each other by key, descending", () => {
    expect(
      orderedTags([
        [null, "aaa"],
        ["", "ccc"],
        ["not a timestamp", "bbb"],
      ]),
    ).toEqual(["ccc", "bbb", "aaa"]);
  });

  it("is a TOTAL order: the same rows shuffled come back in the same sequence", () => {
    const rows = [
      [T2, "bbb"],
      [T2, "aaa"],
      [T3, "ccc"],
      [null, "ddd"],
      [T1, "eee"],
    ] as const;
    const expected = orderedTags(rows);
    expect(orderedTags([...rows].reverse())).toEqual(expected);
    expect(orderedTags([rows[3], rows[0], rows[4], rows[2], rows[1]])).toEqual(expected);
  });

  it("does not mutate what it was given", () => {
    const given = asRuns([
      [T1, "aaa"],
      [T3, "bbb"],
    ]);
    const before = given.map((row) => row.run_id);
    newestFirst(given, NEWEST_RUN_FIRST);
    expect(given.map((row) => row.run_id)).toEqual(before);
  });

  it("answers an empty set with an empty set, and never a row of its own", () => {
    expect(orderedTags([])).toEqual([]);
  });

  it("reads the two columns it was handed and no others", () => {
    // The rule is generic in the ROW: the constraint is the two columns, not
    // which table they came from. A row carrying an EARLIER instant under the
    // other pair's column name must not steal the order.
    const rows = [
      { started_at: T1, run_id: "aaa", created_at: T3, verdict_id: "zzz" },
      { started_at: T3, run_id: "bbb", created_at: T1, verdict_id: "aaa" },
    ];
    expect(newestFirst(rows, NEWEST_RUN_FIRST).map((row) => row.run_id)).toEqual(["bbb", "aaa"]);
    expect(newestFirst(rows, NEWEST_VERDICT_FIRST).map((row) => row.verdict_id)).toEqual([
      "zzz",
      "aaa",
    ]);
  });
});
