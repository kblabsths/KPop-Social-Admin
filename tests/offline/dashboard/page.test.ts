import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_WINDOW } from "@/lib/db/dashboard";
import { T } from "@/lib/db/tables";
import { absoluteUtc } from "@/lib/format";
import { render } from "../ui/markup";
import { readNumber } from "../../live/parity";
import {
  resolutionRunRow,
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemSourcePattern,
  runRow,
  type ResolutionRunRow,
  type ReviewItemRow,
  type RunRow,
} from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type Script,
} from "../../fixtures/stub-client";

/**
 * The Dashboard, rendered (campaign admin-window/TASK-0009).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await DashboardPage())` — no jsdom, no Testing
 * Library, no database. `readDashboard` is stubbed at the module boundary so
 * every state is reachable offline; the reads themselves are exercised in
 * `read.test.ts`.
 *
 * These assert STRUCTURE and BEHAVIOUR — which numbers stand under which
 * label, which links they carry, which rows render in which order, which state
 * a surface falls into — and the machine's own strings where rendering them
 * VERBATIM is the requirement (`severity`, `outcome`, `error_summary`). No
 * copy of the app's own words and no class name is pinned: those belong to the
 * designer and the walk.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/dashboard", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/dashboard")>();
  return {
    ...actual,
    readDashboard: () =>
      actual.readDashboard(actual.DASHBOARD_WINDOW, readWith.client as never),
  };
});

const { default: DashboardPage } = await import("@/app/page");

/* ── the population ──────────────────────────────────────────────────────── */

const CYCLE_NEWEST = "01920000-0000-7000-8000-0000000006a3";
const CYCLE_MIDDLE = "01920000-0000-7000-8000-0000000006a2";
const CYCLE_OLDEST = "01920000-0000-7000-8000-0000000006a1";
const RUN_NEWEST = "01920000-0000-7000-8000-0000000007a2";
const RUN_OLDEST = "01920000-0000-7000-8000-0000000007a1";

/** A `resolution_runs` error, spelled the way the resolver spells one. */
const CYCLE_ERROR =
  "apply_resolution failed for events.starts_at: 23514 check constraint violated";
/** An adapter `runs` error. */
const RUN_ERROR = "ticketmaster: 429 rate limited after 3 retries";

/**
 * Review items in both kinds and both severities, plus a settled one.
 *
 * `openDecisions`/`openSignals` below derive the expected counts from this
 * population with the test's OWN predicate, never by calling the app's — the
 * same two-paths-to-one-number rule the live parity test follows.
 */
function reviewItems(): ReviewItemRow[] {
  return [
    // decisions: one high (older), one low
    reviewItemDataConflict({ severity: "high", opened_at: "2026-08-30T06:00:00Z" }),
    reviewItemEntityLink({ severity: "low", opened_at: "2026-08-31T06:00:00Z" }),
    // a signal: `entity_link` with a source_id
    reviewItemSourcePattern({ severity: "high", opened_at: "2026-08-28T06:00:00Z" }),
    // settled items are browsable, never "attention"
    reviewItemDataConflict({
      review_item_id: "01920000-0000-7000-8000-000000000599",
      status: "settled",
      severity: "high",
      opened_at: "2026-08-01T06:00:00Z",
    }),
  ];
}

/**
 * The signal predicate, written HERE rather than imported: an `entity_link`
 * item whose subject is the source itself (spec §6). Two independent paths to
 * one number, or the parity proves nothing.
 */
function isSignal(item: ReviewItemRow): boolean {
  return item.queue === "entity_link" && item.source_id !== null;
}

function openDecisions(items: ReviewItemRow[]): ReviewItemRow[] {
  return items.filter((item) => item.status === "open" && !isSignal(item));
}

function openSignals(items: ReviewItemRow[]): ReviewItemRow[] {
  return items.filter((item) => item.status === "open" && isSignal(item));
}

