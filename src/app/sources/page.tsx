import type { ReactNode } from "react";
import {
  GaugeCard,
  TrendTable,
  type EmptyWords,
  type TrendMeasure,
} from "@/components/gauges";
import {
  Badge,
  Chip,
  DataTable,
  Empty,
  ErrorLine,
  NotProvisioned,
  Page,
  Section,
  type Column,
} from "@/components/ui";
import {
  listSources,
  selectSources,
  type SourceState,
  type SourcesFilter,
} from "@/lib/db/sources";
import type { DbUnavailable } from "@/lib/db/result";
import { absoluteUtc, count, isAbsent, relativeAge } from "@/lib/format";
import {
  readAwaitingRowTrend,
  type AwaitingRowPoint,
  type AwaitingRowSeries,
  type AwaitingRowTrend,
} from "@/lib/gauges/pending-claims";
import {
  readRejectionStampGauge,
  type RejectionWeek,
  type SettledValues,
  type SourceRejections,
} from "@/lib/gauges/settled-values";

/**
 * Sources — **the registry's state rows, and who keeps being wrong** (campaign
 * admin-window/TASK-0013).
 *
 * Authority: spec §4 ("the sources state rows: lifecycle, current tier,
 * checkpoint, last run, per-source gauge trends"), §5 (the pending-claims
 * per-source `awaiting_row` trend and the settled-values gauge),
 * `contracts/data-model.md` (source registry — config + state), LOOK_AND_FEEL
 * ("Sources … is the data-table rule applied; it carries no bespoke layout",
 * quality bars 1, 4, 10, 11).
 *
 * Three rules this page is built on, each of which it would be easy to break:
 *
 *  - **Config is not state.** The description, the domains fed, the usage, the
 *    dials and the legal status are scraper YAML, and this campaign reads no
 *    scraper file at runtime (spec §10). What renders below is the `sources`
 *    TABLE and nothing else — no invented config column, and no registry value
 *    hand-copied into this repo.
 *  - **Last run is matched by NAME.** `sources` has no last-run column and
 *    `runs.source` has no foreign key (ARCHITECTURE.md §6 trap 6, migration
 *    `20260829000001`). `src/lib/db/sources.ts` is the one place that match
 *    happens; a source with no run renders the dash, which means "has never
 *    run" and never "we could not read it".
 *  - **Tier is a badge, not a colour.** Only severity and health carry colour,
 *    so a page of sources is not a rainbow (LOOK_AND_FEEL, Chips and badges).
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, every child is a pure sync
 * component with plain props — which is what lets the offline suite render
 * `renderToStaticMarkup(await SourcesPage(props))` with no jsdom and no
 * database, and the live suite compare its rows with rows the test reads
 * itself.
 *
 * **Nothing settles anything in M1**: every control in this markup is a link.
 */

/**
 * Three reads happen per request against the live database, so the route
 * renders per request rather than being prerendered at build time
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
 * "Route segment config"). Reading `searchParams` already opts this page in,
 * but the prop is optional — the shell's route test renders every page with no
 * props at all — and a page prerendered at build, where the app has no
 * credential, would ship a FROZEN error state that never re-reads.
 */
export const dynamic = "force-dynamic";

/** This route's own path — the base every narrowing link is built on. */
const SOURCES_PATH = "/sources";

/**
 * The narrowing facet, spelled exactly as the column is.
 *
 * It is also the parameter the CLAIMS page already links a claim's source with
 * (`sourceHref` in `src/lib/claims/filters.ts`: `/sources?source_id=<id>`), so
 * that link narrows this page instead of dead-ending. One name for one thing —
 * the convention `queue-filters.ts` set and `claims/filters.ts` followed.
 */
const SOURCE_FACET = "source_id";

/** What creates the ecosystem objects this page reads. */
const ARRIVES_WITH = "the scraper repo's migrations";

/** One retry sentence, in the app's voice, for every failed read on this page. */
const RETRY = "Reload to try the read again.";

