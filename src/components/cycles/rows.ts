/**
 * The row and read shapes `/cycles`' presentation takes as plain props —
 * campaign admin-window/DEBT-0004.
 *
 * **Declared here, structurally, rather than imported from `lib/db/**`.** A
 * component takes plain props and reaches no database (ARCHITECTURE.md §4
 * rule 1), which is the whole reason every surface below the page function can
 * be rendered in a test with no client at all. `components/ui/state-of.tsx`
 * (`UnavailableRead`), `components/ui/window-line.tsx` (`ReadWindow`) and the
 * pure leaf `lib/cycles/state.ts` (`CycleRow`) each carry the same seam for
 * the same reason, and the compiler checks every call across it: the data
 * layer's `ResolutionRunRow`, `RunRow`, `RunWindow` and `DbResult` satisfy
 * these structurally, so the page hands its reads straight down and nothing
 * translates.
 *
 * The two ORDERED VOCABULARIES these rows are rendered by — which eight
 * counters a cycle has, which nine columns of `runs` the 2026-09-02 ruling
 * displays — stay in `lib/db/**`, where the select list that asks for them
 * lives, and arrive here as props from the page that did the reading. That is
 * what keeps "the eight columns are the eight the read asked for" a COMPILE
 * error rather than a comment: the name unions below are derived from the row
 * shapes, so a counter or a column renamed in the scraper's migration stops
 * `src/app/cycles/page.tsx` compiling at the call.
 */
import type { UnavailableRead } from "@/components/ui";

/**
 * A `resolution_runs` row as the cycle table renders it — identity, when, how
 * it ended, the eight counters, and the producer's failure line.
 * `lib/db/cycles.ts`'s `ResolutionRunRow` satisfies it.
 */
export interface CycleTableRow {
  run_id: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  facts_examined: number;
  applied: number;
  held: number;
  escalated: number;
  entities_created: number;
  claims_linked: number;
  claims_rerejected: number;
  errors: number;
  error_summary: string | null;
}

/**
 * One of the eight counter columns — the row's numeric fields, derived from
 * the row itself so that `CYCLE_COUNTER_LABELS` cannot label a ninth or miss
 * one, and `CYCLE_COUNTERS` (`lib/db/cycles.ts`) cannot drift from it without
 * the page's call failing to compile.
 */
export type CycleCounterName = {
  [Key in keyof CycleTableRow]: CycleTableRow[Key] extends number ? Key : never;
}[keyof CycleTableRow];

/**
 * A `runs` row as this page renders it: the primary key, plus the nine columns
 * Ben's ruling of 2026-09-02 displays. `lib/db/runs.ts`'s `RunRow` satisfies it.
 */
export interface RunTableRow {
  /** The row key and the order's tiebreak. Never a tenth column. */
  run_id: string;
  source: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  error_summary: string | null;
  records_parsed: number;
  claims_emitted: number;
  records_unlinked: number;
  failure_class: string | null;
}

/** One of the nine displayed columns — every field of the row but its key. */
export type RunColumnName = Exclude<keyof RunTableRow, "run_id">;

/** Which of the nine are figures, and so right-aligned. */
export type RunCountName = {
  [Key in RunColumnName]: RunTableRow[Key] extends number ? Key : never;
}[RunColumnName];

/** The window of runs a read returned. `lib/db/runs.ts`'s `RunWindow` satisfies it. */
export interface RunsWindow {
  rows: RunTableRow[];
  limit: number;
  truncated: boolean;
}

/**
 * A read, as a component sees it: the rows, or which of the two refusals this
 * is. `lib/db/result.ts`'s `DbResult<T>` satisfies it arm for arm.
 */
export type ReadOf<T> = { kind: "ok"; data: T } | UnavailableRead;
