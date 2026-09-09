import type { CheerioAPI } from "cheerio";
import { expect } from "vitest";
import { IN_PAGE_LINK } from "@/components/cycles/links";

/**
 * "Is this drawn as a link, at rest?" — asked the same way on every surface
 * (campaign admin-window/BUG-0099).
 *
 * The app has ONE spelling of a link, `components/cycles/links.ts`'s
 * `IN_PAGE_LINK`, and this helper reads it from there rather than repeating
 * it: no test here pins a class literal, so a later change to how this app
 * draws a link moves one constant and the suite follows. What the tests below
 * assert is the property BUG-0054 bought and BUG-0099 found missing on three
 * more surfaces — that the ink and the decoration are on the element as it is
 * SERVED, not behind a `hover:`/`focus:` variant that a reader who has not
 * moved the mouse never sees.
 */

/**
 * A selection, however it was made — `$("a")`, `$(element)`, `.closest("tr")`.
 * Taken from the query function's own return type so this file names no
 * cheerio internal (the alternative in the tree casts through `never`).
 */
export type Selection = ReturnType<CheerioAPI>;

/** The classes of `IN_PAGE_LINK`, as a set to test membership against. */
const LINK_CLASSES: readonly string[] = IN_PAGE_LINK.split(/\s+/).filter(Boolean);

/** Anything that decides ink or decoration, with or without a variant prefix. */
const INK_OR_DECORATION = /^(?:[^\s]+:)?(?:text-|decoration-|underline$|no-underline$)/;

/** One element's classes, in the order it carries them. */
export function classesOf(element: Selection): string[] {
  return (element.attr("class") ?? "").split(/\s+/).filter(Boolean);
}

/** Every anchor inside `scope`, as its class list, in document order. */
export function anchorClasses($: CheerioAPI, scope: Selection): string[][] {
  return scope
    .find("a")
    .toArray()
    .map((anchor) => classesOf($(anchor)));
}

/** The type-scale face an element is drawn in — `type-body`, `type-data`, … */
export function faceOf(classes: readonly string[]): string[] {
  return classes.filter((className) => className.startsWith("type-"));
}

/** The ink half of the spelling — what separates a link from every other value. */
const LINK_INK: readonly string[] = LINK_CLASSES.filter((className) =>
  className.startsWith("text-"),
);

/**
 * The decoration half — the part EVERY link carries, whatever ink its own job
 * gives it. Only the Dashboard's error lines have a job of their own
 * (admin-window/BUG-0108, acceptance criterion 3: red is the palette's word
 * for a failed run), and they wear this half alone.
 */
const LINK_DECORATION: readonly string[] = LINK_CLASSES.filter(
  (className) => !className.startsWith("text-"),
);

/**
 * The spelling this app REJECTED, verbatim, as the eight surfaces of
 * admin-window/BUG-0108 carried it — the fixture every guard over this rule
 * must flag (LESSONS 3: a guard that never saw the defect passes vacuously).
 * Nothing in `src` may spell a link this way; the assertions below and
 * `tests/offline/ui/link-spelling.test.ts` both prove themselves against it.
 */
export const REJECTED_AT_REST_SPELLING = "transition-colors hover:text-accent";

/**
 * Assert that an element carrying `classes` reads as a link with nothing
 * hovering, focusing or clicking it.
 */
export function expectDrawnAsLinkAtRest(classes: readonly string[], what: string): void {
  expectDrawnAsLinkAtRestIn(classes, LINK_INK, what);
}

/**
 * The same claim for a link whose INK is its own palette job — the Dashboard's
 * `error_summary` anchors, which stay `text-broken` because a failed run is
 * broken, and gain the underline so a red string that navigates is told apart
 * from a red string that does not (admin-window/BUG-0108, criterion 3).
 *
 * The decoration half and the no-state-variant rule are identical; only the
 * ink the caller demands changes, so there is one implementation of "drawn as
 * a link at rest" and not two.
 */
export function expectDrawnAsLinkAtRestIn(
  classes: readonly string[],
  ink: readonly string[],
  what: string,
): void {
  for (const link of [...ink, ...LINK_DECORATION]) {
    expect(classes, `${what} is missing the app's link spelling`).toContain(link);
  }
  // The defect itself: ink or decoration parked behind a state variant, so the
  // one thing on screen that goes somewhere announces itself only under the
  // pointer.
  expect(
    classes.filter(
      (className) => className.includes(":") && INK_OR_DECORATION.test(className),
    ),
    `${what} puts its ink or decoration behind a state variant`,
  ).toEqual([]);
}

/**
 * The same claim, asked where the READER is: does the link's spelling reach the
 * glyphs on screen, or only the anchor element?
 *
 * `expectDrawnAsLinkAtRest` grades the anchor's own classes, which is the whole
 * story for an anchor whose body is text. It is not the story when the anchor
 * wraps a box that re-inks and re-fills its own contents: CSS gives a
 * descendant's `text-*` ink priority over the inherited one, and an atomic
 * inline box with a fill of its own paints over the ancestor's decoration. Such
 * an anchor MEASURES accent-plus-underline on itself while rendering exactly as
 * it did before anyone spelled it as a link.
 *
 * `overriders` is every element inside the anchor that could do that — pass
 * `anchor.find("*")` mapped through `classesOf`.
 */
export function expectLinkSpellingReachesTheGlyphs(
  anchorClasses: readonly string[],
  overriders: readonly (readonly string[])[],
  what: string,
): void {
  expectDrawnAsLinkAtRest(anchorClasses, what);
  const reInked = overriders
    .flatMap((classes) => classes.filter((className) => className.startsWith("text-")))
    .filter((className) => !LINK_INK.includes(className));
  expect(
    reInked,
    `${what} is a link whose ink never reaches the words inside it`,
  ).toEqual([]);
}

/** The ink an error line keeps while wearing the link's decoration (criterion 3). */
export const BROKEN_INK: readonly string[] = ["text-broken"];

/**
 * Assert the opposite for a value that goes nowhere — the second fixture every
 * guard needs, so "everything on the surface is a link" cannot pass this file
 * (LESSONS 3).
 *
 * The claim is about INK, not about the underline: an editable value carries a
 * hairline underline of its own at rest (admin-window/TASK-0053) and must stay
 * unconfusable with a link, which it does by staying in primary ink.
 */
export function expectNotDrawnAsLink(classes: readonly string[], what: string): void {
  expect(
    LINK_INK.filter((ink) => classes.includes(ink)),
    `${what} goes nowhere but wears the link's ink`,
  ).toEqual([]);
  expect(
    LINK_CLASSES.every((link) => classes.includes(link)),
    `${what} goes nowhere but is drawn as a link`,
  ).toBe(false);
}
