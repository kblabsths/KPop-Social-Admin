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
): string | null {
  /*
   * NOTHING on a reference item (Ben, 2026-10-23: "delete the 'Asked again 11
   * times -- still not placed.' text; it is not valuable").
   *
   * He is right, and the count is not lost: the meta line below already
   * publishes `asked again ×11`, with the hook a test reads it by. This line
   * was a second rendering of the same number wrapped in a judgment ("still
   * not placed") — which is the app editorialising about its own backlog.
   *
   * On a `data_conflict` item it still earns its place, for the reason
   * admin-window/BUG-0124 put it here: there `evidence` IS the observations
   * behind the values, so folds and evidence ids count the same events from
   * two directions and a disagreement between them is a real finding.
   */
  if (shape === "entity_link_reference") return null;
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
  shape,
  links,
  evidenceIds,
}: {
  item: ReviewItemRow;
  /*
   * `kind` is gone from this component. It was here only to render the kind
   * badge, which moved to `ItemTags` at the bottom of the page on 2026-10-23 —
   * and a prop kept "in case" is a prop the next reader has to account for.
   * `shape` stays, because the fold line still branches on it.
   */
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
  const scope = foldScope(item.folded_count, evidenceIds, shape);
  const lastEvidence = relativeAge(item.last_evidence_at);

  return (
    <div data-item={item.review_item_id} className="flex flex-col gap-2">
      <p className="type-body text-ink">{item.summary}</p>

      {/* `type-body`: "opened 9d ago", "last evidence 7d ago", "asked again
          ×11" are the app's own words about its own rows. The AGES are
          relative-time prose, not machine values — an absolute instant IS a
          machine value and travels in the `title` (Voice bar 6), which is
          where the mono rule actually applies. Corrected 2026-10-23 at Ben's
          word, with the textarea above. */}
      <p className="type-body flex flex-wrap items-baseline gap-3 text-ink-secondary">
        <span title={opened.title}>opened {opened.text}</span>
        <span title={lastEvidence.title}>last evidence {lastEvidence.text}</span>
        <span data-folds={item.folded_count}>
          asked again ×{count(item.folded_count)}
        </span>
      </p>

      {/* What that figure counts, and what the other one does. The evidence-id
          count is published as a hook of its own, so the relation is graded
          against the block below rather than against these words. */}
      {scope === null ? null : (
        <p
          data-fold-scope
          data-fold-evidence-ids={evidenceIds ?? undefined}
          className="type-body text-ink-secondary"
        >
          {scope}
        </p>
      )}

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

/**
 * THE CLASSIFICATION TAGS — severity, kind, shape, queue, status.
 *
 * They were the second thing on the page, under the summary. Ben, 2026-10-23:
 * *"Let's move the tags, e.g. 'high' or 'decision' to the bottom of the page.
 * This might be useful sometimes but as a reviewer I generally do not care."*
 *
 * He is right about the ranking. Four of the five are the app's own filing —
 * which queue, which shape, which kind, which status — and a reviewer opening
 * an item to answer a question does not need to be told how it was filed
 * before being told what it asks. The fifth, severity, is the registry's word
 * and the only one that bears on urgency; it travels with the rest because
 * splitting one badge out to sit alone above the fold would give it more
 * weight than a page of them had.
 *
 * Its own export rather than a flag on the header, so the PAGE decides where
 * they sit. A component that renders its own "at the bottom" cannot be moved
 * by whoever composes the route, and the hooks every oracle reads them by
 * (`data-severity`, `data-kind`, `data-shape`, `data-queue`, `data-status`)
 * are unchanged wherever they land.
 */
export function ItemTags({
  item,
  kind,
  shape,
}: {
  item: ReviewItemRow;
  kind: Kind;
  shape: Shape;
}) {
  return (
    <div data-item-tags="" className="flex flex-wrap items-center gap-2">
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
  );
}
