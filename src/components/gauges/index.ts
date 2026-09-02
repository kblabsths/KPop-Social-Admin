/**
 * The gauge cards — the presentation half of the six gauges (campaign
 * admin-window/TASK-0008).
 *
 * Three pure synchronous components, each taking the output shape of a
 * `lib/gauges` aggregate as plain props: the figure card, the trend table and
 * the distribution view. They import no data layer, hold no state and await
 * nothing (ARCHITECTURE §5); a page reads, narrows the `DbResult` into a
 * `GaugeState` or the aggregate's fields, and hands them down.
 *
 * There is no charting dependency and none may be added: a "chart" here is the
 * data-table rule plus CSS bars built from tokens (LOOK_AND_FEEL; spec §5).
 */
export { GaugeCard, type GaugeCardProps } from "./gauge-card";
export { Distribution, type DistributionRow, spreadRows } from "./distribution";
export { TrendTable, type TrendMeasure } from "./trend-table";
export {
  GaugeStateCard,
  GaugeStateLine,
  stateReplacesSurface,
  type EmptyWords,
  type GaugeLineState,
  type GaugeState,
  type GaugeSurfaceState,
} from "./state";
