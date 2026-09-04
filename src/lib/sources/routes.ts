/**
 * The URLs `/sources` builds, and the facet it builds them from — campaign
 * admin-window/DEBT-0004.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7), the shape
 * `lib/records/routes.ts` already has for the record URL: it imports nothing,
 * reaches no database, and is the ONE place these three links are spelled.
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
 * column is. Queues does not offer this facet yet (its vocabulary is kind /
 * queue / shape / status), and an unrecognised parameter there narrows nothing
 * rather than erroring, so the link lands on the queues rather than anywhere
 * broken until that facet is added (admin-window/TASK-0013's handoff).
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
