import type { EvidenceCanonical } from "@/components/evidence/evidence-pair";
import type { EmptyWords, GaugeState } from "@/components/gauges";
import {
  DIAL_BY_SHAPE,
  EVIDENCE_VIEW_BY_SHAPE,
  ItemHeader,
  claimValueText,
  type DialProps,
  type EvidenceRow,
  type ItemLink,
} from "@/components/review";
import type { ShapeChoices } from "@/components/review/close/actions";
import { linkableFact } from "@/components/review/close/link-actions";
import {
  ACTIONS_BY_SHAPE,
  CloseSlot,
  NOTICE_BY_SHAPE,
  type CloseVerdict,
} from "@/components/review/close/slot";
import { ARRIVES_WITH, Empty, Page, RETRY, Section, StateOf } from "@/components/ui";
import { claimsHref, sourceHref } from "@/lib/claims/filters";
import { readPendingClaims, type PendingClaimRow } from "@/lib/db/claims";
import { isRecordId, readLinkChoices } from "@/lib/db/records";
import type { DbResult, DbUnavailable } from "@/lib/db/result";
import {
  readItemEvidence,
  readReviewItem,
  type CanonicalSide,
  type ItemEvidence,
  type ResolvedClaim,
} from "@/lib/db/review-item";
import { T } from "@/lib/db/tables";
import {
  readItemVerdict,
  readSettlementReadiness,
  type ItemVerdict,
} from "@/lib/db/verdict";
import { count, counted, relativeAge } from "@/lib/format";
import {
  readAwaitingRowTrend,
  stuckPatternThreshold,
  type AwaitingRowTrend,
} from "@/lib/gauges/pending-claims";
import { recordHref } from "@/lib/records/routes";
import { kindOfItem, shapeOf, type ReviewItemRow } from "@/lib/review/shapes";
import { sourceLabel } from "@/lib/sources/names";
import { factKey } from "@/lib/verdict/decision";

/**
 * A review item, rendered — **three typed views over one anatomy** (campaign
 * admin-window/TASK-0011).
 *
 * Authority: spec §6 in full, `contracts/resolver.md` §11,
 * `contracts/data-model.md` (the observation envelope, per-field provenance),
 * SPEC F4, M1 EC7, acceptance test 5, LOOK_AND_FEEL "The evidence pair — this
 * app's signature" and "Key screens — Review item detail".
 *
 * The anatomy, in order down the page:
 *
 *  1. **what happened** — the summary sentence, severity, age, and
 *     `folded_count` as "asked again ×N" (`ItemHeader`);
 *  2. **the close** — spec §7's verdict actions, rendered by
 *     `CloseSlot` (`src/components/review/close/slot.tsx`, campaign
 *     admin-window/TASK-0049). What it offers is decided by ONE read,
 *     `readSettlementReadiness`: with the verdict log absent — the normal case
 *     for the whole of M2 — it draws the not-provisioned card naming that
 *     object and offers no control at all, and nothing on this page settles
 *     anything. Every action it ever offers becomes one typed decision and one
 *     call to `settle_review_item`, through the route this page never touches
 *     (`src/app/api/admin/review-items/[reviewItemId]/settle/route.ts`).
 *     A SETTLED item's own verdict renders inline there instead of a control
 *     (spec F13, campaign admin-window/TASK-0059) — read by id through
 *     `readItemVerdict`, so the investigation ends where the decision was made
 *     rather than at the log tab. An unsettled item renders no verdict block.
 *
 *     **It renders ABOVE the evidence** (campaign admin-window/BUG-0096). The
 *     close used to be last, which on the shape staging really holds put it
 *     3,483px — four screenfuls at 1440x900 — under the evidence it closes, so
 *     the operator had to exhaust 91 folded records to reach the controls that
 *     settle the item. LOOK_AND_FEEL, Key screens, asks for "the evidence
 *     pair, and the close beside it"; of the placements that satisfy that bar
 *     this is the one that costs the evidence views nothing — the close leads
 *     in document order and neither view's markup, width or internal grid
 *     changes. Being decided here rather than inside a view is what makes it
 *     hold identically for all three shapes.
 *  3. **evidence, side by side** — every id in `review_items.evidence`
 *     resolved to its claim (value, source, tier, `observed_at`, payload
 *     pointer) with the fact's current canonical value and provenance beside
 *     them, in the shape's own view (`EVIDENCE_VIEW_BY_SHAPE`). It is the
 *     unbounded part of this page — one row per fold, and a signal folds
 *     hundreds of times — which is exactly why nothing an operator must reach
 *     sits after it.
 *
 * The recommendation slot sits between 1 and the close and renders nothing
 * either — its producer is parked (spec §6, "the anatomy's recommendation slot
 * … exists in the contract and renders nothing until the first recommender
 * ships").
 *
 * **No `notFound()`, by ruling** (admin-window/BUG-0017, ARCHITECTURE.md §5):
 * a review-item id is DATA, not an enum this app owns, so a dynamic segment
 * that matches it must RESOLVE every URL it matches. An id that names no row
 * is one of this surface's own states — rendered at 200, naming the id
 * verbatim in mono and saying it is not in `review_items` — and never a
 * routing outcome. On Next 16.2.2 a `notFound()` thrown here would serve the
 * unstyled error shell instead of the app. A segment that is no id AT ALL is a
 * second state of the same kind and is settled before any read at all
 * (`NOT_AN_ID` below, admin-window/BUG-0076).
 *
 * **It derives nothing of its own**: `shapeOf` and `kindOfItem`
 * (`src/lib/review/shapes.ts`) are the app's only spellings of shape and kind
 * (spec §6, "the kind belongs to the shape and is derived in code — no column
 * carries it"), and the view is selected by a `Record<Shape, …>` so a fourth
 * shape fails to compile rather than falling through to a decision's layout
 * (ARCHITECTURE.md §6 trap 11).
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, and every child is a pure sync
 * component over plain props — which is what lets the offline suite render
 * `renderToStaticMarkup(await ReviewItemPage(props))` with no jsdom and no
 * database, and the live suite compare its evidence with rows the test fetches
 * itself.
 */

