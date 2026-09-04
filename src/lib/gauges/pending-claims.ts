import type { DbResult } from "../db/result";
import { T } from "../db/tables";
import {
  PENDING_CLAIM_BUCKETS,
  RENDERABLE_BUCKETS,
  isRenderableBucket,
  readPendingClaims as readPendingClaimRows,
  readPendingObservations,
  type DbClient,
  type PendingClaimBucket,
  type PendingClaimRow,
  type PendingClaimsFilter,
  type PendingObservationRow,
} from "../db/gauges";
import {
  GAUGE_ROW_CAP,
  groupBy,
  idsOf,
  indexBy,
  mapOk,
  resolveBounds,
  secondsBetween,
  spreadOfDurations,
  utcDay,
  utcDaysBetween,
  windowOf,
  type GaugeOptions,
  type Spread,
  type WindowInfo,
} from "./gauge";

/**
 * Gauge 3 of 6 — **pending claims**, on `/claims` (and its per-source trend on
 * `/sources`).
 *
 * Spec §5: "the classification buckets with counts and age percentiles,
 * filterable by source and domain; per-source `awaiting_row` trend against its
 * pattern threshold" — the knobs it judges are the **stuck-record pattern**
 * and **escalation**.
 *
 * Three schema facts shape the reads (ARCHITECTURE.md §6):
 *
 *  - trap 3 — **`pending_claims` carries no age and no value.** Age comes from
 *    `observations.observed_at`, joined by `observation_id`.
 *  - trap 4 — **`in_window` must never reach the UI**, not as a row, not as a
 *    filter option, not as a zero. It is excluded in the query (`lib/db/gauges.ts`)
 *    AND in `selectClaims` below, so the exclusion holds whether or not the
 *    server narrowed.
 *  - the view holds only **live `pending` claims** (migration `20260901000004`,
 *    `live_pending_claim`), which is why the windowed scan is the
 *    `observations` side: same population, and it is the side that carries the
 *    timestamp both the window and the age need.
 *
 * The scan is ordered **oldest first**, so a truncated read keeps the oldest
 * claims — the stuck ones this gauge exists to show — and drops the newest.
 * When `window.truncated`, every count here is a floor.
 */

export {
  PENDING_CLAIM_BUCKETS,
  RENDERABLE_BUCKETS,
  isRenderableBucket,
};
export type { PendingClaimBucket, PendingClaimRow, PendingClaimsFilter, PendingObservationRow };

/* ── the seam the contracts leave open ───────────────────────────────────── */

/**
 * The per-source stuck-pattern dial (`resolver.stuck_pattern`), if Admin can
 * read one.
 *
 * `count` records per source in `windowDays` days. resolver.md §12 defines the
 * shape; the VALUES live only in the scraper repo's source-registry YAML.
 */
export interface StuckPatternThreshold {
  count: number;
  windowDays: number;
}

/**
 * **THE THRESHOLD SEAM — deliberately empty (admin-window/TASK-0024).**
 *
 * Spec §5 wants the per-source `awaiting_row` trend drawn "against its pattern
 * threshold". That threshold is a registry dial that exists only in the
 * scraper repo's YAML, and spec §10 is explicit: "reuse that would need
 * scraper files at runtime is a flagged gap, not a silent copy" — so **where
 * Admin reads it is a blocked question**, and hand-copying the value into this
 * repo is the one answer that is forbidden. The global default is not here
 * either, for the same reason.
 *
 * Until that ticket is answered this map stays empty and every series reports
 * `threshold: null`; the trend renders WITHOUT the threshold overlay. When the
 * question is answered, the reader is wired here — one map, one call site —
 * and nothing else in the gauges changes.
 */
const STUCK_PATTERN_BY_SOURCE: ReadonlyMap<string, StuckPatternThreshold> = new Map();

/** The dial for a source, or `null` while the seam above is unfilled. */
export function stuckPatternThreshold(sourceId: string): StuckPatternThreshold | null {
  return STUCK_PATTERN_BY_SOURCE.get(sourceId) ?? null;
}

