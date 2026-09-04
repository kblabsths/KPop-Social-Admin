import { Chip, Eyebrow } from "@/components/ui";
import type { FilterFacet } from "@/lib/review/queue-filters";

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
export function FilterBar({ facets }: { facets: readonly FilterFacet[] }) {
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
    </div>
  );
}
