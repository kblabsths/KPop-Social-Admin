import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_SIZE,
  MAX_PAGE_OFFSET,
  PAGE_PARAM,
  PAGE_ROUTES,
  SIZE_PARAM,
  WINDOW_SIZES,
  containingWindow,
  endsWithin,
  isPageNotes,
  largestPage,
  nextWindow,
  offsetOf,
  previousWindow,
  rawWindowOf,
  sameWindow,
  windowBound,
  windowQuery,
  type PageWindow,
  type WindowBound,
} from "@/lib/paging/bounds";

/**
 * The paging vocabulary — campaign admin-window/TASK-0063, rewritten for page
 * windows 2026-10-16.
 *
 * `windowBound` is the ONE guard both pages and both routes ask of a URL, so
 * every refusal it makes and every window it serves is driven here, as a
 * table, once. A bug this file catches: a URL that lands on a window nobody
 * asked for — rounded, defaulted from a malformed value, or seeking past the
 * ceiling — which no page test sees because the page renders whatever window
 * it is handed.
 */

function refusalOf(bound: WindowBound): { reason: string; param: string; bound: string } {
  expect(bound.kind, JSON.stringify(bound)).toBe("refused");
  return bound as { kind: "refused"; reason: string; param: string; bound: string };
}

function servedOf(bound: WindowBound): { window: PageWindow; offset: number } {
  expect(bound.kind, JSON.stringify(bound)).toBe("ok");
  return bound as { kind: "ok"; window: PageWindow; offset: number };
}

describe("the paging vocabulary", () => {
  it("spells each surface's route once, the two parameters, and Ben's three sizes", () => {
    expect(Object.keys(PAGE_ROUTES).sort()).toEqual(["browse", "claims"]);
    for (const route of Object.values(PAGE_ROUTES)) {
      expect(route.startsWith("/api/admin/")).toBe(true);
    }
    expect(new Set(Object.values(PAGE_ROUTES)).size).toBe(2);
    expect(PAGE_PARAM).not.toBe(SIZE_PARAM);
    expect([...WINDOW_SIZES]).toEqual([20, 50, 100]);
    expect(WINDOW_SIZES).toContain(DEFAULT_WINDOW_SIZE);
  });
});

