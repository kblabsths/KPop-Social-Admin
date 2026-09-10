import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_OFFSET,
  OFFSET_PARAM,
  PAGE_ROUTES,
  pageBound,
  type PageBound,
} from "@/lib/paging/bounds";

/**
 * The bound value class — campaign admin-window/TASK-0063, ARCHITECTURE.md
 * §4.3 read kind 3.
 *
 * The guard that counts is the server's (LESSONS 8), so this grades the
 * function the route handler asks, on both fixtures every guard here owes: the
 * spellings it MUST refuse, and the ones it must NOT.
 *
 * Nothing below pins a refusal's WORDS. What is graded is the answer: refused
 * or not, the bound named back verbatim, and — where the number is the whole
 * point — that the sentence carries the constraint's own figure.
 */

/** The window a paging surface hands in. A second one appears below, so
 * nothing here can quietly key on 50. */
const SIZE = 50;

/** The refused arm, or a failure that says what came back instead. */
function refusalOf(bound: PageBound): { reason: string; bound: string } {
  expect(bound.kind, JSON.stringify(bound)).toBe("refused");
  return bound as { kind: "refused"; reason: string; bound: string };
}

describe("the paging vocabulary", () => {
  it("spells each surface's route once, under this app's own api path", () => {
    // The two surfaces §4.3 names, and the shape rule 1's amended exception
    // frames: a relative path into this app's own route handlers.
    expect(Object.keys(PAGE_ROUTES).sort()).toEqual(["browse", "claims"]);
    for (const route of Object.values(PAGE_ROUTES)) {
      expect(route.startsWith("/api/admin/")).toBe(true);
    }
    expect(new Set(Object.values(PAGE_ROUTES)).size).toBe(2);
    expect(OFFSET_PARAM.length).toBeGreaterThan(0);
  });
});

describe("pageBound", () => {
  it("answers ok for a canonical multiple of the window, at the window and at the ceiling", () => {
    // The fixture the guard must NOT flag, at every edge it has: the smallest
    // legal bound (the first screen's own size), an ordinary one, and the
    // ceiling itself — which is IN range, not out of it.
    for (const [raw, offset] of [
      ["50", 50],
      ["100", 100],
      ["1000", 1000],
      [String(MAX_PAGE_OFFSET), MAX_PAGE_OFFSET],
    ] as const) {
      expect(pageBound(raw, SIZE), raw).toEqual({ kind: "ok", offset });
    }
  });

  it("reads the window it is handed, never a window of its own", () => {
    // The size is the SERVER's, so the same raw value is legal against one
    // window and refused against another.
    expect(pageBound("25", 25)).toEqual({ kind: "ok", offset: 25 });
    expect(pageBound("75", 25)).toEqual({ kind: "ok", offset: 75 });
    expect(refusalOf(pageBound("75", SIZE)).bound).toBe("75");
    expect(refusalOf(pageBound("25", SIZE)).bound).toBe("25");
  });

  it("refuses every spelling that is not the bound that was sent, naming it", () => {
    // What is USED is what was SENT (common violations row 20): most of these
    // are values `Number()` would happily turn into a usable offset the caller
    // never wrote.
    const refused = [
      "", // stated and empty
      " ", // whitespace only
      " 50", // padded
      "50 ",
      "\u00A050", // padded with a space that does not look like one
      "+50", // signed
      "-50",
      "050", // leading zero
      "50.0", // fractional spelling
      "1e2", // exponent
      "0x32", // another base
      "1_000", // a separator
      "\uFF15\uFF10", // fullwidth digits
      "abc",
      "50,100", // two bounds
      "75", // a canonical decimal that is not a multiple of the window
      "0", // below the window: the first screen is the server's
      "49",
      String(MAX_PAGE_OFFSET + SIZE), // above the ceiling
      String(MAX_PAGE_OFFSET * 1000),
    ];
    for (const raw of refused) {
      const refusal = refusalOf(pageBound(raw, SIZE));
      // Named back verbatim, in the spelling it arrived in.
      expect(refusal.bound, raw).toBe(raw);
      expect(refusal.reason.length, raw).toBeGreaterThan(0);
      // Never clamped: a refusal carries no offset for a caller to reach for.
      expect(Object.hasOwn(pageBound(raw, SIZE), "offset"), raw).toBe(false);
    }
  });

  it("refuses an absent bound rather than defaulting it to zero", () => {
    // The handler serves what comes AFTER the first screen, so an unstated
    // bound is a refusal, not a 0.
    for (const raw of [null, undefined]) {
      const refusal = refusalOf(pageBound(raw, SIZE));
      expect(refusal.bound).toBe("");
      expect(refusal.reason.length).toBeGreaterThan(0);
    }
  });

  it("says which figure the bound missed, in the refusals that turn on one", () => {
    // Not the wording — the number. A refusal that names neither the window
    // nor the ceiling tells an operator nothing about what to send instead.
    expect(refusalOf(pageBound("75", SIZE)).reason).toContain(String(SIZE));
    expect(refusalOf(pageBound("0", SIZE)).reason).toContain(String(SIZE));
    expect(refusalOf(pageBound(String(MAX_PAGE_OFFSET + SIZE), SIZE)).reason).toContain(
      String(MAX_PAGE_OFFSET),
    );
  });

  it("refuses rather than divides when the window itself is not a window", () => {
    // No bound can be checked against a window that is not one, and "which
    // offsets are multiples of 0?" has no answer worth guessing.
    for (const size of [0, -50, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(refusalOf(pageBound("50", size)).bound, String(size)).toBe("50");
    }
  });

  it("never throws, whatever the bound is", () => {
    for (const raw of ["50", "", " ", "9".repeat(400), "\u202E50", null, undefined]) {
      expect(() => pageBound(raw, SIZE), String(raw)).not.toThrow();
    }
    // A 400-digit bound is refused as itself, not accepted as an Infinity.
    expect(refusalOf(pageBound("9".repeat(400), SIZE)).bound.length).toBe(400);
  });
});
