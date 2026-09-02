import { describe, expect, it } from "vitest";
import {
  KINDS,
  SHAPES,
  kindOf,
  kindOfItem,
  matchesFilter,
  oldestOpenedAt,
  queueOrder,
  selectItems,
  shapeOf,
  shapesOfKind,
  summarizeByKind,
  type Kind,
  type ReviewItemRow,
  type Shape,
} from "@/lib/review/shapes";
import {
  ID,
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemShapes,
  reviewItemSourcePattern,
} from "../../fixtures/rows";

/**
 * The review-item domain (campaign admin-window/TASK-0006) — spec §6 for the
 * shapes and their kinds, §4 for the ordering and the filters.
 *
 * The fixture builders are the population: a row hand-rolled here would be a
 * row nobody verified against migration `20260901000002`.
 */

/**
 * The full population acceptance test 4 asks for: all three shapes in both
 * statuses, six rows, distinct ids, deliberately in an order that is NOT the
 * queue order.
 */
function population(): ReviewItemRow[] {
  return [
    reviewItemSourcePattern({
      review_item_id: "01920000-0000-7000-8000-000000000513",
      status: "settled",
      severity: "high",
      opened_at: "2026-08-22T06:00:00Z",
    }),
    reviewItemDataConflict(), // open, high, 08-30
    reviewItemEntityLink({
      review_item_id: "01920000-0000-7000-8000-000000000512",
      status: "settled",
      severity: "low",
      opened_at: "2026-08-20T06:00:00Z",
    }),
    reviewItemSourcePattern(), // open, high, 08-28
    reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000511",
      status: "settled",
      severity: "low",
      opened_at: "2026-08-21T06:00:00Z",
    }),
    // The open LOW item is the OLDEST open one, so severity and age disagree:
    // an ordering that dropped the severity rule and kept the age rule would
    // put this first, and every assertion below would still pass. It did, once
    // (admin-window/TASK-0006, caught by deliberately breaking the comparator).
    reviewItemEntityLink({ opened_at: "2026-08-25T06:00:00Z" }), // open, low, 08-25
  ];
}

const ids = (items: ReviewItemRow[]) => items.map((i) => i.review_item_id);

describe("shapeOf and kindOf — the three shapes of spec §6", () => {
  it("reads a data_conflict fact item as a decision", () => {
    const item = reviewItemDataConflict();
    expect(shapeOf(item)).toBe("data_conflict_fact");
    expect(kindOfItem(item)).toBe("decision");
  });

  it("reads an entity_link item with no source_id as a fact decision", () => {
    const item = reviewItemEntityLink();
    expect(item.source_id).toBeNull();
    expect(shapeOf(item)).toBe("entity_link_fact");
    expect(kindOfItem(item)).toBe("decision");
  });

  it("reads an entity_link item with a source_id as a source-pattern signal", () => {
    const item = reviewItemSourcePattern();
    expect(item.source_id).not.toBeNull();
    expect(shapeOf(item)).toBe("entity_link_source_pattern");
    expect(kindOfItem(item)).toBe("signal");
  });

  it("discriminates on source_id, not on the fact columns", () => {
    // The trap the migration warns about: an entity_link fact item is usually
    // about a record with no canonical row yet, so `entity_id` is null and
    // `domain`/`field` may be too. Reading nullness of those instead of
    // `source_id` would misfile the commonest item in the queue as a signal.
    const bare = reviewItemEntityLink({ domain: null, entity_id: null, field: null });
    expect(shapeOf(bare)).toBe("entity_link_fact");
    expect(kindOfItem(bare)).toBe("decision");

    // And the mirror: a per-source item that (contrary to the subject rule)
    // still carried fact columns is a signal, because `source_id` is set.
    const stillSourced = reviewItemSourcePattern({ domain: "events", field: "venue" });
    expect(shapeOf(stillSourced)).toBe("entity_link_source_pattern");
    expect(kindOfItem(stillSourced)).toBe("signal");
  });

  it("classifies every fixture shape and nothing else", () => {
    expect(reviewItemShapes().map(shapeOf)).toEqual([
      "data_conflict_fact",
      "entity_link_fact",
      "entity_link_source_pattern",
    ]);
    expect(reviewItemShapes().map(kindOfItem)).toEqual([
      "decision",
      "decision",
      "signal",
    ]);
  });

  it("maps every shape to a kind, and groups the kinds by their shapes", () => {
    expect([...SHAPES].sort()).toEqual(
      (
        [
          "data_conflict_fact",
          "entity_link_fact",
          "entity_link_source_pattern",
        ] as Shape[]
      ).sort(),
    );
    for (const shape of SHAPES) expect(KINDS).toContain(kindOf(shape));
    expect(shapesOfKind("decision")).toEqual([
      "data_conflict_fact",
      "entity_link_fact",
    ]);
    expect(shapesOfKind("signal")).toEqual(["entity_link_source_pattern"]);
  });

  it("is total — a shape comes back for a row of either queue", () => {
    // No caller has an exception path, so nothing may throw here.
    for (const item of population()) {
      expect(SHAPES).toContain(shapeOf(item));
      expect(KINDS).toContain(kindOfItem(item));
    }
  });
});

