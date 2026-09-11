import { afterEach, describe, expect, it, vi } from "vitest";

import * as barrel from "@/components/ui";
import { Button } from "@/components/ui/button";
import { PageMore, fetchJson, usePageRows } from "@/components/ui/paging";
import {
  MAX_PAGE_OFFSET,
  OFFSET_PARAM,
  PAGE_ROUTES,
  pageBound,
  type PageAnswer,
} from "@/lib/paging/bounds";
import { initialPage, pageUrl, requestPage, type PageState } from "@/lib/paging/machine";

import { codeLinesIn, sourceFiles, sourceText } from "../source-tree";
import {
  classesOf,
  disagreeingCounts,
  factoryTicketIds,
  h,
  render,
  runTogetherWords,
  uppercasedIdentifiers,
} from "./markup";

/**
 * The paging affordance — campaign admin-window/TASK-0064, SPEC F14.
 *
 * `PageMore` is a synchronous component over plain props, so every one of its
 * five states is a rendered-markup assertion here and none of them needs a
 * DOM, a browser or a request. `usePageRows` is the one thing in this repo
 * that reaches the network, and it IS driven here — see the last block for why
 * that is possible in a tier with no DOM, and for what the arrangement proves
 * that a composition test could not.
 */

type Row = { id: string };

const HOLDS = "claims";
const SIZE = 50;

/** A state a surface would really be in: a first screen, and nothing paged in yet. */
function state(over: Partial<PageState<Row>> = {}): PageState<Row> {
  return { rows: [], held: SIZE, status: "idle", refusal: null, ...over };
}

const more = (over: Partial<PageState<Row>> = {}): string =>
  render(h(PageMore, { state: state(over), holds: HOLDS, size: SIZE, onPress: () => {} }));

/** How many controls the markup drew. The control is a button; nothing else here is. */
const controls = (html: string): number => (html.match(/<button/g) ?? []).length;

