"use client";

import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { count } from "@/lib/format";
import { MAX_PAGE_OFFSET, pageBound } from "@/lib/paging/bounds";
import {
  AppAuthoredError,
  type PageDeps,
  type PageRefusal,
  type PageState,
  continuing,
  pressing,
  requestPage,
} from "@/lib/paging/machine";
import { Button } from "./button";
// The ONE drawing of a failed read's account — the object, then each run in
// its author's face (admin-window/BUG-0196). It is shared with `ErrorLine`,
// which is data-surface state 4 on every page, rather than walked a second
// time here: two copies of one rule drift, and this rule has already been
// fixed once in this family (LESSONS 5).
import { AuthoredAccount } from "./error-line";
// The app's ONE spelling of state 3's sentence, and the ONE spelling of what
// creates the objects this window reads — imported, never retyped (LESSONS 5,
// admin-window/DEBT-0003). By RELATIVE path, like `./button` and
// `./window-line`, and never through the `src/components/ui` barrel: a server
// module importing a value out of a "use client" module builds green offline
// and answers 500 in production (admin-window/BUG-0094).
import { NotProvisionedClause } from "./not-provisioned";
import { ARRIVES_WITH } from "./state-of";
import {
  type DrawnSentence,
  type DrawnWindow,
  WindowLine,
  readsAgree,
} from "./window-line";

/**
 * The paging affordance — campaign admin-window/TASK-0064, SPEC F14.
 *
 * ONE control, drawn by BOTH paged surfaces (`/claims`, `/browse`) out of this
 * one file rather than hand-copied into two pages. LESSONS 1 is why the
 * control, its inert state, its refusal line and its two end-of-the-road
 * sentences are one component and not four lines each page writes again: a
 * transient status owns its CONTENT, its PLACEMENT, its LIFETIME and its LOCK
 * together, and eleven M2 bugs came from four of those living apart.
 *
 * ## The one framed exception, and its frame
 *
 * ARCHITECTURE.md §4 rule 1, amended 2026-09-10: this is the ONLY component in
 * the repo permitted to reach the network, it calls **this app's own paging
 * route handler by a relative path** and nothing else, and it imports no
 * `lib/db/**`, no `@supabase/supabase-js` and no `process.env` — the
 * service-role client stays server-side. `fetchJson` below is the entire
 * exception, and the acceptance check counts it: exactly one network call
 * under `src/components`.
 *
 * ## Where the decisions are NOT
 *
 * Not here. Whether a press issues a request at all, what bound it carries,
 * what an answer does to the row list and what a rejection becomes are all
 * `src/lib/paging/**` — a directiveless leaf the offline suite drives directly
 * against a recording stub, because this repo's offline tier has no DOM and a
 * click handler that owns its own logic could not be tested at all. `PageMore`
 * takes plain props; `usePageRows` binds `pressing` and `requestPage` to a
 * press and publishes what they return.
 *
 * ## The client boundary
 *
 * A SERVER module importing a VALUE out of this file compiles, lints and
 * renders green offline, then answers 500 in a production build
 * (admin-window/BUG-0094). Only `PageMore` — a component, rendered and never
 * called — is re-exported through the `src/components/ui` barrel; `usePageRows`
 * and `fetchJson` are values and are imported straight from this module by the
 * client modules that need them. Everything both sides of the boundary need is
 * already in `src/lib/paging/**`, which carries no directive.
 *
 * `PagingProvider` and `PagedWindowLine` (admin-window/BUG-0172) are
 * COMPONENTS, so the two paged pages RENDER them — they are imported straight
 * from this module, the way the wrappers import `usePageRows`, and the barrel
 * is not widened by one export.
 */

/**
 * Something other than this app's own route answered the press — campaign
 * admin-window/TASK-0076.
 *
 * MEASURED: a session that expires mid-walk is answered with the login
 * redirect, FOLLOWED to an HTML page at status 200. `response.json()` then
 * rejects with the JSON parser's own `SyntaxError`, and its vocabulary ends up
 * in the refusal line as this app's account of why the press added no rows.
 *
 * So this sentence quotes NOTHING: not the content type, not the status, not a
 * byte of the body. It names what arrived — an answer from something that is
 * not this app's route — and `requestPage` names the route it asked
 * (`deps.route`, this app's own relative path) beside it.
 *
 * Exported for the offline tier; NOT re-exported through the `src/components/ui`
 * barrel — a server module importing a VALUE out of a "use client" module
 * builds green and answers 500 in production (admin-window/BUG-0094).
 */
export const ANSWERED_BY_SOMETHING_ELSE =
  "the page request was answered by something other than this app's own route, so there is no page in what came back";

/**
 * The answer DECLARED a page and carried something that is not one — campaign
 * admin-window/TASK-0076, on the same terms as its neighbour above: this app's
 * own voice, naming what arrived rather than how it failed, quoting nothing.
 *
 * A truncated document sent as `application/json` lands here. The parser's
 * words are the parser's, not this app's account of a press.
 */
export const UNREADABLE_ANSWER =
  "the page request came back declaring a page and carrying an incomplete one, so there is no page to add";

