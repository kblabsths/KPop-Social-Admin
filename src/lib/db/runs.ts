import type { SupabaseClient } from "@supabase/supabase-js";
import { newestFirst } from "./cycles";
import type { DashboardRunRow } from "./dashboard";
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
export const RUNS_OBJECT: ObjectKind = objectKindOf(T.runs);

/**
 * The Cycles & runs page's `runs` read — the adapter framework's half
 * (campaign admin-window/TASK-0016).
 *
 * Authority: admin-observability.md §4 ("`resolution_runs` and the adapter
 * framework's `runs`, newest first, with the counts as columns and
 * `error_summary` inline"), scraper migration `20260829000001` (the table),
 * ARCHITECTURE.md §4.1 (every export returns a `DbResult` and never throws),
 * §4 rule 4 (only `tables.ts` spells a table name), §4.3 (read kinds) and §6
 * trap 6 (`runs.source` is TEXT with no foreign key) — and **Ben's ruling of
 * 2026-09-02**, a dated paragraph in `agenticflow/docs/DECISIONS.md`, which
 * settled the column set. That question is closed; `RUN_COLUMNS` below is the
 * answer, and adding a tenth column re-opens a decision rather than extending
 * a table.
 *
 * **Which read kind, and why** (ARCHITECTURE.md §4.3). A **window** read,
 * kind 2: an adapter files a row every time it wakes, forever, so "every run
 * there has ever been" is not a set a page can hold. The window is stated in
 * the query — a total `.order()` newest first, then an explicit `.limit()` —
 * and the page says which window it is showing, beside the table. That is
 * legitimate for exactly one reason: **no figure the page renders is computed
 * over these rows.** Every number in the table is a column of the row it sits
 * in. A later surface wanting "how many runs failed last night" needs a
 * complete read, not `rows.length` of this one — so `readComplete` is not used
 * here and no `?? 0` appears on this path: a null the database gave is not a
 * zero.
 *
 * **The row shape is the Dashboard's, widened.** `DashboardRunRow` in
 * `dashboard.ts` already carries the first five columns of the ruling and `/`
 * already renders them; this module extends that interface with the four the
 * ruling adds rather than declaring a second, drifting row type. `dashboard.ts`
 * itself is NOT widened — it is deliberately narrower, and it is another
 * ticket's landed surface.
 */

/**
 * The nine columns the Cycles & runs page renders, in the order Ben's ruling
 * of 2026-09-02 names them.
 *
 * Named once, here, because three things iterate this list — the select, the
 * page's column set, and the tests that assert "exactly these nine, no tenth"
 * — and three hand-written lists of the same nine names would drift. The
 * `satisfies` is what makes it a claim about the ROW rather than nine strings:
 * a column renamed in the scraper's migration stops compiling here instead of
 * rendering an empty column.
 *
 * `run_id` is NOT in it. It is the primary key — the row key and the order's
 * tiebreak — and the ruling does not display it, so it is selected below and
 * never rendered as a tenth column.
 *
 * The other thirteen columns of the 22 (`checkpoint_before/after`,
 * `payloads_fetched`, `payloads_archived`, `records_rejected`,
 * `claims_dropped_empty`, `claims_collapsed`, `claims_ai`, `records_linked`,
 * `records_escalated`, `batches_written`, `observations_returned`) are out of
 * M1 scope by that same ruling.
 */
export const RUN_COLUMNS = [
  "source",
  "started_at",
  "ended_at",
  "outcome",
  "error_summary",
  "records_parsed",
  "claims_emitted",
  "records_unlinked",
  "failure_class",
] as const satisfies readonly (keyof RunRow)[];

/** One of the nine displayed columns — e.g. `"records_unlinked"`. */
export type RunColumn = (typeof RUN_COLUMNS)[number];

/**
 * The three counts of the ruling, which render as right-aligned figures.
 *
 * Derived from `RUN_COLUMNS` would be cute and wrong: which of the nine are
 * NUMBERS is a fact about the row, and the `satisfies` here is what keeps the
 * page from formatting a text column as a count.
 */
export const RUN_COUNTS = [
  "records_parsed",
  "claims_emitted",
  "records_unlinked",
] as const satisfies readonly RunColumn[];

/** One of the three count columns. */
export type RunCount = (typeof RUN_COUNTS)[number];

