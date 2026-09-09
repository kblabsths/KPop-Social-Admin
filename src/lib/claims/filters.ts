/**
 * The Claims page's URL state — campaign admin-window/TASK-0012.
 *
 * LOOK_AND_FEEL bar 11: "every filter, sort and page position is bookmarkable
 * and survives the back button", so the whole page state — the two tabs
 * included — is `searchParams` and nothing here holds state of its own. It is
 * the same split `src/lib/review/queue-filters.ts` made for Queues: the pure
 * functions that turn a URL into a narrowing and a narrowing back into a URL
 * live in a PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7), which is what makes
 * "the rendered counts equal the view's counts, per source filter" testable
 * without rendering anything at all.
 *
 * **It imports nothing that can reach a database** — not `lib/db/**`, not a
 * type from it. That is why every facet's vocabulary is handed IN
 * (`FacetOptions`) instead of imported: two of the three are data anyway (the
 * sources and domains a claim set actually carries), and the third — the
 * buckets — is the data layer's, `RENDERABLE_BUCKETS` in `lib/db/claims.ts`.
 * The page reads, then asks this module which narrowing the URL wanted.
 *
 * It decides no membership: `selectClaims` in `lib/db/claims.ts` is the one
 * predicate over claims, and this module only says what the URL asked for.
 *
 * **Its imports are all leaves** (ARCHITECTURE.md §4 rule 7, second
 * paragraph: a leaf may import a leaf, and the leaf layer is a DAG):
 * `lib/url/dropped-params.ts`, the shared owner of the dropped-parameter rule
 * this file re-exports (admin-window/BUG-0141) — which in turn asks
 * `lib/verdict/decision.ts` the app's single definition of blank
 * (admin-window/BUG-0136); `lib/url/narrowing.ts`, the shared owner of the
 * two-fact rule that tells "nothing here yet" from "nothing matched"
 * (admin-window/DEBT-0008); and `lib/records/id.ts`, the app's ONE uuid
 * grammar (admin-window/DEBT-0009). None of them reaches anything that can
 * reach a database, so no cycle can be written through them. The alternative
 * in every case was a second copy of a rule, which is the exact defect
 * ARCHITECTURE.md Common violations row 9 promoted to a rule.
 */

import { canonicalRecordId } from "@/lib/records/id";
import {
  isSurfaceNarrowed,
  type SurfacePopulation,
} from "@/lib/url/narrowing";

/* ── the parameter names ─────────────────────────────────────────────────── */

/**
 * A facet is a `ClaimsFilter` field, and its parameter is spelled the same as
 * the field, as Queues spells its own: one name for one thing, so
 * `?bucket=awaiting_row` narrows `filter.bucket` with no translation table to
 * disagree with. Spec §4's three: "filterable by source, domain and bucket".
 */
export const CLAIM_FACETS = ["bucket", "source_id", "domain"] as const;

export type ClaimFacet = (typeof CLAIM_FACETS)[number];

/** The narrowing a URL asks for. Every field optional; absent means unnarrowed. */
export type ClaimsFilter = Partial<Record<ClaimFacet, string>>;

/** Every value each facet may take, in the order its chips render. */
export type FacetOptions = Readonly<Record<ClaimFacet, readonly string[]>>;

/**
 * The two tabs. `standing` is the standing-disagreements subset — the same
 * view filtered to `bucket = 'standing_disagreement'` (resolver.md §7; there
 * is no second database object), which is why it is a TAB of this route and
 * not a route of its own: one page, one read, two framings.
 */
export const TABS = ["buckets", "standing"] as const;

export type ClaimsTab = (typeof TABS)[number];

/** The tab a bare URL lands on. Omitted from every href, so one state has one URL. */
export const DEFAULT_TAB: ClaimsTab = "buckets";

/** The parameter the tab travels in. A search parameter, never a path segment. */
export const TAB_PARAM = "tab";

/* ── reading the URL ─────────────────────────────────────────────────────── */

/** A `searchParams` value, in every shape Next can hand one over. */
export type ParamValue = string | string[] | undefined;

/** The `searchParams` object a page awaits. */
export type SearchParams = Record<string, ParamValue>;

/**
 * The FIRST value the URL carries for a key. `?bucket=a&bucket=b` is ambiguous
 * state and the web platform already answers it — `URLSearchParams.get()`
 * returns the first — so a hand-edited URL lands on a real, bookmarkable state
 * rather than an error page.
 */
