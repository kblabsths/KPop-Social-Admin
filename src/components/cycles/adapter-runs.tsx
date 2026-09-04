import type { ReactNode } from "react";
import type { EmptyWords } from "@/components/gauges";
import {
  DataTable,
  Empty,
  Section,
  StatCard,
  StateOf,
  WindowLine,
} from "@/components/ui";
import { RUNS_WINDOW } from "./surfaces";
import { runColumns } from "./run-columns";
import type { ReadOf, RunColumnName, RunCountName, RunTableRow, RunsWindow } from "./rows";

/**
 * The adapter framework's runs — campaign admin-window/DEBT-0004, moved here
 * whole from `src/app/cycles/page.tsx`.
 *
 * The window's cap and the object it was read over are facts of the READ, so
 * they arrive as props from the page: nothing here spells a table name or a
 * row cap of its own (ARCHITECTURE.md §4 rules 1 and 4, admin-window/BUG-0077).
 */

/** The heading of the page's other half, and the eyebrow its state cards carry. */
export const RUNS_LABEL = "Adapter runs";

/** The figure the empty state puts on screen, and the label a parity test reads it under. */
const RUNS_IN_WINDOW = "Runs in this window";

/**
 * The zero an empty window renders, as a LITERAL.
 *
 * A window read returns at most its cap, so a window that came back with no
 * rows had no matching rows at all — the zero is exact, and it is the one
 * number this half may state (DECISIONS 2026-09-02, "a counted zero is a real
 * figure"; LOOK_AND_FEEL bar 1, the count is on screen whether or not the
 * table has rows). It is written here rather than taken from `rows.length`
 * because a window's length is not a total and no figure on this page is
 * allowed to come from one (ARCHITECTURE.md §4.3).
 */
const NO_RUNS = 0;

/** What an empty runs table holds, and the one thing that fills it. */
const NO_RUNS_RECORDED: EmptyWords = {
  holds: "runs recorded",
  filledBy:
    "An adapter files a row the moment it wakes, before it has fetched anything.",
};

/** The same, for a window narrowed to a source name that matched nothing. */
function noRunsFrom(source: string): EmptyWords {
  return {
    holds: `runs from ${source}`,
    filledBy:
      "The name is matched against the run's own source text, which is not a registered source's key — a source that has never run has no run here, and a name nothing was ever filed under matches nothing.",
  };
}

/**
 * The one sentence `?source=<name>` earns, beside the half it narrows.
 *
 * The Sources page links here by source name and the facet is REAL now: the
 * runs read below carries it, matched by name (admin-window/TASK-0016). The
 * sentence exists because the narrowing is half a page wide — the resolver's
 * cycles above carry no source column at all, so they are the same cycles with
 * the facet or without it, and an operator who cannot see why must not be left
 * to guess that the page ignored their URL.
 *
 * The name is rendered VERBATIM, as text: what was asked for is what is shown,
 * and nothing the URL carries reaches the document as markup.
 */
function AskedSource({ source }: { source: string }) {
  return (
    <p
      data-source-facet={source}
      data-source-facet-half="runs"
      className="type-body text-ink-secondary"
    >
      Narrowed to the runs whose source is{" "}
      <span className="type-data text-ink">{source}</span>, matched by name.
      This facet narrows the runs below and nothing else: the resolver&rsquo;s
      cycles carry no source, so they are the same cycles with it or without it.
    </p>
  );
}

/**
 * The adapter framework's runs — the page's other half.
 *
 * Four states, none of which shares a rendering with another (LOOK_AND_FEEL,
 * Emptiness), and the kind is on the wrapper as `data-state` so a live test
 * reads WHICH state the page is in before it compares a number: an `error` is
 * always a failure, an `empty` is a pass with a real zero, and neither is
 * inferred from "no rows rendered" (ARCHITECTURE.md §10, common violation 6).
 */
export function AdapterRuns({
  runs,
  now,
  source,
  limit,
  over,
  columns,
  counts,
}: {
  runs: ReadOf<RunsWindow>;
  now: string;
  /** The `?source=` facet as the URL carried it, or undefined for no facet. */
  source: string | undefined;
  /** The cap the query carried (`RUN_WINDOW`). */
  limit: number;
  /** The kind of object the read ran over (`RUNS_OBJECT`). */
  over: "table" | "view";
  /** The nine, in the order the ruling names them (`RUN_COLUMNS`). */
  columns: readonly RunColumnName[];
  /** Which of them are figures (`RUN_COUNTS`). */
  counts: readonly RunCountName[];
}): ReactNode {
  const rows = runs.kind === "ok" ? runs.data.rows : [];
  const kind = runs.kind === "ok" && rows.length === 0 ? "empty" : runs.kind;
  const truncated = runs.kind === "ok" && runs.data.truncated;
  const words = source === undefined ? NO_RUNS_RECORDED : noRunsFrom(source);

  return (
    <Section title={RUNS_LABEL}>
      {/* The window line describes a window this page actually read. A refused
          or absent read returned none, so it would be describing a table that
          is not there (LOOK_AND_FEEL states 3 and 4); an EMPTY window is still
          a window — the page looked, and nothing was there. */}
      {runs.kind === "ok" ? (
        <WindowLine
          gauge={RUNS_WINDOW}
          window={{
            limit,
            held: rows.length,
            truncated,
            over,
          }}
          shows={{
            of: "newest",
            lede: "The adapters’ newest runs, newest first",
            rows: "runs",
          }}
        />
      ) : null}
      {/* The facet sentence answers the URL, so it renders whatever the read
          did: an operator who followed a link deserves to know which half it
          addressed even when that half could not be read. */}
      {source === undefined ? null : <AskedSource source={source} />}
      <div data-surface="runs" data-state={kind} className="flex flex-col gap-2">
        {runs.kind === "not_provisioned" ? (
          // A card replaces the surface; nothing above it describes a table
          // that is not there (LOOK_AND_FEEL state 3).
          <StateOf result={runs} />
        ) : kind === "empty" ? (
          <>
            <StatCard
              label={RUNS_IN_WINDOW}
              value={NO_RUNS}
              sub={
                source === undefined
                  ? "nothing has run yet"
                  : "no run in this window carries that source name"
              }
            />
            <div data-empty="runs">
              <Empty holds={words.holds} filledBy={words.filledBy} />
            </div>
          </>
        ) : (
          <DataTable<RunTableRow>
            label={RUNS_LABEL}
            columns={runColumns({ now, role: "window", columns, counts })}
            rows={rows}
            // The primary key is the row key and the order's tiebreak. It is
            // not a tenth column and is never rendered as one.
            rowKey={(row) => row.run_id}
            placeholder={runs.kind === "error" ? <StateOf result={runs} /> : undefined}
          />
        )}
      </div>
      {/* What the columns mean — for a table that is on screen. With no window
          read there is nothing for it to explain. */}
      {runs.kind === "ok" ? (
        <p className="type-body text-ink-secondary">
          A run with no end is still going: the row is written when the adapter
          wakes and nothing rewrites it, so no completion is guessed.{" "}
          <span className="type-data text-ink">failure_class</span>{" "}
          says whose problem a failure is, and{" "}
          <span className="type-data text-ink">source</span>{" "}
          is the run&rsquo;s own text — a run filed under a name the registry
          does not carry still appears here.
        </p>
      ) : null}
    </Section>
  );
}
