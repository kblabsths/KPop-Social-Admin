"use client";

import { type ReactNode, useRef, useState } from "react";
import { EM_DASH, isAbsent } from "@/lib/format";
import { pageBound } from "@/lib/paging/bounds";
import {
  type PageDeps,
  type PageState,
  pressing,
  requestPage,
} from "@/lib/paging/machine";
import { Button } from "./button";

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
 */

/**
 * One paging request, already parsed — the whole of §4 rule 1's exception.
 *
 * **It does not reject on a non-ok status.** The route answers a refused page
 * as a `PageAnswer` with an HTTP status to match, and that body is the
 * operator's refusal: throwing it away for its status code would replace the
 * reason the server gave with a generic one this app made up.
 *
 * **It rejects only with an `Error` carrying words.** `requestPage`'s
 * `reasonOf` renders a non-`Error` rejection with `String(thrown)`, so a
 * rejection carrying `undefined` reaches the operator as the word "undefined"
 * in a refusal line. A body that is not JSON — an HTML error page, an empty
 * body — already rejects with a `SyntaxError`, which has words; anything else
 * that a client, a proxy or a stub can throw is given the app's own sentence
 * here rather than downstream.
 *
 * Exported so the offline tier can drive it against a stubbed global.
 */
export async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    return await response.json();
  } catch (thrown) {
    throw asError(thrown);
  }
}

/** Whatever a rejection carried, as an `Error` that has something to say. */
function asError(thrown: unknown): Error {
  if (thrown instanceof Error && thrown.message.length > 0) return thrown;
  if (typeof thrown === "string" && thrown.length > 0) return new Error(thrown);
  return new Error("the page request failed before it answered");
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
 * Nothing here throws: `requestPage` turns a rejection into a refusal on the
 * next state and answers instead of raising.
 */
export function usePageRows<Row>(
  initial: PageState<Row>,
  deps: Omit<PageDeps, "fetchJson">,
): { state: PageState<Row>; press: () => void } {
  const [state, setState] = useState<PageState<Row>>(initial);
  const latest = useRef<PageState<Row>>(initial);

  const publish = (next: PageState<Row>): void => {
    latest.current = next;
    setState(next);
  };

  const press = (): void => {
    const before = latest.current;
    const started = pressing(before);
    // `pressing` hands back the SAME object for `loading` and `exhausted`, so
    // identity is the guard: no publication, no request, no re-render.
    if (started === before) return;
    publish(started);
    void requestPage<Row>(before, { ...deps, fetchJson }).then(publish);
  };

  return { state, press };
}

/** What one press asks for, in the operator's words. */
function askFor(size: number, holds: string): string {
  return `Show the next ${size} ${holds}`;
}

/**
 * The affordance itself: the control, the refusal, and the two sentences that
 * replace a control nothing could honour.
 *
 * Five states, drawn from props alone, in this order:
 *
 *  1. **exhausted** — no control, and one sentence saying this view holds no
 *     more. The set really is finished; the read said so.
 *  2. **the next bound cannot be honoured** — no control either, and one
 *     sentence that does NOT claim the set is finished. Past
 *     `MAX_PAGE_OFFSET` a bound refusal returns the state to `idle` by design
 *     (the driver's rule 4), so without this arm the surface would draw a
 *     control every press is refused for, forever — precisely what SPEC F10
 *     forbids. `pageBound` is the one place that answers the question and it
 *     is asked here, of the bound the NEXT press would carry.
 *  3. **loading** — the same control, inert. A second press cannot happen from
 *     the markup, and cannot happen from the driver either.
 *  4. **idle** — the control.
 *
 * A **refusal** is orthogonal to all four and renders beside them: it never
 * removes rows, never changes the bound, and never removes the control, since
 * a refused page is retryable at the same bound. It is drawn here, and not
 * with `ErrorLine`, because `ErrorLine` carries `data-state="error"` — the
 * marker a live oracle grades as a FAILED PAGE READ (admin-window/TASK-0032) —
 * and a page that refused ONE further window is not a page whose read failed.
 */
export function PageMore({
  state,
  holds,
  size,
  onPress,
}: {
  state: PageState<unknown>;
  /** What the surface holds, in the app's own noun: "claims", "events". */
  holds: string;
  /** The window's size — what one press asks for. */
  size: number;
  onPress: () => void;
}): ReactNode {
  const exhausted = state.status === "exhausted";
  const nextBound = pageBound(String(state.held), size);
  const drawsControl = !exhausted && nextBound.kind === "ok";
  const label = askFor(size, holds);

  return (
    <div className="flex flex-col gap-2">
      {state.refusal === null ? null : (
        // The fix a refusal offers is only ever one the operator can take, so
        // it is decided by whether a control is DRAWN and not by the status
        // alone: "press it again" beside no control is an instruction to press
        // nothing (LESSONS 1, CONTENT — the fix is never wishful).
        <Refusal
          reason={state.refusal.reason}
          object={state.refusal.object}
          retryable={drawsControl}
        />
      )}
      {exhausted ? (
        <p data-paging="exhausted" className="type-body text-ink-secondary">
          All {holds} in this view are shown.
        </p>
      ) : !drawsControl ? (
        <p data-paging="limit" className="type-body text-ink-secondary">
          This view shows no further rows.
        </p>
      ) : (
        <Button
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
 * Why the last press added no rows — both halves, the way every refusal in
 * this app is written: the object and the words the answer itself carried,
 * then what the operator can do about it in the app's own voice.
 *
 * The object may be `null` — a bound refusal is about the bound this state
 * already holds, so there is no third thing to name — and a line with nothing
 * to name gets the reason alone rather than a dangling em dash, asked of the
 * app's one definition of absence (`isAbsent`, `lib/format`).
 *
 * `dir="ltr"` isolates the foreign run: the reason and the object are the
 * answer's own text, and text this app did not author never reorders a
 * sentence this app wrote (ARCHITECTURE.md §7).
 */
function Refusal({
  reason,
  object,
  retryable,
}: {
  reason: string;
  object: string | null;
  retryable: boolean;
}): ReactNode {
  const named = object !== null && !isAbsent(object);
  return (
    <p
      data-paging-refusal=""
      role="alert"
      className="flex flex-wrap items-baseline gap-2 text-broken"
    >
      <span className="type-data" dir="ltr">
        {named ? `${object} ${EM_DASH} ${reason}` : reason}
      </span>
      <span className="type-body">
        {retryable
          ? "Press it again to ask for the same rows."
          : "Reload this view to read it again."}
      </span>
    </p>
  );
}
