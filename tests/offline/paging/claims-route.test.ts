import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The claims paging route handler, driven directly — campaign
 * admin-window/TASK-0066.
 *
 * `GET /api/admin/claims/rows` is the second read route in the app and the
 * first that serves rows, so what is asserted here is the whole of what it
 * PROMISES the client (ARCHITECTURE.md §4.3 read kind 3):
 *
 *  - the GATE runs first and a refused gate issues NO read;
 *  - the WINDOW reaches nothing but `windowBound`, and a refused window
 *    reaches no read at all — the recorder stays empty over the whole refusal
 *    table, while the windows the serving table names ARE served, so the
 *    table cannot pass by refusing everything;
 *  - full-or-exhausted, on both edges: a read of `SIZE` rows answers
 *    `exhausted: false`, a read of fewer — zero included — answers `true`, and
 *    the row count served is the row count read;
 *  - the facets are the PAGE's own derivation of the same URL;
 *  - every body the handler emits is one `isPageAnswer` accepts, so the answer
 *    this app serves is one its own client can read.
 *
 * The seam is `getDbClient()` (`src/lib/db/client.ts`) — the ONE place the app
 * resolves a database client (ARCHITECTURE.md §4 rule 3) — so the real
 * `readClaimWindow` and the real `readSourceNames` run against a RECORDING
 * stub, and "no read was issued" is observable as "the stub recorded nothing"
 * rather than as "a module mock was not called". The gate is stubbed because
 * the adversary's premise is a caller who IS an allowlisted admin; it is
 * stubbed CLOSED in its own test to prove the order of the two.
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

const { GET } = await import("@/app/api/admin/claims/rows/route");
// The FIRST screen, driven through the same stubbed client as the route, so
// the seam between them is observable in one test (QA, admin-window/TASK-0066).
const ClaimsPage = (await import("@/app/claims/page")).default;

import { claimLines, type ClaimLine } from "@/lib/claims/lines";
import { T } from "@/lib/db/tables";
import {
  DEFAULT_WINDOW_SIZE,
  PAGE_ANSWER_CACHE_CONTROL,
  PAGE_PARAM,
  PAGE_ROUTES,
  SIZE_PARAM,
  WINDOW_SIZES,
  largestPage,
  isPageAnswer,
  type PageAnswer,
} from "@/lib/paging/bounds";
import { sourceNamesOf } from "@/lib/sources/names";
import { pendingClaimRow, type PendingClaimRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type RecordedCall,
  type Script,
  type ScriptedResponse,
  type StubClient,
} from "../../fixtures/stub-client";
import { REGISTRY, SOURCE, claimView } from "../claims/population";
import { render } from "../ui/markup";

/** The window size every query below that names none pages by. */
const SIZE = DEFAULT_WINDOW_SIZE;

/** The admin the stubbed gate hands the handler. Not a real address. */
const ADMIN = { user: { email: "paging-suite@example.invalid" } };

/**
 * A population deep enough to page through, and DELIBERATELY not a multiple of
 * the window: 149 claims make offset 50 a FULL page that continues and offset
 * 100 a SHORT one that ends the set, so both edges of the biconditional are
 * driven against one fixture (admin-window/BUG-0168's ruling).
 *
 * Two of the three sources are in the registry and the third is not, exactly
 * as `tests/offline/claims/population.ts` arranges it — so the label fallback
 * and the label lookup are both exercised by any page of this set.
 */
const DEPTH = 149;
const SOURCE_RING = [SOURCE.first, SOURCE.second, SOURCE.third] as const;

const POPULATION: readonly PendingClaimRow[] = Array.from({ length: DEPTH }, (_, index) =>
  pendingClaimRow("standing_disagreement", {
    observation_id: `01920000-0000-7000-8000-${(500000 + index).toString().padStart(12, "0")}`,
    source_id: SOURCE_RING[index % SOURCE_RING.length],
    domain: index % 2 === 0 ? "events" : "venues",
    // One instant per claim, STRICTLY ascending, so the read's own order
    // (`observed_at asc`, the id breaking ties) is this array's order and the
    // slice at each offset is a plain `slice` of the fixture. The ordering
    // itself is `tests/offline/claims/read.test.ts`' subject, not this file's.
    observed_at: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
  }),
);

