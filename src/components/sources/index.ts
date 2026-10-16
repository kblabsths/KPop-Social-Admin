/**
 * `/sources`' presentation — campaign admin-window/DEBT-0004.
 *
 * The Sources page's own sections, moved out of `src/app/sources/page.tsx` so
 * that this page's presentation lives beside every other page's
 * (ARCHITECTURE.md §13.6; the page was 793 lines with six components defined
 * where the page function is). Nothing here reads, awaits or fetches: each
 * export is a pure synchronous component or a pure column builder taking plain
 * props, which is the division §5 draws — the page reads and shapes, the
 * components render.
 *
 * The page's URL work is NOT here: `sourcesHref`, `queueItemsHref`, `runsHref`
 * and the `source_id` facet are a pure leaf, `lib/sources/routes.ts`, because
 * the page reads the facet off `searchParams` with the same constant the chips
 * write into a link.
 */
export { sourceColumns } from "./registry-table";
export { type SourceStateRow } from "./rows";
export { SourceChips } from "./source-chips";
export { AwaitingRowTrendSection, RejectionSection } from "./trends";
export {
  ANY_LABEL,
  AWAITING_LABEL,
  AWAITING_SURFACE,
  NOTHING_MATCHED,
  NOTHING_REGISTERED,
  REGISTRY_SURFACE,
  REJECTION_LABEL,
  REJECTION_SURFACE,
} from "./surfaces";
