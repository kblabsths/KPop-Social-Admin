import type { ReactNode } from "react";
import {
  FilterBar,
  QueueList,
  QueueTabs,
  VerdictLog,
  type VerdictLine,
} from "@/components/queues";
import { NOTHING_IN_QUEUE } from "@/components/queues/surfaces";
import {
  Distribution,
  GaugeCard,
  TrendTable,
  spreadRows,
  type EmptyWords,
} from "@/components/gauges";
import { Empty, Page, Section, StateOf, WindowLine, oldestIn } from "@/components/ui";
import { listReviewItems } from "@/lib/db/review-items";
import type { DbResult } from "@/lib/db/result";
import {
  VERDICTS_OBJECT,
  readVerdictLog,
  type VerdictLogWindow,
} from "@/lib/db/verdict";
import { count, counted, duration, relativeAge } from "@/lib/format";
import {
  readQueueHealth,
  type QueueHealth,
  type QueueStats,
} from "@/lib/gauges/queue-health";
import { recordHref } from "@/lib/records/routes";
import {
  filterBar,
  filterFrom,
  isNarrowed,
  tabFrom,
  tabLinks,
  type QueuesTab,
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

/** The order both lists are in, stated on screen (LOOK_AND_FEEL bar 6). */
const SORT_STATEMENT =
  "Open first, severity then age — settled items last, still browsable.";

/**
 * The name the queue-health gauge's WINDOW answers to — `data-window`, the
 * hook a live oracle reads a window back by, as `/cycles` and `/sources`
 * publish theirs.
 *
 * This page published NONE: its window line was a hand-rolled `<p>` carrying
 * the sentence and no attributes at all, so the one surface the window rule
 * could not be graded on was this one (admin-window/DEBT-0006). Named for the
 * gauge, the way `cycle_health` is.
 */
const HEALTH_WINDOW = "queue_health";

/**
 * The name the VERDICT LOG's window answers to — `data-window`, the hook the
 * absence sweep and the live oracle read the window back by.
 *
 * Named for the object the read ran over, the way `cycle_health` is named for
 * its gauge: there is one window on this tab and it is `verdicts`.
 */
const VERDICT_LOG_WINDOW = "verdict_log";

/**
 * The names this page's two graded surfaces answer to — `data-surface`, unique
 * within the page (ARCHITECTURE.md §10, common violation 8).
 *
 * `verdict_log` is the log itself; `verdict_provenance` is the sub-surface
 * carrying the observation leg's own refusal, which is not the log's to answer
 * for — a registry the app could not read costs the log a LINK, never a
 * verdict, so an oracle grading the log excludes it exactly as
 * `queues.live.test.ts` excludes the gauge's per-queue slices.
 */
const VERDICT_SURFACE = "verdict_log";
const VERDICT_PROVENANCE_SURFACE = "verdict_provenance";

/** The h2 above the log, and the accessible name of its table. */
const VERDICT_TITLE = "Verdict log";

/** The lede its window line opens with — this page's words about its subject. */
const VERDICT_LEDE = "Every admin data action, newest first";

/** What an empty verdict log holds and what fills it — never a bare "No data". */
const NO_VERDICTS: EmptyWords = {
  holds: "verdict rows",
  filledBy:
    "An admin settles a review item or overrides a value, and the settlement lands here as one row.",
};

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

/*
 * What an empty queue holds and what fills it lives in
 * `components/queues/surfaces.ts` now, because the Dashboard's zero attention
 * card says the same sentence about what fills a queue and may not keep a
 * second copy of it (campaign admin-window/BUG-0125). This page's use of it is
 * unchanged: `NOTHING_IN_QUEUE[kind]` is the old `NOTHING_HERE[kind]`.
 */

/** The emptiness that has a REASON: the filters, not the database. */
const NOTHING_MATCHED: EmptyWords = {
  holds: "items matching these filters",
  filledBy: "Widen a filter above; the 'all' chip on any row shows everything again.",
};

/**
 * Where a review item opens, from its id alone — the one spelling of that URL
 * on this page, so a queue row and a verdict row cannot come to disagree about
 * where the same item lives.
 */
function itemPath(reviewItemId: string): string {
  return `${QUEUES_PATH}/${encodeURIComponent(reviewItemId)}`;
}

/** Where a row opens (its detail view is admin-window/TASK-0011). */
function itemHref(item: ReviewItemRow): string {
  return itemPath(item.review_item_id);
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
   * A filter is narrowing THIS BLOCK, so the figure above counts the RENDERED
   * set and not the queue. `?status=settled` renders a real zero here, and a
   * zero that did not name its scope would read as "nothing is open" about a
   * database that holds plenty. Decided by `isNarrowed(filter, { kind })`, so
   * a facet that cannot remove a row from this block (its own `kind`) is not
   * counted and the zero stays unscoped (admin-window/BUG-0129).
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
        card={<StateOf result={result} />}
      />
    );
  }
  if (result.kind === "error") {
    return (
      <QueueList
        {...shared}
        state="error"
        items={[]}
        line={<StateOf result={result} />}
      />
    );
  }

  // The rows this queue holds: the kind's share of the set the read already
  // narrowed and ordered. `selectItems` is the app's one predicate — a
  // hand-written `filter(i => …)` here would be a second one (acceptance
  // test 4), and the order is `queueOrder`'s, untouched.
  const ownNarrowing: ReviewItemFilter = { kind };
  const items = selectItems(result.data, ownNarrowing);
  // Narrowed BY WHAT THIS BLOCK RENDERS, not by the URL: the same object the
  // selection above ran with is what the predicate discounts, so the two
  // cannot come to disagree about what this block already excludes. On
  // `/queues?kind=decision` — the Dashboard's own zero-decisions link — the
  // `kind` facet removes not one row from the decision block, so that block
  // reads exactly as it does unfiltered, while the signal block beside it
  // (which the same facet really did empty) still names its scope
  // (admin-window/BUG-0129).
  const narrowed = isNarrowed(filter, ownNarrowing);
  // The read succeeded either way, so it produced a figure either way. An
  // empty queue differs from a full one ONLY in the rows region, where its
  // card says what the queue holds and what fills it: the counted zero keeps
  // the position the count occupies when there are rows, because a figure that
  // disappears at zero cannot be scanned in the same place every morning
  // (admin-window/BUG-0027; LOOK_AND_FEEL bar 1 and "counts sit in fixed
  // positions"). The `Empty` card is untouched and stays where rows go.
  const words = narrowed ? NOTHING_MATCHED : NOTHING_IN_QUEUE[kind];
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