/** The chip that clears the narrowing. The app's own word, not a value. */
const ANY_LABEL = "all";

/** What an empty registry holds and what fills it — never a bare "No data". */
const NOTHING_REGISTERED: EmptyWords = {
  holds: "sources registered",
  filledBy:
    "A source appears once the scraper repo registers it and it reports a lifecycle and a tier.",
};

/** The emptiness that has a REASON: the narrowing, not the database. */
const NOTHING_MATCHED: EmptyWords = {
  holds: "sources matching this narrowing",
  filledBy: "Choose 'all' above to see every source the registry holds.",
};

/** The eyebrow each gauge's state card carries, so an absent gauge names its knob. */
const AWAITING_LABEL = "Awaiting-row claims";
const REJECTION_LABEL = "Re-rejected values";

/**
 * The name each of this page's surfaces answers to — `data-surface`, rendered
 * by `Section` and read by the live parity oracle
 * (`tests/live/sources.live.test.ts`), pinned offline by
 * `tests/offline/sources/page.test.ts`.
 *
 * A NAME, never a position. These three were `section:nth-of-type(n)` until
 * admin-window/DEBT-0002, which made the oracle hostage to this file's element
 * order and to any wrapper a later ticket adds — the failure that cost
 * `/cycles` four live tests when admin-window/BUG-0040 added a section and a
 * `<div>` and `:nth-of-type(1)` began matching two surfaces
 * (admin-window/BUG-0056). `stateOf` demands exactly one match, so a name that
 * does not move is the only addressing that survives a rearrangement.
 *
 * Each trend surface takes the name its window line already answers to
 * (`data-window="awaiting_row"`, `data-window="rejections"`), so the surface
 * and the figure inside it are called the same thing. The name is the
 * surface's identity, not its heading, and is unique within this page — this
 * page writes no `data-surface` of its own anywhere else.
 */
const REGISTRY_SURFACE = "registry";
const AWAITING_SURFACE = "awaiting_row";
const REJECTION_SURFACE = "rejections";

/* ── the URL, which is the whole of this page's state ────────────────────── */

/** A `searchParams` value, in every shape Next can hand one over. */
type ParamValue = string | string[] | undefined;

/** The `searchParams` object a page awaits. */
type SearchParams = Record<string, ParamValue>;

/**
 * The FIRST value the URL carries for a key. `?source_id=a&source_id=b` is
 * ambiguous state and the web platform already answers it —
 * `URLSearchParams.get()` returns the first — so a hand-edited URL lands on a
 * real, bookmarkable state rather than an error page.
 */
function firstValue(value: ParamValue): string | undefined {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value;
}

/**
 * The narrowing the URL asked for, against the ids the registry actually
 * holds. A value outside that set narrows NOTHING rather than emptying the
 * page: the URL can only select from what this page offers, so a typo shows
 * the whole registry instead of a blank that reads like an empty database
 * (the rule `claims/filters.ts` and `browse/views.ts` already apply).
 *
 * This is the third page to want a chip row over one facet
 * (`components/claims/filter-bar.tsx` says as much of itself); the shared,
 * structurally-typed bar is noted on this ticket's handoff rather than built
 * here, where it would be a fourth page's worth of churn.
 */
function filterFrom(params: SearchParams, offered: readonly string[]): SourcesFilter {
  const asked = firstValue(params[SOURCE_FACET]);
  const found = asked === undefined ? undefined : offered.find((id) => id === asked);
  return found === undefined ? {} : { source_id: found };
}

/** The URL showing exactly this narrowing. No narrowing is the bare path. */
function sourcesHref(filter: SourcesFilter): string {
  return filter.source_id === undefined
    ? SOURCES_PATH
    : `${SOURCES_PATH}?${SOURCE_FACET}=${encodeURIComponent(filter.source_id)}`;
}

/**
 * That source's review items — the Queues page narrowed to it.
 *
 * `review_items.source_id` is the column, and the parameter is spelled as the
 * column is. Queues does not offer this facet yet (its vocabulary is kind /
 * queue / shape / status), and an unrecognised parameter there narrows nothing
 * rather than erroring, so the link lands on the queues rather than anywhere
 * broken until that facet is added — noted on this ticket's handoff.
 */
