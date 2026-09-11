import { describe, expect, it } from "vitest";
import {
  PENDING_CLAIM_BUCKETS,
  RENDERABLE_BUCKETS,
  UNRENDERABLE_BUCKET,
  isRenderableBucket,
  readBucketOldest,
  readClaimCount,
  readClaimWindow,
  readPendingClaimRows,
  selectClaims,
  type ClaimRow,
} from "@/lib/db/claims";
import { T } from "@/lib/db/tables";
import { claimLines } from "@/lib/claims/lines";
import { CLAIMS, OBSERVED_AT, SOURCE, SOURCE_NAME, claimView } from "./population";
import { pendingClaimRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
  type StubClient,
} from "../../fixtures/stub-client";
import { codeText, sourceFiles } from "../source-tree";

/**
 * `src/lib/db/claims.ts` — the classification view's one reader (campaign
 * admin-window/TASK-0012, rebuilt by admin-window/BUG-0138).
 *
 * What is asserted here rather than through the page: the reads are a WINDOW
 * and a set of head COUNTS (ARCHITECTURE.md §4.3) rather than a transport of
 * the population; the parked bucket is excluded in every query AND in the
 * predicate, so the returned set is decided by one rule whether or not the
 * server narrowed (§6 trap 4); the order is the DATABASE's; and every failure
 * arrives as a `DbResult` naming the object it was reading.
 *
 * The database these read is `claimView` (`./population.ts`) — a fixture that
 * answers the query it was asked. Nothing here asks `lib/db/claims.ts` what to
 * expect: every expectation is computed from `CLAIMS` with this file's own
 * predicates.
 */

/** The parked bucket, spelled here so this file states what it is testing. */
const PARKED = "in_" + "window";

function scripted(script: Script): StubClient {
  return stubClient(script);
}

/** A database holding the whole fixture population, `in_window` included. */
function wholeView(): Script {
  return { [T.pendingClaims]: claimView(CLAIMS) };
}

/** Every step one query recorded, by method name. */
function stepsOf(stub: StubClient, table: string, nth = 0) {
  const call = stub.calls.filter((c) => c.table === table)[nth];
  expect(call, `${table} was not queried`).toBeDefined();
  return call.steps;
}

function argsOf(stub: StubClient, table: string, method: string, nth = 0) {
  return stepsOf(stub, table, nth)
    .filter((step) => step.method === method)
    .map((step) => step.args);
}

/** Every claim the UI may show, under this file's own reading of the fixture. */
const SHOWABLE = CLAIMS.filter((claim) => claim.bucket !== PARKED);

/** The instant a claim carries, as the fixture states it. */
function instantOf(id: string): string | null {
  return OBSERVED_AT.get(id) ?? null;
}

/** Oldest first, an unknown instant last, the id breaking every tie. */
function longestWaiting(claims: readonly { observation_id: string }[]): string[] {
  return [...claims]
    .sort((a, b) => {
      const at = instantOf(a.observation_id);
      const bt = instantOf(b.observation_id);
      if (at !== null && bt !== null && Date.parse(at) !== Date.parse(bt)) {
        return Date.parse(at) - Date.parse(bt);
      }
      if ((at === null) !== (bt === null)) return at === null ? 1 : -1;
      return a.observation_id < b.observation_id ? -1 : 1;
    })
    .map((claim) => claim.observation_id);
}

describe("the bucket vocabulary", () => {
  it("is the view's six, and the UI may render five of them", () => {
    expect(PENDING_CLAIM_BUCKETS).toHaveLength(6);
    expect([...PENDING_CLAIM_BUCKETS]).toContain(PARKED);
    expect(UNRENDERABLE_BUCKET).toBe(PARKED);
    expect(RENDERABLE_BUCKETS).toHaveLength(5);
    expect(RENDERABLE_BUCKETS).not.toContain(PARKED);
    expect(isRenderableBucket(PARKED)).toBe(false);
    expect(isRenderableBucket("awaiting_row")).toBe(true);
    expect(isRenderableBucket("invented")).toBe(false);
  });
});

