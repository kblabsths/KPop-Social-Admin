import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readComplete,
  readRowsByIds,
  type DbCountedResponse,
  type DbResponse,
  type DbResult,
} from "./result";
import { objectKindOf, T, type ObjectKind } from "./tables";
import type { ClaimsFilter } from "../claims/filters";

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
 * The `pending_claims` reads — campaign admin-window/TASK-0012.
 *
 * **This module is the only place the classification view is queried**, and
 * that is the point of it (ARCHITECTURE.md §6 trap 4): the parked `in_window`
 * bucket is excluded HERE, once, in the query and again in the predicate, so
 * no page, component or gauge can re-admit it and none of them has to
 * remember not to. `src/lib/db/gauges.ts` re-exports the vocabulary and the
 * id-set read below, which is the seam that file declared when it first
 * needed them.
 *
 * Every export returns a `DbResult` and never throws (§4.1); the view is named
 * through `T` alone (§4 rule 4); the two-step join is §4.2's — the view
 * carries no age, so `observations.observed_at` is fetched by
 * `observation_id` and joined in TypeScript (trap 3).
 */

/* ── the bucket vocabulary ───────────────────────────────────────────────── */

/**
 * The six buckets, spelled as the view spells them (migration
 * `20260901000004`, `pending_claims.bucket`), in the view's own precedence
 * order — most blocking first, `agreeing` last.
 */
export const PENDING_CLAIM_BUCKETS = [
  "in_window",
  "standing_disagreement",
  "awaiting_link",
  "awaiting_row",
  "escalated",
  "agreeing",
] as const;

export type PendingClaimBucket = (typeof PENDING_CLAIM_BUCKETS)[number];

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

/** The `pending_claims` view's whole select list — migration `20260901000004`. */
export interface PendingClaimRow {
  observation_id: string;
  /** The view spells the canonical table `domain` (ARCHITECTURE.md §6 trap 1). */
  domain: string;
  entity_id: string | null;
  field: string;
  source_id: string;
  bucket: PendingClaimBucket;
  /** Named only on `awaiting_row`; null in every other bucket. */
  unmet_requirement: string | null;
}

/**
 * A claim with the instant its observation was made — the view carries no age
 * (trap 3), so this is the joined row every claims surface renders.
 *
 * `observed_at` is `null` when the second leg returned no row for the claim:
 * a claim of unknown age, never a claim that arrived this instant.
 */
export interface ClaimRow extends PendingClaimRow {
  observed_at: string | null;
}

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

/** The claim's instant, and nothing else — reads are explicit (§4.2). */
const CLAIM_INSTANT_COLUMNS = ["observation_id", "observed_at"].join(", ");

/**
 * The buckets of a set of claims, by `observation_id` — the gauges' second leg
 * (they window on `observations`, the side that carries the timestamp).
 *
 * Moved here from `lib/db/gauges.ts` with the vocabulary: one module owns
 * every query of this view, so the exclusion below cannot be forgotten by the
 * next query somebody writes.
 */
