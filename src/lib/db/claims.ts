import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countRead,
  readCount,
  readRows,
  readRowsByIds,
  type DbResponse,
  type DbResult,
} from "./result";
import { objectKindOf, T, type ObjectKind } from "./tables";
import type { ClaimsFilter } from "../claims/filters";
import {
  PENDING_CLAIM_BUCKETS,
  type ClaimRow,
  type PendingClaimBucket,
  type PendingClaimRow,
} from "../claims/lines";

/**
 * What this module's window read runs OVER — the word its window line ends
 * its bound clause on.
 *
 * Derived from the same `T.*` constant the query passes to `.from()`, in the
 * module that issues the query, so no page and no component gets a say: the
 * object a window was read over is a fact of the READ (admin-window/BUG-0077,
 * admin-window/DEBT-0006).
 */
export const CLAIMS_OBJECT: ObjectKind = objectKindOf(T.pendingClaims);

/**
 * The `pending_claims` reads — campaign admin-window/TASK-0012, rebuilt by
 * admin-window/BUG-0138.
 *
 * **This module is the only place the classification view is queried**, and
 * that is the point of it (ARCHITECTURE.md §6 trap 4): the parked `in_window`
 * bucket is excluded HERE, once, in every query and again in the predicate, so
 * no page, component or gauge can re-admit it and none of them has to
 * remember not to. `src/lib/db/gauges.ts` re-exports the vocabulary and the
 * id-set read below, which is the seam that file declared when it first
 * needed them.
 *
 * **It is no longer the place the population is transported.** It used to
 * expose one COMPLETE read of the whole view (`listClaims`), followed by a
 * chunked second leg over `observations` for the age the view did not carry —
 * ~14 sequential requests and 2.9-3.8 s of warm server time on a view holding
 * 877 rows (admin-window/BUG-0138, measured by Ben on the walk instance). Both
 * are gone. What answers the page now is a WINDOW read of the longest-waiting
 * claims, ordered in the database, plus `countRead` COUNTS the row cap cannot
 * reach — so the page's cost no longer follows the size of the view.
 *
 * That shape rests on ONE schema change, which is the scraper repo's and
 * Ben's to apply: `public.pending_claims` carries `observations.observed_at`
 * through (the handoff at
 * `agenticflow/tracker/for-human/M2-handoff-pending-claims-observed-at.md`).
 * Until it is installed on a database, every read here that selects the column
 * refuses naming the view — which is what `tests/live/claims.live.test.ts`
 * grades, and it is honest rather than fallible: nothing below falls back to
 * the two-step join, because a fallback is how a page keeps a cost nobody can
 * see (ARCHITECTURE.md §6 trap 12).
 *
 * Every export returns a `DbResult` and never throws (§4.1); the view is named
 * through `T` alone (§4 rule 4); the reads are explicit about their columns
 * (§4.2).
 */

/* ── the bucket vocabulary ───────────────────────────────────────────────── */

/**
 * The six buckets and the union over them are declared in
 * `src/lib/claims/lines.ts` and re-exported here, so every caller of this
 * module keeps the import it already had.
 *
 * They moved with the row interfaces below and for the same reason
 * (admin-window/TASK-0065): `PendingClaimRow.bucket` is typed on
 * `PendingClaimBucket`, and a leaf may not import `lib/db/**` back, not even a
 * type (§4 rule 7). What did NOT move is the EXCLUSION — the parked bucket,
 * the renderable set, the predicate and the `narrowed()` that applies it to
 * every query all stay in this module, which is the one that may query this
 * view (§6 trap 4).
 */
export { PENDING_CLAIM_BUCKETS } from "../claims/lines";
export type { PendingClaimBucket, PendingClaimRow, ClaimRow } from "../claims/lines";

/**
 * The bucket that is empty by rule and is not rendered until it can hold a row
 * (spec §4, M1 EC5, LOOK_AND_FEEL quality bar 3).
 *
 * Every corroboration window is zero-length while windows stay parked
 * (`contracts/resolver.md`, Out of scope: corroboration windows), so the
 * view's condition for `in_window` is `when false` — a real string in the
 * vocabulary that no row can ever carry. It reaches the UI as nothing at all:
 * not a bucket row, not an empty bucket, not a filter option, not a zero.
 */
export const UNRENDERABLE_BUCKET: PendingClaimBucket = "in_window";