/** Newest first, as the read asks the database to order them. */
function cycles(): ResolutionRunRow[] {
  return [
    resolutionRunRow({
      run_id: CYCLE_NEWEST,
      started_at: "2026-09-01T05:00:00Z",
      // still running: no end, no outcome
      ended_at: null,
      outcome: null,
      applied: 0,
      escalated: 0,
      errors: 0,
      error_summary: null,
    }),
    resolutionRunRow({
      run_id: CYCLE_MIDDLE,
      started_at: "2026-09-01T04:45:00Z",
      ended_at: "2026-09-01T04:45:02Z",
      outcome: "skipped",
      applied: 0,
      escalated: 0,
      errors: 0,
      error_summary: null,
    }),
    resolutionRunRow({
      run_id: CYCLE_OLDEST,
      started_at: "2026-09-01T04:30:00Z",
      ended_at: "2026-09-01T04:33:20Z",
      outcome: "failed",
      applied: 37,
      escalated: 3,
      errors: 2,
      error_summary: CYCLE_ERROR,
    }),
  ];
}

function runs(): RunRow[] {
  return [
    runRow({
      run_id: RUN_NEWEST,
      source: "bandsintown",
      started_at: "2026-09-01T03:30:00Z",
      ended_at: null,
      outcome: null,
      error_summary: null,
      // a column the Dashboard must NOT show (see the OPEN-RUNS case below)
      claims_emitted: 7777,
    }),
    runRow({
      run_id: RUN_OLDEST,
      source: "ticketmaster",
      started_at: "2026-09-01T03:00:00Z",
      ended_at: "2026-09-01T03:02:11Z",
      outcome: "failed",
      error_summary: RUN_ERROR,
      claims_emitted: 7777,
    }),
  ];
}

function healthyScript(overrides: Script = {}): Script {
  const items = reviewItems();
  return {
    [T.reviewItems]: { data: items, count: items.length },
    [T.resolutionRuns]: { data: cycles() },
    [T.runs]: { data: runs() },
    ...overrides,
  };
}

async function renderDashboard(script: Script): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await DashboardPage());
}

/* ── reading the markup, structurally ────────────────────────────────────── */

/** The `href` of the link the count under `label` sits inside. */
function countHref(markup: string, label: string): string | undefined {
  const $ = cheerio.load(markup);
  return $("a")
    .toArray()
    .map((element) => $(element))
    .find((node) => node.text().includes(label))
    ?.attr("href");
}

/** The rows of the named table, each as its header-keyed cells. */
function rowsOf(markup: string, table: string): Record<string, string>[] {
  const $ = cheerio.load(markup);
  const scope = $(`table[aria-label="${table}"]`);
  const labels = scope
    .find("thead th")
    .toArray()
    .map((th) => $(th).text().trim());
  return scope
    .find("tbody tr")
    .toArray()
    .map((tr) => {
      const cells = $(tr)
        .find("td")
        .toArray()
        .map((td) => $(td).text().replace(/\s+/g, " ").trim());
      return Object.fromEntries(labels.map((label, i) => [label, cells[i] ?? ""]));
    });
}

/** The `data-outcome` value of each row of the named table, in row order. */
function outcomesOf(markup: string, table: string): (string | undefined)[] {
  const $ = cheerio.load(markup);
  return $(`table[aria-label="${table}"] tbody tr`)
    .toArray()
    .map((tr) => $(tr).find("[data-outcome]").first().attr("data-outcome"));
}

/** Every error line's text and the row it links to, in the named table. */
function errorLinesOf(markup: string, table: string): { text: string; href: string }[] {
  const $ = cheerio.load(markup);
  return $(`table[aria-label="${table}"] [data-error-line]`)
    .toArray()
    .map((element) => ({
      text: $(element).text().replace(/\s+/g, " ").trim(),
      href: $(element).attr("href") ?? "",
    }));
}

/** The whole rendered text, tags stripped. */
function textOf(markup: string): string {
  return cheerio.load(markup).root().text();
}

/* ── the populated case ──────────────────────────────────────────────────── */

