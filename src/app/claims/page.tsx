import type { ReactNode } from "react";
import {
  BucketTable,
  ClaimList,
  ClaimTabs,
  claimWindow,
  CLAIM_WINDOW,
  FilterBar,
  type BucketStat,
  type ClaimLine,
} from "@/components/claims";
import {
  Distribution,
  GaugeCard,
  TrendTable,
  spreadRows,
  type EmptyWords,
} from "@/components/gauges";
import { Empty, ErrorLine, NotProvisioned, Page, Section } from "@/components/ui";
import {
  claimOrder,
  facetOptions,
  listClaims,
  selectClaims,
  RENDERABLE_BUCKETS,
  type ClaimRow,
} from "@/lib/db/claims";
import type { DbUnavailable } from "@/lib/db/result";
import { readSourceNames } from "@/lib/db/sources";
import { absoluteUtc, count, duration } from "@/lib/format";
import {
  claimsHref,
  filterBar,
  filterFrom,
  isNarrowed,
  sourceHref,
  type FacetLabel,
  tabFrom,
  tabLinks,
  withFacet,
  type ClaimsFilter,
  type ClaimsTab,
  type SearchParams,
} from "@/lib/claims/filters";
import {
  readPendingClaims,
  type PendingClaims,
} from "@/lib/gauges/pending-claims";
import {
  readStandingDisagreements,
  STANDING_BUCKET,
  type StandingDisagreements,
} from "@/lib/gauges/standing-disagreements";
import { recordHref } from "@/lib/records/routes";
import { sourceLabel, sourceNamesOf } from "@/lib/sources/names";

/**
 * Claims — **the classification view rendered**: what is stuck, and whose
 * fault (campaign admin-window/TASK-0012).
 *
 * Authority: spec §4 ("buckets with counts, age, filterable by source /
 * domain / bucket; the standing-disagreements subset gets its own tab") and
 * §5 (the pending-claims and standing-disagreements gauges);
 * `contracts/resolver.md` §7 (the six buckets and their precedence) and §4
 * (mutability classes — a standing disagreement is a live contradiction);
 * LOOK_AND_FEEL "Key screens — Claims" and quality bars 1, 3, 5, 10 and 11.
 *
 * **`in_window` appears nowhere on this page**, and no branch below is what
 * keeps it out: `src/lib/db/claims.ts` excludes the parked bucket in the query
 * and again in the predicate, and the bucket vocabulary this page offers as
 * filter chips is `RENDERABLE_BUCKETS`, so it is not a row, not an option, not
 * a zero — and not even a query parameter this page will carry forward
 * (ARCHITECTURE.md §6 trap 4; LOOK_AND_FEEL bar 3).
 *
 * **The read is COMPLETE and unnarrowed** (ARCHITECTURE.md §4.3): the bucket
 * table answers "how many claims are in every bucket, for this source", so a
 * bucket filter must not narrow the counts, and the source and domain chips
 * must offer every value the view carries rather than the survivors of the
 * current narrowing. One whole-set read, and `selectClaims` — the app's one
 * claim predicate — does every narrowing. An `ok` array is therefore every row
 * the view holds, which is what makes "rendered bucket counts equal the view's
 * counts, per bucket and per source filter" (acceptance test 3) true rather
 * than hopeful; a read that could not answer completely arrives as the error
 * state and is rendered as one.
 *
 * The read is complete; the **LIST is drawn as a window** (`CLAIM_WINDOW`,
 * admin-window/BUG-0041): the longest-waiting rows only, with the cap and the
 * number of matching claims stated above the table in the app's window voice.
 * That bound is a rendering bound and nothing else — every count on this page
 * is still computed from the whole matching set, so a window never becomes a
 * total.
 *
 * The two GAUGES on this page are the other kind of read — bounded, ordered
 * WINDOWS (§4.3 kind 2, spec §5) — so their sections name the window they are
 * showing instead of presenting a window aggregate as a total. Only the
 * current tab's gauge is read: a tab is a state of this one route, and reading
 * the other one's window would cost a round trip nobody is looking at.
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, and every child is a pure sync
 * component with plain props — which is what lets the offline suite render
 * `renderToStaticMarkup(await ClaimsPage(props))` with no jsdom and no
 * database, and the live suite compare its counts with counts the test issues
 * itself.
 *
 * **Nothing settles anything in M1** (spec §7 is the verdict slice): every
 * control in this markup is a link.
 */

