import { describe, expect, it } from "vitest";
import {
  listReviewItems,
  readReviewAttention,
  readReviewQueues,
} from "@/lib/db/review-items";
import {
  SHAPES,
  kindOfItem,
  queueOrder,
  shapeOf,
  type ReviewItemRow,
  type Shape,
} from "@/lib/review/shapes";
import { ROW_CAP } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import {
  EDGE_ID,
  ID,
  reviewItemDataConflict,
  reviewItemEdgePopulation,
  reviewItemEntityLink,
  reviewItemSourcePattern,
} from "../../fixtures/rows";
import {
  isCountLeg,
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  undefinedColumnOfRelation,
  type StubClient,
} from "../../fixtures/stub-client";

/**
 * The `review_items` reads (campaign admin-window/TASK-0006), offline against
 * the stub client. No network, no database.
 *
 * The stub answers with whatever the script says regardless of the chain the
 * query built, which is exactly why the filter assertions below matter: if
 * `listReviewItems` leaned on PostgREST alone to narrow, these would return
 * the whole population and the "exactly the matching items" criterion would be
 * unprovable offline — and untrue for any filter with no column behind it.
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
    // Oldest open item, and LOW: severity and age disagree here on purpose, so
    // the order below cannot be satisfied by the age rule alone.
    reviewItemEntityLink({ opened_at: "2026-08-25T06:00:00Z" }), // open, low, 08-25
  ];
}

const ids = (items: ReviewItemRow[]) => items.map((i) => i.review_item_id);

/**
 * A stub whose `review_items` read answers with these rows AND the exact count
 * of them — the response a `{ count: "exact" }` select really returns.
 *
 * The count is part of the fixture since admin-window/TASK-0026 made this a
 * COMPLETE read: without it the helper cannot tell a whole set from a
 * truncated one, and refuses. Scripting `count: rows.length` is a database
 * that holds exactly these rows; the truncation cases below script a larger
 * count on purpose.
 */
function withRows(rows: ReviewItemRow[]) {
  return stubClient({ [T.reviewItems]: { data: rows, count: rows.length } });
}

/**
 * A stub whose `review_items` reads answer PER LEG (admin-window/BUG-0135).
 *
 * `readReviewQueues` on a faceted URL makes the URL's own row read, then one
 * HEAD count per counted shape, in `SHAPES` order. The stub answers every read
 * of a table from one script entry unless the entry is a queue
 * (`tests/fixtures/stub-client.ts`), so a single `withRows` hands the same
 * count to every leg and no population assertion can distinguish them.
 *
 * `legOne` is what the row read returns — the whole table stands in for a
 * database that narrowed nothing, exactly as everywhere else in this file —
 * and `table` is what the database HOLDS, which is what the counts are of.
 *
 * `counted` is which shapes this URL is expected to COUNT, in `SHAPES` order,
 * because the read no longer counts all three on every faceted URL
 * (admin-window/DEBT-0012): the legs are consumed in order, so a script listing
 * a shape the read skips would hand that shape's count to the next shape's leg.
 * It defaults to all three, which is what every URL narrowing both kinds costs.
 */
function withLegs(
  legOne: ReviewItemRow[],
  table: ReviewItemRow[],
  counted: readonly Shape[] = SHAPES,
) {
  return stubClient({
    [T.reviewItems]: [
      { data: legOne, count: legOne.length },
      ...counted.map((shape) => ({
        // A head count returns no rows at all — only the count.
        data: null,
        count: table.filter((row) => shapeOf(row) === shape).length,
      })),
    ],
  });
}

/**
 * Each kind's shapes, in `SHAPES` order — spelled from spec §6 ("the two fact
 * items are decisions, the source-pattern item is the signal") rather than read
 * out of `shapesOfKind`, so a `lib/review` that regrouped the shapes would
 * disagree with this file instead of agreeing with itself.
 */
const DECISION_SHAPES: readonly Shape[] = ["data_conflict_fact", "entity_link_fact"];
const SIGNAL_SHAPES: readonly Shape[] = ["entity_link_source_pattern"];

/** The count each kind's population came back as, unwrapped, or the refusal's kind. */
function populationOf(result: Awaited<ReturnType<typeof readReviewQueues>>) {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
  return result.data.population;
}