/**
 * Does this response DECLARE that it carries JSON?
 *
 * A case-insensitive `application/json`, with parameters (`; charset=utf-8`)
 * allowed and nothing else: the media type is compared to a canonical form
 * rather than against a list of spellings someone thought of (LESSONS 4).
 *
 * **`response.ok` is deliberately NOT the discriminator.** The status is not
 * the question: the route answers a refused page as a `PageAnswer` with a 400
 * to match, and that body is the operator's refusal — throwing it away for its
 * status would replace the server's reason with one this app made up. And the
 * measured defect arrives at status **200**, which a status check misses
 * entirely. The declared type is what separates "this app's route answered"
 * from "something else did".
 */
const DECLARES_JSON = /^application\/json\s*(?:;|$)/i;

function declaresJson(response: Response): boolean {
  const declared = response.headers.get("content-type");
  // No header at all is not a declaration — a proxy page and an empty body
  // both land here, and neither is this app's route answering.
  return declared !== null && DECLARES_JSON.test(declared.trim());
}

/**
 * One paging request, already parsed — the whole of §4 rule 1's exception.
 *
 * **It does not reject on a non-ok status.** The route answers a refused page
 * as a `PageAnswer` with an HTTP status to match, and that body is the
 * operator's refusal: throwing it away for its status code would replace the
 * reason the server gave with a generic one this app made up.
 *
 * **It asks what ANSWERED before it asks what the body says** (campaign
 * admin-window/TASK-0076). Unless the response declares JSON, the body is
 * never read at all and this rejects with `ANSWERED_BY_SOMETHING_ELSE`; a body
 * that declares JSON and does not parse rejects with `UNREADABLE_ANSWER`.
 * Same class as admin-window/BUG-0170 — text this app did not author inside a
 * sentence it wrote — and not covered by it: that fix is inside `errorMessage`
 * in `lib/db/result.ts`, which this path never touches.
 *
 * **It rejects only with an `Error` carrying words.** `requestPage`'s
 * `reasonOf` renders a non-`Error` rejection with `String(thrown)`, so a
 * rejection carrying `undefined` reaches the operator as the word "undefined"
 * in a refusal line. A PLATFORM rejection — the fetch itself never answering —
 * still passes its own words through (`Failed to fetch`): those are the
 * transport's account of a request that did not happen, not a foreign body
 * quoted back as ours.
 *
 * Exported so the offline tier can drive it against a stubbed global.
 */
export async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch (thrown) {
    throw asError(thrown);
  }

  // `AppAuthoredError`, not `Error`: these two sentences are THIS APP's prose,
  // and the driver reads the face off the thrown type rather than off the
  // words (admin-window/BUG-0175). Reword either sentence and nothing moves.
  if (!declaresJson(response)) throw new AppAuthoredError(ANSWERED_BY_SOMETHING_ELSE);

  try {
    return await response.json();
  } catch {
    // The parser's words stop here. What the operator reads is the app's.
    throw new AppAuthoredError(UNREADABLE_ANSWER);
  }
}

/**
 * Whatever a rejection carried, as an `Error` that has something to say.
 *
 * A transport rejection with words of its own keeps them AND keeps its type,
 * so the driver reads it as the machine talking. The last line is the one case
 * where there are no words to carry: the sentence is then THIS APP's, so it is
 * thrown as one (admin-window/BUG-0175) and reaches the operator in sans, like
 * every other sentence this app wrote.
 */
function asError(thrown: unknown): Error {
  if (thrown instanceof Error && thrown.message.length > 0) return thrown;
  if (typeof thrown === "string" && thrown.length > 0) return new Error(thrown);
  return new AppAuthoredError("the page request failed before it answered");
}

/**
 * Binds the pure driver to a press.
 *
 * Two publications per press and no logic of its own: `pressing(current)`
 * BEFORE the await, then whatever `requestPage` answers with. The state handed
 * to `requestPage` is the PRE-press one, because `requestPage` issues no
 * request from `loading` — that arm is what makes a second press free.
 *
 * **The guard reads the current state through a ref, never inside a `setState`
 * updater.** React 19 invokes updaters twice under StrictMode in development,
 * so a request fired from inside one is two requests from a single press —
 * exactly the defect the `loading` arm exists to prevent. The ref is written
 * at the two points that publish and nowhere else, so it is never mutated
 * during a render.
 *
 * **THE FIRST SCREEN CAN BE RE-RENDERED UNDER IT, AND THEN THIS STATE IS NOT A
 * CONTINUATION OF IT** (admin-window/BUG-0216). `useState` seeds ONCE and
 * ignores every later `initial`, while the surface renders the LIVE first
 * screen concatenated with these rows — so a router refresh (`next dev` fires
 * one as `[Fast Refresh]` the moment it has compiled a route handler on
 * demand) left rows paged off one order sitting under a first screen drawn
 * from another. Every read of the state goes through `continuing()`, which
 * hands back `initial` the moment the two no longer name the same bound: the
 * one the press works from, and the one the surface renders. Nothing is
 * merged and nothing is de-duplicated — the rows dropped are a window of an
 * order that is no longer on screen.
 *
 * Nothing here throws: `requestPage` turns a rejection into a refusal on the
 * next state and answers instead of raising.
 *
 * **It hands the window back out** (admin-window/BUG-0168). `deps.size` is the
 * number the driver grades a page against; `PageMore` needs the same number to
 * label the control and to ask `pageBound` whether the next press can be
 * honoured. Returning it is what lets a surface spell the window ONCE — the
 * widget's `size` prop is fed from here rather than retyped from the constant,
 * so the two copies that used to be reconciled nowhere are one value.
 */
