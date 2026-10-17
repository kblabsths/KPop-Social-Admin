import { describe, expect, it } from "vitest";
import {
  KINDS,
  SHAPES,
  kindOf,
  kindOfItem,
  matchesFilter,
  matchesShapeColumns,
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
  EDGE_ID,
  ID,
  reviewItemDataConflict,
  reviewItemEdgePopulation,
  reviewItemEntityLink,
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
});

/**
 * The shape's COLUMN CONDITIONS, held against `shapeOf` (campaign
 * admin-window/BUG-0135).
 *
 * `shapeOf` reads a row and says which shape it is; `SHAPE_COLUMNS` says which
 * rows a shape is made of, in conditions a database can apply — and
 * `src/lib/db/review-items.ts` counts each shape's whole-table population from
 * the second. Two spellings of one rule is exactly what §6 forbids, so they
 * are pinned to each other row by row rather than trusted to agree.
 */
describe("SHAPE_COLUMNS is the same rule as shapeOf, pointing the other way", () => {
  it("selects exactly the rows shapeOf assigns, for all three shapes", () => {
    // The EDGE population, because that is where the two could differ: it
    // carries a `data_conflict` row WITH a `source_id`, which `shapeOf` files
    // as a fact item anyway (that queue has no per-source subject) and which a
    // declaration constraining `source_id` on that queue would drop.
    const rows = reviewItemEdgePopulation();
    const withSource = rows.filter(
      (row) => row.queue === "data_conflict" && row.source_id !== null,
    );
    expect(withSource.length, "the edge case this test exists for").toBeGreaterThan(0);

    for (const shape of SHAPES) {
      const declared = rows.filter((row) => matchesShapeColumns(row, shape));
      const classified = rows.filter((row) => shapeOf(row) === shape);
      expect([shape, declared.map((row) => row.review_item_id)]).toEqual([
        shape,
        classified.map((row) => row.review_item_id),
      ]);
    }
  });
});