function firstValue(value: ParamValue): string | undefined {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value;
}

/**
 * The value if the offered vocabulary holds it, else nothing — the TAB's
 * reader (`filterFrom` asks `named` below, which answers the same question of
 * a facet whose values may be identifiers).
 *
 *
 * A value outside the set constrains NOTHING rather than narrowing to an empty
 * list — the rule `queue-filters.ts` and `browse/views.ts` already apply to a
 * hand-typed parameter: the URL can only ever select from what the page
 * offers, so a typo shows the unfiltered page instead of an empty one that
 * reads as an empty database.
 *
 * **This is also what keeps `in_window` out of the markup on a hand-typed
 * URL.** The bucket options are the renderable buckets, so `?bucket=…` naming
 * the parked one is not a narrowing, is not the active chip, and — the part
 * that would otherwise leak — is not carried forward into the href of every
 * other chip on the page.
 */
function chosen(allowed: readonly string[], raw: ParamValue): string | undefined {
  const value = firstValue(raw);
  if (value === undefined) return undefined;
  return allowed.find((candidate) => candidate === value);
}

/**
 * The offered value a URL value NAMES — the same question `chosen` asks, of a
 * facet whose values may be identifiers (campaign admin-window/DEBT-0009).
 *
 * `source_id` is a uuid column, and the two comparisons a narrowed claims page
 * makes only agree on values that were put in one spelling first: Postgres
 * matches every spelling of one uuid at the gauge's `.eq`, JavaScript matches
 * exactly one in `selectClaims` and in the chip's `active` test. Compared RAW,
 * a real source's id uppercased or with its hyphens left out selected nothing,
 * was reported as a dropped parameter, and the page rendered unnarrowed —
 * admin-window/BUG-0140's defect, still shipping on `/claims` because the
 * grammar lived in `lib/db/records.ts` where no leaf could reach it.
 *
 * So BOTH sides are canonicalised and canonical is compared to canonical
 * (LESSONS 4). The one grammar answers it — `canonicalRecordId`, which also
 * strips the padding a paste brings, by INK rather than by whitespace
 * (admin-window/BUG-0145, BUG-0146) — and a value
 * it says is no id at all compares as ITSELF, which is every value of the two
 * word facets and is byte for byte what this function did before. No second
 * uuid pattern is written here, and no facet needs naming: the values decide.
 *
 * What it RETURNS is always the OFFERED value — the vocabulary's own spelling,
 * which for `source_id` is the id the database printed — so the filter, every
 * chip href and every row link carry one spelling of one id, whatever the URL
 * arrived in.
 */
function named(allowed: readonly string[], raw: ParamValue): string | undefined {
  const value = firstValue(raw);
  if (value === undefined) return undefined;
  const asked = canonicalRecordId(value) ?? value;
  return allowed.find((candidate) => (canonicalRecordId(candidate) ?? candidate) === asked);
}

/**
 * The narrowing the URL asked for, against the vocabularies the page offers.
 * `filterFrom({}, options)` is every claim.
 */
export function filterFrom(
  params: SearchParams = {},
  options: FacetOptions,
): ClaimsFilter {
  const filter: ClaimsFilter = {};
  for (const facet of CLAIM_FACETS) {
    const value = named(options[facet], params[facet]);
    if (value !== undefined) filter[facet] = value;
  }
  return filter;
}

/** The tab the URL asked for; anything else is the default one. */
export function tabFrom(params: SearchParams = {}): ClaimsTab {
  const value = chosen(TABS, params[TAB_PARAM]);
  return (value as ClaimsTab | undefined) ?? DEFAULT_TAB;
}

/**
 * Is anything narrowed STRUCTURALLY — does this URL carry a claim facet that
 * can remove a claim at all? Fact 1 of the two the four states turn on, and
 * never the whole answer on its own.
 *
 * It reads the URL and nothing else, which is the half this leaf can answer:
 * it holds no rows and may reach no database. On its own it cannot tell "this
 * page holds no claims" from "your filter matched nothing", so a surface
 * asking which arm to render asks `claimsNarrowed` below
 * (admin-window/DEBT-0008). Its answer is unchanged for every caller that
 * wants the URL's own question — the chip bar, the dropped-parameter
 * comparison, the tests that pin the vocabulary.
 *
 * **It was `isNarrowed`, which `/queues` also exported with a different
 * meaning** (admin-window/DEBT-0010): there, the question is whether the URL
 * narrows a block BEYOND the narrowing that block already applies to itself
 * (`isNarrowedBeyond`, `src/lib/review/queue-filters.ts`). Two questions, two
 * names — the functions are NOT merged, because their facet sets differ.
 */
