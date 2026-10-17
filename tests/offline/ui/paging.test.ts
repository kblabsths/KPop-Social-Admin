import * as cheerio from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as barrel from "@/components/ui";
import { EM_DASH, count } from "@/lib/format";
import { Chip } from "@/components/ui/chip";
import { ARRIVES_WITH } from "@/components/ui/state-of";
import {
  ANSWERED_BY_SOMETHING_ELSE,
  PagedWindowLine,
  PagingProvider,
  UNREADABLE_ANSWER,
  WindowControls,
  fetchJson,
  usePaging,
} from "@/components/ui/paging";
import { NARROW_THE_VIEW, PagedClaimList } from "@/components/claims/paged-claim-list";
import { PagedBrowseTable } from "@/components/browse/paged-browse-table";
import { RECENT_EVENTS, configuredKeys } from "@/lib/browse/views";
import { WindowLine, type DrawnSentence, type DrawnWindow } from "@/components/ui/window-line";
import {
  MAX_PAGE_OFFSET,
  PAGE_PARAM,
  PAGE_ROUTES,
  SIZE_PARAM,
  WINDOW_SIZES,
  largestPage,
  windowBound,
  type PageAnswer,
  type PageWindow,
} from "@/lib/paging/bounds";
import {
  initialPage,
  requestPage,
  type PageDeps,
  type PageRefusal,
  type PageState,
  type ReasonAuthor,
  type RowIdKey,
} from "@/lib/paging/machine";

import { codeLinesIn, sourceFiles, sourceText } from "../source-tree";
import { classesOf, h, render } from "./markup";

/**
 * The paging affordance — campaign admin-window/TASK-0064, SPEC F14,
 * rewritten for page windows 2026-10-16.
 *
 * `WindowControls` is a synchronous component over the provider's state, so
 * every arm it draws is a rendered-markup assertion here and none needs a
 * DOM. `usePageWindows` is the one thing in this repo that reaches the
 * network, and it IS driven here through the provider: `renderToStaticMarkup`
 * runs hooks for the initial render, a probe hands `goTo` back out, and
 * calling it afterwards is what a click would do. `setState` is a no-op in
 * this renderer, which is what makes the guard assertions discriminating.
 *
 * One table-driven case per class (README "Testing", rule 4).
 */

type Row = { id: string };
const ROW_ID: RowIdKey<Row> = "id";
const HOLDS = "claims";
const SIZE = 50;
const W1: PageWindow = { page: 1, size: SIZE };
const W2: PageWindow = { page: 2, size: SIZE };
const DEPS: Omit<PageDeps<Row>, "fetchJson"> = {
  route: PAGE_ROUTES.claims,
  path: "/claims",
  params: "tab=standing",
  idKey: ROW_ID,
};
const pageOf = (n: number, from = 0): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));
const okFor = (window: PageWindow, rows: Row[]): PageAnswer<Row> => ({
  kind: "ok",
  rows,
  page: window.page,
  size: window.size,
  exhausted: rows.length < window.size,
});

/** A window of the shape `/claims` composes: a count read beside the rows. */
const counted = (held: number, over: Partial<DrawnWindow> = {}): DrawnWindow => ({
  limit: SIZE,
  held,
  truncated: true,
  over: "view",
  oldest: null,
  scope: null,
  drawn: SIZE,
  continues: true,
  heldFrom: "a count read",
  ...over,
});

/** A state on window `window` holding `rows`, with `over` on top. */
const state = (window: PageWindow = W1, rows: Row[] = pageOf(SIZE), over: Partial<PageState<Row>> = {}): PageState<Row> => ({
  ...initialPage<Row>(rows, window, rows.length < window.size, rows.map((row) => row.id)),
  ...over,
});

type BrokenRefusal = Extract<PageRefusal, { condition: "broken" }>;
const brokenArm = (reason: string, author: ReasonAuthor, object: string | null, asked: PageWindow = W2): BrokenRefusal => ({
  condition: "broken",
  reason,
  account: [{ words: reason, author }],
  object,
  asked,
});

