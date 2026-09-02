/**
 * Data-surface state 2 of 4: the surface exists and holds nothing. Names what
 * it holds and the one thing that fills it — never a bare "No data"
 * (LOOK_AND_FEEL, Voice bar 4). An empty queue is good news and reads that
 * way, so this state carries no colour.
 */
export function Empty({
  holds,
  filledBy,
  eyebrow,
}: {
  /** What the surface would hold, as a plural noun: "open decisions". */
  holds: string;
  /** The one thing that fills it: "the resolver files one here when…". */
  filledBy: string;
  /**
   * The `micro` label of the surface this card stands in for, in the position
   * `StatCard` gives it. Optional: a page renders this under a `Section`
   * heading that already names the surface, so requiring it there would be
   * churn. The three gauge components ALWAYS pass their own `label`, because
   * their card replaces the whole gauge — and a screen of empty gauges with no
   * eyebrows names no knobs (ARCHITECTURE §7, admin-window/TASK-0030).
   */
  eyebrow?: string;
}) {
  return (
    <div className="border border-hairline bg-surface p-3">
      {eyebrow === undefined ? null : (
        <p className="type-micro text-ink-secondary">{eyebrow}</p>
      )}
      <p className="type-body text-ink">No {holds}</p>
      <p className="type-body text-ink-secondary">{filledBy}</p>
    </div>
  );
}
