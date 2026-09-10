import { describe, expect, it } from "vitest";
import { OFFSET_PARAM, PAGE_ROUTES, pageBound, type PageAnswer } from "@/lib/paging/bounds";
import {
  initialPage,
  pageUrl,
  requestPage,
  type PageDeps,
  type PageState,
} from "@/lib/paging/machine";

/**
 * The one-press driver — campaign admin-window/TASK-0063, ARCHITECTURE.md §4.3
 * read kind 3 and §4 rule 1's amended exception.
 *
 * There is no DOM in this suite, which is WHY the driver is a directiveless
 * module: every rule below is driven here, against a recording stub, rather
 * than through a press that cannot be simulated. The stub records what it was
 * asked for, so "one press, one request" is graded as a count and a URL and
 * not as an intention.
 */

type Row = { id: string };

const SIZE = 2;
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

/** A `fetchJson` that records every URL it was called with. */
function recorder(reply: (url: string) => unknown): {
  urls: string[];
  deps: PageDeps;
} {
  const urls: string[] = [];
  const deps: PageDeps = {
    route: PAGE_ROUTES.claims,
    params: "tab=standing&source_id=abc",
    size: SIZE,
    fetchJson: async (url: string) => {
      urls.push(url);
      return reply(url);
    },
  };
  return { urls, deps };
}

/** A stub that answers each press with the next scripted answer. */
function answering(...answers: unknown[]): { urls: string[]; deps: PageDeps } {
  let index = 0;
  return recorder(() => answers[index++]);
}

/** A surface that has rendered a first screen of `held` rows and paged in two. */
function paged(held: number, ...ids: string[]): PageState<Row> {
  return { rows: rows(...ids), held, status: "idle", refusal: null };
}

describe("initialPage", () => {
  it("starts idle when the first screen says there is more, exhausted when it does not", () => {
    // A control that cannot be honoured is never offered (SPEC F10): a first
    // screen holding the whole set starts exhausted, so no press is drawn.
    expect(initialPage<Row>(50, true)).toEqual({
      rows: [],
      held: 50,
      status: "idle",
      refusal: null,
    });
    expect(initialPage<Row>(7, false)).toEqual({
      rows: [],
      held: 7,
      status: "exhausted",
      refusal: null,
    });
  });

  it("holds none of the first screen's own rows", () => {
    // `rows` is what was PAGED IN; the first screen belongs to the server.
    expect(initialPage<Row>(50, true).rows).toEqual([]);
  });
});

