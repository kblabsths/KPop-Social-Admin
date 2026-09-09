import { describe, expect, it } from "vitest";
import {
  ANY_LABEL,
  CLAIM_FACETS,
  DEFAULT_TAB,
  TABS,
  claimsHref,
  droppedParams,
  facetChips,
  filterBar,
  filterFrom,
  hasNarrowingFacet,
  sourceHref,
  tabFrom,
  tabLinks,
  withFacet,
  type ClaimsFilter,
  type FacetOptions,
} from "@/lib/claims/filters";
import { recordHref } from "@/lib/records/routes";

/**
 * The Claims page's URL state (campaign admin-window/TASK-0012) — the pure
 * leaf, tested without rendering anything, the way
 * `tests/offline/queues/filters.test.ts` tests its twin.
 *
 * The vocabularies are spelled HERE rather than imported from the data layer:
 * this file's job is to prove that a parameter naming something outside the
 * offered set narrows nothing, and asking the app which set it offers would
 * only prove the two agree with themselves.
 */

const PATH = "/claims";

const BUCKETS = [
  "standing_disagreement",
  "awaiting_link",
  "awaiting_row",
  "escalated",
  "agreeing",
];

const SOURCES = ["source-a", "source-b"];
const DOMAINS = ["events", "venues"];

const OPTIONS: FacetOptions = {
  bucket: BUCKETS,
  source_id: SOURCES,
  domain: DOMAINS,
};

describe("the facets", () => {
  it("are spec §4's three, each named for the field it narrows", () => {
    expect([...CLAIM_FACETS]).toEqual(["bucket", "source_id", "domain"]);
  });

  it("reads each facet out of the URL", () => {
    const filter = filterFrom(
      { bucket: "escalated", source_id: "source-b", domain: "venues" },
      OPTIONS,
    );
    expect(filter).toEqual({
      bucket: "escalated",
      source_id: "source-b",
      domain: "venues",
    });
    expect(hasNarrowingFacet(filter)).toBe(true);
  });

  it("narrows nothing for an absent, repeated or unrecognised parameter", () => {
    expect(filterFrom({}, OPTIONS)).toEqual({});
    expect(hasNarrowingFacet({})).toBe(false);
    // The first value wins, as URLSearchParams.get() does.
    expect(filterFrom({ bucket: ["escalated", "agreeing"] }, OPTIONS)).toEqual({
      bucket: "escalated",
    });
    expect(filterFrom({ bucket: [] }, OPTIONS)).toEqual({});
    // A value outside the offered set constrains nothing, so a typo shows the
    // unfiltered page rather than an empty one that reads as an empty database.
    expect(filterFrom({ source_id: "not-a-source" }, OPTIONS)).toEqual({});
    expect(filterFrom({ bucket: "invented" }, OPTIONS)).toEqual({});
  });

  it("treats the parked bucket as no narrowing, so it never re-enters an href", () => {
    // The vocabulary a page offers is the renderable buckets; the parked one
    // is not in it. A hand-typed `?bucket=in_window` therefore selects
    // nothing, is not the active chip, and — the leak that would matter — is
    // not carried into the href of every other chip on the page
    // (LOOK_AND_FEEL quality bar 3).
    const parked = "in_" + "window";
    const filter = filterFrom({ bucket: parked, source_id: "source-a" }, OPTIONS);
    expect(filter).toEqual({ source_id: "source-a" });

    const rendered = [
      claimsHref(PATH, filter, "buckets"),
      ...filterBar(PATH, filter, "buckets", OPTIONS).flatMap((group) =>
        group.choices.map((choice) => choice.href),
      ),
      ...tabLinks(PATH, filter, "buckets").map((tab) => tab.href),
    ].join(" ");
    expect(rendered).not.toContain(parked);
  });
});

describe("the tabs", () => {
  it("are the two the spec names, defaulting to the buckets view", () => {
    expect([...TABS]).toEqual(["buckets", "standing"]);
    expect(DEFAULT_TAB).toBe("buckets");
    expect(tabFrom({})).toBe("buckets");
    expect(tabFrom({ tab: "standing" })).toBe("standing");
    expect(tabFrom({ tab: "nonsense" })).toBe("buckets");
  });

  it("keeps the filter when crossing between them", () => {
    const filter: ClaimsFilter = { source_id: "source-b" };
    const [buckets, standing] = tabLinks(PATH, filter, "standing");

    expect(buckets.href).toBe("/claims?source_id=source-b");
    expect(standing.href).toBe("/claims?source_id=source-b&tab=standing");
    expect(standing.active).toBe(true);
    expect(buckets.active).toBe(false);
  });
});

