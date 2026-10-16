import { Fragment } from "react";

import {
  CLEAR_EYEBROW,
  CLEARED_BY,
  type ExitChoice,
  type UnchippedNarrowing,
} from "@/lib/url/narrowing";

import { Chip } from "./chip";
import { Identifier } from "./identifier";
import { Eyebrow } from "./micro-label";

/**
 * **The one way out of a narrowing, rendered: the control, and the sentence
 * that names it** — campaign admin-window/BUG-0161, shared by
 * admin-window/BUG-0164.
 *
 * Both halves live in one module on purpose. The card names this chip and the
 * chip is this row, so a page that draws one without the other either promises
 * an exit it has not built or builds one nothing points at — and the sentence
 * quotes the chip's own label (`CLEARED_BY.chip` interpolates `CLEAR_LABEL`)
 * rather than a second spelling of it.
 *
 * It is here rather than on `/claims` because two surfaces say it now:
 * `/queues` kept the advice BUG-0161 retired — widen a filter above, any row's
 * `all` chip — which is false the moment a chipless facet is set, since every
 * chip on either page carries that parameter forward, so one empty state read
 * two ways on two pages of one app (admin-window/BUG-0164).
 * A shared spelling gets imported, never retyped (LESSONS 5), and retyping is
 * exactly what produced this bug once already.
 *
 * Pure components: plain props, no fetching (ARCHITECTURE.md §4 rule 1). What
 * builds the choice they render is `clearNarrowing`, declared once in
 * `src/lib/url/narrowing.ts` and called by each surface with its own
 * unnarrowed href.
 */

/**
 * The empty card's exit sentence: the one control, then every narrowing this
 * surface renders no chip row for, so the words say both what clicking it
 * clears and why the operator could not find the narrowing that emptied the
 * surface.
 *
 * Each facet name is a machine identifier and takes the app's one identifier
 * face (`ui/Identifier`, LOOK_AND_FEEL Voice bar 5) — which is why the words
 * arrive in pieces and are assembled here, once, instead of as one string a
 * page interpolates into.
 *
 * With no control-less narrowing it is the promise alone, which is the whole
 * truth on a URL whose every facet has a chip row above it.
 */
export function ClearedBy({
  narrowings,
}: {
  /** The narrowings with no chip row, in the surface's own facet order. */
  narrowings: readonly UnchippedNarrowing[];
}) {
  return (
    <>
      {CLEARED_BY.chip}
      {narrowings.map((narrowing, index) => (
        <Fragment key={narrowing.facet}>
          {index === 0 ? CLEARED_BY.including : CLEARED_BY.and}
          <Identifier>{narrowing.facet}</Identifier>
          {index === narrowings.length - 1 ? CLEARED_BY.withNoChip : ""}
        </Fragment>
      ))}
      {CLEARED_BY.end}
    </>
  );
}

/**
 * The control itself — a row of the filter bar, not a link inside the empty
 * card, because a narrowing with no control is un-clearable in EVERY state and
 * not only the one where it emptied the surface: `?domain=zzz` narrows a page
 * that still draws rows just as thoroughly, and the operator who wants out of
 * it is on the same screen either way.
 *
 * `null` draws nothing at all: a control that clears nothing is a control that
 * lies (LOOK_AND_FEEL bar 13), so the unnarrowed page has no exit row.
 */
export function ClearRow({ clear }: { clear: ExitChoice | null }) {
  if (clear === null) return null;
  return (
    <div
      data-clear-narrowing
      role="group"
      aria-label={CLEAR_EYEBROW}
      className="flex flex-wrap items-center gap-2"
    >
      {/* The app's own words, so this eyebrow is `micro` prose and not the
          mono identifier every chip row above it carries: the row sets no
          parameter and there is no parameter name to render. */}
      <Eyebrow label={CLEAR_EYEBROW} />
      <Chip label={clear.label} href={clear.href} active={clear.active} />
    </div>
  );
}