/**
 * Both reads happen per request against the live database, so the route
 * renders per request rather than being prerendered at build time
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
 * "Route segment config"). Reading `searchParams` already opts this page in,
 * but the prop is optional — the shell's route test renders every page with no
 * props at all — and a page prerendered at build, where the app has no
 * credential, would ship a FROZEN error state that never re-reads.
 */
export const dynamic = "force-dynamic";

/** This route's own path — the base every filter, tab and bucket link is built on. */
const CLAIMS_PATH = "/claims";

/** What creates the ecosystem objects this page reads. */
const ARRIVES_WITH = "the scraper repo's migrations";

/** The order the claim list is in, stated on screen (LOOK_AND_FEEL bar 6). */
const SORT_STATEMENT =
  "Oldest first — the longest-waiting claim at the top; a claim whose instant is unknown sorts last.";

/**
 * What the list is showing, in the app's window voice — campaign
 * admin-window/BUG-0041. Every other long list on this app states its bound
 * ("a window of at most 200, not a count of the cycles that exist"); this one
 * did not, and it was the one list that was actually unbounded, so the gauge
 * below it sat wherever the backlog put it. The cap and the number held are
 * both on screen, so the window is never a silent truncation.
 */
function windowSentence(held: number, truncated: boolean): string {
  const bound = `A window of at most ${count(CLAIM_WINDOW)} rows, not the whole view.`;
  return truncated
    ? `${bound} ${count(held)} claims match these filters; the ${count(
        CLAIM_WINDOW,
      )} longest-waiting are below — narrow with the filters above to reach the rest.`
    : bound;
}

/** What an empty claims table holds and what fills it — never a bare "No data". */
const NOTHING_HELD: EmptyWords = {
  holds: "claims waiting",
  filledBy:
    "The resolver files one here when it cannot apply a claim yet — no canonical row, an unresolved link, a contradiction, or an open review item.",
};

/** The standing tab's own emptiness, which is good news and reads that way. */
const NOTHING_STANDING: EmptyWords = {
  holds: "standing disagreements",
  filledBy:
    "One appears when a live claim contradicts the applied value and does not displace it — the loser stays visible here.",
};

/** The emptiness that has a REASON: the filters, not the database. */
const NOTHING_MATCHED: EmptyWords = {
  holds: "claims matching these filters",
  filledBy: "Widen a filter above; the 'all' chip on any row shows everything again.",
};

/** The h2 above the claim list, per tab. */
const LIST_TITLE: Record<ClaimsTab, string> = {
  buckets: "All claims",
  standing: "Standing disagreements",
};

/** The h2 above the gauge, per tab, and the eyebrow its state card carries. */
const GAUGE_TITLE: Record<ClaimsTab, string> = {
  buckets: "Pending claims gauge",
  standing: "Standing disagreements gauge",
};

const GAUGE_LABEL: Record<ClaimsTab, string> = {
  buckets: "Pending claims",
  standing: "Standing disagreements",
};