/** The registry read `readSourceNames` makes: the rows whose ids were asked for. */
function registryAnswer(call: RecordedCall): ScriptedResponse {
  const asked = call.steps.find((step) => step.method === "in")?.args[1] as string[] | undefined;
  const wanted = new Set(asked ?? []);
  return { data: REGISTRY.filter((row) => wanted.has(row.source_id)) };
}

function script(claims: readonly PendingClaimRow[] = POPULATION): Script {
  return { [T.pendingClaims]: claimView(claims), [T.sources]: registryAnswer };
}

/** Script the database the next request reads, and keep the recorder. */
function database(scripted: Script): StubClient {
  const stub = stubClient(scripted);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

/** The request one press makes: the route's own path, its facets, its bound. */
function request(query: string): Request {
  return new Request(`http://admin.invalid${PAGE_ROUTES.claims}${query}`);
}

/** Every read of the claims view this request issued, with the chain each built. */
function windowReads(stub: StubClient): RecordedCall[] {
  return stub.calls.filter((call) => call.table === T.pendingClaims);
}

/** The `.range(from, to)` a window read carried. */
function rangeOf(call: RecordedCall): [number, number] {
  const step = call.steps.find((one) => one.method === "range");
  expect(step, "the window read carried no range").toBeDefined();
  return (step as { args: unknown[] }).args as [number, number];
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
function accepted(body: unknown): PageAnswer<ClaimLine> {
  expect(isPageAnswer(body), `the client's own gate rejects ${JSON.stringify(body)}`).toBe(true);
  return body as PageAnswer<ClaimLine>;
}

/** The rows the first screen would shape out of this slice of the population. */
function expectedLines(from: number, to: number): ClaimLine[] {
  const rows = POPULATION.slice(from, to);
  const names = sourceNamesOf(
    REGISTRY.filter((row) => rows.some((claim) => claim.source_id === row.source_id)),
  );
  return claimLines(rows, names);
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

    const response = await GET(request(`?${PAGE_PARAM}=2`));

    expect(response.status).toBe(403);
    expect(gate.calls).toBe(1);
    // Not a row, not a count, not a registry lookup: nothing below the gate ran.
    expect(stub.calls).toEqual([]);
  });

  it("asks the gate before it reads the bound, so a stranger never learns the bound's verdict", async () => {
    const stub = database(script());
    gate.answer = { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };

    // A bound the handler would refuse 400 if it ever looked at it.
    const response = await GET(request(`?${PAGE_PARAM}=abc`));

    expect(response.status).toBe(401);
    expect(stub.calls).toEqual([]);
  });
});

/**
 * The refusal table — campaign admin-window/TASK-0066's central claim, and the
 * measured failure it exists to stop (QA, admin-window/TASK-0065 close): a
 * hand-rolled numeric coercion of `"abc"` is `NaN`, staging answers
 * `.range(NaN, NaN)` with an ok page of ZERO rows, and a zero-row ok page is
 * EXHAUSTION — so a malformed URL would render to the operator as a set that
 * has ended rather than as a refusal.
 *
 * Every entry is asserted four ways: HTTP 400, a `refused` answer naming the
 * reason and the bound AS SENT, the gated cache directives, and a recorder
 * that stayed EMPTY.
 */
