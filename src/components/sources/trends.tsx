import type { ReactNode } from "react";
import { GaugeCard, TrendTable, type TrendMeasure } from "@/components/gauges";
import { IN_PAGE_LINK } from "@/components/cycles/links";
import { Identifier, WindowLine } from "@/components/ui";
import { count, counted, pluralise } from "@/lib/format";
import { sourceLabel, sourceNamesOf } from "@/lib/sources/names";
import { sourcesHref, type SourceNarrowing } from "@/lib/sources/routes";
import type {
  AwaitingRowPoint,
  AwaitingRowSeries,
  AwaitingRowTrend,
} from "@/lib/gauges/pending-claims";
import type {
  RejectionWeek,
  SettledValues,
  SourceRejections,
} from "@/lib/gauges/settled-values";

/**
 * The two per-source trend panels — campaign admin-window/DEBT-0004, moved
 * here whole from `src/app/sources/page.tsx` (spec §4: they live beside the
 * rows; spec §5, gauges 3 and 6 of 6).
 *
 * Each aggregate arrives as a plain prop; the gauges that produce them do
 * their own reading in `lib/gauges/**`, which a component never imports for a
 * value (ARCHITECTURE.md §4 rule 1).
 */

/**
 * The name a per-source row is known by, as a LINK to that source's narrowing
 * of this page.
 *
 * WHAT it says is not this file's decision: it is `sourceLabel`'s one rule
 * (`lib/sources/names.ts`), asked over the names map the caller hands in.
 * This function only draws the anchor. It spelled `{name ?? sourceId}` until
 * admin-window/BUG-0158, and `??` sees only `null` — so a registry row that
 * EXISTED with an ink-less name took neither branch and the trend rendered an
 * anchor with nothing to read and nothing to click, beside sibling rows that
 * named their source (BUG-0154's harm, on this surface).
 *
 * Named `sourceTrendLink` and not `sourceLabel`: the leaf's `sourceLabel`
 * answers the different question "what is this source CALLED" and returns a
 * string. One name per concept (LOOK_AND_FEEL, The Voice), so the one that
 * renders a link says so.
 */