/** A whole paged surface — the line and the controls — from one provider. */
function surface(
  initial: PageState<Row>,
  window: DrawnWindow = counted(877),
  captured: { goTo: ((window: PageWindow) => void) | null } = { goTo: null },
): string {
  return render(
    h(
      PagingProvider<Row>,
      { initial, window, deps: DEPS, children: null },
      h(function Body() {
        const published = usePaging<Row>();
        captured.goTo = published.goTo;
        return h(
          "div",
          null,
          h(PagedWindowLine, { gauge: "claims", shows: { of: "matched", lede: "Longest-waiting first.", rows: HOLDS } }),
          h(WindowControls, { holds: HOLDS, nextStep: NARROW_THE_VIEW }),
        );
      }),
    ),
  );
}

const $of = (html: string) => cheerio.load(html);
const arm = (html: string): string | undefined => $of(html)("[data-paging]").attr("data-paging");
const moves = (html: string): string[] =>
  $of(html)("[data-paging-move]").toArray().map((el) => $of(html)(el).attr("data-paging-move") ?? "");
const hrefOf = (html: string, selector: string): string | undefined => $of(html)(selector).attr("href");
const windowIn = (href: string | undefined): PageWindow | null => {
  const query = new URLSearchParams((href ?? "").split("?")[1]);
  const bound = windowBound({ page: query.get(PAGE_PARAM), size: query.get(SIZE_PARAM) });
  return bound.kind === "ok" ? bound.window : null;
};
const text = (html: string, selector: string): string => $of(html)(selector).text().replace(/\s+/g, " ").trim();
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("WindowControls draws its arms from the provider's state", () => {
  const ceiling: PageWindow = { page: largestPage(SIZE), size: SIZE };

  /** A count past any window these fixtures reach, so only the read or the ceiling can end the set. */
  const PLENTY = counted(MAX_PAGE_OFFSET * 2);

  it.each([
    ["the first window with more to come", state(), "more", ["next"], PLENTY],
    ["a middle window", state(W2), "more", ["previous", "next"], PLENTY],
    ["a move in flight", state(W2, pageOf(SIZE), { status: "loading" }), "loading", ["previous", "next"], PLENTY],
    ["the last window: the read ended inside it", state(W2, pageOf(7)), "exhausted", ["previous"], PLENTY],
    ["the last window: the COUNT is reached", state(W2), "exhausted", ["previous"], counted(100)],
    ["an empty window past the end", state(W2, []), "exhausted", ["previous"], PLENTY],
    ["the window that starts at the ceiling", state(ceiling), "limit", ["previous"], PLENTY],
  ] as const)("%s", (_what, from, expectedArm, expectedMoves, window) => {
    const html = surface(from, window);
    expect(arm(html)).toBe(expectedArm);
    expect(moves(html)).toEqual([...expectedMoves]);
    // Every move is a LINK to the window's own address — a cold load of it is
    // the same window — carrying the surface's facets beside the window.
    for (const move of expectedMoves) {
      const href = hrefOf(html, `[data-paging-move="${move}"]`);
      expect(href?.startsWith("/claims?"), move).toBe(true);
      expect(new URLSearchParams(href?.split("?")[1]).get("tab"), move).toBe("standing");
      expect(windowIn(href), move).toEqual({ page: from.window.page + (move === "next" ? 1 : -1), size: SIZE });
      // Verb + object (copy bar 1), naming the size and the noun.
      expect(text(html, `[data-paging-move="${move}"]`)).toBe(`Show the ${move} ${SIZE} ${HOLDS}`);
    }
    // The size selector on every arm: three chips, the current one marked,
    // each an address at the window that holds this window's first row.
    const chips = $of(html)("[data-paging-size]");
    expect(chips.toArray().map((el) => $of(html)(el).attr("data-paging-size"))).toEqual(WINDOW_SIZES.map(String));
    expect($of(html)('[data-paging-size][aria-current="true"]').attr("data-paging-size")).toBe(String(SIZE));
    expect(windowIn(hrefOf(html, '[data-paging-size="20"]'))).toEqual({
      page: Math.floor(((from.window.page - 1) * SIZE) / 20) + 1,
      size: 20,
    });
    expect(windowIn(hrefOf(html, '[data-paging-size="100"]'))).toEqual({
      page: Math.floor(((from.window.page - 1) * SIZE) / 100) + 1,
      size: 100,
    });
    expect($of(html)("nav").attr("aria-busy")).toBe(expectedArm === "loading" ? "true" : undefined);
  });

  it("draws nothing where no move could change the screen, and nothing but the clause where the object is absent", () => {
    // A first window the read ended inside, holding no more than the smallest
    // size: every link would redraw the same rows.
    const whole = surface(state(W1, pageOf(12)), counted(12, { truncated: false, drawn: 12 }));
    expect($of(whole)("[data-paging]")).toHaveLength(0);
    expect($of(whole)("a")).toHaveLength(0);
    // …but one row more than the smallest size, and the size chips matter.
    const sizable = surface(state(W1, pageOf(21)), counted(21, { truncated: false, drawn: 21 }));
    expect(arm(sizable)).toBe("exhausted");
    expect($of(sizable)("[data-paging-size]")).toHaveLength(3);

    // The backing object is not in this database (admin-window/BUG-0211): the
    // clause, gray, with the object in its own box, and no control of any kind.
    const absent = surface(state(W2, pageOf(SIZE), { refusal: { condition: "not provisioned", missing: "pending_claims", asked: W2 } }));
    expect($of(absent)("[data-paging]")).toHaveLength(0);
    expect($of(absent)("a, button")).toHaveLength(0);
    const clause = $of(absent)("[data-paging-refusal]");
    expect(clause).toHaveLength(1);
    expect(clause.attr("role")).toBe("alert");
    expect(clause.find("[dir='ltr']").text()).toBe("pending_claims");
    expect(clause.text()).toContain(ARRIVES_WITH);
    expect(classesOf(clause.toString())).not.toContain("text-broken");
    expect(classesOf(clause.toString())).toContain("text-ink-secondary");
  });

  it("the ceiling arm names this app as what stopped, then the surface's next step, and never the end of the set", () => {
    const html = surface(state(ceiling), counted(MAX_PAGE_OFFSET * 2));
    const said = text(html, "[data-paging-limit]");
    expect(said).toContain(count(MAX_PAGE_OFFSET + 1));
    expect(said).toContain(NARROW_THE_VIEW);
    expect(said).not.toMatch(/sorry|oops|unfortunately|went wrong|apolog/i);
    expect(said).not.toMatch(/no more|all .* are shown/i);
    // A surface with no next step ends on the app's own sentence.
    const bare = render(
      h(
        PagingProvider<Row>,
        { initial: state(ceiling), window: counted(MAX_PAGE_OFFSET * 2, { heldFrom: "this window" }), deps: DEPS, children: null },
        h(WindowControls, { holds: "events", nextStep: null }),
      ),
    );
    expect(text(bare, "[data-paging-limit]")).not.toContain(NARROW_THE_VIEW);
    expect(text(bare, "[data-paging-limit]").endsWith("end of the set.")).toBe(true);
    // One window below the ceiling still offers a next.
    expect(moves(surface(state({ page: ceiling.page - 1, size: SIZE }), counted(MAX_PAGE_OFFSET * 2)))).toEqual(["previous", "next"]);
  });

  it("a broken refusal reads in red beside the controls, names its object and the window asked, and offers to ask again", () => {
    const refused = state(W1, pageOf(SIZE), { refusal: brokenArm("no relation exists", "the machine", "pending_claims", W2) });
    const html = surface(refused);
    const line = $of(html)("[data-paging-refusal]");
    expect(line).toHaveLength(1);
    expect(line.attr("role")).toBe("alert");
    expect(classesOf(line.toString())).toContain("text-broken");
    expect(line.text()).toContain("pending_claims");
    expect(line.text()).toContain("no relation exists");
    expect(line.text()).toContain(count(2));
    expect(line.find("[data-paging-retry]")).toHaveLength(1);
    // The controls stand — the refusal did not move the window.
    expect(arm(html)).toBe("more");
    expect(moves(html)).toEqual(["next"]);
    // A refusal with nothing to name has no dangling em dash.
    const bound = surface(state(W1, pageOf(SIZE), { refusal: brokenArm("the page must be at least 1", "this app", null) }));
    expect(text(bound, "[data-paging-refusal]")).not.toContain(EM_DASH);
  });

  it("introduces no raw colour, spacing or type value, and draws its chips with the Chip primitive", () => {
    const samples = [
      surface(state()),
      surface(state(W2, pageOf(SIZE), { status: "loading" })),
      surface(state(ceiling)),
      surface(state(W1, pageOf(SIZE), { refusal: brokenArm("x", "the machine", "pending_claims") })),
      surface(state(W2, pageOf(SIZE), { refusal: { condition: "not provisioned", missing: "pending_claims", asked: W2 } })),
    ];
    const every = samples.flatMap(classesOf);
    expect(every.length).toBeGreaterThan(5);
    expect(every.filter((c) => c.includes("[") || /#[0-9a-f]{3,8}/i.test(c))).toEqual([]);
    const RAMP = /-(gray|slate|zinc|neutral|stone|purple|violet|green|emerald|amber|orange|yellow|red|rose|blue|sky|indigo|pink|fuchsia)-\d{2,3}$/;
    expect(every.filter((c) => RAMP.test(c) || c.startsWith("dark:") || c.startsWith("shadow"))).toEqual([]);
    for (const step of every.filter((c) => c.startsWith("type-"))) {
      expect(["type-figure", "type-title", "type-body", "type-data", "type-micro"]).toContain(step);
    }
    for (const sample of samples) expect(sample).not.toMatch(/style="/);
    // The size chip is the app's one chip, classes and all.
    const chip = render(h(Chip, { label: "20", href: "/claims?page=1&size=20", active: false }));
    const drawn = $of(samples[0])('[data-paging-size="20"]').attr("class");
    expect(drawn).toBe($of(chip)("a").attr("class"));
  });
});

describe("usePageWindows binds the driver to the browser's history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A stub that answers every request with `answer`, recording the URLs. */
  function answering(answer: PageAnswer<Row> | ((url: string) => Promise<Response>)) {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return typeof answer === "function" ? answer(url) : Promise.resolve(Response.json(answer));
    });
    return urls;
  }

  /** A browser's history and address, as the hook reaches them through `globalThis`. */
  function browser(search = "") {
    const pushed: string[] = [];
    const location = { search };
    vi.stubGlobal("location", location);
    vi.stubGlobal("history", {
      pushState: (_data: unknown, _unused: string, href: string) => {
        pushed.push(href);
        location.search = href.includes("?") ? `?${href.split("?")[1]}` : "";
      },
    });
    return { pushed, location };
  }

  const asked = (url: string): PageWindow | null => windowIn(url);

  it("one move: pushes the window's address, then asks the route for exactly that window", async () => {
    const urls = answering(okFor(W2, pageOf(SIZE, SIZE)));
    const { pushed } = browser(`?tab=standing`);
    const captured = { goTo: null as ((window: PageWindow) => void) | null };
    surface(state(), counted(877), captured);
    expect(urls).toEqual([]);

    captured.goTo?.(W2);
    await settle();
    expect(pushed).toEqual([`/claims?tab=standing&${PAGE_PARAM}=2&${SIZE_PARAM}=50`]);
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith(PAGE_ROUTES.claims)).toBe(true);
    expect(asked(urls[0])).toEqual(W2);
    expect(new URLSearchParams(urls[0].split("?")[1]).get("tab")).toBe("standing");
  });

  it("a second move while one is in flight issues no second request, and the address is caught up with once it lands", async () => {
    const answer = Promise.withResolvers<Response>();
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return urls.length === 1 ? answer.promise : Promise.resolve(Response.json(okFor(asked(url) ?? W1, pageOf(SIZE))));
    });
    browser();
    const captured = { goTo: null as ((window: PageWindow) => void) | null };
    surface(state(), counted(877), captured);

    captured.goTo?.(W2);
    captured.goTo?.({ page: 3, size: SIZE });
    captured.goTo?.({ page: 3, size: SIZE });
    expect(urls).toHaveLength(1);
    answer.resolve(Response.json(okFor(W2, pageOf(SIZE, SIZE))));
    await settle();
    await settle();
    // The address moved to window 3 while window 2 was in flight, so the
    // surface followed it with ONE more request, for window 3.
    expect(urls.map(asked)).toEqual([W2, { page: 3, size: SIZE }]);
  });

  it("never throws out of a move, and a refused move is asked for again only by the operator", async () => {
    const urls = answering(() => Promise.reject(new TypeError("Failed to fetch")));
    browser();
    const captured = { goTo: null as ((window: PageWindow) => void) | null };
    surface(state(), counted(877), captured);
    expect(() => captured.goTo?.(W2)).not.toThrow();
    await settle();
    await settle();
    // One request, refused; following the address does NOT re-ask the window
    // the move was refused for (that would loop for ever).
    expect(urls).toHaveLength(1);
    captured.goTo?.(W2);
    await settle();
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(urls[0]);
  });

  it("Back follows the address: a move that lands under an address Back has moved is followed by the address's own window", async () => {
    // `renderToStaticMarkup` runs no effects, so the popstate listener is not
    // bound here; what IS driven is the one rule it calls (`sync`), through the
    // path this renderer reaches — a move landing. The operator presses Back
    // while window 3 is in flight: the address is window 1 again, so when
    // window 3 lands the surface asks for window 1, and draws it.
    const answer = Promise.withResolvers<Response>();
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return urls.length === 2 ? answer.promise : Promise.resolve(Response.json(okFor(asked(url) ?? W1, pageOf(SIZE))));
    });
    const { location } = browser(`?${PAGE_PARAM}=1&${SIZE_PARAM}=50`);
    const captured = { goTo: null as ((window: PageWindow) => void) | null };
    surface(state(), counted(877), captured);
    captured.goTo?.(W2);
    await settle();
    expect(urls.map(asked)).toEqual([W2]);

    captured.goTo?.({ page: 3, size: SIZE });
    // Back, pressed while window 3 is in the air.
    location.search = `?${PAGE_PARAM}=1&${SIZE_PARAM}=50`;
    answer.resolve(Response.json(okFor({ page: 3, size: SIZE }, pageOf(SIZE))));
    await settle();
    await settle();
    expect(urls.map(asked)).toEqual([W2, { page: 3, size: SIZE }, W1]);
  });
});

