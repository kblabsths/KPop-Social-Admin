import { describe, expect, it } from "vitest";
import { ROW_CAP } from "@/lib/db/result";
import {
  lastRunBySource,
  listSources,
  readLastRuns,
  readSourceNames,
  readSources,
} from "@/lib/db/sources";
import { T } from "@/lib/db/tables";
import {
  RUN,
  RUNS,
  RUNS_AS_READ,
  SOURCES,
  manySources,
  newestRunFor,
  runsResponse,
} from "./population";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
  type StubClient,
} from "../../fixtures/stub-client";

/**
 * The source-registry reads (campaign admin-window/TASK-0013).
 *
 * Two properties are asserted here that the rendered page cannot show:
 *
 *  1. the registry read is a COMPLETE read (ARCHITECTURE.md §4.3) — exact
 *     count, a total server order ending in the primary key, and the cap — so
 *     an `ok` array is the WHOLE table and a truncated answer REFUSES instead
 *     of rendering a partial registry as the registry;
 *  2. the last-run read is bounded per source and matched by NAME (§6 trap 6),
 *     and its two legs report their own object when either is absent.
 */

function readsWith(script: Script): StubClient {
  return stubClient(script);
}

/** The steps of the one call made against a table, as `method -> args`. */
function stepsOf(client: StubClient, table: string, index = 0) {
  const call = client.calls.filter((made) => made.table === table)[index];
  expect(call, `${table} was queried`).toBeDefined();
  return call.steps;
}

function healthyScript(overrides: Script = {}): Script {
  return {
    [T.sources]: { data: [...SOURCES], count: SOURCES.length },
    // ONE response, because there is ONE request: the whole run log, in the
    // order the server was asked for it.
    [T.runs]: runsResponse(),
    ...overrides,
  };
}

describe("the registry read", () => {
  it("asks for the whole table: exact count, total order, the cap", async () => {
    const client = readsWith(healthyScript());
    const result = await readSources(client.asSupabaseClient());
    expect(result.kind).toBe("ok");

    const steps = stepsOf(client, T.sources);
    const byMethod = new Map(steps.map((step) => [step.method, step.args]));
    expect(byMethod.get("select")?.[1]).toEqual({ count: "exact" });
    expect(steps.filter((step) => step.method === "order").map((step) => step.args)).toEqual([
      ["source", { ascending: true }],
      // Ends in the primary key, so the server order is total and a refusal is
      // deterministic.
      ["source_id", { ascending: true }],
    ]);
    expect(byMethod.get("range")).toEqual([0, ROW_CAP - 1]);
  });

  it("refuses rather than returning a partial registry", async () => {
    const client = readsWith(
      healthyScript({
        // The database holds more rows than came back — our cap, or the
        // server's own `db-max-rows`.
        [T.sources]: { data: [...SOURCES], count: SOURCES.length + 7 },
      }),
    );
    const result = await readSources(client.asSupabaseClient());
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.sources);
    expect(result.message).toContain(String(SOURCES.length + 7));
  });

  it("refuses a read that came back with no count at all", async () => {
    const client = readsWith(healthyScript({ [T.sources]: { data: [...SOURCES] } }));
    const result = await readSources(client.asSupabaseClient());
    // A count nobody made is never a zero and never an "all of it"
    // (ARCHITECTURE.md §4.3; admin-window/BUG-0007).
    expect(result.kind).toBe("error");
  });

  it("names the sources table when it is not in this database", async () => {
    const client = readsWith(
      healthyScript({ [T.sources]: { error: tableNotInSchemaCache(T.sources) } }),
    );
    const result = await listSources(client.asSupabaseClient());
    expect(result).toEqual({ kind: "not_provisioned", missing: T.sources });
  });
});

describe("the last-run read", () => {
  it("asks the whole runs table for its rows, in one complete read", async () => {
    const client = readsWith(healthyScript());
    const result = await readLastRuns(client.asSupabaseClient());
    expect(result).toEqual({ kind: "ok", data: RUNS_AS_READ });

    const steps = stepsOf(client, T.runs);
    const byMethod = new Map(steps.map((step) => [step.method, step.args]));
    // A COMPLETE read (§4.3 kind 1): the exact count, the total order, the cap.
    expect(byMethod.get("select")?.[1]).toEqual({ count: "exact" });
    expect(steps.filter((step) => step.method === "order").map((step) => step.args)).toEqual([
      ["source", { ascending: true }],
      ["started_at", { ascending: false }],
      // uuid v7: the tie breaks in time's own direction, so the order is total.
      ["run_id", { ascending: false }],
    ]);
    expect(byMethod.get("range")).toEqual([0, ROW_CAP - 1]);
    // Unnarrowed on purpose: it needs no name from the registry, which is what
    // lets it run concurrently with it.
    expect(byMethod.get("eq"), "the runs read narrowed by a name").toBeUndefined();
    expect(byMethod.get("in"), "the runs read narrowed by a name set").toBeUndefined();
  });

  it("refuses, naming runs and the real number, rather than folding a partial log", async () => {
    // The cost of one complete read of a table with no retention policy, made
    // a tested state: past the cap the page says so instead of rendering a
    // registry whose last-run column is quietly wrong.
    const client = readsWith(
      healthyScript({ [T.runs]: { data: [...RUNS_AS_READ], count: 1500 } }),
    );
    const result = await readLastRuns(client.asSupabaseClient());
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.runs);
    expect(result.message).toContain("1500");
    expect(result.message).toContain(String(ROW_CAP));
  });

  it("refuses a runs read that came back with no count at all", async () => {
    const client = readsWith(healthyScript({ [T.runs]: { data: [...RUNS_AS_READ] } }));
    // A count nobody made is never a zero and never an "all of it" (§4.3).
    expect((await readLastRuns(client.asSupabaseClient())).kind).toBe("error");
  });

  it("names the runs table when it is not in this database", async () => {
    const client = readsWith(
      healthyScript({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } }),
    );
    const result = await listSources(client.asSupabaseClient());
    // The other leg's object is not blamed for this one's absence.
    expect(result).toEqual({ kind: "not_provisioned", missing: T.runs });
  });

  it("surfaces the database's own words when the run read fails", async () => {
    const client = readsWith(
      healthyScript({ [T.runs]: { error: permissionDenied(T.runs) } }),
    );
    const result = await listSources(client.asSupabaseClient());
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.runs);
    expect(result.message).toContain(`permission denied for table ${T.runs}`);
  });

  it("reports the registry's own refusal when both legs refuse", async () => {
    // The first refusal wins and is returned as it stands, as it did when the
    // legs ran in sequence: the card names `sources`, not the neighbour.
    const client = readsWith({
      [T.sources]: { error: permissionDenied(T.sources) },
      [T.runs]: { error: permissionDenied(T.runs) },
    });
    const result = await listSources(client.asSupabaseClient());
    expect(result.kind === "error" && result.reading).toBe(T.sources);
  });
});