/** Let every already-resolved promise in the chain run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("PageMore draws its five states from props", () => {
  it("idle: one control, naming what the next press gets", () => {
    const html = more();
    expect(controls(html)).toBe(1);
    expect(html).toContain('data-paging="more"');
    // The next window's size in its words — the operator is told what a press
    // costs, not "load more data".
    expect(html).toContain(`Show the next ${SIZE} ${HOLDS}`);
    expect(html).not.toContain('data-paging="exhausted"');
    expect(html).not.toContain('data-paging="limit"');
    expect(html).not.toContain("data-paging-refusal");
  });

  it("loading: the SAME control, inert", () => {
    const html = more({ status: "loading" });
    expect(controls(html)).toBe(1);
    expect(html).toContain('data-paging="loading"');
    expect(html).toContain("disabled");
    // A working button never becomes "…" (the Button primitive's own rule):
    // the label is what it was, so the control does not resize under the
    // pointer that is still over it.
    expect(html).toContain(`Show the next ${SIZE} ${HOLDS}`);
    expect(html).not.toContain('data-paging="more"');
  });

  it("exhausted: NO control at all, and one sentence saying the set is complete", () => {
    const html = more({ status: "exhausted", held: SIZE * 3 });
    expect(controls(html)).toBe(0);
    expect(html).toContain('data-paging="exhausted"');
    expect(html).not.toContain('data-paging="more"');
    expect(html).not.toContain('data-paging="loading"');
    // One sentence, and it names what the surface holds.
    expect((html.match(/<p/g) ?? []).length).toBe(1);
    expect(html).toContain(HOLDS);
  });

  it("a next bound past the ceiling: no control either, and it does NOT say the set is finished", () => {
    // The state the driver leaves a surface in past MAX_PAGE_OFFSET: a bound
    // refusal returns to `idle` by design, so without this arm the surface
    // would draw a control every press is refused for, forever (SPEC F10).
    const held = MAX_PAGE_OFFSET + SIZE;
    // Non-vacuity: the fixture really is a bound `pageBound` refuses, and the
    // status really is the one that would otherwise draw a control.
    expect(pageBound(String(held), SIZE).kind).toBe("refused");

    const html = more({ held });
    expect(controls(html)).toBe(0);
    expect(html).toContain('data-paging="limit"');
    // The set is NOT finished, and the surface must not say it is.
    expect(html).not.toContain('data-paging="exhausted"');
    expect((html.match(/<p/g) ?? []).length).toBe(1);
  });

  it("one window below the ceiling still draws the control, so the arm above is a rule and not a blanket", () => {
    // The must-NOT-flag fixture (LESSONS 8). The largest bound this app will
    // serve is MAX_PAGE_OFFSET itself, and a surface holding it is still one
    // press away from more rows.
    expect(pageBound(String(MAX_PAGE_OFFSET), SIZE).kind).toBe("ok");
    const html = more({ held: MAX_PAGE_OFFSET });
    expect(controls(html)).toBe(1);
    expect(html).toContain('data-paging="more"');
    expect(html).not.toContain('data-paging="limit"');
  });

  it("a refusal: the line names its object and the control STAYS, because a refusal is retryable", () => {
    const html = more({
      refusal: { reason: 'no relation "pending_claims" exists', object: "pending_claims" },
    });
    expect(html).toContain("data-paging-refusal");
    // Both halves: the object the answer named, the words it used, and what
    // the operator can do about it (LESSONS 1, CONTENT).
    expect(html).toContain("pending_claims");
    expect(html).toContain("no relation");
    expect(html).toMatch(/[Pp]ress it again/);
    // The bound did not move, so the control is still the same press.
    expect(controls(html)).toBe(1);
    expect(html).toContain('data-paging="more"');
  });

  it("a bound refusal names no third object, and gets the reason alone rather than a dangling dash", () => {
    // `PageRefusal.object` is null for a bound refusal: the bound the server
    // refused is the one this state already holds.
    const html = more({
      refusal: { reason: "that bound is not one this view serves", object: null },
    });
    expect(html).toContain("data-paging-refusal");
    expect(html).toContain("that bound is not one this view serves");
    expect(html).not.toContain("—");
  });

  it("a refusal on an exhausted set draws the line, and still no control", () => {
    const html = more({
      status: "exhausted",
      refusal: { reason: "the read failed", object: "pending_claims" },
    });
    expect(html).toContain("data-paging-refusal");
    expect(controls(html)).toBe(0);
    // And the fix it offers is one the operator can actually take: there is no
    // control left to press.
    expect(html).not.toMatch(/[Pp]ress it again/);
  });

  it("a refusal past the ceiling offers a fix the operator can actually take", () => {
    // No control is drawn there either, so "press it again" would be an
    // instruction to press nothing.
    const html = more({
      held: MAX_PAGE_OFFSET + SIZE,
      refusal: { reason: "the read failed", object: "pending_claims" },
    });
    expect(html).toContain("data-paging-refusal");
    expect(html).toContain('data-paging="limit"');
    expect(controls(html)).toBe(0);
    expect(html).not.toMatch(/[Pp]ress it again/);
  });

  it("leaves the row markup handed to the surface untouched, refusal or not", () => {
    // A refused page never half-fills the list and never re-draws it (M3 EC5).
    // The rows are the page's, so the proof is that the same row markup
    // renders byte-identically beside every state of this widget.
    const rows = h(
      "ul",
      { "data-rows": "" },
      ["a", "b", "c"].map((id) => h("li", { key: id }, id)),
    );
    const surface = (over: Partial<PageState<Row>>) =>
      render(
        h(
          "div",
          null,
          rows,
          h(PageMore, { state: state(over), holds: HOLDS, size: SIZE, onPress: () => {} }),
        ),
      );
    const listOf = (html: string) => /<ul[^]*<\/ul>/.exec(html)?.[0] ?? "";
    const clean = listOf(surface({}));
    expect(clean).toContain("<li>a</li>");
    for (const over of [
      { refusal: { reason: "the read failed", object: "pending_claims" } },
      { status: "loading" as const },
      { status: "exhausted" as const },
      { held: MAX_PAGE_OFFSET + SIZE },
    ]) {
      expect(listOf(surface(over)), JSON.stringify(over)).toBe(clean);
    }
  });
});

describe("the affordance's look", () => {
  const SAMPLES: { name: string; html: string }[] = [
    { name: "idle", html: more() },
    { name: "loading", html: more({ status: "loading" }) },
    { name: "exhausted", html: more({ status: "exhausted" }) },
    { name: "limit", html: more({ held: MAX_PAGE_OFFSET + SIZE }) },
    {
      name: "refused",
      html: more({ refusal: { reason: "no relation exists", object: "pending_claims" } }),
    },
    {
      name: "refused/exhausted",
      html: more({ status: "exhausted", refusal: { reason: "no relation exists", object: null } }),
    },
  ];

  const everyClass = () =>
    SAMPLES.flatMap((sample) =>
      classesOf(sample.html).map((className) => ({ sample: sample.name, className })),
    );
  const offenders = (predicate: (className: string) => boolean) =>
    everyClass()
      .filter(({ className }) => predicate(className))
      .map(({ sample, className }) => `${sample}: ${className}`);

  it("is the shared Button primitive, not a button this module drew", () => {
    // Derived by rendering the primitive rather than pinned as a literal, so
    // restyling Button moves this assertion with it and nothing here can drift
    // out of step with the rest of the app (LESSONS 5).
    const primitive = (disabled: boolean) =>
      classesOf(render(h(Button, { disabled }, "x"))).join(" ");
    expect(classesOf(more()).join(" ")).toContain(primitive(false));
    expect(classesOf(more({ status: "loading" })).join(" ")).toContain(primitive(true));
  });

  it("introduces no raw colour, spacing or type value", () => {
    expect(everyClass().length).toBeGreaterThan(5);
    expect(offenders((c) => c.includes("["))).toEqual([]);
    expect(offenders((c) => /#[0-9a-f]{3,8}/i.test(c))).toEqual([]);
    for (const sample of SAMPLES) expect(sample.html, sample.name).not.toMatch(/style="/);
    const RAMP =
      /-(gray|slate|zinc|neutral|stone|purple|violet|green|emerald|amber|orange|yellow|red|rose|blue|sky|indigo|pink|fuchsia)-\d{2,3}$/;
    expect(offenders((c) => RAMP.test(c))).toEqual([]);
    expect(offenders((c) => /(^|:)(bg|text|border)-(white|black)$/.test(c))).toEqual([]);
    expect(offenders((c) => c.startsWith("dark:"))).toEqual([]);
    expect(offenders((c) => c.startsWith("shadow"))).toEqual([]);
    // Text sized only through the five type steps.
    expect(offenders((c) => /^(text-(xs|sm|base|lg|xl|\d?xl)|text-\[)/.test(c))).toEqual([]);
    const steps = everyClass().filter(({ className }) => className.startsWith("type-"));
    expect(steps.length).toBeGreaterThan(0);
    for (const { className } of steps) {
      expect(["type-figure", "type-title", "type-body", "type-data", "type-micro"]).toContain(
        className,
      );
    }
    // Spacing on the 2/4/6/8/12/16/24 scale, and rounding only at the control radius.
    const SPACING = /^-?(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y)-([0-9.]+)$/;
    const IN_SCALE = new Set(["0", "0.5", "1", "1.5", "2", "3", "4", "6"]);
    expect(
      everyClass().filter(({ className }) => {
        const match = SPACING.exec(className);
        return match !== null && !IN_SCALE.has(match[2]);
      }),
    ).toEqual([]);
    for (const { className } of everyClass().filter((c) => c.className.startsWith("rounded"))) {
      expect(["rounded-control", "rounded-full"]).toContain(className);
    }
  });

  it("says the app's words, with no build id and no count that disagrees with its noun", () => {
    for (const sample of SAMPLES) {
      expect(runTogetherWords(sample.html), sample.name).toEqual([]);
      expect(factoryTicketIds(sample.html), sample.name).toEqual([]);
      expect(disagreeingCounts(sample.html), sample.name).toEqual([]);
      expect(uppercasedIdentifiers(sample.html), sample.name).toEqual([]);
    }
  });
});

describe("fetchJson — the one request, and what it may reject with", () => {
  const URL_ASKED = pageUrl(
    { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson },
    SIZE,
  );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A stubbed global that records what it was asked and answers `reply`. */
  function stub(reply: () => Response | Promise<never>) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return reply();
    });
    return calls;
  }

  it("asks the URL it was given, carrying this origin's own credentials", async () => {
    const calls = stub(
      () => new Response(JSON.stringify({ kind: "refused", reason: "x", bound: "1" })),
    );
    await fetchJson(URL_ASKED);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_ASKED);
    expect(calls[0].init?.credentials).toBe("same-origin");
  });

  it("does NOT reject on a non-ok status: a 400 carrying a refused answer reaches the driver", async () => {
    // The route answers a refused page as JSON with a status to match. Throwing
    // that body away for its status code would replace the reason the server
    // gave with one this app made up.
    const answer: PageAnswer<Row> = {
      kind: "refused",
      reason: "the `offset` must be a multiple of 50",
      bound: "51",
    };
    stub(() => new Response(JSON.stringify(answer), { status: 400 }));
    expect(await fetchJson(URL_ASKED)).toEqual(answer);

    // …and end to end: the driver reads it and refuses in the answer's words,
    // with the row list untouched.
    stub(() => new Response(JSON.stringify(answer), { status: 400 }));
    const next = await requestPage<Row>(
      { rows: [{ id: "a" }], held: SIZE, status: "idle", refusal: null },
      { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson },
    );
    expect(next.refusal?.reason).toBe(answer.reason);
    expect(next.rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("rejects with an Error carrying words, for every body and every rejection", async () => {
    // `requestPage`'s reasonOf renders a non-Error rejection with
    // String(thrown), so a rejection carrying undefined reaches the operator as
    // the word "undefined" in a refusal line. Nothing here may be a bare
    // string, null or undefined.
    const hostile: { name: string; reply: () => Response | Promise<never> }[] = [
      { name: "an HTML error page", reply: () => new Response("<html>502</html>", { status: 502 }) },
      { name: "an empty body", reply: () => new Response("", { status: 200 }) },
      { name: "a body that is only whitespace", reply: () => new Response("   ") },
      { name: "a rejection carrying undefined", reply: () => Promise.reject(undefined) },
      { name: "a rejection carrying null", reply: () => Promise.reject(null) },
      { name: "a rejection carrying a bare string", reply: () => Promise.reject("offline") },
      { name: "an Error with nothing to say", reply: () => Promise.reject(new Error("")) },
    ];
    for (const { name, reply } of hostile) {
      stub(reply);
      const thrown = await fetchJson(URL_ASKED).then(
        () => null,
        (error: unknown) => error,
      );
      expect(thrown, name).toBeInstanceOf(Error);
      const said = (thrown as Error).message;
      expect(said.length, name).toBeGreaterThan(0);
      // And words reach the operator, not the word "undefined".
      expect(said, name).not.toBe("undefined");
      expect(said, name).not.toBe("null");
      // The driver renders whatever this rejects with; it must be readable.
      const next = await requestPage<Row>(
        { rows: [], held: SIZE, status: "idle", refusal: null },
        { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson },
      );
      expect(next.refusal?.reason, name).toBe(said);
    }
  });

  it("passes a rejection's own words through when it has some", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchJson(URL_ASKED)).rejects.toThrow("Failed to fetch");
  });
});

