import {
  isSurfaceNarrowed,
  type SurfacePopulation,
} from "@/lib/url/narrowing";
import {
  KINDS,
  SHAPES,
  shapeOf,
  shapesOfKind,
  type Kind,
  type ReviewItemFilter,
  type ReviewItemRow,
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
 * The narrowing this page offers that has NO CHIP ROW: the source an item is
 * about (campaign admin-window/BUG-0141).
 *
 * Spelled exactly as the column and as every other surface's parameter for it
 * (`/sources`' own `SOURCE_FACET`, `/claims`' `?source_id=`), so the anchor the
 * Sources page labels "review items" narrows this page instead of landing on
 * every source's items.
 *
 * It is NOT in `FACETS`, and the split is the design: `FACETS` is the CHIP
 * vocabulary — the four facets whose every value is declared in `FACET_VALUES`
 * — and a source vocabulary is unbounded data this page never reads (it holds
 * no registry). So there is no chip row for it; what states the narrowing on
 * screen is the page's scope element, and what clears it is that element's own
 * link back.
 */
export const SOURCE_FACET = "source_id";

/**
 * Every facet that NARROWS, chips or no chips — what `filterFrom`, `queuesHref`
 * and `isNarrowedBeyond` iterate.
 *
 * Two lists, deliberately: a facet with no chip row still travels in every
 * href this page writes, or clicking `settled` — or the verdict-log tab —
 * would silently widen the page back to every source (LOOK_AND_FEEL bar 11:
 * the filter state survives). `facetChips` / `filterBar` / `withFacet` /
 * `FACET_VALUES` keep iterating `FACETS`, because those four are the ones with
 * a vocabulary to draw.
 */
export const NARROWING_FACETS = [...FACETS, SOURCE_FACET] as const;

export type NarrowingFacet = (typeof NARROWING_FACETS)[number];

/**
 * The app's one uuid grammar, HANDED IN (admin-window/BUG-0139/BUG-0140 own
 * it; it lives in `src/lib/records/id.ts`).
 *
 * A uuid pattern written here would be a SECOND grammar — the defect that one
 * is there to prevent — so this file writes none: it takes the canonicaliser
 * as an argument, the way `claims/filters.ts` takes its `FacetOptions`. It
 * returns the id in the database's own spelling, or `null` for a value that is
 * not an id at all.
 *
 * **Handed in is no longer FORCED, and stays anyway.** The argument was
 * BUG-0141's answer to the grammar living under `lib/db/**`, which a pure
 * domain leaf may not import (ARCHITECTURE.md §4 rule 7); since
 * admin-window/DEBT-0009 moved it to a leaf, this file may import it and a
 * leaf-to-leaf edge is the shape rule 7's second paragraph wants. That move
 * did not re-open this signature — the call site is unchanged and so is every
 * answer this module gives — so switching it is a decision for whoever needs
 * it, not a side effect of a file moving.
 */
export type CanonicalId = (raw: string) => string | null;

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

/* ── the tabs ────────────────────────────────────────────────────────────── */

/**
 * The two views of this route (campaign admin-window/TASK-0058).
 *
 * `verdicts` is the VERDICT LOG — `verdicts` newest first, the one record of
 * every admin data action (spec §7, F13). It is a TAB of `/queues` and not a
 * seventh page: VISION names six pages, the sidebar holds exactly six links,
 * and the log renders as a URL facet of the surface whose items it settles
 * (DECISIONS 2026-09-04). The shipped rendering it copies is the
 * standing-disagreements tab on Claims (`src/lib/claims/filters.ts`), which is
 * why the shape below — a `TABS` list, a `DEFAULT_TAB` omitted from every
 * href, `tabFrom` and `tabLinks` — is that module's, not a second invention.
 */
export const TABS = ["queues", "verdict_log"] as const;

export type QueuesTab = (typeof TABS)[number];

/** The tab a bare URL lands on. Omitted from every href, so one state has one URL. */
export const DEFAULT_TAB: QueuesTab = "queues";

/**
 * The parameter the tab travels in — a SEARCH parameter, never a path segment.
 *
 * State lives in the URL (LOOK_AND_FEEL bar 11): the tab is bookmarkable, it
 * survives the back button and a reload, and no route is added. It is spelled
 * `tab` because that is what Claims spells it, and one name for one thing is
 * this file's own rule about a facet.
 */
export const TAB_PARAM = "tab";

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
 *
 * **The source facet is read only when a canonicaliser is handed in**
 * (admin-window/BUG-0141). Called with one argument this is byte for byte what
 * it always was: no `source_id` key is ever set, so the call sites that read
 * only the four chip facets keep their present meaning, and an
 * UN-canonicalised id can reach the filter by no path at all. It is never an
 * identity default: an id in a spelling Postgres would match but JavaScript
 * would not is exactly how `/sources` once denied a source the database had
 * just matched (admin-window/BUG-0140), and a filter is compared both ways.
 *
 * A value that is not a record id at all — `not-a-uuid` — canonicalises to
 * `null` and so narrows NOTHING, the same answer `chosen` gives a value
 * outside a vocabulary. The page names it in its dropped-parameter line
 * rather than swallowing it, and no `22P02` ever reaches a read.
 */
export function filterFrom(
  params: SearchParams = {},
  canonicalId?: CanonicalId,
): ReviewItemFilter {
  const filter: ReviewItemFilter = {};
  const kind = chosen(FACET_VALUES.kind, params.kind);
  const queue = chosen(FACET_VALUES.queue, params.queue);
  const shape = chosen(FACET_VALUES.shape, params.shape);
  const status = chosen(FACET_VALUES.status, params.status);
  if (kind !== undefined) filter.kind = kind;
  if (queue !== undefined) filter.queue = queue;
  if (shape !== undefined) filter.shape = shape;
  if (status !== undefined) filter.status = status;
  if (canonicalId !== undefined) {
    const asked = firstValue(params[SOURCE_FACET]);
    const source = asked === undefined ? null : canonicalId(asked);
    if (source !== null) filter[SOURCE_FACET] = source;
  }
  return filter;
}

/**
 * The tab the URL asked for; anything else is the default one.
 *
 * The same rule `chosen` applies to every facet: a value outside the offered
 * vocabulary selects nothing, so `?tab=nonsense` lands on the queues rather
 * than on an error page.
 */
export function tabFrom(params: SearchParams = {}): QueuesTab {
  return chosen(TABS, params[TAB_PARAM]) ?? DEFAULT_TAB;
}

/* ── the narrowing a surface applies to ITSELF ───────────────────────── */

/**
 * A row that exists only to ask `shapeOf` a question.
 *
 * The two columns the classifier reads carry the case (`queue`, and the
 * `source_id` discriminator migration `20260901000002` defines); every other
 * column is filler it never looks at. Typed in full on purpose — if
 * `ReviewItemRow` grows a column the registry starts classifying by, this stops
 * compiling instead of answering from a probe that has gone stale.
 */
function probeRow(queue: ReviewQueue, source_id: string | null): ReviewItemRow {
  return {
    review_item_id: "",
    queue,
    source_id,
    domain: null,
    entity_id: null,
    field: null,
    severity: "low",
    status: "open",
    summary: "",
    evidence: [],
    folded_count: 0,
    opened_at: "",
    last_evidence_at: "",
  };
}

/** The two states a subject can be in: a FACT (no source) or a SOURCE. */
const SUBJECTS: readonly (string | null)[] = [
  null,
  "00000000-0000-4000-8000-000000000000",
];

/**
 * The queues a shape's rows can appear in, read OUT OF `shapeOf` rather than
 * declared a second time. `./shapes.ts` is the one module that says what a
 * review item is (its own header: "everything that decides *what a review item
 * is* lives here and only here"), so the inverse of its classifier is asked of
 * the classifier — a `Record<Shape, ReviewQueue>` written here would be a second
 * spelling of the same mapping, free to drift the day a shape moves.
 */
function queuesOfShape(shape: Shape): ReviewQueue[] {
  return REVIEW_QUEUES.filter((queue) =>
    SUBJECTS.some((source_id) => shapeOf(probeRow(queue, source_id)) === shape),
  );
}

/** The one value a list holds — nothing when it holds none, nothing when several. */
function only<Value>(values: readonly Value[]): Value | undefined {
  return values.length === 1 ? values[0] : undefined;
}

/**
 * **The narrowing one queue block applies to itself: every facet value its
 * KIND implies** (admin-window/BUG-0131).
 *
 * A block renders `selectItems(rows, { kind })`. A URL facet removes not one
 * row from it when every row of that kind carries that value anyway — so the
 * block's own narrowing is not the one pair `{ kind }` but the whole SET of
 * values the kind entails, derived here from the shape registry:
 *
 * - `kind` — the block's own, always.
 * - `shape` — only when the kind has exactly ONE shape. `shapesOfKind("signal")`
 *   is `["entity_link_source_pattern"]` and nothing else, so
 *   `?shape=entity_link_source_pattern` selects exactly the signal block's set;
 *   the decision kind spans two shapes, so `?shape=data_conflict_fact` really
 *   does remove rows from it and keeps naming its scope.
 * - `queue` — only when every shape of the kind lives in ONE queue. Every
 *   signal row is `queue: "entity_link"` by `shapeOf`, so `?queue=entity_link`
 *   removes nothing from that block; the decision kind spans both queues, so
 *   neither queue value is implied for it.
 * - `status` is never implied by any kind: it is a row's own state and both
 *   values are open to every shape, so a status facet always narrows.
 *
 * Nothing here is a list of values written down beside the registry's: the
 * shapes come from `shapesOfKind`, the queues from `shapeOf`, and a fourth
 * shape or a third queue changes this answer without changing this file.
 */
export function narrowingOfKind(kind: Kind): ReviewItemFilter {
  const narrowing: ReviewItemFilter = { kind };
  const shapes = shapesOfKind(kind);
  // A kind with no shapes has no rows, and vacuous implication would let a
  // block discount every facet on screen. Claim nothing beyond the kind.
  if (shapes.length === 0) return narrowing;

  const shape = only(shapes);
  if (shape !== undefined) narrowing.shape = shape;

  const queues = shapes.map(queuesOfShape);
  // A shape that no queue can produce would leave the union below narrower
  // than the truth, so every shape must name a queue before the union may
  // imply one.
  if (queues.every((list) => list.length > 0)) {
    const queue = only(Array.from(new Set(queues.flat())));
    if (queue !== undefined) narrowing.queue = queue;
  }
  return narrowing;
}

/**
 * Is this URL narrowed BEYOND the narrowing a surface already applies to
 * itself? What tells "nothing here yet" from "nothing matched" — the ONE
 * narrowing decision in this route, asked once per surface that renders a
 * scoped figure or a "nothing matched" card.
 *
 * `within` is the narrowing a surface ALREADY applies to itself, whatever the
 * URL says — `narrowingOfKind(kind)` for one queue block, which is every facet
 * value that block's kind implies. A URL facet whose value the surface applies
 * anyway REMOVES NOT ONE ROW from it, so it may not be counted as narrowing:
 * `/queues?kind=decision` (the Dashboard's own zero-decisions link) renders the
 * decision block's whole set, and a block that said a filter emptied it would
 * be claiming a scope its own read does not support — "empty" and "nothing
 * matched your filters" are different states and never share a rendering
 * (LOOK_AND_FEEL, the four states; admin-window/BUG-0129).
 *
 * The exclusion is by VALUE and not by facet name, and the value it compares
 * against is the whole implied set rather than one facet: `?kind=signal` really
 * does empty the decision block, and `?shape=entity_link_source_pattern` really
 * is the signal block's own set under another name (admin-window/BUG-0131) — the
 * first still reads as filtered, the second may not.
 *
 * **`within` is REQUIRED** (admin-window/DEBT-0010). A surface with no
 * narrowing of its own passes `{}` at the call and thereby asks the whole-URL
 * question OUT LOUD. The parameter used to default to `{}`, so one signature
 * answered two different questions depending on how many arguments it was
 * given — 'narrowed relative to this block' with two, 'is any facet set' with
 * one — and no production call site ever took the default; only tests did. A
 * predicate that answers two questions is the one that gets widened by
 * whichever question broke last (ARCHITECTURE.md Common violations row 15).
 *
 * **A source is always narrowing.** `narrowingOfKind` is unchanged and carries
 * no `source_id`: no kind implies a source, so a source in the URL can never be
 * discounted by a block's own narrowing, for either block
 * (admin-window/BUG-0141). Whether it EMPTIED a block is the counted question
 * `isBlockNarrowed` asks below.
 */
export function isNarrowedBeyond(
  filter: ReviewItemFilter,
  within: ReviewItemFilter,
): boolean {
  return NARROWING_FACETS.some(
    (facet) => filter[facet] !== undefined && filter[facet] !== within[facet],
  );
}

/**
 * **The kinds this URL structurally narrows** — fact 1, asked of every kind at
 * once instead of one block at a time (campaign admin-window/DEBT-0012).
 *
 * `isNarrowedBeyond(filter, narrowingOfKind(kind))` is exactly the question the
 * page asks per block, and its answer decides whether that block's POPULATION
 * is consulted at all: `isSurfaceNarrowed` ANDs fact 1 with fact 2, so a block
 * this URL does not structurally narrow reads as unscoped whatever its
 * population turns out to be, and a count issued for it answers a question no
 * rendering asks (`src/lib/url/narrowing.ts`).
 *
 * The kinds it names are the ones whose population is LOAD-BEARING, which is
 * the opposite of the intuition: on `/queues?kind=signal` the signal block
 * renders its own whole set — no facet of that URL removes a signal row — while
 * the DECISION block is the one whose zero has to be explained, and its rows
 * are all gone from the filtered read (admin-window/BUG-0133). So the kind the
 * URL named is the kind whose count can be skipped.
 *
 * Declared here, beside the predicate it is one call of, and imported by
 * `src/lib/db/review-items.ts` rather than retyped there: the set the read
 * ISSUES counts for and the set the page CONSULTS must be one set, or a block
 * reports a refusal for a read nobody made.
 */
export function kindsNarrowedBy(filter: ReviewItemFilter): Kind[] {
  return KINDS.filter((kind) => isNarrowedBeyond(filter, narrowingOfKind(kind)));
}

/**
 * **Is THIS queue block's rendering scoped by the URL?** The one question the
 * four states turn on, from TWO facts and nothing else (admin-window/BUG-0133).
 *
 * `isNarrowedBeyond` above answers the STRUCTURAL half — can a facet of this
 * URL remove a row of this kind at all, whatever the table holds. It is derived
 * from the shape registry, so it can never answer the other half: **whether
 * the table holds any row of this kind in the first place.** When a block's
 * own queue is empty, no facet has removed anything from it — every URL leaves
 * exactly the rows the bare `/queues` shows, which is none — and a block that
 * said a filter emptied it would be blaming a filter for its own zero and
 * telling the reader to widen a filter that hides nothing. That is the state
 * staging is in today (0 decision items), and "a table with no rows" and "a
 * filter that matched nothing" never share a rendering (LOOK_AND_FEEL, the
 * four states).
 *
 * So the second fact is the block's own POPULATION — the size of the set it
 * renders with no URL facet at all (`readReviewQueues` in
 * `src/lib/db/review-items.ts`) — against the size of what it is rendering
 * now. The rendered set is a subset of the population, so equal sizes mean the
 * SAME SET: the facet removed nothing and there is no scope to claim.
 *
 * Both facts are required and neither is weakened:
 * - `?status=settled` on a decision queue holding open rows: structurally
 *   narrowing AND fewer rows than its population — still names its scope.
 * - `?kind=signal` on a decision queue holding decisions: same — still names it.
 * - `?kind=decision` on the decision block: not structurally narrowing at all
 *   (admin-window/BUG-0129, admin-window/BUG-0131) — never named.
 * - any facet on a decision queue holding NOTHING: population 0, rendered 0 —
 *   no longer named (admin-window/BUG-0133).
 *
 * Pure, and decided here rather than in the page, for the same reason
 * `isNarrowedBeyond` is: it is one rule about a narrowing, and the page renders.
 *
 * **The rule itself now lives in `src/lib/url/narrowing.ts`** and this is its
 * review-domain adapter (admin-window/DEBT-0008): the M2 structure walk found
 * `/claims` and `/sources` answering the same question from fact 1 alone, and
 * a rule with three callers is declared once. What stays here is the half that
 * is this domain's — fact 1, `isNarrowedBeyond(filter, within)` over
 * `NARROWING_FACETS` and a kind's implied narrowing, which no other surface
 * can spell. Nothing about this function's name, signature or answer changed.
 */
export function isBlockNarrowed(
  filter: ReviewItemFilter,
  within: ReviewItemFilter,
  block: SurfacePopulation,
): boolean {
  return isSurfaceNarrowed(isNarrowedBeyond(filter, within), block);
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
 * "No narrowing" is spelled by OMITTING the parameter, in `NARROWING_FACETS`
 * order, so one state has one URL: the unfiltered page is the bare path, and a
 * bookmark carries no redundant state.
 *
 * Every narrowing travels, the chipless source facet included — this is what
 * every chip href and both tab hrefs are built from, so clicking `settled`, or
 * the verdict log, keeps the source you arrived on (admin-window/BUG-0141).
 */
export function queuesHref(
  path: string,
  filter: ReviewItemFilter,
  tab: QueuesTab = DEFAULT_TAB,
): string {
  const query = new URLSearchParams();
  for (const facet of NARROWING_FACETS) {
    const value = filter[facet];
    if (value !== undefined) query.set(facet, value);
  }
  if (tab !== DEFAULT_TAB) query.set(TAB_PARAM, tab);
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

/* ── the tab strip ───────────────────────────────────────────────────────── */

/** One tab: its word, where it goes, and whether we are on it. */
export interface TabLink {
  tab: QueuesTab;
  label: string;
  href: string;
  active: boolean;
}

/**
 * What each tab is called on screen — the app's own words.
 *
 * "Verdict log" and not `verdicts`: the tab is a view of this app's, not a
 * machine identifier, so it takes sentence case like every other heading. The
 * TABLE's name still appears verbatim where it is the subject — in the
 * not-provisioned card, which names the object the query named.
 */
const TAB_LABEL: Record<QueuesTab, string> = {
  queues: "Queues",
  verdict_log: "Verdict log",
};

/**
 * Both tabs, each linking to this page on that tab with the filter kept — the
 * queue you were looking at is the queue you come back to.
 */
export function tabLinks(
  path: string,
  filter: ReviewItemFilter,
  tab: QueuesTab,
): TabLink[] {
  return TABS.map((candidate) => ({
    tab: candidate,
    label: TAB_LABEL[candidate],
    href: queuesHref(path, filter, candidate),
    active: candidate === tab,
  }));
}