/**
 * The fold — the newest run per NAME out of the complete set, with no read of
 * its own (campaign admin-window/BUG-0139).
 *
 * Its input is the rows IN THE ORDER the read asks the server for, which the
 * case above pins off the recorded chain; here the fixture states that order
 * (`RUNS_AS_READ`) and this file's own `newestRunFor` states the answer.
 */
describe("the newest run per name", () => {
  it("breaks a tie on started_at with the uuid v7 run id", async () => {
    const tied = RUNS.filter((run) => run.source === "fandom");
    expect(tied).toHaveLength(2);
    expect(new Set(tied.map((run) => run.started_at)).size, "the fixture ties").toBe(1);
    // Both start at the same instant, so only the id can decide it.
    expect(lastRunBySource(RUNS_AS_READ).get("fandom")?.run_id).toBe(RUN.fandomInFlight);
  });

  it("takes the one run of a source that has exactly one", async () => {
    expect(lastRunBySource(RUNS_AS_READ).get("eventbrite")?.run_id).toBe(RUN.orphan);
  });
});

describe("a source with its last run", () => {
  it("gives every source the newest run carrying its name, and null for none", async () => {
    const client = readsWith(healthyScript());
    const result = await listSources(client.asSupabaseClient());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.data.map((state) => state.source_id)).toEqual(
      SOURCES.map((source) => source.source_id),
    );
    for (const state of result.data) {
      expect(state.lastRun, state.source).toEqual(newestRunFor(state.source));
    }
    // The run belonging to no registry row is nobody's last run.
    expect(
      result.data.some((state) => state.lastRun?.run_id === RUN.orphan),
      "an unregistered source's run is nobody's",
    ).toBe(false);
  });

  it("makes exactly two requests, whatever the registry holds", async () => {
    // The loop this replaced made one `runs` request per registered source:
    // four round trips for three sources, thirty-one for thirty. Two fixtures,
    // three sources and 300, so a per-source read cannot pass.
    const three = readsWith(healthyScript());
    await listSources(three.asSupabaseClient());
    expect(three.tablesRead()).toEqual([T.sources, T.runs]);

    const many = manySources(300);
    const bulk = readsWith({
      [T.sources]: { data: many.sources, count: many.sources.length },
      [T.runs]: { data: many.runs, count: many.runs.length },
    });
    const result = await listSources(bulk.asSupabaseClient());
    expect(bulk.tablesRead()).toEqual([T.sources, T.runs]);
    // And it is still the right answer for all 300 of them.
    expect(result.kind === "ok" && result.data).toHaveLength(300);
    expect(
      result.kind === "ok" &&
        result.data.every((state, index) => state.lastRun?.run_id === many.runs[index].run_id),
    ).toBe(true);
  });

  it("issues both legs together rather than one after the other", async () => {
    // The runs read waited behind the registry's answer and was skipped
    // whenever the registry refused. Concurrent, it is ISSUED whatever the
    // registry does — which is the one thing sequential code cannot do, and it
    // needs no clock to observe.
    const client = readsWith(
      healthyScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
    );
    const result = await listSources(client.asSupabaseClient());
    expect(result.kind === "error" && result.reading).toBe(T.sources);
    expect(client.tablesRead()).toEqual([T.sources, T.runs]);
  });
});

/* ── the label leg ───────────────────────────────────────────────────────── */

/**
 * `readSourceNames` — the second leg (§4.2) that answers "what is this source
 * called" for the surfaces whose own read keys a source by `source_id` and
 * carries no name (`/claims`, the review item). Campaign
 * admin-window/BUG-0043.
 */
describe("the label leg", () => {
  const NAMES = SOURCES.map((row) => ({ source_id: row.source_id, source: row.source }));

  it("asks the registry only for the id it is keyed by and the name", async () => {
    const client = readsWith({ [T.sources]: { data: NAMES } });
    const result = await readSourceNames(
      SOURCES.map((row) => row.source_id),
      client.asSupabaseClient(),
    );
    expect(result.kind === "ok" && result.data).toEqual(NAMES);

    const steps = stepsOf(client, T.sources);
    const select = steps.find((step) => step.method === "select");
    expect(select?.args[0]).toBe("source_id, source");
    const narrowing = steps.find((step) => step.method === "in");
    expect(narrowing?.args[0]).toBe("source_id");
    expect(narrowing?.args[1]).toEqual(SOURCES.map((row) => row.source_id));
  });
});
