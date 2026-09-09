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
  isBlockNarrowed,
  isNarrowed,
  narrowingOfKind,
  queuesHref,
  withFacet,
  type SearchParams,
} from "@/lib/review/queue-filters";
import {
  KINDS,
  SHAPES,
  selectItems,
  type Kind,
  type ReviewItemFilter,
} from "@/lib/review/shapes";
import { reviewItemEdgePopulation } from "../../fixtures/rows";

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

describe("what narrows ONE surface, not the whole URL", () => {
  /**
   * `isNarrowed(filter, within)` — the route's one narrowing decision, asked
   * by a surface that already narrows itself (admin-window/BUG-0129). A queue
   * block selects its own rows with `{ kind }`, so a URL facet naming that
   * same kind removes not one row from it and may not be counted; every other
   * facet, and the same facet with a different value, still counts.
   *
   * Pinned BOTH ways below: the facet that cannot narrow answers `false`, the
   * facet that can answers `true`.
   */
  it("discounts a facet whose value the surface already applies", () => {
    for (const facet of FACETS) {
      for (const value of FACET_VALUES[facet] as readonly string[]) {
        const asked = filterFrom({ [facet]: value });
        expect(isNarrowed(asked), `${facet}=${value} against the whole URL`).toBe(true);
        expect(isNarrowed(asked, asked), `${facet}=${value} within itself`).toBe(false);
      }
    }
  });

  it("counts the same facet asking for a DIFFERENT value", () => {
    for (const facet of FACETS) {
      const values = FACET_VALUES[facet] as readonly string[];
      for (const value of values) {
        for (const other of values.filter((candidate) => candidate !== value)) {
          expect(
            isNarrowed(filterFrom({ [facet]: other }), filterFrom({ [facet]: value })),
            `${facet}=${other} within ${facet}=${value}`,
          ).toBe(true);
        }
      }
    }
  });

  it("counts every OTHER facet beside the one the surface applies", () => {
    const within: ReviewItemFilter = { kind: "decision" };
    for (const facet of FACETS.filter((candidate) => candidate !== "kind")) {
      const value = (FACET_VALUES[facet] as readonly string[])[0];
      expect(isNarrowed(filterFrom({ [facet]: value }), within), facet).toBe(true);
      expect(
        isNarrowed(filterFrom({ kind: "decision", [facet]: value }), within),
        `kind + ${facet}`,
      ).toBe(true);
    }
  });

  it("answers the whole-URL question when the surface narrows nothing itself", () => {
    // The default: what every page-level caller asks, unchanged.
    expect(isNarrowed({}, {})).toBe(false);
    expect(isNarrowed({ kind: "signal" }, {})).toBe(true);
    expect(isNarrowed({}, { kind: "signal" })).toBe(false);
  });
});

