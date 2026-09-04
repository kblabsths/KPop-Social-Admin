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
 * **`over` is the word the sentence ends on, and it names what the window was
 * read over.** The three copies said "not the whole table" twice and "not the
 * whole view" once, which reads as one sentence and is two; the split is
 * settled by the object rather than by whichever copy won — a window over a
 * view says view, a window over a table says table (admin-window/DEBT-0003).
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
  over,
}: {
  /** Which gauge's window this is, for the live suite to read it back. */
  gauge: string;
  window: ReadWindow;
  /** What the window is over, in the app's voice: "Cycles started", … */
  measured: string;
  /** The kind of object the window was read over. */
  over: "table" | "view";
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
      — a window of at most {count(info.limit)} rows, not the whole {over}.
      {info.truncated
        ? " The window filled its cap, so every count here is a floor."
        : ""}
    </p>
  );
}
