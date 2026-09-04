import type { ReactNode } from "react";

import { absoluteUtc, count } from "@/lib/format";

/**
 * What kind of database object a window ran over — the word a sentence that
 * names it ends on ("…not the whole table.").
 *
 * Declared here for the reason `state-of.tsx` declares its own union: a
 * component imports nothing that can reach a database, and `lib/db` is not a
 * leaf (ARCHITECTURE.md §4). `lib/db/tables.ts`'s `ObjectKind` satisfies it
 * structurally.
 */
export type WindowObject = "table" | "view";

/**
 * The facts EVERY window has, whatever read produced it — the hook set this
 * file publishes, decided once (admin-window/DEBT-0006).
 *
 * The app had two window-line dialects: the gauge lines published
 * `since`/`until`/`truncated` and the hand-rolled list lines published
 * `limit`/`held`/`truncated` or nothing at all, so an oracle could not ask one
 * question of all of them. Reconciled here rather than at whichever call site
 * was folded last:
 *
 *  - `limit`, `held` and `truncated` are facts of every window — every read
 *    carried a cap, came back with some number of rows, and either filled the
 *    cap or did not — so **every** window line publishes all three.
 *  - `since`/`until` are facts of a window that is bounded in TIME, and only a
 *    scan is. Their absence is itself the statement "this window has no time
 *    bound"; it is decided by the window object, never by a call site.
 */
interface WindowFacts {
  /** The row cap the query carried. */
  limit: number;
  /** How many rows the read came back with. */
  held: number;
  /** The window did not hold everything it could have, so it is a floor. */
  truncated: boolean;
  /** The object the read ran over. */
  over: WindowObject;
}

/**
 * The window a gauge's SCAN covered, as a component sees it — the fields of
 * `WindowInfo` (`lib/gauges/gauge.ts`), which satisfies this structurally.
 *
 * A scan is bounded in time as well as in rows, which is what separates it
 * from a drawn list's window below.
 */
export interface ReadWindow extends WindowFacts {
  /** Inclusive lower bound the query used. */
  since: string;
  /** The instant the window was measured back from. */
  until: string;
}

/**
 * The window a bounded LIST drew from: a row cap and no time bound.
 *
 * `/cycles`'s two tables, `/claims`'s list and `/browse`'s events are all this
 * kind of read — the newest (or longest-waiting) N rows, stated as a window so
 * the last row on screen is never mistaken for the last row that exists.
 */
export interface DrawnWindow extends WindowFacts {
  since?: undefined;
  until?: undefined;
}

/**
 * What a DRAWN window's line says — one arm per shape of list the app draws,
 * spelled here so that four hand-rolled paragraphs in four page files become
 * four sentences a reader can see side by side (admin-window/DEBT-0006).
 *
 * The arm names the READ, not the page: `newest` is "the newest N rows of an
 * object, newest first", `matched` is "the first N of a complete matching set,
 * longest-waiting first", `catalog` is "the N newest arrivals in a catalog".
 * Only the page's own words about its own subject (`lede`, `rows`) come from
 * the call site — every fact of the read comes from the window, which is the
 * line admin-window/BUG-0077 drew and this file keeps.
 */
export type DrawnSentence =
  /** `/cycles`'s cycles and runs tables. */
  | { of: "newest"; lede: string; rows: string }
  /** `/claims`'s list: a complete read, drawn a window at a time. */
  | { of: "matched"; lede: string; rows: string }
  /** `/browse`'s recent events. */
  | { of: "catalog"; rows: string };

/**
 * The one paragraph, and the one hook set, every window line in this app is.
 *
 * React omits an attribute whose value is `undefined`, so a drawn window —
 * which has no `since` — publishes no `data-window-since`, and the hook set a
 * surface publishes is a property of the read rather than of the page.
 */
