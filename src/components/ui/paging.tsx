"use client";

import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { count } from "@/lib/format";
import {
  MAX_PAGE_OFFSET,
  PAGE_PARAM,
  SIZE_PARAM,
  WINDOW_SIZES,
  containingWindow,
  firstRowOf,
  nextWindow,
  previousWindow,
  windowBound,
  type PageWindow,
  type RawWindow,
} from "@/lib/paging/bounds";
import {
  AppAuthoredError,
  type PageDeps,
  type PageRefusal,
  type PageState,
  continuing,
  pressing,
  requestPage,
  windowHref,
  windowToDraw,
} from "@/lib/paging/machine";
import { IN_PAGE_LINK } from "../cycles/links";
import { Chip } from "./chip";
// The ONE drawing of a failed read's account — the object, then each run in
// its author's face (admin-window/BUG-0196). Shared with `ErrorLine`.
import { AuthoredAccount } from "./error-line";
// The app's ONE spelling of state 3's sentence, and the ONE spelling of what
// creates the objects this window reads — imported, never retyped (LESSONS 5).
// By RELATIVE path, never through the `src/components/ui` barrel: a server
// module importing a value out of a "use client" module builds green offline
// and answers 500 in production (admin-window/BUG-0094).
import { NotProvisionedClause } from "./not-provisioned";
import { ARRIVES_WITH } from "./state-of";
import { type DrawnWindow, WindowLine } from "./window-line";

/**
 * The paging affordance — campaign admin-window/TASK-0064, SPEC F14,
 * rewritten for PAGE WINDOWS on 2026-10-16 (Ben's ruling of 2026-09-11).
 *
 * ONE control set, drawn by BOTH paged surfaces (`/claims`, `/browse`) out of
 * this one file rather than hand-copied into two pages (LESSONS 1): the move
 * links, the size selector, the refusal line and the ceiling sentence are one
 * component, ABOVE the list (LOOK_AND_FEEL bar 14 — nothing the operator must
 * find sits below a long list).
 *
 * ## The shape, in one paragraph
 *
 * The URL names the window (`?page=`, `?size=`; LOOK_AND_FEEL bar 11), the
 * server renders that window on a cold load, and a move between windows is a
 * bounded client request against this app's own route handler for the window
 * the new URL names. Every control is a real link whose `href` IS that URL —
 * open it in a new tab and the server renders the same window — and a click
 * on it is intercepted to push the address and ask the route instead of
 * reloading the page. Back and Forward are `popstate`, answered by the same
 * one rule (`windowToDraw`): the surface draws the window the address names.
 *
 * ## The one framed exception, and its frame
 *
 * ARCHITECTURE.md §4 rule 1, amended 2026-09-10: this is the ONLY component in
 * the repo permitted to reach the network, it calls **this app's own paging
 * route handler by a relative path** and nothing else, and it imports no
 * `lib/db/**`, no `@supabase/supabase-js` and no `process.env`. `fetchJson`
 * below is the entire exception.
 *
 * ## Where the decisions are NOT
 *
 * Not here. Whether a move issues a request, what URL it carries, what an
 * answer does to the window and what a rejection becomes are all
 * `src/lib/paging/**` — a directiveless leaf the offline suite drives
 * directly, because this repo's offline tier has no DOM. The hook below binds
 * `pressing`, `requestPage` and `windowToDraw` to the browser's history and
 * publishes what they return.
 *
 * ## The client boundary
 *
 * A SERVER module importing a VALUE out of this file compiles, lints and
 * renders green offline, then answers 500 in a production build
 * (admin-window/BUG-0094). Only components are re-exported through the
 * `src/components/ui` barrel; `usePageWindows` and `fetchJson` are values and
 * are imported straight from this module by the client modules that need
 * them. Every prop a page writes on `PagingProvider` is DATA — the id crosses
 * as a KEY NAME, never a function (admin-window/BUG-0226).
 */

/**
 * Something other than this app's own route answered the request — campaign
 * admin-window/TASK-0076. This sentence quotes NOTHING: not the content type,
 * not the status, not a byte of the body.
 */
