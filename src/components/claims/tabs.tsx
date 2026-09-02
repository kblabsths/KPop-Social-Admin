import { Chip } from "@/components/ui";
import type { TabLink } from "@/lib/claims/filters";

/**
 * The Claims page's two tabs — campaign admin-window/TASK-0012.
 *
 * The standing-disagreements subset is its own tab (spec §4), and a tab here
 * is a real LINK carrying a `searchParams` value: the state lives in the URL,
 * so a tab is bookmarkable and survives the back button (LOOK_AND_FEEL bar
 * 11), this stays a pure synchronous server component with no client bundle,
 * and it is keyboard-reachable by construction (bar 9).
 *
 * It chooses nothing: `tabLinks` in `src/lib/claims/filters.ts` decides which
 * tabs exist, where each goes and which is current. A pure component: plain
 * props, no fetching (ARCHITECTURE.md §4 rule 1).
 */
export function ClaimTabs({ tabs }: { tabs: readonly TabLink[] }) {
  return (
    <div role="group" aria-label="claims view" className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => (
        <span key={tab.tab} data-tab={tab.tab} data-active={tab.active ? "true" : undefined}>
          <Chip label={tab.label} href={tab.href} active={tab.active} />
        </span>
      ))}
    </div>
  );
}
