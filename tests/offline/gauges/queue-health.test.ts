import { describe, expect, it } from "vitest";
import {
  QUEUES,
  aggregateQueueHealth,
  fetchQueueHealth,
  readQueueHealth,
} from "@/lib/gauges/queue-health";
import type { ReviewItemRow } from "@/lib/review/shapes";
import { T } from "@/lib/db/tables";
import {
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemSourcePattern,
} from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
} from "../../fixtures/stub-client";

/**
 * Gauge 4 — queue health (campaign admin-window/TASK-0007).
 *
 * The knobs are escalation cutoffs and severity assignments, so severity is
 * counted by the registry's two values and nothing else: there is no score
 * here (spec §10 parks the visibility × impact formula).
 *
 * The one figure this gauge cannot compute is settles-per-week —
 * `review_items` carries no settle timestamp, and `verdicts` does not exist
 * until M2's handoff. It reports `null`, and the test below is what stops a
 * later hand from filling that null with a zero.
 */

const NOW = "2026-09-01T12:00:00.000Z";
const WINDOW = { since: "2026-08-25T12:00:00.000Z", until: NOW, limit: 5000, truncated: false };

/**
 * Five items across both queues and both statuses. The two settled ones sit in
 * the same weeks as the open ones, so a settle miscounted as an open would
 * show up in the weekly series.
 */
function population(): ReviewItemRow[] {
  return [
    reviewItemSourcePattern(), // entity_link, open, high, 08-28, folded 5
    reviewItemDataConflict(), // data_conflict, open, high, 08-30, folded 2
    reviewItemEntityLink(), // entity_link, open, low, 08-31, folded 0
    reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000521",
      status: "settled",
      severity: "low",
      opened_at: "2026-08-26T06:00:00Z",
      folded_count: 0,
    }),
    reviewItemEntityLink({
      review_item_id: "01920000-0000-7000-8000-000000000522",
      status: "settled",
      severity: "high",
      opened_at: "2026-08-31T09:00:00Z",
      folded_count: 3,
    }),
  ];
}

function withRows(items: ReviewItemRow[]) {
  return stubClient({ [T.reviewItems]: { data: items } });
}

const queueOf = (health: ReturnType<typeof aggregateQueueHealth>, queue: string) =>
  health.queues.find((entry) => entry.queue === queue);

describe("fetchQueueHealth", () => {
  it("reads review_items with an explicit window and an explicit cap", async () => {
    const stub = withRows(population());
    const result = await fetchQueueHealth(
      { now: NOW, days: 7, limit: 5000 },
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.reviewItems]);
    const steps = stub.calls[0].steps;
    expect(steps.find((s) => s.method === "gte")?.args).toEqual([
      "opened_at",
      "2026-08-25T12:00:00.000Z",
    ]);
    expect(steps.find((s) => s.method === "limit")?.args).toEqual([5000]);
    // Oldest first: the backlog's age distribution is the primary figure.
    expect(steps.find((s) => s.method === "order")?.args).toEqual([
      "opened_at",
      { ascending: true },
    ]);
  });

  it("bounds the query even when the caller passes nothing", async () => {
    const stub = withRows([]);
    await fetchQueueHealth({}, stub.asSupabaseClient());
    const steps = stub.calls[0].steps;
    expect(steps.some((s) => s.method === "gte")).toBe(true);
    expect(steps.find((s) => s.method === "limit")?.args[0]).toBeGreaterThan(0);
  });

  it("reports the table by name when it is absent, and never throws", async () => {
    const stub = stubClient({ [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) } });
    await expect(fetchQueueHealth({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.reviewItems,
    });
  });

  it("carries an arbitrary failure through as the database's own words", async () => {
    const stub = stubClient({ [T.reviewItems]: { error: permissionDenied(T.reviewItems) } });
    await expect(fetchQueueHealth({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "error",
      message: `permission denied for table ${T.reviewItems}`,
    });
  });
});

