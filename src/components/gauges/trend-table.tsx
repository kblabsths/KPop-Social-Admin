import type { ReactNode } from "react";
import {
  type Column,
  DataTable,
  type MicroLabel,
  microLabelText,
} from "@/components/ui";
import { count } from "@/lib/format";
import {
  GaugeStateCard,
  GaugeStateLine,
  stateReplacesSurface,
  type EmptyWords,
  type GaugeState,
} from "./state";

/**
 * The trend table — a per-period or per-source series, rendered by the
 * data-table rule and nothing else (campaign admin-window/TASK-0008).
 *
 * There is no bespoke layout here and no charting dependency: `ui/DataTable`
 * draws it, so a trend inherits the header row, the hairlines, the hover fill,
 * the mono cells and the em dash for a null without restating any of them
 * (LOOK_AND_FEEL, Data table). What this adds is the series shape the
 * `lib/gauges` aggregates return — a row per period (`QueueWeek`,
 * `RejectionWeek`, `AwaitingRowPoint`) or per source/domain, and a numeric
 * measure per column.
 *
 * **A measure that is `null` is a dash, never a zero.** `QueueWeek.settled` is
 * `null` for every week today — the settle timestamp does not exist until
 * `verdicts` lands — and a column of zeros there would read as "nothing
 * settled" instead of "not knowable", which tunes the escalation cutoffs the
 * wrong way (spec §5; `lib/gauges/queue-health.ts`).
 */
export interface TrendMeasure<Row> {
  /** React key for the column. */
  key: string;
  /** The `micro` header label. State the unit here, once, not in every cell. */
  label: string;
  /** The figure for this row, or `null` when it is not measurable. */
  value: (row: Row) => number | null;
  /**
   * How the figure reads. Defaults to a thousand-separated count; a series of
   * seconds passes `duration` from `lib/format`.
   */
  format?: (value: number) => string;
}

export function TrendTable<Row>({
  label,
  period,
  rows,
  rowKey,
  rowLabel,
  measures,
  empty,
  state,
}: {
  /**
   * Accessible name for the table — what the series is of — and the eyebrow of
   * the card that replaces it in a surface state. A machine identifier travels
   * as `{ identifier, words }`; `microLabelText` flattens it for `aria-label`,
   * which takes a string and not markup (admin-window/BUG-0049).
   */
  label: MicroLabel;
  /** The `micro` header of the first column: "week", "day", "source", "domain". */
  period: string;
  rows: Row[];
  rowKey: (row: Row) => string;
  /** The period or source this row is: the machine's own value, in `data` mono. */
  rowLabel: (row: Row) => ReactNode;
  measures: TrendMeasure<Row>[];
  /**
   * The words for the empty series: what this table would hold, and the one
   * thing that fills it. **Required** — the component owns WHEN the empty
   * state shows (no rows, no other state), the caller owns THE WORDS. Neither
   * half can be moved: the component cannot invent "no cycles have run in this
   * window", and a caller whose fixtures always have rows will not remember a
   * case it never sees. So `rows: []` with no state is unwritable, and the one
   * rendering that says nothing at all — a header row over an empty body —
   * cannot be reached (ARCHITECTURE §7, admin-window/TASK-0030).
   */
  empty: EmptyWords;
  /** Set while the surface is loading, empty, unprovisioned or broken. */
  state?: GaugeState;
}) {
  if (state !== undefined) {
    if (stateReplacesSurface(state)) {
      return <GaugeStateCard state={state} label={label} />;
    }
  } else if (rows.length === 0) {
    // No rows and no stated reason: the surface card replaces the table by the
    // same `stateReplacesSurface` rule an explicit empty state obeys, rendered
    // through the same component so the two are one rendering. An explicit
    // `state` wins — a page that knows WHY it is empty (a filter matched
    // nothing) says so in its own words.
    return (
      <GaugeStateCard
        state={{ kind: "empty", holds: empty.holds, filledBy: empty.filledBy }}
        label={label}
      />
    );
  }

  const columns: Column<Row>[] = [
    { key: "__period", label: period, cell: rowLabel },
    ...measures.map((measure) => ({
      key: measure.key,
      label: measure.label,
      align: "right" as const,
      cell: (row: Row) => {
        const value = measure.value(row);
        // `null` is handed to the cell as `null` on purpose: the table's own
        // `orDash` decides what an absence looks like, so every dash in the
        // app is the same dash (`lib/format.ts`, admin-window/BUG-0004).
        return value === null ? null : (measure.format ?? count)(value);
      },
    })),
  ];

  return (
    <DataTable<Row>
      columns={columns}
      // A state means the series is not the series: rendering the rows we
      // happen to hold under a "loading" or an error line would present stale
      // or partial data as the answer.
      rows={state === undefined ? rows : []}
      rowKey={rowKey}
      label={microLabelText(label)}
      placeholder={state === undefined ? undefined : <GaugeStateLine state={state} />}
    />
  );
}
