/**
 * Shared row builders for the offline suite (campaign admin-window).
 *
 * Import these instead of hand-rolling a row: a fixture that drifts from the
 * schema is a test that passes against a database that does not exist. Every
 * column below is verified against the scraper repo's migrations
 * (`kspace Scraper/supabase/migrations/`) — `20260818000000` (observations,
 * field_provenance, sources), `20260829000001` (runs), `20260901000001`
 * (resolution_runs), `20260901000002` (review_items), `20260901000003`
 * (the rejection stamp), `20260901000004` (the pending_claims view). Nothing
 * here invents a column.
 *
 * Every builder takes a partial override, so a test states only the columns
 * its assertion is about.
 */

type Override<Row> = Partial<Row>;

/* ── ids ──────────────────────────────────────────────────────────────────
 * Fixed, so a failure message points at a recognisable row.
 */
export const ID = {
  sourceTicketmaster: "01920000-0000-7000-8000-000000000101",
  sourceBandsintown: "01920000-0000-7000-8000-000000000102",
  eventEntity: "01920000-0000-7000-8000-000000000201",
  groupEntity: "01920000-0000-7000-8000-000000000202",
  observationA: "01920000-0000-7000-8000-000000000301",
  observationB: "01920000-0000-7000-8000-000000000302",
  provenance: "01920000-0000-7000-8000-000000000401",
  reviewItemDataConflict: "01920000-0000-7000-8000-000000000501",
  reviewItemEntityLink: "01920000-0000-7000-8000-000000000502",
  reviewItemSourcePattern: "01920000-0000-7000-8000-000000000503",
  resolutionRun: "01920000-0000-7000-8000-000000000601",
  run: "01920000-0000-7000-8000-000000000701",
} as const;

/* ── sources ─────────────────────────────────────────────────────────────── */

export type SourceKind = "registered" | "cited";
export type SourceLifecycle =
  | "candidate"
  | "trial"
  | "active"
  | "paused"
  | "retired";
export type SourceTier =
  | "admin"
  | "official"
  | "trusted"
  | "standard"
  | "untrusted";

