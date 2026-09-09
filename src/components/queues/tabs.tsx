import { Chip } from "@/components/ui";
import type { TabLink } from "@/lib/review/queue-filters";

/**
 * The Queues page's two tabs — campaign admin-window/TASK-0058.
 *
 * The verdict log is its own tab (spec F13, DECISIONS 2026-09-04), and a tab
 * here is a real LINK carrying a `searchParams` value: the state lives in the
 * URL, so a tab is bookmarkable and survives the back button and a reload
 * (LOOK_AND_FEEL bar 11), this stays a pure synchronous server component with
 * no client bundle, and it is keyboard-reachable by construction (bar 9).
 * Nothing here is a nav item: the sidebar still holds exactly six links.
 *
 * It chooses nothing: `tabLinks` in `src/lib/review/queue-filters.ts` decides
 * which tabs exist, where each goes and which is current. A pure component:
 * plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 *
 * The rendering is the shipped one from Claims (`src/components/claims/tabs.tsx`),
 * copied deliberately rather than reinvented: the two tab strips are the same
 * control on two pages and must not drift into two devices. Folding them into
 * one primitive is a `components/ui` change that belongs to whoever owns that
 * surface, and is noted on this ticket's handoff rather than made here.
 */
export function QueueTabs({ tabs }: { tabs: readonly TabLink[] }) {
  return (
    <div role="group" aria-label="queues view" className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => (
        <span key={tab.tab} data-tab={tab.tab} data-active={tab.active ? "true" : undefined}>
          <Chip label={tab.label} href={tab.href} active={tab.active} />
        </span>
      ))}
    </div>
  );
}
