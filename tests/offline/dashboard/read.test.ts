import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WINDOW,
  readDashboard,
  readLastApplied,
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

/**
 * The last-applied read — campaign admin-window/TASK-0039.
 *
 * Its properties are properties of the QUERY and invisible in markup: that the
 * database picks the maximum (filter, total order, one row), that nothing
 * narrows it to a time window, and that it distinguishes "no cycle ever
 * applied anything" from "the table is not there".
 */
describe("the last-applied read", () => {
  it("asks the database for the newest cycle that applied something, one row", async () => {
    const stub = scriptedClient(HEALTHY);
    const result = await readLastApplied(stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.resolutionRuns]);
    const steps = stepsOf(stub.calls[0]);
    // The filter is the whole point: a cycle that applied nothing is not an
    // answer to "when did the resolver last apply something".
    expect(steps).toContain('gt(["applied",0])');
    expect(steps).toContain('order(["started_at",{"ascending":false}])');
    // A total order, so two cycles that applied on one instant cannot swap the
    // answer between reloads.
    expect(steps).toContain('order(["run_id",{"ascending":false}])');
    expect(steps).toContain("limit([1])");
    expect(steps).toContain("maybeSingle([])");
  });

  it("bounds the answer by nothing but that filter — no lookback window", async () => {
    // The anti-dial property, asserted where it can be seen (Ben's ruling on
    // this ticket: a timestamp, not a gauge, and a dial-able value may not
    // live in a source file). A `gte("started_at", …)` here would be exactly
    // that dial, and would also make an honest "nothing applied" answer into
    // "nothing applied lately".
    const stub = scriptedClient(HEALTHY);
    await readLastApplied(stub.asSupabaseClient());

    const methods = stub.calls[0].steps.map((step) => step.method);
    // Non-vacuous: this reader DOES see the one filter the read carries, so an
    // empty list below means "no other filter", not "no filters were read".
    expect(methods).toContain("gt");
    const narrowing = stub.calls[0].steps
      .filter((step) => ["gte", "lte", "lt", "eq", "in", "filter"].includes(step.method))
      .map((step) => `${step.method}(${JSON.stringify(step.args)})`);
    expect(narrowing).toEqual([]);
  });

  it("selects the instant it renders and the fact it claims, and no more", async () => {
    const stub = scriptedClient(HEALTHY);
    await readLastApplied(stub.asSupabaseClient());

    const select = stub.calls[0].steps.find((step) => step.method === "select");
    const columns = String(select?.args[0]).split(",").map((name) => name.trim());
    expect(columns).toEqual(["run_id", "started_at", "applied"]);
  });

  it("hands back the row the database chose, untouched", async () => {
    const row = resolutionRunRow({
      run_id: "01920000-0000-7000-8000-0000000006ff",
      started_at: "2026-08-24T04:15:00Z",
      applied: 12,
    });
    const stub = scriptedClient({ [T.resolutionRuns]: { data: row } });
    const result = await readLastApplied(stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data?.started_at).toBe("2026-08-24T04:15:00Z");
    expect(result.data?.applied).toBe(12);
  });

  it("answers ok with null when no cycle on record has applied anything", async () => {
    // `.maybeSingle()` over a filtered set that matched nothing: the table
    // answered, and what it said is "none". That is a different state from the
    // table being absent, and the page states it rather than dropping the line.
    const stub = scriptedClient({ [T.resolutionRuns]: { data: null } });
    const result = await readLastApplied(stub.asSupabaseClient());

    expect(result).toEqual({ kind: "ok", data: null });
  });

  it("reports an absent table by name, and throws nothing", async () => {
    const stub = scriptedClient({
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
    });
    const result = await readLastApplied(stub.asSupabaseClient());

    expect(result).toEqual({ kind: "not_provisioned", missing: T.resolutionRuns });
  });

  it("names the read it was making when it failed", async () => {
    const stub = scriptedClient({
      [T.resolutionRuns]: { error: permissionDenied(T.resolutionRuns) },
    });
    const result = await readLastApplied(stub.asSupabaseClient());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.resolutionRuns);
  });

  it("names the column when the table has lost the one it filters on", async () => {
    const stub = scriptedClient({
      [T.resolutionRuns]: { error: undefinedQualifiedColumn(T.resolutionRuns, "applied") },
    });
    const result = await readLastApplied(stub.asSupabaseClient());

    expect(result).toEqual({
      kind: "not_provisioned",
      missing: `${T.resolutionRuns}.applied`,
    });
  });
});

describe("the Dashboard's four reads together", () => {
  it("reads review items, cycles and runs — and nothing else", async () => {
    const stub = scriptedClient(HEALTHY);
    const reads = await readDashboard(DASHBOARD_WINDOW, stub.asSupabaseClient());

    expect(new Set(stub.tablesRead())).toEqual(
      new Set([T.reviewItems, T.resolutionRuns, T.runs]),
    );
    // Two of the four read `resolution_runs`: the cycles window, and the
    // last-applied row over every cycle on record (admin-window/TASK-0039).
    expect(stub.tablesRead().filter((name) => name === T.resolutionRuns)).toHaveLength(2);
    expect(reads.attention.kind).toBe("ok");
    expect(reads.cycles.kind).toBe("ok");
    expect(reads.runs.kind).toBe("ok");
    expect(reads.lastApplied.kind).toBe("ok");
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
    // Every row-set read this page makes carries an explicit bound — none of
    // them may run unbounded (ARCHITECTURE §4.3) — and each carries the bound
    // its own question takes: the two LISTS take the Dashboard's window, and
    // the last-applied read takes ONE row, because a maximum is one row
    // (admin-window/TASK-0039). Asserting one number for all of them would
    // have made the third read impossible to write correctly.
    const stub = scriptedClient(HEALTHY);
    await readDashboard(undefined, stub.asSupabaseClient());

    const bounded = stub.calls.filter((one) => one.table !== T.reviewItems);
    expect(bounded.length).toBe(3);
    const limits = bounded.map((call) => {
      const limit = call.steps.find((step) => step.method === "limit");
      expect(limit, `${call.table} read with no limit at all`).toBeDefined();
      const size = Number(limit?.args[0]);
      expect(size).toBeGreaterThanOrEqual(1);
      expect(size).toBeLessThanOrEqual(ROW_CAP);
      // The maximum is the read that filters on `applied`; the lists do not.
      const filtered = stepsOf(call).some((step) => step.startsWith("gt("));
      return { table: call.table, size, filtered };
    });

    expect(limits.filter((one) => !one.filtered).map((one) => one.size)).toEqual([
      DASHBOARD_WINDOW,
      DASHBOARD_WINDOW,
    ]);
    expect(limits.filter((one) => one.filtered)).toEqual([
      { table: T.resolutionRuns, size: 1, filtered: true },
    ]);
    expect(DASHBOARD_WINDOW).toBeGreaterThan(0);
    expect(DASHBOARD_WINDOW).toBeLessThanOrEqual(ROW_CAP);
  });
});
