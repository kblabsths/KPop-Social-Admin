import type { ResolutionRunRow } from "@/lib/db/cycles";
import type { ObservedAtRow, ProvenanceApplyRow } from "@/lib/db/gauges";

/**
 * The fixture population the Cycles & runs tests render and assert against
 * (campaign admin-window/TASK-0014).
 *
 * Rows are shaped exactly as `contracts/resolver.md` §6 and scraper migration
 * `20260901000001` declare them, and the six cycles cover every state a reader
 * must tell apart: completed with each of the three outcomes, still running,
 * died (a null `ended_at` older than one cadence), and ended with no outcome
 * recorded at all.
 *
 * The instants are relative to the moment the suite loads, because the page
 * reads the real clock: "still running" has to be inside the resolver's
 * 15-minute cadence and "died" outside it, whenever the suite runs.
 */

const NOW = Date.now();
const MINUTE = 60_000;

/** An ISO instant `minutes` before the suite started. */
export function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * MINUTE).toISOString();
}

/** An ISO instant `days` before the suite started. */
export function daysAgo(days: number): string {
  return minutesAgo(days * 24 * 60);
}

/** `started` plus `seconds` — the end of a cycle that finished. */
function endedAfter(started: string, seconds: number): string {
  return new Date(Date.parse(started) + seconds * 1000).toISOString();
}

/** Every counter zero — a cycle that did nothing, which most cycles are. */
const NO_COUNTS = {
  facts_examined: 0,
  applied: 0,
  held: 0,
  escalated: 0,
  entities_created: 0,
  claims_linked: 0,
  claims_rerejected: 0,
  errors: 0,
} as const;

/** A cycle that succeeded five minutes ago, with a four-figure count in it. */
export const SUCCEEDED: ResolutionRunRow = {
  run_id: "0192f0c1-0000-7000-8000-00000000000a",
  started_at: minutesAgo(5),
  ended_at: endedAfter(minutesAgo(5), 45),
  outcome: "succeeded",
  facts_examined: 12_345,
  applied: 1_204,
  held: 87,
  escalated: 6,
  entities_created: 3,
  claims_linked: 41,
  claims_rerejected: 2_610,
  errors: 0,
  error_summary: null,
};

/** A cycle that failed, and wrote the one line of failure text it is allowed. */
export const FAILED: ResolutionRunRow = {
  run_id: "0192f0c1-0000-7000-8000-00000000000b",
  started_at: minutesAgo(20),
  ended_at: endedAfter(minutesAgo(20), 1_190),
  outcome: "failed",
  ...NO_COUNTS,
  facts_examined: 402,
  applied: 11,
  held: 390,
  errors: 3,
  error_summary:
    'venues.name: duplicate key value violates unique constraint "venues_slug_key"',
};

/** A cycle that found the advisory lock held: `skipped`, and healthy. */
export const SKIPPED: ResolutionRunRow = {
  run_id: "0192f0c1-0000-7000-8000-00000000000c",
  started_at: minutesAgo(35),
  ended_at: endedAfter(minutesAgo(35), 0.4),
  outcome: "skipped",
  ...NO_COUNTS,
  error_summary: null,
};

/** Inserted at start, no end yet, inside the cadence: still running. */
export const RUNNING: ResolutionRunRow = {
  run_id: "0192f0c1-0000-7000-8000-00000000000d",
  started_at: minutesAgo(2),
  ended_at: null,
  outcome: null,
  ...NO_COUNTS,
  facts_examined: 55,
  error_summary: null,
};

/** A null `ended_at` three days old: a cycle that died, and nothing repairs it. */
export const DIED: ResolutionRunRow = {
  run_id: "0192f0c1-0000-7000-8000-00000000000e",
  started_at: daysAgo(3),
  ended_at: null,
  outcome: null,
  ...NO_COUNTS,
  facts_examined: 7,
  errors: 1,
  error_summary: "resolver lost its connection mid-cycle",
};

/** It ended and recorded no outcome. The producer wrote no word. */
export const UNRECORDED: ResolutionRunRow = {
  run_id: "0192f0c1-0000-7000-8000-00000000000f",
  started_at: minutesAgo(50),
  ended_at: endedAfter(minutesAgo(50), 30),
  outcome: null,
  ...NO_COUNTS,
  error_summary: null,
};

/**
 * The population, deliberately NOT in newest-first order.
 *
 * The page's order is a stated property of the page, so the fixtures hand it
 * rows in an order no reader would want: a test that fed them already sorted
 * would pass whether or not the page ordered anything.
 */
export const CYCLES: ResolutionRunRow[] = [
  SKIPPED,
  DIED,
  SUCCEEDED,
  UNRECORDED,
  RUNNING,
  FAILED,
];

/** The cycles in the order the page must render them: newest `started_at` first. */
export const NEWEST_FIRST: ResolutionRunRow[] = [
  RUNNING,
  SUCCEEDED,
  FAILED,
  SKIPPED,
  UNRECORDED,
  DIED,
];

/* ── the resolution-latency population (admin-window/BUG-0012's trap) ─────── */

/**
 * Five `field_provenance` decisions: **three applies and two unsets**.
 *
 * The two spellings of `applies` are deliberately different populations — the
 * read's raw window holds all five, and the aggregate's `applies` counts the
 * three that name a claim. A figure taken from the row array would render 5
 * where the truth is 3, which is exactly what BUG-0012 found; the fixture is
 * built so the two numbers cannot be confused for each other.
 *
 * One of the three applies (`EVENTS_UNMATCHED`) names a claim the second fetch
 * does not return, so its wait is unmeasurable and it is the one
 * `unmatchedApplies`.
 */
export const APPLIES: ProvenanceApplyRow[] = [
  {
    provenance_id: "p-1",
    entity_type: "events",
    field: "title",
    source_id: "s-1",
    observation_id: "o-1",
    applied_at: minutesAgo(10),
  },
  {
    provenance_id: "p-2",
    entity_type: "events",
    field: "starts_at",
    source_id: "s-1",
    observation_id: "o-missing",
    applied_at: minutesAgo(12),
  },
  {
    provenance_id: "p-3",
    entity_type: "venues",
    field: "name",
    source_id: "s-2",
    observation_id: "o-3",
    applied_at: minutesAgo(30),
  },
  {
    provenance_id: "p-4",
    entity_type: "events",
    field: "description",
    source_id: null,
    observation_id: null,
    applied_at: minutesAgo(14),
  },
  {
    provenance_id: "p-5",
    entity_type: "events",
    field: "poster_url",
    source_id: null,
    observation_id: null,
    applied_at: minutesAgo(16),
  },
];

/** How many of the five decisions above name a claim, and how many do not. */
export const APPLY_COUNT = 3;
export const UNSET_COUNT = 2;
export const UNMATCHED_COUNT = 1;

/** The claims behind them — `o-missing` is absent on purpose. */
export const OBSERVED: ObservedAtRow[] = [
  { observation_id: "o-1", observed_at: minutesAgo(70), domain: "events" },
  { observation_id: "o-3", observed_at: minutesAgo(90), domain: "venues" },
];