describe("pageUrl", () => {
  it("carries the surface's facets and appends the bound under the one param name", () => {
    const { deps } = recorder(() => undefined);
    const url = new URL(pageUrl(deps, 50), "https://admin.example");
    expect(url.pathname).toBe(PAGE_ROUTES.claims);
    expect(url.searchParams.get(OFFSET_PARAM)).toBe("50");
    expect(url.searchParams.get("tab")).toBe("standing");
    expect(url.searchParams.get("source_id")).toBe("abc");
  });

  it("asks the app's own route by a relative path, whatever the facets are", () => {
    // Rule 1's amended exception: this app's own route handler, by a relative
    // path, and nothing else. No origin is ever composed here.
    for (const params of ["", "?tab=standing", "tab=standing&", "&tab=standing"]) {
      const url = pageUrl({ ...recorder(() => undefined).deps, params }, 4);
      expect(url.startsWith(`${PAGE_ROUTES.claims}?`), params).toBe(true);
      expect(url.includes("?&"), params).toBe(false);
      expect(url.includes("&&"), params).toBe(false);
      expect(new URLSearchParams(url.split("?")[1]).get(OFFSET_PARAM), params).toBe("4");
    }
  });

  // admin-window/BUG-0166. Was a strict XFAIL pin while pageUrl appended the
  // bound instead of overriding one the facets already spell; it is a plain
  // `it` from the commit that made overriding true.
  it("carries THIS press's bound even when the surface's facets already spell one", () => {
    // The bound the handler reads must be the one this module wrote, whatever
    // a surface serialized into `params`. A handler asks `searchParams.get()`,
    // which answers with the FIRST occurrence, so appending is not overriding:
    // a stale `offset` in the facets is the bound the server would honour, and
    // the press would ask for a page the surface already holds. `getAll` is
    // the API that can see the duplicate at all, so both are asserted.
    for (const params of [
      `${OFFSET_PARAM}=99`,
      `tab=standing&${OFFSET_PARAM}=99`,
      `?${OFFSET_PARAM}=99`,
      `${OFFSET_PARAM}=99&${OFFSET_PARAM}=7`,
    ]) {
      const url = pageUrl({ ...recorder(() => undefined).deps, params }, 4);
      const read = new URL(url, "https://admin.example").searchParams;
      expect(read.get(OFFSET_PARAM), params).toBe("4");
      expect(read.getAll(OFFSET_PARAM), params).toEqual(["4"]);
    }
  });

  it("keeps the surface's own facets, in the caller's order, around an overridden bound", () => {
    // Overriding removes the stale bound and NOTHING else: a facet the
    // operator chose is still there, still spelled as sent, still in the order
    // the caller serialized it — the bound is simply written last.
    const params = `tab=standing&${OFFSET_PARAM}=99&source_id=abc`;
    const url = pageUrl({ ...recorder(() => undefined).deps, params }, 6);
    const read = new URL(url, "https://admin.example").searchParams;
    expect([...read.keys()]).toEqual(["tab", "source_id", OFFSET_PARAM]);
    expect(read.get("tab")).toBe("standing");
    expect(read.get("source_id")).toBe("abc");
    expect(read.get(OFFSET_PARAM)).toBe("6");
  });

  // admin-window/BUG-0166, QA round. The override is only worth anything if it
  // survives the WIRE READ: the handler asks `searchParams.get()` and hands the
  // raw string to `pageBound` (the guard that counts, LESSONS 8). Both facets
  // below defeated the pre-fix concatenation at that seam — measured on
  // 731cf91's implementation: `offset=99` was read back as "99" (a bound this
  // press never held), and a facet carrying `#` truncated the query at the
  // fragment so the bound was read back as `null` and every press refused with
  // "the request named no `offset`". Nothing else pins the seam, so it is
  // pinned here rather than left to the first route handler to rediscover.
  it("hands the handler's own reader a bound it accepts, whatever the facets carry", () => {
    const SERVER_WINDOW = 50;
    for (const params of [
      `${OFFSET_PARAM}=99`,
      `tab=standing&${OFFSET_PARAM}=99`,
      "q=x#frag",
      `q=x#frag&${OFFSET_PARAM}=99`,
      "q=a\r\nX-Injected: 1",
    ]) {
      const url = pageUrl(
        { ...recorder(() => undefined).deps, params, size: SERVER_WINDOW },
        SERVER_WINDOW * 2,
      );
      const raw = new URL(url, "https://admin.example").searchParams.get(OFFSET_PARAM);
      expect(pageBound(raw, SERVER_WINDOW), params).toEqual({ kind: "ok", offset: SERVER_WINDOW * 2 });
    }
  });
});

