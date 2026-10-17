import { describe, expect, it } from "vitest";
import { accountText, type AccountSegment } from "@/lib/account/authored";
import {
  PAGE_PARAM,
  PAGE_ROUTES,
  SIZE_PARAM,
  windowBound,
  type PageAnswer,
  type PageWindow,
} from "@/lib/paging/bounds";
import {
  AppAuthoredError,
  continuing,
  initialPage,
  pageUrl,
  pressing,
  requestPage,
  screenOf,
  windowHref,
  windowToDraw,
  type PageDeps,
  type PageRefusal,
  type PageState,
  type ReasonAuthor,
} from "@/lib/paging/machine";

/**
 * The page-window driver — campaign admin-window/TASK-0063, rewritten for
 * page windows 2026-10-16 (ARCHITECTURE.md §4.3 read kind 3, SPEC F14).
 *
 * There is no DOM in this suite, which is WHY the driver is a directiveless
 * module: every rule below is driven here against a recording stub rather
 * than through a click that cannot be simulated. The stub records what it
 * was asked for, so "one move, one request" is graded as a count and a URL.
 *
 * One table-driven case per class (README "Testing", rule 4): the landings,
 * the refusals, and the URL-following rule.
 */

type Row = { id: string };

const SIZE = 20;
const W1: PageWindow = { page: 1, size: SIZE };
const W2: PageWindow = { page: 2, size: SIZE };
const W3: PageWindow = { page: 3, size: SIZE };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const full = (from: number, size = SIZE): Row[] =>
  Array.from({ length: size }, (_, i) => ({ id: `r${from + i}` }));

/** A `fetchJson` that records every URL it was called with. */
function recorder(reply: (url: string) => unknown): { urls: string[]; deps: PageDeps<Row> } {
  const urls: string[] = [];
  const deps: PageDeps<Row> = {
    route: PAGE_ROUTES.claims,
    path: "/claims",
    params: "tab=standing&source_id=abc",
    idKey: "id",
    fetchJson: async (url: string) => {
      urls.push(url);
      return reply(url);
    },
  };
  return { urls, deps };
}

/** The window a request URL named, read back as a handler would read it. */
function askedBy(url: string): PageWindow | null {
  const query = new URLSearchParams(url.split("?")[1]);
  const bound = windowBound({ page: query.get(PAGE_PARAM), size: query.get(SIZE_PARAM) });
  return bound.kind === "ok" ? bound.window : null;
}

/** An `ok` answer for a window, as the route would serve it. */
function okFor(window: PageWindow, served: Row[], exhausted = served.length < window.size): PageAnswer<Row> {
  return { kind: "ok", rows: served, page: window.page, size: window.size, exhausted };
}

type BrokenRefusal = Extract<PageRefusal, { condition: "broken" }>;
function broken(refusal: PageRefusal | null): BrokenRefusal {
  expect(refusal, "there is no refusal to read").not.toBeNull();
  expect((refusal as PageRefusal).condition).toBe("broken");
  return refusal as BrokenRefusal;
}

function authorOf(refusal: BrokenRefusal): ReasonAuthor {
  expect(refusal.account, "the account is not one run").toHaveLength(1);
  expect(accountText(refusal.account)).toBe(refusal.reason);
  return refusal.account[0].author;
}

/** A surface holding window 1, full, with more to come. */
const holding = (window: PageWindow = W1, held: Row[] = full(0)): PageState<Row> =>
  initialPage<Row>(held, window, held.length < window.size, held.map((row) => row.id));

