/**
 * Rendering helpers shared by the primitive tests (campaign admin-window,
 * TASK-0004).
 *
 * The offline project's include glob is `tests/offline/**\/*.test.ts`
 * (tests/suite-globs.ts), so test files are `.ts` and build elements with
 * `createElement` rather than JSX. `h` keeps that readable.
 *
 * Primitives are rendered with `react-dom/server` — no jsdom, no extra
 * dependency — which is exactly the environment they run in, since every one
 * of them is a synchronous server component.
 */
export { createElement as h } from "react";
export { renderToStaticMarkup as render } from "react-dom/server";

/** Every class name the markup emits, in document order, deduplicated per attribute. */
export function classesOf(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)]
    .flatMap((match) => match[1].split(/\s+/))
    .filter(Boolean);
}

/** The tag names the markup emits, in document order. */
export function tagsOf(html: string): string[] {
  return [...html.matchAll(/<([a-z][a-z0-9]*)[\s/>]/g)].map((match) => match[1]);
}

/** The text content, with tags stripped — for order assertions, never for wording. */
export function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Every place the rendered markup runs two words together across an element
 * boundary — a closing tag with a letter or digit hard against it
 * (campaign admin-window/BUG-0045).
 *
 * This exists because the SOURCE is not evidence. JSX drops whitespace whose
 * run contains a newline, so `</span>` at the end of one line and ` dial` at
 * the start of the next reads as `stuck_patterndial` on screen while the file
 * plainly shows a space. Only the rendered string tells the truth, and only a
 * reformatting away from the fix. Each hit is returned as the closing tag plus
 * the characters that collided with it, so a failure names the site.
 *
 * Punctuation is not a hit: `<span>x</span>,` and `</span>.` are correct
 * typography, and `</td><td>` has no text at all.
 */
export function runTogetherWords(html: string): string[] {
  return [...html.matchAll(/<\/(span|a|b|em|strong|code)>[A-Za-z0-9]+/g)].map(
    (match) => match[0],
  );
}

/**
 * Every factory ticket id the rendered markup carries (campaign
 * admin-window/BUG-0045). The operator has no tracker to open, so a build id
 * on screen is copy that cannot be acted on; comments in `src/` may keep
 * citing them, and comments do not reach the browser.
 */
export function factoryTicketIds(html: string): string[] {
  return [
    ...html.matchAll(/admin-window\/[A-Z]+-\d+|\b(?:TASK|BUG|DEBT|DEP)-\d{4}\b/g),
  ].map((match) => match[0]);
}