/* ── rows ────────────────────────────────────────────────────────────────── */

/**
 * Default window: a quarter of claims, capped at the rows the platform will
 * return (`GAUGE_ROW_CAP`). A larger cap does not read more rows — PostgREST
 * stops at its own `db-max-rows` — it only stops the read from knowing it was
 * truncated (admin-window/BUG-0009). The scan is OLDEST-first, so what a full
 * window keeps is the longest-waiting claims, which is what this gauge judges.
 */
export const PENDING_CLAIMS_DEFAULTS = { days: 90, limit: GAUGE_ROW_CAP } as const;

export interface PendingClaimsRows {
  claims: PendingClaimRow[];
  observations: PendingObservationRow[];
  window: WindowInfo;
  filter: PendingClaimsFilter;
}

/* ── the aggregates ──────────────────────────────────────────────────────── */

export interface BucketStats {
  bucket: PendingClaimBucket;
  /** Claims in this bucket. A real zero when the bucket is empty. */
  claims: number;
  /** Seconds from `observations.observed_at` to `window.until`. */
  age: Spread;
  /** Distinct sources with a claim in this bucket. */
  sources: number;
}

export interface PendingClaims {
  window: WindowInfo;
  filter: PendingClaimsFilter;
  /** Claims read, after the unrenderable bucket is excluded. */
  claims: number;
  /** Every renderable bucket, in the view's own order, always present. */
  buckets: BucketStats[];
  /** Age across every bucket. */
  age: Spread;
  /** Distinct sources and domains present — the page's filter options. */
  sources: string[];
  domains: string[];
}

/** One day of one source's `awaiting_row` trend. */
export interface AwaitingRowPoint {
  /** UTC calendar day, `2026-09-01`. */
  day: string;
  claims: number;
}

export interface AwaitingRowSeries {
  sourceId: string;
  /** `awaiting_row` claims for this source in the window. */
  claims: number;
  /** One point per day of the window, zeros included, ascending. */
  points: AwaitingRowPoint[];
  /**
   * The dial to draw the threshold line at — `null` while the seam above is
   * unfilled, which is every call today. A renderer draws the trend and no
   * line; it must not substitute a default of its own.
   */
  threshold: StuckPatternThreshold | null;
}

export interface AwaitingRowTrend {
  window: WindowInfo;
  /** One series per source with an `awaiting_row` claim, busiest first. */
  series: AwaitingRowSeries[];
}

/* ── the read ────────────────────────────────────────────────────────────── */

/**
 * The two bounded reads. `not_provisioned` from either leg names that object —
 * `observations` or `pending_claims` — so the card says which one is absent.
 */
export async function fetchPendingClaims(
  options: GaugeOptions & { filter?: PendingClaimsFilter } = {},
  db?: DbClient,
): Promise<DbResult<PendingClaimsRows>> {
  const bounds = resolveBounds(options, PENDING_CLAIMS_DEFAULTS);
  const filter = options.filter ?? {};

  const observations = await readPendingObservations(bounds, filter, db);
  if (observations.kind !== "ok") return observations;

  const claims = await readPendingClaimRows(
    idsOf(observations.data, (row) => row.observation_id),
    db,
  );
  if (claims.kind !== "ok") return claims;

  return {
    kind: "ok",
    data: {
      claims: claims.data,
      observations: observations.data,
      window: windowOf(bounds, observations.data.length, T.observations),
      filter,
    },
  };
}

/**
 * The claims this read is about: the fetched claims, minus the unrenderable
 * bucket and minus anything the filter excludes.
 *
 * Re-applied in code even though the query narrowed too, for the reason
 * `lib/db/review-items.ts` gives: the returned set is decided by exactly one
 * function whether or not the server narrowed.
 */
