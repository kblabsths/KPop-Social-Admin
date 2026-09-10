
import { Fragment, type ReactNode } from "react";

import {
  BucketTable,
  ClaimList,
  ClaimTabs,
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
import { IN_PAGE_LINK } from "@/components/cycles/links";
import {
  DroppedParamsLine,
  Empty,
  Identifier,
  NARROWED_BY_FILTERS,
  Page,
  Section,
  StateOf,
  WindowLine,
  narrowedTo,
} from "@/components/ui";
import {
  CLAIMS_OBJECT,
  readBucketOldest,
  readClaimCount,
  readClaimWindow,
  RENDERABLE_BUCKETS,
  UNRENDERABLE_BUCKET,
  type ClaimRow,
  type PendingClaimBucket,
} from "@/lib/db/claims";
import type { DbResult } from "@/lib/db/result";
import { readSources } from "@/lib/db/sources";
import { count, counted, duration } from "@/lib/format";
import {
  CLEARED_BY,
  claimsHref,
  claimsNarrowed,
  clearNarrowing,
  droppedParams,
  filterBar,
  filterFrom,
  hasChipNarrowing,
  hasNarrowingFacet,
  sourceHref,
  type FacetLabel,
  tabFrom,
  tabLinks,
  unchippedNarrowings,
  unchippedPhrase,
  withFacet,
  type ClaimsFilter,
  type ClaimsTab,
  type SearchParams,
  type UnchippedNarrowing,
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
 * **This page reads no claim population** (admin-window/BUG-0138, Ben's ruling
 * of 2026-09-10). It used to: one COMPLETE read of the view, then a chunked
 * second leg over `observations` for the age the view did not carry, then the
 * registry, then the gauge — ~14 sequential requests and 2.9-3.8 s of warm
 * server time on staging's 877 claims, all of it depth rather than slow
 * queries. What it reads now, ALL AT ONCE and none of them waiting on
 * another's ids:
 *
 *  - the LIST — ONE window read of the longest-waiting `CLAIM_WINDOW` claims,
 *    ordered in the DATABASE (`observed_at asc`, the instant the scraper
 *    handoff carries through the view), narrowed by `.eq()` at the query;
 *  - every COUNT — `head: true` requests `ROW_CAP` cannot reach: the total
 *    under this tab's narrowing, one per renderable bucket, and, where a facet
 *    is set, the unnarrowed population that tells "nothing here yet" from
 *    "nothing matched" (§4.3, admin-window/DEBT-0008, the shape `/queues`
 *    already has);
 *  - each bucket's OLDEST claim — a `limit 1` window read of its own;
 *  - the source REGISTRY, which is both the labels and the chip vocabulary;
 *  - and the tab's gauge.
 *
 * So the page's cost is invariant to the size of the view: the same requests
 * over 20 claims and over 2,000, none of them reading more than
 * `CLAIM_WINDOW` claim rows, and no figure on screen derived from a set that
 * had to be transported to be counted. Each leg keeps its own `DbResult` and
 * its own rendering — no leg is cast into another's shape and no leg's refusal
 * removes another leg's rows (§4.1, §4.3, common violations row 14).
 *
 * **The LIST is a window and its count is a count** (`CLAIM_WINDOW`,
 * admin-window/BUG-0041): the longest-waiting rows only, with the cap and the
 * number of matching claims stated above the table in the app's window voice.
 * The rows never become a total — the sentence above them states a figure the
 * database counted, not the length of an array.
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

/** The order the claim list is in, stated on screen (LOOK_AND_FEEL bar 6). */
const SORT_STATEMENT =
  "Oldest first — the longest-waiting claim at the top; a claim whose instant is unknown sorts last.";

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

/**
 * The emptiness that has a REASON: a narrowing this URL applied, not the
 * database — in the words of the narrowings that really applied
 * (admin-window/BUG-0160).
 *
 * It used to be one fixed pair naming "these filters" and pointing at the
 * chip rows, which is true of `?bucket=` and `?source_id=` and false of
 * `?domain=`: that facet narrows every read on this page and has no chip row
 * to widen (`CHIP_FACETS`, admin-window/BUG-0138), so the card blamed two
 * chip rows both reading `all` and offered a way out that clears nothing.
 * `narrowedEmpty` below composes the arm from the same two ingredients every
 * other sentence on this page now takes — which chip narrowings are set, and
 * which control-less ones are.
 */
const NOTHING_MATCHED = {
  /** What the chip facets narrow to, in the window line's own spelling. */
  filters: NARROWED_BY_FILTERS,
  /**
   * The way out — ONE control, named in its own words and rendered by the
   * filter bar above (`CLEARED_BY` / `clearNarrowing`,
   * admin-window/BUG-0161).
   *
   * It used to be two sentences and neither exited: "Widen a filter above;
   * the 'all' chip on any row shows everything again" was false the moment
   * `?domain=` was set — every chip on the page carries that parameter
   * forward, both `all` chips included — and the second sentence sent the
   * operator to the address bar, which is not a control this page draws.
   * The words are imported from beside the control rather than typed here, so
   * the card cannot name a chip that says something else (LESSONS 5).
   */
  clearedBy: CLEARED_BY,
} as const;

/**
 * What the bucket table's figures are figures OF — the sentence under it, in
 * the two states the page can be in (admin-window/BUG-0123).
 *
 * The table is the whole classification under the current source and domain,
 * so "under the filters above" is true exactly when a facet is set — and with
 * an empty chip bar it was the second sentence on this page asserting a
 * narrowing nobody performed, beside a window line saying the same
 * (`M2-usersim-priya.md` §6; LOOK_AND_FEEL bar 13, "no screen claims a mark it
 * did not draw").
 *
 * Which arm renders is decided by `claimsNarrowed` — the SAME rule that picks
 * the empty card's words below — so the caption and the card cannot come to
 * disagree about whether anything is filtered.
 *
 * **It is assembled from clauses rather than held as two sentences**
 * (admin-window/BUG-0160), because "under the filters above" is a claim about
 * the CHIP facets and this page has a facet with no chip: `?domain=events`
 * narrowed the figures in this table from 877 to 849 under a caption saying
 * they were narrowed by controls that both read `all`, and the word "domain"
 * appeared nowhere on the screen. So the narrowing clause is now the
 * narrowings themselves — the control-less ones named in the app's words,
 * "the filters above" said only where a chip really is set — and both landed
 * sentences still render to the byte when they are the true ones: with a chip
 * set and no domain, and with nothing set at all.
 *
 * That rule takes TWO facts, and the second is this TABLE's own population
 * (admin-window/DEBT-0008): the whole view, against the rows this table is
 * drawing. A facet that removed not one row of them narrowed nothing here —
 * the bucket facet never can, since this table drops it on purpose, and a
 * source or domain the whole view carries anyway does not either — so the
 * unnarrowed arm is what stands. Which is why its clause states the ROWS'
 * fact and not the URL's: "no filter is set" was false the moment a facet that
 * removes nothing could reach this arm, and the sentence has to be true in
 * every state that renders it (LOOK_AND_FEEL bar 13).
 */
const BUCKET_CAPTION = {
  head: "Every bucket the classification view can hold, with ",
  /** The rows this table drew, when something narrowed them. */
  some: "the claims",
  /** …and when nothing did. */
  every: "every claim",
  inIt: " in it",
  /**
   * The chip narrowings, named as what they are: controls ABOVE this table.
   * It may only be said where one of them is set — the clause was true of
   * every narrowing while every facet had chips, and `?domain=` is the one
   * that does not (admin-window/BUG-0160).
   */
  underTheFilters: " under the filters above",
  nothingNarrows: " — nothing above narrows these counts",
  tail: ". A bucket with no claims is a real zero.",
} as const;

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
 * What the claim list's window was narrowed to, as the phrase its line reads
 * after the row noun ("claims **matching these filters**") — `null` only when
 * the drawn window really is every renderable claim.
 *
 * The list is windowed in TypeScript over a complete read, so its narrowing is
 * the SELECTION and not a `.eq()`: the tab (the standing tab is one bucket's
 * subset) and the facet chips. Both are named here from the same values
 * `selectClaims` was given, because a window line that states a floor or an
 * emptiness of "claims" over a selection that saw one bucket is making the
 * claim admin-window/BUG-0114 was filed for — "the read happened and found no
 * claims at all" stood directly above an empty card saying no claim matched
 * THESE FILTERS.
 *
 * The bucket is named by its own value (`standing_disagreement`), which is what
 * every bucket chip and every bucket row on this page renders: a machine
 * identifier is shown verbatim, never prettified (ARCHITECTURE.md §11).
 *
 * It feeds EVERY clause of that line, the filled one included: the window's
 * count sentence used to name no narrowing at all and say "match these
 * filters" over a tab-narrowed read whose chip bar was empty
 * (admin-window/BUG-0118).
 */
function listScope(
  tab: ClaimsTab,
  narrowed: boolean,
  narrowings: readonly UnchippedNarrowing[],
  chipped: boolean,
): string | null {
  return narrowedTo([
    tab === "standing" ? `in the ${STANDING_BUCKET} bucket` : null,
    // The narrowings this page renders NO control for — `?domain=`, today the
    // only one (admin-window/BUG-0160). They are named here for the same
    // reason the tab's bucket is: nothing else on the screen says them. A
    // chip narrowing can be read off its own chip, so the clause below may
    // stand in for it; a domain narrowing had no chip, no clause and no word
    // anywhere, while every count on the page was narrowed by it.
    //
    // Spelled by the leaf that owns the facet vocabulary, never here: the same
    // phrase is rendered as markup by the caption and the empty card below,
    // and two spellings of one narrowing is exactly how the caption and the
    // line come to describe different sets (LESSONS 5).
    ...(narrowed ? narrowings.map(unchippedPhrase) : []),
    // The window line's own phrase for the CHIP narrowings, imported rather
    // than spelled: the `matched` arm's filled clause says the filters in its
    // own words and subtracts this exact phrase from the scope so it is not
    // said twice, which a second spelling here would silently break
    // (admin-window/BUG-0118).
    //
    // `narrowed` is the LIST's two-fact answer, handed in rather than asked
    // for here (admin-window/DEBT-0008): the window line and the empty card it
    // stands beside describe one set, so they may not decide separately
    // whether a filter is what shaped it. `chipped` is the second gate and a
    // different question — is a filter the operator can SEE set at all — so a
    // window narrowed only by the domain says the domain and never claims a
    // chip row did it (admin-window/BUG-0160).
    narrowed && chipped ? NARROWED_BY_FILTERS : null,
  ]);
}

/**
 * A narrowing the page renders no control for, in the app's prose — the SAME
 * words `unchippedPhrase` gives the window line's `scope`, with the value in
 * the app's one identifier face (`ui/Identifier`, LOOK_AND_FEEL Voice bar 5).
 *
 * Each phrase carries its own leading space, so a call site writes it straight
 * after the noun it qualifies and renders nothing at all when the URL carries
 * no such narrowing.
 *
 * **The window line's copy of these words is plain prose, not mono.** A
 * `DrawnWindow.scope` is a STRING the `matched` arm splits on and subtracts
 * phrases from (`components/ui/window-line.tsx`), so the value cannot carry an
 * element there without rewriting that primitive and every page's window
 * tests; it is the same face the tab's `standing_disagreement` already wears
 * in that line. Noted rather than hidden — one face per identifier is
 * LESSONS 6, and closing that gap is a change to the shared window primitive.
 */
function NarrowedBy({
  narrowings,
}: {
  narrowings: readonly UnchippedNarrowing[];
}) {
  return (
    <>
      {narrowings.map((narrowing) => (
        <Fragment key={narrowing.facet}>
          {` ${narrowing.before}`}
          <Identifier>{narrowing.value}</Identifier>
          {narrowing.after}
        </Fragment>
      ))}
    </>
  );
}

/**
 * What the bucket table's figures are figures OF, assembled from the
 * narrowings that produced them (`BUCKET_CAPTION`, admin-window/BUG-0160).
 *
 * One paragraph, exactly where the page rendered one before — the test helper
 * that reads this sentence takes the surface's last `<p>`.
 */
function BucketCaption({
  narrowed,
  narrowings,
  chipped,
}: {
  narrowed: boolean;
  narrowings: readonly UnchippedNarrowing[];
  chipped: boolean;
}) {
  return (
    <p className="type-body text-ink-secondary">
      {BUCKET_CAPTION.head}
      {narrowed ? BUCKET_CAPTION.some : BUCKET_CAPTION.every}
      {/* The narrowing is named on the arm that CLAIMS one. The unnarrowed arm
          says these counts are whole, and they are: a facet that removed not
          one row of this table shaped nothing here, and naming it beside
          "nothing above narrows these counts" would be the page describing a
          set it did not draw (admin-window/DEBT-0008, LOOK_AND_FEEL bar 13). */}
      <NarrowedBy narrowings={narrowed ? narrowings : []} />
      {BUCKET_CAPTION.inIt}
      {narrowed && chipped ? BUCKET_CAPTION.underTheFilters : ""}
      {narrowed ? "" : BUCKET_CAPTION.nothingNarrows}
      {BUCKET_CAPTION.tail}
    </p>
  );
}

/**
 * The empty card's words when a narrowing this URL applied is what emptied the
 * list — each narrowing named (admin-window/BUG-0160), and ONE way out that
 * really clears every one of them (admin-window/BUG-0161).
 *
 * The exit is a control this page DRAWS — the filter bar's clear row, whose
 * label these words quote — and never an instruction the operator cannot
 * carry out: `/claims?domain=zzz` zeroed every figure on the page while both
 * `all` chips carried `domain=zzz` forward, so the card's own advice led back
 * to the same zeroed page and the only other exits were the sidebar and the
 * address bar.
 *
 * `chipped` and `narrowings` cannot both be empty here: this arm renders only
 * where `claimsNarrowed` is true, which needs a facet of `CLAIM_FACETS`, and
 * every one of those is either a chip facet or carries words of its own
 * (`UNCHIPPED_FACETS` is `CLAIM_FACETS` minus `CHIP_FACETS`, and the words are
 * a total `Record` over it).
 */
function narrowedEmpty(
  narrowings: readonly UnchippedNarrowing[],
  chipped: boolean,
): { holds: ReactNode; filledBy: ReactNode } {
  return {
    holds: (
      <>
        claims
        <NarrowedBy narrowings={narrowings} />
        {chipped ? ` ${NOTHING_MATCHED.filters}` : ""}
      </>
    ),
    filledBy: (
      <>
        {NOTHING_MATCHED.clearedBy.chip}
        {/* Each facet the page renders no chip row for, named by the
            parameter the URL spells it with — so the sentence says both what
            the one control clears and why the operator could not find the
            narrowing that emptied this list. */}
        {narrowings.map((narrowing, index) => (
          <Fragment key={narrowing.facet}>
            {index === 0
              ? NOTHING_MATCHED.clearedBy.including
              : NOTHING_MATCHED.clearedBy.and}
            <Identifier>{narrowing.facet}</Identifier>
            {index === narrowings.length - 1
              ? NOTHING_MATCHED.clearedBy.withNoChip
              : ""}
          </Fragment>
        ))}
        {NOTHING_MATCHED.clearedBy.end}
      </>
    ),
  };
}

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

/**
 * The two SUB-surfaces of the list — the counts that render no row of their
 * own and are reported beside the rows when they refuse
 * (admin-window/BUG-0135's shape, admin-window/BUG-0138's reads).
 *
 * Neither is ever the list's own state: the window read succeeded, so its
 * rows, its card and its state stand whatever these did. One of them costs the
 * window LINE (a `held` nobody counted is not a number this page may print);
 * the other costs four words of that line and which of two empty cards shows.
 * Both render only on a refusal, so a healthy page publishes neither.
 */
const LIST_COUNT_SURFACE = "claims_count";
const POPULATION_SURFACE = "claims_population";

/** The eyebrows over those refusals: the fact that could not be read. */
const LIST_COUNT_EYEBROW = "Matching claims";
const POPULATION_EYEBROW = "Whole-view count";

/**
 * The name each gauge's WINDOW answers to — `data-window`, the hook a live
 * oracle reads a window back by, as `/cycles` and `/sources` publish theirs
 * (admin-window/DEBT-0003).
 *
 * This page published NONE: its hand-copied window line carried the sentence
 * and no attributes at all, so the one window an oracle could not read
 * structurally was on the page whose oracle had already graded a broken state
 * as a pass (common violations 6 and 9). The shared `WindowLine` carries them
 * on every page, this one included.
 *
 * The two names are the page's own tab vocabulary rather than the gauges'
 * design names, for one reason a reader should not have to rediscover:
 * `pending_claims` is a VIEW name, which only `lib/db/tables.ts` may spell
 * (ARCHITECTURE.md §4 rule 4) — and the list above already publishes
 * `data-window="claims"` over that same view, so a second hook named for it
 * would read as the same window twice. Exactly one of these two renders on any
 * tab.
 */
const PENDING_WINDOW = "pending";
const STANDING_WINDOW = "standing";

/**
 * The name the LIST's own window answers to — read back by the live parity
 * oracle (`tests/live/claims.live.test.ts` grades `data-window-held` against
 * its own count of the matching set). The spelling is the one the hand-rolled
 * paragraph carried before admin-window/DEBT-0006 folded it.
 */
const LIST_WINDOW = "claims";

/**
 * The per-bucket figures — each one the answer of the read that was issued for
 * it, refusal included (admin-window/BUG-0138).
 *
 * Nothing is computed from rows here, because the page holds none: `counts[i]`
 * is bucket `i`'s own `head: true` count under the current source/domain
 * narrowing and `oldest[i]` is its own `limit 1` window read. A count that
 * refused travels as the refusal it is — never as a zero, which is the one
 * substitution §4.3 names (common violations row 2) — and the table renders it
 * in that bucket's row, leaving the other four alone.
 *
 * The bucket facet is deliberately absent from what these reads were narrowed
 * by: this table is the whole classification under the current source and
 * domain, and narrowing it to one bucket would answer a question nobody asked
 * with four blanks.
 */
function bucketStats(
  filter: ClaimsFilter,
  tab: ClaimsTab,
  counts: readonly DbResult<number>[],
  oldest: readonly DbResult<string | null>[],
): BucketStat[] {
  return RENDERABLE_BUCKETS.map((bucket, index) => {
    const claims = counts[index];
    const instant = oldest[index];
    const active = filter.bucket === bucket;
    return {
      bucket,
      claims: claims.kind === "ok" ? claims.data : claims,
      // The oldest instant present, from the database's own order — and null,
      // never "now", when the bucket holds nothing or nothing in it has one.
      oldestObservedAt: instant.kind === "ok" ? instant.data : instant,
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
  // In the order the database returned them, unchanged: the window read is
  // `observed_at asc, observation_id asc` with `.limit(CLAIM_WINDOW)`, so a
  // re-sort here could only disagree with the rows that were selected
  // (admin-window/BUG-0138).
  return claims.map((claim) => ({
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

/*
 * The line beside the filter bar that names the parameters this page did not
 * apply is `DroppedParamsLine` in `src/components/ui/dropped-params.tsx` now
 * (admin-window/BUG-0141): `/queues` renders the SAME sentence, and four bugs
 * have landed on it (BUG-0123/0127/0136/0137), so a copy there would have been
 * born with none of them. It moved WHOLE — markup, both hooks and every word —
 * and this page's use of it below is unchanged.
 */

/** The pending-claims gauge (spec §5, gauge 3 of 6) — the buckets tab's. */
function PendingClaimsGauge({ gauge }: { gauge: PendingClaims }) {
  return (
    <>
      <WindowLine
        gauge={PENDING_WINDOW}
        window={gauge.window}
        measured="Claims observed"
      />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Claims in this window"
          value={gauge.claims}
          floor={gauge.window.truncated}
          sub={`${counted(gauge.sources.length, "source")}, ${counted(
            gauge.domains.length,
            "domain",
          )}`}
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
        The per-source <Identifier>awaiting_row</Identifier>{" "}
        trend lives on Sources, and it is drawn without its threshold line: the{" "}
        <Identifier>stuck_pattern</Identifier>{" "}
        dial is a source-registry value only the scraper repo holds, and where
        Admin may read it is an open question. No default is substituted here.
      </p>
    </>
  );
}

/** The standing-disagreements gauge (spec §5, gauge 5 of 6) — the standing tab's. */
function StandingGauge({ gauge }: { gauge: StandingDisagreements }) {
  // The names map this gauge labels its splits by is the gauge's OWN: each
  // split was built by joining the `sources` rows the gauge itself read, and
  // `source: null` there means that read returned no row for it. So a named
  // split becomes an entry and an unnamed one contributes nothing, which is
  // exactly the input `sourceLabel` answers with the id (BUG-0158). It is
  // deliberately not the page's registry map: the figures and the labels in
  // this block then come from one read (LESSONS 11), and the label rule has
  // one owner rather than a `??` retyped in the anchor below.
  const names = sourceNamesOf(
    gauge.bySource.flatMap((split) =>
      split.source === null
        ? []
        : [{ source_id: split.sourceId, source: split.source }],
    ),
  );
  return (
    <>
      <WindowLine
        gauge={STANDING_WINDOW}
        window={gauge.window}
        measured="Claims observed"
      />
      <GaugeCard
        label="Live contradictions in this window"
        value={gauge.claims}
        floor={gauge.window.truncated}
        sub={`from ${counted(gauge.bySource.length, "source")}`}
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
            className={IN_PAGE_LINK}
          >
            {sourceLabel(names, split.sourceId)}
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

  // The narrowing, from the URL ALONE — before a single read, because every
  // read below carries it as `.eq()` and none of them may wait for another to
  // learn what to ask (admin-window/BUG-0138; the same rule `/sources` follows
  // for its gauge legs). Each facet is derived by the one derivation its value
  // class owns (`lib/claims/filters.ts`): the bucket from the vocabulary this
  // app declares, the source from the app's uuid grammar, the domain from the
  // free-text one.
  //
  // The standing tab is one bucket's subset, so it carries no bucket facet at
  // all: dropping it here — rather than overriding it at render — is what
  // keeps the chips, the hrefs and the "nothing matched" words telling the
  // same story as the rows, and stops a bucket nobody can see travelling in
  // the URL.
  const asked = filterFrom(params, RENDERABLE_BUCKETS);
  const filter = tab === "standing" ? withFacet(asked, "bucket", undefined) : asked;
  const showsBuckets = tab !== "standing";

  // The three narrowings the reads take. The LIST's is the tab's own subset;
  // the bucket TABLE's drops the bucket facet, because that table answers "how
  // many claims in every bucket, for this source"; the POPULATION's is the
  // tab's subset with no facet at all — fact 2 of the four-state rule.
  const listFilter: ClaimsFilter =
    tab === "standing" ? { ...filter, bucket: STANDING_BUCKET } : filter;
  const tableFilter = withFacet(filter, "bucket", undefined);
  const populationFilter: ClaimsFilter =
    tab === "standing" ? { bucket: STANDING_BUCKET } : {};
  // Fact 1, from the URL: can a facet of this URL remove a claim at all
  // (`lib/url/narrowing.ts`)? It also decides whether the population count is
  // ISSUED: `isSurfaceNarrowed` ANDs the two facts, so where fact 1 is false
  // no count could change a word this page renders, and the read `/queues`
  // skips for the same reason is skipped here too (admin-window/DEBT-0012).
  const structural = hasNarrowingFacet(filter);
  // The two halves of "what narrowed this page, and can the operator SEE it"
  // (admin-window/BUG-0160). Both are facts of the URL alone, so they are
  // established here beside `structural` and handed to every sentence below:
  // one page-wide answer, so the window line, the bucket caption and the empty
  // card cannot come to disagree about which narrowings are in force.
  const chipped = hasChipNarrowing(filter);
  const narrowings = unchippedNarrowings(filter);

  // ONE composition, every leg independent (§4.3, the interface contract of
  // admin-window/BUG-0138). Nothing here is sequenced: no leg needs an id, a
  // name or a count from another, so the page's read DEPTH is one round trip —
  // plus the gauge's own second leg, which is the gauge's shape and not this
  // page's.
  const [rows, total, perBucket, oldest, registry, pending, standing, population] =
    await Promise.all([
      readClaimWindow({ filter: listFilter, limit: CLAIM_WINDOW }),
      // The count the LIST's window line states — under the same narrowing the
      // window read carried, so the sentence and the rows describe one set. On
      // the buckets tab it is also the bucket table's own figure, and where a
      // bucket facet is set the list's count is that bucket's count below
      // rather than a second identical request.
      readClaimCount(showsBuckets ? tableFilter : listFilter),
      showsBuckets
        ? Promise.all(
            RENDERABLE_BUCKETS.map((bucket) =>
              readClaimCount({ ...tableFilter, bucket }),
            ),
          )
        : null,
      showsBuckets
        ? Promise.all(
            RENDERABLE_BUCKETS.map((bucket) => readBucketOldest(bucket, tableFilter)),
          )
        : null,
      // The registry is BOTH jobs now (admin-window/BUG-0138): what each source
      // is called, and which sources the chip row offers. It cannot be
      // `readSourceNames(ids)` any more — the page no longer knows which ids to
      // ask for until the list read returns, and asking afterwards would put
      // the sequential round trip back. So the chips are every REGISTERED
      // source, a source holding no claim included, carrying a real zero.
      //
      // A refusal here costs the LABELS and the chip vocabulary and nothing
      // else, so it is carried beside the list rather than replacing it: every
      // claim still renders, named by its id verbatim.
      readSources(),
      showsBuckets ? readPendingClaims({ filter: gaugeFilter(filter) }) : null,
      showsBuckets ? null : readStandingDisagreements({ filter: gaugeFilter(filter) }),
      structural ? readClaimCount(populationFilter) : null,
    ]);

  const names = sourceNamesOf(registry.kind === "ok" ? registry.data : []);
  const labelOf: FacetLabel = (facet, value) =>
    facet === "source_id" ? sourceLabel(names, value) : value;

  const options = {
    bucket: RENDERABLE_BUCKETS,
    // The chips read in the order their LABELS sort, so this facet reads the
    // same here as the identical one on `/sources` instead of in uuid order
    // (LOOK_AND_FEEL: the anatomy does not change between screens). The id
    // breaks a tie, so the order is total.
    source_id: (registry.kind === "ok" ? registry.data : [])
      .map((source) => source.source_id)
      .sort((a, b) => {
        const left = sourceLabel(names, a);
        const right = sourceLabel(names, b);
        if (left !== right) return left < right ? -1 : 1;
        return a < b ? -1 : 1;
      }),
  };

  // The count of the set the LIST renders. Where a bucket facet is set that
  // set IS one bucket, so the read issued for that bucket's row answers both
  // surfaces — one query, one figure, never two reads of one question
  // (LESSONS 11).
  const listCount: DbResult<number> =
    (filter.bucket !== undefined && perBucket !== null
      ? perBucket[RENDERABLE_BUCKETS.indexOf(filter.bucket as PendingClaimBucket)]
      : undefined) ?? total;

  // The list's own answer to the four-state question: the URL's structural
  // narrowing AND whether this tab's set holds anything at all. With a
  // population of zero no facet removed a row, so no facet may be given as the
  // reason the list is empty — "the standing tab holds no disagreements" and
  // "your filter matched nothing" are different facts and never share a
  // rendering (LOOK_AND_FEEL, the four states; admin-window/BUG-0133).
  //
  // Both figures are COUNTS the database gave. Where either refused, this
  // falls back to the structural rule alone and says so on its own sub-surface
  // below, rather than claiming a scope no read supports — the shape
  // admin-window/BUG-0135 landed on `/queues`.
  const listNarrowed =
    population !== null && population.kind === "ok" && listCount.kind === "ok"
      ? claimsNarrowed(filter, {
          rendered: listCount.data,
          population: population.data,
        })
      : structural;
  const emptyWords: { holds: ReactNode; filledBy: ReactNode } = listNarrowed
    ? narrowedEmpty(narrowings, chipped)
    : tab === "standing"
      ? NOTHING_STANDING
      : NOTHING_HELD;

  // The bucket table's own answer, over ITS set: the whole view against what
  // it is drawing, which is the view under the source and domain facets only —
  // the bucket facet removes not one row from this table and cannot be what
  // narrowed it.
  const bucketRows =
    perBucket !== null && oldest !== null
      ? bucketStats(filter, tab, perBucket, oldest)
      : [];
  const bucketsNarrowed =
    population !== null && population.kind === "ok" && total.kind === "ok"
      ? claimsNarrowed(filter, { rendered: total.data, population: population.data })
      : structural;

  // The one leg whose refusal is reported beside the surfaces it feeds rather
  // than as a surface's own state: it renders no row, and decides only which
  // arm two sentences take (admin-window/BUG-0135).
  const populationRefused =
    population === null || population.kind === "ok" ? undefined : population;

  // The rows the list draws — the window read's own rows, in the order the
  // database returned them, named from the registry read.
  const listed = rows.kind === "ok" ? claimLines(rows.data, names) : [];

  return (
    <Page title="Claims">
      <ClaimTabs tabs={tabLinks(CLAIMS_PATH, filter, tab)} />
      <FilterBar
        facets={filterBar(CLAIMS_PATH, filter, tab, options, labelOf)}
        // The exit, on the bar rather than in the empty card: a narrowing this
        // page renders no chip for is un-clearable in every state it reaches,
        // not only the one where it emptied the list (admin-window/BUG-0161).
        // It is `null` where the URL narrowed nothing, so the row appears
        // exactly where there is something to clear.
        clear={clearNarrowing(CLAIMS_PATH, filter, tab)}
      />
      <DroppedParamsLine
        dropped={droppedParams(params, filter, [UNRENDERABLE_BUCKET])}
      />

      {showsBuckets ? (
        <Section title="Buckets" surface={BUCKETS_SURFACE}>
          {/* The table's own state is the count read over the SAME object
              under the SAME narrowing its figures are figures of — the total.
              A view that is not in this database answers every one of these
              reads the same way, so the card replaces the surface once rather
              than ten times (LOOK_AND_FEEL state 3); a failure of that read is
              a line inside the table, so the header stays put. A per-BUCKET
              count that refused is neither: it is rendered in its own row,
              beside four that answered (admin-window/BUG-0138). */}
          {total.kind === "not_provisioned" ? (
            <StateOf result={total} />
          ) : (
            <>
              <BucketTable
                label="Claims by bucket"
                rows={bucketRows}
                line={total.kind === "error" ? <StateOf result={total} /> : undefined}
              />
              {/* The caption follows the READ, exactly as the list's window
                  line one Section down does (ARCHITECTURE.md §4.3, "a window
                  line states a read that HAPPENED"; admin-window/BUG-0063,
                  admin-window/BUG-0070, admin-window/BUG-0144). Both arms say
                  what the figures in this table are figures OF, so over a read
                  that refused they describe counts nobody produced: the table
                  draws no bucket row and no count hook, and the sentence still
                  claims it lists every bucket with every claim in it. Worse
                  under a facet — a refusal empties both sides of
                  `bucketsNarrowed`, so the unnarrowed arm is the one that
                  renders and its "nothing above narrows these counts" denies a
                  facet the chip bar shows as applied. The refusal inside the
                  table is the whole of what this state may say. */}
              {total.kind === "ok" ? (
                <BucketCaption
                  narrowed={bucketsNarrowed}
                  narrowings={narrowings}
                  chipped={chipped}
                />
              ) : null}
            </>
          )}
        </Section>
      ) : null}

      <Section title={LIST_TITLE[tab]} surface={LIST_SURFACE}>
        {/* The window line follows the READ, not the rows (ARCHITECTURE.md
            §4.3, admin-window/BUG-0070): it describes a window this page
            actually looked in, so it stands on every `ok` read — with rows or
            with none — and on no other state. A refused or absent read looked
            nowhere, so the line would describe a table that is not there and
            publish a `0` an honest empty read is then indistinguishable from;
            an EMPTY window is still a window, and its line stands BESIDE the
            Empty card below rather than instead of it — the card says what
            would fill the surface, the line says where the app looked. Same
            rule and same shape as `/runs` (admin-window/BUG-0063,
            LOOK_AND_FEEL states 3 and 4).

            Two reads have to have happened for it to stand now, not one: the
            window, and the COUNT that is its `held`. A count this page never
            got is not a number it may print, and it may not print the rows'
            own length instead — that is the window-as-total substitution the
            line exists to prevent — so a refused count costs the LINE and
            nothing else, and says so on its own sub-surface below. */}
        {rows.kind === "ok" && listCount.kind === "ok" ? (
          <WindowLine
            gauge={LIST_WINDOW}
            window={{
              limit: CLAIM_WINDOW,
              held: listCount.data,
              // The window is truncated exactly when the set it was drawn from
              // holds more than it drew — from the COUNT, never from the rows,
              // which is how a `limit 50` read that returned 50 rows says
              // whether a 51st exists (admin-window/BUG-0138).
              truncated: listCount.data > rows.data.length,
              over: CLAIMS_OBJECT,
              // No floor to name, and that is a fact of this read rather than
              // a gap: the list is drawn LONGEST-WAITING first, so its bottom
              // row is the newest claim it holds and never its oldest. A
              // window that did not fill still says it holds every claim the
              // read found; it just has no "nothing earlier" to state
              // (admin-window/BUG-0109).
              oldest: null,
              // What the READS below narrowed to, from the same tab and the
              // same filter they carried (admin-window/BUG-0114).
              scope: listScope(tab, listNarrowed, narrowings, chipped),
            }}
            // The page words its own subject and nothing about the read: the
            // arm ends on what the window is not showing, which needs no state
            // this file knows. It used to hand down a way to REACH the held-back
            // rows in the one state the shared clause could not be said in
            // (admin-window/BUG-0160); no state of this page can reach them at
            // all — the list is a hard `CLAIM_WINDOW` window and the narrowest
            // state the chip rows offer still held 108 claims against 50 rows
            // (measured on staging 2026-09-10) — so both wordings were removed
            // rather than one chosen (admin-window/BUG-0162).
            shows={{ of: "matched", lede: SORT_STATEMENT, rows: "claims" }}
          />
        ) : null}
        {rows.kind === "not_provisioned" ? (
          <StateOf result={rows} />
        ) : rows.kind === "ok" && rows.data.length === 0 ? (
          // Three different emptinesses, three different renderings: the table
          // that holds nothing, the filter that matched nothing, and the table
          // that is not in this database (LOOK_AND_FEEL, Emptiness). The hook
          // says WHICH — the spelling `/sources` and `/queues` already carry
          // (`data-empty`), so the two are told apart structurally and not by
          // reading the copy, and one test grades the rule on all three
          // surfaces at once (admin-window/DEBT-0008).
          <div data-empty={listNarrowed ? "narrowing" : LIST_SURFACE}>
            <Empty holds={emptyWords.holds} filledBy={emptyWords.filledBy} />
          </div>
        ) : (
          <ClaimList
            label={LIST_TITLE[tab]}
            rows={rows.kind === "ok" ? listed : []}
            line={rows.kind === "error" ? <StateOf result={rows} /> : undefined}
          />
        )}
        {registry.kind === "ok" ? null : (
          // The claims rendered fine, or did not; either way what NAMES their
          // sources is its own read of its own object, so it is reported on
          // its own — never folded into the list's state and never silent.
          // Every row above is named by its id verbatim, and the chip row
          // offers the vocabulary this read did not bring.
          <StateOf result={registry} eyebrow="Source names" />
        )}
        {/* Two counts that render no row of their own, each reported beside
            the rows rather than instead of them (admin-window/BUG-0135). The
            first is the list's own `held`; the second is the unnarrowed
            population, which decides only which of two sentences and which of
            two empty cards this surface shows. */}
        {rows.kind === "ok" && listCount.kind !== "ok" ? (
          <div data-surface={LIST_COUNT_SURFACE}>
            <StateOf result={listCount} eyebrow={LIST_COUNT_EYEBROW} />
          </div>
        ) : null}
        {populationRefused === undefined ? null : (
          <div data-surface={POPULATION_SURFACE}>
            <StateOf result={populationRefused} eyebrow={POPULATION_EYEBROW} />
          </div>
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
