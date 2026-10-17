/**
 * The page-window driver — campaign admin-window/TASK-0063, rewritten for
 * PAGE WINDOWS on 2026-10-16 (Ben's ruling of 2026-09-11).
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7). Its ONE paging import is
 * another leaf, `./bounds`, which rule 7 ¶2 permits: the route spelling, the
 * window arithmetic and the answer shape are that file's, asked rather than
 * retyped here. It reaches nothing that can reach a database — the request
 * itself arrives as `fetchJson`, a dependency the caller hands in.
 *
 * **What changed with page windows, in one sentence:** the state used to hold
 * the rows a press APPENDED under a first screen it never held; it now holds
 * ONE WINDOW of rows — the first screen's on a cold load, and whichever window
 * the URL names after a move — and a move REPLACES that window rather than
 * growing a list. So there is no bound that advances, no seam between a first
 * screen and a page, no id set to dedupe across presses (admin-window/BUG-0222's
 * overlap was a property of concatenation, and nothing is concatenated), and
 * no "load everything": the operator is always looking at one bounded read.
 *
 * **Why a directiveless module and not a React hook** (§4 rule 1's amended
 * exception, 2026-09-10). This repo's offline tier has no DOM —
 * `renderToStaticMarkup` only — so a press cannot be simulated and a click
 * handler that owns its own logic cannot be tested here at all. Every decision
 * paging makes therefore lives here, where the offline suite drives it
 * DIRECTLY against a recording stub, and the client hook is a thin binding.
 *
 * **Nothing here throws.** A rejected fetch, a body that is not JSON and a
 * body that is JSON but not a `PageAnswer` all come back as a refusal on the
 * next state, exactly as a refused read does (§4.1: the data layer never
 * throws; the same promise across the wire).
 *
 * **`requestPage` publishes no `loading` state of its own.** It answers with
 * the state a move ENDS in; the interim is `pressing`, which a caller
 * publishes before awaiting, and the `loading` arm below is what makes that
 * safe — a second move on a state already loading issues no request at all.
 */

// ONE LINE EACH, deliberately: the leaf-closure guard in
// `tests/offline/db/layering.test.ts` reads imports LINE BY LINE, so a
// multi-line import's opening brace reads as an import naming no module at all
// and the leaf is reported as reaching outside itself.
import { isPageAnswer, isPageNotes, sameWindow, windowQuery, type PageAnswer, type PageNotes, type PageWindow, type WindowBound } from "./bounds";
// The app's ONE spelling of "who wrote these words", and the join that makes a
// flat account the join of its runs (admin-window/BUG-0196).
import { accountText, type AccountSegment, type ReasonAuthor } from "@/lib/account/authored";
// The app's ONE definition of blank, ASKED rather than retyped (common
// violations row 15, admin-window/BUG-0176). `isAbsent` (`src/lib/format.ts`)
// is the same question one layer up and cannot be reached from a leaf —
// `format.ts` imports React, so importing it here would fail rule 7's closure.
import { isAbsentText } from "@/lib/verdict/decision";

/**
 * Why a move drew no window — FACTS, in two conditions that are not the same
 * kind of thing (admin-window/BUG-0176) — and WHICH WINDOW it asked for.
 *
 * **`"broken"`** is a move THIS APP could not complete: the four red arms and
 * the route's own window refusal. It carries the words, who wrote them, and
 * WHICH object they were about — `reading` for a failed read, the ROUTE when
 * the request or the body never got as far as an answer. `object` is `null`
 * for a window refusal alone: the window the server refused is the one this
 * refusal names in `asked`, so there is no third object to name, and the raw
 * value is never pasted into a sentence this app wrote (common violations
 * rows 15 and 20).
 *
 * **`"not provisioned"`** is the backing object being absent from this
 * database — an absence, never a breakage (LOOK_AND_FEEL, Palette: red means
 * broken, never unavailable). It carries the missing NAME and no prose at all:
 * this is a lib module and may not import a component (§4, one-way
 * dependency), so it cannot author the app's state-3 sentence.
 *
 * **`asked`** is the window the refused move was FOR. It is what lets the
 * surface say which window was refused while still drawing the window it
 * holds, and it is what stops a URL-driven surface from asking for the same
 * refused window again on every render (`windowToDraw` below): a refusal is
 * retried by the operator, never by a loop.
 */
