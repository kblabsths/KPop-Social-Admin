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

/**
 * The columns `observations` actually has. It carries NO `entity_type`: the
 * schema owner dropped that column in scraper migration
 * `20260819000002_the_domain_is_the_entity_type.sql` ("observations.entity_type
 * (the column) is dropped. domain becomes the first part of both identities"),
 * while keeping `field_provenance`'s. A fixture that carries a column the table
 * does not have is how a select naming it passed the offline suite and then
 * failed 42703 against staging (admin-window/BUG-0024).
 */
export interface ObservationRow {
  observation_id: string;
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
  /**
   * `field_provenance` spells the canonical table `entity_type`, and KEEPS it
   * (the same migration that dropped `observations.entity_type` says
   * "field_provenance IS NOT TOUCHED"). Its value is the domain.
   */
  entity_type: string;
  entity_id: string;
  field: string;
  /**
   * Null on a verdict unset — the columns dropped NOT NULL in scraper
   * migration `20260901000005` §1, and a fixture that cannot express the null
   * forces every test about an unset to cast its way out of the type
   * (admin-window/BUG-0012). Both default to a real id, so nothing that does
   * not ask for an unset changes.
   */
  source_id: string | null;
  observation_id: string | null;
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

/**
 * The QA edge population (campaign admin-window, TASK-0006 attack).
 *
 * All three shapes in BOTH statuses, plus the rows the schema permits and the
 * happy-path fixtures never produce: a `data_conflict` row carrying a
 * `source_id`, an `entity_link` row carrying BOTH a fact subject and a
 * `source_id`, a settled item that is also `high`, and two rows on the same
 * instant spelled two different ways (`Z` and `+00:00`) so the age tiebreak is
 * exercised. Migration `20260901000002` CHECK-constrains `queue`, `severity`
 * and `status` and constrains nothing else, so every row here is a row the
 * database can actually hold.
 *
 * Deliberately NOT in queue order.
 */
export const EDGE_ID = {
  dcOpenHigh: "01920000-0000-7000-8000-000000000521",
  dcOpenLowWithSource: "01920000-0000-7000-8000-000000000522",
  dcSettledHigh: "01920000-0000-7000-8000-000000000523",
  elOpenLow: "01920000-0000-7000-8000-000000000524",
  elSettledLow: "01920000-0000-7000-8000-000000000525",
  spOpenHigh: "01920000-0000-7000-8000-000000000526",
  spSettledHigh: "01920000-0000-7000-8000-000000000527",
  spOpenLowBothSubjects: "01920000-0000-7000-8000-000000000528",
  dcTieEarlierId: "01920000-0000-7000-8000-000000000529",
  dcTieLaterId: "01920000-0000-7000-8000-000000000530",
} as const;

export function reviewItemEdgePopulation(): ReviewItemRow[] {
  return [
    reviewItemSourcePattern({
      review_item_id: EDGE_ID.spSettledHigh,
      status: "settled",
      severity: "high",
      opened_at: "2026-08-16T00:00:00Z",
    }),
    reviewItemDataConflict({
      review_item_id: EDGE_ID.dcTieLaterId,
      severity: "low",
      opened_at: "2026-08-11T00:00:00+00:00", // same instant as the tie below
    }),
    reviewItemEntityLink({
      review_item_id: EDGE_ID.elSettledLow,
      status: "settled",
      severity: "low",
      opened_at: "2026-08-14T00:00:00Z",
    }),
    reviewItemDataConflict({
      review_item_id: EDGE_ID.dcOpenHigh,
      severity: "high",
      opened_at: "2026-08-10T00:00:00Z",
    }),
    // A data_conflict row whose source_id is set. The subject is still the
    // fact: that queue has no per-source subject (resolver.md §11), and no
    // constraint stops the column being populated.
    reviewItemDataConflict({
      review_item_id: EDGE_ID.dcOpenLowWithSource,
      source_id: ID.sourceBandsintown,
      severity: "low",
      opened_at: "2026-08-11T06:00:00Z",
    }),
    reviewItemSourcePattern({
      review_item_id: EDGE_ID.spOpenHigh,
      severity: "high",
      opened_at: "2026-08-15T00:00:00Z",
    }),
    reviewItemDataConflict({
      review_item_id: EDGE_ID.dcTieEarlierId,
      severity: "low",
      opened_at: "2026-08-11T00:00:00Z",
    }),
    // An entity_link row carrying BOTH a fact subject and a source_id — the
    // partial unique index treats it as its own subject, so the table can hold
    // it. `source_id` is the discriminator, so it is a source-pattern signal.
    reviewItemSourcePattern({
      review_item_id: EDGE_ID.spOpenLowBothSubjects,
      domain: "events",
      entity_id: ID.eventEntity,
      field: "venue",
      severity: "low",
      opened_at: "2026-08-17T00:00:00Z",
    }),
    reviewItemDataConflict({
      review_item_id: EDGE_ID.dcSettledHigh,
      status: "settled",
      severity: "high",
      opened_at: "2026-08-12T00:00:00Z",
    }),
    reviewItemEntityLink({
      review_item_id: EDGE_ID.elOpenLow,
      severity: "low",
      opened_at: "2026-08-13T00:00:00Z",
    }),
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

/* ── events, and the event_listings VIEW over them ───────────────────────── */

/**
 * The `events` columns, from migration `20260825000002` (the canonical event
 * storage) — `created_at` is the arrival stamp Browse orders on, and it exists
 * on the TABLE alone: the listings view does not carry it (migration
 * `20260825000004`), which is why Browse reads the window from `events` and
 * the venue name from the view.
 */
export interface EventRow {
  event_id: string;
  title: string;
  event_type:
    | "concert"
    | "festival"
    | "fansign"
    | "fanmeet"
    | "showcase"
    | "online"
    | "other";
  status: "scheduled" | "postponed" | "cancelled";
  starts_at: string;
  ends_at: string | null;
  time_precision: "datetime" | "date";
  /** NOT NULL with a `''` default — an empty description is an absence. */
  description: string;
  poster_url: string | null;
  ticket_url: string | null;
  venue_id: string | null;
  created_at: string;
}

export function eventRow(overrides: Override<EventRow> = {}): EventRow {
  return {
    event_id: ID.eventEntity,
    title: "TWICE 5TH WORLD TOUR",
    event_type: "concert",
    status: "scheduled",
    starts_at: "2026-11-14T02:00:00Z",
    ends_at: null,
    time_precision: "datetime",
    description: "The fifth world tour, Los Angeles night one.",
    poster_url: "https://example.invalid/posters/twice-5th.jpg",
    ticket_url: "https://example.invalid/tickets/twice-5th",
    venue_id: "01920000-0000-7000-8000-000000000901",
    created_at: "2026-09-01T04:12:00Z",
    ...overrides,
  };
}

/**
 * The `event_listings` view's row (migration `20260825000004`): events × venues
 * × performers × stats, assembled once in the database so no consumer
 * re-implements the join. Note the absent `created_at` — see `EventRow`.
 */
export interface EventListingRow {
  event_id: string;
  title: string;
  event_type: EventRow["event_type"];
  status: EventRow["status"];
  starts_at: string;
  ends_at: string | null;
  time_precision: EventRow["time_precision"];
  description: string;
  poster_url: string | null;
  ticket_url: string | null;
  venue_id: string | null;
  /** Null when the event has no linked venue — the view LEFT JOINs venues. */
  venue_name: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  performer_names: string[];
  performers_text: string;
  going_count: number;
  interested_count: number;
}

export function eventListingRow(
  overrides: Override<EventListingRow> = {},
): EventListingRow {
  const event = eventRow();
  return {
    event_id: event.event_id,
    title: event.title,
    event_type: event.event_type,
    status: event.status,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    time_precision: event.time_precision,
    description: event.description,
    poster_url: event.poster_url,
    ticket_url: event.ticket_url,
    venue_id: event.venue_id,
    venue_name: "Crypto.com Arena",
    city: "Los Angeles",
    country: "US",
    latitude: 34.043,
    longitude: -118.267,
    timezone: "America/Los_Angeles",
    performer_names: ["TWICE"],
    performers_text: "TWICE",
    going_count: 0,
    interested_count: 0,
    ...overrides,
  };
}
