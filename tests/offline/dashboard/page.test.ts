import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { cycleState } from "@/lib/cycles/state";
import { DASHBOARD_WINDOW } from "@/lib/db/dashboard";
import { RESOLVER_CADENCE_SECONDS } from "@/lib/gauges/gauge";
import { T } from "@/lib/db/tables";
import { absoluteUtc } from "@/lib/format";
import { render } from "../ui/markup";
import { blankCells } from "../absence/surfaces";
import { oneEach, readNumber, surfaceHooks } from "../../live/parity";
import type { ResolutionRunRow as CycleRow } from "@/lib/db/cycles";
import {
  resolutionRunRow,
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemSourcePattern,
  runRow,
  type ResolutionOutcome,
  type ResolutionRunRow,
  type ReviewItemRow,
  type RunRow,
} from "../../fixtures/rows";
/*
 * The Cycles & runs fixtures, borrowed rather than re-hand-rolled: the
 * property pinned below is that the two surfaces agree about ONE population,
 * and a second copy of it here could drift from the one the other surface is
 * rendered against.
 */
import {
  APPLIES as CYCLE_APPLIES,
  CYCLES as CYCLE_POPULATION,
  DIED as DIED_CYCLE,
  OBSERVED as CYCLE_OBSERVED,
  RUNNING as RUNNING_CYCLE,
} from "../cycles/population";
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

/*
 * The OTHER surface that renders a cycle, routed through the same stub client
 * so one population can be rendered on both pages and their words compared
 * ("one word per cycle, on every surface", below). What /cycles renders on its
 * own is asserted in `tests/offline/cycles/`, never here.
 */
vi.mock("@/lib/db/cycles", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/cycles")>();
  return { ...actual, readCycles: (limit?: number) => actual.readCycles(limit, readWith.client as never) };
});
vi.mock("@/lib/db/runs", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/runs")>();
  return {
    ...actual,
    readRuns: (filter?: unknown) => actual.readRuns((filter ?? {}) as never, readWith.client as never),
  };
});
vi.mock("@/lib/gauges/cycle-health", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/cycle-health")>();
  return {
    ...actual,
    readCycleHealth: (options?: unknown) =>
      actual.readCycleHealth((options ?? {}) as never, readWith.client as never),
  };
});
vi.mock("@/lib/gauges/resolution-latency", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/resolution-latency")>();
  return {
    ...actual,
    readResolutionLatency: (options?: unknown) =>
      actual.readResolutionLatency((options ?? {}) as never, readWith.client as never),
  };
});

const { default: CyclesPage } = await import("@/app/cycles/page");

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

/**
 * The instant the cycle fixtures below are built from.
 *
 * They are RELATIVE to the moment the suite loads, because the page reads the
 * real clock to tell a running cycle from one that died
 * (admin-window/BUG-0074): a literal date decides a fixture's state by how
 * long ago the file was typed, so the "still running" cycle here was running
 * on the day it was written and a corpse a week later.
 * `tests/offline/cycles/population.ts` is built this way for the same reason.
 */
const SUITE_NOW = Date.now();

/** An ISO instant `minutes` before the suite loaded. */
function minutesAgo(minutes: number): string {
  return new Date(SUITE_NOW - minutes * 60_000).toISOString();
}

/** `started` plus `seconds` — when a cycle that finished ended. */
function secondsAfter(started: string, seconds: number): string {
  return new Date(Date.parse(started) + seconds * 1_000).toISOString();
}

