import type { ReactNode } from "react";
import { Badge, type Column } from "@/components/ui";
import { CLAMP_LIMIT, clamped, count, isAbsent, relativeAge } from "@/lib/format";
import { OUTCOME_TONE } from "./outcome";
import type { RunColumnName, RunCountName, RunTableRow } from "./rows";

/**
 * The runs table's nine cells and nine columns — campaign
 * admin-window/DEBT-0004, moved here whole from `src/app/cycles/page.tsx`.
 *
 * The ruled column ORDER and which three of them are counts arrive as PROPS
 * from the page: `RUN_COLUMNS` and `RUN_COUNTS` are the read's own select list
 * and its numeric fields (`lib/db/runs.ts`), and a component reaches no data
 * layer (ARCHITECTURE.md §4 rule 1). `RunColumnName` and `RunCountName` are
 * derived from the row shape, so a tenth column, or a column renamed in the
 * scraper's migration, stops the page compiling at the call rather than
 * rendering an empty one.
 */

/**
 * Which copy of a run row is being rendered: the window's own rows, or the
 * single LEAD row repeated above the cycles table.
 *
 * Only the identity hooks differ — every cell body is the same cell body, from
 * the same `RUN_COLUMNS`, so the lead cannot render a run differently from the
 * row it is a copy of.
 */
export type RunRole = "window" | "lead";
/**
 * One run row's nine cells, keyed by column.
 *
 * A `Record` over `RunColumnName` rather than an array of columns: the
 * compiler requires a body for every one of the ruled nine and refuses a
 * tenth, and the ORDER comes from the `columns` the page hands down
 * (`RUN_COLUMNS`, the read's own select list), so the rendered table cannot
 * drift from that select list or from the ruling.
 *
 * Every cell that can be absent returns the `null` ITSELF rather than a
 * component that renders null — `DataTable` passes each body through `orDash`,
 * and a React element is never absent to it, so a `<Cell />` would leave the
 * cell BLANK instead of drawing the shared em dash (admin-window/TASK-0019).
 */
function runCells(
  now: string,
  role: RunRole,
): Record<RunColumnName, (row: RunTableRow) => ReactNode> {
  const lead = role === "lead";
  return {
    source: (row) => (
      // The run's own source TEXT, verbatim: there is no foreign key here and
      // no `sources` row is resolved to (§6 trap 6). A run against a source the
      // registry has never heard of still renders, under the name it filed.
      // `data-run` is the row's identity for a test to read it back by; the
      // primary key is not a rendered column (Ben's ruling: nine, and this is
      // not one of them).
      //
      // The LEAD copy carries `data-latest-run` instead, and never `data-run`:
      // the window's rows are what `[data-run]` means everywhere that reads
      // this page (`tests/offline/runs/`, `tests/live/runs.live.test.ts`), and
      // a repeated row answering to the same hook would double the window
      // those readers see (campaign admin-window/BUG-0040).
      <span
        data-run={lead ? undefined : row.run_id}
        data-run-source={lead ? undefined : row.source}
        data-latest-run={lead ? row.run_id : undefined}
        data-latest-run-source={lead ? row.source : undefined}
        className="type-data text-ink"
      >
        {row.source}
      </span>
    ),
    started_at: (row) => {
      const age = relativeAge(row.started_at, now);
      return (
        <span data-run-started={row.started_at} title={age.title}>
          {age.text}
        </span>
      );
    },
    ended_at: (row) => {
      // A row with no end is a run still going, and says so — the dash would
      // read as a missing value rather than as the state the null IS
      // (Ben's ruling: "a row with none is still running and reads as such").
      if (row.ended_at === null) {
        return (
          <span data-run-inflight="true" className="type-body text-ink-secondary">
            still running
          </span>
        );
      }
      const age = relativeAge(row.ended_at, now);
      return (
        <span data-run-ended={row.ended_at} title={age.title}>
          {age.text}
        </span>
      );
    },
    outcome: (row) =>
      // The producer's own word, verbatim and never narrowed to the check
      // constraint's spellings — `skipped` included, which is a healthy
      // outcome and carries no colour, not a failure.
      isAbsent(row.outcome) ? null : (
        <span data-run-outcome={row.outcome ?? undefined}>
          <Badge tone={OUTCOME_TONE[row.outcome ?? ""] ?? "neutral"}>{row.outcome}</Badge>
        </span>
      ),
    error_summary: (row) => {
      // Inline and VERBATIM — not trimmed, not summarised, not replaced with a
      // friendlier sentence. Red, because a run that reported one is broken.
      //
      // The LEAD copy is the one cell a role changes, and it changes only its
      // LENGTH (campaign admin-window/DEBT-0005). The lead sits ABOVE the
      // cycles window, so its height is the only height on this page that can
      // push the newest cycle under the fold, and an `error_summary` past
      // roughly 700 characters does exactly that — re-breaking half of
      // LOOK_AND_FEEL bar 1, which the lead exists to satisfy. `CLAMP_LIMIT`
      // bounds it; the window's own copy below is unbounded, because one row
      // among two hundred pushes nothing.
      //
      // Nothing is hidden by that. The clamp is VISIBLE (it ends in the
      // ellipsis), the whole string rides the lead's own `title`, and the
      // window row below still carries it verbatim in its own cell — the two
      // ways LOOK_AND_FEEL requires the full text to stay reachable. Below the
      // bound `clamped` returns the value byte-identical with an empty title,
      // so for every error this database has ever held the lead is still the
      // window's row cell for cell, `title` attribute included.
      if (isAbsent(row.error_summary)) return null;
      const error = clamped(
        row.error_summary,
        lead ? CLAMP_LIMIT : Number.POSITIVE_INFINITY,
      );
      return (
        <span
          data-run-error=""
          title={error.title === "" ? undefined : error.title}
          className="type-data text-broken"
        >
          {error.text}
        </span>
      );
    },
    // The three counts of the ruling, thousand-separated. A zero is a real
    // count and renders as one, never as the absence dash: the number is the
    // database's, and nothing on this path substitutes one it did not give
    // (ARCHITECTURE.md §4.3).
    //
    // Written out rather than spread from `RUN_COUNTS`, so the
    // `Record<RunColumnName, …>` above is CHECKED: a column the ruling names
    // and this map forgets is a compile error, which a spread of computed keys
    // would hide.
    records_parsed: (row) => (
      <span data-run-count="records_parsed">{count(row.records_parsed)}</span>
    ),
    claims_emitted: (row) => (
      <span data-run-count="claims_emitted">{count(row.claims_emitted)}</span>
    ),
    records_unlinked: (row) => (
      <span data-run-count="records_unlinked">{count(row.records_unlinked)}</span>
    ),
    failure_class: (row) =>
      // A machine identifier, rendered verbatim in mono and never prettified
      // (ARCHITECTURE.md §11). It is the column that says whose problem a
      // failure is, so a run that named none shows the dash and not a word of
      // ours.
      isAbsent(row.failure_class) ? null : (
        <span data-run-failure-class={row.failure_class ?? undefined} className="type-data text-ink">
          {row.failure_class}
        </span>
      ),
  };
}