export type PageRefusal = (
  | {
      /** A move this app could not complete — the four red arms. */
      condition: "broken";
      /**
       * The whole account as ONE string — the JOIN of `account`, derived at
       * `refuse()`, the single construction point (`accountText`,
       * admin-window/BUG-0196).
       */
      reason: string;
      /**
       * The account as its RUNS — the words of each part and WHO WROTE THEM,
       * in order (admin-window/BUG-0175, admin-window/BUG-0196). `"this app"`
       * renders in the `body` sans step; `"the machine"` in the `data` mono
       * step. SET at `refuse()` and only read by the component — never
       * recovered by comparing `reason` to a constant (LESSONS 4 and 5).
       */
      account: readonly AccountSegment[];
      object: string | null;
    }
  | {
      /** The backing object is not in this database — absence, not breakage. */
      condition: "not provisioned";
      /** The object the ANSWER named, carried verbatim (admin-window/BUG-0176). */
      missing: string;
    }
) & { readonly asked: PageWindow };

/**
 * The two answers to "who wrote this refusal's reason", RE-EXPORTED from the
 * leaf that now owns them (`src/lib/account/authored.ts`).
 */
export type { ReasonAuthor };

/**
 * An `Error` whose message THIS APP composed — admin-window/BUG-0175.
 *
 * Declared once, here, beside the fact it decides. `fetchJson`
 * (`src/components/ui/paging.tsx`) throws its two authored sentences as one of
 * these; every other rejection that reaches `requestPage` carries a runtime's
 * own words and is `"the machine"`. Authorship travels with the THROW, never
 * with the words.
 */
export class AppAuthoredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppAuthoredError";
  }
}

/** Everything one paging surface knows between moves. */
export interface PageState<Row> {
  /** THE WINDOW ON SCREEN — every row of it, the first screen's included. */
  readonly rows: readonly Row[];
  /** WHICH window those rows are: the one the URL names once a move lands. */
  readonly window: PageWindow;
  /**
   * The read that drew this window said the set ends INSIDE it — `endsWithin`
   * (`./bounds`), the route's own full-or-exhausted verdict, carried and never
   * re-derived by counting rows here. It decides whether a next window is
   * offered at all.
   */
  readonly exhausted: boolean;
  readonly status: "idle" | "loading";
  readonly refusal: PageRefusal | null;
  /**
   * The legs that reported on THIS window — the route's own notes for the
   * rows on screen (admin-window/TASK-0076), REPLACED with the window rather
   * than merged across it: a note about columns the previous window left
   * unfilled is about rows no longer on screen. `null` on a first screen
   * (whose legs the page renders itself) and on a surface whose route carries
   * no notes at all (`/claims`).
   */
  readonly notes: PageNotes | null;
  /**
   * WHICH SERVER SCREEN THIS STATE CONTINUES — `screenOf` over the window and
   * the ids the server rendered (admin-window/BUG-0216, kept under windows).
   *
   * `useState` seeds once and ignores every later `initial`, while the
   * server can render the page again under a client that kept its state
   * (`router.refresh()`, and in `next dev` the Fast Refresh that follows
   * compiling a route handler). A state seeded from a screen the server has
   * since replaced is dropped whole by `continuing()` and the surface starts
   * again from the screen it actually has. The empty string is a state that
   * continues no particular screen — what a driver walked from a synthetic
   * start holds — and only ever compares equal to another empty string.
   */
  readonly screen: string;
}

/**
 * The SIGNATURE of one server-rendered screen: the window and the ids it drew,
 * in order. Two screens with the same signature hold the same rows under the
 * same window, so a state seeded from one continues the other.
 *
 * The ids are the surface's own — the field its list keys by (`deps.idKey`,
 * admin-window/BUG-0226) — handed in already read, so this leaf never guesses
 * a key.
 */
export function screenOf(window: PageWindow, ids: readonly string[]): string {
  return `${window.page}/${window.size}:${ids.join(",")}`;
}

/**
 * The state a surface starts in: the server rendered THIS window and said
 * whether the set ended inside it.
 *
 * `ids` are the rows' ids as the surface keys them, for `screen`; a driver
 * started from a synthetic first screen hands none and is then a state that
 * continues no particular screen.
 */
