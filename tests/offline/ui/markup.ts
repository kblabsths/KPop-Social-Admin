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
import * as cheerio from "cheerio";

export { createElement as h } from "react";
export { renderToStaticMarkup as render } from "react-dom/server";

/**
 * The two type steps that carry `text-transform: uppercase` in `globals.css` —
 * `micro` (the eyebrow) and `title` (page h1 and section h2). Whatever text
 * lands inside one of these elements is rewritten on screen, so these are the
 * only two the guard below has to look at, and both are named here rather than
 * in the filter so that adding a sixth step later is one edit.
 */
const UPPERCASING_STEPS = ["type-micro", "type-title"];

/**
 * Every uppercasing label in the rendered markup that has swallowed a machine
 * identifier (campaign admin-window/BUG-0049; widened from `micro` alone to
 * every uppercasing step by admin-window/BUG-0073, which found the same defect
 * in a page h1 the `micro`-only version could not see).
 *
 * The `micro` step is uppercase sans (`--text-micro` + `text-transform:
 * uppercase` in `globals.css`) and so is `title` (`--text-title`), and Voice
 * bar 5 says machine identifiers
 * "render verbatim in mono and are never prettified". Put one inside a `micro`
 * element and the browser rewrites its case: `data_conflict` reaches the
 * screen as `DATA_CONFLICT`, under a heading rendering the same value
 * correctly. So the check is STRUCTURAL — not "is this string uppercase" but
 * "did an identifier end up inside the element that uppercases" — which is
 * also what the fix does: the identifier renders as a sibling of the sans
 * span, never inside it (`src/components/ui/micro-label.tsx` for the eyebrow,
 * `src/components/ui/page.tsx` for the h1).
 *
 * An underscore is the marker, for the same reason `tests/offline/cycles`
 * already uses it on table headers (admin-window/BUG-0044): the app's own
 * words never carry one, and every identifier this window shows —
 * `data_conflict`, `entity_link`, `source_id`, `entity_link_source_pattern` —
 * does. A one-word identifier such as `ticketmaster` is invisible to it, which
 * is why the page tests also assert where those render.
 *
 * Read off the DELIVERED markup, never the source: the label may be built from
 * a template literal, from two JSX expressions or from either side of an
 * element boundary, and only the rendered string says what the operator reads.
 */
export function uppercasedIdentifiers(html: string): string[] {
  const $ = cheerio.load(html);
  return $("[class]")
    .toArray()
    .filter((element) => {
      const classes = ($(element).attr("class") ?? "").split(/\s+/);
      return UPPERCASING_STEPS.some((step) => classes.includes(step));
    })
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter((text) => text.includes("_"));
}

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

/** The mark a tag leaves behind, so an element boundary is neither a space nor a digit. */
const MARK = "\u0000";

/**
 * Words ending in `-s` that a count of one may legitimately precede, because
 * they are not plurals: singular nouns whose form ends in `s`, and the verbs
 * and function words a sentence can put after a figure.
 *
 * The set is the guard's only escape hatch and it is deliberately visible: a
 * future string that trips `disagreeingCounts` wrongly is fixed by adding the
 * word here, in a diff a reader can argue with, rather than by loosening the
 * pattern.
 */
const SINGULAR_S_WORDS = new Set([
  "across",
  "address",
  "always",
  "analysis",
  "as",
  "basis",
  "bus",
  "class",
  "does",
  "focus",
  "gas",
  "has",
  "is",
  "its",
  "less",
  "minus",
  "plus",
  "process",
  "series",
  "status",
  "this",
  "thus",
  "unless",
  "versus",
  "was",
  "yes",
]);

/**
 * Every place the rendered markup pairs the count `1` with a plural noun —
 * "1 sources", "1 items", "1 cycles" (campaign admin-window/BUG-0046,
 * LOOK_AND_FEEL Voice bar 6, "counts carry their noun").
 *
 * Read off the RENDERED text rather than the source, for the same reason
 * `runTogetherWords` is: the count and its noun may arrive from a template
 * literal, from two JSX expressions, or from either side of an element
 * boundary, and only the delivered string says what the operator reads.
 *
 * **Every tag becomes a boundary mark rather than nothing**, which is what
 * makes the guard work on a gauge card at all. A card renders its figure and
 * its sub-line as siblings, so stripping tags outright turns a figure of `1`
 * above the line "1 sources holding one" into the text `11 sources…` — and a
 * `1` preceded by a digit is exactly what this must NOT flag, since
 * `21,001 sources` and `0.1 rows` are both correct. Measured 2026-09-03: with
 * a plain strip, the very string this ticket was filed for goes unseen. The
 * mark is transparent to the count but is not whitespace, so a figure and a
 * heading in two table cells (`<td>1</td><td>sources</td>`) still do not pair.
 *
 * A word is taken for a plural when it ends in `s` and is not in
 * `SINGULAR_S_WORDS` above — this app counts none of English's irregular
 * plurals, and a guard that tried to know them all would be a worse thing to
 * trust. Each hit is returned as the two words that disagree, so a failure
 * names the string rather than only the page.
 */
export function disagreeingCounts(html: string): string[] {
  return [...html.replace(/<[^>]*>/g, MARK).matchAll(/(?<![\d,.])1\0*\s+([a-z]+s)\b/g)]
    .filter((match) => !SINGULAR_S_WORDS.has(match[1]))
    .map((match) => match[0].replace(/[\0\s]+/g, " "));
}
