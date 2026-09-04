import type { ReactNode } from "react";
import { DataTable, Section } from "@/components/ui";
import { IN_PAGE_LINK, RUNS_ANCHOR } from "./links";
import { runColumns } from "./run-columns";
import type { ReadOf, RunColumnName, RunCountName, RunTableRow, RunsWindow } from "./rows";
import { LATEST_RUN_SURFACE } from "./surfaces";

/**
 * The newest adapter run, above the fold — campaign admin-window/DEBT-0004,
 * moved here whole from `src/app/cycles/page.tsx`.
 */

/** The heading of that lead, and the label its one-row table carries. */
const LATEST_RUN_LABEL = "Newest adapter run";

/**
 * The newest adapter run, rendered ABOVE the cycles window.
 *
 * LOOK_AND_FEEL bar 1 names this page by name: at 1440×900, without
 * scrolling, "Cycles & runs shows the newest run with its counts and error".
 * The two halves are stacked and the cycles half is a window of at most 200
 * rows, so against a populated database the runs heading sat 4,419px below the
 * fold — 4.9 viewport-heights down — and the operator had to scroll the whole
 * cycles window to reach the first run (measured on the M1 endgame designer
 * walk, 2026-09-03, admin-window/BUG-0040). Dropping the 200-row cycles window
 * would trade one honesty for another; the newest run is repeated here
 * instead, and both windows below stay exactly what they were.
 *
 * Three rules keep the repetition honest:
 *
 *  - **It is the same READ.** The row is `runs.data.rows[0]` — the first row
 *    of the window rendered below, in the order that read returned (newest
 *    first, `readRuns` in `lib/db/runs.ts`). Not a second query, which could
 *    answer from a different instant, and not a re-sort of the window here.
 *  - **It is the same CELLS.** `runColumns(now, "lead")` is the same nine
 *    columns from the same `RUN_COLUMNS`, so the lead renders a run exactly as
 *    the table does, down to the dash. Only the identity hook differs, so
 *    nothing that reads `[data-run]` counts this row as a second run — and the
 *    length bound on the error cell, which is a bound and not a second
 *    rendering: under `CLAMP_LIMIT` the lead is the window's row cell for cell,
 *    and over it the lead ends in an ellipsis while the whole string stays on
 *    its `title` and in the window's own cell below
 *    (campaign admin-window/DEBT-0005).
 *  - **It states no FIGURE.** A lead is a row, never a count: the window line
 *    below is the only place this half describes its window, and no number
 *    here comes from `rows.length` (ARCHITECTURE.md §4.3).
 *
 * With no row to lead with — an empty window, a refused read, an absent table
 * — it says which of those it is, in one sentence naming the object the read
 * itself named, and links to the section that says it in full. It draws no
 * second state card: each of the four states is rendered once, by the surface
 * that made the read (LOOK_AND_FEEL, Emptiness).
 */
export function LatestRun({
  runs,
  now,
  source,
  columns,
  counts,
}: {
  runs: ReadOf<RunsWindow>;
  now: string;
  /** The `?source=` facet as the URL carried it, or undefined for no facet. */
  source: string | undefined;
  /** The nine, in the order the ruling names them (`RUN_COLUMNS`). */
  columns: readonly RunColumnName[];
  /** Which of them are figures (`RUN_COUNTS`). */
  counts: readonly RunCountName[];
}): ReactNode {
  const newest: RunTableRow | undefined =
    runs.kind === "ok" ? runs.data.rows[0] : undefined;
  // What the lead is showing, for a test to read before it reads a row: the
  // window's first row, or which of the three row-less states this is.
  const kind =
    runs.kind === "ok" ? (newest === undefined ? "empty" : "ok") : runs.kind;

  if (newest === undefined) {
    return (
      <Section title={LATEST_RUN_LABEL} surface={LATEST_RUN_SURFACE}>
        <p data-latest-run-state={kind} className="type-body text-ink-secondary">
          {runs.kind === "not_provisioned" ? (
            <>
              No newest run to show: the read named{" "}
              <span className="type-data text-ink">{runs.missing}</span>, and
              this database holds no such object —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                what creates it is below
              </a>
              .
            </>
          ) : runs.kind === "error" ? (
            <>
              No newest run to show: the read of{" "}
              <span className="type-data text-ink">{runs.reading}</span>{" "}
              failed —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                what the database said is below
              </a>
              .
            </>
          ) : source === undefined ? (
            <>
              No adapter has filed a run in this window, so there is no newest
              run to lead with —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                the runs window is below
              </a>
              .
            </>
          ) : (
            <>
              No run in this window carries the source name{" "}
              <span className="type-data text-ink">{source}</span>, so there is
              no newest run to lead with under it —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                the runs window is below
              </a>
              .
            </>
          )}
        </p>
      </Section>
    );
  }

  return (
    <Section title={LATEST_RUN_LABEL} surface={LATEST_RUN_SURFACE}>
      <div data-latest-run-state={kind}>
        <DataTable<RunTableRow>
          label={LATEST_RUN_LABEL}
          columns={runColumns({ now, role: "lead", columns, counts })}
          rows={[newest]}
          rowKey={(row) => row.run_id}
        />
      </div>
      <p className="type-body text-ink-secondary">
        The first row of the{" "}
        <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
          adapter-runs window below
        </a>
        , repeated here so the last thing that ran is on screen without
        scrolling the cycles. It is that one row and nothing else: what the
        window holds, and what it does not, is stated with the table itself.
      </p>
    </Section>
  );
}