describe("the claim window read", () => {
  it("is ONE request that asks the database for the order and the bound", async () => {
    const stub = scripted(wholeView());
    const result = await readClaimWindow(
      { limit: 3 },
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("ok");

    // One request over the view, and no second leg anywhere: the instant is a
    // column of the view now (admin-window/BUG-0138).
    expect(stub.tablesRead()).toEqual([T.pendingClaims]);

    const steps = stepsOf(stub, T.pendingClaims);
    expect(steps[0].method).toBe("select");
    expect(String(steps[0].args[0])).toContain("observed_at");
    expect(argsOf(stub, T.pendingClaims, "order")).toEqual([
      ["observed_at", { ascending: true, nullsFirst: false }],
      ["observation_id", { ascending: true }],
    ]);
    // An omitted offset is offset 0, spelled as the range it is: PostgREST's
    // `.range()` is inclusive at both ends (admin-window/TASK-0065).
    expect(argsOf(stub, T.pendingClaims, "range")).toEqual([[0, 2]]);
    expect(argsOf(stub, T.pendingClaims, "limit")).toEqual([]);
  });

  it.each([
    { offset: undefined, from: 0, to: 49 },
    { offset: 0, from: 0, to: 49 },
    { offset: 50, from: 50, to: 99 },
  ])(
    "asks for range($from, $to) at offset $offset, in the same total order and with the parked bucket excluded",
    async ({ offset, from, to }) => {
      const stub = scripted(wholeView());
      const result = await readClaimWindow(
        offset === undefined ? { limit: 50 } : { limit: 50, offset },
        stub.asSupabaseClient(),
      );
      expect(result.kind).toBe("ok");

      // The bound moves; nothing else about the request does. The order is
      // what makes a window at offset 50 the CONTINUATION of the one at 0
      // rather than a second arbitrary set (admin-window/TASK-0065).
      expect(argsOf(stub, T.pendingClaims, "order")).toEqual([
        ["observed_at", { ascending: true, nullsFirst: false }],
        ["observation_id", { ascending: true }],
      ]);
      expect(argsOf(stub, T.pendingClaims, "range")).toEqual([[from, to]]);
      expect(argsOf(stub, T.pendingClaims, "limit")).toEqual([]);
      // §6 trap 4 at EVERY offset: a paged read is the same narrowing further
      // down the order, so a page that dropped this would leak the parked
      // bucket into a rendering the first screen never showed.
      expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
      if (result.kind !== "ok") return;
      expect(result.data.map((claim) => claim.bucket)).not.toContain(PARKED);
    },
  );

  it("pages the SAME order: two windows meet exactly, with nothing repeated or dropped", async () => {
    // The property paging rests on. The fixture population is small, so the
    // pages are small — what is asserted is that page 2 begins where page 1
    // ended in the one order the query states, over claims the exclusion has
    // already taken the parked bucket out of.
    const expected = longestWaiting(SHOWABLE);
    const first = await readClaimWindow(
      { limit: 4 },
      scripted(wholeView()).asSupabaseClient(),
    );
    const second = await readClaimWindow(
      { limit: 4, offset: 4 },
      scripted(wholeView()).asSupabaseClient(),
    );
    if (first.kind !== "ok" || second.kind !== "ok") {
      throw new Error("expected both pages to be ok");
    }
    expect(first.data.map((claim) => claim.observation_id)).toEqual(
      expected.slice(0, 4),
    );
    expect(second.data.map((claim) => claim.observation_id)).toEqual(
      expected.slice(4, 8),
    );
  });

  it("keeps the parked bucket out of a page at offset 50, over a view that really has one", async () => {
    // The offset-50 chain above is asserted on a fixture too small to fill a
    // second page, so the EXCLUSION there is a claim about the query alone.
    // This is the same claim about the rows: 120 claims, every fourth one
    // parked, read at offset 50 — the page must be the 51st to 100th
    // RENDERABLE claim of the order, with no `in_window` row anywhere in it.
    const many = Array.from({ length: 120 }, (_, index) =>
      pendingClaimRow(index % 4 === 0 ? "in_window" : "agreeing", {
        observation_id: `0192bbbb-0000-7000-8000-${String(index).padStart(12, "0")}`,
        observed_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      }),
    );
    const showable = many.filter((claim) => claim.bucket !== PARKED);
    expect(showable.length).toBeGreaterThan(50);

    const stub = scripted({ [T.pendingClaims]: claimView(many) });
    const result = await readClaimWindow(
      { limit: 50, offset: 50 },
      stub.asSupabaseClient(),
    );
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    expect(result.data.map((claim) => claim.bucket)).not.toContain(PARKED);
    expect(result.data.map((claim) => claim.observation_id)).toEqual(
      showable.slice(50, 100).map((claim) => claim.observation_id),
    );
  });

  it("answers an offset past the end with an empty page, not a refusal", async () => {
    // An exhausted page is an empty page: PostgREST answers a range beyond the
    // set with the rows that are there and no error.
    const result = await readClaimWindow(
      { limit: 50, offset: 500 },
      scripted(wholeView()).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: [] });
  });

  it("draws the longest-waiting claims, in the order the database returned", async () => {
    const stub = scripted(wholeView());
    const result = await readClaimWindow({ limit: 4 }, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    expect(result.data.map((claim) => claim.observation_id)).toEqual(
      longestWaiting(SHOWABLE).slice(0, 4),
    );
    for (const claim of result.data) {
      expect(claim.observed_at, claim.observation_id).toBe(
        instantOf(claim.observation_id),
      );
    }
  });

  it("keeps a claim whose instant is unknown, at the END and with no age", async () => {
    // A claim of unknown age is not a claim that arrived this instant, and it
    // may not take a position in an age order it does not carry.
    const stub = scripted(wholeView());
    const result = await readClaimWindow(
      { limit: SHOWABLE.length },
      stub.asSupabaseClient(),
    );
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    const unknown = SHOWABLE.filter(
      (claim) => instantOf(claim.observation_id) === null,
    );
    expect(unknown.length).toBeGreaterThan(0);
    const drawn = result.data.map((claim) => claim.observation_id);
    for (const claim of unknown) {
      const at = drawn.indexOf(claim.observation_id);
      expect(at, claim.observation_id).toBeGreaterThanOrEqual(
        drawn.length - unknown.length,
      );
    }
  });

  it("excludes the parked bucket in the query, and narrows by every facet at the query", async () => {
    const stub = scripted(wholeView());
    const result = await readClaimWindow(
      {
        limit: 50,
        filter: { bucket: "awaiting_row", source_id: SOURCE.first, domain: "events" },
      },
      stub.asSupabaseClient(),
    );
    expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
    expect(argsOf(stub, T.pendingClaims, "eq")).toEqual([
      ["bucket", "awaiting_row"],
      ["source_id", SOURCE.first],
      ["domain", "events"],
    ]);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.data.map((claim) => claim.observation_id)).toEqual(
      SHOWABLE.filter(
        (claim) =>
          claim.bucket === "awaiting_row" &&
          claim.source_id === SOURCE.first &&
          claim.domain === "events",
      ).map((claim) => claim.observation_id),
    );
  });

  it("reads no more claims than the window, whatever the view holds", async () => {
    // The property the whole ticket rests on: the request the page issues does
    // not grow with the table (admin-window/BUG-0138).
    const many = Array.from({ length: 2000 }, (_, index) =>
      pendingClaimRow("agreeing", {
        observation_id: `0192aaaa-0000-7000-8000-${String(index).padStart(12, "0")}`,
        observed_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      }),
    );
    const stub = scripted({ [T.pendingClaims]: claimView(many) });
    const result = await readClaimWindow({ limit: 50 }, stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    expect(stub.calls).toHaveLength(1);
    expect(result.data).toHaveLength(50);
    // The bound is a range of exactly the window, not of the 2,000 rows the
    // view holds — the request does not grow with the table at any offset.
    expect(argsOf(stub, T.pendingClaims, "range")).toEqual([[0, 49]]);
  });

  it("names the view when it is absent, and never throws", async () => {
    const result = await readClaimWindow(
      { limit: 50 },
      scripted({
        [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
      }).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "not_provisioned", missing: T.pendingClaims });
  });

  it("surfaces any other failure as the database's own words", async () => {
    const result = await readClaimWindow(
      { limit: 50 },
      scripted({
        [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
      }).asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.pendingClaims);
    expect(result.message).toContain("permission denied");
  });
});

describe("the claim count read", () => {
  it("is a head request carrying the narrowing, and reads no row at all", async () => {
    const stub = scripted(wholeView());
    const result = await readClaimCount(
      { bucket: "awaiting_row" },
      stub.asSupabaseClient(),
    );

    const steps = stepsOf(stub, T.pendingClaims);
    expect(steps[0].method).toBe("select");
    expect(steps[0].args[1]).toEqual({ head: true, count: "exact" });
    expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
    expect(argsOf(stub, T.pendingClaims, "eq")).toEqual([["bucket", "awaiting_row"]]);
    // No cap can reach it: a head count carries no bound and no order.
    expect(steps.some((step) => step.method === "range")).toBe(false);
    expect(steps.some((step) => step.method === "limit")).toBe(false);

    expect(result).toEqual({
      kind: "ok",
      data: SHOWABLE.filter((claim) => claim.bucket === "awaiting_row").length,
    });
  });

  it("counts every renderable bucket when no bucket is named", async () => {
    const result = await readClaimCount(
      {},
      scripted(wholeView()).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: SHOWABLE.length });
    expect(SHOWABLE.length).toBeLessThan(CLAIMS.length);
  });

  it("answers a real zero with a real zero", async () => {
    const result = await readClaimCount(
      { source_id: "0192cccc-0000-7000-8000-000000000000" },
      scripted(wholeView()).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: 0 });
  });

  it("treats a count the database did not give as a REFUSAL, never as a zero", async () => {
    // Exactly what a select written without `{ head: true, count: "exact" }`
    // comes back with (ARCHITECTURE.md §4.3, common violations row 2).
    const result = await readClaimCount(
      {},
      scripted({
        [T.pendingClaims]: { data: null, count: null, error: null },
      }).asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.pendingClaims);
  });

  it("names the view when it is absent", async () => {
    const result = await readClaimCount(
      {},
      scripted({
        [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
      }).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "not_provisioned", missing: T.pendingClaims });
  });
});

