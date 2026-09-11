/**
 * The URLs `/sources` builds, the facet it builds them from, and what that
 * facet is CALLED in a sentence about the read it narrowed — campaign
 * admin-window/DEBT-0004, admin-window/TASK-0073.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7), the shape
 * `lib/records/routes.ts` already has for the record URL: it imports nothing,
 * reaches no database, and is the ONE place these three links, and this
 * surface's narrowing vocabulary, are spelled.
 * They live here rather than in `components/sources/**` because a URL is not
 * presentation — the page reads the facet off `searchParams` with the same
 * constant the chip row writes into a link, and a component may not own a
 * name the page must agree with.
 */

/** This route's own path — the base every narrowing link is built on. */
export const SOURCES_PATH = "/sources";

/**
 * The narrowing facet, spelled exactly as the column is.
 *
 * It is also the parameter the CLAIMS page already links a claim's source with
 * (`sourceHref` in `src/lib/claims/filters.ts`: `/sources?source_id=<id>`), so
 * that link narrows this page instead of dead-ending. One name for one thing —
 * the convention `queue-filters.ts` set and `claims/filters.ts` followed.
 */
export const SOURCE_FACET = "source_id";

/**
 * The narrowing a link carries, as this leaf sees it: the one facet, optional.
 *
 * Declared here so the page, the chip row and the registry table all name one
 * shape; `lib/db/sources.ts`'s `SourcesFilter` satisfies it structurally, so
 * the page hands its own filter straight down and nothing translates (a leaf
 * never imports `lib/db`, not even a type — §4 rule 7).
 */
export interface SourceNarrowing {
  source_id?: string;
}

/** The URL showing exactly this narrowing. No narrowing is the bare path. */
export function sourcesHref(filter: SourceNarrowing): string {
  return filter.source_id === undefined
    ? SOURCES_PATH
    : `${SOURCES_PATH}?${SOURCE_FACET}=${encodeURIComponent(filter.source_id)}`;
}

/**
 * That source's review items — the Queues page narrowed to it.
 *
 * `review_items.source_id` is the column, and the parameter is spelled as the
 * column is. **Queues offers that facet** (`SOURCE_FACET` in
 * `src/lib/review/queue-filters.ts`, admin-window/BUG-0141): the link narrows
 * both queue blocks to this source's items and the page states the scope with
 * a link back out. A source carrying no items renders the honest "nothing
 * matched" rather than another source's row — which is what this anchor
 * promised and did not do until that facet existed.
 */
export function queueItemsHref(sourceId: string): string {
  return `/queues?source_id=${encodeURIComponent(sourceId)}`;
}

/**
 * That source's runs — Cycles & runs narrowed to it BY NAME, because that is
 * the only handle `runs` has (§6 trap 6). The parameter is the column,
 * `runs.source`.
 */
export function runsHref(sourceName: string): string {
  return `/cycles?source=${encodeURIComponent(sourceName)}`;
}

/* ── what narrows a /sources read, and what to call it in a sentence ──────── */

/**
 * **THIS surface's facet table**: which facets of a `/sources` URL narrow a
 * read, how to read each off the filter that read was given, and what the app
 * calls it in a window line (campaign admin-window/TASK-0073, SPEC F15).
 *
 * The SHAPE is not this file's and is not retyped here: it is
 * `UnchippedFacet<SourceNarrowing>` in `src/lib/url/narrowing.ts`, the leaf
 * that owns URL meaning, together with the two functions over it
 * (`unchippedNarrowings`, `unchippedPhrase`) and the composition
 * (`narrowedTo`, `src/components/ui/window-line.tsx`). `/claims` says the same
 * sentence from the same three (admin-window/BUG-0163, admin-window/TASK-0072),
 * which is the whole reason this page's lines are wired and not written —
 * a retyped spelling is the class that has taken five bugs on this family
 * (LESSONS 5).
 *
 * **The shape is not IMPORTED either**, and that is this file's own rule
 * rather than a gap: a pure domain leaf here imports nothing at all
 * (ARCHITECTURE.md §4 rule 7; asserted by `tests/offline/sources/page.test.ts`,
 * "keeps the URL leaf below lib/db"). The table is therefore checked against
 * `UnchippedFacet<SourceNarrowing>` where it is USED — `scopeOf` in
 * `src/app/sources/page.tsx` hands it to the generic `unchippedNarrowings`, so
 * a facet added here with a missing word or a mistyped reader is a compile
 * error at that call, not a narrowing the page applies in silence.
 *
 * **The words state what the READ CARRIED; they are not an attribution.** The
 * phrase names the facet and the value, so it says what population the scan
 * ran over ("Claims observed from source_id <id> …") — the non-attribution
 * kind `lib/url/narrowing.ts` describes, unconditional on what came back. It
 * is deliberately NOT `NARROWED_BY_FILTERS` ("matching these filters"), which
 * points at the chip row this page renders above the registry and is therefore
 * a claim about rows lost to that control — sayable only where that control's
 * own EFFECT is established (architect ruling 2026-09-11,
 * admin-window/BUG-0192).
 *
 * The facet is spelled as the parameter is spelled — one word for one thing,
 * the same convention `CLAIMS_UNCHIPPED_FACETS` follows and the same word the
 * chip row's own eyebrow carries — so an operator reading the line off the
 * screen can write `?source_id=<value>` back into the address bar
 * (LOOK_AND_FEEL bar 11). The value is the id VERBATIM as the query carried
 * it, never the registry's name for it: the name is a second read that can
 * refuse or come back blank, and the line would then name a narrowing its
 * query did not make.
 */
export const SOURCES_NARROWING_FACETS = [
  {
    facet: SOURCE_FACET,
    before: `from ${SOURCE_FACET} `,
    after: "",
    value: (filter: SourceNarrowing) => filter.source_id,
  },
];
