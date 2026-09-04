import { describe, expect, it } from "vitest";
import { ID_CHUNK, ROW_CAP } from "@/lib/db/result";
import {
  listSources,
  readLastRun,
  readSourceNames,
  readSources,
  selectSources,
  type SourceState,
} from "@/lib/db/sources";
import { T } from "@/lib/db/tables";
import { RUN, SOURCE, SOURCES, newestRunFor, runsResponseFor } from "./population";
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
    [T.runs]: SOURCES.map((source) => ({ data: runsResponseFor(source.source) })),
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
  it("asks for one row, newest first, for that source's NAME", async () => {
    // One read, so the script answers with what a database filtered to that
    // name would return.
    const client = readsWith(
      healthyScript({ [T.runs]: { data: runsResponseFor("ticketmaster") } }),
    );
    const result = await readLastRun("ticketmaster", client.asSupabaseClient());
    expect(result).toEqual({ kind: "ok", data: newestRunFor("ticketmaster") });

    const steps = stepsOf(client, T.runs);
    const byMethod = new Map(steps.map((step) => [step.method, step.args]));
    expect(byMethod.get("eq")).toEqual(["source", "ticketmaster"]);
    expect(steps.filter((step) => step.method === "order").map((step) => step.args)).toEqual([
      ["started_at", { ascending: false }],
      ["run_id", { ascending: false }],
    ]);
    expect(byMethod.get("limit")).toEqual([1]);
  });

  it("answers null — never a row of somebody else's — when there is no run", async () => {
    const client = readsWith(healthyScript({ [T.runs]: { data: [] } }));
    const result = await readLastRun("bandsintown", client.asSupabaseClient());
    expect(result).toEqual({ kind: "ok", data: null });
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

  it("reads the runs table once per source, and no more", async () => {
    const client = readsWith(healthyScript());
    await listSources(client.asSupabaseClient());
    expect(client.tablesRead().filter((table) => table === T.runs)).toHaveLength(
      SOURCES.length,
    );
  });
});

describe("the narrowing predicate", () => {
  const states: SourceState[] = SOURCES.map((source) => ({ ...source, lastRun: null }));

  it("keeps everything when nothing is asked for", () => {
    expect(selectSources(states)).toHaveLength(SOURCES.length);
  });

  it("keeps exactly the source the filter names", () => {
    expect(
      selectSources(states, { source_id: SOURCE.fandom }).map((state) => state.source_id),
    ).toEqual([SOURCE.fandom]);
  });

  it("keeps nothing for a source the registry does not hold", () => {
    expect(selectSources(states, { source_id: "nobody" })).toEqual([]);
  });
});

/* ── the label leg ───────────────────────────────────────────────────────── */

/**
 * `readSourceNames` — the second leg (§4.2) that answers "what is this source
 * called" for the surfaces whose own read keys a source by `source_id` and
 * carries no name (`/claims`, the review item). Campaign
 * admin-window/BUG-0043.
 *
 * What is pinned here is what a rendered page cannot show: that an empty id
 * set costs NO round trip, that the request is bounded, and that a refusal
 * arrives as a refusal instead of as an empty registry — an empty `ok` would
 * label every source by its uuid with nothing on screen to say why.
 */
describe("the label leg", () => {
  const NAMES = SOURCES.map((row) => ({ source_id: row.source_id, source: row.source }));

  it("makes no round trip at all for an empty id set", async () => {
    // The stub throws for any table it has no script for, so a query here
    // fails the read as well as the count.
    const client = readsWith({});
    const result = await readSourceNames([], client.asSupabaseClient());
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.data).toEqual([]);
    expect(client.tablesRead()).toEqual([]);
  });

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

  it("keeps every request bounded, and joins the chunks it got back", async () => {
    // A surface may hold more distinct sources than one URL can carry; the
    // answer must still be one lookup, not a truncated one.
    const many = Array.from(
      { length: ID_CHUNK + 5 },
      (_, index) => `01920000-0000-7000-8000-${String(index).padStart(12, "0")}`,
    );
    const client = readsWith({
      [T.sources]: [
        { data: many.slice(0, ID_CHUNK).map((id) => ({ source_id: id, source: "a" })) },
        { data: many.slice(ID_CHUNK).map((id) => ({ source_id: id, source: "b" })) },
      ],
    });
    const result = await readSourceNames(many, client.asSupabaseClient());
    expect(result.kind === "ok" && result.data).toHaveLength(many.length);
    const calls = client.calls.filter((made) => made.table === T.sources);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const ids = call.steps.find((step) => step.method === "in")?.args[1] as string[];
      expect(ids.length).toBeLessThanOrEqual(ID_CHUNK);
    }
  });

  it("answers an id the registry holds no row for by leaving it out", async () => {
    // Not an invented row and not an error: the caller's `sourceLabel` renders
    // that id verbatim, which is the only true thing it can say.
    const client = readsWith({ [T.sources]: { data: [NAMES[0]] } });
    const result = await readSourceNames(
      [NAMES[0].source_id, "01920000-0000-7000-8000-0000000009ff"],
      client.asSupabaseClient(),
    );
    expect(result.kind === "ok" && result.data.map((row) => row.source_id)).toEqual([
      NAMES[0].source_id,
    ]);
  });

  it("refuses as a refusal, naming the registry — never as an empty registry", async () => {
    for (const [failure, kind] of [
      [tableNotInSchemaCache(T.sources), "not_provisioned"],
      [permissionDenied(T.sources), "error"],
    ] as const) {
      const client = readsWith({ [T.sources]: { error: failure } });
      const result = await readSourceNames(
        [SOURCES[0].source_id],
        client.asSupabaseClient(),
      );
      expect(result.kind, kind).toBe(kind);
      // Whichever arm it is, it NAMES the object it was reading, in the
      // spelling the query used — a page composing several reads has to be
      // able to say which one refused (§4.1).
      const named =
        result.kind === "not_provisioned"
          ? result.missing
          : result.kind === "error"
            ? result.reading
            : "";
      expect(named, kind).toBe(T.sources);
    }
  });

  it("stops at the chunk that refused instead of half-filling the lookup", async () => {
    const many = Array.from(
      { length: ID_CHUNK + 5 },
      (_, index) => `01920000-0000-7000-8000-${String(index).padStart(12, "0")}`,
    );
    const client = readsWith({
      [T.sources]: [
        { data: many.slice(0, ID_CHUNK).map((id) => ({ source_id: id, source: "a" })) },
        { error: permissionDenied(T.sources) },
      ],
    });
    const result = await readSourceNames(many, client.asSupabaseClient());
    // A partial map would name half the rows and silently uuid the other half.
    expect(result.kind).toBe("error");
  });
});
