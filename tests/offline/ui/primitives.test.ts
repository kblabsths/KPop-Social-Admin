import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import { Badge, TONE_INK } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty } from "@/components/ui/empty";
import { Eyebrow, microLabelText } from "@/components/ui/micro-label";
import { ErrorLine } from "@/components/ui/error-line";
import { Identifier } from "@/components/ui/identifier";
import { Loading } from "@/components/ui/loading";
import { NotProvisioned } from "@/components/ui/not-provisioned";
import { Page, pageTitleText } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";
import { ARRIVES_WITH, RETRY, StateOf } from "@/components/ui/state-of";
import {
  WindowLine,
  type DrawnWindow,
  type ReadWindow,
} from "@/components/ui/window-line";
import { DroppedParamsLine } from "@/components/ui/dropped-params";
import type { AccountSegment } from "@/lib/account/authored";
import { EM_DASH, absoluteUtc, count, relativeAge } from "@/lib/format";
import { droppedParams } from "@/lib/url/dropped-params";
import { codeLinesIn, sourceFiles, sourceText } from "../source-tree";

import {
  classesOf,
  h,
  render,
  runTogetherWords,
  tagsOf,
  textOf,
  uppercasedIdentifiers,
} from "./markup";

/**
 * The primitives every surface is built from (campaign admin-window,
 * TASK-0004). These assert the tokens a primitive emits and the structure it
 * guarantees — never its wording, which pages own and copy edits change.
 */

type Row = { id: string; source: string; failures: number | null };

const ROWS: Row[] = [
  { id: "a", source: "ticketmaster", failures: 1234 },
  { id: "b", source: "bandsintown", failures: null },
];

const COLUMNS: Column<Row>[] = [
  { key: "source", label: "source", cell: (row) => row.source },
  { key: "failures", label: "failures", align: "right", cell: (row) => row.failures },
];

function table(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    h(DataTable<Row>, {
      columns: COLUMNS,
      rows: ROWS,
      rowKey: (row: Row) => row.id,
      ...overrides,
    }),
  );
}

describe("Page and Section", () => {
  it("puts the page name in an h1 and the section name in an h2, both in title type", () => {
    const page = render(h(Page, { title: "Cycles & runs" }, h(Section, { title: "Runs" })));
    expect(page).toMatch(/<h1[^>]*class="[^"]*type-title/);
    expect(page).toMatch(/<h2[^>]*class="[^"]*type-title/);
  });

  /**
   * A page title may BE a machine identifier — `/records/[table]/[id]` names
   * its h1 after the table — and `type-title` is uppercase sans, so the whole
   * of admin-window/BUG-0049's eyebrow problem repeats one type step up:
   * `walk_sandbox record` reaching the operator as `WALK_SANDBOX RECORD`
   * (admin-window/BUG-0073, measured in Chromium both schemes 2026-09-03).
   *
   * The property asserted is the structural one — the identifier is never
   * inside the element that uppercases — not the words, which pages own and
   * which this test supplies itself.
   */
  it("keeps an identifier title verbatim, in mono, and out of the uppercasing h1", () => {
    const html = render(h(Page, { title: { identifier: "walk_sandbox", words: "record" } }));
    const $ = cheerio.load(html);

    // verbatim: character for character, no prettified spelling anywhere
    expect(textOf(html)).toContain("walk_sandbox");
    expect(textOf(html)).not.toContain("WALK_SANDBOX");

    const identifier = $("h1 span")
      .toArray()
      .map((element) => ({
        classes: ($(element).attr("class") ?? "").split(/\s+/),
        text: $(element).text(),
      }))
      .find((span) => span.text === "walk_sandbox");
    expect(identifier).toBeDefined();
    // mono at its own case, and both survive any uppercasing ancestor added later
    expect(identifier?.classes).toContain("type-data");
    expect(identifier?.classes).toContain("normal-case");
    expect(identifier?.classes).toContain("tracking-normal");
    // the structural half: no element that uppercases contains it — not the
    // span, and not the h1 above it either
    expect(identifier?.classes).not.toContain("type-title");
    expect($("h1").attr("class")?.split(/\s+/)).not.toContain("type-title");
    expect(uppercasedIdentifiers(html)).toEqual([]);

    // and the app's own word still gets the title treatment, in the same h1
    expect($("h1 span.type-title").text()).toBe("record");
  });

  it("puts a real space between an identifier title and its word, not a flex gap", () => {
    // The h1's accessible name is read as text by everything that reads text,
    // and a CSS gap is invisible to all of it (admin-window/BUG-0045).
    const html = render(h(Page, { title: { identifier: "walk_sandbox", words: "record" } }));
    expect(cheerio.load(html)("h1").text()).toBe("walk_sandbox record");
    expect(runTogetherWords(html)).toEqual([]);
  });

  it("renders a bare identifier title with no trailing word when none is given", () => {
    const html = render(h(Page, { title: { identifier: "walk_sandbox" } }));
    expect(cheerio.load(html)("h1").text()).toBe("walk_sandbox");
    expect(uppercasedIdentifiers(html)).toEqual([]);
    expect(classesOf(html)).toContain("type-data");
  });

  it("flattens either title to the string its h1 renders, for an accessible name", () => {
    for (const title of [
      "Queues",
      { identifier: "walk_sandbox" },
      { identifier: "walk_sandbox", words: "record" },
    ] as const) {
      expect(pageTitleText(title)).toBe(cheerio.load(render(h(Page, { title })))("h1").text());
    }
  });

  /**
   * `surface` is the live parity oracle's ADDRESS for a section
   * (admin-window/BUG-0056), and it is optional because seven of the eight
   * pages that use `Section` omit it and must keep the markup they had — four
   * live files still address their sections by POSITION
   * (`section:nth-of-type(n)` in dashboard/sources/claims/browse/review-item),
   * so an attribute this primitive grows unconditionally would move every one
   * of those pages at once. Measured on the fix: with the prop omitted the
   * rendered bytes are identical to the pre-`surface` primitive (md5
   * dbbf6f06bae0bfff49cee4b0ac69ae85 on both, 2026-09-03).
   *
   * Both directions are asserted, because "omitted renders nothing" is only
   * half the contract: a `surface ?? ""` written later would satisfy the first
   * half and still put `data-surface=""` on all eight pages.
   */
  it("carries a data-surface only where a caller named one", () => {
    const unnamed = render(h(Section, { title: "Runs" }, h("p", null, "body")));
    expect(unnamed).not.toContain("data-surface");

    const named = render(
      h(Section, { title: "Runs", surface: "runs_window" }, h("p", null, "body")),
    );
    expect(cheerio.load(named)('[data-surface="runs_window"]').length).toBe(1);
    // The name goes on the section itself — that is the element `stateOf`
    // reads a state of — not on a wrapper around or inside it.
    expect(cheerio.load(named)('section[data-surface="runs_window"]').length).toBe(1);
    // Naming it changes nothing else about the markup.
    expect(named.replace(' data-surface="runs_window"', "")).toBe(unnamed);
  });
});