function queueItemsHref(sourceId: string): string {
  return `/queues?source_id=${encodeURIComponent(sourceId)}`;
}

/**
 * That source's runs — Cycles & runs narrowed to it BY NAME, because that is
 * the only handle `runs` has (§6 trap 6). The parameter is the column,
 * `runs.source`.
 */
function runsHref(sourceName: string): string {
  return `/cycles?source=${encodeURIComponent(sourceName)}`;
}

/* ── the states every surface here can be in ─────────────────────────────── */

/**
 * The state a failed or absent read renders as. `reading` and `missing` come
 * from the result itself, so the line names the object the query named
 * (admin-window/BUG-0016, TASK-0030).
 */
function StateOf({
  result,
  eyebrow,
}: {
  result: DbUnavailable;
  /** Passed only where no `Section` heading already names the surface. */
  eyebrow?: string;
}): ReactNode {
  // The wrapper carries which read refused, in the object's own spelling — the
  // one thing that distinguishes state 3 from state 4 and from an empty
  // surface without reading the card's words back (the three never share a
  // rendering, LOOK_AND_FEEL, Emptiness).
  return result.kind === "not_provisioned" ? (
    <div data-not-provisioned={result.missing}>
      <NotProvisioned
        missing={result.missing}
        arrivesWith={ARRIVES_WITH}
        eyebrow={eyebrow}
      />
    </div>
  ) : (
    <div data-read-failed={result.reading}>
      <ErrorLine reading={result.reading} failed={result.message} retry={RETRY} />
    </div>
  );
}

/* ── the registry table ──────────────────────────────────────────────────── */

/** The narrowing chips: "all", then every source the registry holds. */
function SourceChips({
  sources,
  filter,
}: {
  sources: readonly SourceState[];
  filter: SourcesFilter;
}) {
  return (
    <div
      data-facet={SOURCE_FACET}
      role="group"
      aria-label={SOURCE_FACET}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="type-micro text-ink-secondary">{SOURCE_FACET}</span>
      <Chip
        label={ANY_LABEL}
        href={sourcesHref({})}
        active={filter.source_id === undefined}
      />
      {sources.map((source) => (
        <Chip
          key={source.source_id}
          // The database's own value, verbatim — the word the row shows.
          label={source.source}
          href={sourcesHref({ source_id: source.source_id })}
          active={filter.source_id === source.source_id}
        />
      ))}
    </div>
  );
}

/**
 * The state row, column by column. Nothing here is computed from anything: a
 * value the database holds renders verbatim in mono, and a null renders as the
 * table's own dash (`orDash` in `ui/data-table.tsx`) — never blank, never a
 * zero, never a word of ours standing in for one.
 */
