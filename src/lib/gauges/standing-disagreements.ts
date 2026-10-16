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
import {
  fetchPendingClaims,
  selectPendingClaims,
  type PendingClaimsRows,
} from "./pending-claims";
import { isSourceNamed, sourceLabel, sourceNamesOf } from "../sources/names";

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
   * The source's name as the registry wrote it, or `null` where the registry
   * NAMED NOTHING — an id without a name is reported as an id, never as a
   * guessed name.
   *
   * There are two ways for the registry to name nothing and they are one fact
   * here (campaign admin-window/DEBT-0022): the `sources` read returned no row
   * for this id, or it returned one whose name has no ink in it. Which of the
   * two happened is invisible to an operator — both put a uuid where a name
   * goes — so this field answers neither on its own: it carries
   * `lib/sources/names.ts`' reading, the same one `sourceLabel` renders these
   * rows by and the same one `unnamedSources` counts.
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
  /**
   * Sources the registry named nothing for, so they are shown by their id —
   * their `source` is `null` above.
   *
   * Counted through `isSourceNamed`, which is `sourceLabel`'s own reading of
   * the registry's answer (`lib/sources/names.ts`), so this number and the
   * rows a surface labels by id are ONE question answered once
   * (campaign admin-window/DEBT-0022, admin-window/TASK-0060, LESSONS 11).
   * A gauge that spelled its own `=== undefined` test saw only one of the two
   * ways the registry names nothing.
   */
  unnamedSources: number;
}

/** The claims of this gauge: the renderable set, narrowed to the standing bucket. */
export function selectStanding(rows: PendingClaimsRows): PendingClaimRow[] {
  return selectPendingClaims(rows).filter((claim) => claim.bucket === STANDING_BUCKET);
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
  // WHAT THE REGISTRY CALLS EACH SOURCE, read through the one owner of that
  // question (`lib/sources/names.ts`). The splits below are labelled by
  // `sourceLabel` on every surface that draws them, so the gauge asks the same
  // map rather than spelling a second test of nameability beside it
  // (campaign admin-window/DEBT-0022).
  const names = sourceNamesOf(input.sources);

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
      // "Did the registry name this source?" — asked of `isSourceNamed` and
      // not of `source === undefined`, because a row that came back with no
      // ink in its name is the same fact to an operator as no row at all, and
      // is labelled by its id either way. Spelling the test here counted only
      // one of the two, which is the blank-source-name class
      // (admin-window/BUG-0152/54/56/58/59) reaching this gauge.
      const named = isSourceNamed(names, sourceId);
      if (!named) unnamedSources += 1;

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
        // The registry's name, byte-identical, where there is one to give;
        // `null` where there is not, which is what puts the id on screen.
        source: named ? sourceLabel(names, sourceId) : null,
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