/**
 * The name each of this page's surfaces answers to — `data-surface`, rendered
 * by `Section` and read by the live parity oracle
 * (`tests/live/claims.live.test.ts`), pinned offline by
 * `tests/offline/claims/page.test.ts`.
 *
 * A NAME, never a position. The oracle addressed these as
 * `section:nth-of-type(n)` until admin-window/DEBT-0002 — and on THIS page the
 * position was already tab-dependent, because the standing tab renders no
 * bucket table at all and its list is therefore the first section. That is the
 * bug class that cost `/cycles` four live tests when admin-window/BUG-0040
 * added a section and a `<div>` wrapper (admin-window/BUG-0056): `stateOf`
 * demands exactly one match, so a selector that moves with the page silently
 * repoints at the wrong surface. `[data-surface="claims"]` is the list on
 * BOTH tabs.
 *
 * A name is the surface's IDENTITY, not its heading: the list and the gauge
 * both retitle themselves per tab (`LIST_TITLE`, `GAUGE_TITLE`) and keep the
 * same name. `buckets` is the one surface that does not always render — the
 * standing tab omits it — which is a count of 0 or 1, never 2. All three are
 * unique within this page; it writes no hand-written `data-surface` anywhere.
 */
const BUCKETS_SURFACE = "buckets";
const LIST_SURFACE = "claims";
const GAUGE_SURFACE = "gauge";

/** One retry sentence, in the app's voice, for every failed read on this page. */
const RETRY = "Reload to try the read again.";

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
  return result.kind === "not_provisioned" ? (
    <NotProvisioned
      missing={result.missing}
      arrivesWith={ARRIVES_WITH}
      eyebrow={eyebrow}
    />
  ) : (
    <ErrorLine reading={result.reading} failed={result.message} retry={RETRY} />
  );
}

/** The per-bucket figures, from the claims a source/domain narrowing keeps. */
function bucketStats(
  claims: readonly ClaimRow[],
  filter: ClaimsFilter,
  tab: ClaimsTab,
  buckets: readonly string[],
): BucketStat[] {
  // The bucket facet is deliberately dropped: this table is the whole
  // classification under the current source and domain, and narrowing it to
  // one bucket would answer a question nobody asked with four blanks.
  const scope = selectClaims(claims, withFacet(filter, "bucket", undefined));
  return buckets.map((bucket) => {
    const held = scope.filter((claim) => claim.bucket === bucket);
    const instants = held
      .map((claim) => claim.observed_at)
      .filter((at): at is string => at !== null);
    const active = filter.bucket === bucket;
    return {
      bucket,
      claims: held.length,
      // The oldest instant present, by comparison rather than by a position in
      // a list — and null, never "now", when nothing here has an instant.
      oldestObservedAt:
        instants.length === 0
          ? null
          : instants.reduce((oldest, at) =>
              Date.parse(at) < Date.parse(oldest) ? at : oldest,
            ),
      sources: new Set(held.map((claim) => claim.source_id)).size,
      // Clicking the bucket you are already in clears it: one chip, both ways.
      href: claimsHref(
        CLAIMS_PATH,
        withFacet(filter, "bucket", active ? undefined : bucket),
        tab,
      ),
      active,
    };
  });
}

/**
 * One claim, as the list renders it: its row, its age, and its two links.
 *
 * The source is carried twice on purpose (admin-window/BUG-0043): `sourceId`
 * is the machine value the link narrows by and the row is keyed on, `source`
 * is what the cell SAYS — the registry's name, or that same id verbatim when
 * the registry holds no row for it.
 */
function claimLines(
  claims: readonly ClaimRow[],
  names: ReadonlyMap<string, string>,
): ClaimLine[] {
  return claimOrder(claims).map((claim) => ({
    observationId: claim.observation_id,
    bucket: claim.bucket,
    domain: claim.domain,
    field: claim.field,
    entityId: claim.entity_id,
    sourceId: claim.source_id,
    source: sourceLabel(names, claim.source_id),
    observedAt: claim.observed_at,
    unmetRequirement: claim.unmet_requirement,
    sourceHref: sourceHref(claim.source_id),
    provenanceHref: recordHref(claim.domain, claim.entity_id),
  }));
}

/** The window line every gauge section carries — which window, and whether it filled. */
function WindowLine({
  window,
}: {
  window: PendingClaims["window"] | StandingDisagreements["window"];
}) {
  return (
    <p className="type-body text-ink-secondary">
      Claims observed since {absoluteUtc(window.since)}, read to{" "}
      {absoluteUtc(window.until)} — a window of at most {count(window.limit)} rows,
      not the whole view.
      {window.truncated
        ? " The window filled its cap, so every count here is a floor."
        : ""}
    </p>
  );
}