describe("DataTable", () => {
  it("labels its header row in micro on a chrome fill and its cells in data", () => {
    const html = table();
    expect(html).toMatch(/<th[^>]*class="[^"]*type-micro/);
    expect(html).toMatch(/<tr[^>]*class="[^"]*bg-chrome/);
    expect(html).toMatch(/<td[^>]*class="[^"]*type-data/);
  });

  it("carries the neutral arrow in disabled-gray on a sortable column that is not the sort", () => {
    const html = table({
      columns: [{ ...COLUMNS[0], sort: { href: "?sort=source" } }, COLUMNS[1]],
    });
    expect(html).toContain('href="?sort=source"');
    expect(html).toMatch(/text-ink-disabled/);
    expect(html).not.toMatch(/text-accent/);
  });

  it("carries the direction arrow in accent on the active sort, and says so to a screen reader", () => {
    const html = table({
      columns: [{ ...COLUMNS[0], sort: { href: "?sort=source", active: "desc" } }, COLUMNS[1]],
    });
    expect(html).toMatch(/text-accent/);
    expect(html).toContain('aria-sort="descending"');
  });

  /* ── the marked row (admin-window/BUG-0054, QA probe) ─────────────────── */

  /** Every body row the markup emitted, each as its own whole element. */
  function bodyRows(html: string): string[] {
    const $ = cheerio.load(html);
    return $("tbody tr").toArray().map((element) => $.html(element));
  }

  it("leaves a row it was not asked about byte-identical, mark or no mark", () => {
    // Thirteen other surfaces render this table and not one of them passes
    // `marked`. The mark is only safe if the rows a caller did NOT name come
    // out of the renderer unchanged — hover fill included, since that is the
    // one thing this table already says with a fill.
    const plain = bodyRows(table());
    const withMark = bodyRows(table({ marked: (row: Row) => row.id === "a" }));
    expect(plain).toHaveLength(ROWS.length);
    expect(withMark).toHaveLength(ROWS.length);
    expect(withMark[1]).toBe(plain[1]);
    // ...and the row that WAS named really did change, so the check above is
    // not passing because nothing happened at all.
    expect(withMark[0]).not.toBe(plain[0]);
  });

  it("renders exactly the unmarked table when the predicate names no row", () => {
    // What `/cycles?cycle=<unknown or malformed>` hands the table: a predicate
    // that is present and answers false everywhere. Nothing may be marked, and
    // nothing about the table may move.
    expect(table({ marked: () => false })).toBe(table());
    const $ = cheerio.load(table({ marked: () => false }));
    expect($("[data-row-marked]").length).toBe(0);
  });

  it("marks the row without moving one cell, so no column and no row height shifts", () => {
    const cells = (html: string) => {
      const $ = cheerio.load(html);
      return $("tbody tr").first().find("td").toArray().map((element) => $.html(element));
    };
    const marked = table({ marked: (row: Row) => row.id === "a" });
    expect(cells(marked)).toEqual(cells(table()));
    expect(cells(marked).length).toBeGreaterThan(0);
    // The mark is one row attribute and one class list — never a wrapper, a
    // glyph, or an extra cell.
    const $ = cheerio.load(marked);
    expect($("tbody tr[data-row-marked]").length).toBe(1);
    expect($("tbody tr").first().find("td").length).toBe(COLUMNS.length);
  });

  it("keeps its header and spans the state line it is handed when there are no rows", () => {
    const html = table({ rows: [], placeholder: h(Loading, { what: "runs" }) });
    expect(html).toContain("runs");
    expect(html).toMatch(/colspan="2"/i);
    // the header row survives, so the columns do not jump when rows arrive
    expect(html).toMatch(/<th/);
  });
});

describe("StatCard", () => {
  it("stacks a micro label, the figure, and at most one data sub-line", () => {
    const classes = classesOf(render(h(StatCard, { label: "decisions", value: 12, sub: "oldest 3d" })));
    expect(classes).toContain("type-micro");
    expect(classes).toContain("type-figure");
    expect(classes).toContain("type-data");
  });

  it("separates thousands in the figure", () => {
    expect(render(h(StatCard, { label: "events", value: 1234 }))).toContain("1,234");
  });

  it("colours the figure only when it is handed a state", () => {
    expect(classesOf(render(h(StatCard, { label: "open", value: 3 })))).toContain("text-ink");
    expect(classesOf(render(h(StatCard, { label: "open", value: 3, tone: "attention" })))).toContain(
      "text-attention",
    );
  });

  it("links the number to the page that explains it when given a target", () => {
    const html = render(h(StatCard, { label: "decisions", value: 12, href: "/queues" }));
    expect(tagsOf(html)[0]).toBe("a");
    expect(html).toContain('href="/queues"');
  });

  it("renders a null figure as the dash, never as a zero", () => {
    const html = render(h(StatCard, { label: "decisions", value: null }));
    expect(html).toContain(EM_DASH);
    expect(html).not.toContain(">0<");
  });

  it("qualifies a truncated count in the app's voice, beside the machine's number", () => {
    const floor = render(h(StatCard, { label: "items", value: 1234, floor: true }));
    const exact = render(h(StatCard, { label: "items", value: 1234 }));
    // the figure is untouched: it is still the one mono number on the card
    expect(floor).toContain("1,234");
    expect(classesOf(floor)).toContain("type-figure");
    // and the qualifier is the app's own words, so it is sans and secondary
    expect(classesOf(floor)).toContain("type-body");
    expect(classesOf(exact)).not.toContain("type-body");
    expect(textOf(floor).length).toBeGreaterThan(textOf(exact).length);
  });
});

describe("Badge", () => {
  it("is never interactive: no link, no button, no handler surface", () => {
    const html = render(h(Badge, { children: "adapter" }));
    expect(tagsOf(html)).toEqual(["span"]);
    expect(html).not.toContain("href");
  });

  it("is chrome fill with primary text by default, so a page of sources is not a rainbow", () => {
    const classes = classesOf(render(h(Badge, { children: "ticketmaster" })));
    expect(classes).toContain("bg-chrome");
    expect(classes).toContain("text-ink");
    expect(classes.some((c) => /^text-(attention|broken|healthy|accent)$/.test(c))).toBe(false);
  });

  it("gives severity a colour and not a scale: high is amber, low is gray", () => {
    expect(classesOf(render(h(Badge, { tone: "high", children: "high" })))).toContain("text-attention");
    expect(classesOf(render(h(Badge, { tone: "low", children: "low" })))).toContain("text-ink-secondary");
  });

  /*
   * `TONE_INK` is exported so a surface that shows one of these words WITHOUT
   * a chip — the Dashboard's attention cards, where the chip could not stay
   * inside the card's anchor (admin-window/BUG-0115) — reads the same map
   * instead of copying it. This asserts the export IS what the badge renders,
   * which is what makes it one map and not two that agree today.
   */
  it("renders the very ink it publishes, so a consumer of the map cannot drift", () => {
    for (const tone of ["neutral", "high", "low", "healthy", "broken"] as const) {
      expect(classesOf(render(h(Badge, { tone, children: "x" }))), tone).toContain(
        TONE_INK[tone],
      );
    }
    // The map is INK and nothing else: a consumer that takes a tone's colour
    // must not inherit the box — the fill, the radius, the padding — which is
    // the chip, and which an anchor may not contain (ARCHITECTURE.md §7).
    for (const ink of Object.values(TONE_INK)) {
      expect(ink.startsWith("text-"), ink).toBe(true);
    }
  });
});

