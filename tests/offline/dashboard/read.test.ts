import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WINDOW,
  readDashboard,
  readRecentCycles,
  readRecentRuns,
} from "@/lib/db/dashboard";
import { ROW_CAP } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  undefinedQualifiedColumn,
  type RecordedCall,
  type Script,
} from "../../fixtures/stub-client";
import { resolutionRunRow, reviewItemDataConflict, runRow } from "../../fixtures/rows";

/**
 * The Dashboard's reads (campaign admin-window/TASK-0009).
 *
 * Two properties are asserted here rather than at the page, because they are
 * properties of the QUERY and are invisible in markup:
 *
 *  - **the window is bounded and ordered.** ARCHITECTURE.md §4.3: a select with
 *    no `.order()` and no `.limit()` returns an arbitrary subset in unspecified
 *    order, so "the newest cycles, newest first" would be neither. The order is
 *    total — the time column then the primary key — so the same window comes
 *    back twice running.
 *  - **nothing throws.** §4.1: every read returns a `DbResult`, so an absent
 *    table renders a not-provisioned card instead of taking the app down.
 */

/** The steps one query built, as `method(args)` strings. */
function stepsOf(call: RecordedCall): string[] {
  return call.steps.map((step) => `${step.method}(${JSON.stringify(step.args)})`);
}

function scriptedClient(script: Script) {
  return stubClient(script);
}

const HEALTHY: Script = {
  [T.reviewItems]: { data: [reviewItemDataConflict()], count: 1 },
  [T.resolutionRuns]: { data: [resolutionRunRow()] },
  [T.runs]: { data: [runRow()] },
};

describe("the cycles window read", () => {
  it("asks for the newest first, by a total order, under an explicit limit", async () => {
    const stub = scriptedClient(HEALTHY);
    const result = await readRecentCycles(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.resolutionRuns]);
    const steps = stepsOf(stub.calls[0]);
    expect(steps).toContain('order(["started_at",{"ascending":false}])');
    // The primary key ends the order, so it is total and the window is stable.
    expect(steps).toContain('order(["run_id",{"ascending":false}])');
    expect(steps).toContain(`limit([${DASHBOARD_WINDOW}])`);
  });

  it("selects the columns the Dashboard renders and no others", async () => {
    const stub = scriptedClient(HEALTHY);
    await readRecentCycles(DASHBOARD_WINDOW, stub.asSupabaseClient());

    const select = stub.calls[0].steps.find((step) => step.method === "select");
    const columns = String(select?.args[0]).split(",").map((name) => name.trim());
    expect(columns).toEqual([
      "run_id",
      "started_at",
      "ended_at",
      "outcome",
      "applied",
      "escalated",
      "errors",
      "error_summary",
    ]);
  });

  it("clamps a junk window instead of running unbounded", async () => {
    for (const asked of [0, -3, Number.NaN, ROW_CAP * 10]) {
      const stub = scriptedClient(HEALTHY);
      await readRecentCycles(asked, stub.asSupabaseClient());
      const limit = stub.calls[0].steps.find((step) => step.method === "limit");
      const size = Number(limit?.args[0]);
      expect(size, String(asked)).toBeGreaterThanOrEqual(1);
      expect(size, String(asked)).toBeLessThanOrEqual(ROW_CAP);
    }
  });

  it("reports an absent table by name, and throws nothing", async () => {
    const stub = scriptedClient({
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
    });
    const result = await readRecentCycles(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(result).toEqual({ kind: "not_provisioned", missing: T.resolutionRuns });
  });

  it("names the read it was making when it failed", async () => {
    const stub = scriptedClient({
      [T.resolutionRuns]: { error: permissionDenied(T.resolutionRuns) },
    });
    const result = await readRecentCycles(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.resolutionRuns);
    expect(result.message).toContain("permission denied");
  });

  it("names the column when the table has lost one", async () => {
    const stub = scriptedClient({
      [T.resolutionRuns]: {
        error: undefinedQualifiedColumn(T.resolutionRuns, "escalated"),
      },
    });
    const result = await readRecentCycles(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(result).toEqual({
      kind: "not_provisioned",
      missing: `${T.resolutionRuns}.escalated`,
    });
  });
});

describe("the runs window read", () => {
  it("asks for the newest first, by a total order, under an explicit limit", async () => {
    const stub = scriptedClient(HEALTHY);
    const result = await readRecentRuns(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.runs]);
    const steps = stepsOf(stub.calls[0]);
    expect(steps).toContain('order(["started_at",{"ascending":false}])');
    expect(steps).toContain('order(["run_id",{"ascending":false}])');
    expect(steps).toContain(`limit([${DASHBOARD_WINDOW}])`);
  });

  it("reads only source, when, outcome and the error line", async () => {
    // The Cycles & runs page's column set is the blocked OPEN-RUNS question;
    // reading a counter here would answer it by the back door.
    const stub = scriptedClient(HEALTHY);
    await readRecentRuns(DASHBOARD_WINDOW, stub.asSupabaseClient());

    const select = stub.calls[0].steps.find((step) => step.method === "select");
    const columns = String(select?.args[0]).split(",").map((name) => name.trim());
    expect(columns).toEqual([
      "run_id",
      "source",
      "started_at",
      "ended_at",
      "outcome",
      "error_summary",
    ]);
  });

  it("reports an absent table by name, and throws nothing", async () => {
    const stub = scriptedClient({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } });
    const result = await readRecentRuns(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(result).toEqual({ kind: "not_provisioned", missing: T.runs });
  });
});