export const ANSWERED_BY_SOMETHING_ELSE =
  "the page request was answered by something other than this app's own route, so there is no page in what came back";

/** The answer DECLARED a page and carried something that is not one. */
export const UNREADABLE_ANSWER =
  "the page request came back declaring a page and carrying an incomplete one, so there is no page to add";

/** Does this response DECLARE that it carries JSON? */
const DECLARES_JSON = /^application\/json\s*(?:;|$)/i;

function declaresJson(response: Response): boolean {
  const declared = response.headers.get("content-type");
  return declared !== null && DECLARES_JSON.test(declared.trim());
}

/**
 * One paging request, already parsed — the whole of §4 rule 1's exception.
 *
 * It does not reject on a non-ok status: the route answers a refused window as
 * a `PageAnswer` with an HTTP status to match, and that body is the
 * operator's refusal. It asks what ANSWERED before it asks what the body says
 * (admin-window/TASK-0076), and it rejects only with an `Error` carrying words.
 */
export async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch (thrown) {
    throw asError(thrown);
  }
  if (!declaresJson(response)) throw new AppAuthoredError(ANSWERED_BY_SOMETHING_ELSE);
  try {
    return await response.json();
  } catch {
    throw new AppAuthoredError(UNREADABLE_ANSWER);
  }
}

/** Whatever a rejection carried, as an `Error` that has something to say. */
function asError(thrown: unknown): Error {
  if (thrown instanceof Error && thrown.message.length > 0) return thrown;
  if (typeof thrown === "string" && thrown.length > 0) return new Error(thrown);
  return new AppAuthoredError("the page request failed before it answered");
}

/**
 * THE BROWSER'S ADDRESS, as the two things this module asks of it — read
 * through `globalThis` so the offline tier, which has no window, can stub
 * them and so a server render (which never calls these) never references a
 * name that is not there.
 */
function addressedWindow(): RawWindow | null {
  const location = globalThis.location;
  if (location === undefined) return null;
  const query = new URLSearchParams(location.search);
  return { page: query.get(PAGE_PARAM), size: query.get(SIZE_PARAM) };
}

/**
 * A new history entry at `href` — the native API, which Next's router patches
 * so `usePathname`/`useSearchParams` follow it and Back restores it without a
 * reload (`node_modules/next/dist/client/components/app-router.js`,
 * `copyNextJsInternalHistoryState`).
 */
function pushAddress(href: string): void {
  globalThis.history?.pushState(null, "", href);
}

/**
 * Binds the pure driver to the browser's history.
 *
 * Three verbs and no logic of its own:
 *
 *  - **`goTo(window)`** pushes that window's address and asks the route for
 *    it. The state handed to `requestPage` is the PRE-move one, because
 *    `requestPage` issues no request from `loading` — that arm is what makes a
 *    second click free. A refused move is retried by calling this again with
 *    the same window: the click is the operator's, never a loop's.
 *  - **`sync()`** asks `windowToDraw` which window the ADDRESS now names that
 *    the state does not hold, and requests it. It runs on `popstate` (Back,
 *    Forward) and after every landed move, so an address that moved while a
 *    request was in flight is caught up with and a refused window is never
 *    re-asked by a render.
 *  - **`hrefFor(window)`** is the surface's own address for a window.
 *
 * **The guard reads the current state through a ref, never inside a
 * `setState` updater.** React 19 invokes updaters twice under StrictMode in
 * development, so a request fired from inside one is two requests from one
 * click. The ref is written at the points that publish and nowhere else.
 *
 * **THE SERVER SCREEN CAN BE RE-RENDERED UNDER IT** (admin-window/BUG-0216).
 * `useState` seeds ONCE; every read of the state goes through `continuing()`,
 * which hands back `initial` the moment the two no longer name the same
 * screen.
 */