/** The buckets anything may render — every one except the unrenderable one. */
export const RENDERABLE_BUCKETS: readonly PendingClaimBucket[] =
  PENDING_CLAIM_BUCKETS.filter((bucket) => bucket !== UNRENDERABLE_BUCKET);

/** Is this a bucket the UI may show? The single test, used everywhere. */
export function isRenderableBucket(bucket: string): bucket is PendingClaimBucket {
  return (
    bucket !== UNRENDERABLE_BUCKET &&
    (PENDING_CLAIM_BUCKETS as readonly string[]).includes(bucket)
  );
}

/* ── rows ────────────────────────────────────────────────────────────────── */

/*
 * `PendingClaimRow` and `ClaimRow` are declared in `src/lib/claims/lines.ts`
 * and re-exported at the top of this file (admin-window/TASK-0065). The row
 * shape is what the leaf's `claimLines()` reasons over, so it is declared
 * THERE and this module imports it back — the arrow `ReviewItemRow` in
 * `src/lib/review/shapes.ts` already draws (§4 rule 7).
 */

/** What a GAUGE claims read may be narrowed by (spec §5: "by source and domain"). */
export interface PendingClaimsFilter {
  source_id?: string;
  domain?: string;
}

/* ── the reads ───────────────────────────────────────────────────────────── */

const PENDING_CLAIM_COLUMNS = [
  "observation_id",
  "domain",
  "entity_id",
  "field",
  "source_id",
  "bucket",
  "unmet_requirement",
].join(", ");

/** What the LIST selects: the classification, and the age beside it. */
const CLAIM_COLUMNS = [PENDING_CLAIM_COLUMNS, "observed_at"].join(", ");

/** What one bucket's oldest-claim seek selects: the age, and what it belongs to. */
const BUCKET_INSTANT_COLUMNS = ["bucket", "observed_at"].join(", ");

/**
 * The live pending claims of a WINDOW, read from the view's own instant — the
 * gauges' claims leg, and a SIBLING of their `observations` scan rather than
 * its second step (admin-window/TASK-0074).
 *
 * It exists because the view carries `observed_at` now (scraper migration
 * `20260910000001` carries `observations.observed_at` through unchanged, one
 * row per live pending claim), so the claims a window holds are expressible
 * against this view alone. `readClaimCountIn` windows this side by the same
 * column over the same interval on the same page; this is the row read beside
 * it.
 *
 * **What it is FOR is depth, not round trips.** The gauge used to await its
 * `observations` scan and then feed the ids it returned into
 * `readPendingClaimRows` — four sequential waits on `/claims`, and the
 * largest part of a 1.714 s warm page (admin-window/TASK-0062's census). This
 * read needs nothing from the scan, so the two are issued together and the
 * page's longest chain is one wait.
 *
 * The narrowing, the parked-bucket exclusion and the columns are the ones
 * every other query of this view carries — `narrowed` applies them all. The
 * order is the scan's: **oldest first**, so a truncated read keeps the
 * longest-waiting claims, with `observation_id` breaking every tie so
 * membership at the cap is deterministic (the scan's own order, plus the
 * total-order tiebreak `readClaimWindow` takes for the same reason).
 *
 * A null instant is outside every window (`null >= x` is null), which is the
 * same claim the `observations` scan cannot see either.
 *
 * **Both edges, like the scan beside it** (admin-window/TASK-0070): the window
 * it reads is `[since, until)`, the same interval the `observations` scan
 * applies and the same one the window line above the card prints. It carried
 * the lower edge alone until then, so a claim dated after `until` was in this
 * leg and outside the sentence.
 */
export function readPendingClaimsInWindow(
  bounds: { since: string; until: string; limit: number },
  filter: PendingClaimsFilter = {},
  db?: SupabaseClient,
): Promise<DbResult<PendingClaimRow[]>> {
  return readRows<PendingClaimRow>(
    T.pendingClaims,
    (client) =>
      narrowed(client.from(T.pendingClaims).select(PENDING_CLAIM_COLUMNS), filter)
        .gte("observed_at", bounds.since)
        .lt("observed_at", bounds.until)
        .order("observed_at", { ascending: true })
        .order("observation_id", { ascending: true })
        .limit(bounds.limit) as unknown as PromiseLike<DbResponse<PendingClaimRow[]>>,
    db,
  );
}

