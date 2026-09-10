import { Fragment, type ReactNode } from "react";
import { orDash, relativeAge, type Timestamp } from "@/lib/format";
import { hasVisibleContent } from "@/lib/verdict/decision";
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

/**
 * One segment of the canonical card's provenance line: **either** the app's own
 * words **or** one machine value the app may qualify on either side of.
 *
 * The line reads `ticketmaster · official at apply · applied 3d ago`, and three of
 * those words are not the app's: the winning source's own name, the tier frozen
 * at the apply, and — when the applied claim is no longer live — the status that
 * claim now carries. Handed over as one pre-joined sentence they were foreign
 * text sitting bare in a sentence this app wrote, which is exactly what
 * `src/components/ui/identifier.tsx` exists to stop (ARCHITECTURE.md §7,
 * admin-window/BUG-0137; campaign admin-window/DEBT-0011 criteria 2 and 4).
 *
 * So the caller hands over the PARTS and this file renders them: every
 * `identifier` goes through `MachineValue`, which puts a present value in
 * `<Identifier muted>` — the very class pair `DATA_MUTED` spells, so the face
 * is unchanged and the added property is the isolation — and an absent one
 * through the app's own absence element instead (admin-window/BUG-0152). The
 * app's own words stay text, and the SEPARATOR between segments
 * is this component's, never the caller's, for the reason `MicroLabel` splits an
 * eyebrow the same way (`src/components/ui/micro-label.tsx`): a value the app
 * concatenated into a string can no longer be treated as a value.
 *
 * A plain `string` segment is the app's own words — the two stateless lines
 * ("nothing has been applied to this field yet") are exactly that and carry no
 * machine value at all.
 */
export type ProvenanceSegment =
  | string
  | {
      /** The app's own words BEFORE the value: "the claim it applied is now". */
      before?: string;
      /**
       * The machine value itself — a source name, a tier, a claim status.
       * Verbatim when it has anything visible in it; when it has not, the line
       * draws the app's absence element in its place, exactly as the claim line
       * does (admin-window/BUG-0152).
       */
      identifier: string;
      /** The app's own words AFTER it: "at apply". */
      after?: string;
    };

export type EvidenceCanonical = {
  value: string | null;
  /**
   * The provenance line, in segments: `[{identifier:"ticketmaster"}, …]` renders
   * as `ticketmaster · official at apply · applied 3d ago`.
   */
  provenance: readonly ProvenanceSegment[];
  action?: ReactNode;
};

function CardValue({ value }: { value: string | null }) {
  return (
    <Identifier>{orDash(value)}</Identifier>
  );
}

/**
 * One machine value on a card's secondary line, in the identifier primitive's
 * isolated box — the claim line's source and tier, and every `identifier`
 * segment of the canonical card's provenance line
 * (admin-window/BUG-0151, BUG-0152, DEBT-0011 criteria 2 and 4).
 *
 * All of them are foreign text: `claim.source` is the source's own name
 * straight out of the pipeline, `claim.tier` is `sources.tier`, and the
 * provenance line's parts are that same name, the tier frozen at the apply and
 * the status the applied claim now carries — and
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
 * isolating the app's own dash would be the same category error in reverse,
 * and wrapping it anyway draws an EMPTY box that announces no absence at all.
 *
 * **Absent here is INK and not `isAbsent`** (admin-window/BUG-0156). Every
 * value this function is handed is a PRODUCER's — a source's own name, a tier,
 * an applied claim's status — so the question is the one the label rule asks,
 * `hasVisibleContent` (`lib/verdict/decision.ts`, the app's one definition of
 * blank). `isAbsent` (`lib/format.ts`) additionally calls the bare em dash an
 * absence, because it exists to recognise what the app's OWN formatters
 * return (`count(null)`, `relativeAge(null).text`) — and none of those reach
 * here: the age beside these values is handed to `orDash` directly, one line
 * below. So a source the registry NAMES `—` used to be announced on this line
 * as `no value`, in disabled ink, about a source the page holds the name of.
 * A `null` is still an absence, and so is a name with no ink in it.
 *
 * Both lines of the canonical card ask THIS function rather than each writing
 * the guard again: the provenance line wrapped its parts unconditionally and so
 * drew that empty box while the claim line beside it drew the dash
 * (admin-window/BUG-0152) — one helper is what keeps the two lines on one card
 * answering "nothing here" the same way (LESSONS 5, 7).
 */
function MachineValue({ value }: { value: string | null }) {
  if (value === null || !hasVisibleContent(value)) return <>{orDash(value)}</>;
  return <Identifier muted>{value}</Identifier>;
}

/**
 * The separator the app writes between the parts of a secondary line — the
 * claim line's `source · tier · age` and the canonical card's provenance line.
 *
 * It is the APP's own character, so it lives here, once, rather than at either
 * caller: a caller that joined its parts around a separator of its own would be
 * handing this component a sentence again, and the values inside it would stop
 * being values (which is precisely how the provenance line ended up bare —
 * campaign admin-window/DEBT-0011). The two lines are read together on one card,
 * so one spelling is also what keeps them looking alike.
 */
const SEPARATOR = " · ";

/**
 * One provenance segment: the app's own words, or one machine value in the
 * identifier primitive's isolated box with the app's words beside it.
 *
 * The words are real text nodes on either side of the box, never inside it —
 * the same split `Eyebrow` makes for an eyebrow — so an unterminated bidi
 * control in the value can reorder the value and nothing else, and the app's
 * sentence reads in the order it was written.
 *
 * The value goes through `MachineValue`, the same guard the claim line uses, so
 * a segment whose identifier has nothing visible in it draws the app's absence
 * element instead of an empty isolated box (admin-window/BUG-0152). The app's
 * own words beside it are still the app's, and are still rendered.
 */
function ProvenancePart({ segment }: { segment: ProvenanceSegment }) {
  if (typeof segment === "string") return <>{segment}</>;
  return (
    <>
      {segment.before === undefined ? null : (
        <>
          {segment.before}
          {" "}
        </>
      )}
      <MachineValue value={segment.identifier} />
      {segment.after === undefined ? null : (
        <>
          {" "}
          {segment.after}
        </>
      )}
    </>
  );
}

/**
 * The canonical card's provenance line, assembled from the caller's segments.
 *
 * The wrapper keeps `DATA_MUTED` for the reason the claim line's does: after the
 * machine values move into their own isolated boxes it inks only the app's own
 * words — the separators, "at apply", "applied 3d ago" — which is what the
 * primitive's doc reserves the class for.
 */
function ProvenanceLine({ segments }: { segments: readonly ProvenanceSegment[] }) {
  return (
    <span className={DATA_MUTED}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index === 0 ? null : SEPARATOR}
          <ProvenancePart segment={segment} />
        </Fragment>
      ))}
    </span>
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
              <MachineValue value={claim.source} />
              {SEPARATOR}
              <MachineValue value={claim.tier} />
              {SEPARATOR}
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
        <ProvenanceLine segments={canonical.provenance} />
        {canonical.action ? <div className="flex gap-2 pt-1">{canonical.action}</div> : null}
      </div>
    </div>
  );
}