describe("Chip", () => {
  it("is a real link, so a filter is bookmarkable and survives the back button", () => {
    const html = render(h(Chip, { label: "decision", href: "/queues?shape=decision" }));
    expect(tagsOf(html)).toEqual(["a"]);
    expect(html).toContain('href="/queues?shape=decision"');
  });

  it("fills with accent when active and with chrome when not", () => {
    const active = classesOf(render(h(Chip, { label: "decision", href: "/q", active: true })));
    expect(active).toContain("bg-accent");
    expect(active).toContain("text-on-accent");
    expect(active).not.toContain("bg-chrome");

    const inactive = classesOf(render(h(Chip, { label: "decision", href: "/q" })));
    expect(inactive).toContain("bg-chrome");
    expect(inactive).toContain("text-ink-secondary");
    expect(inactive).not.toContain("bg-accent");
  });
});

describe("Button", () => {
  it("fills with accent only as the primary", () => {
    expect(classesOf(render(h(Button, { variant: "primary" }, "Save override")))).toContain("bg-accent");
    expect(classesOf(render(h(Button, {}, "Close")))).not.toContain("bg-accent");
  });

  it("gives secondary a hairline border and a transparent fill", () => {
    const classes = classesOf(render(h(Button, { variant: "secondary" }, "Close")));
    expect(classes).toContain("border-hairline");
    expect(classes.some((c) => c.startsWith("bg-"))).toBe(false);
  });

  it("styles destructive as a red border and red text, never a red fill", () => {
    const classes = classesOf(render(h(Button, { variant: "destructive" }, "Save override")));
    expect(classes).toContain("border-broken");
    expect(classes).toContain("text-broken");
    expect(classes).not.toContain("bg-broken");
  });

  it("dims to half opacity when disabled and does not change its label", () => {
    const enabled = render(h(Button, { variant: "primary" }, "Choose this value"));
    const disabled = render(h(Button, { variant: "primary", disabled: true }, "Choose this value"));
    expect(classesOf(disabled)).toContain("opacity-50");
    expect(classesOf(disabled)).toContain("cursor-not-allowed");
    expect(disabled).toContain("disabled=");
    expect(textOf(disabled)).toBe(textOf(enabled));
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    expect(render(h(Button, {}, "Close"))).toContain('type="button"');
  });
});

describe("the four data-surface states", () => {
  it("names what is loading on one data line and never animates", () => {
    const html = render(h(Loading, { what: "cycles" }));
    expect(classesOf(html)).toContain("type-data");
    expect(html).toContain("cycles");
    expect(classesOf(html).some((c) => /animate|pulse|spin/.test(c))).toBe(false);
  });

  /**
   * `holds` and `filledBy` widened from `string` to `ReactNode` so that a
   * caller whose sentence contains a machine identifier can set that one word
   * in the app's identifier-in-prose spelling (admin-window/BUG-0120). Both
   * halves of that are asserted here: the widening changed nothing for the
   * callers that pass a string, and it really does carry a caller's element.
   */
  it("adds no element of its own around a string caller's two lines", () => {
    const holds = "open decisions";
    const filledBy = "the resolver files one here";
    const $ = cheerio.load(render(h(Empty, { holds, filledBy })));
    const lines = $("p").toArray();
    expect(lines).toHaveLength(2);
    expect($(lines[0]).text()).toBe(`No ${holds}`);
    expect($(lines[1]).text()).toBe(filledBy);
    // The card wraps nothing: what a string caller renders is text, and the
    // 16 call sites that pass strings render exactly what they did before.
    for (const line of lines) expect($(line).children().toArray()).toHaveLength(0);
  });

  it("renders an element a caller puts inside a line, unchanged and in place", () => {
    const $ = cheerio.load(
      render(
        h(Empty, {
          holds: h("span", { "data-probe": "held" }, "verdicts"),
          filledBy: h("em", { "data-probe": "fills" }, "a resolver run"),
        }),
      ),
    );
    // Each line carries the caller's own element, with its tag and attribute
    // intact — the card neither drops it nor re-wraps its words.
    const held = $('p [data-probe="held"]');
    expect(held).toHaveLength(1);
    expect(held.text()).toBe("verdicts");
    expect(held.parent().text()).toBe("No verdicts");
    const fills = $('p [data-probe="fills"]');
    expect(fills).toHaveLength(1);
    expect(fills[0].tagName).toBe("em");
    expect(fills.text()).toBe("a resolver run");
  });

  it("names the missing table in mono and stays gray — unavailable is not broken", () => {
    const html = render(h(NotProvisioned, { missing: "verdicts", arrivesWith: "the scraper repo's migration" }));
    expect(html).toMatch(/class="type-data[^"]*"[^>]*>verdicts</);
    expect(classesOf(html)).toContain("text-ink-secondary");
    expect(classesOf(html)).not.toContain("text-broken");
    expect(html).not.toContain(">0<");
  });

  it("carries an optional eyebrow above the message, and emits none without one", () => {
    // The eyebrow is the `micro` label of the surface the card stands in for
    // (LOOK_AND_FEEL: `micro` is "the eyebrow label above a value"), so it must
    // read before the message, not after it (admin-window/TASK-0030).
    for (const [bare, labelled] of [
      [
        render(h(Empty, { holds: "open decisions", filledBy: "the resolver files one here" })),
        render(
          h(Empty, {
            holds: "open decisions",
            filledBy: "the resolver files one here",
            eyebrow: "cycle health",
          }),
        ),
      ],
      [
        render(h(NotProvisioned, { missing: "verdicts", arrivesWith: "a migration" })),
        render(h(NotProvisioned, { missing: "verdicts", arrivesWith: "a migration", eyebrow: "cycle health" })),
      ],
    ]) {
      expect(classesOf(labelled)).toContain("type-micro");
      const text = textOf(labelled);
      // first thing the card reads out: the label sits ABOVE the message
      expect(text.indexOf("cycle health")).toBe(0);

      // a card given no eyebrow is exactly the card that shipped before it
      // existed: no stray label, no empty element holding its place
      expect(classesOf(bare)).not.toContain("type-micro");
      expect(textOf(bare)).not.toContain("cycle health");
    }
  });

  it("takes the read a failed query was making as a REQUIRED prop", () => {
    // Compile-time half of the assertion: `tsc --noEmit` covers `tests/**`
    // (tsconfig `include`), so if `reading` ever goes optional again this
    // directive becomes an unused-directive error and the build reddens.
    // BUG-0016 shipped precisely because only a reviewer could catch it
    // (ARCHITECTURE §7, admin-window/TASK-0030).
    const anonymous = () =>
      // @ts-expect-error a red line that names no read is unwritable
      h(ErrorLine, { failed: "relation does not exist", retry: "reload the page" });
    expect(typeof anonymous).toBe("function");

    const named = render(
      h(ErrorLine, { reading: "verdicts", failed: "no such relation", retry: "reload the page" }),
    );
    expect(textOf(named)).toContain("verdicts");
  });

  it("renders an error as one red line carrying the failure verbatim and the retry", () => {
    const html = render(
      h(ErrorLine, {
        reading: "verdicts",
        failed: 'relation "verdicts" does not exist',
        retry: "reload the page",
      }),
    );
    expect(classesOf(html)).toContain("text-broken");
    expect(html).toContain("does not exist");
    expect(html).toContain("reload the page");
    expect(tagsOf(html)[0]).toBe("p");
  });
});

