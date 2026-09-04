import { describe, expect, it } from "vitest";
import {
  aggregateCycleHealth,
  fetchCycleHealth,
  readCycleHealth,
  type ResolutionRunRow,
} from "@/lib/gauges/cycle-health";
import { T } from "@/lib/db/tables";
import { ID, resolutionRunRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  undefinedColumnOfRelation,
} from "../../fixtures/stub-client";

/**
 * Gauge 1 — cycle health (campaign admin-window/TASK-0007), offline against
 * the stub client. No network, no database.
 *
 * The knob is the resolver's 15-minute cadence, so the assertions that matter
 * are: a duration that cannot be measured is not a zero, and a cycle that ran
 * long is counted against the cadence rather than averaged into it.
 */

const NOW = "2026-09-01T12:00:00.000Z";

/** Three cycles: one fast, one over cadence, one still running. */
function population(): ResolutionRunRow[] {
  return [
    resolutionRunRow(), // 04:00:00 → 04:03:20 = 200s, succeeded, clean
    resolutionRunRow({
      run_id: "01920000-0000-7000-8000-000000000602",
      started_at: "2026-09-01T05:00:00Z",
      ended_at: "2026-09-01T05:20:00Z", // 1200s — over the 900s cadence
      outcome: "failed",
      facts_examined: 100,
      applied: 1,
      held: 2,
      escalated: 3,
      entities_created: 4,
      claims_linked: 5,
      claims_rerejected: 6,
      errors: 2,
      error_summary: "ticketmaster adapter timed out",
    }),
    resolutionRunRow({
      run_id: "01920000-0000-7000-8000-000000000603",
      started_at: "2026-09-01T06:00:00Z",
      ended_at: null,
      outcome: null,
      facts_examined: 0,
      applied: 0,
      held: 0,
      escalated: 0,
      entities_created: 0,
      claims_linked: 0,
      claims_rerejected: 0,
      errors: 0,
    }),
  ];
}

function withRows(rows: ResolutionRunRow[]) {
  return stubClient({ [T.resolutionRuns]: { data: rows } });
}