/**
 * The buckets of a set of claims, by `observation_id` — an id-set lookup over
 * this view.
 *
 * It is the REVIEW ITEM's read (`app/queues/[reviewItemId]/page.tsx`), which
 * holds the claim ids of one item and asks what bucket each landed in. The
 * gauges took their second leg from it until admin-window/TASK-0074 gave them
 * `readPendingClaimsInWindow` above; a page that already has its ids still
 * wants this one.
 *
 * Moved here from `lib/db/gauges.ts` with the vocabulary: one module owns
 * every query of this view, so the exclusion below cannot be forgotten by the
 * next query somebody writes.
 */
export function readPendingClaimRows(
  ids: readonly string[],
  db?: SupabaseClient,
): Promise<DbResult<PendingClaimRow[]>> {
  return readRowsByIds<PendingClaimRow>(
    T.pendingClaims,
    ids,
    (client, chunkIds) =>
      client
        .from(T.pendingClaims)
        .select(PENDING_CLAIM_COLUMNS)
        .in("observation_id", chunkIds)
        .neq("bucket", UNRENDERABLE_BUCKET)
        .limit(chunkIds.length) as unknown as PromiseLike<DbResponse<PendingClaimRow[]>>,
    db,
  );
}

/**
 * The narrowing every read below carries, applied to the query and nowhere
 * else — never as a filter over rows a page fetched (ARCHITECTURE.md §4.3).
 *
 * The parked bucket is excluded UNCONDITIONALLY, whatever the filter says, so
 * the one exclusion trap 4 asks for is a property of this function rather than
 * of each call site; a `filter.bucket` narrows on top of it and can only ever
 * take rows away. `source_id` and `domain` reach here already derived from the
 * URL by the one derivation each value class owns (`lib/claims/filters.ts`),
 * so what is compared at the database is what the page spells on screen.
 */
function narrowed(query: unknown, filter: ClaimsFilter = {}): ClaimQuery {
  let narrowedQuery = (query as ClaimQuery).neq("bucket", UNRENDERABLE_BUCKET);
  if (filter.bucket !== undefined) {
    narrowedQuery = narrowedQuery.eq("bucket", filter.bucket);
  }
  if (filter.source_id !== undefined) {
    narrowedQuery = narrowedQuery.eq("source_id", filter.source_id);
  }
  if (filter.domain !== undefined) {
    narrowedQuery = narrowedQuery.eq("domain", filter.domain);
  }
  return narrowedQuery;
}

/**
 * The builder methods these reads use, and nothing else — the chain as a shape
 * rather than as `supabase-js`'s own generic type.
 *
 * Written out because the alternative does not compile: a narrowing function
 * generic over the real `PostgrestFilterBuilder` re-instantiates that type on
 * every conditional `.eq()` and `tsc` gives up (`TS2589`, type instantiation
 * excessively deep). This is the same seam every read in this layer already
 * takes at the end of its chain — one `as unknown as` where the builder meets
 * our own `DbResponse` — moved one step earlier so that ONE narrowing function
 * serves the window read and the count reads (a second copy is what drifts,
 * LESSONS 5). The names and arities are checked against the chain each call
 * site builds, and the offline stub records exactly these steps.
 */
interface ClaimQuery {
  eq(column: string, value: string): ClaimQuery;
  neq(column: string, value: string): ClaimQuery;
  /** The lower bound a WINDOWED count carries (admin-window/BUG-0163). */
  gte(column: string, value: string): ClaimQuery;
  /**
   * The EXCLUSIVE upper bound the same windowed read carries
   * (admin-window/TASK-0070) — `[since, until)`, so the count and the scan
   * printed beside it are counts of one population over one interval.
   */
  lt(column: string, value: string): ClaimQuery;
  order(
    column: string,
    options: { ascending: boolean; nullsFirst?: boolean },
  ): ClaimQuery;
  limit(rows: number): ClaimQuery;
  /**
   * The half-open-in-PostgREST-terms window a PAGED read carries
   * (admin-window/TASK-0065): `.range(from, to)` is INCLUSIVE at both ends, so
   * a page of `limit` rows starting at `offset` is `range(offset, offset +
   * limit - 1)`. It replaces `.limit()` on the window read alone — a head
   * count still carries neither, and the gauge scans still carry `.limit()`.
   */
  range(from: number, to: number): ClaimQuery;
}

