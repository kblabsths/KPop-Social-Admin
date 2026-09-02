import { runRow, type RunRow } from "../../fixtures/rows";

/**
 * The `runs` population the adapter-runs half of `/cycles` is rendered against
 * (campaign admin-window/TASK-0016).
 *
 * Rows come from the SHARED builder (`tests/fixtures/rows.ts`, whose columns
 * are verified against scraper migration `20260829000001`) rather than being
 * hand-rolled here: a fixture that drifts from the schema is a test that
 * passes against a database that does not exist (ARCHITECTURE.md §10).
 *
 * The six runs cover every state the section must make legible: each outcome
 * the constraint allows, a failure carrying both a `failure_class` and an
 * `error_summary`, a run still in flight (no end, no outcome), and a run filed
 * under a source name no registry row carries — which still renders, because
 * `runs.source` is text with no foreign key (§6 trap 6).
 *
 * Instants are fixed rather than relative to the suite's clock: unlike a
 * cycle, a run's state is read from its own columns and not from its age, so
 * nothing here needs to be inside or outside a cadence.
 */

/** The three source names the population files runs under. */
export const SOURCE = {
  ticketmaster: "ticketmaster",
  bandsintown: "bandsintown",
  /** No `sources` row carries this name. The run still renders. */
  unregistered: "a-source-the-registry-never-heard-of",
} as const;

/** A name no run in this population carries — the unmatched facet. */
export const NO_SUCH_SOURCE = "eventbrite";

/** Every count zero — a run that fetched nothing, which a skipped run is. */
const NO_COUNTS = {
  payloads_fetched: 0,
  payloads_archived: 0,
  records_parsed: 0,
  records_rejected: 0,
  claims_emitted: 0,
  claims_dropped_empty: 0,
  claims_collapsed: 0,
  claims_ai: 0,
  records_linked: 0,
  records_unlinked: 0,
  records_escalated: 0,
  batches_written: 0,
  observations_returned: 0,
} as const;

/** The newest run: ticketmaster, completed, with four- and five-figure counts. */
export const SUCCEEDED: RunRow = runRow({
  run_id: "0192f0c2-0000-7000-8000-00000000001a",
  source: SOURCE.ticketmaster,
  started_at: "2026-09-02T06:00:00Z",
  ended_at: "2026-09-02T06:04:10Z",
  outcome: "succeeded",
  failure_class: null,
  error_summary: null,
  records_parsed: 12_345,
  claims_emitted: 48_010,
  records_unlinked: 1_207,
});

/** A run that failed, and wrote both the class and the one line of failure text. */
export const FAILED: RunRow = runRow({
  run_id: "0192f0c2-0000-7000-8000-00000000001b",
  source: SOURCE.bandsintown,
  started_at: "2026-09-02T05:00:00Z",
  ended_at: "2026-09-02T05:00:12Z",
  outcome: "failed",
  failure_class: "structural",
  error_summary:
    'events[3].starts_at: expected an ISO instant, got "TBA" (adapter gave up after 1 record)',
  records_parsed: 3,
  claims_emitted: 0,
  records_unlinked: 0,
});

/** A run that got some of the way: `partial`, and the class says whose problem. */
export const PARTIAL: RunRow = runRow({
  run_id: "0192f0c2-0000-7000-8000-00000000001c",
  source: SOURCE.ticketmaster,
  started_at: "2026-09-02T04:00:00Z",
  ended_at: "2026-09-02T04:07:41Z",
  outcome: "partial",
  failure_class: "transient",
  error_summary: "upstream 503 on page 7 of 12; the pages before it were kept",
  records_parsed: 704,
  claims_emitted: 2_811,
  records_unlinked: 96,
});

/** The advisory lock was held, so the adapter did nothing: `skipped`, and healthy. */
export const SKIPPED: RunRow = runRow({
  run_id: "0192f0c2-0000-7000-8000-00000000001d",
  source: SOURCE.bandsintown,
  started_at: "2026-09-02T03:00:00Z",
  ended_at: "2026-09-02T03:00:00Z",
  outcome: "skipped",
  failure_class: null,
  error_summary: null,
  ...NO_COUNTS,
});

/** Written when the adapter woke, never completed: no end, no outcome, no class. */
export const IN_FLIGHT: RunRow = runRow({
  run_id: "0192f0c2-0000-7000-8000-00000000001e",
  source: SOURCE.ticketmaster,
  started_at: "2026-09-02T02:00:00Z",
  ended_at: null,
  outcome: null,
  failure_class: null,
  error_summary: null,
  ...NO_COUNTS,
  records_parsed: 41,
});

/** Filed under a name the registry does not carry. It is still a run. */
export const UNREGISTERED: RunRow = runRow({
  run_id: "0192f0c2-0000-7000-8000-00000000001f",
  source: SOURCE.unregistered,
  started_at: "2026-09-02T01:00:00Z",
  ended_at: "2026-09-02T01:00:30Z",
  outcome: "succeeded",
  failure_class: null,
  error_summary: null,
  records_parsed: 8,
  claims_emitted: 8,
  records_unlinked: 8,
});

/**
 * The population, deliberately NOT in newest-first order.
 *
 * The section's order is a stated property of the page, so the fixtures hand
 * it rows in an order no reader would want: a test fed rows already sorted
 * would pass whether or not the page ordered anything.
 */
export const RUNS: RunRow[] = [
  SKIPPED,
  UNREGISTERED,
  SUCCEEDED,
  IN_FLIGHT,
  PARTIAL,
  FAILED,
];

/** The runs in the order the page must render them: newest `started_at` first. */
export const NEWEST_FIRST: RunRow[] = [
  SUCCEEDED,
  FAILED,
  PARTIAL,
  SKIPPED,
  IN_FLIGHT,
  UNREGISTERED,
];

/**
 * What a read narrowed to one source name returns — this file's own predicate,
 * written from the schema rather than asked of the module under test
 * (ARCHITECTURE.md §10: two paths to one answer, or it proves nothing).
 */
export function runsFrom(name: string): RunRow[] {
  return NEWEST_FIRST.filter((run) => run.source === name);
}