export function initialPage<Row>(
  rows: readonly Row[],
  window: PageWindow,
  exhausted: boolean,
  ids: readonly string[] = [],
): PageState<Row> {
  return {
    rows,
    window,
    exhausted,
    status: "idle",
    refusal: null,
    // A surface's FIRST screen renders its own legs server-side.
    notes: null,
    screen: ids.length === 0 ? "" : screenOf(window, ids),
  };
}

/**
 * The state a move publishes BEFORE its request resolves.
 *
 * `idle` becomes `loading` with everything else untouched; `loading` comes back
 * as **the SAME object**, so a caller comparing identity can see that a second
 * move changed nothing and never publish a re-render for it. The standing
 * refusal is carried through rather than cleared: it is still the only
 * account of why the last move drew nothing, and `requestPage` clears it when
 * a move succeeds.
 */
export function pressing<Row>(state: PageState<Row>): PageState<Row> {
  if (state.status !== "idle") return state;
  return { ...state, status: "loading" };
}

/**
 * THE STATE A SURFACE MAY STILL DRAW (admin-window/BUG-0216, under windows).
 *
 * A state whose `screen` is not the current server screen's does not continue
 * it, and the surface starts again from the screen it actually has. Nothing
 * is merged or repaired: a state seeded from a screen the server has replaced
 * is a window of an order the operator is no longer looking at. It also
 * decides the move that was IN FLIGHT when the screen changed — its answer is
 * published carrying the OLD `screen`, so the next render drops it by this
 * same one comparison.
 */
export function continuing<Row>(
  state: PageState<Row>,
  initial: PageState<Row>,
): PageState<Row> {
  return state.screen === initial.screen ? state : initial;
}

/**
 * WHICH FIELDS OF A ROW MAY NAME IT — every key of `Row` whose value is a
 * `string`, and no other (admin-window/BUG-0226).
 *
 * The id a surface draws its rows under crosses a CLIENT BOUNDARY, so it is
 * carried as this — a NAME — and never as a function: a server page writes
 * `deps` as props on a `"use client"` element, React serializes every one of
 * them into the flight payload, and a function is the one shape that is not
 * data. It answered HTTP 500 on both paged surfaces, with no markup at all
 * (measured on a production build 2026-09-14; `tests/fixtures/client-props.ts`
 * is the offline tier's reading of the same fact).
 */
export type RowIdKey<Row> = {
  [K in keyof Row]-?: Row[K] extends string ? K : never;
}[keyof Row] &
  string;

/**
 * WHAT ONE ROW IS CALLED, read from a row that may be ANYTHING — the total
 * reading of `RowIdKey` (admin-window/BUG-0226). It **never throws**: a null
 * row, a row that is not an object, a missing field and a field holding a
 * number all answer `""`, the same answer a blank id gives.
 */
export function readId(row: unknown, key: string): string {
  if (row === null || typeof row !== "object") return "";
  const named = (row as Record<string, unknown>)[key];
  return typeof named === "string" ? named : "";
}

/**
 * THE SERVER-SIDE READER OF THAT NAME — `readId` bound to one key, for the
 * places a page needs a function over its OWN rows (admin-window/BUG-0226).
 * A surface spells its id field ONCE, as a `RowIdKey`, hands THAT to `deps`,
 * and derives this from the same constant — one fact, one derivation.
 */
export function idAt<Row>(key: RowIdKey<Row>): (row: Row) => string {
  return (row: Row): string => readId(row, key);
}

/**
 * What one move needs: where to ask, what to carry, how to ask — and what a
 * row is CALLED, for the screen signature.
 */
export interface PageDeps<Row> {
  /** `PAGE_ROUTES[...]` — this app's own route, by a relative path. */
  readonly route: string;
  /** The SURFACE's own address (`/claims`, `/browse`) — what a window href is built on. */
  readonly path: string;
  /** The surface's own facets, already serialized (`a=1&b=2`, or empty). */
  readonly params: string;
  /**
   * THE NAME OF THE FIELD A ROW IS DRAWN UNDER — a `RowIdKey` and not a
   * reader, because these deps CROSS A CLIENT BOUNDARY (admin-window/BUG-0226).
   */
  readonly idKey: RowIdKey<Row>;
  /** One request, already parsed. It may reject; a refusal is the answer. */
  readonly fetchJson: (url: string) => Promise<unknown>;
}

/** The URL one move asks for — `route?params&page=N&size=S`. */
export function pageUrl<Row>(deps: Pick<PageDeps<Row>, "route" | "params">, window: PageWindow): string {
  return `${deps.route}?${windowQuery(deps.params, window)}`;
}

