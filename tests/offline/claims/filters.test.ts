import { describe, expect, it } from "vitest";
import {
  ANY_LABEL,
  CHIP_FACETS,
  CLAIM_FACETS,
  CLEARED_BY,
  CLEAR_LABEL,
  DEFAULT_TAB,
  CLAIMS_UNCHIPPED_FACETS,
  TABS,
  claimsHref,
  claimsQuery,
  droppedParams,
  facetChips,
  filterBar,
  filterFrom,
  hasChipFacet,
  hasNarrowingFacet,
  listFilterOf,
  sourceHref,
  tabFacetsOf,
  tabFrom,
  tabLinks,
  withFacet,
  withoutChipFacets,
  type ClaimFacet,
  type ClaimsFilter,
  type ClaimsTab,
  type FacetOptions,
} from "@/lib/claims/filters";
// The exit CONTROL is declared once for every surface (admin-window/BUG-0164);
// what this leaf still owns is the pair of facts the page hands it — "did this
// URL narrow anything" and "where is this page with nothing set".
import { clearNarrowing } from "@/lib/url/narrowing";
// The vocabulary's own home (admin-window/TASK-0072): the shape and the two
// functions over it are the URL leaf's, the facet TABLE below is this page's.
import { unchippedNarrowings, unchippedPhrase } from "@/lib/url/narrowing";

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

/**
 * This page's control-less narrowings — the shared reader over THIS page's own
 * facet table (admin-window/TASK-0072).
 *
 * The pairing is spelled once here for the same reason the page spells it
 * once: the function is generic over a filter and the table is the claims
 * surface's, and a second hand-built table in a test would grade a vocabulary
 * the page does not use.
 */
const unchippedOf = (filter: ClaimsFilter) =>
  unchippedNarrowings(filter, CLAIMS_UNCHIPPED_FACETS);

/**
 * The facets of that table, as `ClaimFacet`s — derived by intersection rather
 * than cast, so a table entry naming a parameter this page does not have would
 * silently shrink this list and redden the identity case below rather than
 * type-erroring somewhere unrelated.
 */
const UNCHIPPED_NAMES: readonly ClaimFacet[] = CLAIM_FACETS.filter((facet) =>
  CLAIMS_UNCHIPPED_FACETS.some((unchipped) => unchipped.facet === facet),
);

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
});

