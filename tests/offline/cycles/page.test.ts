import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { CYCLE_COUNTERS, CYCLE_WINDOW, type ResolutionRunRow } from "@/lib/db/cycles";
import { T } from "@/lib/db/tables";
import { CLAMP_LIMIT, ELLIPSIS, EM_DASH, absoluteUtc, duration } from "@/lib/format";
import { RESOLVER_CADENCE_SECONDS } from "@/lib/gauges/gauge";
import { readNumber } from "../../live/parity";
import {
  codeText,
  implicitInterElementSpaces,
  implicitInterElementSpacesIn,
  sourceFiles,
} from "../source-tree";
import { factoryTicketIds, h, render, runTogetherWords } from "../ui/markup";
import { Badge } from "@/components/ui/badge";
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
  daysAgo,
  minutesAgo,
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
  SOURCE as RUN_SOURCE,
  runsFrom,
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
    /** The reading the app arrived at for this row's outcome word, if any. */
    tone: row.find("[data-outcome-tone]").attr("data-outcome-tone"),
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
/**
 * The ONE `data` sub-line of the stat card standing under `label`, read
 * structurally: `ui/StatCard`'s anatomy is the eyebrow, then the figure, then
 * at most one line of sub-detail, so the sub-line is the first following
 * sibling that is not wholly a number. No class name and no copy is addressed.
 */
function cardSubLine(markup: string, label: string): string {
  const $ = cheerio.load(markup);
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const eyebrows = $("span")
    .toArray()
    .filter(
      (element) =>
        $(element).children().length === 0 && flat($(element).text()) === label,
    );
  if (eyebrows.length !== 1) {
    throw new Error(`"${label}" labels ${eyebrows.length} cards in this markup.`);
  }
  const following = $(eyebrows[0])
    .nextAll()
    .toArray()
    .map((element) => flat($(element).text()));
  return following.find((text) => text !== "" && !/^-?[\d,]+$/.test(text)) ?? "";
}

/** The cadence the health card judges against, spelled as the card spells it. */
const CADENCE = duration(RESOLVER_CADENCE_SECONDS);

/**
 * Every number a line of copy COUNTS — the cadence excluded, because it is a
 * rendered duration and not a count of anything.
 *
 * Counts rather than the sentence: what the line must state is which sets it
 * measures over, so the words stay free to change and only the arithmetic is
 * the contract (admin-window/BUG-0110).
 */
function countsIn(text: string): number[] {
  return [...text.split(CADENCE).join(" ").matchAll(/\d[\d,]*/g)].map((match) =>
    Number(match[0].replace(/,/g, "")),
  );
}

/**
 * A cycle with every counter at zero, for the fixtures a test builds itself.
 * Shaped like `./population`'s rows; the run id, the instants and the outcome
 * are what each caller varies.
 */
const BARE_CYCLE: ResolutionRunRow = {
  run_id: "",
  started_at: "",
  ended_at: null,
  outcome: null,
  facts_examined: 0,
  applied: 0,
  held: 0,
  escalated: 0,
  entities_created: 0,
  claims_linked: 0,
  claims_rerejected: 0,
  errors: 0,
  error_summary: null,
};

/**
 * Words that would make a figure's sub-line the app's verdict rather than the
 * operator's — "whether the figure is good news stays the operator's call"
 * (LOOK_AND_FEEL, Zeroes).
 */
const REASSURANCE =
  /\b(all clear|healthy|no problems?|nothing to worry|nothing is wrong|looking good|good news|on track|as expected)\b/i;

/**
 * The first paragraph standing AFTER the named table, in document order — the
 * note a distribution's figures are qualified by. Positional within the page's
 * own reading order rather than addressed by class or by copy.
 */
function noteBelow(markup: string, table: string): string {
  const $ = cheerio.load(markup);
  const all = $("*").toArray();
  const start = all.indexOf($(`table[aria-label="${table}"]`).get(0) as never);
  if (start === -1) throw new Error(`no table labelled "${table}" in this markup.`);
  const note = all.slice(start).find((element) => $(element).is("p"));
  return note === undefined ? "" : $(note).text().replace(/\s+/g, " ").trim();
}

/**
 * The run ids of every rendered cycle whose duration cell holds no duration —
 * the rows the over-cadence figure cannot be computed over, as the TABLE
 * shows them.
 */
