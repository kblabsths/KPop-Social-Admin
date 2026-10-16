import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The browse paging route handler, driven directly — campaign
 * admin-window/TASK-0068.
 *
 * `GET /api/admin/browse/rows` answers ONE page of the recent-events window
 * `/browse` server-rendered. What is asserted here is the whole of what it
 * PROMISES the client (ARCHITECTURE.md §4.3 read kind 3):
 *
 *  - the GATE runs first and a refused gate issues NO read;
 *  - the BOUND reaches nothing but `pageBound`, and a refused bound reaches no
 *    read at all — the recorder stays empty over the whole refusal table,
 *    while the one canonical bound in that same table IS served, so the table
 *    cannot pass by refusing everything;
 *  - full-or-exhausted, on both edges, with the row count the READ returned —
 *    and a leg that contributes nothing may neither shorten the page nor end
 *    the set (common violations row 14);
 *  - the two legs that fill columns travel WITH the answer, never dropped;
 *  - every arm carries the gated-answer cache directives, so the first screen
 *    and its continuation are one surface under ONE cache policy;
 *  - every body the handler emits is one `isPageAnswer` accepts.
 *
 * The seam is `getDbClient()` (`src/lib/db/client.ts`) — the ONE place the app
 * resolves a database client (§4 rule 3) — so the real `readRecentEvents` runs
 * against a RECORDING stub and "no read was issued" is observable as "the stub
 * recorded nothing". The gate is stubbed because the adversary's premise is a
 * caller who IS an allowlisted admin; it is stubbed CLOSED in its own test to
 * prove the order of the two.
 */

const gate = vi.hoisted(() => ({
  answer: undefined as unknown,
  calls: 0,
}));

vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => {
    gate.calls += 1;
    return gate.answer as { error?: Response; user?: { email: string } };
  },
}));

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDbClient: () => {
      if (readWith.client === undefined) {
        throw new Error("the route was driven without a scripted database");
      }
      return readWith.client as SupabaseClient;
    },
  };
});

const { GET } = await import("@/app/api/admin/browse/rows/route");

import type { BrowseRow } from "@/lib/browse/rows";
import { RECENT_EVENTS } from "@/lib/browse/views";
import type { BrowseLegNotes } from "@/lib/db/browse";
import { T } from "@/lib/db/tables";
import {
  MAX_PAGE_OFFSET,
  OFFSET_PARAM,
  PAGE_ANSWER_CACHE_CONTROL,
  PAGE_ROUTES,
  isPageAnswer,
  type NotedPageAnswer,
} from "@/lib/paging/bounds";
import {
  ID,
  eventListingRow,
  eventRow,
  fieldProvenanceRow,
  sourceRow,
  type EventRow,
} from "../../fixtures/rows";
import { codeText } from "../source-tree";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type RecordedCall,
  type Script,
  type ScriptedResponse,
  type StubClient,
} from "../../fixtures/stub-client";

/** The admin the stubbed gate hands the handler. Not a real address. */
const ADMIN = { user: { email: "paging-suite@example.invalid" } };

const view = RECENT_EVENTS;

/**
 * A catalog deep enough to page through, and DELIBERATELY not a multiple of
 * the window: 137 events make offset 50 a FULL page that continues and offset
 * 100 a SHORT one that ends the set, so both edges of the biconditional are
 * driven against one fixture (admin-window/BUG-0168's ruling).
 */
const DEPTH = 137;

const CATALOG: readonly EventRow[] = Array.from({ length: DEPTH }, (_, index) =>
  eventRow({
    event_id: `01920000-0000-7000-8000-${(920000 + index).toString().padStart(12, "0")}`,
    title: `event ${index}`,
    // STRICTLY descending arrival, so the read's own order (`created_at desc`,
    // the id breaking ties) is this array's order and the page at each offset
    // is a plain slice of the fixture.
    created_at: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
  }),
);

/** The `.range(from, to)` a recorded call carried. */
function rangeOf(call: RecordedCall): [number, number] {
  const step = call.steps.find((one) => one.method === "range");
  expect(step, "the read carried no range").toBeDefined();
  return (step as { args: unknown[] }).args as [number, number];
}

