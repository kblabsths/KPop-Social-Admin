import type { SupabaseClient } from "@supabase/supabase-js";
import { type ResolutionRunRow } from "./gauges";
import { ROW_CAP, readRows, type DbResponse, type DbResult } from "./result";
import { T } from "./tables";

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
 * **The adapter framework's `runs` are NOT read here.** Which of that table's
 * columns this page shows is the blocked `OPEN-RUNS` question
 * (ARCHITECTURE.md §12) and belongs to its own ticket and its own module; a
 * read of `runs` added here would answer it by the back door.
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

/** Epoch ms for a timestamp string, or `null` when it will not parse. */
function instantOf(ts: string | null): number | null {
  if (ts === null || ts === "") return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
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
 */
export function newestFirst(rows: readonly ResolutionRunRow[]): ResolutionRunRow[] {
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

/* ── the three states a reader must tell apart ───────────────────────────── */

/**
 * What a cycle row IS, decided from `ended_at` and `outcome` together.
 *
 * Migration `20260901000001` states the requirement in its own header —
 * "three states a reader must tell apart at a glance … a cycle still running,
 * a cycle that finished with its verdict, and a cycle that died - the last
 * keeps a null `ended_at` forever and nothing rewrites it, so a null older
 * than one cadence is how a crash stays visible".
 *
 *  - `outcome` — the producer said how it ended, and the word is carried
 *    verbatim rather than narrowed to the check constraint's three spellings:
 *    an outcome the constraint gains later renders under its own name instead
 *    of being dropped. `skipped` is one of these, so a skipped cycle is
 *    legible as itself and never as a failure.
 *  - `running` — no `ended_at`, and the cycle started less than one cadence
 *    ago: it may well still be going.
 *  - `died` — no `ended_at`, and the cycle started longer ago than that.
 *    Nothing repairs the row, so rendering it as "running" would show a crash
 *    from last March as work in progress forever.
 *  - `unrecorded` — it ended and recorded no outcome. The producer wrote no
 *    word and this app invents none.
 */
export type CycleState =
  | { kind: "outcome"; outcome: string }
  | { kind: "running" }
  | { kind: "died"; ageSeconds: number }
  | { kind: "unrecorded" };

/** What `cycleState` needs from the caller: the clock, and the cadence. */
export interface CycleStateOptions {
  /** The instant "now" means, so a render and its test agree on one clock. */
  now: string | Date;
  /**
   * The resolver's cadence in seconds — the age past which an unfinished
   * cycle is a dead one. Handed in rather than imported: the cadence is
   * `lib/gauges`' constant (`RESOLVER_CADENCE_SECONDS`, from
   * `contracts/resolver.md` §12), and `lib/gauges` reads THIS layer, never the
   * other way about (ARCHITECTURE.md §4).
   */
  cadenceSeconds: number;
}

/** The state of one cycle row. Pure; the clock and the cadence come in. */
export function cycleState(
  row: Pick<ResolutionRunRow, "started_at" | "ended_at" | "outcome">,
  options: CycleStateOptions,
): CycleState {
  if (row.outcome !== null && row.outcome.trim() !== "") {
    return { kind: "outcome", outcome: row.outcome };
  }
  if (row.ended_at !== null) return { kind: "unrecorded" };

  const started = instantOf(row.started_at);
  const now =
    options.now instanceof Date ? options.now.getTime() : Date.parse(options.now);
  // An age nobody can measure cannot carry the "older than one cadence" claim
  // a death is, so the row stays what the schema says it is: a cycle inserted
  // at start that has not recorded an end. `started_at` is not-null in the
  // table, so this is the unparseable case alone.
  if (started === null || Number.isNaN(now)) return { kind: "running" };

  const ageSeconds = (now - started) / 1000;
  return ageSeconds > options.cadenceSeconds
    ? { kind: "died", ageSeconds }
    : { kind: "running" };
}
