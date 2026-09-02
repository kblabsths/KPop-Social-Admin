import { describe, expect, it } from "vitest";
import { QUEUES } from "@/lib/gauges/queue-health";
import {
  ANY_LABEL,
  FACETS,
  FACET_VALUES,
  REVIEW_QUEUES,
  REVIEW_STATUSES,
  facetChips,
  filterBar,
  filterFrom,
  isNarrowed,
  queuesHref,
  withFacet,
  type SearchParams,
} from "@/lib/review/queue-filters";
import { KINDS, SHAPES, type ReviewItemFilter } from "@/lib/review/shapes";

/**
 * The Queues page's URL state (campaign admin-window/TASK-0010).
 *
 * Acceptance test 4 — "shape and queue filters return exactly the matching
 * items" — has two halves. The membership half belongs to
 * `src/lib/review/shapes.ts` and is proved in `tests/offline/review/`; this
 * file owns the other half: that the URL is read into exactly the narrowing it
 * names, and that every link the page offers writes a URL that reads back the
 * same way. A filter that is exact but unreachable from its own chips would
 * pass the first half and still be wrong.
 *
 * Behaviour only: no class name and no copy is pinned. The one string this
 * file does assert is the VALUE side of a parameter, because those are the
 * database's own words and the page shows them verbatim.
 */

const PATH = "/queues";

/** The `searchParams` a URL this module built would arrive as. */
function paramsOf(href: string): SearchParams {
  const url = new URL(href, "https://x.invalid");
  const params: SearchParams = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    params[key] = all.length > 1 ? all : all[0];
  }
  return params;
}

describe("the facet vocabulary", () => {
  it("offers exactly the values the domain declares", () => {
    expect(FACET_VALUES.kind).toEqual(KINDS);
    expect(FACET_VALUES.shape).toEqual(SHAPES);
    expect(FACET_VALUES.status).toEqual(REVIEW_STATUSES);
    expect(FACET_VALUES.queue).toEqual(REVIEW_QUEUES);
  });

  it("names the same two queues the queue-health gauge reports on", () => {
    // The gauge declares its own pair because a pure leaf cannot import
    // `lib/gauges/**` (ARCHITECTURE.md §4). Two declarations of one vocabulary
    // can drift; this is what stops them, and it is why the drift is named on
    // the ticket rather than left to be discovered.
    expect([...REVIEW_QUEUES]).toEqual([...QUEUES]);
  });

  it("covers every field of the filter the data layer takes", () => {
    // A facet that existed here but not on `ReviewItemFilter` would not narrow
    // anything; one that existed there but not here would be unreachable.
    const asFilterKeys: (keyof ReviewItemFilter)[] = [...FACETS];
    expect(asFilterKeys.sort()).toEqual(["kind", "queue", "shape", "status"]);
  });
});

describe("reading the URL", () => {
  it("narrows nothing when the URL says nothing", () => {
    expect(filterFrom({})).toEqual({});
    expect(filterFrom()).toEqual({});
    expect(isNarrowed({})).toBe(false);
  });

  it("reads each facet's every value", () => {
    for (const facet of FACETS) {
      for (const value of FACET_VALUES[facet] as readonly string[]) {
        expect(filterFrom({ [facet]: value }), `${facet}=${value}`).toEqual({
          [facet]: value,
        });
      }
    }
  });

  it("combines facets with AND", () => {
    expect(
      filterFrom({ kind: "signal", queue: "entity_link", status: "settled" }),
    ).toEqual({ kind: "signal", queue: "entity_link", status: "settled" });
    expect(isNarrowed(filterFrom({ status: "open" }))).toBe(true);
  });

  it("ignores a value outside the vocabulary rather than emptying the page", () => {
    // The same rule `shownColumns` applies to a hand-typed `cols`: a typo
    // shows the unfiltered page, never an empty one that reads as a database
    // with nothing in it.
    expect(filterFrom({ queue: "data_conflict_fact" })).toEqual({});
    expect(filterFrom({ status: "SETTLED" })).toEqual({});
    expect(filterFrom({ kind: "" })).toEqual({});
    expect(filterFrom({ shape: "; drop table" })).toEqual({});
  });

  it("ignores a parameter that is not a facet at all", () => {
    expect(filterFrom({ severity: "high", page: "2", cols: "title" })).toEqual({});
  });

  it("takes the first value when the URL repeats a key", () => {
    // `URLSearchParams.get()`'s own answer: ambiguous state still lands on a
    // real, bookmarkable page.
    expect(filterFrom({ kind: ["signal", "decision"] })).toEqual({ kind: "signal" });
    expect(filterFrom({ kind: [] })).toEqual({});
    expect(filterFrom({ status: ["nonsense", "open"] })).toEqual({});
  });
});

