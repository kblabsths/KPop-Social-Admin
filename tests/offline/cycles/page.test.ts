import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { CYCLE_COUNTERS, CYCLE_WINDOW } from "@/lib/db/cycles";
import { T } from "@/lib/db/tables";
import { CLAMP_LIMIT, ELLIPSIS, EM_DASH } from "@/lib/format";
import { readNumber } from "../../live/parity";
import {
  implicitInterElementSpaces,
  implicitInterElementSpacesIn,
} from "../source-tree";
import { factoryTicketIds, render, runTogetherWords } from "../ui/markup";
import {
  APPLIES,
  APPLY_COUNT,
  CYCLES,
  DIED,
  FAILED,
  NEWEST_FIRST,
  OBSERVED,
  RUNNING,
  SKIPPED,
  SUCCEEDED,
  UNMATCHED_COUNT,
  UNRECORDED,
  UNSET_COUNT,
} from "./population";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type Script,
} from "../../fixtures/stub-client";
/**
 * The other half's fixtures, borrowed rather than re-hand-rolled: the property
 * this file pins about them is a property of THIS PAGE's order (the lead that
 * puts the newest run above the fold, admin-window/BUG-0040), and a second
 * population of runs written here could drift from the one
 * `tests/offline/runs/` renders the same page against.
 */
import {
  FAILED as RUN_FAILED,
  NEWEST_FIRST as RUNS_NEWEST_FIRST,
  NO_SUCH_SOURCE,
  RUNS,
} from "../runs/population";

/**
 * The Cycles & runs page, rendered (campaign admin-window/TASK-0014).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await CyclesPage(props))` — no jsdom, no Testing
 * Library, no database. Every read is stubbed at its module boundary, so all
 * four states are reachable offline.
 *
 * **Every expectation is computed here, from the fixture population**
 * (`./population.ts`), never asked of the module the page called. The two
 * latency counts are the point of that rule: the fixtures hold five
 * `field_provenance` decisions of which three are applies, and this file
 * asserts the page renders 3 — the number a row array would have made 5
 * (admin-window/BUG-0012).
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which cycles render, in which
 * order, which state each row is in, where a link goes, which object an absent
 * read names — plus the machine's own strings where rendering them VERBATIM is
 * the requirement (the run id, the outcome, the `error_summary`, the missing
 * table). No class name and no copy of the app's own words is pinned.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/cycles", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/cycles")>();
  return {
    ...actual,
    readCycles: (limit?: number) =>
      actual.readCycles(limit, readWith.client as never),
  };
});

/**
 * The page's other half reads its own table through its own module
 * (`src/lib/db/runs.ts`, admin-window/TASK-0016). It is routed through the
 * same stub so this file stays offline-pure; what that half RENDERS is
 * asserted in `tests/offline/runs/`, not here.
 */
vi.mock("@/lib/db/runs", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/runs")>();
  return {
    ...actual,
    readRuns: (filter?: unknown) =>
      actual.readRuns((filter ?? {}) as never, readWith.client as never),
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

const cyclesModule = await import("@/app/cycles/page");
const CyclesPage = cyclesModule.default;

/**
 * A database holding the whole population.
 *
 * The reads happen in a fixed order, which is what the queued responses
 * follow: the cycle table's window read of `resolution_runs`, then the
 * cycle-health gauge's own window read of the same table, then the latency
 * gauge's two legs (`field_provenance`, then `observations`).
 */
function healthyScript(overrides: Script = {}): Script {
  return {
    [T.resolutionRuns]: [{ data: [...CYCLES] }, { data: [...CYCLES] }],
    [T.fieldProvenance]: { data: [...APPLIES] },
    [T.observations]: { data: [...OBSERVED] },
    // The other half's table. This file asserts only that it is read and that
    // it does not disturb the cycles; `tests/offline/runs/` renders its rows.
    [T.runs]: { data: [] },
    ...overrides,
  };
}

async function renderCycles(
  script: Script,
  params: Record<string, string | string[]> = {},
): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await CyclesPage({ searchParams: Promise.resolve(params) }));
}

/* ── reading the markup, structurally ────────────────────────────────────── */

/** The run ids the cycle table rendered, in rendered order. */
function renderedCycles(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-cycle]")
    .toArray()
    .map((element) => $(element).attr("data-cycle") ?? "");
}

/** One cycle row: its hooks, its counter cells and its whole text. */
function cycleRow(markup: string, runId: string) {
  const $ = cheerio.load(markup);
  const marker = $(`[data-cycle="${runId}"]`);
  const row = marker.closest("tr");
  const counts: Record<string, string> = {};
  row.find("[data-cycle-count]").each((_, element) => {
    counts[$(element).attr("data-cycle-count") ?? ""] = $(element).text().trim();
  });
  return {
    state: marker.attr("data-cycle-state"),
    outcome: marker.attr("data-cycle-outcome"),
    current: marker.attr("aria-current"),
    marked: row.attr("data-row-marked"),
    /** The row's own rendering, compared only against the OTHER rows' — never
     *  against a literal, so restyling the mark does not redden this file. */
    rendering: row.attr("class"),
    anchor: marker.attr("id"),
    startedAt: row.find("[data-cycle-started]").attr("data-cycle-started"),
    duration: row.find("[data-cycle-duration]").text().trim(),
    error: row.find("[data-cycle-error]").text().trim(),
    counts,
    cells: row
      .find("td")
      .toArray()
      .map((cell) => $(cell).text().replace(/\s+/g, " ").trim()),
    text: row.text().replace(/\s+/g, " ").trim(),
  };
}

/** A table's column headers, in order. */
function headers(markup: string, label: string): string[] {
  const $ = cheerio.load(markup);
  return $(`table[aria-label="${label}"] th`)
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim());
}

/**
 * The header sitting above one counter's own cells, found through the cell's
 * machine hook — so this reads the table's real column ORDER rather than a
 * second copy of it kept in the test.
 */
function headerAbove(markup: string, table: string, counter: string): string {
  const $ = cheerio.load(markup);
  const cell = $(`table[aria-label="${table}"] [data-cycle-count="${counter}"]`)
    .first()
    .closest("td");
  const siblings = cell.parent().children("td").toArray();
  const index = siblings.findIndex((element) => element === cell[0]);
  return index === -1 ? "" : (headers(markup, table)[index] ?? "");
}

/**
 * Every label the page puts above a FIGURE, read structurally — a leaf span
 * whose next sibling is the figure itself (`ui/StatCard`'s anatomy: `micro`
 * label, then the number, optionally prefixed "at least" when the window was
 * truncated).
 *
 * Structural and not by class name on purpose: this exists so a table header
 * and a gauge label can be compared as two INDEPENDENTLY read strings
 * (admin-window/BUG-0044 — the table said `FACTS_EXAMINED` while the gauge a
 * few thousand pixels below said `FACTS EXAMINED`).
 */
function figureLabels(markup: string): string[] {
  const $ = cheerio.load(markup);
  const found: string[] = [];
  $("span").each((_, element) => {
    const node = $(element);
    if (node.children().length > 0) return;
    const text = node.text().replace(/\s+/g, " ").trim();
    if (text === "") return;
    const beside = node.next().text().replace(/\s+/g, " ").trim();
    if (/^(at least)?\s*\d[\d,]*$/.test(beside)) found.push(text);
  });
  return found;
}

/**
 * What is wrong with a header of the CYCLES table, or `null` when nothing is.
 *
 * A predicate rather than an inline regex so the test can prove it
 * DISCRIMINATES: it is handed a spelling it must flag as well as the headers
 * it must clear (LESSONS 3). Both faults are admin-window/BUG-0044's: a raw
 * database column name uppercased into a sans `micro` eyebrow, and the
 * cycle's own identifier headed with the adapter's noun (LOOK_AND_FEEL's
 * glossary pins `cycle` (resolver) and `run` (adapter) as two nouns of two
 * producers, and this page shows both tables).
 */
function headerFault(header: string): string | null {
  if (/_/.test(header)) return "raw column name";
  if (/\brun\b/i.test(header)) return "calls a cycle a run";
  return null;
}

/** The objects a not-provisioned card names. */
function notProvisioned(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-not-provisioned]")
    .toArray()
    .map((element) => $(element).attr("data-not-provisioned") ?? "");
}

/** The reads that failed, as the error lines name them. */
function readsFailed(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-read-failed]")
    .toArray()
    .map((element) => $(element).attr("data-read-failed") ?? "");
}

/** A gauge's window line, as the page states it. */
function windowOf(markup: string, gauge: string) {
  const line = cheerio.load(markup)(`[data-window="${gauge}"]`);
  return {
    present: line.length > 0,
    since: line.attr("data-window-since"),
    truncated: line.attr("data-window-truncated") === "true",
  };
}

/** Every section heading the page rendered, in order. */
function sections(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("h2")
    .toArray()
    .map((element) => $(element).text().trim());
}