export function selectClaims(input: PendingClaimsRows): PendingClaimRow[] {
  const { filter } = input;
  return input.claims.filter((claim) => {
    if (!isRenderableBucket(claim.bucket)) return false;
    if (filter.source_id !== undefined && claim.source_id !== filter.source_id) return false;
    if (filter.domain !== undefined && claim.domain !== filter.domain) return false;
    return true;
  });
}

/** Seconds each claim has been waiting, by its observation's `observed_at`. */
function ages(
  claims: readonly PendingClaimRow[],
  observations: readonly PendingObservationRow[],
  until: string,
): (number | null)[] {
  const observed = indexBy(observations, (row) => row.observation_id);
  return claims.map((claim) => {
    const observation = observed.get(claim.observation_id);
    // No observation means no age. `null`, never 0: a claim of unknown age is
    // not a claim that arrived this instant.
    return observation === undefined ? null : secondsBetween(observation.observed_at, until);
  });
}

/** The pure aggregate: buckets with counts and age percentiles. */
export function aggregatePendingClaims(input: PendingClaimsRows): PendingClaims {
  const claims = selectClaims(input);
  const { observations, window, filter } = input;
  const byBucket = groupBy(claims, (claim) => claim.bucket);

  const buckets: BucketStats[] = RENDERABLE_BUCKETS.map((bucket) => {
    const group = byBucket.get(bucket) ?? [];
    return {
      bucket,
      claims: group.length,
      age: spreadOfDurations(ages(group, observations, window.until)),
      sources: idsOf(group, (claim) => claim.source_id).length,
    };
  });

  return {
    window,
    filter,
    claims: claims.length,
    buckets,
    age: spreadOfDurations(ages(claims, observations, window.until)),
    sources: idsOf(claims, (claim) => claim.source_id).sort(),
    domains: idsOf(claims, (claim) => claim.domain).sort(),
  };
}

/**
 * The pure aggregate for the per-source `awaiting_row` trend (spec §4: the
 * per-source gauge trends live on Sources).
 *
 * Every series carries `threshold: null` while the seam above is unfilled —
 * the trend is drawn, the line is not.
 */
export function aggregateAwaitingRowTrend(input: PendingClaimsRows): AwaitingRowTrend {
  const { observations, window } = input;
  const observed = indexBy(observations, (row) => row.observation_id);
  const awaitingRow = selectClaims(input).filter((claim) => claim.bucket === "awaiting_row");
  const days = utcDaysBetween(window.since, window.until);

  const series = [...groupBy(awaitingRow, (claim) => claim.source_id).entries()]
    .map(([sourceId, group]) => {
      const perDay = new Map<string, number>(days.map((day) => [day, 0]));
      for (const claim of group) {
        const observation = observed.get(claim.observation_id);
        const day = observation === undefined ? null : utcDay(observation.observed_at);
        // A claim whose day falls outside the rendered range (or whose
        // observation is missing) is counted in `claims` but plotted nowhere,
        // rather than being moved to a day it did not happen on.
        if (day !== null && perDay.has(day)) perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }
      return {
        sourceId,
        claims: group.length,
        points: days.map((day) => ({ day, claims: perDay.get(day) ?? 0 })),
        threshold: stuckPatternThreshold(sourceId),
      };
    })
    .sort((a, b) => b.claims - a.claims || (a.sourceId < b.sourceId ? -1 : 1));

  return { window, series };
}

/** Fetch and aggregate the buckets — what `/claims` calls. */
export async function readPendingClaims(
  options: GaugeOptions & { filter?: PendingClaimsFilter } = {},
  db?: DbClient,
): Promise<DbResult<PendingClaims>> {
  return mapOk(await fetchPendingClaims(options, db), aggregatePendingClaims);
}

/** Fetch and aggregate the per-source trend — what `/sources` calls. */
export async function readAwaitingRowTrend(
  options: GaugeOptions & { filter?: PendingClaimsFilter } = {},
  db?: DbClient,
): Promise<DbResult<AwaitingRowTrend>> {
  return mapOk(await fetchPendingClaims(options, db), aggregateAwaitingRowTrend);
}
