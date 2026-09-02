import { describe, expect, it } from "vitest";
import { readRecentEvents } from "@/lib/db/browse";
import { RECENT_EVENTS } from "@/lib/browse/views";
import { ROW_CAP } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import {
  ID,
  eventListingRow,
  eventRow,
  fieldProvenanceRow,
  sourceRow,
} from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  undefinedQualifiedColumn,
  type RecordedCall,
  type Script,
} from "../../fixtures/stub-client";

/**
 * Browse's reads (campaign admin-window/TASK-0015), offline against the stub
 * client. No network, no database.
 *
 * The stub answers with whatever the script says regardless of the chain the
 * query built, so the chain assertions below matter on their own: they are how
 * "newest first" and "this read is bounded / this read is complete" are proved
 * without a server to prove them against.
 */

const view = RECENT_EVENTS;

const EVENT_A = "01920000-0000-7000-8000-000000000a01";
const EVENT_B = "01920000-0000-7000-8000-000000000a02";
const EVENT_C = "01920000-0000-7000-8000-000000000a03";

/** Three events, deliberately NOT in arrival order, with a decoy calendar order. */
function events() {
  return [
    // arrived second; starts LAST
    eventRow({
      event_id: EVENT_B,
      title: "middle arrival",
      created_at: "2026-08-15T00:00:00Z",
      starts_at: "2027-06-01T00:00:00Z",
    }),
    // arrived FIRST; starts first
    eventRow({
      event_id: EVENT_C,
      title: "newest arrival",
      created_at: "2026-09-01T00:00:00Z",
      starts_at: "2026-10-01T00:00:00Z",
    }),
    // arrived last; starts in the middle
    eventRow({
      event_id: EVENT_A,
      title: "oldest arrival",
      created_at: "2026-07-01T00:00:00Z",
      starts_at: "2026-12-01T00:00:00Z",
    }),
  ];
}

function provenance() {
  return [
    fieldProvenanceRow({
      entity_id: EVENT_C,
      field: "title",
      source_id: ID.sourceTicketmaster,
    }),
    fieldProvenanceRow({
      entity_id: EVENT_C,
      field: "starts_at",
      source_id: ID.sourceBandsintown,
    }),
    // a second decision on the same field by the same source: append-only, so
    // the table really does hold repeats, and the column must not.
    fieldProvenanceRow({
      entity_id: EVENT_C,
      field: "title",
      source_id: ID.sourceTicketmaster,
    }),
    fieldProvenanceRow({
      entity_id: EVENT_B,
      field: "title",
      source_id: ID.sourceBandsintown,
    }),
  ];
}

function sources() {
  return [
    sourceRow({ source_id: ID.sourceTicketmaster, source: "ticketmaster" }),
    sourceRow({ source_id: ID.sourceBandsintown, source: "bandsintown" }),
  ];
}

function listings() {
  return [
    eventListingRow({ event_id: EVENT_C, venue_name: "Crypto.com Arena" }),
    eventListingRow({ event_id: EVENT_B, venue_name: null }),
    eventListingRow({ event_id: EVENT_A, venue_name: "The Forum" }),
  ];
}

/** A full, healthy script — every read answered with its exact count. */
function fullScript(overrides: Script = {}): Script {
  return {
    [T.events]: { data: events() },
    [T.eventListings]: { data: listings(), count: listings().length },
    [T.fieldProvenance]: { data: provenance(), count: provenance().length },
    [T.sources]: { data: sources(), count: sources().length },
    ...overrides,
  };
}

function callTo(stub: ReturnType<typeof stubClient>, table: string): RecordedCall {
  const call = stub.calls.find((each) => each.table === table);
  if (!call) throw new Error(`no query was built against '${table}'`);
  return call;
}

function argsOf(call: RecordedCall, method: string): unknown[][] {
  return call.steps.filter((step) => step.method === method).map((s) => s.args);
}

