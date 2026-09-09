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
  /**
   * The instant the OLDEST row in the window carries — the value of the column
   * the read ORDERED by, read off the window's last row — or `null` when the
   * window has no such instant to name.
   *
   * It is what makes bar 13's other half sayable (admin-window/BUG-0109). A
   * window that did NOT fill its cap returned everything its read matched, so
   * the last row on screen is the OBJECT's own floor rather than the window's,
   * and the line says so ("runs recorded since 2026-08-31; nothing earlier is
   * retained") instead of letting five runs that are the whole history read
   * like the top of a long list.
   *
   * `null` is the honest answer in exactly two shapes, and is not a shrug:
   *
   *  - the read returned no rows, so there is no oldest row to name;
   *  - the window's order is not one in TIME, so its bottom row is not its
   *    oldest — `/claims` draws its matches longest-waiting FIRST (its bottom
   *    row is the newest) and the entity picker draws its choices by name.
   *
   * A `null` states the rest of the sentence and no floor. It is never a dash
   * and never a guessed instant.
   */
  oldest: string | null;
  /**
   * What the read was NARROWED to, in the app's words, as a phrase that reads
   * straight after the row noun — `"from bandsintown"`, so `runs` becomes
   * `runs from bandsintown` in every clause of the line — or `null` when the
   * read covered the whole object.
   *
   * A window line states what the READ was (ARCHITECTURE.md §4.3), and a
   * narrowed read is a different population from the object it ran over. It is
   * REQUIRED for the same reason `oldest` is: a defaulted narrowing is a
   * narrowing nobody declared, and every sentence built on it is a confident
   * claim about rows the read never saw. `/cycles?source=<name>` read one
   * source's runs below its cap and the line said "runs recorded since <that
   * source's oldest run>; nothing earlier is retained" — of the whole `runs`
   * table, which retains older runs from every other source and renders them
   * on the same page without the facet (admin-window/BUG-0114).
   *
   * The call site fills it from the SAME narrowing its query carried — the
   * `source` the runs read hands back, the filter the claim list selected on —
   * never from a second reading of the URL, which is how the two come to
   * disagree.
   */
  scope: string | null;
}

/**
 * The instant the oldest row of a window carries — `DrawnWindow.oldest` for
 * every surface whose read is ordered NEWEST FIRST, so its last row is its
 * oldest.
 *
 * One spelling for the six surfaces that need it: `rows[rows.length - 1]` is
 * the kind of expression that is written six times and gets an off-by-one on
 * the seventh, and every one of them would then be a sentence stating a floor
 * that is not the floor. An empty window has no oldest row and answers `null`
 * (admin-window/BUG-0109).
 *
 * The caller passes the accessor because WHICH column the read ordered by is
 * a fact of that read — `started_at` for a run or a cycle, `created_at` for a
 * verdict or an event's arrival — and this file may not guess it. It may
 * answer `null` itself, for the nullable column `/browse` orders on: a row
 * carrying no arrival instant states no floor rather than a made-up one.
 */
export function oldestIn<Row>(
  rows: readonly Row[],
  instant: (row: Row) => string | null,
): string | null {
  const last = rows[rows.length - 1];
  return last === undefined ? null : instant(last);
}

/**
 * The window a DRAWN list read, for the surfaces whose read hands back a bare
 * array and leaves the cap with the caller (`/browse`, the Dashboard's two
 * panels).
 *
 * **Truncation is not a call-site opinion.** A limit read that came back with
 * fewer rows than its cap returned everything it matched; one that came back
 * with exactly its cap may be hiding more. That is the same comparison
 * `windowOf` (`lib/gauges/gauge.ts`) and `readRuns` (`lib/db/runs.ts`) make
 * where their own caps applied, spelled once here so three pages cannot come
 * to disagree about what "filled" means — and so no surface decides which
 * clause to render by counting its own rows (admin-window/BUG-0109).
 */
export function drawnWindow(read: {
  limit: number;
  held: number;
  over: WindowObject;
  oldest: string | null;
  scope: string | null;
}): DrawnWindow {
  return { ...read, truncated: read.held >= read.limit };
}

/**
 * What a DRAWN window's line says — one arm per shape of list the app draws,
 * spelled here so that four hand-rolled paragraphs in four page files become
 * four sentences a reader can see side by side (admin-window/DEBT-0006).
 *
 * The arm names the READ, not the page: `newest` is "the newest N rows of an
 * object, newest first" — whatever the object, so `/cycles`'s cycles and runs
 * and `/queues`'s verdict log all take it — `matched` is "the first N of a
 * complete matching set, longest-waiting first", `catalog` is "the N newest
 * arrivals in a catalog".
 * Only the page's own words about its own subject (`lede`, `rows`) come from
 * the call site — every fact of the read comes from the window, which is the
 * line admin-window/BUG-0077 drew and this file keeps.
 */
