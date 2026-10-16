/**
 * The names `/cycles`' surfaces and windows answer to — campaign
 * admin-window/DEBT-0004, moved here whole from the page file with the ticket
 * ids and the reasoning intact.
 */

/**
 * The name each of /cycles' surfaces answers to — `data-surface`, rendered
 * by `Section` and read by the live parity oracle
 * (`tests/live/cycles.live.test.ts`).
 *
 * A NAME, never a position. The oracle used to address these surfaces as
 * `section:nth-of-type(n)`, which made it hostage to the page file's element
 * order: admin-window/BUG-0040 added the lead section and wrapped the runs
 * window in a `<div>`, so `section:nth-of-type(1)` matched two surfaces and
 * four live tests threw, while the two gauge selectors kept grading the right
 * surfaces only because +1 section and -1 section happened to cancel
 * (admin-window/BUG-0056). Rearranging this page must not be able to repoint
 * an oracle at the wrong surface, so every surface a test grades carries its
 * own name and none of them is addressed by where it sits.
 *
 * Each has to match exactly one element (`stateOf` refuses otherwise), which
 * is why the runs window keeps its own hand-written `data-surface="runs"`
 * wrapper (`AdapterRuns`) and the `<Section>` around it takes no name: two
 * elements answering to `runs` would break `runs.live.test.ts` the same way.
 */
export const LATEST_RUN_SURFACE = "latest_run";
export const CYCLES_SURFACE = "cycles";
export const HEALTH_SURFACE = "cycle_health";
export const LATENCY_SURFACE = "resolution_latency";

/**
 * The name each of /cycles' two TABLE windows answers to — `data-window`,
 * the hook `tests/offline/absence/pages.test.ts` and the live oracles read a
 * window back by. Unchanged spellings: they were hand-written on the two
 * paragraphs the fold replaced (admin-window/DEBT-0006).
 */
export const CYCLES_WINDOW = "cycles";
export const RUNS_WINDOW = "runs";