export function usePageWindows<Row>(
  initial: PageState<Row>,
  deps: Omit<PageDeps<Row>, "fetchJson">,
): {
  state: PageState<Row>;
  goTo: (window: PageWindow) => void;
  hrefFor: (window: PageWindow) => string;
} {
  const [state, setState] = useState<PageState<Row>>(initial);
  const latest = useRef<PageState<Row>>(initial);

  const publish = (next: PageState<Row>): void => {
    latest.current = next;
    setState(next);
  };

  const request = (to: PageWindow): void => {
    const before = continuing(latest.current, initial);
    const started = pressing(before);
    // `pressing` hands back the SAME object from `loading`, so identity is
    // the guard: no publication, no request, no re-render.
    if (started === before) return;
    publish(started);
    void requestPage<Row>(before, { ...deps, fetchJson }, to).then((next) => {
      publish(next);
      sync();
    });
  };

  const sync = (): void => {
    // No address — no browser — is nothing to follow: a server render never
    // reaches here, and the offline tier drives `goTo` without one.
    const addressed = addressedWindow();
    if (addressed === null) return;
    const to = windowToDraw(continuing(latest.current, initial), windowBound(addressed));
    if (to !== null) request(to);
  };

  const hrefFor = (window: PageWindow): string => windowHref(deps, window);

  const goTo = (window: PageWindow): void => {
    pushAddress(hrefFor(window));
    request(window);
  };

  // Back and Forward: the address moved, so the surface follows it. The
  // listener reads the LATEST `sync` through a ref written in an effect —
  // never during render — so a re-render never leaves a stale closure
  // registered and no ref is read while rendering.
  const follow = useRef<() => void>(() => {});
  useEffect(() => {
    follow.current = sync;
  });
  useEffect(() => {
    const onPopState = (): void => follow.current();
    globalThis.addEventListener?.("popstate", onPopState);
    return () => globalThis.removeEventListener?.("popstate", onPopState);
  }, []);

  return { state: continuing(state, initial), goTo, hrefFor };
}

/**
 * ONE surface's paging state, published to every part of that surface that
 * states a fact about it — campaign admin-window/BUG-0172.
 *
 * The window line, the controls and the rows are three elements with the
 * page's own server-rendered children between them; nothing can hand a state
 * down that tree without the page becoming a client component, so a
 * zero-markup provider publishes it sideways: `Context.Provider` emits no
 * element, and the first server render is exactly what the page composed.
 */
interface PagingSurface<Row> {
  /** What the driver has published for this surface, after every move so far. */
  state: PageState<Row>;
  /** Move to a window: push its address, ask the route. */
  goTo: (window: PageWindow) => void;
  /** The surface's own address for a window — every control's `href`. */
  hrefFor: (window: PageWindow) => string;
  /**
   * THE WINDOW THE OPERATOR NOW HOLDS — the page's own first-screen facts
   * combined with the paging state exactly once (`continuedWindow` below), so
   * every part of the surface states a fact about the same object
   * (admin-window/BUG-0180).
   */
  window: DrawnWindow;
  /**
   * DOES THE SET END WITH THIS WINDOW — `endsHere` below, the ONE derivation
   * the line's `truncated` and the controls' "next" both read (LESSONS 11).
   */
  atEnd: boolean;
}

const PagingContext = createContext<PagingSurface<unknown> | null>(null);

/**
 * The paging state ONE surface holds, published to every part of that surface
 * that states a fact about it: the controls, the rows, and the window line.
 * It renders NO markup of its own, so the page's DOM is what the page
 * composed on the first render — the server screen for a given URL IS what
 * the client draws for it (SPEC F14, design question 3).
 */