/** Newest first, as the read asks the database to order them. */
function cycles(): ResolutionRunRow[] {
  const skippedAt = minutesAgo(17);
  const failedAt = minutesAgo(32);
  return [
    resolutionRunRow({
      run_id: CYCLE_NEWEST,
      // still running: no end, no outcome, and inside the resolver's cadence
      started_at: minutesAgo(2),
      ended_at: null,
      outcome: null,
      applied: 0,
      escalated: 0,
      errors: 0,
      error_summary: null,
    }),
    resolutionRunRow({
      run_id: CYCLE_MIDDLE,
      started_at: skippedAt,
      ended_at: secondsAfter(skippedAt, 2),
      outcome: "skipped",
      applied: 0,
      escalated: 0,
      errors: 0,
      error_summary: null,
    }),
    resolutionRunRow({
      run_id: CYCLE_OLDEST,
      started_at: failedAt,
      ended_at: secondsAfter(failedAt, 200),
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

/**
 * Does each row of the named table render the app's ABSENCE in that column?
 *
 * `[aria-label="no value"]` is the one absence rendering (`nullDash`,
 * `lib/format.ts`), so this reads what an operator is shown — a cell that is
 * empty, or one carrying anything else, answers false — without pinning the
 * dash character or a class name.
 */
function absencesOf(markup: string, table: string, column: string): boolean[] {
  const $ = cheerio.load(markup);
  const scope = $(`table[aria-label="${table}"]`);
  const at = scope
    .find("thead th")
    .toArray()
    .map((th) => $(th).text().trim())
    .indexOf(column);
  if (at < 0) throw new Error(`table ${table} has no ${column} column`);
  return scope
    .find("tbody tr")
    .toArray()
    .map((tr) => $(tr).find("td").eq(at).find('[aria-label="no value"]').length > 0);
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

/* ── the adversarial pass (QA, campaign admin-window/TASK-0009) ──────────── */

/**
 * The states the builder's own cases do not reach: producer text that is
 * hostile or enormous, an attention read that came back TRUNCATED rather than
 * uncounted, a population whose only high-severity item is settled, an open
 * set that ties on the instant, an adapter outcome the check constraint allows
 * but this page has no tone for, and an absent table beside a present one.
 *
 * Behaviour only — which figure stands under which label, which state a
 * surface falls into, what round-trips verbatim. No copy and no class is
 * pinned here either.
 */

/** The smallest element whose text carries `needle` — the card that names it. */
function cardNaming(markup: string, needle: string) {
  const $ = cheerio.load(markup);
  const nodes = $("*")
    .toArray()
    .filter((element) => $(element).text().includes(needle))
    .sort((a, b) => $(a).text().length - $(b).text().length);
  return $(nodes[0]);
}

describe("hostile and boundary producer text", () => {
  it("renders an error_summary carrying markup as text, spawning no element", async () => {
    // `error_summary` is the producer's own string and is rendered verbatim.
    // Verbatim must not mean *interpreted*: a summary quoting a payload it
    // failed to parse can carry anything at all.
    const payload =
      '<script>alert("cycle")</script><img src=x onerror=alert(1)> & <b>b</b>';
    const markup = await renderDashboard(
      healthyScript({
        [T.resolutionRuns]: {
          data: [
            resolutionRunRow({
              run_id: CYCLE_OLDEST,
              outcome: "failed",
              error_summary: payload,
            }),
          ],
        },
        [T.runs]: {
          data: [runRow({ run_id: RUN_OLDEST, outcome: "failed", error_summary: payload })],
        },
      }),
    );
    const $ = cheerio.load(markup);

    // Nothing in the payload became part of the document.
    expect($("script")).toHaveLength(0);
    expect($("img")).toHaveLength(0);
    expect($("b")).toHaveLength(0);
    // And the operator still reads exactly what the database holds.
    expect(errorLinesOf(markup, "cycles")).toEqual([
      { text: payload, href: `/cycles?cycle=${CYCLE_OLDEST}` },
    ]);
    expect(errorLinesOf(markup, "runs")).toEqual([
      { text: payload, href: `/cycles?run=${RUN_OLDEST}` },
    ]);
  });

  it("renders a very long error_summary in full — untrimmed, still linked", async () => {
    // "Never trimmed, never summarised" is the contract; a truncated error
    // line is a wrong error line, and the trim would be silent.
    const enormous = "E".repeat(5000);
    const markup = await renderDashboard(
      healthyScript({
        [T.runs]: {
          data: [runRow({ run_id: RUN_OLDEST, outcome: "failed", error_summary: enormous })],
        },
      }),
    );
    const lines = errorLinesOf(markup, "runs");

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toHaveLength(5000);
    expect(lines[0].text).toBe(enormous);
    expect(lines[0].href).toBe(`/cycles?run=${RUN_OLDEST}`);
  });

  it("renders an adapter outcome it has no tone for, verbatim", async () => {
    // `runs.outcome` admits four values (migration 20260829000001); this page
    // colours two of them. The other two must still read as themselves rather
    // than be dropped or coerced into one it knows.
    const markup = await renderDashboard(
      healthyScript({
        [T.runs]: {
          data: [runRow({ run_id: RUN_OLDEST, ended_at: "2026-09-01T03:02:11Z", outcome: "partial" })],
        },
      }),
    );

    expect(outcomesOf(markup, "runs")).toEqual(["partial"]);
    expect(rowsOf(markup, "runs")[0].outcome).toBe("partial");
  });

  it("reads an adapter run still in flight as running, not as a blank", async () => {
    // The cycles half is asserted above; the runs half shares the rendering
    // and nothing pinned it. A run row is inserted at start, so a null
    // `ended_at` with a null `outcome` is the commonest live row there is.
    const markup = await renderDashboard(healthyScript());

    expect(outcomesOf(markup, "runs")).toEqual(["running", "failed"]);
  });
});

describe("the attention summary under refusal and ties", () => {
  it("renders no figure when the attention read was truncated, and says how many", async () => {
    // Distinct from the uncounted case above: here the count came back and is
    // LARGER than the rows. A number derived from that set would be wrong on
    // the one screen whose job is 'what needs me' — so no number renders and
    // the refusal carries the real count.
    const items = reviewItems();
    const markup = await renderDashboard(
      healthyScript({ [T.reviewItems]: { data: items, count: 4210 } }),
    );
    const $ = cheerio.load(markup);
    const alert = $('[role="alert"]').text();

    expect(() => readNumber(markup, "Open decisions")).toThrow();
    expect(() => readNumber(markup, "Open signals")).toThrow();
    expect($('a[href^="/queues?"]')).toHaveLength(0);
    expect(alert).toContain("4210");
    expect(alert).toContain(T.reviewItems);
  });

  it("fabricates no severity or age from settled items when nothing is open", async () => {
    // Every item settled, every one of them `high`. The open count is a real
    // zero, and neither the severity nor the oldest age may be borrowed from
    // a row that is not attention.
    const settled: ReviewItemRow[] = [
      reviewItemDataConflict({
        review_item_id: "01920000-0000-7000-8000-000000000901",
        status: "settled",
        severity: "high",
        opened_at: "2026-07-01T06:00:00Z",
      }),
      reviewItemSourcePattern({
        review_item_id: "01920000-0000-7000-8000-000000000902",
        status: "settled",
        severity: "high",
        opened_at: "2026-07-02T06:00:00Z",
      }),
    ];
    const markup = await renderDashboard(
      healthyScript({ [T.reviewItems]: { data: settled, count: settled.length } }),
    );
    const $ = cheerio.load(markup);

    expect(readNumber(markup, "Open decisions")).toBe(0);
    expect(readNumber(markup, "Open signals")).toBe(0);
    for (const kind of ["decision", "signal"]) {
      const card = $(`a[href*="kind=${kind}"]`);
      expect(card, kind).toHaveLength(1);
      // No severity word borrowed from the settled rows...
      expect(card.text(), kind).not.toMatch(/\bhigh\b|\blow\b/);
      // ...and no age either: an age element is a titled span.
      expect(card.find("[title]"), kind).toHaveLength(0);
      // The settled rows' instants reach nothing on this page.
      expect(card.text(), kind).not.toContain("2026-07");
    }
  });

  it("shows one oldest age per kind when every open item shares an instant", async () => {
    const instant = "2026-08-30T06:00:00Z";
    const tied: ReviewItemRow[] = [
      reviewItemDataConflict({
        review_item_id: "01920000-0000-7000-8000-000000000911",
        opened_at: instant,
      }),
      reviewItemEntityLink({
        review_item_id: "01920000-0000-7000-8000-000000000912",
        opened_at: instant,
      }),
      reviewItemSourcePattern({
        review_item_id: "01920000-0000-7000-8000-000000000913",
        opened_at: instant,
      }),
    ];
    const markup = await renderDashboard(
      healthyScript({ [T.reviewItems]: { data: tied, count: tied.length } }),
    );
    const $ = cheerio.load(markup);

    expect(readNumber(markup, "Open decisions")).toBe(2);
    expect(readNumber(markup, "Open signals")).toBe(1);
    for (const kind of ["decision", "signal"]) {
      const titles = $(`a[href*="kind=${kind}"] [title]`)
        .toArray()
        .map((element) => $(element).attr("title"));
      // Exactly one age, and it is the instant they all share.
      expect(titles, kind).toEqual([absoluteUtc(instant)]);
    }
  });
});

describe("one absent table beside a present one", () => {
  it("names the absent object without a zero anywhere in the card that names it", async () => {
    // LOOK_AND_FEEL bar 4: not-provisioned is never a zero. The counts of the
    // reads that DID succeed still render, so the absence must be legible as
    // absence rather than as 'nothing happened last night'.
    const markup = await renderDashboard(
      healthyScript({
        [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
      }),
    );
    const $ = cheerio.load(markup);

    expect($('table[aria-label="cycles"]')).toHaveLength(0);
    expect($('table[aria-label="runs"]')).toHaveLength(1);
    expect(readNumber(markup, "Open decisions")).toBe(
      openDecisions(reviewItems()).length,
    );
    // The card that names the missing object states no quantity at all.
    const card = cardNaming(markup, T.resolutionRuns);
    expect(card.text()).toContain(T.resolutionRuns);
    expect(card.text()).not.toMatch(/\d/);
    // ...and it is not the red state: an absence is not a breakage.
    expect(card.closest('[role="alert"]')).toHaveLength(0);
  });
});


describe("a cycle or run that reported nothing", () => {
  // campaign admin-window/BUG-0026: the two `error` columns and the two
  // `outcome` columns yield the ABSENCE ITSELF to the table. A column that
  // hands `DataTable` a component element instead hides the null from `orDash`
  // and leaves the cell empty, which is what an operator sees as a table with
  // holes in it.

  it("renders the shared absence, not an empty cell, where there is no error", async () => {
    const markup = await renderDashboard(healthyScript());

    // Two of the three cycles and one of the two runs reported no error.
    expect(absencesOf(markup, "cycles", "error")).toEqual([true, true, false]);
    expect(absencesOf(markup, "runs", "error")).toEqual([true, false]);
    // Nothing on the page renders a cell with nothing in it.
    expect(blankCells(markup)).toBe(0);
    // ...and the rows that DID report one are untouched: verbatim and linked.
    expect(errorLinesOf(markup, "cycles")).toEqual([
      { text: CYCLE_ERROR, href: `/cycles?cycle=${CYCLE_OLDEST}` },
    ]);
    expect(errorLinesOf(markup, "runs")).toEqual([
      { text: RUN_ERROR, href: `/cycles?run=${RUN_OLDEST}` },
    ]);
  });

  it("reads a row that ENDED with no outcome recorded as an absence, not as running", async () => {
    // `resolution_runs.outcome` and `runs.outcome` are null until completion,
    // so a row that ended without one is a real state and not a fixture
    // curiosity. The page invents no word for it — the table's own dash says
    // the producer recorded none — and it must not read as "still running",
    // which is the OTHER null-outcome state.
    const markup = await renderDashboard(
      healthyScript({
        [T.resolutionRuns]: {
          data: [
            resolutionRunRow({
              run_id: CYCLE_OLDEST,
              started_at: "2026-09-01T04:30:00Z",
              ended_at: "2026-09-01T04:33:20Z",
              outcome: null,
              error_summary: null,
            }),
          ],
        },
        [T.runs]: {
          data: [
            runRow({
              run_id: RUN_OLDEST,
              started_at: "2026-09-01T03:00:00Z",
              ended_at: "2026-09-01T03:02:11Z",
              outcome: null,
              error_summary: null,
            }),
          ],
        },
      }),
    );

    for (const table of ["cycles", "runs"]) {
      expect(absencesOf(markup, table, "outcome"), table).toEqual([true]);
      // No state word was borrowed: neither an outcome nor "running".
      expect(outcomesOf(markup, table), table).toEqual([undefined]);
    }
    expect(blankCells(markup)).toBe(0);
    // The still-running rendering is still reachable — this is the other state.
    const running = await renderDashboard(healthyScript());
    expect(outcomesOf(running, "runs")).toEqual(["running", "failed"]);
  });

  it("treats an error_summary of whitespace as no error at all", async () => {
    // A producer that wrote a blank string reported nothing, and the row reads
    // the same as one that wrote null — absence is `isAbsent`, defined once
    // (admin-window/BUG-0004).
    const markup = await renderDashboard(
      healthyScript({
        [T.runs]: {
          data: [
            runRow({
              run_id: RUN_OLDEST,
              ended_at: "2026-09-01T03:02:11Z",
              outcome: "failed",
              error_summary: "   ",
            }),
          ],
        },
      }),
    );

    expect(errorLinesOf(markup, "runs")).toEqual([]);
    expect(absencesOf(markup, "runs", "error")).toEqual([true]);
    expect(blankCells(markup)).toBe(0);
  });
});

/* ── the two states a null outcome can be in ─────────────────────────────── */

describe("a cycle with no end recorded", () => {
  /*
   * The Dashboard classifies a cycle by `ended_at` ALONE
   * (`src/app/page.tsx`), so every null-outcome, null-`ended_at` row reads as
   * running however old it is. `/cycles` reads the same row through
   * `cycleState` (`src/lib/cycles/state.ts`) and calls one older than a cadence
   * `died` — migration 20260901000001's own requirement, "a null older than
   * one cadence is how a crash stays visible".
   *
   * `data-outcome` is the STATE hook both surfaces expose for a test, not the
   * word on screen: this asserts the classification, and a rename of either
   * page's copy never touches it.
   *
   * Two fixtures on purpose: one the surface must flag (a month old) and one
   * it must not (a minute old). Both are built off the wall clock, because
   * this page reads its own — a fixture with a literal date decides nothing.
   */
  const CADENCE = RESOLVER_CADENCE_SECONDS;

  function noEndCycles(now: number): ResolutionRunRow[] {
    return [
      resolutionRunRow({
        run_id: CYCLE_NEWEST,
        started_at: new Date(now - 60_000).toISOString(),
        ended_at: null,
        outcome: null,
        errors: 0,
        error_summary: null,
      }),
      resolutionRunRow({
        run_id: CYCLE_OLDEST,
        started_at: new Date(now - 30 * 24 * 3_600_000).toISOString(),
        ended_at: null,
        outcome: null,
        errors: 0,
        error_summary: null,
      }),
    ];
  }

  it("reads a cycle younger than one cadence as running", async () => {
    const now = Date.now();
    const [fresh] = noEndCycles(now);
    expect(cycleState(fresh, { now: new Date(now), cadenceSeconds: CADENCE }).kind).toBe(
      "running",
    );
    const markup = await renderDashboard(
      healthyScript({ [T.resolutionRuns]: { data: noEndCycles(now) } }),
    );
    expect(outcomesOf(markup, "cycles")[0]).toBe("running");
  });

  /*
   * admin-window/BUG-0074, filed as an `it.fails` xfail and closed here: the
   * Dashboard classified a cycle by `ended_at` ALONE, so it had no `died`
   * state at all and this assertion was the divergence itself. It now reads
   * the row through the same `cycleState` /cycles reads it through.
   */
  it("does not read a cycle older than one cadence as running", async () => {
    const now = Date.now();
    const dead = noEndCycles(now)[1];
    // What the OTHER surface makes of the same row, from the one function that
    // decides it.
    expect(cycleState(dead, { now: new Date(now), cadenceSeconds: CADENCE }).kind).toBe(
      "died",
    );
    const markup = await renderDashboard(
      healthyScript({ [T.resolutionRuns]: { data: noEndCycles(now) } }),
    );
    expect(outcomesOf(markup, "cycles")[1]).toBe("died");
  });
});

/* ── one word per cycle, on every surface ────────────────────────────────── */

/**
 * The property admin-window/BUG-0074 exists to hold: **the word the Dashboard
 * gives a cycle is the word /cycles gives the same row.**
 *
 * Not "the Dashboard says died for this fixture" — that would pass while the
 * two pages agreed about nothing else, and it would pin a word the designer
 * owns. This renders ONE population on BOTH pages and compares them row by
 * row, matched by `run_id`, so the surfaces are each other's oracle: a word
 * changed on one page, a state added to `CycleState`, or a second copy of
 * either the state function or the word map reddens this.
 *
 * The population is `tests/offline/cycles/population.ts` — the same six rows
 * /cycles is rendered against, covering all four states (each of the three
 * outcomes, running, died, and ended-with-no-outcome). It is borrowed rather
 * than re-hand-rolled for the reason that file gives: a second population here
 * would drift from the one the other surface is tested on.
 *
 * The two pages order their rows differently — /cycles sorts newest first, the
 * Dashboard renders the window the read handed it — so the comparison is by id
 * and never by position.
 */
describe("one word per cycle, on every surface", () => {
  /**
   * The text of the outcome cell of each cycle row, keyed by `run_id`.
   *
   * The column is found by its header and the row by the id the surface
   * itself exposes, so this reads what an operator is shown without knowing
   * where either page puts its columns.
   */
  function wordsByCycle(
    markup: string,
    table: cheerio.Cheerio<never>,
    idOf: (row: cheerio.Cheerio<never>) => string | undefined,
  ): Record<string, string> {
    const $ = cheerio.load(markup);
    const at = table
      .find("thead th")
      .toArray()
      .map((th) => $(th).text().trim())
      .indexOf("outcome");
    if (at < 0) throw new Error("that cycle table has no outcome column");
    const words: Record<string, string> = {};
    table.find("tbody tr").each((_, tr) => {
      const row = $(tr) as unknown as cheerio.Cheerio<never>;
      const id = idOf(row);
      if (id === undefined) throw new Error("a cycle row carries no cycle id");
      words[id] = $(tr).find("td").eq(at).text().replace(/\s+/g, " ").trim();
    });
    return words;
  }

  /** The Dashboard names the row in the link its started cell carries. */
  function dashboardWords(markup: string): Record<string, string> {
    const $ = cheerio.load(markup);
    const table = $('table[aria-label="cycles"]') as unknown as cheerio.Cheerio<never>;
    return wordsByCycle(markup, table, (row) => {
      const href = row.find('a[href*="cycle="]').first().attr("href");
      if (href === undefined) return undefined;
      return new URL(href, "http://dashboard.test").searchParams.get("cycle") ?? undefined;
    });
  }

  /**
   * /cycles names the row on its `data-cycle` hook — which is also how its
   * table is found here, so this comparison needs no copy of that page's
   * accessible name.
   */
  function cyclesPageWords(markup: string): Record<string, string> {
    const $ = cheerio.load(markup);
    const table = $("[data-cycle]")
      .first()
      .closest("table") as unknown as cheerio.Cheerio<never>;
    return wordsByCycle(markup, table, (row) =>
      row.find("[data-cycle]").first().attr("data-cycle"),
    );
  }

  async function renderCyclesPage(
    population: readonly CycleRow[] = CYCLE_POPULATION,
  ): Promise<string> {
    readWith.client = stubClient({
      // The cycle table's window read, then the cycle-health gauge's own.
      [T.resolutionRuns]: [{ data: [...population] }, { data: [...population] }],
      [T.fieldProvenance]: { data: [...CYCLE_APPLIES] },
      [T.observations]: { data: [...CYCLE_OBSERVED] },
      [T.runs]: { data: [] },
    }).asSupabaseClient();
    return render(await CyclesPage({ searchParams: Promise.resolve({}) }));
  }

  it("gives every cycle the same word the Cycles & runs page gives it", async () => {
    const dashboard = dashboardWords(
      await renderDashboard(
        healthyScript({ [T.resolutionRuns]: { data: [...CYCLE_POPULATION] } }),
      ),
    );
    const cyclesPage = cyclesPageWords(await renderCyclesPage());

    // Neither map may be empty or short, or the comparison below would hold
    // over nothing: both surfaces rendered every row of the population.
    const ids = CYCLE_POPULATION.map((row) => row.run_id).sort();
    expect(Object.keys(dashboard).sort()).toEqual(ids);
    expect(Object.keys(cyclesPage).sort()).toEqual(ids);

    expect(dashboard).toEqual(cyclesPage);
  });

  /**
   * The population the shared fixture cannot express, and the one the ticket
   * was filed about: **the resolver crashed, so the dead cycle is the NEWEST
   * row**, and the Dashboard's window is a strict subset of what /cycles
   * shows.
   *
   * `tests/offline/cycles/population.ts` is borrowed everywhere else here, but
   * it cannot be borrowed for this: its newest rows are minutes old, and a
   * cycle cannot be both newer than those and older than a cadence. So this
   * builds the crash — nothing has started since the resolver died 20 minutes
   * ago — and hands the Dashboard only the six rows the database's `.limit()`
   * would return while /cycles reads the whole window behind them.
   */
  const CYCLE_OUTCOMES: ResolutionOutcome[] = ["succeeded", "failed", "skipped"];
  const CRASHED_AT = minutesAgo(20);
  const CRASH_POPULATION: ResolutionRunRow[] = [
    // The cycle that died, newest of all: at the TOP of the Dashboard's six.
    resolutionRunRow({
      run_id: "01920000-0000-7000-8000-000000000dea",
      started_at: CRASHED_AT,
      ended_at: null,
      outcome: null,
    }),
    // Seven completed cycles behind it — one more than the Dashboard's window,
    // so the window truncating is a fact this test can assert rather than hope.
    ...[35, 50, 65, 80, 95, 110, 125].map((minutes, index) =>
      resolutionRunRow({
        run_id: `01920000-0000-7000-8000-000000000d0${index}`,
        started_at: minutesAgo(minutes),
        ended_at: secondsAfter(minutesAgo(minutes), 40),
        // An ended row with no outcome recorded is the fourth state; the rest
        // carry the producer's own words.
        outcome: index === 0 ? null : CYCLE_OUTCOMES[index % CYCLE_OUTCOMES.length],
      }),
    ),
  ];

  it("agrees about a dead cycle at the top of a window that truncates", async () => {
    const inWindow = CRASH_POPULATION.slice(0, DASHBOARD_WINDOW);
    const dashboard = dashboardWords(
      await renderDashboard(healthyScript({ [T.resolutionRuns]: { data: inWindow } })),
    );
    const cyclesPage = cyclesPageWords(await renderCyclesPage(CRASH_POPULATION));

    // The two surfaces really are showing different sets — a comparison over
    // one identical list would prove nothing about a window at all.
    expect(Object.keys(dashboard).sort()).toEqual(inWindow.map((row) => row.run_id).sort());
    expect(Object.keys(cyclesPage).length).toBeGreaterThan(Object.keys(dashboard).length);

    const dead = CRASH_POPULATION[0].run_id;
    expect(Object.keys(dashboard)).toContain(dead);

    // Every row the Dashboard shows reads there exactly as it reads on the
    // page the operator clicks through to.
    for (const [runId, word] of Object.entries(dashboard)) {
      expect([runId, word]).toEqual([runId, cyclesPage[runId]]);
    }

    // …and not because one word is given to everything: the dead row's word is
    // its own, on both surfaces.
    for (const [surface, words] of [
      ["dashboard", dashboard],
      ["cycles", cyclesPage],
    ] as const) {
      expect(words[dead], surface).not.toBe("");
      for (const other of CRASH_POPULATION.slice(1, DASHBOARD_WINDOW)) {
        expect(words[other.run_id], `${surface}/${other.run_id}`).not.toBe(words[dead]);
      }
    }
  });

  it("tells the two no-outcome states apart on both surfaces", async () => {
    // The comparison above would also hold if every state rendered one word.
    // These two rows differ ONLY in how long ago they started, so a surface
    // that ignores age gives them the same word — which is the defect
    // admin-window/BUG-0074 was.
    const dashboard = dashboardWords(
      await renderDashboard(
        healthyScript({ [T.resolutionRuns]: { data: [...CYCLE_POPULATION] } }),
      ),
    );
    const cyclesPage = cyclesPageWords(await renderCyclesPage());

    for (const [surface, words] of [
      ["dashboard", dashboard],
      ["cycles", cyclesPage],
    ] as const) {
      expect(words[RUNNING_CYCLE.run_id], surface).not.toBe(words[DIED_CYCLE.run_id]);
      expect(words[RUNNING_CYCLE.run_id], surface).not.toBe("");
      expect(words[DIED_CYCLE.run_id], surface).not.toBe("");
    }
  });
});

/* ── one word for an unfinished run, across the two producers ────────────── */

/**
 * The other half of admin-window/BUG-0074's rule, which the ticket scoped OUT
 * of the fix and which is therefore worth pinning rather than assuming.
 *
 * The adapter framework's `runs` are a **different producer** from the
 * resolver's `resolution_runs`, and nothing in this repo or in
 * `contracts/resolver.md` gives them a cadence — the 15 minutes is the
 * resolver's alone (`RESOLVER_CADENCE_SECONDS`, `lib/gauges/gauge.ts`). So a
 * run with no `ended_at` is read as unfinished at any age, deliberately, and
 * the ticket left that reading where it was.
 *
 * What the Voice glossary still binds is the WORD: "one name per concept,
 * everywhere". These assert that the two surfaces which render an unfinished
 * run give it the same word, and that the Dashboard's two tables do too —
 * which is what stops the reading being *scoped out* from quietly becoming a
 * second vocabulary. They assert nothing about WHICH word, and nothing about
 * age: a later decision to age adapter runs out stays free, as long as both
 * surfaces move together.
 */
describe("one word for an unfinished run, on every surface", () => {
  const RUN_IN_FLIGHT = "01920000-0000-7000-8000-0000000007b1";
  const RUN_ANCIENT = "01920000-0000-7000-8000-0000000007b2";
  const RUN_FINISHED = "01920000-0000-7000-8000-0000000007b3";

  /** Newest first, as the read orders them: two unfinished, one ended. */
  function unfinishedRuns(): RunRow[] {
    const finishedAt = minutesAgo(30);
    return [
      runRow({
        run_id: RUN_IN_FLIGHT,
        source: "ticketmaster",
        started_at: minutesAgo(3),
        ended_at: null,
        outcome: null,
        error_summary: null,
      }),
      runRow({
        run_id: RUN_FINISHED,
        source: "bandsintown",
        started_at: finishedAt,
        ended_at: secondsAfter(finishedAt, 90),
        outcome: "failed",
        error_summary: RUN_ERROR,
      }),
      // A run whose end was never recorded at all: 400 days of no `ended_at`.
      // It is here to prove the two surfaces read it the SAME way, not that
      // either reads it a particular way.
      runRow({
        run_id: RUN_ANCIENT,
        source: "eventbrite",
        started_at: minutesAgo(400 * 24 * 60),
        ended_at: null,
        outcome: null,
        error_summary: null,
      }),
    ];
  }

  /** /cycles, rendered against the same runs and no cycles at all. */
  async function renderCyclesRuns(runsRows: RunRow[]): Promise<string> {
    readWith.client = stubClient({
      [T.resolutionRuns]: [{ data: [] }, { data: [] }],
      [T.fieldProvenance]: { data: [] },
      [T.observations]: { data: [] },
      [T.runs]: [{ data: [...runsRows] }, { data: [...runsRows] }],
    }).asSupabaseClient();
    return render(await CyclesPage({ searchParams: Promise.resolve({}) }));
  }

  it("gives an unfinished adapter run the word the Cycles & runs page gives it", async () => {
    const runsRows = unfinishedRuns();
    const dashboard = rowsOf(await renderDashboard(healthyScript({ [T.runs]: { data: runsRows } })), "runs");

    // /cycles marks the state on the row itself (`data-run-inflight`), so this
    // reads the word that surface shows without knowing which column it puts
    // it in — the two pages lay the runs out differently and always have.
    const $ = cheerio.load(await renderCyclesRuns(runsRows));
    const onCycles = $("[data-run-inflight]")
      .toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim());

    // Both surfaces rendered the unfinished runs at all, or the comparison
    // below would hold over nothing.
    expect(dashboard).toHaveLength(runsRows.length);
    expect(onCycles.length).toBeGreaterThan(0);

    const unfinished = new Set([RUN_IN_FLIGHT, RUN_ANCIENT]);
    const dashboardWords = new Set(
      dashboard
        .filter((_, index) => unfinished.has(runsRows[index].run_id))
        .map((row) => row.outcome),
    );
    // One word for the state, whatever the row's age — on each surface, and
    // the same one across them.
    expect(dashboardWords.size).toBe(1);
    expect(new Set(onCycles).size).toBe(1);
    expect([...dashboardWords]).toEqual([...new Set(onCycles)]);

    // Not vacuous: the run that ENDED is not given the unfinished word.
    const ended = dashboard[runsRows.findIndex((row) => row.run_id === RUN_FINISHED)];
    expect(ended.outcome).not.toBe([...dashboardWords][0]);
  });

  it("gives an unfinished run and an unfinished cycle one word, and a dead cycle another", async () => {
    // The Dashboard's two tables are two producers on one screen. The state
    // they share — nothing has recorded an end yet — is one concept and takes
    // one word; the state only the resolver has (it died) takes another.
    const running = resolutionRunRow({
      run_id: CYCLE_NEWEST,
      started_at: minutesAgo(1),
      ended_at: null,
      outcome: null,
    });
    const dead = resolutionRunRow({
      run_id: CYCLE_OLDEST,
      started_at: minutesAgo(45),
      ended_at: null,
      outcome: null,
    });
    const markup = await renderDashboard(
      healthyScript({
        [T.resolutionRuns]: { data: [running, dead] },
        [T.runs]: { data: unfinishedRuns() },
      }),
    );
    const cycles = rowsOf(markup, "cycles");
    const runs = rowsOf(markup, "runs");

    expect(cycles).toHaveLength(2);
    expect(runs.length).toBeGreaterThan(0);
    expect(cycles[0].outcome).not.toBe("");
    expect(runs[0].outcome).toBe(cycles[0].outcome);
    expect(cycles[1].outcome).not.toBe(cycles[0].outcome);
  });
});

/* ── the addressing the live oracle depends on ───────────────────────────── */

/**
 * The name each surface answers to (`data-surface`, `src/app/page.tsx`), as
 * `tests/live/dashboard.live.test.ts` addresses them.
 */
const SURFACE_HOOKS = {
  attention: '[data-surface="attention"]',
  cycles: '[data-surface="cycles"]',
  runs: '[data-surface="runs"]',
} as const;

const HOOKS = Object.values(SURFACE_HOOKS);

describe("the surface hooks the live parity oracle addresses", () => {
  /**
   * The live oracle grades ONE surface at a time and `stateOf`
   * (`tests/live/parity.ts`) refuses any selector matching other than exactly
   * one element. Until admin-window/DEBT-0002 it addressed these three
   * POSITIONALLY — `section:nth-of-type(n)` — so one added section, or one
   * `<div>` wrapped around an existing one, either duplicates a match or
   * silently repoints the selector at the neighbouring surface. On `/cycles`
   * that is not hypothetical: admin-window/BUG-0040's lead section and its
   * wrapper made `:nth-of-type(1)` match two surfaces and four live tests
   * threw (admin-window/BUG-0056).
   *
   * Nothing offline could see any of that — `npm test` runs the offline and
   * isolated projects only — so the live oracle's addressing had no pin in CI.
   * These cases are that pin, in the file that owns this page's markup: a
   * reorder reddens the suite that runs on every ticket, not only the one that
   * needs staging.
   */
  it("gives each surface exactly one element, in every state", async () => {
    const populated = await renderDashboard(healthyScript());
    const empty = await renderDashboard(
      healthyScript({
        [T.reviewItems]: { data: [], count: 0 },
        [T.resolutionRuns]: { data: [] },
        [T.runs]: { data: [] },
      }),
    );
    // The states that swap a surface's table for a card are exactly where a
    // wrapper is most likely to appear or vanish.
    const absent = await renderDashboard({
      [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
      [T.runs]: { error: tableNotInSchemaCache(T.runs) },
    });
    const refused = await renderDashboard({
      [T.reviewItems]: { error: permissionDenied(T.reviewItems) },
      [T.resolutionRuns]: { error: permissionDenied(T.resolutionRuns) },
      [T.runs]: { error: permissionDenied(T.runs) },
    });
    // One read failing while its neighbours succeed: a partial failure swaps
    // exactly one surface's table for a card while the rest keeps its shape,
    // which no whole-page script can reach.
    const partial = await renderDashboard(
      healthyScript({
        [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
      }),
    );

    const states: [string, string][] = [
      ["populated", populated],
      ["empty", empty],
      ["absent", absent],
      ["refused", refused],
      ["one read absent", partial],
    ];
    for (const [name, markup] of states) {
      // `nested` empty is the second half: a hook can be unique and still
      // swallow its neighbour's state cards.
      expect(surfaceHooks(markup, HOOKS), name).toEqual({
        counts: oneEach(HOOKS),
        nested: [],
      });
    }
  });

  it("keeps each surface's own rows inside its own hook", async () => {
    // A hook that is unique but points at the wrong surface is the same bug
    // wearing a different hat, so each name is checked against what that
    // surface actually reads.
    const $ = cheerio.load(await renderDashboard(healthyScript()));

    // One queue link per kind — decisions and signals, of equal standing.
    expect($(SURFACE_HOOKS.attention).find('a[href^="/queues?"]').length).toBe(2);
    expect($(SURFACE_HOOKS.cycles).find('table[aria-label="cycles"]').length).toBe(1);
    expect($(SURFACE_HOOKS.runs).find('table[aria-label="runs"]').length).toBe(1);

    // The two tables never bleed into each other's surface.
    expect($(SURFACE_HOOKS.cycles).find('table[aria-label="runs"]').length).toBe(0);
    expect($(SURFACE_HOOKS.runs).find('table[aria-label="cycles"]').length).toBe(0);
    expect($(SURFACE_HOOKS.attention).find("table").length).toBe(0);
  });
});
