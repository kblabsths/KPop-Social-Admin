import {
  ID,
  observationRow,
  pendingClaimRow,
  runRow,
  sourceRow,
  type ObservationRow,
  type PendingClaimRow,
  type RunRow,
  type SourceRow,
} from "../../fixtures/rows";

/**
 * The fixture population the Sources page is rendered against (campaign
 * admin-window/TASK-0013).
 *
 * Every row comes from `tests/fixtures/rows.ts`, so no column here is
 * invented; this file only chooses the SHAPE of the world — three sources in
 * three lifecycles, one of them never run, a run belonging to no registered
 * source, and a run still in flight.
 *
 * The timestamps that must fall inside a GAUGE WINDOW are relative to now
 * rather than fixed: the two gauges window 90 days back from the real clock,
 * and a fixture pinned to a calendar date would silently fall out of the
 * window and start asserting zeros (the page takes no clock of its own —
 * ARCHITECTURE §5 keeps it a plain read). The registry's own timestamps stay
 * fixed, because nothing windows them.
 */

const NOW = Date.now();
const DAY = 86_400_000;

/** An ISO instant `n` days before this test run. */
export function daysAgo(n: number): string {
  return new Date(NOW - n * DAY).toISOString();
}

/* ── the registry ────────────────────────────────────────────────────────── */

export const SOURCE = {
  bandsintown: ID.sourceBandsintown,
  fandom: "01920000-0000-7000-8000-000000000103",
  ticketmaster: ID.sourceTicketmaster,
} as const;

export const SOURCE_NAME = {
  [SOURCE.bandsintown]: "bandsintown",
  [SOURCE.fandom]: "fandom",
  [SOURCE.ticketmaster]: "ticketmaster",
} as const;

/**
 * Three sources, in the order a `sources` read returns them (by name — the
 * server order `readSources` asks for).
 *
 *  - `bandsintown` is paused, carries a note and NO checkpoint, and has never
 *    run: the row that proves an absence renders as an absence.
 *  - `fandom` is on trial and its newest run is still in flight.
 *  - `ticketmaster` is active with two runs, so "newest" has to be chosen.
 */
export const SOURCES: SourceRow[] = [
  sourceRow({
    source_id: SOURCE.bandsintown,
    source: "bandsintown",
    kind: "registered",
    lifecycle: "paused",
    tier: "standard",
    checkpoint: null,
    note: "Paused while the rate limit is renegotiated.",
  }),
  sourceRow({
    source_id: SOURCE.fandom,
    source: "fandom",
    kind: "cited",
    lifecycle: "trial",
    tier: "untrusted",
    checkpoint: "page-42",
    note: null,
  }),
  sourceRow({
    source_id: SOURCE.ticketmaster,
    source: "ticketmaster",
    kind: "registered",
    lifecycle: "active",
    tier: "official",
    checkpoint: "2026-08-31T00:00:00Z",
    note: null,
  }),
];

/* ── the runs, which carry a NAME and no key ─────────────────────────────── */

export const RUN = {
  ticketmasterOld: "01920000-0000-7000-8000-000000000701",
  ticketmasterNew: "01920000-0000-7000-8000-000000000702",
  fandomInFlight: "01920000-0000-7000-8000-000000000703",
  orphan: "01920000-0000-7000-8000-000000000704",
} as const;

/**
 * Four runs, three sources' worth of them — `bandsintown` has none, and
 * `eventbrite` has one while having no `sources` row at all (a run against an
 * unregistered source is exactly why `runs.source` has no foreign key,
 * migration `20260829000001`).
 */
export const RUNS: RunRow[] = [
  runRow({
    run_id: RUN.ticketmasterOld,
    source: "ticketmaster",
    started_at: "2026-08-30T03:00:00Z",
    ended_at: "2026-08-30T03:04:00Z",
    outcome: "partial",
    failure_class: "transient",
  }),
  runRow({
    run_id: RUN.ticketmasterNew,
    source: "ticketmaster",
    started_at: "2026-09-01T03:00:00Z",
    ended_at: "2026-09-01T03:02:11Z",
    outcome: "succeeded",
  }),
  runRow({
    run_id: RUN.fandomInFlight,
    source: "fandom",
    started_at: "2026-09-01T05:00:00Z",
    // Inserted at start, never completed: no end, no outcome.
    ended_at: null,
    outcome: null,
    failure_class: null,
  }),
  runRow({
    run_id: RUN.orphan,
    source: "eventbrite",
    started_at: "2026-09-01T06:00:00Z",
  }),
];

/**
 * The newest run for a NAME — this file's own predicate, written from the
 * schema rather than from the module under test (ARCHITECTURE §10: two paths
 * to one answer, or it proves nothing).
 */