function sourceColumns(filter: SourcesFilter): Column<SourceState>[] {
  return [
    {
      key: "source",
      label: "source",
      cell: (row) => (
        <a
          href={sourcesHref({
            // Clicking the source you are already narrowed to clears it.
            source_id: filter.source_id === row.source_id ? undefined : row.source_id,
          })}
          data-source={row.source_id}
          data-source-name={row.source}
          aria-current={filter.source_id === row.source_id ? "true" : undefined}
          className="transition-colors hover:text-accent"
        >
          {row.source}
        </a>
      ),
    },
    {
      key: "kind",
      label: "kind",
      // `registered` or `cited` — how the source arrived. A machine identifier,
      // rendered verbatim, and not a badge: badges here carry lifecycle and
      // tier alone.
      cell: (row) => <span data-source-kind={row.kind}>{row.kind}</span>,
    },
    {
      key: "lifecycle",
      label: "lifecycle",
      cell: (row) => (
        <span data-source-lifecycle={row.lifecycle}>
          <Badge>{row.lifecycle}</Badge>
        </span>
      ),
    },
    {
      key: "tier",
      label: "tier",
      cell: (row) => (
        <span data-source-tier={row.tier}>
          <Badge>{row.tier}</Badge>
        </span>
      ),
    },
    {
      key: "checkpoint",
      label: "checkpoint",
      // The adapter's opaque resume token, verbatim. A source that has never
      // committed one has no checkpoint, which is the dash.
      // `isAbsent` is the app's ONE definition of absence, so a checkpoint
      // that is null and one that is an empty string read the same
      // (admin-window/BUG-0004).
      cell: (row) =>
        isAbsent(row.checkpoint) ? null : (
          <span data-source-checkpoint={row.checkpoint}>{row.checkpoint}</span>
        ),
    },
    {
      key: "last_run",
      label: "last run",
      cell: (row) => {
        // No run at all: the dash. It says "this source has never run", and it
        // is reachable only because the read succeeded — a `runs` table that
        // could not be read replaces this whole table with its own state.
        if (row.lastRun === null) return null;
        const age = relativeAge(row.lastRun.started_at);
        return (
          <span
            data-source-last-run={row.lastRun.run_id}
            data-source-last-run-at={row.lastRun.started_at}
            title={age.title}
          >
            {age.text}
          </span>
        );
      },
    },
    {
      key: "outcome",
      label: "outcome",
      cell: (row) => {
        const run = row.lastRun;
        if (run === null) return null;
        // A run still in flight has neither end nor outcome (the row is
        // inserted at start), so it reads as the dash with the running state
        // beside it rather than as a fabricated outcome.
        if (run.outcome === null) {
          return run.ended_at === null ? (
            <span data-source-run-state="running">still running</span>
          ) : null;
        }
        return (
          <span data-source-outcome={run.outcome}>
            {run.outcome}
            {run.failure_class === null ? "" : ` · ${run.failure_class}`}
          </span>
        );
      },
    },
    {
      key: "note",
      label: "note",
      // Free text on the state row — the operator's own words about why a
      // source is paused, and the app does not paraphrase them.
      cell: (row) =>
        isAbsent(row.note) ? null : <span data-source-note="">{row.note}</span>,
    },
    {
      key: "links",
      label: "links",
      cell: (row) => (
        <span className="flex flex-wrap gap-2">
          <a
            href={queueItemsHref(row.source_id)}
            data-source-items={row.source_id}
            className="transition-colors hover:text-accent"
          >
            review items
          </a>
          <a
            href={runsHref(row.source)}
            data-source-runs={row.source}
            className="transition-colors hover:text-accent"
          >
            runs
          </a>
        </span>
      ),
    },
  ];
}

/* ── the two per-source trends (spec §4: they live beside the rows) ──────── */

/** The window line every gauge section carries — which window, and whether it filled. */
function WindowLine({
  gauge,
  window: info,
  measured,
}: {
  /** Which gauge's window this is, for the live suite to read it back. */
  gauge: string;
  window: AwaitingRowTrend["window"];
  /** What the window is over, in the app's voice: "Claims observed", … */
  measured: string;
}) {
  return (
    <p
      data-window={gauge}
      data-window-since={info.since}
      data-window-until={info.until}
      data-window-truncated={info.truncated ? "true" : "false"}
      className="type-body text-ink-secondary"
    >
      {measured} since {absoluteUtc(info.since)}, read to {absoluteUtc(info.until)}{" "}
      — a window of at most {count(info.limit)} rows, not the whole table.
      {info.truncated
        ? " The window filled its cap, so every count here is a floor."
        : ""}
    </p>
  );
}

/** The name a per-source row is known by: the registry's name, or the raw id. */
function sourceLabel(sourceId: string, name: string | null): ReactNode {
  return (
    <a
      href={sourcesHref({ source_id: sourceId })}
      data-trend-source={sourceId}
      className="transition-colors hover:text-accent"
    >
      {name ?? sourceId}
    </a>
  );
}

