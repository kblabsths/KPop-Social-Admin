import type { SupabaseClient } from "@supabase/supabase-js";
import { ROW_CAP, readOne, readRows, type DbResponse, type DbResult } from "./result";
import { readReviewAttention } from "./review-items";
import { T } from "./tables";
import type { ReviewAttention } from "../review/shapes";

/**
 * The Dashboard's reads — campaign admin-window/TASK-0009.
 *
 * Authority: admin-observability.md §4 (the Dashboard is "the breakfast view:
 * attention summary with decision and signal counts separate … last night's
 * cycles and runs, error lines"), ARCHITECTURE.md §3 (this file is "the
 * Dashboard's reads"), §4.1 (every export returns a `DbResult` and never
 * throws) and §4 rule 4 (only `tables.ts` spells a table name).
 *
 * Four reads, reported separately, because the Dashboard's surfaces fail
 * independently: with `resolution_runs` absent the attention summary must
 * still render its counts, and each surface must name the object IT could not
 * read (admin-window/BUG-0016). The fourth is the last-applied row
 * (admin-window/TASK-0039), which the cycles surface states as a line and
 * drops whole when its own read did not return — the table's absence is
 * already named once by the list beside it, and naming it twice on one card
 * tells an operator nothing new.
 *
 * **Which read kind, and why** (ARCHITECTURE.md §4.3, and the architect's
 * ruling on this ticket 2026-09-02):
 *
 *  - the attention summary is a **complete** read — it is `readReviewAttention`
 *    in `review-items.ts`, which reads through `readComplete`, so its open
 *    count, max severity and oldest age are over the whole open set or the read
 *    refuses and no number renders. It is reused, never re-derived: the kind
 *    is derived in exactly one module (spec §6).
 *  - the cycles and runs lists are **window** reads — "last night's cycles and
 *    runs" is a window by nature, so each is ordered newest-first and limited,
 *    and the page states the window it is showing. That is legitimate for
 *    exactly one reason: **no figure on this page is computed from these rows.**
 *    Every number the two tables render is a column of the row it sits in, not
 *    a count over the set, so there is nothing here that a partial set could
 *    make wrong. A later surface that wants "how many cycles ran last night"
 *    needs a complete read, not `rows.length` of this one.
 *  - the last-applied row is **neither**: it is one row addressed by an order
 *    (`readOne`), and the database's own `where … order … limit 1` makes it
 *    the maximum over every row the table holds. Nothing about it is partial,
 *    so there is no cap to state and no window to name beyond "every cycle on
 *    record" — see `readLastApplied` below.
 *
 * The cycle and run row shapes here are the DASHBOARD's, deliberately narrow:
 * the Dashboard shows what answers "did anything happen last night" and links
 * into `/cycles` for the rest. Which columns the **Cycles & runs page** shows
 * for adapter `runs` is a separate, blocked question (ARCHITECTURE.md §12
 * `OPEN-RUNS`) owned by `src/lib/db/runs.ts`; nothing here answers it.
 */

/**
 * How many cycles and how many runs the Dashboard shows.
 *
 * Six of each keeps the whole view above the fold at 1440×900 without
 * scrolling (LOOK_AND_FEEL quality bar 1) while still showing a night's worth
 * of the 15-minute cadence's most recent cycles. The page states the window in
 * words beside each table, so the number is never mistaken for a total.
 */
export const DASHBOARD_WINDOW = 6;

/**
 * One `resolution_runs` row, narrowed to the Dashboard's question — migration
 * `20260901000001`, columns as `contracts/resolver.md` §6 names them.
 *
 * `outcome` is `string | null` rather than the check constraint's three
 * values: it renders verbatim, so an outcome the constraint gains later
 * appears under its own name instead of being dropped or coerced. A row with
 * no `ended_at` is a cycle still running and reads as such.
 */
export interface DashboardCycleRow {
  run_id: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  applied: number;
  escalated: number;
  errors: number;
  error_summary: string | null;
}

/**
 * One adapter `runs` row, narrowed to **exactly** what the Dashboard needs:
 * source, when, outcome, error line (this ticket's description). The other 17
 * columns belong to the Cycles & runs page, whose column set is the blocked
 * `OPEN-RUNS` question — reading them here would answer it by the back door.
 *
 * `source` is TEXT with no foreign key (migration `20260829000001`): a source
 * is matched by NAME, never by id (ARCHITECTURE.md §6 trap 6). The Dashboard
 * only renders it.
 */
export interface DashboardRunRow {
  run_id: string;
  source: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  error_summary: string | null;
}

/**
 * The newest `resolution_runs` row that APPLIED something — the row behind the
 * Dashboard's "when did the resolver last actually write" line
 * (campaign admin-window/TASK-0039).
 *
 * `applied` is selected as well as filtered on, so the row a surface makes the
 * claim about carries the fact the claim rests on; `started_at` is the instant
 * the line ages, and it is the same instant the cycles table ages its rows by,
 * so the two never disagree about one row.
 */
export interface LastAppliedCycle {
  run_id: string;
  started_at: string;
  applied: number;
}

/** The four reads the Dashboard makes, each reported on its own. */
export interface DashboardReads {
  /** Open counts, max severity and oldest age, per kind. A COMPLETE read. */
  attention: DbResult<ReviewAttention>;
  /** The newest resolver cycles. A WINDOW read; the page says which window. */
  cycles: DbResult<DashboardCycleRow[]>;
  /** The newest adapter runs. A WINDOW read; the page says which window. */
  runs: DbResult<DashboardRunRow[]>;
  /**
   * The newest cycle that applied something, over EVERY cycle the table holds
   * — `ok` carrying `null` when no cycle in it ever applied anything.
   */
  lastApplied: DbResult<LastAppliedCycle | null>;
}

