import { describe, expect, it } from "vitest";
import { ROW_CAP } from "@/lib/db/result";
import {
  RUN_COLUMNS,
  RUN_COUNTS,
  RUN_WINDOW,
  narrowedTo,
  readRuns,
} from "@/lib/db/runs";
import { T } from "@/lib/db/tables";
import {
  NEWEST_FIRST,
  NO_SUCH_SOURCE,
  RUNS,
  SOURCE,
  SUCCEEDED,
  runsFrom,
} from "./population";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type RecordedCall,
} from "../../fixtures/stub-client";

/**
 * `src/lib/db/runs.ts` — the adapter framework's `runs` window read (campaign
 * admin-window/TASK-0016).
 *
 * Exercised through the scripted stub client, so every assertion is about the
 * QUERY this module builds and what it does with the answer — never about a
 * network. The two properties that matter most here are structural: the read
 * is a WINDOW read (ARCHITECTURE.md §4.3 — ordered, limited, no
 * `{ count: "exact" }`, no `.range()`), and the `?source=` facet is matched by
 * NAME against `runs.source`, because that column is text with no foreign key
 * (§6 trap 6).
 */

/** One method's arguments out of a recorded query chain. */
function steps(call: RecordedCall, method: string): unknown[][] {
  return call.steps.filter((step) => step.method === method).map((step) => step.args);
}

/** Every method name the chain called, in order. */
function methods(call: RecordedCall): string[] {
  return call.steps.map((step) => step.method);
}

describe("the ruled column set", () => {
  it("is exactly the nine Ben ruled on 2026-09-02, in that order", () => {
    // The set and its order are the contract (DECISIONS.md, 2026-09-02; the
    // ticket enumerates the nine). A tenth column re-opens a settled decision
    // rather than extending a table, so this assertion is the door.
    expect([...RUN_COLUMNS]).toEqual([
      "source",
      "started_at",
      "ended_at",
      "outcome",
      "error_summary",
      "records_parsed",
      "claims_emitted",
      "records_unlinked",
      "failure_class",
    ]);
    expect(RUN_COLUMNS).toHaveLength(9);
  });

  it("names the three counts, and nothing that is not one", () => {
    expect([...RUN_COUNTS]).toEqual([
      "records_parsed",
      "claims_emitted",
      "records_unlinked",
    ]);
    for (const counter of RUN_COUNTS) {
      expect(RUN_COLUMNS, counter).toContain(counter);
    }
  });

  it("leaves the other thirteen columns of the table out of M1", () => {
    // The out-of-scope thirteen, named on the ruling. Reading one here is what
    // would answer a settled question by the back door.
    for (const column of [
      "checkpoint_before",
      "checkpoint_after",
      "payloads_fetched",
      "payloads_archived",
      "records_rejected",
      "claims_dropped_empty",
      "claims_collapsed",
      "claims_ai",
      "records_linked",
      "records_escalated",
      "batches_written",
      "observations_returned",
    ]) {
      expect(RUN_COLUMNS as readonly string[], column).not.toContain(column);
    }
  });
});