export function usePageRows<Row>(
  initial: PageState<Row>,
  deps: Omit<PageDeps<Row>, "fetchJson">,
): { state: PageState<Row>; press: () => void; size: number } {
  const [state, setState] = useState<PageState<Row>>(initial);
  const latest = useRef<PageState<Row>>(initial);

  const publish = (next: PageState<Row>): void => {
    latest.current = next;
    setState(next);
  };

  const press = (): void => {
    // The state a press works from is the one the SURFACE is drawing: a press
    // made against a first screen this state no longer continues would ask for
    // the old screen's next bound (admin-window/BUG-0216).
    const before = continuing(latest.current, initial);
    const started = pressing(before);
    // `pressing` hands back the SAME object for `loading` and `exhausted`, so
    // identity is the guard: no publication, no request, no re-render.
    if (started === before) return;
    publish(started);
    void requestPage<Row>(before, { ...deps, fetchJson }).then(publish);
  };

  // Derived during render rather than written back into the state: a first
  // screen that changes is a fact of the PROPS, and the one place it is
  // answered is this expression, which both the press above and every consumer
  // below read.
  return { state: continuing(state, initial), press, size: deps.size };
}

/**
 * ONE surface's paging state, published to every part of that surface that
 * states a fact about it — campaign admin-window/BUG-0172.
 *
 * **The defect this exists for.** The window line of `/browse` and `/claims`
 * is the PAGE's, server-rendered above the wrapper, and a press changes the
 * rows underneath a sentence nothing can reach: with 120 rows on screen and
 * `[data-paging="exhausted"]` below them, `[data-window-truncated="true"]`
 * above still said events that arrived before them are not shown. Two answers
 * to one question, published in the hooks, which is the defect a rewording
 * could not have touched (LESSONS 11: one row, one verdict).
 *
 * **Why a context and not a prop.** The line is rendered ABOVE the rows and
 * the control below them, with the page's own server-rendered children in
 * between; nothing can hand a state down that tree without the page becoming
 * a client component. A zero-markup provider publishes it sideways instead:
 * `Context.Provider` emits no element, so the first server render of both
 * pages is byte-identical to the one they rendered before this ticket — a
 * `"use client"` component is server-rendered on the first request with the
 * very facts the page composed, and there is no second render until a press.
 */
interface PagingSurface<Row> {
  /** What the driver has published for this surface, after every press so far. */
  state: PageState<Row>;
  /** What a press does — the widget's `onPress`, and nothing else's. */
  press: () => void;
  /**
   * The window the driver grades a page against, handed back by `usePageRows`
   * so a surface spells it ONCE (admin-window/BUG-0168).
   */
  size: number;
  /**
   * THE WINDOW THE OPERATOR NOW HOLDS — the page's own first-screen facts
   * combined with the press state exactly once (`continuedWindow` below), so
   * every part of the surface that states a fact about this read states it
   * about the same object (admin-window/BUG-0180).
   */
  window: DrawnWindow;
  /**
   * Do that window's two reads agree? `readsAgree`'s verdict over the window
   * above, decided HERE and handed down already decided: the line reads it and
   * so does the control's terminal sentence, so one screen cannot answer one
   * question twice (LESSONS 11, admin-window/BUG-0180).
   */
  readsAgree: boolean;
}

/**
 * `null` is "no provider above me", which is a programming error and never a
 * state of the app — `usePaging` says so rather than rendering a surface with
 * an invented paging state.
 */
const PagingContext = createContext<PagingSurface<unknown> | null>(null);

