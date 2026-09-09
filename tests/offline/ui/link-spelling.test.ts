import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { IN_PAGE_LINK } from "@/components/cycles/links";
import { codeLinesIn, sourceFiles, sourceText } from "../source-tree";
import { stubClient, type Script } from "../../fixtures/stub-client";
import {
  BROKEN_INK,
  CHIP_FILL,
  REJECTED_AT_REST_SPELLING,
  chipsInsideLinks,
  classesOf,
  expectDrawnAsLinkAtRest,
  expectDrawnAsLinkAtRestIn,
  expectLinkSpellingReachesTheGlyphs,
  expectNotDrawnAsLink,
  type Selection,
} from "../../fixtures/link-spelling";

/*
 * The whole-window sweep below renders every page, so it needs the one seam
 * every read of every page goes through — `getDbClient()` (ARCHITECTURE.md §4
 * rule 3). `vi.mock` is hoisted per FILE and cannot be imported, so this
 * stanza is copied verbatim from the three files that already drive the shared
 * harness (`absence/pages.test.ts`, `blank-cells.test.ts`, `in-window.test.ts`)
 * — the mock and its `scriptDatabase`, and nothing else: no walk, no helper.
 */
const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDbClient: () => {
      if (readWith.client === undefined) throw new Error("no database scripted");
      return readWith.client as SupabaseClient;
    },
  };
});

const { loadSurfaces, pageRoutes, populatedScript, renderSurface } = await import(
  "../absence/surfaces"
);

/** Script the database the next render reads. */
function scriptDatabase(script: Script) {
  readWith.client = stubClient(script).asSupabaseClient();
}

const SURFACES = await loadSurfaces();

/** The window's pages: every `page.tsx` on disk except the sign-in page. */
const WINDOW_ROUTES = pageRoutes().filter((route) => route !== "/login");

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

/**
 * The other way a file gets the spelling wrong: it gets it RIGHT, by hand
 * (campaign admin-window/BUG-0117).
 *
 * `links.ts` publishes one spelling because "a second spelling is a second
 * answer to 'does this text go somewhere', and BUG-0099 is what the second
 * answer cost". A file that retypes the published classes as a literal renders
 * identically today and is a second answer tomorrow — which is exactly the
 * state the eight files of BUG-0108 were in the day before the spelling
 * changed under them. Three files were doing it when this rule landed:
 * `review/item-header.tsx`, `review/close/slot.tsx` and `app/not-found.tsx`.
 *
 * Derived from `IN_PAGE_LINK`, never pinned: the rule is "this line writes out
 * every class the published spelling is made of", so restyling the link moves
 * the guard with it. Order does not matter and a longer class that merely
 * begins with one of them (`underline-offset-2`, `decoration-hairline`) is not
 * a hit — `EditableCell`'s resting hairline is a real, different affordance.
 */
const PUBLISHED_CLASSES: readonly string[] = IN_PAGE_LINK.split(/\s+/).filter(Boolean);

/** The file that PUBLISHES the spelling, which necessarily writes it out. */
const SPELLING_OWNER = "src/components/cycles/links.ts";