/**
 * Every read here happens per request against the live database, so the route
 * renders per request rather than being prerendered at build
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
 * "Route segment config"). A page prerendered at build, where the app has no
 * credential, would ship a FROZEN error state that never re-reads. Cache
 * Components is not enabled in `next.config.ts`, so this option is live on
 * Next 16.2.2.
 */
export const dynamic = "force-dynamic";

/** The Claims page, which every "its claims" link narrows. */
const CLAIMS_PATH = "/claims";

/**
 * Where a review-item id comes from — the ONE recovery sentence the two
 * emptinesses of this address share.
 *
 * Both the row this database does not hold and the segment that can be no id
 * end with the same advice, so it is written once: two copies drift, and the
 * pair that shares advice is exactly the pair an operator compares
 * (the record page keeps its own single copy for the same reason,
 * `foundBy` in `src/app/records/[table]/[id]/page.tsx`, admin-window/BUG-0052).
 */
const FOUND_BY =
  "Queues lists the items this database holds; check the id in the address bar.";

/**
 * The table's name, in the face the machine's own words get on this page —
 * campaign admin-window/BUG-0121.
 *
 * `review_items` is an identifier the database produced, so wherever this
 * page's prose says it, it is drawn at the data step in mono, verbatim, case
 * and underscore intact — the same face the id echoed above the card is
 * already drawn in, and the same span `NotProvisioned`
 * (`src/components/ui/not-provisioned.tsx`) and the record page's own
 * `TableName` emit (LOOK_AND_FEEL Voice bar 5). Before this, both empty cards
 * said it in the app's own prose face, one line under that id.
 *
 * File-local on purpose, exactly as `TableName` is on the record page: the
 * `type-data text-ink` identifier-in-prose span is hand-spelled in ~20 places
 * across `src/`, and lifting it into a shared primitive is a ticket of its
 * own, not a change made in passing here (admin-window/BUG-0120's handoff).
 *
 * Only the IDENTIFIER is wrapped. "review item" — two words, the app's own
 * noun for the thing — is prose and stays sans, which is why the cards' first
 * line ("No review item at this address") is untouched.
 */
function ReviewItems() {
  return <span className="type-data text-ink">{T.reviewItems}</span>;
}