describe("queueOrder — open first, then severity, then age (§4)", () => {
  it("puts every open item before every settled one", () => {
    const ordered = queueOrder(population());
    const firstSettled = ordered.findIndex((i) => i.status === "settled");
    expect(firstSettled).toBe(3);
    expect(ordered.slice(0, 3).every((i) => i.status === "open")).toBe(true);
    expect(ordered.slice(3).every((i) => i.status === "settled")).toBe(true);
  });

  it("puts high severity before low, within a status", () => {
    const open = queueOrder(population()).filter((i) => i.status === "open");
    const firstLow = open.findIndex((i) => i.severity === "low");
    expect(firstLow).toBeGreaterThan(0);
    expect(open.slice(0, firstLow).every((i) => i.severity === "high")).toBe(true);
    expect(open.slice(firstLow).every((i) => i.severity === "low")).toBe(true);
  });

  it("puts the oldest first among items tied on status and severity", () => {
    const older = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000521",
      opened_at: "2026-08-01T06:00:00Z",
    });
    const newer = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000522",
      opened_at: "2026-08-29T06:00:00Z",
    });
    expect(ids(queueOrder([newer, older]))).toEqual([
      older.review_item_id,
      newer.review_item_id,
    ]);
  });

  it("orders the whole population exactly", () => {
    expect(ids(queueOrder(population()))).toEqual([
      ID.reviewItemSourcePattern, // open,    high, 08-28
      ID.reviewItemDataConflict, // open,    high, 08-30
      ID.reviewItemEntityLink, // open,    low,  08-25  (older, but low)
      "01920000-0000-7000-8000-000000000513", // settled, high, 08-22
      "01920000-0000-7000-8000-000000000512", // settled, low,  08-20  (older, but low)
      "01920000-0000-7000-8000-000000000511", // settled, low,  08-21
    ]);
  });

  it("ranks severity above age — a newer high outranks an older low", () => {
    const olderLow = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000541",
      severity: "low",
      opened_at: "2026-01-01T00:00:00Z",
    });
    const newerHigh = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000542",
      severity: "high",
      opened_at: "2026-08-31T00:00:00Z",
    });
    expect(ids(queueOrder([olderLow, newerHigh]))).toEqual([
      newerHigh.review_item_id,
      olderLow.review_item_id,
    ]);
  });

  it("ranks status above severity — an open low outranks a settled high", () => {
    const settledHigh = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000551",
      status: "settled",
      severity: "high",
      opened_at: "2026-01-01T00:00:00Z",
    });
    const openLow = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000552",
      status: "open",
      severity: "low",
      opened_at: "2026-08-31T00:00:00Z",
    });
    expect(ids(queueOrder([settledHigh, openLow]))).toEqual([
      openLow.review_item_id,
      settledHigh.review_item_id,
    ]);
  });

  it("compares instants, not strings — an offset spelling sorts with a Z one", () => {
    // PostgREST spells `+00:00` where a fixture spells `Z`; lexicographically
    // "2026-08-30T06:00:00+00:00" sorts BEFORE "2026-08-29T06:00:00Z".
    const offsetNewer = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000531",
      opened_at: "2026-08-30T06:00:00+00:00",
    });
    const zOlder = reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000532",
      opened_at: "2026-08-29T06:00:00Z",
    });
    expect(ids(queueOrder([offsetNewer, zOlder]))).toEqual([
      zOlder.review_item_id,
      offsetNewer.review_item_id,
    ]);
  });

  it("is total and independent of input order", () => {
    const forward = ids(queueOrder(population()));
    const reversed = ids(queueOrder([...population()].reverse()));
    expect(reversed).toEqual(forward);
  });

  it("does not mutate its input", () => {
    const items = population();
    const before = ids(items);
    queueOrder(items);
    expect(ids(items)).toEqual(before);
  });

  it("handles an empty queue", () => {
    expect(queueOrder([])).toEqual([]);
  });
});

