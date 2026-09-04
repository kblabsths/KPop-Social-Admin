import type { ReactNode } from "react";
import { FilterBar, QueueList } from "@/components/queues";
import {
  Distribution,
  GaugeCard,
  TrendTable,
  spreadRows,
  type EmptyWords,
} from "@/components/gauges";
import { Empty, ErrorLine, NotProvisioned, Page, Section } from "@/components/ui";
import { listReviewItems } from "@/lib/db/review-items";
import type { DbResult } from "@/lib/db/result";
import { absoluteUtc, count, counted, duration, relativeAge } from "@/lib/format";
import {
  readQueueHealth,
  type QueueHealth,
  type QueueStats,
} from "@/lib/gauges/queue-health";
import {
  filterBar,
  filterFrom,
  isNarrowed,
  type SearchParams,
} from "@/lib/review/queue-filters";
import {
  KINDS,
  oldestOpenedAt,
  selectItems,
  type Kind,
  type ReviewItemFilter,
  type ReviewItemRow,
} from "@/lib/review/shapes";

/**
 * Queues — `review_items` as TWO QUEUES OF EQUAL STANDING (campaign
 * admin-window/TASK-0010).
 *
 * Authority: spec §4 ("the decision queue and the signal queue, each open
 * first, severity then age, filterable by shape; settled items browsable") and
 * §6 (the kind belongs to the shape and is derived in code), LOOK_AND_FEEL
 * quality bars 1, 2, 6 and 11 and "Key screens — Queues".
 *
 * The two lists are ONE COMPONENT rendered once per kind, side by side under
 * one container: same width, same type scale, same level of the page, neither
 * nested in the other and neither styled as the primary inbox (bar 2). They
 * render in both directions of every state, including when a filter has
 * emptied one of them — a page that hid the other queue when the URL named a
 * kind would break equal standing exactly when an operator arrived from the
 * Dashboard's "open signals" link.
 *
 * **Nothing here classifies, orders or filters anything itself.** `shapeOf`,
 * `selectItems` and `queueOrder` in `src/lib/review/shapes.ts` are the one
 * predicate and the one display order in the app (acceptance test 4 is only
 * true because there is one of each), and `listReviewItems` applies them to a
 * COMPLETE read (ARCHITECTURE.md §4.3): an `ok` array is the WHOLE matching
 * set, so there is no paging UI, no "showing N of M" line and no local
 * `.limit`/`.slice`/re-sort anywhere below. A read that could not answer
 * completely arrives as the error state and is rendered as one.
 *
 * The queue-health gauge on this page is the OTHER kind of read — a bounded,
 * ordered WINDOW (§4.3 kind 2, spec §5) — and its section says so rather than
 * presenting a window aggregate as a total.
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, and every child is a pure sync
 * component with plain props, which is what lets the offline suite render
 * `renderToStaticMarkup(await QueuesPage(props))` with no jsdom and no
 * database, and the live suite compare its counts with counts the test issues
 * itself.
 *
 * **Nothing settles anything in M1** (spec §7 is the verdict slice): every
 * control in this markup is a link, there is no verdict action and no
 * scaffolding toward one. `status` is a search parameter, never a path
 * segment, so browsing settled items is a state of this one route.
 */

/**
 * Both reads happen per request against the live database, so the route
 * renders per request rather than being prerendered at build time
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
 * "Route segment config"). Reading `searchParams` already opts this page in,
 * but the prop is optional — the shell's route test renders every page with
 * no props at all — and a page that prerendered at build, where the app has no
 * credential, would ship a FROZEN error state that never re-reads. Cache
 * Components is not enabled in `next.config.ts`, so this option is live on
 * Next 16.2.2.
 */
export const dynamic = "force-dynamic";

/** This route's own path — the base every filter link is built on. */
const QUEUES_PATH = "/queues";

/** What creates the ecosystem tables this page reads. */
const ARRIVES_WITH = "the scraper repo's migrations";

/** The order both lists are in, stated on screen (LOOK_AND_FEEL bar 6). */
const SORT_STATEMENT =
  "Open first, severity then age — settled items last, still browsable.";

/** The h2 above each queue. Both are sections of the page, at one level. */
const QUEUE_TITLE: Record<Kind, string> = {
  decision: "Decision queue",
  signal: "Signal queue",
};

/** The `micro` label each queue's open figure stands under. */
const OPEN_LABEL: Record<Kind, string> = {
  decision: "Open decisions",
  signal: "Open signals",
};

