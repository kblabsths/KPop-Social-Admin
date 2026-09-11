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
   *
   * **It is a LIST OF PHRASES, joined once at render** (admin-window/TASK-0072,
   * the M2 close's ruling 4). It used to be the joined string, composed by
   * `narrowedTo` and then SPLIT BACK APART by `besides` and `narrows` in this
   * same file — so a facet value carrying the join string could forge a
   * segment, and a phrase built out of two could be subtracted in half. The
   * round trip is gone: nothing here splits anything, the join happens where
   * the sentence is written, and a value is one phrase whatever is inside it.
   */
  scope: readonly string[] | null;
  /**
   * The rows THIS WINDOW PUT ON SCREEN — the number an operator can count
   * below the line, stated by whoever drew them (admin-window/BUG-0183).
   *
   * It is stated on the FIRST screen too, not only on a continued one: it is a
   * fact of the read that drew the rows, and every clause naming what is below
   * the line names this and nothing else. It used to be absent until a press
   * had grown the window, and the two arms fell back to the CAP — so three
   * unpaged `/claims` screens holding 37, 10 and 49 claims each told the
   * operator that "the 50 longest-waiting are below", publishing the size of a
   * window as a description of a screen.
   *
   * A paged surface's line is rendered inside client-land by `PagedWindowLine`
   * (`src/components/ui/paging.tsx`), which overwrites this with the paging
   * state's own `held` — the first screen plus everything a press appended —
   * so a continued window states what is on screen and not what the first read
   * drew.
   *
   * Absent/`null` says this window states NO rows on screen, and then the two
   * arms that name the rows below name NONE: they invent no number and they
   * never reach for the cap. Neither page can reach that state — both of them
   * state it — and the seven other call sites are the arms that do not read
   * it at all.
   *
   * `truncated` — never a count of the rows beside it — remains the one
   * held-back verdict (LESSONS 11), and on a paged surface it is the paging
   * state's own status. Whether a press may CONTINUE this window is
   * `continues` below, never this field's presence (admin-window/BUG-0183).
   */
  drawn?: number | null;
  /**
   * Can a press CONTINUE this window? Absent means no — the nine unpaged
   * `WindowLine` call sites, unchanged (admin-window/BUG-0183).
   *
   * STATED by the page that composed the window, never inferred from another
   * field's presence or size (ARCHITECTURE.md §4.3 rule 4). It was read off
   * `drawn`'s PRESENCE, which made one field carry two unrelated facts: a
   * surface that honestly stated the rows it had drawn was thereby claiming a
   * press it has no way to make, and `/claims`'s agreeing state would have
   * swapped "The window did not fill — 37 of at most 50" for a held-back
   * sentence.
   *
   * The two pages that choose between the paged line and the plain one
   * (`/claims`, `/browse`) state it from the SAME expression that makes that
   * choice, so ONE page-level fact reaches both components; `PagingProvider`
   * spreads the page's window into the continued one, so it rides through to
   * `PagedWindowLine` untouched.
   */
  continues?: boolean;
  /**
   * What `held` COUNTS — stated by the page that composed these facts, never
   * inferred from the number's size (admin-window/BUG-0174).
   *
   *  "this window"  → `held` is the rows THIS window's reads came back with, so
   *                   a press that appends rows grows it (`/browse`).
   *  "a count read" → `held` came from a SEPARATE count over the matching set;
   *                   a press reads no row into it, so it stands (`/claims`,
   *                   whose live paged-walk oracle grades that hook).
   *
   * Absent → "this window": the nine unpaged lines mean exactly that, no call
   * site of them changes, and nothing about them re-renders.
   *
   * It was a SIZE HEURISTIC in `PagedWindowLine` — `held <= limit ? drawn :
   * held` — which is two meanings of one field guessed apart by asking which
   * number is bigger. It is unreachable-wrong only because `/claims` is drawn
   * pageable only when its count exceeds the cap, and it is a trap for the
   * next surface to inherit these arms. Nothing in the SENTENCE reads it: it
   * decides which number `held` publishes, and `held` is already a fact of
   * every window.
   */
  heldFrom?: "this window" | "a count read";
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
  scope: readonly string[] | null;
  /**
   * Whose number `held` is, where the call site has one to state — carried
   * through untouched, because it is the page's statement and not a fact this
   * function derives (admin-window/BUG-0174).
   */
  heldFrom?: DrawnWindow["heldFrom"];
  /**
   * Whether a press can CONTINUE this window, where the call site has that to
   * state — carried through untouched for the same reason `heldFrom` is: it is
   * the page's statement about its own affordance, not a fact this function
   * derives (admin-window/BUG-0183).
   */
  continues?: DrawnWindow["continues"];
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
  /**
   * `/claims`'s list: a complete read, drawn a window at a time.
   *
   * It carries no way for the call site to word the end of the truncated
   * clause. It briefly did (`reach`, admin-window/BUG-0160): the shared clause
   * pointed at "the filters above", which is a claim about the PAGE's controls
   * that this file cannot check, so the one state where the narrowing in force
   * has no chip row needed its own words. admin-window/BUG-0162 removed the
   * claim instead — the clause now names what is not shown and says nothing
   * about how to reach it, which is true from every call site and in every
   * narrowing, so there is nothing left for a page to override.
   */
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
 * How a filled `matched` window ends: naming what it is NOT showing, and
 * nothing else — spelled once for both of its branches.
 *
 * It used to end by telling the operator to narrow with the filters above —
 * a remedy no state of the page can perform (admin-window/BUG-0162). `/claims`
 * draws a hard `limit 50` window, so narrowing reveals a row past the 50th
 * only where it takes the matching count BELOW 50, and no combination of the
 * controls it renders gets near that: measured on staging 2026-09-10, the
 * narrowest state the two chip rows can reach still held 108 claims against
 * the same 50 rows. A window line states the read (ARCHITECTURE.md §4.3) —
 * the count, the cap, and what is not below — and paging past the cap is a
 * capability this app does not have yet (admin-window/BUG-0138), so the line
 * names its absence by not offering a way around it rather than by inventing
 * one.
 *
 * It names no NUMBER for the rows it held back, deliberately: `held` and
 * `limit` are established by two different reads (`/claims` counts the
 * population and draws the window separately), so their difference is a third
 * figure no read produced, and it goes to zero or negative in exactly the
 * states truncation is interesting in.
 */
const THE_REST_IS_NOT_SHOWN = "the rest are not shown.";

/**
 * Which side of its CAP a window's ROWS landed on — the one clause this file
 * gains (admin-window/BUG-0186), spelled beside the vocabulary it completes.
 *
 * It is `didNotFill`'s opening in the not-reached direction, word for word and
 * figure for figure, and its complement in the other: a window that drew as
 * many rows as its cap allowed may be hiding more, and that is a fact of the
 * ROW read alone — the number of rows it came back with, against the number it
 * was allowed. No second read is consulted here, which is the whole point: the
 * clause it replaces took its verdict from a separate COUNT, so a count that
 * came back smaller than the rows made a window that drew its whole cap say it
 * did not fill.
 *
 * It states no relationship to the count and asserts no rest. What the count
 * read established is stated as the count's own fact, in the clause beside
 * this one.
 */
function rowsAgainstCap(below: number, limit: number): string {
  return below < limit
    ? `The window did not fill — ${count(below)} of at most ${count(limit)}.`
    : `The window reached its cap — ${count(below)} of at most ${count(limit)}.`;
}

/**
 * How a scope of several narrowings is joined into the words the line says —
 * one spelling, used in exactly ONE place (`scopeWords` below), which is the
 * moment the sentence is written.
 *
 * It used to be seen by the composition AND by a subtraction that split the
 * joined string back apart, so the round trip was only as sound as the values
 * that went through it: a facet value carrying `", "` forged a segment nobody
 * composed. A scope is a list now (`DrawnWindow.scope`), so there is nothing
 * to read back apart and this constant is render vocabulary and nothing else
 * (admin-window/TASK-0072).
 */
const NARROWING_JOIN = ", ";

/**
 * The scope as the WORDS a clause says — the one join, at render.
 *
 * Every clause that puts a scope into a sentence comes through here, so the
 * app has one spelling of "several narrowings, read as one phrase" and no
 * clause can invent a second separator.
 */
function scopeWords(scope: readonly string[] | null): string | null {
  return scope === null ? null : scope.join(NARROWING_JOIN);
}

/**
 * The `scope` of a read narrowed by more than one thing — the phrases in the
 * order they read, with the ones that do not apply left out, and `null` when
 * none of them do.
 *
 * A call site composes its scope through here rather than assembling its own
 * list, because the `matched` arm asks this same scope which narrowings it
 * carries (`narrows`) and subtracts one of them (`besides`); the phrases stay
 * phrases the whole way, and nothing in this file takes one apart
 * (admin-window/TASK-0072, admin-window/BUG-0118).
 *
 * **This is the only `narrowedTo` in the app** (admin-window/DEBT-0010). It
 * takes narrowing PHRASES and returns the scope as a PHRASE LIST; the facet
 * canonicaliser that used to share the word lived in `src/lib/db/runs.ts` and
 * took a `?source=` to a query value. Nothing but the type checker stood
 * between the two imports, so the word now belongs to this one — and that
 * canonicaliser has since been retired into `canonicalUrlText`
 * (`src/lib/url/text.ts`, admin-window/BUG-0155), which shares no word with
 * anything here.
 */
export function narrowedTo(
  narrowings: readonly (string | null)[],
): readonly string[] | null {
  const named = narrowings.filter((phrase): phrase is string => phrase !== null);
  return named.length === 0 ? null : named;
}

/**
 * The window's narrowing MINUS the one a clause's own words already state —
 * what `population()` should see from inside a clause that names a narrowing
 * itself, so the sentence states it once and states the rest (bar 13's
 * requirement is that the clause name the population, not that it name it
 * twice).
 */
function besides(
  scope: readonly string[] | null,
  stated: string,
): readonly string[] | null {
  if (scope === null) return null;
  return narrowedTo(scope.filter((phrase) => phrase !== stated));
}

/**
 * Does this window's read really carry that narrowing?
 *
 * The other half of `besides`, and the reason both live here: a clause that
 * states a narrowing IN ITS OWN WORDS may only do so when the read actually
 * carried it. `besides` subtracts a phrase whether or not it was there, so on
 * an unnarrowed window it answered `null` and the clause went on asserting the
 * narrowing anyway — "877 claims match these filters" over a read no filter
 * touched, byte-identical to the same page with a chip set
 * (admin-window/BUG-0123). Asked of the same `scope` the subtraction reads, so
 * the two cannot come to disagree about what the window was narrowed by.
 */
function narrows(scope: readonly string[] | null, stated: string): boolean {
  return scope !== null && scope.includes(stated);
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
function population(rows: string, scope: readonly string[] | null): string {
  const words = scopeWords(scope);
  return words === null ? rows : `${rows} ${words}`;
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
  const scoped = scopeWords(info.scope);
  const earlier =
    scoped === null ? "nothing earlier" : `nothing earlier ${scoped}`;
  const floor =
    info.oldest === null
      ? ""
      : `: ${of} recorded since ${absoluteUtc(info.oldest)}; ${earlier} is retained`;
  return ` The window did not fill — ${count(info.held)} of at most ${count(
    info.limit,
  )} — so it holds all the ${of} the read found${floor}.`;
}

/**
 * The rows a CONTINUED window has on screen, or `null` where the sentence is
 * the one the app rendered before paging existed (admin-window/BUG-0172).
 *
 * Every window whose rows on screen are still within its cap answers `null`
 * here, and they are the same case for a reader: the unpageable surface, whose
 * `drawn` is the rows the page rendered, and the paged surface that has taken
 * in nothing yet, whose `drawn` is still the first screen's own rows. **A
 * first screen renders byte-identically either way**, which is the whole of
 * SPEC F14's "the first screen does not change": the cap is what a full first
 * window drew, so `drawn` passes this test only after a press really appended
 * rows.
 */
function continuedTo(info: DrawnWindow): number | null {
  const drawn = info.drawn ?? null;
  return drawn !== null && drawn > info.limit ? drawn : null;
}

/**
 * Is this window one a press can CONTINUE — whatever it has taken in so far?
 *
 * It is what keeps `didNotFill` off a paged surface (admin-window/BUG-0172).
 * The wrapper is only ever drawn on a window that FILLED, so "The window did
 * not fill — 50 of at most 50" is a sentence no state of it may reach; the
 * not-truncated case here is the set being complete on screen, which is a
 * different sentence and each arm below says it in its own words.
 *
 * It reads the page's own statement (`DrawnWindow.continues`) and NOTHING
 * else. It used to ask whether `drawn` was present — a fact about the rows on
 * screen, standing in for a fact about a control — so the only way for a
 * surface to state what it had drawn was to claim a press it cannot make
 * (admin-window/BUG-0183, ARCHITECTURE.md §4.3 rule 4).
 */
function pageable(info: DrawnWindow): boolean {
  return info.continues === true;
}

/**
 * Has the read that continues this window said the SET HAS ENDED?
 *
 * `truncated` is the one held-back verdict and on a paged surface it is the
 * paging state's own status (admin-window/BUG-0172), so a pageable window that
 * is not truncated is one the read has ended. It is asked rather than compared
 * to a number: a window whose count and whose rows disagree is exactly the
 * state that must not be settled by arithmetic (admin-window/BUG-0174).
 */
function ended(info: DrawnWindow): boolean {
  return pageable(info) && !info.truncated;
}

/**
 * The rows that are ON SCREEN, for the clauses that name them
 * (admin-window/BUG-0174, admin-window/BUG-0183).
 *
 * ONE source and one only: `drawn`, which whoever drew the rows states — on a
 * paged surface the driver's own `held`, on an unpaged one the rows the page
 * rendered. `null` where the window states none, and then no clause names
 * them at all.
 *
 * **`limit` is not an answer here, in any arm or any state.** The cap is the
 * size of a window; it is never a description of a screen. The fallback this
 * function used to carry claimed one true use — the unpaged window, "where
 * the clause is rendered only over a read that filled" — and that gate does
 * not exist: on `/claims` the clause is gated on `truncated`, which comes from
 * a separate COUNT read and not from the rows filling the cap, so screens
 * holding 37, 10 and 49 claims all said "the 50 longest-waiting are below"
 * (admin-window/BUG-0183). The same fallback on the paged arm rendered the
 * cap's number over an exhausted screen that had appended zero rows
 * (admin-window/BUG-0174).
 */
function onScreen(info: DrawnWindow): number | null {
  return info.drawn ?? null;
}

/**
 * DO THIS WINDOW'S TWO READS AGREE? The ONE derivation
 * (admin-window/BUG-0174, admin-window/BUG-0180).
 *
 * A count and a window read are TWO reads (`/claims` counts the matching set
 * and draws its rows separately), and only where they agree has ONE read
 * established a relationship between them that a sentence may assert
 * (LESSONS 2). The two readings, which is the whole of the expression below:
 *
 *  - a window still offering more agrees while the count is LARGER than the
 *    rows drawn — that is what makes "the rest are not shown" a statement of
 *    the count rather than an invention;
 *  - a window the read has ENDED agrees where the rows drawn ARE the count,
 *    and then the set really is complete on screen.
 *
 * It decides which SENTENCE is sayable and nothing else: `truncated` keeps its
 * own one derivation (the paging state's status, LESSONS 11) and nothing here
 * re-derives it by counting rows.
 *
 * **It is EXPORTED because two surfaces ask it of one window** — the matched
 * arm below and the terminal sentence of `PageMore`, which replaces the
 * control and is the element an operator actually acts on. That sentence used
 * to assert the completeness this arm had just declined to assert, three lines
 * apart on one screen, because the control held no window and compared
 * nothing (admin-window/BUG-0180). It is asked of the ONE `DrawnWindow` the
 * page composed — never re-derived beside it, and never a size heuristic under
 * a new name (admin-window/BUG-0174).
 *
 * A window whose `held` counts its OWN rows has no second read to disagree
 * with, so once its read has ended (`truncated` false) `onScreen` IS `held`
 * and this answers `true` by construction — which is why `/browse` cannot
 * reach the diverged sentence at all.
 *
 * A window that states NO rows on screen answers the DISAGREE verdict: there
 * is one read here and not two, so there is no agreement to assert
 * (admin-window/BUG-0183). Its exported signature is unchanged — the terminal
 * sentence of `PageMore` asks it of the same window this arm does.
 */
export function readsAgree(info: DrawnWindow): boolean {
  const below = onScreen(info);
  if (below === null) return false;
  return info.truncated ? below < info.held : below === info.held;
}

/**
 * MAY THIS WINDOW SAY IT DID NOT FILL? The one place the `matched` arm's fill
 * verdict is decided (admin-window/BUG-0186).
 *
 * The verdict is the ROW read's, against its own cap, and it is never the
 * COUNT read's. `/claims` issues two reads — a count over the matching set and
 * the window that draws the rows — and the arm's gate was `truncated`, which
 * that page derives from the COUNT alone (`listCount.data > listed.length`).
 * A count that comes back SMALLER than the rows drawn turns that gate off, so
 * the did-not-fill clause rendered over a screen holding 50 claims under a cap
 * of 50, naming the count's 30: a window that drew its whole cap saying it did
 * not fill, and a sentence describing the screen with a number about something
 * else. Two screens holding 50 and 37 claims said the same thing, byte for
 * byte (measured on a988b00; the other direction of admin-window/BUG-0174 and
 * admin-window/BUG-0183's divergence, which those tickets fixed for the clause
 * next door).
 *
 * So both halves must hold, and both come from facts the window already
 * carries — no field is added and no call site passes a new prop:
 *
 *  - the window's own rows fell SHORT of its cap (`drawn < limit`, which
 *    `drawn` states since admin-window/BUG-0183) — a window that reached its
 *    cap may be hiding rows, whatever any other read says;
 *  - the two reads AGREE (`readsAgree`, the one derivation) — the clause ends
 *    by asserting that the window holds everything the read found, which is a
 *    relationship between the count and the rows, and only agreement
 *    establishes it (LESSONS 2).
 *
 * A window that states NO rows on screen answers `true`: there is ONE read
 * here and not two (`held` is that read's own rows, `heldFrom` absent meaning
 * "this window"), so there is no second read to fall short of the cap against
 * and nothing to disagree with — its sentence is the one it has always
 * rendered, which is what admin-window/BUG-0183 left standing and this ticket
 * pins byte for byte. It is asked only where the window is NOT truncated and
 * no press can continue it; the other two states are the clauses beside it.
 */
function maySayItDidNotFill(info: DrawnWindow): boolean {
  const below = onScreen(info);
  if (below === null) return true;
  return below < info.limit && readsAgree(info);
}

/**
 * How a continued window that has reached the end of its set ends — the read's
 * own verdict, in the app's voice.
 *
 * It is deliberately NOT `PageMore`'s "All N in this view are shown": two
 * sentences about one question read as a page arguing with itself when they
 * differ and as a stutter when they agree (LESSONS 11). This one is the
 * WINDOW's: it says what the read that continued the window came back with.
 */
const THE_READ_FOUND_NO_MORE = "the read found no more.";

/**
 * How a continued window whose read has NOT ended the set ends, where the
 * window's two reads disagree about how many rows there are
 * (admin-window/BUG-0174).
 *
 * `THE_REST_IS_NOT_SHOWN` asserts that a rest EXISTS, which on `/claims` is
 * the COUNT's statement — true while the count is larger than the rows drawn
 * and an invention once it is not (staging's count moved 877 -> 878 between
 * two sessions of this campaign, and a stale count under a grown screen is the
 * same divergence the other way). This says only what the paging state itself
 * established: the read has not reached the end.
 */
const THE_SET_HAS_NOT_ENDED = "the read has not said the set has ended.";

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
        /**
         * What the SCAN was narrowed to, in the app's words, as a phrase that
         * reads straight after `measured` — `"in the events domain"`, so
         * "Claims observed" becomes "Claims observed in the events domain" —
         * or `null`/absent where the scan covered the whole object.
         *
         * The same fact `DrawnWindow.scope` carries for a drawn list, and it
         * is here for the same reason (admin-window/BUG-0163): a scan narrowed
         * at the query is a different population from the object its sentence
         * names, so `/claims?domain=events` moved every figure on the gauge
         * card while this line said, to the byte, what it says over the whole
         * table. It is filled from the SAME narrowing the query carried, never
         * from a second reading of the URL.
         *
         * **It is the one narrowing declaration in this file that is
         * OPTIONAL**, and that is a fact about this arm's other call sites
         * rather than a licence to default it. Every DRAWN call site was
         * converted when `scope` landed, so that one is required; the scan arm
         * has six others (`/queues`, `/cycles` x2, `/review`, `/sources` x2)
         * that admin-window/BUG-0163 may not touch — its criterion 4 pins
         * every other page's window line as admin-window/BUG-0160 left it. Two
         * of those six — `/sources`' trend and rejection lines, whose reads
         * carry `readAwaitingRowTrend({ filter })` — are the same defect one
         * page over, unfixed here and reported in this ticket's handoff rather
         * than silently changed.
         */
        scope?: readonly string[] | null;
        shows?: undefined;
      }
    | {
        window: DrawnWindow;
        shows: DrawnSentence;
        measured?: undefined;
        scope?: undefined;
      }
  ),
): ReactNode {
  if (props.shows === undefined) {
    const info = props.window;
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        {/* The narrowing rides through the same `population` the drawn arms'
            clauses use, so a scan and a list state one narrowing in one
            spelling, and an unnarrowed scan renders the sentence it always
            did, to the byte. */}
        {population(props.measured, props.scope ?? null)} since{" "}
        {absoluteUtc(info.since)}, read to {absoluteUtc(info.until)} — a window
        of at most {count(info.limit)} rows, not the whole {info.over}.
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
    // A window a press CONTINUES states what is below it, and takes its
    // held-back verdict from `truncated` alone (admin-window/BUG-0172,
    // admin-window/BUG-0174). THREE sentences, one per state the read can be
    // in, and each names the number the read it describes established:
    //
    //  - the FIRST screen (and every window no press can continue) is the
    //    sentence this arm has always rendered, to the byte: the cap is what
    //    that read carried and what it drew;
    //  - a CONTINUED window states the rows the operator now holds instead of
    //    the cap of the first read, and states no cap of its own — 50 is the
    //    size of ONE press, not a description of a screen holding 877;
    //  - a window the read has ENDED says the set is complete on screen, and
    //    says it without ranking a set with nothing outside it ("the 877
    //    longest-waiting of 877") and without denying being the whole view
    //    three lines above a control that says it is.
    //
    // The count and the rows are TWO reads (`/claims` counts the matching set
    // and draws the window separately), so where they disagree each is stated
    // as its own read and no clause asserts a relationship between them that
    // no single read established (LESSONS 2).
    const of = population(shows.rows, info.scope);
    // This clause names ONE narrowing in its own words — the filters — and
    // takes every other one from the window, like every other clause in this
    // file. It used to take none at all, on the reasoning that "match these
    // filters" was already the narrowing; that holds only when the narrowing
    // IS the chips. `/claims?tab=standing` is narrowed by the TAB with an
    // empty chip bar, so a count of one bucket was stated over filters nobody
    // had set and the bucket was never named, while the two clauses below — on
    // the same window, the same read — said "in the standing_disagreement
    // bucket" (admin-window/BUG-0118). `besides` subtracts what this sentence
    // already says, so the filters are stated once and a filter-narrowed
    // window renders the sentence it always did, to the byte.
    //
    // And it may only say them when they are SET (admin-window/BUG-0123). The
    // phrase was unconditional, so a read no filter touched was described as
    // "877 claims match these filters" — the same sentence, to the byte, as
    // the same page with a chip set, which is the one claim bar 13 forbids
    // ("no screen claims a mark it did not draw"). An unfiltered window states
    // the same count over the population the window itself names: the whole
    // object where nothing narrowed it, the tab's bucket where the tab did.
    const counted = narrows(info.scope, NARROWED_BY_FILTERS)
      ? `${count(info.held)} ${population(
          shows.rows,
          besides(info.scope, NARROWED_BY_FILTERS),
        )} match these filters`
      : `${count(info.held)} ${of} in all`;
    // The rows that are below, from the rows this window DREW and never from
    // the cap (admin-window/BUG-0183). A window that states none names none:
    // there is no number here a read established, so the clause that would
    // name one is not rendered and nothing else about the line moves.
    const below = onScreen(info);
    // A window that drew NO ROWS names none either, and holds nothing back
    // (admin-window/BUG-0197). Over an empty card the clause was two sentences
    // arguing: the line ranked a set with nothing in it ("the 0 longest-waiting
    // are below") and then apologised for withholding a rest, directly above
    // the card whose whole job is to say the read came back empty. A window
    // that drew none has nothing to rank and nothing to hold back, so the line
    // states what the COUNT read found and stops — that clause is a fact its
    // own read established, and an operator who sees it over an empty card
    // learns the real thing, which is that the two reads disagree. The verdict
    // is `below` itself: no new read, no new prop, no new `DrawnWindow` field.
    const holdsBack =
      below === null
        ? ""
        : below === 0
          ? ` ${counted}.`
          : ` ${counted}; the ${count(below)} longest-waiting are below — ${THE_REST_IS_NOT_SHOWN}`;

    // What the line says where `didNotFill` may not speak: EACH READ AS ITS
    // OWN FACT (admin-window/BUG-0186), and then the rows against their cap.
    // Nothing here ranks one read out of the other, claims a rest the count no
    // longer covers, or says the window holds everything "the read" found —
    // with two reads disagreeing there is no one read for that sentence to be
    // about, and with the cap reached there is no such claim to make.
    //
    // AGREEMENT is the whole difference between the two spellings:
    //
    //  - where the count and the rows are the same number, one read really did
    //    establish that every claim it counted is on screen, so the line says
    //    so in the words the ENDED paged window already uses;
    //  - where they are not, the count is stated as a count and nothing else —
    //    the spelling the paged arm's diverged sentence uses, deliberately
    //    free of the superlative, which under a smaller count would read as a
    //    ranking out of it ("30 claims in all; the 50 longest-waiting").
    const eachReadsOwnFact =
      below === null
        ? ""
        : readsAgree(info)
          ? ` ${counted}, and every one of them is below. ${rowsAgainstCap(
              below,
              info.limit,
            )}`
          : ` A count of ${of} answered ${count(info.held)}. ${rowsAgainstCap(
              below,
              info.limit,
            )}`;

    if (below === null || (continuedTo(info) === null && !ended(info))) {
      // Unchanged, element for element and byte for byte, in every state but
      // the two whose fill verdict came from the wrong read: this is the first
      // screen SPEC F14 keeps, and every window no press can continue.
      return (
        <WindowParagraph gauge={props.gauge} window={info}>
          {shows.lede} A window of at most {count(info.limit)} rows, not the whole{" "}
          {info.over}.
          {info.truncated || pageable(info)
            ? holdsBack
            : maySayItDidNotFill(info)
              ? didNotFill(info, shows.rows)
              : eachReadsOwnFact}
        </WindowParagraph>
      );
    }

    // Do this window's two reads agree? Asked of the ONE derivation above,
    // which the control's terminal sentence asks of this same window
    // (admin-window/BUG-0180) — the reading of it a reader needs is there, and
    // this arm no longer carries a second copy of the expression.
    const agree = readsAgree(info);
    const complete = ` ${counted}, and every one of them is below — ${THE_READ_FOUND_NO_MORE}`;
    // Where they disagree, each read is stated as its own and nothing asserts
    // a relationship between them: not "the 50 longest-waiting of 877", which
    // ranks a selection out of a set the rows never came from, and not "the
    // rest are not shown" over a count that no longer covers the screen.
    const twoReads = ` A count of ${of} answered ${count(
      info.held,
    )}; the reads returned the ${count(below)} below, and ${
      info.truncated ? THE_SET_HAS_NOT_ENDED : THE_READ_FOUND_NO_MORE
    }`;
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        {shows.lede}
        {!agree ? twoReads : info.truncated ? holdsBack : complete}
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
  // The clauses of a catalog window, and which read produces each
  // (admin-window/BUG-0172, admin-window/BUG-0174). A window nothing has
  // continued says whether it filled, exactly as it always has — that is the
  // first screen, cap clause included. A CONTINUED one states the rows the
  // operator now holds and no cap of its own, because 50 is the size of one
  // press and not a description of a screen holding 120; where the read has
  // said the set has ended it says so, and does not go on denying that it is
  // the whole catalog three lines above a control that says it is.
  // `didNotFill` is reachable only where no press can happen: a surface that
  // can be continued filled its window to be drawn at all, so "the window did
  // not fill — 50 of at most 50" is a sentence no state of it reaches.
  const catalogOf = population(shows.rows, info.scope);
  // The rows this window drew, and the same rule the matched arm follows: a
  // window that states none names none, and renders the sentence it renders
  // before a press — its cap clause included (admin-window/BUG-0183).
  const catalogBelow = onScreen(info);
  if (catalogBelow === null || (continuedTo(info) === null && !ended(info))) {
    return (
      <WindowParagraph gauge={props.gauge} window={info}>
        {/* The cap is stated as a cap ("at most"), not as the row count: this
            arm said "The 50 newest events" whatever the read came back with, so
            a catalog holding twelve events was described as fifty
            (admin-window/BUG-0109). Every other arm already spells it this way. */}
        The newest {population(shows.rows, info.scope)} by arrival, newest first —
        a window of at most {count(info.limit)}, not the whole catalog.
        {info.truncated
          ? ` The window filled its cap, so ${catalogOf} that arrived before the ones below are not shown.`
          : didNotFill(info, shows.rows)}
      </WindowParagraph>
    );
  }
  const drawnNow = catalogBelow;
  return (
    <WindowParagraph gauge={props.gauge} window={info}>
      The newest {catalogOf} by arrival, newest first.
      {info.truncated
        ? ` ${count(drawnNow)} ${catalogOf} are on screen, and ${catalogOf} that arrived before them are not shown.`
        : ` ${count(drawnNow)} ${catalogOf} are on screen, and ${THE_READ_FOUND_NO_MORE}`}
    </WindowParagraph>
  );
}
