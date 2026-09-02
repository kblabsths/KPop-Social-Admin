import type { DbResult } from "../db/result";
import {
  readResolutionRuns,
  type DbClient,
  type ResolutionRunRow,
} from "../db/gauges";
import {
  RESOLVER_CADENCE_SECONDS,
  mapOk,
  resolveBounds,
  secondsBetween,
  spreadOfDurations,
  windowOf,
  type GaugeOptions,
  type Spread,
  type WindowInfo,
} from "./gauge";

/**
 * Gauge 1 of 6 — **cycle health**, on `/cycles`.
 *
 * Spec §5: "recent `resolution_runs`: duration vs cadence, facts examined vs
 * writes, outcome counts, errors" — the knob it judges is the **resolver
 * cadence** (resolver.md §12: 15 min) and "when to buy the watermark".
 *
 * The read is one bounded, windowed scan (`lib/db/gauges.ts`); everything else
 * is `aggregateCycleHealth`, which is pure and is what the offline tests
 * exercise (ARCHITECTURE.md §8).
 */

export type { ResolutionRunRow };

/** Default window: a week of cycles. At a 15-minute cadence that is ~672 rows. */
export const CYCLE_HEALTH_DEFAULTS = { days: 7, limit: 800 } as const;

/** The bounded row set the gauge aggregates, with the window it was read under. */
export interface CycleHealthRows {
  rows: ResolutionRunRow[];
  window: WindowInfo;
}

/**
 * What one cycle wrote, by counter.
 *
 * `total` is the sum of the five, and `held` is deliberately **not** among
 * them: migration `20260901000004`'s header says it plainly — "the cycle writes
 * nothing for a fact that stays held". `escalated` IS a write, because an
 * escalation opens a `review_items` row.
 */
export interface CycleWrites {
  applied: number;
  entitiesCreated: number;
  claimsLinked: number;
  claimsRerejected: number;
  escalated: number;
  total: number;
}

/** The most recent cycle that reported an error, for the glance's error line. */
export interface CycleError {
  runId: string;
  startedAt: string;
  errors: number;
  errorSummary: string | null;
}

export interface CycleHealth {
  window: WindowInfo;
  /** Cycles read in the window. A floor when `window.truncated`. */
  cycles: number;
  /**
   * Counts per `outcome`, with the three the table's check constraint allows
   * always present so a zero renders as a zero, plus `unfinished` for a row
   * with no outcome yet. An outcome the constraint gains later appears under
   * its own name rather than being dropped.
   */
  outcomes: Record<string, number>;
  /** Cycle duration in seconds (`ended_at - started_at`); unfinished cycles are unmeasurable. */
  duration: Spread;
  /** resolver.md §12's cadence, in seconds — what the duration is judged against. */
  cadenceSeconds: number;
  /** Cycles whose measured duration exceeded the cadence: the cycle is falling behind. */
  overCadence: number;
  /** Total facts examined across the window — the left side of "examined vs writes". */
  factsExamined: number;
  /** The right side: what those examinations actually wrote. */
  writes: CycleWrites;
  /** Facts the cycle held: examined, wrote nothing, still waiting. */
  held: number;
  /** Errors summed across the window, and how many cycles reported any. */
  errors: number;
  cyclesWithErrors: number;
  /** The newest cycle carrying errors, or null when the window is clean. */
  latestError: CycleError | null;
}

/** The bounded scan. Returns a `DbResult` and never throws (§4.1). */
export async function fetchCycleHealth(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<CycleHealthRows>> {
  const bounds = resolveBounds(options, CYCLE_HEALTH_DEFAULTS);
  const result = await readResolutionRuns(bounds, db);
  if (result.kind !== "ok") return result;
  return {
    kind: "ok",
    data: { rows: result.data, window: windowOf(bounds, result.data.length) },
  };
}

/** A counter the database may have handed back as null or junk. */
function counter(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The pure aggregate. Takes the fetched rows, returns what the card renders.
 *
 * No figure is invented: a cycle with no `ended_at` contributes to
 * `outcomes.unfinished` and to `duration.unmeasurable`, never a zero duration.
 */
export function aggregateCycleHealth(input: CycleHealthRows): CycleHealth {
  const { rows, window } = input;

  const outcomes: Record<string, number> = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    unfinished: 0,
  };
  const writes: CycleWrites = {
    applied: 0,
    entitiesCreated: 0,
    claimsLinked: 0,
    claimsRerejected: 0,
    escalated: 0,
    total: 0,
  };

  const durations: (number | null)[] = [];
  let overCadence = 0;
  let factsExamined = 0;
  let held = 0;
  let errors = 0;
  let cyclesWithErrors = 0;
  let latestError: CycleError | null = null;
  let latestErrorAt = -Infinity;

  for (const row of rows) {
    const outcome =
      row.outcome === null || row.outcome === undefined ? "unfinished" : row.outcome;
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

    const duration = secondsBetween(row.started_at, row.ended_at);
    durations.push(duration);
    if (duration !== null && duration > RESOLVER_CADENCE_SECONDS) overCadence += 1;

    factsExamined += counter(row.facts_examined);
    held += counter(row.held);
    writes.applied += counter(row.applied);
    writes.entitiesCreated += counter(row.entities_created);
    writes.claimsLinked += counter(row.claims_linked);
    writes.claimsRerejected += counter(row.claims_rerejected);
    writes.escalated += counter(row.escalated);

    const rowErrors = counter(row.errors);
    errors += rowErrors;
    if (rowErrors > 0 || row.error_summary !== null) {
      cyclesWithErrors += 1;
      const startedAt = Date.parse(row.started_at);
      const at = Number.isNaN(startedAt) ? -Infinity : startedAt;
      if (latestError === null || at > latestErrorAt) {
        latestErrorAt = at;
        latestError = {
          runId: row.run_id,
          startedAt: row.started_at,
          errors: rowErrors,
          errorSummary: row.error_summary,
        };
      }
    }
  }

  writes.total =
    writes.applied +
    writes.entitiesCreated +
    writes.claimsLinked +
    writes.claimsRerejected +
    writes.escalated;

  return {
    window,
    cycles: rows.length,
    outcomes,
    duration: spreadOfDurations(durations),
    cadenceSeconds: RESOLVER_CADENCE_SECONDS,
    overCadence,
    factsExamined,
    writes,
    held,
    errors,
    cyclesWithErrors,
    latestError,
  };
}

/** Fetch and aggregate — what a page calls. */
export async function readCycleHealth(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<CycleHealth>> {
  return mapOk(await fetchCycleHealth(options, db), aggregateCycleHealth);
}
