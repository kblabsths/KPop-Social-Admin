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
 * **Its one import** is `lib/verdict/decision.ts`, for the app's single
 * definition of blank (admin-window/BUG-0136, below). That module imports
 * NOTHING — it is the leaf every other leaf's blankness question already ends
 * at, `lib/format.ts` included — so the arrow reaches nothing that can reach a
 * database and no cycle can be written through it. The alternative was a
 * second definition of "renders nothing" in this file, which is the exact
 * defect admin-window/BUG-0089 consolidated away.
 */
import { hasVisibleContent, visibleContent } from "@/lib/verdict/decision";

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

/** Is this key one of the page's facets? The narrowing vocabulary, as a guard. */
function isFacet(key: string): key is ClaimFacet {
  return (CLAIM_FACETS as readonly string[]).includes(key);
}

/**
 * What the URL asked for that the page DID NOT DO — the parameters carried
 * into this render that narrowed nothing (admin-window/BUG-0123).
 *
 * A parameter outside `CLAIM_FACETS`, and a facet value outside the offered
 * vocabulary, both narrow nothing here by design (`chosen` above: a URL can
 * only select from what the page offers, so a typo lands on a real state
 * rather than an empty one that reads as an empty database). Dropping it was
 * right; dropping it SILENTLY was not — a hand-typed `?record_id=<uuid>`
 * returned 200 under a sentence asserting the rows were filtered, and the
 * operator who did not know the count by heart had nothing to check
 * (`M2-usersim-priya.md` §6).
 *
 * Three rules, and they are the whole definition:
 *
 *  - **The question is the APPLIED filter, not the vocabulary.** A facet that
 *    reached `applied` is applied, whatever the URL spelled; one that did not
 *    is dropped, whether its value was unusable or the TAB took the facet away
 *    (the standing tab is one bucket's subset and carries no bucket facet, so
 *    a `?tab=standing&bucket=…` really is a narrowing this page did not do).
 *  - **`tab` is never here.** Every value of it lands on a real tab —
 *    `tabFrom` falls back to `DEFAULT_TAB` — and the tab strip shows which,
 *    so the page consumed it and no sentence is claiming otherwise.
 *  - **A key carrying no value asked for nothing** and is not a dropped
 *    narrowing; `?bucket=` is the URL saying nothing, not the page ignoring
 *    something. **A value carrying no key asks for nothing either**
 *    (admin-window/BUG-0127): `/claims?=x` reaches the page as `{"": "x"}`
 *    and `/claims?%20%20=1` as `{"  ": "1"}`, and a query pair is a request
 *    only with both halves — a nameless value names no facet, so there is no
 *    narrowing to have dropped. Same rule as the empty value, read from the
 *    other side, and it is why this line can no longer render a sentence
 *    with a hole where the name goes. Counting such a key as `withheld`
 *    instead would put "a parameter this page may not name" on screen, which
 *    states a reason that is not the reason: nothing is withheld, there is
 *    no name. Bar 3 is untouched either way — nothing is rendered.
 *
 *    **"Names nothing" is decided by INK, not by whitespace**
 *    (admin-window/BUG-0136). The rule above is right and `trim()` expressed
 *    only its whitespace half: `String.prototype.trim` strips the Unicode
 *    `White_Space` set and nothing else, so `/claims?%E2%80%8B=1` (ZERO WIDTH
 *    SPACE), `?%00=1`, `?%C2%AD=1`, `?%E2%81%A0=1`, `?%E2%80%8E=1` and
 *    `?%7F=1` all survived it and were spelled into the mono span, where a
 *    browser laid every one of them out at 0px and the sentence read with the
 *    same hole (measured in Chromium, both colour schemes, 2026-09-09). The
 *    test is now the app's ONE definition of blank — `hasVisibleContent`
 *    (`lib/verdict/decision.ts`, admin-window/BUG-0089) — so a key a reader
 *    would see nothing of names nothing, whichever family its codepoints come
 *    from, and this file holds no second opinion about what renders. Where
 *    that definition draws the line is its ruling, not this module's: an
 *    assigned printable character is content even when it looks unhelpful, so
 *    a U+2800 BRAILLE PATTERN BLANK key is still named.
 *
 * `neverNamed` is the small set of words this app may not put on screen at all
 * — the parked bucket (`UNRENDERABLE_BUCKET`, `lib/db/claims.ts`; LOOK_AND_FEEL
 * bar 3) — which a URL may perfectly well use as a KEY. It is handed in rather
 * than imported because this module is a pure domain leaf and may not reach
 * `lib/db/**` (ARCHITECTURE.md §4 rule 7). Such a parameter is still COUNTED:
 * the page says it dropped one without spelling it, which is bar 3 and bar 13
 * both kept. **The comparison is against what a reader would SEE of the key**
 * (`visibleContent`, admin-window/BUG-0136): `?in_window%E2%80%8B=1` reads as
 * `in_window` on screen, ink for ink, so a byte comparison would put the
 * parked bucket in front of an operator while agreeing it had not.
 */
export interface DroppedParams {
  /** The names, in the order the URL carried them, safe to render verbatim. */
  named: string[];
  /** How many more were dropped whose NAME this app may not put on screen. */
  withheld: number;
}

export function droppedParams(
  params: SearchParams = {},
  applied: ClaimsFilter = {},
  neverNamed: readonly string[] = [],
): DroppedParams {
  const named: string[] = [];
  let withheld = 0;
  for (const key of Object.keys(params)) {
    if (key === TAB_PARAM) continue;
    // A key with nothing a reader could see in it names nothing, so it asked
    // for nothing — the empty-value rule from the other side, and the whole
    // of it: blank is ink, not whitespace (admin-window/BUG-0136). The one
    // thing this line may never do is spell a name that is not there.
    if (!hasVisibleContent(key)) continue;
    const asked = firstValue(params[key]);
    if (asked === undefined || asked === "") continue;
    if (isFacet(key) && applied[key] !== undefined) continue;
    // What the app may not render is a word on the SCREEN, so the key is
    // compared as it would be read, not as it was typed.
    if (neverNamed.includes(visibleContent(key))) withheld += 1;
    else named.push(key);
  }
  return { named, withheld };
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