export function readPendingClaims(
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
 * The classification view, whole.
 *
 * A COMPLETE read (ARCHITECTURE.md §4.3): `{ count: "exact" }`, a total
 * server-side order ending in `observation_id` — the view's key, one row per
 * live pending claim — and `.range(0, cap - 1)`. An `ok` array is therefore
 * every row the view holds, which is the only reason "the rendered bucket
 * counts equal the view's counts" (acceptance test 3) can be asserted at all;
 * a silently truncated set would make it false with nothing to show for it.
 *
 * **It is deliberately NOT narrowed server-side by the page's filter.** The
 * bucket table answers "how many claims in every bucket, for this source" —
 * so a bucket filter must not narrow the counts, and the source and domain
 * chips must offer every value the view carries and not just the ones that
 * survived the current narrowing. One whole-set read, and `selectClaims` does
 * every narrowing. If the view ever outgrows `ROW_CAP` the read refuses with
 * the real number (§4.3's rule, and raising the cap is then a decision with
 * evidence behind it) rather than rendering a partial count as a total.
 *
 * `in_window` is excluded in the query, so it is not even transported.
 */
function claimsQuery(db: SupabaseClient, cap: number) {
  return db
    .from(T.pendingClaims)
    .select(PENDING_CLAIM_COLUMNS, { count: "exact" })
    .neq("bucket", UNRENDERABLE_BUCKET)
    .order("bucket", { ascending: true })
    .order("observation_id", { ascending: true })
    .range(0, cap - 1) as unknown as PromiseLike<
    DbCountedResponse<PendingClaimRow[]>
  >;
}

/** The instants behind a set of claims — the join's second leg (§4.2). */
function readClaimInstants(
  ids: readonly string[],
  db?: SupabaseClient,
): Promise<DbResult<{ observation_id: string; observed_at: string }[]>> {
  return readRowsByIds<{ observation_id: string; observed_at: string }>(
    T.observations,
    ids,
    (client, chunkIds) =>
      client
        .from(T.observations)
        .select(CLAIM_INSTANT_COLUMNS)
        .in("observation_id", chunkIds)
        // At most one row per id — `observation_id` is the table's key — so
        // the leg can never ask for more rows than the ids it filtered on.
        .limit(chunkIds.length) as unknown as PromiseLike<
        DbResponse<{ observation_id: string; observed_at: string }[]>
      >,
    db,
  );
}

/**
 * Every claim the view holds, with its age's instant. The Claims page's read.
 *
 * Both legs report separately: `not_provisioned` from either names THAT object
 * (`pending_claims` or `observations`), so the card says which one is absent.
 * A claim whose observation did not come back keeps a `null` instant rather
 * than being dropped — dropping it would make the rendered count disagree with
 * the view, which is the one thing this page may not do.
 */
export async function listClaims(db?: SupabaseClient): Promise<DbResult<ClaimRow[]>> {
  const claims = await readComplete<PendingClaimRow>(
    T.pendingClaims,
    (client, cap) => claimsQuery(client, cap),
    db,
  );
  if (claims.kind !== "ok") return claims;

  // The exclusion again, in code: the returned set is decided by one rule
  // whether or not the server narrowed — the reason `lib/db/review-items.ts`
  // re-applies its own filter. Only the parked bucket is dropped here; a
  // bucket string this app has never heard of is a row of the view and stays,
  // or the count on screen would quietly stop matching the database.
  const rows = claims.data.filter((claim) => claim.bucket !== UNRENDERABLE_BUCKET);

  const instants = await readClaimInstants(
    [...new Set(rows.map((claim) => claim.observation_id))],
    db,
  );
  if (instants.kind !== "ok") return instants;

  const observedAt = new Map(
    instants.data.map((row) => [row.observation_id, row.observed_at]),
  );
  return {
    kind: "ok",
    data: rows.map((claim) => ({
      ...claim,
      observed_at: observedAt.get(claim.observation_id) ?? null,
    })),
  };
}

/* ── the one predicate, and the one order ────────────────────────────────── */

/**
 * The claims a filter keeps — the app's ONE claim predicate, so "the rendered
 * counts equal the view's counts, per bucket and per source filter" is a
 * property of one function rather than of every surface that filters.
 *
 * The parked bucket is dropped here too, whatever was asked for.
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

/**
 * The display order, and the only one: **oldest first** — the longest-waiting
 * claim is the one that is stuck, and this page answers "what is stuck".
 *
 * A claim whose instant is unknown sorts last: it cannot claim a position in
 * an age order it does not carry. `observation_id` breaks every tie, so the
 * order is total and two claims made on the same instant never swap between
 * renders.
 */
export function claimOrder(claims: readonly ClaimRow[]): ClaimRow[] {
  return [...claims].sort((a, b) => {
    const at = a.observed_at === null ? null : Date.parse(a.observed_at);
    const bt = b.observed_at === null ? null : Date.parse(b.observed_at);
    const aKnown = at !== null && !Number.isNaN(at);
    const bKnown = bt !== null && !Number.isNaN(bt);
    if (aKnown && bKnown && at !== bt) return (at as number) - (bt as number);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    return a.observation_id < b.observation_id ? -1 : 1;
  });
}

/**
 * The values a facet may take, from the claims the view holds: every source
 * and every domain present, sorted, plus the buckets — the renderable ones in
 * the view's own order, followed by any bucket the rows carry that this app
 * has no name for (a seventh bucket a later migration adds shows up under its
 * own name rather than vanishing from a count).
 */
export function facetOptions(claims: readonly ClaimRow[]): {
  bucket: readonly string[];
  source_id: readonly string[];
  domain: readonly string[];
} {
  const distinct = (values: readonly string[]) => [...new Set(values)].sort();
  const known = new Set<string>(RENDERABLE_BUCKETS);
  const unknown = distinct(
    claims.map((claim) => claim.bucket).filter((bucket) => !known.has(bucket)),
  ).filter((bucket) => bucket !== UNRENDERABLE_BUCKET);
  return {
    bucket: [...RENDERABLE_BUCKETS, ...unknown],
    source_id: distinct(claims.map((claim) => claim.source_id)),
    domain: distinct(claims.map((claim) => claim.domain)),
  };
}