function cyclesWithoutDuration(markup: string): string[] {
  const $ = cheerio.load(markup);
  return renderedCycles(markup).filter(
    (runId) =>
      $(`[data-cycle="${runId}"]`).closest("tr").find("[data-cycle-duration]")
        .length === 0,
  );
}

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

  it("names the oldest cycle it holds when the window did not fill", async () => {
    // Bar 13's other half (admin-window/BUG-0109): under its cap, the read
    // returned every cycle it matched, so the last row on screen is the
    // TABLE's own floor and the line says so. The instant is the population's
    // own, rendered the way this app renders one — no copy is pinned.
    const markup = await renderCycles(healthyScript());
    const oldest = [...CYCLES].sort((a, b) =>
      a.started_at < b.started_at ? -1 : 1,
    )[0].started_at;
    const line = cheerio.load(markup)('[data-window="cycles"]');

    expect(line.attr("data-window-held")).toBe(String(CYCLES.length));
    expect(line.text().replace(/\s+/g, " ")).toContain(absoluteUtc(oldest));
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
    const line = cheerio.load(markup)('[data-window="cycles"]');
    expect(line.attr("data-window-truncated")).toBe("true");
    // …and its last row is the CAP's bottom, not the table's, so the line must
    // not offer that row as a floor (admin-window/BUG-0109).
    expect(line.text().replace(/\s+/g, " ")).not.toContain(
      absoluteUtc(capped[capped.length - 1].started_at),
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
      // Canonicalising the facet (admin-window/BUG-0143) left THIS arm exactly
      // where it was: a value with no canonical form keeps the RAW spelling in
      // the page's own sentence, and the page acted on it, so the shared
      // dropped-parameter line has nothing to report. That is where `?cycle=`
      // and `?run=` deliberately part company — converging them is a design
      // question the ticket declined, and this is the pin that catches a
      // silent convergence.
      expect($('[data-cycle-found="false"]').attr("data-cycle-asked"), nonsense).toBe(
        nonsense,
      );
      expect($("[data-dropped-params]").length, nonsense).toBe(0);
    }
  });

  /**
   * Was QA's strict `it.fails` pin, flipped to a plain `it(...)` — assertions
   * unchanged — by admin-window/BUG-0143, which canonicalised `?cycle=`.
   *
   * `?run=` was canonicalised at the edge by admin-window/BUG-0142
   * (`canonicalRecordId`, `src/app/cycles/page.tsx`), because Postgres
   * compares a uuid by VALUE and this page compares it by STRING — so an
   * uppercased or unhyphenated spelling of a real id marks its row. Its twin
   * `?cycle=`, in the same page function two lines above, still went to the
   * row predicate raw. The result was not silence: the page stated, of a
   * cycle whose row it was rendering three elements below, that it is "not
   * among the 200 newest cycles" — a false claim about the very window it had
   * just read (LESSONS 2 and 4, and the class BUG-0140 settled for
   * `/sources`).
   */
  it(
    "marks the cycle a non-canonical spelling of a real id names [admin-window/BUG-0143]",
    async () => {
      for (const spelling of [
        FAILED.run_id.toUpperCase(),
        FAILED.run_id.replace(/-/g, ""),
        FAILED.run_id.replace(/-/g, "").toUpperCase(),
      ]) {
        const markup = await renderCycles(healthyScript(), { cycle: spelling });
        const $ = cheerio.load(markup);
        // The row IS in the window the page just read…
        expect(renderedCycles(markup), spelling).toContain(FAILED.run_id);
        // …so the verdict is `found`, and the row it names carries the mark.
        expect($("[data-cycle-found]").attr("data-cycle-found"), spelling).toBe("true");
        expect(cycleRow(markup, FAILED.run_id).marked, spelling).toBe("true");
        expect(cycleRow(markup, FAILED.run_id).current, spelling).toBe("true");
        // Exactly one row, and one accessible marking, on the whole page.
        expect($("tr[data-row-marked]").length, spelling).toBe(1);
        expect($("[data-cycle][aria-current]").length, spelling).toBe(1);
        // Named in the database's own spelling — the id that reaches the row,
        // and the id the in-page link lands on — never the paste's spelling.
        expect($("[data-cycle-asked]").attr("data-cycle-asked"), spelling).toBe(
          FAILED.run_id,
        );
        expect($("[data-cycle-asked]").text(), spelling).toContain(FAILED.run_id);
        expect(markup, spelling).not.toContain(spelling);
        expect($('[data-cycle-found="true"] a').attr("href"), spelling).toBe(
          `#${cycleRow(markup, FAILED.run_id).anchor}`,
        );
        // A facet the page APPLIED is not one it dropped.
        expect($("[data-dropped-params]").length, spelling).toBe(0);
      }
    },
  );

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

/* ── green is for a cycle with nothing left to answer for ────────────────── */

/**
 * The row the walk measured and the shared fixture cannot express: the
 * producer wrote `succeeded`, and the row's OWN errors column says 108
 * (campaign admin-window/BUG-0106).
 *
 * It is `SUCCEEDED` with a second identity and an error count, so the pair
 * below differs in the ONE fact under test — an assertion over a row built
 * from scratch would also pass if `succeeded` had simply stopped being green.
 */
const ERRORED: ResolutionRunRow = {
  ...SUCCEEDED,
  run_id: "0192f0c1-0000-7000-8000-0000000000e1",
  errors: 108,
  error_summary: 'column "venue" of relation "events" does not exist',
};

/** The whole population plus that row, in both reads of `resolution_runs`. */
function withErroredSuccess(): Script {
  const population = [...CYCLES, ERRORED];
  return healthyScript({
    [T.resolutionRuns]: [{ data: population }, { data: population }],
  });
}

/** The error count the row itself shows, read out of its own errors cell. */
function errorsShown(row: { counts: Record<string, string> }): number {
  return Number((row.counts.errors ?? "").replace(/[^0-9-]/g, ""));
}

/**
 * LOOK_AND_FEEL, Palette: **healthy is green only when nothing needs a human**
 * — an outcome whose own row carries a non-zero error count renders in
 * attention amber, whatever word its producer wrote, and the word itself stays
 * verbatim.
 *
 * admin-window/BUG-0106 measured seventeen `/cycles` rows saying `succeeded`
 * in `--color-healthy` with 108 errors in the same row, two cells left of the
 * failure they had recorded verbatim. What is asserted here is the TONE the
 * row earned, published on `data-outcome-tone` — never a class name and never
 * a colour value, which belong to the palette and the walk.
 */