/**
 * The `n` longest-waiting claims under a narrowing — ONE request, ordered in
 * the DATABASE.
 *
 * A WINDOW read (ARCHITECTURE.md §4.3 kind 2): its rows are never a total, and
 * nothing re-sorts them — the page renders them in the order they arrived, so
 * "the longest-waiting 50" is a fact of the query rather than of a comparator
 * over a set somebody had to fetch whole first.
 *
 * `observed_at asc, nullsFirst: false` is the page's stated order: oldest
 * first, an unknown instant last. `observation_id` breaks every tie, so the
 * order is total and two claims made on one instant never swap between
 * renders — which is what makes membership of the window itself deterministic
 * when the cap falls inside a tie.
 *
 * **`offset` is where that window STARTS, and it defaults to 0**
 * (admin-window/TASK-0065). The bound is a `.range(offset, offset + limit - 1)`
 * rather than a `.limit(limit)`, so the continuation the operator asks for is
 * the next slice of the SAME total order — which is the only reason paging
 * this read cannot drop or repeat a claim between two requests. Every caller
 * that names no offset issues exactly the request it issued before.
 *
 * The parked-bucket exclusion is `narrowed()`'s and `selectClaims`', at every
 * offset alike (§6 trap 4): a paged read is this same narrowing further down
 * the order, and a page that skipped either would leak the parked `in_window`
 * bucket into a rendering.
 */
export function readClaimWindow(
  options: { filter?: ClaimsFilter; limit: number; offset?: number },
  db?: SupabaseClient,
): Promise<DbResult<ClaimRow[]>> {
  const offset = options.offset ?? 0;
  return readRows<ClaimRow>(
    T.pendingClaims,
    (client) =>
      narrowed(client.from(T.pendingClaims).select(CLAIM_COLUMNS), options.filter)
        .order("observed_at", { ascending: true, nullsFirst: false })
        .order("observation_id", { ascending: true })
        .range(offset, offset + options.limit - 1) as unknown as PromiseLike<
        DbResponse<ClaimRow[]>
      >,
    db,
  ).then((drawn) =>
    // The exclusion again, in code: the returned set is decided by one rule
    // whether or not the server narrowed (§6 trap 4). Only the parked bucket
    // is dropped — a bucket string this app has never heard of is a row of the
    // view and stays, or the list would quietly stop showing what the count
    // counted. It is `selectClaims` and not a second predicate, and it is
    // bounded by the window rather than by the table.
    drawn.kind === "ok" ? { kind: "ok", data: selectClaims(drawn.data) } : drawn,
  );
}

/**
 * How many claims a narrowing holds — a `countRead` request through
 * `readCount`, so `ROW_CAP` cannot reach it and a null count is a refusal,
 * never a zero (§4.3; common violations row 2).
 *
 * It is `countRead` and not a `head: true` count of its own: a HEAD response
 * carries no body, so the 404 a database without `pending_claims` answers
 * reached this app as `error: null, count: null` and the page rendered the
 * no-count arm's developer sentence beside the panel's own not-provisioned
 * card (admin-window/BUG-0210). GET-shaped over zero rows, the absence
 * classifies exactly as the window read's does.
 *
 * `filter.bucket` undefined counts every RENDERABLE bucket. It is one count
 * per question and NOT a grouped read, because PostgREST refuses aggregates on
 * this deployment: `select=bucket,count()` answers `PGRST123 "Use of aggregate
 * functions is not allowed"` (measured against staging 2026-09-09, 84 ms —
 * admin-window/BUG-0138). There is no grouped read to choose.
 */
export function readClaimCount(
  filter?: ClaimsFilter,
  db?: SupabaseClient,
): Promise<DbResult<number>> {
  return readCount(
    T.pendingClaims,
    (client) =>
      narrowed(countRead(client, T.pendingClaims), filter) as unknown as PromiseLike<{
        count: number | null;
        error: unknown;
      }>,
    db,
  );
}

