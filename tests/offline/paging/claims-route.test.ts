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
 *  - the BOUND reaches nothing but `pageBound`, and a refused bound reaches no
 *    read at all — the recorder stays empty over the whole refusal table,
 *    while the one canonical bound in that same table IS served, so the table
 *    cannot pass by refusing everything;
 *  - full-or-exhausted, on both edges: a read of `CLAIM_WINDOW` rows answers
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

import { CLAIM_WINDOW } from "@/components/claims";
import { claimLines, type ClaimLine } from "@/lib/claims/lines";
import { T } from "@/lib/db/tables";
import {
  MAX_PAGE_OFFSET,
  OFFSET_PARAM,
  PAGE_ROUTES,
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
import { REGISTRY, SOURCE, SOURCE_NAME, claimView } from "../claims/population";
import { render } from "../ui/markup";

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
async function ask(query: string): Promise<{ status: number; body: unknown }> {
  const response = await GET(request(query));
  return { status: response.status, body: await response.json() };
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

    const response = await GET(request(`?${OFFSET_PARAM}=50`));

    expect(response.status).toBe(403);
    expect(gate.calls).toBe(1);
    // Not a row, not a count, not a registry lookup: nothing below the gate ran.
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
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "..", "..", "src/app/api/admin/claims/rows/route.ts"),
      "utf8",
    );
    const body = source.slice(source.indexOf("export async function GET"));
    const firstStatement = body.slice(body.indexOf("{") + 1).trim().split("\n")[0];
    expect(firstStatement).toMatch(/requireAdmin\(\)/);
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
 * Every entry is asserted three ways: HTTP 400, a `refused` answer naming the
 * reason and the bound AS SENT, and a recorder that stayed EMPTY.
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
  ["a bound past the ceiling", `?${OFFSET_PARAM}=${MAX_PAGE_OFFSET + CLAIM_WINDOW}`, String(MAX_PAGE_OFFSET + CLAIM_WINDOW)],
];

describe("the bound reaches nothing but pageBound", () => {
  it.each(REFUSED)("refuses %s with 400, naming it, and reads nothing", async (_what, query, sent) => {
    const stub = database(script());

    const { status, body } = await ask(query);
    const answer = accepted(body);

    expect(status).toBe(400);
    expect(answer.kind).toBe("refused");
    if (answer.kind !== "refused") return;
    // The bound AS SENT — never a trimmed, repaired or clamped spelling of it.
    expect(answer.bound).toBe(sent);
    expect(answer.reason.length).toBeGreaterThan(0);
    // The whole point: no query of any object was even built.
    expect(stub.calls, `${sent} reached a read`).toEqual([]);
  });

  it("serves the one canonical bound in that same table, so the table cannot pass by refusing everything", async () => {
    const stub = database(script());

    const { status, body } = await ask(`?${OFFSET_PARAM}=50`);
    const answer = accepted(body);

    expect(status).toBe(200);
    expect(answer.kind).toBe("ok");
    // Exactly ONE read of the view, and it is the window the bound named.
    expect(windowReads(stub).length).toBe(1);
    expect(rangeOf(windowReads(stub)[0])).toEqual([50, 50 + CLAIM_WINDOW - 1]);
  });

  it("does its own arithmetic on the raw parameter nowhere", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "..", "..", "src/app/api/admin/claims/rows/route.ts"),
      "utf8",
    );
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

    const { status, body } = await ask(`?${OFFSET_PARAM}=50`);
    const answer = accepted(body);

    expect(status).toBe(200);
    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(CLAIM_WINDOW);
    expect(answer.exhausted).toBe(false);
    // The rows the READ returned, shaped as the first screen shapes its own.
    expect(answer.rows).toEqual(expectedLines(50, 100));
    // The bound the REQUEST carried, echoed — never the read's own idea of it.
    expect(answer.offset).toBe(50);
    expect(rangeOf(windowReads(stub)[0])[0]).toBe(answer.offset);
  });

  it("answers a SHORT page as exhausted, with the rows it really read", async () => {
    database(script());

    const { body } = await ask(`?${OFFSET_PARAM}=100`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    // 149 claims: the page at 100 holds 49 of them.
    expect(answer.rows.length).toBe(DEPTH - 100);
    expect(answer.rows.length).toBeLessThan(CLAIM_WINDOW);
    expect(answer.exhausted).toBe(true);
    expect(answer.rows).toEqual(expectedLines(100, DEPTH));
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

  it("never reports a row count the read did not return, at any offset on the grid", async () => {
    for (let offset = CLAIM_WINDOW; offset <= 200; offset += CLAIM_WINDOW) {
      const stub = database(script());
      const { body } = await ask(`?${OFFSET_PARAM}=${offset}`);
      const answer = accepted(body);
      if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);

      const [from, to] = rangeOf(windowReads(stub)[0]);
      const read = POPULATION.slice(from, to + 1);
      expect(answer.rows.length, `offset ${offset}`).toBe(read.length);
      // The biconditional itself, at every bound: exhausted IS the short page.
      expect(answer.exhausted, `offset ${offset}`).toBe(read.length < CLAIM_WINDOW);
      // Never longer than the window: the read asks for one window and the
      // answer carries what it got.
      expect(answer.rows.length).toBeLessThanOrEqual(CLAIM_WINDOW);
    }
  });
});