/**
 * The per-source `awaiting_row` trend (spec §5, gauge 3 of 6 — its trend half).
 *
 * **Drawn without its threshold line.** The per-source `resolver.stuck_pattern`
 * dial lives only in the scraper repo's registry YAML, and where Admin may
 * read it is an open question (ARCHITECTURE.md §12 `OPEN-DIAL`,
 * admin-window/TASK-0024); `stuckPatternThreshold` therefore answers `null` for
 * every source today, and a hand-copied number is not an answer. The column
 * below appears if and when that seam is filled — the page reads the dial the
 * gauge carries and substitutes no default of its own.
 */
function AwaitingRowTrendSection({
  trend,
  filter,
  nameOf,
}: {
  trend: AwaitingRowTrend;
  filter: SourcesFilter;
  nameOf: (sourceId: string) => string | null;
}) {
  const { window: info, series } = trend;
  const claims = series.reduce((total, one) => total + one.claims, 0);
  const dialled = series.filter((one) => one.threshold !== null);
  // Narrowed to one source, the trend is that source's DAYS — the shape the
  // word "trend" actually means. Unnarrowed it is one row per source, busiest
  // first, which is the comparison an operator makes across the fleet.
  //
  // Found BY ID, the way `RejectionSection` below does it. The read narrows at
  // the query, so today `series` holds that one source — but taking `series[0]`
  // would make this rendering depend on a narrowing applied twice upstream, and
  // the day a series arrives unfiltered it would silently label a stranger's
  // days as this source's (admin-window/BUG-0022).
  const narrowed =
    filter.source_id === undefined
      ? null
      : (series.find((one) => one.sourceId === filter.source_id) ?? null);

  const perSource: TrendMeasure<AwaitingRowSeries>[] = [
    { key: "claims", label: "claims", value: (one) => one.claims },
    {
      key: "days",
      label: "days with a claim",
      value: (one) => one.points.filter((point) => point.claims > 0).length,
    },
    ...(dialled.length === 0
      ? []
      : [
          {
            key: "threshold",
            label: "threshold",
            value: (one: AwaitingRowSeries) => one.threshold?.count ?? null,
          },
        ]),
  ];

  return (
    <>
      <WindowLine gauge="awaiting_row" window={info} measured="Claims observed" />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Awaiting-row claims in this window"
          value={claims}
          floor={info.truncated}
          sub={`${count(series.length)} sources holding one`}
        />
        <GaugeCard
          label="Sources with awaiting-row claims"
          value={series.length}
          sub="A claim waits here when its record has no canonical row yet"
        />
      </div>
      {narrowed === null ? (
        <TrendTable<AwaitingRowSeries>
          label="Awaiting-row claims by source"
          period="source"
          rows={series}
          rowKey={(one) => one.sourceId}
          rowLabel={(one) => sourceLabel(one.sourceId, nameOf(one.sourceId))}
          measures={perSource}
          empty={{
            holds: "sources waiting on a record in this window",
            filledBy:
              "A source's claim arrives before the record it belongs to exists, and the source appears here.",
          }}
          state={
            filter.source_id === undefined
              ? undefined
              : {
                  kind: "empty",
                  holds: "awaiting-row claims from this source in this window",
                  filledBy:
                    "This source claims a fact about a record the pipeline has not created yet, and the days appear here.",
                }
          }
        />
      ) : (
        <TrendTable<AwaitingRowPoint>
          label="Awaiting-row claims by day"
          period="day"
          rows={narrowed.points}
          rowKey={(point) => point.day}
          rowLabel={(point) => point.day}
          measures={[
            { key: "claims", label: "claims", value: (point) => point.claims },
            ...(narrowed.threshold === null
              ? []
              : [
                  {
                    key: "threshold",
                    label: "threshold",
                    value: () => narrowed.threshold?.count ?? null,
                  },
                ]),
          ]}
          empty={{
            holds: "days in this window",
            filledBy: "The window covers at least one day as soon as it is read.",
          }}
        />
      )}
      {dialled.length === 0 ? (
        <p className="type-body text-ink-secondary">
          No threshold line is drawn. The per-source{" "}
          <span className="type-data text-ink">stuck_pattern</span>{" "}
          dial lives only in the scraper repo&rsquo;s source registry, and where
          Admin may read it is an open question — so no default is substituted
          here.
        </p>
      ) : null}
    </>
  );
}

