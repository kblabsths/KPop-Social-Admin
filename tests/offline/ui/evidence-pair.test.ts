import { describe, expect, it } from "vitest";

import * as cheerio from "cheerio";

import { EvidencePair, type EvidenceClaim } from "@/components/evidence/evidence-pair";
import { Button } from "@/components/ui/button";
import { Identifier } from "@/components/ui/identifier";
import { EM_DASH, absoluteUtc } from "@/lib/format";

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
   * instead — never this". The card hands the whole line `DATA_MUTED` and
   * leaves the source a bare text node inside it, so the value is not
   * isolated and the app's own words share its bidi paragraph.
   *
   * The expectation is READ OFF the primitive rather than typed here: whatever
   * `<Identifier muted>` renders for `dir` is what the source must carry, so
   * this pins the behaviour and not a literal.
   *
   * PINNED `it.fails` for admin-window/BUG-0151 (open). Watched red as a plain
   * `it` first — 1 failed | 10 passed, so the failure is this assertion and not
   * a broken fixture. When the source goes through the primitive, this file
   * reddens as an XPASS and the pin comes off (plain `it`).
   */
  it.fails("gives the claim's source the isolation the identifier primitive gives an identifier — admin-window/BUG-0151", () => {
    const source = "ticketmaster";
    const $primitive = cheerio.load(render(h(Identifier, { muted: true, children: source })));
    const isolation = $primitive("span").attr("dir");

    const $ = cheerio.load(pair({ claims: [{ ...CLAIMS[0], source }] }));
    const own = $("*").toArray().filter((element) => $(element).text() === source);

    expect(own).toHaveLength(1);
    expect($(own[0]).attr("dir")).toBe(isolation);
  });

  it("renders with no contenders at all and draws no dangling separator", () => {
    const html = pair({ claims: [] });
    expect(html).toContain("current");
    expect([...html.matchAll(/border-l/g)]).toHaveLength(0);
  });
});