describe("usePageRows binds the driver to a press", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The hook, driven with no DOM.
   *
   * `renderToStaticMarkup` runs hooks for the initial render, so a probe
   * component can hand its `press` back out; calling it afterwards is what a
   * click would do. **`setState` is a no-op in this renderer** — the `state`
   * this hook returns can never change here — which is exactly what makes the
   * assertions below discriminating: every one of them turns on the press
   * guard reading the CURRENT state through a ref. A guard reading the
   * `useState` value would see the initial state forever, ask for the same
   * bound twice, and never reach the `loading` arm at all.
   */
  function probe(initial: PageState<Row>, params = "") {
    // The press is captured on a box rather than a `let`: the assignment
    // happens inside a callback, which is exactly the shape control-flow
    // analysis cannot see.
    const captured: { press: (() => void) | null } = { press: null };
    const html = render(
      h(function Probe() {
        const bound = usePageRows<Row>(initial, {
          route: PAGE_ROUTES.claims,
          params,
          size: SIZE,
        });
        captured.press = bound.press;
        return h(PageMore, {
          state: bound.state,
          holds: HOLDS,
          size: SIZE,
          onPress: bound.press,
        });
      }),
    );
    const { press } = captured;
    if (press === null) throw new Error("the hook returned no press");
    return { html, press };
  }

  /** A stub that answers every request with `answer`, recording the URLs. */
  function answering(answer: PageAnswer<Row> | (() => Promise<never>)) {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return typeof answer === "function"
        ? answer()
        : Promise.resolve(new Response(JSON.stringify(answer)));
    });
    return urls;
  }

  const boundOf = (url: string): string | null =>
    new URLSearchParams(url.split("?")[1]).get(OFFSET_PARAM);

  it("renders the first screen's own affordance before any press", () => {
    const urls = answering({ kind: "ok", rows: [], offset: SIZE, exhausted: true });
    const { html } = probe(initialPage<Row>(SIZE, true));
    expect(html).toContain('data-paging="more"');
    // No press, no request.
    expect(urls).toEqual([]);
  });

  it("draws no control at all when the first screen said there is no more", () => {
    answering({ kind: "ok", rows: [], offset: SIZE, exhausted: true });
    const { html } = probe(initialPage<Row>(SIZE, false));
    expect(html).toContain('data-paging="exhausted"');
    expect(controls(html)).toBe(0);
  });

  it("one press, one request, at the bound the PRE-press state held", async () => {
    const urls = answering({ kind: "ok", rows: [{ id: "c" }], offset: SIZE, exhausted: false });
    const { press } = probe(initialPage<Row>(SIZE, true), "tab=standing");
    press();
    await settle();
    expect(urls).toHaveLength(1);
    expect(boundOf(urls[0])).toBe(String(SIZE));
    // The surface's own facets ride along, and the route is this app's own.
    expect(new URLSearchParams(urls[0].split("?")[1]).get("tab")).toBe("standing");
    expect(urls[0].startsWith(PAGE_ROUTES.claims)).toBe(true);
  });

  it("a second press while one is in flight issues NO second request", async () => {
    // The whole reason the interim `loading` state is published before the
    // await. All three presses happen in the same tick, so the only thing that
    // can stop the last two is a state the first one already published.
    const answer = Promise.withResolvers<Response>();
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return answer.promise;
    });

    const { press } = probe(initialPage<Row>(SIZE, true));
    press();
    press();
    press();
    expect(urls).toHaveLength(1);
    answer.resolve(
      new Response(
        JSON.stringify({ kind: "ok", rows: [{ id: "c" }], offset: SIZE, exhausted: false }),
      ),
    );
    await settle();
    expect(urls).toHaveLength(1);
  });

  it("a press after the answer lands asks for the NEXT bound, never the same one twice", async () => {
    const urls = answering({ kind: "ok", rows: [{ id: "c" }], offset: SIZE, exhausted: false });
    const { press } = probe(initialPage<Row>(SIZE, true));
    press();
    await settle();
    press();
    await settle();
    // One row arrived, so the bound grew by one — by what actually arrived,
    // never by what the answer claimed its offset was.
    expect(urls.map(boundOf)).toEqual([String(SIZE), String(SIZE + 1)]);
  });

  it("presses no further once the answer says the set is exhausted", async () => {
    const urls = answering({ kind: "ok", rows: [], offset: SIZE, exhausted: true });
    const { press } = probe(initialPage<Row>(SIZE, true));
    press();
    await settle();
    press();
    press();
    await settle();
    expect(urls).toHaveLength(1);
  });

  it("never throws out of the press, and a refusal leaves the press repeatable", async () => {
    const urls = answering(() => Promise.reject(new TypeError("Failed to fetch")));
    const { press } = probe(initialPage<Row>(SIZE, true));
    expect(() => press()).not.toThrow();
    await settle();
    expect(urls).toHaveLength(1);
    // The driver turned the rejection into a refusal and returned to idle, so
    // the same bound can be asked for again.
    press();
    await settle();
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(urls[0]);
  });

  it("fires its request from a ref, never from inside a setState updater", () => {
    // React 19 invokes a setState updater TWICE under StrictMode in
    // development, so a request fired from inside one is two requests from a
    // single press — the exact defect the loading arm exists to prevent, and
    // one no offline render can reproduce. The behavioural half is the
    // in-flight double press above; this is the structural half, and it is
    // cheap: the state setter is only ever handed a value.
    const source = sourceText("src/components/ui/paging.tsx");
    expect(source).toContain("useRef");
    expect(source.match(/setState\(/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/setState\(\s*(?:\(|function|async)/);
  });
});

describe("the module's place in the tree", () => {
  it("is a client module, and the barrel re-exports only its component", () => {
    // A server module importing a VALUE out of a "use client" module compiles,
    // lints and renders green offline, then answers 500 in a production build
    // (admin-window/BUG-0094). A re-export is an import for that rule, so the
    // server barrel may carry the component and nothing else.
    expect(sourceText("src/components/ui/paging.tsx").startsWith('"use client"')).toBe(true);
    expect(barrel.PageMore).toBe(PageMore);
    expect("usePageRows" in barrel).toBe(false);
    expect("fetchJson" in barrel).toBe(false);
  });

  it("holds the only network call under src/components, and it reaches nothing else", () => {
    // ARCHITECTURE §4 rule 1's framed exception: one call, one origin, by a
    // relative path. Asserted over the tree so the next paged surface cannot
    // quietly grow a second one (LESSONS 5).
    const CALL = /(?<![\w$.])fetch\s*\(/g;
    const sites = sourceFiles()
      .filter((file) => file.startsWith("src/components/"))
      .flatMap((file) => (sourceText(file).match(CALL) ?? []).map(() => file));
    expect(sites).toEqual(["src/components/ui/paging.tsx"]);

    // Read off the CODE, not the prose: the module's docstring names the very
    // things it may not import, which is documentation and not an edge.
    const code = codeLinesIn(sourceText("src/components/ui/paging.tsx")).join("\n");
    expect(code).not.toContain("@supabase/supabase-js");
    expect(code).not.toContain("lib/db/");
    expect(code).not.toContain("process.env");
    // No absolute origin: the one call takes the relative route the leaf spells.
    expect(code).not.toMatch(/fetch\s*\(\s*["'`]\w+:/);
  });
});

describe("a page that arrives short of the window", () => {
  /**
   * QA attack, admin-window/TASK-0064: the affordance and the driver disagree
   * about what a SHORT page means, and the disagreement ends paging for good.
   *
   * `requestPage`'s `ok` arm grows `held` by the rows that actually arrived and
   * ends in `exhausted` only when the answer SAID so or carried zero rows — so
   * an answer of 30 rows for a 50-row window with `exhausted: false` leaves
   * `held` at 80, one bound `pageBound` refuses for not being a multiple of the
   * window. `PageMore` then draws its `limit` arm: no control, and a sentence
   * saying this view shows no further rows — while the answer the operator just
   * received said the set continues. The rest of the set is unreachable without
   * a reload, which is the exact complaint FEAT-0015 exists to answer.
   *
   * The assertion is fix-agnostic on purpose. Either end is honest — the driver
   * may call a short page the end of the set (which its own `ok`-arm comment
   * already claims: "A short or empty page is the end of the set"), or the
   * route's contract may guarantee full-or-exhausted pages and the driver
   * refuse a short one out loud. What may NOT stand is the third outcome:
   * silently dropping the affordance while claiming nothing is wrong.
   *
   * Filed as admin-window/BUG-0168.
   */
  const short = (count: number, exhausted: boolean): Promise<PageState<Row>> =>
    requestPage<Row>(
      { rows: [], held: SIZE, status: "idle", refusal: null },
      {
        route: PAGE_ROUTES.claims,
        params: "",
        size: SIZE,
        fetchJson: async () => ({
          kind: "ok",
          rows: Array.from({ length: count }, (_, i) => ({ id: `r${i}` })),
          offset: SIZE,
          exhausted,
        }),
      },
    );

  // STRICT xfail — admin-window/BUG-0168. `it.fails` is red the day this
  // starts passing, which sends the next reader to the ticket instead of
  // letting the pin rot: flip it back to `it` as part of the fix.
  it.fails("still offers a way to the rest of the set, or says the set is complete", async () => {
    const next = await short(30, false);
    // Non-vacuity: the answer really did say the set continues, and the rows
    // really did arrive.
    expect(next.rows).toHaveLength(30);
    expect(next.status).not.toBe("exhausted");

    const html = render(
      h(PageMore, { state: next, holds: HOLDS, size: SIZE, onPress: () => {} }),
    );
    // One of the two honest endings, never the silent one.
    expect(controls(html) === 1 || html.includes('data-paging="exhausted"')).toBe(true);
    expect(html).not.toContain('data-paging="limit"');
  });

  it("a full window still pages on, so the case above is about the short page alone", async () => {
    // The must-NOT-flag fixture (LESSONS 8): the same path, one window wide.
    const next = await short(SIZE, false);
    expect(next.held).toBe(SIZE * 2);
    const html = render(
      h(PageMore, { state: next, holds: HOLDS, size: SIZE, onPress: () => {} }),
    );
    expect(controls(html)).toBe(1);
    expect(html).toContain('data-paging="more"');
  });
});
