import { describe, expect, it } from "vitest";
import { cycleState } from "@/lib/cycles/state";
import {
  CYCLE_COUNTERS,
  CYCLE_WINDOW,
  newestFirst,
  readCycles,
  type ResolutionRunRow,
} from "@/lib/db/cycles";
import { T } from "@/lib/db/tables";
import { ROW_CAP } from "@/lib/db/result";
import { RESOLVER_CADENCE_SECONDS } from "@/lib/gauges/gauge";
import {
  CYCLES,
  DIED,
  FAILED,
  NEWEST_FIRST,
  RUNNING,
  SKIPPED,
  SUCCEEDED,
  UNRECORDED,
  minutesAgo,
} from "./population";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type RecordedCall,
} from "../../fixtures/stub-client";

/**
 * `src/lib/db/cycles.ts` — the `resolution_runs` window read — and the state
 * function the leaf `src/lib/cycles/state.ts` exports, which decides which of
 * the four states a cycle row is in (campaign admin-window/TASK-0014).
 *
 * The read is exercised through the scripted stub client, so the assertions
 * are about the QUERY this module builds and what it does with the answer —
 * never about a network. The state derivation is pure and is asserted
 * directly, against the rule migration `20260901000001` states: a null
 * `ended_at` older than one cadence is a cycle that died.
 */

/** The clock every state assertion is made against. */
const NOW = new Date().toISOString();

/** The options `cycleState` takes, with the contract's own cadence. */
const CLOCK = { now: NOW, cadenceSeconds: RESOLVER_CADENCE_SECONDS };

/** One method's arguments out of a recorded query chain. */
function steps(call: RecordedCall, method: string): unknown[][] {
  return call.steps.filter((step) => step.method === method).map((step) => step.args);
}

describe("the counter vocabulary", () => {
  it("names the eight counts in the contract's own order", () => {
    // contracts/resolver.md §6, column order: the four fact counters, then the
    // three claim/entity counters, then errors. A page renders these as its
    // columns and the live suite reads them back, so the ORDER is part of the
    // contract, not an implementation detail.
    expect([...CYCLE_COUNTERS]).toEqual([
      "facts_examined",
      "applied",
      "held",
      "escalated",
      "entities_created",
      "claims_linked",
      "claims_rerejected",
      "errors",
    ]);
  });
});

