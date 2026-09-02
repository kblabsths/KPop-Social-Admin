import type { ReactNode } from "react";
import { nullDash, relativeAge, type Timestamp } from "@/lib/format";
import { cx } from "@/components/ui/cx";

/**
 * The evidence pair — this app's signature block.
 *
 * Wherever a contested fact appears (review-item detail, claim detail, the
 * edit surface's provenance line) it renders as cards in one row: **the
 * contending claims on the left, the current canonical value as the rightmost
 * card**, hairline-separated and visibly labelled as current.
 *
 * Every claim card carries, in this fixed order: the value (`data`, primary
 * text), then `source · tier · age` in secondary. The canonical card adds its
 * provenance line. **The order and the anatomy never change between screens** —
 * that repetition is what lets the operator read a conflict in two seconds.
 *
 * Verdict actions live on the card they act on (`action`), never collected
 * into a separate toolbar.
 */
export type EvidenceClaim = {
  /** React key — the observation id. */
  id: string;
  value: string | null;
  source: string;
  tier: string;
  /** When the claim was observed; rendered as a relative age. */
  observedAt: Timestamp;
  /** The one control that chooses this value, rendered inside this card. */
  action?: ReactNode;
};

export type EvidenceCanonical = {
  value: string | null;
  /** "ticketmaster, applied 3d ago" / "admin-set Jun 12". */
  provenance: string;
  action?: ReactNode;
};

function CardValue({ value }: { value: string | null }) {
  return (
    <span className="type-data text-ink">{value === null || value === "" ? nullDash() : value}</span>
  );
}

export function EvidencePair({
  claims,
  canonical,
}: {
  claims: EvidenceClaim[];
  canonical: EvidenceCanonical;
}) {
  return (
    <div className="flex flex-wrap items-stretch border border-hairline bg-surface">
      {claims.map((claim, index) => {
        const age = relativeAge(claim.observedAt);
        return (
          <div
            key={claim.id}
            className={cx(
              "flex min-w-0 flex-1 flex-col gap-1 p-3",
              index > 0 && "border-l border-hairline",
            )}
          >
            <span className="type-micro text-ink-secondary">contender</span>
            <CardValue value={claim.value} />
            <span className="type-data text-ink-secondary">
              {claim.source} · {claim.tier} ·{" "}
              <span title={age.title || undefined}>{age.text}</span>
            </span>
            {claim.action ? <div className="flex gap-2 pt-1">{claim.action}</div> : null}
          </div>
        );
      })}
      <div
        className={cx(
          "flex min-w-0 flex-1 flex-col gap-1 p-3",
          claims.length > 0 && "border-l border-hairline",
        )}
      >
        <span className="type-micro text-ink">current</span>
        <CardValue value={canonical.value} />
        <span className="type-data text-ink-secondary">{canonical.provenance}</span>
        {canonical.action ? <div className="flex gap-2 pt-1">{canonical.action}</div> : null}
      </div>
    </div>
  );
}