/**
 * One queue's slice of the queue-health gauge (spec §5).
 *
 * Every eyebrow here belongs to a QUEUE, and a queue name is a machine
 * identifier — so it is handed over as `{ identifier, words }` rather than
 * concatenated into the label string. Concatenation put it inside the `micro`
 * step, which is uppercase sans, and the same screen then showed
 * `DATA_CONFLICT OPEN` three pixels under the `data_conflict` subsection
 * heading below (LOOK_AND_FEEL Voice bar 5; admin-window/BUG-0049). The
 * primitive keeps the identifier verbatim in mono and gives only OUR words the
 * `micro` treatment (`ui/micro-label.tsx`).
 */
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
          label={{ identifier: stats.queue, words: "open" }}
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
          label={{ identifier: stats.queue, words: "folded" }}
          value={stats.folds.foldedItems}
          floor={window.truncated}
          sub={`of ${counted(stats.folds.items, "item")} read here, ${counted(
            stats.folds.folds,
            "fold",
          )} in all`}
        />
      </div>
      <Distribution
        label={{ identifier: stats.queue, words: "open age" }}
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
        label={{ identifier: stats.queue, words: "by week" }}
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

/**
 * The verdict log, as the tab renders it (spec F13,
 * `contracts/admin-observability.md` §7).
 *
 * One row per verdict, and the two structural nulls are rendered by the
 * component as this app's one dash, with one line above the table saying what
 * a dash means there (LESSONS 1, admin-window/BUG-0053).
 *
 * The observation's link is the RECORD surface of the fact it is about — the
 * one place a rendered observation already leads in this app
 * (`components/claims/claim-list.tsx`'s `record` column). There is no
 * observation-addressable URL, so an id the resolving leg could not place
 * renders verbatim rather than linking somewhere invented.
 */
function verdictLines(log: VerdictLogWindow): VerdictLine[] {
  return log.rows.map((row) => {
    const fact =
      row.observation_id === null ? undefined : log.facts.get(row.observation_id);
    return {
      verdictId: row.verdict_id,
      actor: row.actor,
      action: row.action,
      reviewItemId: row.review_item_id,
      itemHref: row.review_item_id === null ? null : itemPath(row.review_item_id),
      observationId: row.observation_id,
      observationHref:
        fact === undefined ? null : recordHref(fact.domain, fact.entity_id),
      note: row.note,
      createdAt: row.created_at,
    };
  });
}