/**
 * The paging state ONE surface holds, published to every part of that surface
 * that states a fact about it: the rows, the control, and the window line.
 *
 * It renders NO markup of its own — a context provider emits none — so the
 * page's DOM is byte-identical to today's on the first render, which is SPEC
 * F14's "the first screen does not change" (admin-window/BUG-0172).
 *
 * The page renders it around the same children in the same order it rendered
 * them before, and those children stay SERVER components: a server parent may
 * hand server-rendered JSX to a client component as `children`, so the column
 * selector and the leg notes of `/browse` do not move into the client bundle.
 *
 * It calls `usePageRows` and owns the press, so the wrapper below it stops
 * calling the hook and consumes this instead — one surface, one driver, one
 * state, which is what keeps the line and the control from disagreeing.
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
   * Where a press asks, what it carries, the window it is graded against, and
   * the NAME of the field its rows are drawn under.
   *
   * **EVERY PROP WRITTEN ON THIS COMPONENT IS DATA** — admin-window/BUG-0226.
   * This module is `"use client"` and both callers are server pages, so React
   * serializes each of these into the flight payload on the way over; a
   * function is the one shape that cannot go. It is not a warning either: the
   * page throws before any markup is produced and answers HTTP 500, which no
   * offline render can see (`renderToStaticMarkup` has no client boundary) and
   * no `tsc` or lint run can either. `deps.id` was such a function for one
   * landed commit and took `/claims` and `/browse` off the air entirely;
   * `deps.idKey` is the name that replaced it, read by the driver with
   * `readId` and by the page itself with `idAt`. The offline tier grades the
   * value this component is handed (`tests/fixtures/client-props.ts`) —
   * anything callable in `initial` or `deps` is the same 500 again.
   */
  deps: Omit<PageDeps<Row>, "fetchJson">;
  /**
   * THE FIRST SCREEN'S WINDOW, as the page composed it — ONE object for the
   * whole surface (admin-window/BUG-0172, admin-window/BUG-0180).
   *
   * The page is the only thing that knows what its `held` counts
   * (`heldFrom`), and it is the ONLY thing that may state it. What the page
   * cannot know is the press: `truncated` on a paged surface is the driver's
   * status, so the live window is combined here and nowhere else, and both the
   * line above the rows and the sentence below them read that one object.
   */
  window: DrawnWindow;
  /** The page's own children, server-rendered, passed straight through. */
  children: ReactNode;
}): ReactNode {
  const driver = usePageRows<Row>(initial, deps);
  // The surface's ONE window, and the ONE verdict over it. `readsAgree` is
  // asked here rather than by either consumer: a control that asks it of a
  // window of its own is the second comparison this ticket exists to remove.
  const live = continuedWindow(first, driver.state);
  const surface: PagingSurface<Row> = {
    ...driver,
    window: live,
    readsAgree: readsAgree(live),
  };
  return (
    <PagingContext.Provider value={surface as PagingSurface<unknown>}>
      {children}
    </PagingContext.Provider>
  );
}

/**
 * The window the operator NOW holds: the page's first-screen facts, combined
 * with the facts only the press knows — spelled ONCE for the whole surface
 * (admin-window/BUG-0172, admin-window/BUG-0180).
 *
 *  - **`truncated` is the paging state's own answer and nothing else** — no
 *    row is counted beside it. On the first render `idle` reproduces, by
 *    construction, what each page computes today: a surface is drawn paged
 *    only where its first window filled (`/browse`) or where a count said
 *    there is more (`/claims`), which are the two pages' own `truncated`.
 *    A refusal returns the driver to `idle`, so a refused press leaves this
 *    window byte-identical to the one before it, and at the bound ceiling it
 *    still says rows are not shown — because they are.
 *  - **`drawn` is what the operator now holds**, which is the driver's own
 *    `held`: the first screen plus everything appended.
 *  - **`held` is whatever the WINDOW says it counts** (`DrawnWindow.heldFrom`,
 *    admin-window/BUG-0174). A window whose `held` counts its own rows grows
 *    with the rows a press appends (`/browse`, whose line was stuck at 50
 *    under 100 rows); one whose `held` came from a separate count read stands
 *    untouched, because paging reads no row into that count (`/claims`, whose
 *    hook the live paged-walk oracle grades the walk against). It is STATED by
 *    the page that composed the facts, never inferred here: this compared
 *    `held` to `limit` and took the bigger meaning, which is one field with two
 *    meanings guessed apart by size — wrong the moment a surface's count sits
 *    under its cap, and a trap for every surface that inherits these arms.
 *
 * Nothing here compares a number to the cap, or to a row count beside it.
 */
function continuedWindow(first: DrawnWindow, state: PageState<unknown>): DrawnWindow {
  const drawn = state.held;
  return {
    ...first,
    held: first.heldFrom === "a count read" ? first.held : drawn,
    truncated: state.status !== "exhausted",
    drawn,
  };
}

/**
 * The surface's paging state, for the parts of it that state a fact about the
 * read the operator now holds — the two wrappers and `PagedWindowLine`.
 *
 * It throws where there is no provider rather than defaulting: a default would
 * be a paging state no read produced, drawn under rows some read did, and the
 * whole point of this module is that one derivation answers for the surface.
 */
export function usePaging<Row>(): PagingSurface<Row> {
  const surface = useContext(PagingContext);
  if (surface === null) {
    throw new Error("a paged surface was drawn outside its PagingProvider");
  }
  return surface as PagingSurface<Row>;
}

/**
 * The window line of a surface that may CONTINUE its window — same element,
 * same position and the same primitive the page renders when it cannot
 * (admin-window/BUG-0172).
 *
 * It renders the SURFACE's window and composes nothing: the page hands its
 * first-screen facts to `PagingProvider`, which combines them with the press
 * state once (`continuedWindow`), and the sentence below the rows reads that
 * same object. A window this component built for itself would be a second
 * spelling of those facts, which is how two elements on one screen come to
 * disagree (admin-window/BUG-0180).
 */