describe("the recent-events read", () => {
  it("returns the rows newest-first by arrival, not by the calendar", async () => {
    const stub = stubClient(fullScript());
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.events.kind).toBe("ok");
    if (listing.events.kind !== "ok") return;
    expect(listing.events.data.map((row) => row.event_id)).toEqual([
      EVENT_C, // 2026-09-01
      EVENT_B, // 2026-08-15
      EVENT_A, // 2026-07-01
    ]);
  });

  it("names the distinct sources behind each row, from the provenance join", async () => {
    const stub = stubClient(fullScript());
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    if (listing.events.kind !== "ok") throw new Error("expected ok");

    const byId = new Map(listing.events.data.map((row) => [row.event_id, row]));
    expect(byId.get(EVENT_C)?.sources).toEqual(["bandsintown", "ticketmaster"]);
    expect(byId.get(EVENT_B)?.sources).toEqual(["bandsintown"]);
    expect(byId.get(EVENT_A)?.sources).toEqual([]);
    expect(listing.provenance).toBeNull();
  });

  it("fills the venue name from the listings view", async () => {
    const stub = stubClient(fullScript());
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    if (listing.events.kind !== "ok") throw new Error("expected ok");

    const byId = new Map(listing.events.data.map((row) => [row.event_id, row]));
    expect(byId.get(EVENT_C)?.venue_name).toBe("Crypto.com Arena");
    expect(byId.get(EVENT_B)?.venue_name).toBeNull();
    expect(listing.venues).toBeNull();
  });

  it("carries every spot-verification value onto the row", async () => {
    const stub = stubClient(fullScript());
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    if (listing.events.kind !== "ok") throw new Error("expected ok");

    const newest = listing.events.data[0];
    const source = events().find((e) => e.event_id === EVENT_C);
    expect(newest.title).toBe(source?.title);
    expect(newest.description).toBe(source?.description);
    expect(newest.poster_url).toBe(source?.poster_url);
    expect(newest.starts_at).toBe(source?.starts_at);
    expect(newest.created_at).toBe(source?.created_at);
  });

  it("reads only the four objects it needs, each named through tables.ts", async () => {
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());
    expect(new Set(stub.tablesRead())).toEqual(
      new Set([T.events, T.eventListings, T.fieldProvenance, T.sources]),
    );
  });
});

describe("the window read", () => {
  it("orders the window on the view's own sort and bounds it with a limit", async () => {
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());
    const call = callTo(stub, T.events);

    const orders = argsOf(call, "order");
    expect(orders[0][0]).toBe(view.sort.field);
    expect(orders[0][1]).toEqual({ ascending: false });
    // A total order: the primary key breaks every tie, so the window is the
    // same set on every request.
    expect(orders[orders.length - 1][0]).toBe("event_id");
    expect(argsOf(call, "limit")[0][0]).toBe(view.window);
  });

  it("is a window read, so it asks for no exact count", async () => {
    // ARCHITECTURE.md §4.3: `events` is a growing catalog and Browse shows
    // "the newest N", never "all of them". A complete read here would refuse
    // the page outright once the catalog passed the row cap.
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());
    const select = argsOf(callTo(stub, T.events), "select")[0];
    expect(select[1]).toBeUndefined();
  });
});

describe("the join legs", () => {
  it("asks each leg for an exact count, a total order and the row cap", async () => {
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());

    for (const [table, primaryKey] of [
      [T.eventListings, "event_id"],
      [T.fieldProvenance, "provenance_id"],
      [T.sources, "source_id"],
    ] as const) {
      const call = callTo(stub, table);
      expect(argsOf(call, "select")[0][1], table).toEqual({ count: "exact" });
      const orders = argsOf(call, "order");
      expect(orders[orders.length - 1][0], table).toBe(primaryKey);
      expect(argsOf(call, "range")[0], table).toEqual([0, ROW_CAP - 1]);
    }
  });

  it("narrows each leg to the window's own ids", async () => {
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());

    const ids = [EVENT_B, EVENT_C, EVENT_A];
    expect(argsOf(callTo(stub, T.eventListings), "in")[0]).toEqual([
      "event_id",
      ids,
    ]);
    expect(argsOf(callTo(stub, T.fieldProvenance), "in")[0]).toEqual([
      "entity_id",
      ids,
    ]);
    expect(argsOf(callTo(stub, T.sources), "in")[0][0]).toBe("source_id");
  });

  it("asks provenance only about events, by the canonical table's own name", async () => {
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());
    expect(argsOf(callTo(stub, T.fieldProvenance), "eq")[0]).toEqual([
      "entity_type",
      T.events,
    ]);
  });

  it("skips every leg when the window came back empty", async () => {
    const stub = stubClient({ [T.events]: { data: [] } });
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.events).toEqual({ kind: "ok", data: [] });
    expect(listing.venues).toBeNull();
    expect(listing.provenance).toBeNull();
    expect(stub.tablesRead()).toEqual([T.events]);
  });

  it("skips the sources leg when provenance named no source", async () => {
    const stub = stubClient(
      fullScript({ [T.fieldProvenance]: { data: [], count: 0 } }),
    );
    await readRecentEvents(view, stub.asSupabaseClient());
    expect(stub.tablesRead()).not.toContain(T.sources);
  });
});

/**
 * `field_provenance` is an append-only decision log (campaign
 * admin-window/BUG-0010): the read has to fetch enough to tell a current
 * decision from a superseded one, and only the current ones may reach the
 * column.
 */
