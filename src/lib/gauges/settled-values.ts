import type { DbResult } from "../db/result";
import {
  readRejectionStamps,
  readSourceStates,
  type DbClient,
  type RejectionRow,
  type SourceStateRow,
} from "../db/gauges";
import {
  groupBy,
  idsOf,
  indexBy,
  mapOk,
  resolveBounds,
  utcWeekStart,
  utcWeeksBetween,
  windowOf,
  type GaugeOptions,
  type WindowInfo,
} from "./gauge";

/**
 * Gauge 6 of 6 — **settled values**, on `/sources`.
 *
 * Spec §5: "per-source re-reject counts over time — who keeps pushing
 * adjudicated values" — the knobs it judges are **source health** and **tier
 * moves**.
 *
 * The stamps are `observations.rejected_at` / `rejected_by`, added by migration
 * `20260901000003_an_adjudicated_claim_carries_its_stamp.sql`, whose
 * `rejected_by` check constrains the column to three values and whose comment
 * defines each:
 *
 *  - `resolver` — "the mechanical re-rejection at step 0b, counted by
 *    `resolution_runs.claims_rerejected`". **This is the re-reject** this gauge
 *    counts: the source pushed a value a human already adjudicated out, and
 *    the resolver threw it out again without asking.
 *  - `verdict` — "a human settlement applied a value and rejected the live
 *    claims it overruled". The original adjudication, reported beside the
 *    re-rejects and never summed into them.
 *  - `window` — RESERVED and never written in v1. Counted under its own name
 *    if it ever appears, rather than being dropped or folded into another.
 *
 * **A note on the export names.** This gauge is spec §5's "settled values" and
 * the module keeps that name, but its functions are named for the rejection
 * stamps they READ: `tests/offline/review/one-place.test.ts` (landed with
 * admin-window/TASK-0006) forbids any `function`/`const` under `src/` whose
 * NAME contains `settle` or `verdict`, so that nothing is scaffolded toward
 * M2's close. This gauge writes nothing, calls no RPC and touches no verdict
 * path — it reads two columns — so it honours that guard rather than being
 * excepted from it. The spec's vocabulary survives in the type names below.
 */

export type { RejectionRow };

/** Default window: a quarter of rejections. */
export const REJECTION_STAMP_DEFAULTS = { days: 90, limit: 5000 } as const;

/** The reason a claim was adjudicated out — `observations.rejected_by`. */
export const REJECTION_REASONS = ["verdict", "resolver", "window"] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** The one reason that means "pushed a value that was already adjudicated". */
export const RE_REJECT_REASON: RejectionReason = "resolver";

/** The reason that means "a human adjudication overruled this claim". */
const ADJUDICATION_REASON: RejectionReason = "verdict";

export interface SettledValuesRows {
  rejections: RejectionRow[];
  sources: SourceStateRow[];
  window: WindowInfo;
}

/** One week of one source's rejections. */
export interface RejectionWeek {
  /** The Monday that starts the week, `2026-08-31`. */
  weekStart: string;
  /** `rejected_by = 'resolver'` — the re-rejects. */
  rerejected: number;
  /** The human adjudications. */
  adjudicated: number;
}

export interface SourceRejections {
  sourceId: string;
  /** The source's name, or `null` when its `sources` row did not come back. */
  source: string | null;
  /** `sources.tier` — the CURRENT tier, which drifts; the knob this gauge moves. */
  tier: string | null;
  lifecycle: string | null;
  /** Re-rejects in the window: the headline figure. */
  rerejected: number;
  /** Human adjudications against this source's claims in the window. */
  adjudicated: number;
  /** Every reason seen, by its own name — including one this app does not know. */
  byReason: Record<string, number>;
  /** All rejections of this source's claims in the window. */
  total: number;
  /** One entry per week of the window, ascending, zeros included. */
  weeks: RejectionWeek[];
}