/** The verdict tab's one section: the window line, the log, and its states. */
function VerdictSection({ log }: { log: DbResult<VerdictLogWindow> }): ReactNode {
  return (
    <Section title={VERDICT_TITLE} surface={VERDICT_SURFACE}>
      {/* The window line follows the READ, not the rows (ARCHITECTURE.md
          §4.3): it stands on an `ok` result — with rows or with none — and on
          no other state, so the absence of the line means "this read did not
          happen" here exactly as it does on every other surface. The rule is
          graded for every surface at once in
          `tests/offline/absence/pages.test.ts`. */}
      {log.kind === "ok" ? (
        <WindowLine
          gauge={VERDICT_LOG_WINDOW}
          window={{
            limit: log.data.limit,
            held: log.data.rows.length,
            truncated: log.data.truncated,
            over: VERDICTS_OBJECT,
            // Newest first, so the last row is the oldest verdict the read
            // came back with — the log's own floor when the window did not
            // fill (admin-window/BUG-0109).
            oldest: oldestIn(log.data.rows, (row) => row.created_at),
            // The verdict log read carries no filter at all — the tab decides
            // WHETHER this read happens, never which rows it may see — so the
            // floor below is the log's own (admin-window/BUG-0114).
            scope: null,
          }}
          shows={{ of: "newest", lede: VERDICT_LEDE, rows: "verdict rows" }}
        />
      ) : null}

      <VerdictLog
        label={VERDICT_TITLE}
        lines={log.kind === "ok" ? verdictLines(log.data) : []}
        card={
          log.kind === "not_provisioned" ? (
            // The graded normal case for the whole of M2: `verdicts` arrives
            // with the handoff migration and is on neither staging nor
            // production, so the tab draws the card naming it and states no
            // number at all (LOOK_AND_FEEL state 3).
            <StateOf result={log} />
          ) : log.kind === "ok" && log.data.rows.length === 0 ? (
            <Empty holds={NO_VERDICTS.holds} filledBy={NO_VERDICTS.filledBy} />
          ) : undefined
        }
        line={log.kind === "error" ? <StateOf result={log} /> : undefined}
      />

      {log.kind === "ok" && log.data.factsUnavailable !== null ? (
        // The observation leg alone refused: every verdict is here and only
        // the link to where its observation landed is missing, so the refusal
        // is reported as its OWN sub-surface, naming its own object
        // (admin-window/BUG-0021). It is excluded from the log's state for the
        // same reason the gauge's per-queue slices are excluded from the
        // gauge's: a leg that only labels is not the surface's to answer for.
        <div data-surface={VERDICT_PROVENANCE_SURFACE}>
          <StateOf result={log.data.factsUnavailable} />
        </div>
      ) : null}
    </Section>
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
  const params = (await searchParams) ?? {};
  const filter = filterFrom(params);
  const tab: QueuesTab = tabFrom(params);
  // The strip renders on both tabs and carries the filter across, so the queue
  // you were looking at is the queue you come back to.
  const tabs = <QueueTabs tabs={tabLinks(QUEUES_PATH, filter, tab)} />;

  // Each tab makes ITS OWN reads and no others. A read the rendered tab never
  // needs is a read that never happened, which is exactly what the absence of
  // a window line means on every surface of this app (ARCHITECTURE.md §4.3):
  // the verdict tab asks `review_items` nothing, and the queues tab asks
  // `verdicts` nothing.
  if (tab === "verdict_log") {
    return (
      <Page title="Queues">
        {tabs}
        <VerdictSection log={await readVerdictLog()} />
      </Page>
    );
  }

  // One complete read for both queues, and the gauge's own bounded window.
  // Reported separately: with the gauge's window unreadable the lists still
  // render, and each surface names the read that refused.
  const [items, health] = await Promise.all([
    listReviewItems(filter),
    readQueueHealth(),
  ]);

  return (
    <Page title="Queues">
      {tabs}
      <FilterBar facets={filterBar(QUEUES_PATH, filter)} />

      <div className="flex flex-col gap-4">
        {KINDS.map((kind) => (
          <Queue key={kind} kind={kind} result={items} filter={filter} />
        ))}
      </div>

      <Section title="Queue health">
        {health.kind !== "ok" ? (
          <StateOf result={health} />
        ) : (
          <>
            {/* The window line follows the READ, not the rows (ARCHITECTURE.md
                §4.3): it stands on an `ok` result — with rows or with none —
                and on no other state, so the absence of the line means "this
                read did not happen" here exactly as it does on every other
                surface. It said that in prose and published no `data-window`
                hook at all until admin-window/DEBT-0006, which is why the rule
                graded in `tests/offline/absence/pages.test.ts` could not reach
                this page. */}
            <WindowLine
              gauge={HEALTH_WINDOW}
              window={health.data.window}
              measured="Items opened"
            />
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