export type DrawnSentence =
  /** `/cycles`'s cycles and runs tables, and `/queues`'s verdict log. */
  | {
      of: "newest";
      lede: string;
      rows: string;
      /**
       * Where the REST of this list is, in the page's own words — rendered
       * only when there is a rest, which is to say only on a window that
       * filled its cap.
       *
       * The Dashboard's runs panel is why it rides on the window rather than
       * on the page's optimism: it promised "Open Cycles & runs for the rest"
       * over five runs that ARE every run recorded, and `/cycles` then showed
       * the operator the same five (admin-window/BUG-0109).
       */
      more?: string;
    }
  /** `/claims`'s list: a complete read, drawn a window at a time. */
  | { of: "matched"; lede: string; rows: string }
  /** `/browse`'s recent events. */
  | { of: "catalog"; rows: string }
  /**
   * The entity picker's choices: the first N rows of the referenced table BY
   * NAME (campaign admin-window/TASK-0055).
   *
   * Its own arm because none of the three above states this read: the picker's
   * window is neither newest-first nor a complete matching set nor a catalog
   * arrival order, and its truncation costs rows LATER IN THE ALPHABET rather
   * than older ones. Naming that is the whole job of the line — a picker that
   * showed the first thousand venues and said nothing would read as "these are
   * the venues", which is the total claim §4.3 forbids.
   */
  | { of: "alphabetical"; rows: string };

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
 * The narrowing the `matched` arm's TRUNCATED clause states in its OWN words
 * ("73 claims **match these filters**") — the phrase a call site folds into
 * that same window's `scope` for the very same narrowing.
 *
 * It exists so the clause can subtract exactly this narrowing from the scope
 * and name every OTHER one the read carried: `/claims?tab=standing` is
 * narrowed by the TAB, with an empty chip bar, so the clause stated a count of
 * one bucket over "these filters" and named no bucket at all, while the same
 * window's other two arms said "in the standing_disagreement bucket"
 * (admin-window/BUG-0118).
 *
 * Exported so the one call site that has this narrowing (`/claims`'s
 * `listScope`) spells it ONCE, here: a second spelling is how the two come to
 * disagree, and a scope that no longer matches this string is one the clause
 * would say twice.
 */
export const NARROWED_BY_FILTERS = "matching these filters";

/**
 * How a scope of several narrowings is joined — one spelling, seen by both the
 * composing (`narrowedTo`) and the subtraction (`besides`), so a scope built by
 * a page can always be read back apart by this file.
 */
const NARROWING_JOIN = ", ";

/**
 * The `scope` of a read narrowed by more than one thing — the phrases in the
 * order they read, with the ones that do not apply left out, and `null` when
 * none of them do.
 *
 * A call site composes its scope through here rather than joining its own
 * strings, because the `matched` arm reads one back OUT again
 * (admin-window/BUG-0118); the two halves of that round trip are next to each
 * other on purpose.
 */
export function narrowedTo(
  narrowings: readonly (string | null)[],
): string | null {
  const named = narrowings.filter((phrase): phrase is string => phrase !== null);
  return named.length === 0 ? null : named.join(NARROWING_JOIN);
}

/**
 * The window's narrowing MINUS the one a clause's own words already state —
 * what `population()` should see from inside a clause that names a narrowing
 * itself, so the sentence states it once and states the rest (bar 13's
 * requirement is that the clause name the population, not that it name it
 * twice).
 */
function besides(scope: string | null, stated: string): string | null {
  if (scope === null) return null;
  return narrowedTo(
    scope.split(NARROWING_JOIN).filter((phrase) => phrase !== stated),
  );
}

/**
 * The population a clause is about: the rows the arm names, carrying whatever
 * the read was narrowed to (`DrawnWindow.scope`).
 *
 * EVERY clause that names the rows goes through here, so one line cannot state
 * its cap over the facet and its floor over the object — the split that made
 * `/cycles?source=<name>` say "runs recorded since <one source's oldest>;
 * nothing earlier is retained" of a table that retains older runs from other
 * sources (admin-window/BUG-0114). An unnarrowed window answers the bare noun,
 * so its sentences are the ones the app rendered before a facet existed, to the
 * byte.
 */
function population(rows: string, scope: string | null): string {
  return scope === null ? rows : `${rows} ${scope}`;
}