describe("initialPage and the screen it continues", () => {
  it("holds the window the server drew, idle, with no refusal and no notes", () => {
    const state = initialPage<Row>(rows("a", "b"), W2, true, ["a", "b"]);
    expect(state).toEqual({
      rows: rows("a", "b"),
      window: W2,
      exhausted: true,
      status: "idle",
      refusal: null,
      notes: null,
      screen: screenOf(W2, ["a", "b"]),
    });
    // A synthetic start continues no particular screen.
    expect(initialPage<Row>([], W1, true).screen).toBe("");
  });

  it("drops a state seeded from a screen the server has since replaced, and keeps one it continues", async () => {
    // admin-window/BUG-0216, under windows: the server re-renders the page
    // under a client that kept its state. Same window, same ids → continued;
    // any difference → the fresh server screen wins, whole.
    const first = holding();
    const moved = await requestPage<Row>(first, recorder(() => okFor(W2, full(20))).deps, W2);
    expect(continuing(moved, holding())).toBe(moved);
    expect(continuing(moved, holding(W1, full(1)))).toEqual(holding(W1, full(1)));
    expect(continuing(moved, holding(W2, full(20)))).toEqual(holding(W2, full(20)));
    // Two states that continue no screen at all continue each other.
    expect(continuing(initialPage<Row>([], W1, true), initialPage<Row>([], W3, true)).window).toBe(W1);
  });
});

describe("pressing", () => {
  it("turns idle into loading and touches nothing else; hands loading back as the SAME object", () => {
    const state = holding();
    const started = pressing(state);
    expect(started).toEqual({ ...state, status: "loading" });
    expect(pressing(started)).toBe(started);
  });
});

describe("the URLs a move composes", () => {
  it("asks this app's own route with the surface's facets and the window, and builds the same window into the surface's own address", () => {
    const { deps } = recorder(() => null);
    const url = pageUrl(deps, W3);
    expect(url.startsWith(`${PAGE_ROUTES.claims}?`)).toBe(true);
    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.get("tab")).toBe("standing");
    expect(query.get("source_id")).toBe("abc");
    expect(askedBy(url)).toEqual(W3);
    // The href carries the SAME query on the surface's path, so a cold load
    // of it renders the window the move drew.
    const href = windowHref(deps, W3);
    expect(href.startsWith("/claims?")).toBe(true);
    expect(href.split("?")[1]).toBe(url.split("?")[1]);
    // A stale window in the facets is overridden, never duplicated.
    const stale = pageUrl({ ...deps, params: `${PAGE_PARAM}=9&${SIZE_PARAM}=100` }, W3);
    expect(new URLSearchParams(stale.split("?")[1]).getAll(PAGE_PARAM)).toEqual(["3"]);
  });
});

describe("windowToDraw — the one rule a URL-driven surface follows", () => {
  const refusedFor = (asked: PageWindow): PageState<Row> => ({
    ...holding(),
    refusal: { condition: "broken", reason: "r", account: [{ words: "r", author: "this app" }], object: null, asked },
  });
  const ok = (window: PageWindow) => windowBound({ page: String(window.page), size: String(window.size) });

  it.each([
    ["the address names the window on screen", holding(), ok(W1), null],
    ["the address names another window", holding(), ok(W2), W2],
    ["the address names another size", holding(), ok({ page: 1, size: 50 }), { page: 1, size: 50 }],
    ["a move is in flight", pressing(holding()), ok(W2), null],
    ["the address names a window this app refuses", holding(), windowBound({ page: "abc", size: null }), null],
    ["the address names the window the last move was refused for", refusedFor(W2), ok(W2), null],
    ["the address names a window other than the refused one", refusedFor(W2), ok(W3), W3],
  ] as const)("%s", (_what, state, asked, expected) => {
    expect(windowToDraw(state, asked)).toEqual(expected);
  });
});

