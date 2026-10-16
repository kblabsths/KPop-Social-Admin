/**
 * The row shape `/sources`' presentation takes as a plain prop — campaign
 * admin-window/DEBT-0004.
 *
 * **Declared here, structurally, rather than imported from `lib/db/**`.** A
 * component takes plain props and reaches no database (ARCHITECTURE.md §4
 * rule 1), which is what lets the registry table be rendered in a test with no
 * client at all; `components/ui/state-of.tsx`, `components/ui/window-line.tsx`
 * and the pure leaf `lib/sources/names.ts` each carry the same seam for the
 * same reason. `lib/db/sources.ts`'s `SourceState` satisfies this, so the page
 * hands its read straight down and nothing translates.
 */

/**
 * A `sources` state row with its last run resolved, narrowed to the columns
 * this table draws.
 *
 * `lastRun` is `null` when `runs` holds no row for this source's NAME — the
 * honest answer, rendered as the dash: a source that has never run is not a
 * source that ran zero times.
 */
export interface SourceStateRow {
  source_id: string;
  source: string;
  kind: string;
  lifecycle: string;
  tier: string;
  checkpoint: string | null;
  note: string | null;
  lastRun: {
    run_id: string;
    started_at: string;
    ended_at: string | null;
    outcome: string | null;
    failure_class: string | null;
  } | null;
}
