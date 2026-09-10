import { describe, expect, it } from "vitest";
import {
  ANY_LABEL,
  CHIP_FACETS,
  CLAIM_FACETS,
  CLEARED_BY,
  CLEAR_LABEL,
  DEFAULT_TAB,
  TABS,
  UNCHIPPED_FACETS,
  claimsHref,
  clearNarrowing,
  droppedParams,
  facetChips,
  filterBar,
  filterFrom,
  hasChipNarrowing,
  hasNarrowingFacet,
  sourceHref,
  tabFrom,
  tabLinks,
  unchippedNarrowings,
  unchippedPhrase,
  withFacet,
  type ClaimFacet,
  type ClaimsFilter,
  type ClaimsTab,
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

/**
 * The sources the CHIP ROW offers — real uuids, because that is what the
 * column is and what the registry read hands over (admin-window/BUG-0138).
 *
 * They used to be word-shaped (`source-a`), which was readable while the facet
 * was checked against a vocabulary. It is not any more: `?source_id=` is
 * derived by the app's uuid grammar and applied at the query, so a word-shaped
 * fixture would only ever exercise the arm that narrows NOTHING.
 */
const SOURCES = [
  "0192a000-0000-7000-8000-00000000000a",
  "0192a000-0000-7000-8000-00000000000b",
];

const OPTIONS: FacetOptions = {
  bucket: BUCKETS,
  source_id: SOURCES,
};

/**
 * A registered source as the registry really keys it — a uuid — and the same
 * id in the two other spellings Postgres accepts and a URL can carry
 * (admin-window/DEBT-0009, on admin-window/BUG-0140's property).
 *
 * The fixtures above are deliberately NOT uuids: this file's other job is to
 * prove a value outside the offered set narrows nothing, and word-shaped
 * options make that readable. Both live here because both are real — the
 * comparison this leaf makes has to answer a uuid facet and a word facet with
 * the same rule.
 */
const SOURCE_ID = "259e2030-00bd-4200-8730-4669e46a0c04";

/** Every spelling of `SOURCE_ID` a URL can carry that Postgres would match. */
const ID_SPELLINGS = [
  SOURCE_ID.toUpperCase(),
  SOURCE_ID.replace(/-/g, ""),
  SOURCE_ID.replace(/-/g, "").toUpperCase(),
  ` ${SOURCE_ID}\n`,
];

/**
 * **One id, one narrowing** — admin-window/BUG-0140's property, on `/claims`
 * (admin-window/DEBT-0009).
 *
 * `source_id` is a uuid column, so Postgres matches every spelling of one id
 * while JavaScript matches exactly one; this leaf compares in JavaScript, and
 * compared the URL's RAW value against the ids the view carries. A real
 * source's id, uppercased or with its hyphens left out, therefore selected
 * nothing, was reported by the dropped-parameter line, and the page rendered
 * unnarrowed — the same defect `/sources` was fixed for, one route over. It
 * could not be fixed here until the grammar became a leaf this leaf may
 * import (ARCHITECTURE §4 rule 7).
 */
describe("a source id in another spelling", () => {
  it.each(ID_SPELLINGS)("narrows to the id the view holds, for %o", (spelling) => {
    expect(spelling).not.toBe(SOURCE_ID);
    expect(filterFrom({ source_id: spelling }, BUCKETS)).toEqual({
      source_id: SOURCE_ID,
    });
  });

  it("spells the narrowing back in the one canonical form", () => {
    for (const spelling of ID_SPELLINGS) {
      const filter = filterFrom({ source_id: spelling }, BUCKETS);
      // What the chips and the row links carry is the id the DATABASE prints,
      // never the spelling the URL arrived in.
      expect(claimsHref(PATH, filter)).toBe(`/claims?source_id=${SOURCE_ID}`);
      expect(sourceHref(filter.source_id ?? "")).toBe(`/sources?source_id=${SOURCE_ID}`);
      // ...and the chip for that source is the active one.
      const chips = facetChips(PATH, filter, DEFAULT_TAB, "source_id", [SOURCE_ID]);
      expect(chips.choices.find((choice) => choice.active)?.label).toBe(SOURCE_ID);
    }
  });

  it("says nothing was dropped once the id narrowed", () => {
    for (const spelling of ID_SPELLINGS) {
      const params = { source_id: spelling };
      expect(droppedParams(params, filterFrom(params, BUCKETS))).toEqual({
        named: [],
        withheld: 0,
      });
    }
  });

  /**
   * The second fixture the guard owes (LESSONS 8): a value that is no source
   * id AT ALL narrows nothing and is named by the dropped-parameter line.
   *
   * The guard is the id GRAMMAR now, not a vocabulary (admin-window/BUG-0138).
   * That is a narrower gate than the one this case used to state, and it is
   * the gate that matters: the narrowing is a `.eq()` on a `uuid` column, so a
   * value Postgres cannot read as a uuid is `22P02` — a page-wide error state
   * for one typed character — while a well-formed id nothing carries is a
   * question the database can answer, and answers with zero (the case below).
   */
  it.each([
    "not-a-uuid",
    `${SOURCE_ID.slice(0, 20)} ${SOURCE_ID.slice(20)}`,
    "259e2030-00bd-4200-8730-4669e46a0c0", // one character short
  ])("narrows nothing for %o, and is reported", (asked) => {
    const params = { source_id: asked };
    expect(filterFrom(params, BUCKETS)).toEqual({});
    expect(droppedParams(params, filterFrom(params, BUCKETS))).toEqual({
      named: ["source_id"],
      withheld: 0,
    });
  });

  /**
   * **EXPECTED CHANGE, admin-window/BUG-0138**: a well-formed id this database
   * holds no claim for now NARROWS, and is not reported as dropped.
   *
   * It used to be checked against the distinct sources of the whole claim
   * population — the read this page no longer makes and cannot make
   * concurrently with the reads it narrows — so the page rendered unnarrowed
   * under a line saying the parameter was dropped. The narrowing really
   * happens now: the counts and the window all carry `.eq("source_id", …)`,
   * every figure comes back 0, and the page renders the "nothing matched"
   * card. That is the same answer criterion 7 rules for `?domain=`, on the
   * other facet the page can no longer enumerate.
   */
  it("narrows for a well-formed id nothing carries, and does NOT report it", () => {
    const params = { source_id: "01920000-0000-7000-8000-0000000000a1" };
    const filter = filterFrom(params, BUCKETS);
    expect(filter).toEqual({ source_id: params.source_id });
    expect(droppedParams(params, filter)).toEqual({ named: [], withheld: 0 });
  });

  /**
   * The word facets are answered by the SAME comparison and are unchanged by
   * it: no bucket and no domain is a uuid, so the id grammar has nothing to
   * say about either and the value compares as itself.
   */
  it("leaves a facet whose values are words comparing as words", () => {
    expect(filterFrom({ bucket: "escalated", domain: "venues" }, BUCKETS)).toEqual({
      bucket: "escalated",
      domain: "venues",
    });
    expect(filterFrom({ bucket: " escalated" }, BUCKETS)).toEqual({});
  });
});

describe("the facets", () => {
  it("are spec §4's three, each named for the field it narrows", () => {
    expect([...CLAIM_FACETS]).toEqual(["bucket", "source_id", "domain"]);
  });

  it("reads each facet out of the URL", () => {
    const filter = filterFrom(
      { bucket: "escalated", source_id: SOURCES[1], domain: "venues" },
      BUCKETS,
    );
    expect(filter).toEqual({
      bucket: "escalated",
      source_id: SOURCES[1],
      domain: "venues",
    });
    expect(hasNarrowingFacet(filter)).toBe(true);
  });

  it("narrows nothing for an absent, repeated or unrecognised parameter", () => {
    expect(filterFrom({}, BUCKETS)).toEqual({});
    expect(hasNarrowingFacet({})).toBe(false);
    // The first value wins, as URLSearchParams.get() does.
    expect(filterFrom({ bucket: ["escalated", "agreeing"] }, BUCKETS)).toEqual({
      bucket: "escalated",
    });
    expect(filterFrom({ bucket: [] }, BUCKETS)).toEqual({});
    expect(filterFrom({ source_id: [] }, BUCKETS)).toEqual({});
    // A bucket outside the vocabulary this app declares constrains nothing, so
    // a typo shows the unfiltered page rather than an empty one that reads as
    // an empty database — and a value that is no source id at all narrows
    // nothing either, because the column it would be compared against is a
    // uuid and Postgres refuses the comparison (`22P02`).
    expect(filterFrom({ source_id: "not-a-source" }, BUCKETS)).toEqual({});
    expect(filterFrom({ bucket: "invented" }, BUCKETS)).toEqual({});
  });

  it("treats the parked bucket as no narrowing, so it never re-enters an href", () => {
    // The vocabulary a page offers is the renderable buckets; the parked one
    // is not in it. A hand-typed `?bucket=in_window` therefore selects
    // nothing, is not the active chip, and — the leak that would matter — is
    // not carried into the href of every other chip on the page
    // (LOOK_AND_FEEL quality bar 3).
    const parked = "in_" + "window";
    const filter = filterFrom({ bucket: parked, source_id: SOURCES[0] }, BUCKETS);
    expect(filter).toEqual({ source_id: SOURCES[0] });

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
    const filter: ClaimsFilter = { source_id: SOURCES[1] };
    const [buckets, standing] = tabLinks(PATH, filter, "standing");

    expect(buckets.href).toBe(`/claims?source_id=${SOURCES[1]}`);
    expect(standing.href).toBe(`/claims?source_id=${SOURCES[1]}&tab=standing`);
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
      { domain: "events", source_id: SOURCES[0], bucket: "escalated" },
      "buckets",
    );
    expect(href).toBe(
      `/claims?bucket=escalated&source_id=${SOURCES[0]}&domain=events`,
    );
  });

  it("round-trips every filter it writes", () => {
    const filter: ClaimsFilter = {
      bucket: "awaiting_row",
      source_id: SOURCES[1],
      domain: "venues",
    };
    const query = new URL(claimsHref(PATH, filter, "standing"), "https://x");
    const params = Object.fromEntries(query.searchParams.entries());
    expect(filterFrom(params, BUCKETS)).toEqual(filter);
    expect(tabFrom(params)).toBe("standing");
  });
});