/**
 * The refusal card and the window line — the two helpers every page used to
 * carry its own copy of (campaign admin-window/DEBT-0003).
 *
 * They are primitives for one reason beyond tidiness: both render the hooks a
 * live oracle reads a page's STATE back by, and four hand-copies is four
 * chances for that contract to drift where a drift grades a broken page as a
 * pass (ARCHITECTURE.md §10, common violations 6 and 9). Two copies had
 * already lost the `StateOf` wrappers and the `/claims` `WindowLine` had lost
 * every `data-window*` attribute before this fold.
 */
describe("StateOf", () => {
  const MISSING = { kind: "not_provisioned", missing: "pending_claims" } as const;
  const FAILED = {
    kind: "error",
    reading: "observations",
    message: "relation does not exist",
  } as const;

  it("wraps each refusal in the hook that NAMES the read it refused", () => {
    const missing = cheerio.load(render(h(StateOf, { result: MISSING })));
    const failed = cheerio.load(render(h(StateOf, { result: FAILED })));

    expect(missing("[data-not-provisioned]").attr("data-not-provisioned")).toBe(
      MISSING.missing,
    );
    expect(failed("[data-read-failed]").attr("data-read-failed")).toBe(FAILED.reading);

    // Neither state may answer to the other's hook: a page composing several
    // reads reports each one separately, and an oracle asking "which read
    // refused?" must get one answer per refusal.
    expect(missing("[data-read-failed]").length).toBe(0);
    expect(failed("[data-not-provisioned]").length).toBe(0);
  });

  it("draws the two refusals as the two primitives that own them, never as one shape", () => {
    const missing = cheerio.load(render(h(StateOf, { result: MISSING })));
    const failed = cheerio.load(render(h(StateOf, { result: FAILED })));

    expect(missing('[data-state="not_provisioned"]').length).toBe(1);
    expect(missing('[data-state="error"]').length).toBe(0);
    expect(failed('[data-state="error"]').length).toBe(1);
    expect(failed('[data-state="not_provisioned"]').length).toBe(0);
  });

  it("spends the window's one arrival sentence and its one retry sentence", () => {
    // The point of the fold: these two sentences are spelled ONCE. A page that
    // re-spelled either could drift from every other page's wording, which is
    // exactly what eight hand-copies of `ARRIVES_WITH` risked.
    // Read through cheerio, which decodes: the card's sentence reaches the
    // screen as text, and React escapes the apostrophe of "repo's" on the way
    // out — a raw-markup comparison would be asserting the escaping, not the
    // sentence.
    const said = (html: string) => cheerio.load(html).text();
    expect(said(render(h(StateOf, { result: MISSING })))).toContain(ARRIVES_WITH);
    expect(said(render(h(StateOf, { result: FAILED })))).toContain(RETRY);
  });

  it("carries an eyebrow where the surface has no heading, and none where it does", () => {
    for (const result of [MISSING, FAILED] as const) {
      const labelled = render(h(StateOf, { result, eyebrow: "cycle health" }));
      const bare = render(h(StateOf, { result }));
      expect(textOf(bare)).not.toContain("cycle health");
      // `ErrorLine` is a line inside a surface that already names itself, so
      // only the card takes the label — asserted per state rather than assumed.
      if (result.kind === "not_provisioned") {
        expect(textOf(labelled).indexOf("cycle health")).toBe(0);
      }
    }
  });
});

/**
 * A FAILED READ'S ACCOUNT, AND THE TWO FACES IT READS IN — campaign
 * admin-window/BUG-0196.
 *
 * "Mono carries every value the database produced … Sans carries every word
 * the app wrote. That split *is* the typographic idea: the operator can always
 * see which words are the machine's" (LOOK_AND_FEEL → Typography). MEASURED
 * defect: this line drew the WHOLE account in one `type-data` span, so the
 * app's own clause about a part it refused to quote — "a 4524-character markup
 * document arrived here instead of the database's own words" — reached the
 * operator in the database's face, inside the same red mono run as a real
 * Postgres string.
 *
 * Every case is STRUCTURAL: which run a part lands in, read off the delivered
 * markup. None of them pins a sentence this app wrote, and the two that decide
 * a face hand the SAME words to both authors, so no string comparison can pass
 * them.
 */
