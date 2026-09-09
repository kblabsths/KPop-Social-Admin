import type { ReactNode } from "react";
import { isAbsent, orDash, relativeAge, type Timestamp } from "@/lib/format";
import { cx } from "@/components/ui/cx";
import { DATA_MUTED, Identifier } from "@/components/ui/identifier";

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
  /**
   * The source's tier. **Null when the app could not read it** — the card
   * draws that absence with `orDash`, exactly as it draws an absent value, so
   * the caller never substitutes a character of its own
   * (admin-window/BUG-0134).
   */
  tier: string | null;
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
    <Identifier>{orDash(value)}</Identifier>
  );
}

/**
 * One machine value on the claim line — the source's own name, the source's
 * tier — in the identifier primitive's isolated box
 * (admin-window/BUG-0151, DEBT-0011 criteria 2 and 4).
 *
 * Both are foreign text: `claim.source` is the source's own name straight out
 * of the pipeline and `claim.tier` is `sources.tier`, and
 * `src/components/ui/identifier.tsx` names exactly that class of value as what
 * the primitive is for ("a source's own name"). Hand-facing them with
 * `DATA_MUTED` left them un-isolated inside the line's own bidi paragraph, so
 * an unterminated U+202E in a source name drew the app's OWN separators, tier
 * and relative age backwards: `ticketmaster · official · 14d ago` reached
 * Chromium as `ticketoga d41 · laiciffo · retsam`. `<Identifier muted>` renders
 * the same class pair `DATA_MUTED` spells, so this changes the face by exactly
 * `dir="ltr"` — the isolation, and nothing else.
 *
 * An ABSENT value is not a machine value at all: it is the app's own absence
 * element (`orDash`, admin-window/BUG-0134), so it is returned unwrapped —
 * isolating the app's own dash would be the same category error in reverse.
 */
function ClaimValue({ value }: { value: string | null }) {
  if (isAbsent(value)) return <>{orDash(value)}</>;
  return <Identifier muted>{value}</Identifier>;
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
            {/*
              * The wrapper keeps `DATA_MUTED`: after the values moved into
              * their own isolated boxes it inks only the app's OWN words on
              * this line — the two separators and the relative age — which is
              * precisely what the primitive's doc reserves the class for
              * ("the app's own transient words that happen to share the face
              * … they are not identifiers and they are not isolated"). Its one
              * prohibition, "a machine identifier takes `<Identifier muted>`
              * instead — never this", is now honoured: no machine value on
              * this line wears the class.
              */}
            <span className={DATA_MUTED}>
              <ClaimValue value={claim.source} />
              {" · "}
              <ClaimValue value={claim.tier} />
              {" · "}
              <span title={age.title || undefined}>{orDash(age.text)}</span>
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
        <span className={DATA_MUTED}>{canonical.provenance}</span>
        {canonical.action ? <div className="flex gap-2 pt-1">{canonical.action}</div> : null}
      </div>
    </div>
  );
}