describe("fetchCycleHealth", () => {
  it("reads resolution_runs with an explicit window and an explicit cap", async () => {
    const stub = withRows(population());
    const result = await fetchCycleHealth({ now: NOW, days: 7, limit: 800 }, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.resolutionRuns]);
    const steps = stub.calls[0].steps;
    expect(steps.find((s) => s.method === "gte")?.args).toEqual([
      "started_at",
      "2026-08-25T12:00:00.000Z",
    ]);
    expect(steps.find((s) => s.method === "limit")?.args).toEqual([800]);
    // Newest first, so a truncated read keeps the recent cycles.
    expect(steps.find((s) => s.method === "order")?.args).toEqual([
      "started_at",
      { ascending: false },
    ]);
  });

  it("bounds the query even when the caller passes nothing", async () => {
    const stub = withRows([]);
    await fetchCycleHealth({}, stub.asSupabaseClient());
    const steps = stub.calls[0].steps;
    expect(steps.some((s) => s.method === "gte")).toBe(true);
    expect(steps.find((s) => s.method === "limit")?.args[0]).toBeGreaterThan(0);
  });

  it("reports the window it read, and whether the cap cut it short", async () => {
    const stub = withRows(population());
    const short = await fetchCycleHealth({ now: NOW, limit: 3 }, stub.asSupabaseClient());
    expect(short.kind === "ok" && short.data.window.truncated).toBe(true);

    const roomy = await fetchCycleHealth({ now: NOW, limit: 50 }, stub.asSupabaseClient());
    expect(roomy.kind === "ok" && roomy.data.window.truncated).toBe(false);
  });

  it("reports the table by name when it is absent, and never throws", async () => {
    const stub = stubClient({
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
    });
    await expect(fetchCycleHealth({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.resolutionRuns,
    });
  });

  it("names the column when the table is there but a column is not", async () => {
    const stub = stubClient({
      [T.resolutionRuns]: {
        error: undefinedColumnOfRelation(T.resolutionRuns, "claims_rerejected"),
      },
    });
    await expect(fetchCycleHealth({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: `${T.resolutionRuns}.claims_rerejected`,
    });
  });

  it("carries an arbitrary failure through as the database's own words", async () => {
    const stub = stubClient({
      [T.resolutionRuns]: { error: permissionDenied(T.resolutionRuns) },
    });
    await expect(fetchCycleHealth({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "error",
      // The read that refused is named as well as the refusal, and the
      // client's own account reaches the caller intact (BUG-0016).
      reading: T.resolutionRuns,
      message: expect.stringContaining(`permission denied for table ${T.resolutionRuns}`),
    });
  });
});

describe("aggregateCycleHealth", () => {
  const window = { since: "2026-08-25T12:00:00.000Z", until: NOW, limit: 800, truncated: false };
  const health = aggregateCycleHealth({ rows: population(), window });

  it("counts every outcome, with a cycle that has not finished under its own name", () => {
    expect(health.cycles).toBe(3);
    expect(health.outcomes).toEqual({
      succeeded: 1,
      failed: 1,
      skipped: 0,
      running: 0,
      died: 1,
      unrecorded: 0,
    });
  });

  /*
   * The three states a row with no `outcome` can be in are counted apart, each
   * under the word the `/cycles` table already puts on that row
   * (admin-window/BUG-0055). One bucket for all three named the same four
   * cycles `unfinished` that the rows called `died`.
   *
   * The clock is `window.until`, so these are decidable rather than
   * wall-clock: 11:59 is one minute before it, 06:00 is six hours before it.
   */
  it("tells a cycle still running apart from one that died, by the same cadence the rows use", () => {
    const running = resolutionRunRow({
      run_id: "01920000-0000-7000-8000-000000000701",
      started_at: "2026-09-01T11:59:00Z", // 60s before `until` — inside the 900s cadence
      ended_at: null,
      outcome: null,
    });
    const died = resolutionRunRow({
      run_id: "01920000-0000-7000-8000-000000000702",
      started_at: "2026-09-01T06:00:00Z", // six hours before it — nothing repairs this row
      ended_at: null,
      outcome: null,
    });
    const split = aggregateCycleHealth({ rows: [running, died], window });
    expect(split.outcomes.running).toBe(1);
    expect(split.outcomes.died).toBe(1);
    // The word the panel used to lump both under is not a bucket any more.
    expect(split.outcomes.unfinished).toBeUndefined();
  });

  it("counts a cycle that ended recording no outcome as neither running nor died", () => {
    const unrecorded = resolutionRunRow({
      run_id: "01920000-0000-7000-8000-000000000703",
      started_at: "2026-09-01T04:00:00Z",
      ended_at: "2026-09-01T04:03:20Z",
      outcome: null,
    });
    const health = aggregateCycleHealth({ rows: [unrecorded], window });
    expect(health.outcomes.unrecorded).toBe(1);
    expect(health.outcomes.running).toBe(0);
    expect(health.outcomes.died).toBe(0);
  });

  it("counts every row exactly once, whatever state it is in", () => {
    const total = Object.values(health.outcomes).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(health.cycles);
  });

  it("measures duration and says how many it could NOT measure", () => {
    expect(health.duration.count).toBe(2);
    expect(health.duration.unmeasurable).toBe(1);
    expect(health.duration.min).toBe(200);
    expect(health.duration.max).toBe(1200);
  });

  it("judges duration against resolver.md §12's cadence", () => {
    expect(health.cadenceSeconds).toBe(900);
    expect(health.overCadence).toBe(1);
  });

  it("puts facts examined beside what those examinations wrote", () => {
    expect(health.factsExamined).toBe(412 + 100 + 0);
    expect(health.writes).toEqual({
      applied: 38,
      entitiesCreated: 10,
      claimsLinked: 24,
      claimsRerejected: 17,
      escalated: 6,
      total: 95,
    });
    // A held fact writes nothing (migration 20260901000004's header), so it is
    // reported beside the writes and never summed into them.
    expect(health.held).toBe(26);
    expect(health.writes.total).toBe(
      health.writes.applied +
        health.writes.entitiesCreated +
        health.writes.claimsLinked +
        health.writes.claimsRerejected +
        health.writes.escalated,
    );
  });

  it("surfaces the errors and the newest cycle carrying one", () => {
    expect(health.errors).toBe(2);
    expect(health.cyclesWithErrors).toBe(1);
    expect(health.latestError).toEqual({
      runId: "01920000-0000-7000-8000-000000000602",
      startedAt: "2026-09-01T05:00:00Z",
      errors: 2,
      errorSummary: "ticketmaster adapter timed out",
    });
  });

  it("picks the NEWEST error, not the first row it saw", () => {
    const older = resolutionRunRow({
      run_id: ID.resolutionRun,
      started_at: "2026-08-30T04:00:00Z",
      errors: 9,
      error_summary: "older",
    });
    const newer = resolutionRunRow({
      run_id: "01920000-0000-7000-8000-000000000699",
      started_at: "2026-08-31T04:00:00Z",
      errors: 1,
      error_summary: "newer",
    });
    // Rows arrive newest-first from the query; the aggregate must not depend
    // on that ordering to answer "the latest error".
    const health = aggregateCycleHealth({ rows: [older, newer], window });
    expect(health.latestError?.errorSummary).toBe("newer");
  });

  it("counts a cycle carrying an error summary but a zero error count", () => {
    const health = aggregateCycleHealth({
      rows: [resolutionRunRow({ errors: 0, error_summary: "partial: bandsintown skipped" })],
      window,
    });
    expect(health.errors).toBe(0);
    expect(health.cyclesWithErrors).toBe(1);
    expect(health.latestError?.errorSummary).toBe("partial: bandsintown skipped");
  });

  it("reports an empty window as zeros for counts and NULLS for figures", () => {
    const empty = aggregateCycleHealth({ rows: [], window });
    expect(empty.cycles).toBe(0);
    expect(empty.outcomes).toEqual({
      succeeded: 0,
      failed: 0,
      skipped: 0,
      running: 0,
      died: 0,
      unrecorded: 0,
    });
    expect(empty.factsExamined).toBe(0);
    expect(empty.writes.total).toBe(0);
    expect(empty.overCadence).toBe(0);
    expect(empty.latestError).toBeNull();
    // A percentile over nothing is not a zero-second cycle.
    expect(empty.duration.p50).toBeNull();
    expect(empty.duration.max).toBeNull();
  });

  it("counts an outcome the check constraint may gain later under its own name", () => {
    // The fixture pins `outcome` to the three the check constraint allows
    // today; this asserts what happens when a fourth arrives.
    const later: ResolutionRunRow = { ...resolutionRunRow(), outcome: "abandoned" };
    const health = aggregateCycleHealth({ rows: [later], window });
    expect(health.outcomes.abandoned).toBe(1);
    expect(health.outcomes.succeeded).toBe(0);
  });
});

describe("readCycleHealth", () => {
  it("fetches and aggregates in one call", async () => {
    const stub = withRows(population());
    const result = await readCycleHealth({ now: NOW }, stub.asSupabaseClient());
    expect(result.kind === "ok" && result.data.cycles).toBe(3);
  });

  it("passes a not-provisioned database straight through", async () => {
    const stub = stubClient({
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
    });
    await expect(readCycleHealth({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.resolutionRuns,
    });
  });
});