describe("a failed read's account renders each part in its author's face", () => {
  const MACHINE = 'relation "pending_claims" does not exist';
  const OURS = "the words this app wrote about the part it refused to quote";

  /** The type step each span of the line carries, with its text. */
  function runs(html: string): { step: string; words: string; isolated: boolean }[] {
    const $ = cheerio.load(html);
    return $('[data-state="error"] span')
      .toArray()
      .map((element) => ({
        step: ($(element).attr("class") ?? "").split(/\s+/).find((c) => c.startsWith("type-")) ?? "",
        words: $(element).text(),
        isolated: $(element).attr("dir") === "ltr",
      }));
  }

  /** The words of every run in one type step, joined as the line reads them. */
  const inStep = (html: string, step: string): string =>
    runs(html)
      .filter((run) => run.step === step)
      .map((run) => run.words)
      .join(" ");

  const line = (authored?: readonly AccountSegment[]) =>
    render(
      h(ErrorLine, {
        reading: "pending_claims",
        failed: (authored ?? [{ words: MACHINE, author: "the machine" as const }])
          .map((segment) => segment.words)
          .join(" "),
        authored,
        retry: RETRY,
      }),
    );

  it("draws an account carrying no authorship exactly as it always did: one mono run", () => {
    // The wire's documented default, and every call site that holds only the
    // string: absence means the whole account is the machine's.
    const html = line();
    expect(inStep(html, "type-data")).toBe(`pending_claims ${EM_DASH} ${MACHINE}`);
    expect(inStep(html, "type-body")).toBe(RETRY);
  });

  it("derives the face from the carried fact alone: the same words, both ways round", () => {
    // A renderer matching a sentence against a list of this app's own phrases
    // fails both halves of this; one reading the carried fact passes both. No
    // rewording can move a face.
    const asOurs = line([{ words: MACHINE, author: "this app" }]);
    expect(inStep(asOurs, "type-body")).toContain(MACHINE);
    expect(inStep(asOurs, "type-data")).not.toContain(MACHINE);

    const asTheirs = line([{ words: OURS, author: "the machine" }]);
    expect(inStep(asTheirs, "type-data")).toContain(OURS);
    expect(inStep(asTheirs, "type-body")).not.toContain(OURS);
  });

  it("keeps the whole account, in order, with one em dash after the object", () => {
    // No account is dropped, truncated or reordered to make the split easier,
    // and the words still read as one sentence to anything that concatenates
    // the text — a screen reader announcing the alert, a live oracle reading
    // the card back.
    const html = line([
      { words: MACHINE, author: "the machine" },
      { words: OURS, author: "this app" },
    ]);
    const read = cheerio.load(html)('[data-state="error"]').text();
    expect(read).toContain(`pending_claims ${EM_DASH} ${MACHINE} ${OURS}`);
    expect(read.split(EM_DASH)).toHaveLength(2);
    expect(read.indexOf(MACHINE)).toBeLessThan(read.indexOf(OURS));
    expect(read.indexOf(OURS)).toBeLessThan(read.indexOf(RETRY));
  });

  it("isolates exactly the runs this app did not write, and never one it did", () => {
    // `dir="ltr"` boxes foreign text so it cannot reorder the line around it
    // (ARCHITECTURE §7). A sentence this app wrote needs no isolation from
    // itself, and the object is foreign in every arm.
    const html = line([
      { words: MACHINE, author: "the machine" },
      { words: OURS, author: "this app" },
    ]);
    const isolated = runs(html).filter((run) => run.isolated);
    expect(isolated.map((run) => run.words)).toEqual([`pending_claims ${EM_DASH} ${MACHINE}`]);
    for (const run of runs(html)) {
      if (run.words.includes(OURS)) expect(run.isolated).toBe(false);
    }
  });

  it("merges two runs by the same author, so a two-field account keeps its space", () => {
    // The line lays its runs out as flex items, so the gap between two spans
    // is the layout's and not a character. Two same-authored parts therefore
    // have to arrive in ONE span or the account reads run together.
    const html = line([
      { words: "first", author: "the machine" },
      { words: "second", author: "the machine" },
    ]);
    expect(runs(html).filter((run) => run.step === "type-data")).toHaveLength(1);
    expect(inStep(html, "type-data")).toBe(`pending_claims ${EM_DASH} first second`);
  });

  it("gets the account alone rather than a dangling em dash when the read names nothing", () => {
    // The app's one definition of absence, asked of the object — unchanged by
    // the split, and asked once for both faces.
    for (const reading of ["", "   "]) {
      const html = render(
        h(ErrorLine, {
          reading,
          failed: OURS,
          authored: [{ words: OURS, author: "this app" as const }],
          retry: RETRY,
        }),
      );
      expect(cheerio.load(html)('[data-state="error"]').text(), JSON.stringify(reading)).not.toContain(
        EM_DASH,
      );
      expect(inStep(html, "type-body"), JSON.stringify(reading)).toContain(OURS);
    }
  });

  it("carries the account down through StateOf, which is how every page draws it", () => {
    // The seam a page actually renders: `DbResult`'s error arm satisfies
    // `UnavailableRead` structurally, so no page translates and the runs are
    // not re-derived anywhere on the way (admin-window/BUG-0196 criterion 5c).
    const html = render(
      h(StateOf, {
        result: {
          kind: "error",
          reading: "pending_claims",
          message: `${MACHINE} ${OURS}`,
          authored: [
            { words: MACHINE, author: "the machine" },
            { words: OURS, author: "this app" },
          ],
        },
      }),
    );
    expect(inStep(html, "type-data")).toContain(MACHINE);
    expect(inStep(html, "type-body")).toContain(OURS);
    expect(html).toContain('data-read-failed="pending_claims"');
  });
});

/**
 * WindowLine — the hook set, and the silence.
 *
 * This describe block held ~1,090 lines until 2026-10-21, grading the SENTENCE
 * each window arm said: the `newest` lede and its cap clause, the `matched`
 * arm's two-reads-two-facts rule, `catalog`'s arrival order, the scan's
 * `measured`/`scope`/`answersFor` phrases, and the did-not-fill floor. Ben
 * deleted that prose on his first operator pass, so every one of those cases
 * now grades text no operator will ever read.
 *
 * What replaces them is the contract that is left, and it is a real one: the
 * `data-window-*` attributes are what the offline suites and the live oracles
 * read a window back by, so they are pinned here attribute by attribute. The
 * silence is pinned too — a sentence creeping back into this component is a
 * decision, and it reddens this file.
 */
describe("WindowLine", () => {
  const SCAN: ReadWindow = {
    since: "2026-06-01T00:00:00.000Z",
    until: "2026-09-01T00:00:00.000Z",
    limit: 2000,
    held: 1200,
    truncated: false,
    over: "table",
  };
  const DRAWN: DrawnWindow = {
    limit: 50,
    held: 50,
    truncated: true,
    over: "view",
    oldest: "2026-08-31T00:00:00.000Z",
    scope: null,
  };
  const at = (html: string) => cheerio.load(html)("[data-window]");

  it("publishes a scan's window, attribute by attribute, time bounds included", () => {
    const published = at(render(h(WindowLine, { gauge: "cycle_health", window: SCAN })));
    expect(published.length).toBe(1);
    expect(published.attr("data-window")).toBe("cycle_health");
    expect(published.attr("data-window-since")).toBe(SCAN.since);
    expect(published.attr("data-window-until")).toBe(SCAN.until);
    expect(published.attr("data-window-limit")).toBe(String(SCAN.limit));
    expect(published.attr("data-window-held")).toBe(String(SCAN.held));
  });

  it("publishes no time bound for a drawn window, because a drawn read has none", () => {
    const published = at(render(h(WindowLine, { gauge: "claims", window: DRAWN })));
    // React omits an `undefined` attribute, so the ABSENCE of these two is
    // itself the statement "this window is not bounded in time".
    expect(published.attr("data-window-since")).toBeUndefined();
    expect(published.attr("data-window-until")).toBeUndefined();
    expect(published.attr("data-window-limit")).toBe("50");
  });

  it("states truncation as a confident boolean, in both directions", () => {
    // Never an absent attribute for "not truncated": an oracle reading the
    // hook back must tell a complete window from a missing claim
    // (ARCHITECTURE.md §4.3 — a null is a refusal, never a zero).
    const complete = at(render(h(WindowLine, { gauge: "g", window: { ...DRAWN, truncated: false } })));
    const filled = at(render(h(WindowLine, { gauge: "g", window: { ...DRAWN, truncated: true } })));
    expect(complete.attr("data-window-truncated")).toBe("false");
    expect(filled.attr("data-window-truncated")).toBe("true");
  });

  it("publishes a page window's position only when the read stated one", () => {
    const silent = at(render(h(WindowLine, { gauge: "g", window: DRAWN })));
    expect(silent.attr("data-window-from")).toBeUndefined();
    const positioned = at(
      render(h(WindowLine, { gauge: "g", window: { ...DRAWN, from: 51, drawn: 50 } })),
    );
    expect(positioned.attr("data-window-from")).toBe("51");
    expect(positioned.attr("data-window-drawn")).toBe("50");
  });

  it("says nothing at all, on every window it is handed", () => {
    // The contract Ben set on 2026-10-21. A window line that speaks again is a
    // decision and must be made deliberately, not by a clause drifting back in.
    for (const [what, window] of [
      ["scan", SCAN],
      ["scan, truncated", { ...SCAN, truncated: true }],
      ["drawn", DRAWN],
      ["drawn, not truncated", { ...DRAWN, truncated: false }],
      ["drawn, empty", { ...DRAWN, held: 0, truncated: false, oldest: null }],
      ["page window", { ...DRAWN, from: 51, drawn: 50 }],
    ] as const) {
      const html = render(h(WindowLine, { gauge: "g", window }));
      expect(textOf(html), what).toBe("");
      expect(tagsOf(html), what).toEqual(["p"]);
      expect(at(html).length, what).toBe(1);
    }
  });
});