describe("the facets", () => {
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

  /**
   * The query one PRESS carries — campaign admin-window/TASK-0067, SPEC F14.
   *
   * It is the same serialization the URL above carries, so the two cannot
   * drift (LESSONS 5), and the round trip that matters is not a string
   * comparison: the route handler re-derives the LIST's narrowing from these
   * parameters with the page's own two functions, so what is asserted is that
   * `claimsQuery(filter, tab)` -> `listFilterOf(filterFrom(...), tabFrom(...))`
   * lands on exactly the filter the first screen's rows were read under.
   */
  it("carries the page's narrowing to the paging route, and nothing else", () => {
    const filter: ClaimsFilter = {
      bucket: "awaiting_row",
      source_id: SOURCES[1],
      domain: "venues",
    };
    expect(claimsQuery(filter, "buckets")).toBe(
      `bucket=awaiting_row&source_id=${SOURCES[1]}&domain=venues`,
    );
    // The query half of the href, spelled once for both.
    expect(claimsHref(PATH, filter, "buckets")).toBe(
      `${PATH}?${claimsQuery(filter, "buckets")}`,
    );
    // Nothing narrowed is nothing carried — never `?bucket=&domain=`.
    expect(claimsQuery({}, "buckets")).toBe("");
    expect(claimsQuery({})).toBe("");
    expect(claimsQuery({}, "standing")).toBe("tab=standing");
  });

  it("re-derives the same list narrowing the first screen read under", () => {
    const standingBucket = "standing_disagreement";
    const cases: ReadonlyArray<readonly [ClaimsFilter, ClaimsTab]> = [
      [{}, "buckets"],
      [{ bucket: "escalated" }, "buckets"],
      [{ source_id: SOURCES[0], domain: "events" }, "buckets"],
      // The standing tab carries no bucket facet at all: the tab sets it, and
      // a bucket nobody can see must not travel in a URL.
      [{}, "standing"],
      [{ source_id: SOURCES[1] }, "standing"],
    ];
    for (const [filter, tab] of cases) {
      const query = Object.fromEntries(
        new URLSearchParams(claimsQuery(filter, tab)).entries(),
      );
      const where = JSON.stringify([filter, tab]);
      expect(tabFrom(query), where).toBe(tab);
      expect(
        listFilterOf(filterFrom(query, BUCKETS), tabFrom(query), standingBucket),
        where,
      ).toEqual(listFilterOf(filter, tab, standingBucket));
    }
  });

  it("carries no parameter the page DROPPED", () => {
    // The defect this shape exists for (admin-window/BUG-0141): a facet the
    // page could not read narrowed no row above, so it may not narrow the rows
    // a press appends. The filter is what the page APPLIED — never the URL.
    const asked = {
      bucket: "not_a_bucket",
      source_id: "not-a-uuid",
      domain: "events",
      tab: "standing",
    };
    const applied = filterFrom(asked, BUCKETS);
    expect(applied).toEqual({ domain: "events" });
    expect(claimsQuery(applied, tabFrom(asked))).toBe("domain=events&tab=standing");
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
      expect(CLAIMS_UNCHIPPED_FACETS.map((facet) => facet.facet)).toEqual(
        CLAIM_FACETS.filter((facet) => !(CHIP_FACETS as readonly string[]).includes(facet)),
      );
      // Non-vacuous in both directions, which is the whole point of the split:
      // there really is a facet with no chip row, and it is not every facet.
      expect(UNCHIPPED_NAMES).toContain("domain");
      expect(UNCHIPPED_NAMES.length).toBeGreaterThan(0);
      expect(UNCHIPPED_NAMES.length).toBeLessThan(CLAIM_FACETS.length);
      // Every entry can read its own facet off a filter, which is the half of
      // the table the shared function calls (LESSONS 8: one input it must
      // find, one it must not).
      for (const unchipped of CLAIMS_UNCHIPPED_FACETS) {
        expect(unchipped.value({ [unchipped.facet]: "a-value" }), unchipped.facet).toBe(
          "a-value",
        );
        expect(unchipped.value({}), unchipped.facet).toBeUndefined();
      }
    });

    it("names every facet that narrows with no chip, and no facet that has one", () => {
      // The facet with no control: named, with the value the query carried.
      const named = unchippedOf(filterFrom({ domain: "events" }, BUCKETS));
      expect(named.map((narrowing) => narrowing.facet)).toEqual([...UNCHIPPED_NAMES]);
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
        expect(unchippedOf(filter), facet).toEqual([]);
      }

      // And an unnarrowed URL names nothing at all.
      expect(unchippedOf(filterFrom({}, BUCKETS))).toEqual([]);
    });

    it("says whether a filter the operator can SEE is set, which is a different question", () => {
      // The gate on "these filters" and "the filters above": a chip facet, and
      // only a chip facet, is a filter the page draws a control for. The facet
      // with no chip row narrows just as hard — `hasNarrowingFacet` still says
      // so — which is exactly why the two questions may not share an answer.
      const domainOnly = filterFrom({ domain: "events" }, BUCKETS);
      expect(hasNarrowingFacet(domainOnly)).toBe(true);
      expect(hasChipFacet(domainOnly)).toBe(false);
      expect(unchippedOf(domainOnly)).toHaveLength(1);

      for (const facet of CHIP_FACETS) {
        const chipped = { ...domainOnly, [facet]: BUCKETS[0] };
        expect(hasChipFacet(chipped), facet).toBe(true);
        // Both kinds at once: the sentence has to be true of both, so both
        // are still on offer.
        expect(unchippedOf(chipped), facet).toHaveLength(1);
      }

      const bare = filterFrom({}, BUCKETS);
      expect(hasChipFacet(bare)).toBe(false);
      expect(hasNarrowingFacet(bare)).toBe(false);
    });
  });
});

/**
 * **The family subtraction widens a read by what the URL CONTRIBUTED to it** —
 * admin-window/BUG-0192's own named hazard 1, refiled as
 * admin-window/BUG-0193 when the first fix decided from `asked` and deleted
 * from `applied`.
 *
 * The widened count exists to answer one question: did the CHIP family remove
 * any of the rows this surface drew (`isFamilyNarrowing`,
 * `src/lib/url/narrowing.ts`)? So the filter it is taken under has to be this
 * surface's own read minus the chips the operator set, and nothing else. The
 * standing tab merges `bucket = standing_disagreement` into its read of its
 * own accord — no control on screen offers it — so subtracting it counts the
 * OTHER tab's population and the comparison then differs for a reason that has
 * nothing to do with the chip bar.
 *
 * The coincidence case below is why the surface's own facets are handed IN
 * rather than inferred from equal values: `standing_disagreement` is itself a
 * bucket the chip row offers, so `?bucket=standing_disagreement` reaches the
 * standing tab in one click and there the applied bucket and the asked bucket
 * are the same STRING while only one of them is a control above.
 *
 * What the PAGE renders in that state is graded in
 * `tests/offline/claims/page.test.ts`; this is the leaf's share.
 */