/** What an empty queue holds and what fills it — never a bare "No data". */
const NOTHING_HERE: Record<Kind, EmptyWords> = {
  decision: {
    holds: "decisions waiting",
    filledBy:
      "The resolver files one when sources disagree about a fact, or when a record cannot link.",
  },
  signal: {
    holds: "signals",
    filledBy:
      "The resolver files one when a source crosses its stuck-record threshold.",
  },
};

/** The emptiness that has a REASON: the filters, not the database. */
const NOTHING_MATCHED: EmptyWords = {
  holds: "items matching these filters",
  filledBy: "Widen a filter above; the 'all' chip on any row shows everything again.",
};

/** Where a row opens (its detail view is admin-window/TASK-0011). */
function itemHref(item: ReviewItemRow): string {
  return `${QUEUES_PATH}/${encodeURIComponent(item.review_item_id)}`;
}

/**
 * The one sub-line under a queue's open figure: the registry's two severity
 * words with their counts, and the oldest waiting item's age.
 *
 * Verbatim, and no score beside them — the ranking formula is parked (spec
 * §10, VISION non-goal). With nothing open there is no severity and no age,
 * and the line says so rather than showing a dash pair that reads as missing
 * data.
 */
function OpenDetail({
  items,
  narrowed,
}: {
  items: readonly ReviewItemRow[];
  /**
   * A filter is narrowing the page, so the figure above counts the RENDERED
   * set and not the queue. `?status=settled` renders a real zero here, and a
   * zero that did not name its scope would read as "nothing is open" about a
   * database that holds plenty.
   */
  narrowed: boolean;
}) {
  const open = selectItems([...items], { status: "open" });
  const scope = narrowed ? " in this filtered view" : "";
  if (open.length === 0) return <span>{`nothing open${scope}`}</span>;
  // The one definition of "oldest" this app has — the same instant comparison
  // `queueOrder` sorts by, rather than a position in the rendered list, which
  // is severity-major and so does not end on the longest wait.
  const age = relativeAge(oldestOpenedAt(open));
  const highs = open.filter((item) => item.severity === "high").length;
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span>
        {count(highs)} high, {count(open.length - highs)} low{scope}
      </span>
      <span title={age.title}>oldest {age.text}</span>
    </span>
  );
}

/** One queue block's four states, from one read, rendered once per kind. */
function Queue({
  kind,
  result,
  filter,
}: {
  kind: Kind;
  result: DbResult<ReviewItemRow[]>;
  filter: ReviewItemFilter;
}): ReactNode {
  const shared = {
    kind,
    title: QUEUE_TITLE[kind],
    openLabel: OPEN_LABEL[kind],
    sort: SORT_STATEMENT,
    hrefFor: itemHref,
  };

  // A read that could not count passes NO figure: a zero for a table that is
  // not there, or for a read that refused, would be a number the app never
  // counted (LOOK_AND_FEEL state 3, quality bar 4).
  if (result.kind === "not_provisioned") {
    return (
      <QueueList
        {...shared}
        state="not_provisioned"
        items={[]}
        card={
          <NotProvisioned missing={result.missing} arrivesWith={ARRIVES_WITH} />
        }
      />
    );
  }
  if (result.kind === "error") {
    return (
      <QueueList
        {...shared}
        state="error"
        items={[]}
        line={
          <ErrorLine
            reading={result.reading}
            failed={result.message}
            retry="Reload to try the read again."
          />
        }
      />
    );
  }

  // The rows this queue holds: the kind's share of the set the read already
  // narrowed and ordered. `selectItems` is the app's one predicate — a
  // hand-written `filter(i => …)` here would be a second one (acceptance
  // test 4), and the order is `queueOrder`'s, untouched.
  const items = selectItems(result.data, { kind });
  const narrowed = isNarrowed(filter);
  // The read succeeded either way, so it produced a figure either way. An
  // empty queue differs from a full one ONLY in the rows region, where its
  // card says what the queue holds and what fills it: the counted zero keeps
  // the position the count occupies when there are rows, because a figure that
  // disappears at zero cannot be scanned in the same place every morning
  // (admin-window/BUG-0027; LOOK_AND_FEEL bar 1 and "counts sit in fixed
  // positions"). The `Empty` card is untouched and stays where rows go.
  const words = narrowed ? NOTHING_MATCHED : NOTHING_HERE[kind];
  return (
    <QueueList
      {...shared}
      state={items.length === 0 ? "empty" : "ok"}
      items={items}
      open={selectItems(items, { status: "open" }).length}
      // The same sub-line rule in both: with nothing open it says so, and
      // names the filtered scope when a filter is what emptied the queue, so
      // a scoped zero never reads as a whole-queue zero.
      openDetail={<OpenDetail items={items} narrowed={narrowed} />}
      card={
        items.length === 0 ? (
          <Empty holds={words.holds} filledBy={words.filledBy} />
        ) : undefined
      }
    />
  );
}