/**
 * What answers a queues URL whose segment is not a review-item id at all —
 * campaign admin-window/BUG-0076.
 *
 * The state before this one was the READ-FAILED line over "Reload to try the
 * read again": `review_items.review_item_id` is a `uuid`, so PostgREST handed
 * the segment to Postgres, which refused the comparison (`22P02 invalid input
 * syntax for type uuid`), the data layer classified that correctly as an
 * arbitrary failure, and the surface offered the operator the one action that
 * can never work — a reload re-sends the same segment forever.
 *
 * It is the EMPTY state and not a fifth one, for the reasons `isRecordId`
 * (`src/lib/db/records.ts`) and the record page's own answer already carry:
 * nothing failed, no query was issued, the table is there, and a segment that
 * is not a uuid can equal no uuid key — so "no such item" is true here with
 * certainty rather than on a read's say-so.
 *
 * Its WORDS are its own, and that is the point of the state rather than a
 * flourish: the empty card below means "the table answered and holds no such
 * row", which is a different fact, and the Look separates emptinesses by their
 * words alone ("an empty bucket, a table with no rows, and an unprovisioned
 * table are three different states and never share a rendering"). What stands
 * in front of the shared advice is this state's own business — what is wrong
 * with the address and what a correct one looks like — so an operator whose
 * paste dropped a character, or carried a trailing space the address bar
 * renders as nothing at all, can see it. The id itself is NOT quoted back into
 * this sentence: it is already above, verbatim in mono, and a trailing space
 * quoted mid-sentence is invisible exactly where it matters.
 */
const NOT_AN_ID = (
  <>
    {`The address bar does not hold an id: `}
    <ReviewItems />
    {` ids are uuids, 32 ` +
      `hexadecimal digits usually written in five hyphenated groups. `}
    {FOUND_BY}
  </>
);

/**
 * The name each of this page's graded surfaces answers to — `data-surface`,
 * read by the live parity oracle (`tests/live/review-item.live.test.ts`) and
 * pinned offline by `tests/offline/review-item/page.test.ts`.
 *
 * A NAME, never a position. The header was `section:nth-of-type(1)` and the
 * evidence body `section:nth-of-type(2) > :nth-child(2)` until
 * admin-window/DEBT-0002 — the second compounding this file's section ORDER
 * with the body's position among its section's own children, so that the
 * parked recommendation slot filling in, or one more leg note, repoints it
 * silently. `stateOf` refuses any selector not matching exactly one element,
 * which is how the same class cost `/cycles` four live tests
 * (admin-window/BUG-0040, admin-window/BUG-0056).
 *
 * `evidence` names the BODY — the shape's evidence view, or the state card
 * that replaced it — and not the `<Section>` around it, because that section
 * also carries the legs this page reports beside the evidence (the bucket read
 * and the source registry) and the accounting line. Each leg is its own read
 * with its own object: grading them as one surface makes an unreadable bucket
 * look like unreadable evidence. So the Evidence `<Section>` deliberately
 * takes no `surface` of its own — two elements answering to one name is the
 * failure this attribute exists to prevent.
 */
const HEADER_SURFACE = "what_happened";
const EVIDENCE_SURFACE = "evidence";
/**
 * The close is a graded surface of its own, for the reason the two above are:
 * its state is a different read's (`readSettlementReadiness`), so an oracle
 * that graded it as part of the evidence would report an unprovisioned verdict
 * log as unreadable evidence.
 *
 * A settled item's own verdict is a sub-surface INSIDE it, `item_verdict`,
 * named by the component that renders it (`ITEM_VERDICT_SURFACE`,
 * `src/components/review/close/slot.tsx`) for the same reason once more: its
 * state is `readItemVerdict`'s, so an item settled with no row on record is
 * not a close that failed, and an oracle grading the close excludes it.
 */
const CLOSE_SURFACE = "close";

/**
 * The dial's display window, in days.
 *
 * A choice of THIS PAGE's, stated on screen beside the figures, and not the
 * resolver's pattern window — that number is a source-registry dial in the
 * scraper repo and copying it here is forbidden (spec §10;
 * `src/lib/gauges/pending-claims.ts` holds the empty seam). Two weeks of daily
 * points reads as a dial on a detail page, where the gauge's own 90-day
 * default would be ninety mostly-zero rows beside the evidence.
 */