export function PagedWindowLine({
  gauge,
  shows,
}: {
  gauge: string;
  shows: DrawnSentence;
}): ReactNode {
  // `window:` is renamed off the global here for the same reason the provider
  // names it `first`: a bare `window` in a client module reads as the DOM's.
  const { window: surface } = usePaging();
  return <WindowLine gauge={gauge} window={surface} shows={shows} />;
}

/** What one press asks for, in the operator's words. */
function askFor(size: number, holds: string): string {
  return `Show the next ${size} ${holds}`;
}

/**
 * WHY THIS APP STOPPED PAGING, and the one thing the operator can do next —
 * campaign admin-window/BUG-0178.
 *
 * The sentence this replaces said that this VIEW showed no further rows, and
 * it was read as exhaustion: the arm beside it says "All {holds} in this view
 * are shown", the two render in the same face in the same position with no
 * control under either, and the only difference on screen was the words. An
 * operator who reached the ceiling read it as the set being finished and
 * stopped — a false totality, which ARCHITECTURE.md §4.3 exists to make
 * impossible ("a concatenation is still not a total"). It also named nothing
 * to do, against LOOK_AND_FEEL copy bar 3 ("what failed, then what to do, with
 * no apology"), and stated a fact about THIS APP in the passive voice as a
 * fact about the data. Its exact words are deliberately not quoted anywhere in
 * this file: this ticket's checks grade their absence from it (LESSONS 12).
 *
 * So the two halves, in that order:
 *
 *  - **what stopped the paging is this app**, named as this app and given the
 *    app's own number — `MAX_PAGE_OFFSET`, imported rather than retyped
 *    (LESSONS 5) and rendered through the app's one thousands-separated count.
 *    It is stated as what it IS, the largest BOUND this app serves, and never
 *    as a count of rows on screen: the surface at the ceiling holds one window
 *    MORE than the ceiling (100,050 under a bound ceiling of 100,000), so a
 *    sentence calling it a row count would disagree with the line beside it.
 *    Naming the app's refusal out loud is §4.3 read kind 3 — "refused with the
 *    reason named — never clamped in silence";
 *  - **what the operator can do next, WHERE THE SURFACE SUPPLIED ONE** — the
 *    `nextStep` prop, and never a word this file chose
 *    (admin-window/BUG-0198). The noun this arm reads was always per-surface;
 *    the next step is too, and this module cannot know it. `/claims` carries
 *    facet chips, so narrowing really is how that surface is worked and it
 *    supplies that sentence itself (`../claims/paged-claim-list.tsx`);
 *    `/browse` has one parameter, `columns`, which "chooses which COLUMNS
 *    render and never which rows are read" (`src/app/browse/page.tsx`), so it
 *    supplies NONE and the arm ends on the half above. A next step kept here
 *    as a default and opted out of by the surfaces that cannot honour it is
 *    ruled out (architect, 2026-09-11): a surface added later would inherit
 *    advice nobody checked it can take, which is this defect with a longer
 *    fuse. Whatever a surface supplies, it is deliberately not "press it
 *    again": no control is drawn here (LESSONS 1, CONTENT — the fix is never
 *    wishful).
 *
 * **It asserts nothing about the read**, which is the rule both terminal
 * sentences of this file are written under (architect, 2026-09-11): the
 * exhausted arms say what the READ established, and this arm is the one case
 * where the read established nothing at all, so the sentence is about the app.
 * That is also what keeps it off the window line's closing clause — the line
 * states the WINDOW's verdict (what the read came back with) and this states
 * the CONTROL's (that this app has stopped asking), so one screen never
 * answers one question twice (LESSONS 11, the stutter
 * `./window-line`'s `THE_READ_FOUND_NO_MORE` names).
 */
/**
 * THE LIST MOVED UNDER THE OPERATOR, SAID ONCE, IN CLIENT-LAND — campaign
 * admin-window/BUG-0222.
 *
 * A press asks for a POSITION in an order the route re-reads when the press
 * arrives. A row inserted ahead of that position in between moves every later
 * row down one, so the page comes back beginning with rows the operator is
 * already looking at. The driver refuses to draw one id twice
 * (`src/lib/paging/machine.ts`, rule 8) — and a silent drop would hide the one
 * fact that matters, which is not that this app dropped a row but that the
 * rows on screen are not the rows the route is paging.
 *
 * So the driver publishes the FACT (`state.overlapped`) and this file says it,
 * because this is where every other word of the paging area lives (LESSONS 5).
 * Three properties it is written to keep:
 *
 *  - **It is about the PRESS, so it renders only after one.** `initialPage`
 *    publishes `overlapped: false`, so the first server render of both paged
 *    surfaces is byte-identical to the one before this ticket (M3 EC4), and
 *    the hook below is absent from it.
 *  - **It claims nothing about the run.** It does not say the list is
 *    complete, does not say it is contiguous, and says nothing about the rows
 *    a moving order may have carried PAST the bound — that is the skip, which
 *    is admin-window/BUG-0221's and is not fixed here. It reports what this
 *    press met and what the operator can do.
 *  - **It is a notice, not a breakage.** Nothing failed: the route answered,
 *    the app drew what it could honour. So it takes the secondary ink every
 *    other terminal sentence here takes, never the broken red, and it is
 *    announced politely (`role="status"`) rather than as an alert
 *    (LOOK_AND_FEEL, Palette — red means broken).
 *
 * The noun is the SURFACE's own word, like every other sentence in this
 * element; the wording is the designer's to grade at the walk.
 */