/** The pending-claims gauge (spec §5, gauge 3 of 6) — the buckets tab's. */
function PendingClaimsGauge({ gauge }: { gauge: PendingClaims }) {
  return (
    <>
      <WindowLine window={gauge.window} />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Claims in this window"
          value={gauge.claims}
          floor={gauge.window.truncated}
          sub={`${count(gauge.sources.length)} sources, ${count(
            gauge.domains.length,
          )} domains`}
        />
        <GaugeCard
          label="Buckets holding claims"
          value={gauge.buckets.filter((bucket) => bucket.claims > 0).length}
          sub={`of ${count(gauge.buckets.length)} the view can classify into`}
        />
      </div>
      <Distribution
        label="Pending claim age"
        dimension="percentile"
        measure="age"
        format={duration}
        rows={spreadRows(gauge.age)}
        empty={{
          holds: "claims to age in this window",
          filledBy: "A claim is made and stays pending, and its wait joins the spread.",
        }}
        state={
          gauge.age.count === 0
            ? {
                kind: "empty",
                holds: "claims in this window",
                filledBy:
                  "A claim the resolver cannot apply yet appears here, and its wait is measured.",
              }
            : undefined
        }
      />
      <TrendTable<PendingClaims["buckets"][number]>
        label="Claims by bucket in this window"
        period="bucket"
        rows={gauge.buckets}
        rowKey={(bucket) => bucket.bucket}
        rowLabel={(bucket) => bucket.bucket}
        measures={[
          { key: "claims", label: "claims", value: (bucket) => bucket.claims },
          { key: "sources", label: "sources", value: (bucket) => bucket.sources },
          {
            key: "p50",
            label: "p50 age",
            value: (bucket) => bucket.age.p50,
            format: duration,
          },
        ]}
        empty={{
          holds: "buckets in this window",
          filledBy: "A claim is classified into one, and the bucket appears here.",
        }}
      />
      <p className="type-body text-ink-secondary">
        The per-source <span className="type-data text-ink">awaiting_row</span>{" "}
        trend lives on Sources, and it is drawn without its threshold line: the{" "}
        <span className="type-data text-ink">stuck_pattern</span>{" "}
        dial is a source-registry value only the scraper repo holds, and where
        Admin may read it is an open question. No default is substituted here.
      </p>
    </>
  );
}

/** The standing-disagreements gauge (spec §5, gauge 5 of 6) — the standing tab's. */
function StandingGauge({ gauge }: { gauge: StandingDisagreements }) {
  return (
    <>
      <WindowLine window={gauge.window} />
      <GaugeCard
        label="Live contradictions in this window"
        value={gauge.claims}
        floor={gauge.window.truncated}
        sub={`${count(gauge.bySource.length)} sources holding one`}
      />
      <TrendTable<StandingDisagreements["bySource"][number]>
        label="Standing disagreements by source"
        period="source"
        rows={gauge.bySource}
        rowKey={(split) => split.sourceId}
        rowLabel={(split) => (
          <a
            href={sourceHref(split.sourceId)}
            data-split-source={split.sourceId}
            className="transition-colors hover:text-accent"
          >
            {split.source ?? split.sourceId}
            {split.tier === null ? "" : ` · tier ${split.tier}`}
            {split.lifecycle === null ? "" : ` · ${split.lifecycle}`}
          </a>
        )}
        measures={[
          { key: "claims", label: "claims", value: (split) => split.claims },
          {
            key: "p50",
            label: "p50 age",
            value: (split) => split.age.p50,
            format: duration,
          },
        ]}
        empty={{
          holds: "sources holding a contradiction in this window",
          filledBy:
            "A source's claim contradicts the applied value without displacing it, and the source appears here.",
        }}
      />
      <p className="type-body text-ink-secondary">
        Tier is the source&rsquo;s CURRENT tier, which drifts — not the tier the
        applied value won under.
        {gauge.unnamedSources > 0
          ? ` ${count(gauge.unnamedSources)} of these sources had no registry row in this read, so they are named by id.`
          : ""}
      </p>
    </>
  );
}