describe("the filters — exactly the matching items (acceptance test 4)", () => {
  /** The id set a filter returns, and the id set it should return. */
  function expectExactly(
    filter: Parameters<typeof selectItems>[1],
    predicate: (item: ReviewItemRow) => boolean,
  ) {
    const all = population();
    const got = ids(selectItems(all, filter)).sort();
    const want = ids(all.filter(predicate)).sort();
    expect(want.length).toBeGreaterThan(0); // the filter must be exercised
    expect(got).toEqual(want); // no extras
    expect(want.every((id) => got.includes(id))).toBe(true); // none missing
  }

  it("returns exactly the items of each queue", () => {
    expectExactly({ queue: "data_conflict" }, (i) => i.queue === "data_conflict");
    expectExactly({ queue: "entity_link" }, (i) => i.queue === "entity_link");
  });

  it("returns exactly the items of each shape", () => {
    for (const shape of SHAPES) {
      expectExactly({ shape }, (i) => shapeOf(i) === shape);
    }
  });

  it("returns exactly the items of each kind", () => {
    for (const kind of KINDS) {
      expectExactly({ kind }, (i) => kindOfItem(i) === kind);
    }
  });

  it("returns exactly the items of each status — settled stays browsable", () => {
    expectExactly({ status: "open" }, (i) => i.status === "open");
    expectExactly({ status: "settled" }, (i) => i.status === "settled");
  });

  it("combines fields with AND", () => {
    expectExactly(
      { queue: "entity_link", status: "open" },
      (i) => i.queue === "entity_link" && i.status === "open",
    );
    expectExactly(
      { shape: "entity_link_source_pattern", status: "settled" },
      (i) => shapeOf(i) === "entity_link_source_pattern" && i.status === "settled",
    );
  });

  it("returns nothing for a contradictory filter, rather than everything", () => {
    // A shape of one kind asked for under the other kind: an empty set is the
    // right answer; an unimplemented field would quietly return all six.
    expect(
      selectItems(population(), { shape: "entity_link_source_pattern", kind: "decision" }),
    ).toEqual([]);
    expect(
      selectItems(population(), { queue: "data_conflict", shape: "entity_link_fact" }),
    ).toEqual([]);
  });

  it("an empty filter constrains nothing", () => {
    expect(ids(selectItems(population(), {}))).toEqual(ids(population()));
    expect(ids(selectItems(population()))).toEqual(ids(population()));
    expect(matchesFilter(reviewItemDataConflict())).toBe(true);
  });

  it("preserves input order — ordering is queueOrder's job alone", () => {
    const all = population();
    const openIds = ids(all.filter((i) => i.status === "open"));
    expect(ids(selectItems(all, { status: "open" }))).toEqual(openIds);
  });
});

describe("summarizeByKind — the Dashboard's attention summary (§4, §5)", () => {
  it("counts open items per kind and ignores settled ones", () => {
    const summary = summarizeByKind(population());
    expect(summary.decision.open).toBe(2); // data_conflict + entity_link fact
    expect(summary.signal.open).toBe(1); // the source pattern
    expect(summary.decision.kind).toBe("decision");
    expect(summary.signal.kind).toBe("signal");
  });

  it("reports max severity as the presence of a high, per kind", () => {
    const summary = summarizeByKind(population());
    expect(summary.decision.maxSeverity).toBe("high");
    expect(summary.signal.maxSeverity).toBe("high");

    const lowOnly = summarizeByKind([
      reviewItemDataConflict({ severity: "low" }),
      reviewItemEntityLink({ severity: "low" }),
    ]);
    expect(lowOnly.decision.maxSeverity).toBe("low");
  });

  it("reports the oldest open opened_at per kind, as a timestamp not an age", () => {
    const summary = summarizeByKind(population());
    expect(summary.decision.oldestOpenedAt).toBe("2026-08-25T06:00:00Z");
    expect(summary.signal.oldestOpenedAt).toBe("2026-08-28T06:00:00Z");
  });

  it("reports both kinds with zeroes and nulls when there is nothing open", () => {
    const settledOnly = population().filter((i) => i.status === "settled");
    const summary = summarizeByKind(settledOnly);
    for (const kind of KINDS) {
      expect(summary[kind as Kind]).toEqual({
        kind,
        open: 0,
        maxSeverity: null,
        oldestOpenedAt: null,
      });
    }
    expect(Object.keys(summarizeByKind([])).sort()).toEqual([...KINDS].sort());
  });

  it("oldestOpenedAt compares instants and is null for an empty set", () => {
    expect(oldestOpenedAt([])).toBeNull();
    expect(
      oldestOpenedAt([
        reviewItemDataConflict({ opened_at: "2026-08-30T06:00:00+00:00" }),
        reviewItemDataConflict({ opened_at: "2026-08-29T23:00:00Z" }),
      ]),
    ).toBe("2026-08-29T23:00:00Z");
  });
});