const REFUSED: ReadonlyArray<readonly [string, string, string, string]> = [
  ["an empty page", `?${PAGE_PARAM}=`, PAGE_PARAM, ""],
  ["a page that is a word", `?${PAGE_PARAM}=abc`, PAGE_PARAM, "abc"],
  ["a page with a leading space", `?${PAGE_PARAM}=%202`, PAGE_PARAM, " 2"],
  ["a page with an explicit sign", `?${PAGE_PARAM}=%2B2`, PAGE_PARAM, "+2"],
  ["a page with a leading zero", `?${PAGE_PARAM}=02`, PAGE_PARAM, "02"],
  ["a page with a decimal point", `?${PAGE_PARAM}=2.0`, PAGE_PARAM, "2.0"],
  ["a page with an exponent", `?${PAGE_PARAM}=1e1`, PAGE_PARAM, "1e1"],
  ["a negative page", `?${PAGE_PARAM}=-1`, PAGE_PARAM, "-1"],
  ["page zero", `?${PAGE_PARAM}=0`, PAGE_PARAM, "0"],
  ["an empty size", `?${SIZE_PARAM}=`, SIZE_PARAM, ""],
  ["a size this app does not offer", `?${SIZE_PARAM}=30`, SIZE_PARAM, "30"],
  ["a size that is a word", `?${SIZE_PARAM}=fifty`, SIZE_PARAM, "fifty"],
  [
    "a page past the ceiling",
    `?${PAGE_PARAM}=${largestPage(SIZE) + 1}`,
    PAGE_PARAM,
    String(largestPage(SIZE) + 1),
  ],
];

describe("the window reaches nothing but windowBound", () => {
  it.each(REFUSED)("refuses %s with 400, naming it, and reads nothing", async (_what, query, param, sent) => {
    const stub = database(script());

    const { status, body, cacheControl } = await ask(query);
    const answer = accepted(body);

    expect(status).toBe(400);
    expect(answer.kind).toBe("refused");
    if (answer.kind !== "refused") return;
    // The parameter by NAME and its value AS SENT — never a trimmed, repaired
    // or clamped spelling of it.
    expect(answer.param).toBe(param);
    expect(answer.bound).toBe(sent);
    expect(answer.reason.length).toBeGreaterThan(0);
    expect(cacheControl).toBe(PAGE_ANSWER_CACHE_CONTROL);
    // The whole point: no query of any object was even built.
    expect(stub.calls, `${sent} reached a read`).toEqual([]);
  });

  it("serves the windows the address names — the first by default, and each size at its own offset", async () => {
    // So the table above cannot pass by refusing everything, and so the one
    // guard both pages and both routes share is driven here on its serving
    // arm: no parameters is window 1 at the default size, and page 3 at 20
    // is rows 41–60.
    for (const [query, from, size] of [
      ["", 0, SIZE],
      [`?${PAGE_PARAM}=2`, SIZE, SIZE],
      [`?${PAGE_PARAM}=3&${SIZE_PARAM}=20`, 40, 20],
      [`?${SIZE_PARAM}=100`, 0, 100],
    ] as const) {
      const stub = database(script());
      const { status, body } = await ask(query);
      const answer = accepted(body);
      expect(status, query).toBe(200);
      if (answer.kind !== "ok") throw new Error(`${query}: expected an ok window, got ${answer.kind}`);
      expect(windowReads(stub).length, query).toBe(1);
      expect(rangeOf(windowReads(stub)[0]), query).toEqual([from, from + size - 1]);
      expect(answer.size, query).toBe(size);
      expect(answer.page, query).toBe(from / size + 1);
    }
  });
});