/**
 * The lead the page opens with: which run it repeats, in which state, and the
 * cells it put on screen (admin-window/BUG-0040).
 *
 * The lead's copy of a run answers to `data-latest-run` and never to
 * `data-run`, so `tests/offline/runs/` and `tests/live/runs.live.test.ts` — the
 * files that own the runs WINDOW — keep seeing exactly the window's own rows.
 */
function leadRun(markup: string) {
  const $ = cheerio.load(markup);
  const marker = $("[data-latest-run]");
  const row = marker.closest("tr");
  return {
    markers: marker.length,
    state: $("[data-latest-run-state]").attr("data-latest-run-state"),
    runId: marker.attr("data-latest-run"),
    source: marker.attr("data-latest-run-source"),
    startedAt: row.find("[data-run-started]").attr("data-run-started"),
    outcome: row.find("[data-run-outcome]").attr("data-run-outcome"),
    inFlight: row.find("[data-run-inflight]").length > 0,
    error: row.find("[data-run-error]").text().trim(),
    /** The whole of an error the lead had to clamp (admin-window/DEBT-0005). */
    errorTitle: row.find("[data-run-error]").attr("title"),
    cells: row
      .find("td")
      .toArray()
      .map((cell) => $(cell).text().replace(/\s+/g, " ").trim()),
    /** Where the lead points for the rest of the window. */
    href: $("[data-latest-run-state]")
      .closest("section")
      .find("a")
      .first()
      .attr("href"),
  };
}

/**
 * One WINDOW row's error, verbatim.
 *
 * The lead's bound is the lead's (admin-window/DEBT-0005): a row inside a
 * 200-row window pushes nothing under the fold, so its cell still carries the
 * producer's whole string — which is one of the two ways LOOK_AND_FEEL keeps
 * a clamped value reachable.
 */
function windowRunError(markup: string, runId: string): string {
  const $ = cheerio.load(markup);
  return $(`[data-run="${runId}"]`)
    .closest("tr")
    .find("[data-run-error]")
    .text()
    .trim();
}

/** One window row's cells, as their texts — for comparing the lead against it. */
function windowRunCells(markup: string, runId: string): string[] {
  const $ = cheerio.load(markup);
  return $(`[data-run="${runId}"]`)
    .closest("tr")
    .find("td")
    .toArray()
    .map((cell) => $(cell).text().replace(/\s+/g, " ").trim());
}

/**
 * Every row marker on the page, in document order: `run` for anything the lead
 * rendered, `cycle` for a row of the cycles window.
 *
 * This is the fold property in structural form. The bug was ORDER: the runs
 * half sat below a window of up to 200 cycle rows, 4,419px down at 1440×900,
 * so the newest run could not be read without scrolling. A later reorder that
 * pushes runs back under the cycles window puts a `cycle` in front of a `run`
 * here, and this file goes red.
 */
function rowOrder(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-latest-run], [data-latest-run-state], [data-cycle]")
    .toArray()
    .map((element) =>
      $(element).attr("data-cycle") === undefined ? "run" : "cycle",
    );
}

/** A cycles window filled to its cap, so the fold pin faces the real page. */
function fullCycleWindow() {
  return Array.from({ length: CYCLE_WINDOW }, (_, index) => ({
    ...SUCCEEDED,
    run_id: `capped-${String(index).padStart(4, "0")}`,
    started_at: new Date(
      Date.parse(SUCCEEDED.started_at) - index * 60_000,
    ).toISOString(),
  }));
}

/** One distribution or trend table's rows, as their cell texts. */
function tableRows(markup: string, label: string): string[][] {
  const $ = cheerio.load(markup);
  return $(`table[aria-label="${label}"] tbody tr`)
    .toArray()
    .map((element) =>
      $(element)
        .find("td")
        .toArray()
        .map((cell) => $(cell).text().replace(/\s+/g, " ").trim()),
    );
}

/** Every row rendering the named table emitted, in order. */
function rowRenderings(markup: string, label: string): (string | undefined)[] {
  const $ = cheerio.load(markup);
  return $(`table[aria-label="${label}"] tbody tr`)
    .toArray()
    .map((element) => $(element).attr("class"));
}

/**
 * The classes an element carries **at rest** — every variant-prefixed class
 * (`hover:`, `focus:`) dropped, sorted, as one string.
 *
 * A link whose only difference from plain text is a `hover:` class is
 * identical to plain text until the pointer arrives, which is the whole of
 * admin-window/BUG-0054's second half. Comparing rest spellings to each other
 * says that without pinning any spelling.
 */
function restSpelling(className: string | undefined): string {
  return (className ?? "")
    .split(/\s+/)
    .filter((name) => name !== "" && !name.includes(":"))
    .sort()
    .join(" ");
}

/** The rest spelling of every in-page anchor the markup emitted. */
function anchorRestSpellings(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $('a[href^="#"]')
    .toArray()
    .map((element) => restSpelling($(element).attr("class")));
}

/** The rest spelling of every mono value the page prints as plain text. */
function plainValueRestSpellings(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("span.type-data")
    .toArray()
    .filter((element) => $(element).parents("a").length === 0)
    .map((element) => restSpelling($(element).attr("class")));
}

const CYCLES_TABLE = "Cycles";
const OUTCOMES = "Cycle outcomes";
const DURATIONS = "Cycle duration";
const WAITS = "Wait from claim to apply";
const BY_DOMAIN = "Wait by domain";

/* ── the cycle table ─────────────────────────────────────────────────────── */

