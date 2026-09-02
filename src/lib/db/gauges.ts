import type { SupabaseClient } from "@supabase/supabase-js";
import { readRows, type DbResponse, type DbResult } from "./result";
import { T } from "./tables";
import type { ReviewItemRow } from "../review/shapes";

/**
 * The gauge reads — campaign admin-window/TASK-0007.
 *
 * **Why the queries live here and the gauges live in `src/lib/gauges/`:**
 * ARCHITECTURE.md §4 rule 2 is "only `lib/db/**` imports
 * `@supabase/supabase-js`", and §4's dependency graph runs
 * `lib/gauges/** -> lib/db/**` one way. So this file owns every PostgREST
 * chain and every row type, and `lib/gauges/*` composes them and aggregates
 * the rows in pure TypeScript. That split is what makes "the aggregate is
 * pure" a structural fact rather than a promise: nothing under `lib/gauges/`
 * can reach a database at all.
 *
 * Every read here is **bounded** — ARCHITECTURE.md §8: "every gauge query
 * carries an explicit `limit` and an explicit time window; an unbounded fetch
 * is a defect". A scan carries `.gte(<its time column>, since)` and
 * `.limit(n)`; an id-set lookup carries `.in(...)` over ids a previous read
 * produced, chunked, and `.limit(n)` again.
 *
 * Every export returns a `DbResult` and never throws (§4.1), and the table is
 * named through `T` alone (§4 rule 4), so a database lacking the resolver
 * tables renders a not-provisioned card naming the missing object.
 */

/**
 * The database handle a gauge passes through.
 *
 * `lib/gauges/*` never calls a method on it — it takes one from a page and
 * hands it to the reads below, which is the whole of its involvement with the
 * client. Spelling the type here keeps `@supabase/supabase-js` inside
 * `lib/db/**` where ARCHITECTURE.md §4 rule 2 puts it, instead of leaking the
 * library's import into six modules that do not use its API.
 */
export type DbClient = SupabaseClient;

/* ── bounds ──────────────────────────────────────────────────────────────── */

/** The window and cap a scan runs under. Resolved by `lib/gauges/gauge.ts`. */
export interface ReadBounds {
  /** Inclusive lower bound on the table's own time column, as an ISO instant. */
  since: string;
  /** Hard row cap. */
  limit: number;
}

/**
 * How many ids go into one `.in(...)`. PostgREST puts the list in the URL, so
 * an unchunked `.in()` over a 1,000-row id set builds a request long enough to
 * be refused by a proxy. Chunking keeps every request bounded.
 */
export const ID_CHUNK = 100;