/** The events window, answered from the fixture at whatever range was asked. */
function catalogWindow(rows: readonly EventRow[] = CATALOG) {
  return (call: RecordedCall): ScriptedResponse => {
    const [from, to] = rangeOf(call);
    return { data: rows.slice(from, to + 1) };
  };
}

/** The ids a leg was asked about. */
function askedIds(call: RecordedCall): string[] {
  const step = call.steps.find((one) => one.method === "in");
  return ((step?.args[1] as string[] | undefined) ?? []).slice();
}

/** Venue names for exactly the ids a leg asked about. */
function listingsFor(call: RecordedCall): ScriptedResponse {
  const ids = askedIds(call);
  return {
    data: ids.map((id) => eventListingRow({ event_id: id, venue_name: "The Forum" })),
    count: ids.length,
  };
}

/** One applied title decision per id a leg asked about. */
function provenanceFor(call: RecordedCall): ScriptedResponse {
  const ids = askedIds(call);
  return {
    data: ids.map((id) =>
      fieldProvenanceRow({
        provenance_id: `01920000-0000-7000-8000-${id.slice(-12)}`,
        entity_id: id,
        field: "title",
        source_id: ID.sourceTicketmaster,
      }),
    ),
    count: ids.length,
  };
}

const SOURCES: ScriptedResponse = {
  data: [sourceRow({ source_id: ID.sourceTicketmaster, source: "ticketmaster" })],
  count: 1,
};

function script(overrides: Script = {}): Script {
  return {
    [T.events]: catalogWindow(),
    [T.eventListings]: listingsFor,
    [T.fieldProvenance]: provenanceFor,
    [T.sources]: SOURCES,
    ...overrides,
  };
}

/** Script the database the next request reads, and keep the recorder. */
function database(scripted: Script): StubClient {
  const stub = stubClient(scripted);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

/** The request one press makes: the route's own path and its bound. */
function request(query: string): Request {
  return new Request(`http://admin.invalid${PAGE_ROUTES.browse}${query}`);
}

/** Every read of the events window this request issued. */
function windowReads(stub: StubClient): RecordedCall[] {
  return stub.calls.filter((call) => call.table === T.events);
}

/** Drive the handler and read its answer back as the client would. */
async function ask(
  query: string,
): Promise<{ status: number; body: unknown; cacheControl: string | null }> {
  const response = await GET(request(query));
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
  };
}

/**
 * Every answer this route serves is fed back through the CLIENT's own gate.
 *
 * `isPageAnswer` is asked of `unknown` on the far side of the wire, so an
 * answer it rejects is one the driver refuses out loud whatever is in it —
 * which is why it is asserted on all four arms rather than on the ok one.
 */
function accepted(body: unknown): NotedPageAnswer<BrowseRow, BrowseLegNotes> {
  expect(isPageAnswer(body), `the client's own gate rejects ${JSON.stringify(body)}`).toBe(true);
  return body as NotedPageAnswer<BrowseRow, BrowseLegNotes>;
}

/** The route, repo-relative — the spelling `codeText` reads. */
const ROUTE_FILE = "src/app/api/admin/browse/rows/route.ts";

/** The route file, whole, as the structural assertions read it. */
function routeSource(): string {
  return fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "..", ROUTE_FILE),
    "utf8",
  );
}

beforeEach(() => {
  gate.answer = ADMIN;
  gate.calls = 0;
  readWith.client = undefined;
});

describe("the gate, first and always", () => {
  it("answers the gate's own refusal and issues no read", async () => {
    const stub = database(script());
    gate.answer = { error: Response.json({ error: "Forbidden" }, { status: 403 }) };

    const response = await GET(request(`?${OFFSET_PARAM}=50`));

    expect(response.status).toBe(403);
    expect(gate.calls).toBe(1);
    // Not a row, not a count, not a leg: nothing below the gate ran.
    expect(stub.calls).toEqual([]);
  });

  it("asks the gate before it reads the bound, so a stranger never learns the bound's verdict", async () => {
    const stub = database(script());
    gate.answer = { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };

    // A bound the handler would refuse 400 if it ever looked at it.
    const response = await GET(request(`?${OFFSET_PARAM}=abc`));

    expect(response.status).toBe(401);
    expect(stub.calls).toEqual([]);
  });

  it("is the first statement of the handler body", () => {
    const source = routeSource();
    const body = source.slice(source.indexOf("export async function GET"));
    const firstStatement = body.slice(body.indexOf("{") + 1).trim().split("\n")[0];
    expect(firstStatement).toMatch(/requireAdmin\(\)/);
  });
});

