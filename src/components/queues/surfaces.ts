/**
 * What an empty queue holds and what fills it — the words themselves, in one
 * place, because TWO surfaces say them (campaign admin-window/BUG-0125).
 *
 * `/queues` says them in its `Empty` card, under the rows that are not there.
 * The Dashboard says them in the sub-line under a zero attention count, where
 * there is no rows region and so no `Empty` card to carry them: a card reading
 * `OPEN DECISIONS 0` with no filler named tells a reader nothing about whether
 * the queue is quiet or the resolver is not asking (the user-sim walk of
 * 2026-09-09 read exactly that, beside 108 links nobody can make).
 *
 * Both surfaces therefore render the SAME sentence about what puts a row in a
 * queue — one concept, one spelling (LOOK_AND_FEEL, the Voice glossary), and a
 * later correction to the resolver's filing conditions lands on both screens
 * at once instead of on whichever page its author had open. The duplicated
 * tone map of admin-window/BUG-0106 is what a second copy costs.
 *
 * Moved here whole from `src/app/queues/page.tsx`, where it was `NOTHING_HERE`
 * and where its two consumers could not both reach it. It is data, not a
 * component: no import of `lib/db`, nothing to render (ARCHITECTURE.md §5).
 */
import type { EmptyWords } from "@/components/gauges";
import type { Kind } from "@/lib/review/shapes";

/**
 * What an empty queue of each kind holds, and the one thing that fills it —
 * never a bare "No data" (LOOK_AND_FEEL Voice bar 4).
 *
 * `holds` is the noun the QUEUE's own empty card uses, so it stands for the
 * set that page rendered — the rows a filter left, open and settled alike. A
 * surface counting something narrower (the Dashboard counts OPEN items alone)
 * says its own scope in its own words and takes only `filledBy` from here:
 * that clause is about the resolver, and it is true of every scope.
 */
export const NOTHING_IN_QUEUE: Record<Kind, EmptyWords> = {
  decision: {
    holds: "decisions waiting",
    filledBy:
      "The resolver files one when sources disagree about a fact, or when a record cannot link.",
  },
  signal: {
    holds: "signals",
    filledBy:
      "The resolver files one when a source crosses its stuck-record threshold.",
  },
};