describe("queueOrder — open first, then severity, then age (§4)", () => {
  it("does not mutate its input", () => {
    const items = population();
    const before = ids(items);
    queueOrder(items);
    expect(ids(items)).toEqual(before);
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

  it("returns exactly the items of one source, and none of a source with no items", () => {
    // `review_items.source_id` as a filter field (admin-window/BUG-0141): the
    // one predicate compares it, so `/queues?source_id=` narrows through the
    // same function every other facet does. A per-fact item carries no source
    // at all and matches no source narrowing.
    expectExactly(
      { source_id: ID.sourceBandsintown },
      (i) => i.source_id === ID.sourceBandsintown,
    );
    expect(
      population().some((i) => i.source_id === ID.sourceTicketmaster),
      "the fixture must hold no item of this source, or the case below is vacuous",
    ).toBe(false);
    expect(selectItems(population(), { source_id: ID.sourceTicketmaster })).toEqual([]);
    // AND with a field of another sort, and a contradiction that must empty.
    expectExactly(
      { source_id: ID.sourceBandsintown, status: "open" },
      (i) => i.source_id === ID.sourceBandsintown && i.status === "open",
    );
    expect(
      matchesFilter(reviewItemDataConflict(), { source_id: ID.sourceBandsintown }),
      "a fact item carries no source",
    ).toBe(false);
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

/* ── QA attack (campaign admin-window, TASK-0006) ─────────────────────────── */

/**
 * The adversarial pass over the edge population: the rows migration
 * `20260901000002` permits and the happy-path fixtures never produce.
 *
 * The oracle below is written out ROW BY ROW rather than computed with
 * `shapeOf`/`kindOfItem`, on purpose. A filter test whose expected set is
 * produced by the same derivation the filter uses cannot fail when that
 * derivation is wrong — both sides move together. Acceptance test 4 says
 * "exactly the matching items", so the matching items are named here.
 */
const EDGE_ORACLE: ReadonlyArray<{
  id: string;
  queue: "data_conflict" | "entity_link";
  status: "open" | "settled";
  shape: Shape;
  kind: Kind;
}> = [
  // subject is a fact; `source_id` is irrelevant on this queue (resolver §11)
  { id: EDGE_ID.dcOpenHigh, queue: "data_conflict", status: "open", shape: "data_conflict_fact", kind: "decision" },
  { id: EDGE_ID.dcOpenLowWithSource, queue: "data_conflict", status: "open", shape: "data_conflict_fact", kind: "decision" },
  { id: EDGE_ID.dcSettledHigh, queue: "data_conflict", status: "settled", shape: "data_conflict_fact", kind: "decision" },
  { id: EDGE_ID.dcTieEarlierId, queue: "data_conflict", status: "open", shape: "data_conflict_fact", kind: "decision" },
  { id: EDGE_ID.dcTieLaterId, queue: "data_conflict", status: "open", shape: "data_conflict_fact", kind: "decision" },
  { id: EDGE_ID.elOpenLow, queue: "entity_link", status: "open", shape: "entity_link_fact", kind: "decision" },
  { id: EDGE_ID.elSettledLow, queue: "entity_link", status: "settled", shape: "entity_link_fact", kind: "decision" },
  // `source_id` set is the whole discriminator — including on the row that
  // also carries a fact subject
  { id: EDGE_ID.spOpenHigh, queue: "entity_link", status: "open", shape: "entity_link_source_pattern", kind: "signal" },
  { id: EDGE_ID.spOpenLowBothSubjects, queue: "entity_link", status: "open", shape: "entity_link_source_pattern", kind: "signal" },
  { id: EDGE_ID.spSettledHigh, queue: "entity_link", status: "settled", shape: "entity_link_source_pattern", kind: "signal" },
];

/** The queue order §4 asks for, read off the population by hand. */
const EDGE_QUEUE_ORDER: readonly string[] = [
  EDGE_ID.dcOpenHigh, // open, high, 08-10
  EDGE_ID.spOpenHigh, // open, high, 08-15
  EDGE_ID.dcTieEarlierId, // open, low, 08-11T00:00Z  — tie, lower id
  EDGE_ID.dcTieLaterId, // open, low, 08-11T00:00+00:00 — same instant, higher id
  EDGE_ID.dcOpenLowWithSource, // open, low, 08-11T06:00
  EDGE_ID.elOpenLow, // open, low, 08-13
  EDGE_ID.spOpenLowBothSubjects, // open, low, 08-17
  EDGE_ID.dcSettledHigh, // settled, high, 08-12
  EDGE_ID.spSettledHigh, // settled, high, 08-16
  EDGE_ID.elSettledLow, // settled, low, 08-14
];

/** A deterministic shuffle — a seeded LCG, so a failure reproduces exactly. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("the edge population — rows the schema permits (QA attack)", () => {
  it("covers all three shapes in both statuses", () => {
    const pop = reviewItemEdgePopulation();
    expect(ids(pop).sort()).toEqual(EDGE_ORACLE.map((r) => r.id).sort());
    for (const shape of SHAPES) {
      for (const status of ["open", "settled"] as const) {
        expect(
          EDGE_ORACLE.filter((r) => r.shape === shape && r.status === status).length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("classifies every row as the oracle says, including the both-subjects and stray-source_id rows", () => {
    const byId = new Map(reviewItemEdgePopulation().map((i) => [i.review_item_id, i]));
    for (const row of EDGE_ORACLE) {
      const item = byId.get(row.id) as ReviewItemRow;
      expect([row.id, shapeOf(item)]).toEqual([row.id, row.shape]);
      expect([row.id, kindOfItem(item)]).toEqual([row.id, row.kind]);
    }
  });

  it("returns exactly the oracle's id set for every combination of the four filter fields", () => {
    const pop = reviewItemEdgePopulation();
    const queues = [undefined, "data_conflict", "entity_link"] as const;
    const statuses = [undefined, "open", "settled"] as const;
    const shapes = [undefined, ...SHAPES] as const;
    const kinds = [undefined, ...KINDS] as const;
    let exercised = 0;

    for (const queue of queues) {
      for (const status of statuses) {
        for (const shape of shapes) {
          for (const kind of kinds) {
            const filter = { queue, status, shape, kind };
            const want = EDGE_ORACLE.filter(
              (r) =>
                (queue === undefined || r.queue === queue) &&
                (status === undefined || r.status === status) &&
                (shape === undefined || r.shape === shape) &&
                (kind === undefined || r.kind === kind),
            ).map((r) => r.id);
            const got = ids(selectItems(pop, filter));
            expect([JSON.stringify(filter), got.slice().sort()]).toEqual([
              JSON.stringify(filter),
              want.slice().sort(),
            ]);
            exercised += 1;
          }
        }
      }
    }
    expect(exercised).toBe(queues.length * statuses.length * shapes.length * kinds.length);
  });

  it("orders the edge population exactly as §4 reads, ties broken stably", () => {
    expect(ids(queueOrder(reviewItemEdgePopulation()))).toEqual([...EDGE_QUEUE_ORDER]);
  });

  it("returns the same order from any input permutation, and loses no row", () => {
    const pop = reviewItemEdgePopulation();
    for (let seed = 1; seed <= 40; seed += 1) {
      const ordered = queueOrder(shuffled(pop, seed));
      expect([seed, ids(ordered)]).toEqual([seed, [...EDGE_QUEUE_ORDER]]);
    }
  });

  it("summarises the edge population per kind without counting settled rows", () => {
    const summary = summarizeByKind(reviewItemEdgePopulation());
    expect(summary.decision).toEqual({
      kind: "decision",
      open: 5,
      maxSeverity: "high",
      oldestOpenedAt: "2026-08-10T00:00:00Z",
    });
    expect(summary.signal).toEqual({
      kind: "signal",
      open: 2,
      maxSeverity: "high",
      oldestOpenedAt: "2026-08-15T00:00:00Z",
    });
  });

  it("does not let a SETTLED high raise a kind's max severity or its oldest age", () => {
    // The fabrication this guards: a summary that reads severity or age over
    // the whole population would report `high` for a kind whose only open item
    // is low, and would date the queue from an item nobody is waiting on.
    const summary = summarizeByKind([
      reviewItemDataConflict({
        review_item_id: EDGE_ID.dcSettledHigh,
        status: "settled",
        severity: "high",
        opened_at: "2026-01-01T00:00:00Z",
      }),
      reviewItemDataConflict({
        review_item_id: EDGE_ID.dcOpenLowWithSource,
        severity: "low",
        opened_at: "2026-08-11T06:00:00Z",
      }),
    ]);
    expect(summary.decision).toEqual({
      kind: "decision",
      open: 1,
      maxSeverity: "low",
      oldestOpenedAt: "2026-08-11T06:00:00Z",
    });
    expect(summary.signal).toEqual({
      kind: "signal",
      open: 0,
      maxSeverity: null,
      oldestOpenedAt: null,
    });
  });
});