describe("the cycles the resolver filed", () => {
  it("renders every cycle, newest first by started_at", async () => {
    const markup = await renderCycles(healthyScript());
    expect(renderedCycles(markup)).toEqual(NEWEST_FIRST.map((row) => row.run_id));
  });

  it("renders all eight counts, thousand-separated, as their own columns", async () => {
    const markup = await renderCycles(healthyScript());

    // Each of the contract's eight counters has a column of its own, found by
    // the cell's machine hook and not by what the header calls it — the words
    // above them are asserted separately, below.
    for (const counter of CYCLE_COUNTERS) {
      expect(headerAbove(markup, CYCLES_TABLE, counter), counter).not.toBe("");
    }

    const row = cycleRow(markup, SUCCEEDED.run_id);
    expect(Object.keys(row.counts).sort()).toEqual([...CYCLE_COUNTERS].sort());
    // A four- and five-figure count reads as a figure, not as a raw integer
    // (LOOK_AND_FEEL: thousand-separated).
    expect(row.counts.facts_examined).toBe("12,345");
    expect(row.counts.claims_rerejected).toBe("2,610");
    expect(row.counts.applied).toBe("1,204");
    // A zero is a real count and renders as one, never as the absence dash.
    expect(row.counts.errors).toBe("0");
  });

  it("heads every column in one vocabulary, and never calls a cycle a run", async () => {
    const markup = await renderCycles(healthyScript());
    const set = headers(markup, CYCLES_TABLE);

    // Non-vacuous: one header per cell the table actually rendered, and more
    // headers than there are counters — so the loop below faces the whole row.
    expect(set.length).toBe(cycleRow(markup, SUCCEEDED.run_id).cells.length);
    expect(set.length).toBeGreaterThan(CYCLE_COUNTERS.length);

    // The predicate discriminates: the two spellings this table used to render
    // are exactly the two it flags.
    expect(headerFault("facts_examined")).toBe("raw column name");
    expect(headerFault("run id")).toBe("calls a cycle a run");

    for (const header of set) {
      expect(headerFault(header), header).toBeNull();
    }

    // The machine names did not go anywhere — they are on the CELLS, which is
    // what every offline and live reader of this table selects by.
    expect(Object.keys(cycleRow(markup, SUCCEEDED.run_id).counts).sort()).toEqual(
      [...CYCLE_COUNTERS].sort(),
    );
  });

  it("heads the facts column with the words the gauge puts above the same figure", async () => {
    const markup = await renderCycles(healthyScript());
    const header = headerAbove(markup, CYCLES_TABLE, "facts_examined");
    expect(header).not.toBe("");
    // The same words on both surfaces. Case belongs to the stylesheet — a
    // `micro` label is uppercased there — so the comparison is of the words.
    expect(figureLabels(markup).map((label) => label.toUpperCase())).toContain(
      header.toUpperCase(),
    );
  });

  it("renders error_summary inline and verbatim", async () => {
    const markup = await renderCycles(healthyScript());
    expect(cycleRow(markup, FAILED.run_id).error).toBe(FAILED.error_summary);
    // A cycle with nothing to report shows the table's dash, not an empty cell.
    const clean = cycleRow(markup, SUCCEEDED.run_id);
    expect(clean.error).toBe("");
    expect(clean.cells[clean.cells.length - 1]).toBe(EM_DASH);
  });

  it("makes a running, a skipped and a completed cycle each legible as itself", async () => {
    const markup = await renderCycles(healthyScript());

    const running = cycleRow(markup, RUNNING.run_id);
    expect(running.state).toBe("running");
    expect(running.outcome).toBeUndefined();

    const skipped = cycleRow(markup, SKIPPED.run_id);
    expect(skipped.state).toBe("outcome");
    expect(skipped.outcome).toBe("skipped");

    const succeeded = cycleRow(markup, SUCCEEDED.run_id);
    expect(succeeded.state).toBe("outcome");
    expect(succeeded.outcome).toBe("succeeded");

    // Five states, five different renderings — no two rows say the same thing
    // about different states, which is what "legible as such" means.
    const rows = [RUNNING, SKIPPED, SUCCEEDED, DIED, UNRECORDED];
    const readings = new Set(
      rows.map((row) => cycleRow(markup, row.run_id).cells[2]),
    );
    expect(readings.size).toBe(rows.length);
  });

  it("shows a cycle that died as dead, not as running forever", async () => {
    const markup = await renderCycles(healthyScript());
    const died = cycleRow(markup, DIED.run_id);
    expect(died.state).toBe("died");
    expect(died.outcome).toBeUndefined();
    // It has no end, so it has no duration — the dash, never a zero.
    expect(died.duration).toBe("");
    expect(cycleRow(markup, RUNNING.run_id).duration).toBe("");
  });

  it("says a cycle that ended with no outcome recorded none", async () => {
    const markup = await renderCycles(healthyScript());
    const row = cycleRow(markup, UNRECORDED.run_id);
    expect(row.state).toBe("unrecorded");
    expect(row.outcome).toBeUndefined();
    // The outcome cell is the table's dash: the producer wrote no word.
    expect(row.cells[2]).toBe(EM_DASH);
    // It ended, so its duration IS measurable.
    expect(row.duration).not.toBe("");
  });

  it("states the window it is showing, and never presents it as a count", async () => {
    const markup = await renderCycles(healthyScript());
    const line = cheerio.load(markup)('[data-window="cycles"]');
    expect(line.attr("data-window-limit")).toBe(String(CYCLE_WINDOW));
    expect(line.attr("data-window-truncated")).toBe("false");
  });

  it("says so when the window filled its cap", async () => {
    // A read that came back with exactly its cap is a floor: older cycles are
    // inside the window and were not returned, so the last row must not read
    // as the oldest cycle there is.
    const capped = Array.from({ length: CYCLE_WINDOW }, (_, index) => ({
      ...SUCCEEDED,
      run_id: `capped-${String(index).padStart(4, "0")}`,
      started_at: new Date(Date.parse(SUCCEEDED.started_at) - index * 60_000).toISOString(),
    }));
    const markup = await renderCycles({
      [T.resolutionRuns]: [{ data: capped }, { data: [...CYCLES] }],
      [T.fieldProvenance]: { data: [...APPLIES] },
      [T.observations]: { data: [...OBSERVED] },
    });
    expect(renderedCycles(markup)).toHaveLength(CYCLE_WINDOW);
    expect(cheerio.load(markup)('[data-window="cycles"]').attr("data-window-truncated")).toBe(
      "true",
    );
  });

  it("marks the cycle a Dashboard link asked for, and says so when it is not here", async () => {
    const marked = await renderCycles(healthyScript(), { cycle: FAILED.run_id });
    const $marked = cheerio.load(marked);
    expect($marked('[data-cycle-found="true"]').attr("data-cycle-asked")).toBe(
      FAILED.run_id,
    );
    expect(cycleRow(marked, FAILED.run_id).current).toBe("true");
    // The row carries the anchor the line links to, so the link reaches it.
    expect($marked('[data-cycle-found="true"] a').attr("href")).toBe(
      `#${cycleRow(marked, FAILED.run_id).anchor}`,
    );
    // Only the asked-for row is marked.
    expect($marked("[data-cycle][aria-current]").length).toBe(1);

    const absent = await renderCycles(healthyScript(), { cycle: "0192ffff-dead" });
    const $absent = cheerio.load(absent);
    expect($absent('[data-cycle-found="false"]').attr("data-cycle-asked")).toBe(
      "0192ffff-dead",
    );
    expect($absent("[data-cycle][aria-current]").length).toBe(0);
    // The DRAWN mark is absent too (admin-window/BUG-0054, QA probe): the page
    // must not paint a row for an id it just said is not in the window.
    expect($absent("[data-row-marked]").length).toBe(0);
    expect($marked("[data-row-marked]").length).toBe(1);
    // The id is named verbatim, so the operator can see which cycle was meant.
    expect(absent).toContain("0192ffff-dead");
  });

  it("draws the mark the sentence claims, on that row and no other [admin-window/BUG-0054]", async () => {
    // The defect: the asked-for row carried `aria-current` and NOTHING a
    // reader could see, so "Cycle <id> is marked in the table below" was a
    // claim the screen did not keep, and the walk scanned 69 uuids by eye.
    const marked = await renderCycles(healthyScript(), { cycle: FAILED.run_id });
    const $ = cheerio.load(marked);

    // One row is marked, and it is the row the sentence names.
    const markedRows = $(`table[aria-label="${CYCLES_TABLE}"] tbody tr[data-row-marked]`);
    expect(markedRows.length).toBe(1);
    expect(cycleRow(marked, FAILED.run_id).marked).toBe("true");
    expect(markedRows.find(`[data-cycle="${FAILED.run_id}"]`).length).toBe(1);

    // ...and it LOOKS different from every other row, without hovering: its
    // rendering is one no other row shares, and the others still share one.
    const renderings = rowRenderings(marked, CYCLES_TABLE);
    expect(renderings.length).toBeGreaterThan(1);
    const mine = cycleRow(marked, FAILED.run_id).rendering;
    expect(renderings.filter((rendering) => rendering === mine)).toHaveLength(1);
    expect(new Set(renderings.filter((rendering) => rendering !== mine)).size).toBe(1);

    // The id the sentence names is drawn differently from every other id in
    // the window too, so the eye lands on the value it was told to look for.
    const ids = $("[data-cycle]").toArray().map((element) => $(element).attr("class"));
    const mineId = $(`[data-cycle="${FAILED.run_id}"]`).attr("class");
    expect(ids.filter((rendering) => rendering === mineId)).toHaveLength(1);

    // The mark is a rendering and nothing else: same rows, same cells, same
    // words as the page with no facet — no height, density or content moved.
    const plain = await renderCycles(healthyScript());
    expect(renderedCycles(marked)).toEqual(renderedCycles(plain));
    expect(cycleRow(marked, FAILED.run_id).cells).toEqual(
      cycleRow(plain, FAILED.run_id).cells,
    );
  });

  it("marks no row, and renders every row alike, with no ?cycle= [admin-window/BUG-0054]", async () => {
    const plain = await renderCycles(healthyScript());
    const $ = cheerio.load(plain);
    expect($("[data-row-marked]").length).toBe(0);
    expect($("[data-cycle][aria-current]").length).toBe(0);
    expect($('[data-cycle-asked]').length).toBe(0);
    const renderings = rowRenderings(plain, CYCLES_TABLE);
    expect(renderings.length).toBe(renderedCycles(plain).length);
    expect(new Set(renderings).size).toBe(1);
  });

  it("renders an in-page link as a link at rest, not only on hover [admin-window/BUG-0054]", async () => {
    // The sentence's id is the one-click route to the row. It used to render
    // as `text-ink` with an accent only on `hover:`, so at rest it was
    // spelled exactly like the mono ids this page prints as plain text and
    // nothing said it could be clicked.
    const markup = await renderCycles(healthyScript(), { cycle: FAILED.run_id });
    const anchors = anchorRestSpellings(markup);
    expect(anchors.length).toBeGreaterThan(1);

    const plainValues = new Set(plainValueRestSpellings(markup));
    expect(plainValues.size).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(plainValues.has(anchor), `a link at rest is spelled "${anchor}", and so is a plain value`).toBe(false);
    }

    // And the page spells link ONE way: every in-page anchor shares its rest
    // spelling once the type step it inherits from its context is set aside.
    const withoutTypeStep = anchors.map((spelling) =>
      spelling
        .split(" ")
        .filter((name) => !name.startsWith("type-"))
        .join(" "),
    );
    expect(new Set(withoutTypeStep).size).toBe(1);
  });

  it("takes the first value when the URL names a facet twice", async () => {
    const markup = await renderCycles(healthyScript(), {
      cycle: [FAILED.run_id, SUCCEEDED.run_id],
    });
    expect(cycleRow(markup, FAILED.run_id).current).toBe("true");
    expect(cycleRow(markup, SUCCEEDED.run_id).current).toBeUndefined();
    // The drawn mark takes the same first value, and lands on one row only —
    // an ambiguous URL must never paint two (admin-window/BUG-0054, QA probe).
    expect(cheerio.load(markup)("[data-row-marked]").length).toBe(1);
    expect(cycleRow(markup, FAILED.run_id).marked).toBe("true");
    expect(cycleRow(markup, SUCCEEDED.run_id).marked).toBeUndefined();
  });

  it("marks nothing for a ?cycle= carrying no id at all [admin-window/BUG-0054]", async () => {
    // Half a hand-typed URL. It is a facet the page HAS been handed, so the
    // predicate exists and runs against all 69 rows; none may answer to it.
    const markup = await renderCycles(healthyScript(), { cycle: "" });
    const $ = cheerio.load(markup);
    expect($("[data-row-marked]").length).toBe(0);
    expect($("[data-cycle][aria-current]").length).toBe(0);
    expect(renderedCycles(markup)).toEqual(renderedCycles(await renderCycles(healthyScript())));
  });

  it("marks nothing for a ?cycle= that is not a run id at all [admin-window/BUG-0054]", async () => {
    // A malformed id reaches `anchorFor` and the row predicate alike; the page
    // answers with a sentence and zero painted rows, never a crash.
    for (const nonsense of ["../../etc/passwd", "%%%", "a b c", "<script>x</script>"]) {
      const markup = await renderCycles(healthyScript(), { cycle: nonsense });
      const $ = cheerio.load(markup);
      expect($("[data-row-marked]").length, nonsense).toBe(0);
      expect($("[data-cycle][aria-current]").length, nonsense).toBe(0);
      expect(renderedCycles(markup).length, nonsense).toBe(CYCLES.length);
      expect(markup, nonsense).not.toContain("<script>x");
    }
  });

  it("keeps the window's own limits on screen beside a cycle it could not find", async () => {
    // A full window is the one case where "not here" and "does not exist" come
    // apart: the cap filled, so the asked-for cycle may be older than the
    // oldest row. The page may only say the cycle is not in THIS window, and
    // the truncation the reader needs to know that has to be on the same
    // screen — not dropped because a facet was asked for.
    const capped = Array.from({ length: CYCLE_WINDOW }, (_, index) => ({
      ...SUCCEEDED,
      run_id: `capped-${String(index).padStart(4, "0")}`,
      started_at: new Date(Date.parse(SUCCEEDED.started_at) - index * 60_000).toISOString(),
    }));
    const markup = await renderCycles(
      {
        [T.resolutionRuns]: [{ data: capped }, { data: [...CYCLES] }],
        [T.fieldProvenance]: { data: [...APPLIES] },
        [T.observations]: { data: [...OBSERVED] },
      },
      { cycle: "0192ffff-older-than-the-window" },
    );
    const $ = cheerio.load(markup);
    expect(renderedCycles(markup)).toHaveLength(CYCLE_WINDOW);
    expect($('[data-cycle-found="false"]').attr("data-cycle-asked")).toBe(
      "0192ffff-older-than-the-window",
    );
    expect($('[data-window="cycles"]').attr("data-window-truncated")).toBe("true");
    expect($("[data-cycle][aria-current]").length).toBe(0);
    expect($("[data-row-marked]").length).toBe(0);
  });

  it("answers a ?cycle= link off an empty read, which is evidence and not a refusal", async () => {
    // An `ok` read of a table holding nothing IS a window — the page looked
    // and there was nothing there — so the negative verdict is earned here,
    // unlike the read that never returned one (admin-window/BUG-0023).
    const markup = await renderCycles(
      healthyScript({ [T.resolutionRuns]: [{ data: [] }, { data: [] }] }),
      { cycle: SUCCEEDED.run_id },
    );
    const $ = cheerio.load(markup);
    expect(renderedCycles(markup)).toEqual([]);
    expect($('[data-empty="cycles"]').length).toBe(1);
    expect($('[data-cycle-found="false"]').attr("data-cycle-asked")).toBe(SUCCEEDED.run_id);
    expect($("[data-cycle-unchecked]").length).toBe(0);
    expect(notProvisioned(markup)).toEqual([]);
  });

  it("renders a facet value the URL invented as text, never as markup", async () => {
    // Both facets put a URL-controlled string into the page, and the value is
    // named verbatim so the operator sees what was asked for. Verbatim is the
    // TEXT, never the markup: nothing the URL carries may reach the document
    // as an element.
    const markup = await renderCycles(healthyScript(), {
      cycle: '<script>alert(1)</script>',
      source: '"><img src=x onerror=alert(1)>',
    });
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    const $ = cheerio.load(markup);
    expect($("script").length).toBe(0);
    expect($("img").length).toBe(0);
    // Still named, as text, so a mistyped facet is legible rather than silent.
    expect($("[data-cycle-asked]").text()).toContain("<script>alert(1)</script>");
    expect($("[data-source-facet]").text()).toContain('"><img src=x onerror=alert(1)>');
  });

  it("renders the empty state, not a zero, when no cycle has ever run", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.resolutionRuns]: [{ data: [] }, { data: [] }] }),
    );
    expect(renderedCycles(markup)).toEqual([]);
    expect(cheerio.load(markup)('[data-empty="cycles"]').length).toBe(1);
    expect(notProvisioned(markup)).toEqual([]);
  });
});

