import type { SupabaseClient } from "@supabase/supabase-js";
import { instantOf } from "../cycles/state";
import { type ResolutionRunRow } from "./gauges";
import { ROW_CAP, readRows, type DbResponse, type DbResult } from "./result";
import { objectKindOf, T, type ObjectKind } from "./tables";

/**
 * What this module's window read runs OVER — the word its window line ends
 * its bound clause on.
 *
 * Derived from the same `T.*` constant the query passes to `.from()`, in the
 * module that issues the query, so no page and no component gets a say: the
 * object a window was read over is a fact of the READ (admin-window/BUG-0077,
 * admin-window/DEBT-0006).
 */
export const CYCLES_OBJECT: ObjectKind = objectKindOf(T.resolutionRuns);

/**
 * The Cycles & runs page's reads — campaign admin-window/TASK-0014, the
 * `resolution_runs` half.
 *
 * Authority: admin-observability.md §4 ("`resolution_runs` and the adapter
 * framework's `runs`, newest first, with the counts as columns and
 * `error_summary` inline"), `contracts/resolver.md` §6 (the row and every
 * column's meaning), scraper migration `20260901000001` (the table itself, and
 * the three states its own comments say a reader must tell apart),
 * ARCHITECTURE.md §4.1 (every export returns a `DbResult` and never throws),
 * §4 rule 4 (only `tables.ts` spells a table name) and §4.3 (read kinds).
 *
 * **The adapter framework's `runs` are NOT read here.** They are the page's
 * other half and they have their own module, `src/lib/db/runs.ts`
 * (admin-window/TASK-0016, on Ben's ruling of 2026-09-02): one module per
 * table, so an absent `runs` never takes the cycles half down with it.
 *
 * **Which read kind, and why** (ARCHITECTURE.md §4.3). This is a **window**
 * read, kind 2: the resolver files a row every fifteen minutes forever, so
 * "every cycle there has ever been" is not a set a page can hold or a reader
 * can want. The window is stated in the query — a total `.order()` newest
 * first, then an explicit `.limit()` — and the page says which window it is
 * showing, in words, beside the table. That is legitimate for exactly one
 * reason, the same one `lib/db/dashboard.ts` gives: **no figure on that table
 * is computed from these rows.** Every number in it is a column of the row it
 * sits in. The two counts the page does present as figures come from the
 * cycle-health gauge, which carries its own `WindowInfo` and labels a
 * truncated count as a floor.
 *
 * **What a row IS is not decided here.** `cycleState`, the `CycleState` union
 * and the one word each state is called by live in the pure leaf
 * `src/lib/cycles/state.ts`, which this module and every surface that renders
 * a cycle read (admin-window/BUG-0074). This file reads the rows; the leaf
 * says what they are.
 */

export type { ResolutionRunRow };

/**
 * The eight counters, in `contracts/resolver.md` §6's own column order.
 *
 * Named once, here, because both the page's column set and the tests that
 * assert "all eight render" iterate this list — two hand-written lists of the
 * same eight names would drift, and the one that drifts silently is the test.
 * `satisfies` is what makes the list a claim about the ROW rather than eight
 * strings: a counter renamed in the scraper's migration stops compiling here
 * instead of rendering an empty column.
 *
 * `held` is in the list and is not a write (migration `20260901000004`: "the
 * cycle writes nothing for a fact that stays held"); the cycle-health gauge is
 * where that distinction is drawn, not here — this list is the row's counters,
 * in the contract's order.
 */
export const CYCLE_COUNTERS = [
  "facts_examined",
  "applied",
  "held",
  "escalated",
  "entities_created",
  "claims_linked",
  "claims_rerejected",
  "errors",
] as const satisfies readonly (keyof ResolutionRunRow)[];

/** One of the eight counter columns — e.g. `"claims_rerejected"`. */
export type CycleCounter = (typeof CYCLE_COUNTERS)[number];