/**
 * Absence renders identically everywhere, or it does not render at all.
 *
 * LOOK_AND_FEEL, Data table: "A null renders as `—` in disabled-gray — never
 * blank, never `null`, `N/A` or `none`." TASK-0004 seeds `nullDash()` so that
 * "absence looks identical everywhere" (`src/lib/format.ts`, its own words).

 * admin-window/BUG-0004 fixed the three ways this disagreed with itself: the
 * primitives no longer carry their own guards, they ask `isAbsent()` in
 * `src/lib/format.ts`, so a helper-produced dash, a falsy cell body and a
 * non-finite figure all render the one `nullDash()`.
 *
 * These drive the two ways a page reaches a cell without going through a raw
 * `null` — a formatting helper's string, and a falsy React body.
 */
describe("absence, across the format helpers and the primitives", () => {
  type Missing = { id: string; n: number | null; at: string | null; flagged: boolean };
  const missing: Missing[] = [{ id: "only", n: null, at: null, flagged: false }];
  const dashCell = (html: string) =>
    [...html.matchAll(/<td[^>]*class="([^"]*)"[^>]*>(.*?)<\/td>/g)].map((m) => ({
      classes: m[1],
      body: m[2],
    }));

  it("shows a helper-produced dash in disabled-gray, like every other dash in the row", () => {
    const html = render(
      h(DataTable<Missing>, {
        columns: [
          { key: "raw", label: "raw", cell: (row: Missing) => row.n },
          { key: "count", label: "count", cell: (row: Missing) => count(row.n) },
          { key: "age", label: "age", cell: (row: Missing) => relativeAge(row.at).text },
          { key: "when", label: "when", cell: (row: Missing) => absoluteUtc(row.at) },
        ] as Column<Missing>[],
        rows: missing,
        rowKey: (row: Missing) => row.id,
      }),
    );
    const cells = dashCell(html);
    expect(cells).toHaveLength(4);
    // every one of the four is the same absence; every one must read the same
    for (const cell of cells) {
      expect(cell.body).toContain(EM_DASH);
      expect(`${cell.classes} ${cell.body}`).toContain("text-ink-disabled");
    }
  });

  it("never leaves a cell blank when its body is a falsy React node", () => {
    const html = render(
      h(DataTable<Missing>, {
        // `row.flagged && <something>` is the idiom every page will reach for;
        // it yields `false`, which React renders as nothing.
        columns: [{ key: "f", label: "flagged", cell: (row: Missing) => row.flagged && "yes" }] as Column<Missing>[],
        rows: missing,
        rowKey: (row: Missing) => row.id,
      }),
    );
    const [cell] = dashCell(html);
    expect(cell.body).not.toBe("");
    expect(cell.body).toContain(EM_DASH);
  });

  it("shows a figure that is not a number as the same dash a null figure gets", () => {
    const nan = render(h(StatCard, { label: "runs", value: Number.NaN }));
    expect(nan).toContain(EM_DASH);
    expect(nan).toContain("text-ink-disabled");
  });

  it("dashes a truthy boolean cell body too, since React draws it as nothing either", () => {
    const html = render(
      h(DataTable<Missing>, {
        columns: [{ key: "f", label: "flagged", cell: () => true }] as Column<Missing>[],
        rows: missing,
        rowKey: (row: Missing) => row.id,
      }),
    );
    const [cell] = dashCell(html);
    expect(cell.body).toContain(EM_DASH);
    expect(cell.body).toContain("text-ink-disabled");
  });

  it("never mistakes a real zero for an absence, in a cell or in a figure", () => {
    const html = render(
      h(DataTable<Missing>, {
        columns: [{ key: "z", label: "zero", cell: () => count(0) }] as Column<Missing>[],
        rows: missing,
        rowKey: (row: Missing) => row.id,
      }),
    );
    const [cell] = dashCell(html);
    expect(cell.body).toBe("0");
    expect(render(h(StatCard, { label: "runs", value: 0 }))).not.toContain(EM_DASH);
  });
});

/* ── the eyebrow, and the identifier it may carry ────────────────────────── */

/**
 * `Eyebrow` is the one place a machine identifier is allowed inside a `micro`
 * label (campaign admin-window/BUG-0049).
 *
 * What is asserted here is the PROPERTY the fix has to hold — the identifier
 * keeps its own case, keeps the mono face, and is not inside the element that
 * uppercases — never the app's words, which pages own. The words are supplied
 * by the test itself for exactly that reason.
 */