describe("the URL a state has", () => {
  it("omits every parameter that narrows nothing, so one state has one URL", () => {
    expect(claimsHref(PATH, {}, "buckets")).toBe("/claims");
    expect(claimsHref(PATH, {})).toBe("/claims");
    expect(claimsHref(PATH, {}, "standing")).toBe("/claims?tab=standing");
  });

  it("writes the facets in one fixed order", () => {
    const href = claimsHref(
      PATH,
      { domain: "events", source_id: "source-a", bucket: "escalated" },
      "buckets",
    );
    expect(href).toBe("/claims?bucket=escalated&source_id=source-a&domain=events");
  });

  it("round-trips every filter it writes", () => {
    const filter: ClaimsFilter = {
      bucket: "awaiting_row",
      source_id: "source-b",
      domain: "venues",
    };
    const query = new URL(claimsHref(PATH, filter, "standing"), "https://x");
    const params = Object.fromEntries(query.searchParams.entries());
    expect(filterFrom(params, OPTIONS)).toEqual(filter);
    expect(tabFrom(params)).toBe("standing");
  });
});

describe("one facet at a time", () => {
  it("changes one and keeps the others", () => {
    const filter: ClaimsFilter = { bucket: "escalated", domain: "events" };
    expect(withFacet(filter, "source_id", "source-a")).toEqual({
      bucket: "escalated",
      domain: "events",
      source_id: "source-a",
    });
    expect(withFacet(filter, "bucket", undefined)).toEqual({ domain: "events" });
    // The input is untouched — a pure function over a filter.
    expect(filter).toEqual({ bucket: "escalated", domain: "events" });
  });

  it("offers 'all' first, then exactly the values it was handed", () => {
    const group = facetChips(PATH, { bucket: "escalated" }, "buckets", "bucket", BUCKETS);
    expect(group.facet).toBe("bucket");
    expect(group.choices.map((choice) => choice.label)).toEqual([
      ANY_LABEL,
      ...BUCKETS,
    ]);
    expect(group.choices.filter((choice) => choice.active)).toHaveLength(1);
    expect(
      group.choices.find((choice) => choice.label === "escalated")?.active,
    ).toBe(true);
    // "all" clears this facet and keeps the tab.
    expect(group.choices[0].href).toBe("/claims");
  });

  it("builds one group per facet, in facet order", () => {
    expect(filterBar(PATH, {}, "buckets", OPTIONS).map((group) => group.facet)).toEqual([
      ...CLAIM_FACETS,
    ]);
  });
});

describe("where a claim leads", () => {
  it("links to its source's own page, narrowed to it", () => {
    expect(sourceHref("source a/b")).toBe("/sources?source_id=source%20a%2Fb");
  });

  it("links to the record where its fact's provenance is shown", () => {
    expect(recordHref("events", "e-1")).toBe("/records/events/e-1");
    expect(recordHref("venues", "v/1")).toBe("/records/venues/v%2F1");
  });

  it("offers no provenance link for a record that does not exist yet", () => {
    // An `awaiting_row` claim's record has no canonical row — there is no fact
    // to show provenance for, and the row says what it is waiting for instead.
    expect(recordHref("events", null)).toBeNull();
    expect(recordHref("events", "")).toBeNull();
  });
});

