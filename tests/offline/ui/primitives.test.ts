import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty } from "@/components/ui/empty";
import { Eyebrow, microLabelText } from "@/components/ui/micro-label";
import { ErrorLine } from "@/components/ui/error-line";
import { Loading } from "@/components/ui/loading";
import { NotProvisioned } from "@/components/ui/not-provisioned";
import { Page, pageTitleText } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";
import { EM_DASH, absoluteUtc, count, relativeAge } from "@/lib/format";

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

  it("leaves a plain-string title on the h1 itself, as every other page had it", () => {
    // Twelve of the thirteen `Page` callers pass their own words, and the
    // identifier form must not move any of them: one element, no wrapper span,
    // `type-title` on the h1 (admin-window/BUG-0073).
    const html = render(h(Page, { title: "Queues" }));
    const $ = cheerio.load(html);
    expect($("h1").attr("class")?.split(/\s+/)).toContain("type-title");
    expect($("h1 span").length).toBe(0);
    expect($("h1").text()).toBe("Queues");
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

  it("pads the page at the 16px step and spaces its sections at the same step", () => {
    const classes = classesOf(render(h(Page, { title: "Queues" })));
    expect(classes).toContain("p-4");
    expect(classes).toContain("gap-4");
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

  it("sits on a surface fill inside one hairline border, and scrolls inside it", () => {
    const html = table();
    const wrapper = html.slice(0, html.indexOf("<table"));
    expect(wrapper).toContain("border-hairline");
    expect(wrapper).toContain("bg-surface");
    // the scroll container is inside the border, so the page never scrolls sideways
    expect(wrapper.indexOf("border-hairline")).toBeLessThan(wrapper.indexOf("overflow-x-auto"));
  });

  it("separates rows with hairlines and fills them on hover — no zebra, no vertical rules", () => {
    const html = table();
    const rowClasses = [...html.matchAll(/<tr class="([^"]*)"/g)].map((m) => m[1]).slice(1);
    for (const row of rowClasses) {
      expect(row).toContain("border-t");
      expect(row).toContain("hover:bg-chrome");
    }
    const classes = classesOf(html);
    expect(classes.filter((c) => /^(odd|even|nth)[:-]/.test(c))).toEqual([]);
    const cellClasses = [...html.matchAll(/<t[dh][^>]*class="([^"]*)"/g)].map((m) => m[1]);
    for (const cell of cellClasses) {
      expect(cell).not.toMatch(/\bborder-[lr]\b/);
    }
  });

  it("renders a null cell as the dash in disabled-gray, never blank", () => {
    const html = table();
    expect(html).toContain(EM_DASH);
    expect(html).toMatch(/text-ink-disabled[^>]*>—/);
    expect(html).not.toContain("N/A");
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

  it("keeps the chrome fill for every tone — colour lands on the text", () => {
    for (const tone of ["neutral", "high", "low", "healthy", "broken"] as const) {
      expect(classesOf(render(h(Badge, { tone, children: "x" })))).toContain("bg-chrome");
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
  it("are four separate components, each rendering its own shape", () => {
    const loading = render(h(Loading, { what: "cycles" }));
    const empty = render(h(Empty, { holds: "open decisions", filledBy: "the resolver files one here" }));
    const missing = render(h(NotProvisioned, { missing: "verdicts", arrivesWith: "the scraper repo's migration" }));
    const failed = render(
      h(ErrorLine, { reading: "verdicts", failed: "relation does not exist", retry: "reload the page" }),
    );
    expect(new Set([loading, empty, missing, failed]).size).toBe(4);
  });

  it("names what is loading on one data line and never animates", () => {
    const html = render(h(Loading, { what: "cycles" }));
    expect(classesOf(html)).toContain("type-data");
    expect(html).toContain("cycles");
    expect(classesOf(html).some((c) => /animate|pulse|spin/.test(c))).toBe(false);
  });

  it("renders empty as a surface card carrying both what it holds and what fills it", () => {
    const html = render(h(Empty, { holds: "open decisions", filledBy: "the resolver files one here" }));
    expect(classesOf(html)).toContain("bg-surface");
    expect(classesOf(html)).toContain("border-hairline");
    expect(html).toContain("open decisions");
    expect(html).toContain("the resolver files one here");
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

  it("falls back to the failure alone when the read it was given names nothing", () => {
    // The type forces the prop; it cannot force the string to say something,
    // since `""` is a `string`. A blank read gets the app's one definition of
    // absence rather than a dangling em dash (`isAbsent` — BUG-0004/BUG-0019).
    for (const reading of ["", "   "]) {
      const html = render(h(ErrorLine, { reading, failed: "no such relation", retry: "reload" }));
      expect(textOf(html), JSON.stringify(reading)).not.toContain(EM_DASH);
      expect(textOf(html), JSON.stringify(reading)).toContain("no such relation");
    }
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

  it("clears the same card once the identifier is out of the sans label", () => {
    const good = render(
      h(StatCard, { label: { identifier: "data_conflict", words: "open" }, value: 0 }),
    );
    expect(uppercasedIdentifiers(good)).toEqual([]);
    // and the identifier really is still on the card — the guard is not
    // satisfied by deleting the word
    expect(textOf(good)).toContain("data_conflict");
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

  it("clears the same page once the identifier is out of the title element", () => {
    const good = render(
      h(Page, { title: { identifier: "walk_sandbox", words: "record" } }),
    );
    expect(uppercasedIdentifiers(good)).toEqual([]);
    expect(textOf(good)).toContain("walk_sandbox");
  });
});