describe("one bucket's oldest claim", () => {
  it("is a limit 1 seek in the database's own order", async () => {
    const stub = scripted(wholeView());
    const result = await readBucketOldest(
      "standing_disagreement",
      {},
      stub.asSupabaseClient(),
    );

    expect(argsOf(stub, T.pendingClaims, "order")).toEqual([
      ["observed_at", { ascending: true, nullsFirst: false }],
    ]);
    expect(argsOf(stub, T.pendingClaims, "limit")).toEqual([[1]]);
    expect(argsOf(stub, T.pendingClaims, "eq")).toEqual([
      ["bucket", "standing_disagreement"],
    ]);

    const held = SHOWABLE.filter((claim) => claim.bucket === "standing_disagreement")
      .map((claim) => instantOf(claim.observation_id))
      .filter((at): at is string => at !== null)
      .sort();
    expect(result).toEqual({ kind: "ok", data: held[0] });
  });

  it("carries null — an absence, never 'now' — for a bucket holding nothing", async () => {
    const result = await readBucketOldest(
      "escalated",
      { source_id: "0192cccc-0000-7000-8000-000000000000" },
      scripted(wholeView()).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: null });
  });

  it("carries null for a bucket whose only claim has no instant", async () => {
    const noInstant = [
      pendingClaimRow("escalated", {
        observation_id: "0192dddd-0000-7000-8000-000000000001",
        observed_at: null,
      }),
    ];
    const result = await readBucketOldest(
      "escalated",
      {},
      scripted({ [T.pendingClaims]: claimView(noInstant) }).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: null });
  });

  it("names the view when it is absent", async () => {
    const result = await readBucketOldest(
      "escalated",
      {},
      scripted({
        [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
      }).asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "not_provisioned", missing: T.pendingClaims });
  });
});

