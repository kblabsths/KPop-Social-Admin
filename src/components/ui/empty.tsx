import type { ReactNode } from "react";
import { Eyebrow, type MicroLabel } from "./micro-label";

/**
 * Data-surface state 2 of 4: the surface exists and holds nothing. Names what
 * it holds and the one thing that fills it — never a bare "No data"
 * (LOOK_AND_FEEL, Voice bar 4). An empty queue is good news and reads that
 * way, so this state carries no colour.
 *
 * Carries `data-state="empty"`. This card and `NotProvisioned` render the same
 * container and differ only in their WORDS, so before this hook existed the
 * only way to tell an honest emptiness from an absent table was to grep the
 * copy — which graded an empty page as an unprovisioned one and pinned the
 * designer's words in a test (ARCHITECTURE §10, admin-window/TASK-0032).
 */
export function Empty({
  holds,
  filledBy,
  eyebrow,
}: {
  /**
   * What the surface would hold, as a plural noun: "open decisions".
   *
   * A NODE and not a string, so that a caller whose sentence contains a
   * machine identifier can set that one word in the app's identifier-in-prose
   * spelling — the same wrapping `NotProvisioned` does for the table it names
   * (LOOK_AND_FEEL Voice bar 5; admin-window/BUG-0120). A plain string is
   * still a node, so a caller with nothing to wrap passes one and this card
   * renders exactly the text it rendered before the widening: the card adds no
   * element of its own around either line.
   */
  holds: ReactNode;
  /** The one thing that fills it: "the resolver files one here when…". A node, for the reason `holds` is. */
  filledBy: ReactNode;
  /**
   * The `micro` label of the surface this card stands in for, in the position
   * `StatCard` gives it. Optional: a page renders this under a `Section`
   * heading that already names the surface, so requiring it there would be
   * churn. The three gauge components ALWAYS pass their own `label`, because
   * their card replaces the whole gauge — and a screen of empty gauges with no
   * eyebrows names no knobs (ARCHITECTURE §7, admin-window/TASK-0030).
   */
  eyebrow?: MicroLabel;
}) {
  return (
    <div data-state="empty" className="border border-hairline bg-surface p-3">
      {eyebrow === undefined ? null : (
        <Eyebrow label={eyebrow} className="block" />
      )}
      <p className="type-body text-ink">No {holds}</p>
      <p className="type-body text-ink-secondary">{filledBy}</p>
    </div>
  );
}