describe("PagingProvider publishes one surface's state, and draws nothing", () => {
  const CATALOG: DrawnSentence = { of: "catalog", rows: "events" };
  const WINDOW: DrawnWindow = { limit: SIZE, held: SIZE, truncated: true, over: "view", oldest: null, scope: null, drawn: SIZE, continues: true };
  const line = (initial: PageState<Row>, window: DrawnWindow = WINDOW): string =>
    render(
      h(
        PagingProvider<Row>,
        { initial, window, deps: { ...DEPS, route: PAGE_ROUTES.browse, path: "/browse", params: "" }, children: null },
        h(PagedWindowLine, { gauge: "events", shows: CATALOG }),
      ),
    );
  const hook = (html: string, name: string): string | undefined => $of(html)("[data-window]").attr(name);

  it("renders no markup of its own, and the page's own line to the byte on the first screen", () => {
    const child = h("span", { "data-probe": "" }, "rows");
    expect(render(h(PagingProvider<Row>, { initial: state(), window: WINDOW, deps: DEPS, children: null }, child))).toBe(render(child));
    // The server screen for an address is what the client draws for it: the
    // provider combines the page's facts with a state the page itself seeded,
    // so the line it renders is the line the page would render alone.
    expect(line(state())).toBe(render(h(WindowLine, { gauge: "events", window: { ...WINDOW, from: 1 }, shows: CATALOG })));
  });

  it.each([
    ["idle on a full window", state(), "true"],
    ["loading", state(W1, pageOf(SIZE), { status: "loading" }), "true"],
    ["refused", state(W1, pageOf(SIZE), { refusal: brokenArm("x", "this app", null) }), "true"],
    ["the read ended inside this window", state(W1, pageOf(12)), "false"],
  ] as const)("takes truncation from the state's own exhaustion and nothing else: %s", (_what, initial, truncated) => {
    expect(hook(line(initial), "data-window-truncated")).toBe(truncated);
  });

  it("states where the window starts and what it drew, and whose number held is", () => {
    const moved = state(W2, pageOf(SIZE, SIZE));
    expect(hook(line(moved), "data-window-from")).toBe(String(SIZE + 1));
    expect(hook(line(moved), "data-window-drawn")).toBe(String(SIZE));
    expect(hook(line(moved), "data-window-limit")).toBe(String(SIZE));
    // `heldFrom` decides which number `held` publishes (admin-window/BUG-0174):
    // a count read stands whatever its number; a window's own rows follow the
    // rows on screen.
    expect(hook(line(moved, { ...WINDOW, held: 877, heldFrom: "a count read" }), "data-window-held")).toBe("877");
    expect(hook(line(moved, { ...WINDOW, held: 12, heldFrom: "a count read" }), "data-window-held")).toBe("12");
    expect(hook(line(moved, { ...WINDOW, held: 877, heldFrom: "this window" }), "data-window-held")).toBe(String(SIZE));
    expect(hook(line(moved), "data-window-held")).toBe(String(SIZE));
    // …and the size the state holds is the cap the line states.
    expect(hook(line(state({ page: 1, size: 20 }, pageOf(20))), "data-window-limit")).toBe("20");
  });

  it("refuses to draw a paged surface outside its provider", () => {
    expect(() => render(h(PagedWindowLine, { gauge: "events", shows: CATALOG }))).toThrow();
    expect(() => render(h(WindowControls, { holds: HOLDS, nextStep: null }))).toThrow();
    expect(() =>
      render(
        h(function Probe() {
          usePaging();
          return null;
        }),
      ),
    ).toThrow();
  });
});