const DIAL_DAYS = 14;

/** The same refusal, as the gauge components' own state prop. */
function gaugeStateOf(result: DbUnavailable): GaugeState {
  return result.kind === "not_provisioned"
    ? { kind: "not_provisioned", missing: result.missing, arrivesWith: ARRIVES_WITH }
    : { kind: "error", reading: result.reading, failed: result.message, retry: RETRY };
}

/* ── the anatomy, shaped ─────────────────────────────────────────────────── */

/**
 * One resolved claim, as a view renders it.
 *
 * `held` is the classification view's own words — the bucket, and on
 * `awaiting_row` the unmet requirement it names (a missing NOT NULL column, a
 * performer invariant, a curated domain). A claim the view does not carry is
 * `null` rather than a guessed bucket.
 */
function evidenceRow(
  claim: ResolvedClaim,
  buckets: ReadonlyMap<string, PendingClaimRow>,
): EvidenceRow {
  const { observation } = claim;
  const bucket = buckets.get(observation.observation_id);
  const requirement = bucket?.unmet_requirement ?? null;
  return {
    observationId: observation.observation_id,
    value: claimValueText(observation.value),
    source: claim.source,
    sourceHref: sourceHref(observation.source_id),
    tier: claim.tier,
    observedAt: observation.observed_at,
    status: observation.status,
    payloadRef: observation.payload_ref,
    fact: factKey(observation.domain, observation.field),
    recordHref: recordHref(observation.domain, observation.entity_id),
    held:
      bucket === undefined
        ? null
        : requirement === null
          ? bucket.bucket
          : `${bucket.bucket}: ${requirement}`,
  };
}

/**
 * The canonical card — the fact's current value and the decision behind it.
 *
 * Three things it must not blur (ARCHITECTURE.md §6 traps 5 and 7):
 *  - the tier here is `tier_at_apply`, FROZEN at the apply, and the line says
 *    "at apply" so it cannot be read as the source's tier today;
 *  - a decision whose winning claim is no longer live leaves NO current value:
 *    the card shows the dash and the line says which status the claim now
 *    carries, rather than showing a value canonical does not stand behind;
 *  - an unset decision names no source at all, and says so instead of
 *    borrowing one.
 *
 * The lock flag the decision log also carries is not shown here; see
 * `src/lib/db/review-item.ts` for why it is not even read.
 *
 * `null` means there is no fact to have a canonical value — a per-source item.
 */
function canonicalCard(side: CanonicalSide): EvidenceCanonical | null {
  if (side.kind === "no_fact") return null;
  if (side.kind === "no_row") {
    return {
      value: null,
      provenance: "no canonical row yet — this record has not been created",
    };
  }
  if (side.kind === "no_decision") {
    return { value: null, provenance: "nothing has been applied to this field yet" };
  }

  const { decision, source, observation, live } = side.decided;
  const applied = relativeAge(decision.applied_at);
  const parts = [
    source ?? "no winning claim",
    `${decision.tier_at_apply} at apply`,
    `applied ${applied.text}`,
  ];
  if (!live) {
    parts.push(
      observation === null
        ? "the claim it applied is not in this database"
        : `the claim it applied is now ${observation.status}`,
    );
  }
  return {
    value: live && observation !== null ? claimValueText(observation.value) : null,
    provenance: parts.join(" · "),
  };
}

/**
 * Where this investigation continues (LOOK_AND_FEEL bar 10, SPEC F4: "an
 * investigation never leaves the app").
 *
 * Every link is real or absent — never a link to something that does not
 * exist. A per-fact item has no single source, so its source links live on the
 * evidence rows, one per contending claim; an `entity_link` fact item has no
 * record link because its record is exactly what does not exist yet, and the
 * canonical card says so in the same words.
 *
 * **A source link says the source's NAME** (admin-window/BUG-0043). Both links
 * a source-pattern item carries are narrowed by `source_id`, and both used to
 * print that uuid — while the evidence cells directly below, pointing at the
 * SAME href, read `ticketmaster`. The names come from the evidence read's one
 * registry map, so the two labels are the same string by construction; an id
 * the registry answered nothing for renders verbatim, which is then the only
 * true thing the page can say about it.
 */