describe("the attention summary", () => {
  it("renders decision and signal counts as two separate figures", async () => {
    const markup = await renderDashboard(healthyScript());
    const items = reviewItems();

    expect(readNumber(markup, "Open decisions")).toBe(openDecisions(items).length);
    expect(readNumber(markup, "Open signals")).toBe(openSignals(items).length);
  });

  it("counts open items alone — a settled item is browsable, never attention", async () => {
    const items = reviewItems();
    const markup = await renderDashboard(healthyScript());

    // The population holds a settled high-severity decision; it is not counted.
    expect(items.some((item) => item.status === "settled")).toBe(true);
    expect(readNumber(markup, "Open decisions")).toBe(
      items.filter((item) => item.status === "open" && !isSignal(item)).length,
    );
  });

  it("gives the two counts equal standing — same container, same level", async () => {
    const markup = await renderDashboard(healthyScript());
    const $ = cheerio.load(markup);
    const cards = $('a[href^="/queues?"]').toArray();

    expect(cards).toHaveLength(2);
    // Siblings of one parent: neither is nested inside, beside or beneath the
    // other (LOOK_AND_FEEL quality bar 2).
    const parents = cards.map((card) => $(card).parent().get(0));
    expect(parents[0]).toBe(parents[1]);
    // Same element, same classes: neither is styled as the primary inbox.
    expect($(cards[0]).attr("class")).toBe($(cards[1]).attr("class"));
    expect(cards[0].tagName).toBe(cards[1].tagName);
  });

  it("links each count into the queue filtered to that kind", async () => {
    const markup = await renderDashboard(healthyScript());

    const decisions = countHref(markup, "Open decisions");
    const signals = countHref(markup, "Open signals");
    expect(decisions).toBeDefined();
    expect(signals).toBeDefined();
    expect(decisions).not.toBe(signals);
    for (const href of [decisions, signals]) {
      expect(href?.startsWith("/queues?")).toBe(true);
    }
    // The parameter carries the kind the card counts.
    expect(new URL(decisions as string, "https://x.invalid").searchParams.get("kind")).toBe(
      "decision",
    );
    expect(new URL(signals as string, "https://x.invalid").searchParams.get("kind")).toBe(
      "signal",
    );
  });

  it("shows the registry's severity word verbatim, and no number beside it", async () => {
    const markup = await renderDashboard(healthyScript());
    const $ = cheerio.load(markup);
    const card = $('a[href*="kind=decision"]').text();
    const items = openDecisions(reviewItems());

    // The population's decisions include a `high`, so `high` is the max.
    expect(items.some((item) => item.severity === "high")).toBe(true);
    expect(card).toContain("high");
    // Verbatim means verbatim: the registry's word, never a number standing
    // for it and never a percentage — the ranking formula is parked.
    expect(card).not.toMatch(/high\s*[:=]?\s*\d/);
    expect(card).not.toContain("%");
  });

  it("shows the oldest open item's age, with the absolute instant in the title", async () => {
    const markup = await renderDashboard(healthyScript());
    const $ = cheerio.load(markup);

    for (const [kind, open] of [
      ["decision", openDecisions(reviewItems())],
      ["signal", openSignals(reviewItems())],
    ] as const) {
      const oldest = [...open].sort(
        (a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at),
      )[0];
      const titles = $(`a[href*="kind=${kind}"] [title]`)
        .toArray()
        .map((element) => $(element).attr("title"));
      expect(titles, kind).toContain(absoluteUtc(oldest.opened_at));
    }
  });
});