export function hasNarrowingFacet(filter: ClaimsFilter): boolean {
  return CLAIM_FACETS.some((facet) => filter[facet] !== undefined);
}

/**
 * **Is THIS claims surface's rendering scoped by the URL?** — the four-state
 * question, from BOTH facts (admin-window/DEBT-0008).
 *
 * `/claims` decided it from `hasNarrowingFacet` alone, so `?bucket=X` over a
 * view holding zero claims said "no claims matched these filters" and told the
 * operator to widen a filter that had removed nothing. The rule is
 * `src/lib/url/narrowing.ts`' — the same one `/queues`' `isBlockNarrowed` and
 * `/sources` call — and this is its claims-domain adapter: fact 1 is the URL
 * question above, fact 2 is the surface's own population.
 *
 * Asked PER SURFACE, because the two on this page hold different sets: the
 * claim list's population is every claim the current TAB spans (the standing
 * tab is one bucket's subset), while the bucket table's is every claim the
 * view holds, since that table drops the bucket facet on purpose. A page-wide
 * answer would make one of them speak for a set it does not render.
 */
export function claimsNarrowed(
  filter: ClaimsFilter,
  surface: SurfacePopulation,
): boolean {
  return isSurfaceNarrowed(hasNarrowingFacet(filter), surface);
}

/**
 * What the URL asked for that the page DID NOT DO — the parameters carried
 * into this render that narrowed nothing (admin-window/BUG-0123).
 *
 * **Moved to `src/lib/url/dropped-params.ts` by admin-window/BUG-0141, which
 * gave `/queues` the same sentence.** Four bugs have landed on this one rule
 * (BUG-0123, BUG-0127, BUG-0136, BUG-0137); a second copy of it would be born
 * with none of them, which is ARCHITECTURE.md Common violations row 9 promoted
 * to a rule (§13.7). Re-exported here — not re-implemented, and not wrapped —
 * so this page's callers and its two test files never learned it moved, and the
 * rule is DECLARED in exactly one file — which a check on this ticket greps for,
 * and which is why this line does not spell that declaration either. `tab` is
 * the parameter this page consumes outside its filter and it is
 * the shared rule's default `consumed` list, so a two-argument call from here
 * means exactly what it meant before.
 *
 * `ClaimsFilter` is what this page hands over as the APPLIED narrowing: every
 * field is an optional string, which is the shared rule's `AppliedNarrowing`.
 */
export { droppedParams, type DroppedParams } from "@/lib/url/dropped-params";

/* ── writing the URL ─────────────────────────────────────────────────────── */

/**
 * The same filter with one facet set, or cleared when the value is undefined.
 * Every other facet keeps its value, so changing one chip never silently drops
 * another.
 */
export function withFacet(
  filter: ClaimsFilter,
  facet: ClaimFacet,
  value: string | undefined,
): ClaimsFilter {
  const next: ClaimsFilter = { ...filter };
  if (value === undefined) delete next[facet];
  else next[facet] = value;
  return next;
}

/**
 * The URL showing exactly this filter on exactly this tab.
 *
 * "No narrowing" is spelled by OMITTING the parameter, in `CLAIM_FACETS`
 * order, and the default tab is omitted too — so one state has one URL, the
 * unfiltered page is the bare path, and a bookmark carries no redundant state.
 */