/**
 * The columns this read asks for: identity, when it ran, how it ended, the
 * eight counters, then the one line of failure text — the row as §6 orders it.
 *
 * The counters are spread from `CYCLE_COUNTERS` rather than retyped, so the
 * select list and the rendered column set cannot disagree about which eight
 * numbers a cycle has.
 */
const CYCLE_COLUMNS = [
  "run_id",
  "started_at",
  "ended_at",
  "outcome",
  ...CYCLE_COUNTERS,
  "error_summary",
].join(", ");

/**
 * How many cycles the page's table shows.
 *
 * At the resolver's 15-minute cadence 200 cycles is a bit over two days —
 * enough to answer "what has the resolver been doing" by scrolling, without
 * building a table of the platform's whole 1,000-row ceiling. The page states
 * the window in words beside the table, so the number is never mistaken for a
 * count of cycles that exist.
 */
export const CYCLE_WINDOW = 200;

/** The window of cycles a read returned, and whether it filled its cap. */
export interface CycleWindow {
  /** The cycles, newest first. */
  rows: ResolutionRunRow[];
  /** The cap the query carried. */
  limit: number;
  /**
   * The read came back with exactly its cap, so older cycles inside the
   * window exist and were not returned. The page says so rather than letting
   * the last row read as the oldest cycle there is.
   */
  truncated: boolean;
}

/**
 * A sane row count: at least one row, never more than the platform will
 * return. `limit(0)` and `limit(NaN)` are the defects a bound exists to
 * prevent, and asking for more rows than PostgREST hands back makes the server
 * truncate silently (ARCHITECTURE.md §4.3, admin-window/BUG-0009).
 */
function windowSize(limit: number): number {
  if (!Number.isFinite(limit)) return CYCLE_WINDOW;
  return Math.max(1, Math.min(Math.floor(limit), ROW_CAP));
}

/**
 * The display order: **newest first by `started_at`**, `run_id` descending
 * where two cycles share an instant.
 *
 * The query already asks for exactly this order, so this sort normally changes
 * nothing — it is here because the page's order is a stated property of the
 * page (spec §4) and must not depend on a transport keeping its promise. A
 * timestamp that will not parse sorts last rather than poisoning the
 * comparison: the row still renders, at the end, where an unreadable
 * `started_at` is visible instead of silently reordering the cycles above it.
 *
 * The input is not mutated.
 *
 * Generic over the row because BOTH halves of the Cycles & runs page order
 * their table this way, off the same two columns: `resolution_runs` here and
 * the adapter framework's `runs` in `src/lib/db/runs.ts`
 * (admin-window/TASK-0016). One comparator, so the two tables cannot come to
 * disagree about what "newest first" means; the constraint is the two columns
 * it reads, not which table they came from.
 */
export function newestFirst<Row extends Pick<ResolutionRunRow, "run_id" | "started_at">>(
  rows: readonly Row[],
): Row[] {
  return [...rows].sort((a, b) => {
    const left = instantOf(a.started_at);
    const right = instantOf(b.started_at);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left;
    }
    return a.run_id < b.run_id ? 1 : a.run_id > b.run_id ? -1 : 0;
  });
}

/**
 * The newest cycles, newest first.
 *
 * The order is total — `started_at` descending then the primary key — so two
 * cycles that started on the same instant cannot swap places between reloads
 * and the window is the same window twice running.
 */
export async function readCycles(
  limit: number = CYCLE_WINDOW,
  db?: SupabaseClient,
): Promise<DbResult<CycleWindow>> {
  const size = windowSize(limit);
  const result = await readRows<ResolutionRunRow>(
    T.resolutionRuns,
    (client) =>
      client
        .from(T.resolutionRuns)
        .select(CYCLE_COLUMNS)
        .order("started_at", { ascending: false })
        .order("run_id", { ascending: false })
        .limit(size) as unknown as PromiseLike<DbResponse<ResolutionRunRow[]>>,
    db,
  );
  if (result.kind !== "ok") return result;
  return {
    kind: "ok",
    data: {
      rows: newestFirst(result.data),
      limit: size,
      truncated: result.data.length >= size,
    },
  };
}
