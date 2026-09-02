import type { DbResult } from "../db/result";
import {
  readSourceStates,
  type DbClient,
  type PendingClaimRow,
  type PendingClaimsFilter,
  type SourceStateRow,
} from "../db/gauges";
import {
  groupBy,
  idsOf,
  indexBy,
  mapOk,
  secondsBetween,
  spreadOfDurations,
  type GaugeOptions,
  type Spread,
  type WindowInfo,
} from "./gauge";
import { fetchPendingClaims, selectClaims, type PendingClaimsRows } from "./pending-claims";

/**
 * Gauge 5 of 6 — **standing disagreements**, on `/claims` (standing tab).
 *
 * Spec §5: "live contradictions with age and per-source split — who keeps
 * losing, and who keeps being right from below" — the knobs it judges are the
 * **silent-win tier gap** and **promotion evidence**.
 *
 * ARCHITECTURE.md §6 trap 2: **there is no separate standing-disagreements
 * view.** It is `pending_claims` filtered to `bucket = 'standing_disagreement'`
 * (resolver.md §7), so this gauge reuses `fetchPendingClaims` rather than
 * building a second read of the same view, and adds one leg: the `sources`
 * rows, because "from below" is a statement about the source's TIER and
 * `pending_claims` carries no tier (trap 5).
 *
 * The tier reported here is `sources.tier` — the source's CURRENT tier, which
 * drifts. It is not `field_provenance.tier_at_apply`, and it is labelled as
 * what it is.
 */

export type { SourceStateRow };

/** The bucket this gauge is (`pending_claims.bucket`, migration `20260901000004`). */
export const STANDING_BUCKET = "standing_disagreement";

export interface StandingDisagreementsRows {
  claims: PendingClaimsRows;
  sources: SourceStateRow[];
}

export interface SourceSplit {
  sourceId: string;
  /**
   * The source's name, or `null` when the `sources` read returned no row for
   * it — an id without a name is reported as an id, never as a guessed name.
   */
  source: string | null;
  /** `sources.tier` — the source's CURRENT tier, which drifts (trap 5). */
  tier: string | null;
  lifecycle: string | null;
  /** Standing disagreements this source is holding. */
  claims: number;
  /** Age in seconds, `observations.observed_at` to `window.until`. */
  age: Spread;
  /** The oldest claim's `observed_at`, or null when none is measurable. */
  oldestObservedAt: string | null;
  /** The canonical tables it disagrees about, sorted. */
  domains: string[];
}

export interface StandingDisagreements {
  window: WindowInfo;
  filter: PendingClaimsFilter;
  /** Live contradictions read in the window; a floor when `window.truncated`. */
  claims: number;
  /** Age across every contradiction. */
  age: Spread;
  /** Per source, most contradictions first. */
  bySource: SourceSplit[];
  /** Sources whose `sources` row did not come back — their names are null above. */
  unnamedSources: number;
}

/** The claims of this gauge: the renderable set, narrowed to the standing bucket. */
export function selectStanding(rows: PendingClaimsRows): PendingClaimRow[] {
  return selectClaims(rows).filter((claim) => claim.bucket === STANDING_BUCKET);
}

/**
 * The bounded reads: the claims read (`observations` → `pending_claims`) plus
 * the `sources` rows the split names. `not_provisioned` from any leg names
 * that object.
 */
export async function fetchStandingDisagreements(
  options: GaugeOptions & { filter?: PendingClaimsFilter } = {},
  db?: DbClient,
): Promise<DbResult<StandingDisagreementsRows>> {
  const claims = await fetchPendingClaims(options, db);
  if (claims.kind !== "ok") return claims;

  const sources = await readSourceStates(
    idsOf(selectStanding(claims.data), (claim) => claim.source_id),
    db,
  );
  if (sources.kind !== "ok") return sources;

  return { kind: "ok", data: { claims: claims.data, sources: sources.data } };
}

/** The pure aggregate. */
export function aggregateStandingDisagreements(
  input: StandingDisagreementsRows,
): StandingDisagreements {
  const { window, filter, observations } = input.claims;
  const standing = selectStanding(input.claims);
  const observed = indexBy(observations, (row) => row.observation_id);
  const sourceById = indexBy(input.sources, (row) => row.source_id);

  const ageOf = (claim: PendingClaimRow): number | null => {
    const observation = observed.get(claim.observation_id);
    return observation === undefined
      ? null
      : secondsBetween(observation.observed_at, window.until);
  };

  let unnamedSources = 0;
  const bySource = [...groupBy(standing, (claim) => claim.source_id).entries()]
    .map(([sourceId, group]) => {
      const source = sourceById.get(sourceId);
      if (source === undefined) unnamedSources += 1;

      let oldestObservedAt: string | null = null;
      let oldest = Infinity;
      for (const claim of group) {
        const observation = observed.get(claim.observation_id);
        if (observation === undefined) continue;
        const at = Date.parse(observation.observed_at);
        if (!Number.isNaN(at) && at < oldest) {
          oldest = at;
          oldestObservedAt = observation.observed_at;
        }
      }

      return {
        sourceId,
        source: source?.source ?? null,
        tier: source?.tier ?? null,
        lifecycle: source?.lifecycle ?? null,
        claims: group.length,
        age: spreadOfDurations(group.map(ageOf)),
        oldestObservedAt,
        domains: idsOf(group, (claim) => claim.domain).sort(),
      };
    })
    .sort((a, b) => b.claims - a.claims || (a.sourceId < b.sourceId ? -1 : 1));

  return {
    window,
    filter,
    claims: standing.length,
    age: spreadOfDurations(standing.map(ageOf)),
    bySource,
    unnamedSources,
  };
}

/** Fetch and aggregate — what the standing tab calls. */
export async function readStandingDisagreements(
  options: GaugeOptions & { filter?: PendingClaimsFilter } = {},
  db?: DbClient,
): Promise<DbResult<StandingDisagreements>> {
  return mapOk(
    await fetchStandingDisagreements(options, db),
    aggregateStandingDisagreements,
  );
}
