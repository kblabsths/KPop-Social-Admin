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
 */

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
 * The value if the offered vocabulary holds it, else nothing.
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
 * The narrowing the URL asked for, against the vocabularies the page offers.
 * `filterFrom({}, options)` is every claim.
 */
export function filterFrom(
  params: SearchParams = {},
  options: FacetOptions,
): ClaimsFilter {
  const filter: ClaimsFilter = {};
  for (const facet of CLAIM_FACETS) {
    const value = chosen(options[facet], params[facet]);
    if (value !== undefined) filter[facet] = value;
  }
  return filter;
}

/** The tab the URL asked for; anything else is the default one. */
export function tabFrom(params: SearchParams = {}): ClaimsTab {
  const value = chosen(TABS, params[TAB_PARAM]);
  return (value as ClaimsTab | undefined) ?? DEFAULT_TAB;
}

/** Is anything narrowed? What tells "nothing here yet" from "nothing matched". */
export function isNarrowed(filter: ClaimsFilter): boolean {
  return CLAIM_FACETS.some((facet) => filter[facet] !== undefined);
}

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
   * What the chip says. Every narrowing choice is the DATABASE'S OWN VALUE,
   * verbatim — `awaiting_row`, a source id, `events` — because that is the
   * word the URL carries and the word the row shows. Only the "no narrowing"
   * chip is a word of the app's.
   */
  label: string;
  href: string;
  active: boolean;
}

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
        label: value,
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
): FilterFacet[] {
  return CLAIM_FACETS.filter(
    (facet) => !(tab === "standing" && facet === "bucket"),
  ).map((facet) => facetChips(path, filter, tab, facet, options[facet]));
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
