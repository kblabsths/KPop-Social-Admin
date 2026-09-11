import { describe, expect, it } from "vitest";
import { OFFSET_PARAM, PAGE_ROUTES, pageBound, type PageAnswer } from "@/lib/paging/bounds";
import {
  initialPage,
  pageUrl,
  pressing,
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
  return { rows: rows(...ids), held, status: "idle", refusal: null, notes: null };
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
      // A surface's FIRST screen renders its own legs server-side; this state
      // holds only what presses brought (admin-window/TASK-0076).
      notes: null,
    });
    expect(initialPage<Row>(7, false)).toEqual({
      rows: [],
      held: 7,
      status: "exhausted",
      refusal: null,
      notes: null,
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
      { rows: rows("a"), held: 4, status: "loading", refusal: null, notes: null },
      { rows: rows("a"), held: 4, status: "exhausted", refusal: null, notes: null },
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
   * FULL-OR-EXHAUSTED, the client half — campaign admin-window/BUG-0168, ruled
   * 2026-09-10 (DECISIONS.md, "a paged answer is full-or-exhausted";
   * ARCHITECTURE.md §4.3 read kind 3).
   *
   * The driver reads `deps.size` — it never did — and grades the `ok` arm
   * against it. The four shapes below are the whole of that contract, each
   * driven against the recording stub, and the property after them is the one
   * that kills the CLASS rather than this instance: a `held` that has walked
   * off the grid `pageBound` enforces is what made paging unreachable for the
   * life of a view, so no press may produce one except on the final page.
   *
   * Neither refusal is reachable from this app's own route, which derives
   * `exhausted` from the read it just made (TASK-0066). They are here for
   * foreign data on a wire — a truncating proxy, a stale deploy, a route
   * mid-rewrite — where the alternative is telling the operator that a
   * truncated read is the whole set.
   */
  describe("an ok answer is a full window or it says the set ended", () => {
    const before = paged(4, "a", "b");
    const served = (count: number): Row[] =>
      Array.from({ length: count }, (_, i) => ({ id: `s${i}` }));

    it("a FULL window that continues: appends in order, grows held by the WINDOW, stays idle", async () => {
      const { urls, deps } = answering({
        kind: "ok",
        rows: served(SIZE),
        offset: 4,
        exhausted: false,
      } satisfies PageAnswer<Row>);
      const next = await requestPage(
        { ...before, refusal: { reason: "the read failed", object: "pending_claims" } },
        deps,
      );
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b", "s0", "s1"]);
      expect(next.held).toBe(4 + SIZE);
      expect(next.status).toBe("idle");
      // A press that succeeds clears the account of the one before it.
      expect(next.refusal).toBeNull();
      expect(urls).toHaveLength(1);
    });

    it("a page that SAYS the set ended: appends what it carries, however short, and ends exhausted", async () => {
      for (const count of [0, 1, SIZE]) {
        const { urls, deps } = answering({
          kind: "ok",
          rows: served(count),
          offset: 4,
          exhausted: true,
        } satisfies PageAnswer<Row>);
        const next = await requestPage(before, deps);
        expect(next.status, `${count} rows`).toBe("exhausted");
        expect(next.refusal, `${count} rows`).toBeNull();
        expect(next.rows.map((row) => row.id), `${count} rows`).toEqual([
          "a",
          "b",
          ...served(count).map((row) => row.id),
        ]);
        expect(next.held, `${count} rows`).toBe(4 + count);
        expect(urls, `${count} rows`).toHaveLength(1);
      }
    });

    it("an EMPTY page behaves exactly as it always has, whatever it says about the end", async () => {
      // The one row count this arm still reads as the end of the set by
      // itself: nothing to append, no bound to move, nothing that could be
      // missing. Deliberately unchanged by the ruling.
      const { deps } = answering({ kind: "ok", rows: [], offset: 4, exhausted: false });
      const next = await requestPage(before, deps);
      expect(next.status).toBe("exhausted");
      expect(next.refusal).toBeNull();
      expect(next.rows).toBe(before.rows);
      expect(next.held).toBe(4);
    });

    it("SHORT and still continuing: refused OUT LOUD, naming the route, with one request made", async () => {
      // The defect this ticket was filed for. The route said it served fewer
      // rows than the window AND that the set continues: one of the two is
      // wrong, and which one cannot be told from here.
      const { urls, deps } = answering({
        kind: "ok",
        rows: served(SIZE - 1),
        offset: 4,
        exhausted: false,
      } satisfies PageAnswer<Row>);
      const next = await requestPage(before, deps);
      // Identical in length, members and order — a refusal never half-fills.
      expect(next.rows).toHaveLength(before.rows.length);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b"]);
      // The next press asks for the SAME bound, so the set stays reachable.
      expect(next.held).toBe(4);
      expect(next.status).toBe("idle");
      expect(next.refusal?.object).toBe(PAGE_ROUTES.claims);
      expect(next.refusal?.reason.length).toBeGreaterThan(0);
      expect(urls).toHaveLength(1);
    });

    it("LONGER than the window: refused the same way, on either value of exhausted", async () => {
      for (const exhausted of [false, true]) {
        const { urls, deps } = answering({
          kind: "ok",
          rows: served(SIZE + 1),
          offset: 4,
          exhausted,
        } satisfies PageAnswer<Row>);
        const next = await requestPage(before, deps);
        expect(next.rows.map((row) => row.id), `exhausted: ${exhausted}`).toEqual(["a", "b"]);
        expect(next.held, `exhausted: ${exhausted}`).toBe(4);
        expect(next.status, `exhausted: ${exhausted}`).toBe("idle");
        expect(next.refusal?.object, `exhausted: ${exhausted}`).toBe(PAGE_ROUTES.claims);
        expect(urls, `exhausted: ${exhausted}`).toHaveLength(1);
      }
    });

    it("a window that is not a window grades nothing: the answer is refused and no row lands", async () => {
      // `pageBound` refuses every bound built from such a size, so a state
      // grown against one could never be pressed again. Both fixtures
      // (LESSONS 8): the same full page lands against a real window above.
      for (const size of [0, -2, 2.5, Number.NaN]) {
        const { deps } = answering({ kind: "ok", rows: served(2), offset: 4, exhausted: false });
        const next = await requestPage(before, { ...deps, size });
        expect(next.rows.map((row) => row.id), `size ${size}`).toEqual(["a", "b"]);
        expect(next.held, `size ${size}`).toBe(4);
        expect(next.refusal?.object, `size ${size}`).toBe(PAGE_ROUTES.claims);
      }
    });

    /**
     * THE INVARIANT THAT KILLS THE CLASS (admin-window/BUG-0168, criterion 3),
     * asserted over the whole matrix above rather than case by case: after ANY
     * press, either the bound the next press would carry is one this app
     * serves, or the set is over. `held` leaves the bound grid only on the
     * final page.
     *
     * It is what makes residual 5 unreachable too: a second consumer wiring
     * the widget slightly differently cannot re-open the hole, because the
     * driver itself refuses to leave the grid.
     */
    it("INVARIANT: after any press, the next bound is servable or the set is exhausted", async () => {
      const shapes: { name: string; rows: number; exhausted: boolean }[] = [];
      for (const count of [0, 1, SIZE - 1, SIZE, SIZE + 1, SIZE * 3]) {
        for (const exhausted of [false, true]) {
          shapes.push({ name: `${count} rows, exhausted: ${exhausted}`, rows: count, exhausted });
        }
      }
      // Non-vacuity: the matrix really does contain pages of every shape the
      // contract names, and both endings really do occur across it.
      expect(shapes).toHaveLength(12);
      const endings = new Set<string>();

      for (const shape of shapes) {
        for (const start of [before, paged(SIZE, "a"), paged(SIZE * 50, "a", "b")]) {
          const { deps } = answering({
            kind: "ok",
            rows: served(shape.rows),
            offset: 4,
            exhausted: shape.exhausted,
          } satisfies PageAnswer<Row>);
          const next = await requestPage(start, deps);
          endings.add(next.status);
          const servable = pageBound(String(next.held), SIZE).kind === "ok";
          expect(
            servable || next.status === "exhausted",
            `${shape.name} from held ${start.held} left held ${next.held}`,
          ).toBe(true);
        }
      }
      expect([...endings].sort()).toEqual(["exhausted", "idle"]);
    });
  });

  /**
   * THE LEGS A PAGE BROUGHT REACH THE STATE, OR THE PRESS IS REFUSED — campaign
   * admin-window/TASK-0076.
   *
   * `GET /api/admin/browse/rows` answers a `NotedPageAnswer`: its `ok` arm
   * carries the two legs that FILL columns over the events window, each `null`
   * when that leg answered. The driver used to drop them, so a page whose
   * provenance leg refused reached the operator as events with a silently
   * empty Sources column — nothing rendered them because nothing could.
   *
   * Every case below is driven against the same recording stub the rest of
   * this file uses, and the note objects are compared by IDENTITY wherever the
   * point is that nothing reworded them.
   */
  describe("the leg notes a page carries", () => {
    /** A refused provenance leg, as `lib/db/browse.ts` reports one. */
    const PROVENANCE_GONE = {
      kind: "not_provisioned",
      missing: "field_provenance",
    } as const;
    /** A refused venue leg, the other arm. */
    const VENUES_BROKE = {
      kind: "error",
      reading: "event_listings.venue_name",
      message: "connection refused",
    } as const;

    /** An `ok` page of a full window, optionally carrying a `notes` field. */
    const page = (ids: string[], notes?: unknown): unknown => {
      const answer: Record<string, unknown> = {
        kind: "ok",
        rows: rows(...ids),
        offset: 4,
        exhausted: false,
      };
      if (notes !== undefined) answer.notes = notes;
      return answer;
    };

    it("(1) appends the rows AND leaves the refused leg's note byte-identical on the state", async () => {
      const { deps } = answering(
        page(["c", "d"], { venues: null, provenance: PROVENANCE_GONE }),
      );
      const next = await requestPage(paged(4, "a", "b"), deps);
      // The rows landed.
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
      expect(next.held).toBe(6);
      expect(next.status).toBe("idle");
      expect(next.refusal).toBeNull();
      // …and so did the legs' own report, unrewritten: same kind, same
      // `missing`, no sentence of this app's wrapped around it.
      expect(next.notes).toEqual({ venues: null, provenance: PROVENANCE_GONE });
      expect(next.notes?.provenance).toBe(PROVENANCE_GONE);
    });

    it("(2) holds a record of nulls when both legs answered", async () => {
      // `null` is a leg's ANSWER, not its absence: a surface reading this
      // state can tell "that column is filled" from "nobody said".
      const { deps } = answering(page(["c", "d"], { venues: null, provenance: null }));
      const next = await requestPage(paged(4, "a", "b"), deps);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
      expect(next.notes).toEqual({ venues: null, provenance: null });
      expect(next.notes).not.toBeNull();
    });

    it("(3) an answer with NO notes property leaves the standing notes exactly as they were", async () => {
      // The claims route's answer. `/claims` is byte-identical through this
      // ticket because of this arm.
      const standing = { venues: null, provenance: PROVENANCE_GONE };
      const { deps } = answering(page(["c", "d"]));
      const before = { ...paged(4, "a", "b"), notes: standing };
      const next = await requestPage(before, deps);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
      expect(next.held).toBe(6);
      expect(next.refusal).toBeNull();
      expect(next.notes).toBe(standing);

      // …and from a state that never held any, nothing is invented.
      const { deps: deps2 } = answering(page(["c", "d"]));
      expect((await requestPage(paged(4, "a", "b"), deps2)).notes).toBeNull();
    });

    it("(4) an unreadable notes field REFUSES naming the route, on five shapes", async () => {
      // Appending the rows and dropping the notes is the defect this ticket
      // closes; rendering a note this app cannot read is the one thing worse.
      const unreadable: ReadonlyArray<readonly [string, unknown]> = [
        ["a string", "the provenance leg failed"],
        ["an array", [PROVENANCE_GONE]],
        ["a kind this app does not know", { provenance: { kind: "unavailable", missing: "x" } }],
        ["a `missing` that is a number", { provenance: { kind: "not_provisioned", missing: 7 } }],
        ["a note that is itself a record", { provenance: { venues: null, provenance: null } }],
      ];
      for (const [name, notes] of unreadable) {
        const { urls, deps } = answering(page(["c", "d"], notes));
        const next = await requestPage(paged(4, "a", "b"), deps);
        // Zero rows appended, the bound unmoved, the press repeatable.
        expect(next.rows.map((row) => row.id), name).toEqual(["a", "b"]);
        expect(next.held, name).toBe(4);
        expect(next.status, name).toBe("idle");
        expect(next.refusal?.object, name).toBe(PAGE_ROUTES.claims);
        expect(next.refusal?.reason.length, name).toBeGreaterThan(0);
        expect(urls, name).toHaveLength(1);
        // The reason is THIS APP's: not one character of the field it refused,
        // and no figure it would have to pluralise.
        const reason = next.refusal?.reason ?? "";
        expect(reason, name).not.toContain("unavailable");
        expect(reason, name).not.toContain("provenance");
        expect(reason, name).not.toContain("kind");
        expect(reason, name).not.toMatch(/\d/);
      }
    });

    it("(4b) an unreadable notes field on a page that WOULD have landed — the must-not-flag half", async () => {
      // The same rows, the same window, the same bound: only the notes differ — so
      // the refusal above is about the notes and nothing else.
      const { deps } = answering(page(["c", "d"], { provenance: PROVENANCE_GONE }));
      const next = await requestPage(paged(4, "a", "b"), deps);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
      expect(next.refusal).toBeNull();
    });

    it("(5) MERGES per key: a standing note survives a later page whose legs answered", async () => {
      // Why merge and not replace: the rows the refused leg left unfilled are
      // STILL on screen after the next press, so a note that vanished would be
      // the silently-empty-column defect one press later.
      const { deps } = answering(
        page(["c", "d"], { venues: null, provenance: PROVENANCE_GONE }),
        page(["e", "f"], { venues: null, provenance: null }),
      );
      const first = await requestPage(paged(4, "a", "b"), deps);
      const second = await requestPage(first, deps);
      expect(second.notes).toEqual({ venues: null, provenance: PROVENANCE_GONE });
      // Byte-identical still: the FIRST page's own note object.
      expect(second.notes?.provenance).toBe(PROVENANCE_GONE);
      // Both pages' rows, in the order they arrived.
      expect(second.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
      expect(second.held).toBe(8);
    });

    it("(5b) a key that is null or absent TAKES a later page's note", async () => {
      // The other half of the merge rule, so it is not a rule that only ever
      // keeps: a leg that answered on page one and refused on page two reports
      // the refusal, and a key no page had mentioned appears.
      const { deps } = answering(
        page(["c", "d"], { venues: null }),
        page(["e", "f"], { venues: VENUES_BROKE, provenance: PROVENANCE_GONE }),
      );
      const first = await requestPage(paged(4, "a", "b"), deps);
      expect(first.notes).toEqual({ venues: null });
      const second = await requestPage(first, deps);
      expect(second.notes).toEqual({ venues: VENUES_BROKE, provenance: PROVENANCE_GONE });
      expect(second.notes?.venues).toBe(VENUES_BROKE);
    });

    it("(6) a refused press leaves the notes it held, on every way a press is refused", async () => {
      const standing = { venues: null, provenance: PROVENANCE_GONE };
      const held = { ...paged(4, "a", "b"), notes: standing };

      const refusals: ReadonlyArray<readonly [string, () => unknown]> = [
        // A short continuing page.
        ["a short continuing page", () => page(["c"])],
        // A rejected request.
        [
          "a rejected request",
          () => {
            throw new Error("Failed to fetch");
          },
        ],
        // A body that never parsed.
        [
          "a body that never parsed",
          () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        ],
        // …and the answer's own refusal arms, for good measure.
        ["a not-provisioned answer", () => ({ kind: "not_provisioned", missing: "pending_claims" })],
        ["a body that is not an answer", () => ({ rows: rows("c") })],
      ];
      for (const [name, reply] of refusals) {
        const { deps } = recorder(reply);
        const next = await requestPage(held, deps);
        expect(next.refusal, name).not.toBeNull();
        expect(next.rows.map((row) => row.id), name).toEqual(["a", "b"]);
        expect(next.held, name).toBe(4);
        // The notes are the account of columns that are STILL unfilled.
        expect(next.notes, name).toBe(standing);
      }
    });

    it("an EMPTY page ends the set without disturbing the notes it holds", async () => {
      // Nothing appended, so no column of this page's went unfilled.
      const standing = { venues: null, provenance: PROVENANCE_GONE };
      const { deps } = answering({ kind: "ok", rows: [], offset: 4, exhausted: false });
      const next = await requestPage({ ...paged(4, "a", "b"), notes: standing }, deps);
      expect(next.status).toBe("exhausted");
      expect(next.notes).toBe(standing);
    });

    it("a FINAL page's notes land too: exhaustion is not a reason to drop a leg's report", async () => {
      const { deps } = answering({
        kind: "ok",
        rows: rows("c"),
        offset: 4,
        exhausted: true,
        notes: { venues: null, provenance: PROVENANCE_GONE },
      });
      const next = await requestPage(paged(4, "a", "b"), deps);
      expect(next.status).toBe("exhausted");
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
      expect(next.notes?.provenance).toBe(PROVENANCE_GONE);
    });

    it("pressing carries the notes through, and still hands back the SAME object", () => {
      const standing = { venues: null, provenance: PROVENANCE_GONE };
      const idle: PageState<Row> = {
        rows: rows("a"),
        held: 2,
        status: "idle",
        refusal: null,
        notes: standing,
      };
      expect(pressing(idle).notes).toBe(standing);
      expect(pressing(idle).status).toBe("loading");
      for (const status of ["loading", "exhausted"] as const) {
        const state: PageState<Row> = { ...idle, status };
        // Identity, unchanged by this ticket: the double-press proof rests on it.
        expect(pressing(state)).toBe(state);
      }
    });

    it("the state it was handed is never mutated, notes included", async () => {
      const standing = { venues: null, provenance: PROVENANCE_GONE };
      const before = { ...paged(4, "a", "b"), notes: standing };
      const { deps } = answering(page(["c", "d"], { venues: VENUES_BROKE, provenance: null }));
      await requestPage(before, deps);
      expect(before.notes).toBe(standing);
      expect(standing).toEqual({ venues: null, provenance: PROVENANCE_GONE });
    });

    it("a `__proto__` key in a notes body is an entry, never a prototype", async () => {
      // The keys come off a JSON body. Built by assignment, `merged["__proto__"] = note`
      // would set a prototype instead of adding an entry.
      const body = JSON.parse(
        '{"kind":"ok","rows":[{"id":"c"},{"id":"d"}],"offset":4,"exhausted":false,' +
          '"notes":{"__proto__":null,"provenance":null}}',
      ) as unknown;
      const { deps } = answering(body);
      const next = await requestPage(paged(4, "a", "b"), deps);
      expect(next.refusal).toBeNull();
      expect(Object.hasOwn(next.notes ?? {}, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });
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
      // The recovering answer is a FULL window (admin-window/BUG-0168): under
      // full-or-exhausted a one-row page for a two-row window is itself a
      // refusal, so a short answer here would have graded the clearing arm
      // against a page that never lands.
      const { deps } = answering(
        { kind: "error", reading: "pending_claims", message: "connection refused" },
        { kind: "ok", rows: rows("c", "d"), offset: 4, exhausted: false },
      );
      const refused = await requestPage(held, deps);
      expect(refused.refusal).not.toBeNull();
      const recovered = await requestPage(refused, deps);
      expect(recovered.refusal).toBeNull();
      expect(recovered.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
      expect(recovered.held).toBe(6);
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

describe("pressing", () => {
  // The interim state a press publishes BEFORE its request resolves — campaign
  // admin-window/TASK-0064. It lives in the leaf, not in the hook that calls
  // it, so that the arm which makes a double press safe can be driven in a
  // tier that has no DOM.

  it("turns idle into loading and touches nothing else", () => {
    const idle: PageState<Row> = {
      rows: rows("a", "b"),
      held: 4,
      status: "idle",
      refusal: null,
      notes: null,
    };
    const started = pressing(idle);
    expect(started.status).toBe("loading");
    // Untouched means the SAME rows, not merely equal ones: a press that
    // rebuilt the list would re-key every row the operator is looking at.
    expect(started.rows).toBe(idle.rows);
    expect(started.held).toBe(idle.held);
    expect(started.refusal).toBe(idle.refusal);
  });

  it("keeps a standing refusal visible while the retry is in the air", () => {
    // The last press was refused, the operator pressed again: the reason is
    // still the only account of what happened, and clearing it here would
    // blank the line the moment it is acted on (LESSONS 1, LIFETIME).
    const refused: PageState<Row> = {
      rows: rows("a"),
      held: 2,
      status: "idle",
      refusal: { reason: "the read failed", object: "pending_claims" },
      notes: null,
    };
    expect(pressing(refused).refusal).toBe(refused.refusal);
    expect(pressing(refused).status).toBe("loading");
  });

  it("hands back the SAME object from loading and from exhausted", () => {
    // Identity, not equality: a caller publishing this would re-render the
    // whole row list for a press that changed nothing.
    for (const status of ["loading", "exhausted"] as const) {
      const state: PageState<Row> = {
        rows: rows("a"),
        held: 2,
        status,
        refusal: null,
        notes: null,
      };
      expect(pressing(state)).toBe(state);
    }
  });

  it("is idempotent, so a third press is as free as the second", () => {
    const idle: PageState<Row> = {
      rows: rows("a"),
      held: 2,
      status: "idle",
      refusal: null,
      notes: null,
    };
    const once = pressing(idle);
    expect(pressing(once)).toBe(once);
  });
});

describe("the double press, composed from the two pure pieces", () => {
  // The offline tier has no DOM, so the press itself cannot be simulated here.
  // What CAN be driven is the composition every caller is obliged to
  // reproduce — publish `pressing(current)`, hand the PRE-press state to
  // `requestPage` — and that composition is where the safety lives.

  it("issues ZERO requests when the state has already been pressed", async () => {
    const { urls, deps } = answering({
      kind: "ok",
      rows: rows("c"),
      offset: 4,
      exhausted: false,
    } satisfies PageAnswer<Row>);
    const idle = paged(4, "a", "b");
    const inFlight = pressing(idle);

    expect(await requestPage(inFlight, deps)).toBe(inFlight);
    expect(urls).toEqual([]);
  });

  it("issues exactly ONE from the pre-press state, so the pin above is not vacuous", () => {
    // The must-NOT-flag half (LESSONS 8): the same driver, the same deps, the
    // state a caller is obliged to hand it, and a request really is made. The
    // answer is a FULL window so that the rows it carries land — under
    // full-or-exhausted (admin-window/BUG-0168) a short continuing page is
    // refused, and this half proves the press did something.
    const { urls, deps } = answering({
      kind: "ok",
      rows: rows("c", "d"),
      offset: 4,
      exhausted: false,
    } satisfies PageAnswer<Row>);
    const idle = paged(4, "a", "b");
    void pressing(idle);
    return requestPage(idle, deps).then((next) => {
      expect(urls).toHaveLength(1);
      expect(next.rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    });
  });
});
