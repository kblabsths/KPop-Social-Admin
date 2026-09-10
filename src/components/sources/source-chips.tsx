import { Chip, Eyebrow } from "@/components/ui";
import { sourceLabel } from "@/lib/sources/names";
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
 *
 * **Each chip is a source LABELLED BY ITS ID, so what it says is
 * `sourceLabel`'s** (`lib/sources/names.ts`, "the one owner of this rule") —
 * campaign admin-window/BUG-0159. Its whole href is `?source_id=<uuid>`; it
 * used to say the registry's `source.source` raw, with no fallback of ANY
 * spelling, so a registry row that EXISTED with an ink-less name rendered a
 * CONTROL with nothing to read and nothing visible to click — beside the trend
 * row for that same source, in that same render, which has named it by its id
 * since admin-window/BUG-0158. One source, one answer (LESSONS 11).
 *
 * The `names` map is the page's, built once from the SAME complete registry
 * read these chips are rendered from (`app/sources/page.tsx`), so the chip and
 * the trend below it are not two derivations of one fact.
 */
export function SourceChips({
  sources,
  names,
  filter,
}: {
  sources: readonly SourceStateRow[];
  names: ReadonlyMap<string, string>;
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
          // What the registry calls this source, or its id verbatim when the
          // registry names nothing readable — the app's one rule, asked here
          // rather than answered again (admin-window/BUG-0159).
          label={sourceLabel(names, source.source_id)}
          href={sourcesHref({ source_id: source.source_id })}
          active={filter.source_id === source.source_id}
        />
      ))}
    </div>
  );
}
