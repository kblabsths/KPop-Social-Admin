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
  /**
   * What the SCAN was narrowed to, where its call site has that to declare —
   * the same fact `DrawnWindow.scope` carries, optional here because the scan
   * arm was converted surface by surface (admin-window/BUG-0194).
   */
  scope?: readonly string[] | null;
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
   * WHERE THIS WINDOW STARTS in the order — the 1-based index of its first
   * row (1, 51, 101 …), stated by the paging state that drew it (page windows,
   * 2026-10-16). Absent means the first row: every unpaged line, and a paged
   * surface's first screen, start at row 1 and say nothing about it.
   *
   * It is what lets a continued line say "rows 51–100 are below" rather than
   * ranking a selection out of a set, and it is STATED, never inferred from a
   * page number this file does not hold (ARCHITECTURE.md §4.3 rule 4).
   */
  from?: number;
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
  /** Where the window starts, where the call site has that to state (page windows). */
  from?: DrawnWindow["from"];
}): DrawnWindow {
  return { ...read, truncated: read.held >= read.limit };
}

/**
 * A DRAWN window's stated position or row count as a hook value, or nothing:
 * a scan has neither, and a drawn window that states neither publishes
 * neither (React omits an `undefined` attribute).
 */
function drawnFact(
  info: ReadWindow | DrawnWindow,
  fact: "from" | "drawn" | "oldest",
): string | undefined {
  if (!(fact in info)) return undefined;
  const value = (info as DrawnWindow)[fact];
  return value === undefined || value === null ? undefined : String(value);
}

/**
 * A window's FACTS, as hooks, and nothing visible — campaign admin-window,
 * rewritten 2026-10-21 on Ben's ruling.
 *
 * It used to render a sentence. Three of them, on the Dashboard alone:
 *
 *   "The resolver's newest cycles, newest first — a window of at most 6, not
 *    a count of the cycles that exist. The window filled its cap, so cycles
 *    older than the ones below are not shown. Open Cycles & runs for the
 *    rest."
 *
 * Ben quoted that back on his first operator pass and said delete it, and
 * everything like it across the website. So the sentence layer is gone — about
 * 700 lines of it, one arm per shape of list (`newest`, `matched`, `catalog`,
 * `alphabetical`, and the scan), with the clause helpers that composed them.
 *
 * **What is deliberately kept: the hook set.** Every window still publishes
 * `data-window-*`, because those attributes are the contract the offline
 * suites and the live oracles read a window back by — the cap it carried, how
 * many rows it held, whether it filled, and a scan's time bounds. They were
 * never what the operator read; they are what a test reads. Deleting the
 * prose does not cost a single assertion about whether a read was honest, and
 * the facts themselves (`DrawnWindow`, `drawnWindow`, `oldestIn`, `scope`)
 * are untouched above.
 *
 * **What is knowingly lost.** LOOK_AND_FEEL bar 13 required every windowed
 * list to SAY on screen that it was a window. Nothing says it now: a table of
 * six cycles and a table of six-of-twelve-hundred look identical to a reader.
 * Two M1 user-sims named that statement as the reason they trusted the tool,
 * so this is a real trade and it is Ben's to make — he made it, twice, and
 * the bar is struck in LOOK_AND_FEEL rather than quietly contradicted here.
 * The honest place for it, if it comes back, is the info bubble Ben reserved
 * for himself — not a paragraph above the table.
 *
 * React omits an attribute whose value is `undefined`, so a drawn window —
 * which has no `since` — publishes no `data-window-since`, and the hook set a
 * surface publishes stays a property of the read rather than of the page.
 */
export function WindowLine({
  gauge,
  window: info,
}: {
  gauge: string;
  window: ReadWindow | DrawnWindow;
}) {
  return (
    <p
      data-window={gauge}
      data-window-since={info.since}
      data-window-until={info.until}
      data-window-limit={String(info.limit)}
      data-window-held={String(info.held)}
      data-window-truncated={info.truncated ? "true" : "false"}
      data-window-from={drawnFact(info, "from")}
      data-window-drawn={drawnFact(info, "drawn")}
      /* The OBJECT's own floor, where the window has one — the instant the
         oldest row in a drawn window carries. It used to reach the operator
         as a clause ("runs recorded since 2026-08-31; nothing earlier is
         retained"), which is bar 13's other half and is now deleted; the
         FACT is still a fact of the read, so it is published here rather than
         dropped. A window with no instant to name (an empty read, or an order
         that is not in time) publishes nothing, as before. */
      data-window-oldest={drawnFact(info, "oldest")}
      /* WHAT THE READ WAS NARROWED TO, as the phrases the call site declared,
         joined once here.

         It reached the operator as a clause ("runs from ticketmaster", "Claims
         observed in the events domain") until 2026-10-21. With the sentence
         deleted, `DrawnWindow.scope` had become dead data — set by every call
         site, read by nothing — and the choice was to delete it from the type
         or publish it. Published, for the reason `oldest` is: a narrowed read
         is a DIFFERENT POPULATION from the object it ran over
         (admin-window/BUG-0163, admin-window/BUG-0114), so which narrowing a
         window carried is a fact about that window and worth keeping
         observable. `null` — an unnarrowed read — publishes nothing. */
      data-window-scope={
        info.scope === undefined || info.scope === null || info.scope.length === 0
          ? undefined
          : info.scope.join(", ")
      }
      hidden
    />
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