describe("the two wrappers put the controls ABOVE the rows", () => {
  it("/claims: controls, then the list — and nothing after the last row", () => {
    const html = render(
      h(
        PagingProvider<{ observationId: string }>,
        {
          initial: initialPage(pageOf(3).map((row) => ({ observationId: row.id })), { page: 2, size: 20 }, true),
          window: counted(23, { limit: 20, drawn: 3, truncated: false }),
          deps: { route: PAGE_ROUTES.claims, path: "/claims", params: "", idKey: "observationId" },
          children: null,
        },
        h(PagedClaimList, { label: "All claims" }),
      ),
    );
    expect(html.indexOf("data-paging")).toBeLessThan(html.indexOf("<table"));
    expect(html.lastIndexOf("</table>")).toBe(html.lastIndexOf("</table>"));
    expect(html.slice(html.lastIndexOf("</table>"))).not.toMatch(/data-paging|<a |<button/);
    expect($of(html)("[data-claim]")).toHaveLength(3);
  });

  it("/browse: controls, then the window's own leg notes, then the table alone inside the surface", () => {
    const view = RECENT_EVENTS;
    const rows = pageOf(2).map((row) => ({
      event_id: row.id,
      title: row.id,
      description: null,
      poster_url: null,
      starts_at: null,
      created_at: null,
      venue_name: null,
      sources: [],
    }));
    const html = render(
      h(
        PagingProvider<(typeof rows)[number]>,
        {
          initial: {
            ...initialPage(rows, { page: 2, size: 20 }, true),
            notes: { venues: null, provenance: { kind: "not_provisioned", missing: "field_provenance" } },
          },
          window: counted(22, { limit: 20, drawn: 2, truncated: false, heldFrom: "this window" }),
          deps: { route: PAGE_ROUTES.browse, path: "/browse", params: "", idKey: "event_id" },
          children: null,
        },
        h(PagedBrowseTable, { surface: "events", view, shown: configuredKeys(view), reported: [] }),
      ),
    );
    const at = (needle: string) => html.indexOf(needle);
    expect(at("data-paging")).toBeLessThan(at('data-not-provisioned="field_provenance"'));
    expect(at('data-not-provisioned="field_provenance"')).toBeLessThan(at('data-surface="events"'));
    expect($of(html)('[data-surface="events"]').children()).toHaveLength(1);
    expect($of(html)('[data-surface="events"]').find("[data-state]")).toHaveLength(0);
    // A note the page already reported above the table is not reported again.
    const once = render(
      h(
        PagingProvider<(typeof rows)[number]>,
        {
          initial: {
            ...initialPage(rows, { page: 2, size: 20 }, true),
            notes: { venues: null, provenance: { kind: "not_provisioned", missing: "field_provenance" } },
          },
          window: counted(22, { limit: 20, drawn: 2, truncated: false, heldFrom: "this window" }),
          deps: { route: PAGE_ROUTES.browse, path: "/browse", params: "", idKey: "event_id" },
          children: null,
        },
        h(PagedBrowseTable, { surface: "events", view, shown: configuredKeys(view), reported: ["field_provenance"] }),
      ),
    );
    expect($of(once)("[data-not-provisioned]")).toHaveLength(0);
  });
});

