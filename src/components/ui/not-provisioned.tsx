/**
 * Data-surface state 3 of 4: the backing table is not in this database yet.
 * Gray, never red — red means broken, never unavailable — and never a zero
 * that reads like data. Names the missing table verbatim in mono and what
 * creates it (LOOK_AND_FEEL, state 3 and Voice bar 4).
 */
export function NotProvisioned({
  missing,
  arrivesWith,
}: {
  /** The table/view name the query used, spelled exactly as the query spelled it. */
  missing: string;
  /** What creates it: "the scraper repo's migration". */
  arrivesWith: string;
}) {
  return (
    <div className="border border-hairline bg-surface p-3">
      <p className="type-body text-ink-secondary">
        <span className="type-data text-ink">{missing}</span> isn&rsquo;t in this
        database yet — it arrives with {arrivesWith}.
      </p>
    </div>
  );
}