describe("full-or-exhausted, the route's half of the contract", () => {
  it("answers a FULL window that continues", async () => {
    const stub = database(script());

    const { status, body } = await ask(`?${PAGE_PARAM}=2`);
    const answer = accepted(body);

    expect(status).toBe(200);
    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(SIZE);
    expect(answer.exhausted).toBe(false);
    // The rows the READ returned, shaped as the first screen shapes its own.
    expect(answer.rows).toEqual(expectedLines(50, 100));
    // The window the REQUEST named, echoed — never the read's own idea of it.
    expect(answer.page).toBe(2);
    expect(answer.size).toBe(SIZE);
    expect(rangeOf(windowReads(stub)[0])[0]).toBe((answer.page - 1) * answer.size);
  });

  it("never reports a row count the read did not return, at any window of any size", async () => {
    for (const size of WINDOW_SIZES) {
      for (let page = 1; (page - 1) * size <= 200; page += 1) {
        const stub = database(script());
        const { body } = await ask(`?${PAGE_PARAM}=${page}&${SIZE_PARAM}=${size}`);
        const answer = accepted(body);
        if (answer.kind !== "ok") throw new Error(`expected an ok window, got ${answer.kind}`);

        const [from, to] = rangeOf(windowReads(stub)[0]);
        const read = POPULATION.slice(from, to + 1);
        const where = `page ${page} at ${size}`;
        expect(from, where).toBe((page - 1) * size);
        expect(answer.rows.length, where).toBe(read.length);
        // The biconditional itself, at every window: exhausted IS the short one.
        expect(answer.exhausted, where).toBe(read.length < size);
        expect(answer.rows.length, where).toBeLessThanOrEqual(size);
      }
    }
  });
});

