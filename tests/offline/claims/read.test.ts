import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PENDING_CLAIM_BUCKETS,
  RENDERABLE_BUCKETS,
  UNRENDERABLE_BUCKET,
  isRenderableBucket,
  readBucketOldest,
  readClaimCount,
  readClaimCountIn,
  readClaimWindow,
  readPendingClaimRows,
  readPendingClaimsInWindow,
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
  it("is a GET-shaped count carrying the narrowing, and reads no row at all", async () => {
    const stub = scripted(wholeView());
    const result = await readClaimCount(
      { bucket: "awaiting_row" },
      stub.asSupabaseClient(),
    );

    const steps = stepsOf(stub, T.pendingClaims);
    expect(steps[0].method).toBe("select");
    // `{ count: "exact" }` and NOT `head: true` — a HEAD response carries no
    // body, so the 404 a database without this view answers reached the app as
    // `error: null, count: null` and the page rendered a developer sentence
    // instead of the absence (admin-window/BUG-0210).
    expect(steps[0].args[1]).toEqual({ count: "exact" });
    expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
    expect(argsOf(stub, T.pendingClaims, "eq")).toEqual([["bucket", "awaiting_row"]]);
    // No cap can reach it, and it is still not a row read: no `.range`, and
    // the only bound is the count read's own "bring back nothing".
    expect(steps.some((step) => step.method === "range")).toBe(false);
    expect(argsOf(stub, T.pendingClaims, "limit")).toEqual([[0]]);

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

/**
 * The WINDOWED count and the scan printed beside it — campaign
 * admin-window/TASK-0070.
 *
 * `readClaimCountIn` replaced `readClaimCountSince`, which took a lower edge
 * and nothing else while the scan whose rows it is printed beside is
 * `[since, until]` and capped at 1,000. A count over a different interval than
 * the rows beside it is a false relationship whichever way it is resolved
 * (LESSONS 2), so the pair now takes ONE bounds object carrying both edges and
 * the two reads cannot be given different intervals.
 *
 * The fixture that proves it is a claim dated AFTER `until` (LESSONS 8, two
 * fixtures): clock skew at a source, or a source dating ahead, files a claim
 * the old count counted and the scan beside it never saw.
 */
describe("the windowed claim count read", () => {
  /** The window these cases are about — every fixture instant is placed in it. */
  const WINDOW = { since: "2026-08-01T00:00:00Z", until: "2026-09-01T00:00:00Z" };

  /** A claim of this fixture's own, at an instant, in the standing bucket. */
  function claimAt(id: string, observedAt: string | null) {
    return pendingClaimRow("standing_disagreement", {
      observation_id: id,
      observed_at: observedAt,
    });
  }

  /** Three claims inside the window, and the ones outside each of its edges. */
  const INSIDE = [
    claimAt("in-1", "2026-08-05T00:00:00Z"),
    claimAt("in-2", "2026-08-15T00:00:00Z"),
    claimAt("in-3", "2026-08-31T23:59:59Z"),
  ];
  const BEFORE_SINCE = claimAt("before", "2026-07-31T23:59:59Z");
  const AFTER_UNTIL = claimAt("ahead", "2026-09-02T00:00:00Z");
  const NO_INSTANT = claimAt("undated", null);

  const countIn = (claims: readonly ClaimRow[], filter?: Parameters<typeof readClaimCountIn>[1]) =>
    readClaimCountIn(
      WINDOW,
      filter,
      scripted({ [T.pendingClaims]: claimView(claims) }).asSupabaseClient(),
    );

  it("is a GET-shaped count carrying BOTH edges on the instant, and the narrowing", async () => {
    const stub = scripted({ [T.pendingClaims]: claimView(INSIDE) });
    await readClaimCountIn(WINDOW, { source_id: SOURCE.first }, stub.asSupabaseClient());

    const steps = stepsOf(stub, T.pendingClaims);
    // GET-shaped, so an absent view answers with its `PGRST205` body
    // (admin-window/BUG-0210).
    expect(steps[0].args[1]).toEqual({ count: "exact" });
    expect(argsOf(stub, T.pendingClaims, "gte")).toEqual([["observed_at", WINDOW.since]]);
    expect(
      argsOf(stub, T.pendingClaims, "lt"),
      "the count is printed beside a scan bounded at [since, until): it must " +
        "carry the same upper edge, not the scan's lower edge alone",
    ).toEqual([["observed_at", WINDOW.until]]);
    // The narrowing and the parked-bucket exclusion are still the query's.
    expect(argsOf(stub, T.pendingClaims, "eq")).toEqual([["source_id", SOURCE.first]]);
    expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
    // Still a count and never a row read: no cap can reach it, and the only
    // bound is the count read's own "bring back nothing".
    expect(steps.some((step) => step.method === "range")).toBe(false);
    expect(argsOf(stub, T.pendingClaims, "limit")).toEqual([[0]]);
  });

  it("leaves out a claim dated after until — the figure the old count changed", async () => {
    // The fixture where the upper edge MATTERS: the view holds four claims the
    // lower edge admits, one of them dated ahead of the instant the read was
    // resolved at.
    expect(await countIn([...INSIDE, AFTER_UNTIL])).toEqual({
      kind: "ok",
      data: INSIDE.length,
    });
  });

  it("leaves out nothing when no claim is dated after until", async () => {
    // The non-vacuous twin (LESSONS 8): the same four-claim view, its fourth
    // claim INSIDE the window. A count that had simply lost a row would pass
    // the case above and fail here.
    const alsoInside = claimAt("in-4", "2026-08-20T00:00:00Z");
    expect(await countIn([...INSIDE, alsoInside])).toEqual({
      kind: "ok",
      data: INSIDE.length + 1,
    });
  });

  it("counts [since, until) — a claim AT until is out, a claim AT since is in", async () => {
    // QA (admin-window/TASK-0070): every fixture instant above is strictly
    // inside the window or strictly outside it, so the EDGES themselves are
    // unpinned — a count written `.lte("observed_at", until)` passes all of
    // them. The figure printed beside the scan must be over the same
    // half-open interval the scan reads: `until` exclusive, `since`
    // inclusive.
    //
    // The edge is 8 claims wide on staging today: measured 2026-09-11, the
    // view's 877 claims sit on five distinct instants, and the largest tie
    // holds 8 rows at one of them — `.lt(that instant)` counts 847 where
    // `.lt(that instant + 1ms)` counts 855.
    const atSince = claimAt("at-since", WINDOW.since);
    const atUntil = claimAt("at-until", WINDOW.until);
    expect(await countIn([...INSIDE, atSince, atUntil])).toEqual({
      kind: "ok",
      data: INSIDE.length + 1,
    });
  });

  it("leaves out a claim before since, and one carrying no instant at all", async () => {
    // The lower edge is unchanged, and a claim of unknown instant is outside
    // every window however many edges it has (`null >= x` and `null < x` are
    // both null) — the same claim the scan beside it cannot see either.
    expect(await countIn([...INSIDE, BEFORE_SINCE, NO_INSTANT])).toEqual({
      kind: "ok",
      data: INSIDE.length,
    });
  });

  it("counts the population the scan beside it draws, over one bounds object", async () => {
    // THE RELATIONSHIP THE PAGE PRINTS, at the read: the gauge's claims leg
    // and the count above are handed the SAME bounds and must describe one
    // population. On a view holding a claim dated ahead, an upper edge on one
    // of them and not the other is two different figures under one sentence.
    const view = [...INSIDE, AFTER_UNTIL, BEFORE_SINCE, NO_INSTANT];
    const bounds = { ...WINDOW, limit: 50 };
    const stub = scripted({ [T.pendingClaims]: claimView(view) });
    const scan = await readPendingClaimsInWindow(bounds, {}, stub.asSupabaseClient());
    const count = await countIn(view);

    expect(scan.kind).toBe("ok");
    if (scan.kind !== "ok") return;
    expect(count).toEqual({ kind: "ok", data: scan.data.length });
    // …and the fixture really is one where an unbounded upper edge would have
    // changed the number, so this is not an equality of two unwindowed reads.
    expect(scan.data.map((claim) => claim.observation_id)).not.toContain(
      AFTER_UNTIL.observation_id,
    );
    expect(view.filter((claim) => claim.observed_at !== null).length).toBeGreaterThan(
      scan.data.length,
    );
  });

  it("names the view when it is absent", async () => {
    const result = await readClaimCountIn(
      WINDOW,
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

  /** One reach out of a file: the specifier AS WRITTEN, and where it points. */
  type Reach = {
    /** The specifier exactly as the import line spelled it. */
    specifier: string;
    /**
     * An `src/**` reach as a repo-relative path with NO extension — which
     * file that is, `resolveSource` answers — or a package name carried
     * through unchanged, which is not a path at all.
     */
    target: string;
  };

  /** The modules a file imports, by the four spellings that reach one. */
  function importsOf(file: string, read: (file: string) => string = codeText): Reach[] {
    return read(file)
      .split("\n")
      .filter((line) => /^\s*import\b|\brequire\s*\(|\bimport\s*\(|\bfrom\s+["']/.test(line))
      .map((line) => line.match(/["']([^"']*)["']/)?.[1])
      .filter((specifier): specifier is string => specifier !== undefined)
      .map((specifier) => {
        if (specifier.startsWith("@/")) return { specifier, target: `src/${specifier.slice(2)}` };
        if (specifier.startsWith(".")) {
          return {
            specifier,
            target: path.posix.normalize(`${file.replace(/\/[^/]*$/, "")}/${specifier}`),
          };
        }
        return { specifier, target: specifier };
      })
      .map(({ specifier, target }) => ({
        specifier,
        target: target.startsWith("src/") ? target.replace(/\.tsx?$/, "") : target,
      }));
  }

  /**
   * The file an `src/**` reach really names, or `null` when nothing under
   * `src/` answers to it — **the BARREL included** (admin-window/DEBT-0017).
   *
   * `@/components/ui` is `src/components/ui/index.ts`, not
   * `src/components/ui.ts`. Mapped to the latter and handed to `codeText` it
   * read as the EMPTY STRING — `sourceText` answers "" for a path that is not
   * a readable file, by design, so that a probe vanishing mid-walk is not a
   * failure — and the whole subtree behind the barrel went unscanned while the
   * walk below reported green over a closure it had never read. The leaf's
   * imports all resolve today, so that was latent: exactly the shape of guard
   * that greens the day it stops working.
   *
   * **Not shared with `tests/offline/db/layering.test.ts`'s `importTarget`,
   * deliberately** (LESSONS 4). That one answers a different question — is
   * this ONE import outside the closed leaf allowlist — for which a barrel is
   * already correctly "not a leaf", and it never reads the target's text at
   * all. Teaching it to resolve index files would change what it grades and
   * buy nothing; a resolver shared between the two would be one predicate
   * answering two questions.
   */
  function resolveSource(target: string, tree: Set<string> = sourceTree()): string | null {
    for (const candidate of [
      `${target}.ts`,
      `${target}.tsx`,
      `${target}/index.ts`,
      `${target}/index.tsx`,
    ]) {
      if (tree.has(candidate)) return candidate;
    }
    return null;
  }

  /** The one walk of `src/`, as a set, read once per call site that needs it. */
  function sourceTree(): Set<string> {
    return new Set(sourceFiles());
  }

  /**
   * The closure walk itself, over a TEXT READER so it can be driven on
   * fixtures — no probe file is written into the tree other walkers are
   * reading in parallel (admin-window/BUG-0029's hazard, `../source-tree`).
   * Returns every file it read; an unresolvable `src/` reach, a forbidden
   * import and a forbidden word are all assertion FAILURES from inside it.
   */
  function closureOf(entry: string, read: (file: string) => string = codeText): Set<string> {
    const tree = sourceTree();
    const seen = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      expect(read(file), `${file} names a client or a credential`).not.toMatch(FORBIDDEN);
      for (const { specifier, target } of importsOf(file, read)) {
        expect(target, `${file} imports it`).not.toMatch(/^src\/lib\/db\//);
        expect(target, `${file} imports it`).not.toMatch(FORBIDDEN);
        if (!target.startsWith("src/")) continue;
        const resolved = resolveSource(target, tree);
        // NEVER empty text that skips a subtree in silence: a reach into
        // `src/` that names no file is this guard failing to do its job, and
        // it says whose line it was and what that line asked for.
        expect(
          resolved,
          `${file} imports "${specifier}", which resolves to no file under src/ — the closure behind it would go unread`,
        ).not.toBeNull();
        const next = resolved as string;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  }

  it("is a real file with real imports, so nothing below passes vacuously", () => {
    expect(sourceFiles()).toContain(LEAF);
    expect(importsOf(LEAF).length).toBeGreaterThan(0);
  });

  it("resolves a BARREL specifier to the index file it really names", () => {
    // Both fixtures (LESSONS 8). The barrel is the one that used to read as
    // empty text, and the plain module beside it is the spelling that must
    // still resolve to its own file.
    const tree = sourceTree();
    expect(tree.has("src/components/ui/index.ts")).toBe(true);
    expect(tree.has("src/components/ui.ts")).toBe(false);
    expect(resolveSource("src/components/ui", tree)).toBe("src/components/ui/index.ts");
    expect(resolveSource(LEAF.replace(/\.ts$/, ""), tree)).toBe(LEAF);
    expect(resolveSource("src/lib/claims/nothing-is-here", tree)).toBeNull();
  });

  it("never reaches lib/db, supabase-js or process.env, at any depth", () => {
    const seen = closureOf(LEAF);
    // The closure really was walked: the leaf's three direct imports at least.
    expect(seen.size).toBeGreaterThan(3);
  });

  /**
   * The guard proved on fixtures rather than on the tree, through the reader
   * `closureOf` takes: each fixture below is a module map, and the FILE PATHS
   * in it are real ones so that resolution is the real resolution. What is
   * fake is only the text they are said to contain.
   */
  describe("the guard itself, on fixtures it must flag and one it must not", () => {
    const IMPORTER = "src/lib/claims/lines.ts";
    const BARREL = "src/components/ui/index.ts";
    const readingFrom =
      (text: Record<string, string>) =>
      (file: string): string =>
        text[file] ?? "";
    /** The assertion message a failing walk carried, or "" if it passed. */
    function failureOf(walk: () => unknown): string {
      try {
        walk();
      } catch (thrown) {
        return thrown instanceof Error ? thrown.message : String(thrown);
      }
      return "";
    }

    it("FAILS naming the importer and the specifier when an src/ reach reaches no file", () => {
      const GHOST = "@/lib/claims/nothing-is-here";
      const failure = failureOf(() =>
        closureOf(IMPORTER, readingFrom({ [IMPORTER]: `import { x } from "${GHOST}";` })),
      );
      expect(failure, "a specifier that resolves to nothing passed the guard").not.toBe("");
      expect(failure).toContain(IMPORTER);
      expect(failure).toContain(GHOST);
    });

    it("FAILS on each forbidden reach found BEHIND a barrel, two hops from the entry", () => {
      // The defect the resolver closes, driven: before it, the barrel read as
      // empty text and all three of these were invisible to the walk.
      const behind = [
        'import { createClient } from "@supabase/supabase-js";',
        'import { readClaimWindow } from "@/lib/db/claims";',
        "const key = process.env.SUPABASE_SERVICE_ROLE_KEY;",
      ];
      for (const planted of behind) {
        const failure = failureOf(() =>
          closureOf(
            IMPORTER,
            readingFrom({
              [IMPORTER]: 'import { Button } from "@/components/ui";',
              [BARREL]: planted,
            }),
          ),
        );
        expect(failure, planted).not.toBe("");
        // And it failed for the reach BEHIND the barrel, not for some
        // accident of the fixture: the file the message names is the barrel.
        expect(failure, planted).toContain(BARREL);
      }
    });

    it("passes over the same shape with nothing forbidden behind it, having ENTERED the barrel", () => {
      // The must-NOT-flag fixture, and the proof that the three above failed
      // for their content and not for their shape: the same two hops, with
      // the barrel really read.
      const seen = closureOf(
        IMPORTER,
        readingFrom({
          [IMPORTER]: 'import { Button } from "@/components/ui";',
          [BARREL]: 'import { EM_DASH } from "@/lib/format";',
        }),
      );
      expect([...seen]).toContain(BARREL);
    });

    /**
     * A RELATIVE barrel spelling, and the walk continuing PAST it — the
     * resolver's other new path, added by QA attacking admin-window/DEBT-0017.
     *
     * `../ui` from inside `src/components/**` reaches the same barrel the `@/`
     * fixtures above use, through `path.posix.normalize` rather than through
     * the alias branch, and the forbidden reach here sits THREE hops from the
     * entry so the failure also proves the queue keeps resolving after a
     * resolved index file rather than stopping at the first one.
     */
    it("resolves a RELATIVE barrel spelling and keeps walking past it", () => {
      const FROM = "src/components/claims/window-line.tsx";
      const THIRD = "src/lib/claims/filters.ts";
      const failure = failureOf(() =>
        closureOf(
          FROM,
          readingFrom({
            [FROM]: 'import { Button } from "../ui";',
            [BARREL]: 'import { sourceHref } from "@/lib/claims/filters";',
            [THIRD]: 'import { readClaimWindow } from "@/lib/db/claims";',
          }),
        ),
      );
      expect(failure, "a reach three hops out passed the guard").not.toBe("");
      expect(failure).toContain(THIRD);
    });
  });
});