const CYCLE_COLUMNS = [
  "run_id",
  "started_at",
  "ended_at",
  "outcome",
  "applied",
  "escalated",
  "errors",
  "error_summary",
].join(", ");

const RUN_COLUMNS = [
  "run_id",
  "source",
  "started_at",
  "ended_at",
  "outcome",
  "error_summary",
].join(", ");

/**
 * A sane row count for a window read: at least one row, never more than the
 * platform cap.
 *
 * `limit(0)` and `limit(NaN)` are the defects a bound exists to prevent
 * (`lib/gauges/gauge.ts` clamps for the same reason), and asking for more rows
 * than PostgREST will return makes the server truncate silently
 * (ARCHITECTURE.md §4.3).
 */
function windowSize(limit: number): number {
  if (!Number.isFinite(limit)) return DASHBOARD_WINDOW;
  return Math.max(1, Math.min(Math.floor(limit), ROW_CAP));
}

/**
 * The newest resolver cycles, newest first.
 *
 * The order is total — `started_at desc` then the primary key — so two cycles
 * that started on the same instant cannot swap places between reloads, and the
 * window is the same window twice running. It is also the DISPLAY order, which
 * is what §4 asks for ("newest first").
 */
export function readRecentCycles(
  limit: number = DASHBOARD_WINDOW,
  db?: SupabaseClient,
): Promise<DbResult<DashboardCycleRow[]>> {
  const size = windowSize(limit);
  return readRows<DashboardCycleRow>(
    T.resolutionRuns,
    (client) =>
      client
        .from(T.resolutionRuns)
        .select(CYCLE_COLUMNS)
        .order("started_at", { ascending: false })
        .order("run_id", { ascending: false })
        .limit(size) as unknown as PromiseLike<DbResponse<DashboardCycleRow[]>>,
    db,
  );
}

/** The newest adapter runs, newest first — same ordering rule as the cycles. */
export function readRecentRuns(
  limit: number = DASHBOARD_WINDOW,
  db?: SupabaseClient,
): Promise<DbResult<DashboardRunRow[]>> {
  const size = windowSize(limit);
  return readRows<DashboardRunRow>(
    T.runs,
    (client) =>
      client
        .from(T.runs)
        .select(RUN_COLUMNS)
        .order("started_at", { ascending: false })
        .order("run_id", { ascending: false })
        .limit(size) as unknown as PromiseLike<DbResponse<DashboardRunRow[]>>,
    db,
  );
}

/** The columns the last-applied read needs, and no others. */
const LAST_APPLIED_COLUMNS = ["run_id", "started_at", "applied"].join(", ");

/**
 * The newest cycle that APPLIED something — the read behind the Dashboard's
 * "did the resolver actually write anything" line (admin-window/TASK-0039).
 *
 * **Not a window over the newest few.** The database applies the filter, the
 * order and the limit together, so `where applied > 0 order by started_at
 * desc, run_id desc limit 1` IS the maximum over every row the table holds:
 * had any cycle applied something, this read would have returned it. That is
 * why an `ok` carrying `null` is the strong statement "no cycle on record has
 * applied anything" rather than "none among the six the page lists" — the
 * distinction the line exists to draw, since the page already shows the
 * newest cycles and 69 of them applying nothing is exactly the state that
 * reads calm.
 *
 * It is therefore neither read kind of §4.3 in the shape those helpers take:
 * there is no set here to be silently partial, and no cap to fill. It is
 * `readOne` — one row addressed by an order rather than by a key — for the
 * reason `readReviewItem` is: `.maybeSingle()` distinguishes "the table
 * answered and holds no such row" from "the table is not there", and only the
 * first of those is a statement about the resolver.
 *
 * **No lookback bound, deliberately.** A "has it applied anything in the last
 * N hours" read would put a dial-able value in a source file, which is the
 * one thing this line may not become (Ben's ruling, campaign
 * admin-window/TASK-0039: a timestamp, not a gauge; a dial belongs in a row).
 * The order is total — `started_at` then the primary key — so two cycles that
 * applied on the same instant cannot swap the answer between reloads.
 */
export function readLastApplied(
  db?: SupabaseClient,
): Promise<DbResult<LastAppliedCycle | null>> {
  return readOne<LastAppliedCycle>(
    T.resolutionRuns,
    (client) =>
      client
        .from(T.resolutionRuns)
        .select(LAST_APPLIED_COLUMNS)
        .gt("applied", 0)
        .order("started_at", { ascending: false })
        .order("run_id", { ascending: false })
        .limit(1)
        .maybeSingle() as unknown as PromiseLike<DbResponse<LastAppliedCycle>>,
    db,
  );
}

/**
 * Everything the Dashboard reads, in one call.
 *
 * The four run concurrently and are returned unmerged: one failing read never
 * takes the others down, and the page renders honest states rather than one
 * anonymous one. Nothing here throws — each read classifies its own failure
 * (§4.1).
 *
 * Two of them read `resolution_runs`: the cycles WINDOW the table renders, and
 * the last-applied row over every cycle on record. They are separate reads on
 * purpose — one is a list, the other is a maximum, and a maximum taken from
 * the list's six rows would answer a different question (admin-window/TASK-0039).
 */
export async function readDashboard(
  limit: number = DASHBOARD_WINDOW,
  db?: SupabaseClient,
): Promise<DashboardReads> {
  const [attention, cycles, runs, lastApplied] = await Promise.all([
    readReviewAttention(db),
    readRecentCycles(limit, db),
    readRecentRuns(limit, db),
    readLastApplied(db),
  ]);
  return { attention, cycles, runs, lastApplied };
}