describe("the refusals a read can carry", () => {
  it("answers a database with no pending_claims by NAMING it, not by erroring", async () => {
    database({
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
      [T.sources]: registryAnswer,
    });

    const { status, body } = await ask(`?${OFFSET_PARAM}=50`);
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

    const { body } = await ask(`?${OFFSET_PARAM}=50`);
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

    const { body } = await ask(`?${OFFSET_PARAM}=50`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    expect(answer.rows.length).toBe(CLAIM_WINDOW);
    // `sourceLabel`'s own rule: an id the registry names nothing for stays on
    // screen verbatim — the id is then the only true thing the app can say.
    for (const row of answer.rows) expect(row.source).toBe(row.sourceId);
  });

  it("names a registered source and leaves an unregistered one as its id", async () => {
    database(script());

    const { body } = await ask(`?${OFFSET_PARAM}=50`);
    const answer = accepted(body);

    if (answer.kind !== "ok") throw new Error(`expected an ok page, got ${answer.kind}`);
    const named = answer.rows.filter((row) => row.sourceId === SOURCE.first);
    const unnamed = answer.rows.filter((row) => row.sourceId === SOURCE.third);
    expect(named.length).toBeGreaterThan(0);
    expect(unnamed.length).toBeGreaterThan(0);
    for (const row of named) expect(row.source).toBe(SOURCE_NAME.get(SOURCE.first));
    for (const row of unnamed) expect(row.source).toBe(SOURCE.third);
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

    await ask(`?domain=venues&source_id=${SOURCE.second}&${OFFSET_PARAM}=50`);

    const asked = equalities(windowReads(stub)[0]);
    expect(asked).toContainEqual(["domain", "venues"]);
    expect(asked).toContainEqual(["source_id", SOURCE.second]);
  });

  it("reads the standing TAB as the bucket it is", async () => {
    const stub = database(script());

    await ask(`?tab=standing&${OFFSET_PARAM}=50`);

    expect(equalities(windowReads(stub)[0])).toContainEqual([
      "bucket",
      "standing_disagreement",
    ]);
  });

  it("narrows by nothing for a value the page's own vocabulary refuses", async () => {
    const stub = database(script());

    // The parked bucket is not a renderable one, so it narrows NOTHING here
    // exactly as it narrows nothing on the page (ARCHITECTURE.md §6 trap 4).
    await ask(`?bucket=in_window&${OFFSET_PARAM}=50`);

    expect(equalities(windowReads(stub)[0]).map(([column]) => column)).not.toContain("bucket");
  });

  it("takes the FIRST value of a repeated facet, as the page does", async () => {
    const stub = database(script());

    await ask(`?domain=events&domain=venues&${OFFSET_PARAM}=50`);

    expect(equalities(windowReads(stub)[0])).toContainEqual(["domain", "events"]);
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
  it("is accepted by the client's own gate on all four arms", async () => {
    const arms: Array<{ what: string; script: Script; query: string }> = [
      { what: "ok", script: script(), query: `?${OFFSET_PARAM}=50` },
      { what: "refused", script: script(), query: `?${OFFSET_PARAM}=abc` },
      {
        what: "not_provisioned",
        script: {
          [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
          [T.sources]: registryAnswer,
        },
        query: `?${OFFSET_PARAM}=50`,
      },
      {
        what: "error",
        script: {
          [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
          [T.sources]: registryAnswer,
        },
        query: `?${OFFSET_PARAM}=50`,
      },
    ];

    const seen: string[] = [];
    for (const arm of arms) {
      database(arm.script);
      const { body } = await ask(arm.query);
      const answer = accepted(body);
      expect(answer.kind, arm.what).toBe(arm.what);
      seen.push(answer.kind);
    }
    // Every arm the answer type has, driven — not three of four.
    expect(seen).toEqual(["ok", "refused", "not_provisioned", "error"]);
  });

  it("answers JSON", async () => {
    database(script());
    const response = await GET(request(`?${OFFSET_PARAM}=50`));
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

describe("the first screen and its continuation are one set", () => {
  it("continues where the screen ended: no row repeated, none skipped", async () => {
    const screen = await firstScreenIds({});
    const { ids } = await pagedIds(`?${OFFSET_PARAM}=${CLAIM_WINDOW}`);

    expect(screen.length).toBe(CLAIM_WINDOW);
    // Disjoint — a repeated row is the defect an off-grid bound would cause.
    expect(new Set([...screen, ...ids]).size).toBe(screen.length + ids.length);
    // And contiguous in the read's own order — no row fell between them.
    expect([...screen, ...ids]).toEqual(idsWhere(() => true).slice(0, screen.length + ids.length));
  });

  it("reads the standing TAB's subset on both surfaces, bucket facet and all", async () => {
    // The tab IS a bucket, so `listFilterOf` drops the URL's own bucket on it.
    // A route that kept `bucket=agreeing` would append rows from a bucket the
    // screen above is not showing — one list, two narrowings.
    const params = { tab: "standing", bucket: "agreeing" };
    const screen = await firstScreenIds(params);
    const { ids, exhausted } = await pagedIds(
      `?tab=standing&bucket=agreeing&${OFFSET_PARAM}=${CLAIM_WINDOW}`,
    );
    const standing = idsWhere((row) => row.bucket === "standing_disagreement");

    expect(screen).toEqual(standing.slice(0, CLAIM_WINDOW));
    expect([...screen, ...ids]).toEqual(standing);
    // The set ended inside this page, and the page says so.
    expect(exhausted).toBe(true);
  });

  it("keeps a control-less facet across the boundary", async () => {
    const screen = await firstScreenIds({ domain: "venues" });
    const { ids } = await pagedIds(`?domain=venues&${OFFSET_PARAM}=${CLAIM_WINDOW}`);

    expect([...screen, ...ids]).toEqual(idsWhere((row) => row.domain === "venues"));
  });

  it("really does serve different rows for a different narrowing (the control)", async () => {
    const venues = await pagedIds(`?domain=venues&${OFFSET_PARAM}=${CLAIM_WINDOW}`);
    const events = await pagedIds(`?domain=events&${OFFSET_PARAM}=${CLAIM_WINDOW}`);

    expect(venues.ids).not.toEqual(events.ids);
  });
});
