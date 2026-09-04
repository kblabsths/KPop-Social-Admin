import { Badge, type Column } from "@/components/ui";
import { isAbsent, relativeAge } from "@/lib/format";
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
export function sourceColumns(filter: SourceNarrowing): Column<SourceStateRow>[] {
  return [
    {
      key: "source",
      label: "source",
      cell: (row) => (
        <a
          href={sourcesHref({
            // Clicking the source you are already narrowed to clears it.
            source_id: filter.source_id === row.source_id ? undefined : row.source_id,
          })}
          data-source={row.source_id}
          data-source-name={row.source}
          aria-current={filter.source_id === row.source_id ? "true" : undefined}
          className="transition-colors hover:text-accent"
        >
          {row.source}
        </a>
      ),
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
            className="transition-colors hover:text-accent"
          >
            review items
          </a>
          <a
            href={runsHref(row.source)}
            data-source-runs={row.source}
            className="transition-colors hover:text-accent"
          >
            runs
          </a>
        </span>
      ),
    },
  ];
}