describe("writing the URL", () => {
  it("spells no narrowing as the bare path", () => {
    expect(queuesHref(PATH, {})).toBe(PATH);
  });

  it("carries every set facet and nothing else", () => {
    const href = queuesHref(PATH, { kind: "decision", status: "open" });
    expect(paramsOf(href)).toEqual({ kind: "decision", status: "open" });
  });

  it("round-trips every combination back to the same filter", () => {
    for (const kind of [undefined, ...FACET_VALUES.kind]) {
      for (const queue of [undefined, ...FACET_VALUES.queue]) {
        for (const shape of [undefined, ...FACET_VALUES.shape]) {
          for (const status of [undefined, ...FACET_VALUES.status]) {
            const filter = filterFrom({ kind, queue, shape, status });
            expect(filterFrom(paramsOf(queuesHref(PATH, filter)))).toEqual(filter);
          }
        }
      }
    }
  });

  it("changes one facet and keeps the rest", () => {
    const filter: ReviewItemFilter = { kind: "signal", status: "open" };
    expect(withFacet(filter, "queue", "entity_link")).toEqual({
      kind: "signal",
      status: "open",
      queue: "entity_link",
    });
    // Clearing removes the key rather than setting it to a value that means
    // "everything" — an absent parameter is how "no narrowing" is spelled.
    expect(withFacet(filter, "kind", undefined)).toEqual({ status: "open" });
    expect(filter).toEqual({ kind: "signal", status: "open" });
  });
});

describe("the chips a page renders", () => {
  it("offers 'all' plus exactly the facet's values, in that order", () => {
    for (const facet of FACETS) {
      const chips = facetChips(PATH, {}, facet);
      expect(chips.facet).toBe(facet);
      expect(chips.choices.map((choice) => choice.label)).toEqual([
        ANY_LABEL,
        ...(FACET_VALUES[facet] as readonly string[]),
      ]);
    }
  });

  it("marks 'all' active while that facet narrows nothing", () => {
    const chips = facetChips(PATH, {}, "shape");
    expect(chips.choices.filter((choice) => choice.active)).toHaveLength(1);
    expect(chips.choices[0].active).toBe(true);
  });

  it("marks exactly the chosen value active, and links 'all' back out", () => {
    const filter = filterFrom({ shape: SHAPES[1] });
    const chips = facetChips(PATH, filter, "shape");
    const active = chips.choices.filter((choice) => choice.active);

    expect(active).toHaveLength(1);
    expect(active[0].label).toBe(SHAPES[1]);
    expect(paramsOf(chips.choices[0].href)).toEqual({});
  });

  it("keeps every other facet when one chip is followed", () => {
    const filter = filterFrom({ kind: "decision", status: "open" });
    for (const choice of facetChips(PATH, filter, "queue").choices) {
      const landed = filterFrom(paramsOf(choice.href));
      expect(landed.kind).toBe("decision");
      expect(landed.status).toBe("open");
    }
  });

  it("lands on the state its own chip claims, for every chip of every facet", () => {
    // The whole bar, from every state: following a chip must produce the
    // filter it says it produces — otherwise "active" is decoration.
    for (const start of [{}, { kind: "signal" as const }, { status: "settled" as const }]) {
      for (const group of filterBar(PATH, start)) {
        for (const choice of group.choices) {
          const landed = filterFrom(paramsOf(choice.href));
          expect(landed[group.facet] ?? ANY_LABEL, `${group.facet}=${choice.label}`).toBe(
            choice.label,
          );
        }
      }
    }
  });

  it("renders one group per facet", () => {
    expect(filterBar(PATH, {}).map((group) => group.facet)).toEqual([...FACETS]);
  });
});