/**
 * The same count, bounded to a WINDOW — every claim of this narrowing observed
 * in `[since, until)` (admin-window/BUG-0163, both edges since
 * admin-window/TASK-0070).
 *
 * It is fact 2 of `lib/url/narrowing.ts`' two-fact rule for a surface whose
 * set is a window rather than the whole view: the gauge on `/claims` renders
 * the claims of a bounded scan, so "what would this surface hold with no URL
 * facet at all" has to carry the scan's own bounds. Asked with the unnarrowed
 * filter, it answers exactly that — and it is the bounded count that rule
 * prescribes for a fact it costs a query (admin-window/BUG-0135), never a
 * second row read.
 *
 * **It takes ONE bounds object, carrying both edges, and that is the point of
 * the shape.** It was `readClaimCountSince(since, …)` and had no upper bound
 * at all, while the scan it is printed beside is `[since, until]` and capped
 * at 1,000 — so the two figures the page compares were counts over two
 * different intervals, and a claim dated after `until` (clock skew at a
 * source, a source dating ahead) was counted here and rendered nowhere. The
 * caller hands this and the scan the same `gaugeBounds` object, so the two
 * reads cannot be given different edges by construction. An optional `until`
 * defaulting to "no upper edge" was the other way to write it and is the same
 * defect one release later (LESSONS 4).
 *
 * The bound is `observed_at`, the instant the view carries through from
 * `observations` — the same column the gauge scan windows on, so the two
 * figures are counts of one population under one window. A claim whose instant
 * is unknown is outside every such window (`null >= x` is null), which is the
 * same claim the scan cannot see either.
 *
 * It is a SECOND function rather than an argument on `readClaimCount` because
 * the two answer different questions — "how many claims does this narrowing
 * hold" and "how many did this window hold" — and a predicate answering two
 * questions gets widened by whichever one broke last (LESSONS 4). The
 * narrowing itself is still declared once: both go through `narrowed`.
 */
export function readClaimCountIn(
  bounds: { since: string; until: string },
  filter?: ClaimsFilter,
  db?: SupabaseClient,
): Promise<DbResult<number>> {
  return readCount(
    T.pendingClaims,
    (client) =>
      narrowed(countRead(client, T.pendingClaims), filter)
        .gte("observed_at", bounds.since)
        .lt("observed_at", bounds.until) as unknown as PromiseLike<{
        count: number | null;
        error: unknown;
      }>,
    db,
  );
}

/**
 * The oldest instant in ONE bucket under a narrowing: a `limit 1` window read
 * ordered `observed_at asc`, issued with the rest.
 *
 * `ok` carries `null` when the bucket holds nothing — an absence, never "now"
 * — and also when the one row it holds carries no instant, which is the same
 * absence from the reader's side: the table's dash says the bucket has no age
 * to show, and the count beside it says whether it has claims.
 */
export function readBucketOldest(
  bucket: PendingClaimBucket,
  filter?: ClaimsFilter,
  db?: SupabaseClient,
): Promise<DbResult<string | null>> {
  return readRows<{ bucket: string; observed_at: string | null }>(
    T.pendingClaims,
    (client) =>
      narrowed(client.from(T.pendingClaims).select(BUCKET_INSTANT_COLUMNS), {
        ...filter,
        bucket,
      })
        .order("observed_at", { ascending: true, nullsFirst: false })
        .limit(1) as unknown as PromiseLike<
        DbResponse<{ bucket: string; observed_at: string | null }[]>
      >,
    db,
  ).then((oldest) => {
    if (oldest.kind !== "ok") return oldest;
    // The bucket comes back so the answer can be checked against what was
    // asked (§6 trap 4, the code half): a server that ignored the narrowing
    // would put another bucket's age — the parked bucket's included — in this
    // row.
    const row = oldest.data[0];
    if (row === undefined || row.bucket !== bucket) return { kind: "ok", data: null };
    return { kind: "ok", data: row.observed_at ?? null };
  });
}

/* ── the one predicate ───────────────────────────────────────────────────── */

/**
 * The claims a filter keeps — the app's ONE claim predicate over rows already
 * in hand.
 *
 * It is no longer what narrows the Claims page: every read above narrows at
 * the database, which is the whole of admin-window/BUG-0138. It stays because
 * the exclusion has to be expressible in code as well as in a query — a server
 * that ignored the filter must not be able to leak the parked bucket into a
 * rendering — and because the gauges select over row sets they already hold.
 *
 * The parked bucket is dropped here too, whatever was asked for.
 *
 * It owns the bare word: the pending-claims gauge's own selection over its
 * bundled read is `selectPendingClaims` (`lib/gauges/pending-claims.ts`), a
 * different question over a different input, and both names are pinned to one
 * declaring module by the vocabulary guard in
 * `tests/offline/url/narrowing.test.ts` (admin-window/DEBT-0014).
 */
export function selectClaims(
  claims: readonly ClaimRow[],
  filter: ClaimsFilter = {},
): ClaimRow[] {
  return claims.filter((claim) => {
    if (claim.bucket === UNRENDERABLE_BUCKET) return false;
    if (filter.bucket !== undefined && claim.bucket !== filter.bucket) return false;
    if (filter.source_id !== undefined && claim.source_id !== filter.source_id) {
      return false;
    }
    if (filter.domain !== undefined && claim.domain !== filter.domain) return false;
    return true;
  });
}