export function claimsHref(
  path: string,
  filter: ClaimsFilter,
  tab: ClaimsTab = DEFAULT_TAB,
): string {
  const query = new URLSearchParams();
  for (const facet of CLAIM_FACETS) {
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
   * What the chip SAYS. Every narrowing choice is the database's own word for
   * that value — `awaiting_row`, `events`, a source's registry NAME — because
   * that is the word the row beside it shows. Only the "no narrowing" chip is
   * a word of the app's.
   *
   * It is not always the value in the URL: a source is keyed by `source_id`, a
   * uuid, and named by `sources.source`, so the chip reads `ticketmaster`
   * while `value` carries the id (admin-window/BUG-0043). A label the caller
   * cannot resolve falls back to the value verbatim — never a blank, never a
   * guess.
   */
  label: string;
  href: string;
  active: boolean;
}

/**
 * What a facet's values are CALLED, when the value is not readable.
 *
 * Handed in rather than looked up: this module is a pure domain leaf and may
 * not reach a database (ARCHITECTURE.md §4 rule 7), and the only facet that
 * needs one — `source_id` — is named by a registry row the page has already
 * read. Absent, or returning nothing for a value, means the value is its own
 * label, which is what the two other facets want.
 */
export type FacetLabel = (facet: ClaimFacet, value: string) => string;

/** One group of chips: the facet it sets, and every choice it offers. */
export interface FilterFacet {
  /** The facet, which is also its parameter name and its `micro` label. */
  facet: ClaimFacet;
  choices: FilterChoice[];
}

/** The chip that clears a facet. The app's own word, not a value. */
export const ANY_LABEL = "all";

/**
 * One facet's chips: "all" first, then every value it may take, each linking
 * to this page with that one facet changed, every other facet kept and the tab
 * kept. Exactly the offered vocabulary, nothing outside it.
 */
export function facetChips(
  path: string,
  filter: ClaimsFilter,
  tab: ClaimsTab,
  facet: ClaimFacet,
  values: readonly string[],
  labelOf?: FacetLabel,
): FilterFacet {
  const current = filter[facet];
  return {
    facet,
    choices: [
      {
        label: ANY_LABEL,
        href: claimsHref(path, withFacet(filter, facet, undefined), tab),
        active: current === undefined,
      },
      ...values.map((value) => ({
        // The chip says what the value is CALLED; the href still carries the
        // value itself, so naming a source never changes what a chip narrows.
        label: labelOf === undefined ? value : labelOf(facet, value),
        href: claimsHref(path, withFacet(filter, facet, value), tab),
        active: current === value,
      })),
    ],
  };
}

/**
 * Every facet's chips, in `CLAIM_FACETS` order — **except the bucket facet on
 * the standing tab**, because that tab IS a bucket
 * (`bucket = 'standing_disagreement'`, resolver.md §7). A bucket chip there
 * would look like a narrowing and do nothing, which is worse than not offering
 * it: the tab strip above already says which bucket you are in.
 */
export function filterBar(
  path: string,
  filter: ClaimsFilter,
  tab: ClaimsTab,
  options: FacetOptions,
  labelOf?: FacetLabel,
): FilterFacet[] {
  return CLAIM_FACETS.filter(
    (facet) => !(tab === "standing" && facet === "bucket"),
  ).map((facet) => facetChips(path, filter, tab, facet, options[facet], labelOf));
}

/** One tab: its word, where it goes, and whether we are on it. */
export interface TabLink {
  tab: ClaimsTab;
  label: string;
  href: string;
  active: boolean;
}

/** What each tab is called on screen. The app's words; the buckets are data. */
const TAB_LABEL: Record<ClaimsTab, string> = {
  buckets: "Buckets",
  standing: "Standing disagreements",
};

/**
 * Both tabs, each linking to this page on that tab with the filter kept — a
 * source you were looking at stays the source you are looking at when you
 * cross to the contradictions.
 */
export function tabLinks(
  path: string,
  filter: ClaimsFilter,
  tab: ClaimsTab,
): TabLink[] {
  return TABS.map((candidate) => ({
    tab: candidate,
    label: TAB_LABEL[candidate],
    href: claimsHref(path, filter, candidate),
    active: candidate === tab,
  }));
}

/* ── where a claim leads ─────────────────────────────────────────────────── */

/**
 * The source's page, narrowed to that source.
 *
 * LOOK_AND_FEEL bar 10: "from a claim its source and the fact's provenance —
 * each in one click, each a real URL". The parameter is spelled as the column
 * is, which is this app's landed convention for a facet
 * (`queue-filters.ts`: "one name for one thing"). Sources is a sibling ticket
 * (admin-window/TASK-0013): if it spells its own narrowing differently, this
 * one function changes — and until it does the link still lands on the source
 * registry rather than anywhere broken.
 */
export function sourceHref(sourceId: string): string {
  return `/sources?source_id=${encodeURIComponent(sourceId)}`;
}