describe("requestPage", () => {
  it("issues exactly ONE request per press from idle, at the bound it holds", () => {
    // One press, one request.
    const { urls, deps } = answering({
      kind: "ok",
      rows: rows("c", "d"),
      offset: 4,
      exhausted: false,
    } satisfies PageAnswer<Row>);
    return requestPage(paged(4, "a", "b"), deps).then((next) => {
      expect(urls).toHaveLength(1);
      expect(new URLSearchParams(urls[0].split("?")[1]).get(OFFSET_PARAM)).toBe("4");
      expect(next.held).toBe(6);
    });
  });

  it("issues NO request from loading or from exhausted, and returns that state untouched", () => {
    // No press, no request — and the same state object back, so a caller
    // comparing identity can see that nothing happened.
    const { urls, deps } = answering({ kind: "ok", rows: rows("x"), offset: 4, exhausted: false });
    const states: PageState<Row>[] = [
      { rows: rows("a"), held: 4, status: "loading", refusal: null },
      { rows: rows("a"), held: 4, status: "exhausted", refusal: null },
    ];
    return Promise.all(
      states.map(async (state) => {
        expect(await requestPage(state, deps)).toBe(state);
      }),
    ).then(() => {
      expect(urls).toEqual([]);
    });
  });

  it("appends an ok answer in the order received and grows the bound by the row count", async () => {
    const { urls, deps } = answering(
      { kind: "ok", rows: rows("c", "d"), offset: 4, exhausted: false },
      { kind: "ok", rows: rows("e", "f"), offset: 6, exhausted: false },
    );
    const first = await requestPage(paged(4, "a", "b"), deps);
    expect(first.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(first.held).toBe(6);
    expect(first.status).toBe("idle");
    expect(first.refusal).toBeNull();

    // The second press asks for the bound the first press produced.
    const second = await requestPage(first, deps);
    expect(second.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(second.held).toBe(8);
    expect(urls.map((url) => new URLSearchParams(url.split("?")[1]).get(OFFSET_PARAM))).toEqual([
      "4",
      "6",
    ]);
  });

  it("leaves the state it was handed alone", async () => {
    const before = paged(4, "a", "b");
    const { deps } = answering({ kind: "ok", rows: rows("c"), offset: 4, exhausted: true });
    await requestPage(before, deps);
    expect(before.rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(before.held).toBe(4);
    expect(before.status).toBe("idle");
  });

  it("takes the answer's own word for exhaustion, and stops pressing on it", async () => {
    const { urls, deps } = answering(
      { kind: "ok", rows: rows("c"), offset: 4, exhausted: true },
      { kind: "ok", rows: rows("d"), offset: 5, exhausted: false },
    );
    const done = await requestPage(paged(4, "a", "b"), deps);
    expect(done.status).toBe("exhausted");
    expect(done.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(done.held).toBe(5);

    // Exhausted is terminal: the second press never reaches the network.
    expect(await requestPage(done, deps)).toBe(done);
    expect(urls).toHaveLength(1);
  });

  it("reads an ok answer with NO rows as exhaustion, not as a refusal", async () => {
    // A page past the end is an answer (§4.3 kind 3), so nothing is refused
    // and nothing is added.
    const { deps } = answering({ kind: "ok", rows: [], offset: 4, exhausted: false });
    const next = await requestPage(paged(4, "a", "b"), deps);
    expect(next.status).toBe("exhausted");
    expect(next.refusal).toBeNull();
    expect(next.rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(next.held).toBe(4);
  });

  /**
   * M3 EC5 / §4.3: a refused page never half-fills the list. Every arm of a
   * refusal — the two `DbResult` ones, the bound one, and the three ways a
   * body never becomes an answer at all — is graded on the same three
   * properties: the rows are identical, the bound is unchanged so the same
   * press can be made again, and the refusal names the object.
   */
  describe("a refusal", () => {
    const held = paged(4, "a", "b");

    const arms: ReadonlyArray<readonly [string, unknown, string | null]> = [
      ["not_provisioned", { kind: "not_provisioned", missing: "pending_claims" }, "pending_claims"],
      [
        "error",
        { kind: "error", reading: "event_listings", message: "connection refused" },
        "event_listings",
      ],
      ["a refused bound", { kind: "refused", reason: "the offset must be a multiple of 50", bound: "75" }, null],
      ["a body that is not an answer", { rows: rows("c", "d") }, PAGE_ROUTES.claims],
      ["a body that is not even an object", "<!doctype html>", PAGE_ROUTES.claims],
      ["a null body", null, PAGE_ROUTES.claims],
    ];

    for (const [name, body, object] of arms) {
      it(`never extends the list: ${name}`, async () => {
        const { deps } = answering(body);
        const next = await requestPage(held, deps);
        expect(next.rows).toHaveLength(held.rows.length);
        expect(next.rows.map((row) => row.id)).toEqual(["a", "b"]);
        expect(next.held).toBe(4);
        expect(next.status).toBe("idle");
        expect(next.refusal?.object ?? null).toBe(object);
        expect(next.refusal?.reason.length).toBeGreaterThan(0);
      });
    }

    it("never extends the list: a rejected request", async () => {
      const { deps } = recorder(() => {
        throw new Error("Failed to fetch");
      });
      const next = await requestPage(held, deps);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b"]);
      expect(next.held).toBe(4);
      expect(next.status).toBe("idle");
      expect(next.refusal?.object).toBe(PAGE_ROUTES.claims);
      // The transport's own words, not a sentence of ours over the top.
      expect(next.refusal?.reason).toContain("Failed to fetch");
    });

    it("never extends the list: a body that never parsed", async () => {
      // What `res.json()` does to an HTML error page.
      const { deps } = recorder(() => {
        throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
      });
      const next = await requestPage(held, deps);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b"]);
      expect(next.status).toBe("idle");
      expect(next.refusal?.object).toBe(PAGE_ROUTES.claims);
    });

    it("carries the database's own words, and names the object the page would name", async () => {
      const { deps } = answering({
        kind: "error",
        reading: "pending_claims",
        message: "connection refused",
      });
      const next = await requestPage(held, deps);
      expect(next.refusal).toEqual({ reason: "connection refused", object: "pending_claims" });
    });

    it("names the absent object in the not-provisioned refusal", async () => {
      const { deps } = answering({ kind: "not_provisioned", missing: "pending_claims" });
      const next = await requestPage(held, deps);
      expect(next.refusal?.object).toBe("pending_claims");
      expect(next.refusal?.reason).toContain("pending_claims");
    });

    it("is cleared by the next press that succeeds", async () => {
      const { deps } = answering(
        { kind: "error", reading: "pending_claims", message: "connection refused" },
        { kind: "ok", rows: rows("c"), offset: 4, exhausted: false },
      );
      const refused = await requestPage(held, deps);
      expect(refused.refusal).not.toBeNull();
      const recovered = await requestPage(refused, deps);
      expect(recovered.refusal).toBeNull();
      expect(recovered.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
      expect(recovered.held).toBe(5);
    });

    it("leaves the press repeatable, at the same bound", async () => {
      const { urls, deps } = answering(
        { kind: "error", reading: "pending_claims", message: "boom" },
        { kind: "ok", rows: rows("c"), offset: 4, exhausted: true },
      );
      const refused = await requestPage(held, deps);
      await requestPage(refused, deps);
      expect(urls.map((url) => new URLSearchParams(url.split("?")[1]).get(OFFSET_PARAM))).toEqual([
        "4",
        "4",
      ]);
    });
  });

  it("never throws, whatever the request does", async () => {
    // §4.1's promise, carried across the wire: a driver that throws would take
    // the whole surface down from a click handler.
    const hostile: Array<() => unknown> = [
      () => {
        throw new Error("boom");
      },
      // A rejection that is not an Error at all — what a stray `Promise.reject`
      // hands a caller.
      () => Promise.reject("a string, not an Error"),
      () => Promise.reject(undefined),
      () => undefined,
      () => null,
      () => Number.NaN,
      () => ({ kind: "ok", rows: null, offset: 4, exhausted: false }),
    ];
    for (const reply of hostile) {
      const { deps } = recorder(reply);
      const next = await requestPage(paged(4, "a", "b"), deps);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b"]);
      expect(next.status).toBe("idle");
      expect(next.refusal).not.toBeNull();
    }
  });
});