/**
 * The settled-values gauge (spec §5, gauge 6 of 6) — per-source re-reject
 * counts over time, "who keeps pushing adjudicated values".
 *
 * A **re-reject** is `observations.rejected_by = 'resolver'`: the source
 * pushed a value a human already adjudicated out and the resolver threw it out
 * again at step 0b. The human adjudications (`verdict`) are reported beside
 * them and never summed into them.
 */
function RejectionSection({
  gauge,
  filter,
}: {
  gauge: SettledValues;
  filter: SourcesFilter;
}) {
  const { window: info, bySource } = gauge;
  const narrowed =
    filter.source_id === undefined
      ? null
      : (bySource.find((split) => split.sourceId === filter.source_id) ?? null);
  // The figures answer the question the URL asked. Narrowed to a source with
  // nothing adjudicated in this window, that is an empty scope — a real zero
  // over the rows read, not the fleet's total wearing one source's name.
  const scope =
    filter.source_id === undefined ? bySource : narrowed === null ? [] : [narrowed];
  const rerejected = scope.reduce((total, split) => total + split.rerejected, 0);
  // The closing sentence obeys the same rule as the cards. Both facts it
  // reports are per-source facts: an unattributed rejection is missing its
  // REASON, not its source, and an unnamed source is one row of `scope` whose
  // registry lookup came back empty. Read off the whole gauge they were the
  // FLEET's, so a bandsintown row moved a page narrowed to ticketmaster
  // (admin-window/BUG-0022) — and deleting the sentence would have lost two
  // facts the operator needs, so they are scoped rather than dropped.
  const unattributed = scope.reduce((total, split) => total + split.unattributed, 0);
  const unnamed = scope.filter((split) => split.source === null).length;

  return (
    <>
      <WindowLine gauge="rejections" window={info} measured="Claims adjudicated" />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Re-rejected claims in this window"
          value={rerejected}
          floor={info.truncated}
          sub="Values a human already adjudicated out, pushed again"
        />
        <GaugeCard
          label="Sources re-pushing adjudicated values"
          value={scope.filter((split) => split.rerejected > 0).length}
          sub={`of ${count(scope.length)} with any claim adjudicated in this window`}
        />
      </div>
      {narrowed === null ? (
        <TrendTable<SourceRejections>
          label="Re-rejected values by source"
          period="source"
          rows={bySource}
          rowKey={(split) => split.sourceId}
          rowLabel={(split) => sourceLabel(split.sourceId, split.source)}
          measures={[
            { key: "rerejected", label: "re-rejected", value: (split) => split.rerejected },
            { key: "adjudicated", label: "adjudicated", value: (split) => split.adjudicated },
            { key: "total", label: "all rejections", value: (split) => split.total },
          ]}
          empty={{
            holds: "sources whose claims were adjudicated in this window",
            filledBy:
              "A human settles a fact, or the resolver throws a settled value out again, and the source appears here.",
          }}
          state={
            filter.source_id === undefined
              ? undefined
              : {
                  kind: "empty",
                  holds: "adjudicated claims from this source in this window",
                  filledBy:
                    "This source pushes a value a verdict already rejected, and the weeks appear here.",
                }
          }
        />
      ) : (
        <TrendTable<RejectionWeek>
          label="Re-rejected values by week"
          period="week (Monday)"
          rows={narrowed.weeks}
          rowKey={(week) => week.weekStart}
          rowLabel={(week) => week.weekStart}
          measures={[
            { key: "rerejected", label: "re-rejected", value: (week) => week.rerejected },
            { key: "adjudicated", label: "adjudicated", value: (week) => week.adjudicated },
          ]}
          empty={{
            holds: "weeks in this window",
            filledBy: "The window covers at least one week as soon as it is read.",
          }}
        />
      )}
      <p className="type-body text-ink-secondary">
        A re-reject is the resolver throwing out a value a human already
        adjudicated out — source health, and the evidence behind a tier move.
        {unattributed > 0
          ? ` ${count(unattributed)} ${
              unattributed === 1 ? "rejection carries" : "rejections carry"
            } no reason at all, so ${
              unattributed === 1 ? "it is" : "they are"
            } counted in neither column.`
          : ""}
        {unnamed === 0
          ? ""
          : unnamed === 1 && narrowed !== null
            ? " This source had no registry row in this read, so it is named by id."
            : ` ${count(unnamed)} of these sources had no registry row in this read, so they are named by id.`}
      </p>
    </>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default async function SourcesPage({
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

  // The registry, whole — every narrowing below is `selectSources`'.
  const sources = await listSources();
  const held = sources.kind === "ok" ? sources.data : [];
  const filter = filterFrom(
    params,
    held.map((source) => source.source_id),
  );
  const shown = selectSources(held, filter);

  // The gauges are the other kind of read — bounded, ordered WINDOWS (§4.3
  // kind 2), so each section names the window it is showing. The awaiting-row
  // window narrows at the query, because `observations.source_id` is a real
  // column on the side it scans; the rejection gauge takes no filter, so its
  // narrowing happens over the rows it returned.
  const trend = await readAwaitingRowTrend({ filter });
  const rejections = await readRejectionStampGauge();

  const nameOf = (sourceId: string): string | null =>
    held.find((source) => source.source_id === sourceId)?.source ?? null;

  const emptyWords = filter.source_id === undefined ? NOTHING_REGISTERED : NOTHING_MATCHED;

  return (
    <Page title="Sources">
      {sources.kind === "ok" && held.length > 0 ? (
        <SourceChips sources={held} filter={filter} />
      ) : null}

      <Section title="Registry" surface={REGISTRY_SURFACE}>
        {sources.kind === "not_provisioned" ? (
          // A card replaces the surface; nothing above it describes a table
          // that is not there (LOOK_AND_FEEL state 3).
          <StateOf result={sources} />
        ) : sources.kind === "ok" && shown.length === 0 ? (
          // Two different emptinesses, two different renderings: the registry
          // that holds nothing, and the narrowing that matched nothing. The
          // hook says WHICH, so neither can be mistaken for the other or for
          // an absent table.
          <div data-empty={filter.source_id === undefined ? "registry" : "narrowing"}>
            <Empty holds={emptyWords.holds} filledBy={emptyWords.filledBy} />
          </div>
        ) : (
          <>
            <DataTable<SourceState>
              label="Sources"
              columns={sourceColumns(filter)}
              rows={sources.kind === "ok" ? shown : []}
              rowKey={(row) => row.source_id}
              placeholder={
                sources.kind === "error" ? <StateOf result={sources} /> : undefined
              }
            />
            <p className="type-body text-ink-secondary">
              State, not configuration: what the registry holds about a source —
              its description, the domains it feeds, its dials and its legal
              status — lives in the scraper repo and is not read here. Tier is
              the source&rsquo;s current tier, which drifts. Last run is the
              newest run whose <span className="type-data text-ink">source</span>{" "}
              name matches this row; a source that has never run shows no run.
            </p>
          </>
        )}
      </Section>

      <Section title="Awaiting-row trend" surface={AWAITING_SURFACE}>
        {trend.kind === "ok" ? (
          <AwaitingRowTrendSection trend={trend.data} filter={filter} nameOf={nameOf} />
        ) : (
          <StateOf result={trend} eyebrow={AWAITING_LABEL} />
        )}
      </Section>

      <Section title="Settled values" surface={REJECTION_SURFACE}>
        {rejections.kind === "ok" ? (
          <RejectionSection gauge={rejections.data} filter={filter} />
        ) : (
          <StateOf result={rejections} eyebrow={REJECTION_LABEL} />
        )}
      </Section>
    </Page>
  );
}
