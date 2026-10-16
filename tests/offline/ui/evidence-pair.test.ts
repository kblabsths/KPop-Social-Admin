import { describe, expect, it } from "vitest";

import * as cheerio from "cheerio";

import {
  EvidencePair,
  type EvidenceClaim,
  type ProvenanceSegment,
} from "@/components/evidence/evidence-pair";
import { Button } from "@/components/ui/button";
import { Identifier } from "@/components/ui/identifier";
import { EM_DASH, absoluteUtc, orDash, relativeAge } from "@/lib/format";

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

/**
 * The canonical card as `/queues/[reviewItemId]` hands it over: the value, and
 * the provenance line in PARTS — the winning source's own name, the tier frozen
 * at the apply with the app's qualifier beside it, and the app's own applied-age
 * sentence (`canonicalCard`, campaign admin-window/DEBT-0011).
 */
const PROVENANCE: ProvenanceSegment[] = [
  // A source and a tier that appear on NO contender card, so the whole-pair
  // oracles above ("exactly one element whose text is this value") keep saying
  // what they were written to say about the claim line.
  { identifier: "songkick" },
  { identifier: "official", after: "at apply" },
  "applied 3d ago",
];

const CANONICAL = { value: "2026-09-14T19:00:00Z", provenance: PROVENANCE };

function pair(overrides: Partial<Parameters<typeof EvidencePair>[0]> = {}) {
  return render(h(EvidencePair, { claims: CLAIMS, canonical: CANONICAL, ...overrides }));
}

/**
 * The claim line of a contender card: the card's last span child — the
 * `source · tier · age` line, whose app-authored words and isolated machine
 * values these tests read apart (admin-window/BUG-0151).
 *
 * Read off the rendered markup rather than named by class, so a face change
 * cannot redden it and a structural change must.
 */
function line(html: string, card = 0) {
  const $ = cheerio.load(html);
  const cards = $("div").first().children("div");
  return { $, element: cards.eq(card).children("span").last() };
}

/**
 * That line split the way the browser splits it: the text of every isolated
 * box, and everything OUTSIDE those boxes — the app's own words, which are the
 * words a hostile value must not be able to move (ARCHITECTURE §7).
 */
