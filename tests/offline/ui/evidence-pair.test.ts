import { describe, expect, it } from "vitest";

import * as cheerio from "cheerio";

import { EvidencePair, type EvidenceClaim } from "@/components/evidence/evidence-pair";
import { Button } from "@/components/ui/button";
import { Identifier } from "@/components/ui/identifier";
import { EM_DASH, absoluteUtc, relativeAge } from "@/lib/format";

import { classesOf, h, render, textOf } from "./markup";

/**
 * The evidence pair — the app's signature block (campaign admin-window,
 * TASK-0004). Its whole value is that the anatomy never changes between
 * screens, so these tests assert order and structure, not wording.
 */

const CLAIMS: EvidenceClaim[] = [
  {
    id: "obs-1",
    value: "2026-09-14T19:00:00Z",
    source: "ticketmaster",
    tier: "primary",
    observedAt: "2026-08-26T04:12:00Z",
  },
  {
    id: "obs-2",
    value: "2026-09-15T19:00:00Z",
    source: "bandsintown",
    tier: "secondary",
    observedAt: "2026-08-28T04:12:00Z",
  },
];

const CANONICAL = { value: "2026-09-14T19:00:00Z", provenance: "ticketmaster, applied 3d ago" };

function pair(overrides: Partial<Parameters<typeof EvidencePair>[0]> = {}) {
  return render(h(EvidencePair, { claims: CLAIMS, canonical: CANONICAL, ...overrides }));
}