/* ── the two gauges (spec §5) ────────────────────────────────────────────── */

describe("the cycle-health gauge", () => {
  it("renders its window, its counts and its outcome spread", async () => {
    const markup = await renderCycles(healthyScript());
    expect(windowOf(markup, "cycle_health").present).toBe(true);

    // Every figure is the aggregate's, over the fixture population: six
    // cycles, and the facts examined summed across them.
    expect(readNumber(markup, "Cycles in this window")).toBe(CYCLES.length);
    expect(readNumber(markup, "Facts examined")).toBe(
      CYCLES.reduce((total, row) => total + row.facts_examined, 0),
    );
    expect(readNumber(markup, "Errors")).toBe(
      CYCLES.reduce((total, row) => total + row.errors, 0),
    );

    // The outcome spread counts each of the constraint's three words and each
    // of the three states a row carrying none can be in — the fixture holds
    // exactly one cycle in each of the six.
    const outcomes = new Map(
      tableRows(markup, OUTCOMES).map((cells) => [cells[0], cells[1]]),
    );
    expect(outcomes.get("succeeded")).toBe("1");
    expect(outcomes.get("failed")).toBe("1");
    expect(outcomes.get("skipped")).toBe("1");
    expect(outcomes.get("died")).toBe("1");
  });

  /*
   * admin-window/BUG-0055. The panel called four cycles `unfinished` where the
   * rows called the same four `died`, and a reader had to prove the two sets
   * were one set before he would trust the count.
   *
   * Both sides are read out of the DELIVERED markup and compared to each
   * other, never to a literal: the property is that this page has one word per
   * state, not that the word is any particular string. Rename `died` to
   * anything and this still passes; name one state two ways and it cannot.
   */
  it("names each state with the same word the table rows do", async () => {
    const markup = await renderCycles(healthyScript());
    const panel = new Map(
      tableRows(markup, OUTCOMES).map((cells) => [cells[0], cells[1]]),
    );
    // One cycle per state in the fixture, so every row's own word must be a
    // line of the panel reading exactly 1.
    for (const row of [SUCCEEDED, FAILED, SKIPPED, RUNNING, DIED, UNRECORDED]) {
      const cell = cycleRow(markup, row.run_id);
      const word = cell.cells[2];
      expect(panel.has(word), `${cell.state} row says "${word}"`).toBe(true);
      expect(panel.get(word), `${cell.state} row says "${word}"`).toBe("1");
    }
  });

  it("counts every rendered cycle exactly once across the outcome panel", async () => {
    const markup = await renderCycles(healthyScript());
    const total = tableRows(markup, OUTCOMES)
      .map((cells) => Number(cells[1].replace(/,/g, "")))
      .reduce((sum, n) => sum + n, 0);
    expect(total).toBe(renderedCycles(markup).length);
  });

  it("reports a duration spread, and counts a cycle with no end as unmeasurable", async () => {
    const markup = await renderCycles(healthyScript());
    const rows = tableRows(markup, DURATIONS);
    // min / p50 / p90 / p95 / p99 / max, each a duration and not a raw second
    // count (LOOK_AND_FEEL: ages and lengths are relative).
    expect(rows.map((cells) => cells[0])).toEqual([
      "min",
      "p50",
      "p90",
      "p95",
      "p99",
      "max",
    ]);
    // The two cycles with no end contribute no duration of zero: the shortest
    // measured duration is the skipped cycle's sub-second one.
    expect(rows[0][1]).toBe("0.4s");
  });

  it("names the newest cycle carrying errors, and links to its row", async () => {
    const markup = await renderCycles(healthyScript());
    const $ = cheerio.load(markup);
    const line = $("[data-latest-error]");
    // FAILED is 20 minutes old, DIED is three days old: the newest of the two.
    expect(line.attr("data-latest-error")).toBe(FAILED.run_id);
    expect(line.find("a").attr("href")).toBe(
      `#${cycleRow(markup, FAILED.run_id).anchor}`,
    );
    expect(line.text()).toContain(FAILED.error_summary);
  });
});

