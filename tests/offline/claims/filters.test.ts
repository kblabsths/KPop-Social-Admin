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
  isNarrowed,
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
    expect(isNarrowed(filter)).toBe(true);
  });

  it("narrows nothing for an absent, repeated or unrecognised parameter", () => {
    expect(filterFrom({}, OPTIONS)).toEqual({});
    expect(isNarrowed({})).toBe(false);
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
});