describe("aggregateQueueHealth", () => {
  const health = aggregateQueueHealth({ items: population(), window: WINDOW });

  it("reports both queues, always, so an empty queue is a zero and not a gap", () => {
    expect(health.queues.map((entry) => entry.queue)).toEqual([...QUEUES]);
    const empty = aggregateQueueHealth({ items: [], window: WINDOW });
    expect(empty.queues.map((entry) => entry.queue)).toEqual([...QUEUES]);
    expect(empty.queues.every((entry) => entry.open === 0 && entry.settled === 0)).toBe(true);
  });

  it("counts open and settled items per queue", () => {
    expect(queueOf(health, "data_conflict")).toMatchObject({ open: 1, settled: 1 });
    expect(queueOf(health, "entity_link")).toMatchObject({ open: 2, settled: 1 });
  });

  it("counts open severity by the registry's two values and computes no score", () => {
    expect(queueOf(health, "entity_link")?.openBySeverity).toEqual({ high: 1, low: 1 });
    expect(queueOf(health, "data_conflict")?.openBySeverity).toEqual({ high: 1, low: 0 });
    // A settled high does not inflate an open severity count.
    expect(
      (queueOf(health, "entity_link")?.openBySeverity.high ?? 0) +
        (queueOf(health, "entity_link")?.openBySeverity.low ?? 0),
    ).toBe(queueOf(health, "entity_link")?.open);
  });

  it("distributes the age of the OPEN items and names the longest waiter", () => {
    const entityLink = queueOf(health, "entity_link");
    // 08-28T06:00 and 08-31T06:00 against 09-01T12:00.
    expect(entityLink?.openAge.count).toBe(2);
    expect(entityLink?.openAge.max).toBe(4 * 86_400 + 6 * 3600);
    expect(entityLink?.oldestOpenedAt).toBe("2026-08-28T06:00:00Z");
    expect(queueOf(health, "data_conflict")?.oldestOpenedAt).toBe("2026-08-30T06:00:00Z");
  });

  it("says nothing rather than zero for the age of an empty queue", () => {
    const empty = aggregateQueueHealth({ items: [], window: WINDOW });
    for (const queue of empty.queues) {
      expect(queue.openAge.p50).toBeNull();
      expect(queue.openAge.max).toBeNull();
      expect(queue.oldestOpenedAt).toBeNull();
      expect(queue.folds.foldRate).toBeNull();
      expect(queue.folds.foldsPerItem).toBeNull();
    }
  });

  it("computes fold rates over the queue's items", () => {
    const entityLink = queueOf(health, "entity_link")?.folds;
    expect(entityLink).toMatchObject({ items: 3, foldedItems: 2, folds: 8 });
    expect(entityLink?.foldRate).toBeCloseTo(2 / 3);
    expect(entityLink?.foldsPerItem).toBeCloseTo(8 / 3);

    const dataConflict = queueOf(health, "data_conflict")?.folds;
    expect(dataConflict).toMatchObject({ items: 2, foldedItems: 1, folds: 2 });
    expect(dataConflict?.foldRate).toBe(0.5);
  });

  it("counts opens into the week they opened in, zeros included", () => {
    const entityLink = queueOf(health, "entity_link");
    expect(entityLink?.weeks.map((week) => week.weekStart)).toEqual([
      "2026-08-24",
      "2026-08-31",
    ]);
    expect(entityLink?.weeks.map((week) => week.opened)).toEqual([1, 2]);
    expect(queueOf(health, "data_conflict")?.weeks.map((week) => week.opened)).toEqual([2, 0]);
  });

  it("says settles-per-week is UNKNOWABLE rather than reporting zero settles", () => {
    // There is no settle timestamp on review_items; `verdicts` arrives with
    // M2's handoff. A zero here would tune the escalation cutoffs on a fiction.
    expect(health.settlesMeasurable).toBe(false);
    for (const queue of health.queues) {
      for (const week of queue.weeks) {
        expect(week.settled).toBeNull();
      }
    }
    // …even though settled items were plainly read.
    expect(health.queues.reduce((sum, queue) => sum + queue.settled, 0)).toBe(2);
  });

  it("summarises by kind through the review domain, not a second derivation", () => {
    // `summarizeByKind` counts OPEN items only: two decisions, one signal.
    expect(health.byKind.decision).toMatchObject({ open: 2, maxSeverity: "high" });
    expect(health.byKind.signal).toMatchObject({
      open: 1,
      maxSeverity: "high",
      oldestOpenedAt: "2026-08-28T06:00:00Z",
    });
  });

  it("carries the window it read, and the item count as a floor when truncated", () => {
    const truncated = aggregateQueueHealth({
      items: population(),
      window: { ...WINDOW, truncated: true },
    });
    expect(truncated.items).toBe(5);
    expect(truncated.window.truncated).toBe(true);
  });
});

describe("readQueueHealth", () => {
  it("fetches and aggregates in one call", async () => {
    const stub = withRows(population());
    const result = await readQueueHealth({ now: NOW, days: 7 }, stub.asSupabaseClient());
    expect(result.kind === "ok" && result.data.items).toBe(5);
  });

  it("passes a not-provisioned database straight through", async () => {
    const stub = stubClient({ [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) } });
    await expect(readQueueHealth({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.reviewItems,
    });
  });
});