function movedUnderYou(holds: string): string {
  return (
    `The ${holds} in this view moved while it was open, so this press answered with ` +
    `${holds} already on screen and they were not drawn again. ` +
    `Reload this view to read it as it now stands.`
  );
}

function stoppedAtTheCeiling(holds: string, nextStep: string | null): string {
  const stopped =
    `This app serves no bound past ${count(MAX_PAGE_OFFSET)} ${holds}, so paging stops ` +
    `here and not at the end of the set.`;
  return nextStep === null ? stopped : `${stopped} ${nextStep}`;
}

/**
 * The affordance itself: the control, the refusal, and the two sentences that
 * replace a control nothing could honour.
 *
 * Five states, drawn from props alone, in this order — plus the one arm that
 * draws nothing at all (0), which is read ahead of every other:
 *
 *  0. **the backing object is not in this database** — no control and no
 *     sentence of this element's own: the refusal clause above it is the
 *     whole account (admin-window/BUG-0211). It is read FIRST because it is
 *     the one condition under which neither sentence below is true — the set
 *     did not run out and this app did not stop at its own ceiling; the
 *     object the surface pages is simply not there, and no press provisions
 *     one. **The affordance is drawn only where a press could be honoured**,
 *     which is M3 EC5's heading and SPEC F14's rule, applied to the one arm
 *     whose text already offers no press.
 *  1. **exhausted** — no control, and one sentence: the read that continues
 *     this view came back with nothing more. **This arm is read BEFORE arm 2
 *     and the order is load-bearing** (admin-window/BUG-0168): a legitimate
 *     final page is short, so an exhausted state's `held` may sit off the grid
 *     `pageBound` enforces (80 against a window of 50) — honestly so, because
 *     there is no next bound to honour. Read in the other order it would draw
 *     arm 2 and tell the operator that this app stopped at its own ceiling,
 *     about a set the read established IS complete.
 *
 *     **WHICH terminal sentence is the WINDOW's verdict, handed in already
 *     decided** (admin-window/BUG-0180). Where the surface's two reads agree,
 *     every row the count found is on screen and the set really is complete —
 *     the sentence says so, in the words it has always said it in. Where they
 *     DISAGREE — `/claims` counts the matching set and draws its rows in two
 *     separate reads, so a claim resolved between them ends the set short of
 *     the count — no single read established completeness, and this element is
 *     the one an operator acts on (it REPLACES the control; there is nothing
 *     left to press). It then says what the read did establish and no more,
 *     while the window line three lines above states each read as its own.
 *  2. **the next bound cannot be honoured** — no control either, and one
 *     sentence that does NOT claim the set is finished: `stoppedAtTheCeiling`
 *     below, which names THIS APP as what stopped and what the operator can
 *     do next (admin-window/BUG-0178). Past `MAX_PAGE_OFFSET` a bound refusal
 *     returns the state to `idle` by design (the driver's rule 4), so without
 *     this arm the surface would draw a control every press is refused for,
 *     forever — precisely what SPEC F10 forbids. `pageBound` is the one place
 *     that answers the question and it is asked here, of the bound the NEXT
 *     press would carry.
 *  3. **loading** — the same control, inert. A second press cannot happen from
 *     the markup, and cannot happen from the driver either.
 *  4. **idle** — the control.
 *
 * A **refusal** is orthogonal to the four arms below it and renders beside
 * them: it never removes rows and never changes the bound. It leaves the
 * control alone in every condition but one — a refused bound and a failed
 * read are retryable at the same bound, so their control and their "Press it
 * again" sentence stand; a backing object that is not in this database is not
 * retryable by anything, and arm 0 above withdraws the control for that one
 * condition alone (admin-window/BUG-0211). It is drawn here, and not
 * with `ErrorLine`, because `ErrorLine` carries `data-state="error"` — the
 * marker a live oracle grades as a FAILED PAGE READ (admin-window/TASK-0032) —
 * and a page that refused ONE further window is not a page whose read failed.
 */
