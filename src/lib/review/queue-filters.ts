import {
  KINDS,
  SHAPES,
  type Kind,
  type ReviewItemFilter,
  type ReviewQueue,
  type ReviewStatus,
  type Shape,
} from "./shapes";

/**
 * The Queues page's URL state — campaign admin-window/TASK-0010.
 *
 * LOOK_AND_FEEL bar 11: "every filter, sort and page position is bookmarkable
 * and survives the back button", so the whole filter state is `searchParams`
 * and nothing here holds state of its own. It is the same split
 * `src/lib/browse/views.ts` made for the column selector: the pure functions
 * that turn a URL into a narrowing and a narrowing back into a URL live in a
 * PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7), which is what makes "each
 * filter returns exactly the matching items" (acceptance test 4) testable
 * without rendering anything at all.
 *
 * It decides no membership: `ReviewItemFilter`, `matchesFilter` and
 * `selectItems` in `./shapes.ts` are the one predicate in the app (spec §6),
 * and this module only says which narrowing the URL asked for. It spells no
 * shape and no kind either — `SHAPES` and `KINDS` are imported, because the
 * kind mapping lives in exactly one module.
 */

/* ── the parameter names ─────────────────────────────────────────────────── */

/**
 * A facet is a `ReviewItemFilter` field, and its parameter is spelled the same
 * as the field. One name for one thing: `?queue=entity_link` narrows
 * `filter.queue`, and there is no translation table to disagree with.
 *
 * `status` is a SEARCH PARAMETER and never a path segment — `/queues` is one
 * route and settled items are one of its states (admin-window/BUG-0020's
 * residual: a `src/app/**` path carrying `settle`/`verdict` is refused by the
 * M2-close guard, and rightly, since the close itself is M2's).
 */
export const FACETS = ["kind", "queue", "shape", "status"] as const;

export type Facet = (typeof FACETS)[number];

/**
 * `review_items.queue` — both values, so an empty queue is a zero and not a
 * gap.
 *
 * Spelled here because a leaf cannot import `lib/gauges/queue-health.ts`
 * (which declares the same pair for the gauge): the arrow runs
 * `lib/gauges/** -> lib/db/**`, and a leaf importing a gauge would invert it.
 * `tests/offline/queues/filters.test.ts` pins the two lists equal so they
 * cannot drift; the right long-term home is `./shapes.ts` beside `SHAPES` and
 * `KINDS`, which is a change to another ticket's module and is noted on this
 * ticket's handoff rather than made here.
 */
export const REVIEW_QUEUES: readonly ReviewQueue[] = ["data_conflict", "entity_link"];

/** `review_items.status` — open first, settled browsable (spec §4). */
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["open", "settled"];

/** Every value each facet may take, in the order its chips render. */
export const FACET_VALUES: {
  kind: readonly Kind[];
  queue: readonly ReviewQueue[];
  shape: readonly Shape[];
  status: readonly ReviewStatus[];
} = {
  kind: KINDS,
  queue: REVIEW_QUEUES,
  shape: SHAPES,
  status: REVIEW_STATUSES,
};

/* ── reading the URL ─────────────────────────────────────────────────────── */

/** A `searchParams` value, in every shape Next can hand one over. */
export type ParamValue = string | string[] | undefined;

/** The `searchParams` object a page awaits. */
export type SearchParams = Record<string, ParamValue>;

/**
 * The FIRST value the URL carries for a key.
 *
 * `?kind=decision&kind=signal` is ambiguous state, and the web platform
 * already answers it: `URLSearchParams.get()` returns the first. Taking the
 * first rather than refusing keeps a hand-edited URL landing on a real,
 * bookmarkable state instead of an error page.
 */
function firstValue(value: ParamValue): string | undefined {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value;
}

/**
 * The value if the vocabulary holds it, else nothing.
 *
 * A value outside the set constrains NOTHING rather than narrowing to an
 * empty list — the same rule `shownColumns` in `src/lib/browse/views.ts`
 * already applies to a hand-typed `cols`: the URL can only ever select from
 * what the page offers, and a typo shows the unfiltered page rather than an
 * empty one that looks like the database is empty.
 */
function chosen<Value extends string>(
  allowed: readonly Value[],
  raw: ParamValue,
): Value | undefined {
  const value = firstValue(raw);
  if (value === undefined) return undefined;
  return allowed.find((candidate) => candidate === value);
}