describe("the runs window read", () => {
  it("asks for the nine ruled columns and the key, newest first, under an explicit cap", async () => {
    const stub = stubClient({ [T.runs]: { data: RUNS } });
    const result = await readRuns({}, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.runs]);

    const call = stub.calls[0];
    const selected = String(steps(call, "select")[0][0]);
    for (const column of ["run_id", ...RUN_COLUMNS]) {
      expect(selected, column).toContain(column);
    }

    // A TOTAL order: the sort column, then the primary key, so two runs that
    // started on the same instant cannot swap places between reloads.
    expect(steps(call, "order")).toEqual([
      ["started_at", { ascending: false }],
      ["run_id", { ascending: false }],
    ]);
    expect(steps(call, "limit")).toEqual([[RUN_WINDOW]]);
  });

  it("is a window read, not a complete one", async () => {
    // ARCHITECTURE.md §4.3: a complete read is `{ count: "exact" }` + a total
    // order + `.range(0, cap - 1)`, and its `ok` array is the whole matching
    // set. This read makes no such claim — every number the page renders off
    // it is a column of the row it sits in — so it must not ask for a count it
    // would then have to honour.
    const stub = stubClient({ [T.runs]: { data: RUNS } });
    await readRuns({}, stub.asSupabaseClient());

    const call = stub.calls[0];
    expect(methods(call)).not.toContain("range");
    expect(steps(call, "select")[0][1]).toBeUndefined();
  });

  it("returns the rows newest first, whatever order they arrived in", async () => {
    const stub = stubClient({ [T.runs]: { data: RUNS } });
    const result = await readRuns({}, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    expect(result.data.rows.map((row) => row.run_id)).toEqual(
      NEWEST_FIRST.map((row) => row.run_id),
    );
  });

  it("reports a window that filled its cap as truncated, and one that did not as not", async () => {
    const full = stubClient({ [T.runs]: { data: RUNS } });
    const filled = await readRuns({ limit: RUNS.length }, full.asSupabaseClient());
    if (filled.kind !== "ok") throw new Error(`expected ok, got ${filled.kind}`);
    expect(filled.data.truncated).toBe(true);
    expect(filled.data.limit).toBe(RUNS.length);

    const roomy = stubClient({ [T.runs]: { data: RUNS } });
    const spare = await readRuns({ limit: RUNS.length + 1 }, roomy.asSupabaseClient());
    if (spare.kind !== "ok") throw new Error(`expected ok, got ${spare.kind}`);
    expect(spare.data.truncated).toBe(false);
  });

  it("never asks for more rows than the platform will return", async () => {
    const stub = stubClient({ [T.runs]: { data: [] } });
    await readRuns({ limit: ROW_CAP * 5 }, stub.asSupabaseClient());
    expect(steps(stub.calls[0], "limit")).toEqual([[ROW_CAP]]);

    // A cap nobody can compute falls back to the page's window rather than
    // becoming an unbounded query.
    const junk = stubClient({ [T.runs]: { data: [] } });
    await readRuns({ limit: Number.NaN }, junk.asSupabaseClient());
    expect(steps(junk.calls[0], "limit")).toEqual([[RUN_WINDOW]]);
  });

  it("answers an empty table with no rows, and never a state of its own", async () => {
    const stub = stubClient({ [T.runs]: { data: [] } });
    const result = await readRuns({}, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.data.rows).toEqual([]);
    expect(result.data.truncated).toBe(false);
    expect(result.data.source).toBeNull();
  });

  it("classifies an absent table as not provisioned, naming it", async () => {
    const stub = stubClient({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } });
    const result = await readRuns({}, stub.asSupabaseClient());
    expect(result).toEqual({ kind: "not_provisioned", missing: T.runs });
  });

  it("carries a refused read's own account, naming what it was reading", async () => {
    const stub = stubClient({ [T.runs]: { error: permissionDenied(T.runs) } });
    const result = await readRuns({}, stub.asSupabaseClient());
    if (result.kind !== "error") throw new Error(`expected error, got ${result.kind}`);
    expect(result.reading).toBe(T.runs);
    expect(result.message).toContain(`permission denied for table ${T.runs}`);
  });
});

describe("the ?source= facet", () => {
  it("narrows by NAME against the run's own source column, never by a key", async () => {
    const stub = stubClient({
      [T.runs]: { data: runsFrom(SOURCE.ticketmaster) },
    });
    const result = await readRuns(
      { source: SOURCE.ticketmaster },
      stub.asSupabaseClient(),
    );
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    const call = stub.calls[0];
    expect(steps(call, "eq")).toEqual([["source", SOURCE.ticketmaster]]);
    // `runs.source` is text with no foreign key (§6 trap 6): there is no id to
    // match on and none may be invented.
    expect(String(steps(call, "eq")[0][0])).not.toContain("source_id");
    expect(result.data.source).toBe(SOURCE.ticketmaster);
    expect(result.data.rows.map((row) => row.run_id)).toEqual(
      runsFrom(SOURCE.ticketmaster).map((row) => row.run_id),
    );
  });

  it("narrows nothing when no source was asked for", async () => {
    const stub = stubClient({ [T.runs]: { data: RUNS } });
    const result = await readRuns({}, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(steps(stub.calls[0], "eq")).toEqual([]);
    expect(result.data.source).toBeNull();
  });

  it("keeps a run whose source name no registry row carries", async () => {
    // No foreign key means an unregistered name is a legitimate run, and the
    // facet reaches it like any other.
    const stub = stubClient({ [T.runs]: { data: runsFrom(SOURCE.unregistered) } });
    const result = await readRuns(
      { source: SOURCE.unregistered },
      stub.asSupabaseClient(),
    );
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(steps(stub.calls[0], "eq")).toEqual([["source", SOURCE.unregistered]]);
    expect(result.data.rows).toHaveLength(1);
  });

  it("answers a name that matches nothing with an empty window, not a refusal", async () => {
    const stub = stubClient({ [T.runs]: { data: [] } });
    const result = await readRuns({ source: NO_SUCH_SOURCE }, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.data.rows).toEqual([]);
    expect(result.data.source).toBe(NO_SUCH_SOURCE);
  });

  it("treats a facet carrying nothing as no facet at all", async () => {
    expect(narrowedTo(undefined)).toBeNull();
    expect(narrowedTo("")).toBeNull();
    expect(narrowedTo("   ")).toBeNull();
    // A present name is used verbatim: a source is a text identifier, and
    // trimming it would match a row the URL did not ask for.
    expect(narrowedTo(SOURCE.ticketmaster)).toBe(SOURCE.ticketmaster);
    expect(narrowedTo(" spaced ")).toBe(" spaced ");

    const stub = stubClient({ [T.runs]: { data: [SUCCEEDED] } });
    const result = await readRuns({ source: "" }, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(steps(stub.calls[0], "eq")).toEqual([]);
    expect(result.data.source).toBeNull();
  });
});
