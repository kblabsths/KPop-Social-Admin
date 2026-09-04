import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EM_DASH,
  absoluteUtc,
  absoluteUtcInZonedColumn,
  count,
  counted,
  duration,
  isAbsent,
  nullDash,
  orDash,
  pluralise,
  relativeAge,
  UTC_ZONE,
} from "@/lib/format";

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

/**
 * The zone is stated ONCE (Voice bar 6): prose and title attributes wear it on
 * the value, a column whose header already says `(UTC)` does not repeat it in
 * 50 cells (admin-window/BUG-0047). Both forms come from one stamp, so they
 * cannot drift apart on the instant itself.
 */
describe("absoluteUtcInZonedColumn", () => {
  it("renders the same instant as absoluteUtc, without the zone token", () => {
    expect(absoluteUtcInZonedColumn(T)).toBe("2026-08-29 04:12");
    expect(absoluteUtcInZonedColumn(T)).not.toContain(UTC_ZONE);
    expect(absoluteUtc(T)).toBe(`${absoluteUtcInZonedColumn(T)} ${UTC_ZONE}`);
  });

  it("agrees with absoluteUtc across kinds and across the day", () => {
    for (const instant of [
      T,
      "2026-01-01T00:00:00.000Z",
      "2026-12-31T23:59:59.000Z",
      new Date(T),
      new Date(T).getTime(),
    ]) {
      expect(absoluteUtc(instant)).toBe(
        `${absoluteUtcInZonedColumn(instant)} ${UTC_ZONE}`,
      );
    }
  });

  it("renders absence as the dash, like every other formatter", () => {
    for (const missing of [null, undefined, "", "not a date"]) {
      expect(absoluteUtcInZonedColumn(missing)).toBe(EM_DASH);
      expect(isAbsent(absoluteUtcInZonedColumn(missing))).toBe(true);
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

describe("duration", () => {
  it("climbs the same unit ladder relativeAge climbs", () => {
    expect(duration(45)).toBe("45s");
    expect(duration(200)).toBe("3m");
    expect(duration(7200)).toBe("2h");
    expect(duration(540_000)).toBe("6d");
  });

  it("keeps a sub-second span visible rather than rounding it to nothing", () => {
    expect(duration(0.25)).toBe("0.3s");
    expect(duration(0)).toBe("0s");
  });

  it("renders a negative span negative, because two clocks disagreeing is a finding", () => {
    expect(duration(-200)).toBe("-3m");
  });

  it("renders absence as the dash, never as zero", () => {
    expect(duration(null)).toBe(EM_DASH);
    expect(duration(undefined)).toBe(EM_DASH);
    expect(duration(Number.NaN)).toBe(EM_DASH);
    expect(duration(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
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

describe("pluralise", () => {
  it("takes the one form at one and the many form at nothing and at more", () => {
    expect(pluralise(1, "it is", "they are")).toBe("it is");
    expect(pluralise(0, "it is", "they are")).toBe("they are");
    expect(pluralise(2, "it is", "they are")).toBe("they are");
    expect(pluralise(769, "it is", "they are")).toBe("they are");
  });

  it("treats a quantity that is not a whole one as many, the way the language does", () => {
    // English gives `1.5 sources`, not `1.5 source` — the form follows the
    // quantity, not the rounding of it.
    expect(pluralise(1.5, "one", "many")).toBe("many");
    expect(pluralise(0.5, "one", "many")).toBe("many");
    expect(pluralise(1.0, "one", "many")).toBe("one");
  });

  it("takes the many form for an unknown quantity, so a dash is never singular", () => {
    for (const unknown of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pluralise(unknown, "one", "many")).toBe("many");
    }
  });

  it("carries whatever the caller's two forms are, verb as readily as noun", () => {
    expect(pluralise(1, "names", "name")).toBe("names");
    expect(pluralise(3, "names", "name")).toBe("name");
  });
});

describe("counted", () => {
  it("agrees with its noun at nothing, at one, and at many", () => {
    // The three cases the app got wrong: staging held exactly one source and
    // the page said "1 sources" (admin-window/BUG-0046).
    expect(counted(0, "source")).toBe("0 sources");
    expect(counted(1, "source")).toBe("1 source");
    expect(counted(2, "source")).toBe("2 sources");
  });

  it("keeps the thousand separator the count already applies", () => {
    expect(counted(1234, "item")).toBe("1,234 items");
    expect(counted(1_000_001, "fold")).toBe("1,000,001 folds");
  });

  it("takes an explicit second form when the regular -s would be wrong", () => {
    expect(counted(1, "entity", "entities")).toBe("1 entity");
    expect(counted(4, "entity", "entities")).toBe("4 entities");
    // A phrase whose verb has to agree is the same problem, so it is the same
    // helper — Sources says this about rejection stamps carrying no reason.
    expect(counted(1, "rejection carries", "rejections carry")).toBe(
      "1 rejection carries",
    );
    expect(counted(2, "rejection carries", "rejections carry")).toBe(
      "2 rejections carry",
    );
  });

  it("renders an unknown count as the dash beside the plural, never as zero and never singular", () => {
    for (const unknown of [null, undefined, Number.NaN]) {
      expect(counted(unknown, "source")).toBe(`${EM_DASH} sources`);
    }
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

  it("keeps a value present when it merely contains or resembles the dash, and when it is composite", () => {
    // The swallow-a-real-value trap: absence recognises the *bare* dash a
    // helper returns, so a value that only contains one, or is a node rather
    // than a scalar, must still render as itself.
    for (const present of [`${EM_DASH}x`, `${EM_DASH} ${EM_DASH}`, "0 ", -0, ["a", "b"]]) {
      expect(isAbsent(present)).toBe(false);
    }
    const element = createElement("span", { className: "real" }, "x");
    expect(renderToStaticMarkup(orDash(element))).toBe(
      renderToStaticMarkup(element),
    );
    expect(renderToStaticMarkup(orDash(["a", "b"]))).toBe("ab");
  });

  it("renders an absence as the same element nullDash produces, and passes a value through", () => {
    expect(renderToStaticMarkup(orDash(count(null)))).toBe(renderToStaticMarkup(nullDash()));
    expect(renderToStaticMarkup(orDash(false))).toBe(renderToStaticMarkup(nullDash()));
    expect(renderToStaticMarkup(orDash(count(1234)))).toBe("1,234");
  });
});