describe("fetchJson — the one request, and what it may reject with", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const AS_JSON = { status: 200, headers: { "content-type": "application/json" } };

  it("asks the URL it was given with this origin's credentials, does not reject on a 400, and reads the body once", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    let reads = 0;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      const response = Response.json({ kind: "refused", reason: "no", param: "page", bound: "0" }, { status: 400 });
      const json = response.json.bind(response);
      response.json = () => {
        reads += 1;
        return json();
      };
      return Promise.resolve(response);
    });
    await expect(fetchJson("/api/admin/claims/rows?page=0")).resolves.toMatchObject({ kind: "refused" });
    expect(calls).toEqual([["/api/admin/claims/rows?page=0", { credentials: "same-origin" }]]);
    expect(reads).toBe(1);
  });

  it.each([
    ["an HTML sign-in page at 200", "<!doctype html><body>Sign in</body>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }, ANSWERED_BY_SOMETHING_ELSE],
    ["no content type at all", "{}", { status: 200 }, ANSWERED_BY_SOMETHING_ELSE],
    ["a media type that merely looks like json", "{}", { status: 200, headers: { "content-type": "application/jsonx" } }, ANSWERED_BY_SOMETHING_ELSE],
    ["a truncated body declared json", '{"kind":"ok","rows":[', AS_JSON, UNREADABLE_ANSWER],
  ])("rejects in the app's own voice when %s", async (_what, body, init, sentence) => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(body, init)));
    await expect(fetchJson("/x")).rejects.toMatchObject({ name: "AppAuthoredError", message: sentence });
  });

  it("still reaches the driver for every spelling of a declared json answer, and passes a transport's own words through", async () => {
    for (const type of ["application/json", "Application/JSON", "application/json; charset=utf-8", " application/json "]) {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response('{"a":1}', { status: 200, headers: { "content-type": type } })));
      await expect(fetchJson("/x"), type).resolves.toEqual({ a: 1 });
    }
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchJson("/x")).rejects.toMatchObject({ name: "TypeError", message: "Failed to fetch" });
    vi.stubGlobal("fetch", () => Promise.reject(undefined));
    await expect(fetchJson("/x")).rejects.toMatchObject({ name: "AppAuthoredError" });
  });
});

