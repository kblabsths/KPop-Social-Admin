import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty } from "@/components/ui/empty";
import { ErrorLine } from "@/components/ui/error-line";
import { Loading } from "@/components/ui/loading";
import { NotProvisioned } from "@/components/ui/not-provisioned";
import { Page } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";
import { EM_DASH, absoluteUtc, count, relativeAge } from "@/lib/format";

import { classesOf, h, render, tagsOf, textOf } from "./markup";

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

  it("pads the page at the 16px step and spaces its sections at the same step", () => {
    const classes = classesOf(render(h(Page, { title: "Queues" })));
    expect(classes).toContain("p-4");
    expect(classes).toContain("gap-4");
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