describe("Eyebrow", () => {
  /** The element that actually carries a class, for one rendering. */
  function spans(html: string) {
    const $ = cheerio.load(html);
    return $("span[class]")
      .toArray()
      .map((element) => ({
        classes: ($(element).attr("class") ?? "").split(/\s+/),
        text: $(element).text().replace(/\s+/g, " ").trim(),
      }));
  }

  it("renders the app's own words as a plain micro label, as it always did", () => {
    const html = render(h(Eyebrow, { label: "open decisions" }));
    expect(textOf(html)).toBe("open decisions");
    expect(classesOf(html)).toContain("type-micro");
    // one element, not a wrapper and a child: a caller with no identifier gets
    // exactly the markup that shipped before this component existed
    expect(spans(html)).toHaveLength(1);
  });

  it("keeps an identifier verbatim, in mono, and out of the uppercasing element", () => {
    const html = render(
      h(Eyebrow, { label: { identifier: "data_conflict", words: "open age" } }),
    );

    // verbatim: the value the machine produced, character for character
    expect(textOf(html)).toContain("data_conflict");
    expect(textOf(html)).not.toContain("DATA_CONFLICT");

    const identifier = spans(html).find((span) => span.text === "data_conflict");
    expect(identifier).toBeDefined();
    // mono, and its case survives whatever it is nested in: `type-data` is the
    // step for a value the database produced, `normal-case` and
    // `tracking-normal` are what an uppercasing ancestor cannot override
    expect(identifier?.classes).toContain("type-data");
    expect(identifier?.classes).toContain("normal-case");
    expect(identifier?.classes).toContain("tracking-normal");
    // and it is NOT inside the micro element — the browser uppercases whatever
    // is, so nesting would undo the two classes above at every ancestor added
    // later. This is the structural half of the guarantee.
    expect(identifier?.classes).not.toContain("type-micro");
    expect(uppercasedIdentifiers(html)).toEqual([]);

    // our words still get the micro treatment
    const words = spans(html).find((span) => span.text === "open age");
    expect(words?.classes).toContain("type-micro");
  });

  it("puts a real space between the identifier and the words, not a flex gap", () => {
    // A CSS gap is invisible to every reader of text — the accessible name,
    // the parity readers, a screen reader — and JSX drops whitespace runs that
    // contain a newline, so only the delivered markup proves it
    // (admin-window/BUG-0045's `stuck_patterndial`, from the other side).
    const html = render(
      h(Eyebrow, { label: { identifier: "entity_link", words: "folded" } }),
    );
    expect(textOf(html)).toBe("entity_link folded");
    expect(runTogetherWords(html)).toEqual([]);
  });

  it("renders a bare identifier with no trailing words when none are given", () => {
    const html = render(h(Eyebrow, { label: { identifier: "source_id" } }));
    expect(textOf(html)).toBe("source_id");
    expect(uppercasedIdentifiers(html)).toEqual([]);
    expect(classesOf(html)).toContain("type-data");
  });

  it("flattens to the same string it renders, for an accessible name", () => {
    // `DataTable` names itself with `aria-label`, which takes a string and not
    // markup, so the two must not drift.
    for (const label of [
      "open decisions",
      { identifier: "source_id" },
      { identifier: "data_conflict", words: "by week" },
    ] as const) {
      expect(microLabelText(label)).toBe(textOf(render(h(Eyebrow, { label }))));
    }
  });
});

/**
 * The guard itself, proved on two inputs — one it MUST flag and one it must
 * NOT (LESSONS 3). A grep guard that has never seen a passing spelling passes
 * vacuously, and this one decides whether two page suites are meaningful.
 */
describe("the uppercased-identifier guard", () => {
  it("flags an identifier concatenated into a micro label", () => {
    // exactly what `/queues` shipped: `` `${stats.queue} open` `` handed to a
    // StatCard as one string
    const bad = render(h(StatCard, { label: "data_conflict open", value: 0 }));
    expect(uppercasedIdentifiers(bad)).toEqual(["data_conflict open"]);
  });

  /**
   * The same two inputs one type step up, because the guard now reads `title`
   * as well as `micro` (admin-window/BUG-0073). Without this pair the widening
   * would be a line of code nothing exercises — a guard that has never flagged
   * an h1 says nothing about h1s.
   */
  it("flags an identifier concatenated into a page title", () => {
    // exactly what `/records/[table]/[id]` shipped: `` `${config.table} record` ``
    const bad = render(h(Page, { title: "walk_sandbox record" }));
    expect(uppercasedIdentifiers(bad)).toEqual(["walk_sandbox record"]);
  });
});

/* ── the dropped-parameter line, and its rule (admin-window/BUG-0141) ─────── */

/**
 * The sentence that says what the URL asked for and a page did not do. It was
 * `/claims`' alone and is now a primitive, because `/queues` says it too and a
 * second copy would be born without the four fixes that landed on the first
 * (BUG-0123, BUG-0127, BUG-0136, BUG-0137 — ARCHITECTURE.md Common violations
 * rows 9 and 15).
 *
 * Every behaviour those four bugs pinned is graded, unchanged, in
 * `tests/offline/claims/{page,filters}.test.ts` — which did not move when the
 * code did, and are the proof this was a MOVE. What is graded here is what the
 * move added: the two page assumptions that became arguments, and the hooks the
 * component publishes for any page that renders it.
 */
describe("droppedParams, the shared rule", () => {
  it("skips the keys a page says it consumed, and only those", () => {
    // `tab` is the default because both routes that carry a tab spell it that
    // way, and every value of it lands on a real tab.
    expect(droppedParams({ tab: "verdict_log", record_id: "r-1" }, {})).toEqual({
      named: ["record_id"],
      withheld: 0,
    });
    // A route with no tab says so, and then `tab` is a dropped parameter like
    // any other.
    expect(droppedParams({ tab: "x" }, {}, [], [])).toEqual({
      named: ["tab"],
      withheld: 0,
    });
    // …and a route consuming something else names it.
    expect(droppedParams({ cols: "a", record_id: "r-1" }, {}, [], ["cols"])).toEqual({
      named: ["record_id"],
      withheld: 0,
    });
  });

  it("asks the APPLIED narrowing by its own keys, never by a prototype's", () => {
    // A URL may spell anything: `?constructor=1` must be answered by what the
    // page applied, not by `Object.prototype.constructor` being present on
    // every object in the language.
    expect(droppedParams({ constructor: "1" }, {})).toEqual({
      named: ["constructor"],
      withheld: 0,
    });
    expect(droppedParams({ toString: "1" }, { bucket: "escalated" })).toEqual({
      named: ["toString"],
      withheld: 0,
    });
    // An applied key is still applied, and an explicitly-undefined one is not.
    expect(droppedParams({ source_id: "s-1" }, { source_id: "s-1" })).toEqual({
      named: [],
      withheld: 0,
    });
    expect(droppedParams({ source_id: "s-1" }, { source_id: undefined })).toEqual({
      named: ["source_id"],
      withheld: 0,
    });
  });

  it("reads a repeated key the way a page reads it: the first value", () => {
    expect(droppedParams({ record_id: ["r-1", "r-2"] }, {})).toEqual({
      named: ["record_id"],
      withheld: 0,
    });
    expect(droppedParams({ record_id: [] }, {})).toEqual({ named: [], withheld: 0 });
    expect(droppedParams({ record_id: [""] }, {})).toEqual({ named: [], withheld: 0 });
  });
});

