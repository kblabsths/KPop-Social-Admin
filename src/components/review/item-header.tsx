import { IN_PAGE_LINK } from "@/components/cycles/links";
import { Badge } from "@/components/ui";
import { count, counted, relativeAge } from "@/lib/format";
import type { Kind, ReviewItemRow, Shape } from "@/lib/review/shapes";

/**
 * **What happened** — the first of spec §6's three anatomy points, and the
 * same block for all three shapes (campaign admin-window/TASK-0011).
 *
 * It carries exactly what the contract lists: the item's summary sentence, its
 * severity, its age, and `folded_count` rendered as "asked again ×N". The
 * queue, kind, shape and status stand beside them as the machine's own words,
 * verbatim in mono badges — only severity carries colour (LOOK_AND_FEEL,
 * Chips and badges), so a detail page is not a rainbow.
 *
 * `folded_count` is a real zero, not an absence: an item nothing has folded
 * into was asked once, and that is a fact rather than a missing number.
 *
 * **The fold count does not stand alone** (campaign admin-window/BUG-0124).
 * Both M2 user-sims read `asked again ×700` over an evidence table of 91 rows
 * and could not say what either number counted; one said outright that, asked
 * for a one-line summary of the signal, they would have quoted the wrong
 * figure. So the block states what a fold IS — one re-ask of this item, never
 * one record — and names the other count beside it: how many evidence ids the
 * item carries, which is the population the block below lists. Two figures,
 * each with its noun, in one sentence, and no ratio between them: Admin holds
 * `folded_count` and `evidence` as two columns of one row and relates them
 * nowhere else (LOOK_AND_FEEL Voice bar 6; VISION non-goal "no severity
 * formula").
 *
 * The evidence-id clause follows the READ, exactly as a window line does
 * (ARCHITECTURE.md §4.3): `evidenceIds` is null on every state where the
 * evidence read did not happen, so its absence means that and nothing else,
 * and the sentence never counts ids nobody read.
 *
 * **It re-derives nothing.** `kind` and `shape` arrive as props because
 * `shapeOf`/`kindOfItem` in `src/lib/review/shapes.ts` are the only spellings
 * of that derivation in the app (spec §6: "the kind belongs to the shape and
 * is derived in code — no column carries it").
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 * Every control in this markup is a link — nothing here settles anything.
 *
 * Those links carry the app's ONE link spelling, imported from
 * `components/cycles/links.ts` rather than retyped here, and the whole of each
 * link's words are drawn in it: `value` keeps its mono FACE and takes the
 * link's INK, because a descendant's `text-*` outranks the ink the anchor
 * inherits down to it, so `text-ink-secondary` on the value drew half of every
 * out-link in the ink of a value that goes nowhere (admin-window/BUG-0117 —
 * the mechanism of BUG-0113 without the chip's fill over the underline).
 */

/** One way out of this item: where it goes, and what it opens. */
export interface ItemLink {
  /** What the link opens, in the app's voice. */
  label: string;
  href: string;
  /**
   * Does this leave the app?
   *
   * The first links here that do: a source's own listing for the event
   * (`event_sources.source_url`, Ben 2026-10-21). An external destination
   * opens in a new tab and carries `rel="noreferrer noopener"` — the operator
   * is mid-decision and must not lose the page, and a source platform has no
   * business being handed this app's address. Absent or false is every
   * in-app link, which is unchanged.
   */
  external?: boolean;
  /**
   * WHAT it is narrowed to, as the app names it — shown beside the label.
   *
   * The caller resolves it, and this component prints exactly what it is
   * handed: a source arrives as the registry's name (`ticketmaster`), a record
   * as `domain/entity_id`, and anything the app could not resolve as the
   * machine value verbatim. It used to be documented as "the machine value" and
   * a source-pattern item duly read `Its source 01a05782-…` above evidence
   * cells that read `ticketmaster` and pointed at the same href — one page, one
   * destination, two labels (admin-window/BUG-0043).
   */
  value?: string;
}

/**
 * The fold count wearing its noun, beside the count of what the evidence block
 * below lists — campaign admin-window/BUG-0124.
 *
 * Three arms, and each says only what this page can stand behind:
 *
 *  - the evidence read did not happen (`null`): the definition alone. No
 *    second figure is invented for a read nobody made;
 *  - the item carries no evidence id: the folds, and that absence stated as an
 *    absence — the block below already says what would fill it;
 *  - both counts are real: both are printed with their nouns, and where they
 *    are the SAME number the sentence says so, rather than leaving a reader to
 *    decide for themselves whether one figure is the other one narrowed.
 */
