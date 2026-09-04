import { absoluteUtc, count } from "@/lib/format";

/**
 * The window a gauge actually read, as a component sees it — the four fields
 * of `WindowInfo` (`lib/gauges/gauge.ts`).
 *
 * Declared here for the reason `state-of.tsx` declares its own union: a
 * component imports nothing that can reach a database, and `lib/gauges` is not
 * a leaf (ARCHITECTURE.md §4). Every gauge's `window` satisfies it
 * structurally.
 */
export interface ReadWindow {
  /** Inclusive lower bound the query used. */
  since: string;
  /** The instant the window was measured back from. */
  until: string;
  /** The row cap the query carried. */
  limit: number;
  /** The scan came back at its cap, so every count over it is a floor. */
  truncated: boolean;
  /**
   * The kind of database object the scan ran over — the word the sentence
   * ends on. Set by `windowOf` from the `tables.ts` name the query used
   * (admin-window/BUG-0077); a component only renders it.
   */
  over: "table" | "view";
}

/**
 * The window line a gauge section carries — which window, and whether it
 * filled (ARCHITECTURE.md §4.3, read kind 2: "the caller's own `.order()` +
 * `.limit()` define a NAMED window and the surface says which window it is
 * showing").
 *
 * ONE definition, for every page (admin-window/DEBT-0003). It stood three
 * times, and the `/claims` copy had already dropped every `data-window*`
 * attribute the other two carry — so the one window line an oracle could not
 * read structurally was the one on the page whose oracle had already graded a
 * broken state as a pass (common violations 6 and 9).
 *
 * **The word the sentence ends on names what the window was read over, and it
 * is not a prop.** The three copies said "not the whole table" twice and "not
 * the whole view" once, which reads as one sentence and is two; DEBT-0003
 * folded them into this component but left the word a REQUIRED `over` prop, so
 * the split was parameterised rather than settled — `/claims` and `/sources`
 * kept describing one and the same `WindowInfo` (the pending-claims window,
 * over `observations`) as "view" and "table" (admin-window/BUG-0077).
 *
 * It now rides on the window itself (`ReadWindow.over`), established once by
 * `windowOf` from the `T.*` name the scanning query passed to `.from()`. A
 * window over a view says view and a window over a table says table because
 * that is what the read did — and two call sites rendering one window can no
 * longer disagree, because neither of them is asked.
 *
 * The line follows the READ, not the rows: a caller renders it on an `ok`
 * result — with rows or with none — and on no other state, so the absence of
 * the line means "this read did not happen" on every surface
 * (ARCHITECTURE.md §4.3; admin-window/BUG-0063, BUG-0067, BUG-0070, graded for
 * every surface at once in `tests/offline/absence/pages.test.ts`).
 */
export function WindowLine({
  gauge,
  window: info,
  measured,
}: {
  /** Which gauge's window this is, for the live suite to read it back. */
  gauge: string;
  window: ReadWindow;
  /** What the window is over, in the app's voice: "Cycles started", … */
  measured: string;
}) {
  return (
    <p
      data-window={gauge}
      data-window-since={info.since}
      data-window-until={info.until}
      data-window-truncated={info.truncated ? "true" : "false"}
      className="type-body text-ink-secondary"
    >
      {measured} since {absoluteUtc(info.since)}, read to {absoluteUtc(info.until)}{" "}
      — a window of at most {count(info.limit)} rows, not the whole {info.over}.
      {info.truncated
        ? " The window filled its cap, so every count here is a floor."
        : ""}
    </p>
  );
}
