import { Chip } from "@/components/ui";
import type {
  BrowseColumnKey,
  BrowseColumnOption,
} from "@/lib/browse/views";

/**
 * Browse's runtime column selector (campaign admin-window/TASK-0015).
 *
 * Spec §4: "a runtime column selector over the configured set". The options
 * are computed by `columnOptions` in `src/lib/browse/views.ts` — **exactly the
 * view definition's configured columns, every one offered and nothing outside
 * it** — so this component chooses nothing; it renders what the definition
 * configured.
 *
 * Every control is a LINK, not a handler: the selector's state lives in
 * `searchParams` (LOOK_AND_FEEL bar 11 — "every filter, sort and page position
 * is bookmarkable and survives the back button"), so this stays a pure sync
 * server component with no client bundle and no `useState` a reload forgets.
 * That also makes it keyboard-reachable by construction (bar 9).
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 */
export function ColumnSelector({
  label,
  options,
  hrefFor,
}: {
  /** The `micro` label above the chips, and the group's accessible name. */
  label: string;
  options: readonly BrowseColumnOption[];
  /** The URL that shows a given set of columns. */
  hrefFor: (keys: readonly BrowseColumnKey[]) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="type-micro text-ink-secondary">{label}</span>
      {options.map((option) => (
        <Chip
          key={option.key}
          label={option.label}
          href={hrefFor(option.toggled)}
          active={option.shown}
        />
      ))}
    </div>
  );
}