/** The surface's own address for a window — what every control's `href` is. */
export function windowHref<Row>(deps: Pick<PageDeps<Row>, "path" | "params">, window: PageWindow): string {
  return `${deps.path}?${windowQuery(deps.params, window)}`;
}

/**
 * WHICH WINDOW A SURFACE MUST REQUEST, given what it holds and what the URL
 * now names — the one rule behind a URL-driven surface, answered here so the
 * offline tier can drive it (the hook only calls it).
 *
 *  - a URL this app refuses names nothing to request: on a cold load the
 *    server already refused it by name, and no move this app makes writes one;
 *  - a move in flight is left to land — its `then` asks this question again;
 *  - the window on screen IS the URL's: nothing to do;
 *  - the URL's window is the one the last move was REFUSED for: nothing to do
 *    either. A refusal is retried by the operator pressing again, never by a
 *    render loop re-asking the same refused window for ever;
 *  - otherwise, the URL's window.
 */
export function windowToDraw<Row>(state: PageState<Row>, asked: WindowBound): PageWindow | null {
  if (asked.kind !== "ok") return null;
  if (state.status !== "idle") return null;
  if (sameWindow(state.window, asked.window)) return null;
  if (state.refusal !== null && sameWindow(state.refusal.asked, asked.window)) return null;
  return asked.window;
}

/** A refusal that draws no window: the rows, the window and the notes stand. */
function withRefusal<Row>(state: PageState<Row>, refusal: PageRefusal): PageState<Row> {
  return { ...state, status: "idle", refusal };
}

/**
 * What the line says when the refusal that reached it carried NO WORDS —
 * admin-window/BUG-0176, criterion 14. The PAGING layer's own clause, about a
 * MOVE; it says only what the app knows.
 */
const WORDLESS_REFUSAL = "this request was refused and nothing came back to say why";

/**
 * A refusal for the BROKEN condition — the words, their author, and the
 * object they were about. One sentence with one author: `refuseAccount` with
 * a list of one.
 */
function refuse<Row>(
  state: PageState<Row>,
  asked: PageWindow,
  reason: string,
  object: string | null,
  reasonFrom: ReasonAuthor,
): PageState<Row> {
  return refuseAccount(state, asked, [{ words: reason, author: reasonFrom }], object);
}

/**
 * THE construction point for every broken refusal (admin-window/BUG-0196).
 * `reason` is DERIVED here — `accountText(account)` — and a wordless account
 * is replaced by this app's own clause, author and all (admin-window/BUG-0176,
 * admin-window/BUG-0184: the question is the app's one definition of blank).
 */
function refuseAccount<Row>(
  state: PageState<Row>,
  asked: PageWindow,
  account: readonly AccountSegment[],
  object: string | null,
): PageState<Row> {
  const reason = accountText(account);
  const wordless = isAbsentText(reason);
  return withRefusal(state, {
    condition: "broken",
    reason: wordless ? WORDLESS_REFUSAL : reason,
    account: wordless ? [{ words: WORDLESS_REFUSAL, author: "this app" }] : account,
    object,
    asked,
  });
}

/** The absent-object refusal: the NAME the answer gave, and nothing else. */
function refuseAbsent<Row>(state: PageState<Row>, asked: PageWindow, missing: string): PageState<Row> {
  return withRefusal(state, { condition: "not provisioned", missing, asked });
}

/**
 * The ways an `ok` answer is not a window this view may hold — the client
 * half of full-or-exhausted (ARCHITECTURE.md §4.3 read kind 3). They carry no
 * figure: this leaf cannot reach the app's one pluralisation rule.
 */
const SHORT_PAGE =
  "the window arrived short of its size and did not say the set had ended, so it may be missing rows";
const OVERLONG_PAGE =
  "the window arrived with more rows than its size, so it is not the window this view asked for";
const UNASKED_PAGE =
  "the window arrived for a different window than this view asked for, so it is not the window this view asked for";
const UNREADABLE_NOTES =
  "the window reported on its own columns in a form this app cannot read, so none of it was taken in";

/** The words a thrown or rejected value carries, without asking it to be an Error. */
function reasonOf(thrown: unknown): string {
  if (thrown instanceof Error && thrown.message.length > 0) return thrown.message;
  if (typeof thrown === "string" && thrown.length > 0) return thrown;
  return String(thrown);
}

