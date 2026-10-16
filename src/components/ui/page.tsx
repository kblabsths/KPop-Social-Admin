import type { ReactNode } from "react";
import { type MicroLabel, microLabelText } from "./micro-label";

/**
 * A page: the h1 in `title` type, 16px padding, 16px between sections.
 * LOOK_AND_FEEL: `title` is page h1 and section h2, nothing else.
 *
 * **A title may carry a machine identifier, and then it is two things rather
 * than one string** (campaign admin-window/BUG-0073). `type-title` is sans
 * with `text-transform: uppercase`, so a title built by concatenating a
 * machine name with English — `` `${config.table} record` `` on
 * `/records/[table]/[id]` — reaches the screen as `WALK_SANDBOX RECORD`, three
 * lines above the same page rendering the row id in mono at its own case.
 * Voice bar 5: identifiers "render verbatim in mono and are never prettified
 * into Title Case prose".
 *
 * The remedy is the structural one `Eyebrow` already landed for the `micro`
 * step (admin-window/BUG-0049, `./micro-label.tsx`): keep the identifier OUT
 * of the element that uppercases. So a title is either
 *
 *  - a plain `string` — the app's own words, rendered exactly as every caller
 *    already had it, `type-title` on the h1 itself and no wrapper — or
 *  - an `{ identifier, words }` pair, where the identifier renders verbatim in
 *    the `data` mono step (`normal-case tracking-normal` hold even if this
 *    h1 is ever nested inside an uppercasing ancestor) and only the app's
 *    `words` get `type-title`.
 *
 * It takes `MicroLabel`, the eyebrow's own type, deliberately: "an identifier
 * optionally qualified by the app's words" is one idea, and a second copy of
 * it here would drift from the first. `microLabelText` is what joins the two
 * halves for any caller that needs the title as a string.
 *
 * The h1's accessible name is unchanged either way — `walk_sandbox record`,
 * both halves, in reading order, separated by **a real text node** and not a
 * flex gap, which is invisible to everything that reads text (the
 * `stuck_patterndial` collision of admin-window/BUG-0045).
 */
export function Page({
  title,
  actions,
  children,
}: {
  title: MicroLabel;
  /** At most one primary Button per screen (LOOK_AND_FEEL, Buttons). */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <PageTitle title={title} />
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The h1. One element for the app's words; for an identifier, an h1 that
 * carries no type step of its own and two spans that do — because the check
 * that matters ("no `type-title` element contains the identifier") is about
 * the element's whole subtree, so `type-title` on the h1 with a mono span
 * inside it would still uppercase nothing but would still be the same defect
 * one DOM level up.
 */
function PageTitle({ title }: { title: MicroLabel }) {
  if (typeof title === "string") {
    return <h1 className="type-title text-ink">{title}</h1>;
  }
  return (
    <h1 className="text-ink">
      <span className="type-data normal-case tracking-normal">{title.identifier}</span>
      {title.words === undefined ? null : (
        <>
          {" "}
          <span className="type-title">{title.words}</span>
        </>
      )}
    </h1>
  );
}

/** The title as plain text — the h1's reading order, for an accessible name. */
export const pageTitleText = microLabelText;