describe("the refusals a read can carry", () => {
  it("answers a database with no pending_claims by NAMING it, not by erroring", async () => {
    database({
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
      [T.sources]: registryAnswer,
    });

    const { status, body } = await ask(`?${PAGE_PARAM}=2`);
    const answer = accepted(body);

    // Absence is a normal answer: the PAGE decides what a not-provisioned
    // surface looks like, and by then no affordance is drawn at all.
    expect(status).toBe(200);
    expect(answer).toEqual({ kind: "not_provisioned", missing: T.pendingClaims });
  });

  it("carries the database's own message on a failed read", async () => {
    database({
      [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
      [T.sources]: registryAnswer,
    });

    const { body } = await ask(`?${PAGE_PARAM}=2`);
    const answer = accepted(body);

    if (answer.kind !== "error") throw new Error(`expected an error answer, got ${answer.kind}`);
    expect(answer.reading).toBe(T.pendingClaims);
    // The database's own words, carried through unchanged — the data layer
    // appends the code it came with and summarises nothing (§4.1).
    expect(answer.message).toContain(permissionDenied(T.pendingClaims).message);
    expect(answer.message).toContain("42501");
    // The database's words and nothing else: no client, no url, no key.
    expect(JSON.stringify(answer)).not.toMatch(/SUPABASE|service_role|supabase\.co/i);
  });

  it("serves the rows when the REGISTRY refuses, naming each source by its id", async () => {
    database({
      [T.pendingClaims]: claimView(POPULATION),
      [T.sources]: { error: permissionDenied(T.sources) },
    });

    const { body } = await ask(`?${PAGE_PARAM}=2`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(SIZE);
    // `sourceLabel`'s own rule: an id the registry names nothing for stays on
    // screen verbatim — the id is then the only true thing the app can say.
    for (const row of answer.rows) expect(row.source).toBe(row.sourceId);
  });
});

describe("the facets are the page's own", () => {
  /** The `.eq(column, value)` pairs one read carried. */
  function equalities(call: RecordedCall): Array<[string, unknown]> {
    return call.steps
      .filter((step) => step.method === "eq")
      .map((step) => [String(step.args[0]), step.args[1]] as [string, unknown]);
  }

  it("passes the URL's narrowing through to the read", async () => {
    const stub = database(script());

    await ask(`?domain=venues&source_id=${SOURCE.second}&${PAGE_PARAM}=2`);

    const asked = equalities(windowReads(stub)[0]);
    expect(asked).toContainEqual(["domain", "venues"]);
    expect(asked).toContainEqual(["source_id", SOURCE.second]);
  });

  it("narrows by nothing for a value the page's own vocabulary refuses", async () => {
    const stub = database(script());

    // The parked bucket is not a renderable one, so it narrows NOTHING here
    // exactly as it narrows nothing on the page (ARCHITECTURE.md §6 trap 4).
    await ask(`?bucket=in_window&${PAGE_PARAM}=2`);

    expect(equalities(windowReads(stub)[0]).map(([column]) => column)).not.toContain("bucket");
  });

  it("parses no facet of its own anywhere under src/app/api", () => {
    const apiDir = path.join(import.meta.dirname, "..", "..", "..", "src/app/api");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(apiDir);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      // The facet names are `lib/claims/filters.ts`' to read off a URL. A route
      // asking the query string for one itself is the second parse this rule
      // forbids (common violations row 20).
      expect(text, `${file} reads a facet off the query string`).not.toMatch(
        /searchParams\.get\(\s*['"](?:bucket|source_id|domain|tab)['"]/,
      );
    }
  });
});

describe("the route owns the shape of what it serves", () => {
  const ARMS: Array<{ what: string; script: Script; query: string }> = [
    { what: "ok", script: script(), query: `?${PAGE_PARAM}=2` },
    { what: "refused", script: script(), query: `?${PAGE_PARAM}=abc` },
    {
      what: "not_provisioned",
      script: {
        [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
        [T.sources]: registryAnswer,
      },
      query: `?${PAGE_PARAM}=2`,
    },
    {
      what: "error",
      script: {
        [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
        [T.sources]: registryAnswer,
      },
      query: `?${PAGE_PARAM}=2`,
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
   * already answers these directives because Next sets them on the response;
   * a Route Handler answers with NO `Cache-Control` unless it writes one, so
   * without this `/claims` and its own continuation would be one surface under
   * two cache policies (admin-window/BUG-0171, measured off the wire by QA:
   * every arm of this route answered with no `Cache-Control` at all while the
   * browse route on the same server carried the directives).
   */
  it("says so itself on all four arms, from the one constant", async () => {
    for (const arm of ARMS) {
      database(arm.script);
      const { cacheControl } = await ask(arm.query);
      expect(cacheControl, arm.what).toBe(PAGE_ANSWER_CACHE_CONTROL);
    }
  });

  it("answers JSON", async () => {
    database(script());
    const response = await GET(request(`?${PAGE_PARAM}=2`));
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("serves GET and nothing else", async () => {
    const route = await import("@/app/api/admin/claims/rows/route");
    expect(Object.keys(route)).toEqual(["GET"]);
  });
});

/**
 * THE FIRST SCREEN AND ITS CONTINUATION ARE ONE SET — QA's attack on
 * admin-window/TASK-0066, and the property the shared derivation exists for.
 *
 * Everything above drives the route ALONE, so it cannot see the defect this
 * feature is most exposed to: a paged row set that belongs to a different
 * narrowing, or a different order, than the rows already on the screen — rows
 * repeated or skipped at the boundary, which no assertion about one surface
 * can catch (ARCHITECTURE.md common violations row 20; LESSONS 5). So here the
 * PAGE function and the ROUTE are driven against ONE stubbed database, and the
 * ids the screen rendered are compared with the ids the press appended.
 *
 * The population is deliberately MIXED — two buckets, two domains, three
 * sources, strictly ascending instants — so the standing tab's subset, a
 * domain facet and the unnarrowed set are three different row sets, and the
 * last case is the CONTROL: two different narrowings really do serve different
 * rows, so the equalities above cannot pass by comparing a set with itself.
 */
const MIXED: readonly PendingClaimRow[] = Array.from({ length: 130 }, (_, index) =>
  pendingClaimRow(index % 2 === 0 ? "standing_disagreement" : "agreeing", {
    observation_id: `01920000-0000-7000-8000-${(700000 + index).toString().padStart(12, "0")}`,
    source_id: SOURCE_RING[index % SOURCE_RING.length],
    domain: index % 4 < 2 ? "events" : "venues",
    observed_at: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
  }),
);

/** The whole page's database: the view, the registry, and the instants leg. */
function mixedScript(): Script {
  return {
    [T.pendingClaims]: claimView(MIXED),
    [T.observations]: { data: [] },
    [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
  };
}

/** The claim ids the FIRST SCREEN rendered, in rendered order. */
async function firstScreenIds(params: Record<string, string>): Promise<string[]> {
  database(mixedScript());
  const markup = render(await ClaimsPage({ searchParams: Promise.resolve(params) }));
  const $ = cheerio.load(markup);
  return $("[data-claim]")
    .toArray()
    .map((element) => $(element).attr("data-claim") ?? "");
}

/** The ids ONE press appended, against the same database at the same bound. */
async function pagedIds(query: string): Promise<{ ids: string[]; exhausted: boolean }> {
  database(mixedScript());
  const { body } = await ask(query);
  const answer = accepted(body);
  if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
  return { ids: answer.rows.map((row) => row.observationId), exhausted: answer.exhausted };
}

/** The population's own ids, in the read's order, under this file's predicate. */
function idsWhere(keep: (row: PendingClaimRow) => boolean): string[] {
  return MIXED.filter(keep).map((row) => row.observation_id);
}

describe("the server screen and the route's window are one set", () => {
  it("answers, for an address, exactly the window the page server-renders for it", async () => {
    // SPEC F14 under page windows (design question 3): a cold load of
    // `/claims?page=2&size=20` and a move to that window must draw the same
    // rows, because they are the same bounded read of the same order.
    for (const [page, size] of [
      [2, 20],
      [3, 50],
      [1, 100],
    ] as const) {
      const screen = await firstScreenIds({ [PAGE_PARAM]: String(page), [SIZE_PARAM]: String(size) });
      const { ids } = await pagedIds(`?${PAGE_PARAM}=${page}&${SIZE_PARAM}=${size}`);
      expect(screen, `page ${page} at ${size}`).toEqual(ids);
      expect(screen, `page ${page} at ${size}`).toEqual(
        idsWhere(() => true).slice((page - 1) * size, page * size),
      );
    }
  });

  it("draws every id exactly once across all windows, at each of the three sizes", async () => {
    // THE WINDOW INVARIANT, pinned offline over a fixture this file owns
    // (README "Testing", rules 1 and 3): walking page 1, 2, … until the route
    // says the set ended yields the population — every id once, in order, no
    // duplicate at any seam and no skip. On staging this is what the browser
    // walk counts (877 claims, 120 events), and that walk is a read.
    for (const size of WINDOW_SIZES) {
      const drawn: string[] = [];
      let page = 1;
      let exhausted = false;
      while (!exhausted) {
        const window = await pagedIds(`?${PAGE_PARAM}=${page}&${SIZE_PARAM}=${size}`);
        drawn.push(...window.ids);
        exhausted = window.exhausted;
        page += 1;
        if (page > 20) throw new Error(`the walk at ${size} never ended`);
      }
      expect(new Set(drawn).size, `size ${size}`).toBe(drawn.length);
      expect(drawn, `size ${size}`).toEqual(idsWhere(() => true));
      // The walk really took more than one window at every size.
      expect(page - 1, `size ${size}`).toBe(Math.ceil(MIXED.length / size));
    }
  });

  it("reads the standing TAB's subset on both surfaces, bucket facet and all", async () => {
    // The tab IS a bucket, so `listFilterOf` drops the URL's own bucket on it.
    // A route that kept `bucket=agreeing` would serve rows from a bucket the
    // page is not showing — one list, two narrowings.
    const params = { tab: "standing", bucket: "agreeing" };
    const screen = await firstScreenIds(params);
    const { ids, exhausted } = await pagedIds(`?tab=standing&bucket=agreeing&${PAGE_PARAM}=2`);
    const standing = idsWhere((row) => row.bucket === "standing_disagreement");

    expect(screen).toEqual(standing.slice(0, SIZE));
    expect([...screen, ...ids]).toEqual(standing);
    // The set ended inside this window, and the window says so.
    expect(exhausted).toBe(true);
  });

  it("keeps a control-less facet across windows", async () => {
    const screen = await firstScreenIds({ domain: "venues" });
    const { ids } = await pagedIds(`?domain=venues&${PAGE_PARAM}=2`);

    expect([...screen, ...ids]).toEqual(idsWhere((row) => row.domain === "venues"));
  });
});
