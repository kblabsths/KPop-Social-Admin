import type { DbResult } from "../db/result";
import { readReviewItemsOpenedSince, type DbClient } from "../db/gauges";
import {
  oldestOpenedAt,
  summarizeByKind,
  type ReviewAttention,
  type ReviewItemRow,
  type ReviewQueue,
  type ReviewSeverity,
} from "../review/shapes";
import {
  GAUGE_ROW_CAP,
  groupBy,
  mapOk,
  rate,
  resolveBounds,
  secondsBetween,
  spreadOfDurations,
  utcWeekStart,
  utcWeeksBetween,
  windowOf,
  type GaugeOptions,
  type Spread,
  type WindowInfo,
} from "./gauge";

/**
 * Gauge 4 of 6 — **queue health**, on `/queues`.
 *
 * Spec §5: "per queue: open count, age distribution, opens vs settles per
 * week, fold rates" — the knobs it judges are **escalation cutoffs** and
 * **severity assignments**.
 *
 * The domain lives in `src/lib/review/shapes.ts` (admin-window/TASK-0006) and
 * is reused here rather than re-derived: the row type, the kind mapping and
 * `summarizeByKind` — whose own docstring says it is "what the Dashboard's
 * attention summary and the queue-health gauge both need". This module adds
 * only what is a *gauge*: bounded reading, ages, weekly series, fold rates.
 *
 * **Severity is `low`/`high` and nothing else** (spec §10 parks the
 * visibility × impact formula; resolver.md §11). There is no score here, no
 * weighting and no computed priority — a severity figure is a COUNT of items
 * carrying one of the two registry values.
 */

/**
 * Default window: half a year of items, capped at the rows the platform will
 * return (`GAUGE_ROW_CAP`). 180 days of `review_items` passes that cap in
 * normal operation, which is the point: at the cap the window reports
 * `truncated: true` and every count is read as a floor, instead of a cap of
 * 5000 that the server silently cut to 1000 and called complete
 * (admin-window/BUG-0009).
 */
export const QUEUE_HEALTH_DEFAULTS = { days: 180, limit: GAUGE_ROW_CAP } as const;

/** Both queues, always reported, so an empty queue renders a zero and not a gap. */
export const QUEUES: readonly ReviewQueue[] = ["data_conflict", "entity_link"];

export interface QueueHealthRows {
  items: ReviewItemRow[];
  window: WindowInfo;
}

/** One week of a queue's flow. */
export interface QueueWeek {
  /** The Monday that starts the week, `2026-08-31`. */
  weekStart: string;
  /** Items whose `opened_at` falls in this week. */
  opened: number;
  /**
   * Items settled in this week — **`null`, always, today.**
   *
   * `review_items` carries `opened_at` and `last_evidence_at` and no settle
   * timestamp (migration `20260901000002`); when an item settled is a
   * `verdicts` fact, and `verdicts` does not exist until M2's handoff
   * migration is installed. A gauge that cannot compute a figure says so
   * rather than fabricating a zero — a week of "0 settles" and a week whose
   * settles are unknowable tune the escalation cutoffs in opposite directions.
   */
  settled: number | null;
}

/** How much folding a queue is doing (`review_items.folded_count`). */
export interface FoldStats {
  /** Items read for this queue in the window. */
  items: number;
  /** Items that have folded at least one duplicate into themselves. */
  foldedItems: number;
  /** Folds summed across the queue's items. */
  folds: number;
  /** `foldedItems / items`, or `null` when there are no items — never a zero rate. */
  foldRate: number | null;
  /** `folds / items`, or `null` when there are no items. */
  foldsPerItem: number | null;
}

export interface QueueStats {
  queue: ReviewQueue;
  /** Open items. Settled ones stay browsable and are counted separately. */
  open: number;
  settled: number;
  /** Open items by the registry's two severity values. Both keys always present. */
  openBySeverity: Record<ReviewSeverity, number>;
  /** Age in seconds of the OPEN items, `opened_at` to `window.until`. */
  openAge: Spread;
  /** The `opened_at` of the longest-waiting open item, or null when there are none. */
  oldestOpenedAt: string | null;
  folds: FoldStats;
  /** One entry per week of the window, ascending, zeros included. */
  weeks: QueueWeek[];
}

export interface QueueHealth {
  window: WindowInfo;
  /** Items read in the window; a floor when `window.truncated`. */
  items: number;
  /** Both queues, in `QUEUES` order, always present. */
  queues: QueueStats[];
  /**
   * The same rows summarised by KIND rather than by queue — decision and
   * signal, from `summarizeByKind`. The Dashboard's attention summary and this
   * gauge agree because they are one function.
   */
  byKind: ReviewAttention;
  /**
   * Whether settles-per-week is computable at all. `false` until `verdicts`
   * lands; a renderer reads this instead of inferring absence from nulls.
   */
  settlesMeasurable: boolean;
}

/** The bounded scan. Returns a `DbResult` and never throws. */
export async function fetchQueueHealth(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<QueueHealthRows>> {
  const bounds = resolveBounds(options, QUEUE_HEALTH_DEFAULTS);
  const result = await readReviewItemsOpenedSince(bounds, db);
  if (result.kind !== "ok") return result;
  return {
    kind: "ok",
    data: { items: result.data, window: windowOf(bounds, result.data.length) },
  };
}

function foldStats(items: readonly ReviewItemRow[]): FoldStats {
  let folds = 0;
  let foldedItems = 0;
  for (const item of items) {
    const count =
      typeof item.folded_count === "number" && Number.isFinite(item.folded_count)
        ? item.folded_count
        : 0;
    folds += count;
    if (count > 0) foldedItems += 1;
  }
  return {
    items: items.length,
    foldedItems,
    folds,
    foldRate: rate(foldedItems, items.length),
    foldsPerItem: rate(folds, items.length),
  };
}

function weeklyFlow(items: readonly ReviewItemRow[], window: WindowInfo): QueueWeek[] {
  const opened = new Map<string, number>();
  for (const item of items) {
    const week = utcWeekStart(item.opened_at);
    if (week === null) continue;
    opened.set(week, (opened.get(week) ?? 0) + 1);
  }
  return utcWeeksBetween(window.since, window.until).map((weekStart) => ({
    weekStart,
    opened: opened.get(weekStart) ?? 0,
    // Not zero — unknowable. See QueueWeek.settled.
    settled: null,
  }));
}

/** The pure aggregate. */
export function aggregateQueueHealth(input: QueueHealthRows): QueueHealth {
  const { items, window } = input;
  const byQueue = groupBy(items, (item) => item.queue);

  const queues = QUEUES.map((queue) => {
    const group = byQueue.get(queue) ?? [];
    const open = group.filter((item) => item.status === "open");
    return {
      queue,
      open: open.length,
      settled: group.filter((item) => item.status === "settled").length,
      openBySeverity: {
        high: open.filter((item) => item.severity === "high").length,
        low: open.filter((item) => item.severity === "low").length,
      },
      openAge: spreadOfDurations(
        open.map((item) => secondsBetween(item.opened_at, window.until)),
      ),
      oldestOpenedAt: oldestOpenedAt(open),
      folds: foldStats(group),
      weeks: weeklyFlow(group, window),
    };
  });

  return {
    window,
    items: items.length,
    queues,
    byKind: summarizeByKind(items),
    settlesMeasurable: false,
  };
}

/** Fetch and aggregate — what `/queues` calls. */
export async function readQueueHealth(
  options: GaugeOptions = {},
  db?: DbClient,
): Promise<DbResult<QueueHealth>> {
  return mapOk(await fetchQueueHealth(options, db), aggregateQueueHealth);
}
