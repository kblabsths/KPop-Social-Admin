import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { CYCLE_COUNTERS, CYCLE_WINDOW } from "@/lib/db/cycles";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import { readNumber } from "../../live/parity";
import { render } from "../ui/markup";
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
  type Script,
} from "../../fixtures/stub-client";

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

    // The header carries the contract's eight column names, in its order.
    for (const counter of CYCLE_COUNTERS) {
      expect(headers(markup, CYCLES_TABLE), counter).toContain(counter);
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
    // The id is named verbatim, so the operator can see which cycle was meant.
    expect(absent).toContain("0192ffff-dead");
  });

  it("takes the first value when the URL names a facet twice", async () => {
    const markup = await renderCycles(healthyScript(), {
      cycle: [FAILED.run_id, SUCCEEDED.run_id],
    });
    expect(cycleRow(markup, FAILED.run_id).current).toBe("true");
    expect(cycleRow(markup, SUCCEEDED.run_id).current).toBeUndefined();
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

    // The outcome spread counts each of the constraint's three words plus the
    // rows that carry none — two here, the running one and the dead one.
    const outcomes = new Map(
      tableRows(markup, OUTCOMES).map((cells) => [cells[0], cells[1]]),
    );
    expect(outcomes.get("succeeded")).toBe("1");
    expect(outcomes.get("failed")).toBe("1");
    expect(outcomes.get("skipped")).toBe("1");
    expect(outcomes.get("unfinished")).toBe("3");
  });

  it("reports a duration spread, and counts the unfinished as unmeasurable", async () => {
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
  // Pinned red: admin-window/BUG-0023. `it.fails` is vitest's strict xfail —
  // it turns RED the day the page stops publishing the verdict, which is the
  // signal to flip these two back to `it(...)` as part of the fix.
  it.fails("does not claim the cycle is absent when resolution_runs is not provisioned [admin-window/BUG-0023]", async () => {
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

  it.fails("does not claim the cycle is absent when the read of resolution_runs was refused [admin-window/BUG-0023]", async () => {
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
});

describe("the adapter framework's runs", () => {
  it("renders nothing at all, and names none of that table's columns", async () => {
    const markup = await renderCycles(healthyScript());
    // Three sections: the cycles, and the two gauges spec §5 puts on this page.
    expect(sections(markup)).toEqual(["Cycles", "Cycle health", "Resolution latency"]);
    // One table of cycles, two distributions and one trend — no fifth surface
    // waiting to be filled with guessed columns.
    const $ = cheerio.load(markup);
    expect(
      $("table")
        .toArray()
        .map((element) => $(element).attr("aria-label")),
    ).toEqual([CYCLES_TABLE, OUTCOMES, DURATIONS, WAITS, BY_DOMAIN]);
    // Nothing on the page is hooked to an adapter run, so no column of that
    // table has been guessed at — the `OPEN-RUNS` question is still open and
    // this page answers none of it.
    expect(cheerio.load(markup)("[data-run]").length).toBe(0);
  });

  it("does not read the runs table", async () => {
    const stub = stubClient(healthyScript());
    readWith.client = stub.asSupabaseClient();
    await CyclesPage({ searchParams: Promise.resolve({}) });
    expect(stub.tablesRead()).not.toContain(T.runs);
  });
});