/**
 * A rejection, as a refusal: its words AND who wrote them, decided together
 * at one point (admin-window/BUG-0175). `instanceof` is the whole derivation.
 */
function refusalFor(thrown: unknown): AccountSegment[] {
  if (thrown instanceof AppAuthoredError && thrown.message.length > 0) {
    return [{ words: thrown.message, author: "this app" }];
  }
  return [{ words: reasonOf(thrown), author: "the machine" }];
}

/**
 * ONE move, to window `to`. Returns the next state; never throws.
 *
 * In order (ARCHITECTURE.md §4.3 read kind 3, SPEC F14):
 *
 *  1. **One move, one request; no move, no request.** From `loading` this
 *     calls `fetchJson` ZERO times and returns the state unchanged — the same
 *     object. From `idle` it makes exactly ONE call, for `to`.
 *  2. **The answer is the window this move asked for, or it is refused.**
 *     Every `ok` answer declares its window; one that is not `to` is refused
 *     before its rows, its exhaustion or its notes are read at all.
 *  3. **An `ok` answer is FULL-OR-EXHAUSTED, or it is refused out loud**
 *     (admin-window/BUG-0168). Exactly `size` rows and the set continues, or
 *     at most `size` rows and `exhausted` is true — anything else is foreign
 *     data. An `ok` answer with ZERO rows that says the set ended is an EMPTY
 *     WINDOW, drawn as such: the read happened and found nothing at it.
 *  4. **The legs the window brought reach the state, or the move is refused**
 *     (admin-window/TASK-0076): a `notes` field must satisfy `isPageNotes`,
 *     and it REPLACES the standing notes — they were about the window that is
 *     no longer on screen. An answer with no `notes` field leaves `null`.
 *  5. **A landed window REPLACES the rows**: `rows`, `window`, `exhausted` and
 *     `notes` are the answer's; the refusal clears; `screen` is carried, since
 *     the server screen this state continues has not changed.
 *  6. **A refusal draws nothing** (M3 EC5): the rows, the window, the
 *     exhaustion and the notes come back exactly as they were, the refusal
 *     names the object and the window it asked for, and `status` returns to
 *     `idle` so the operator may retry.
 *  7. **Foreign data is a refusal, never a throw**: a rejected `fetchJson`, a
 *     body that never parsed, and a body `isPageAnswer` rejects all refuse
 *     naming the route.
 */
export async function requestPage<Row>(
  state: PageState<Row>,
  deps: PageDeps<Row>,
  to: PageWindow,
): Promise<PageState<Row>> {
  if (state.status !== "idle") return state;

  let body: unknown;
  try {
    body = await deps.fetchJson(pageUrl(deps, to));
  } catch (thrown) {
    return refuseAccount(state, to, refusalFor(thrown), deps.route);
  }

  if (!isPageAnswer(body)) {
    return refuse(state, to, "the page request answered something this app cannot read", deps.route, "this app");
  }
  const answer = body as PageAnswer<Row>;

  switch (answer.kind) {
    case "ok": {
      if (answer.page !== to.page || answer.size !== to.size) {
        return refuse(state, to, UNASKED_PAGE, deps.route, "this app");
      }
      const served = answer.rows.length;
      if (served > to.size) {
        return refuse(state, to, OVERLONG_PAGE, deps.route, "this app");
      }
      if (served < to.size && !answer.exhausted) {
        return refuse(state, to, SHORT_PAGE, deps.route, "this app");
      }

      let notes: PageNotes | null = null;
      if (Object.hasOwn(answer, "notes")) {
        const reported = (answer as { notes?: unknown }).notes;
        if (!isPageNotes(reported)) return refuse(state, to, UNREADABLE_NOTES, deps.route, "this app");
        notes = reported;
      }

      return {
        rows: answer.rows,
        window: to,
        exhausted: answer.exhausted,
        status: "idle",
        refusal: null,
        notes,
        screen: state.screen,
      };
    }
    case "not_provisioned":
      return refuseAbsent(state, to, answer.missing);
    case "error":
      return refuseAccount(
        state,
        to,
        answer.authored ?? [{ words: answer.message, author: "the machine" }],
        answer.reading,
      );
    case "refused":
      // The route's own window refusal, written by `src/lib/paging/bounds.ts`
      // — which is this app, on the other side of a fetch.
      return refuse(state, to, answer.reason, null, "this app");
  }
}
