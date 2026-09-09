import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui";
import { STATE_WORD, type CycleState } from "@/lib/cycles/state";
import { duration } from "@/lib/format";

/**
 * How an OUTCOME word is rendered — campaign admin-window/DEBT-0004.
 *
 * Both halves of `/cycles` render one: a cycle's, decided from two columns by
 * `cycleState`, and a run's, which the producer either wrote or did not. THE
 * DASHBOARD'S cycle table renders one too, and takes it from here for the same
 * reason: the tone decision lives in this module and is called, never copied,
 * because two copies is how the same word comes to be green on one table and
 * grey on the one below it (admin-window/BUG-0106 — `src/app/page.tsx` had
 * grown exactly that second copy).
 */

/** The four readings the palette gives an outcome word. */
export type OutcomeTone = "neutral" | "healthy" | "attention" | "broken";

/**
 * What the producer's WORD alone reads as, before the row's own errors are
 * counted. Health carries colour; nothing else does.
 */
const WORD_TONE: Record<string, OutcomeTone> = {
  succeeded: "healthy",
  failed: "broken",
};

/**
 * The tone one outcome earns — the app's reading of the producer's word AND
 * the error count of the row or card that word sits on.
 *
 * **Healthy is green only when nothing needs a human** (LOOK_AND_FEEL,
 * Palette). A row that reports errors has something left to answer for, so its
 * word cannot be green however confident the producer was: it renders in
 * attention amber, and the WORD is untouched — verbatim, in mono, exactly as
 * written. admin-window/BUG-0106 is the measurement: seventeen cycles on
 * `/cycles` said `succeeded` in `--color-healthy` while their own ERRORS cell
 * said 108, two cells left of the failure they had recorded verbatim.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It never demotes a broken word. `failed` on a row with errors stays
 *    broken red: red already says a human is needed, and amber would be a
 *    quieter reading of a louder fact.
 *  - It never promotes. A word with no health reading stays neutral where the
 *    row is clean; only a non-zero error count moves anything.
 *  - `errors === null` means the producer keeps no error count for this kind
 *    of row at all — an adapter `run` — and then the word alone decides, which
 *    is what it did before this function existed. A `0` is a counted zero and
 *    means the row is clean; the two are not the same fact.
 */
export function outcomeTone(outcome: string, errors: number | null): OutcomeTone {
  const word = WORD_TONE[outcome] ?? "neutral";
  if (word === "broken") return word;
  return errors !== null && errors > 0 ? "attention" : word;
}

/**
 * Which `Badge` tone draws each reading.
 *
 * `high` is the Badge's own name for the palette's **attention amber** — the
 * severity colour, and the same ink `--color-attention` the gauges spell
 * `attention` (`ui/stat-card.tsx`). No colour is added to the palette here:
 * this maps an outcome's reading onto ink the app already measures for
 * contrast (LOOK_AND_FEEL bar 12: attention on chrome, 4.57:1 light).
 */
export const OUTCOME_BADGE_TONE: Record<OutcomeTone, BadgeTone> = {
  neutral: "neutral",
  healthy: "healthy",
  attention: "high",
  broken: "broken",
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
 *
 * `errors` is the row's OWN error count, which is what decides whether its
 * word may read healthy (`outcomeTone`); the caller passes the count from the
 * same row it is drawing, and `null` where its producer keeps none.
 * `data-outcome-tone` publishes the reading the app arrived at, so a test and
 * a walk can ask which tone a row earned without reading a class name.
 */
export function stateCell(state: CycleState, errors: number | null): ReactNode {
  if (state.kind === "outcome") {
    const tone = outcomeTone(state.outcome, errors);
    return (
      <span data-outcome-tone={tone}>
        <Badge tone={OUTCOME_BADGE_TONE[tone]}>{state.outcome}</Badge>
      </span>
    );
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
