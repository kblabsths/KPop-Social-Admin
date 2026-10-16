import { IN_PAGE_LINK } from "@/components/cycles/links";
import { Badge, type Column } from "@/components/ui";
import { isAbsent, relativeAge } from "@/lib/format";
import { sourceLabel } from "@/lib/sources/names";
import {
  queueItemsHref,
  runsHref,
  sourcesHref,
  type SourceNarrowing,
} from "@/lib/sources/routes";
import type { SourceStateRow } from "./rows";

/**
 * The registry table's columns — campaign admin-window/DEBT-0004, moved here
 * whole from `src/app/sources/page.tsx`.
 */

/**
 * The state row, column by column. Nothing here is computed from anything: a
 * value the database holds renders verbatim in mono, and a null renders as the
 * table's own dash (`orDash` in `ui/data-table.tsx`) — never blank, never a
 * zero, never a word of ours standing in for one.
 */
export function sourceColumns(
  filter: SourceNarrowing,
  /**
   * What the registry calls each source, as `sourceNamesOf` recorded it — the
   * page's own complete `listSources` read, handed over whole, exactly as
   * `SourceChips` and the two trend sections take it.
   *
   * The name column has the row's own `source` in its hand, so this map looks
   * redundant and is not: what to SAY when that string names nothing readable
   * is `sourceLabel`'s one rule and not this file's
   * (admin-window/TASK-0060). This cell spelled `{row.source}` raw — no
   * fallback of any spelling, which is why the `?? sourceId` scanner never saw
   * it — so one blank registry row rendered the registry's own name cell as an
   * anchor with nothing to read and nothing visible to click, beside a trend
   * row naming that same source by its id (BUG-0154's harm; BUG-0159 was the
   * same defect on the chips).
   */
  names: ReadonlyMap<string, string>,
): Column<SourceStateRow>[] {
  return [
    {
      key: "source",
      label: "source",
      cell: (row) => {
        // Derived ONCE and rendered into both the ink and the hook, so the
        // attribute a test or a live oracle reads is the thing an operator
        // reads (LESSONS 11).
        const label = sourceLabel(names, row.source_id);
        return (
          <a
            href={sourcesHref({
              // Clicking the source you are already narrowed to clears it.
              source_id: filter.source_id === row.source_id ? undefined : row.source_id,
            })}
            data-source={row.source_id}
            data-source-name={label}
            aria-current={filter.source_id === row.source_id ? "true" : undefined}
            className={IN_PAGE_LINK}
          >
            {label}
          </a>
        );
      },
    },
    {
      key: "kind",
      label: "kind",
      // `registered` or `cited` — how the source arrived. A machine identifier,
      // rendered verbatim, and not a badge: badges here carry lifecycle and
      // tier alone.
      cell: (row) => <span data-source-kind={row.kind}>{row.kind}</span>,
    },
    {
      key: "lifecycle",
      label: "lifecycle",
      cell: (row) => (
        <span data-source-lifecycle={row.lifecycle}>
          <Badge>{row.lifecycle}</Badge>
        </span>
      ),
    },
    {
      key: "tier",
      label: "tier",
      cell: (row) => (
        <span data-source-tier={row.tier}>
          <Badge>{row.tier}</Badge>
        </span>
      ),
    },
    {
      key: "checkpoint",
      label: "checkpoint",
      // The adapter's opaque resume token, verbatim. A source that has never
      // committed one has no checkpoint, which is the dash.
      // `isAbsent` is the app's ONE definition of absence, so a checkpoint
      // that is null and one that is an empty string read the same
      // (admin-window/BUG-0004).
      cell: (row) =>
        isAbsent(row.checkpoint) ? null : (
          <span data-source-checkpoint={row.checkpoint}>{row.checkpoint}</span>
        ),
    },
    {
      key: "last_run",
      label: "last run",
      cell: (row) => {
        // No run at all: the dash. It says "this source has never run", and it
        // is reachable only because the read succeeded — a `runs` table that
        // could not be read replaces this whole table with its own state.
        if (row.lastRun === null) return null;
        const age = relativeAge(row.lastRun.started_at);
        return (
          <span
            data-source-last-run={row.lastRun.run_id}
            data-source-last-run-at={row.lastRun.started_at}
            title={age.title}
          >
            {age.text}
          </span>
        );
      },
    },
    {
      key: "outcome",
      label: "outcome",
      cell: (row) => {
        const run = row.lastRun;
        if (run === null) return null;
        // A run still in flight has neither end nor outcome (the row is
        // inserted at start), so it reads as the dash with the running state
        // beside it rather than as a fabricated outcome.
        if (run.outcome === null) {
          return run.ended_at === null ? (
            <span data-source-run-state="running">still running</span>
          ) : null;
        }
        return (
          <span data-source-outcome={run.outcome}>
            {run.outcome}
            {run.failure_class === null ? "" : ` · ${run.failure_class}`}
          </span>
        );
      },
    },
    {
      key: "note",
      label: "note",
      // Free text on the state row — the operator's own words about why a
      // source is paused, and the app does not paraphrase them.
      cell: (row) =>
        isAbsent(row.note) ? null : <span data-source-note="">{row.note}</span>,
    },
    {
      key: "links",
      label: "links",
      cell: (row) => (
        <span className="flex flex-wrap gap-2">
          <a
            href={queueItemsHref(row.source_id)}
            data-source-items={row.source_id}
            className={IN_PAGE_LINK}
          >
            review items
          </a>
          {/* The registry's NAME, raw and not the label: `runs` carries no
              key and is filtered by `runs.source`, so this is a value to
              match rather than a word to read (admin-window/TASK-0060). A
              source the registry named nothing for matches the runs that
              named nothing either, which is the truth about the run log. */}
          <a
            href={runsHref(row.source)}
            data-source-runs={row.source}
            className={IN_PAGE_LINK}
          >
            runs
          </a>
        </span>
      ),
    },
  ];
}