export function PageMore({
  state,
  holds,
  size,
  readsAgree: agree,
  nextStep,
  onPress,
}: {
  state: PageState<unknown>;
  /** What the surface holds, in the app's own noun: "claims", "events". */
  holds: string;
  /**
   * The window's size — what one press asks for, and the grid the next bound
   * must sit on. It comes from `usePageRows`, which hands back the very number
   * the driver graded the last page against; it is never retyped beside it.
   */
  size: number;
  /**
   * Do this surface's two reads agree — `readsAgree` (`./window-line`) over
   * the ONE window the page composed, DECIDED ELSEWHERE and handed here as a
   * verdict (admin-window/BUG-0180).
   *
   * This component compares no count, no row count and no `held` to anything:
   * its only arithmetic is the bound question below, which is `pageBound`'s.
   * It is a required prop rather than a defaulted one because the defect it
   * closes was precisely a sentence asserting a fact the control did not hold:
   * a surface that has not decided this has nothing for this element to say.
   */
  readsAgree: boolean;
  /**
   * WHAT THE OPERATOR CAN DO NEXT once this app has stopped paging, in the
   * SURFACE's words — or `null` where this surface has nothing to offer
   * (admin-window/BUG-0198).
   *
   * It is read by one arm only, the bound ceiling below, and it is a REQUIRED
   * prop rather than a defaulted one for the same reason `readsAgree` is: a
   * default would be advice this module chose on behalf of a surface it knows
   * nothing about. Only the surface knows whether its own URL can remove a
   * row — `/claims` has facet chips and says so, `/browse` has `columns`,
   * which changes which columns render and never which rows are read, and
   * says nothing — so a surface that has not answered the question has
   * nothing for this element to say on its behalf, and `null` is that answer
   * written down rather than forgotten.
   *
   * The wording is the surface's too: this file compares it to nothing,
   * appends it verbatim, and every other arm ignores it.
   */
  nextStep: string | null;
  onPress: () => void;
}): ReactNode {
  const exhausted = state.status === "exhausted";
  const nextBound = pageBound(String(state.held), size);
  // THE BACKING OBJECT IS NOT IN THIS DATABASE — admin-window/BUG-0211.
  //
  // The state's own published fact, read and never re-derived: a press asked
  // for the next window and the answer said the object it reads is not here.
  // No bound, no retry and no press of any kind provisions a table, so there
  // is nothing this control could ask for — which is why the clause beside it
  // deliberately offers no fix (`Refusal` below).
  const unprovisioned = state.refusal !== null && state.refusal.condition === "not provisioned";
  const drawsControl = !exhausted && !unprovisioned && nextBound.kind === "ok";
  const label = askFor(size, holds);

  return (
    <div className="flex flex-col gap-2">
      {state.refusal === null ? null : (
        // The fix a refusal offers is only ever one the operator can take, so
        // it is decided by whether a control is DRAWN and not by the status
        // alone: "press it again" beside no control is an instruction to press
        // nothing (LESSONS 1, CONTENT — the fix is never wishful).
        <Refusal refusal={state.refusal} retryable={drawsControl} />
      )}
      {state.overlapped ? (
        // ONE element, whatever the surface and however many presses met an
        // overlap: the fact is the state's and the state holds it once
        // (admin-window/BUG-0222). It renders beside every arm below, exactly
        // as a refusal does — a list that moved under the operator moved
        // whether the next press is offered, refused or exhausted.
        <p data-paging-overlap="" role="status" className="type-body text-ink-secondary">
          {movedUnderYou(holds)}
        </p>
      ) : null}
      {unprovisioned ? (
        // A PAGING AFFORDANCE IS NEVER DRAWN WHERE IT CANNOT BE HONOURED
        // (M3 EC5, SPEC F14's "a control that cannot be honoured is never
        // drawn") — and here nothing replaces it either. The clause above IS
        // the account: it names the object that is missing and what creates
        // it, and a second sentence under it could only claim something that
        // did not happen — that the set ran out, or that this app stopped at
        // its own ceiling. So this arm draws NOTHING.
        //
        // It is read FIRST, ahead of both of those arms, for exactly that
        // reason: whatever else this state holds, the surface has just learned
        // the object it pages is not in this database, and that is the fact
        // the operator is owed. (The driver leaves every refusal `idle`, so
        // this never displaces a real exhaustion; the ordering is what keeps
        // the rule total rather than a race between two arms.)
        null
      ) : exhausted ? (
        agree ? (
          // One read established that every row the surface counted is on
          // screen, so the set IS complete and the sentence says so — the
          // words this arm has always said, to the byte.
          <p data-paging="exhausted" className="type-body text-ink-secondary">
            All {holds} in this view are shown.
          </p>
        ) : (
          // No single read established completeness, so nothing here claims
          // it: what the READ came back with is all this sentence may say
          // (LESSONS 2, admin-window/BUG-0180). The window line beside it
          // states each of the two reads as its own.
          <p data-paging="exhausted" className="type-body text-ink-secondary">
            The read returned no further {holds}.
          </p>
        )
      ) : !drawsControl ? (
        // The app refusing, said in the app's own voice: what stopped the
        // paging, then what this SURFACE offers to do about it, where it
        // offers anything (admin-window/BUG-0178, admin-window/BUG-0198). One
        // expression, so no transform can drop a space inside the sentence.
        <p data-paging="limit" className="type-body text-ink-secondary">
          {stoppedAtTheCeiling(holds, nextStep)}
        </p>
      ) : (
        // `self-start` is the whole of the shape fix (admin-window/BUG-0177):
        // this wrapper is a flex column, whose default `align-items: stretch`
        // sized the control by the content column rather than by its label —
        // 1216px at 1440, a hairline-bordered, centre-labelled slab reading as
        // a banner, and by area the loudest control on a page where it is
        // correctly the SECONDARY one. The override sits on the ITEM and not
        // on the container on purpose: the refusal line and the two terminal
        // sentences above are paragraphs that must keep filling the column and
        // wrapping in it, so the container keeps stretching them while the one
        // child that must be intrinsic opts out. Nothing about the Button
        // primitive moves — the width was never its doing, and every other
        // call site renders exactly as it did.
        <Button
          className="self-start"
          data-paging={state.status === "loading" ? "loading" : "more"}
          disabled={state.status === "loading"}
          onClick={onPress}
        >
          {label}
        </Button>
      )}
    </div>
  );
}