describe("the provenance leg, read as a decision log", () => {
  const OLD_STAMP = "2026-01-01T00:00:00Z";
  const NEW_STAMP = "2026-08-01T00:00:00Z";

  /** (EVENT_C, title) decided twice, plus a verdict unset on another field. */
  function log() {
    return [
      fieldProvenanceRow({
        provenance_id: "01920000-0000-7000-8000-0000000000f1",
        entity_id: EVENT_C,
        field: "title",
        source_id: ID.sourceBandsintown,
        applied_at: OLD_STAMP,
      }),
      fieldProvenanceRow({
        provenance_id: "01920000-0000-7000-8000-0000000000f2",
        entity_id: EVENT_C,
        field: "title",
        source_id: ID.sourceTicketmaster,
        applied_at: NEW_STAMP,
      }),
      {
        ...fieldProvenanceRow({
          provenance_id: "01920000-0000-7000-8000-0000000000f3",
          entity_id: EVENT_C,
          field: "poster_url",
          applied_at: NEW_STAMP,
        }),
        source_id: null,
        observation_id: null,
      },
    ];
  }

  function loggedScript() {
    return fullScript({
      [T.fieldProvenance]: { data: log(), count: log().length },
    });
  }

  it("selects the fact identity and the ordering key, not just the source", async () => {
    // Without `field` and a decision order the read cannot tell a current
    // decision from a superseded one at all.
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());
    const select = String(argsOf(callTo(stub, T.fieldProvenance), "select")[0][0]);
    for (const column of ["field", "applied_at", "provenance_id", "source_id"]) {
      expect(select, column).toContain(column);
    }
  });

  it("orders the log by the decision stamp, then by its key", async () => {
    const stub = stubClient(fullScript());
    await readRecentEvents(view, stub.asSupabaseClient());
    const columns = argsOf(callTo(stub, T.fieldProvenance), "order").map(
      (args) => args[0],
    );
    expect(columns.indexOf("applied_at")).toBeGreaterThan(-1);
    expect(columns.indexOf("provenance_id")).toBeGreaterThan(
      columns.indexOf("applied_at"),
    );
  });

  it("names the source of the latest decision, never the superseded one", async () => {
    const stub = stubClient(loggedScript());
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    if (listing.events.kind !== "ok") throw new Error("expected ok");
    const byId = new Map(listing.events.data.map((row) => [row.event_id, row]));
    expect(byId.get(EVENT_C)?.sources).toEqual(["ticketmaster"]);
  });

  it("looks up names only for the sources still behind a value", async () => {
    // The superseded source and the unset's absent one are not asked about:
    // `.in("source_id", [null])` is not a query, and a retired feed's name is
    // not needed to render a value it no longer backs.
    const stub = stubClient(loggedScript());
    await readRecentEvents(view, stub.asSupabaseClient());
    expect(argsOf(callTo(stub, T.sources), "in")[0]).toEqual([
      "source_id",
      [ID.sourceTicketmaster],
    ]);
  });

  it("skips the sources leg when every current decision is a verdict unset", async () => {
    const unsetOnly = [
      {
        ...fieldProvenanceRow({ entity_id: EVENT_C, field: "poster_url" }),
        source_id: null,
        observation_id: null,
      },
    ];
    const stub = stubClient(
      fullScript({
        [T.fieldProvenance]: { data: unsetOnly, count: unsetOnly.length },
      }),
    );
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    expect(stub.tablesRead()).not.toContain(T.sources);
    if (listing.events.kind !== "ok") throw new Error("expected ok");
    expect(listing.events.data.every((row) => row.sources.length === 0)).toBe(
      true,
    );
    expect(listing.provenance).toBeNull();
  });

  it("refuses a truncated log rather than calling a superseded source current", async () => {
    // "The latest decision" is only knowable over the COMPLETE set, so the
    // complete read refuses instead of reducing a partial log.
    const stub = stubClient(
      fullScript({
        [T.fieldProvenance]: { data: log(), count: ROW_CAP + 1 },
      }),
    );
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    expect(listing.provenance?.kind).toBe("error");
    expect(stub.tablesRead()).not.toContain(T.sources);
    if (listing.events.kind !== "ok") throw new Error("expected ok");
    expect(listing.events.data.every((row) => row.sources.length === 0)).toBe(
      true,
    );
  });
});