describe("windowBound", () => {
  const SERVED: ReadonlyArray<readonly [string, string | null, string | null, PageWindow, number]> = [
    ["nothing named: the first window at the default size", null, null, { page: 1, size: 50 }, 0],
    ["the first window, spelled", "1", "50", { page: 1, size: 50 }, 0],
    ["a page with no size", "3", null, { page: 3, size: 50 }, 100],
    ["a size with no page", null, "20", { page: 1, size: 20 }, 0],
    ["rows 41–60", "3", "20", { page: 3, size: 20 }, 40],
    ["rows 201–300", "3", "100", { page: 3, size: 100 }, 200],
    [
      "the window that starts exactly at the ceiling",
      String(MAX_PAGE_OFFSET / 50 + 1),
      "50",
      { page: MAX_PAGE_OFFSET / 50 + 1, size: 50 },
      MAX_PAGE_OFFSET,
    ],
  ];

  it.each(SERVED)("serves %s", (_what, page, size, window, offset) => {
    expect(windowBound({ page, size })).toEqual({ kind: "ok", window, offset });
    expect(offsetOf(window)).toBe(offset);
  });

  const REFUSED: ReadonlyArray<readonly [string, string | null, string | null, string]> = [
    ["an empty page", "", null, PAGE_PARAM],
    ["an empty size", null, "", SIZE_PARAM],
    ["a page that is a word", "abc", null, PAGE_PARAM],
    ["a page with a leading space", " 2", null, PAGE_PARAM],
    ["a page with a sign", "+2", null, PAGE_PARAM],
    ["a page with a leading zero", "02", null, PAGE_PARAM],
    ["a page with a decimal point", "2.0", null, PAGE_PARAM],
    ["a page with an exponent", "1e1", null, PAGE_PARAM],
    ["a negative page", "-1", null, PAGE_PARAM],
    ["page zero", "0", null, PAGE_PARAM],
    ["a size this app does not offer", "1", "30", SIZE_PARAM],
    ["a size of zero", "1", "0", SIZE_PARAM],
    ["a size that is a word", "1", "fifty", SIZE_PARAM],
    ["a size with a sign", "1", "+50", SIZE_PARAM],
    ["a page past the ceiling", String(MAX_PAGE_OFFSET / 50 + 2), "50", PAGE_PARAM],
    ["a page past the ceiling at the smallest size", String(MAX_PAGE_OFFSET / 20 + 2), "20", PAGE_PARAM],
    ["a 400-digit page", "9".repeat(400), null, PAGE_PARAM],
  ];

  it.each(REFUSED)("refuses %s, naming the parameter and never clamping", (_what, page, size, param) => {
    const refusal = refusalOf(windowBound({ page, size }));
    expect(refusal.param).toBe(param);
    // The value AS SENT — never trimmed, repaired or rounded.
    expect(refusal.bound).toBe(param === PAGE_PARAM ? page : size);
    expect(refusal.reason.length).toBeGreaterThan(0);
    expect(Object.hasOwn(windowBound({ page, size }), "window")).toBe(false);
  });

  it("names the figure a refusal turns on, so an operator knows what to send instead", () => {
    expect(refusalOf(windowBound({ page: "1", size: "30" })).reason).toContain("20, 50, 100");
    expect(refusalOf(windowBound({ page: "0", size: null })).reason).toContain("1");
    const past = refusalOf(windowBound({ page: String(largestPage(50) + 1), size: "50" }));
    expect(past.reason).toContain(String(largestPage(50)));
    expect(past.reason).toContain(String(MAX_PAGE_OFFSET + 1));
    // …and the largest page really is served, one past it really is not.
    expect(windowBound({ page: String(largestPage(50)), size: "50" }).kind).toBe("ok");
    expect(windowBound({ page: String(largestPage(100)), size: "100" }).kind).toBe("ok");
    expect(windowBound({ page: String(largestPage(100) + 1), size: "100" }).kind).toBe("refused");
  });

  it("reads the size BEFORE the page, so a ceiling refusal is about the size that was named", () => {
    // Page 3,000 is past the ceiling at 50 and within it at 20? No: 2,999 × 20
    // = 59,980, under 100,000 — so the same page is served at one size and
    // refused at another, which is only right if the size is read first.
    expect(servedOf(windowBound({ page: "3000", size: "20" })).offset).toBe(59_980);
    expect(refusalOf(windowBound({ page: "3000", size: "50" })).param).toBe(PAGE_PARAM);
    // A refused size is refused before the page is read at all.
    expect(refusalOf(windowBound({ page: "abc", size: "30" })).param).toBe(SIZE_PARAM);
  });

  it("never throws, whatever the URL carries", () => {
    for (const raw of ["50", "", " ", "9".repeat(400), "‮50", null, undefined]) {
      expect(() => windowBound({ page: raw, size: raw }), String(raw)).not.toThrow();
    }
  });
});