function parts(html: string, card = 0) {
  const { $, element } = line(html, card);
  const isolated = element.find("[dir]").toArray().map((node) => $(node).text());
  const appWords = element
    .contents()
    .toArray()
    .filter((node) => !("attribs" in node && node.attribs?.dir !== undefined))
    .map((node) => $(node).text())
    .join("");
  return { text: element.text(), isolated, appWords };
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
    const text = textOf(pair());
    for (const segment of PROVENANCE) {
      const words = typeof segment === "string" ? segment : segment.identifier;
      expect(text.lastIndexOf(words)).toBeGreaterThan(text.lastIndexOf("current"));
    }
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
   * A producer's value that LOOKS like the app's dash is still a value
   * (admin-window/BUG-0156).
   *
   * Every value this line carries is foreign — the source's own name, the
   * tier, the applied claim's status — so "is there anything here" is the
   * question the app asks of a producer's string (`hasVisibleContent`, the one
   * definition of blank, which is what the label rule
   * `lib/sources/names.ts` asks of the registry). It is NOT `isAbsent`, whose
   * extra branch calls a bare em dash an absence because that is what the
   * app's OWN formatters return for one. This line asked `isAbsent`, so a
   * source the registry NAMES `—` was drawn in disabled ink and announced to
   * a screen reader as `no value` — about a source whose name the page is
   * holding, one block above the evidence cell that had lost its link over the
   * same disagreement.
   *
   * Both directions (LESSONS 8), and the second is the one a fix that simply
   * stopped dashing would fail: a name with NO ink is still an absence here.
   */
  it("draws a producer's em-dash name as a value and a name with no ink as the absence", () => {
    const isolation = cheerio
      .load(render(h(Identifier, { muted: true, children: "x" })))("span")
      .attr("dir");

    // 1. A registry name whose only character is an em dash: a machine value,
    //    in the isolated box every other source name gets, announced as
    //    nothing.
    const $named = cheerio.load(pair({ claims: [{ ...CLAIMS[0], source: EM_DASH }] }));
    const own = $named("*")
      .toArray()
      .filter((element) => $named(element).text() === EM_DASH);
    expect(own, "the name is on the line exactly once").toHaveLength(1);
    expect($named(own[0]).attr("dir"), "isolated like any other source name").toBe(isolation);
    expect($named('[aria-label="no value"]'), "announced as an absence").toHaveLength(0);

    // 2. A name with nothing visible in it — not merely whitespace: the class
    //    `hasVisibleContent` knows and `trim()` does not — is an absence, and
    //    the app's own element draws it, in no isolated box.
    const $blank = cheerio.load(pair({ claims: [{ ...CLAIMS[0], source: "\u200b \u2060" }] }));
    const dash = $blank('[aria-label="no value"]');
    expect(dash, "the app's absence element draws an unreadable name").toHaveLength(1);
    expect(dash.attr("dir"), "the dash is the app's own, not a machine value").toBeUndefined();
    expect(dash.parents("[dir]"), "and it sits in no isolated box").toHaveLength(0);
  });

  /**
   * The same containment, driven from the TIER (admin-window/BUG-0151, QA
   * attack). The fix routes both machine values through the one helper, so a
   * hostile tier is the arm the source fixture above cannot see: if only the
   * source were isolated, `sources.tier` — equally a value this app did not
   * author — would still be able to draw the app's separators, the source
   * beside it and the relative age backwards.
   *
   * Measured in Chromium (playwright, 1440x900, per-character Range rects
   * sorted by x, 2026-09-09) on this markup: logical
   * `ticketmaster · off<U+202E>icial · 14d ago` reaches the screen as
   * `ticketmaster · offlaici<U+202E> · 14d ago` — the reversal stops at the
   * tier's own box and every app-authored character is in the order the app
   * wrote it.
   */
  it("keeps the app's words out of a hostile TIER's bidi box too", () => {
    const RLO = "\u202e";
    const claim = { ...CLAIMS[0], source: "ticketmaster", tier: "official" };

    const healthy = parts(pair({ claims: [claim] }));
    const hostile = parts(pair({ claims: [{ ...claim, tier: `off${RLO}icial` }] }));

    expect(hostile.isolated).toEqual([claim.source, `off${RLO}icial`]);
    expect(hostile.appWords).not.toContain(RLO);
    expect(hostile.appWords).toBe(healthy.appWords);
  });

  /**
   * The absence arm of the SOURCE (admin-window/BUG-0151, QA attack).
   *
   * The fix put `claim.source` behind the same absence guard the tier has, so a
   * source with nothing visible in it is the app's own dash — announced to a
   * reader who cannot see the ink — and NOT an empty isolated box, which is
   * what wrapping the value unconditionally would draw: a machine identifier's
   * box with no identifier in it, and no absence announced at all. Both halves
   * are asserted, because only the second one fails under that wrong fix.
   *
   * The fixtures are every shape `isAbsent` calls empty (`lib/format.ts`,
   * admin-window/BUG-0004/BUG-0085): the empty string, whitespace, and a string
   * whose only characters are invisible.
   */
  it.each([["empty", ""], ["blank", "   "], ["ink-less", "\u200b\u202e"]])(
    "draws a %s source as the app's absence element, not an empty isolated box",
    (_name, source) => {
      const { $, element } = line(pair({ claims: [{ ...CLAIMS[0], source }] }));
      const dash = element.find('[aria-label="no value"]');

      expect(dash, "the app's absence element stands in for the source").toHaveLength(1);
      expect(dash.attr("dir"), "the dash is the app's own, not a machine value").toBeUndefined();
      expect(dash.parents("[dir]"), "and it sits in no isolated box").toHaveLength(0);

      const boxes = element.find("[dir]").toArray().map((node) => $(node).text());
      expect(boxes, "the absent source leaves no empty identifier box behind").toEqual([
        CLAIMS[0].tier,
      ]);
    },
  );

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

  /**
   * The CANONICAL card's provenance line is the same defect class as the claim
   * line one card to its left (admin-window/BUG-0151), and criterion 2 of
   * admin-window/DEBT-0011 reaches it: three of its words are machine values —
   * the winning source's own name, the tier frozen at the apply, and the status
   * the applied claim now carries. Handed over as one pre-joined sentence they
   * sat bare inside a sentence this app wrote; handed over as PARTS, each takes
   * the primitive's isolated box while the app's own words stay text.
   *
   * The expectation is READ OFF `<Identifier muted>` rather than typed here, so
   * this pins the behaviour and not a literal.
   */
  it("gives every machine value in the provenance line the identifier's isolated box", () => {
    const isolation = cheerio
      .load(render(h(Identifier, { muted: true, children: "x" })))("span")
      .attr("dir");

    const $ = cheerio.load(pair());
    const line = $("div").first().children("div").last().children("span").last();
    const isolated = line.find("[dir]").toArray().map((node) => $(node).text());

    // Exactly the segments' identifiers, in the caller's order — no app word
    // has been swept into a box, and no value has been left out of one.
    expect(isolated).toEqual(
      PROVENANCE.flatMap((segment) =>
        typeof segment === "string" ? [] : [segment.identifier],
      ),
    );
    for (const node of line.find("[dir]").toArray()) {
      expect($(node).attr("dir")).toBe(isolation);
    }
  });

  /**
   * Second fixture, the one that decides whether the isolation is worth
   * anything: a source name carrying an unterminated RIGHT-TO-LEFT OVERRIDE.
   * The control must reach the screen verbatim (isolation reorders nothing and
   * removes nothing) and stay inside the value's own box, so the app's own words
   * on the line — the separators, "at apply", the applied-age sentence — are the
   * words, in the order, the app wrote them beside a healthy source.
   *
   * And on the HEALTHY line the text must not change by one character: it is
   * exactly the caller's parts, joined by the app's own separator — the SAME
   * separator the claim line above it uses, which is where it is read from
   * rather than typed here.
   */
  it("keeps a hostile source inside its own box and adds no text to the healthy provenance line", () => {
    const RLO = "\u202e";

    /** The provenance line of the canonical card: that card's last span child. */
    function provenance(html: string) {
      const $ = cheerio.load(html);
      const element = $("div").first().children("div").last().children("span").last();
      const appWords = element
        .contents()
        .toArray()
        .filter((node) => !("attribs" in node && node.attribs?.dir !== undefined))
        .map((node) => $(node).text())
        .join("");
      return {
        text: element.text(),
        isolated: element.find("[dir]").toArray().map((node) => $(node).text()),
        appWords,
      };
    }

    const hostileSource = `ticket${RLO}master`;
    const healthy = provenance(pair());
    const hostile = provenance(
      pair({
        canonical: {
          ...CANONICAL,
          provenance: [{ identifier: hostileSource }, ...PROVENANCE.slice(1)],
        },
      }),
    );

    // Fixture 1: verbatim, in its own box, and nowhere else on the line.
    expect(hostile.isolated[0]).toBe(hostileSource);
    expect(hostile.appWords).not.toContain(RLO);
    expect(hostile.appWords).toBe(healthy.appWords);

    // Fixture 2: the healthy line is the caller's parts and nothing else. The
    // separator comes off the CLAIM line, whose own test already proves it is
    // one app-authored string rendered identically between values — so the two
    // lines on one card cannot drift apart, and no wording is pinned here.
    const claimLine = cheerio.load(pair())("div").first().children("div").first().children("span").last();
    const claimText = claimLine.text();
    const separator = claimText.slice(
      claimText.indexOf(CLAIMS[0].source) + CLAIMS[0].source.length,
      claimText.indexOf(String(CLAIMS[0].tier)),
    );
    expect(separator.trim(), "the app writes a separator between parts").not.toBe("");

    const assembled = PROVENANCE.map((segment) =>
      typeof segment === "string"
        ? segment
        : [segment.before, segment.identifier, segment.after]
            .filter((word) => word !== undefined)
            .join(" "),
    ).join(separator);
    expect(healthy.text).toBe(assembled);
  });

  /**
   * The two provenance arms whose APP-AUTHORED WORDS SIT AFTER THE VALUE — the
   * only positions where an unterminated override in a machine value can reach
   * them at all, since a control reorders what follows it and not what precedes
   * it (admin-window/DEBT-0011 criterion 4, QA attack).
   *
   * The hostile-source fixture above cannot see either of them: the source is
   * the FIRST segment, graded by the words that follow the whole line, while
   * `{identifier: tier, after: "at apply"}` puts two app words immediately
   * behind one value, and the not-live arm
   * (`{before: "the claim it applied is now", identifier: status}`) is the arm
   * criterion 2 names outright ("a status … value") and no test rendered at all
   * — `canonicalCard` builds it only when the decision's claim has stopped
   * being live (`src/app/queues/[reviewItemId]/page.tsx`).
   */
  it("keeps the app's words beside a hostile tier and a hostile status out of their boxes", () => {
    const RLO = "‮";
    const notLive: ProvenanceSegment[] = [
      ...PROVENANCE,
      { before: "the claim it applied is now", identifier: "superseded" },
    ];

    function provenance(segments: ProvenanceSegment[]) {
      const $ = cheerio.load(pair({ canonical: { ...CANONICAL, provenance: segments } }));
      const element = $("div").first().children("div").last().children("span").last();
      return {
        isolated: element.find("[dir]").toArray().map((node) => $(node).text()),
        appWords: element
          .contents()
          .toArray()
          .filter((node) => !("attribs" in node && node.attribs?.dir !== undefined))
          .map((node) => $(node).text())
          .join(""),
      };
    }

    const healthy = provenance(notLive);

    // The TIER, with the app's "at apply" one text node behind it.
    const hostileTier = provenance(
      notLive.map((segment, index) =>
        index === 1 ? { identifier: `off${RLO}icial`, after: "at apply" } : segment,
      ),
    );
    expect(hostileTier.isolated[1]).toBe(`off${RLO}icial`);
    expect(hostileTier.appWords).not.toContain(RLO);
    expect(hostileTier.appWords).toBe(healthy.appWords);

    // The not-live STATUS, with the app's whole clause beside it.
    const hostileStatus = provenance(
      notLive.map((segment, index) =>
        index === notLive.length - 1
          ? { before: "the claim it applied is now", identifier: `sup${RLO}erseded` }
          : segment,
      ),
    );
    expect(hostileStatus.isolated.at(-1)).toBe(`sup${RLO}erseded`);
    expect(hostileStatus.appWords).not.toContain(RLO);
    expect(hostileStatus.appWords).toBe(healthy.appWords);
  });

  /**
   * A provenance value with nothing visible in it draws the app's own absence
   * element — the same thing the claim line one card to its LEFT draws for the
   * same class of value (`sources.source`, reached through `canonicalSideOf`'s
   * `sources.get(id)?.source`), because both lines now ask one guard
   * (`MachineValue`; admin-window/BUG-0152, BUG-0151, BUG-0134).
   *
   * Until the guard landed, `ProvenancePart` wrapped `segment.identifier`
   * unconditionally: the line rendered `<span dir="ltr" class="…"></span>` and
   * read " ·  at apply · applied 3d ago", a silent gap where the winning source
   * belongs and no absence announced to a reader who cannot see the ink.
   *
   * Both halves are asserted, because a fix that wrapped `orDash`'s result
   * wholesale would satisfy the second and still leave the value's own empty box
   * standing. The expectation is read off `orDash` rather than typed here, so
   * this pins the behaviour and not a literal.
   */
  it.each([["empty", ""], ["blank", "   "], ["ink-less", "​‮"]])(
    "draws a %s provenance value as the app's absence element, not an empty isolated box — admin-window/BUG-0152",
    (_name, value) => {
      const absence = cheerio.load(render(orDash("")))("[aria-label]").first();

      const $ = cheerio.load(
        pair({
          canonical: {
            ...CANONICAL,
            provenance: [{ identifier: value }, ...PROVENANCE.slice(1)],
          },
        }),
      );
      const line = $("div").first().children("div").last().children("span").last();

      const boxes = line.find("[dir]").toArray().map((node) => $(node).text());
      expect(boxes, "no identifier box is left standing empty").not.toContain(value);
      expect(
        line.find(`[aria-label="${absence.attr("aria-label")}"]`),
        "the app's absence element stands in for the missing source",
      ).toHaveLength(1);
    },
  );

  /**
   * The absent-value fixtures every guard on this card is graded on: the three
   * shapes `isAbsent` calls empty (`lib/format.ts`), plus the two the ROW TYPE
   * says cannot happen and PostgREST can still deliver — `tier_at_apply` and
   * `observations.status` are declared `string` in `lib/db/review-item.ts`
   * while the columns behind them are the scraper repo's, so a null arriving
   * there is a type lie this component meets at runtime, not a compile error
   * (LESSONS 8: `undefined` and `null` are two inputs).
   */
  const ABSENT_VALUES: [string, string][] = [
    ["empty", ""],
    ["blank", "   "],
    ["ink-less", "\u200b\u202e"],
    ["null at runtime", null as unknown as string],
    ["undefined at runtime", undefined as unknown as string],
  ];

  /** The canonical card's provenance line, split the way the browser splits it. */
  function canonicalLine(html: string) {
    const $ = cheerio.load(html);
    const element = $("div").first().children("div").last().children("span").last();
    return {
      $,
      element,
      text: element.text(),
      isolated: element.find("[dir]").toArray().map((node) => $(node).text()),
    };
  }

  /** The app's absence element as `orDash` draws it — read, never typed. */
  function absenceLabel() {
    return cheerio.load(render(orDash("")))("[aria-label]").first().attr("aria-label");
  }

  /**
   * An absent provenance value takes the app's absence element **and the app's
   * own words beside it are still rendered** — the case the guard's two other
   * call sites on this line have and the first segment does not
   * (admin-window/BUG-0152).
   *
   * `canonicalCard` (`src/app/queues/[reviewItemId]/page.tsx`) hands two of its
   * three machine values over WITH app words attached: the tier carries `after`
   * ("at apply") and a dead claim's status carries `before` ("the claim it
   * applied is now"). A blank `tier_at_apply` or a blank status therefore lands
   * in a segment the first-segment fixtures never reach, and the two failure
   * modes there are different ones: the empty isolated box BUG-0152 was filed
   * for, and a segment that drops the app's clause along with the value, leaving
   * a bare dash the line never explains.
   *
   * The words are the FIXTURE's own strings, not this app's copy, so a rewrite
   * of either sentence cannot redden this and a guard that swallows them must.
   */
  it.each(ABSENT_VALUES)(
    "keeps the app's words beside a %s provenance value and leaves no box standing empty — admin-window/BUG-0152",
    (_name, value) => {
      const WORDS = "QA_APP_WORDS";
      const placements: ProvenanceSegment[][] = [
        // The tier's placement: app words AFTER the value, mid-line.
        [{ identifier: "songkick" }, { identifier: value, after: WORDS }, "applied 3d ago"],
        // The dead claim's placement: app words BEFORE the value, last.
        [{ identifier: "songkick" }, "applied 3d ago", { before: WORDS, identifier: value }],
      ];

      for (const provenance of placements) {
        const { element, text, isolated } = canonicalLine(
          pair({ canonical: { ...CANONICAL, provenance } }),
        );

        const dash = element.find(`[aria-label="${absenceLabel()}"]`);
        expect(dash, "the app's absence element stands in for the missing value").toHaveLength(1);
        expect(dash.parents("[dir]"), "and it sits in no identifier box").toHaveLength(0);
        expect(isolated, "only the value that HAS something visible keeps a box").toEqual([
          "songkick",
        ]);
        expect(text, "the app's own clause beside it is still rendered").toContain(WORDS);
      }
    },
  );

  /**
   * The two secondary lines of one card answer an absent machine value with the
   * SAME element — the property that made `MachineValue` one helper rather than
   * a guard written twice (admin-window/BUG-0152, LESSONS 5 and 7).
   *
   * This is the behaviour the one-owner shape buys, asserted as behaviour: the
   * provenance line and the claim line beside it are rendered from the same
   * absent value and their absence elements are compared to EACH OTHER, so a
   * second hand-written guard on either line — a blank, a hand-typed dash, a
   * dash in an identifier's box — separates them and reddens this, while a
   * change to the app's one absence element moves both together and does not.
   */
  it.each(ABSENT_VALUES)(
    "answers a %s value with the same absence element on both lines of the card — admin-window/BUG-0152",
    (_name, value) => {
      const onProvenance = canonicalLine(
        pair({
          canonical: { ...CANONICAL, provenance: [{ identifier: value }, ...PROVENANCE.slice(1)] },
        }),
      );
      const onClaim = line(pair({ claims: [{ ...CLAIMS[0], source: value }] }));

      const label = absenceLabel();
      const fromProvenance = onProvenance.element.find(`[aria-label="${label}"]`);
      const fromClaim = onClaim.element.find(`[aria-label="${label}"]`);

      expect(fromProvenance, "the provenance line draws it once").toHaveLength(1);
      expect(fromClaim, "so does the claim line").toHaveLength(1);
      expect(
        onProvenance.$.html(fromProvenance),
        "and the two lines draw the very same element",
      ).toBe(onClaim.$.html(fromClaim));
    },
  );

  it("renders with no contenders at all and draws no dangling separator", () => {
    const html = pair({ claims: [] });
    expect(html).toContain("current");
    expect([...html.matchAll(/border-l/g)]).toHaveLength(0);
  });
});