function foldScope(
  folds: number,
  evidenceIds: number | null,
  shape: Shape,
): string {
  /*
   * WHAT A FOLD IS depends on the shape, and the line used to assume one shape.
   *
   * On a `data_conflict` item, `evidence` is "the observation ids behind
   * exactly the values the summary names, appended as repeats fold in"
   * (`20260911000009`). So folds and evidence ids count the same events from
   * two directions and a disagreement between them is a real finding — which
   * is why admin-window/BUG-0124 put the comparison here.
   *
   * On a REFERENCE item the two are unrelated. `evidence` is the ranked
   * CANDIDATE entity ids, fixed when the item opens, and "a repeat sighting
   * folds `folded_count` and `last_evidence_at` and appends nothing". So the
   * folds count SIGHTINGS and the evidence counts OPTIONS. Measured on the
   * Yeonjun item: 88 folds, 10 candidates — and this function reported that as
   * "the counts disagree", which is two unrelated numbers accused of
   * contradicting each other (Ben found it, 2026-10-23).
   *
   * The sightings themselves are not recorded anywhere: `folded_count` is a
   * counter and no table names the 88 events behind it, so the line says how
   * many there were and does not pretend any of them can be opened. That gap
   * is filed for the scraper.
   */
  if (shape === "entity_link_reference") {
    // The number IS the story on this shape: a name sighted 88 times that the
    // pipeline has declined to place 88 times is a different problem from one
    // seen once, and nothing else on the page says so.
    // "Asked again", in the app's own existing vocabulary — the queue list's
    // column for this very number. NOT "sighted N times": `folded_count`
    // counts the REPEATS (the list renders `×0` for an item seen once), so a
    // total would be `folds + 1`, and that +1 is an inference this line does
    // not need to make in order to say the useful thing.
    return folds === 0
      ? "Seen once, not placed."
      : `Asked again ${counted(folds, "time")} — still not placed.`;
  }
  if (evidenceIds === null) return counted(folds, "fold");
  if (evidenceIds === 0) {
    return `${counted(folds, "fold")}, carrying no evidence id.`;
  }
  const both = `${counted(folds, "fold")} over ${counted(
    evidenceIds,
    "evidence id",
  )}`;
  return folds === evidenceIds ? both : `${both} — the counts disagree.`;
}

export function ItemHeader({
  item,
  kind,
  shape,
  links,
  evidenceIds,
}: {
  item: ReviewItemRow;
  kind: Kind;
  shape: Shape;
  /** Where this investigation continues (LOOK_AND_FEEL bar 10). */
  links: readonly ItemLink[];
  /**
   * How many DISTINCT evidence ids this item carries — the population the
   * evidence block below lists, each one resolved to a row or named as
   * unresolved — or `null` when that read did not happen at all
   * (`ItemEvidence.ids.distinct`, `src/lib/db/review-item.ts`).
   */
  evidenceIds: number | null;
}) {
  const opened = relativeAge(item.opened_at);
  const lastEvidence = relativeAge(item.last_evidence_at);

  return (
    <div data-item={item.review_item_id} className="flex flex-col gap-2">
      <p className="type-body text-ink">{item.summary}</p>

      <div className="flex flex-wrap items-center gap-2">
        <span data-severity={item.severity}>
          <Badge tone={item.severity}>{item.severity}</Badge>
        </span>
        <span data-kind={kind}>
          <Badge>{kind}</Badge>
        </span>
        <span data-shape={shape}>
          <Badge>{shape}</Badge>
        </span>
        <span data-queue={item.queue}>
          <Badge>{item.queue}</Badge>
        </span>
        <span data-status={item.status}>
          <Badge>{item.status}</Badge>
        </span>
      </div>

      <p className="type-data flex flex-wrap items-baseline gap-3 text-ink-secondary">
        <span title={opened.title}>opened {opened.text}</span>
        <span title={lastEvidence.title}>last evidence {lastEvidence.text}</span>
        <span data-folds={item.folded_count}>
          asked again ×{count(item.folded_count)}
        </span>
      </p>

      {/* What that figure counts, and what the other one does. The evidence-id
          count is published as a hook of its own, so the relation is graded
          against the block below rather than against these words. */}
      <p
        data-fold-scope
        data-fold-evidence-ids={evidenceIds ?? undefined}
        className="type-body text-ink-secondary"
      >
        {foldScope(item.folded_count, evidenceIds, shape)}
      </p>

      {links.length === 0 ? null : (
        <p className="type-body flex flex-wrap items-baseline gap-3">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-out={link.href}
              data-external={link.external === true ? "true" : undefined}
              target={link.external === true ? "_blank" : undefined}
              rel={link.external === true ? "noreferrer noopener" : undefined}
              className={IN_PAGE_LINK}
            >
              {link.label}
              {link.value === undefined ? null : (
                <span className="type-data"> {link.value}</span>
              )}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
