import { type Column } from "@/components/ui";
import { cycleState } from "@/lib/cycles/state";
import { count, duration, relativeAge } from "@/lib/format";
import { anchorFor } from "./links";
import { stateCell } from "./outcome";
import type { CycleCounterName, CycleTableRow } from "./rows";
import type { EmptyWords } from "@/components/gauges";

/**
 * The cycle table's columns — campaign admin-window/DEBT-0004, moved here
 * whole from `src/app/cycles/page.tsx`.
 *
 * The eight counters and the cadence arrive as PROPS from the page, which is
 * the half that did the reading: `CYCLE_COUNTERS` is the read's own select
 * list (`lib/db/cycles.ts`) and `RESOLVER_CADENCE_SECONDS` is the resolver's
 * (`lib/gauges/gauge.ts`), and a component reaches neither module
 * (ARCHITECTURE.md §4 rule 1). `CycleCounterName` is derived from the row, so
 * a counter renamed in the scraper's migration stops the page compiling at the
 * call instead of rendering an empty column.
 */

/** What an empty cycle table holds, and the one thing that fills it. */
export const NOTHING_RECORDED: EmptyWords = {
  holds: "cycles recorded",
  filledBy:
    "The resolver files a row every time it wakes, including the cycles that found nothing to do.",
};

/**
 * What this table calls each counter — the app's own words, one naming system
 * for the whole header row (campaign admin-window/BUG-0044).
 *
 * The header of a table is a LABEL, and a label is the app speaking: `micro`
 * is a SANS eyebrow (LOOK_AND_FEEL, Type), while §11's "verbatim in mono"
 * governs machine identifiers rendered as VALUES. `facts_examined` uppercased
 * into a sans eyebrow was neither, and it made this one row speak two
 * vocabularies — seven of the app's words beside six database column names.
 * The words below are the ones the app already uses for these same numbers:
 * the Dashboard's cycle table (`src/app/page.tsx`), this page's own
 * cycle-health gauge ("Facts examined"), and the rejection gauge's
 * "re-rejected".
 *
 * The machine names have not gone anywhere — every counter cell still carries
 * its own column name on `data-cycle-count`, which is what the offline and
 * live tests read. The row's identity is the operator's; the hooks are the
 * machine's.
 *
 * A `Record` over `CycleCounter` rather than a lookup with a fallback: a
 * counter renamed in the scraper's migration stops COMPILING here, instead of
 * quietly falling back to its raw name in the header — the exact regression
 * this ticket exists to prevent.
 */
const CYCLE_COUNTER_LABELS: Record<CycleCounterName, string> = {
  facts_examined: "facts examined",
  applied: "applied",
  held: "held",
  escalated: "escalated",
  entities_created: "entities created",
  claims_linked: "claims linked",
  claims_rerejected: "claims re-rejected",
  errors: "errors",
};

/**
 * The row's own columns: identity, when, how it ended, how long it took, the
 * eight counters, and the failure line the producer wrote.
 *
 * The counter columns are generated from the `counters` the page hands down
 * — `CYCLE_COUNTERS`, the read's own select list — so the eight columns are
 * the eight the read asked for, in `contracts/resolver.md` §6's order, and
 * neither list can lose one without the other failing to compile.
 */
export function cycleColumns({
  now,
  askedFor,
  counters,
  cadenceSeconds,
  durationOf,
}: {
  /** One clock for the whole render, so no two rows disagree about an age. */
  now: string;
  /** The `?cycle=<run_id>` the URL asked for, or undefined for none. */
  askedFor: string | undefined;
  /** The eight counters, in the order the read asked for them. */
  counters: readonly CycleCounterName[];
  /** The resolver's cadence: the age past which an unfinished cycle is a dead one. */
  cadenceSeconds: number;
  /** `ended_at - started_at`, in seconds, or null where there is no end. */
  durationOf: (row: CycleTableRow) => number | null;
}): Column<CycleTableRow>[] {
  return [
    {
      key: "run_id",
      // A cycle's id, and the glossary keeps `cycle` (resolver) and `run`
      // (adapter) apart as two nouns of two producers — on the one page that
      // shows both tables, heading this column `run_id` called a cycle a run
      // (admin-window/BUG-0044). The KEY stays the row's own column name; the
      // header is what the operator reads.
      label: "cycle id",
      cell: (row) => {
        const state = cycleState(row, { now, cadenceSeconds });
        const asked = row.run_id === askedFor;
        return (
          <span
            id={anchorFor(row.run_id)}
            // The asked-for id in the palette's selection colour, so the value
            // the sentence above names is the value that catches the eye in a
            // window of up to 200 mono ids (admin-window/BUG-0054). Accent on
            // this row's fill measures 5.04:1 light and 7.21:1 dark; it is not
            // underlined, which is what this page spells a link with.
            className={asked ? "text-accent" : undefined}
            data-cycle={row.run_id}
            // What this row IS, in one attribute: the four states of a cycle
            // row, decided once in `lib/cycles/state.ts`.
            data-cycle-state={state.kind}
            // The producer's own word, where it wrote one — never narrowed to
            // the check constraint's three spellings.
            data-cycle-outcome={state.kind === "outcome" ? state.outcome : undefined}
            aria-current={asked ? "true" : undefined}
          >
            {row.run_id}
          </span>
        );
      },
    },
    {
      key: "started_at",
      label: "started",
      cell: (row) => {
        const age = relativeAge(row.started_at, now);
        return (
          <span data-cycle-started={row.started_at} title={age.title}>
            {age.text}
          </span>
        );
      },
    },
    {
      key: "outcome",
      label: "outcome",
      cell: (row) => stateCell(cycleState(row, { now, cadenceSeconds })),
    },
    {
      key: "duration",
      label: "duration",
      align: "right",
      // `ended_at - started_at`, and nothing when there is no end: a cycle
      // with no end has no duration, which is the dash and never a zero.
      cell: (row) => {
        const seconds = durationOf(row);
        return seconds === null ? null : (
          <span data-cycle-duration={String(seconds)}>{duration(seconds)}</span>
        );
      },
    },
    ...counters.map((counter) => ({
      key: counter,
      label: CYCLE_COUNTER_LABELS[counter],
      align: "right" as const,
      cell: (row: CycleTableRow) => (
        <span data-cycle-count={counter}>{count(row[counter])}</span>
      ),
    })),
    {
      key: "error_summary",
      // What the Dashboard already heads the same column (`src/app/page.tsx`).
      // The VALUE below is still the producer's line, verbatim.
      label: "error",
      // The producer's first failure, inline and VERBATIM — not trimmed, not
      // summarised, not replaced with a friendlier sentence (LOOK_AND_FEEL:
      // the app shows what the database said). Red, because a cycle that
      // reported one is broken.
      cell: (row) =>
        row.error_summary === null || row.error_summary.trim() === "" ? null : (
          <span data-cycle-error="" className="type-data text-broken">
            {row.error_summary}
          </span>
        ),
    },
  ];
}