export default async function ClaimsPage({
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
  const tab = tabFrom(params);

  // The view, whole — every narrowing below is the predicate's.
  const claims = await listClaims();

  // The vocabularies the URL may select from: the buckets the app may render,
  // and the sources and domains the view actually carries. A parameter naming
  // anything else narrows nothing, so a hand-typed URL lands on a real state
  // and carries nothing forward into the chips' hrefs.
  const asFound =
    claims.kind === "ok"
      ? facetOptions(claims.data)
      : { bucket: RENDERABLE_BUCKETS, source_id: [], domain: [] };

  // What each source is CALLED — admin-window/BUG-0043. `pending_claims` keys
  // a source by `source_id` and carries no name, so the label is a second leg
  // (§4.2) over exactly the ids this view holds; the rest of the app has
  // always shown the name, and 877 rows of uuid said nothing an operator
  // could read. The id keeps every job it had: it keys the row, it travels in
  // the URL, and it is what a chip narrows by.
  //
  // A refusal here costs the LABEL and nothing else, so it is carried beside
  // the list rather than replacing it (the review item does the same with its
  // own registry leg): every claim still renders, named by its id verbatim.
  const registry = await readSourceNames(asFound.source_id);
  const names = sourceNamesOf(registry.kind === "ok" ? registry.data : []);
  const labelOf: FacetLabel = (facet, value) =>
    facet === "source_id" ? sourceLabel(names, value) : value;

  const options = {
    ...asFound,
    // The chips read in the order their LABELS sort, so this facet reads the
    // same here as the identical one on `/sources` instead of in uuid order
    // (LOOK_AND_FEEL: the anatomy does not change between screens). The id
    // breaks a tie, so the order is total.
    source_id: [...asFound.source_id].sort((a, b) => {
      const left = sourceLabel(names, a);
      const right = sourceLabel(names, b);
      if (left !== right) return left < right ? -1 : 1;
      return a < b ? -1 : 1;
    }),
  };
  // The standing tab is one bucket's subset, so it carries no bucket facet at
  // all: dropping it here — rather than overriding it at render — is what
  // keeps the chips, the hrefs and the "nothing matched" words telling the
  // same story as the rows, and stops a bucket nobody can see travelling in
  // the URL.
  const asked = filterFrom(params, options);
  const filter = tab === "standing" ? withFacet(asked, "bucket", undefined) : asked;

  // Only the tab on screen reads its gauge's window: a tab is a state of this
  // one route, and reading the other one's window costs a round trip nobody is
  // looking at. Each is its own typed result, so neither is cast into the
  // other's shape.
  const pending =
    tab === "buckets" ? await readPendingClaims({ filter: gaugeFilter(filter) }) : null;
  const standing =
    tab === "standing"
      ? await readStandingDisagreements({ filter: gaugeFilter(filter) })
      : null;

  const shown =
    claims.kind === "ok"
      ? selectClaims(
          claims.data,
          tab === "standing" ? { ...filter, bucket: STANDING_BUCKET } : filter,
        )
      : [];
  // The list is DRAWN as a window; `shown` stays the whole matching set, so
  // the sentence above the table can state how many claims it really holds
  // (admin-window/BUG-0041). Nothing else on the page reads these rows.
  const listed = claimWindow(claimLines(shown, names));
  const emptyWords = isNarrowed(filter)
    ? NOTHING_MATCHED
    : tab === "standing"
      ? NOTHING_STANDING
      : NOTHING_HELD;

  return (
    <Page title="Claims">
      <ClaimTabs tabs={tabLinks(CLAIMS_PATH, filter, tab)} />
      <FilterBar facets={filterBar(CLAIMS_PATH, filter, tab, options, labelOf)} />

      {tab === "standing" ? null : (
        <Section title="Buckets" surface={BUCKETS_SURFACE}>
          {claims.kind === "not_provisioned" ? (
            // A card replaces the surface; nothing above it describes a table
            // that is not there (LOOK_AND_FEEL state 3).
            <StateOf result={claims} />
          ) : (
            <>
              <BucketTable
                label="Claims by bucket"
                rows={
                  claims.kind === "ok"
                    ? bucketStats(claims.data, filter, tab, options.bucket)
                    : []
                }
                line={
                  claims.kind === "error" ? <StateOf result={claims} /> : undefined
                }
              />
              <p className="type-body text-ink-secondary">
                Every bucket the classification view can hold, with the claims in
                it under the filters above. A bucket with no claims is a real
                zero.
              </p>
            </>
          )}
        </Section>
      )}

      <Section title={LIST_TITLE[tab]} surface={LIST_SURFACE}>
        {claims.kind === "not_provisioned" ? (
          <StateOf result={claims} />
        ) : claims.kind === "ok" && shown.length === 0 ? (
          // Three different emptinesses, three different renderings: the table
          // that holds nothing, the filter that matched nothing, and the table
          // that is not in this database (LOOK_AND_FEEL, Emptiness).
          <Empty holds={emptyWords.holds} filledBy={emptyWords.filledBy} />
        ) : (
          <>
            {/* The window line describes a window this page actually read, and
                states a count it actually took. A refused or absent read
                counted nothing, so the line would describe a table that is not
                there and publish a `0` no other state can produce — an empty
                matching set renders the Empty card above, with no line at all.
                Same rule and same shape as `/runs` (admin-window/BUG-0063,
                LOOK_AND_FEEL states 3 and 4). */}
            {claims.kind === "ok" ? (
              <p
                data-window="claims"
                data-window-limit={String(CLAIM_WINDOW)}
                data-window-held={String(listed.held)}
                data-window-truncated={listed.truncated ? "true" : "false"}
                className="type-body text-ink-secondary"
              >
                {SORT_STATEMENT} {windowSentence(listed.held, listed.truncated)}
              </p>
            ) : null}
            <ClaimList
              label={LIST_TITLE[tab]}
              rows={claims.kind === "ok" ? listed.rows : []}
              line={
                claims.kind === "error" ? <StateOf result={claims} /> : undefined
              }
            />
            {registry.kind === "ok" ? null : (
              // The claims rendered fine; only what NAMES their sources could
              // not be read, so it is reported on its own, naming its own
              // object, and every row above is named by its id verbatim.
              <StateOf result={registry} eyebrow="Source names" />
            )}
          </>
        )}
      </Section>

      <Section title={GAUGE_TITLE[tab]} surface={GAUGE_SURFACE}>
        {pending !== null ? (
          pending.kind === "ok" ? (
            <PendingClaimsGauge gauge={pending.data} />
          ) : (
            <StateOf result={pending} eyebrow={GAUGE_LABEL[tab]} />
          )
        ) : standing !== null && standing.kind === "ok" ? (
          <StandingGauge gauge={standing.data} />
        ) : standing !== null ? (
          <StateOf result={standing} eyebrow={GAUGE_LABEL[tab]} />
        ) : null}
      </Section>
    </Page>
  );
}

/**
 * The gauge's own narrowing. The gauges read `observations` by source and
 * domain — real columns on that table — and know nothing of buckets: the
 * bucket facet narrows what this page RENDERS, never what the window measured,
 * or the figure would stop being the window it names.
 */
function gaugeFilter(filter: ClaimsFilter): { source_id?: string; domain?: string } {
  const narrowed: { source_id?: string; domain?: string } = {};
  if (filter.source_id !== undefined) narrowed.source_id = filter.source_id;
  if (filter.domain !== undefined) narrowed.domain = filter.domain;
  return narrowed;
}