export interface SourceRow {
  source_id: string;
  source: string;
  kind: SourceKind;
  lifecycle: SourceLifecycle;
  tier: SourceTier;
  checkpoint: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function sourceRow(overrides: Override<SourceRow> = {}): SourceRow {
  return {
    source_id: ID.sourceTicketmaster,
    source: "ticketmaster",
    kind: "registered",
    lifecycle: "active",
    tier: "official",
    checkpoint: "2026-08-31T00:00:00Z",
    note: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-09-01T04:00:00Z",
    ...overrides,
  };
}

/* ── observations ────────────────────────────────────────────────────────── */

export type ObservationStatus =
  | "pending"
  | "applied"
  | "superseded"
  | "rejected"
  | "quarantined";

export interface ObservationRow {
  observation_id: string;
  entity_type: string;
  entity_id: string | null;
  field: string;
  domain: string;
  /** jsonb — the one json column in the system; render as JSON text. */
  value: unknown;
  schema_version: number;
  source_id: string;
  external_ref: string | null;
  payload_ref: string | null;
  observed_at: string;
  last_confirmed_at: string;
  status: ObservationStatus;
  rejected_at: string | null;
  rejected_by: string | null;
}

export function observationRow(
  overrides: Override<ObservationRow> = {},
): ObservationRow {
  return {
    observation_id: ID.observationA,
    entity_type: "events",
    entity_id: ID.eventEntity,
    field: "title",
    domain: "events",
    value: "TWICE 5TH WORLD TOUR",
    schema_version: 1,
    source_id: ID.sourceTicketmaster,
    external_ref: "tm-G5vYZ9d1",
    payload_ref: "ticketmaster/2026-08-31/G5vYZ9d1.json",
    observed_at: "2026-08-31T22:10:00Z",
    last_confirmed_at: "2026-09-01T04:10:00Z",
    status: "applied",
    rejected_at: null,
    rejected_by: null,
    ...overrides,
  };
}

/** A reference-class value: an object carrying a `ref` key (never text). */
export function referenceValue(ref: string): { ref: string } {
  return { ref };
}

/* ── field_provenance ────────────────────────────────────────────────────── */

export interface FieldProvenanceRow {
  provenance_id: string;
  /** `field_provenance` spells the canonical table `entity_type`, not `domain`. */
  entity_type: string;
  entity_id: string;
  field: string;
  source_id: string;
  observation_id: string;
  /** The tier AT THE APPLY — frozen, unlike `sources.tier`, which drifts. */
  tier_at_apply: SourceTier;
  applied_at: string;
  admin_locked: boolean;
}

export function fieldProvenanceRow(
  overrides: Override<FieldProvenanceRow> = {},
): FieldProvenanceRow {
  return {
    provenance_id: ID.provenance,
    entity_type: "events",
    entity_id: ID.eventEntity,
    field: "title",
    source_id: ID.sourceTicketmaster,
    observation_id: ID.observationA,
    tier_at_apply: "official",
    applied_at: "2026-09-01T04:12:00Z",
    admin_locked: false,
    ...overrides,
  };
}

/* ── review_items ────────────────────────────────────────────────────────── */

export type ReviewQueue = "data_conflict" | "entity_link";
export type ReviewSeverity = "low" | "high";
export type ReviewStatus = "open" | "settled";

export interface ReviewItemRow {
  review_item_id: string;
  queue: ReviewQueue;
  /** Set on a per-source item; null on a per-fact item. */
  source_id: string | null;
  /** `review_items` spells the canonical table `domain`, not `entity_type`. */
  domain: string | null;
  entity_id: string | null;
  field: string | null;
  severity: ReviewSeverity;
  status: ReviewStatus;
  summary: string;
  /** uuid[] of observation ids, in fold order. */
  evidence: string[];
  folded_count: number;
  opened_at: string;
  last_evidence_at: string;
}

/** Shape 1 of 3: a `data_conflict` item about one fact — a DECISION. */
export function reviewItemDataConflict(
  overrides: Override<ReviewItemRow> = {},
): ReviewItemRow {
  return {
    review_item_id: ID.reviewItemDataConflict,
    queue: "data_conflict",
    source_id: null,
    domain: "events",
    entity_id: ID.eventEntity,
    field: "title",
    severity: "high",
    status: "open",
    summary:
      "events.title: ticketmaster (official) says 'TWICE 5TH WORLD TOUR', bandsintown (standard) says 'TWICE World Tour'; neither outranks the settled value.",
    evidence: [ID.observationA, ID.observationB],
    folded_count: 2,
    opened_at: "2026-08-30T06:00:00Z",
    last_evidence_at: "2026-09-01T04:00:00Z",
    ...overrides,
  };
}

/** Shape 2 of 3: an `entity_link` item about one fact — a DECISION. */
export function reviewItemEntityLink(
  overrides: Override<ReviewItemRow> = {},
): ReviewItemRow {
  return {
    review_item_id: ID.reviewItemEntityLink,
    queue: "entity_link",
    source_id: null,
    domain: "events",
    entity_id: null,
    field: "venue",
    severity: "low",
    status: "open",
    summary:
      "events.venue: bandsintown's 'The Forum, Inglewood' matches no venue and the match confidence is below the bar.",
    evidence: [ID.observationB],
    folded_count: 0,
    opened_at: "2026-08-31T06:00:00Z",
    last_evidence_at: "2026-08-31T06:00:00Z",
    ...overrides,
  };
}

/**
 * Shape 3 of 3: an `entity_link` item whose subject is the SOURCE itself —
 * the stuck-record pattern, a SIGNAL. `source_id` set, the other three null;
 * that null-shape is what the subject's unique index compares NULLS NOT
 * DISTINCT.
 */
export function reviewItemSourcePattern(
  overrides: Override<ReviewItemRow> = {},
): ReviewItemRow {
  return {
    review_item_id: ID.reviewItemSourcePattern,
    queue: "entity_link",
    source_id: ID.sourceBandsintown,
    domain: null,
    entity_id: null,
    field: null,
    severity: "high",
    status: "open",
    summary:
      "bandsintown: 41 records stuck unlinked for 6 cycles — the venue names it emits match nothing.",
    evidence: [ID.observationB],
    folded_count: 5,
    opened_at: "2026-08-28T06:00:00Z",
    last_evidence_at: "2026-09-01T04:00:00Z",
    ...overrides,
  };
}

/** The three shapes, in the order spec §6 lists them. */
export function reviewItemShapes(): ReviewItemRow[] {
  return [
    reviewItemDataConflict(),
    reviewItemEntityLink(),
    reviewItemSourcePattern(),
  ];
}

/* ── pending_claims (a VIEW) ─────────────────────────────────────────────── */

/**
 * The six buckets, spelled exactly as the view spells them.
 * `in_window` is empty by rule and must never reach the UI — it is here so a
 * test can prove the data layer filters it out.
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

export interface PendingClaimRow {
  observation_id: string;
  /** The view spells the canonical table `domain`. */
  domain: string;
  entity_id: string | null;
  field: string;
  source_id: string;
  bucket: PendingClaimBucket;
  /** Named only on `awaiting_row`; null in every other bucket. */
  unmet_requirement: string | null;
}

