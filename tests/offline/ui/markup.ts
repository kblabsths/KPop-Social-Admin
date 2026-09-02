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
