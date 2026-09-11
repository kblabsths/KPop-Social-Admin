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
import { canonicalUrlText } from "@/lib/url/text";
import {
  isSurfaceNarrowed,
  type SurfacePopulation,
  type UnchippedFacet,
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

/**
 * The facets that render a CHIP ROW — a bounded vocabulary the page can offer
 * (admin-window/BUG-0138, Ben's ruling of 2026-09-10).
 *
 * Two of the three, and the missing one is `domain`. A chip row is an
 * ENUMERATION, and the page has no bounded read of "the domains in play": the
 * chips used to be the distinct domains of the whole claim population, which
 * cost a read of every row of the view on every request, and `domain_target`
 * is a function taking a domain name rather than an enumerable registry, so
 * there is nothing to ask instead. `?domain=` therefore stays a REAL narrowing
 * — applied server-side by `.eq("domain", …)` on every count and on the window
 * read, named in the window line's scope and in the bucket caption's narrowed
 * arm — and simply offers no chips. Spec §4's "filterable by source / domain /
 * bucket" is unchanged; what went is the enumeration the page never read.
 */
export const CHIP_FACETS = ["bucket", "source_id"] as const;

export type ChipFacet = (typeof CHIP_FACETS)[number];

/**
 * A facet that narrows and renders NO control — `CLAIM_FACETS` minus
 * `CHIP_FACETS`, and today exactly `domain` (admin-window/BUG-0160).
 *
 * DERIVED rather than listed, so the two sets cannot drift: a facet that gains
 * a chip row leaves this one in the same edit, and a facet that loses one
 * joins it. The type is what makes that safe — `UNCHIPPED_WORDS` below is a
 * total `Record` over it, so a facet arriving here with no words to be named
 * by is a compile error rather than a narrowing the page applies in silence,
 * which is the whole defect this vocabulary exists for.
 *
 * It is this page's own facet union and carries no `Unchipped` SHAPE: the
 * shape is `src/lib/url/narrowing.ts`' and is declared exactly once
 * (admin-window/TASK-0072).
 */
type UnchippedClaimFacet = Exclude<ClaimFacet, ChipFacet>;

/** Every facet of a claims URL that narrows with no chip to read it off. */
const UNCHIPPED_CLAIM_FACETS: readonly UnchippedClaimFacet[] = CLAIM_FACETS.filter(
  (facet): facet is UnchippedClaimFacet =>
    !(CHIP_FACETS as readonly string[]).includes(facet),
);

/**
 * What each control-less facet is CALLED in a sentence about it.
 *
 * `domain` is spelled as the parameter is spelled — one word for one thing,
 * so an operator reading "claims in the events domain" off the screen can
 * write `?domain=events` back into the address bar (LOOK_AND_FEEL bar 11).
 */
const UNCHIPPED_WORDS: Record<UnchippedClaimFacet, { before: string; after: string }> = {
  domain: { before: "in the ", after: " domain" },
};

/**
 * THIS surface's table of control-less facets — how to read each off a
 * `ClaimsFilter` and what to call it — in `CLAIM_FACETS` order.
 *
 * The vocabulary is the page's and stays here, beside the filters it is read
 * off; the SHAPE it is expressed in (`UnchippedFacet`, `UnchippedNarrowing`)
 * and the two functions over it (`unchippedNarrowings`, `unchippedPhrase`)
 * belong to `src/lib/url/narrowing.ts`, so a second surface saying the same
 * sentence imports them instead of retyping them (admin-window/TASK-0072,
 * LESSONS 5). This module declares none of those three and re-exports none of
 * them: one declaration, one home.
 */
export const CLAIMS_UNCHIPPED_FACETS: readonly UnchippedFacet<ClaimsFilter>[] =
  UNCHIPPED_CLAIM_FACETS.map((facet) => ({
    facet,
    ...UNCHIPPED_WORDS[facet],
    value: (filter: ClaimsFilter) => filter[facet],
  }));

/**
 * Does this URL set a facet the page actually renders a CONTROL for?
 *
 * The other half of `CLAIMS_UNCHIPPED_FACETS`, and the reason both live here:
 * a sentence may say "these filters" or "the filters above" only where a
 * filter the operator can SEE is set (admin-window/BUG-0160).
 * `/claims?domain=events` narrows every count on the page with both chip rows
 * reading `all`, so those two phrases pointed at controls that said nothing
 * was filtered — while the narrowing that really applied was named nowhere on
 * the screen.
 *
 * **It answers PRESENCE and says so in its name** (architect ruling
 * 2026-09-11, ARCHITECTURE.md §4.3): is a chip facet SET on this filter. It is
 * not an EFFECT question and must never be read as one — whether a facet
 * removed a row is `claimsNarrowed` / `isSurfaceNarrowed`, which take a
 * population. Its old name spelled this presence answer with the word the
 * effect questions own, and one chip earned two opposite sentences on two
 * staging URLs while the two answers were ANDed in one clause
 * (admin-window/BUG-0191's residual; the rendered arms are
 * admin-window/BUG-0192's).
 *
 * It is NOT `hasNarrowingFacet` with a different set by accident: that one
 * answers "can this URL remove a row at all" (fact 1 of the four states) and
 * must go on counting every facet, chipped or not.
 */
export function hasChipFacet(filter: ClaimsFilter): boolean {
  return CHIP_FACETS.some((facet) => filter[facet] !== undefined);
}

/**
 * The same read with every CHIP facet **the URL carried** dropped — the widened
 * narrowing whose count answers "did the chip family remove any of these rows"
 * (`isFamilyNarrowing`, `lib/url/narrowing.ts`; admin-window/BUG-0192).
 *
 * Two arguments and not one, and that is the whole rule: `applied` is the
 * filter a surface's read was really given, `asked` is what the URL asked for.
 * The subtraction takes the chip facets out of `asked`, so a facet a SURFACE
 * merged in of its own accord survives it. The one such facet today is the
 * standing tab's own bucket (`listFilterOf`): it is not a control above,
 * nothing on screen offers it, and dropping it would compare this tab's rows
 * against the OTHER tab's population — an attribution answered off the wrong
 * set, which is the class this function is part of fixing.
 *
 * It is this page's vocabulary applied to a shared rule, which is why it lives
 * here and the rule does not: `CHIP_FACETS` is the claims page's own set, and
 * the leaf that decides attribution takes booleans and numbers so it can stay
 * free of every filter type in the app (§4 rule 7).
 */
export function withoutChipFacets(
  applied: ClaimsFilter,
  asked: ClaimsFilter,
): ClaimsFilter {
  const widened: ClaimsFilter = { ...applied };
  for (const facet of CHIP_FACETS) {
    if (asked[facet] !== undefined) delete widened[facet];
  }
  return widened;
}

/** The narrowing a URL asks for. Every field optional; absent means unnarrowed. */
export type ClaimsFilter = Partial<Record<ClaimFacet, string>>;

/** Every value a CHIP facet offers, in the order its chips render. */
export type FacetOptions = Readonly<Record<ChipFacet, readonly string[]>>;

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
 * The value if the offered vocabulary holds it, else nothing — the reader for
 * the two CLOSED vocabularies this page has: the tab, and the bucket facet.
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
 * The narrowing the URL asked for — one DERIVATION per facet, and each is the
 * one its value class already owns (ARCHITECTURE.md §7; LESSONS 4 and 5).
 *
 * `filterFrom({}, buckets)` is every claim.
 *
 * **The three facets are read three different ways, and the reason is what
 * each value IS**, not a preference:
 *
 *  - `bucket` is a CLOSED vocabulary this app declares — `RENDERABLE_BUCKETS`
 *    in `lib/db/claims.ts`, handed in because this leaf may not reach
 *    `lib/db/**` — so a value outside it narrows NOTHING, which is what keeps
 *    the parked bucket out of the markup on a hand-typed URL: it is not a
 *    narrowing, not the active chip, and not carried forward into the href of
 *    every other chip on the page (§6 trap 4, LOOK_AND_FEEL bar 3).
 *  - `source_id` is a uuid COLUMN, so its derivation is `canonicalRecordId` —
 *    the app's one uuid grammar (admin-window/BUG-0140, BUG-0145, BUG-0146).
 *    A value it says is no id at all narrows nothing and is reported on the
 *    dropped-parameter line, and that guard is load-bearing rather than
 *    tidy: the narrowing is a `.eq()` on a `uuid` column now, and Postgres
 *    answers a non-uuid with `22P02` — a page-wide error state for a typo.
 *  - `domain` is FREE TEXT, so its derivation is `canonicalUrlText` — the free
 *    text class's one derivation (admin-window/BUG-0155), which strips the
 *    padding a paste brought, refuses a value this app may not spell, and
 *    returns the single string that both reaches the query and is spelled in
 *    every sentence about it.
 *
 * **Neither of the two value facets is checked against a vocabulary any more**
 * (admin-window/BUG-0138). They used to be checked against the distinct
 * sources and domains of the whole claim population — which is exactly the
 * read this page no longer makes, and cannot make concurrently with the reads
 * it narrows. So a well-formed value the view holds no row for now NARROWS,
 * honestly, and the page renders the "nothing matched" card with a window line
 * holding 0 rather than the unnarrowed page under a line saying the parameter
 * was dropped: the narrowing happened, and the page says where it looked. What
 * is still DROPPED — and still named — is a value that names nothing at all
 * for its class.
 */
export function filterFrom(
  params: SearchParams = {},
  buckets: readonly string[],
): ClaimsFilter {
  const filter: ClaimsFilter = {};
  const bucket = chosen(buckets, params.bucket);
  if (bucket !== undefined) filter.bucket = bucket;
  const sourceId = canonicalRecordId(firstValue(params.source_id) ?? "");
  if (sourceId !== null) filter.source_id = sourceId;
  const domain = canonicalUrlText(firstValue(params.domain));
  if (domain !== null) filter.domain = domain;
  return filter;
}

/** The tab the URL asked for; anything else is the default one. */
export function tabFrom(params: SearchParams = {}): ClaimsTab {
  const value = chosen(TABS, params[TAB_PARAM]);
  return (value as ClaimsTab | undefined) ?? DEFAULT_TAB;
}

/**
 * The narrowing the claim LIST reads under — the tab's own subset of what the
 * URL asked for, derived ONCE for both surfaces that read it
 * (admin-window/TASK-0066).
 *
 * The first screen (`src/app/claims/page.tsx`) and the paging route handler
 * (`src/app/api/admin/claims/rows/route.ts`) issue the SAME `readClaimWindow`
 * at two offsets of one order, so the narrowing under them has to be one
 * derivation and not two spellings of it: a paged row set that belonged to a
 * different narrowing than the rows above it is the defect this function
 * exists to make unwritable (LESSONS 5; ARCHITECTURE.md common violations
 * row 20 — what is SHOWN is what was USED).
 *
 * The standing tab IS a bucket (`bucket = 'standing_disagreement'`,
 * resolver.md §7), so on that tab the URL's own bucket facet is dropped and
 * the tab's bucket is set instead: a bucket chip there would look like a
 * narrowing and do nothing, and a bucket nobody can see must not travel in the
 * URL. Every other facet the URL asked for is carried through untouched.
 *
 * `standingBucket` is handed IN for the reason every vocabulary in this file
 * is: this is a pure domain leaf and the constant lives beside the gauge that
 * is that bucket (`lib/gauges/standing-disagreements.ts`), which reaches
 * `lib/db/**`. One spelling, handed down — never a second copy typed here.
 */
export function listFilterOf(
  asked: ClaimsFilter,
  tab: ClaimsTab,
  standingBucket: string,
): ClaimsFilter {
  if (tab !== "standing") return asked;
  return { ...withFacet(asked, "bucket", undefined), bucket: standingBucket };
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
  const search = claimsQuery(filter, tab);
  return search.length === 0 ? path : `${path}?${search}`;
}

/**
 * The facets a PAGING request carries: the narrowing this page APPLIED,
 * serialized — campaign admin-window/TASK-0067, SPEC F14.
 *
 * It is the query half of `claimsHref` above and is spelled ONCE for both:
 * the URL an operator bookmarks and the URL a press asks the route handler
 * for state the same narrowing, in the same facet order, with "no narrowing"
 * spelled the same way — by omission (LESSONS 5).
 *
 * **It is built from the FILTER, never from `searchParams`.** A parameter the
 * page DROPPED — a bucket outside the offered vocabulary, a `source_id` that
 * is not a uuid, a domain the URL respelled — narrowed no read the first
 * screen made, so it must not travel to the handler and come back as a
 * different narrowing under rows drawn from the first one
 * (`lib/url/dropped-params.ts`, admin-window/BUG-0141; ARCHITECTURE.md common
 * violations row 20 — what is SHOWN is what was USED).
 *
 * **What the caller hands in is the TAB's filter, not the list's.** The route
 * handler re-derives the list's narrowing with `listFilterOf` from these same
 * two arguments, exactly as the page does, so the standing tab's own bucket
 * arrives by the tab rather than as a `?bucket=` — the page drops that facet
 * from its URL on purpose, and a bucket nobody can see must not start
 * travelling in one now (see `listFilterOf` above).
 */
export function claimsQuery(filter: ClaimsFilter, tab: ClaimsTab = DEFAULT_TAB): string {
  const query = new URLSearchParams();
  for (const facet of CLAIM_FACETS) {
    const value = filter[facet];
    if (value !== undefined) query.set(facet, value);
  }
  if (tab !== DEFAULT_TAB) query.set(TAB_PARAM, tab);
  return query.toString();
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
 * Every CHIP facet's chips, in `CHIP_FACETS` order — **except the bucket facet
 * on the standing tab**, because that tab IS a bucket
 * (`bucket = 'standing_disagreement'`, resolver.md §7). A bucket chip there
 * would look like a narrowing and do nothing, which is worse than not offering
 * it: the tab strip above already says which bucket you are in.
 *
 * `domain` has no chip row at all (`CHIP_FACETS`, admin-window/BUG-0138) and
 * still narrows: a facet the page cannot ENUMERATE is not a facet the page
 * cannot APPLY, and the two questions are answered separately here and at the
 * query.
 */
export function filterBar(
  path: string,
  filter: ClaimsFilter,
  tab: ClaimsTab,
  options: FacetOptions,
  labelOf?: FacetLabel,
): FilterFacet[] {
  return CHIP_FACETS.filter(
    (facet) => !(tab === "standing" && facet === "bucket"),
  ).map((facet) => facetChips(path, filter, tab, facet, options[facet], labelOf));
}

/* ── the exit ────────────────────────────────────────────────────────────── */

/**
 * The app's word for the ONE control that clears every narrowing at once
 * (admin-window/BUG-0161).
 *
 * `ANY_LABEL` clears ONE facet and says so; this clears the whole filter. The
 * two are different promises and carry different words, because
 * `/claims?domain=zzz` made the difference load-bearing: every chip on the
 * page — both `all` chips included — carried `domain=zzz` forward, so the one
 * action the empty card named ("the 'all' chip on any row shows everything
 * again") returned the operator to the same zeroed page, and the narrowing
 * that emptied it had no control on the screen at all.
 */
export const CLEAR_LABEL = "clear filters";

/**
 * What the row holding that control is CALLED — its `role="group"` name, and
 * the eyebrow standing over it.
 *
 * The app's own word rather than a parameter name: the row is not a facet, so
 * unlike every chip row above it there is no identifier to render (the chip
 * rows' eyebrows are `MicroLabel.identifier`, this one is words).
 */
export const CLEAR_EYEBROW = "narrowing";

/**
 * The exit: where "no narrowing at all, on this tab" is, or `null` when this
 * URL narrows nothing and there is nothing to clear.
 *
 * It is `claimsHref` over the EMPTY filter, which is what makes it total over
 * `CLAIM_FACETS` rather than over the facets that happen to render a chip: a
 * facet added tomorrow — chipped or not — is dropped by this href on the day
 * it is read, because the href is built from the filter that has nothing set
 * instead of by subtracting the narrowings someone remembered. Anything the
 * URL carried that this page never applied goes with it, since `claimsHref`
 * writes only what the page understood.
 *
 * The TAB is kept, and is the one narrowing this deliberately does not clear:
 * a tab is a control the operator can see and cross back from (`tabLinks`),
 * which is exactly what the facets it does clear are not.
 */
export function clearNarrowing(
  path: string,
  filter: ClaimsFilter,
  tab: ClaimsTab = DEFAULT_TAB,
): FilterChoice | null {
  if (!hasNarrowingFacet(filter)) return null;
  return { label: CLEAR_LABEL, href: claimsHref(path, {}, tab), active: false };
}

/**
 * The words an empty surface names that control with — assembled here, beside
 * the control, so the card and the chip cannot come to disagree about what
 * clicking it does (LESSONS 5: a shared spelling gets imported, never
 * retyped). `CLEAR_LABEL` is interpolated rather than spelled a second time,
 * so the card quotes the chip's own word by construction.
 *
 * Three pieces, because the facet's name is a machine identifier and takes the
 * app's one identifier face in markup (`ui/Identifier`, LOOK_AND_FEEL Voice
 * bar 5) — the same split `UnchippedNarrowing` makes for the same reason.
 */
export const CLEARED_BY = {
  /** The whole promise, and it is the control's own promise. */
  chip: `The '${CLEAR_LABEL}' chip above clears every filter in this URL`,
  /** …before the first control-less facet's own name. */
  including: ", including ",
  /** …between two of them, on a page that ever has two. */
  and: ", ",
  /** …and after the last, saying why the operator could not find it. */
  withNoChip: ", which has no chip row of its own",
  end: ".",
} as const;

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