export function PagingProvider<Row>({
  initial,
  deps,
  window: first,
  children,
}: {
  /** The first screen's own state, composed by the page (`initialPage`). */
  initial: PageState<Row>;
  /**
   * Where a move asks, the surface's own address, what it carries, and the
   * NAME of the field its rows are drawn under.
   *
   * **EVERY PROP WRITTEN ON THIS COMPONENT IS DATA** — admin-window/BUG-0226.
   * This module is `"use client"` and both callers are server pages, so React
   * serializes each of these into the flight payload; a function is the one
   * shape that cannot go, and it took both paged surfaces to HTTP 500. The
   * offline tier grades the value this component is handed
   * (`tests/fixtures/client-props.ts`).
   */
  deps: Omit<PageDeps<Row>, "fetchJson">;
  /** THE FIRST SCREEN'S WINDOW, as the page composed it — ONE object for the surface. */
  window: DrawnWindow;
  /** The page's own children, server-rendered, passed straight through. */
  children: ReactNode;
}): ReactNode {
  const driver = usePageWindows<Row>(initial, deps);
  const atEnd = endsHere(first, driver.state);
  const surface: PagingSurface<Row> = {
    ...driver,
    window: continuedWindow(first, driver.state, atEnd),
    atEnd,
  };
  return (
    <PagingContext.Provider value={surface as PagingSurface<unknown>}>
      {children}
    </PagingContext.Provider>
  );
}

/**
 * DOES THE SET END WITH THIS WINDOW — the one derivation, from the two facts
 * that can each establish it and never from a row count compared to a cap.
 *
 *  - **The READ ends it** when it came back short of its size (`exhausted`,
 *    the route's own full-or-exhausted verdict): nothing follows the rows it
 *    returned, at the instant it ran. An empty window ends it the same way.
 *  - **The COUNT ends it**, on a surface that has one (`heldFrom: "a count
 *    read"`, `/claims`), when the last row on screen reaches the count: a
 *    window holding rows 1–50 under a count of 50 is the whole set, and a
 *    "next" offered there would draw an empty window the count said was
 *    empty. The count can END the set; it cannot EXTEND it past a read that
 *    came back short — a read's "nothing more at this position" is a direct
 *    observation, and a count that says otherwise is stated beside it by the
 *    line as the count's own fact (admin-window/BUG-0174, BUG-0180). A stale
 *    count smaller than the rows drawn ends it too, exactly as the first
 *    screen always treated it: no control, each read stated as its own.
 *  - A surface with no count (`/browse`) has only the read's answer.
 */
function endsHere(first: DrawnWindow, state: PageState<unknown>): boolean {
  if (state.exhausted) return true;
  if (first.heldFrom !== "a count read") return false;
  const last = firstRowOf(state.window) + state.rows.length - 1;
  return first.held <= last;
}

/**
 * The window the operator NOW holds: the page's first-screen facts, combined
 * with the facts only the paging state knows — spelled ONCE for the surface.
 *
 *  - **`limit` is the window's size**, the cap of the read that drew it.
 *  - **`from` is where the window starts** in the order — row 1, 51, 101 …
 *  - **`drawn` is the rows on screen** — the window's own row count.
 *  - **`truncated` is `endsHere`'s verdict and nothing else** — the same one
 *    the controls read, so the hook above the rows and the "next" beside them
 *    never disagree (LESSONS 11).
 *  - **`held` is whatever the WINDOW says it counts** (`heldFrom`,
 *    admin-window/BUG-0174): a separate count read stands untouched by a move
 *    (`/claims`); a window whose `held` is its own rows is the rows on screen
 *    (`/browse`). STATED by the page, never inferred here.
 */
function continuedWindow(first: DrawnWindow, state: PageState<unknown>, atEnd: boolean): DrawnWindow {
  const drawn = state.rows.length;
  return {
    ...first,
    limit: state.window.size,
    held: first.heldFrom === "a count read" ? first.held : drawn,
    truncated: !atEnd,
    drawn,
    from: firstRowOf(state.window),
  };
}

/**
 * The surface's paging state, for the parts of it that state a fact about the
 * read the operator now holds. It throws where there is no provider rather
 * than defaulting: a paging state no read produced is the defect.
 */
export function usePaging<Row>(): PagingSurface<Row> {
  const surface = useContext(PagingContext);
  if (surface === null) {
    throw new Error("a paged surface was drawn outside its PagingProvider");
  }
  return surface as PagingSurface<Row>;
}