/**
 * The narrowing the URL asked for. An absent, repeated or unrecognised
 * parameter constrains nothing, so `filterFrom({})` is the whole table —
 * settled items included, which is what keeps them browsable.
 */
export function filterFrom(params: SearchParams = {}): ReviewItemFilter {
  const filter: ReviewItemFilter = {};
  const kind = chosen(FACET_VALUES.kind, params.kind);
  const queue = chosen(FACET_VALUES.queue, params.queue);
  const shape = chosen(FACET_VALUES.shape, params.shape);
  const status = chosen(FACET_VALUES.status, params.status);
  if (kind !== undefined) filter.kind = kind;
  if (queue !== undefined) filter.queue = queue;
  if (shape !== undefined) filter.shape = shape;
  if (status !== undefined) filter.status = status;
  return filter;
}

/** Is anything narrowed at all? What tells "nothing here yet" from "nothing matched". */
export function isNarrowed(filter: ReviewItemFilter): boolean {
  return FACETS.some((facet) => filter[facet] !== undefined);
}

/* ── writing the URL ─────────────────────────────────────────────────────── */

/**
 * The same filter with one facet set, or cleared when the value is undefined.
 * Every other facet keeps its value, so changing one chip never silently drops
 * another (`?kind=signal&status=settled` stays both).
 */
export function withFacet<F extends Facet>(
  filter: ReviewItemFilter,
  facet: F,
  value: ReviewItemFilter[F],
): ReviewItemFilter {
  const next: ReviewItemFilter = { ...filter };
  if (value === undefined) delete next[facet];
  else next[facet] = value;
  return next;
}

/**
 * The URL showing exactly this filter.
 *
 * "No narrowing" is spelled by OMITTING the parameter, in `FACETS` order, so
 * one state has one URL: the unfiltered page is the bare path, and a bookmark
 * carries no redundant state.
 */
export function queuesHref(path: string, filter: ReviewItemFilter): string {
  const query = new URLSearchParams();
  for (const facet of FACETS) {
    const value = filter[facet];
    if (value !== undefined) query.set(facet, value);
  }
  const search = query.toString();
  return search.length === 0 ? path : `${path}?${search}`;
}

/* ── the chips ───────────────────────────────────────────────────────────── */

/** One filter chip: where it goes, and whether it is the state we are in. */
export interface FilterChoice {
  /**
   * What the chip says. Every narrowing choice is the DATABASE'S OWN VALUE,
   * verbatim — `high`, `entity_link`, `settled` — because that is the word the
   * URL carries and the word the row shows (LOOK_AND_FEEL: machine
   * identifiers render verbatim). Only the "no narrowing" chip is a word of
   * the app's.
   */
  label: string;
  href: string;
  active: boolean;
}

/** One group of chips: the facet it sets, and every choice it offers. */
export interface FilterFacet {
  /** The facet, which is also its parameter name and its `micro` label. */
  facet: Facet;
  choices: FilterChoice[];
}

/** The chip that clears a facet. The app's own word, not a value. */
export const ANY_LABEL = "all";

/**
 * One facet's chips: "all" first, then every value it may take, each linking
 * to this page with that one facet changed and every other facet kept.
 *
 * Exactly the configured vocabulary, nothing outside it — a chip can only ever
 * offer a value `FACET_VALUES` holds, which is the same guarantee the column
 * selector makes about its configured set.
 */
export function facetChips(
  path: string,
  filter: ReviewItemFilter,
  facet: Facet,
): FilterFacet {
  const values: readonly string[] = FACET_VALUES[facet];
  const current = filter[facet];
  return {
    facet,
    choices: [
      {
        label: ANY_LABEL,
        href: queuesHref(path, withFacet(filter, facet, undefined)),
        active: current === undefined,
      },
      ...values.map((value) => ({
        label: value,
        href: queuesHref(
          path,
          withFacet(filter, facet, value as ReviewItemFilter[Facet]),
        ),
        active: current === value,
      })),
    ],
  };
}

/** Every facet's chips, in `FACETS` order. */
export function filterBar(path: string, filter: ReviewItemFilter): FilterFacet[] {
  return FACETS.map((facet) => facetChips(path, filter, facet));
}