function WindowParagraph({
  gauge,
  window: info,
  children,
}: {
  gauge: string;
  window: ReadWindow | DrawnWindow;
  children: ReactNode;
}) {
  return (
    <p
      data-window={gauge}
      data-window-since={info.since}
      data-window-until={info.until}
      data-window-limit={String(info.limit)}
      data-window-held={String(info.held)}
      data-window-truncated={info.truncated ? "true" : "false"}
      className="type-body text-ink-secondary"
    >
      {children}
    </p>
  );
}

/**
 * The window line a surface carries — which window, and whether it filled
 * (ARCHITECTURE.md §4.3, read kind 2: "the caller's own `.order()` +
 * `.limit()` define a NAMED window and the surface says which window it is
 * showing").
 *
 * ONE definition, for every page (admin-window/DEBT-0003, admin-window/DEBT-0006).
 * The sentence stood three times when DEBT-0003 folded it and six more times
 * outside that fold — including `/queues`'s, which stated a window in prose and
 * published no `data-window*` hook at all, so the rule below was unenforceable
 * on exactly one surface.
 *
 * **The word the sentence ends on names what the window was read over, and it
 * is not a prop.** Copies said "not the whole table" twice and "not the whole
 * view" once, which reads as one sentence and is two; DEBT-0003 folded them
 * but left the word a REQUIRED `over` prop, so the split was parameterised
 * rather than settled — `/claims` and `/sources` kept describing one and the
 * same `WindowInfo` (the pending-claims window, over `observations`) as "view"
 * and "table" (admin-window/BUG-0077). It now rides on the window itself, so
 * two call sites rendering one window cannot disagree, because neither is
 * asked.
 *
 * **The line follows the READ, not the rows**: a caller renders it on an `ok`
 * result — with rows or with none — and on no other state, so the absence of
 * the line means "this read did not happen" on every surface
 * (ARCHITECTURE.md §4.3; admin-window/BUG-0063, BUG-0067, BUG-0070, graded for
 * every surface at once in `tests/offline/absence/pages.test.ts`).
 *
 * Two call shapes, because the app makes two kinds of windowed read and their
 * sentences are not interchangeable: a SCAN takes `measured` (the app's words
 * for what it counted) and states its time bounds; a DRAWN list takes `shows`,
 * whose arm names the shape of list it is. Neither shape lets a call site
 * spell a fact of the read.
 */
export function WindowLine(
  props: { gauge: string } & (
    | {
        window: ReadWindow;
        /** What the window is over, in the app's voice: "Cycles started", … */
        measured: string;
        shows?: undefined;
      }
    | { window: DrawnWindow; shows: DrawnSentence; measured?: undefined }
  ),
): ReactNode {
  if (props.shows === undefined) {
    const info = props.window;
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        {props.measured} since {absoluteUtc(info.since)}, read to{" "}
        {absoluteUtc(info.until)} — a window of at most {count(info.limit)} rows,
        not the whole {info.over}.
        {info.truncated
          ? " The window filled its cap, so every count here is a floor."
          : ""}
      </WindowParagraph>
    );
  }

  const info = props.window;
  const shows = props.shows;
  if (shows.of === "newest") {
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        {shows.lede} — a window of at most {count(info.limit)}, not a count of
        the {shows.rows} that exist.
        {info.truncated
          ? ` The window filled its cap, so older ${shows.rows} ran than the ones below.`
          : ""}
      </WindowParagraph>
    );
  }
  if (shows.of === "matched") {
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        {shows.lede} A window of at most {count(info.limit)} rows, not the whole{" "}
        {info.over}.
        {info.truncated
          ? ` ${count(info.held)} ${shows.rows} match these filters; the ${count(
              info.limit,
            )} longest-waiting are below — narrow with the filters above to reach the rest.`
          : ""}
      </WindowParagraph>
    );
  }
  return (
    <WindowParagraph gauge={props.gauge} window={info}>
      The {count(info.limit)} newest {shows.rows} by arrival, newest first — a
      window, not the whole catalog.
    </WindowParagraph>
  );
}