describe("when an object is missing", () => {
  it("names events itself and renders no rows", async () => {
    const stub = stubClient({
      [T.events]: { error: tableNotInSchemaCache(T.events) },
    });
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.events).toEqual({
      kind: "not_provisioned",
      missing: T.events,
    });
    expect(stub.tablesRead()).toEqual([T.events]);
  });

  it("still returns every event row when field_provenance is absent", async () => {
    // The acceptance criterion: with `field_provenance` absent the event rows
    // still render AND the page is told which table is missing.
    const stub = stubClient(
      fullScript({
        [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
      }),
    );
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.events.kind).toBe("ok");
    if (listing.events.kind !== "ok") return;
    expect(listing.events.data).toHaveLength(3);
    expect(listing.events.data.every((row) => row.sources.length === 0)).toBe(
      true,
    );
    expect(listing.provenance).toEqual({
      kind: "not_provisioned",
      missing: T.fieldProvenance,
    });
    // The venue column is unaffected by the provenance table's absence.
    expect(listing.venues).toBeNull();
    expect(listing.events.data[0].venue_name).toBe("Crypto.com Arena");
  });

  it("still returns every event row when the listings view is absent", async () => {
    const stub = stubClient(
      fullScript({
        [T.eventListings]: { error: tableNotInSchemaCache(T.eventListings) },
      }),
    );
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.events.kind).toBe("ok");
    if (listing.events.kind !== "ok") return;
    expect(listing.events.data).toHaveLength(3);
    expect(listing.events.data.every((row) => row.venue_name === null)).toBe(
      true,
    );
    expect(listing.venues).toEqual({
      kind: "not_provisioned",
      missing: T.eventListings,
    });
    expect(listing.provenance).toBeNull();
  });

  it("reports the sources table's absence as the provenance column's failure", async () => {
    // The two reads answer one question — "which sources are behind this row"
    // — so one failure is one note rather than two.
    const stub = stubClient(
      fullScript({ [T.sources]: { error: tableNotInSchemaCache(T.sources) } }),
    );
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.provenance).toEqual({
      kind: "not_provisioned",
      missing: T.sources,
    });
    if (listing.events.kind !== "ok") throw new Error("expected ok");
    expect(listing.events.data).toHaveLength(3);
    // The ids stand in for names nobody could resolve — the decision is real,
    // and the order is the same deterministic string order the names get.
    expect(listing.events.data[0].sources).toEqual(
      [ID.sourceBandsintown, ID.sourceTicketmaster].sort(),
    );
  });

  it("names the missing COLUMN when the database complains about one", async () => {
    const stub = stubClient({
      [T.events]: {
        error: undefinedQualifiedColumn(T.events, "created_at"),
      },
    });
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    expect(listing.events).toEqual({
      kind: "not_provisioned",
      missing: `${T.events}.created_at`,
    });
  });
});

describe("when a read fails or refuses", () => {
  it("surfaces the database's own words, never a message of ours", async () => {
    const stub = stubClient({
      [T.events]: { error: permissionDenied(T.events) },
    });
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.events.kind).toBe("error");
    if (listing.events.kind !== "error") return;
    // The database's own words survive, and the leg that refused is named —
    // Browse makes four reads, so "which one" is half the answer (BUG-0016).
    expect(listing.events.message).toContain(permissionDenied(T.events).message);
    expect(listing.events.reading).toBe(T.events);
  });

  it("refuses a truncated provenance set instead of understating the sources", async () => {
    // A complete read whose exact count exceeds the rows returned is an
    // error naming the object, the count and the cap — never a partial list
    // presented as "the sources behind this row".
    const stub = stubClient(
      fullScript({
        [T.fieldProvenance]: { data: provenance(), count: ROW_CAP + 7 },
      }),
    );
    const listing = await readRecentEvents(view, stub.asSupabaseClient());

    expect(listing.provenance?.kind).toBe("error");
    expect(
      listing.provenance?.kind === "error" ? listing.provenance.message : "",
    ).toContain(String(ROW_CAP + 7));
    if (listing.events.kind !== "ok") throw new Error("expected ok");
    expect(listing.events.data.every((row) => row.sources.length === 0)).toBe(
      true,
    );
  });

  it("refuses a leg that came back with no count at all", async () => {
    // PostgREST answers a select written without { count: "exact" } with
    // error: null and count: null; a helper that read that as "all of them"
    // is admin-window/BUG-0007's defect.
    const stub = stubClient(
      fullScript({ [T.eventListings]: { data: listings() } }),
    );
    const listing = await readRecentEvents(view, stub.asSupabaseClient());
    expect(listing.venues?.kind).toBe("error");
  });

  it("never throws, whatever the database does", async () => {
    for (const script of [
      { [T.events]: { error: new Error("socket hang up") } },
      { [T.events]: { data: null } },
      fullScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
      fullScript({ [T.fieldProvenance]: { data: null, count: null } }),
    ] as Script[]) {
      const stub = stubClient(script);
      await expect(
        readRecentEvents(view, stub.asSupabaseClient()),
      ).resolves.toBeDefined();
    }
  });
});