describe("the Dashboard's three reads together", () => {
  it("reads review items, cycles and runs — and nothing else", async () => {
    const stub = scriptedClient(HEALTHY);
    const reads = await readDashboard(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(new Set(stub.tablesRead())).toEqual(
      new Set([T.reviewItems, T.resolutionRuns, T.runs]),
    );
    expect(reads.attention.kind).toBe("ok");
    expect(reads.cycles.kind).toBe("ok");
    expect(reads.runs.kind).toBe("ok");
  });

  it("counts the open items per kind through the complete read", async () => {
    const stub = scriptedClient(HEALTHY);
    const reads = await readDashboard(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(reads.attention.kind).toBe("ok");
    if (reads.attention.kind !== "ok") return;
    expect(reads.attention.data.decision.open).toBe(1);
    expect(reads.attention.data.signal.open).toBe(0);
    expect(reads.attention.data.decision.maxSeverity).toBe("high");
  });

  it("refuses the counts when the count read was truncated", async () => {
    // `readComplete`'s guarantee: an `ok` array is the whole matching set. A
    // count larger than the rows returned is a refusal carrying the real
    // number, never a figure computed over a partial set.
    const stub = scriptedClient({
      ...HEALTHY,
      [T.reviewItems]: { data: [reviewItemDataConflict()], count: 4_000 },
    });
    const reads = await readDashboard(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(reads.attention.kind).toBe("error");
    if (reads.attention.kind !== "error") return;
    expect(reads.attention.reading).toBe(T.reviewItems);
    expect(reads.attention.message).toContain("4000");
    // The other two surfaces are untouched by it.
    expect(reads.cycles.kind).toBe("ok");
    expect(reads.runs.kind).toBe("ok");
  });

  it("keeps one failing read from taking the other two down", async () => {
    const stub = scriptedClient({
      ...HEALTHY,
      [T.runs]: { error: tableNotInSchemaCache(T.runs) },
    });
    const reads = await readDashboard(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(reads.attention.kind).toBe("ok");
    expect(reads.cycles.kind).toBe("ok");
    expect(reads.runs).toEqual({ kind: "not_provisioned", missing: T.runs });
  });

  it("reads a sane window by default", async () => {
    const stub = scriptedClient(HEALTHY);
    await readDashboard(undefined, stub.asSupabaseClient());

    for (const call of stub.calls.filter((one) => one.table !== T.reviewItems)) {
      expect(stepsOf(call)).toContain(`limit([${DASHBOARD_WINDOW}])`);
    }
    expect(DASHBOARD_WINDOW).toBeGreaterThan(0);
    expect(DASHBOARD_WINDOW).toBeLessThanOrEqual(ROW_CAP);
  });
});