describe("the resolution-latency gauge", () => {
  it("counts the applies, and never the raw window it read", async () => {
    const markup = await renderCycles(healthyScript());
    expect(windowOf(markup, "resolution_latency").present).toBe(true);

    // The trap admin-window/BUG-0012 found: the read's row array holds five
    // decisions, three of which are applies. The page must render 3.
    expect(APPLIES.length).toBe(APPLY_COUNT + UNSET_COUNT);
    expect(readNumber(markup, "Applies in this window")).toBe(APPLY_COUNT);
    expect(readNumber(markup, "Unset by a human decision")).toBe(UNSET_COUNT);
    expect(readNumber(markup, "Applies with no claim found")).toBe(UNMATCHED_COUNT);
  });

  it("lists a domain whose applies are zero beside the count that explains it", async () => {
    const markup = await renderCycles(healthyScript());
    const rows = new Map(
      tableRows(markup, BY_DOMAIN).map((cells) => [cells[0], cells.slice(1)]),
    );
    // events: two applies (one of them unmatched) and both unsets.
    expect(rows.get("events")?.[0]).toBe("2");
    expect(rows.get("events")?.[1]).toBe("2");
    // venues: one apply, no unsets, and a measurable wait.
    expect(rows.get("venues")?.[0]).toBe("1");
    expect(rows.get("venues")?.[1]).toBe("0");
    expect(rows.get("venues")?.[2]).not.toBe(EM_DASH);
  });

  it("renders the wait spread as durations, not as raw seconds", async () => {
    const markup = await renderCycles(healthyScript());
    const rows = tableRows(markup, WAITS);
    expect(rows.map((cells) => cells[0])).toEqual([
      "min",
      "p50",
      "p90",
      "p95",
      "p99",
      "max",
    ]);
    // The two measurable waits are 60 and 60 minutes: an hour, on the app's
    // one unit ladder.
    expect(rows[0][1]).toBe("1h");
  });

  it("says the window held nothing when the resolver has applied nothing", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.fieldProvenance]: { data: [] }, [T.observations]: { data: [] } }),
    );
    expect(readNumber(markup, "Applies in this window")).toBe(0);
    // No rows and a stated reason: the trend is replaced by its empty card
    // rather than rendering a header row over nothing.
    expect(tableRows(markup, BY_DOMAIN)).toEqual([]);
    expect(notProvisioned(markup)).toEqual([]);
  });
});

/* ── the four states, and the seam ───────────────────────────────────────── */

