import { Badge } from "@/components/ui";
import { count, relativeAge } from "@/lib/format";
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
 * **It re-derives nothing.** `kind` and `shape` arrive as props because
 * `shapeOf`/`kindOfItem` in `src/lib/review/shapes.ts` are the only spellings
 * of that derivation in the app (spec §6: "the kind belongs to the shape and
 * is derived in code — no column carries it").
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 * Every control in this markup is a link — nothing here settles anything.
 */

/** One way out of this item: where it goes, and what it opens. */
export interface ItemLink {
  /** What the link opens, in the app's voice. */
  label: string;
  href: string;
  /** The machine value the link is narrowed by, shown verbatim beside it. */
  value?: string;
}

export function ItemHeader({
  item,
  kind,
  shape,
  links,
}: {
  item: ReviewItemRow;
  kind: Kind;
  shape: Shape;
  /** Where this investigation continues (LOOK_AND_FEEL bar 10). */
  links: readonly ItemLink[];
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

      {links.length === 0 ? null : (
        <p className="type-body flex flex-wrap items-baseline gap-3">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-out={link.href}
              className="text-accent underline"
            >
              {link.label}
              {link.value === undefined ? null : (
                <span className="type-data text-ink-secondary"> {link.value}</span>
              )}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