function linksOf(
  item: ReviewItemRow,
  names: ReadonlyMap<string, string>,
): ItemLink[] {
  const links: ItemLink[] = [];
  if (item.source_id !== null) {
    const source = sourceLabel(names, item.source_id);
    links.push({
      label: "Its claims",
      href: claimsHref(CLAIMS_PATH, { source_id: item.source_id }),
      value: source,
    });
    links.push({
      label: "Its source",
      href: sourceHref(item.source_id),
      value: source,
    });
  } else if (item.domain !== null) {
    links.push({
      label: "Its claims",
      href: claimsHref(CLAIMS_PATH, { domain: item.domain }),
      value: item.domain,
    });
  }

  const record =
    item.domain === null ? null : recordHref(item.domain, item.entity_id);
  if (record !== null && item.entity_id !== null) {
    links.push({
      label: "Its record",
      href: record,
      value: `${item.domain}/${item.entity_id}`,
    });
  }
  return links;
}

/**
 * The evidence block's accounting sentence — resolved over the ids the read
 * actually looked at.
 *
 * **Both figures come from `evidence.ids`**, the read's one accounting, so
 * they cannot disagree: `claims + unresolved === ids.distinct` holds by
 * construction, and every id the sentence says went unresolved is named below
 * it. Dividing the deduplicated claim count by `review_items.evidence.length`
 * is what made `[A, A, B]` report "2 of 3 resolved" while naming no unresolved
 * id (admin-window/BUG-0021).
 *
 * A repeat is not hidden by counting distinct ids, it is stated: `evidence` is
 * appended to on every fold (`contracts/resolver.md` §11) and has no
 * uniqueness, so an operator comparing the array with this sentence is told
 * why the two lengths differ instead of being left to wonder.
 */
function accountingOf(evidence: ItemEvidence): string {
  const { stored, distinct } = evidence.ids;
  const resolved = `${count(evidence.claims.length)} of ${counted(distinct, "evidence id")} resolved to a claim, in the order they folded in.`;
  return stored === distinct
    ? resolved
    : `${resolved} It stores ${count(stored)} ids in all: a claim that folded in again is appended, and counts once here.`;
}

/** The words for an evidence block with nothing in it — the reason decides them. */
function emptyWords(evidence: ItemEvidence): EmptyWords {
  return evidence.unresolved.length > 0
    ? {
        holds: "claims behind this item's evidence ids",
        filledBy:
          "Every id it carries is listed below, and none of them names a row this database holds.",
      }
    : {
        holds: "claims on this item",
        filledBy:
          "The resolver appends an observation id to `evidence` each time this item folds; this one carries none.",
      };
}

/**
 * The dial's props, from the per-source trend the gauge aggregated.
 *
 * `name` is the source as an operator reads it when one of its own claims is
 * on this page to carry the name, and the id verbatim otherwise — never a
 * name this app did not read.
 */
function dialProps(
  sourceId: string,
  name: string,
  trend: DbResult<AwaitingRowTrend>,
): DialProps {
  // The source name is the machine's own value: it goes into the eyebrow as an
  // identifier, so it renders verbatim in mono rather than being uppercased
  // into `TICKETMASTER STUCK RECORDS` by the sans `micro` step
  // (LOOK_AND_FEEL Voice bar 5; admin-window/BUG-0049).
  const label = { identifier: name, words: "stuck records" };
  const empty: EmptyWords = {
    holds: "days with a stuck record in this window",
    filledBy:
      "A record of this source misses its creation bar, and the day it was claimed appears here.",
  };
  if (trend.kind !== "ok") {
    return { label, series: null, window: null, empty, state: gaugeStateOf(trend) };
  }
  const series = trend.data.series.find((one) => one.sourceId === sourceId);
  return {
    label,
    series: {
      // No series means this source has no stuck record in the window: a real
      // zero, not an absence.
      claims: series?.claims ?? 0,
      points: series?.points ?? [],
      // The seam, asked rather than assumed. Null every call today.
      threshold: series?.threshold ?? stuckPatternThreshold(sourceId),
    },
    window: trend.data.window,
    empty,
  };
}