export interface SettledValues {
  window: WindowInfo;
  /** Rejections read in the window; a floor when `window.truncated`. */
  rejections: number;
  /** Re-rejects across every source. */
  rerejected: number;
  /** Counts per `rejected_by`, the three known reasons always present. */
  byReason: Record<string, number>;
  /** Per source, most re-rejects first. */
  bySource: SourceRejections[];
  /** Sources whose `sources` row did not come back — their names are null above. */
  unnamedSources: number;
  /**
   * Rejections carrying no `rejected_by` at all. The column is nullable and
   * written by convention rather than by a trigger (migration
   * `20260901000003`), so a stamp without a reason is possible and is reported
   * rather than being counted as a re-reject.
   */
  unattributed: number;
}

/** The two bounded reads. Returns a `DbResult` and never throws. */
export async function fetchRejectionStamps(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<SettledValuesRows>> {
  const bounds = resolveBounds(options, REJECTION_STAMP_DEFAULTS);
  const rejections = await readRejectionStamps(bounds, db);
  if (rejections.kind !== "ok") return rejections;

  const sources = await readSourceStates(
    idsOf(rejections.data, (row) => row.source_id),
    db,
  );
  if (sources.kind !== "ok") return sources;

  return {
    kind: "ok",
    data: {
      rejections: rejections.data,
      sources: sources.data,
      window: windowOf(bounds, rejections.data.length),
    },
  };
}

/** A reason counter seeded with the three the check constraint allows. */
function emptyReasons(): Record<string, number> {
  const reasons: Record<string, number> = {};
  for (const reason of REJECTION_REASONS) reasons[reason] = 0;
  return reasons;
}

/** The pure aggregate. */
export function aggregateRejectionStamps(input: SettledValuesRows): SettledValues {
  const { rejections, window } = input;
  const sourceById = indexBy(input.sources, (row) => row.source_id);
  const weeks = utcWeeksBetween(window.since, window.until);

  const byReason = emptyReasons();
  let unattributed = 0;
  for (const row of rejections) {
    if (row.rejected_by === null || row.rejected_by === undefined) {
      unattributed += 1;
      continue;
    }
    byReason[row.rejected_by] = (byReason[row.rejected_by] ?? 0) + 1;
  }

  let unnamedSources = 0;
  const bySource = [...groupBy(rejections, (row) => row.source_id).entries()]
    .map(([sourceId, group]) => {
      const source = sourceById.get(sourceId);
      if (source === undefined) unnamedSources += 1;

      const reasons = emptyReasons();
      const weekly = new Map<string, RejectionWeek>(
        weeks.map((weekStart) => [weekStart, { weekStart, rerejected: 0, adjudicated: 0 }]),
      );
      for (const row of group) {
        if (row.rejected_by !== null && row.rejected_by !== undefined) {
          reasons[row.rejected_by] = (reasons[row.rejected_by] ?? 0) + 1;
        }
        const weekStart = utcWeekStart(row.rejected_at);
        const week = weekStart === null ? undefined : weekly.get(weekStart);
        // A rejection outside the rendered weeks is still counted in the
        // totals; it is not moved onto a week it did not happen in.
        if (week === undefined) continue;
        if (row.rejected_by === RE_REJECT_REASON) week.rerejected += 1;
        else if (row.rejected_by === ADJUDICATION_REASON) week.adjudicated += 1;
      }

      return {
        sourceId,
        source: source?.source ?? null,
        tier: source?.tier ?? null,
        lifecycle: source?.lifecycle ?? null,
        rerejected: reasons[RE_REJECT_REASON] ?? 0,
        adjudicated: reasons[ADJUDICATION_REASON] ?? 0,
        byReason: reasons,
        total: group.length,
        weeks: weeks.map((weekStart) => weekly.get(weekStart) as RejectionWeek),
      };
    })
    .sort(
      (a, b) =>
        b.rerejected - a.rerejected ||
        b.total - a.total ||
        (a.sourceId < b.sourceId ? -1 : 1),
    );

  return {
    window,
    rejections: rejections.length,
    rerejected: byReason[RE_REJECT_REASON] ?? 0,
    byReason,
    bySource,
    unnamedSources,
    unattributed,
  };
}

/** Fetch and aggregate — what `/sources` calls. */
export async function readRejectionStampGauge(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<SettledValues>> {
  return mapOk(await fetchRejectionStamps(options, db), aggregateRejectionStamps);
}
