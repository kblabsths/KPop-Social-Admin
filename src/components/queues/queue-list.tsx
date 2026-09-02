import type { ReactNode } from "react";
import { Badge, type Column, DataTable, Section, StatCard } from "@/components/ui";
import { count, relativeAge } from "@/lib/format";
import { shapeOf, type Kind, type ReviewItemRow } from "@/lib/review/shapes";

/**
 * The four states one queue block can be in (LOOK_AND_FEEL, Emptiness): the
 * three `DbResult` kinds plus `empty` — a read that succeeded and counted
 * nothing. They never share a rendering, and the block says which one it is in
 * (`data-state`, the hook the Cycles page's runs surface already carries).
 */
export type QueueState = "ok" | "empty" | "error" | "not_provisioned";

/**
 * One of the two queues — campaign admin-window/TASK-0010.
 *
 * The Queues page renders this component ONCE PER KIND and nothing else: the
 * decision queue and the signal queue are the same component with the same
 * props, so they cannot drift into different widths, type scales or levels of
 * the page, and neither can end up nested in or styled as the primary inbox
 * (LOOK_AND_FEEL quality bar 2; spec §4 rationale — "a signal is the machine
 * breaking, a decision is a question about one datum"). Equal standing is a
 * structural property here, not a styling promise.
 *
 * A row reads as ONE SENTENCE (LOOK_AND_FEEL, Key screens — Queues): what
 * happened, how old, how many times folded. Severity is the registry's own
 * word, verbatim, with no score and no computed rank beside it (bar 6), and
 * the shape is the machine's own identifier, verbatim.
 *
 * It re-derives NOTHING: the rows arrive already narrowed and already ordered
 * by `queueOrder` (`src/lib/review/shapes.ts`, the one display-order
 * authority), and this component neither sorts, slices nor pages them. Its
 * table has no sortable header for the same reason — the order is the
 * contract's, stated on screen, not the operator's to change in M1.
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 * Nothing here settles anything: every control in this markup is a link.
 *
 * The block has two regions and they answer different questions
 * (admin-window/BUG-0027): the FIGURE region — the labelled open count, in one
 * fixed position whatever the state — and the ROWS region below it
 * (`data-rows`), which holds the table, the `Empty` card or the
 * `NotProvisioned` card. A counted zero is a figure and holds its position;
 * only a state that COUNTED NOTHING (a missing table, a refused read) leaves
 * the figure region empty, because a zero there would be a lie about a table
 * that is not present (LOOK_AND_FEEL state 3). Which of the four states the
 * block is in is on the wrapper as `data-state`, so a reader — an operator or
 * a live test — knows which state it is reading before it reads a number,
 * rather than inferring it from "no rows rendered".
 */
export function QueueList({
  kind,
  state,
  title,
  openLabel,
  open,
  openDetail,
  sort,
  items,
  hrefFor,
  card,
  line,
}: {
  /** Which queue this is. Rendered as the block's own hook, `data-queue`. */
  kind: Kind;
  /**
   * Which of the four states this block is in, verbatim on the wrapper as
   * `data-state`. `ok` and `empty` are both a read that COUNTED — `empty` is
   * a real zero — while `error` and `not_provisioned` counted nothing at all.
   */
  state: QueueState;
  /** The h2 above the list — the same type scale for both queues. */
  title: string;
  /** The `micro` label the open figure stands under. */
  openLabel: string;
  /**
   * Open items in this queue. Omitted when no read produced a number — a
   * missing table or a failed read is never rendered as a zero
   * (LOOK_AND_FEEL state 3). A read that came back EMPTY did produce one, and
   * passes `0`: the figure holds its position rather than vanishing when the
   * queue goes quiet (admin-window/BUG-0027).
   */
  open?: number;
  /** At most one `data` line under that figure: severity split and oldest age. */
  openDetail?: ReactNode;
  /** The order the list is in, stated on screen (quality bar 6). */
  sort: string;
  /** The rows, already filtered and already in `queueOrder`. */
  items: readonly ReviewItemRow[];
  /** Where a row opens — the item's own detail URL. */
  hrefFor: (item: ReviewItemRow) => string;
  /**
   * A CARD state — the page's own `Empty` or `NotProvisioned` — rendered in
   * the ROWS region in place of the table, because those two draw their own
   * border and a card inside the table's border would draw two. It replaces
   * the rows; the figure above them, when there is one, stays put.
   */
  card?: ReactNode;
  /**
   * A LINE state — the page's own `ErrorLine` — rendered inside the table so
   * the header stays put and the operator still sees what the list is of.
   */
  line?: ReactNode;
}) {
  const columns: Column<ReviewItemRow>[] = [
    {
      key: "severity",
      label: "severity",
      cell: (item) => (
        <span data-severity={item.severity}>
          <Badge tone={item.severity}>{item.severity}</Badge>
        </span>
      ),
    },
    {
      key: "summary",
      label: "what happened",
      cell: (item) => (
        <a
          href={hrefFor(item)}
          data-item={item.review_item_id}
          className="transition-colors hover:text-accent"
        >
          {item.summary}
        </a>
      ),
    },
    {
      key: "shape",
      label: "shape",
      cell: (item) => {
        const shape = shapeOf(item);
        return (
          <span data-shape={shape}>
            <Badge>{shape}</Badge>
          </span>
        );
      },
    },
    {
      key: "status",
      label: "status",
      cell: (item) => <span data-status={item.status}>{item.status}</span>,
    },
    {
      key: "opened",
      label: "opened",
      cell: (item) => {
        // Relative, with the absolute instant in the title (Voice bar 6).
        const age = relativeAge(item.opened_at);
        return <span title={age.title}>{age.text}</span>;
      },
    },
    {
      key: "folded",
      label: "asked again",
      align: "right",
      // `folded_count` is how many duplicates were folded into this item, so a
      // zero is a real answer — "asked once" — and not an absence. It renders
      // as a number rather than a dash for exactly that reason.
      cell: (item) => (
        <span data-folds={item.folded_count}>{`×${count(item.folded_count)}`}</span>
      ),
    },
  ];

  return (
    <div data-queue={kind} data-state={state} className="flex w-full flex-col gap-2">
      <Section title={title}>
        {/* The figure, in the one position it occupies in every state that
            counted something: above the rows region, never inside it. */}
        {open === undefined ? null : (
          <StatCard
            label={openLabel}
            value={open}
            sub={openDetail}
            tone={open > 0 ? "attention" : "default"}
          />
        )}
        <div data-rows={kind} className="flex flex-col gap-2">
          {card ?? (
            <>
              <p className="type-body text-ink-secondary">{sort}</p>
              <DataTable<ReviewItemRow>
                columns={columns}
                rows={line === undefined ? [...items] : []}
                rowKey={(item) => item.review_item_id}
                label={title}
                placeholder={line}
              />
            </>
          )}
        </div>
      </Section>
    </div>
  );
}