describe("one facet at a time", () => {
  it("changes one and keeps the others", () => {
    const filter: ClaimsFilter = { bucket: "escalated", domain: "events" };
    expect(withFacet(filter, "source_id", SOURCES[0])).toEqual({
      bucket: "escalated",
      domain: "events",
      source_id: SOURCES[0],
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

  /**
   * The facet that narrows without a chip row — Ben's ruling of 2026-09-10
   * (admin-window/BUG-0138, criterion 7).
   *
   * `domain` has no bounded vocabulary Admin can read: the chips used to be
   * the distinct domains of the whole claim population, which is the read this
   * page no longer makes, and `domain_target` is a function taking a domain
   * name rather than an enumerable registry. So the chip row goes and the
   * NARROWING stays — a facet the page cannot enumerate is not a facet it
   * cannot apply.
   *
   * This is the leaf's half: the value is derived and applied, no chip group
   * is built for it, and the page may not call it dropped. The other half —
   * that the applied value reaches EVERY count read and the window read as
   * `.eq("domain", …)`, and that the window line and the bucket caption name
   * it — is graded where the queries and the rendering are:
   * `tests/offline/claims/page.test.ts` ("narrows every count and the window
   * server-side", and "a narrowing with no chip row" for the naming,
   * admin-window/BUG-0160) and `tests/offline/claims/read.test.ts`.
   */
  it("domain narrows every count and the window, with no chip row", () => {
    const params = { domain: "venues" };
    const filter = filterFrom(params, BUCKETS);

    // Applied: the page carries it into every read (see the page's own pin).
    expect(filter).toEqual({ domain: "venues" });
    expect(hasNarrowingFacet(filter)).toBe(true);
    // ...so it was not dropped, and the line may not say it was.
    expect(droppedParams(params, filter)).toEqual({ named: [], withheld: 0 });
    // ...and it still travels in every URL this page writes.
    expect(claimsHref(PATH, filter)).toBe("/claims?domain=venues");

    // No chip row: not a group, not an eyebrow, not an "all" chip.
    const bar = filterBar(PATH, filter, "buckets", OPTIONS);
    expect(bar.map((group) => group.facet)).not.toContain("domain");
    expect(bar.map((group) => group.facet)).toEqual([...CHIP_FACETS]);

    // The padding a paste brings is stripped by the free-text class's own one
    // derivation, so what is queried is what is spelled; a value this app may
    // not spell narrows nothing and IS reported.
    expect(filterFrom({ domain: " venues " }, BUCKETS)).toEqual({ domain: "venues" });
    // ...and padding this app may not SPELL is refused rather than laundered,
    // which is the free-text class's landed rule (admin-window/BUG-0155).
    expect(filterFrom({ domain: "venues\n" }, BUCKETS)).toEqual({});
    expect(filterFrom({ domain: "  " }, BUCKETS)).toEqual({});
    expect(filterFrom({ domain: "\u202Evenues" }, BUCKETS)).toEqual({});
    expect(droppedParams({ domain: "\u202Evenues" }, {})).toEqual({
      named: ["domain"],
      withheld: 0,
    });
  });

  /**
   * The other half of the facet with no chip row (admin-window/BUG-0160).
   *
   * `?domain=` narrows every count and the window read on `/claims` and the
   * page renders no control for it, so nothing on the screen said the page was
   * narrowed at all: `/claims?domain=events` drew `awaiting_row` 741 against
   * 769 unnarrowed and 849 claims against 877, under a window line saying "849
   * claims match these filters" and a caption saying the figures were "under
   * the filters above", with both chip rows reading `all` and the words
   * "domain" and "events" nowhere in the rendered page (designer, staging,
   * 2026-09-10).
   *
   * This is the leaf's share of the fix: the two questions a sentence has to
   * ask before it may say "these filters" or name a narrowing, and the ONE
   * spelling of the words it names it with — the same words the window line
   * takes as a string and the caption and the empty card render with the value
   * in the app's identifier face. What the PAGE does with them is graded where
   * the page is rendered (`tests/offline/claims/page.test.ts`, "a narrowing
   * with no chip row").
   *
   * The words are read off the leaf rather than typed here: this file pins no
   * copy. What it pins is the shape — the value verbatim, the facet named, one
   * spelling in both channels — and the RULE, which is that a facet with a
   * chip row is never named this way and a facet without one always is.
   */
  describe("a domain narrowing is named on the page that applied it", () => {
    it("is the facet set CLAIM_FACETS has that CHIP_FACETS does not", () => {
      expect([...UNCHIPPED_FACETS]).toEqual(
        CLAIM_FACETS.filter((facet) => !(CHIP_FACETS as readonly string[]).includes(facet)),
      );
      // Non-vacuous in both directions, which is the whole point of the split:
      // there really is a facet with no chip row, and it is not every facet.
      expect(UNCHIPPED_FACETS).toContain("domain");
      expect(UNCHIPPED_FACETS.length).toBeGreaterThan(0);
      expect(UNCHIPPED_FACETS.length).toBeLessThan(CLAIM_FACETS.length);
    });

    it("names every facet that narrows with no chip, and no facet that has one", () => {
      // The facet with no control: named, with the value the query carried.
      const named = unchippedNarrowings(filterFrom({ domain: "events" }, BUCKETS));
      expect(named.map((narrowing) => narrowing.facet)).toEqual([...UNCHIPPED_FACETS]);
      expect(named.map((narrowing) => narrowing.value)).toEqual(["events"]);
      // The value reaches the sentence VERBATIM — never re-cased, never
      // prettified (LOOK_AND_FEEL Voice bar 5), and never a label the page
      // would have to look up.
      for (const narrowing of named) {
        expect(unchippedPhrase(narrowing)).toContain(narrowing.value);
        expect(unchippedPhrase(narrowing)).toContain(narrowing.facet);
        // One spelling, assembled from the pieces both channels read: the
        // string the window line takes IS the words the markup renders around
        // the identifier box.
        expect(unchippedPhrase(narrowing)).toBe(
          `${narrowing.before}${narrowing.value}${narrowing.after}`,
        );
      }

      // A facet the page DOES render a control for is never named this way —
      // its chip says it, and saying it twice is what the window line's own
      // subtraction exists to prevent (admin-window/BUG-0118).
      for (const facet of CHIP_FACETS) {
        const filter: ClaimsFilter = { [facet]: BUCKETS[0] };
        expect(unchippedNarrowings(filter), facet).toEqual([]);
      }

      // And an unnarrowed URL names nothing at all.
      expect(unchippedNarrowings(filterFrom({}, BUCKETS))).toEqual([]);
    });

    it("says whether a filter the operator can SEE is set, which is a different question", () => {
      // The gate on "these filters" and "the filters above": a chip facet, and
      // only a chip facet, is a filter the page draws a control for. The facet
      // with no chip row narrows just as hard — `hasNarrowingFacet` still says
      // so — which is exactly why the two questions may not share an answer.
      const domainOnly = filterFrom({ domain: "events" }, BUCKETS);
      expect(hasNarrowingFacet(domainOnly)).toBe(true);
      expect(hasChipNarrowing(domainOnly)).toBe(false);
      expect(unchippedNarrowings(domainOnly)).toHaveLength(1);

      for (const facet of CHIP_FACETS) {
        const chipped = { ...domainOnly, [facet]: BUCKETS[0] };
        expect(hasChipNarrowing(chipped), facet).toBe(true);
        // Both kinds at once: the sentence has to be true of both, so both
        // are still on offer.
        expect(unchippedNarrowings(chipped), facet).toHaveLength(1);
      }

      const bare = filterFrom({}, BUCKETS);
      expect(hasChipNarrowing(bare)).toBe(false);
      expect(hasNarrowingFacet(bare)).toBe(false);
    });

    it("keeps the narrowing readable back into the URL it came from", () => {
      // LOOK_AND_FEEL bar 11, the half admin-window/BUG-0160 was filed for:
      // the bookmarked view is a link, so the screen has to spell what the
      // link carries. The parameter's name and its value are both in the
      // phrase, and the value is the one the href writes back.
      for (const value of ["events", "venues", "groups"]) {
        const filter = filterFrom({ domain: value }, BUCKETS);
        const [narrowing] = unchippedNarrowings(filter);
        expect(claimsHref(PATH, filter)).toContain(
          `${narrowing.facet}=${narrowing.value}`,
        );
        expect(unchippedPhrase(narrowing)).toContain(value);
      }
    });
  });

  it("builds one group per CHIP facet, in facet order", () => {
    expect(filterBar(PATH, {}, "buckets", OPTIONS).map((group) => group.facet)).toEqual([
      ...CHIP_FACETS,
    ]);
  });
});

/**
 * **A narrowing the page applied is a narrowing the page can undo** —
 * admin-window/BUG-0161.
 *
 * Measured on staging at `/claims?domain=zzz` (designer, 2026-09-10): all five
 * bucket rows read `0`, and every anchor on the page carried `domain=zzz`
 * forward — both `all` chips included — so the one action the empty card named
 * ("the 'all' chip on any row shows everything again") landed back on the same
 * zeroed page. The only exits were the sidebar and the address bar.
 *
 * The leaf's share is the pair: ONE control whose href applies no narrowing at
 * all, and the card's words, which quote that control's own label instead of
 * describing an action of their own. Both live beside each other here so they
 * cannot drift into naming different things (LESSONS 5); what the PAGE renders
 * is graded in `tests/offline/claims/page.test.ts`.
 *
 * Every expectation below is computed from `CLAIM_FACETS` rather than from the
 * three facets that exist today, so a facet added tomorrow — with a chip row
 * or without one — is graded on the day it is read.
 */
describe("the empty card names an exit that clears every narrowing the page applied", () => {
  /** A value each facet really narrows by, in the facet's own value class. */
  const A_VALUE: Record<ClaimFacet, string> = {
    bucket: BUCKETS[0],
    source_id: SOURCE_ID,
    // The ticket's own URL: a well-formed value nothing carries. It still
    // NARROWS (admin-window/BUG-0138), which is what made the dead end.
    domain: "zzz",
  };

  /** The narrowing a URL applies, read back off an href this leaf wrote. */
  const appliedBy = (href: string): ClaimsFilter => {
    const [path, query = ""] = href.split("?");
    expect(path).toBe(PATH);
    return filterFrom(Object.fromEntries(new URLSearchParams(query)), BUCKETS);
  };

  /** The exit, or a failure naming the state that was left without one. */
  const exitFrom = (filter: ClaimsFilter, tab: ClaimsTab = DEFAULT_TAB) => {
    const exit = clearNarrowing(PATH, filter, tab);
    if (exit === null) {
      throw new Error(`no exit offered for ${JSON.stringify(filter)} on ${tab}`);
    }
    return exit;
  };

  it("is offered exactly where the URL narrowed something", () => {
    // Nothing set: no row, because there is nothing to clear and a control
    // that clears nothing is a control that lies (LOOK_AND_FEEL bar 13).
    expect(clearNarrowing(PATH, filterFrom({}, BUCKETS))).toBeNull();
    // A parameter the page did NOT apply is not a narrowing either: the
    // dropped-parameter line says what happened to it, and this row stays
    // away rather than offering to clear a filter nobody is under.
    expect(clearNarrowing(PATH, filterFrom({ domain: "  " }, BUCKETS))).toBeNull();
    expect(clearNarrowing(PATH, filterFrom({ source_id: "not-a-uuid" }, BUCKETS))).toBeNull();
    // And every facet on its own gets one.
    for (const facet of CLAIM_FACETS) {
      const filter = filterFrom({ [facet]: A_VALUE[facet] }, BUCKETS);
      expect(hasNarrowingFacet(filter), facet).toBe(true);
      expect(clearNarrowing(PATH, filter), facet).not.toBeNull();
    }
  });

  it("lands on a URL that applies NO narrowing, every facet included", () => {
    for (const facet of CLAIM_FACETS) {
      const filter = filterFrom({ [facet]: A_VALUE[facet] }, BUCKETS);
      // Non-vacuous: this facet really is set on the page the exit is shown on.
      expect(Object.keys(filter), facet).toEqual([facet]);

      const cleared = appliedBy(exitFrom(filter).href);
      expect(cleared, facet).toEqual({});
      expect(hasNarrowingFacet(cleared), facet).toBe(false);
      expect(hasChipNarrowing(cleared), facet).toBe(false);
      expect(unchippedNarrowings(cleared), facet).toEqual([]);
    }

    // Every facet at once — the state where clearing one at a time is exactly
    // what does not work.
    const all = filterFrom(A_VALUE, BUCKETS);
    expect(Object.keys(all).sort()).toEqual([...CLAIM_FACETS].sort());
    expect(exitFrom(all).href).toBe(PATH);
    expect(appliedBy(exitFrom(all).href)).toEqual({});
  });

  it("clears the facet with NO chip row, which is the one nothing else drops", () => {
    // The dead end itself, in one comparison. Both facets are set; the `all`
    // chip of the chipped one is the control the old card named.
    const filter = filterFrom(
      { source_id: SOURCE_ID, domain: A_VALUE.domain },
      BUCKETS,
    );
    for (const facet of UNCHIPPED_FACETS) {
      expect(filter[facet], facet).toBeDefined();
    }

    for (const group of filterBar(PATH, filter, DEFAULT_TAB, OPTIONS)) {
      const any = group.choices.find((choice) => choice.label === ANY_LABEL);
      expect(any, group.facet).toBeDefined();
      // Every `all` chip carries the control-less narrowing forward — which is
      // correct behaviour for a chip that clears ONE facet, and is why it can
      // never be the exit (the page's criterion 3: the chip rows keep their
      // present job).
      for (const facet of UNCHIPPED_FACETS) {
        expect(appliedBy(any?.href ?? "")[facet], `${group.facet} / ${facet}`).toBe(
          filter[facet],
        );
      }
    }

    // The exit drops it, and drops the chip narrowing with it.
    expect(appliedBy(exitFrom(filter).href)).toEqual({});
  });

  it("keeps the tab, which is the one narrowing the operator can already see", () => {
    for (const tab of TABS) {
      const filter = filterFrom({ domain: A_VALUE.domain }, BUCKETS);
      const exit = exitFrom(filter, tab);
      // The same page, unnarrowed, on the tab you were reading — and the tab
      // strip is the control that crosses back (`tabLinks`), so nothing here
      // is left without one.
      expect(appliedBy(exit.href), tab).toEqual({});
      expect(exit.href, tab).toBe(claimsHref(PATH, {}, tab));
      expect(tabFrom(Object.fromEntries(new URLSearchParams(exit.href.split("?")[1] ?? ""))), tab)
        .toBe(tab);
    }
  });

  it("is named by the card in the control's own word, not in words of its own", () => {
    // The two halves that have to agree: the chip says `CLEAR_LABEL`, and the
    // card quotes exactly that string. Nothing here pins the copy — what is
    // pinned is that one string reaches both channels (LESSONS 5).
    expect(exitFrom(filterFrom({ domain: A_VALUE.domain }, BUCKETS)).label).toBe(
      CLEAR_LABEL,
    );
    expect(CLEARED_BY.chip).toContain(`'${CLEAR_LABEL}'`);
    // It is a different promise from an `all` chip, so it is a different word:
    // one clears a facet, the other clears the filter.
    expect(CLEAR_LABEL).not.toBe(ANY_LABEL);
    // The exit is never the state you are in — it is somewhere else, always.
    expect(exitFrom(filterFrom(A_VALUE, BUCKETS)).active).toBe(false);
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