describe("DroppedParamsLine", () => {
  const line = (dropped: Parameters<typeof DroppedParamsLine>[0]["dropped"]) =>
    render(h(DroppedParamsLine, { dropped }));

  it("renders nothing at all when nothing was dropped", () => {
    expect(line({ named: [], withheld: 0 })).toBe("");
  });

  it("publishes the total and each spelled name as its own hook", () => {
    const $ = cheerio.load(line({ named: ["record_id", "cols"], withheld: 1 }));
    expect($("[data-dropped-params]").attr("data-dropped-params")).toBe("3");
    expect(
      $("[data-dropped-param]")
        .toArray()
        .map((element) => $(element).attr("data-dropped-param")),
    ).toEqual(["record_id", "cols"]);
    // The names are the app's identifier treatment, isolated left-to-right.
    expect($('[data-dropped-param="record_id"]').attr("dir")).toBe("ltr");
    expect(classesOf(line({ named: ["record_id"], withheld: 0 }))).toContain("type-data");
  });

  it("counts a withheld parameter without spelling it anywhere", () => {
    const parked = "in_" + "window";
    const html = line({ named: [], withheld: 1 });
    expect(html).not.toContain(parked);
    expect(cheerio.load(html)("[data-dropped-param]")).toHaveLength(0);
    expect(cheerio.load(html)("[data-dropped-params]").attr("data-dropped-params")).toBe("1");
  });
});

/* ── the identifier, and the face it now owns (admin-window/DEBT-0011) ────── */

/**
 * The machine identifier's one rendering.
 *
 * LOOK_AND_FEEL Voice bar 5 — identifiers "render verbatim in mono and are
 * never prettified" — was two Tailwind classes hand-typed at 48 call sites in
 * 26 files, which is how the campaign fixed the same breach three times one
 * surface at a time (BUG-0112, then BUG-0120 "the face BUG-0112 fixed one
 * paragraph above", then BUG-0121 "the face BUG-0120 fixed one route over"),
 * and how two pages grew byte-identical private copies of it.
 *
 * Nothing here pins a class literal: the face is read off the primitive's own
 * render, so a restyle moves these assertions with it. What is pinned is the
 * behaviour — the text reaches the screen unchanged, the call site's hooks
 * survive, and the box is bidi-isolated.
 */
describe("Identifier", () => {
  const identifier = (props: Record<string, unknown> = {}) =>
    render(h(Identifier, { children: "data_conflict", ...props }));

  it("renders the identifier verbatim, in the mono step", () => {
    const $ = cheerio.load(identifier());
    const span = $("span");
    expect(span).toHaveLength(1);
    // Verbatim: same case, same underscore, nothing added and nothing removed.
    expect(span.text()).toBe("data_conflict");
    expect(classesOf(identifier())).toContain("type-data");
    // ...and no ancestor of it uppercases, which is the defect BUG-0049/0073
    // fixed one label at a time.
    expect(uppercasedIdentifiers(identifier())).toEqual([]);
  });

  it("takes secondary ink where the surface has already said it louder", () => {
    const loud = classesOf(identifier());
    const quiet = classesOf(identifier({ muted: true }));
    // The same type step either way — only the ink job differs, and both are
    // tokens (the palette rules are swept in `tokens.test.ts`).
    expect(quiet).toContain("type-data");
    expect(quiet).not.toEqual(loud);
  });

  it("carries the call site's hooks, which is how oracles address it", () => {
    const $ = cheerio.load(
      identifier({ "data-run-failure-class": "adapter_timeout", id: "run-1" }),
    );
    expect($("[data-run-failure-class]").attr("data-run-failure-class")).toBe(
      "adapter_timeout",
    );
    expect($("#run-1").text()).toBe("data_conflict");
  });

  /**
   * The bidi isolation, on two fixtures (ARCHITECTURE §7, promoted from Common
   * violations row 15; admin-window/BUG-0137). Foreign text reaches prose
   * through an allowlist or inside its own isolated box — and an identifier
   * span is exactly where foreign text lands. Hanging it off the primitive is
   * the rule applied once instead of at 48 call sites.
   *
   * Fixture 1: an identifier carrying an unterminated RIGHT-TO-LEFT OVERRIDE,
   * which before this could reorder the rest of the app's own sentence.
   * Fixture 2: the app's own label beside it, which is not foreign text and
   * must be left exactly as the page wrote it — a component that isolated
   * everything would pass fixture 1 and say nothing.
   */
  it("isolates the identifier, and leaves an ordinary label alone", () => {
    const RLO = "‮";
    const $ = cheerio.load(
      render(
        h(
          "p",
          { className: "type-body" },
          h(Eyebrow, { label: "failure class" }),
          h(Identifier, { children: `adapter${RLO}timeout` }),
          " says whose problem a failure is.",
        ),
      ),
    );
    const isolated = $("[dir]")
      .toArray()
      .map((element) => $(element).text());
    expect(isolated).toEqual([`adapter${RLO}timeout`]);
    // The override is still there — isolation reorders nothing and removes
    // nothing, which is why it is the answer here and a blocklist is not.
    expect($("[dir]").text()).toBe(`adapter${RLO}timeout`);
    expect($("[dir]").attr("dir")).toBe("ltr");
    // ...and the app's own words next to it were not touched.
    expect($("p").text()).toContain(" says whose problem a failure is.");
  });
});

/**
 * One owner for the face (ARCHITECTURE §11 and Common violations row 16).
 *
 * The class pair is derived by RENDERING the primitive rather than typed here,
 * so restyling the identifier moves this guard with it and no literal is
 * pinned; what the guard forbids is a SECOND place in `src/` that spells
 * whatever the primitive spells.
 */
describe("the identifier face has one owner", () => {
  const OWNER = "src/components/ui/identifier.tsx";
  const FACE = classesOf(render(h(Identifier, { children: "x" }))).join(" ");
  const MUTED = classesOf(render(h(Identifier, { children: "x", muted: true }))).join(" ");

  /** Every code line of `text` that spells the face itself. */
  function handSpellingsIn(text: string): string[] {
    return codeLinesIn(text)
      .filter((line) => line.includes(FACE) || line.includes(MUTED))
      .map((line) => line.trim());
  }

  it("flags a hand-spelled face and clears the primitive's own call", () => {
    // Must flag: what `TableName` and `ReviewItems` were, and what 48 call
    // sites spelled.
    expect(
      handSpellingsIn('  return <span className="type-data text-ink">{config.table}</span>;'),
    ).toEqual(['return <span className="type-data text-ink">{config.table}</span>;']);
    // Must NOT flag — or the sweep below is a formality: the primitive's own
    // call, and a comment that names the rule while documenting it.
    for (const clean of [
      "  return <Identifier>{config.table}</Identifier>;",
      "  <Identifier muted data-review-item={reviewItemId}>{reviewItemId}</Identifier>",
      ' * the `type-data text-ink` span this primitive replaced',
    ]) {
      expect(handSpellingsIn(clean), clean).toEqual([]);
    }
  });

  it("leaves no file under src/ but the primitive spelling the face", () => {
    const files = sourceFiles();
    // Non-vacuous on both sides: the walk is plainly the real tree, and the
    // scanner really does see the spelling where it legitimately lives.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(OWNER);
    expect(handSpellingsIn(sourceText(OWNER)).length).toBeGreaterThan(0);
    expect(
      files
        .filter((file) => file !== OWNER)
        .flatMap((file) => handSpellingsIn(sourceText(file)).map((line) => `${file}: ${line}`)),
    ).toEqual([]);
  });
});
