import type { SupabaseClient } from "@supabase/supabase-js";
import { readRows, readRowsByIds, type DbResponse, type DbResult } from "./result";
import { T } from "./tables";
import type { PendingClaimsFilter } from "./claims";
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
 *
 * **What used to live here and now lives elsewhere** (campaign
 * admin-window/TASK-0012), re-exported below so every caller and test keeps
 * its import path:
 *
 *  - `ID_CHUNK`, `chunk` and `readRowsByIds` moved to `./result.ts`. The
 *    two-step join is ARCHITECTURE.md §4.2's rule for every reader, not a
 *    gauge trick; `lib/db/claims.ts` is the second module to need it, and a
 *    helper it imported from here would have made this module and that one a
 *    cycle.
 *  - the `pending_claims` VOCABULARY (`PENDING_CLAIM_BUCKETS`,
 *    `RENDERABLE_BUCKETS`, `isRenderableBucket`), its row and filter types,
 *    and the view's own read moved to `./claims.ts` — the seam this file
 *    named when it declared them, so the `in_window` exclusion is written
 *    once, in the module ARCHITECTURE.md §6 trap 4 names, and no query of
 *    that view exists outside it.
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

/* ── moved, and re-exported from where they went ─────────────────────────── */

export { ID_CHUNK, chunk, readRowsByIds } from "./result";
export {
  PENDING_CLAIM_BUCKETS,
  RENDERABLE_BUCKETS,
  isRenderableBucket,
  readPendingClaims,
} from "./claims";
export type { PendingClaimBucket, PendingClaimRow, PendingClaimsFilter } from "./claims";

/* ── bounds ──────────────────────────────────────────────────────────────── */

/** The window and cap a scan runs under. Resolved by `lib/gauges/gauge.ts`. */
export interface ReadBounds {
  /** Inclusive lower bound on the table's own time column, as an ISO instant. */
  since: string;
  /** Hard row cap. */
  limit: number;
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
 *
 * **Both id columns admit null**, and a reader that types them otherwise is
 * lying about rows this read really returns. Scraper migration
 * `20260901000005` §1 drops NOT NULL on the pair, and its own column comments
 * are the contract: `source_id` — "null on a verdict unset, the one row shape
 * whose authority is a human verdict rather than a winning observation";
 * `observation_id` — "null on a verdict unset. A reader takes a null here as
 * 'no applied observation'". `contracts/data-model.md`, Per-field provenance,
 * says the same. `readProvenanceApplies` windows on `applied_at` alone, so an
 * unset is in its row set like any other decision — see `namesNoObservation`
 * (campaign admin-window/BUG-0012).
 */
export interface ProvenanceApplyRow {
  provenance_id: string;
  entity_type: string;
  field: string;
  /** The source whose claim won the field; null on a verdict unset. */
  source_id: string | null;
  /** The winning claim this decision applied; null on a verdict unset. */
  observation_id: string | null;
  applied_at: string;
}

/**
 * Does this decision name no applied observation — the row shape whose
 * authority is a human verdict rather than a winning observation?
 *
 * The test is `observation_id`, because that is the column a reader of this
 * table is told to read as "no applied observation" (migration
 * `20260901000005`'s comment, quoted above); `source_id` is null on the same
 * rows, dropped NOT NULL in the same statement. A row that names an
 * observation is a real apply whatever else is null on it, so this stays
 * decidable from the join key alone.
 *
 * It lives here, beside the row shape whose contract it states, so the six
 * gauges cannot each grow their own spelling of the same null check.
 *
 * The name reads off the COLUMN rather than the decision, deliberately: the
 * landed guard in `tests/offline/review/one-place.test.ts` forbids declaring
 * anything under `src/` whose name carries the M2 close's vocabulary, and this
 * is a read of a null id, not a step toward that write path (the same
 * compliance admin-window/TASK-0007 made for `…RejectionStamps`).
 */
export function namesNoObservation(
  row: Pick<ProvenanceApplyRow, "observation_id">,
): boolean {
  return row.observation_id === null;
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
 * Every `field_provenance` decision in the window, newest first — one row per
 * canonical write.
 *
 * It is NOT filtered to applies. A verdict unset (`namesNoObservation`) is in this
 * row set, deliberately: adding `.not("observation_id", "is", null)` here
 * would make the unset invisible, and an aggregate could then only ever report
 * zero of them — a fabricated 0 of exactly the kind the gauges refuse
 * (`gauge.ts`, "a figure they cannot compute says so"). The population is
 * separated where every other gauge decision is made, in pure TypeScript
 * (`aggregateResolutionLatency`), and the window's `truncated` flag keeps
 * meaning "the read hit its cap", decided against the rows the server actually
 * returned (admin-window/BUG-0009, BUG-0012).
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
