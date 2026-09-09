import * as cheerio from "cheerio";
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
  expectNotDrawnAsLink,
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

describe("no anchor anywhere in the window contains a chip", () => {
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
   */
  it("sweeps exactly the routes the filesystem offers", () => {
    expect(SURFACES.map((surface) => surface.route).sort()).toEqual(WINDOW_ROUTES);
  });

  for (const surface of SURFACES) {
    it(`${surface.route} draws no chip inside a link`, async () => {
      scriptDatabase(populatedScript(surface));
      const $ = cheerio.load(await renderSurface(surface));
      expect(
        chipsInsideLinks($, $.root()),
        `${surface.route} renders a chip inside an anchor`,
      ).toEqual([]);
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
});