export function newestRunFor(name: string): RunRow | null {
  const held = RUNS.filter((run) => run.source === name).sort(
    (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
  );
  return held[0] ?? null;
}

/** What a `runs` read filtered to one name returns, newest first, capped at one. */
export function runsResponseFor(name: string): RunRow[] {
  const newest = newestRunFor(name);
  return newest === null ? [] : [newest];
}

/* ── the pending claims behind the awaiting-row trend ────────────────────── */

const OBSERVATION = {
  tmYesterday: "01920000-0000-7000-8000-000000000901",
  tmTwoDaysAgo: "01920000-0000-7000-8000-000000000902",
  bitYesterday: "01920000-0000-7000-8000-000000000903",
  tmAgreeing: "01920000-0000-7000-8000-000000000904",
} as const;

/** The live pending claims of the window — the side that carries the instant. */
export const PENDING_OBSERVATIONS: ObservationRow[] = [
  observationRow({
    observation_id: OBSERVATION.tmYesterday,
    source_id: SOURCE.ticketmaster,
    status: "pending",
    observed_at: daysAgo(1),
  }),
  observationRow({
    observation_id: OBSERVATION.tmTwoDaysAgo,
    source_id: SOURCE.ticketmaster,
    status: "pending",
    observed_at: daysAgo(2),
  }),
  observationRow({
    observation_id: OBSERVATION.bitYesterday,
    source_id: SOURCE.bandsintown,
    status: "pending",
    observed_at: daysAgo(1),
  }),
  observationRow({
    observation_id: OBSERVATION.tmAgreeing,
    source_id: SOURCE.ticketmaster,
    status: "pending",
    observed_at: daysAgo(1),
  }),
];

/**
 * Their buckets. Three are `awaiting_row` — the bucket the trend is of — and
 * one is `agreeing`, so a trend that counted every pending claim would be
 * caught.
 */
export const PENDING_CLAIMS: PendingClaimRow[] = [
  pendingClaimRow("awaiting_row", {
    observation_id: OBSERVATION.tmYesterday,
    source_id: SOURCE.ticketmaster,
  }),
  pendingClaimRow("awaiting_row", {
    observation_id: OBSERVATION.tmTwoDaysAgo,
    source_id: SOURCE.ticketmaster,
  }),
  pendingClaimRow("awaiting_row", {
    observation_id: OBSERVATION.bitYesterday,
    source_id: SOURCE.bandsintown,
  }),
  pendingClaimRow("agreeing", {
    observation_id: OBSERVATION.tmAgreeing,
    source_id: SOURCE.ticketmaster,
  }),
];

/** This file's own count of a source's awaiting-row claims. */
export function awaitingRowClaims(sourceId: string): number {
  return PENDING_CLAIMS.filter(
    (claim) => claim.bucket === "awaiting_row" && claim.source_id === sourceId,
  ).length;
}

/* ── the adjudication stamps behind the settled-values gauge ─────────────── */

/**
 * Five adjudicated claims: two re-rejects and one human adjudication for
 * `ticketmaster`, one re-reject for `bandsintown`, and one stamp carrying no
 * reason at all (the column is nullable and written by convention, migration
 * `20260901000003`).
 */
export const REJECTIONS: ObservationRow[] = [
  observationRow({
    observation_id: "01920000-0000-7000-8000-000000000a01",
    source_id: SOURCE.ticketmaster,
    status: "rejected",
    rejected_at: daysAgo(3),
    rejected_by: "resolver",
  }),
  observationRow({
    observation_id: "01920000-0000-7000-8000-000000000a02",
    source_id: SOURCE.ticketmaster,
    status: "rejected",
    rejected_at: daysAgo(4),
    rejected_by: "resolver",
  }),
  observationRow({
    observation_id: "01920000-0000-7000-8000-000000000a03",
    source_id: SOURCE.ticketmaster,
    status: "rejected",
    rejected_at: daysAgo(5),
    rejected_by: "verdict",
  }),
  observationRow({
    observation_id: "01920000-0000-7000-8000-000000000a04",
    source_id: SOURCE.bandsintown,
    status: "rejected",
    rejected_at: daysAgo(6),
    rejected_by: "resolver",
  }),
  observationRow({
    observation_id: "01920000-0000-7000-8000-000000000a05",
    source_id: SOURCE.bandsintown,
    status: "rejected",
    rejected_at: daysAgo(7),
    rejected_by: null,
  }),
];

/** This file's own count of a source's re-rejects — `rejected_by = 'resolver'`. */
export function rerejects(sourceId: string): number {
  return REJECTIONS.filter(
    (row) => row.source_id === sourceId && row.rejected_by === "resolver",
  ).length;
}

/** This file's own count of the human adjudications against a source. */
export function adjudications(sourceId: string): number {
  return REJECTIONS.filter(
    (row) => row.source_id === sourceId && row.rejected_by === "verdict",
  ).length;
}
