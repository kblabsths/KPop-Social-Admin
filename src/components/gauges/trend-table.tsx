import type { ReactNode } from "react";
import { type Column, DataTable } from "@/components/ui";
import { count } from "@/lib/format";
import {
  GaugeStateCard,
  GaugeStateLine,
  stateReplacesSurface,
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
  state,
}: {
  /** Accessible name for the table — what the series is of. */
  label: string;
  /** The `micro` header of the first column: "week", "day", "source", "domain". */
  period: string;
  rows: Row[];
  rowKey: (row: Row) => string;
  /** The period or source this row is: the machine's own value, in `data` mono. */
  rowLabel: (row: Row) => ReactNode;
  measures: TrendMeasure<Row>[];
  /** Set while the surface is loading, empty, unprovisioned or broken. */
  state?: GaugeState;
}) {
  if (state !== undefined && stateReplacesSurface(state)) {
    return <GaugeStateCard state={state} />;
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
      label={label}
      placeholder={state === undefined ? undefined : <GaugeStateLine state={state} />}
    />
  );
}