describe("a database without the resolver's tables", () => {
  it("names resolution_runs in its not-provisioned state, and never renders a zero", async () => {
    const markup = await renderCycles({
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
      [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
    });
    // Both the table and the cycle-health gauge read that object, and each
    // names it in the spelling its own query used.
    expect(notProvisioned(markup)).toContain(T.resolutionRuns);
    expect(notProvisioned(markup)).toContain(T.fieldProvenance);
    expect(renderedCycles(markup)).toEqual([]);
    expect(() => readNumber(markup, "Cycles in this window")).toThrow();
  });

  it("keeps each surface's failure to itself", async () => {
    // The latency gauge's second leg is absent; the cycle table and the
    // cycle-health gauge are untouched by that.
    const markup = await renderCycles(
      healthyScript({ [T.observations]: { error: tableNotInSchemaCache(T.observations) } }),
    );
    expect(notProvisioned(markup)).toEqual([T.observations]);
    expect(renderedCycles(markup)).toEqual(NEWEST_FIRST.map((row) => row.run_id));
    expect(readNumber(markup, "Cycles in this window")).toBe(CYCLES.length);
  });

  it("names the read that was refused, in the object's own spelling", async () => {
    const markup = await renderCycles(
      healthyScript({
        [T.resolutionRuns]: [
          { error: permissionDenied(T.resolutionRuns) },
          { data: [...CYCLES] },
        ],
      }),
    );
    expect(readsFailed(markup)).toContain(T.resolutionRuns);
    // The database's own account reaches the page, not a sentence of ours.
    expect(markup).toContain("permission denied");
    // The header stays put: an error is a line inside the surface, not a card
    // replacing it.
    expect(headers(markup, CYCLES_TABLE).length).toBeGreaterThan(0);
  });

  /**
   * Was a strict `it.fails` pin for admin-window/BUG-0067: `/cycles` rendered
   * its cycles window line in EVERY state, publishing `data-window="cycles"`,
   * `data-window-limit="200"` and `data-window-truncated="false"` over a table
   * it could not read. `/runs` (`AdapterRuns`, src/app/cycles/page.tsx) and
   * `/claims` (admin-window/BUG-0063) already dropped the line on a non-ok
   * read; this was the third surface and the last one diverging. Fixed by
   * wrapping the line in `cycles.kind === "ok"`, so it is a plain `it` now and
   * reddens if the line ever escapes that branch again.
   */
  it("claims no cycles window it never read", async () => {
    // The rule `/runs` sets and `/claims` was moved onto
    // (admin-window/BUG-0063): the window line describes a window this page
    // actually read. A refused, absent or transport-failed read looked in no
    // window, so the sentence would describe a table that is not there and
    // `data-window-truncated="false"` would be a confident boolean about a
    // read that returned nothing (LOOK_AND_FEEL states 3 and 4,
    // ARCHITECTURE.md "a null count is a refusal, never a zero").
    const failures: Array<[string, Script]> = [
      [
        "refused",
        {
          [T.resolutionRuns]: [
            { error: permissionDenied(T.resolutionRuns) },
            { data: [...CYCLES] },
          ],
          [T.fieldProvenance]: { data: [...APPLIES] },
          [T.observations]: { data: [...OBSERVED] },
          [T.runs]: { data: [] },
        },
      ],
      [
        "absent",
        {
          [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
          [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
          [T.observations]: { data: [...OBSERVED] },
          [T.runs]: { data: [] },
        },
      ],
      [
        "transport",
        {
          [T.resolutionRuns]: [
            { error: transportFailure("bad port") },
            { data: [...CYCLES] },
          ],
          [T.fieldProvenance]: { data: [...APPLIES] },
          [T.observations]: { data: [...OBSERVED] },
          [T.runs]: { data: [] },
        },
      ],
    ];
    for (const [label, script] of failures) {
      const markup = await renderCycles(script);
      const $ = cheerio.load(markup);
      expect($('[data-window="cycles"]'), label).toHaveLength(0);
      // The refusal itself is still on screen: the line goes, the state stays.
      expect(markup, label).toContain(T.resolutionRuns);
      expect(renderedCycles(markup), label).toEqual([]);
    }
  });

  it("still states the cycles window on a read that happened, empty or not", async () => {
    // The other half of the same rule: an EMPTY window is still a window —
    // the page looked in it, and nothing was there.
    for (const [label, script] of [
      ["populated", healthyScript()],
      [
        "empty",
        healthyScript({ [T.resolutionRuns]: [{ data: [] }, { data: [] }] }),
      ],
    ] as const) {
      const $ = cheerio.load(await renderCycles(script));
      expect($('[data-window="cycles"]'), label).toHaveLength(1);
      expect($('[data-window="cycles"]').attr("data-window-limit"), label).toBe(
        String(CYCLE_WINDOW),
      );
    }
  });
});

/* ── what the page may claim when it never read the window ───────────────── */

describe("the ?cycle= link against a window the page could not read", () => {
  /**
   * The Dashboard links every cycle line to `/cycles?cycle=<run_id>`, and an
   * operator follows that link EXACTLY when something is wrong. If the read of
   * `resolution_runs` refused or the object is absent, the page holds no
   * window at all — so "this cycle is not in the window" is a verdict it has
   * no evidence for, and on the not-provisioned path it contradicts the card
   * rendered immediately below it.
   *
   * Behaviour asserted, not copy: the page must not publish the definite
   * NEGATIVE verdict (`data-cycle-found="false"`) off a read that returned no
   * window. Saying nothing, or saying the window could not be read, both pass.
   */
  // Filed as two `it.fails` pins by QA and flipped back to plain `it(...)` when
  // admin-window/BUG-0023 was fixed: the assertions below are unchanged, and
  // they now hold because the verdict renders only off an `ok` read.
  it("does not claim the cycle is absent when resolution_runs is not provisioned [admin-window/BUG-0023]", async () => {
    const markup = await renderCycles(
      healthyScript({
        [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
      }),
      { cycle: SUCCEEDED.run_id },
    );
    // The read never happened, so the page has no window to judge against.
    expect(notProvisioned(markup)).toContain(T.resolutionRuns);
    expect(renderedCycles(markup)).toEqual([]);
    expect(cheerio.load(markup)('[data-cycle-found="false"]').length).toBe(0);
  });

  it("does not claim the cycle is absent when the read of resolution_runs was refused [admin-window/BUG-0023]", async () => {
    const markup = await renderCycles(
      healthyScript({
        [T.resolutionRuns]: [
          { error: permissionDenied(T.resolutionRuns) },
          { data: [...CYCLES] },
        ],
      }),
      { cycle: SUCCEEDED.run_id },
    );
    expect(readsFailed(markup)).toContain(T.resolutionRuns);
    expect(renderedCycles(markup)).toEqual([]);
    expect(cheerio.load(markup)('[data-cycle-found="false"]').length).toBe(0);
  });

  it("says instead that the window it would have looked in was never read", async () => {
    // Not merely the absence of the negative verdict: the operator who
    // followed the Dashboard's link is told which read came back with no
    // window, in the object's own spelling, and no row anywhere is marked as
    // the asked-for cycle.
    for (const script of [
      { [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) } },
      {
        [T.resolutionRuns]: [
          { error: permissionDenied(T.resolutionRuns) },
          { data: [...CYCLES] },
        ],
      },
    ] satisfies Script[]) {
      const markup = await renderCycles(healthyScript(script), {
        cycle: SUCCEEDED.run_id,
      });
      const $ = cheerio.load(markup);
      const line = $(`[data-cycle-asked="${SUCCEEDED.run_id}"]`);
      expect(line.attr("data-cycle-unchecked")).toBe(T.resolutionRuns);
      expect(line.attr("data-cycle-found")).toBeUndefined();
      // The asked-for id is still named, so the link does not read as broken.
      expect(line.text()).toContain(SUCCEEDED.run_id);
      expect($("[data-cycle][aria-current]").length).toBe(0);
    }
  });

  it("holds the verdict back for a transport failure too, not only a refusal", async () => {
    // The two pinned states are PostgREST's; a fetch that never reached the
    // database is the third way a read comes back with no window, and the page
    // may not answer the link off that one either. The line names the object
    // it was reading — never the transport's own account, which is the error
    // card's job below.
    const markup = await renderCycles(
      healthyScript({
        [T.resolutionRuns]: [{ error: transportFailure() }, { data: [...CYCLES] }],
      }),
      { cycle: SUCCEEDED.run_id },
    );
    const $ = cheerio.load(markup);
    expect(readsFailed(markup)).toContain(T.resolutionRuns);
    expect($("[data-cycle-found]").length).toBe(0);
    expect($(`[data-cycle-asked="${SUCCEEDED.run_id}"]`).attr("data-cycle-unchecked")).toBe(
      T.resolutionRuns,
    );
    expect($("[data-cycle][aria-current]").length).toBe(0);
  });

  it("still answers the ?cycle= link when the read did return a window", async () => {
    // The fix removes a verdict from two states and from no others: an `ok`
    // read that does not hold the cycle still says so.
    const markup = await renderCycles(healthyScript(), { cycle: "0192ffff-dead" });
    const $ = cheerio.load(markup);
    expect($('[data-cycle-found="false"]').attr("data-cycle-asked")).toBe("0192ffff-dead");
    expect($("[data-cycle-unchecked]").length).toBe(0);
  });
});

/* ── the facet that belongs to the half this page does not render ────────── */

describe("a ?source= link arriving from the Sources page", () => {
  it("says which half the facet narrows, and narrows none of the cycles itself", async () => {
    // `resolution_runs` carries no source, so the cycles are the same cycles
    // with the facet as without it — but the arriving link is answered rather
    // than ignored byte-for-byte (relayed on admin-window/TASK-0016).
    const plain = await renderCycles(healthyScript());
    const faceted = await renderCycles(healthyScript(), { source: "ticketmaster" });
    expect(renderedCycles(faceted)).toEqual(renderedCycles(plain));
    const line = cheerio.load(faceted)("[data-source-facet]");
    expect(line.attr("data-source-facet")).toBe("ticketmaster");
    // The source is named verbatim, so the operator sees which one was meant.
    expect(line.text()).toContain("ticketmaster");
    // No facet, no sentence.
    expect(cheerio.load(plain)("[data-source-facet]").length).toBe(0);
  });

  it("takes the first value when the URL names the source twice", async () => {
    const markup = await renderCycles(healthyScript(), {
      source: ["bandsintown", "eventbrite"],
    });
    expect(cheerio.load(markup)("[data-source-facet]").attr("data-source-facet")).toBe(
      "bandsintown",
    );
  });
});

/**
 * The adapter framework's `runs` are the page's OTHER half and landed with
 * admin-window/TASK-0016 (Ben's ruling of 2026-09-02). Everything about that
 * half — its nine columns, its order, its four states and the `?source=`
 * facet — is asserted in `tests/offline/runs/`, which owns it and renders the
 * whole page against a `runs` population.
 *
 * What stays HERE is the boundary this file's own subject cares about: the
 * cycles half is the cycles half, and the second table on the page does not
 * bleed into it. The reads this file scripts do not include `runs`, so the
 * runs section renders its own error state and the cycles below are
 * unaffected — which is the assertion.
 */
describe("the adapter framework's runs, beside the cycles", () => {
  it("is a second section, and the cycles half is unchanged by it", async () => {
    const markup = await renderCycles(healthyScript());
    // Five sections: the lead that puts the newest run above the fold
    // (admin-window/BUG-0040), then the two halves spec §4 names, then the two
    // gauges §5 puts on this page.
    expect(sections(markup)).toEqual([
      "Newest adapter run",
      "Cycles",
      "Adapter runs",
      "Cycle health",
      "Resolution latency",
    ]);
    // This file's script holds no `runs` rows, so that half renders its empty
    // state — a card, not a table — and the surfaces below are the cycles
    // table plus the two gauges' distributions and trend, unchanged.
    const $ = cheerio.load(markup);
    expect($('[data-surface="runs"]').attr("data-state")).toBe("empty");
    expect(
      $("table")
        .toArray()
        .map((element) => $(element).attr("aria-label")),
    ).toEqual([CYCLES_TABLE, OUTCOMES, DURATIONS, WAITS, BY_DOMAIN]);
    // Every cycle still renders beside it.
    expect(renderedCycles(markup)).toEqual(NEWEST_FIRST.map((row) => row.run_id));
  });

  it("reads the runs table separately from the cycles table", async () => {
    const stub = stubClient(healthyScript());
    readWith.client = stub.asSupabaseClient();
    await CyclesPage({ searchParams: Promise.resolve({}) });
    // Two tables, two reads: one refusing never takes the other down
    // (ARCHITECTURE.md §4.1).
    expect(stub.tablesRead()).toContain(T.resolutionRuns);
    expect(stub.tablesRead()).toContain(T.runs);
  });
});
/* ── the newest run, above the fold (admin-window/BUG-0040) ──────────────── */

/**
 * LOOK_AND_FEEL bar 1 names this page: at 1440×900, without scrolling,
 * "Cycles & runs shows the newest run with its counts and error". Both halves
 * are windows of at most 200 rows and they are stacked, so on the M1 endgame
 * designer walk the runs heading measured y=4,419px — 4.9 viewport-heights
 * below the fold — and the newest run could not be read at a glance.
 *
 * The fold is not a thing offline markup can measure, so what these tests pin
 * is the ORDER that caused it: the newest run renders BEFORE the cycles
 * window, whole. Everything the runs half itself promises — its nine columns,
 * its four states, its facet — stays the property of `tests/offline/runs/`;
 * what is asserted here is this page's own arrangement, and that the lead is a
 * repeat of the window's first row rather than a second read or a second run.
 */
describe("the newest adapter run, above the cycles window", () => {
  it("leads with the window's newest run, ahead of a cycles window at its cap", async () => {
    const markup = await renderCycles({
      [T.resolutionRuns]: [{ data: fullCycleWindow() }, { data: [...CYCLES] }],
      [T.fieldProvenance]: { data: [...APPLIES] },
      [T.observations]: { data: [...OBSERVED] },
      [T.runs]: { data: [...RUNS] },
    });

    // The page the walk measured: 200 cycle rows between the top and the runs.
    expect(renderedCycles(markup)).toHaveLength(CYCLE_WINDOW);

    const lead = leadRun(markup);
    expect(lead.markers).toBe(1);
    expect(lead.state).toBe("ok");
    // The newest by started_at — computed here from the fixtures, which are
    // handed to the page deliberately out of order.
    expect(lead.runId).toBe(RUNS_NEWEST_FIRST[0].run_id);

    // And it is ahead of every one of those 200 rows: nothing of the cycles
    // window renders before the run does.
    const order = rowOrder(markup);
    expect(order).toContain("cycle");
    expect(order.lastIndexOf("run")).toBeLessThan(order.indexOf("cycle"));
  });

  it("shows that run's source, start, outcome and error, verbatim", async () => {
    // A window whose newest run FAILED is the case bar 1 exists for: "did
    // anything happen last night" is answered by the run that broke.
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [RUN_FAILED] } }),
    );

    const lead = leadRun(markup);
    expect(lead.runId).toBe(RUN_FAILED.run_id);
    expect(lead.source).toBe(RUN_FAILED.source);
    expect(lead.startedAt).toBe(RUN_FAILED.started_at);
    expect(lead.outcome).toBe(RUN_FAILED.outcome);
    // The producer's own failure line, not trimmed and not summarised.
    expect(lead.error).toBe(RUN_FAILED.error_summary);
  });

  it("bounds an over-long error on the lead, keeps the whole of it reachable, and holds the fold", async () => {
    // The lead is the only row ABOVE the cycles window, so its height is the
    // one height on this page that can push the newest cycle back under the
    // fold — which the walk measured happening past roughly 700 characters of
    // `error_summary` (admin-window/DEBT-0005, from BUG-0040). This is that
    // string at 2,000, against the cycles window at its 200-row cap.
    const HUGE = `${"upstream 503 on page 7 of 12; ".repeat(66)}and it never came back`;
    expect(HUGE.length).toBeGreaterThanOrEqual(2_000);
    const failed = { ...RUN_FAILED, error_summary: HUGE };

    const markup = await renderCycles({
      [T.resolutionRuns]: [{ data: fullCycleWindow() }, { data: [...CYCLES] }],
      [T.fieldProvenance]: { data: [...APPLIES] },
      [T.observations]: { data: [...OBSERVED] },
      [T.runs]: { data: [failed] },
    });

    const lead = leadRun(markup);
    // Bounded, and VISIBLY bounded — nothing is cut in silence.
    expect(Array.from(lead.error).length).toBeLessThanOrEqual(CLAMP_LIMIT);
    expect(lead.error.endsWith(ELLIPSIS)).toBe(true);
    // Producer text is never re-worded: what is on screen is its own opening.
    expect(HUGE.startsWith(lead.error.slice(0, -ELLIPSIS.length))).toBe(true);
    // And the whole of it stays reachable, both ways the Look rules allow: on
    // the lead's own element, and verbatim in the row's own cell below.
    expect(lead.errorTitle).toBe(HUGE);
    expect(windowRunError(markup, failed.run_id)).toBe(HUGE);

    // The property the bound exists for: one lead, and it is still ahead of
    // all 200 cycle rows rather than having wrapped them off the screen.
    expect(lead.markers).toBe(1);
    expect(renderedCycles(markup)).toHaveLength(CYCLE_WINDOW);
    const order = rowOrder(markup);
    expect(order).toContain("cycle");
    expect(order.lastIndexOf("run")).toBeLessThan(order.indexOf("cycle"));
  });

  it("leaves an error the bound does not reach byte-identical, title and all", async () => {
    // Every `error_summary` this database has ever held is short (staging's
    // longest is 58 characters), so the ordinary lead is still the window's
    // row cell for cell — the clamp adds no title and changes no text.
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [RUN_FAILED] } }),
    );
    const lead = leadRun(markup);
    expect(RUN_FAILED.error_summary?.length).toBeLessThan(CLAMP_LIMIT);
    expect(lead.error).toBe(RUN_FAILED.error_summary);
    expect(lead.error).not.toContain(ELLIPSIS);
    expect(lead.errorTitle).toBeUndefined();
  });

  it("renders the lead as the very row the window renders below, cell for cell", async () => {
    // Same read, same columns, same cell bodies: the lead cannot drift from
    // the row it repeats, dash included.
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [...RUNS] } }),
    );
    const newest = RUNS_NEWEST_FIRST[0];
    expect(leadRun(markup).cells).toEqual(windowRunCells(markup, newest.run_id));
    expect(leadRun(markup).cells.length).toBeGreaterThan(0);
  });

  it("is a repeat and not a second run: the window below still holds each row once", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [...RUNS] } }),
    );
    const $ = cheerio.load(markup);
    // `[data-run]` is what the files owning the runs window read. The lead
    // answers to `data-latest-run` instead, so the window is still the window.
    expect(
      $("[data-run]")
        .toArray()
        .map((element) => $(element).attr("data-run")),
    ).toEqual(RUNS_NEWEST_FIRST.map((row) => row.run_id));
    // One window, one window line: the lead describes no window of its own.
    expect($('[data-window="runs"]').length).toBe(1);
    // And states no figure — a lead is a row, never a count
    // (ARCHITECTURE.md §4.3).
    expect(() => readNumber(markup, "Runs in this window")).toThrow();
  });

  it("links to the window it took the row from", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [...RUNS] } }),
    );
    const href = leadRun(markup).href;
    expect(href).toBeDefined();
    expect(href?.startsWith("#")).toBe(true);
    // The target exists on this page, so "below" is a click and not a hunt.
    expect(cheerio.load(markup)(href ?? "#none").length).toBe(1);
  });

  it("leaves the cycles half exactly as it was", async () => {
    // The bug was the runs half only. The 200-row cycles window, its
    // "at most N, not a count" line and the newest cycle's own counts and
    // error are what the page already got right, and they stay above the fold
    // beside the run.
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [...RUNS] } }),
    );
    const $ = cheerio.load(markup);
    expect(renderedCycles(markup)).toEqual(NEWEST_FIRST.map((row) => row.run_id));
    expect($('[data-window="cycles"]').attr("data-window-limit")).toBe(
      String(CYCLE_WINDOW),
    );
    // The newest cycle still renders all eight counters and its error cell.
    const newestCycle = cycleRow(markup, NEWEST_FIRST[0].run_id);
    expect(Object.keys(newestCycle.counts).sort()).toEqual(
      [...CYCLE_COUNTERS].sort(),
    );
    expect(newestCycle.cells).toHaveLength(CYCLE_COUNTERS.length + 5);
  });

  it("says which absence it is when there is no run to lead with, and draws no second card", async () => {
    // Three row-less states, three different sentences, each naming the object
    // its read named — and each rendered ONCE on the page: the state cards
    // below belong to the surface that made the read, and the lead adds none.
    const empty = await renderCycles(healthyScript({ [T.runs]: { data: [] } }));
    expect(leadRun(empty).state).toBe("empty");
    expect(leadRun(empty).markers).toBe(0);
    expect(cheerio.load(empty)('[data-empty="runs"]').length).toBe(1);
    expect(notProvisioned(empty)).toEqual([]);
    expect(readsFailed(empty)).toEqual([]);

    const absent = await renderCycles(
      healthyScript({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } }),
    );
    expect(leadRun(absent).state).toBe("not_provisioned");
    expect(leadRun(absent).markers).toBe(0);
    // The object is named in the lead, in the spelling the read used …
    expect(cheerio.load(absent)("[data-latest-run-state]").text()).toContain(T.runs);
    // … and the not-provisioned CARD is still rendered exactly once, by the
    // surface that read it.
    expect(notProvisioned(absent)).toEqual([T.runs]);

    const refused = await renderCycles(
      healthyScript({ [T.runs]: { error: permissionDenied(T.runs) } }),
    );
    expect(leadRun(refused).state).toBe("error");
    expect(leadRun(refused).markers).toBe(0);
    expect(cheerio.load(refused)("[data-latest-run-state]").text()).toContain(T.runs);
    expect(readsFailed(refused)).toEqual([T.runs]);

    // Whatever it says, it says it above the cycles window — an operator who
    // cannot see a run must not have to scroll 200 rows to find out why.
    for (const markup of [empty, absent, refused]) {
      const order = rowOrder(markup);
      expect(order).toContain("cycle");
      expect(order.lastIndexOf("run")).toBeLessThan(order.indexOf("cycle"));
    }
  });

  it("names the source a facet asked for when nothing was filed under it", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [] } }),
      { source: NO_SUCH_SOURCE },
    );
    const lead = leadRun(markup);
    expect(lead.state).toBe("empty");
    expect(lead.markers).toBe(0);
    // The name is stated verbatim, so the operator sees which one was meant.
    expect(cheerio.load(markup)("[data-latest-run-state]").text()).toContain(
      NO_SUCH_SOURCE,
    );
  });
});

