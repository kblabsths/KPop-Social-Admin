import type { DbResult } from "../db/result";
import {
  readObservedAt,
  readProvenanceApplies,
  type DbClient,
  type ObservedAtRow,
  type ProvenanceApplyRow,
} from "../db/gauges";
import {
  GAUGE_ROW_CAP,
  RESOLVER_CADENCE_SECONDS,
  groupBy,
  idsOf,
  indexBy,
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
 * Gauge 2 of 6 — **resolution latency**, on `/cycles`.
 *
 * Spec §5: "`observed_at` → outcome latency percentiles, per domain" — the
 * knob it judges is the **resolver cadence** (and windows, if they ever land).
 * The outcome side is `field_provenance.applied_at`: the instant a claim
 * became the canonical value.
 *
 * **Two-step join** (ARCHITECTURE.md §4.2): the windowed scan is
 * `field_provenance` — one row per apply, which is exactly the population of
 * measurable latencies — and the observations it names are fetched by
 * `.in("observation_id", …)` and joined here, in TypeScript. No PostgREST
 * embed, even though an FK exists: the id-set join is what makes this testable
 * offline and what does not break when a view's inferred relationships change.
 */

export type { ObservedAtRow, ProvenanceApplyRow };

/**
 * Default window: a week of applies, capped at the rows the platform will
 * return (`GAUGE_ROW_CAP`). Asking for more than that made the scan
 * undecidable, not bigger: PostgREST stopped at its own `db-max-rows` and the
 * window reported `truncated: false` over a floor (admin-window/BUG-0009).
 */
export const RESOLUTION_LATENCY_DEFAULTS = { days: 7, limit: GAUGE_ROW_CAP } as const;

export interface ResolutionLatencyRows {
  applies: ProvenanceApplyRow[];
  observations: ObservedAtRow[];
  window: WindowInfo;
}

export interface DomainLatency {
  /** The canonical table the applies belong to (`field_provenance.entity_type`). */
  domain: string;
  /** Applies read for this domain. */
  applies: number;
  /** Seconds from `observations.observed_at` to `field_provenance.applied_at`. */
  latency: Spread;
}

export interface ResolutionLatency {
  window: WindowInfo;
  /** Applies read in the window; a floor when `window.truncated`. */
  applies: number;
  /** The latency across every domain. */
  overall: Spread;
  /** Per domain, ordered by domain name so two renders agree. */
  byDomain: DomainLatency[];
  /**
   * Applies whose observation was not in the second fetch — the pair has no
   * left-hand side, so its latency is unmeasurable rather than zero. Already
   * counted in every `unmeasurable` below; surfaced here because a large value
   * means the join, not the resolver, is what the reader is looking at.
   */
  unmatchedApplies: number;
  /** resolver.md §12's cadence in seconds — the yardstick a latency is read against. */
  cadenceSeconds: number;
}

/**
 * The two bounded reads. Returns a `DbResult` and never throws; if either leg
 * is absent the result is `not_provisioned` naming that object.
 */
export async function fetchResolutionLatency(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<ResolutionLatencyRows>> {
  const bounds = resolveBounds(options, RESOLUTION_LATENCY_DEFAULTS);
  const applies = await readProvenanceApplies(bounds, db);
  if (applies.kind !== "ok") return applies;

  const observations = await readObservedAt(
    idsOf(applies.data, (row) => row.observation_id),
    db,
  );
  if (observations.kind !== "ok") return observations;

  return {
    kind: "ok",
    data: {
      applies: applies.data,
      observations: observations.data,
      window: windowOf(bounds, applies.data.length),
    },
  };
}

/** The pure aggregate: join in code, then measure. */
export function aggregateResolutionLatency(
  input: ResolutionLatencyRows,
): ResolutionLatency {
  const { applies, observations, window } = input;
  const observedAt = indexBy(observations, (row) => row.observation_id);

  let unmatchedApplies = 0;
  const latencyOf = (row: ProvenanceApplyRow): number | null => {
    const observation = observedAt.get(row.observation_id);
    if (observation === undefined) {
      unmatchedApplies += 1;
      return null;
    }
    return secondsBetween(observation.observed_at, row.applied_at);
  };

  // Measured once per apply and reused, so `unmatchedApplies` counts each
  // unmatched row exactly once rather than once per grouping pass.
  const measured = applies.map((row) => ({ row, latency: latencyOf(row) }));

  const byDomain = [...groupBy(measured, ({ row }) => row.entity_type).entries()]
    .map(([domain, group]) => ({
      domain,
      applies: group.length,
      latency: spreadOfDurations(group.map(({ latency }) => latency)),
    }))
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));

  return {
    window,
    applies: applies.length,
    overall: spreadOfDurations(measured.map(({ latency }) => latency)),
    byDomain,
    unmatchedApplies,
    cadenceSeconds: RESOLVER_CADENCE_SECONDS,
  };
}

/** Fetch and aggregate — what a page calls. */
export async function readResolutionLatency(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<ResolutionLatency>> {
  return mapOk(await fetchResolutionLatency(options, db), aggregateResolutionLatency);
}
