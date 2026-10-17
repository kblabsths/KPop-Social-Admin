"use client";

import { usePathname } from "next/navigation";

import { ErrorLine } from "@/components/ui/error-line";
import { Page } from "@/components/ui/page";

/**
 * The route-level error boundary — a NET, not a voice (campaign
 * admin-window/TASK-0082, ruled from BUG-0228).
 *
 * Next mounts this as the React error boundary around every route segment
 * below the root layout (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`),
 * so a render that THROWS — a component reading `row.name.trim()` on a
 * number, a client-boundary violation, a bug nobody predicted — lands here
 * instead of on Next's own unstyled 500. It wraps `page.tsx` and everything
 * under it and sits INSIDE `layout.tsx`, which is what keeps the Frame and
 * the sidebar drawn around it: the operator is never stranded on a bare page
 * (LOOK_AND_FEEL, the Frame).
 *
 * **What it says, and the limit on it.** Three things and no fourth: the
 * surface that could not be drawn, named by its route; the machine's own
 * token — Next's `digest`, when there is one — verbatim in the mono face; and
 * the app's fix sentence, in the app's face (LESSONS 6: the mono face belongs
 * to the machine's words, and this app's own sentence never wears it). It
 * invents no cause, quotes no stack and states no database fact, because it
 * knows none: in a production build the `error` it receives from a server
 * render carries a generic message and the digest alone (the guide above),
 * so `error.message` is never rendered — it is either a redaction or, from a
 * client render, a stack-shaped sentence nobody asked the operator to read.
 *
 * **It never replaces a refusal.** Every answer this app can NAME is still a
 * `DbResult` arm rendered as its own card by the page that read it — a
 * `not_provisioned` answer draws the not-provisioned card, a failed read
 * draws `ErrorLine` with the database's words — and `lib/db/**` still never
 * throws (ARCHITECTURE.md §4.1). No module gains a `throw` to reach this
 * file; it exists for the answer nobody classified. That is why it is built
 * from the shared refusal primitives rather than beside them: `Page` for the
 * frame and the h1, `ErrorLine` for the one red line — the same `text-broken`
 * role, `role="alert"` and `data-state="error"` hook every failed read
 * carries — so an oracle that reads the window's states reads this one too.
 *
 * No `global-error.tsx`: it replaces the root layout, which is synchronous,
 * reads no data and renders `Shell` from a path and a static nav list — there
 * is no path on which it throws, so there is nothing for a second boundary
 * to catch and a bare `<html>` of its own to justify.
 *
 * A client component because the framework requires one, and the ONLY thing
 * it takes from the client runtime is the route it is standing in
 * (`usePathname`); it fetches nothing and holds no state.
 */

/** The h1's words beside the route identifier. */
export const COULD_NOT_BE_DRAWN = "could not be drawn";

/**
 * The app's fix sentence: reload; and if it repeats, the answer this database
 * gave is one this app cannot render — which is a fact to report, not a value
 * to retype.
 */
export const RENDER_FIX =
  "Reload to draw it again. If it repeats, the answer this database gave is one this app cannot render.";

/** The app's own clause for a throw that arrived without a digest. */
export const NO_DIGEST = "no digest came with it";

/**
 * Next's `digest`, when it is a token with ink in it. A blank one is no
 * token: rendering it would put an empty mono box where a value belongs.
 */
function digestOf(error: { digest?: string }): string | null {
  return typeof error.digest === "string" && error.digest.trim() !== "" ? error.digest : null;
}

export default function RouteError({ error }: { error: Error & { digest?: string } }) {
  // `usePathname` is typed `string` inside the app router; the fallback is
  // for the compat overload Next adds when a page is rendered outside one.
  const route = usePathname() ?? "/";
  const digest = digestOf(error);

  return (
    <Page title={{ identifier: route, words: COULD_NOT_BE_DRAWN }}>
      <div data-render-failed={route}>
        <ErrorLine
          reading={route}
          failed={digest ?? NO_DIGEST}
          // Who wrote the account decides its face (LESSONS 6): the digest is
          // the machine's and renders in mono; the no-digest clause is this
          // app's and does not.
          authored={
            digest === null
              ? [{ words: NO_DIGEST, author: "this app" }]
              : [{ words: digest, author: "the machine" }]
          }
          retry={RENDER_FIX}
        />
      </div>
    </Page>
  );
}
