import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EM_DASH, absoluteUtc, count, isAbsent, nullDash, orDash, relativeAge } from "@/lib/format";

/**
 * The shared formatting helpers (campaign admin-window, TASK-0004).
 * LOOK_AND_FEEL Voice bar 6: ages are relative with the absolute value in the
 * title attribute, scheduled times are absolute, counts are separated, and a
 * null is the dash — never blank, never `null`, `N/A` or `none`.
 */

const T = "2026-08-29T04:12:33.000Z";

describe("absoluteUtc", () => {
  it("states the zone and drops the ISO punctuation", () => {
    expect(absoluteUtc(T)).toBe("2026-08-29 04:12 UTC");
  });

  it("accepts a Date and an epoch as well as a string", () => {
    expect(absoluteUtc(new Date(T))).toBe(absoluteUtc(T));
    expect(absoluteUtc(new Date(T).getTime())).toBe(absoluteUtc(T));
  });

  it("renders absence as the dash rather than a blank or the word null", () => {
    for (const missing of [null, undefined, "", "not a date"]) {
      expect(absoluteUtc(missing)).toBe(EM_DASH);
    }
  });
});

describe("relativeAge", () => {
  const at = (seconds: number) => new Date(Date.parse(T) + seconds * 1000);

  it("climbs one unit ladder: seconds, minutes, hours, days", () => {
    expect(relativeAge(T, at(30)).text).toBe("just now");
    expect(relativeAge(T, at(5 * 60)).text).toBe("5m ago");
    expect(relativeAge(T, at(3 * 3600)).text).toBe("3h ago");
    expect(relativeAge(T, at(3 * 86_400)).text).toBe("3d ago");
    expect(relativeAge(T, at(400 * 86_400)).text).toBe("400d ago");
  });

  it("truncates rather than rounds up, so nothing ages early", () => {
    expect(relativeAge(T, at(2 * 86_400 + 23 * 3600)).text).toBe("2d ago");
  });

  it("carries the absolute value for the title attribute", () => {
    expect(relativeAge(T, at(3 * 86_400)).title).toBe(absoluteUtc(T));
  });

  it("reads a future timestamp forwards", () => {
    expect(relativeAge(T, at(-2 * 86_400)).text).toBe("in 2d");
  });

  it("renders absence as the dash with no title", () => {
    expect(relativeAge(null)).toEqual({ text: EM_DASH, title: "" });
  });
});

describe("count", () => {
  it("separates thousands", () => {
    expect(count(1234)).toBe("1,234");
    expect(count(1_234_567)).toBe("1,234,567");
  });

  it("keeps a small number and a zero as themselves", () => {
    expect(count(0)).toBe("0");
    expect(count(42)).toBe("42");
  });

  it("renders absence as the dash, never as zero", () => {
    expect(count(null)).toBe(EM_DASH);
    expect(count(undefined)).toBe(EM_DASH);
    expect(count(Number.NaN)).toBe(EM_DASH);
  });
});

describe("nullDash", () => {
  it("is the em dash in the disabled-gray token", () => {
    const html = renderToStaticMarkup(nullDash());
    expect(html).toContain(EM_DASH);
    expect(html).toContain("text-ink-disabled");
  });

  it("names itself for a screen reader rather than reading out punctuation", () => {
    expect(renderToStaticMarkup(nullDash())).toContain("aria-label");
  });
});

/**
 * The one definition of absence (campaign admin-window/BUG-0004). Primitives
 * ask here rather than each writing `x === null || x === ""`, so a dash a
 * helper produced and a dash a raw null produced render identically.
 */
describe("isAbsent and orDash", () => {
  it("calls absent everything React would draw as nothing", () => {
    for (const missing of [null, undefined, "", "   ", false, true, []]) {
      expect(isAbsent(missing)).toBe(true);
    }
  });

  it("calls absent a figure that is not a finite number, so no cell reads NaN", () => {
    for (const missing of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isAbsent(missing)).toBe(true);
    }
  });

  it("calls absent the dash string the formatting helpers return", () => {
    expect(isAbsent(count(null))).toBe(true);
    expect(isAbsent(absoluteUtc(null))).toBe(true);
    expect(isAbsent(relativeAge(null).text)).toBe(true);
  });

  it("keeps a real value present, including the zero and the empty-looking ones", () => {
    for (const present of [0, "0", count(0), "false", "no value"]) {
      expect(isAbsent(present)).toBe(false);
    }
  });

  it("renders an absence as the same element nullDash produces, and passes a value through", () => {
    expect(renderToStaticMarkup(orDash(count(null)))).toBe(renderToStaticMarkup(nullDash()));
    expect(renderToStaticMarkup(orDash(false))).toBe(renderToStaticMarkup(nullDash()));
    expect(renderToStaticMarkup(orDash(count(1234)))).toBe("1,234");
  });
});
