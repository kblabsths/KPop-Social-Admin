import { describe, expect, it } from "vitest";
import { listReviewItems, readReviewAttention } from "@/lib/db/review-items";
import { SHAPES, kindOfItem, shapeOf, type ReviewItemRow } from "@/lib/review/shapes";
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
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  undefinedColumnOfRelation,
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

/** A stub whose `review_items` read answers with these rows. */
function withRows(rows: ReviewItemRow[]) {
  return stubClient({ [T.reviewItems]: { data: rows } });
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
    const stub = stubClient({ [T.reviewItems]: { data: null } });
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
    expect(result.message).toBe(permissionDenied(T.reviewItems).message);
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
    const stub = stubClient({ [T.reviewItems]: { data: [] } });
    const result = await readReviewAttention(stub.asSupabaseClient());
    expect(result).toEqual({
      kind: "ok",
      data: {
        decision: { kind: "decision", open: 0, maxSeverity: null, oldestOpenedAt: null },
        signal: { kind: "signal", open: 0, maxSeverity: null, oldestOpenedAt: null },
      },
    });
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