/**
 * The refusal table — the measured failure it exists to stop (QA,
 * admin-window/TASK-0065 close): a hand-rolled numeric coercion of `"abc"` is
 * `NaN`, staging answers `.range(NaN, NaN)` with an ok page of ZERO rows, and
 * a zero-row ok page is EXHAUSTION — so a malformed URL would render to the
 * operator as a set that has ended rather than as a refusal.
 *
 * Every entry is asserted four ways: HTTP 400, a `refused` answer naming the
 * reason and the bound AS SENT, the gated cache directives, and a recorder
 * that stayed EMPTY.
 */
const REFUSED: ReadonlyArray<readonly [string, string, string]> = [
  ["no offset parameter at all", "", ""],
  ["an empty offset", `?${OFFSET_PARAM}=`, ""],
  ["a word", `?${OFFSET_PARAM}=abc`, "abc"],
  ["a leading space", `?${OFFSET_PARAM}=%2050`, " 50"],
  ["an explicit sign", `?${OFFSET_PARAM}=%2B50`, "+50"],
  ["a leading zero", `?${OFFSET_PARAM}=050`, "050"],
  ["a decimal point", `?${OFFSET_PARAM}=50.0`, "50.0"],
  ["an exponent", `?${OFFSET_PARAM}=1e2`, "1e2"],
  ["a negative bound", `?${OFFSET_PARAM}=-50`, "-50"],
  ["a bound below the window", `?${OFFSET_PARAM}=49`, "49"],
  ["a bound off the window's grid", `?${OFFSET_PARAM}=51`, "51"],
  [
    "a bound past the ceiling",
    `?${OFFSET_PARAM}=${MAX_PAGE_OFFSET + view.window}`,
    String(MAX_PAGE_OFFSET + view.window),
  ],
];