/* ── the names the live parity oracle addresses these surfaces by ────────── */

/**
 * Every surface this page renders, by the `data-surface` name it answers to.
 * `runs` is the runs window's own hand-written wrapper, which
 * `tests/live/runs.live.test.ts` has always used; the other four are the
 * `<Section>` hooks added by admin-window/BUG-0056.
 */
const SURFACE_HOOKS = {
  latest_run: '[data-surface="latest_run"]',
  cycles: '[data-surface="cycles"]',
  runs: '[data-surface="runs"]',
  cycle_health: '[data-surface="cycle_health"]',
  resolution_latency: '[data-surface="resolution_latency"]',
} as const;

describe("the surface hooks the live parity oracle addresses", () => {
  /**
   * `tests/live/cycles.live.test.ts` grades ONE surface at a time, and
   * `stateOf` (`tests/live/parity.ts`) refuses any selector matching other
   * than exactly one element. Until admin-window/BUG-0056 that oracle
   * addressed the surfaces POSITIONALLY — `section:nth-of-type(n)` — so
   * admin-window/BUG-0040's lead section and its `<div>` wrapper around the
   * runs window made one selector match two surfaces (four live tests threw),
   * while the two gauge selectors kept naming the right surfaces only because
   * a section added above and a section buried below happened to cancel.
   *
   * Nothing offline could see any of that: `npm test` runs the offline and
   * isolated projects only, so the live oracle's addressing had no pin in CI.
   * These two cases are that pin, and they live in the file that owns this
   * page's markup on purpose — a reorder should redden the suite that runs on
   * every ticket, not only the one that needs staging.
   */
  it("gives each surface exactly one element, in every state and under a facet", async () => {
    const populated = await renderCycles(healthyScript({ [T.runs]: { data: [...RUNS] } }));
    const empty = await renderCycles(healthyScript({ [T.runs]: { data: [] } }));
    const faceted = await renderCycles(
      healthyScript({ [T.runs]: { data: [...RUNS] } }),
      { source: RUN_FAILED.source, cycle: SUCCEEDED.run_id },
    );
    // Nothing readable at all: the states that swap a surface's table for a
    // card are exactly where a wrapper is most likely to appear or vanish.
    const absent = await renderCycles({
      [T.resolutionRuns]: { error: tableNotInSchemaCache(T.resolutionRuns) },
      [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      [T.runs]: { error: tableNotInSchemaCache(T.runs) },
    });
    const refused = await renderCycles({
      [T.resolutionRuns]: { error: permissionDenied(T.resolutionRuns) },
      [T.fieldProvenance]: { error: permissionDenied(T.fieldProvenance) },
      [T.observations]: { error: permissionDenied(T.observations) },
      [T.runs]: { error: permissionDenied(T.runs) },
    });

    for (const markup of [populated, empty, faceted, absent, refused]) {
      const $ = cheerio.load(markup);
      for (const hook of Object.values(SURFACE_HOOKS)) {
        expect($(hook).length, hook).toBe(1);
      }
      // …and no surface sits inside another, so grading one never reads a
      // card that belongs to its neighbour.
      for (const outer of Object.values(SURFACE_HOOKS)) {
        for (const inner of Object.values(SURFACE_HOOKS)) {
          if (outer === inner) continue;
          expect($(outer).find(inner).length, `${outer} inside ${inner}`).toBe(0);
        }
      }
    }
  });

  it("keeps each surface's own rows and window line inside its own hook", async () => {
    // A hook that is unique but points at the wrong surface is the same bug
    // wearing a different hat, so each name is checked against what that
    // surface actually reads.
    const $ = cheerio.load(
      await renderCycles(healthyScript({ [T.runs]: { data: [...RUNS] } })),
    );

    expect($(SURFACE_HOOKS.latest_run).find("[data-latest-run-state]").length).toBe(1);
    expect($(SURFACE_HOOKS.cycles).find("[data-cycle]").length).toBe(CYCLES.length);
    expect($(SURFACE_HOOKS.cycles).find('[data-window="cycles"]').length).toBe(1);
    expect($(SURFACE_HOOKS.runs).find("[data-run]").length).toBe(RUNS.length);
    expect($(SURFACE_HOOKS.cycle_health).find('[data-window="cycle_health"]').length).toBe(1);
    expect(
      $(SURFACE_HOOKS.resolution_latency).find('[data-window="resolution_latency"]').length,
    ).toBe(1);

    // The two tables never bleed into each other's surface: the lead's copy of
    // a run is the lead's, and the cycles surface holds no run at all.
    expect($(SURFACE_HOOKS.cycles).find("[data-run], [data-latest-run]").length).toBe(0);
    expect($(SURFACE_HOOKS.runs).find("[data-cycle], [data-latest-run]").length).toBe(0);
    expect($(SURFACE_HOOKS.latest_run).find("[data-cycle], [data-run]").length).toBe(0);
  });

  /**
   * The states above are the four whole-page ones. These are the awkward
   * middles: ONE read failing while its neighbours succeed, and URL facets
   * that are not the well-formed link a Dashboard tile emits. Both are where
   * admin-window/BUG-0040 actually did its damage — a wrapper appearing in one
   * branch and not another — and neither is reachable from a whole-page
   * script, because a partial failure swaps exactly one surface's table for a
   * card while the rest of the page keeps its shape.
   */
  it("keeps every hook unique and disjoint when one read fails and the others do not", async () => {
    // Thunks, not promises: `renderCycles` installs the script on a SHARED
    // stub client, so six renders started at once would read each other's
    // database. Each is built and awaited in turn.
    const states: Array<[string, () => Promise<string>]> = [
      // The runs half absent, the cycles half fine: the only branch where the
      // hand-written `data-surface="runs"` wrapper holds a card, not a table.
      ["runs absent", () => renderCycles(healthyScript({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } }))],
      // The latency gauge refused, everything above it readable.
      ["latency refused", () => renderCycles(healthyScript({ [T.observations]: { error: permissionDenied(T.observations) } }))],
      // The cycles table and its health gauge both refused — two surfaces
      // swapped for cards at once, the runs half untouched.
      [
        "cycles refused",
        () =>
          renderCycles(
            healthyScript({
              [T.resolutionRuns]: [
                { error: permissionDenied(T.resolutionRuns) },
                { error: permissionDenied(T.resolutionRuns) },
              ],
              [T.runs]: { data: [...RUNS] },
            }),
          ),
      ],
      // Facets that are not the shape a link emits: a cycle id in no window,
      // a source name given twice, and an empty source name.
      ["unknown cycle", () => renderCycles(healthyScript({ [T.runs]: { data: [...RUNS] } }), { cycle: "no-such-run-id" })],
      ["repeated source", () => renderCycles(healthyScript({ [T.runs]: { data: [...RUNS] } }), { source: ["ticketmaster", "eventbrite"] })],
      ["empty source", () => renderCycles(healthyScript({ [T.runs]: { data: [...RUNS] } }), { source: "" })],
    ];

    for (const [name, render] of states) {
      const $ = cheerio.load(await render());
      for (const hook of Object.values(SURFACE_HOOKS)) {
        expect($(hook).length, `${name}: ${hook}`).toBe(1);
      }
      for (const outer of Object.values(SURFACE_HOOKS)) {
        for (const inner of Object.values(SURFACE_HOOKS)) {
          if (outer === inner) continue;
          expect($(outer).find(inner).length, `${name}: ${outer} inside ${inner}`).toBe(0);
        }
      }
    }
  });
});

