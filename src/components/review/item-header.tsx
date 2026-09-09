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
function foldScope(folds: number, evidenceIds: number | null): string {
  const fold = "Each fold is a re-ask of this item, not a record";
  if (evidenceIds === null) return `${fold}.`;
  if (evidenceIds === 0) {
    return `${fold}: ${counted(folds, "fold")}, and it carries no evidence id.`;
  }
  const both = `${fold}: ${counted(folds, "fold")} over the ${counted(
    evidenceIds,
    "evidence id",
  )} it carries, listed below`;
  return folds === evidenceIds ? `${both} — the two counts agree.` : `${both}.`;
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
        {foldScope(item.folded_count, evidenceIds)}
      </p>

      {links.length === 0 ? null : (
        <p className="type-body flex flex-wrap items-baseline gap-3">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-out={link.href}
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