describe("the bound reaches nothing but pageBound", () => {
  it.each(REFUSED)("refuses %s with 400, naming it, and reads nothing", async (_what, query, sent) => {
    const stub = database(script());

    const { status, body, cacheControl } = await ask(query);
    const answer = accepted(body);

    expect(status).toBe(400);
    expect(answer.kind).toBe("refused");
    if (answer.kind !== "refused") return;
    // The bound AS SENT — never a trimmed, repaired or clamped spelling of it.
    expect(answer.bound).toBe(sent);
    expect(answer.reason.length).toBeGreaterThan(0);
    expect(cacheControl).toBe(PAGE_ANSWER_CACHE_CONTROL);
    // The whole point: no query of any object was even built.
    expect(stub.calls, `${sent} reached a read`).toEqual([]);
  });

  it("serves the one canonical bound in that same table, so the table cannot pass by refusing everything", async () => {
    const stub = database(script());

    const { status, body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    expect(status).toBe(200);
    expect(answer.kind).toBe("ok");
    // Exactly ONE read of the events window, and it is the window the bound
    // named — `.range(offset, offset + window - 1)`, never a NaN range.
    expect(windowReads(stub).length).toBe(1);
    expect(rangeOf(windowReads(stub)[0])).toEqual([view.window, view.window * 2 - 1]);
  });

  it("takes the FIRST value of a repeated offset, as URLSearchParams.get would", async () => {
    const stub = database(script());

    const { status } = await ask(`?${OFFSET_PARAM}=50&${OFFSET_PARAM}=60`);

    expect(status).toBe(200);
    expect(rangeOf(windowReads(stub)[0])[0]).toBe(50);
  });

  it("refuses on the FIRST value of a repeated offset too", async () => {
    const stub = database(script());

    const { status, body } = await ask(`?${OFFSET_PARAM}=abc&${OFFSET_PARAM}=50`);
    const answer = accepted(body);

    expect(status).toBe(400);
    if (answer.kind !== "refused") throw new Error(`expected a refusal, got ${answer.kind}`);
    expect(answer.bound).toBe("abc");
    expect(stub.calls).toEqual([]);
  });

  it("does its own arithmetic on the raw parameter nowhere", () => {
    const source = routeSource();
    // The route ASKS the shared guard…
    expect(source).toContain("pageBound(");
    // …and never coerces the parameter itself. `pageBound` owns every spelling
    // question, so a second reader here is a second answer to it.
    expect(source).not.toMatch(/parseInt|parseFloat|Number\(/);
  });
});

describe("full-or-exhausted, the route's half of the contract", () => {
  it("answers a FULL window that continues", async () => {
    const stub = database(script());

    const { status, body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    expect(status).toBe(200);
    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(view.window);
    expect(answer.exhausted).toBe(false);
    expect(answer.rows.map((row) => row.event_id)).toEqual(
      CATALOG.slice(view.window, view.window * 2).map((row) => row.event_id),
    );
    // The bound the REQUEST carried, echoed — never the read's own idea of it,
    // and never a number recomputed from `rows.length`.
    expect(answer.offset).toBe(view.window);
    expect(rangeOf(windowReads(stub)[0])[0]).toBe(answer.offset);
  });

  it("answers a SHORT page as exhausted, with the rows it really read", async () => {
    database(script());

    const { body } = await ask(`?${OFFSET_PARAM}=100`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    // 137 events: the page at 100 holds 37 of them.
    expect(answer.rows.length).toBe(DEPTH - 100);
    expect(answer.rows.length).toBeLessThan(view.window);
    expect(answer.exhausted).toBe(true);
    expect(answer.offset).toBe(100);
  });

  it("answers a page past the end with zero rows and calls the set exhausted", async () => {
    database(script());

    const { status, body } = await ask(`?${OFFSET_PARAM}=200`);
    const answer = accepted(body);

    expect(status).toBe(200);
    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows).toEqual([]);
    expect(answer.exhausted).toBe(true);
    expect(answer.offset).toBe(200);
  });

  it("never reports a row count the read did not return, at any bound on the grid", async () => {
    for (let offset = view.window; offset <= 200; offset += view.window) {
      const stub = database(script());
      const { body } = await ask(`?${OFFSET_PARAM}=${offset}`);
      const answer = accepted(body);
      if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);

      const [from, to] = rangeOf(windowReads(stub)[0]);
      const read = CATALOG.slice(from, to + 1);
      expect(answer.rows.length, `offset ${offset}`).toBe(read.length);
      // The biconditional itself, at every bound: exhausted IS the short page.
      expect(answer.exhausted, `offset ${offset}`).toBe(read.length < view.window);
      // Never longer than the window.
      expect(answer.rows.length).toBeLessThanOrEqual(view.window);
    }
  });

  /**
   * A leg that renders no row of its own may not decide the surface's state
   * (common violations row 14), and nothing removes a row between `.range()`
   * and the answer (§4.3). A page shortened in code would answer `exhausted`
   * with rows still behind it and end the operator's paging early.
   */
  it("answers a FULL continuing page when every leg returns nothing at all", async () => {
    const stub = database(
      script({
        [T.eventListings]: { data: [], count: 0 },
        [T.fieldProvenance]: { data: [], count: 0 },
        [T.sources]: { data: [], count: 0 },
      }),
    );

    const { body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(view.window);
    expect(answer.exhausted).toBe(false);
    expect(answer.rows.every((row) => row.venue_name === null)).toBe(true);
    expect(answer.rows.every((row) => row.sources.length === 0)).toBe(true);
    // The legs answered; they simply held no row for these ids.
    expect(answer.notes).toEqual({ venues: null, provenance: null });
    expect(rangeOf(windowReads(stub)[0])).toEqual([view.window, view.window * 2 - 1]);
  });

  it("answers a FULL continuing page when every row shares one venue and names no source", async () => {
    database(
      script({
        [T.eventListings]: (call: RecordedCall) => ({
          data: askedIds(call).map((id) =>
            eventListingRow({ event_id: id, venue_name: "The Forum" }),
          ),
          count: askedIds(call).length,
        }),
        [T.fieldProvenance]: { data: [], count: 0 },
      }),
    );

    const { body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(view.window);
    expect(answer.exhausted).toBe(false);
    expect(answer.rows.every((row) => row.venue_name === "The Forum")).toBe(true);
  });
});

describe("the legs travel with the answer or not at all", () => {
  it("carries a refused VENUE leg in the ok answer, rows and all", async () => {
    database(script({ [T.eventListings]: { error: permissionDenied(T.eventListings) } }));

    const { status, body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    expect(status).toBe(200);
    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(view.window);
    // The same object `StateOf` renders above the table on the first screen:
    // the leg's own arm, naming the object it was reading.
    expect(answer.notes.venues?.kind).toBe("error");
    expect(
      answer.notes.venues?.kind === "error" ? answer.notes.venues.reading : "",
    ).toBe(T.eventListings);
    expect(answer.notes.provenance).toBeNull();
    // And no service-role material travelled with it.
    expect(JSON.stringify(answer)).not.toMatch(/SUPABASE|service_role|supabase\.co/i);
  });

  it("carries a refused PROVENANCE leg rather than an empty Sources column", async () => {
    database(
      script({
        [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
      }),
    );

    const { body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(view.window);
    // Every row's Sources column is empty — and the answer says WHY, instead
    // of letting the client render it as "no sources behind this row".
    expect(answer.rows.every((row) => row.sources.length === 0)).toBe(true);
    expect(answer.notes.provenance).toEqual({
      kind: "not_provisioned",
      missing: T.fieldProvenance,
    });
  });

  it("carries both notes as null when both legs answered", async () => {
    database(script());

    const { body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.notes).toEqual({ venues: null, provenance: null });
    // The legs really did fill their columns, so "null" means answered and
    // not "never asked" (the fixture that must NOT flag — LESSONS 8).
    expect(answer.rows.every((row) => row.venue_name === "The Forum")).toBe(true);
    expect(answer.rows.every((row) => row.sources[0] === "ticketmaster")).toBe(true);
  });

  it("runs the legs over exactly THIS page's ids", async () => {
    const stub = database(script());

    await ask(`?${OFFSET_PARAM}=${view.window}`);

    const ids = CATALOG.slice(view.window, view.window * 2).map((row) => row.event_id);
    for (const table of [T.eventListings, T.fieldProvenance] as const) {
      const call = stub.calls.find((one) => one.table === table);
      expect(call, table).toBeDefined();
      expect(askedIds(call as RecordedCall), table).toEqual(ids);
    }
  });
});

describe("the refusals a read can carry", () => {
  it("answers a database with no events by NAMING it, not by erroring", async () => {
    database(script({ [T.events]: { error: tableNotInSchemaCache(T.events) } }));

    const { status, body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    // Absence is a normal answer: the PAGE decides what a not-provisioned
    // surface looks like, and by then no affordance is drawn at all (F10).
    expect(status).toBe(200);
    expect(answer).toEqual({ kind: "not_provisioned", missing: T.events });
  });

  it("carries the database's own message on a failed read", async () => {
    database(script({ [T.events]: { error: permissionDenied(T.events) } }));

    const { body } = await ask(`?${OFFSET_PARAM}=${view.window}`);
    const answer = accepted(body);

    if (answer.kind !== "error") throw new Error(`expected an error answer, got ${answer.kind}`);
    expect(answer.reading).toBe(T.events);
    // The database's own words, carried through unchanged — the data layer
    // appends the code it came with and summarises nothing (§4.1).
    expect(answer.message).toContain(permissionDenied(T.events).message);
    expect(answer.message).toContain("42501");
    // The database's words and nothing else: no client, no url, no key.
    expect(JSON.stringify(answer)).not.toMatch(/SUPABASE|service_role|supabase\.co/i);
  });
});

describe("the route owns the shape of what it serves", () => {
  const ARMS: Array<{ what: string; script: Script; query: string }> = [
    { what: "ok", script: script(), query: `?${OFFSET_PARAM}=50` },
    { what: "refused", script: script(), query: `?${OFFSET_PARAM}=abc` },
    {
      what: "not_provisioned",
      script: script({ [T.events]: { error: tableNotInSchemaCache(T.events) } }),
      query: `?${OFFSET_PARAM}=50`,
    },
    {
      what: "error",
      script: script({ [T.events]: { error: permissionDenied(T.events) } }),
      query: `?${OFFSET_PARAM}=50`,
    },
  ];

  it("is accepted by the client's own gate on all four arms", async () => {
    const seen: string[] = [];
    for (const arm of ARMS) {
      database(arm.script);
      const { body } = await ask(arm.query);
      const answer = accepted(body);
      expect(answer.kind, arm.what).toBe(arm.what);
      seen.push(answer.kind);
    }
    // Every arm the answer type has, driven — not three of four.
    expect(seen).toEqual(["ok", "refused", "not_provisioned", "error"]);
  });

  /**
   * A GATED ANSWER IS NEVER STORABLE. Every dynamically rendered page here
   * already answers these directives because Next sets them; a Route Handler
   * answers with NO `Cache-Control` unless it writes one, so without this the
   * first screen and its continuation would be one surface under two cache
   * policies (admin-window/TASK-0068).
   */
  it("says so itself on all four arms, from the one constant", async () => {
    for (const arm of ARMS) {
      database(arm.script);
      const { cacheControl } = await ask(arm.query);
      expect(cacheControl, arm.what).toBe(PAGE_ANSWER_CACHE_CONTROL);
    }
  });

  it("spells those directives nowhere but the shared constant", () => {
    // The value is `lib/paging/bounds.ts`' to own; a second string typed into
    // a route is how the two routes drift (LESSONS 5). Read over CODE lines
    // only — the docstring above the handler explains the directives and that
    // is documentation, not a second spelling.
    const code = codeText(ROUTE_FILE);
    expect(code).toContain("PAGE_ANSWER_CACHE_CONTROL");
    expect(code).not.toContain("no-store");
    expect(code).not.toContain("must-revalidate");
  });

  it("answers JSON", async () => {
    database(script());
    const response = await GET(request(`?${OFFSET_PARAM}=50`));
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("serves GET and nothing else", async () => {
    const route = await import("@/app/api/admin/browse/rows/route");
    expect(Object.keys(route)).toEqual(["GET"]);
  });
});

/**
 * BROWSE GAINS NO WIDTH HERE (SPEC F14, ARCHITECTURE.md §4.3 kind 3). Paging
 * lets the operator walk further down the view that exists: one curated view,
 * the same column selector, no second view, no table picker, no SQL runner and
 * no search box. `BROWSE_VIEWS` holding exactly one entry is
 * `tests/offline/browse/views.test.ts`' assertion; what is asserted HERE is
 * that no URL reaches a query through this route.
 */
describe("the route reads no view, table or column off the URL", () => {
  it("reads the same objects whatever the URL says about views and tables", async () => {
    const stub = database(script());

    await ask(
      `?view=all-events&table=venues&cols=secret_column&sort=starts_at&q=drop&${OFFSET_PARAM}=50`,
    );

    // The four objects Browse's own read names through `tables.ts`, and no
    // other — the URL named two tables and neither was read.
    expect(new Set(stub.tablesRead())).toEqual(
      new Set([T.events, T.eventListings, T.fieldProvenance, T.sources]),
    );
    const window = windowReads(stub)[0];
    // The view's own sort, not the URL's.
    expect(window.steps.filter((step) => step.method === "order")[0].args[0]).toBe(
      view.sort.field,
    );
    // Nothing narrowed the window: no facet of this URL reaches it.
    expect(window.steps.map((step) => step.method)).not.toContain("eq");
    expect(window.steps.map((step) => step.method)).not.toContain("ilike");
  });

  it("serves the same page whatever the URL says about columns", async () => {
    database(script());
    const plain = accepted((await ask(`?${OFFSET_PARAM}=50`)).body);
    database(script());
    const narrowed = accepted((await ask(`?cols=title&${OFFSET_PARAM}=50`)).body);

    // `cols` decides which columns RENDER and never which rows are READ
    // (admin-window/BUG-0114); the rows carry every column the view carries.
    expect(narrowed).toEqual(plain);
    if (narrowed.kind !== "ok") throw new Error("expected an ok page");
    expect(narrowed.rows[0].venue_name).not.toBeUndefined();
    expect(narrowed.rows[0].starts_at).not.toBeUndefined();
  });

  it("is unmoved by a `__proto__` key in the query", async () => {
    // The adapter's record has no prototype, so this is an own entry the route
    // never reads — and it is not a bound (admin-window/TASK-0068).
    const stub = database(script());

    const { status, body } = await ask(`?__proto__=x&${OFFSET_PARAM}=50`);
    const answer = accepted(body);

    expect(status).toBe(200);
    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.offset).toBe(50);
    expect(rangeOf(windowReads(stub)[0])).toEqual([50, 50 + view.window - 1]);
  });
});