describe("EvidencePair", () => {
  it("puts the contenders on the left and the canonical value in the rightmost card", () => {
    const text = textOf(pair());
    expect(text.indexOf("ticketmaster")).toBeLessThan(text.lastIndexOf("current"));
    expect(text.indexOf("bandsintown")).toBeLessThan(text.lastIndexOf("current"));
    // the canonical card is last in document order
    expect(text.lastIndexOf("current")).toBeGreaterThan(text.indexOf("contender"));
  });

  it("labels the canonical card as current, and only it", () => {
    const text = textOf(pair());
    expect(text.match(/current/g)).toHaveLength(1);
  });

  it("separates the cards with hairlines and nothing else — no fills, no shadows", () => {
    const html = pair();
    const cardBorders = [...html.matchAll(/class="[^"]*border-l[^"]*"/g)];
    // two boundaries for three cards: claim 2 and the canonical card
    expect(cardBorders).toHaveLength(2);
    expect(classesOf(html).some((c) => c.startsWith("shadow"))).toBe(false);
  });

  it("carries value, then source, tier and age, in that fixed order on every claim card", () => {
    const text = textOf(pair());
    const card = text.slice(text.indexOf("contender"), text.lastIndexOf("contender"));
    expect(card.indexOf("2026-09-14T19:00:00Z")).toBeLessThan(card.indexOf("ticketmaster"));
    expect(card.indexOf("ticketmaster")).toBeLessThan(card.indexOf("primary"));
    expect(card.indexOf("primary")).toBeLessThan(card.indexOf("ago"));
  });

  it("renders the value in data and the source line in secondary", () => {
    const classes = classesOf(pair());
    expect(classes).toContain("type-data");
    expect(classes).toContain("text-ink-secondary");
    expect(classes).toContain("type-micro");
  });

  it("shows the age relatively with the absolute value in the title attribute", () => {
    const html = pair();
    expect(html).toContain(`title="${absoluteUtc("2026-08-26T04:12:00Z")}"`);
    expect(html).toMatch(/ago<|in \d/);
  });

  it("adds the provenance line to the canonical card", () => {
    expect(textOf(pair())).toContain("ticketmaster, applied 3d ago");
  });

  it("puts the verdict control inside the card it acts on, never in a toolbar", () => {
    const html = pair({
      claims: [{ ...CLAIMS[0], action: h(Button, {}, "Choose this value") }, CLAIMS[1]],
    });
    const firstCardEnd = html.indexOf("bandsintown");
    expect(html.indexOf("Choose this value")).toBeGreaterThan(0);
    expect(html.indexOf("Choose this value")).toBeLessThan(firstCardEnd);
  });

  it("renders a null contender value as the dash, keeping the anatomy identical", () => {
    const html = pair({ claims: [{ ...CLAIMS[0], value: null }] });
    expect(html).toContain(EM_DASH);
    expect(html).toContain("text-ink-disabled");
  });


  /**
   * The claim line's SOURCE is a machine identifier, and the primitive says so
   * itself: `src/components/ui/identifier.tsx` names "a source's own name"
   * among the foreign text an identifier span is where it lands, and its
   * `DATA_MUTED` doc says "a machine identifier takes `<Identifier muted>`
   * instead — never this" (campaign admin-window/BUG-0151, DEBT-0011
   * criteria 2 and 4).
   *
   * The expectation is READ OFF the primitive rather than typed here: whatever
   * `<Identifier muted>` renders for `dir` is what the source must carry, so
   * this pins the behaviour and not a literal.
   */
  it("gives the claim's source the isolation the identifier primitive gives an identifier — admin-window/BUG-0151", () => {
    const source = "ticketmaster";
    const $primitive = cheerio.load(render(h(Identifier, { muted: true, children: source })));
    const isolation = $primitive("span").attr("dir");

    const $ = cheerio.load(pair({ claims: [{ ...CLAIMS[0], source }] }));
    const own = $("*").toArray().filter((element) => $(element).text() === source);

    expect(own).toHaveLength(1);
    expect($(own[0]).attr("dir")).toBe(isolation);
  });

  /**
   * The TIER is the same class of value — `sources.tier`, the source's own
   * word, straight out of the registry (admin-window/BUG-0151) — so a present
   * one takes the same isolated box. Second fixture: an ABSENT tier is not a
   * machine value at all but the app's own absence element
   * (`lib/format.ts`'s dash, admin-window/BUG-0134), so it must NOT be dressed
   * as an identifier — a fix that wrapped `orDash`'s result wholesale would
   * pass the first arm and fail here.
   */
  it("isolates a present tier, and leaves an absent one the app's own absence element", () => {
    const isolation = cheerio
      .load(render(h(Identifier, { muted: true, children: "x" })))("span")
      .attr("dir");

    const tier = "primary";
    const $present = cheerio.load(pair({ claims: [{ ...CLAIMS[0], tier }] }));
    const own = $present("*").toArray().filter((element) => $present(element).text() === tier);
    expect(own).toHaveLength(1);
    expect($present(own[0]).attr("dir")).toBe(isolation);

    const $absent = cheerio.load(pair({ claims: [{ ...CLAIMS[0], tier: null }] }));
    const dash = $absent('[aria-label="no value"]');
    expect(dash, "the app's absence element still draws the absent tier").toHaveLength(1);
    expect(dash.attr("dir"), "the dash is the app's own, not a machine value").toBeUndefined();
    expect(dash.parents("[dir]"), "and it sits in no isolated box").toHaveLength(0);
  });

  /**
   * The harm the isolation exists to stop, on two fixtures (ARCHITECTURE §7,
   * promoted from Common violations row 15; admin-window/BUG-0137, BUG-0151).
   *
   * Fixture 1 — a source name carrying an unterminated RIGHT-TO-LEFT OVERRIDE.
   * The control must stay inside the value's own box, so the app's own words on
   * that line (the separators and the relative age) are exactly the words, in
   * exactly the order, the app wrote them in — measured here as "identical to
   * the healthy render's". Before the fix the whole line was one un-isolated
   * inline box and Chromium drew `ticketmaster · official · 14d ago` as
   * `ticketoga d41 · laiciffo · retsam`.
   *
   * Fixture 2 — the healthy line, whose TEXT the isolation must not change by
   * one character: the three values in order, separated by the app's own
   * separator (rendered twice, identically), and nothing else. Isolation
   * reorders nothing and adds nothing; it only draws a box.
   */
  it("keeps the app's separators and age out of the source's bidi box, and adds no text to the healthy line", () => {
    const RLO = "\u202e";
    const claim = { ...CLAIMS[0], source: "ticketmaster", tier: "official" };

    /** The claim line of the first contender card: the card's last span child. */
    function line(html: string) {
      const $ = cheerio.load(html);
      const card = $("div").first().children("div").first();
      return { $, element: card.children("span").last() };
    }

    /** The line's text, and the app's own words in it — everything outside the isolated boxes. */
    function parts(html: string) {
      const { $, element } = line(html);
      const isolated = element.find("[dir]").toArray().map((node) => $(node).text());
      const appWords = element
        .contents()
        .toArray()
        .filter((node) => !("attribs" in node && node.attribs?.dir !== undefined))
        .map((node) => $(node).text())
        .join("");
      return { text: element.text(), isolated, appWords };
    }

    const healthy = parts(pair({ claims: [claim] }));
    const hostile = parts(pair({ claims: [{ ...claim, source: `ticket${RLO}master` }] }));

    // Fixture 1: the control reached the screen verbatim, inside the value's
    // own box — and nowhere else on the line.
    expect(hostile.isolated[0]).toBe(`ticket${RLO}master`);
    expect(hostile.appWords).not.toContain(RLO);
    // ...so the app's own words beside a hostile source are the words, in the
    // order, it writes beside a healthy one.
    expect(hostile.appWords).toBe(healthy.appWords);

    // Fixture 2: the healthy line still reads source, tier, age in that fixed
    // order, holds those three values and nothing else, and puts the SAME
    // app-authored separator between them both times — the isolation drew a
    // box and did not add, drop or move one character of text.
    expect(healthy.isolated).toEqual([claim.source, claim.tier]);
    const age = relativeAge(claim.observedAt);
    const values = [claim.source, claim.tier, age.text];
    let rest = healthy.text;
    const separators: string[] = [];
    for (const value of values) {
      const at = rest.indexOf(value);
      expect(at, `the line carries ${value}, in order`).toBeGreaterThanOrEqual(0);
      separators.push(rest.slice(0, at));
      rest = rest.slice(at + value.length);
    }
    // Nothing before the first value, nothing after the last, and the two
    // separators between them are the same string as each other.
    expect([separators[0], rest]).toEqual(["", ""]);
    expect(separators[2]).toBe(separators[1]);
    expect(separators[1].trim(), "the app writes a separator there").not.toBe("");
  });

  it("renders with no contenders at all and draws no dangling separator", () => {
    const html = pair({ claims: [] });
    expect(html).toContain("current");
    expect([...html.matchAll(/border-l/g)]).toHaveLength(0);
  });
});