describe("what the URL asked for and the page did not do", () => {
  const APPLIED: ClaimsFilter = { bucket: "escalated" };

  it("names a parameter this page never applied, and only that one", () => {
    expect(
      droppedParams({ bucket: "escalated", record_id: "r-1" }, APPLIED),
    ).toEqual({ named: ["record_id"], withheld: 0 });
    // The tab is consumed by the page, and a facet that reached the filter is
    // applied — neither is a dropped narrowing.
    expect(droppedParams({ tab: "standing", bucket: "escalated" }, APPLIED)).toEqual({
      named: [],
      withheld: 0,
    });
    // A facet whose value no chip offers narrowed nothing, so it IS dropped.
    expect(droppedParams({ bucket: "invented" }, {})).toEqual({
      named: ["bucket"],
      withheld: 0,
    });
  });

  it("counts a parameter whose own NAME the app may not render, and spells none of it", () => {
    const parked = "in_" + "window";
    expect(droppedParams({ [parked]: "1" }, {}, [parked])).toEqual({
      named: [],
      withheld: 1,
    });
  });

  it("ignores a key that is empty or blank, exactly as it ignores an empty value", () => {
    // admin-window/BUG-0127: `/claims?=x` reaches the page as `{"": "x"}` and
    // `/claims?%20%20=1` as `{"  ": "1"}`. A query pair is a request only when
    // it has both halves: a value carrying no name asks for nothing this page
    // could have applied, so it is the URL saying nothing — the same answer
    // `?bucket=` already gets — and not a narrowing to report. Counting it
    // instead would put it on the `withheld` path, whose sentence ("a
    // parameter this page may not name") states a reason that is not the
    // reason: there is no name being withheld.
    expect(droppedParams({ "": "x" }, {})).toEqual({ named: [], withheld: 0 });
    expect(droppedParams({ "  ": "1" }, {})).toEqual({ named: [], withheld: 0 });
    expect(droppedParams({ "\t\n": "1" }, {})).toEqual({ named: [], withheld: 0 });
    // The empty VALUE this sits beside, unchanged.
    expect(droppedParams({ record_id: "" }, {})).toEqual({ named: [], withheld: 0 });
    // A blank key alongside a real one drops neither the report nor the count.
    expect(droppedParams({ "": "x", record_id: "r-1" }, {})).toEqual({
      named: ["record_id"],
      withheld: 0,
    });
  });

  /**
   * The same rule, on the half `String.prototype.trim` cannot see
   * (admin-window/BUG-0136).
   *
   * `trim()` strips the Unicode `White_Space` set and nothing else, so
   * `?%E2%80%8B=1` (ZERO WIDTH SPACE), `?%00=1`, `?%C2%AD=1` (SOFT HYPHEN),
   * `?%E2%81%A0=1` (WORD JOINER), `?%E2%80%8E=1` (LEFT-TO-RIGHT MARK) and
   * `?%7F=1` (DELETE) all reached `named` and were spelled into the mono span,
   * where Chromium laid every one of them out at 0px — the same hole
   * admin-window/BUG-0127 closed for `?=x`, reached through a codepoint
   * instead of a space. `droppedParams` now asks the app's ONE definition of
   * blank (`hasVisibleContent`, `lib/verdict/decision.ts`,
   * admin-window/BUG-0089) rather than `trim()`, so both halves get the same
   * answer from the same rule.
   */
  it("ignores a key with no visible content, whatever its codepoints", () => {
    // Ink-less by category: controls (Cc), format characters (Cf) and a
    // Hangul filler — none of which `trim()` removes.
    const inkLess = [
      "\u0000", // NULL
      "\u200B", // ZERO WIDTH SPACE
      "\u00AD", // SOFT HYPHEN
      "\u2060", // WORD JOINER
      "\u3164", // HANGUL FILLER
      "\u200E", // LEFT-TO-RIGHT MARK
      "\u007F", // DELETE
      "\u00A0", // NO-BREAK SPACE — whitespace, so trim() saw this one too
      "\uFEFF", // ZERO WIDTH NO-BREAK SPACE (BOM)
      "\u200B\u00AD\u2060", // a key made of nothing else
      " \u200B ", // mixed with the whitespace half
    ];
    for (const key of inkLess) {
      const where = [...key]
        .map(
          (c) =>
            "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
        )
        .join(" ");
      expect(droppedParams({ [key]: "1" }, {}), where).toEqual({
        named: [],
        withheld: 0,
      });
    }
  });

  it("names a key that puts any ink on the page, however little", () => {
    // The other direction, so the rule above cannot pass by dropping every
    // dropped parameter. One printable character on the renderable allowlist
    // is a name an operator can read back.
    for (const key of [".", "-", "_", "0", "record_id", "bucket", "in_windows"]) {
      expect(droppedParams({ [key]: "1" }, {}), JSON.stringify(key)).toEqual({
        named: [key],
        withheld: 0,
      });
    }

    // MOVED by admin-window/BUG-0137 (criterion 6), from `named` to counted.
    // These three carry ink — `hasVisibleContent` still says so, and
    // `decision.ts` is untouched — but ink is no longer what decides SPELLING.
    // The line spells a key only from the renderable allowlist
    // `^[A-Za-z0-9_.-]{1,64}$` (ARCHITECTURE.md §7), because "does this render
    // ink" and "does this read as the word bar 3 bans" are not decidable by
    // codepoint class: `in_win<U+034F>dow` reads as the parked word, and so
    // would a homoglyph nobody has typed yet. Each is still COUNTED — a
    // parameter was carried and dropped, and the page says so without
    // spelling it.
    for (const key of [
      "\u8A18\u9332", // CJK: ink, and outside the class the page can promise
      "\u2800", // BRAILLE PATTERN BLANK: content to `decision.ts`, unspellable here
      "record_id\u200B", // ASCII plus a ZWSP — no longer byte-identical to a name
    ]) {
      expect(droppedParams({ [key]: "1" }, {}), JSON.stringify(key)).toEqual({
        named: [],
        withheld: 1,
      });
    }
  });

  it("still counts, and still refuses to spell, a name the app may not render", () => {
    // LOOK_AND_FEEL bar 3 through the ink-less half: `in_window` must appear
    // nowhere, and a key that READS as `in_window` because its extra
    // codepoints draw nothing would put it on screen just as surely. The
    // withheld test therefore asks what a reader would SEE of the key,
    // through the same one definition (admin-window/BUG-0136).
    const parked = "in_" + "window";
    expect(droppedParams({ [parked]: "1" }, {}, [parked])).toEqual({
      named: [],
      withheld: 1,
    });
    expect(droppedParams({ [parked + "\u200B"]: "1" }, {}, [parked])).toEqual({
      named: [],
      withheld: 1,
    });
    expect(droppedParams({ "in\u200B_window": "1" }, {}, [parked])).toEqual({
      named: [],
      withheld: 1,
    });
    // A key with no visible content at all is ignored BEFORE the withheld
    // test: there is no name to withhold, so nothing is counted either.
    expect(droppedParams({ "\u200B": "1" }, {}, [parked])).toEqual({
      named: [],
      withheld: 0,
    });
    // And an ordinary neighbour of the parked word is still named in full.
    expect(droppedParams({ in_windows: "1" }, {}, [parked])).toEqual({
      named: ["in_windows"],
      withheld: 0,
    });
  });

  /**
   * The rule itself, both ways (admin-window/BUG-0137, criteria 1, 3 and 7).
   *
   * ARCHITECTURE.md §7: "text this app did not author never sits inside a
   * sentence this app wrote" — foreign text reaches prose through an
   * allowlist or inside its own box, never by scrubbing. This line takes the
   * allowlist arm, so what it spells is byte-identical to what the URL
   * carried (spec §11), and everything else is counted through the `withheld`
   * arm that already existed for the parked word.
   */
  it("spells a key only from the renderable allowlist, and counts every other", () => {
    // NAMED: the class every facet this page could ever offer satisfies, and
    // the class in which a key renders as itself.
    const parked = "in_" + "window";
    for (const key of ["record_id", "bucket", "a.b-c_9", "A0", "a".repeat(64)]) {
      expect(droppedParams({ [key]: "1" }, {}, [parked]), JSON.stringify(key)).toEqual({
        named: [key],
        withheld: 0,
      });
    }

    // COUNTED: outside the class by character, or longer than 64. Length is
    // bounded because a name spelled verbatim is a line the operator reads,
    // and no facet this page offers is longer than 12 characters.
    for (const key of [
      "\u8A18\u9332", // CJK — ink, but not a name this page can promise
      "\uFE0F", // VARIATION SELECTOR-16 — 0px in Chromium
      "\u202Eabc", // RIGHT-TO-LEFT OVERRIDE — reversed the app's own sentence
      "a b", // a space, so the name would not read as one token
      "a".repeat(65), // one character past the bound
    ]) {
      const where = [...key]
        .map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
        .join(" ");
      expect(droppedParams({ [key]: "1" }, {}, [parked]), where).toEqual({
        named: [],
        withheld: 1,
      });
    }

    // The allowlist decides SPELLING, never whether a parameter was dropped:
    // a key that carries no name at all is still ignored before it, and a
    // key that carries no value still asked for nothing.
    expect(droppedParams({ "\u200B": "1" }, {})).toEqual({ named: [], withheld: 0 });
    expect(droppedParams({ record_id: "" }, {})).toEqual({ named: [], withheld: 0 });
  });

  /**
   * The half the CATEGORY the one definition names cannot see
   * (admin-window/BUG-0137, QA).
   *
   * `hasVisibleContent` removes `\p{White_Space}`, `\p{Cf}`, `\p{Cc}` and the
   * four Hangul fillers — not `\p{Mn}`. So a key of nothing but a nonspacing
   * mark reaches `named` and is spelled into the mono span, where Chromium
   * lays it out at **width 0px, is_visible false** and the operator reads
   * "The URL carries , which this page did not apply" — the hole
   * admin-window/BUG-0127 and BUG-0136 each closed for their own family of
   * codepoints. Measured over HTTP on a production build (port 8798,
   * staging, 2026-09-09), identical in light and dark; the `record_id`
   * control measures 59.41px, visible.
   *
   * FIXED by admin-window/BUG-0137, the arm this pin's own text offers
   * second — "spell something an operator can read back" — taken as a rule
   * rather than as a fourth codepoint family: a key is spelled only if its
   * RAW characters match the renderable allowlist `^[A-Za-z0-9_.-]{1,64}$`
   * (`droppedParams`, `src/lib/claims/filters.ts`; ARCHITECTURE.md §7,
   * "text this app did not author never sits inside a sentence this app
   * wrote"). None of these three keys does, so none is spelled — and each
   * is COUNTED rather than ignored, which is the ONE field of this pin that
   * moved (`withheld: 1`, not `0`): a parameter really was carried and
   * dropped, the key has visible content by the app's one definition of
   * blank, and bar 13 has the page say so without naming it. The other arm
   * — ignoring them — would need a second opinion about blankness in this
   * file, which is the fourth blocklist admin-window/BUG-0137 exists to
   * refuse (measured: `agenticflow/tracker/evidence/BUG-0137/rule-dryrun.mjs`).
   */
  it("ignores a key that is nothing but marks a reader cannot see", () => {
    // Each measured at width 0px in Chromium, both colour schemes:
    // U+FE0F VARIATION SELECTOR-16, U+034F COMBINING GRAPHEME JOINER,
    // U+0301 COMBINING ACUTE ACCENT.
    for (const key of ["\uFE0F", "\u034F", "\u0301"]) {
      const where =
        "U+" + key.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      expect(droppedParams({ [key]: "1" }, {}), where).toEqual({
        named: [],
        withheld: 1,
      });
    }
  });

  /**
   * LOOK_AND_FEEL bar 3 through the same gap (admin-window/BUG-0137, QA):
   * "`in_window` appears nowhere — not as a bucket row, not as a filter
   * option, not as a zero, on any page", and `contracts/admin-build.md`
   * acceptance test 3 says the same. admin-window/BUG-0136 made the withheld
   * test read the key as a reader would (`visibleContent`), which catches
   * `in_window\u200B`; a mark that same definition rules CONTENT rides
   * straight through it, and the parked word is rendered legibly.
   *
   * Measured in Chromium on a production build (port 8798, 2026-09-09, both
   * colour schemes): `/claims?in_window%EF%B8%8F=1` renders the mono span
   * `in_window` at **59.41px, visible — the `record_id` control's exact
   * width**, because U+FE0F adds no ink; `/claims?in_win%CD%8Fdow=1` the
   * same; `/claims?in_window%E2%A0%80=1` at 66.92px (the word plus a blank
   * braille cell). FIXED by admin-window/BUG-0137 — see the pin above: none
   * of the three keys matches the renderable allowlist, so none reaches the
   * mono span, and each is counted through the `withheld` arm exactly as an
   * exact `in_window` already was.
   */
  it("still refuses to spell the parked word when an inkless mark rides along", () => {
    const parked = "in_" + "window";
    for (const key of [parked + "\uFE0F", "in_win\u034Fdow", parked + "\u2800"]) {
      const where = [...key]
        .map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
        .join(" ");
      // Still COUNTED — bar 13's "no screen claims a mark it did not draw" is
      // kept by saying one was dropped without spelling it.
      expect(droppedParams({ [key]: "1" }, {}, [parked]), where).toEqual({
        named: [],
        withheld: 1,
      });
    }
    // Not vacuous: an ordinary neighbour of the parked word is still named.
    expect(droppedParams({ in_windows: "1" }, {}, [parked])).toEqual({
      named: ["in_windows"],
      withheld: 0,
    });
  });
});
