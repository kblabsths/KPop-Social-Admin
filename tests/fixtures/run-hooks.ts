import type { RunColumn } from "@/lib/db/runs";

/**
 * The machine hook that marks each ruled `runs` column's own CELL on
 * `/cycles` — the seam a test uses to say WHICH column it is looking at.
 *
 * It lives here, shared, because two oracles need the same answer: the offline
 * render (`tests/offline/runs/page.test.ts`) and the staging parity oracle
 * (`tests/live/runs.live.test.ts`). Two hand-kept copies of the same nine
 * selectors would drift the moment one file was updated and the other was not.
 *
 * **Why a hook and not a header** (campaign admin-window/BUG-0064). The header
 * row used to spell each column's raw database name, so a test could read the
 * column set straight off it. The headers are the app's own words now — a
 * label is the app speaking (LOOK_AND_FEEL, Type) — while the machine names
 * stayed exactly where they always were, on the cells. So the ruled SET and
 * ORDER (Ben's ruling of 2026-09-02, `RUN_COLUMNS` in `src/lib/db/runs.ts`)
 * are read from here, and what the headers CALL those columns is asserted
 * separately, against the other surface that renders the same columns.
 *
 * A `Record` over `RunColumn`, so a column renamed in the scraper's migration
 * stops COMPILING here — a test that silently stopped covering one of the nine
 * would be worse than the bug it was watching for.
 *
 * `ended_at` has two selectors: a run with an end carries the instant, a run
 * still in flight carries the in-flight hook instead, and both are that one
 * column.
 */
export const RUN_CELL_HOOK: Record<RunColumn, string> = {
  source: "[data-run-source]",
  started_at: "[data-run-started]",
  ended_at: "[data-run-ended], [data-run-inflight]",
  outcome: "[data-run-outcome]",
  error_summary: "[data-run-error]",
  records_parsed: '[data-run-count="records_parsed"]',
  claims_emitted: '[data-run-count="claims_emitted"]',
  records_unlinked: '[data-run-count="records_unlinked"]',
  failure_class: "[data-run-failure-class]",
};

/** Every ruled column, in the order this map declares them. */
const COLUMNS = Object.keys(RUN_CELL_HOOK) as RunColumn[];

/**
 * The columns whose hook EVERY rendered run row carries, whatever the run did.
 *
 * `source` and `started_at` are NOT NULL and the three counts are NOT NULL
 * (migration `20260829000001`), and `ended_at` renders one of its two hooks
 * either way — a run with an end carries the instant, one still in flight says
 * so. The other three (`outcome`, `error_summary`, `failure_class`) are
 * nullable, and a null renders the table's dash and no hook at all, which is
 * the correct rendering and not a missing column.
 *
 * It matters to the LIVE oracle, which grades whatever staging holds: it is
 * what stops "no hook found anywhere" from reading as a pass.
 */
export const ALWAYS_HOOKED: readonly RunColumn[] = [
  "source",
  "started_at",
  "ended_at",
  "records_parsed",
  "claims_emitted",
  "records_unlinked",
];

/**
 * The columns one rendered run row really has, in rendered order, named by the
 * machine hook each cell carries — never by its header.
 *
 * `find` is the caller's cheerio selector runner, so this module needs no
 * cheerio import of its own and both oracles keep their single loaded
 * document.
 *
 * A cell whose value was absent carries no hook and comes back as `null` —
 * that is a real rendering (the table's dash), not a missing column. A cell
 * carrying TWO hooks comes back as a string that is not a column name at all,
 * so the comparison fails loudly and names the cell rather than passing over
 * it.
 */
export function columnsFromHooks(
  cells: readonly unknown[],
  find: (cell: unknown, selector: string) => number,
): (string | null)[] {
  return cells.map((cell) => {
    const found = COLUMNS.filter((column) => find(cell, RUN_CELL_HOOK[column]) > 0);
    if (found.length === 0) return null;
    return found.length === 1 ? found[0] : `<cell with ${found.length} hooks>`;
  });
}