/**
 * The verdict this item was settled with, as the close slot takes it (spec
 * F13's second half, campaign admin-window/TASK-0059).
 *
 * `null` in, `null` out, and it is the load-bearing case: it means the read
 * was NEVER MADE — an open item was settled by nothing, and a database without
 * the log has no row to hold one — so the block renders nothing at all rather
 * than an empty slot claiming an absence it never looked for (LESSONS 1, and
 * the same rule a missing window line states, ARCHITECTURE.md §4.3).
 *
 * Where the observation resolved, its link is the RECORD surface of the fact
 * it is about — the one place a rendered observation already leads in this app
 * (`components/queues/verdict-log.tsx`, `components/claims/claim-list.tsx`).
 * There is no observation-addressable URL, so an id the leg could not place
 * arrives with a null href and the block renders it verbatim.
 */
function settledWith(read: DbResult<ItemVerdict | null> | null): CloseVerdict | null {
  if (read === null) return null;
  if (read.kind !== "ok") return read;
  if (read.data === null) {
    return { kind: "ok", verdict: null, factUnavailable: null };
  }

  const { verdict, fact, factUnavailable } = read.data;
  return {
    kind: "ok",
    verdict: {
      action: verdict.action,
      actor: verdict.actor,
      note: verdict.note,
      createdAt: verdict.created_at,
      observationId: verdict.observation_id,
      observationHref:
        fact === null ? null : recordHref(fact.domain, fact.entity_id),
    },
    factUnavailable,
  };
}

/**
 * The rows this item's fact may be linked to, or null when no read was made —
 * the close's link control's whole database side (campaign
 * admin-window/TASK-0056, SPEC F10's first action).
 *
 * **Four narrowings before a query, and each one is a reason not to read:**
 *
 *  - the verdict log is absent or refused, so NO control renders at all and a
 *    window nobody can choose from is a round trip nobody asked for. That is
 *    the graded normal case for the whole of M2;
 *  - the item is already settled, so the close offers its verdict instead;
 *  - the item names no whole reference fact — `linkableFact`, the ONE
 *    predicate, imported rather than re-spelled here (common violation 9): an
 *    `entity_link` item opened before its canonical row exists has nothing to
 *    link, and that is the ordinary state of one;
 *  - the map does not call that field a reference of that table, so this app
 *    has no search for the rows behind it — asked and answered inside
 *    `readLinkChoices`, which makes no query in that case.
 *
 * Past all four it is the same read the record surface's picker makes, through
 * the same one seam, so the two surfaces choose from the same window.
 */