/**
 * What a DRAWN window says about its own bottom when it did NOT fill its cap —
 * the other half of quality bar 13 (admin-window/BUG-0109).
 *
 * Three of the four arms carried a `truncated === true` clause and none of them
 * carried its complement, so a window that filled and one that did not read
 * IDENTICALLY: `/cycles` showed five adapter runs against a cap of 200 — every
 * run the framework has ever recorded — under a sentence that said only "a
 * window of at most 200", and a three-day history read like the top of a long
 * one. The complement is not decoration: a read that came back under its cap
 * returned everything it matched, so the last row on screen IS the object's own
 * floor, and that is a fact only the app can state.
 *
 * **Which clause renders is decided by `truncated` and by nothing else.** That
 * flag is established where the cap actually applied — `windowOf`
 * (`lib/gauges/gauge.ts`), `readRuns` (`lib/db/runs.ts`), `drawnWindow` above —
 * never by this file comparing the rows it was handed against a number.
 */
function didNotFill(info: DrawnWindow, rows: string): string {
  const of = population(rows, info.scope);
  // An empty window is still a window (ARCHITECTURE.md §4.3): the read happened
  // and found nothing, which is a different claim from "everything is below".
  // What it found nothing OF is the narrowed population, never the object: a
  // `?source=` read that matched no row found no runs FROM THAT SOURCE, above
  // an empty card that says the same (admin-window/BUG-0114).
  if (info.held === 0) {
    return ` The window did not fill: the read happened and found no ${of} at all.`;
  }
  // "nothing earlier is retained" is a claim about everything the read could
  // have seen, so it is only ever made about the population the read covered.
  // Unnarrowed, that is the object and the sentence is the one bar 13 wrote;
  // narrowed, the same words carry the facet — nothing earlier FROM THAT
  // SOURCE is retained, which is true, where the bare sentence was not
  // (admin-window/BUG-0114).
  const earlier =
    info.scope === null ? "nothing earlier" : `nothing earlier ${info.scope}`;
  const floor =
    info.oldest === null
      ? ""
      : `: ${of} recorded since ${absoluteUtc(info.oldest)}; ${earlier} is retained`;
  return ` The window did not fill — ${count(info.held)} of at most ${count(
    info.limit,
  )} — so it holds all the ${of} the read found${floor}.`;
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
        the {population(shows.rows, info.scope)} that exist.
        {info.truncated
          ? // Arm-generic, because the arm is: `newest` is "the newest N rows
            // of an object, newest first", and the object may be cycles, runs
            // or verdicts. The clause said "older X ran than the ones below",
            // which is true of a resolver cycle and false of every other
            // newest-first window the arm serves (admin-window/TASK-0058).
            ` The window filled its cap, so ${population(
              shows.rows,
              info.scope,
            )} older than the ones below are not shown.`
          : didNotFill(info, shows.rows)}
        {info.truncated && shows.more !== undefined ? ` ${shows.more}` : ""}
      </WindowParagraph>
    );
  }
  if (shows.of === "matched") {
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        {shows.lede} A window of at most {count(info.limit)} rows, not the whole{" "}
        {info.over}.
        {/* This clause names ONE narrowing in its own words — the filters —
            and takes every other one from the window, like every other clause
            in this file. It used to take none at all, on the reasoning that
            "match these filters" was already the narrowing; that holds only
            when the narrowing IS the chips. `/claims?tab=standing` is narrowed
            by the TAB with an empty chip bar, so a count of one bucket was
            stated over filters nobody had set and the bucket was never named,
            while the two clauses below — on the same window, the same read —
            said "in the standing_disagreement bucket" (admin-window/BUG-0118).
            `besides` subtracts what this sentence already says, so the filters
            are stated once and an unnarrowed (or filter-only) window renders
            the sentence it always did, to the byte. */}
        {info.truncated
          ? ` ${count(info.held)} ${population(
              shows.rows,
              besides(info.scope, NARROWED_BY_FILTERS),
            )} match these filters; the ${count(
              info.limit,
            )} longest-waiting are below — narrow with the filters above to reach the rest.`
          : didNotFill(info, shows.rows)}
      </WindowParagraph>
    );
  }
  if (shows.of === "alphabetical") {
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        The first {count(info.limit)} {population(shows.rows, info.scope)} by
        name — a window, not the whole {info.over}.
        {info.truncated
          ? ` The window filled its cap, so ${population(
              shows.rows,
              info.scope,
            )} later in the alphabet are not in it.`
          : didNotFill(info, shows.rows)}
      </WindowParagraph>
    );
  }
  return (
    <WindowParagraph gauge={props.gauge} window={info}>
      {/* The cap is stated as a cap ("at most"), not as the row count: this
          arm said "The 50 newest events" whatever the read came back with, so
          a catalog holding twelve events was described as fifty
          (admin-window/BUG-0109). Every other arm already spells it this way. */}
      The newest {population(shows.rows, info.scope)} by arrival, newest first —
      a window of at most {count(info.limit)}, not the whole catalog.
      {info.truncated
        ? ` The window filled its cap, so ${population(
            shows.rows,
            info.scope,
          )} that arrived before the ones below are not shown.`
        : didNotFill(info, shows.rows)}
    </WindowParagraph>
  );
}
