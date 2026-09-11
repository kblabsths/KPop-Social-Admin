import * as cheerio from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as barrel from "@/components/ui";
import { EM_DASH } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  ANSWERED_BY_SOMETHING_ELSE,
  PageMore,
  PagedWindowLine,
  PagingProvider,
  UNREADABLE_ANSWER,
  fetchJson,
  usePageRows,
  usePaging,
} from "@/components/ui/paging";
import { WindowLine, type DrawnSentence, type DrawnWindow } from "@/components/ui/window-line";
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
  textOf,
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
  return { rows: [], held: SIZE, status: "idle", refusal: null, notes: null, ...over };
}

const more = (over: Partial<PageState<Row>> = {}): string =>
  render(h(PageMore, { state: state(over), holds: HOLDS, size: SIZE, onPress: () => {} }));

/** A page of rows, as a stub would serve it. A FULL window is `pageOf(SIZE)`. */
const pageOf = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}` }));

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

  it("exhausted on a bound that is off the grid — the legitimate FINAL page — still says the set is complete", () => {
    // admin-window/BUG-0168, the arm-ordering trap. A final page is allowed to
    // be short, so an exhausted surface's `held` may sit between two windows:
    // 80 against a window of 50. `pageBound` refuses that bound — and it
    // should, there is no next press to serve — but the sentence the operator
    // reads must be the set's completion, not "this view shows no further
    // rows", which is the very sentence this ticket exists to remove.
    const held = SIZE + 30;
    // Non-vacuity: the fixture really is the collision — a bound `pageBound`
    // refuses, on a state whose set really is finished.
    expect(pageBound(String(held), SIZE).kind).toBe("refused");

    const html = more({ status: "exhausted", held });
    expect(controls(html)).toBe(0);
    expect(html).toContain('data-paging="exhausted"');
    expect(html).not.toContain('data-paging="limit"');
    expect((html.match(/<p/g) ?? []).length).toBe(1);
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
      refusal: {
        reason: 'no relation "pending_claims" exists',
        object: "pending_claims",
        reasonFrom: "the machine",
      },
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
      refusal: {
        reason: "that bound is not one this view serves",
        object: null,
        reasonFrom: "this app",
      },
    });
    expect(html).toContain("data-paging-refusal");
    expect(html).toContain("that bound is not one this view serves");
    expect(html).not.toContain("—");
  });

  it("a refusal on an exhausted set draws the line, and still no control", () => {
    const html = more({
      status: "exhausted",
      refusal: { reason: "the read failed", object: "pending_claims", reasonFrom: "the machine" },
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
      refusal: { reason: "the read failed", object: "pending_claims", reasonFrom: "the machine" },
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
      {
        refusal: {
          reason: "the read failed",
          object: "pending_claims",
          reasonFrom: "the machine" as const,
        },
      },
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
      html: more({
        refusal: {
          reason: "no relation exists",
          object: "pending_claims",
          reasonFrom: "the machine",
        },
      }),
    },
    {
      name: "refused/exhausted",
      html: more({
        status: "exhausted",
        refusal: { reason: "no relation exists", object: null, reasonFrom: "the machine" },
      }),
    },
    {
      // Both faces are sampled, so the guards below scan the branch this app's
      // own prose renders through too (admin-window/BUG-0175).
      name: "refused/app-authored",
      html: more({
        refusal: {
          reason: ANSWERED_BY_SOMETHING_ELSE,
          object: PAGE_ROUTES.claims,
          reasonFrom: "this app",
        },
      }),
    },
    {
      name: "refused/app-authored, nothing to name",
      html: more({
        refusal: {
          reason: "a bound of 61 is not a multiple of the 50-row window",
          object: null,
          reasonFrom: "this app",
        },
      }),
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
    // `Response.json` is what both paging routes answer with (their `answer()`
    // helper), so it is what a fixture for "this app's route answered" uses:
    // `new Response(JSON.stringify(...))` declares `text/plain`, which is a
    // body from something ELSE (admin-window/TASK-0076).
    const calls = stub(() => Response.json({ kind: "refused", reason: "x", bound: "1" }));
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
    stub(() => Response.json(answer, { status: 400 }));
    expect(await fetchJson(URL_ASKED)).toEqual(answer);

    // …and end to end: the driver reads it and refuses in the answer's words,
    // with the row list untouched.
    stub(() => Response.json(answer, { status: 400 }));
    const next = await requestPage<Row>(
      { rows: [{ id: "a" }], held: SIZE, status: "idle", refusal: null, notes: null },
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
        { rows: [], held: SIZE, status: "idle", refusal: null, notes: null },
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

/**
 * WHAT ANSWERED, BEFORE WHAT THE BODY SAYS — campaign admin-window/TASK-0076.
 *
 * MEASURED: a session that expires mid-walk is answered with the login
 * redirect, FOLLOWED to an HTML page at status **200**. `response.json()`
 * rejected with the JSON parser's own `SyntaxError`, `asError` passed its words
 * through, and `requestPage`'s `reasonOf` put them in the refusal slot — so the
 * operator read the parser's vocabulary as this app's account of why the press
 * added no rows. Same class as admin-window/BUG-0170 (text this app did not
 * author inside a sentence it wrote), and not covered by it: that fix is inside
 * `errorMessage` in `lib/db/result.ts`, which this path never touches.
 *
 * `response.ok` is deliberately not the discriminator — the measured defect
 * arrives at 200, and a 400 carrying a refused page is the operator's own
 * refusal (pinned above, unchanged).
 */
describe("fetchJson asks what ANSWERED before it reads the body", () => {
  const URL_ASKED = pageUrl(
    { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson },
    SIZE,
  );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answeredWith(body: BodyInit | null, init?: ResponseInit): void {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(body, init)));
  }

  /** Whatever `fetchJson` rejected with, or a failure naming what it resolved. */
  async function rejection(): Promise<Error> {
    const thrown = await fetchJson(URL_ASKED).then(
      (value) => ({ resolved: value }),
      (error: unknown) => error,
    );
    expect(thrown, JSON.stringify(thrown)).toBeInstanceOf(Error);
    return thrown as Error;
  }

  /**
   * The refusal AS READ, not as escaped: React writes `'` as `&#x27;` and `<`
   * as `&lt;`, so a body fragment that leaked would hide from a raw substring
   * check behind its own escape.
   */
  const readable = (html: string): string =>
    textOf(html)
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

  /** The measured fixture: the login page, followed, at status 200. */
  const LOGIN_PAGE =
    '<!doctype html><html><head><title>Sign in</title></head><body>' +
    '<form action="/api/auth/callback"><input name="csrfToken" value="7f3a"></form>' +
    "</body></html>";

  const NOT_THIS_APP: ReadonlyArray<readonly [string, BodyInit | null, ResponseInit]> = [
    [
      "the measured one: an HTML login page at status 200",
      LOGIN_PAGE,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    ],
    [
      "a text/plain proxy page",
      "502 Bad Gateway (proxy)",
      { status: 502, headers: { "content-type": "text/plain" } },
    ],
    ["no content-type header at all", "{}", { status: 200, headers: {} }],
    ["an empty body", null, { status: 200 }],
  ];

  it("refuses in the app's own words when something else answered, on four fixtures", async () => {
    for (const [name, body, init] of NOT_THIS_APP) {
      answeredWith(body, init);
      const thrown = await rejection();
      expect(thrown.message, name).toBe(ANSWERED_BY_SOMETHING_ELSE);
    }
  });

  it("the operator's refusal is EXACTLY that sentence, with this app's own route as its object", async () => {
    // End to end: through the driver, which names `deps.route` on this arm.
    for (const [name, body, init] of NOT_THIS_APP) {
      answeredWith(body, init);
      const next = await requestPage<Row>(
        { rows: [{ id: "a" }], held: SIZE, status: "idle", refusal: null, notes: null },
        { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson },
      );
      expect(next.refusal?.reason, name).toBe(ANSWERED_BY_SOMETHING_ELSE);
      expect(next.refusal?.object, name).toBe(PAGE_ROUTES.claims);
      // A refusal never half-fills the list, whatever it was refused for.
      expect(next.rows.map((row) => row.id), name).toEqual(["a"]);
      expect(next.held, name).toBe(SIZE);
      expect(next.status, name).toBe("idle");
    }
  });

  it("the RENDERED refusal quotes nothing this app did not author", async () => {
    // The login-page fixture, all the way to the markup an operator reads: no
    // fragment of the body, no content type, no status code, and none of the
    // JSON parser's vocabulary.
    const [, body, init] = NOT_THIS_APP[0];
    answeredWith(body, init);
    const next = await requestPage<Row>(
      { rows: [], held: SIZE, status: "idle", refusal: null, notes: null },
      { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson },
    );
    const shown = readable(
      render(h(PageMore, { state: next, holds: HOLDS, size: SIZE, onPress: () => {} })),
    );
    // Non-vacuity: the refusal really is on screen.
    expect(shown).toContain(ANSWERED_BY_SOMETHING_ELSE);
    for (const forbidden of [/JSON/i, /token/, /</, /SyntaxError/]) {
      expect(shown, String(forbidden)).not.toMatch(forbidden);
    }
    // Nor the body, the declared type, or the status.
    for (const fragment of ["doctype", "csrfToken", "7f3a", "Sign in", "text/html", "200", "502"]) {
      expect(shown, fragment).not.toContain(fragment);
    }
  });

  it("a body that DECLARES json and does not parse refuses on the same terms", async () => {
    // A truncated document, sent as `application/json`.
    for (const truncated of ['{"kind":"ok","rows":[{"id":', "", "   "]) {
      answeredWith(truncated, { status: 200, headers: { "content-type": "application/json" } });
      const thrown = await rejection();
      expect(thrown.message, JSON.stringify(truncated)).toBe(UNREADABLE_ANSWER);
    }

    answeredWith('{"kind":"ok","rows":[{"id":', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const next = await requestPage<Row>(
      { rows: [{ id: "a" }], held: SIZE, status: "idle", refusal: null, notes: null },
      { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson },
    );
    expect(next.refusal?.reason).toBe(UNREADABLE_ANSWER);
    expect(next.refusal?.object).toBe(PAGE_ROUTES.claims);
    expect(next.rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("both sentences are the app's voice, and neither is one of its generic apologies", async () => {
    const sentences = [ANSWERED_BY_SOMETHING_ELSE, UNREADABLE_ANSWER];
    // Two DIFFERENT accounts: "something else answered" and "the answer broke
    // off" are not the same fact, and one sentence for both would be an
    // apology rather than a report.
    expect(new Set(sentences).size).toBe(2);
    for (const sentence of sentences) {
      expect(sentence.length, sentence).toBeGreaterThan(20);
      // Quotes nothing: no parser vocabulary, no media type, no figure.
      for (const forbidden of [/JSON/i, /SyntaxError/, /content-type/i, /status/i, /\d/]) {
        expect(sentence, String(forbidden)).not.toMatch(forbidden);
      }
      // Distinct from the app's existing generic lines, so a refusal says
      // which of them happened (LESSONS 11 — one row, one verdict).
      expect(sentence).not.toBe("the page request failed before it answered");
      expect(sentence).not.toBe("the page request answered something this app cannot read");
    }
  });

  it("must NOT flag: every spelling of a declared json answer still reaches the driver", async () => {
    // The passing half (LESSONS 8). The media type is compared on a canonical
    // form, not against a list of spellings someone thought of (LESSONS 4).
    const answer: PageAnswer<Row> = { kind: "ok", rows: pageOf(SIZE), offset: SIZE, exhausted: false };
    for (const declared of [
      "application/json",
      "application/json; charset=utf-8",
      "application/json;charset=UTF-8",
      "APPLICATION/JSON",
      "Application/Json; charset=utf-8",
      "  application/json  ",
    ]) {
      answeredWith(JSON.stringify(answer), { status: 200, headers: { "content-type": declared } });
      expect(await fetchJson(URL_ASKED), declared).toEqual(answer);
    }
  });

  it("a media type that merely LOOKS like json is something else answering", async () => {
    // `application/json` with parameters, and nothing else: a suffix type or a
    // different tree is not this app's route, which answers `Response.json`.
    for (const declared of ["application/jsonl", "text/json", "application/ld+json", "json"]) {
      answeredWith("{}", { status: 200, headers: { "content-type": declared } });
      expect((await rejection()).message, declared).toBe(ANSWERED_BY_SOMETHING_ELSE);
    }
  });

  it("reads the body ONCE and only after the declaration, still one request per press", async () => {
    // The body is never read at all when something else answered: an HTML page
    // reaches no parser, which is the whole point of the discriminator.
    const calls: string[] = [];
    const response = new Response(LOGIN_PAGE, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    // Own properties shadow the prototype's readers; `headers` is untouched.
    for (const reader of ["json", "text"] as const) {
      Object.defineProperty(response, reader, {
        configurable: true,
        value: () => {
          calls.push(reader);
          return Promise.reject(new Error("the body was read"));
        },
      });
    }
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return Promise.resolve(response);
    });
    expect((await rejection()).message).toBe(ANSWERED_BY_SOMETHING_ELSE);
    expect(calls).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it("a PLATFORM rejection still passes its own words through", async () => {
    // Unchanged: `Failed to fetch` is the transport's account of a request
    // that never happened, not a foreign body quoted back as ours.
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    expect((await rejection()).message).toBe("Failed to fetch");
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
        // `Response.json`, because that is what this app's routes answer with
        // and `fetchJson` now reads the declared type (admin-window/TASK-0076).
        : Promise.resolve(Response.json(answer));
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
      Response.json({ kind: "ok", rows: [{ id: "c" }], offset: SIZE, exhausted: false }),
    );
    await settle();
    expect(urls).toHaveLength(1);
  });

  it("a press after the answer lands asks for the NEXT bound, never the same one twice", async () => {
    // A FULL window, and the bound grows by the window (admin-window/BUG-0168,
    // ruled full-or-exhausted): the answer used to carry one row and the bound
    // used to grow by one, which is the very step that walked `held` off the
    // grid `pageBound` enforces. What this case grades is unchanged — the
    // second press asks for a bound the first press produced, never the same
    // one twice — and the answer's own `offset` still never reaches the state.
    const urls = answering({ kind: "ok", rows: pageOf(SIZE), offset: 999, exhausted: false });
    const { press } = probe(initialPage<Row>(SIZE, true));
    press();
    await settle();
    press();
    await settle();
    expect(urls.map(boundOf)).toEqual([String(SIZE), String(SIZE * 2)]);
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

  /** The control's own words, without pinning the sentence around them. */
  const controlText = (html: string): string =>
    /<button[^>]*>([^]*?)<\/button>/.exec(html)?.[1]?.replace(/<[^>]*>/g, "") ?? "";

  it("a surface spells the window ONCE: the driver grades against the number the control renders", async () => {
    // QA residual 4, folded into admin-window/BUG-0168: `PageDeps.size` was
    // never read, so the window was supplied twice — once to the driver, once
    // to `PageMore` — and reconciled nowhere. The surface below spells it in
    // ONE place and feeds the widget from the hook's own return, and the two
    // halves are then read off ONE fixture: the same 7-row answer LANDS
    // against a window of 7 (the next press moves on to 14) and is REFUSED
    // against a window of 8 (the next press asks for 8 again) — so the number
    // the driver graded the page against is the number the control names.
    const SERVED = 7;
    const consumer = async (
      windowSize: number,
    ): Promise<{ bounds: (string | null)[]; label: string }> => {
      const urls = answering({
        kind: "ok",
        rows: pageOf(SERVED),
        offset: windowSize,
        exhausted: false,
      });
      const captured: { press: (() => void) | null } = { press: null };
      const html = render(
        h(function Surface() {
          // The ONE spelling of this surface's window.
          const bound = usePageRows<Row>(initialPage<Row>(windowSize, true), {
            route: PAGE_ROUTES.claims,
            params: "",
            size: windowSize,
          });
          captured.press = bound.press;
          // …and the widget is fed from the hook, never retyped beside it.
          return h(PageMore, {
            state: bound.state,
            holds: HOLDS,
            size: bound.size,
            onPress: bound.press,
          });
        }),
      );
      const { press } = captured;
      if (press === null) throw new Error("the hook returned no press");
      press();
      await settle();
      press();
      await settle();
      return { bounds: urls.map(boundOf), label: controlText(html) };
    };

    const landed = await consumer(SERVED);
    const refused = await consumer(SERVED + 1);

    expect(landed.bounds).toEqual([String(SERVED), String(SERVED * 2)]);
    expect(refused.bounds).toEqual([String(SERVED + 1), String(SERVED + 1)]);
    // The control names the same window the driver just graded against — the
    // number, not the sentence around it.
    expect(landed.label).toContain(String(SERVED));
    expect(landed.label).not.toContain(String(SERVED + 1));
    expect(refused.label).toContain(String(SERVED + 1));
    expect(refused.label).not.toContain(String(SERVED));
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

/**
 * ONE surface, ONE state — the provider, and the window line that reads it
 * (campaign admin-window/BUG-0172).
 *
 * The defect: a paged surface's window line was the PAGE's, server-rendered
 * above a wrapper that changes the rows underneath it, so after a press the
 * page published two answers to one question. The mechanism here is the fix —
 * a zero-markup provider that publishes the one state, and a line that renders
 * the shared primitive from it.
 */
describe("PagingProvider publishes one surface's state, and draws nothing", () => {
  const WINDOW: DrawnWindow = {
    limit: SIZE,
    held: SIZE,
    truncated: true,
    over: "view",
    oldest: null,
    scope: null,
  };
  const CATALOG: DrawnSentence = { of: "catalog", rows: "events" };

  /** The line, rendered inside a surface whose state is `state`. */
  const paged = (state: PageState<Row>, window: DrawnWindow = WINDOW): string =>
    render(
      h(
        PagingProvider,
        {
          initial: state,
          deps: { route: PAGE_ROUTES.browse, params: "", size: SIZE },
          children: null,
        },
        h(PagedWindowLine, { gauge: "events", window, shows: CATALOG }),
      ),
    );

  const hooks = (html: string) => {
    const line = cheerio.load(html)("[data-window]");
    return {
      lines: line.length,
      held: line.attr("data-window-held"),
      truncated: line.attr("data-window-truncated"),
    };
  };

  it("renders no markup of its own: the children are the whole output", () => {
    const child = h("span", { "data-probe": "" }, "rows");
    const wrapped = render(
      h(
        PagingProvider,
        {
          initial: initialPage<Row>(SIZE, true),
          deps: { route: PAGE_ROUTES.browse, params: "", size: SIZE },
          children: null,
        },
        child,
      ),
    );
    expect(wrapped).toBe(render(child));
  });

  it("renders the page's own window line, to the byte, before any press", () => {
    // SPEC F14: the first screen does not change. The page composes the facts
    // once and hands the same object to either component, so the paged arm and
    // the unpaged one are the same element with the same hooks and the same
    // words until a press changes what the operator holds.
    expect(paged(initialPage<Row>(SIZE, true))).toBe(
      render(h(WindowLine, { gauge: "events", window: WINDOW, shows: CATALOG })),
    );
  });

  it("takes truncation from the paging state's status and from nothing else", () => {
    // Offered, in flight and refused all still hold rows back; only the read's
    // own answer that the set has ended says otherwise (LESSONS 11).
    const states: [string, PageState<Row>][] = [
      ["idle", initialPage<Row>(SIZE, true)],
      ["loading", { ...initialPage<Row>(SIZE, true), status: "loading" }],
      [
        "refused",
        {
          ...initialPage<Row>(SIZE, true),
          refusal: {
            reason: "the view is not provisioned",
            object: "pending_claims",
            reasonFrom: "this app",
          },
        },
      ],
    ];
    for (const [name, state] of states) {
      expect(hooks(paged(state)).truncated, name).toBe("true");
    }
    expect(hooks(paged(initialPage<Row>(SIZE, false))).truncated).toBe("false");
  });

  it("whose number held is, is a fact the window states, never a size it compares", () => {
    // admin-window/BUG-0174, BUG-0172's residual (a). Two shapes of `held`, two
    // behaviours: a window whose `held` counts ITS OWN rows grows with the rows
    // a press appends (`/browse`, whose line was stuck at 50 under 100 rows),
    // and one whose `held` came from a separate COUNT read stands unmoved while
    // rows are appended under it (`/claims`, whose hook the live paged-walk
    // oracle grades the walk against).
    //
    // This component used to guess between them by asking which number was
    // bigger than the cap — one field with two meanings, told apart by size.
    // The cases below are the two the heuristic gets WRONG, so nothing here
    // can pass by comparing anything to `limit`.
    const continued: PageState<Row> = {
      rows: pageOf(SIZE),
      held: SIZE * 2,
      status: "idle",
      refusal: null,
      notes: null,
    };

    // Stated "this window": it grows with the rows, whatever its number is —
    // including a number ABOVE the cap, which the heuristic froze.
    expect(hooks(paged(continued, { ...WINDOW, heldFrom: "this window" })).held).toBe(
      String(SIZE * 2),
    );
    expect(
      hooks(paged(continued, { ...WINDOW, held: 877, heldFrom: "this window" })).held,
    ).toBe(String(SIZE * 2));

    // Stated "a count read": it stands, whatever its number is — including a
    // count UNDER the cap, which the heuristic overwrote with the row count.
    expect(
      hooks(paged(continued, { ...WINDOW, held: 877, heldFrom: "a count read" })).held,
    ).toBe("877");
    expect(
      hooks(paged(continued, { ...WINDOW, held: 12, heldFrom: "a count read" })).held,
    ).toBe("12");

    // Absent is "this window": the nine unpaged lines mean exactly that, and no
    // call site of them changes.
    expect(hooks(paged(continued)).held).toBe(String(SIZE * 2));

    // …and the fact reaches the markup only through `held`: no attribute is
    // added for it, in either statement (SPEC F14, §5).
    for (const heldFrom of ["this window", "a count read"] as const) {
      const attrs = Object.keys(
        cheerio.load(paged(continued, { ...WINDOW, heldFrom }))("[data-window]").attr() ?? {},
      ).filter((name) => name.startsWith("data-window"));
      expect(attrs.sort(), heldFrom).toEqual(
        Object.keys(cheerio.load(paged(continued))("[data-window]").attr() ?? {})
          .filter((name) => name.startsWith("data-window"))
          .sort(),
      );
    }
  });

  it("renders the line without comparing any number to the cap", () => {
    // The other half of the criterion: the component READS the window's
    // statement and derives nothing from the cap's size. Read off the code, so
    // the next hand at this file cannot quietly reintroduce the heuristic.
    const code = codeLinesIn(sourceText("src/components/ui/paging.tsx")).join("\n");
    expect(code).toContain("heldFrom");
    expect(code).not.toContain("first.limit");
    expect(code).not.toMatch(/held\s*[<>]=?\s*/);
  });

  it("is ONE element in every state a press can end in", () => {
    for (const state of [
      initialPage<Row>(SIZE, true),
      { ...initialPage<Row>(SIZE, true), status: "loading" as const },
      initialPage<Row>(SIZE, false),
    ]) {
      expect(hooks(paged(state)).lines).toBe(1);
    }
  });

  it("refuses to draw a paged surface outside its provider", () => {
    // A default would be a paging state no read produced, drawn under rows
    // some read did.
    expect(() =>
      render(h(PagedWindowLine, { gauge: "events", window: WINDOW, shows: CATALOG })),
    ).toThrow();
    expect(() => render(h(function Probe() {
      usePaging();
      return null;
    }))).toThrow();
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
    // The two refusal sentences are VALUES too (admin-window/TASK-0076): the
    // rule is about what crosses, not about what kind of value it is.
    expect("ANSWERED_BY_SOMETHING_ELSE" in barrel).toBe(false);
    expect("UNREADABLE_ANSWER" in barrel).toBe(false);
    // The two components a PAGE renders out of this module are imported
    // straight from it, the way the wrappers import `usePageRows`: the barrel
    // is a server module and every server module that imports it takes on
    // whatever it re-exports, so it is not widened by one export
    // (admin-window/BUG-0172).
    expect("PagingProvider" in barrel).toBe(false);
    expect("PagedWindowLine" in barrel).toBe(false);
    expect("usePaging" in barrel).toBe(false);
    expect(Object.keys(barrel).filter((name) => name.startsWith("Page"))).toContain("PageMore");
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
  /** The answer the stub serves, and the state the driver reached from it. */
  type ServedPage = Extract<PageAnswer<Row>, { kind: "ok" }>;
  const short = async (
    count: number,
    exhausted: boolean,
  ): Promise<{ answer: ServedPage; next: PageState<Row> }> => {
    const answer: ServedPage = {
      kind: "ok",
      rows: pageOf(count),
      offset: SIZE,
      exhausted,
    };
    const next = await requestPage<Row>(
      { rows: [], held: SIZE, status: "idle", refusal: null, notes: null },
      {
        route: PAGE_ROUTES.claims,
        params: "",
        size: SIZE,
        fetchJson: async () => answer,
      },
    );
    return { answer, next };
  };

  // The pin, flipped back to a plain `it` by the fix — admin-window/BUG-0168,
  // RULED (b): the route contract is full-or-exhausted and the driver refuses
  // anything else out loud.
  it("still offers a way to the rest of the set, or says the set is complete", async () => {
    const { answer, next } = await short(30, false);
    // Non-vacuity, re-expressed against the ANSWER the stub served rather than
    // the resulting state, because the ruled ending appends nothing: under (b)
    // a short continuing page is REFUSED, so `next.rows` is empty by design and
    // the original `expect(next.rows).toHaveLength(30)` would now assert the
    // fix away. What the fixture has to be is unchanged — a page short of the
    // window that says the set continues — and that is what is checked here.
    expect(answer.rows).toHaveLength(30);
    expect(answer.exhausted).toBe(false);

    const html = render(
      h(PageMore, { state: next, holds: HOLDS, size: SIZE, onPress: () => {} }),
    );
    // One of the two honest endings, never the silent one. (Unchanged.)
    expect(controls(html) === 1 || html.includes('data-paging="exhausted"')).toBe(true);
    expect(html).not.toContain('data-paging="limit"');
  });

  it("a full window still pages on, so the case above is about the short page alone", async () => {
    // The must-NOT-flag fixture (LESSONS 8): the same path, one window wide.
    const { next } = await short(SIZE, false);
    expect(next.held).toBe(SIZE * 2);
    const html = render(
      h(PageMore, { state: next, holds: HOLDS, size: SIZE, onPress: () => {} }),
    );
    expect(controls(html)).toBe(1);
    expect(html).toContain('data-paging="more"');
  });
});


/**
 * WHICH WORDS ARE THE MACHINE'S — admin-window/BUG-0175.
 *
 * Mono carries every value the database produced; sans carries every word the
 * app wrote, and that split IS the typographic idea (LOOK_AND_FEEL → The Look
 * → Typography; ARCHITECTURE.md §7). This line put both authors in the one
 * mono span, so an operator reading `canceling statement due to statement
 * timeout` and `the page request answered something this app cannot read` saw
 * the same 11px mono red run and could not tell who was talking.
 *
 * Every arm below is driven END TO END — a stubbed `fetch`, the real
 * `fetchJson`, the real driver, the rendered markup — so what is graded is
 * what an operator reads, not what a fixture asserts about itself.
 */
describe("the refusal line says who wrote the words", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const AS_JSON = { status: 200, headers: { "content-type": "application/json" } };
  const DEPS = { route: PAGE_ROUTES.claims, params: "", size: SIZE, fetchJson };
  const BEFORE: PageState<Row> = {
    rows: [{ id: "a" }],
    held: SIZE,
    status: "idle",
    refusal: null,
    notes: null,
  };

  /** One press against a stubbed wire, rendered. */
  async function pressed(body: BodyInit | null, init: ResponseInit): Promise<string> {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(body, init)));
    const next = await requestPage<Row>(BEFORE, DEPS);
    expect(next.refusal, String(body)).not.toBeNull();
    // A refusal never half-fills the list, moves the bound or ends the set.
    expect(next.rows.map((row) => row.id)).toEqual(["a"]);
    expect(next.held).toBe(SIZE);
    expect(next.status).toBe("idle");
    return render(h(PageMore, { state: next, holds: HOLDS, size: SIZE, onPress: () => {} }));
  }

  /**
   * The refusal line, read by type step: what is mono, what is sans, what the
   * bidi isolation wraps, and the whole line AS READ — cheerio decodes the
   * entities React writes, so an apostrophe in one of the app's own sentences
   * does not hide the sentence from a substring check.
   */
  function faces(html: string): {
    mono: string;
    sans: string;
    isolated: string[];
    read: string;
  } {
    const $ = cheerio.load(html);
    const line = $("[data-paging-refusal]");
    expect(line).toHaveLength(1);
    const step = (name: string): string =>
      line
        .find(`span.${name}`)
        .toArray()
        .map((element) => $(element).text())
        .join(" ");
    return {
      mono: step("type-data"),
      sans: step("type-body"),
      isolated: line
        .find("[dir='ltr']")
        .toArray()
        .map((element) => $(element).text()),
      read: line.text(),
    };
  }

  /** The five arms the designer measured, as the wire delivers each one. */
  const ARMS: ReadonlyArray<{
    name: string;
    body: BodyInit | null;
    init: ResponseInit;
    /** The words on the line beside the identifier, and who wrote them. */
    reason: string;
    author: "this app" | "the machine";
    /** The machine identifier that must stay mono on every arm. */
    identifier: string | null;
  }> = [
    {
      name: "(a) something other than this app's route answered",
      body: "<!doctype html><html><body>Sign in</body></html>",
      init: { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      reason: ANSWERED_BY_SOMETHING_ELSE,
      author: "this app",
      identifier: PAGE_ROUTES.claims,
    },
    {
      name: "(b) a truncated body declared application/json",
      body: '{"kind":"ok","rows":[{"id":',
      init: AS_JSON,
      reason: UNREADABLE_ANSWER,
      author: "this app",
      identifier: PAGE_ROUTES.claims,
    },
    {
      name: "(c) a body that is not a page answer",
      body: '{"rows":[{"id":"c"}]}',
      init: AS_JSON,
      reason: "the page request answered something this app cannot read",
      author: "this app",
      identifier: PAGE_ROUTES.claims,
    },
    {
      name: "(d) the route's own bound refusal",
      body: JSON.stringify({
        kind: "refused",
        reason: "a bound of 61 is not a multiple of the 50-row window",
        bound: "61",
      }),
      init: { status: 400, headers: { "content-type": "application/json" } },
      reason: "a bound of 61 is not a multiple of the 50-row window",
      author: "this app",
      // A bound refusal is about the bound this state already holds, so there
      // is no third thing to name.
      identifier: null,
    },
    {
      name: "(e) the database's own error string",
      body: JSON.stringify({
        kind: "error",
        reading: "pending_claims",
        message: "canceling statement due to statement timeout",
      }),
      init: { status: 500, headers: { "content-type": "application/json" } },
      reason: "canceling statement due to statement timeout",
      author: "the machine",
      identifier: "pending_claims",
    },
  ];

  it("a reason this app wrote reads in sans, a reason the answer carried reads in mono", async () => {
    // The two faces pinned SIDE BY SIDE, on the two arms the designer measured
    // one press apart: the app's 22-word sentence about a page it could not
    // read, and Postgres' own timeout string.
    const [answeredByElse] = ARMS;
    const app = faces(await pressed(answeredByElse.body, answeredByElse.init));
    expect(app.sans).toContain(ANSWERED_BY_SOMETHING_ELSE);
    expect(app.mono).not.toContain(ANSWERED_BY_SOMETHING_ELSE);

    const failed = ARMS[4];
    const machine = faces(await pressed(failed.body, failed.init));
    expect(machine.mono).toContain("canceling statement due to statement timeout");
    expect(machine.sans).not.toContain("canceling statement due to statement timeout");
  });

  it("grades every arm a press can reach: four sentences this app wrote, and one it did not", async () => {
    const authors = new Set<string>();
    for (const arm of ARMS) {
      const face = faces(await pressed(arm.body, arm.init));
      const wrote = arm.author === "this app" ? face.sans : face.mono;
      const other = arm.author === "this app" ? face.mono : face.sans;
      expect(wrote, arm.name).toContain(arm.reason);
      expect(other, arm.name).not.toContain(arm.reason);
      authors.add(arm.author);
    }
    expect([...authors].sort()).toEqual(["the machine", "this app"]);
    // Four of the five are the app's own prose, which is what the ticket says.
    expect(ARMS.filter((arm) => arm.author === "this app")).toHaveLength(4);
  });

  it("the identifier stays mono on every arm, and dir=ltr isolates exactly the run this app did not write", async () => {
    for (const arm of ARMS) {
      const html = await pressed(arm.body, arm.init);
      const face = faces(html);
      if (arm.identifier === null) {
        // Nothing to name, so no dangling em dash either.
        expect(face.read, arm.name).not.toContain(EM_DASH);
        continue;
      }
      // The route path and the object the answer named are machine
      // identifiers: mono in every arm, never in the app's sans run.
      expect(face.mono, arm.name).toContain(arm.identifier);
      expect(face.sans, arm.name).not.toContain(arm.identifier);
      // One em dash, separating the identifier from the reason.
      expect(face.read.split(EM_DASH), arm.name).toHaveLength(2);
      // The isolated run is the foreign one — the identifier alone where the
      // reason is ours, the identifier and the reason where it is not.
      expect(face.isolated, arm.name).toHaveLength(1);
      expect(face.isolated[0], arm.name).toContain(arm.identifier);
      if (arm.author === "this app") {
        expect(face.isolated[0].trim(), arm.name).toBe(arm.identifier);
      } else {
        expect(face.isolated[0], arm.name).toContain(arm.reason);
      }
    }
  });

  it("the order, the markers, the red and the control are what they were", async () => {
    for (const arm of ARMS) {
      const html = await pressed(arm.body, arm.init);
      // Identifier, then reason, then the fix in the app's voice.
      const { read } = faces(html);
      const at = (needle: string): number => read.indexOf(needle);
      if (arm.identifier !== null) {
        expect(at(arm.identifier), arm.name).toBeLessThan(at(arm.reason));
      }
      expect(at(arm.reason), arm.name).toBeLessThan(at("Press it again"));
      // The line itself: same marker, same role, same red, still above the
      // control, and the control is still there because a refusal is
      // retryable at the same bound.
      expect(html, arm.name).toContain("data-paging-refusal");
      expect(html, arm.name).toContain('role="alert"');
      expect(classesOf(html), arm.name).toContain("text-broken");
      expect(html.indexOf("data-paging-refusal"), arm.name).toBeLessThan(html.indexOf("<button"));
      expect(controls(html), arm.name).toBe(1);
      expect(html, arm.name).toContain('data-paging="more"');
      // Only the five type steps, on the line and around it.
      for (const className of classesOf(html).filter((c) => c.startsWith("type-"))) {
        expect(["type-figure", "type-title", "type-body", "type-data", "type-micro"]).toContain(
          className,
        );
      }
    }
  });

  it("derives the face from the fact alone: the words never decide it here", () => {
    // The component is handed a refusal whose words say one thing and whose
    // `reasonFrom` says the other, BOTH ways round. A component comparing the
    // reason to one of this module's constants fails both halves; one reading
    // the carried fact passes both. No string comparison can survive this.
    const asMachine = faces(
      more({
        refusal: {
          reason: ANSWERED_BY_SOMETHING_ELSE,
          object: "pending_claims",
          reasonFrom: "the machine",
        },
      }),
    );
    expect(asMachine.mono).toContain(ANSWERED_BY_SOMETHING_ELSE);
    expect(asMachine.sans).not.toContain(ANSWERED_BY_SOMETHING_ELSE);

    const asApp = faces(
      more({
        refusal: {
          reason: "canceling statement due to statement timeout",
          object: "pending_claims",
          reasonFrom: "this app",
        },
      }),
    );
    expect(asApp.sans).toContain("canceling statement due to statement timeout");
    expect(asApp.mono).not.toContain("canceling statement due to statement timeout");
    // And the identifier did not move either way.
    expect(asMachine.mono).toContain("pending_claims");
    expect(asApp.mono).toContain("pending_claims");
  });

  /**
   * The two arms only a REJECTED fetch can reach, driven end to end through
   * the real `fetchJson` — the face, not just the words.
   *
   * `asError`'s last-resort sentence is the app's own prose for a rejection
   * that carried no words of its own, and criterion 1 is unconditional: a
   * sentence this app wrote reads in sans on every arm, including the one no
   * constant in the offline arm table reaches. Its neighbour is the control:
   * a transport rejection that DID bring words keeps them AND keeps the
   * machine's face, so neither assertion passes by rendering everything one
   * way.
   */
  it("a rejection with no words of its own reads in the app's voice; one with words stays the machine's", async () => {
    const LAST_RESORT = "the page request failed before it answered";

    // Nothing to say: fetch rejects carrying a value with no message at all.
    vi.stubGlobal("fetch", () => Promise.reject(undefined));
    const wordless = await requestPage<Row>(BEFORE, DEPS);
    expect(wordless.refusal?.reason).toBe(LAST_RESORT);
    const ours = faces(
      render(h(PageMore, { state: wordless, holds: HOLDS, size: SIZE, onPress: () => {} })),
    );
    expect(ours.sans).toContain(LAST_RESORT);
    expect(ours.mono).not.toContain(LAST_RESORT);
    // The route is still the machine identifier beside it, isolated alone.
    expect(ours.mono).toContain(PAGE_ROUTES.claims);
    expect(ours.isolated.map((run) => run.trim())).toEqual([PAGE_ROUTES.claims]);

    // A non-Error rejection with no message reaches the same sentence: the
    // words are the app's either way, so the face is too.
    vi.stubGlobal("fetch", () => Promise.reject({ code: "ECONNRESET" }));
    const objectThrown = await requestPage<Row>(BEFORE, DEPS);
    expect(objectThrown.refusal?.reason).toBe(LAST_RESORT);
    expect(objectThrown.refusal?.reasonFrom).toBe("this app");

    // The discriminator: the transport's OWN words, which this app did not
    // write, still read as the machine on the very same line.
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const transport = await requestPage<Row>(BEFORE, DEPS);
    expect(transport.refusal?.reason).toBe("Failed to fetch");
    const theirs = faces(
      render(h(PageMore, { state: transport, holds: HOLDS, size: SIZE, onPress: () => {} })),
    );
    expect(theirs.mono).toContain("Failed to fetch");
    expect(theirs.sans).not.toContain("Failed to fetch");
    // One isolated run carrying both, exactly as the answer-carried arm draws.
    expect(theirs.isolated).toHaveLength(1);
    expect(theirs.isolated[0]).toContain(PAGE_ROUTES.claims);
    expect(theirs.isolated[0]).toContain("Failed to fetch");
  });
});
