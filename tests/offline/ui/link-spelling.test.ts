import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import { IN_PAGE_LINK } from "@/components/cycles/links";
import { codeLinesIn, sourceFiles, sourceText } from "../source-tree";
import {
  BROKEN_INK,
  CHIP_FILL,
  REJECTED_AT_REST_SPELLING,
  chipsInsideLinks,
  expectDrawnAsLinkAtRest,
  expectDrawnAsLinkAtRestIn,
  expectNotDrawnAsLink,
} from "../../fixtures/link-spelling";

/**
 * One spelling of a link, asserted over the WHOLE source tree (campaign
 * admin-window/BUG-0108).
 *
 * admin-window/BUG-0099 published the spelling — `IN_PAGE_LINK` in
 * `src/components/cycles/links.ts`, accent ink plus an underline, on the
 * element as it is SERVED — and converted three surfaces to it. Eight files
 * kept their own `transition-colors hover:text-accent`, which is a link that
 * announces itself only under the pointer: 132 of them across the Dashboard,
 * Claims, Sources, Browse and the verdict log. Per-page assertions caught none
 * of that, because a page written after them is unguarded the day it lands —
 * so the rule lives here, over the tree, in one copy (the shape
 * `ui/copy.test.ts` settled for the inter-element-space rule).
 *
 * The rule is asserted over CODE lines only: `links.ts`'s docstring quotes the
 * rejected spelling in order to document why it was rejected, and a guard that
 * cannot tell a quotation from a site would force the documentation out of the
 * file that owns the decision.
 */

/** The rejected spelling's distinguishing half — ink behind a state variant. */
const HOVER_INK = /hover:text-accent/;

/**
 * Every place `text` spells a link the rejected way, as `line: text`.
 *
 * Text in, hits out — so the rule below is proved on two fixtures rather than
 * on a probe file written into a tree that other tests are walking in parallel
 * (`source-tree.ts`, "The hazard").
 */
function hoverLinkSpellingsIn(text: string): string[] {
  return codeLinesIn(text)
    .filter((line) => HOVER_INK.test(line))
    .map((line) => line.trim());
}

describe("the guard over the source tree", () => {
  it("flags the spelling this app rejected", () => {
    // The fixture it MUST flag: the class string all eight files carried.
    expect(
      hoverLinkSpellingsIn(`<a href={href} className="${REJECTED_AT_REST_SPELLING}">x</a>`),
    ).toHaveLength(1);
  });

  it("stays green on the spelling this app publishes", () => {
    // The fixture it must NOT flag, both ways a file spells it.
    expect(hoverLinkSpellingsIn(`<a href={href} className={IN_PAGE_LINK}>x</a>`)).toEqual([]);
    expect(
      hoverLinkSpellingsIn(`<a href={href} className="type-data ${IN_PAGE_LINK}">x</a>`),
    ).toEqual([]);
  });

  it("reads a docstring quoting the rejected spelling as documentation", () => {
    expect(
      hoverLinkSpellingsIn(
        ["/**", " * These links were `text-ink hover:text-accent`, which…", " */"].join("\n"),
      ),
    ).toEqual([]);
  });

  it("is looking at the real tree, including the files that carried the defect", () => {
    // Non-vacuity: the walk that the rule below runs over reaches the eight
    // files admin-window/BUG-0108 converted, so a green rule means green code
    // and not an empty listing.
    const files = sourceFiles();
    for (const file of [
      "src/app/page.tsx",
      "src/app/claims/page.tsx",
      "src/components/browse/browse-table.tsx",
      "src/components/claims/bucket-table.tsx",
      "src/components/claims/claim-list.tsx",
      "src/components/sources/registry-table.tsx",
      "src/components/sources/trends.tsx",
      "src/components/queues/verdict-log.tsx",
    ]) {
      expect(files, `${file} is not in the walk this rule runs over`).toContain(file);
    }
  });

  it("finds no file under src spelling a link with a hover variant", () => {
    const offenders = sourceFiles().flatMap((file) =>
      hoverLinkSpellingsIn(sourceText(file)).map((hit) => `${file} — ${hit}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the assertion every page test spells this rule with", () => {
  const rejected = REJECTED_AT_REST_SPELLING.split(" ");
  const published = IN_PAGE_LINK.split(" ");

  it("rejects an anchor whose ink waits for the pointer", () => {
    expect(() => expectDrawnAsLinkAtRest(rejected, "the old spelling")).toThrow();
  });

  it("accepts an anchor drawn in the published spelling", () => {
    expect(() => expectDrawnAsLinkAtRest(published, "the published spelling")).not.toThrow();
    expect(() =>
      expectDrawnAsLinkAtRest(["type-data", ...published], "a faced link"),
    ).not.toThrow();
  });

  it("holds an error line to the decoration while leaving it its own ink", () => {
    expect(() =>
      expectDrawnAsLinkAtRestIn(
        ["type-data", "whitespace-nowrap", "text-broken", "underline"],
        BROKEN_INK,
        "a linked error line",
      ),
    ).not.toThrow();
    // Red without the underline is the defect criterion 3 names: a red string
    // that navigates, indistinguishable from a red string that does not.
    expect(() =>
      expectDrawnAsLinkAtRestIn(
        ["type-data", "whitespace-nowrap", "text-broken"],
        BROKEN_INK,
        "an unmarked error line",
      ),
    ).toThrow();
  });

  it("still says a value that goes nowhere is not a link", () => {
    expect(() => expectNotDrawnAsLink(["type-data"], "an inert value")).not.toThrow();
    expect(() => expectNotDrawnAsLink(published, "a link")).toThrow();
  });
});

describe("the rule that a badge never sits inside a link", () => {
  /*
   * LOOK_AND_FEEL, "Chips and badges": "A badge never sits inside a link, and
   * a link never wears one … any badge classifying it sits beside it, never
   * around it. Walkable: no anchor inside `main` contains a chip-filled span."
   * Earned by admin-window/BUG-0113, where a chip inside the /claims bucket
   * anchors re-inked the words and painted over the underline.
   *
   * Both fixtures, so the guard cannot pass vacuously: the shape it must flag,
   * and the shape the ruling prescribes instead.
   */
  const chip = `<span class="${CHIP_FILL.join(" ")} text-attention">high</span>`;

  it("reads the chip's fill off the component, not off a literal here", () => {
    // Non-vacuity of the derivation itself: an empty CHIP_FILL would make
    // `every` trivially true and flag every element in the tree.
    expect(CHIP_FILL.length).toBeGreaterThan(0);
    expect(CHIP_FILL.some((className) => className.startsWith("text-"))).toBe(false);
  });

  it("flags a chip that sits inside the anchor", () => {
    const $ = cheerio.load(`<p><a href="/x" class="${IN_PAGE_LINK}">open${chip}</a></p>`);
    expect(chipsInsideLinks($, $.root())).toHaveLength(1);
  });

  it("stays green when the chip sits beside the anchor, which is the ruling", () => {
    const $ = cheerio.load(
      `<p><a href="/x" class="${IN_PAGE_LINK}">open</a>${chip}</p>`,
    );
    expect(chipsInsideLinks($, $.root())).toEqual([]);
  });

  it("stays green on a link whose body is its own words", () => {
    const $ = cheerio.load(`<p><a href="/x" class="${IN_PAGE_LINK}">standing</a></p>`);
    expect(chipsInsideLinks($, $.root())).toEqual([]);
  });
});