/**
 * The prose the page ships, checked against the RENDERED markup rather than
 * the source (campaign admin-window/BUG-0045).
 *
 * The footnote under the runs table reads `<span>source</span> is the run's`
 * in the file — a space is plainly there — and a walker read `sourceis` off
 * the screen. JSX drops a whitespace run that contains a newline, so the file
 * is not evidence and this assertion runs on the markup.
 */
describe("the copy the operator actually reads", () => {
  it("names no factory ticket, with runs present and with none", async () => {
    for (const [state, script] of Object.entries({
      "runs present": healthyScript({ [T.runs]: { data: [...RUNS] } }),
      "no runs": healthyScript(),
      refused: healthyScript({
        [T.runs]: { error: permissionDenied(T.runs) },
      }),
    })) {
      // The guard proves itself before it clears the page.
      expect(factoryTicketIds("<p>the lead section (admin-window/BUG-0040)</p>")).toEqual([
        "admin-window/BUG-0040",
      ]);
      expect(factoryTicketIds(await renderCycles(script)), state).toEqual([]);
    }
  });

  it("puts a space between a mono identifier and the word after it", async () => {
    // Two fixtures, same guard: the run-together spelling the walk read off
    // the screen must trip it, and this page must not.
    expect(runTogetherWords('<span class="type-data">source</span>is the run')).toEqual([
      "</span>is",
    ]);
    const markup = await renderCycles(healthyScript({ [T.runs]: { data: [...RUNS] } }));
    expect(runTogetherWords(markup)).toEqual([]);
  });
  it("writes every inter-element space as an explicit expression, which no transform may drop", () => {
    // The rendered assertions above CANNOT fail on this defect: vitest's JSX
    // transform keeps the space that `next build`'s transform drops (measured
    // on the delivered HTML of :8781, 2026-09-03). The source rule is what
    // actually guards it, so it stands beside them.
    //
    // Two fixtures: the pre-fix spelling of this page must trip the scanner...
    expect(
      implicitInterElementSpacesIn('          <span className=\"type-data text-ink\">source</span> is the run&rsquo;s'),
    ).toEqual(['1: <span className=\"type-data text-ink\">source</span> is the run&rsquo;s']);
    // ...and the page as it stands must be clean of it.
    expect(implicitInterElementSpaces("src/app/cycles/page.tsx")).toEqual([]);
  });
});
