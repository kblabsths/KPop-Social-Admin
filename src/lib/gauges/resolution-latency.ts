import type { DbResult } from "../db/result";
import {
  namesNoObservation,
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
 *
 * **What counts as an apply.** `field_provenance` is the decision log, not an
 * apply log: a **verdict unset** — the row shape whose authority is a human
 * verdict rather than a winning observation — sits in the same window with
 * both id columns null (scraper migration `20260901000005`;
 * `contracts/data-model.md`, Per-field provenance). An unset named no
 * observation, so it has no `observed_at` and therefore no latency to measure:
 * spec §5's gauge is "`observed_at` → outcome latency", and a row with no
 * observation is not a latency this gauge lost, it is not one of its
 * measurements at all. It is counted on its own, as `verdictUnsets`, and is in
 * neither `applies` nor `unmatchedApplies` (campaign admin-window/BUG-0012).
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
  /**
   * Every `field_provenance` row the window read — applies AND verdict unsets,
   * exactly as `readProvenanceApplies` returns them. The aggregate separates
   * the two; the output's `applies` is a COUNT of the applies among these, so
   * the two spellings are deliberately not the same population.
   */
  applies: ProvenanceApplyRow[];
  observations: ObservedAtRow[];
  window: WindowInfo;
}

export interface DomainLatency {
  /** The canonical table the decisions belong to (`field_provenance.entity_type`). */
  domain: string;
  /** Applies read for this domain — verdict unsets are not among them. */
  applies: number;
  /**
   * Verdict unsets read for this domain. A domain whose window held only
   * unsets is still listed, with `applies: 0` and a latency of nulls: that
   * zero is a measured count of applies, and this field is what explains it.
   */
  verdictUnsets: number;
  /** Seconds from `observations.observed_at` to `field_provenance.applied_at`. */
  latency: Spread;
}

export interface ResolutionLatency {
  window: WindowInfo;
  /**
   * Applies read in the window — the population of measurable latencies, so
   * verdict unsets are NOT counted here. A floor when `window.truncated`.
   */
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
   *
   * A verdict unset is never counted here. It named no observation for the
   * second fetch to miss, so reporting it as a lost join would send the reader
   * to investigate a join defect that does not exist — the defect this figure
   * exists to reveal (admin-window/BUG-0012).
   */
  unmatchedApplies: number;
  /**
   * Verdict unsets read in the window — decisions whose authority is a human
   * verdict, which name no observation and so have no latency.
   *
   * Reported rather than dropped: they are real decisions the resolver made in
   * this window, and a reader comparing `applies` against the cycle-health
   * gauge's write counts needs to see where the difference went. A floor when
   * `window.truncated`, like every other count here.
   */
  verdictUnsets: number;
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
  const { applies: decisions, observations, window } = input;
  const observedAt = indexBy(observations, (row) => row.observation_id);

  let unmatchedApplies = 0;
  /**
   * The latency of one APPLY. Only ever called for a row that names an
   * observation, so a `null` here means the second fetch did not return that
   * observation — which is precisely what `unmatchedApplies` reports.
   */
  const latencyOf = (row: ProvenanceApplyRow): number | null => {
    const observation =
      row.observation_id === null ? undefined : observedAt.get(row.observation_id);
    if (observation === undefined) {
      unmatchedApplies += 1;
      return null;
    }
    return secondsBetween(observation.observed_at, row.applied_at);
  };

  // The window's decisions split into the two populations before anything is
  // measured: an unset has no observation, so it is not a latency this gauge
  // failed to measure — it is not one of its measurements (admin-window/BUG-0012).
  // Measured once per apply and reused, so `unmatchedApplies` counts each
  // unmatched row exactly once rather than once per grouping pass.
  const measured = decisions.map((row) => {
    const unset = namesNoObservation(row);
    return { row, unset, latency: unset ? null : latencyOf(row) };
  });
  const applied = measured.filter(({ unset }) => !unset);

  // Grouped over ALL decisions, so a domain whose window held only unsets is
  // still named — with `applies: 0` and its own `verdictUnsets`, rather than
  // vanishing from the breakdown.
  const byDomain = [...groupBy(measured, ({ row }) => row.entity_type).entries()]
    .map(([domain, group]) => {
      const groupApplies = group.filter(({ unset }) => !unset);
      return {
        domain,
        applies: groupApplies.length,
        verdictUnsets: group.length - groupApplies.length,
        latency: spreadOfDurations(groupApplies.map(({ latency }) => latency)),
      };
    })
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));

  return {
    window,
    applies: applied.length,
    overall: spreadOfDurations(applied.map(({ latency }) => latency)),
    byDomain,
    unmatchedApplies,
    verdictUnsets: measured.length - applied.length,
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