describe("listReviewItems", () => {
  it("reads review_items and returns the rows in queue order", async () => {
    const stub = withRows(population());
    const result = await listReviewItems({}, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(stub.tablesRead()).toEqual([T.reviewItems]);
    expect(ids(result.data)).toEqual([
      ID.reviewItemSourcePattern, // open,    high, 08-28
      ID.reviewItemDataConflict, // open,    high, 08-30
      ID.reviewItemEntityLink, // open,    low,  08-25 (older, but low)
      "01920000-0000-7000-8000-000000000513", // settled, high, 08-22
      "01920000-0000-7000-8000-000000000512", // settled, low,  08-20
    ]);
  });

  it("selects an explicit column list, not a star", async () => {
    const stub = withRows(population());
    await listReviewItems({}, stub.asSupabaseClient());

    const select = stub.calls[0].steps.find((step) => step.method === "select");
    const columns = String(select?.args[0] ?? "");
    expect(columns).not.toContain("*");
    // The subject columns and the ordering columns must be among them, or the
    // shapes and the order would be derived from absent fields.
    for (const column of [
      "review_item_id",
      "queue",
      "source_id",
      "severity",
      "status",
      "opened_at",
      "evidence",
    ]) {
      expect(columns).toContain(column);
    }
  });

  it("pushes the column filters it can to the database", async () => {
    const stub = withRows(population());
    await listReviewItems(
      { queue: "entity_link", status: "open" },
      stub.asSupabaseClient(),
    );
    const eqs = stub.calls[0].steps.filter((step) => step.method === "eq");
    expect(eqs.map((step) => step.args)).toEqual([
      ["queue", "entity_link"],
      ["status", "open"],
    ]);
  });

  it("sends no eq for a derived filter — there is no shape or kind column", async () => {
    const stub = withRows(population());
    await listReviewItems({ shape: "entity_link_fact" }, stub.asSupabaseClient());
    const eqColumns = stub.calls[0].steps
      .filter((step) => step.method === "eq")
      .map((step) => step.args[0]);
    expect(eqColumns).toEqual([]);
  });

  it("returns exactly the matching items for every shape filter", async () => {
    for (const shape of SHAPES) {
      const all = population();
      const stub = withRows(all);
      const result = await listReviewItems({ shape }, stub.asSupabaseClient());
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") continue;
      expect(ids(result.data).sort()).toEqual(
        ids(all.filter((i) => shapeOf(i) === shape)).sort(),
      );
      expect(result.data.every((i) => shapeOf(i) === shape)).toBe(true);
    }
  });

  it("returns exactly the matching items for every queue and kind filter", async () => {
    for (const queue of ["data_conflict", "entity_link"] as const) {
      const all = population();
      const result = await listReviewItems({ queue }, withRows(all).asSupabaseClient());
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(ids(result.data).sort()).toEqual(
        ids(all.filter((i) => i.queue === queue)).sort(),
      );
    }
    for (const kind of ["decision", "signal"] as const) {
      const all = population();
      const result = await listReviewItems({ kind }, withRows(all).asSupabaseClient());
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(ids(result.data).sort()).toEqual(
        ids(all.filter((i) => kindOfItem(i) === kind)).sort(),
      );
    }
  });

  it("returns an empty ok for an empty table, never a null", async () => {
    const stub = stubClient({ [T.reviewItems]: { data: null, count: 0 } });
    expect(await listReviewItems({}, stub.asSupabaseClient())).toEqual({
      kind: "ok",
      data: [],
    });
  });

  it("classifies an absent table as not_provisioned, naming it", async () => {
    const stub = stubClient({
      [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
    });
    expect(await listReviewItems({}, stub.asSupabaseClient())).toEqual({
      kind: "not_provisioned",
      missing: T.reviewItems,
    });
  });

  it("classifies an absent column as not_provisioned, naming table and column", async () => {
    const stub = stubClient({
      [T.reviewItems]: {
        error: undefinedColumnOfRelation(T.reviewItems, "folded_count"),
      },
    });
    expect(await listReviewItems({}, stub.asSupabaseClient())).toEqual({
      kind: "not_provisioned",
      missing: `${T.reviewItems}.folded_count`,
    });
  });

  it("surfaces any other failure as the database's own message, and throws nothing", async () => {
    const stub = stubClient({
      [T.reviewItems]: { error: permissionDenied(T.reviewItems) },
    });
    const result = await listReviewItems({}, stub.asSupabaseClient());
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain(permissionDenied(T.reviewItems).message);
    expect(result.reading).toBe(T.reviewItems);
  });
});

/**
 * The complete-read contract (ARCHITECTURE.md §4.3, admin-window/TASK-0026).
 *
 * `listReviewItems` presents its result as exactly the matching items and
 * `readReviewAttention` counts it, so a silently truncated row set would make
 * both WRONG rather than refused. These assert the query that makes truncation
 * detectable, and that a detected truncation never becomes an ok.
 */
describe("listReviewItems is a complete read", () => {
  it("asks for the exact count", async () => {
    const stub = withRows(population());
    await listReviewItems({}, stub.asSupabaseClient());
    const select = stub.calls[0].steps.find((step) => step.method === "select");
    expect(select?.args[1]).toMatchObject({ count: "exact" });
  });

  it("bounds the read with an explicit range at the shared cap", async () => {
    const stub = withRows(population());
    await listReviewItems({}, stub.asSupabaseClient());
    const range = stub.calls[0].steps.find((step) => step.method === "range");
    expect(range?.args).toEqual([0, ROW_CAP - 1]);
  });

  it("orders server-side on a total key ending in the primary key", async () => {
    // Without a total order the subset a cap returns is arbitrary and a
    // refusal is not reproducible. The last key must be the primary key, or
    // rows tied on the others can still reshuffle between reads.
    const stub = withRows(population());
    await listReviewItems({}, stub.asSupabaseClient());
    const orders = stub.calls[0].steps
      .filter((step) => step.method === "order")
      .map((step) => step.args[0]);
    expect(orders).toEqual(["status", "severity", "opened_at", "review_item_id"]);
  });

  it("refuses when the database holds more rows than it returned", async () => {
    const rows = population();
    const stub = stubClient({
      [T.reviewItems]: { data: rows, count: rows.length + 732 },
    });
    const result = await listReviewItems({}, stub.asSupabaseClient());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    // The object the read asked for is carried by the result, not spelled
    // into the prose (BUG-0016: every error arm names its read).
    expect(result.reading).toBe(T.reviewItems);
    expect(result.message).toContain(String(rows.length + 732));
    expect(result.message).toContain(String(ROW_CAP));
    // A partial queue list would look exactly like a short queue.
    expect(result).not.toHaveProperty("data");
  });

  it("refuses when the response carries no count at all", async () => {
    const stub = stubClient({ [T.reviewItems]: { data: population() } });
    const result = await listReviewItems({}, stub.asSupabaseClient());
    expect(result.kind).toBe("error");
    expect(result).not.toHaveProperty("data");
  });

  it("keeps queueOrder as the display authority, applied after the read", async () => {
    // The stub answers whatever the script holds regardless of the `.order()`
    // chain — so it stands in for a server order that disagrees. The rendered
    // order comes back right anyway, which is the property: the query's order
    // is for determinism, `queueOrder` decides what the page shows.
    const rows = population();
    const stub = stubClient({
      [T.reviewItems]: { data: [...rows].reverse(), count: rows.length },
    });
    const result = await listReviewItems({}, stub.asSupabaseClient());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(ids(result.data)).toEqual(ids(queueOrder(rows)));
  });
});

describe("readReviewAttention", () => {
  it("summarises the open items per kind", async () => {
    const stub = withRows(population());
    const result = await readReviewAttention(stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.decision).toEqual({
      kind: "decision",
      open: 2,
      maxSeverity: "high",
      oldestOpenedAt: "2026-08-25T06:00:00Z",
    });
    expect(result.data.signal).toEqual({
      kind: "signal",
      open: 1,
      maxSeverity: "high",
      oldestOpenedAt: "2026-08-28T06:00:00Z",
    });
  });

  it("asks the database for the open ones", async () => {
    const stub = withRows(population());
    await readReviewAttention(stub.asSupabaseClient());
    expect(
      stub.calls[0].steps.filter((step) => step.method === "eq").map((s) => s.args),
    ).toEqual([["status", "open"]]);
  });

  it("reports both kinds at zero against an empty table", async () => {
    const stub = stubClient({ [T.reviewItems]: { data: [], count: 0 } });
    const result = await readReviewAttention(stub.asSupabaseClient());
    expect(result).toEqual({
      kind: "ok",
      data: {
        decision: { kind: "decision", open: 0, maxSeverity: null, oldestOpenedAt: null },
        signal: { kind: "signal", open: 0, maxSeverity: null, oldestOpenedAt: null },
      },
    });
  });

  it("refuses rather than reporting an open count over a truncated set", async () => {
    // The failure this whole ticket exists for: 5 open items counted out of a
    // table the database says holds 1732 matching rows would be a WRONG
    // number on the Dashboard, not a refused one.
    const rows = population();
    const stub = stubClient({ [T.reviewItems]: { data: rows, count: 1732 } });
    const result = await readReviewAttention(stub.asSupabaseClient());
    expect(result.kind).toBe("error");
    expect(result).not.toHaveProperty("data");
  });

  it("propagates not_provisioned rather than reporting zero attention", async () => {
    // A missing table must not read as "nothing needs attention" on the
    // Dashboard — that is the failure mode acceptance test 9 exists for.
    const stub = stubClient({
      [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
    });
    expect(await readReviewAttention(stub.asSupabaseClient())).toEqual({
      kind: "not_provisioned",
      missing: T.reviewItems,
    });
  });
});

/* ── QA attack (campaign admin-window, TASK-0006) ─────────────────────────── */

/**
 * The same edge population the domain tests attack, driven through the data
 * layer. The stub answers every query with the WHOLE table regardless of the
 * `.eq` chain — which is the point: it stands in for a database that does not
 * narrow (a filter with no column behind it, a stale schema cache, a view that
 * ignores the predicate), and the returned set must still be exactly the
 * matching one.
 */
const EDGE_SHAPE_IDS: Record<string, string[]> = {
  data_conflict_fact: [
    EDGE_ID.dcOpenHigh,
    EDGE_ID.dcOpenLowWithSource,
    EDGE_ID.dcSettledHigh,
    EDGE_ID.dcTieEarlierId,
    EDGE_ID.dcTieLaterId,
  ],
  entity_link_fact: [EDGE_ID.elOpenLow, EDGE_ID.elSettledLow],
  entity_link_source_pattern: [
    EDGE_ID.spOpenHigh,
    EDGE_ID.spOpenLowBothSubjects,
    EDGE_ID.spSettledHigh,
  ],
};

describe("listReviewItems over the edge population (QA attack)", () => {
  it("returns exactly the matching ids for each shape when the database narrows nothing", async () => {
    for (const shape of SHAPES) {
      const stub = withRows(reviewItemEdgePopulation());
      const result = await listReviewItems({ shape }, stub.asSupabaseClient());
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect([shape, ids(result.data).sort()]).toEqual([
        shape,
        EDGE_SHAPE_IDS[shape].slice().sort(),
      ]);
    }
  });

  it("returns exactly the matching ids for a kind + status combination", async () => {
    const stub = withRows(reviewItemEdgePopulation());
    const result = await listReviewItems(
      { kind: "signal", status: "open" },
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(ids(result.data)).toEqual([EDGE_ID.spOpenHigh, EDGE_ID.spOpenLowBothSubjects]);
  });

  it("returns the whole edge population in queue order for an empty filter", async () => {
    const stub = withRows(reviewItemEdgePopulation());
    const result = await listReviewItems({}, stub.asSupabaseClient());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(ids(result.data)).toEqual([
      EDGE_ID.dcOpenHigh,
      EDGE_ID.spOpenHigh,
      EDGE_ID.dcTieEarlierId,
      EDGE_ID.dcTieLaterId,
      EDGE_ID.dcOpenLowWithSource,
      EDGE_ID.elOpenLow,
      EDGE_ID.spOpenLowBothSubjects,
      EDGE_ID.dcSettledHigh,
      EDGE_ID.spSettledHigh,
      EDGE_ID.elSettledLow,
    ]);
  });
});

describe("readReviewAttention over the edge population (QA attack)", () => {
  it("counts only the open items even when the database returns the settled ones too", async () => {
    // The `.eq("status","open")` push-down is an optimisation; the stub ignores
    // it, so these numbers come from the in-code filter alone. A summary that
    // trusted the server would report 10 open items here instead of 7.
    const stub = withRows(reviewItemEdgePopulation());
    const result = await readReviewAttention(stub.asSupabaseClient());
    expect(result).toEqual({
      kind: "ok",
      data: {
        decision: {
          kind: "decision",
          open: 5,
          maxSeverity: "high",
          oldestOpenedAt: "2026-08-10T00:00:00Z",
        },
        signal: {
          kind: "signal",
          open: 2,
          maxSeverity: "high",
          oldestOpenedAt: "2026-08-15T00:00:00Z",
        },
      },
    });
  });

  it("reports no attention rather than throwing when the read is refused", async () => {
    const stub = stubClient({ [T.reviewItems]: { error: permissionDenied(T.reviewItems) } });
    const result = await readReviewAttention(stub.asSupabaseClient());
    expect(result.kind).toBe("error");
  });
});

describe("readReviewQueues", () => {
  /**
   * The Queues page's read (campaign admin-window/BUG-0133): the filtered rows
   * AND each kind's whole-table count, so a block can tell "my queue is empty"
   * from "the filter matched nothing". The stub answers every read of a table
   * with the same script whatever the chain built, so the population here is
   * the population `selectItems` finds in the scripted rows.
   */
  it("returns the filtered rows beside the WHOLE-TABLE count of the kind the URL emptied", async () => {
    const rows = population();
    const stub = withLegs(rows, rows, DECISION_SHAPES);
    const result = await readReviewQueues({ kind: "signal" }, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // the rows are the filtered ones...
    expect(ids(result.data.items)).toEqual(
      ids(queueOrder(rows.filter((row) => kindOfItem(row) === "signal"))),
    );
    // ...and the DECISION population is NOT: it counts every decision row the
    // table holds, settled ones included, which is the set the bare `/queues`
    // renders in that block. That is the figure the four-state rule needs, and
    // it needs it for exactly this kind — the one whose rows this URL removed.
    expect(result.data.population.decision).toEqual({
      kind: "ok",
      data: rows.filter((row) => kindOfItem(row) === "decision").length,
    });
    // The SIGNAL population was never asked for, and says so: this URL removes
    // no signal row, so `isSurfaceNarrowed` reads that block as unscoped from
    // fact 1 alone and no count could change a word of it
    // (admin-window/DEBT-0012). `not_asked` is a third state — not the zero
    // that would claim an empty queue, and not a refusal to report.
    expect(result.data.population.signal).toEqual({ kind: "not_asked" });
  });

  it("counts a kind the filter emptied as the rows it really holds", async () => {
    // The seam the defect lived in: the filtered read cannot see the rows the
    // facet removed, so a decision block reading only its own result cannot
    // tell this state from an empty table.
    const rows = population();
    const stub = withLegs(rows, rows, DECISION_SHAPES);
    const result = await readReviewQueues({ kind: "signal" }, stub.asSupabaseClient());

    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.data.items.filter((row) => kindOfItem(row) === "decision")).toEqual([]);
    expect(result.data.population.decision).toEqual({
      kind: "ok",
      data: rows.filter((row) => kindOfItem(row) === "decision").length,
    });
  });

  it("reports a real zero for a kind the TABLE holds none of", async () => {
    const signals = population().filter((row) => kindOfItem(row) === "signal");
    const stub = withLegs(signals, signals);
    const result = await readReviewQueues({ status: "open" }, stub.asSupabaseClient());

    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    // A real zero, from a count the database gave — never a gap and never a
    // refusal dressed as nothing (ARCHITECTURE.md §4.3).
    expect(result.data.population.decision).toEqual({ kind: "ok", data: 0 });
    expect(result.data.population.signal).toEqual({ kind: "ok", data: signals.length });
  });

  it("reads ONCE when the URL narrows nothing, and is its own population", async () => {
    // The bare `/queues` must not pay for a second read: the unfiltered result
    // already IS the whole table. Not one count leg is issued either.
    const rows = population();
    const stub = withLegs(rows, rows);
    const result = await readReviewQueues({}, stub.asSupabaseClient());

    expect(stub.tablesRead().filter((table) => table === T.reviewItems)).toHaveLength(1);
    const counted = populationOf(result);
    if (counted.decision.kind !== "ok" || counted.signal.kind !== "ok") {
      throw new Error("expected both populations ok");
    }
    expect(counted.decision.data + counted.signal.data).toBe(rows.length);
  });

  it("refuses whole rather than reporting a population the database never gave", async () => {
    // Both legs are the same table and the same query; a refusal on either is
    // the page's refusal. A count the app substituted would be exactly the
    // figure LOOK_AND_FEEL state 3 forbids.
    for (const [name, script] of [
      ["absent", tableNotInSchemaCache(T.reviewItems)],
      ["refused", permissionDenied(T.reviewItems)],
    ] as const) {
      const stub = stubClient({ [T.reviewItems]: { error: script } });
      const result = await readReviewQueues({ kind: "signal" }, stub.asSupabaseClient());
      expect(result.kind, name).not.toBe("ok");
      expect(result, name).not.toHaveProperty("data.population");
    }
  });

  /**
   * Landed red by QA as a strict `it.fails` pin (admin-window/BUG-0135) and
   * flipped to `it` by the fix: a population leg that could not be read no
   * longer deletes the rows the URL's own complete read DID return.
   *
   * The population leg is unconditionally the WHOLE table, so no URL facet
   * narrows it: past `ROW_CAP` it refuses for every faceted URL, including the
   * `?queue=`/`?status=` ones PostgREST narrowed by a real column and answered
   * in full. It decides four words of a sub-line and which empty card shows,
   * and it renders no row of its own — the refusal belongs BESIDE the rows, the
   * way `/claims` reports a source registry that would not read while every
   * claim still renders, not INSTEAD of them. Which shape carries it is the
   * fix's choice; this asserts only that the rows reach the caller.
   *
   * Its sibling below is the other half and must stay green: when the FILTERED
   * leg is the truncated one, those rows really are unknown and the read
   * refuses.
   */
  it(
    "keeps the rows its own complete read returned when only the POPULATION leg is truncated (admin-window/BUG-0135)",
    async () => {
      const rows = population();
      const conflicts = rows.filter((row) => row.queue === "data_conflict");
      expect(conflicts.length).toBeGreaterThan(0);
      const stub = stubClient({
        [T.reviewItems]: [
          // Leg 1 — the URL's own read, narrowed at the database by the
          // `queue` COLUMN and complete: every matching row, counted.
          { data: conflicts, count: conflicts.length },
          // Leg 2 — the population: the whole table, past the cap.
          { data: rows, count: ROW_CAP + 500 },
        ],
      });
      const result = await readReviewQueues(
        { queue: "data_conflict" },
        stub.asSupabaseClient(),
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(ids(result.data.items)).toEqual(ids(queueOrder(conflicts)));
    },
  );

  it("refuses a truncated read rather than counting a population it did not see", async () => {
    const stub = stubClient({
      [T.reviewItems]: { data: reviewItemEdgePopulation(), count: ROW_CAP + 40 },
    });
    const result = await readReviewQueues({ kind: "signal" }, stub.asSupabaseClient());
    expect(result.kind).toBe("error");
  });
});

/**
 * The POPULATION leg, as admin-window/BUG-0135 shapes it: one count per shape,
 * built from the declaration in `src/lib/review/shapes.ts`, each kind's figure
 * the sum of the counts the database gave — and never the read's own refusal.
 *
 * The legs are GET-shaped counts since admin-window/BUG-0210: `{ count:
 * "exact" }` over zero rows, never `head: true`, because a HEAD response
 * carries no body and the 404 a database without `review_items` answers
 * reached the app as `error: null, count: null`.
 */
describe("readReviewQueues counts the population instead of reading it", () => {
  /** The count legs of one recorded run, in the order they were issued. */
  function countLegs(stub: ReturnType<typeof withLegs>) {
    return stub.calls.filter((call) => isCountLeg(call));
  }

  it("asks for a GET-shaped count and no rows, one leg per shape", async () => {
    const rows = population();
    const stub = withLegs(rows, rows);
    await readReviewQueues({ queue: "data_conflict" }, stub.asSupabaseClient());

    const legs = countLegs(stub);
    expect(legs).toHaveLength(SHAPES.length);
    for (const leg of legs) {
      const select = leg.steps.find((step) => step.method === "select");
      expect(select?.args[1]).toEqual({ count: "exact" });
      // No cap can apply to a read that returns no rows — which is the whole
      // reason this leg is a count (admin-window/BUG-0135) — and the bound
      // that makes it return none is `limit(0)`, not a row window.
      expect(leg.steps.map((step) => step.method)).not.toContain("range");
      expect(leg.steps.map((step) => step.method)).not.toContain("order");
      expect(
        leg.steps.filter((step) => step.method === "limit").map((step) => step.args),
      ).toEqual([[0]]);
    }
  });

  it("narrows each leg by the columns the shape is DECLARED by", async () => {
    // The declaration is `SHAPE_COLUMNS` in `src/lib/review/shapes.ts`; spelled
    // here from spec §6 and migration `20260901000002` instead, so a `lib/db`
    // that grew a queue value or a null check of its own would disagree with
    // this rather than with itself. `data_conflict` constrains only the queue —
    // a `data_conflict` row is a fact item whatever `source_id` it carries.
    const expected: Record<string, { eq: unknown[][]; is: unknown[][]; not: unknown[][] }> = {
      data_conflict_fact: { eq: [["queue", "data_conflict"]], is: [], not: [] },
      entity_link_fact: {
        eq: [["queue", "entity_link"]],
        is: [["source_id", null]],
        not: [],
      },
      entity_link_source_pattern: {
        eq: [["queue", "entity_link"]],
        is: [],
        not: [["source_id", "is", null]],
      },
    };

    const rows = population();
    const stub = withLegs(rows, rows);
    await readReviewQueues({ queue: "data_conflict" }, stub.asSupabaseClient());

    const legs = countLegs(stub);
    const by = (leg: (typeof legs)[number], method: string) =>
      leg.steps.filter((step) => step.method === method).map((step) => step.args);
    // In `SHAPES` order — the order the per-leg scripting in this file and in
    // `tests/offline/queues/page.test.ts` depends on.
    SHAPES.forEach((shape, index) => {
      const leg = legs[index];
      expect([shape, by(leg, "eq")]).toEqual([shape, expected[shape].eq]);
      expect([shape, by(leg, "is")]).toEqual([shape, expected[shape].is]);
      expect([shape, by(leg, "not")]).toEqual([shape, expected[shape].not]);
    });
  });

  it("answers a faceted URL whatever the table's size — ROW_CAP cannot reach a count", async () => {
    // The defect, at the read: leg 1 is the URL's own complete read and leg 2
    // WAS the whole table as rows, so past the cap it refused for every faceted
    // URL and took the rendered rows with it. A count of a million is a number
    // the database gave, not a truncation.
    const rows = population();
    const conflicts = rows.filter((row) => row.queue === "data_conflict");
    const stub = stubClient({
      [T.reviewItems]: [
        { data: conflicts, count: conflicts.length },
        { data: null, count: 1_000_000 },
      ],
    });
    const result = await readReviewQueues(
      { queue: "data_conflict" },
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    const counted = populationOf(result);
    expect(ids(result.kind === "ok" ? result.data.items : [])).toEqual(
      ids(queueOrder(conflicts)),
    );
    // Two shapes make the decision queue, so its figure is the SUM of the two
    // counts — no subtraction from a table total anywhere.
    expect(counted.decision).toEqual({ kind: "ok", data: 2_000_000 });
    expect(counted.signal).toEqual({ kind: "ok", data: 1_000_000 });
  });

  it("carries a refused count as THAT kind's refusal, and keeps every row", async () => {
    // The signal queue is one shape, the last leg; the decision queue's two
    // legs answered, so its figure stands. A leg that refused is reported by
    // the caller, never returned as the read's own refusal.
    const rows = population();
    const stub = stubClient({
      [T.reviewItems]: [
        { data: rows, count: rows.length },
        { data: null, count: 3 },
        { data: null, count: 4 },
        { error: permissionDenied(T.reviewItems) },
      ],
    });
    const result = await readReviewQueues({ status: "open" }, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    const counted = populationOf(result);
    expect(counted.decision).toEqual({ kind: "ok", data: 7 });
    expect(counted.signal.kind).toBe("error");
    if (counted.signal.kind !== "error") return;
    expect(counted.signal.reading).toBe(T.reviewItems);
    expect(counted.signal.message).toContain(permissionDenied(T.reviewItems).message);
    // and the rows the URL's own read returned are all still here
    expect(ids(result.kind === "ok" ? result.data.items : [])).toEqual(
      ids(queueOrder(rows.filter((row) => row.status === "open"))),
    );
  });

  it("reports an absent table on a count leg as that kind's not_provisioned", async () => {
    const rows = population();
    const stub = stubClient({
      [T.reviewItems]: [
        { data: rows, count: rows.length },
        { error: tableNotInSchemaCache(T.reviewItems) },
      ],
    });
    const result = await readReviewQueues({ status: "open" }, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    const counted = populationOf(result);
    for (const kind of ["decision", "signal"] as const) {
      expect([kind, counted[kind]]).toEqual([
        kind,
        { kind: "not_provisioned", missing: T.reviewItems },
      ]);
    }
  });

  it("is non-ok exactly when the URL's own read is", async () => {
    // The rule, both ways round. A count leg that refused never makes the read
    // refuse; a FILTERED leg that refused always does.
    const rows = population();
    const filter = { queue: "data_conflict" } as const;

    const populationRefused = await readReviewQueues(
      filter,
      stubClient({
        [T.reviewItems]: [
          { data: rows, count: rows.length },
          { error: permissionDenied(T.reviewItems) },
        ],
      }).asSupabaseClient(),
    );
    expect(populationRefused.kind).toBe("ok");

    const filteredRefused = await readReviewQueues(
      filter,
      stubClient({
        [T.reviewItems]: [
          { error: permissionDenied(T.reviewItems) },
          { data: null, count: 1 },
        ],
      }).asSupabaseClient(),
    );
    expect(filteredRefused.kind).toBe("error");
    expect(filteredRefused).not.toHaveProperty("data");
  });
});

/**
 * **What a `/queues` URL COSTS, counted on the stub's call log**
 * (campaign admin-window/DEBT-0012).
 *
 * The population exists to answer fact 2 of the four-state rule, and
 * `isSurfaceNarrowed` ANDs it with fact 1 (`src/lib/url/narrowing.ts`) — so a
 * block whose fact 1 is already `false` renders identically whatever its
 * population says, and a count issued for it answers a question no rendering
 * asks. The kinds that DO need it are the ones this URL narrows, which is the
 * opposite of the kind the URL names: on `?kind=signal` the signal block
 * renders its own whole set, while the decision block's rows are all gone from
 * the filtered read and its zero is the one that has to be explained
 * (admin-window/BUG-0133).
 *
 * Every number below is a MEASUREMENT of the tree it runs on, not a wish: the
 * per-URL figures were read off this log on 2026-09-09 before they were written
 * down, and the shapes each URL counts are named, so a read that issued the
 * right NUMBER of counts for the wrong shapes fails here too.
 *
 * Which shapes are asked is spelled from the migration's own rule — `queue`,
 * and whether `source_id` is null (`20260901000002`: a subject is either a fact
 * or a source) — never from `SHAPE_COLUMNS`, which is the declaration the app
 * builds these queries FROM.
 */
describe("readReviewQueues counts only the kinds the URL narrows", () => {
  /** Every `review_items` read of one run — the row leg plus every count leg. */
  function readsOfReviewItems(stub: StubClient): number {
    return stub.tablesRead().filter((table) => table === T.reviewItems).length;
  }

  /**
   * Which shape a count leg is narrowed to, read back off the recorded chain
   * and named in this file's own words: the queue it pinned, plus what it said
   * about `source_id`. A `data_conflict` leg constrains only the queue.
   */
  function countedShapes(stub: StubClient): string[] {
    return stub.calls
      .filter((call) => isCountLeg(call))
      .map((leg) => {
        const args = (method: string) =>
          leg.steps.filter((step) => step.method === method).map((step) => step.args);
        const queue = args("eq").find(([column]) => column === "queue")?.[1];
        if (args("is").some(([column, value]) => column === "source_id" && value === null)) {
          return `${String(queue)}/source-null`;
        }
        if (args("not").some(([column]) => column === "source_id")) {
          return `${String(queue)}/source-set`;
        }
        return String(queue);
      });
  }

  /** A source id the fixtures carry — a source is always narrowing (BUG-0141). */
  const CARRIED = ID.sourceBandsintown;

  /** The three shapes as this file names their count legs, in `SHAPES` order. */
  const DATA_CONFLICT_FACT = "data_conflict";
  const ENTITY_LINK_FACT = "entity_link/source-null";
  const SOURCE_PATTERN = "entity_link/source-set";
  const BOTH_KINDS = [DATA_CONFLICT_FACT, ENTITY_LINK_FACT, SOURCE_PATTERN];

  /**
   * One row per URL shape: what it costs against `review_items`, and which
   * count legs make up the difference. `reads` is 1 (the row leg) + the legs.
   */
  const COST: {
    where: string;
    filter: Parameters<typeof readReviewQueues>[0];
    reads: number;
    counts: string[];
  }[] = [
    // The bare URL: its own rows ARE the whole table, so it is its own
    // population and not one count is issued (admin-window/BUG-0133).
    { where: "/queues", filter: {}, reads: 1, counts: [] },
    // A URL naming ONE kind: the OTHER kind's shapes, and no others. The named
    // kind's block is not structurally narrowed by its own value, so its
    // population cannot change a word it renders (BUG-0129, BUG-0131).
    {
      where: "/queues?kind=decision",
      filter: { kind: "decision" },
      reads: 2,
      counts: [SOURCE_PATTERN],
    },
    {
      where: "/queues?kind=signal",
      filter: { kind: "signal" },
      reads: 3,
      counts: [DATA_CONFLICT_FACT, ENTITY_LINK_FACT],
    },
    // A facet that IMPLIES one kind counts as naming it: every signal row is
    // `queue: "entity_link"`, and the signal kind has exactly one shape, so
    // both of these leave the signal block rendering its own whole set.
    {
      where: "/queues?queue=entity_link",
      filter: { queue: "entity_link" },
      reads: 3,
      counts: [DATA_CONFLICT_FACT, ENTITY_LINK_FACT],
    },
    {
      where: "/queues?shape=entity_link_source_pattern",
      filter: { shape: "entity_link_source_pattern" },
      reads: 3,
      counts: [DATA_CONFLICT_FACT, ENTITY_LINK_FACT],
    },
    // A facet implying NO kind: both blocks can be emptied by it, so both
    // populations are load-bearing and all three counts are issued. `status`
    // is never implied by a kind, `source_id` never by anything
    // (admin-window/BUG-0141), and the decision kind spans both queues and
    // both fact shapes.
    { where: "/queues?status=open", filter: { status: "open" }, reads: 4, counts: BOTH_KINDS },
    {
      where: "/queues?queue=data_conflict",
      filter: { queue: "data_conflict" },
      reads: 4,
      counts: BOTH_KINDS,
    },
    {
      where: "/queues?shape=data_conflict_fact",
      filter: { shape: "data_conflict_fact" },
      reads: 4,
      counts: BOTH_KINDS,
    },
    {
      where: `/queues?source_id=${CARRIED}`,
      filter: { source_id: CARRIED },
      reads: 4,
      counts: BOTH_KINDS,
    },
  ];

  it("scripts its legs against every shape there is, so a fourth shape reddens here", () => {
    // Fixture integrity, not a domain claim: the per-leg scripting above hands
    // each count its answer BY POSITION, so this file's two shape lists have to
    // partition the registry in its own order or every count in this describe
    // is answered by the wrong leg. A fourth shape reddens this line first.
    expect([...DECISION_SHAPES, ...SIGNAL_SHAPES]).toEqual([...SHAPES]);
  });

  /**
   * **The facet values each KIND implies** — spec §6, spelled here rather than
   * read out of `narrowingOfKind`, so the exhaustive claim below grades the app
   * instead of asking it what it expects.
   *
   * The decision kind spans both queues and both fact shapes, so its own kind
   * value is all it implies. Every signal row is an `entity_link_source_pattern`
   * in the `entity_link` queue, so a URL naming either selects exactly the
   * signal block's set and removes not one row from it.
   */
  const IMPLIED: Record<string, Record<string, string | undefined>> = {
    decision: { kind: "decision" },
    signal: { kind: "signal", queue: "entity_link", shape: "entity_link_source_pattern" },
  };

  it("counts, over EVERY url the facet vocabulary can spell, only the kinds it narrows", async () => {
    // Added by QA on admin-window/DEBT-0012. The table above names nine URLs;
    // the vocabulary spells 216, and the ticket's saving is a claim about all
    // of them. A facet COMBINATION that skipped a count it needs — or paid for
    // one it does not — is reachable from no row of that table, and this is the
    // one vantage that sees them together.
    const values = {
      kind: [undefined, "decision", "signal"],
      queue: [undefined, "data_conflict", "entity_link"],
      shape: [undefined, ...SHAPES],
      status: [undefined, "open", "settled"],
      source_id: [undefined, CARRIED],
    } as const;

    const seen = new Map<number, number>();
    let urls = 0;
    for (const kind of values.kind)
      for (const queue of values.queue)
        for (const shape of values.shape)
          for (const status of values.status)
            for (const source_id of values.source_id) {
              const filter: Record<string, string> = {};
              if (kind !== undefined) filter.kind = kind;
              if (queue !== undefined) filter.queue = queue;
              if (shape !== undefined) filter.shape = shape;
              if (status !== undefined) filter.status = status;
              if (source_id !== undefined) filter.source_id = source_id;
              urls += 1;

              // This file's own reading of which kinds the URL narrows: some
              // facet it carries holds a value that kind does not imply.
              const narrows = (of: string) =>
                (["kind", "queue", "shape", "status", "source_id"] as const).some(
                  (facet) =>
                    filter[facet] !== undefined && filter[facet] !== IMPLIED[of][facet],
                );
              const asked = ["decision", "signal"].filter(narrows);
              const shapes = [
                ...(asked.includes("decision") ? DECISION_SHAPES : []),
                ...(asked.includes("signal") ? SIGNAL_SHAPES : []),
              ];
              const where = `/queues?${new URLSearchParams(filter).toString() || "(bare)"}`;

              const stub = withRows(population());
              const result = await readReviewQueues(filter as never, stub.asSupabaseClient());

              // One row leg, plus one count leg per shape of a narrowed kind —
              // and the bare URL's own rows ARE its population, so it counts
              // nothing (criterion 2).
              const reads = readsOfReviewItems(stub);
              expect(reads, where).toBe(1 + shapes.length);
              // ...and each leg is the shape it claims to be, so no count can
              // answer for another (the stub dispenses BY POSITION).
              expect(
                countedShapes(stub),
                `${where}: which counts`,
              ).toEqual(
                shapes.map((shape) =>
                  shape === "data_conflict_fact"
                    ? DATA_CONFLICT_FACT
                    : shape === "entity_link_fact"
                      ? ENTITY_LINK_FACT
                      : SOURCE_PATTERN,
                ),
              );
              // The kinds it skipped answer `not_asked` and the kinds it asked
              // answer a number — never the other way round.
              if (result.kind !== "ok") throw new Error(`${where}: ${result.kind}`);
              for (const of of ["decision", "signal"] as const) {
                expect(result.data.population[of].kind, `${where}: ${of}`).toBe(
                  // An unnarrowed URL is its own population, so both kinds are
                  // counted off the rows it already holds.
                  shapes.length === 0 || asked.includes(of) ? "ok" : "not_asked",
                );
              }
              seen.set(reads, (seen.get(reads) ?? 0) + 1);
            }

    // The measured shape of the saving, so a change to it has to be restated
    // here: 8 of the 216 URLs now cost less, and 207 are unchanged at four.
    expect(urls).toBe(216);
    expect([...seen.entries()].sort()).toEqual([[1, 1], [2, 1], [3, 7], [4, 207]]);
  });

  it("issues exactly the reads each URL shape needs, and no others", async () => {
    for (const { where, filter, reads, counts } of COST) {
      const rows = population();
      const stub = withRows(rows);
      await readReviewQueues(filter, stub.asSupabaseClient());
      expect(readsOfReviewItems(stub), where).toBe(reads);
      expect(countedShapes(stub), `${where}: which counts`).toEqual(counts);
    }
  });

  it("answers the kind it did not count as not_asked — never a zero, never a refusal", async () => {
    // The three states pulled apart on ONE run: a table holding no decision
    // row at all, read under `?kind=signal`. The decision population is a real
    // counted ZERO (a claim about the table, which the block needs), and the
    // signal population is `not_asked` (no claim at all). A read that answered
    // the second as `0` would be claiming an empty signal queue over a table
    // full of signals.
    const signals = population().filter((row) => kindOfItem(row) === "signal");
    expect(signals.length).toBeGreaterThan(0);
    const stub = withLegs(signals, signals, DECISION_SHAPES);
    const result = await readReviewQueues({ kind: "signal" }, stub.asSupabaseClient());

    const counted = populationOf(result);
    expect(counted.decision).toEqual({ kind: "ok", data: 0 });
    expect(counted.signal).toEqual({ kind: "not_asked" });
  });

  it("reports nothing for the kind it did not count, even when every count refuses", async () => {
    // A refusal is the caller's to report beside the rows (admin-window/BUG-0135);
    // a question never asked has nothing to report, and the two may not share a
    // rendering. The one scripted refusal answers every count leg.
    const rows = population();
    const stub = stubClient({
      [T.reviewItems]: [
        { data: rows, count: rows.length },
        { error: permissionDenied(T.reviewItems) },
      ],
    });
    const result = await readReviewQueues({ kind: "decision" }, stub.asSupabaseClient());

    const counted = populationOf(result);
    expect(counted.signal.kind).toBe("error");
    expect(counted.decision).toEqual({ kind: "not_asked" });
    // and the rows the URL's own read returned are all still here
    expect(ids(result.kind === "ok" ? result.data.items : [])).toEqual(
      ids(queueOrder(rows.filter((row) => kindOfItem(row) === "decision"))),
    );
  });

  it("keeps the whole-table meaning of every count it does issue", async () => {
    // The saving is in WHICH counts are issued, never in what they count: no
    // condition on a count leg comes from the filter, so each figure is still
    // what the kind holds with NO url facet at all (admin-window/BUG-0141) —
    // which is the only reading under which `rendered !== population` is a
    // question worth asking.
    const rows = population();
    const stub = withLegs(rows, rows);
    await readReviewQueues(
      { kind: "signal", status: "open", source_id: CARRIED },
      stub.asSupabaseClient(),
    );

    // `?status=` and `?source_id=` narrow both blocks, so this URL costs all
    // three counts even though it also names a kind...
    expect(countedShapes(stub)).toEqual(BOTH_KINDS);
    // ...and every condition on every count leg is one the SHAPE defines: the
    // queue, and what `source_id` must be. Never the URL's status, and never
    // its source as an equality.
    for (const leg of stub.calls.filter((call) => isCountLeg(call))) {
      for (const step of leg.steps) {
        if (!["eq", "is", "not"].includes(step.method)) continue;
        expect([step.method, step.args[0]]).not.toEqual(["eq", "source_id"]);
        expect(["queue", "source_id"], JSON.stringify(step.args)).toContain(
          String(step.args[0]),
        );
      }
    }
  });
});

describe("truncation beats every filter (QA attack)", () => {
  it("refuses a derived filter over a truncated set rather than reporting its matches", async () => {
    // `shape` and `kind` have no column, so they are applied in code AFTER the
    // read. Over a truncated row set that would produce a confident short (or
    // empty) match list for a filter the database never saw — indistinguishable
    // from "nothing matches". The refusal has to come first.
    for (const filter of [{ shape: "entity_link_fact" } as const, { kind: "signal" } as const]) {
      const stub = stubClient({
        [T.reviewItems]: { data: reviewItemEdgePopulation(), count: ROW_CAP + 40 },
      });
      const result = await listReviewItems(filter, stub.asSupabaseClient());
      expect([filter, result.kind]).toEqual([filter, "error"]);
      expect(result).not.toHaveProperty("data");
    }
  });

  it("reports no attention numbers over an uncounted read", async () => {
    // An open count and an oldest age are exactness claims. A response with no
    // count cannot support them, so the summary must refuse rather than
    // summarise whatever rows happened to arrive.
    const stub = stubClient({
      [T.reviewItems]: { data: reviewItemEdgePopulation(), count: null },
    });
    const result = await readReviewAttention(stub.asSupabaseClient());
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.reviewItems);
    expect(result).not.toHaveProperty("data");
  });
});

/* ── narrowed by a SOURCE (admin-window/BUG-0141) ─────────────────────────── */

/**
 * `review_items.source_id` as a filter field: pushed to the database like the
 * other two real columns, re-applied by the one predicate, and NEVER applied to
 * the population counts.
 *
 * The whole set below is spelled from the fixture rather than from
 * `matchesFilter`: what is being proved is that the returned set is exactly the
 * rows carrying that source, which asking the app's own predicate would only
 * restate.
 */
describe("listReviewItems narrowed by a source", () => {
  const CARRIED = ID.sourceBandsintown;
  const ABSENT = ID.sourceTicketmaster;

  it("pushes the source to the database, beside the other column filters", async () => {
    const stub = withRows(population());
    await listReviewItems(
      { queue: "entity_link", status: "open", source_id: CARRIED },
      stub.asSupabaseClient(),
    );

    expect(
      stub.calls[0].steps.filter((step) => step.method === "eq").map((step) => step.args),
    ).toEqual([
      ["queue", "entity_link"],
      ["status", "open"],
      ["source_id", CARRIED],
    ]);
  });

  it("returns exactly the rows carrying that source, and nothing else", async () => {
    // The stub answers whatever the script says regardless of the chain, so
    // this is the PREDICATE's answer — which is what makes the set right even
    // where the database narrowed nothing.
    const all = reviewItemEdgePopulation();
    const result = await listReviewItems(
      { source_id: CARRIED },
      withRows(all).asSupabaseClient(),
    );
    if (result.kind !== "ok") throw new Error(result.kind);

    const expected = all.filter((row) => row.source_id === CARRIED);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(all.length);
    expect(ids(result.data).sort()).toEqual(ids(expected).sort());
    // A per-fact item carries no source, so it can match no source narrowing.
    expect(result.data.every((row) => row.source_id === CARRIED)).toBe(true);
  });

  it("returns nothing for a well-formed source the table does not carry", async () => {
    const all = reviewItemEdgePopulation();
    const result = await listReviewItems(
      { source_id: ABSENT },
      withRows(all).asSupabaseClient(),
    );
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(all.some((row) => row.source_id === ABSENT)).toBe(false);
    expect(result.data).toEqual([]);
  });

  it("counts each kind's WHOLE-queue population, never the source's share", async () => {
    // What lets a source with no items render "nothing matched" instead of
    // "this queue is empty" (admin-window/BUG-0133): the population is the
    // unfiltered figure, so `rendered !== population` can be asked at all. A
    // count narrowed by the URL would make every block's zero look unfiltered.
    const table = reviewItemEdgePopulation();
    const carried = table.filter((row) => row.source_id === CARRIED);
    const stub = withLegs(carried, table);
    const result = await readReviewQueues({ source_id: CARRIED }, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(result.kind);

    // The rows are the source's…
    expect(ids(result.data.items).sort()).toEqual(ids(carried).sort());
    // …and the populations are the whole table's, per kind.
    for (const kind of ["decision", "signal"] as const) {
      expect(result.data.population[kind], kind).toEqual({
        kind: "ok",
        data: table.filter((row) => kindOfItem(row) === kind).length,
      });
    }
    // The source facet took the COUNT path at all — which is the other half of
    // BUG-0133: an unnarrowed URL reads its population off its own rows.
    expect(countLegsOf(stub)).toHaveLength(SHAPES.length);
    // …and no count leg carries the source.
    for (const leg of countLegsOf(stub)) {
      expect(
        leg.steps.filter((step) => step.method === "eq").map((step) => step.args[0]),
      ).not.toContain("source_id");
    }
  });
});

/** The count legs of one recorded run — the population's own reads. */
function countLegsOf(stub: ReturnType<typeof withLegs>) {
  return stub.calls.filter((call) => isCountLeg(call));
}