describe("requestPage", () => {
  it("issues NO request from loading, and returns that state untouched", async () => {
    const { urls, deps } = recorder(() => okFor(W2, full(20)));
    const loading = pressing(holding());
    expect(await requestPage(loading, deps, W2)).toBe(loading);
    expect(urls).toEqual([]);
  });

  it("one move, one request, for the window asked — and the state it was handed is never mutated", async () => {
    const { urls, deps } = recorder(() => okFor(W3, full(40)));
    const before = holding();
    const snapshot = JSON.stringify(before);
    const after = await requestPage(before, deps, W3);
    expect(urls).toHaveLength(1);
    expect(askedBy(urls[0])).toEqual(W3);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.window).toEqual(W3);
  });

  const NOTES = { venues: null, provenance: { kind: "not_provisioned" as const, missing: "field_provenance" } };

  it.each([
    ["a full window that continues", okFor(W2, full(20)), full(20), false, null],
    ["a short window that ends the set", okFor(W2, rows("a", "b")), rows("a", "b"), true, null],
    ["an EMPTY window — the read happened and found nothing there", okFor(W2, []), [], true, null],
    ["a window carrying its legs' notes", { ...okFor(W2, full(20)), notes: NOTES }, full(20), false, NOTES],
  ] as const)("lands %s: the window is REPLACED, never appended", async (_what, answer, drawn, exhausted, notes) => {
    const before: PageState<Row> = {
      ...holding(),
      // A standing refusal and standing notes from an earlier window: both
      // are about what is no longer on screen once this lands.
      refusal: { condition: "not provisioned", missing: "x", asked: W3 },
      notes: { venues: { kind: "error", reading: "event_listings", message: "old" } },
    };
    const { deps } = recorder(() => answer);
    const after = await requestPage(before, deps, W2);
    expect(after).toEqual({
      rows: drawn,
      window: W2,
      exhausted,
      status: "idle",
      refusal: null,
      notes,
      screen: before.screen,
    });
    // Nothing of window 1 survives in the list: one window is one read.
    expect(after.rows.some((row) => before.rows.includes(row))).toBe(false);
  });

  /**
   * Every way a move is refused — one row per arm (README "Testing", rule 4).
   * Each row says what arrived and what the refusal must carry: the words'
   * AUTHOR (the face the line draws), the OBJECT named, and the condition.
   */
  const REFUSALS: ReadonlyArray<
    readonly [
      string,
      () => unknown,
      {
        condition: "broken" | "not provisioned";
        author?: ReasonAuthor;
        object?: string | null;
        reason?: string;
        missing?: string;
      },
    ]
  > = [
    ["a rejected request carrying the transport's words", () => Promise.reject(new TypeError("Failed to fetch")), { condition: "broken", author: "the machine", object: PAGE_ROUTES.claims, reason: "Failed to fetch" }],
    ["a rejected request carrying this app's sentence", () => Promise.reject(new AppAuthoredError("not this app's route")), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims, reason: "not this app's route" }],
    ["a rejection with no words at all", () => Promise.reject(undefined), { condition: "broken", author: "the machine", object: PAGE_ROUTES.claims, reason: "undefined" }],
    ["a body that is not a page answer", () => ({ rows: [] }), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims }],
    ["the OLD wire shape, offset and all", () => ({ kind: "ok", rows: full(20), offset: 20, exhausted: false }), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims }],
    ["a window served for a different PAGE than asked", () => okFor(W3, full(40)), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims }],
    ["a window served at a different SIZE than asked", () => okFor({ page: 2, size: 50 }, full(20, 50)), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims }],
    ["a SHORT window that says the set continues", () => okFor(W2, rows("a"), false), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims }],
    ["a window LONGER than its size", () => okFor(W2, full(20, 21)), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims }],
    ["a window whose notes this app cannot read", () => ({ ...okFor(W2, full(20)), notes: { venues: "gone" } }), { condition: "broken", author: "this app", object: PAGE_ROUTES.claims }],
    ["the route's own window refusal", () => ({ kind: "refused", reason: "the page must be at least 1", param: "page", bound: "0" }), { condition: "broken", author: "this app", object: null, reason: "the page must be at least 1" }],
    ["the database's own error", () => ({ kind: "error", reading: "pending_claims", message: "canceling statement due to statement timeout" }), { condition: "broken", author: "the machine", object: "pending_claims", reason: "canceling statement due to statement timeout" }],
    ["an error whose account carries BOTH authors", () => ({ kind: "error", reading: "pending_claims", message: "a b", authored: [{ words: "a", author: "the machine" }, { words: "b", author: "this app" }] as AccountSegment[] }), { condition: "broken", object: "pending_claims", reason: "a b" }],
    ["an error with no words", () => ({ kind: "error", reading: "pending_claims", message: "   " }), { condition: "broken", author: "this app", object: "pending_claims" }],
    ["the backing object is not in this database", () => ({ kind: "not_provisioned", missing: "pending_claims" }), { condition: "not provisioned", missing: "pending_claims" }],
  ];

  it.each(REFUSALS)("refuses %s: nothing drawn, the window unmoved, idle, naming what it asked for", async (_what, reply, expected) => {
    const before: PageState<Row> = { ...holding(), notes: { venues: null } };
    const { urls, deps } = recorder(reply);
    const after = await requestPage(before, deps, W2);

    expect(urls).toHaveLength(1);
    // Rule 6: the rows, the window, the exhaustion and the notes stand.
    expect(after.rows).toBe(before.rows);
    expect(after.window).toEqual(W1);
    expect(after.exhausted).toBe(before.exhausted);
    expect(after.notes).toBe(before.notes);
    expect(after.status).toBe("idle");
    expect(after.refusal?.asked).toEqual(W2);
    expect(after.refusal?.condition).toBe(expected.condition);

    if (expected.condition === "not provisioned") {
      expect(after.refusal).toEqual({ condition: "not provisioned", missing: expected.missing, asked: W2 });
      return;
    }
    const refusal = broken(after.refusal);
    expect(refusal.object).toBe(expected.object);
    expect(refusal.reason.length).toBeGreaterThan(0);
    if (expected.reason !== undefined) expect(refusal.reason).toBe(expected.reason);
    if (expected.author !== undefined) expect(authorOf(refusal)).toBe(expected.author);
    else expect(refusal.account.map((run) => run.author)).toEqual(["the machine", "this app"]);
    // A refusal that puts no ink on the page is worded by this app.
    expect(refusal.reason.trim().length).toBeGreaterThan(0);
  });

  it("clears a standing refusal on the next move that lands, and never throws", async () => {
    const refused = await requestPage(holding(), recorder(() => Promise.reject(new Error("x"))).deps, W2);
    expect(refused.refusal).not.toBeNull();
    const landed = await requestPage(refused, recorder(() => okFor(W2, full(20))).deps, W2);
    expect(landed.refusal).toBeNull();
    for (const reply of [() => { throw new Error("sync"); }, () => Promise.reject(null), () => null, () => [null]]) {
      await expect(requestPage(holding(), recorder(reply).deps, W2)).resolves.toBeDefined();
    }
  });

  it("a window is one read of one order — nothing on screen is merged with what the route answered", async () => {
    // THE RULE THAT REPLACES admin-window/BUG-0221's `it.fails` pin. Under
    // append-on-press, a claim settled between the screen read and the press
    // was drawn on no screen and nothing could say so. Under page windows the
    // operator is always looking at ONE bounded read at ONE instant: a move is
    // a fresh read of the window the address names, and what the route
    // answered is what is drawn — no merge, no dedupe against rows that are
    // no longer on screen. The population moving between two reads is still
    // not promised against (§4.3: no snapshot across moves); what IS promised
    // is that the list on screen is never the concatenation of two orders.
    const screen = holding(W1, rows("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"));
    // `a` settled after the screen was read, so the route's window 2 of the
    // CURRENT order begins with `v`, not `u`.
    const moved = await requestPage(screen, recorder(() => okFor(W2, full(21).map((_, i) => ({ id: `r${21 + i}` })))).deps, W2);
    expect(moved.rows.map((row) => row.id)).toEqual(Array.from({ length: 20 }, (_, i) => `r${21 + i}`));
    expect(moved.rows.some((row) => screen.rows.some((was) => was.id === row.id))).toBe(false);
    // Moving back re-reads window 1 as it NOW stands — the route's answer,
    // never the rows this state held before.
    const back = await requestPage(moved, recorder(() => okFor(W1, full(1))).deps, W1);
    expect(back.rows.map((row) => row.id)).toEqual(full(1).map((row) => row.id));
  });
});