function sourceTrendLink(
  names: ReadonlyMap<string, string>,
  sourceId: string,
): ReactNode {
  return (
    <a
      href={sourcesHref({ source_id: sourceId })}
      data-trend-source={sourceId}
      className={IN_PAGE_LINK}
    >
      {sourceLabel(names, sourceId)}
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
export function AwaitingRowTrendSection({
  trend,
  filter,
  names,
  scope,
}: {
  trend: AwaitingRowTrend;
  filter: SourceNarrowing;
  /**
   * What the registry calls each source, as `sourceNamesOf` recorded it — the
   * page's own `listSources` read, handed over whole (`/sources`' registry leg
   * is a COMPLETE read, so it names every source this trend can hold). A map
   * rather than a lookup function because the LABEL rule lives in
   * `sourceLabel` and needs the registry's answer itself, blank names included
   * (admin-window/BUG-0158).
   */
  names: ReadonlyMap<string, string>;
  /**
   * What the read BELOW this line was narrowed to, as the phrases the line
   * says — `null` for a read that covered the whole object
   * (admin-window/TASK-0073).
   *
   * Composed by the page, from the filter this read was GIVEN and from the one
   * facet table `/sources` owns (`SOURCES_NARROWING_FACETS`,
   * `lib/sources/routes.ts`), through the phrase shape every surface shares
   * (`lib/url/narrowing.ts`). **This file declares no narrowing phrase and
   * spells none**: a sentence retyped beside the line it belongs to is the
   * class LESSONS 5 names, and the model one page over is `/claims`, which
   * says this by import (admin-window/BUG-0163).
   */
  scope: readonly string[] | null;
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
      <WindowLine
        gauge="awaiting_row"
        window={info}
        measured="Claims observed"
        scope={scope}
      />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Awaiting-row claims in this window"
          value={claims}
          floor={info.truncated}
          sub={`from ${counted(series.length, "source")}`}
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
          rowLabel={(one) => sourceTrendLink(names, one.sourceId)}
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
          <Identifier>stuck_pattern</Identifier>{" "}
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
export function RejectionSection({
  gauge,
  filter,
  scope,
}: {
  gauge: SettledValues;
  filter: SourceNarrowing;
  /**
   * What the read BELOW this line was narrowed to, as the phrases the line
   * says — `null` for a read that covered the whole object
   * (admin-window/TASK-0073).
   *
   * Composed by the page, from the filter this read was GIVEN and from the one
   * facet table `/sources` owns (`SOURCES_NARROWING_FACETS`,
   * `lib/sources/routes.ts`), through the phrase shape every surface shares
   * (`lib/url/narrowing.ts`). **This file declares no narrowing phrase and
   * spells none**: a sentence retyped beside the line it belongs to is the
   * class LESSONS 5 names, and the model one page over is `/claims`, which
   * says this by import (admin-window/BUG-0163).
   */
  scope: readonly string[] | null;
}) {
  const { window: info, bySource } = gauge;
  // The names map THIS section labels by is the gauge's own: `bySource` was
  // built by joining the registry rows the gauge itself read, and `source:
  // null` there means that read returned no row for the source. So the map
  // gets an entry per named split and nothing for an unnamed one, which is
  // exactly the input `sourceLabel` answers the id for (admin-window/BUG-0158).
  // Deliberately NOT the page's registry read: this section's figures and its
  // labels then come from one read, and a registry leg that refused cannot
  // rename a row the gauge did name.
  const names = sourceNamesOf(
    bySource.flatMap((split) =>
      split.source === null
        ? []
        : [{ source_id: split.sourceId, source: split.source }],
    ),
  );
  const narrowed =
    filter.source_id === undefined
      ? null
      : (bySource.find((split) => split.sourceId === filter.source_id) ?? null);
  // The figures answer the question the URL asked. Narrowed to a source with
  // nothing adjudicated in this window, that is an empty set — a real zero over
  // the rows read, not the fleet's total wearing one source's name.
  //
  // It is `reported` and no longer `scope` (admin-window/TASK-0073): `scope` is
  // the app's word for WHAT A READ WAS NARROWED TO, which is the prop above and
  // is this line's business; these are the splits this SECTION reports its
  // figures over, selected from the rows an unnarrowed read returned. One word,
  // one concept (LESSONS 6) — and the two are not the same fact here, which is
  // the whole reason this line names no narrowing.
  const reported =
    filter.source_id === undefined ? bySource : narrowed === null ? [] : [narrowed];
  const rerejected = reported.reduce((total, split) => total + split.rerejected, 0);
  // The closing sentence obeys the same rule as the cards. Both facts it
  // reports are per-source facts: an unattributed rejection is missing its
  // REASON, not its source, and an unnamed source is one row of `reported` whose
  // registry lookup came back empty. Read off the whole gauge they were the
  // FLEET's, so a bandsintown row moved a page narrowed to ticketmaster
  // (admin-window/BUG-0022) — and deleting the sentence would have lost two
  // facts the operator needs, so they are scoped rather than dropped.
  const unattributed = reported.reduce((total, split) => total + split.unattributed, 0);
  const unnamed = reported.filter((split) => split.source === null).length;

  return (
    <>
      <WindowLine
        gauge="rejections"
        window={info}
        measured="Claims adjudicated"
        scope={scope}
      />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Re-rejected claims in this window"
          value={rerejected}
          floor={info.truncated}
          sub="Values a human already adjudicated out, pushed again"
        />
        <GaugeCard
          label="Sources re-pushing adjudicated values"
          value={reported.filter((split) => split.rerejected > 0).length}
          sub={`of ${count(reported.length)} with any claim adjudicated in this window`}
        />
      </div>
      {narrowed === null ? (
        <TrendTable<SourceRejections>
          label="Re-rejected values by source"
          period="source"
          rows={bySource}
          rowKey={(split) => split.sourceId}
          rowLabel={(split) => sourceTrendLink(names, split.sourceId)}
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
          ? ` ${counted(unattributed, "rejection carries", "rejections carry")} no reason at all, so ${pluralise(
              unattributed,
              "it is",
              "they are",
            )} counted in neither column.`
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
