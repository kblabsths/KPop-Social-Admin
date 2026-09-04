import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { STATE_WORD, type CycleState } from "@/lib/cycles/state";
import { duration } from "@/lib/format";

/**
 * How an OUTCOME word is rendered — campaign admin-window/DEBT-0004.
 *
 * Both halves of `/cycles` render one: a cycle's, decided from two columns by
 * `cycleState`, and a run's, which the producer either wrote or did not. They
 * share the tone map here rather than each carrying a copy of it, because two
 * copies is how the same word comes to be green on one table and grey on the
 * one below it.
 */

/** How a completed cycle's own word is coloured. Health carries colour; nothing else does. */
export const OUTCOME_TONE: Record<string, "healthy" | "broken" | "neutral"> = {
  succeeded: "healthy",
  failed: "broken",
};

/*
 * The word for each no-outcome state is `STATE_WORD`, imported from the leaf
 * `lib/cycles/state.ts` — read by the table row below, by the cycle-health
 * panel's outcome list, AND by the Dashboard's cycle table, so no two of them
 * can name one state two ways (Voice glossary: "one name per concept,
 * everywhere").
 *
 * admin-window/BUG-0055 is what it is for: the rows said `died` where the
 * panel said `unfinished`, over the same four cycles on the same screen, and a
 * reader had to satisfy himself the two sets were one before trusting either
 * count. admin-window/BUG-0074 is why it left this file: the Dashboard, which
 * cannot import a page, had grown its own copy of the words and its own idea
 * of what a no-outcome row is.
 */

/**
 * A cycle's state, as the operator reads it.
 *
 * The producer's own word wins where there is one, verbatim and in mono. Where
 * there is none the row says which of the two null-outcome states it is —
 * `died` is a crash that nothing will ever repair, and rendering it as
 * "running" would leave a months-old failure reading as work in progress.
 */
export function stateCell(state: CycleState): ReactNode {
  if (state.kind === "outcome") {
    return <Badge tone={OUTCOME_TONE[state.outcome] ?? "neutral"}>{state.outcome}</Badge>;
  }
  if (state.kind === "running") {
    return <span className="type-body text-ink-secondary">{STATE_WORD.running}</span>;
  }
  if (state.kind === "died") {
    return (
      <span title={`no end recorded ${duration(state.ageSeconds)} after it started`}>
        <Badge tone="broken">{STATE_WORD.died}</Badge>
      </span>
    );
  }
  // It ended and recorded no outcome. The producer wrote no word, so neither
  // does this page: the table's own dash stands for the absent value.
  //
  // A plain function and not a component, deliberately: a `<StateCell />`
  // ELEMENT is never absent, whatever it renders, so `DataTable`'s `orDash`
  // would see a body and leave the cell BLANK — the one rendering
  // LOOK_AND_FEEL forbids ("never blank, never `null`, `N/A` or `none`").
  // Returning the `null` itself is what puts the dash in the cell.
  return null;
}