describe("last night's cycles and runs", () => {
  it("renders the cycles the read returned, in the order it returned them", async () => {
    // The database does the ordering (newest first — asserted on the query in
    // read.test.ts); the page must not reshuffle what it was handed.
    const markup = await renderDashboard(healthyScript());
    const $ = cheerio.load(markup);
    const rendered = $('table[aria-label="cycles"] tbody tr')
      .toArray()
      .map((tr) => $(tr).find('a[href^="/cycles?"]').first().attr("href"));

    expect(rendered).toEqual(
      cycles().map((row) => `/cycles?cycle=${row.run_id}`),
    );
  });

  it("renders the runs the read returned, in the order it returned them", async () => {
    const markup = await renderDashboard(healthyScript());
    const $ = cheerio.load(markup);
    const rendered = $('table[aria-label="runs"] tbody tr')
      .toArray()
      .map((tr) => $(tr).find('a[href^="/cycles?"]').first().attr("href"));

    expect(rendered).toEqual(runs().map((row) => `/cycles?run=${row.run_id}`));
  });

  it("surfaces each error_summary verbatim, linked to the row that produced it", async () => {
    const markup = await renderDashboard(healthyScript());

    expect(errorLinesOf(markup, "cycles")).toEqual([
      { text: CYCLE_ERROR, href: `/cycles?cycle=${CYCLE_OLDEST}` },
    ]);
    expect(errorLinesOf(markup, "runs")).toEqual([
      { text: RUN_ERROR, href: `/cycles?run=${RUN_OLDEST}` },
    ]);
  });

  it("reads a still-running cycle and a skipped cycle each as such", async () => {
    const markup = await renderDashboard(healthyScript());

    // Row order is the read's: newest (running), skipped, failed.
    expect(outcomesOf(markup, "cycles")).toEqual(["running", "skipped", "failed"]);
    // The producer's own word, rendered verbatim.
    expect(rowsOf(markup, "cycles")[1].outcome).toBe("skipped");
  });

  it("shows a run's source, when, outcome and error — and no other run column", async () => {
    // The Cycles & runs page's column set for adapter runs is a blocked
    // question (ARCHITECTURE §12 OPEN-RUNS); the Dashboard answers only its
    // own, so a counter like `claims_emitted` must not appear here.
    const markup = await renderDashboard(healthyScript());
    const rows = rowsOf(markup, "runs");

    expect(rows).toHaveLength(runs().length);
    expect(Object.keys(rows[0])).toHaveLength(4);
    expect(rows[1].source).toBe("ticketmaster");
    expect(rows[1].outcome).toBe("failed");
    expect(textOf(markup)).not.toContain("7777");
  });

  it("renders each cycle's own counts, not a total over the window", async () => {
    const markup = await renderDashboard(healthyScript());
    const rows = rowsOf(markup, "cycles");
    const expected = cycles();

    expect(rows).toHaveLength(expected.length);
    rows.forEach((row, index) => {
      expect(row.applied).toBe(String(expected[index].applied));
      expect(row.escalated).toBe(String(expected[index].escalated));
      expect(row.errors).toBe(String(expected[index].errors));
    });
  });
});

describe("no parked surface", () => {
  it("renders none of the surfaces whose producers do not exist", async () => {
    const markup = await renderDashboard(healthyScript()).then(textOf);
    for (const parked of ["recommendation", "incident", "agent run", "operator"]) {
      expect(markup.toLowerCase(), parked).not.toContain(parked);
    }
  });
});

/* ── the empty case ──────────────────────────────────────────────────────── */

describe("with the tables present and empty", () => {
  const emptyScript: Script = {
    [T.reviewItems]: { data: [], count: 0 },
    [T.resolutionRuns]: { data: [] },
    [T.runs]: { data: [] },
  };

  it("renders a real zero for each kind — the read said so", async () => {
    const markup = await renderDashboard(emptyScript);

    expect(readNumber(markup, "Open decisions")).toBe(0);
    expect(readNumber(markup, "Open signals")).toBe(0);
  });

  it("keeps both counts linked, so an empty queue is still reachable", async () => {
    const markup = await renderDashboard(emptyScript);
    const $ = cheerio.load(markup);

    expect($('a[href^="/queues?"]')).toHaveLength(2);
  });

  it("renders the empty state for cycles and runs, not a table of nothing", async () => {
    const markup = await renderDashboard(emptyScript);
    const $ = cheerio.load(markup);

    expect($('table[aria-label="cycles"]')).toHaveLength(0);
    expect($('table[aria-label="runs"]')).toHaveLength(0);
    // Words under each heading say what the surface will hold.
    expect(textOf(markup).length).toBeGreaterThan(0);
  });
});

/* ── the not-provisioned case ────────────────────────────────────────────── */