/** Split a list into chunks of at most `size`. */
export function chunk<T2>(items: readonly T2[], size = ID_CHUNK): T2[][] {
  if (size <= 0) return [[...items]];
  const chunks: T2[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * The second leg of a two-step join (ARCHITECTURE.md §4.2): query A returned
 * rows, `ids` are its keys, and this runs query B `.in(...)` over them in
 * bounded chunks and concatenates the results.
 *
 * No ids means no query at all — an empty `.in()` is a pointless round trip,
 * and `ok: []` is the honest answer. The chunks are sequential, so a chunk
 * that errors stops the read instead of half-filling it, and the first non-`ok`
 * result comes back unchanged so a missing table still reaches the page as
 * `not_provisioned` naming that table.
 */
export async function readRowsByIds<Row>(
  missing: string,
  ids: readonly string[],
  run: (db: SupabaseClient, chunkIds: string[]) => PromiseLike<DbResponse<Row[]>>,
  db?: SupabaseClient,
): Promise<DbResult<Row[]>> {
  if (ids.length === 0) return { kind: "ok", data: [] };
  const collected: Row[] = [];
  for (const chunkIds of chunk(ids)) {
    const result = await readRows<Row>(missing, (client) => run(client, chunkIds), db);
    if (result.kind !== "ok") return result;
    collected.push(...result.data);
  }
  return { kind: "ok", data: collected };
}

/* ── the pending-claim bucket vocabulary ─────────────────────────────────── */

/**
 * The six buckets, spelled as the view spells them (migration
 * `20260901000004`, `pending_claims.bucket`).
 *
 * It lives in the data layer because ARCHITECTURE.md §6 trap 4 puts the
 * `in_window` exclusion here — "filter it out at the data layer … once".
 *
 * SEAM: when `src/lib/db/claims.ts` lands (§6 trap 4 names that file), this
 * vocabulary and `isRenderableBucket` move there and this module imports them,
 * rather than the data layer carrying two copies that can drift.
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
 * (spec §4, M1 EC5): every corroboration window is zero-length, so the view's
 * condition for it is false for every claim. Nothing downstream ever sees it —
 * not as a row, not as a filter option, not as a zero.
 */
const UNRENDERABLE_BUCKET: PendingClaimBucket = "in_window";

/** The buckets a gauge may report — every one except the unrenderable one. */
export const RENDERABLE_BUCKETS: readonly PendingClaimBucket[] =
  PENDING_CLAIM_BUCKETS.filter((bucket) => bucket !== UNRENDERABLE_BUCKET);

/** Is this a bucket the UI may show? The single test, used everywhere. */
export function isRenderableBucket(bucket: string): bucket is PendingClaimBucket {
  return (
    bucket !== UNRENDERABLE_BUCKET &&
    (PENDING_CLAIM_BUCKETS as readonly string[]).includes(bucket)
  );
}

/* ── row types, exactly as the scraper repo's migrations declare them ────── */

/** `resolution_runs` — migration `20260901000001`. */
export interface ResolutionRunRow {
  run_id: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  facts_examined: number;
  applied: number;
  held: number;
  escalated: number;
  entities_created: number;
  claims_linked: number;
  claims_rerejected: number;
  errors: number;
  error_summary: string | null;
}

/**
 * `field_provenance`, narrowed to what a latency needs.
 *
 * `entity_type` — not `domain` — is this table's spelling of the canonical
 * table (ARCHITECTURE.md §6 trap 1).
 */
export interface ProvenanceApplyRow {
  provenance_id: string;
  entity_type: string;
  field: string;
  source_id: string;
  observation_id: string;
  applied_at: string;
}

/** `observations`, narrowed to the instant a claim was made. */
export interface ObservedAtRow {
  observation_id: string;
  observed_at: string;
  domain: string;
}

/** `observations`, narrowed to a live pending claim's keys and instant. */
export interface PendingObservationRow {
  observation_id: string;
  source_id: string;
  domain: string;
  field: string;
  observed_at: string;
}

/** The `pending_claims` view's whole select list — migration `20260901000004`. */
export interface PendingClaimRow {
  observation_id: string;
  /** The view spells the canonical table `domain` (§6 trap 1). */
  domain: string;
  entity_id: string | null;
  field: string;
  source_id: string;
  bucket: PendingClaimBucket;
  /** Named only on `awaiting_row`; null in every other bucket. */
  unmet_requirement: string | null;
}

/**
 * `observations`, narrowed to the adjudication stamp — migration
 * `20260901000003`. `rejected_at` is nullable on the table but never null in
 * this row set: the query's `gte` on it cannot return a claim that was never
 * adjudicated.
 */
export interface RejectionRow {
  observation_id: string;
  source_id: string;
  domain: string;
  field: string;
  rejected_at: string;
  rejected_by: string | null;
}

/** `sources`, narrowed to the state a per-source split names. */
export interface SourceStateRow {
  source_id: string;
  source: string;
  kind: string;
  lifecycle: string;
  /** The source's CURRENT tier, which drifts — not `tier_at_apply` (§6 trap 5). */
  tier: string;
}

/** What a claims read may be narrowed by (spec §5: "by source and domain"). */
export interface PendingClaimsFilter {
  source_id?: string;
  domain?: string;
}

/* ── the reads ───────────────────────────────────────────────────────────── */

const RESOLUTION_RUN_COLUMNS = [
  "run_id",
  "started_at",
  "ended_at",
  "outcome",
  "facts_examined",
  "applied",
  "held",
  "escalated",
  "entities_created",
  "claims_linked",
  "claims_rerejected",
  "errors",
  "error_summary",
].join(", ");

const PROVENANCE_COLUMNS = [
  "provenance_id",
  "entity_type",
  "field",
  "source_id",
  "observation_id",
  "applied_at",
].join(", ");

const OBSERVED_AT_COLUMNS = ["observation_id", "observed_at", "domain"].join(", ");

const PENDING_OBSERVATION_COLUMNS = [
  "observation_id",
  "source_id",
  "domain",
  "field",
  "observed_at",
].join(", ");

const PENDING_CLAIM_COLUMNS = [
  "observation_id",
  "domain",
  "entity_id",
  "field",
  "source_id",
  "bucket",
  "unmet_requirement",
].join(", ");

const REVIEW_ITEM_COLUMNS = [
  "review_item_id",
  "queue",
  "source_id",
  "domain",
  "entity_id",
  "field",
  "severity",
  "status",
  "summary",
  "evidence",
  "folded_count",
  "opened_at",
  "last_evidence_at",
].join(", ");

const REJECTION_COLUMNS = [
  "observation_id",
  "source_id",
  "domain",
  "field",
  "rejected_at",
  "rejected_by",
].join(", ");

const SOURCE_COLUMNS = ["source_id", "source", "kind", "lifecycle", "tier"].join(", ");

/**
 * Recent cycles. Newest first, so a truncated read keeps the recent ones —
 * which is what spec §5's "recent `resolution_runs`" asks for.
 */
export function readResolutionRuns(
  bounds: ReadBounds,
  db?: SupabaseClient,
): Promise<DbResult<ResolutionRunRow[]>> {
  return readRows<ResolutionRunRow>(
    T.resolutionRuns,
    (client) =>
      client
        .from(T.resolutionRuns)
        .select(RESOLUTION_RUN_COLUMNS)
        .gte("started_at", bounds.since)
        .order("started_at", { ascending: false })
        .limit(bounds.limit) as unknown as PromiseLike<DbResponse<ResolutionRunRow[]>>,
    db,
  );
}

/**
 * Applies in the window — one row per apply, which is exactly the population
 * of measurable latencies. Newest first for the same reason.
 */
export function readProvenanceApplies(
  bounds: ReadBounds,
  db?: SupabaseClient,
): Promise<DbResult<ProvenanceApplyRow[]>> {
  return readRows<ProvenanceApplyRow>(
    T.fieldProvenance,
    (client) =>
      client
        .from(T.fieldProvenance)
        .select(PROVENANCE_COLUMNS)
        .gte("applied_at", bounds.since)
        .order("applied_at", { ascending: false })
        .limit(bounds.limit) as unknown as PromiseLike<DbResponse<ProvenanceApplyRow[]>>,
    db,
  );
}

/** The observation instants behind a set of applies — the join's second leg. */
export function readObservedAt(
  ids: readonly string[],
  db?: SupabaseClient,
): Promise<DbResult<ObservedAtRow[]>> {
  return readRowsByIds<ObservedAtRow>(
    T.observations,
    ids,
    (client, chunkIds) =>
      client
        .from(T.observations)
        .select(OBSERVED_AT_COLUMNS)
        .in("observation_id", chunkIds)
        .limit(chunkIds.length) as unknown as PromiseLike<DbResponse<ObservedAtRow[]>>,
    db,
  );
}

/**
 * The live pending claims of the window — the `pending_claims` view's own
 * population (migration `20260901000004`, `live_pending_claim`), read from the
 * side that carries the timestamp both the window and the age need
 * (ARCHITECTURE.md §6 trap 3: the view carries no age).
 *
 * **Oldest first**, so a truncated read keeps the oldest claims — the stuck
 * ones the gauge exists to show — and drops the newest.
 */
export function readPendingObservations(
  bounds: ReadBounds,
  filter: PendingClaimsFilter,
  db?: SupabaseClient,
): Promise<DbResult<PendingObservationRow[]>> {
  return readRows<PendingObservationRow>(
    T.observations,
    (client) => {
      let builder = client
        .from(T.observations)
        .select(PENDING_OBSERVATION_COLUMNS)
        .eq("status", "pending");
      if (filter.source_id !== undefined) builder = builder.eq("source_id", filter.source_id);
      if (filter.domain !== undefined) builder = builder.eq("domain", filter.domain);
      return builder
        .gte("observed_at", bounds.since)
        .order("observed_at", { ascending: true })
        .limit(bounds.limit) as unknown as PromiseLike<DbResponse<PendingObservationRow[]>>;
    },
    db,
  );
}

/**
 * The buckets of those claims. **`in_window` is excluded here** — the data
 * layer, once (ARCHITECTURE.md §6 trap 4). The gauges exclude it again in
 * code, so the returned set is decided by one rule whether or not the server
 * narrowed.
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
 * The review items opened in the window.
 *
 * **Oldest first**: the backlog's age distribution is queue health's primary
 * figure, so a truncated read keeps the longest-waiting items. The cost is
 * that the newest weeks of its series then under-report, which is what the
 * window's `truncated` flag exists to say.
 */
export function readReviewItemsOpenedSince(
  bounds: ReadBounds,
  db?: SupabaseClient,
): Promise<DbResult<ReviewItemRow[]>> {
  return readRows<ReviewItemRow>(
    T.reviewItems,
    (client) =>
      client
        .from(T.reviewItems)
        .select(REVIEW_ITEM_COLUMNS)
        .gte("opened_at", bounds.since)
        .order("opened_at", { ascending: true })
        .limit(bounds.limit) as unknown as PromiseLike<DbResponse<ReviewItemRow[]>>,
    db,
  );
}

/**
 * The adjudication stamps of the window.
 *
 * `gte` on the nullable stamp is also the "was ever adjudicated" filter: `null
 * >= x` is null, so a claim that never was cannot satisfy it. Newest first —
 * a truncated read of a counts-over-time gauge keeps the recent weeks.
 */
export function readRejectionStamps(
  bounds: ReadBounds,
  db?: SupabaseClient,
): Promise<DbResult<RejectionRow[]>> {
  return readRows<RejectionRow>(
    T.observations,
    (client) =>
      client
        .from(T.observations)
        .select(REJECTION_COLUMNS)
        .gte("rejected_at", bounds.since)
        .order("rejected_at", { ascending: false })
        .limit(bounds.limit) as unknown as PromiseLike<DbResponse<RejectionRow[]>>,
    db,
  );
}

/**
 * The source state rows behind a set of source ids.
 *
 * A lookup, not a scan: its bound is the id set plus the cap. A time window
 * would be wrong here — a source registered two years ago is still the source
 * of today's claim.
 */
export function readSourceStates(
  ids: readonly string[],
  db?: SupabaseClient,
): Promise<DbResult<SourceStateRow[]>> {
  return readRowsByIds<SourceStateRow>(
    T.sources,
    ids,
    (client, chunkIds) =>
      client
        .from(T.sources)
        .select(SOURCE_COLUMNS)
        .in("source_id", chunkIds)
        .limit(chunkIds.length) as unknown as PromiseLike<DbResponse<SourceStateRow[]>>,
    db,
  );
}
