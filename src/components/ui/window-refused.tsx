import type { ReactNode } from "react";

import { Identifier } from "./identifier";
import { IN_PAGE_LINK } from "../cycles/links";

/**
 * THE ADDRESS NAMED A WINDOW THIS APP DOES NOT SERVE — page windows,
 * 2026-10-16, design question 2 of the ticket.
 *
 * `/claims?page=abc`, `?size=30`, `?page=0`, `?page=3000&size=50` (past the
 * seek ceiling): the page refuses by NAME — the parameter, boxed as the
 * identifier it is, and the rule it broke in this app's words — reads no
 * list, draws no rows and offers no control, and names the one thing the
 * operator can do: open the first window. **Never a clamp**: a value this app
 * rounded to the nearest window would be a window nobody asked for, rendered
 * under an address that says otherwise.
 *
 * **The VALUE is not echoed.** A hand-typed address can carry anything — the
 * parked bucket name, a script, a credential — and this app renders no text
 * it did not write except a machine identifier it owns (common violations
 * row 15; `tests/offline/absence/in-window.test.ts` grades that no page ever
 * echoes the parked bucket, whichever parameter it arrives in). The parameter
 * name is this app's own vocabulary; the rule names the figure that was
 * missed where one was.
 *
 * It is this app's refusal and not the database's, so it is not a data-surface
 * state (`StateOf`) and carries its own hook. Red, because the request was
 * refused and nothing was drawn (LOOK_AND_FEEL, Palette: red means broken) —
 * what failed, then what to do, no apology (copy bar 3). A server-safe module:
 * both pages render it, and nothing here is a client value.
 */
export function WindowRefused({
  param,
  reason,
  firstWindowHref,
}: {
  /** The parameter refused — `page` or `size`, in the URL's own spelling. */
  param: string;
  /** Why, in this app's words (`windowBound`, `lib/paging/bounds.ts`). */
  reason: string;
  /** The address of the first window at the default size — the way back. */
  firstWindowHref: string;
}): ReactNode {
  return (
    <p
      data-window-refused={param}
      role="alert"
      className="flex flex-wrap items-baseline gap-2 text-broken"
    >
      <span className="type-body">
        The address names a window this app does not serve —{" "}
        <Identifier>{param}</Identifier>: {reason}.
      </span>
      <a href={firstWindowHref} className={`type-body ${IN_PAGE_LINK}`}>
        Open the first window
      </a>
    </p>
  );
}
