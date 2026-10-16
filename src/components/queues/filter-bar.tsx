import { Chip, ClearRow, Eyebrow } from "@/components/ui";
import type { FilterFacet } from "@/lib/review/queue-filters";
import type { ExitChoice } from "@/lib/url/narrowing";

/**
 * The Queues page's filters — campaign admin-window/TASK-0010.
 *
 * One group of chips per facet (kind, queue, shape, status), each chip a real
 * LINK: the filter state lives in `searchParams` (LOOK_AND_FEEL bar 11), so
 * this stays a pure synchronous server component with no client bundle and no
 * `useState` a reload forgets — and it is keyboard-reachable by construction
 * (bar 9).
 *
 * It chooses nothing. `filterBar` in `src/lib/review/queue-filters.ts` decides
 * which chips exist, where each goes and which is active; this renders them.
 * The group's label is the parameter it sets, so the screen and the URL use
 * one word for one thing — which makes it a machine identifier, and it renders
 * as one: verbatim, in mono, in its own case, never uppercased into a sans
 * `micro` label the way `SOURCE_ID` was (admin-window/BUG-0049).
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 */
export function FilterBar({
  facets,
  clear = null,
}: {
  facets: readonly FilterFacet[];
  /**
   * The one control that clears EVERY narrowing the URL applied, or `null`
   * where it applied none (`clearNarrowing`, admin-window/BUG-0164).
   *
   * Drawn by `ui/ClearRow` — the same module that assembles the sentence the
   * empty card names it with, so the promise and the control cannot come
   * apart. It is a row of this bar rather than a link inside that card because
   * a narrowing with no control is un-clearable in every state, not only the
   * one where it emptied a queue: `?source_id=<id>` narrows a page that still
   * draws rows just as thoroughly.
   */
  clear?: ExitChoice | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      {facets.map((group) => (
        <div
          key={group.facet}
          data-facet={group.facet}
          role="group"
          aria-label={group.facet}
          className="flex flex-wrap items-center gap-2"
        >
          <Eyebrow label={{ identifier: group.facet }} />
          {group.choices.map((choice) => (
            <Chip
              key={choice.label}
              label={choice.label}
              href={choice.href}
              active={choice.active}
            />
          ))}
        </div>
      ))}
      <ClearRow clear={clear} />
    </div>
  );
}