/** `className` as a whole class word, not as the head of a longer one. */
function writesClass(line: string, className: string): boolean {
  return new RegExp(`(?<![\\w-])${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(
    line,
  );
}

/**
 * Every place `text` retypes the published spelling instead of importing it,
 * as the trimmed line. Text in, hits out — the same two-fixture shape the
 * rejected-spelling rule above is proved with.
 */
function retypedLinkSpellingsIn(text: string): string[] {
  return codeLinesIn(text)
    .filter((line) => PUBLISHED_CLASSES.every((className) => writesClass(line, className)))
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

  it("flags a file that retypes the published spelling", () => {
    // The fixture it MUST flag: the literal three files carried
    // (admin-window/BUG-0117), and the same two classes written the other way
    // round, since the rule is about the spelling and not about the order.
    expect(
      retypedLinkSpellingsIn(`<a href={href} className="${IN_PAGE_LINK}">x</a>`),
    ).toHaveLength(1);
    expect(
      retypedLinkSpellingsIn(
        `<a href={href} className="${[...PUBLISHED_CLASSES].reverse().join(" ")}">x</a>`,
      ),
    ).toHaveLength(1);
  });

  it("stays green on a file that imports it", () => {
    // The fixture it must NOT flag, both ways a file spells the import — and
    // the neighbouring affordance that merely starts with the same word.
    expect(retypedLinkSpellingsIn(`<a href={href} className={IN_PAGE_LINK}>x</a>`)).toEqual(
      [],
    );
    expect(
      retypedLinkSpellingsIn("<a className={`type-data ${IN_PAGE_LINK}`}>x</a>"),
    ).toEqual([]);
    expect(
      retypedLinkSpellingsIn(
        'const RESTING = "underline decoration-hairline decoration-1 underline-offset-2";',
      ),
    ).toEqual([]);
  });

  it("finds no file under src retyping the spelling it could import", () => {
    // `links.ts` is the one file that necessarily writes the classes out: it
    // is where they are published. Everything else imports them.
    const offenders = sourceFiles()
      .filter((file) => file !== SPELLING_OWNER)
      .flatMap((file) =>
        retypedLinkSpellingsIn(sourceText(file)).map((hit) => `${file} — ${hit}`),
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

/**
 * The INK half of the published spelling — the sweep's SUBJECT filter
 * (campaign admin-window/BUG-0117).
 *
 * Load-bearing, and asserted as a predicate below rather than assumed: the
 * Dashboard's `error_summary` anchors keep `text-broken` and wear the
 * decoration alone by ruling (admin-window/BUG-0108 criterion 3), so a sweep
 * that graded every anchor in the window would redden on correct work.
 */
const LINK_INK: readonly string[] = PUBLISHED_CLASSES.filter((className) =>
  className.startsWith("text-"),
);

/** One anchor drawn in the app's own ink, with everything it wraps. */
interface InkedLink {
  /** The anchor's own classes. */
  classes: string[];
  /** The classes of every element inside it — what could re-ink its words. */
  overriders: string[][];
  /** The words a reader sees, for the failure message. */
  words: string;
}

/**
 * Every anchor in `scope` drawn in the link's OWN ink, with its descendants.
 *
 * Structural: it asks "is this the app's link" by the ink half of the one
 * published spelling, never by a class literal written here.
 */
function linksInTheAppsInk($: CheerioAPI, scope: Selection): InkedLink[] {
  return scope
    .find("a")
    .toArray()
    .map((anchor) => $(anchor))
    .filter((anchor) => {
      const classes = classesOf(anchor);
      return LINK_INK.every((ink) => classes.includes(ink));
    })
    .map((anchor) => ({
      classes: classesOf(anchor),
      overriders: anchor
        .find("*")
        .toArray()
        .map((element) => classesOf($(element))),
      words: anchor.text().replace(/\s+/g, " ").trim().slice(0, 40),
    }));
}

describe("the ink filter the window sweep picks its subject with", () => {
  /*
   * LESSONS 3, applied to the FILTER and not only to the rule: a predicate
   * that quietly matched nothing, or matched everything, would make the sweep
   * below either vacuous or wrong about links that are not its subject.
   */
  it("takes an anchor drawn in the app's own ink as its subject", () => {
    const $ = cheerio.load(`<p><a href="/x" class="${IN_PAGE_LINK}">standing</a></p>`);
    expect(linksInTheAppsInk($, $.root()).map((link) => link.words)).toEqual(["standing"]);
  });

  it("leaves the error line's own ink out of it, which the ruling requires", () => {
    // admin-window/BUG-0108 criterion 3: red is the palette's word for a
    // failed run, so these anchors keep `text-broken` and wear the decoration
    // alone. They are not this rule's subject.
    const $ = cheerio.load(
      `<p><a href="/x" class="type-data ${BROKEN_INK.join(" ")} underline">a failed run</a></p>`,
    );
    expect(linksInTheAppsInk($, $.root())).toEqual([]);
  });

  it("reports what an anchor wraps, which is what the rule grades", () => {
    const $ = cheerio.load(
      `<p><a href="/x" class="${IN_PAGE_LINK}">Its source` +
        `<span class="type-data text-ink-secondary"> bandsintown</span></a></p>`,
    );
    const [link] = linksInTheAppsInk($, $.root());
    expect(link.overriders).toEqual([["type-data", "text-ink-secondary"]]);
    expect(() =>
      expectLinkSpellingReachesTheGlyphs(link.classes, link.overriders, "a half-inked link"),
    ).toThrow();
    // And the shape the fix leaves behind: the value keeps its FACE, the ink
    // is the link's one ink.
    expect(() =>
      expectLinkSpellingReachesTheGlyphs(link.classes, [["type-data"]], "a whole link"),
    ).not.toThrow();
  });
});

describe("no anchor anywhere in the window breaks the app's link spelling", () => {
  /*
   * ARCHITECTURE.md §7, promoted from Common violations row 13 at its second
   * instance (admin-window/BUG-0113 on `/claims`, admin-window/BUG-0115 on the
   * Dashboard's attention cards): **no anchor in any page's delivered markup
   * contains a chip-filled span**. A chip is an inline-block box with a fill of
   * its own, so inside an anchor it takes CSS priority over the inherited ink
   * and paints over the ancestor's underline — and where the anchor carries a
   * hover fill of the same token, the chip's own box dissolves into the card
   * under the pointer.
   *
   * Repo-wide and over the RENDERED window rather than per page, so a page
   * added later inherits the rule instead of a comment about it: the inventory
   * is `loadSurfaces()` / `pageRoutes()` from the shared harness three files in
   * `tests/offline/absence/` already drive, and the chip's classes are derived
   * by rendering `<Badge>` (`CHIP_FILL`), so restyling the chip moves the guard
   * with it and no class literal is pinned here.
   *
   * **What this sweep does NOT cover, and the walk still owns**: a chip inside
   * a link on a state `populatedScript` never renders — a filtered list, an
   * error, a hover-only affordance. It is a floor under the walk, not a
   * replacement for it.
   *
   * Measured on the pre-fix tree, 2026-09-09: 2 hits on `/` (both attention
   * `StatCard`s) and 0 on the other seven routes.
   *
   * **The second assertion, on the same rendered routes** (campaign
   * admin-window/BUG-0117): for every anchor drawn in the link's own INK, the
   * spelling reaches the words a reader sees. A chip is one way a descendant
   * takes CSS priority over the inherited ink; an unboxed `<span>` that simply
   * re-inks the link's own words is the other, and it leaves the underline
   * intact so nothing about the anchor looks wrong. The review header's two
   * out-links did exactly that — the label in accent, the source's name beside
   * it in secondary ink, inside one anchor. Measured on the pre-fix tree,
   * 2026-09-09: 2 hits, both on `/queues/<reviewItemId>`, 0 on the other seven
   * routes. It rides this loop rather than a second sweep of its own, so a
   * page added later inherits both rules from one render.
   */
  it("sweeps exactly the routes the filesystem offers", () => {
    expect(SURFACES.map((surface) => surface.route).sort()).toEqual(WINDOW_ROUTES);
  });

  for (const surface of SURFACES) {
    it(`${surface.route} keeps every link's spelling on the words it draws`, async () => {
      scriptDatabase(populatedScript(surface));
      const $ = cheerio.load(await renderSurface(surface));
      expect(
        chipsInsideLinks($, $.root()),
        `${surface.route} renders a chip inside an anchor`,
      ).toEqual([]);
      for (const link of linksInTheAppsInk($, $.root())) {
        expectLinkSpellingReachesTheGlyphs(
          link.classes,
          link.overriders,
          `${surface.route} — "${link.words}"`,
        );
      }
    });
  }

  it("renders anchors and chips on the window it sweeps, so green is not empty", async () => {
    let anchors = 0;
    let chips = 0;
    for (const surface of SURFACES) {
      scriptDatabase(populatedScript(surface));
      const $ = cheerio.load(await renderSurface(surface));
      anchors += $("a").length;
      chips += $("span")
        .toArray()
        .filter((element) => {
          const classes = classesOf($(element));
          return CHIP_FILL.every((className) => classes.includes(className));
        }).length;
    }
    // Both halves of the claim have to be on screen for an empty result to
    // mean anything: pages that link, and chips that could have landed inside
    // one (LESSONS 3 — a guard that never saw its subject passes vacuously).
    expect(anchors).toBeGreaterThan(0);
    expect(chips).toBeGreaterThan(0);
  });

  it("finds links in the app's own ink on more than one route, and words inside them", async () => {
    // The same non-vacuity for the second assertion: its subject is the anchor
    // drawn in the published INK, and the thing it grades is what such an
    // anchor WRAPS. A window that rendered no inked link, or only bare ones,
    // would pass the loop above saying nothing at all.
    const routesWithLinks: string[] = [];
    let wrapping = 0;
    for (const surface of SURFACES) {
      scriptDatabase(populatedScript(surface));
      const $ = cheerio.load(await renderSurface(surface));
      const inked = linksInTheAppsInk($, $.root());
      if (inked.length > 0) routesWithLinks.push(surface.route);
      wrapping += inked.filter((link) => link.overriders.length > 0).length;
    }
    expect(routesWithLinks.length).toBeGreaterThan(1);
    expect(wrapping).toBeGreaterThan(0);
  });
});
