/**
 * `/cycles`' presentation — campaign admin-window/DEBT-0004.
 *
 * The Cycles & runs page's own sections, moved out of `src/app/cycles/page.tsx`
 * so that this page's presentation lives beside every other page's
 * (ARCHITECTURE.md §13.6; the page was 1,291 lines with eight components
 * defined where the page function is). Nothing here reads, awaits or fetches:
 * each export is a pure synchronous component or a pure column builder taking
 * plain props, which is the division §5 draws — the page reads and shapes, the
 * components render.
 */
export { AdapterRuns, RUNS_LABEL } from "./adapter-runs";
export { AskedCycle, type AskedCycleState } from "./asked-cycle";
export { CycleHealthSection } from "./cycle-health";
export { NOTHING_RECORDED, cycleColumns } from "./cycle-table";
export { LatestRun } from "./latest-run";
export { LatencySection } from "./latency";
export { IN_PAGE_LINK, RUNS_ANCHOR, anchorFor } from "./links";
export { OUTCOME_TONE, stateCell } from "./outcome";
export {
  type CycleCounterName,
  type CycleTableRow,
  type ReadOf,
  type RunColumnName,
  type RunCountName,
  type RunTableRow,
  type RunsWindow,
} from "./rows";
export { type RunRole, runColumns } from "./run-columns";
export {
  CYCLES_SURFACE,
  CYCLES_WINDOW,
  HEALTH_SURFACE,
  LATENCY_SURFACE,
  LATEST_RUN_SURFACE,
  RUNS_WINDOW,
} from "./surfaces";
