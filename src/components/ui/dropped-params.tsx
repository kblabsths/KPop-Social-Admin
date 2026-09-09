import type { ReactNode } from "react";
import { counted } from "@/lib/format";
import type { DroppedParams } from "@/lib/url/dropped-params";

/**
 * The one line beside a filter bar that says what the URL asked for and the
 * page did not do (admin-window/BUG-0123, moved here whole from
 * `src/app/claims/page.tsx` by admin-window/BUG-0141 so `/queues` renders the
 * SAME sentence from the same code rather than a copy of it).
 *
 * Priya typed `?record_id=<event id>` into the address bar, got a 200 and the
 * same 877 rows under the same sentence: "an unknown filter silently ignored,
 * with a sentence actively asserting it was applied" (`M2-usersim-priya.md`
 * §6). Dropping the parameter is right — a URL narrows only by what the page
 * offers — but a page that drops one says so, because bar 13's clause is about
 * the whole screen: "no screen claims a mark it did not draw".
 *
 * **The NAME is rendered verbatim in mono; the VALUE never is.** Voice bar 5
 * for the name; LOOK_AND_FEEL bar 3 for the value — `?bucket=in_window` is the
 * shape this line exists to answer, and echoing what the URL asked for would
 * put the parked bucket on the screen the rest of `/claims` keeps it off. So
 * no value reaches the markup by any path, and a parameter whose own NAME is a
 * word this app may not render is counted rather than spelled
 * (`droppedParams`' `neverNamed`).
 *
 * **Verbatim is safe here because of what reaches it, not because of what
 * this component does to it.** `droppedParams` spells a key only when its raw
 * characters match its renderable allowlist `^[A-Za-z0-9_.-]{1,64}$`, and
 * counts every other one through the same `withheld` arm as the parked word
 * (admin-window/BUG-0137; ARCHITECTURE.md §7, "text this app did not author
 * never sits inside a sentence this app wrote"). So the only foreign text
 * this sentence can ever contain is that class — no 0px name leaving a hole
 * where a name should be, and no bidi control from a URL reordering the words
 * around it, in the rendered page or in the text copied out of it. This
 * component scrubs nothing and must not start: a name it renders is the
 * URL's own bytes.
 *
 * It stands beside the filter bar rather than inside the sections, because it
 * is a fact of the URL and not of any read: it renders the same over an `ok`
 * read, a refusal and a table that is not there.
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1). Its
 * markup and both hooks (`data-dropped-params`, `data-dropped-param`) are the
 * ones `/claims` shipped, unchanged — `tests/offline/claims/page.test.ts` pins
 * them and did not move when this did.
 */
export function DroppedParamsLine({ dropped }: { dropped: DroppedParams }) {
  const total = dropped.named.length + dropped.withheld;
  if (total === 0) return null;
  const items: ReactNode[] = dropped.named.map((name) => (
    // `dir` is a belt, not the fix: HTML's own UA rule isolates a `dir`-bearing
    // inline box, so anything it held could reorder only itself. What keeps
    // the sentence in the order this page wrote it is the allowlist upstream
    // — by the time a name is here it is ASCII with no bidi semantics at all.
    <span key={name} dir="ltr" data-dropped-param={name} className="type-data text-ink">
      {name}
    </span>
  ));
  if (dropped.withheld > 0) {
    // Counted, not named: the word itself is one the app may not put on
    // screen, and an operator who typed it knows what they typed.
    items.push(
      `${counted(dropped.withheld, "parameter")} this page may not name`,
    );
  }
  return (
    <p data-dropped-params={String(total)} className="type-body text-ink-secondary">
      The URL carries{" "}
      {items.flatMap((item, index) =>
        index === 0
          ? [item]
          : [index === items.length - 1 ? " and " : ", ", item],
      )}
      {total === 1
        ? ", which this page did not apply: nothing below is narrowed by it."
        : ", which this page did not apply: nothing below is narrowed by them."}
    </p>
  );
}
