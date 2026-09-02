import { Chip } from "@/components/ui";
import type { FilterFacet } from "@/lib/claims/filters";

/**
 * The Claims page's filters — campaign admin-window/TASK-0012.
 *
 * One group of chips per facet (bucket, source_id, domain), each chip a real
 * LINK, for the reasons the Queues filter bar gives: the filter state lives in
 * `searchParams` (LOOK_AND_FEEL bar 11), so this is a pure synchronous server
 * component with no `useState` a reload forgets, and it is keyboard-reachable
 * by construction (bar 9). The group's `micro` label is the parameter it sets,
 * so the screen and the URL use one word for one thing.
 *
 * It chooses nothing: `filterBar` in `src/lib/claims/filters.ts` decides which
 * chips exist, where each goes and which is active — including the one chip
 * that can never exist here, the parked bucket, which is not in the
 * vocabulary the page offers.
 *
 * It is a near-twin of `components/queues/filter-bar.tsx`, which renders the
 * same primitive over its own facet type. The shared thing is `ui/Chip`; the
 * two differ only in which leaf's `FilterFacet` they take, and a third page
 * wanting chips is the point at which one structurally-typed bar earns its
 * keep (noted on this ticket's handoff rather than done here, the way
 * `queue-filters.ts` noted its own duplicate vocabulary).
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
          <span className="type-micro text-ink-secondary">{group.facet}</span>
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
