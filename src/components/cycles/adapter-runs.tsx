import type { ReactNode } from "react";
import type { EmptyWords } from "@/components/gauges";
import {
  DataTable,
  Empty,
  Section,
  StatCard,
  StateOf,
  WindowLine,
  oldestIn,
} from "@/components/ui";
import { count } from "@/lib/format";
import { IN_PAGE_LINK, runAnchorFor } from "./links";
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
 * How the runs window's sentence names a narrowed read: the phrase that reads
 * straight after the row noun, so every clause of the line is about `runs from
 * bandsintown` rather than about `runs` (admin-window/BUG-0114).
 *
 * The name comes from the READ (`RunWindow.source`, `lib/db/runs.ts`) and never
 * from the `source` prop beside it: the prop is what the URL asked for, the
 * window carries what actually reached the database, and a line that describes
 * the read must be built from the second.
 */
function runsScope(source: string | null): string | null {
  return source === null ? null : `from ${source}`;
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
 * What this page knows about the run a `?run=<run_id>` link asked for — three
 * states, the same three `AskedCycle` has, for the same reason
 * (admin-window/BUG-0023: a read that returned no window is not evidence of
 * absence).
 *
 * Decided HERE rather than in the page, because this half already holds the
 * read that answers it: the window's rows, the cap they came under, and the
 * source the query was narrowed to are one fact of one read, and a second
 * derivation in the page could disagree with the table beneath the sentence
 * (LESSONS 11).
 */
type AskedRunState =
  | { kind: "found" }
  | { kind: "absent" }
  /** No window was read at all; `reading` is the object whose read said so. */
  | { kind: "unchecked"; reading: string };

function askedRunState(runs: ReadOf<RunsWindow>, run: string): AskedRunState {
  if (runs.kind === "not_provisioned") return { kind: "unchecked", reading: runs.missing };
  if (runs.kind === "error") return { kind: "unchecked", reading: runs.reading };
  return runs.data.rows.some((row) => row.run_id === run)
    ? { kind: "found" }
    : { kind: "absent" };
}

/**
 * The one sentence `?run=<run_id>` earns — the Dashboard's run lines land here
 * (campaign admin-window/BUG-0142).
 *
 * Until this landed the parameter was consumed in silence: the run an operator
 * had just clicked was named nowhere on the page it arrived at, no row was
 * marked, and with a window of up to 200 runs there was nothing to scan for
 * (walked 2026-09-09). The page's own `?cycle=` had answered the identical
 * question since admin-window/BUG-0054, so this is that answer applied to the
 * other half, not a new device.
 *
 * **The absent sentence claims only the scope its read had** (LESSONS 2). Under
 * `?source=<name>` the window below holds one source's runs, so a run that is
 * not in it may still be a run of another source that this page renders
 * without the facet — and the line says the third possibility out loud rather
 * than telling the operator the id belongs to no run at all. The scope comes
 * from the READ (`RunsWindow.source`), never from the `?source=` the URL
 * carried, for the reason `runsScope` above gives.
 */
function AskedRun({
  run,
  state,
  limit,
  scope,
}: {
  /** The id the URL asked for, in the database's own spelling. */
  run: string;
  state: AskedRunState;
  /** The window's row cap — what "not among the N newest runs" counts. */
  limit: number;
  /** What the read was narrowed to, as a phrase, or null for the whole table. */
  scope: string | null;
}) {
  if (state.kind === "unchecked") {
    return (
      <p
        data-run-asked={run}
        data-run-unchecked={state.reading}
        className="type-body text-ink-secondary"
      >
        Whether run{" "}
        <span className="type-data text-ink">{run}</span>{" "}
        is in this window is not something this page can say: the read of{" "}
        <span className="type-data text-ink">{state.reading}</span>{" "}
        returned no window to look in. What is below says why.
      </p>
    );
  }
  if (state.kind === "found") {
    return (
      <p
        data-run-asked={run}
        data-run-found="true"
        className="type-body text-ink-secondary"
      >
        Run{" "}
        <a href={`#${runAnchorFor(run)}`} className={`type-data ${IN_PAGE_LINK}`}>
          {run}
        </a>{" "}
        is marked in the table below.
      </p>
    );
  }
  return (
    <p
      data-run-asked={run}
      data-run-found="false"
      className="type-body text-ink-secondary"
    >
      Run{" "}
      <span className="type-data text-ink">{run}</span>{" "}
      is not among the {count(limit)} newest runs{scope === null ? "" : ` ${scope}`}, so
      it is not in this window — it ran earlier
      {scope === null ? "" : ", it was filed under another source"}, or no run
      carries that id.
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
  run,
  limit,
  over,
  columns,
  counts,
}: {
  runs: ReadOf<RunsWindow>;
  now: string;
  /** The `?source=` facet as the URL carried it, or undefined for no facet. */
  source: string | undefined;
  /**
   * The `?run=<run_id>` the URL asked for, in the database's own spelling, or
   * undefined for no facet and for a value that is not a run id at all — which
   * marks nothing here and is named by the page's dropped-parameter line
   * instead (campaign admin-window/BUG-0142).
   */
  run: string | undefined;
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
  // One derivation of the asked-for run, read by the sentence AND by the row
  // predicate below, so the row that is drawn as marked is the row the
  // sentence names.
  const asked = run === undefined ? undefined : askedRunState(runs, run);

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
            // The read is newest-first, so the LAST row is the oldest run it
            // came back with. On a window that did not fill, that row is the
            // object's own floor rather than the window's, and the line says
            // so — five runs against a cap of 200 are every run recorded, not
            // the top of a long list (admin-window/BUG-0109).
            oldest: oldestIn(rows, (row) => row.started_at),
            // What the read was narrowed to, taken from the read itself. A
            // `?source=` window holds every run of ONE source, so the floor it
            // names is that source's and never the table's — the table
            // retains older runs from other sources and this same page
            // renders them without the facet (admin-window/BUG-0114).
            scope: runsScope(runs.data.source),
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
      {/* The run sentence answers the URL the same way, and for the same
          reason: an operator who clicked a run line on the Dashboard is told
          which run they are looking at even when the window could not be
          read. */}
      {run === undefined || asked === undefined ? null : (
        <AskedRun
          run={run}
          state={asked}
          limit={limit}
          // From the READ, never from the `?source=` prop beside it: the line
          // describes the window that was actually asked for.
          scope={runsScope(runs.kind === "ok" ? runs.data.source : null)}
        />
      )}
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
            columns={runColumns({ now, role: "window", columns, counts, asked: run })}
            rows={rows}
            // The primary key is the row key and the order's tiebreak. It is
            // not a tenth column and is never rendered as one.
            rowKey={(row) => row.run_id}
            // What "is marked in the table below" means on screen. The
            // predicate is the one the sentence was decided from, so a mark is
            // drawn exactly when the line above claims one (LOOK_AND_FEEL bar
            // 13: no screen claims a mark it did not draw).
            marked={run === undefined ? undefined : (row) => row.run_id === run}
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