/**
 * Why the last press added no rows — the object, the reason, then what the
 * operator can do about it in the app's own voice, in that order.
 *
 * ## Two conditions, and only one of them is breakage (admin-window/BUG-0176)
 *
 * A press this app could not COMPLETE is broken and reads in the broken red.
 * A backing object that is not in this database is UNAVAILABLE, and
 * LOOK_AND_FEEL is explicit: "red means broken, never unavailable. A missing
 * backing table is gray." MEASURED defect — the wrapper carried `text-broken`
 * on every arm, so the one arm about absence was painted as breakage, said its
 * object twice (`pending_claims — pending_claims is not …`), never said what
 * fills it, and closed with "Press it again to ask for the same rows." for a
 * table no press can create.
 *
 * So the absent arm renders the app's ONE spelling of data-surface state 3
 * (`NotProvisionedClause`, `./not-provisioned` — the same clause the card
 * renders), in the card's own `text-ink-secondary`, with the object inside the
 * `<Identifier>` box that clause carries and NO instruction at all: the half
 * of copy bar 3 that says what to do is the clause naming what creates it,
 * because there is nothing here for the operator to press. Everything else
 * about the line is unchanged — the marker, the role, and the rule that a
 * refusal appends no row and moves no bound.
 *
 * **And since admin-window/BUG-0211 there is no control under it either.**
 * This arm said there was nothing to press while the widget beneath it still
 * offered one, enabled, with its label unmoved (measured on a production build
 * against staging, 2026-09-11): the sentence and the affordance disagreed
 * about whether anything was left to ask for. `PageMore`'s arm 0 is where that
 * is answered — the fact is the state's, so the element that draws controls
 * reads it rather than this line growing a second rule.
 *
 * ## The face says who is talking (admin-window/BUG-0175)
 *
 * Mono carries every value the database produced; sans carries every word the
 * app wrote, and that split is enforced by which primitive you use, not by
 * remembering (LOOK_AND_FEEL → Typography; ARCHITECTURE.md §7). This line used
 * ONE mono span for both authors, so the app's own 22-word sentence about a
 * page it could not read claimed an authorship it does not have and sat in the
 * same 11px mono red run as a Postgres timeout string.
 *
 * The refusal's `account` is the whole derivation, and it is DECIDED ELSEWHERE
 * — at `refuse()` in `src/lib/paging/machine.ts` for the arms this app writes,
 * and one seam further back in `src/lib/db/result.ts` for a failed read's,
 * where each clause is authored. This component compares no string to
 * anything: reword any of those sentences and no face moves.
 *
 * **Since admin-window/BUG-0196 the split is drawn by `AuthoredAccount`**
 * (`./error-line`), the same component `ErrorLine` draws it with, off the same
 * one run-splitting derivation — because a failed READ's account can carry
 * BOTH authors in one line: the database's words beside this app's counted
 * clause about a part it refused to quote. One arm with two faces is not a
 * second rule; it is the same rule over a list.
 *
 * What does NOT change with the face: the object is a machine identifier and
 * stays in the `data` mono step in every arm, the em dash still separates it
 * from the reason, and the fix still comes last in sans. The object may be
 * `null` — a bound refusal is about the bound this state already holds, so
 * there is no third thing to name — and a line with nothing to name gets the
 * reason alone rather than a dangling em dash, asked of the app's one
 * definition of absence (`isAbsent`, `lib/format`).
 *
 * `dir="ltr"` isolates the runs this app did NOT author (ARCHITECTURE.md §7),
 * and it isolates exactly those: the identifier always, plus each run the
 * machine wrote. A sentence this app wrote needs no isolation from itself.
 */
function Refusal({
  refusal,
  retryable,
}: {
  /** The FACTS the driver published — never re-derived here. */
  refusal: PageRefusal;
  retryable: boolean;
}): ReactNode {
  if (refusal.condition === "not provisioned") {
    // Gray from the card's own token, the object in its own isolated box
    // exactly once, what creates it in the app's one spelling, and no fix the
    // operator cannot take.
    return (
      <p data-paging-refusal="" role="alert" className="type-body text-ink-secondary">
        <NotProvisionedClause missing={refusal.missing} arrivesWith={ARRIVES_WITH} />
      </p>
    );
  }

  const fix = retryable
    ? "Press it again to ask for the same rows."
    : "Reload this view to read it again.";
  return (
    <p
      data-paging-refusal=""
      role="alert"
      className="flex flex-wrap items-baseline gap-2 text-broken"
    >
      <AuthoredAccount object={refusal.object} account={refusal.account} />
      <span className="type-body">{fix}</span>
    </p>
  );
}