export function pendingClaimRow(
  bucket: PendingClaimBucket,
  overrides: Override<PendingClaimRow> = {},
): PendingClaimRow {
  const awaitingRow = bucket === "awaiting_row";
  return {
    observation_id: `01920000-0000-7000-8000-0000000008${PENDING_CLAIM_BUCKETS.indexOf(bucket)
      .toString()
      .padStart(2, "0")}`,
    domain: "events",
    entity_id: awaitingRow ? null : ID.eventEntity,
    field: "title",
    source_id: ID.sourceTicketmaster,
    bucket,
    unmet_requirement: awaitingRow ? "at least one linked performer" : null,
    ...overrides,
  };
}

/** One claim in every bucket, including `in_window`. */
export function pendingClaimsInEveryBucket(): PendingClaimRow[] {
  return PENDING_CLAIM_BUCKETS.map((bucket) => pendingClaimRow(bucket));
}

/* ── resolution_runs (the resolver's cycles) ─────────────────────────────── */

export type ResolutionOutcome = "succeeded" | "failed" | "skipped";

export interface ResolutionRunRow {
  run_id: string;
  started_at: string;
  ended_at: string | null;
  outcome: ResolutionOutcome | null;
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

export function resolutionRunRow(
  overrides: Override<ResolutionRunRow> = {},
): ResolutionRunRow {
  return {
    run_id: ID.resolutionRun,
    started_at: "2026-09-01T04:00:00Z",
    ended_at: "2026-09-01T04:03:20Z",
    outcome: "succeeded",
    facts_examined: 412,
    applied: 37,
    held: 24,
    escalated: 3,
    entities_created: 6,
    claims_linked: 19,
    claims_rerejected: 11,
    errors: 0,
    error_summary: null,
    ...overrides,
  };
}

/* ── runs (the adapter framework's runs) ─────────────────────────────────── */

export type RunOutcome = "succeeded" | "partial" | "failed" | "skipped";
export type RunFailureClass = "transient" | "structural" | "config";

export interface RunRow {
  run_id: string;
  /** TEXT with no foreign key: match a source by NAME, never by id. */
  source: string;
  started_at: string;
  ended_at: string | null;
  outcome: RunOutcome | null;
  failure_class: RunFailureClass | null;
  checkpoint_before: string | null;
  checkpoint_after: string | null;
  error_summary: string | null;
  payloads_fetched: number;
  payloads_archived: number;
  records_parsed: number;
  records_rejected: number;
  claims_emitted: number;
  claims_dropped_empty: number;
  claims_collapsed: number;
  claims_ai: number;
  records_linked: number;
  records_unlinked: number;
  records_escalated: number;
  batches_written: number;
  observations_returned: number;
}

export function runRow(overrides: Override<RunRow> = {}): RunRow {
  return {
    run_id: ID.run,
    source: "ticketmaster",
    started_at: "2026-09-01T03:00:00Z",
    ended_at: "2026-09-01T03:02:11Z",
    outcome: "succeeded",
    failure_class: null,
    checkpoint_before: "2026-08-31T00:00:00Z",
    checkpoint_after: "2026-09-01T00:00:00Z",
    error_summary: null,
    payloads_fetched: 120,
    payloads_archived: 120,
    records_parsed: 118,
    records_rejected: 2,
    claims_emitted: 806,
    claims_dropped_empty: 14,
    claims_collapsed: 31,
    claims_ai: 0,
    records_linked: 101,
    records_unlinked: 17,
    records_escalated: 1,
    batches_written: 5,
    observations_returned: 806,
    ...overrides,
  };
}
