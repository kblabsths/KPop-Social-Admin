/**
 * Data-surface state 3 of 4: the backing table is not in this database yet.
 * Gray, never red — red means broken, never unavailable — and never a zero
 * that reads like data. Names the missing table verbatim in mono and what
 * creates it (LOOK_AND_FEEL, state 3 and Voice bar 4).
 *
 * Carries `data-state="not_provisioned"` — the hook that separates it from
 * `Empty`, which draws the identical container (ARCHITECTURE §10,
 * admin-window/TASK-0032).
 */
export function NotProvisioned({
  missing,
  arrivesWith,
  eyebrow,
}: {
  /** The table/view name the query used, spelled exactly as the query spelled it. */
  missing: string;
  /** What creates it: "the scraper repo's migration". */
  arrivesWith: string;
  /**
   * The `micro` label of the surface this card stands in for. Optional here
   * and always passed by the gauge components — see `Empty` for the ruling
   * (ARCHITECTURE §7, admin-window/TASK-0030).
   */
  eyebrow?: string;
}) {
  return (
    <div
      data-state="not_provisioned"
      className="border border-hairline bg-surface p-3"
    >
      {eyebrow === undefined ? null : (
        <p className="type-micro text-ink-secondary">{eyebrow}</p>
      )}
      <p className="type-body text-ink-secondary">
        <span className="type-data text-ink">{missing}</span>{" "}
        isn&rsquo;t in this database yet — it arrives with {arrivesWith}.
      </p>
    </div>
  );
}