/**
 * What this table calls each of the nine ruled columns — the app's own words
 * (campaign admin-window/BUG-0064).
 *
 * A table header is a LABEL, and a label is the app speaking: `micro` is a
 * SANS eyebrow (LOOK_AND_FEEL, Type), while §11's "verbatim in mono" governs
 * machine identifiers rendered as VALUES. `started_at` uppercased into a sans
 * eyebrow is neither, and it made this page speak two vocabularies: the cycles
 * table a few thousand pixels above headed the very same `error_summary`
 * column ERROR while this one headed it ERROR_SUMMARY.
 *
 * Ben's ruling of 2026-09-02 settled WHICH nine columns this half shows — its
 * one use of "verbatim" qualifies the error VALUE, never a header — so nothing
 * ruled is overturned by naming them. `RUN_COLUMNS` is untouched: it is still
 * the select list, the ruled set and the ruled order, and the union this map
 * is keyed by is derived from the row that select list asks for.
 *
 * The words come from the app, not from this file's imagination. The four
 * columns the Dashboard's runs table already shows are headed with the words
 * it already uses for them (`src/app/page.tsx` — source, started, outcome,
 * error), so `runs.started_at` cannot read STARTED on `/` and STARTED_AT here;
 * `ended_at` takes the tense of its neighbour, and the four the Dashboard does
 * not show are the plain sentence-case reading of the same nouns the page's
 * own prose uses for them.
 *
 * The machine names have not gone anywhere — every cell still carries its own
 * column name on a `data-run-*` hook, which is what the offline and live tests
 * select by. The row's identity is the operator's; the hooks are the
 * machine's.
 *
 * A `Record` over `RunColumnName` rather than a lookup with a fallback: a
 * column renamed in the scraper's migration stops COMPILING, instead of quietly
 * falling back to its raw name in the header — the exact regression this
 * ticket exists to prevent (the same device as `CYCLE_COUNTER_LABELS` above,
 * admin-window/BUG-0044).
 */
const RUN_COLUMN_LABELS: Record<RunColumnName, string> = {
  source: "source",
  started_at: "started",
  ended_at: "ended",
  outcome: "outcome",
  error_summary: "error",
  records_parsed: "records parsed",
  claims_emitted: "claims emitted",
  records_unlinked: "records unlinked",
  failure_class: "failure class",
};

/**
 * The nine columns, in the order the ruling names them.
 *
 * The KEY stays each column's own machine name — it is the react key and what
 * the cells' hooks spell — and the header is what the operator reads
 * (`RUN_COLUMN_LABELS` above).
 */
export function runColumns({
  now,
  role,
  columns,
  counts,
}: {
  now: string;
  role: RunRole;
  /** The nine, in the order the ruling names them (`RUN_COLUMNS`). */
  columns: readonly RunColumnName[];
  /** Which of them are figures, and so right-aligned (`RUN_COUNTS`). */
  counts: readonly RunCountName[];
}): Column<RunTableRow>[] {
  const cells = runCells(now, role);
  const rightAligned: ReadonlySet<string> = new Set(counts);
  return columns.map((column) => ({
    key: column,
    label: RUN_COLUMN_LABELS[column],
    align: rightAligned.has(column) ? ("right" as const) : undefined,
    cell: cells[column],
  }));
}