describe("the refusal line says who wrote the words", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const AS_JSON = { status: 200, headers: { "content-type": "application/json" } };

  /** One move, end to end: a stubbed `fetch`, the real `fetchJson`, the real driver, the rendered surface. */
  async function moved(body: BodyInit | null, init: ResponseInit): Promise<string> {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(body, init)));
    const after = await requestPage<Row>(state(), { ...DEPS, fetchJson }, W2);
    return surface(after);
  }

  function faces(html: string) {
    const $ = $of(html);
    const line = $("[data-paging-refusal]");
    const step = (name: string) => line.find(`.${name}`).toArray().map((el) => $(el).text()).join(" ");
    return {
      mono: step("type-data"),
      sans: step("type-body"),
      isolated: line.find("[dir='ltr']").toArray().map((el) => $(el).text()),
      read: line.text(),
    };
  }

  it.each([
    ["something other than this app's route answered", "<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }, ANSWERED_BY_SOMETHING_ELSE, "this app", PAGE_ROUTES.claims],
    ["a truncated body declared json", '{"kind":"ok","rows":[', AS_JSON, UNREADABLE_ANSWER, "this app", PAGE_ROUTES.claims],
    ["a body that is not a page answer", '{"rows":[]}', AS_JSON, "the page request answered something this app cannot read", "this app", PAGE_ROUTES.claims],
    ["the route's own window refusal", JSON.stringify({ kind: "refused", reason: "the page must be at least 1", param: "page", bound: "0" }), { status: 400, headers: { "content-type": "application/json" } }, "the page must be at least 1", "this app", null],
    ["the database's own error string", JSON.stringify({ kind: "error", reading: "pending_claims", message: "canceling statement due to statement timeout" }), { status: 500, headers: { "content-type": "application/json" } }, "canceling statement due to statement timeout", "the machine", "pending_claims"],
  ] as const)("%s", async (_what, body, init, reason, author, identifier) => {
    const html = await moved(body, init);
    const face = faces(html);
    const wrote = author === "this app" ? face.sans : face.mono;
    const other = author === "this app" ? face.mono : face.sans;
    expect(wrote).toContain(reason);
    expect(other).not.toContain(reason);
    if (identifier === null) {
      expect(face.read).not.toContain(EM_DASH);
    } else {
      expect(face.mono).toContain(identifier);
      expect(face.sans).not.toContain(identifier);
      expect(face.read.split(EM_DASH)).toHaveLength(2);
      expect(face.isolated).toHaveLength(1);
      expect(face.isolated[0]).toContain(identifier);
      if (author === "this app") expect(face.isolated[0].trim()).toBe(identifier);
      else expect(face.isolated[0]).toContain(reason);
    }
    // Red, announced, above the controls, which stand because a refusal is
    // retryable at the same window.
    expect(classesOf($of(html)("[data-paging-refusal]").toString())).toContain("text-broken");
    expect($of(html)("[data-paging-refusal]").attr("role")).toBe("alert");
    expect(html.indexOf("data-paging-refusal")).toBeLessThan(html.indexOf("<nav"));
    expect(arm(html)).toBe("more");
  });

  it("draws an account carrying BOTH authors run by run, isolating only the machine's", async () => {
    const SAID = "canceling statement due to statement timeout";
    const CLAUSE = "and the words this app wrote about what it would not quote";
    const html = await moved(
      JSON.stringify({
        kind: "error",
        reading: "pending_claims",
        message: `${SAID} ${CLAUSE}`,
        authored: [{ words: SAID, author: "the machine" }, { words: CLAUSE, author: "this app" }],
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
    const face = faces(html);
    expect(face.mono).toContain(SAID);
    expect(face.mono).not.toContain(CLAUSE);
    expect(face.sans).toContain(CLAUSE);
    expect(face.sans).not.toContain(SAID);
    expect(face.read.indexOf(SAID)).toBeLessThan(face.read.indexOf(CLAUSE));
    expect(face.isolated).toHaveLength(1);
    expect(face.isolated[0]).toContain(SAID);
    expect(face.isolated[0]).not.toContain(CLAUSE);
  });

  it("derives the face from the carried fact alone: the words never decide it", () => {
    const asMachine = faces(surface(state(W1, pageOf(SIZE), { refusal: brokenArm(ANSWERED_BY_SOMETHING_ELSE, "the machine", "pending_claims") })));
    expect(asMachine.mono).toContain(ANSWERED_BY_SOMETHING_ELSE);
    expect(asMachine.sans).not.toContain(ANSWERED_BY_SOMETHING_ELSE);
    const asApp = faces(surface(state(W1, pageOf(SIZE), { refusal: brokenArm("canceling statement", "this app", "pending_claims") })));
    expect(asApp.sans).toContain("canceling statement");
    expect(asApp.mono).not.toContain("canceling statement");
  });
});

describe("the module's place in the tree", () => {
  it("is a client module, and the barrel re-exports only its component", () => {
    expect(sourceText("src/components/ui/paging.tsx").startsWith('"use client"')).toBe(true);
    expect(barrel.WindowControls).toBe(WindowControls);
    for (const value of ["usePageWindows", "fetchJson", "ANSWERED_BY_SOMETHING_ELSE", "UNREADABLE_ANSWER", "PagingProvider", "PagedWindowLine", "usePaging"]) {
      expect(value in barrel, value).toBe(false);
    }
  });

  it("holds the only network call under src/components, and it reaches nothing else", () => {
    const CALL = /(?<![\w$.])fetch\s*\(/g;
    const sites = sourceFiles()
      .filter((file) => file.startsWith("src/components/"))
      .flatMap((file) => (sourceText(file).match(CALL) ?? []).map(() => file));
    expect(sites).toEqual(["src/components/ui/paging.tsx"]);
    const code = codeLinesIn(sourceText("src/components/ui/paging.tsx")).join("\n");
    expect(code).not.toContain("@supabase/supabase-js");
    expect(code).not.toContain("lib/db/");
    expect(code).not.toContain("process.env");
    expect(code).not.toMatch(/fetch\s*\(\s*["'`]\w+:/);
  });
});