describe("against a database without the ecosystem tables", () => {
  const absentScript: Script = {
    [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
    [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
    [T.runs]: { error: tableNotInSchemaCache(T.runs) },
  };

  it("renders, names every missing table, and throws nothing", async () => {
    const markup = await renderDashboard(absentScript);
    const text = textOf(markup);

    expect(markup.length).toBeGreaterThan(0);
    for (const missing of [T.reviewItems, T.resolutionRuns, T.runs]) {
      expect(text, missing).toContain(missing);
    }
  });

  it("shows no count at all — a missing table is never a zero", async () => {
    const markup = await renderDashboard(absentScript);
    const $ = cheerio.load(markup);

    // No count card at all, and no standalone digit anywhere in the surface.
    expect($('a[href^="/queues?"]')).toHaveLength(0);
    expect(textOf(markup)).not.toMatch(/(?<!\d)0(?!\d)/);
  });

  it("keeps the surfaces independent — one absent table leaves the others rendering", async () => {
    const markup = await renderDashboard(
      healthyScript({
        [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
      }),
    );

    expect(readNumber(markup, "Open decisions")).toBe(
      openDecisions(reviewItems()).length,
    );
    expect(textOf(markup)).toContain(T.resolutionRuns);
    expect(rowsOf(markup, "runs")).toHaveLength(runs().length);
  });
});

/* ── the error case ──────────────────────────────────────────────────────── */

describe("when a read fails", () => {
  it("names the read that refused, on every surface", async () => {
    const markup = await renderDashboard({
      [T.reviewItems]: { error: permissionDenied(T.reviewItems) },
      [T.resolutionRuns]: { error: permissionDenied(T.resolutionRuns) },
      [T.runs]: { error: permissionDenied(T.runs) },
    });
    const $ = cheerio.load(markup);
    const lines = $('[role="alert"]')
      .toArray()
      .map((element) => $(element).text());

    expect(lines).toHaveLength(3);
    for (const missing of [T.reviewItems, T.resolutionRuns, T.runs]) {
      expect(
        lines.some((line) => line.includes(missing)),
        missing,
      ).toBe(true);
    }
  });

  it("carries the client's whole account of a transport failure, untrimmed", async () => {
    // BUG-0016's residual: the red line carries every field the client gave,
    // stack frame included. Trimming it silently is the defect.
    const failure = transportFailure();
    const markup = await renderDashboard({
      [T.reviewItems]: { error: failure },
      [T.resolutionRuns]: { error: failure },
      [T.runs]: { error: failure },
    });
    const text = textOf(markup);

    expect(text).toContain("Caused by");
    expect(text).toContain("makeNetworkError");
  });

  it("renders no figure when the count read refused", async () => {
    // A complete read that came back without a count is a refusal, not a zero
    // (ARCHITECTURE §4.3) — so the page must show no number under the label.
    const markup = await renderDashboard(
      healthyScript({ [T.reviewItems]: { data: reviewItems() } }),
    );

    expect(() => readNumber(markup, "Open decisions")).toThrow();
    expect(textOf(markup)).toContain(T.reviewItems);
  });
});

/* ── the window ──────────────────────────────────────────────────────────── */

describe("the cycles and runs window", () => {
  it("never renders more lines than the window it asked for", async () => {
    const many = Array.from({ length: DASHBOARD_WINDOW + 4 }, (_, index) =>
      resolutionRunRow({
        run_id: `01920000-0000-7000-8000-0000000006${String(index).padStart(2, "0")}`,
        started_at: `2026-09-01T0${index % 10}:00:00Z`,
      }),
    );
    // The database honours the limit; the page renders what it was handed.
    const markup = await renderDashboard(
      healthyScript({
        [T.resolutionRuns]: { data: many.slice(0, DASHBOARD_WINDOW) },
      }),
    );

    expect(rowsOf(markup, "cycles")).toHaveLength(DASHBOARD_WINDOW);
  });

  it("renders the source of every run row it was handed", async () => {
    const markup = await renderDashboard(healthyScript());
    const sources = rowsOf(markup, "runs").map((row) => row.source);

    expect(sources).toEqual(runs().map((row) => row.source));
  });
});