/**
 * The window line of a surface whose window MOVES — same element, same
 * position and the same primitive the page renders when it cannot
 * (admin-window/BUG-0172). It renders the SURFACE's window and composes
 * nothing.
 */
export function PagedWindowLine({ gauge }: { gauge: string }): ReactNode {
  const { window: surface } = usePaging();
  return <WindowLine gauge={gauge} window={surface} />;
}

/**
 * WHY THIS APP STOPPED PAGING — campaign admin-window/BUG-0178, kept under
 * windows. What stopped the paging is this app, named with its own number
 * (`MAX_PAGE_OFFSET` through the app's one thousands-separated count), stated
 * as the largest row a window may start past and never as a count of rows; then
 * what the operator can do next, WHERE THE SURFACE SUPPLIED ONE
 * (admin-window/BUG-0198). It asserts nothing about the read.
 */
function stoppedAtTheCeiling(holds: string, nextStep: string | null): string {
  const stopped =
    `This app serves no window starting past row ${count(MAX_PAGE_OFFSET + 1)} of the ${holds}, ` +
    `so paging stops here and not at the end of the set.`;
  return nextStep === null ? stopped : `${stopped} ${nextStep}`;
}

/** What one move link says, in the operator's words (copy bar 1: verb + object). */
function moveLabel(direction: "previous" | "next", size: number, holds: string): string {
  return `Show the ${direction} ${size} ${holds}`;
}

/**
 * The controls — ABOVE the list (LOOK_AND_FEEL bar 14): where this window
 * sits, how to move, and how many rows a window holds.
 *
 * Every control is a LINK whose `href` is the window's own address, so a
 * cold load, a new tab and a shared link all land on the same window the
 * server renders; a plain click is intercepted (`goTo`) so the move is one
 * bounded request against the route rather than a page load. A modified click
 * (new tab, new window) is left to the browser.
 *
 * Arms, read in this order, and the `data-paging` hook names the one drawn:
 *
 *  0. **the backing object is not in this database** — no controls at all:
 *     the refusal clause above is the whole account (admin-window/BUG-0211).
 *     No move provisions a table, so no move is offered. Nor is anything
 *     drawn where no move could change the screen (`movable` below).
 *  1. **loading** — the controls stand (a click pushes the address; the
 *     surface catches up when the request lands), marked `aria-busy`.
 *  2. **exhausted** — the set ends with this window (`endsHere`: the read
 *     came back short, or the count is reached): no "next" link, and no
 *     sentence of this element's own — the window line beside it states the
 *     verdict (LESSONS 11, one answer).
 *  3. **limit** — the next window would start past `MAX_PAGE_OFFSET`: no
 *     "next" link, and `stoppedAtTheCeiling` says what stopped it.
 *  4. **more** — a "next" link.
 *
 * "Previous" is offered on every window but the first, in every arm but 0;
 * the size selector likewise. A **refusal** renders beside the arms: it never
 * removes rows and never changes the window.
 */
