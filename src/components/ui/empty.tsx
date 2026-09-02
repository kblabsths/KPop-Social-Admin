/**
 * Data-surface state 2 of 4: the surface exists and holds nothing. Names what
 * it holds and the one thing that fills it — never a bare "No data"
 * (LOOK_AND_FEEL, Voice bar 4). An empty queue is good news and reads that
 * way, so this state carries no colour.
 */
export function Empty({
  holds,
  filledBy,
}: {
  /** What the surface would hold, as a plural noun: "open decisions". */
  holds: string;
  /** The one thing that fills it: "the resolver files one here when…". */
  filledBy: string;
}) {
  return (
    <div className="border border-hairline bg-surface p-3">
      <p className="type-body text-ink">No {holds}</p>
      <p className="type-body text-ink-secondary">{filledBy}</p>
    </div>
  );
}
