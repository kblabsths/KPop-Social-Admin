import { Chip, Eyebrow } from "@/components/ui";
import { SOURCE_FACET, sourcesHref, type SourceNarrowing } from "@/lib/sources/routes";
import type { SourceStateRow } from "./rows";
import { ANY_LABEL } from "./surfaces";

/**
 * The registry's narrowing chips — campaign admin-window/DEBT-0004, moved here
 * whole from `src/app/sources/page.tsx`.
 */

/**
 * The narrowing chips: "all", then every source the registry holds.
 *
 * The group's label is the URL parameter it sets — `source_id`, a column name
 * and so a machine identifier. It renders verbatim in mono rather than
 * uppercased into the sans `micro` step, which turned it into `SOURCE_ID` on
 * screen (LOOK_AND_FEEL Voice bar 5; admin-window/BUG-0049).
 */
export function SourceChips({
  sources,
  filter,
}: {
  sources: readonly SourceStateRow[];
  filter: SourceNarrowing;
}) {
  return (
    <div
      data-facet={SOURCE_FACET}
      role="group"
      aria-label={SOURCE_FACET}
      className="flex flex-wrap items-center gap-2"
    >
      <Eyebrow label={{ identifier: SOURCE_FACET }} />
      <Chip
        label={ANY_LABEL}
        href={sourcesHref({})}
        active={filter.source_id === undefined}
      />
      {sources.map((source) => (
        <Chip
          key={source.source_id}
          // The database's own value, verbatim — the word the row shows.
          label={source.source}
          href={sourcesHref({ source_id: source.source_id })}
          active={filter.source_id === source.source_id}
        />
      ))}
    </div>
  );
}