describe("the narrowing a KIND implies", () => {
  /**
   * `narrowingOfKind(kind)` — every facet value a row of that kind must carry
   * (admin-window/BUG-0131). A queue block hands it to both `selectItems` and
   * `isNarrowed`, so it has to be exactly right in both directions: claiming a
   * value the kind does NOT imply would silently drop rows from the block,
   * claiming too few leaves the block blaming a facet that removed nothing.
   */
  const POPULATION = reviewItemEdgePopulation();

  /**
   * What each kind implies, spelled from spec §6 and migration
   * `20260901000002` — NOT read back out of `narrowingOfKind`. Asking the
   * function what it expects would make every sweep below vacuous the moment
   * the function under-claims.
   */
  const IMPLIED: Record<Kind, Partial<Record<string, string>>> = {
    decision: { kind: "decision" },
    signal: {
      kind: "signal",
      shape: "entity_link_source_pattern",
      queue: "entity_link",
    },
  };

  it("names the values spec §6 says every row of that kind carries", () => {
    // The signal queue is `entity_link_source_pattern` and no other shape, and
    // that shape exists only under the `entity_link` queue (migration
    // `20260901000002`: a per-source subject belongs to that queue alone).
    expect(narrowingOfKind("signal")).toEqual(IMPLIED.signal);
    // The decision queue spans two shapes and both queues, so it implies
    // nothing beyond its own kind — `?shape=data_conflict_fact` and
    // `?queue=data_conflict` really do remove rows from it.
    expect(narrowingOfKind("decision")).toEqual(IMPLIED.decision);
  });

  it("never implies a status: that is a row's own state, not its kind's", () => {
    for (const kind of KINDS) {
      expect(narrowingOfKind(kind).status, kind).toBeUndefined();
    }
  });

  it("SELECTS exactly the kind's rows — an implied value removes none of them", () => {
    // The soundness half, on rows rather than on the mapping: the derived
    // narrowing and the bare `{ kind }` pick the same items out of a
    // population that holds all three shapes, both statuses, and the rows the
    // schema permits but the happy path never produces.
    for (const kind of KINDS) {
      const implied = selectItems(POPULATION, narrowingOfKind(kind));
      const byKind = selectItems(POPULATION, { kind });
      expect(implied.length, kind).toBeGreaterThan(0);
      expect(implied, kind).toEqual(byKind);
    }
  });

  it("discounts a URL facet exactly when the kind implies its value", () => {
    // Both ways, over the whole URL vocabulary: the value the kind implies is
    // not narrowing, every other value of every facet is. This is the pin an
    // over-fix fails — dropping a facet by NAME rather than by value would let
    // `?shape=entity_link_fact` (which empties the signal block) read as
    // unfiltered.
    for (const kind of KINDS) {
      const within = narrowingOfKind(kind);
      for (const facet of FACETS) {
        for (const value of FACET_VALUES[facet] as readonly string[]) {
          expect(
            isNarrowed(filterFrom({ [facet]: value }), within),
            `${facet}=${value} on ${kind}`,
          ).toBe(IMPLIED[kind][facet] !== value);
        }
      }
    }
  });

  it("keeps counting a facet BESIDE the implied one", () => {
    // The fix may not turn a block's narrowing off wholesale: a status facet
    // still narrows the signal block on the very URLs that select its own set.
    const within = narrowingOfKind("signal");
    for (const query of [
      "shape=entity_link_source_pattern&status=settled",
      "queue=entity_link&status=open",
      "kind=signal&status=settled",
    ]) {
      expect(isNarrowed(filterFrom(paramsOf(`/queues?${query}`)), within), query).toBe(
        true,
      );
    }
  });

  it("is derived, not written down — no kind claims a value its rows contradict", () => {
    // Whatever the registry says today, the claim has to hold row by row: for
    // every kind and every facet value it implies, EVERY row of that kind
    // carries that value. A fourth shape or a third queue changes the derived
    // answer, and this stays the test of it.
    for (const kind of KINDS) {
      const within = narrowingOfKind(kind) as Record<string, string | undefined>;
      const rows = selectItems(POPULATION, { kind });
      for (const facet of FACETS) {
        const value = within[facet];
        if (value === undefined) continue;
        expect(
          selectItems(rows, filterFrom({ [facet]: value })),
          `${kind} implies ${facet}=${value}`,
        ).toEqual(rows);
      }
    }
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

describe("the narrowing ONE BLOCK is actually under", () => {
  /**
   * `isBlockNarrowed(filter, within, { rendered, population })` — the whole
   * four-state decision, from two facts (admin-window/BUG-0133).
   *
   * `isNarrowed`/`narrowingOfKind` above answer only what a KIND implies:
   * whether a facet CAN remove a row of that kind. They cannot answer whether
   * the table holds any row of that kind at all — so on staging's 0 decision
   * items every facet outside the kind's implied set flipped the decision
   * block into the filtered rendering, blaming a filter for a zero the empty
   * queue produced. The population is the second fact, and the rendered set is
   * a subset of it, so equal sizes mean the same set and no scope to claim.
   *
   * Pinned BOTH ways: every case below is asserted true where the filter
   * really did narrow the block and false where it did not.
   */

  /**
   * The values each kind implies, spelled from spec §6 as the sibling describe
   * spells them — asking `narrowingOfKind` what to expect would only prove
   * this module agrees with itself.
   */
  const IMPLIES: Record<Kind, Partial<Record<string, string>>> = {
    decision: { kind: "decision" },
    signal: {
      kind: "signal",
      shape: "entity_link_source_pattern",
      queue: "entity_link",
    },
  };

  it("answers false for EVERY url when the block's own queue is empty", () => {
    // The reported state. No facet, and no combination of facets, may be given
    // as the reason a block that holds nothing holds nothing.
    for (const kind of KINDS) {
      const within = narrowingOfKind(kind);
      for (const facet of FACETS) {
        for (const value of FACET_VALUES[facet] as readonly string[]) {
          expect(
            isBlockNarrowed(filterFrom({ [facet]: value }), within, {
              rendered: 0,
              population: 0,
            }),
            `${facet}=${value} on an empty ${kind} queue`,
          ).toBe(false);
        }
      }
      for (const query of [
        "kind=signal&status=settled",
        "queue=data_conflict&shape=data_conflict_fact&status=open",
      ]) {
        expect(
          isBlockNarrowed(filterFrom(paramsOf(`/queues?${query}`)), within, {
            rendered: 0,
            population: 0,
          }),
          `${query} on an empty ${kind} queue`,
        ).toBe(false);
      }
    }
  });

  it("answers true when a facet really did remove rows from a populated block", () => {
    // The half that may not be weakened: a block that HOLDS rows and is
    // rendering fewer of them is scoped, and says so.
    for (const kind of KINDS) {
      const within = narrowingOfKind(kind);
      for (const facet of FACETS) {
        for (const value of FACET_VALUES[facet] as readonly string[]) {
          const implied = IMPLIES[kind][facet] === value;
          expect(
            isBlockNarrowed(filterFrom({ [facet]: value }), within, {
              rendered: implied ? 4 : 0,
              population: 4,
            }),
            `${facet}=${value} on a populated ${kind} queue`,
          ).toBe(!implied);
        }
      }
    }
  });

  it("answers false when the facet left every row of a populated block in place", () => {
    // Equal sizes mean the same set: a scope claim over a set the URL did not
    // change is a claim the read does not support, however narrow the URL
    // looks. `?status=settled` on a block whose rows are all settled renders
    // exactly the unfiltered block.
    const within = narrowingOfKind("decision");
    expect(
      isBlockNarrowed(filterFrom({ status: "settled" }), within, {
        rendered: 3,
        population: 3,
      }),
    ).toBe(false);
    expect(
      isBlockNarrowed(filterFrom({ status: "settled" }), within, {
        rendered: 2,
        population: 3,
      }),
    ).toBe(true);
  });

  it("never claims a scope the structural rule already refused", () => {
    // A facet the kind implies stays discounted whatever the counts say — the
    // second fact may only ever REMOVE a scope claim, never add one.
    const within = narrowingOfKind("signal");
    for (const [facet, value] of Object.entries(IMPLIES.signal)) {
      expect(
        isBlockNarrowed(filterFrom({ [facet]: value }), within, {
          rendered: 1,
          population: 7,
        }),
        `${facet}=${value}`,
      ).toBe(false);
    }
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