describe("the tone a cycle's outcome earns", () => {
  it("does not paint a succeeded cycle green when its own row reports errors [admin-window/BUG-0106]", async () => {
    const markup = await renderCycles(withErroredSuccess());

    const errored = cycleRow(markup, ERRORED.run_id);
    const clean = cycleRow(markup, SUCCEEDED.run_id);

    // The two rows really are the pair this claims: same word, and the error
    // count is the difference between them.
    expect(errored.outcome).toBe(clean.outcome);
    expect(errorsShown(errored)).toBeGreaterThan(0);
    expect(errorsShown(clean)).toBe(0);

    expect(errored.tone).toBe("attention");
    expect(clean.tone).toBe("healthy");
  });

  it("leaves the word itself untouched — only the colour is the app's reading", async () => {
    const markup = await renderCycles(withErroredSuccess());

    const errored = cycleRow(markup, ERRORED.run_id);
    const clean = cycleRow(markup, SUCCEEDED.run_id);

    // The producer's word, verbatim, and the same word the clean row shows:
    // the outcome cell of the two rows reads identically.
    expect(errored.cells[2]).toBe(ERRORED.outcome);
    expect(errored.cells[2]).toBe(clean.cells[2]);
    // …and the row still states its failure verbatim beside it.
    expect(errored.error).toBe(ERRORED.error_summary);
  });

  it("keeps a failed cycle broken, and a state that is not an outcome unchanged", async () => {
    const markup = await renderCycles(withErroredSuccess());

    // `failed` carries errors too; red already says a human is needed, and
    // amber would be a quieter reading of a louder fact.
    expect(errorsShown(cycleRow(markup, FAILED.run_id))).toBeGreaterThan(0);
    expect(cycleRow(markup, FAILED.run_id).tone).toBe("broken");
    // A clean outcome with no health reading is still uncoloured.
    expect(cycleRow(markup, SKIPPED.run_id).tone).toBe("neutral");
    // The three states that are not an outcome read exactly as before: no
    // outcome word, so no tone for one.
    for (const row of [RUNNING, DIED, UNRECORDED]) {
      const rendered = cycleRow(markup, row.run_id);
      expect(rendered.tone, row.run_id).toBeUndefined();
      expect(rendered.outcome, row.run_id).toBeUndefined();
    }
    expect(cycleRow(markup, DIED.run_id).state).toBe("died");
  });

  it("leaves no row on the page showing errors and a healthy word", async () => {
    const markup = await renderCycles(withErroredSuccess());

    // The walkable form of the bar, over every row the page rendered: read
    // each row's own errors cell and its own tone, and let no row hold both a
    // count and the green.
    const ids = renderedCycles(markup);
    expect(ids.length).toBe(CYCLES.length + 1);

    const green: string[] = [];
    let errored = 0;
    for (const id of ids) {
      const row = cycleRow(markup, id);
      // Every row carrying an outcome word states the reading it earned, so a
      // page that published no reading at all cannot pass this vacuously.
      if (row.state === "outcome") expect(row.tone, id).toBeDefined();
      if (errorsShown(row) <= 0) continue;
      errored += 1;
      if (row.tone === "healthy") green.push(id);
    }
    // The population really did put errored rows on screen, so the emptiness
    // below is a finding and not an empty loop.
    expect(errored).toBeGreaterThan(1);
    expect(green).toEqual([]);
  });

  /**
   * **The boundary is ONE error, not many** (QA of admin-window/BUG-0106).
   *
   * The bug was measured on rows carrying 108, and every assertion written for
   * it uses that count — so an implementation that woke at `errors > 1` rather
   * than `errors > 0` would pass all of them, and would leave green exactly
   * the two rows the ticket's own table lists at **1 error** ("2 | succeeded |
   * 1 | --color-healthy"). The palette bar's word is *non-zero*, and one is
   * non-zero: a single failure is still something left to answer for.
   */
  it("reads a single error as an error, not as a rounding of zero [admin-window/BUG-0106]", async () => {
    const ONE: ResolutionRunRow = {
      ...SUCCEEDED,
      run_id: "0192f0c1-0000-7000-8000-0000000000e2",
      errors: 1,
      error_summary: 'column "venue" of relation "events" does not exist',
    };
    const population = [...CYCLES, ONE];
    const markup = await renderCycles(
      healthyScript({ [T.resolutionRuns]: [{ data: population }, { data: population }] }),
    );

    const row = cycleRow(markup, ONE.run_id);
    // The row really is the pair's errored half: same word, one error.
    expect(row.outcome).toBe(SUCCEEDED.outcome);
    expect(errorsShown(row)).toBe(1);
    expect(row.tone).toBe("attention");
    // …and the clean row of the same word is still green, so this cannot pass
    // by `succeeded` having simply stopped being healthy.
    expect(cycleRow(markup, SUCCEEDED.run_id).tone).toBe("healthy");
  });

  /**
   * **Whatever word its producer wrote** (QA of admin-window/BUG-0106).
   *
   * The palette bar colours an errored outcome amber without asking which word
   * it is, and the builder's implementation follows it for a NEUTRAL word too
   * — a `skipped` row that reports errors reads attention rather than staying
   * uncoloured. Nothing on staging exercises that today (measured 2026-09-09:
   * the one `skipped` cycle in the 200-row window carries `errors = 0`), so it
   * is pinned here: the rule is the count's, not a special case for the single
   * word the bug happened to be filed about.
   */
  it("gives a neutral word with errors the same amber a succeeded one gets [admin-window/BUG-0106]", async () => {
    const SKIPPED_WITH_ERRORS: ResolutionRunRow = {
      ...SKIPPED,
      run_id: "0192f0c1-0000-7000-8000-0000000000e3",
      errors: 3,
      error_summary: "three facts were skipped and nothing repaired them",
    };
    const population = [...CYCLES, SKIPPED_WITH_ERRORS];
    const markup = await renderCycles(
      healthyScript({ [T.resolutionRuns]: [{ data: population }, { data: population }] }),
    );

    const errored = cycleRow(markup, SKIPPED_WITH_ERRORS.run_id);
    const clean = cycleRow(markup, SKIPPED.run_id);
    // The producer's word is untouched on both, and only the count differs.
    expect(errored.outcome).toBe(clean.outcome);
    expect(errorsShown(errored)).toBe(3);
    expect(errorsShown(clean)).toBe(0);

    expect(errored.tone).toBe("attention");
    expect(clean.tone).toBe("neutral");
  });

  /**
   * **No new colour enters the palette** (criterion 6 of admin-window/BUG-0106).
   *
   * The amber an errored outcome earns is the ink the app already gives its
   * high-severity badge — the same primitive, drawn the same way — and the
   * clean row keeps the ink the app already gives a healthy one. Each side is
   * compared against ANOTHER RENDERING of the app's own primitive, never
   * against a class literal or a colour value: restyling the palette moves
   * both sides of every equality below together, so a design change cannot
   * redden this, while a hand-rolled second amber would.
   */
  it("draws an errored outcome with ink the palette already carries [admin-window/BUG-0106]", async () => {
    const markup = await renderCycles(withErroredSuccess());
    const $ = cheerio.load(markup);
    const badgeOf = (runId: string) =>
      $(`[data-cycle="${runId}"]`).closest("tr").find("[data-outcome-tone] span").attr("class");
    const primitive = (tone: "high" | "healthy") =>
      cheerio.load(render(h(Badge, { tone, children: "succeeded" })))("span").first().attr("class");

    expect(badgeOf(ERRORED.run_id)).toBe(primitive("high"));
    expect(badgeOf(SUCCEEDED.run_id)).toBe(primitive("healthy"));
    // The two really are different renderings, so the equalities above are not
    // both satisfied by one undifferentiated badge.
    expect(badgeOf(ERRORED.run_id)).not.toBe(badgeOf(SUCCEEDED.run_id));
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

  /*
   * admin-window/BUG-0110. "0 ran longer than the 15m cadence" stood bare on
   * the card beside four cycles that never finished — a zero computed over 65
   * of 69 rows, reading as "nothing ran long" (LOOK_AND_FEEL, Zeroes).
   *
   * Both fixtures below hold cycles that all ran WELL under the cadence, so
   * the over-cadence figure is a real 0 either way and only the excluded set
   * differs. Every expectation is the fixture's own arithmetic; the copy is
   * never pinned.
   */

  /** A cycle that started `minutes` ago and finished `seconds` later. */
  function ranFor(suffix: string, minutes: number, seconds: number): ResolutionRunRow {
    const started = minutesAgo(minutes);
    return {
      ...BARE_CYCLE,
      run_id: `0192f0c1-0000-7000-8000-1000000000${suffix}`,
      started_at: started,
      ended_at: new Date(Date.parse(started) + seconds * 1000).toISOString(),
      outcome: "succeeded",
    };
  }

  /**
   * A cycle that recorded no end, older than a cadence — a row the page's own
   * outcome panel calls dead, used where a test needs the excluded set to be
   * unambiguous.
   */
  function recordedNoEnd(suffix: string, days: number): ResolutionRunRow {
    return {
      ...BARE_CYCLE,
      run_id: `0192f0c1-0000-7000-8000-2000000000${suffix}`,
      started_at: daysAgo(days),
      ended_at: null,
      outcome: null,
    };
  }

  const scriptOf = (rows: ResolutionRunRow[]) =>
    healthyScript({ [T.resolutionRuns]: [{ data: rows }, { data: rows }] });

  const FINISHED = [ranFor("01", 5, 45), ranFor("02", 20, 60), ranFor("03", 35, 120)];
  const NO_END = [recordedNoEnd("01", 3), recordedNoEnd("02", 4)];

  it("states what the over-cadence zero counts, and how many cycles it leaves out", async () => {
    const rows = [...FINISHED, ...NO_END];
    const markup = await renderCycles(scriptOf(rows));

    // The figure is untouched: the card still counts the whole window.
    expect(readNumber(markup, "Cycles in this window")).toBe(rows.length);

    // The zero beside it names both sets it was computed over: none of the
    // three that finished ran long, and two recorded no end at all.
    expect(countsIn(cardSubLine(markup, "Cycles in this window"))).toEqual([
      0,
      FINISHED.length,
      NO_END.length,
    ]);
  });

  it("counts the cycles it excludes as one number, wherever the page states it", async () => {
    const markup = await renderCycles(scriptOf([...FINISHED, ...NO_END]));
    const excluded = countsIn(cardSubLine(markup, "Cycles in this window"))[2];

    // The rows themselves: a cycle with no end renders no duration, and there
    // are exactly as many of those as the line says it left out.
    expect(cyclesWithoutDuration(markup)).toHaveLength(excluded);
    // ...and the note under the duration percentiles, which qualifies the same
    // figures from the same field, states that one number and no other. One
    // read, one count of one set: the page cannot report it twice and disagree
    // with itself. It is NOT required to equal the outcome panel's dead, which
    // is a subset of it — that demand was retired with admin-window/BUG-0116.
    expect(countsIn(noteBelow(markup, DURATIONS))).toEqual([excluded]);
  });

  it("leaves the zero bare when every cycle in the window finished", async () => {
    const markup = await renderCycles(scriptOf(FINISHED));
    // Nothing is excluded, so there is no excluded set to name: the line
    // states the one figure and adds no clause that says nothing.
    expect(cyclesWithoutDuration(markup)).toEqual([]);
    expect(countsIn(cardSubLine(markup, "Cycles in this window"))).toEqual([0]);
  });

  it("does not tell the operator whether the zero is good news", async () => {
    // The guard proves it discriminates before it clears the page: the
    // reassuring sentence the bar was written against must trip it.
    expect(REASSURANCE.test("0 ran longer than the 15m cadence — all clear")).toBe(true);
    for (const [state, rows] of [
      ["with cycles that recorded no end", [...FINISHED, ...NO_END]],
      ["with none", FINISHED],
    ] as const) {
      const sub = cardSubLine(await renderCycles(scriptOf([...rows])), "Cycles in this window");
      expect(REASSURANCE.test(sub), `${state}: ${sub}`).toBe(false);
    }
  });

  /*
   * admin-window/BUG-0116. The clause admin-window/BUG-0110 added is built
   * from `duration.unmeasurable` — EVERY row the over-cadence figure could
   * not be computed over — and says of all of them that they never finished.
   * That set is wider than the dead. A cycle is inserted at start and its end
   * is written at completion (scraper migration `20260901000001`: `ended_at`
   * is "null while the cycle is still running"), so a cycle in flight right
   * now is in the excluded set too, and the page's own outcome panel counts
   * it on the same screen under the word the app pins for that state. One row,
   * two states, two surfaces — the property admin-window/BUG-0055 pinned from
   * the rows' side.
   *
   * What is guarded is a CLASS of claim, never a spelling: the line may say
   * the figure leaves rows out, and how many, and it may call them unfinished.
   * It may not say they never finish while the page itself is saying one of
   * them is still going.
   *
   * Was a strict `it.fails` pin (QA, commit 4242769). Fixed by naming the
   * excluded set by what is true of every row in it — it recorded no end, the
   * duration note's own words — and passing no verdict on what became of them
   * (the architect's ruling of 2026-09-09: classifying a cycle by STATE is
   * `STATE_WORD`'s job and the outcome panel's surface). It is a plain `it`
   * now and reddens if a death verdict ever returns to this card.
   */
  const NEVER_ENDS =
    /\bnever\b[^.;]*\b(finish|finishes|finished|complete|completes|completed|end|ends|ended)\b/i;

  /** A cycle with no end, younger than one cadence: still in flight. */
  function stillRunning(suffix: string): ResolutionRunRow {
    return {
      ...BARE_CYCLE,
      run_id: `0192f0c1-0000-7000-8000-3000000000${suffix}`,
      started_at: minutesAgo(2),
      ended_at: null,
      outcome: null,
    };
  }

  const RUNNING_NOW = stillRunning("01");

  it("guards the claim a cycle never ends, in any spelling, and nothing weaker", () => {
    // What the bar forbids...
    expect(NEVER_ENDS.test("0 of 3 finished cycles ran long; 1 never finished")).toBe(true);
    expect(NEVER_ENDS.test("0 of 3 finished cycles ran long; 1 never completed")).toBe(true);
    expect(NEVER_ENDS.test("0 of 3 finished cycles ran long; 1 never ends")).toBe(true);
    // ...and what it must leave alone: naming the excluded set without
    // pronouncing it dead, and the bare line of an empty excluded set.
    expect(NEVER_ENDS.test("0 of 3 finished cycles ran long; 1 recorded no end")).toBe(false);
    expect(NEVER_ENDS.test("0 of 3 finished cycles ran long; 1 has not finished")).toBe(false);
    expect(NEVER_ENDS.test("0 of 3 finished cycles ran long; 1 died")).toBe(false);
    expect(NEVER_ENDS.test("0 ran longer than the 15m cadence")).toBe(false);
  });

  it("excludes the cycle that is still in flight, and counts it once", async () => {
    const markup = await renderCycles(scriptOf([...FINISHED, RUNNING_NOW]));

    // The setup this fixture asserts about, established from the page's own
    // surfaces: the running cycle renders no duration, so it is exactly the
    // one row the over-cadence figure leaves out...
    expect(cyclesWithoutDuration(markup)).toEqual([RUNNING_NOW.run_id]);
    expect(countsIn(cardSubLine(markup, "Cycles in this window"))).toEqual([
      0,
      FINISHED.length,
      1,
    ]);
    // ...and nothing on this page died. The word comes from the row and is
    // looked up in the panel, so no literal state word is pinned here.
    const outcomes = new Map(
      tableRows(markup, OUTCOMES).map((cells) => [cells[0], cells[1]]),
    );
    expect(outcomes.get(cycleRow(markup, RUNNING_NOW.run_id).cells[2])).toBe("1");
  });

  it("counts its whole excluded set on a mixed window, not the dead within it (admin-window/BUG-0110)", async () => {
    // The seam the architect's ruling of 2026-09-09 turns on: the excluded set
    // is every row with no measured duration, which on a mixed window is a
    // STRICT SUPERSET of the dead — one in flight, one dead. The card states
    // that set once, as the same number the duration note states, and does not
    // report the dead count in its place (which would leave the in-flight row
    // silently dropped from a figure that claims to name what it excludes).
    const markup = await renderCycles(scriptOf([...FINISHED, RUNNING_NOW, NO_END[0]]));
    const excluded = countsIn(cardSubLine(markup, "Cycles in this window"))[2];

    // The rows agree: exactly that many render no duration at all.
    expect(cyclesWithoutDuration(markup)).toHaveLength(excluded);
    // One field, two surfaces, one number (amended criterion 4).
    expect(countsIn(noteBelow(markup, DURATIONS))).toEqual([excluded]);

    // ...and the outcome panel splits that same set across the states the page
    // classifies rows by. Each word comes from the ROW, looked up in the panel,
    // so no state literal is pinned here.
    const outcomes = new Map(
      tableRows(markup, OUTCOMES).map((cells) => [cells[0], cells[1]]),
    );
    const dead = Number(outcomes.get(cycleRow(markup, NO_END[0].run_id).cells[2]));
    const inFlight = Number(outcomes.get(cycleRow(markup, RUNNING_NOW.run_id).cells[2]));
    expect(dead + inFlight).toBe(excluded);
    // The card's count is the superset's, never the dead's: a line reporting
    // the dead here would drop the in-flight row from what it claims to name.
    expect(excluded).toBeGreaterThan(dead);
  });

  it("does not pronounce a cycle it is rendering as in-flight one that never finished (admin-window/BUG-0116)", async () => {
    const sub = cardSubLine(
      await renderCycles(scriptOf([...FINISHED, RUNNING_NOW])),
      "Cycles in this window",
    );
    expect(NEVER_ENDS.test(sub), sub).toBe(false);
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

/* ── the run a Dashboard link asked for (admin-window/BUG-0142) ──────────── */

/**
 * The Dashboard's run rows link to `/cycles?run=<run_id>`, and until
 * admin-window/BUG-0142 this page consumed that parameter in SILENCE: the id
 * appeared nowhere in the rendered text, `data-row-marked` occurred zero times,
 * and all five runs rendered alike — while `?cycle=` on the very same page had
 * marked its row and named it since admin-window/BUG-0054 (walked 2026-09-09).
 *
 * What is pinned below is BOTH directions, because a mark and a sentence are
 * each other's evidence (LOOK_AND_FEEL bar 13, "no screen claims a mark it did
 * not draw"): the run that is here is marked once and named once, and the run
 * that is not here is named as absent with nothing marked. The runs half's own
 * rendering — its nine columns, its four states — stays the property of
 * `tests/offline/runs/`; what these assert is this page's answer to its URL.
 */
describe("a ?run= link arriving from the Dashboard", () => {
  const RUNS_TABLE = "Adapter runs";

  /** A database holding the whole run population beside the cycles. */
  const withRuns = (overrides: Script = {}) =>
    healthyScript({ [T.runs]: { data: [...RUNS] }, ...overrides });

  /** Every marked row on the page, as the `aria-label` of the table holding it. */
  function markedRowTables(markup: string): string[] {
    const $ = cheerio.load(markup);
    return $("tr[data-row-marked]")
      .toArray()
      .map((element) => $(element).closest("table").attr("aria-label") ?? "");
  }

  /** The runs the window rendered, in rendered order. */
  function renderedRuns(markup: string): string[] {
    const $ = cheerio.load(markup);
    return $("[data-run]")
      .toArray()
      .map((element) => $(element).attr("data-run") ?? "");
  }

  /** One run row's marking, read the way the cycles half's is. */
  function runRow(markup: string, runId: string) {
    const $ = cheerio.load(markup);
    const marker = $(`[data-run="${runId}"]`);
    return {
      marked: marker.closest("tr").attr("data-row-marked"),
      current: marker.attr("aria-current"),
      anchor: marker.attr("id"),
      rendering: marker.closest("tr").attr("class"),
    };
  }

  /** The names the dropped-parameter line spelled, in the order it spelled them. */
  function droppedNames(markup: string): string[] {
    const $ = cheerio.load(markup);
    return $("[data-dropped-param]")
      .toArray()
      .map((element) => $(element).attr("data-dropped-param") ?? "");
  }

  it("marks the run the link named, and links its id to that very row", async () => {
    const markup = await renderCycles(withRuns(), { run: RUN_FAILED.run_id });
    const $ = cheerio.load(markup);

    // The sentence names the run the URL asked for…
    expect($('[data-run-found="true"]').attr("data-run-asked")).toBe(RUN_FAILED.run_id);
    expect($("[data-run-asked]").text()).toContain(RUN_FAILED.run_id);
    // …and the id it names is a link into the page, landing on the row itself.
    expect($('[data-run-found="true"] a').attr("href")).toBe(
      `#${runRow(markup, RUN_FAILED.run_id).anchor}`,
    );

    // Exactly one row on the whole page is marked, it is in the ADAPTER RUNS
    // table, and it is that run's row — never the lead's repeat of the newest.
    expect(markedRowTables(markup)).toEqual([RUNS_TABLE]);
    expect(runRow(markup, RUN_FAILED.run_id).marked).toBe("true");
    // The accessible marking lands on the same row and no other.
    expect($("[data-run][aria-current]").length).toBe(1);
    expect(runRow(markup, RUN_FAILED.run_id).current).toBe("true");

    // It LOOKS different from every other row without hovering, and the other
    // rows still look alike — the mark is drawn, not only announced.
    const renderings = rowRenderings(markup, RUNS_TABLE);
    expect(renderings.length).toBe(RUNS.length);
    const mine = runRow(markup, RUN_FAILED.run_id).rendering;
    expect(renderings.filter((rendering) => rendering === mine)).toHaveLength(1);
    expect(new Set(renderings.filter((rendering) => rendering !== mine)).size).toBe(1);

    // The facet narrows NOTHING: the same runs, in the same order, and the
    // cycles half is the same cycles it renders with no facet at all.
    const plain = await renderCycles(withRuns());
    expect(renderedRuns(markup)).toEqual(renderedRuns(plain));
    expect(renderedCycles(markup)).toEqual(renderedCycles(plain));
    // A parameter the page acted on is not a parameter it dropped.
    expect(droppedNames(markup)).toEqual([]);
  });

  it("matches the id in any spelling the database would have matched", async () => {
    // Postgres compares a uuid by VALUE and this page compares it by STRING,
    // so the value is canonicalised where it is derived from the request. An
    // uppercased or unhyphenated paste of a real run id is the same run
    // (admin-window/BUG-0140's class; LESSONS 4).
    const canonical = RUN_FAILED.run_id;
    for (const spelling of [
      canonical.toUpperCase(),
      canonical.replace(/-/g, ""),
      canonical.replace(/-/g, "").toUpperCase(),
    ]) {
      const markup = await renderCycles(withRuns(), { run: spelling });
      expect(markedRowTables(markup), spelling).toEqual([RUNS_TABLE]);
      expect(runRow(markup, canonical).marked, spelling).toBe("true");
      // Named in the database's own spelling — the id that reaches the row.
      expect($runAsked(markup), spelling).toBe(canonical);
    }
  });

  it("says a run id no row in the window holds is not here, and marks nothing", async () => {
    // Well formed, and no run carries it: the window IS the evidence, so the
    // negative verdict is earned (unlike the read that returned none, below).
    const absent = "0192f0c2-0000-7000-8000-0000000000ff";
    const markup = await renderCycles(withRuns(), { run: absent });
    const $ = cheerio.load(markup);

    expect($('[data-run-found="false"]').attr("data-run-asked")).toBe(absent);
    // The id is named verbatim, so the operator sees which run was meant.
    expect($("[data-run-asked]").text()).toContain(absent);
    // Said ONCE: one sentence about this run, not one per state.
    expect($("[data-run-asked]").length).toBe(1);
    expect(markedRowTables(markup)).toEqual([]);
    expect($("[data-run][aria-current]").length).toBe(0);
    // And the window is the window it always was.
    expect(renderedRuns(markup)).toEqual(RUNS_NEWEST_FIRST.map((row) => row.run_id));
    expect(droppedNames(markup)).toEqual([]);
  });

  it("says which window it looked in when a source facet narrowed the runs", async () => {
    // The runs read is narrowed by `?source=`, so "not in this window" is a
    // claim about ONE source's runs — and a run of another source, which this
    // page renders without the facet, is a third possibility the line must not
    // swallow (LESSONS 2: a sentence claims only the scope its read had).
    // The read the page makes is narrowed at the database, so the script hands
    // back exactly the rows that query would return.
    const markup = await renderCycles(
      withRuns({ [T.runs]: { data: runsFrom(RUN_SOURCE.bandsintown) } }),
      {
        source: RUN_SOURCE.bandsintown,
        run: RUNS_NEWEST_FIRST.find((row) => row.source === RUN_SOURCE.ticketmaster)!
          .run_id,
      },
    );
    const $ = cheerio.load(markup);
    const line = $('[data-run-found="false"]');
    expect(line.length).toBe(1);
    // The scope the read really had is named in the same sentence…
    expect(line.text()).toContain(RUN_SOURCE.bandsintown);
    // …and the window below holds exactly that source's runs, unmarked.
    expect(renderedRuns(markup)).toEqual(
      RUNS_NEWEST_FIRST.filter((row) => row.source === RUN_SOURCE.bandsintown).map(
        (row) => row.run_id,
      ),
    );
    expect(markedRowTables(markup)).toEqual([]);
  });

  it("marks the run that is in a narrowed window, and says so", async () => {
    const run = RUNS_NEWEST_FIRST.find(
      (row) => row.source === RUN_SOURCE.bandsintown,
    )!;
    const markup = await renderCycles(
      withRuns({ [T.runs]: { data: runsFrom(RUN_SOURCE.bandsintown) } }),
      { source: RUN_SOURCE.bandsintown, run: run.run_id },
    );
    expect(cheerio.load(markup)('[data-run-found="true"]').attr("data-run-asked")).toBe(
      run.run_id,
    );
    expect(markedRowTables(markup)).toEqual([RUNS_TABLE]);
    expect(runRow(markup, run.run_id).marked).toBe("true");
  });

  it("holds the verdict back when the read returned no window to look in", async () => {
    // A refused or absent read hands this page NO window, so "that run is not
    // here" is a verdict it has no evidence for — the third state, and not a
    // shade of absent (admin-window/BUG-0023, applied to the other half).
    for (const [state, script] of Object.entries({
      not_provisioned: withRuns({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } }),
      refused: withRuns({ [T.runs]: { error: permissionDenied(T.runs) } }),
      transport: withRuns({ [T.runs]: { error: transportFailure() } }),
    })) {
      const markup = await renderCycles(script, { run: RUN_FAILED.run_id });
      const $ = cheerio.load(markup);
      expect($("[data-run-unchecked]").attr("data-run-asked"), state).toBe(
        RUN_FAILED.run_id,
      );
      // It names the object whose read returned none, in that read's own
      // spelling, so the operator is sent to the failure and not to a phantom.
      expect($("[data-run-unchecked]").attr("data-run-unchecked"), state).toBe(T.runs);
      expect($("[data-run-found]").length, state).toBe(0);
      expect(markedRowTables(markup), state).toEqual([]);
      // The cycles half is untouched by any of it.
      expect(renderedCycles(markup), state).toEqual(
        NEWEST_FIRST.map((row) => row.run_id),
      );
    }
  });

  it("names a ?run= that is not a run id as a parameter it did not apply", async () => {
    // The shared owner's sentence, the one `/claims` and `/queues` render
    // (admin-window/BUG-0141): a value that can match no row narrows nothing,
    // and a page that drops a parameter says so. The NAME is spelled; the
    // value never is.
    for (const nonsense of [
      "not-a-uuid",
      "../../etc/passwd",
      "%%%",
      "<script>alert(1)</script>",
    ]) {
      const markup = await renderCycles(withRuns(), { run: nonsense });
      const $ = cheerio.load(markup);
      expect(droppedNames(markup), nonsense).toEqual(["run"]);
      expect($("[data-dropped-params]").attr("data-dropped-params"), nonsense).toBe("1");
      // No verdict about a run, because no run was asked for that could exist.
      expect($("[data-run-asked]").length, nonsense).toBe(0);
      expect(markedRowTables(markup), nonsense).toEqual([]);
      expect($("[data-run][aria-current]").length, nonsense).toBe(0);
      // Nothing is narrowed, and the URL's value reaches the page as neither
      // text nor markup.
      expect(renderedRuns(markup), nonsense).toEqual(
        RUNS_NEWEST_FIRST.map((row) => row.run_id),
      );
      expect(markup, nonsense).not.toContain(nonsense);
      expect($("script").length, nonsense).toBe(0);
    }
  });

  it("takes the first value when the URL names the run twice", async () => {
    const markup = await renderCycles(withRuns(), {
      run: [RUN_FAILED.run_id, RUNS_NEWEST_FIRST[0].run_id],
    });
    expect($runAsked(markup)).toBe(RUN_FAILED.run_id);
    expect(markedRowTables(markup)).toEqual([RUNS_TABLE]);
    expect(runRow(markup, RUN_FAILED.run_id).marked).toBe("true");
    expect(runRow(markup, RUNS_NEWEST_FIRST[0].run_id).marked).toBeUndefined();
  });

  it("marks the newest run without marking the lead that repeats it", async () => {
    // The lead is the window's first row shown again above the fold
    // (admin-window/BUG-0040). Marking it too would draw two marks for one
    // run, and giving it the row's anchor would put two elements on one id —
    // where `#` reaches whichever the browser met first.
    const newest = RUNS_NEWEST_FIRST[0].run_id;
    const markup = await renderCycles(withRuns(), { run: newest });
    const $ = cheerio.load(markup);
    expect(markedRowTables(markup)).toEqual([RUNS_TABLE]);
    expect(leadRun(markup).runId).toBe(newest);
    expect($("[data-latest-run]").closest("tr").attr("data-row-marked")).toBeUndefined();
    expect($("[data-latest-run]").attr("aria-current")).toBeUndefined();

    // Every id in the document is unique, so the sentence's link is unambiguous.
    const ids = $("[id]")
      .toArray()
      .map((element) => $(element).attr("id") ?? "");
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks nothing, and says nothing about a run, with no ?run= at all", async () => {
    const markup = await renderCycles(withRuns());
    const $ = cheerio.load(markup);
    expect($("[data-run-asked]").length).toBe(0);
    expect($("tr[data-row-marked]").length).toBe(0);
    expect($("[data-run][aria-current]").length).toBe(0);
    expect($("[data-dropped-params]").length).toBe(0);
    // Every run row still carries the anchor a link would land on.
    for (const run of RUNS) {
      expect(runRow(markup, run.run_id).anchor, run.run_id).toBeTruthy();
    }
  });

  it("keeps the two halves' anchors apart when one id names a cycle AND a run", async () => {
    // `resolution_runs.run_id` and `runs.run_id` are two producers' keys over
    // two tables and could perfectly well hold the same value; `links.ts`
    // spells the two anchors separately (`cycle-<id>` / `run-<id>`) so that
    // `#` cannot reach the wrong half. Nothing pinned that, so the seam is
    // pinned here: one id, both facets, two marks that stay in their own
    // tables and two links that each land on their own row.
    const shared = FAILED.run_id;
    const runs = [
      { ...RUN_FAILED, run_id: shared },
      ...RUNS.filter((row) => row.run_id !== RUN_FAILED.run_id),
    ];
    const markup = await renderCycles(withRuns({ [T.runs]: { data: runs } }), {
      cycle: shared,
      run: shared,
    });
    const $ = cheerio.load(markup);

    // One mark per half, each in its own table.
    expect(markedRowTables(markup).sort()).toEqual([CYCLES_TABLE, RUNS_TABLE].sort());
    expect(cycleRow(markup, shared).marked).toBe("true");
    expect(runRow(markup, shared).marked).toBe("true");
    // One accessible marking per half, and neither reaches the other's rows.
    expect($(`[data-cycle="${shared}"][aria-current]`).length).toBe(1);
    expect($(`[data-run="${shared}"][aria-current]`).length).toBe(1);

    // Two distinct anchors, and every id in the document still unique — so
    // each sentence's link reaches the row that sentence names.
    const cycleAnchor = cycleRow(markup, shared).anchor;
    const runAnchor = runRow(markup, shared).anchor;
    expect(cycleAnchor).toBeTruthy();
    expect(runAnchor).toBeTruthy();
    expect(cycleAnchor).not.toBe(runAnchor);
    expect($('[data-cycle-found="true"] a').attr("href")).toBe(`#${cycleAnchor}`);
    expect($('[data-run-found="true"] a').attr("href")).toBe(`#${runAnchor}`);
    const ids = $("[id]").toArray().map((element) => $(element).attr("id") ?? "");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("answers the two facets independently when the URL carries both", async () => {
    // `?cycle=` marks a cycle and `?run=` marks a run: two halves, two
    // sentences, two marks — and neither is the other's.
    const markup = await renderCycles(withRuns(), {
      cycle: FAILED.run_id,
      run: RUN_FAILED.run_id,
    });
    expect(markedRowTables(markup).sort()).toEqual([RUNS_TABLE, CYCLES_TABLE].sort());
    expect(cycleRow(markup, FAILED.run_id).marked).toBe("true");
    expect(runRow(markup, RUN_FAILED.run_id).marked).toBe("true");
    expect(droppedNames(markup)).toEqual([]);
  });
});

/** The run id the page says it was asked for, wherever it landed. */
function $runAsked(markup: string): string | undefined {
  return cheerio.load(markup)("[data-run-asked]").attr("data-run-asked");
}

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

/* ── where this page's presentation lives (admin-window/DEBT-0004) ───────── */

/**
 * The structural half of ARCHITECTURE.md §13.6, asserted here rather than left
 * to the next builder's discipline: this page ships its own
 * `src/components/cycles/` module, the page file defines no component of its
 * own, and nothing in that module can reach a database.
 *
 * It was 1,291 lines with eight components written where the page function is
 * (common violation 10). The rules below are what stop the eighth from coming
 * back, and each is stated with BOTH fixtures — the input it must flag and the
 * input it must not.
 */
describe("the module this page's presentation lives in", () => {
  const PAGE = "src/app/cycles/page.tsx";
  const MODULE = "src/components/cycles/";

  /** A component DEFINITION at the top level of a file, in either spelling. */
  const COMPONENT = /^(export\s+)?(default\s+)?function\s+[A-Z]/m;

  /** Anything below the page that awaits — §5's one-async-boundary rule. */
  const AWAITS = /\basync\b|\bawait\b/;

  it("contains the page and the module these rules are about", () => {
    const files = sourceFiles();
    expect(files).toContain(PAGE);
    expect(files).toContain("src/components/cycles/index.ts");
    expect(files.filter((file) => file.startsWith(MODULE)).length).toBeGreaterThan(1);
  });

  it("keeps every component out of the page file", () => {
    // The scanner must see a component where there is one...
    expect(COMPONENT.test("function AdapterRuns({ runs }: Props) {")).toBe(true);
    expect(COMPONENT.test("export function LatestRun() {")).toBe(true);
    // ...and the page, which defines only its async page function, is clean.
    expect(COMPONENT.test(codeText(PAGE))).toBe(false);
  });

  it("keeps the components off lib/db and off the client library", () => {
    // Rule 1: a component takes plain props and returns markup, which is what
    // lets every surface below the page be rendered with no database at all.
    const files = sourceFiles().filter((file) => file.startsWith(MODULE));
    for (const file of files) {
      const text = codeText(file);
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/db\//);
      expect(text, file).not.toContain("@supabase/supabase-js");
      expect(text, file).not.toMatch(AWAITS);
    }
    // The same scanners on inputs they MUST flag, so none of the three above
    // can pass by never having recognised a violation.
    expect(/from\s+["']@\/lib\/db\//.test('import { readRuns } from "@/lib/db/runs";')).toBe(true);
    expect(AWAITS.test("const rows = await readRuns();")).toBe(true);
  });

  it("leaves the page function the only async component on the route", () => {
    // §5: the page reads and shapes; everything below it is pure and sync.
    // The page itself must still be async — a criterion the rule above would
    // happily satisfy by deleting the read.
    expect(codeText(PAGE)).toMatch(/export default async function CyclesPage/);
  });
});