/** One queue's slice of the queue-health gauge (spec §5). */
function QueueGauge({
  stats,
  health,
}: {
  stats: QueueStats;
  health: QueueHealth;
}) {
  const { window } = health;
  const oldest = relativeAge(stats.oldestOpenedAt);
  return (
    <div data-gauge-queue={stats.queue} className="flex flex-col gap-2">
      <p className="type-data text-ink">{stats.queue}</p>
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label={`${stats.queue} open`}
          value={stats.open}
          floor={window.truncated}
          sub={
            stats.open === 0 ? (
              "nothing open in this window"
            ) : (
              <span className="flex flex-wrap items-baseline gap-2">
                <span>
                  {count(stats.openBySeverity.high)} high,{" "}
                  {count(stats.openBySeverity.low)} low
                </span>
                <span title={oldest.title}>oldest {oldest.text}</span>
              </span>
            )
          }
        />
        <GaugeCard
          label={`${stats.queue} folded`}
          value={stats.folds.foldedItems}
          floor={window.truncated}
          sub={`of ${counted(stats.folds.items, "item")} read here, ${counted(
            stats.folds.folds,
            "fold",
          )} in all`}
        />
      </div>
      <Distribution
        label={`${stats.queue} open age`}
        dimension="percentile"
        measure="age"
        format={duration}
        rows={spreadRows(stats.openAge)}
        empty={{
          holds: "open items to age in this window",
          filledBy: "An item opens and stays open, and its age joins the spread.",
        }}
        state={
          stats.openAge.count === 0
            ? {
                kind: "empty",
                holds: "open items in this window",
                filledBy:
                  "An item opens in this queue, and its wait is measured here.",
              }
            : undefined
        }
      />
      <TrendTable<(typeof stats.weeks)[number]>
        label={`${stats.queue} by week`}
        period="week (UTC)"
        rows={stats.weeks}
        rowKey={(week) => week.weekStart}
        rowLabel={(week) => week.weekStart}
        measures={[
          { key: "opened", label: "opened", value: (week) => week.opened },
          { key: "settled", label: "settled", value: (week) => week.settled },
        ]}
        empty={{
          holds: "weeks of this queue in the window",
          filledBy: "The resolver opens an item, and the week it opened in appears here.",
        }}
      />
    </div>
  );
}

export default async function QueuesPage({
  searchParams,
}: {
  /**
   * Next 16 hands `searchParams` over as a promise
   * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
   * Optional, so the page also renders standing alone with no props, the way
   * the shell's route test calls every page.
   */
  searchParams?: Promise<SearchParams>;
} = {}) {
  const filter = filterFrom((await searchParams) ?? {});
  // One complete read for both queues, and the gauge's own bounded window.
  // Reported separately: with the gauge's window unreadable the lists still
  // render, and each surface names the read that refused.
  const [items, health] = await Promise.all([
    listReviewItems(filter),
    readQueueHealth(),
  ]);

  return (
    <Page title="Queues">
      <FilterBar facets={filterBar(QUEUES_PATH, filter)} />

      <div className="flex flex-col gap-4">
        {KINDS.map((kind) => (
          <Queue key={kind} kind={kind} result={items} filter={filter} />
        ))}
      </div>

      <Section title="Queue health">
        {health.kind === "not_provisioned" ? (
          <NotProvisioned missing={health.missing} arrivesWith={ARRIVES_WITH} />
        ) : health.kind === "error" ? (
          <ErrorLine
            reading={health.reading}
            failed={health.message}
            retry="Reload to try the read again."
          />
        ) : (
          <>
            <p className="type-body text-ink-secondary">
              Items opened since {absoluteUtc(health.data.window.since)}, read to{" "}
              {absoluteUtc(health.data.window.until)} — a window of at most{" "}
              {count(health.data.window.limit)} rows, not the whole table.
              {health.data.window.truncated
                ? " The window filled its cap, so every count here is a floor."
                : ""}
            </p>
            {health.data.queues.map((stats) => (
              <QueueGauge key={stats.queue} stats={stats} health={health.data} />
            ))}
            <p className="type-body text-ink-secondary">
              Settles per week are not measurable yet: no column records when an
              item was closed, so those cells are dashes and never zeros.
            </p>
          </>
        )}
      </Section>
    </Page>
  );
}