export function WindowControls({
  holds,
  nextStep,
}: {
  /** What the surface holds, in the app's own noun: "claims", "events". */
  holds: string;
  /**
   * What the operator can do once this app has stopped paging at its own
   * ceiling, in the SURFACE's words — or `null` where the surface has nothing
   * to offer (admin-window/BUG-0198). Required, so a surface answers it.
   */
  nextStep: string | null;
}): ReactNode {
  const { state, atEnd, goTo, hrefFor } = usePaging();
  const unprovisioned = state.refusal !== null && state.refusal.condition === "not provisioned";
  const loading = state.status === "loading";
  const previous = previousWindow(state.window);
  const next = nextWindow(state.window);
  // CAN ANY MOVE CHANGE WHAT IS ON SCREEN? A first window the read ended
  // inside, holding no more rows than the smallest size, is the whole set
  // whatever size is chosen: every link would redraw the same rows, which is
  // a control that cannot be honoured in any way the operator can see (SPEC
  // F10's rule). Then nothing is drawn but a standing refusal.
  const movable = previous !== null || !atEnd || state.rows.length > WINDOW_SIZES[0];
  const nextServable =
    windowBound({ page: String(next.page), size: String(next.size) }).kind === "ok";
  // A "next" is offered while the set has not ended with this window
  // (`endsHere`, the provider's one verdict) and the next window is one this
  // app serves — in flight or not: a click during a move pushes the address
  // and the surface catches up when the move lands.
  const offersNext = !atEnd && nextServable;
  const arm = loading
    ? "loading"
    : atEnd
      ? "exhausted"
      : nextServable
        ? "more"
        : "limit";

  const move = (window: PageWindow) => (event: MouseEvent<HTMLAnchorElement>) => {
    // A modified click asks the browser for a new tab or window: the href is
    // the real address and the server renders it — leave it alone.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goTo(window);
  };

  // Nothing to draw at all — no refusal to state and no move that could
  // change the screen — is NO element: a wrapper around nothing would still
  // be a paging element in the markup of a surface that offers none.
  if (state.refusal === null && (unprovisioned || !movable)) return null;

  return (
    <div data-paging-controls="" className="flex flex-col gap-2">
      {state.refusal === null ? null : (
        <Refusal refusal={state.refusal} retry={() => goTo((state.refusal as PageRefusal).asked)} />
      )}
      {unprovisioned || !movable ? null : (
        <nav
          aria-label={`Windows of ${holds}`}
          aria-busy={loading || undefined}
          data-paging={arm}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1"
        >
          {previous === null ? null : (
            <a
              href={hrefFor(previous)}
              onClick={move(previous)}
              data-paging-move="previous"
              className={`type-body ${IN_PAGE_LINK}`}
            >
              {moveLabel("previous", state.window.size, holds)}
            </a>
          )}
          {offersNext ? (
            <a
              href={hrefFor(next)}
              onClick={move(next)}
              data-paging-move="next"
              className={`type-body ${IN_PAGE_LINK}`}
            >
              {moveLabel("next", state.window.size, holds)}
            </a>
          ) : !atEnd ? (
            <span data-paging-limit="" className="type-body text-ink-secondary">
              {stoppedAtTheCeiling(holds, nextStep)}
            </span>
          ) : null}
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="type-body text-ink-secondary">Rows per window</span>
            {WINDOW_SIZES.map((size) => {
              const at = containingWindow(state.window, size);
              return (
                <Chip
                  key={size}
                  label={String(size)}
                  href={hrefFor(at)}
                  active={size === state.window.size}
                  onClick={move(at)}
                  hooks={{ "data-paging-size": String(size) }}
                />
              );
            })}
          </span>
        </nav>
      )}
    </div>
  );
}

/**
 * Why the last move drew no window — the object, the reason, then what the
 * operator can do about it in the app's own voice (admin-window/BUG-0176,
 * admin-window/BUG-0175, admin-window/BUG-0196).
 *
 * A move this app could not COMPLETE is broken and reads in the broken red,
 * with a retry the operator can take: the same window, asked again. A backing
 * object that is not in this database is UNAVAILABLE and gray, in the app's
 * one spelling of state 3, with no instruction at all — nothing a move can do
 * provisions a table (admin-window/BUG-0211).
 */
function Refusal({ refusal, retry }: { refusal: PageRefusal; retry: () => void }): ReactNode {
  if (refusal.condition === "not provisioned") {
    return (
      <p data-paging-refusal="" role="alert" className="type-body text-ink-secondary">
        <NotProvisionedClause missing={refusal.missing} arrivesWith={ARRIVES_WITH} />
      </p>
    );
  }
  return (
    <p
      data-paging-refusal=""
      role="alert"
      className="flex flex-wrap items-baseline gap-2 text-broken"
    >
      <AuthoredAccount object={refusal.object} account={refusal.account} />
      <span className="type-body">
        Window {count(refusal.asked.page)} was not drawn.{" "}
        <button
          type="button"
          data-paging-retry=""
          onClick={retry}
          className={`type-body ${IN_PAGE_LINK}`}
        >
          Ask for it again
        </button>
      </span>
    </p>
  );
}
