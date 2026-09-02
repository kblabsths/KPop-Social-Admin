import type { ReactNode } from "react";
import { type Column, DataTable } from "@/components/ui";
import { count } from "@/lib/format";
import type { Spread } from "@/lib/gauges/gauge";
import {
  GaugeStateCard,
  GaugeStateLine,
  stateReplacesSurface,
  type GaugeState,
} from "./state";

/**
 * The distribution view — an age or percentile spread as rows of label +
 * `data` value, each with a bar (campaign admin-window/TASK-0008).
 *
 * **"Chart" here is the data-table rule plus a CSS bar built from tokens.**
 * No charting dependency is added — none is allowed (the ticket's checks pin
 * the absence in `package.json`, and any dependency at all is a toolsmith DEP
 * ticket against ALLOWED_DEPS). The bar is two nested spans on the palette's
 * neutral fills: it carries no colour, because colour is reserved for state
 * and a distribution is not a state (LOOK_AND_FEEL, Palette).
 *
 * The bar is decoration for the number beside it and is `aria-hidden`; the
 * value is always present as text, so a row is readable with no bar at all —
 * which is what a row whose value is unmeasurable renders.
 */
export interface DistributionRow {
  /** React key for the row. */
  key: string;
  /** What this row is: a percentile, a bucket, an age band. */
  label: ReactNode;
  /** The figure, or `null` when it is not measurable — never a zero. */
  value: number | null;
  /** One short extra `data` cell, shown only when `detail` is labelled. */
  detail?: ReactNode;
}

/**
 * A `lib/gauges` `Spread` as distribution rows, in ascending percentile order.
 *
 * One definition, because five of the six gauges report a `Spread` and five
 * hand-written percentile row lists would disagree about the order or drop the
 * ones that came back `null`. A percentile the aggregate could not compute
 * stays in the list with a `null` value: the row is the question, and "we
 * could not measure it" is an answer the operator needs to see.
 */
export function spreadRows(spread: Spread): DistributionRow[] {
  return [
    { key: "min", label: "min", value: spread.min },
    { key: "p50", label: "p50", value: spread.p50 },
    { key: "p90", label: "p90", value: spread.p90 },
    { key: "p95", label: "p95", value: spread.p95 },
    { key: "p99", label: "p99", value: spread.p99 },
    { key: "max", label: "max", value: spread.max },
  ];
}

/** The largest finite, positive value in the rows — the bar scale. */
function scaleOf(rows: DistributionRow[]): number | null {
  let largest = 0;
  for (const row of rows) {
    if (row.value !== null && Number.isFinite(row.value) && row.value > largest) {
      largest = row.value;
    }
  }
  return largest > 0 ? largest : null;
}

/**
 * The bar. Width is the row's share of the scale — data, so it is an inline
 * width and not a token; the fills, the height and the spacing are tokens.
 *
 * A negative value (two clocks disagreed — `secondsBetween` surfaces it rather
 * than clamping) draws no bar rather than a backwards one; the number beside
 * it still reads negative.
 */
function Bar({ share }: { share: number }) {
  return (
    <span className="block h-1 w-full bg-chrome" aria-hidden="true">
      <span
        className="block h-1 bg-chrome-inverse"
        style={{ width: `${(share * 100).toFixed(1)}%` }}
      />
    </span>
  );
}

export function Distribution({
  label,
  dimension,
  measure,
  rows,
  format = count,
  max,
  detailLabel,
  state,
}: {
  /** Accessible name for the table — what is distributed. */
  label: string;
  /** The `micro` header of the label column: "percentile", "bucket", "age". */
  dimension: string;
  /** The `micro` header of the value column. State the unit here, once. */
  measure: string;
  rows: DistributionRow[];
  /**
   * How a figure reads. Defaults to a thousand-separated count; an age or
   * latency spread passes `duration` from `lib/format`.
   */
  format?: (value: number) => string;
  /**
   * The value a full bar stands for. Defaults to the largest value present,
   * so a lone distribution is self-scaling; pass it explicitly to make two
   * distributions comparable side by side.
   */
  max?: number;
  /** Header for the optional detail column. The column exists only with it. */
  detailLabel?: string;
  /** Set while the surface is loading, empty, unprovisioned or broken. */
  state?: GaugeState;
}) {
  if (state !== undefined && stateReplacesSurface(state)) {
    return <GaugeStateCard state={state} />;
  }

  const scale = max !== undefined && max > 0 ? max : scaleOf(rows);

  const columns: Column<DistributionRow>[] = [
    { key: "label", label: dimension, cell: (row) => row.label },
    {
      key: "value",
      label: measure,
      align: "right",
      // `null` goes to the cell as `null` so the table's own `orDash` renders
      // the absence — one dash, defined once (`lib/format.ts`).
      cell: (row) => (row.value === null ? null : format(row.value)),
    },
    ...(detailLabel === undefined
      ? []
      : [
          {
            key: "detail",
            label: detailLabel,
            align: "right" as const,
            cell: (row: DistributionRow) => row.detail ?? null,
          },
        ]),
    {
      key: "bar",
      // No header word: the bar is the value column drawn, and a second
      // heading for the same figure would be read out twice.
      label: "",
      cell: (row) => {
        if (scale === null || row.value === null || !(row.value > 0)) return null;
        return <Bar share={Math.min(1, row.value / scale)} />;
      },
    },
  ];

  return (
    <DataTable<DistributionRow>
      columns={columns}
      rows={state === undefined ? rows : []}
      rowKey={(row) => row.key}
      label={label}
      placeholder={state === undefined ? undefined : <GaugeStateLine state={state} />}
    />
  );
}