describe("the window arithmetic", () => {
  it("names the window at another size that holds this window's first row (design question 1)", () => {
    // On rows 51–100 at size 50, switching to 20 lands on rows 41–60 and
    // switching to 100 on rows 1–100 — the row the operator was reading from
    // stays on screen.
    const at50: PageWindow = { page: 2, size: 50 };
    expect(containingWindow(at50, 20)).toEqual({ page: 3, size: 20 });
    expect(containingWindow(at50, 100)).toEqual({ page: 1, size: 100 });
    expect(containingWindow(at50, 50)).toEqual(at50);
    // Rows 101–120 at 20: at 50 that is rows 101–150 (page 3); at 100, rows
    // 101–200 (page 2).
    expect(containingWindow({ page: 6, size: 20 }, 50)).toEqual({ page: 3, size: 50 });
    expect(containingWindow({ page: 6, size: 20 }, 100)).toEqual({ page: 2, size: 100 });
    // The first window at any size holds row 1.
    for (const size of WINDOW_SIZES) {
      expect(containingWindow({ page: 1, size: 100 }, size)).toEqual({ page: 1, size });
    }
  });

  it("steps one window at a time, and the first window has no previous", () => {
    expect(nextWindow({ page: 1, size: 20 })).toEqual({ page: 2, size: 20 });
    expect(previousWindow({ page: 2, size: 20 })).toEqual({ page: 1, size: 20 });
    expect(previousWindow({ page: 1, size: 20 })).toBeNull();
    expect(sameWindow({ page: 2, size: 20 }, { page: 2, size: 20 })).toBe(true);
    expect(sameWindow({ page: 2, size: 20 }, { page: 2, size: 50 })).toBe(false);
  });

  it("writes the window into a query ONCE, overriding whatever the facets carried", () => {
    // Appending is not overriding (admin-window/BUG-0166): a query carrying a
    // stale page would otherwise be read FIRST by a handler.
    const query = new URLSearchParams(
      windowQuery(`tab=standing&${PAGE_PARAM}=9&source_id=abc&${SIZE_PARAM}=100`, {
        page: 2,
        size: 20,
      }),
    );
    expect(query.getAll(PAGE_PARAM)).toEqual(["2"]);
    expect(query.getAll(SIZE_PARAM)).toEqual(["20"]);
    expect(query.get("tab")).toBe("standing");
    expect(query.get("source_id")).toBe("abc");
    expect([...query.keys()]).toEqual(["tab", "source_id", PAGE_PARAM, SIZE_PARAM]);
    // A leading `?` or `&` on the facets is tolerated, and empty facets too.
    expect(windowQuery("?a=1", { page: 1, size: 50 })).toBe(windowQuery("a=1", { page: 1, size: 50 }));
    expect(windowQuery("", { page: 1, size: 50 })).toBe(`${PAGE_PARAM}=1&${SIZE_PARAM}=50`);
    // …and round-trips through the guard to the same window.
    const back = new URLSearchParams(windowQuery("", { page: 7, size: 100 }));
    expect(servedOf(windowBound({ page: back.get(PAGE_PARAM), size: back.get(SIZE_PARAM) })).window).toEqual({
      page: 7,
      size: 100,
    });
  });

  it("ends the set inside a SHORT window and says nothing about a full one", () => {
    expect(endsWithin(49, 50)).toBe(true);
    expect(endsWithin(0, 50)).toBe(true);
    expect(endsWithin(50, 50)).toBe(false);
  });

  it("reads a page's parameters by their FIRST value, as a query does", () => {
    expect(rawWindowOf({ [PAGE_PARAM]: ["3", "9"], [SIZE_PARAM]: "20" })).toEqual({ page: "3", size: "20" });
    expect(rawWindowOf({})).toEqual({ page: undefined, size: undefined });
  });
});

describe("isPageNotes", () => {
  const note = { kind: "not_provisioned", missing: "event_listings" };
  const failed = { kind: "error", reading: "field_provenance", message: "refused" };

  it("accepts a record of notes and nulls, by whatever keys the surface spells", () => {
    for (const notes of [{}, { venues: null }, { venues: note, provenance: failed }, { anything: null }]) {
      expect(isPageNotes(notes), JSON.stringify(notes)).toBe(true);
    }
  });

  it("refuses anything that is not a record of notes, including notes wearing the right shape", () => {
    const foreign: unknown[] = [
      null,
      undefined,
      [],
      "venues",
      { venues: "missing" },
      { venues: { kind: "ok", data: [] } },
      { venues: { kind: "not_provisioned" } },
      { venues: { kind: "error", reading: "x" } },
      { venues: { kind: "error", reading: "x", message: "m", authored: "the machine" } },
      { venues: null, provenance: 7 },
    ];
    for (const notes of foreign) {
      expect(isPageNotes(notes), JSON.stringify(notes ?? String(notes))).toBe(false);
    }
  });
});