describe("the id-set read the gauges use", () => {
  it("excludes the parked bucket too, and asks for no more rows than ids", async () => {
    const stub = scripted(wholeView());
    const result = await readPendingClaimRows(
      CLAIMS.map((claim) => claim.observation_id),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("ok");
    expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
    const ids = argsOf(stub, T.pendingClaims, "in")[0][1] as string[];
    expect(argsOf(stub, T.pendingClaims, "limit")).toEqual([[ids.length]]);
  });
});

describe("the one predicate", () => {
  const rows: ClaimRow[] = CLAIMS.map((claim) => ({
    ...claim,
    observed_at: instantOf(claim.observation_id),
  }));

  it("drops the parked bucket whatever was asked for", () => {
    expect(selectClaims(rows).map((claim) => claim.bucket)).not.toContain(PARKED);
    expect(selectClaims(rows, { bucket: PARKED })).toEqual([]);
  });

  it("returns exactly the matching claims, per facet", () => {
    const bySource = selectClaims(rows, { source_id: SOURCE.first });
    expect(new Set(bySource.map((claim) => claim.observation_id))).toEqual(
      new Set(
        CLAIMS.filter(
          (claim) => claim.source_id === SOURCE.first && claim.bucket !== PARKED,
        ).map((claim) => claim.observation_id),
      ),
    );

    const byBucketAndDomain = selectClaims(rows, {
      bucket: "awaiting_row",
      domain: "events",
    });
    expect(byBucketAndDomain.map((claim) => claim.observation_id)).toEqual(
      CLAIMS.filter(
        (claim) => claim.bucket === "awaiting_row" && claim.domain === "events",
      ).map((claim) => claim.observation_id),
    );
  });
});

/**
 * The structural half of ARCHITECTURE.md §6 trap 4: "filter it out at the data
 * layer, in `lib/db/claims.ts`, ONCE". A second module querying this view is a
 * second place the exclusion could be forgotten, and no test of behaviour can
 * see it coming.
 */
describe("the view has exactly one reader", () => {
  it("queries pending_claims from src/lib/db/claims.ts alone", () => {
    // The walk and the comment-stripping read are `tests/offline/source-tree.ts`
    // — one copy for every structural rule in this suite, tolerant of the
    // probe `db/layering.test.ts` writes and deletes under the source tree in
    // a parallel worker (admin-window/BUG-0032).
    const readers = sourceFiles().filter((file) =>
      /\.from\(T\.pendingClaims\)/.test(codeText(file)),
    );
    expect(readers).toEqual(["src/lib/db/claims.ts"]);
  });
});

/* ── the leaf the reads and the route handler share ──────────────────────── */

/**
 * `src/lib/claims/lines.ts` — the row shaping, moved out of
 * `src/app/claims/page.tsx` (campaign admin-window/TASK-0065).
 *
 * It is tested HERE, beside the read whose rows it shapes, rather than in a
 * file of its own: the two halves are one answer to "what does a claims
 * surface show", and `/claims` and the route handler that continues its list
 * must hand back the same shape.
 */
describe("the claim line shaping", () => {
  const rows: ClaimRow[] = CLAIMS.map((claim) => ({
    ...claim,
    observed_at: instantOf(claim.observation_id),
  }));

  it("keeps the order it was handed, and shapes every row", () => {
    const lines = claimLines(rows, SOURCE_NAME);
    expect(lines.map((line) => line.observationId)).toEqual(
      rows.map((claim) => claim.observation_id),
    );
  });

  it("NAMES a registered source and leaves an unregistered one as its id", () => {
    // Two fixtures, as a guard needs (LESSONS 8): the registry names
    // `SOURCE.first` and deliberately does not name `SOURCE.third`.
    const lines = claimLines(rows, SOURCE_NAME);
    const named = lines.find((line) => line.sourceId === SOURCE.first);
    const unnamed = lines.find((line) => line.sourceId === SOURCE.third);
    expect(named?.source).toBe(SOURCE_NAME.get(SOURCE.first));
    expect(unnamed?.source).toBe(SOURCE.third);
    // Whichever it says, the LINK still narrows by the machine value.
    expect(named?.sourceHref).toContain(encodeURIComponent(SOURCE.first));
    expect(unnamed?.sourceHref).toContain(encodeURIComponent(SOURCE.third));
  });

  it("carries a provenance link only where there is a canonical row", () => {
    const lines = claimLines(rows, SOURCE_NAME);
    const withRow = lines.find((line) => line.entityId !== null);
    const without = lines.find((line) => line.entityId === null);
    expect(withRow?.provenanceHref).toContain(
      encodeURIComponent(withRow?.entityId as string),
    );
    expect(without?.provenanceHref).toBeNull();
  });

  it("carries the claim's own instant through, absence included", () => {
    const lines = claimLines(rows, SOURCE_NAME);
    for (const line of lines) {
      expect(line.observedAt, line.observationId).toBe(instantOf(line.observationId));
    }
    expect(lines.some((line) => line.observedAt === null)).toBe(true);
  });
});

/**
 * ARCHITECTURE.md §4 rule 7 for the ONE leaf this ticket added — asserted over
 * its whole transitive import closure, not just its own import lines.
 *
 * `tests/offline/db/layering.test.ts` owns the rule for the registered leaf
 * SET; this is the same property for `src/lib/claims/lines.ts`, whose row
 * types `src/lib/db/claims.ts` imports back. A leaf that reached `lib/db/**`
 * — even through a module two hops away, even type-only — would write the
 * directory cycle rule 7 forbids and put the row shape back out of reach of
 * the route handler that has to share it.
 */
describe("the claims leaf reaches nothing that can reach a database", () => {
  const LEAF = "src/lib/claims/lines.ts";
  const FORBIDDEN = /@supabase\/supabase-js|process\s*\.\s*env/;

  /** The `src/**` modules a file imports, by the four spellings that reach one. */
  function importsOf(file: string): string[] {
    return codeText(file)
      .split("\n")
      .filter((line) => /^\s*import\b|\brequire\s*\(|\bimport\s*\(|\bfrom\s+["']/.test(line))
      .map((line) => line.match(/["']([^"']*)["']/)?.[1])
      .filter((specifier): specifier is string => specifier !== undefined)
      .map((specifier) =>
        specifier.startsWith("@/")
          ? `src/${specifier.slice(2)}`
          : specifier.startsWith(".")
            ? `${file.replace(/\/[^/]*$/, "")}/${specifier}`
            : specifier,
      )
      .map((target) =>
        target.startsWith("src/")
          ? `${target.replace(/\.tsx?$/, "").replace(/\/\.\//g, "/")}.ts`
          : target,
      );
  }

  it("is a real file with real imports, so nothing below passes vacuously", () => {
    expect(sourceFiles()).toContain(LEAF);
    expect(importsOf(LEAF).length).toBeGreaterThan(0);
  });

  it("never reaches lib/db, supabase-js or process.env, at any depth", () => {
    const seen = new Set<string>([LEAF]);
    const queue = [LEAF];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      expect(codeText(file), `${file} names a client or a credential`).not.toMatch(
        FORBIDDEN,
      );
      for (const target of importsOf(file)) {
        expect(target, `${file} imports it`).not.toMatch(/^src\/lib\/db\//);
        expect(target, `${file} imports it`).not.toMatch(FORBIDDEN);
        if (target.startsWith("src/") && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    // The closure really was walked: the leaf's three direct imports at least.
    expect(seen.size).toBeGreaterThan(3);
  });
});