describe("widening a read by one facet family", () => {
  const standingBucket = "standing_disagreement";
  /** The URL an operator is on: both chip facets, plus the control-less one. */
  const asked: ClaimsFilter = {
    bucket: "escalated",
    source_id: SOURCES[0],
    domain: "events",
  };

  /** The same read, widened — always taken through the tab's own two facts. */
  const widened = (from: ClaimsFilter, tab: ClaimsTab) =>
    withoutChipFacets(
      listFilterOf(from, tab, standingBucket),
      from,
      tabFacetsOf(tab, standingBucket),
    );

  /**
   * The subtraction, over the three states the class was wrong in one at a
   * time (admin-window/BUG-0192's hazard 1, refiled as admin-window/BUG-0193):
   * the buckets tab, where both chips really are part of the read; the
   * standing tab, whose own bucket replaced the URL's and must survive the
   * subtraction; and the standing tab asked for that same bucket, where the
   * applied and the asked value are one string while only one is a control.
   */
  const WIDENINGS: ReadonlyArray<readonly [string, ClaimsTab, ClaimsFilter, string, ClaimsFilter]> = [
    ["the buckets tab, which merges nothing", "buckets", asked, "escalated", { domain: "events" }],
    [
      "the standing tab, which merged its own bucket in",
      "standing",
      asked,
      standingBucket,
      { bucket: standingBucket, domain: "events" },
    ],
    [
      "the standing tab when the URL asked for that same bucket",
      "standing",
      { ...asked, bucket: standingBucket },
      standingBucket,
      { bucket: standingBucket, domain: "events" },
    ],
  ];

  it.each(WIDENINGS)(
    "drops the chip facets the URL contributed and keeps the rest, on %s",
    (_state, tab, from, appliedBucket, expected) => {
      const applied = listFilterOf(from, tab, standingBucket);
      const before = { ...applied };
      // The bucket the READ carries is the tab's where the tab has one.
      expect(applied.bucket).toBe(appliedBucket);
      expect(widened(from, tab)).toEqual(expected);
      // A subtraction, not a mutation: the read the page issues is untouched.
      expect(applied).toEqual(before);
    },
  );

  it("answers for a tab that merges nothing, and for every facet family", () => {
    // The other tab merges no facet at all, so its widened read is its applied
    // read minus every chip — and a URL that set no chip is widened to itself.
    expect(tabFacetsOf("buckets", standingBucket)).toEqual({});
    expect(widened({ domain: "events" }, "buckets")).toEqual({ domain: "events" });
    expect(widened({}, "buckets")).toEqual({});

    // Every facet the tab merges is a facet its own read carries, at that
    // value — the two halves of the merge read from one spelling, so a tab
    // that gains a merged facet gains it for the subtraction in the same edit.
    for (const tab of TABS) {
      const own = tabFacetsOf(tab, standingBucket);
      const applied = listFilterOf(asked, tab, standingBucket);
      for (const [facet, value] of Object.entries(own)) {
        expect(applied[facet as ClaimFacet], tab).toBe(value);
        expect(widened(asked, tab)[facet as ClaimFacet], tab).toBe(value);
      }
      // ...and the empty URL on that tab reads exactly those facets.
      expect(listFilterOf({}, tab, standingBucket), tab).toEqual(own);
    }
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

  /** The exit this page offers — composed exactly as `src/app/claims/page.tsx` composes it. */
  const exitOffered = (filter: ClaimsFilter, tab: ClaimsTab = DEFAULT_TAB) =>
    clearNarrowing(hasNarrowingFacet(filter), claimsHref(PATH, {}, tab));

  /** The exit, or a failure naming the state that was left without one. */
  const exitFrom = (filter: ClaimsFilter, tab: ClaimsTab = DEFAULT_TAB) => {
    const exit = exitOffered(filter, tab);
    if (exit === null) {
      throw new Error(`no exit offered for ${JSON.stringify(filter)} on ${tab}`);
    }
    return exit;
  };

  it("is offered exactly where the URL narrowed something", () => {
    // Nothing set: no row, because there is nothing to clear and a control
    // that clears nothing is a control that lies (LOOK_AND_FEEL bar 13).
    expect(exitOffered(filterFrom({}, BUCKETS))).toBeNull();
    // A parameter the page did NOT apply is not a narrowing either: the
    // dropped-parameter line says what happened to it, and this row stays
    // away rather than offering to clear a filter nobody is under.
    expect(exitOffered(filterFrom({ domain: "  " }, BUCKETS))).toBeNull();
    expect(exitOffered(filterFrom({ source_id: "not-a-uuid" }, BUCKETS))).toBeNull();
    // And every facet on its own gets one.
    for (const facet of CLAIM_FACETS) {
      const filter = filterFrom({ [facet]: A_VALUE[facet] }, BUCKETS);
      expect(hasNarrowingFacet(filter), facet).toBe(true);
      expect(exitOffered(filter), facet).not.toBeNull();
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
      expect(hasChipFacet(cleared), facet).toBe(false);
      expect(unchippedOf(cleared), facet).toEqual([]);
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
    for (const facet of UNCHIPPED_NAMES) {
      expect(filter[facet], facet).toBeDefined();
    }

    for (const group of filterBar(PATH, filter, DEFAULT_TAB, OPTIONS)) {
      const any = group.choices.find((choice) => choice.label === ANY_LABEL);
      expect(any, group.facet).toBeDefined();
      // Every `all` chip carries the control-less narrowing forward — which is
      // correct behaviour for a chip that clears ONE facet, and is why it can
      // never be the exit (the page's criterion 3: the chip rows keep their
      // present job).
      for (const facet of UNCHIPPED_NAMES) {
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
      // Spelled here rather than taken from `claimsHref`, which is what the
      // page composes the exit FROM: an assertion against the builder's own
      // output would hold however that builder changed.
      expect(exit.href, tab).toBe(tab === DEFAULT_TAB ? PATH : `${PATH}?tab=${tab}`);
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

  /**
   * What the line does with a dropped parameter's KEY is decided by the key's
   * spelling — the class admin-window/BUG-0127 (a blank key), BUG-0136 (a key
   * with no visible content) and BUG-0137 (a key outside the renderable
   * allowlist `^[A-Za-z0-9_.-]{1,64}$`, ARCHITECTURE.md §7) each fixed one
   * codepoint family of, graded as one table over the leaf's one rule: a key
   * with no visible content asked for nothing and is ignored, a key from the
   * allowlist is named verbatim, and every other key is COUNTED and never
   * spelled — the parked word above all, however an ink-less mark rides along
   * inside or beside it.
   */
  type KeyCase = readonly [Record<string, string>, { named: string[]; withheld: number }];
  const parked = "in_" + "window";
  const ignored = (key: string): KeyCase => [{ [key]: "1" }, { named: [], withheld: 0 }];
  const named = (key: string): KeyCase => [{ [key]: "1" }, { named: [key], withheld: 0 }];
  const counted = (key: string): KeyCase => [{ [key]: "1" }, { named: [], withheld: 1 }];
  const KEY_SPELLINGS: ReadonlyArray<KeyCase> = [
    // Ignored: the key is empty, whitespace, or codepoints a reader never sees
    // — controls (Cc), format characters (Cf), a Hangul filler, the BOM.
    ...[
      "",
      "  ",
      "\t\n",
      "\u0000",
      "\u200B",
      "\u00AD",
      "\u2060",
      "\u3164",
      "\u200E",
      "\u007F",
      "\u00A0",
      "\uFEFF",
      "\u200B\u00AD\u2060",
      " \u200B ",
    ].map(ignored),
    // …a value carrying no name beside a value with one, and an empty VALUE.
    [{ "": "x", record_id: "r-1" }, { named: ["record_id"], withheld: 0 }],
    [{ record_id: "" }, { named: [], withheld: 0 }],
    // Named, verbatim: inside the renderable allowlist, 64 characters at most.
    ...[".", "-", "_", "0", "record_id", "bucket", "in_windows", "a.b-c_9", "A0", "a".repeat(64)].map(
      named,
    ),
    // Counted, never spelled: ink the page cannot promise to render as itself,
    // a mark laid out at 0px, a bidi override, a space, one character past the
    // bound — and the parked word, with any of them riding along.
    ...[
      "\u8A18\u9332",
      "\u2800",
      "record_id\u200B",
      "\uFE0F",
      "\u034F",
      "\u0301",
      "\u202Eabc",
      "a b",
      "a".repeat(65),
      parked,
      parked + "\u200B",
      "in\u200B_window",
      parked + "\uFE0F",
      "in_win\u034Fdow",
      parked + "\u2800",
    ].map(counted),
  ];

  it.each(KEY_SPELLINGS)(
    "names, counts or ignores %o by its key's spelling alone, answering %o",
    (params, expected) => {
      expect(droppedParams(params, {}, [parked])).toEqual(expected);
    },
  );
});