describe("the cycles window read", () => {
  it("asks for the whole row, newest first, under an explicit cap", async () => {
    const stub = stubClient({ [T.resolutionRuns]: { data: CYCLES } });
    const result = await readCycles(undefined, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.resolutionRuns]);

    const call = stub.calls[0];
    const selected = String(steps(call, "select")[0][0]);
    // Every column the contract names, including all eight counters and the
    // failure line — the page cannot render a column the read never asked for.
    for (const column of [
      "run_id",
      "started_at",
      "ended_at",
      "outcome",
      ...CYCLE_COUNTERS,
      "error_summary",
    ]) {
      expect(selected, column).toContain(column);
    }

    // A TOTAL order: the sort column, then the primary key, so two cycles that
    // started on the same instant cannot swap places between reloads.
    expect(steps(call, "order")).toEqual([
      ["started_at", { ascending: false }],
      ["run_id", { ascending: false }],
    ]);
    expect(steps(call, "limit")).toEqual([[CYCLE_WINDOW]]);
  });

  it("returns the rows newest first, whatever order they arrived in", async () => {
    const stub = stubClient({ [T.resolutionRuns]: { data: CYCLES } });
    const result = await readCycles(undefined, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    expect(result.data.rows.map((row) => row.run_id)).toEqual(
      NEWEST_FIRST.map((row) => row.run_id),
    );
  });

  it("reports a window that filled its cap as truncated, and one that did not as not", async () => {
    const full = stubClient({ [T.resolutionRuns]: { data: CYCLES } });
    const filled = await readCycles(CYCLES.length, full.asSupabaseClient());
    if (filled.kind !== "ok") throw new Error(`expected ok, got ${filled.kind}`);
    expect(filled.data.truncated).toBe(true);
    expect(filled.data.limit).toBe(CYCLES.length);

    const roomy = stubClient({ [T.resolutionRuns]: { data: CYCLES } });
    const spare = await readCycles(CYCLES.length + 1, roomy.asSupabaseClient());
    if (spare.kind !== "ok") throw new Error(`expected ok, got ${spare.kind}`);
    expect(spare.data.truncated).toBe(false);
  });

  it("never asks for more rows than the platform will return", async () => {
    const stub = stubClient({ [T.resolutionRuns]: { data: [] } });
    await readCycles(ROW_CAP * 5, stub.asSupabaseClient());
    expect(steps(stub.calls[0], "limit")).toEqual([[ROW_CAP]]);

    // A cap nobody can compute falls back to the page's window rather than
    // becoming an unbounded query.
    const junk = stubClient({ [T.resolutionRuns]: { data: [] } });
    await readCycles(Number.NaN, junk.asSupabaseClient());
    expect(steps(junk.calls[0], "limit")).toEqual([[CYCLE_WINDOW]]);
  });

  it("classifies an absent table as not provisioned, naming it", async () => {
    const stub = stubClient({
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
    });
    const result = await readCycles(undefined, stub.asSupabaseClient());
    expect(result).toEqual({ kind: "not_provisioned", missing: T.resolutionRuns });
  });

  it("carries a refused read's own account, naming what it was reading", async () => {
    const stub = stubClient({ [T.resolutionRuns]: { error: permissionDenied(T.resolutionRuns) } });
    const result = await readCycles(undefined, stub.asSupabaseClient());
    if (result.kind !== "error") throw new Error(`expected error, got ${result.kind}`);
    expect(result.reading).toBe(T.resolutionRuns);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("answers an empty table with no rows, and never a state of its own", async () => {
    const stub = stubClient({ [T.resolutionRuns]: { data: [] } });
    const result = await readCycles(undefined, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.data.rows).toEqual([]);
    expect(result.data.truncated).toBe(false);
  });
});

describe("the display order", () => {
  it("does not mutate what it was given", () => {
    const given = [...CYCLES];
    newestFirst(given);
    expect(given).toEqual(CYCLES);
  });

  it("breaks a tie on the primary key, descending", () => {
    const instant = minutesAgo(4);
    const tied: ResolutionRunRow[] = [
      { ...SUCCEEDED, run_id: "aaa", started_at: instant },
      { ...SUCCEEDED, run_id: "ccc", started_at: instant },
      { ...SUCCEEDED, run_id: "bbb", started_at: instant },
    ];
    expect(newestFirst(tied).map((row) => row.run_id)).toEqual(["ccc", "bbb", "aaa"]);
  });

  it("sorts a timestamp it cannot read last, and keeps the row", () => {
    const unreadable: ResolutionRunRow = { ...SUCCEEDED, run_id: "junk", started_at: "" };
    const sorted = newestFirst([unreadable, ...CYCLES]);
    expect(sorted).toHaveLength(CYCLES.length + 1);
    expect(sorted[sorted.length - 1].run_id).toBe("junk");
  });
});

describe("the state one cycle row is in", () => {
  it("carries the producer's own outcome, verbatim", () => {
    expect(cycleState(SUCCEEDED, CLOCK)).toEqual({
      kind: "outcome",
      outcome: "succeeded",
    });
    expect(cycleState(FAILED, CLOCK)).toEqual({ kind: "outcome", outcome: "failed" });
    // `skipped` is the advisory lock being held, and is legible as itself.
    expect(cycleState(SKIPPED, CLOCK)).toEqual({ kind: "outcome", outcome: "skipped" });
  });

  it("does not narrow the outcome to the three the constraint allows today", () => {
    // A word the check constraint gains later renders under its own name
    // rather than being dropped or coerced into one of today's three.
    const future = { ...SUCCEEDED, outcome: "abandoned" };
    expect(cycleState(future, CLOCK)).toEqual({ kind: "outcome", outcome: "abandoned" });
  });

  it("reads a fresh null ended_at as still running", () => {
    expect(cycleState(RUNNING, CLOCK)).toEqual({ kind: "running" });
  });

  it("reads a null ended_at older than one cadence as a cycle that died", () => {
    const state = cycleState(DIED, CLOCK);
    if (state.kind !== "died") throw new Error(`expected died, got ${state.kind}`);
    expect(state.ageSeconds).toBeGreaterThan(RESOLVER_CADENCE_SECONDS);
  });

  it("turns over from running to died at one cadence, and not before", () => {
    const inside = {
      ...RUNNING,
      started_at: new Date(Date.parse(NOW) - (RESOLVER_CADENCE_SECONDS - 30) * 1000).toISOString(),
    };
    const outside = {
      ...RUNNING,
      started_at: new Date(Date.parse(NOW) - (RESOLVER_CADENCE_SECONDS + 30) * 1000).toISOString(),
    };
    expect(cycleState(inside, CLOCK).kind).toBe("running");
    expect(cycleState(outside, CLOCK).kind).toBe("died");
  });

  it("says a cycle that ended with no outcome recorded none, and invents none", () => {
    expect(cycleState(UNRECORDED, CLOCK)).toEqual({ kind: "unrecorded" });
  });

  it("makes no death claim about an age it cannot measure", () => {
    // `started_at` is not-null in the table, so this is the unparseable case
    // alone: the row is what the schema says it is — inserted at start, no end
    // recorded — and no crash is asserted from a timestamp nobody can read.
    expect(cycleState({ ...RUNNING, started_at: "" }, CLOCK)).toEqual({ kind: "running" });
  });
});