async function linkableChoices(
  item: ReviewItemRow,
  readiness: DbResult<unknown> | { kind: "ok" } | DbUnavailable,
): Promise<ShapeChoices | null> {
  if (readiness.kind !== "ok" || item.status === "settled") return null;

  const fact = linkableFact(item);
  if (fact === null) return null;

  // The fact -> table lookup and the read itself are both the data layer's
  // (`readLinkChoices`): the one edit map is declared once and read by its own
  // consumers, and a page reaching into it directly is the second allowlist
  // `tests/offline/edit/config.test.ts` refuses to let grow. A domain that map
  // does not call a reference of this field answers with nothing to show and
  // nothing to report, having made no query.
  const choices = await readLinkChoices(fact.domain, fact.field);
  return { window: choices.window, note: choices.note };
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default async function ReviewItemPage({
  params,
}: {
  /** Next 16 hands dynamic segments over as a promise. */
  params: Promise<{ reviewItemId: string }>;
}) {
  const { reviewItemId } = await params;

  // The identity of what was asked for, rendered whatever the read did — and
  // whether or not a read happened at all: an operator looking at a refusal
  // still needs to know which item they opened.
  const identity = (
    <p data-review-item={reviewItemId} className="type-data text-ink-secondary">
      {reviewItemId}
    </p>
  );

  // The segment is not an id at all, which is a question about the REQUEST and
  // is settled here, BEFORE any read (`isRecordId`, `src/lib/db/records.ts`,
  // carries the grammar and why it is Postgres's own; `NOT_AN_ID` carries what
  // this state says). Asking it first is the fix and not an optimisation: it
  // is what keeps one bad address to ONE answer, where the item read, the
  // evidence legs and the dial below would each report the same refusal
  // separately — and it means no query is issued for a value no row can carry
  // (admin-window/BUG-0076).
  if (!isRecordId(reviewItemId)) {
    return (
      <Page title="Review item">
        {identity}
        <Empty
          holds="review item at this address"
          filledBy={NOT_AN_ID}
          eyebrow="Review item"
        />
      </Page>
    );
  }

  const item = await readReviewItem(reviewItemId);

  if (item.kind !== "ok") {
    return (
      <Page title="Review item">
        {identity}
        <StateOf result={item} eyebrow="Review item" />
      </Page>
    );
  }

  if (item.data === null) {
    // The table answered and holds no such row. A state of this surface, at
    // 200 — not a routing outcome (admin-window/BUG-0017).
    return (
      <Page title="Review item">
        {identity}
        <Empty
          holds={
            <>
              {`row with that id in `}
              <ReviewItems />
            </>
          }
          filledBy={FOUND_BY}
          eyebrow="Review item"
        />
      </Page>
    );
  }

  const row = item.data;
  const shape = shapeOf(row);
  const kind = kindOfItem(row);
  const evidence = await readItemEvidence(row);

  // The bucket a claim sits in, for the shapes whose evidence is about being
  // STUCK. One read of the classification view, through the module that owns
  // every query of it, so the parked bucket stays excluded (§6 trap 4).
  const claimIds =
    evidence.kind === "ok"
      ? evidence.data.claims.map((claim) => claim.observation.observation_id)
      : [];
  const buckets = await readPendingClaims(claimIds);

  // What every source on this page is called — one map, from the evidence
  // read's single registry query, so the header link, the evidence cells and
  // the dial cannot label one source three ways (admin-window/BUG-0043). An
  // evidence read that refused resolved no name at all, and every id then
  // renders verbatim rather than being guessed at.
  const names =
    evidence.kind === "ok" ? evidence.data.sourceNames : new Map<string, string>();

  // The per-source dial, only for the shape whose view carries one.
  const dialSource = DIAL_BY_SHAPE[shape] ? row.source_id : null;
  const trend =
    dialSource === null
      ? null
      : await readAwaitingRowTrend({
          days: DIAL_DAYS,
          filter: { source_id: dialSource },
        });

  // May this surface offer a settlement at all? ONE question, asked through
  // the one helper that owns it (ARCHITECTURE.md §9.2; a page asking it for
  // itself is the hand-copied probe common violation 9 forbids). Its absent
  // answer is the normal one for the whole of M2 and is what the close slot
  // renders today.
  const readiness = await readSettlementReadiness();

  // WHICH verdict settled this item — asked only where there is an answer to
  // have (spec F13's second half, campaign admin-window/TASK-0059). An OPEN
  // item was settled by nothing, and a database whose log is absent has no row
  // to hold one and has already said so in the card above; either way this
  // read never happens and the block renders nothing, which is what its
  // absence means here exactly as a missing window line means it elsewhere
  // (ARCHITECTURE.md §4.3). It is a by-id read through the one module that
  // owns this object — a page spelling its own query is common violation 9.
  const verdict =
    readiness.kind === "ok" && row.status === "settled"
      ? await readItemVerdict(row.review_item_id)
      : null;

  // The SIXTH leg, and the narrowest: the rows this item's reference fact may
  // be LINKED to (campaign admin-window/TASK-0056, spec §7's "link to an
  // existing entity"). Read only where a picker could be drawn at all — an
  // `entity_link` FACT item, still open, naming a whole reference fact
  // (`linkableFact`, the one predicate, never a copy of it here), on a table
  // whose map entry calls that field a reference — so the graded normal case,
  // an absent verdict log, makes no venue read at all and shows no card for
  // one. A refused read costs the PICKER and nothing else: the settle control,
  // the evidence and every other leg stay exactly as they were, and
  // `linkNotice` says on screen why the picker is missing.
  const linkChoices: ShapeChoices | null = await linkableChoices(row, readiness);

  const EvidenceView = EVIDENCE_VIEW_BY_SHAPE[shape];
  const bucketById = new Map(
    (buckets.kind === "ok" ? buckets.data : []).map((claim) => [
      claim.observation_id,
      claim,
    ]),
  );

  // The evidence, shaped once: the view below renders it, and the shape's
  // action list is built from it — `data_conflict`'s first action is one
  // control per evidence card (spec §7), so the two must be the same rows.
  const evidenceRows =
    evidence.kind === "ok"
      ? evidence.data.claims.map((claim) => evidenceRow(claim, bucketById))
      : [];

  return (
    <Page title="Review item">
      {identity}

      <Section title="What happened" surface={HEADER_SURFACE}>
        <ItemHeader
          item={row}
          kind={kind}
          shape={shape}
          links={linksOf(row, names)}
        />
      </Section>

      {/* The recommendation slot. It exists in the anatomy and renders nothing
          in M1: its producer — the specialist's proposed action, rationale and
          confidence — is parked (spec §6). Its place is still directly under
          what happened; what moved beneath it is the close, not this slot. */}

      {/* The close (spec §7), ABOVE the evidence it closes — campaign
          admin-window/BUG-0096. Placement is the whole of what that ticket
          moved: the slot renders before `EVIDENCE_SURFACE` in document order,
          so an operator reaches the decision without scrolling the evidence
          out of the way first (LOOK_AND_FEEL, Key screens: the close is beside
          the evidence, never four screenfuls under it). It is decided HERE,
          once, for all three shapes rather than inside a shape's view, which
          is what makes the placement the same whether the evidence is two
          cards or the signal's hundred-odd folded records; the views
          themselves are untouched and keep their own anatomy.

          Its ONE question — may a settlement be offered at all — is
          `readiness`; with the verdict log absent, which is the normal case
          for the whole of M2, the slot renders that state and offers no
          control. The shape's action list comes from the one map
          (`ACTIONS_BY_SHAPE`), never from a shape re-derived here, and its
          companion says what the shape WITHHOLDS and why — today only a
          conflict on a reference field, whose value links a row rather than
          carrying text (`NOTICE_BY_SHAPE`, spec §8). */}
      <Section title="The close" surface={CLOSE_SURFACE}>
        <CloseSlot
          item={row}
          readiness={readiness}
          actions={ACTIONS_BY_SHAPE[shape]({
            item: row,
            evidence: evidenceRows,
            choices: linkChoices,
          })}
          notice={NOTICE_BY_SHAPE[shape]({
            item: row,
            evidence: evidenceRows,
            choices: linkChoices,
          })}
          verdict={settledWith(verdict)}
        />
      </Section>

      <Section title="Evidence">
        {evidence.kind !== "ok" ? (
          <div data-surface={EVIDENCE_SURFACE}>
            <StateOf result={evidence} />
          </div>
        ) : (
          <>
            {/* The graded surface, named in both branches: the evidence view
                or the card that replaced it, and never the legs below. */}
            <div data-surface={EVIDENCE_SURFACE}>
              <EvidenceView
                rows={evidenceRows}
                unresolved={evidence.data.unresolved}
                empty={emptyWords(evidence.data)}
                canonical={canonicalCard(evidence.data.canonical)}
                dial={
                  dialSource === null || trend === null
                    ? null
                    : dialProps(dialSource, sourceLabel(names, dialSource), trend)
                }
              />
            </div>
            {buckets.kind === "ok" || claimIds.length === 0 ? null : (
              // The claims rendered fine; only what is HOLDING them could not
              // be read. Reported separately, naming its own object, rather
              // than blanking the evidence that did arrive.
              <StateOf result={buckets} />
            )}
            {evidence.data.sourcesUnavailable === null ? null : (
              // Same pattern, one leg down: the registry could not be read, so
              // every claim shows its source id verbatim and no tier. The
              // claims are still the item's evidence (admin-window/BUG-0021).
              <StateOf result={evidence.data.sourcesUnavailable} />
            )}
            <p className="type-body text-ink-secondary">
              {accountingOf(evidence.data)}
            </p>
          </>
        )}
      </Section>

    </Page>
  );
}