/**
 * One `runs` row, narrowed to the nine ruled columns plus its primary key —
 * migration `20260829000001`.
 *
 * It extends `DashboardRunRow` (`source`, `started_at`, `ended_at`, `outcome`,
 * `error_summary`, `run_id`) because the ruling's first five ARE the
 * Dashboard's shape; the four below are what this page adds.
 *
 *  - `source` is TEXT with no foreign key, deliberately (§6 trap 6), so a run
 *    against an unregistered source still writes its row — and is matched by
 *    NAME, never resolved to a `sources` row by key.
 *  - `ended_at` null is a run still in flight; nothing rewrites the row, and
 *    no completion is invented for it.
 *  - `outcome` and `failure_class` are typed `string | null` rather than the
 *    check constraints' words: a value the database holds and this app has
 *    never heard of must render verbatim rather than be narrowed away.
 *  - the three counts are NOT NULL in the migration, so they are `number`; a
 *    zero is a real count and never an absence.
 */
export interface RunRow extends DashboardRunRow {
  records_parsed: number;
  claims_emitted: number;
  records_unlinked: number;
  /** `transient | structural | config` today — carried verbatim, whatever it says. */
  failure_class: string | null;
}

/** What the query asks for: the key, then the nine the page renders. */
const SELECT = ["run_id", ...RUN_COLUMNS].join(", ");

/**
 * How many runs the page's table shows.
 *
 * The same 200 the cycles half uses: enough to answer "what have the adapters
 * been doing" by scrolling, without building a table of the platform's whole
 * 1,000-row ceiling. The page states the window in words beside the table, so
 * the number is never mistaken for a count of the runs that exist.
 */
export const RUN_WINDOW = 200;

/** The window of runs a read returned, and what narrowed it. */
export interface RunWindow {
  /** The runs, newest first. */
  rows: RunRow[];
  /** The cap the query carried. */
  limit: number;
  /**
   * The read came back with exactly its cap, so older runs inside the window
   * exist and were not returned. The page says so rather than letting the last
   * row read as the oldest run there is.
   */
  truncated: boolean;
  /**
   * The source NAME the query was narrowed to, or `null` when it was not —
   * the narrowing that actually reached the database, so the page states the
   * facet it got rather than the one it asked for.
   */
  source: string | null;
}

/** What a runs read may be narrowed by. */
export interface RunsFilter {
  /**
   * `?source=<name>` — the Sources page's seam. Matched against `runs.source`
   * BY NAME (§6 trap 6): there is no foreign key to resolve, and a name with
   * no `sources` row is still a run that renders. A name matching nothing is
   * an empty window, which is a real answer and not an error.
   */
  source?: string;
  /** The window size. Defaults to `RUN_WINDOW`, clamped to the platform cap. */
  limit?: number;
}

/**
 * A sane row count: at least one row, never more than the platform will
 * return. `limit(0)` and `limit(NaN)` are the defects a bound exists to
 * prevent, and asking for more rows than PostgREST hands back makes the server
 * truncate silently (ARCHITECTURE.md §4.3).
 */
function windowSize(limit: number): number {
  if (!Number.isFinite(limit)) return RUN_WINDOW;
  return Math.max(1, Math.min(Math.floor(limit), ROW_CAP));
}

/**
 * The facet as the query will use it, or `null` for no narrowing at all.
 *
 * A `?source=` carrying nothing is not a narrowing to the empty name — it is
 * an operator who typed half a URL — so it narrows nothing rather than
 * rendering every run as unmatched. A name that is present is used VERBATIM:
 * `runs.source` is a text identifier, and trimming it would match a row the
 * URL did not ask for.
 */
export function narrowedTo(source: string | undefined): string | null {
  if (source === undefined || source.trim() === "") return null;
  return source;
}

/**
 * The newest runs, newest first, optionally narrowed to one source name.
 *
 * The order is total — `started_at` descending then the primary key — so two
 * runs that started on the same instant cannot swap places between reloads and
 * the window is the same window twice running. It is re-applied to the rows in
 * TypeScript (`newestFirst`, shared with the cycles half) because the page's
 * order is a stated property of the page and must not depend on a transport
 * keeping its promise.
 */
export async function readRuns(
  filter: RunsFilter = {},
  db?: SupabaseClient,
): Promise<DbResult<RunWindow>> {
  const size = windowSize(filter.limit ?? RUN_WINDOW);
  const source = narrowedTo(filter.source);

  const result = await readRows<RunRow>(
    T.runs,
    (client) => {
      const selected = client.from(T.runs).select(SELECT);
      // By NAME. There is no key to match on and none is invented.
      const narrowed = source === null ? selected : selected.eq("source", source);
      return narrowed
        .order("started_at", { ascending: false })
        .order("run_id", { ascending: false })
        .limit(size) as unknown as PromiseLike<DbResponse<RunRow[]>>;
    },
    db,
  );
  if (result.kind !== "ok") return result;
  return {
    kind: "ok",
    data: {
      rows: newestFirst(result.data),
      limit: size,
      truncated: result.data.length >= size,
      source,
    },
  };
}
