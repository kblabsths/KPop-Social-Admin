import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RUN_COLUMNS, RUN_COUNTS, RUN_WINDOW } from "@/lib/db/runs";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import { readNumber } from "../../live/parity";
import { APPLIES, CYCLES, OBSERVED } from "../cycles/population";
import { render } from "../ui/markup";
import {
  FAILED,
  IN_FLIGHT,
  NEWEST_FIRST,
  NO_SUCH_SOURCE,
  PARTIAL,
  RUNS,
  SKIPPED,
  SOURCE,
  SUCCEEDED,
  UNREGISTERED,
  runsFrom,
} from "./population";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type Script,
} from "../../fixtures/stub-client";

/**
 * The adapter-runs half of `/cycles`, rendered (campaign
 * admin-window/TASK-0016 — Ben's ruling of 2026-09-02).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await CyclesPage(props))` — no jsdom, no Testing
 * Library, no database. The seam mocked is `getDbClient()`, the ONE place the
 * app resolves a client (§4 rule 3), so every read of the page — both tables
 * and both gauges — goes through the scripted stub and all four states of the
 * runs section are reachable offline.
 *
 * **Every expectation is computed here, from the fixture population**
 * (`./population.ts`), never asked of the module the page called.
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which runs render, in which order,
 * which state each is in, which columns exist and that there is no tenth,
 * which object an absent read names — plus the machine's own strings where
 * rendering them VERBATIM is the requirement (the source name, the outcome,
 * the `error_summary`, the `failure_class`, the missing table). No class name
 * and no copy of the app's own words is pinned.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDbClient: () => {
      if (readWith.client === undefined) throw new Error("no database scripted");
      return readWith.client as SupabaseClient;
    },
  };
});

const cyclesModule = await import("@/app/cycles/page");
const CyclesPage = cyclesModule.default;

/**
 * A database holding both halves' populations.
 *
 * `resolution_runs` answers twice (the cycles table, then the cycle-health
 * gauge); `runs` answers once per render. The cycles half is scripted so the
 * independence assertions below have something to be independent OF.
 */
function healthyScript(overrides: Script = {}): Script {
  return {
    [T.resolutionRuns]: [{ data: [...CYCLES] }, { data: [...CYCLES] }],
    [T.fieldProvenance]: { data: [...APPLIES] },
    [T.observations]: { data: [...OBSERVED] },
    [T.runs]: { data: [...RUNS] },
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

const RUNS_TABLE = "Adapter runs";
const RUNS_FIGURE = "Runs in this window";

/** The state the runs section is in, read structurally (ARCHITECTURE.md §10). */
function runsState(markup: string): string | undefined {
  return cheerio.load(markup)('[data-surface="runs"]').attr("data-state");
}

/** The run ids the runs table rendered, in rendered order. */
function renderedRuns(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-run]")
    .toArray()
    .map((element) => $(element).attr("data-run") ?? "");
}

/** The cycle ids the OTHER half rendered — the half a runs failure must not touch. */
function renderedCycles(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-cycle]")
    .toArray()
    .map((element) => $(element).attr("data-cycle") ?? "");
}

/** One run row: its hooks, its count cells and every cell's text. */
function runRowOf(markup: string, runId: string) {
  const $ = cheerio.load(markup);
  const marker = $(`[data-run="${runId}"]`);
  const row = marker.closest("tr");
  const counts: Record<string, string> = {};
  row.find("[data-run-count]").each((_, element) => {
    counts[$(element).attr("data-run-count") ?? ""] = $(element).text().trim();
  });
  return {
    source: marker.attr("data-run-source"),
    startedAt: row.find("[data-run-started]").attr("data-run-started"),
    endedAt: row.find("[data-run-ended]").attr("data-run-ended"),
    inFlight: row.find("[data-run-inflight]").length > 0,
    outcome: row.find("[data-run-outcome]").attr("data-run-outcome"),
    failureClass: row.find("[data-run-failure-class]").attr("data-run-failure-class"),
    error: row.find("[data-run-error]").text().trim(),
    counts,
    cells: row
      .find("td")
      .toArray()
      .map((cell) => $(cell).text().replace(/\s+/g, " ").trim()),
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

/* ── the nine columns, and no tenth ──────────────────────────────────────── */

describe("the columns the adapter-runs half shows", () => {
  it("renders exactly the nine ruled columns, in the ruled order", async () => {
    const markup = await renderCycles(healthyScript());
    expect(runsState(markup)).toBe("ok");
    // The header is the ruled set itself: nine columns, each under the
    // machine name the migration and the ruling both spell.
    expect(headers(markup, RUNS_TABLE)).toEqual([...RUN_COLUMNS]);
  });

  it("shows no tenth column — not the primary key, not one of the other thirteen", async () => {
    const markup = await renderCycles(healthyScript());
    const header = headers(markup, RUNS_TABLE);
    expect(header).toHaveLength(9);
    // `run_id` is the row key and the order's tiebreak, never a column.
    expect(header).not.toContain("run_id");
    for (const outOfScope of [
      "checkpoint_before",
      "checkpoint_after",
      "payloads_fetched",
      "payloads_archived",
      "records_rejected",
      "claims_dropped_empty",
      "claims_collapsed",
      "claims_ai",
      "records_linked",
      "records_escalated",
      "batches_written",
      "observations_returned",
    ]) {
      expect(header, outOfScope).not.toContain(outOfScope);
    }
    // Every rendered row carries exactly nine cells, so no row smuggles one in.
    for (const run of NEWEST_FIRST) {
      expect(runRowOf(markup, run.run_id).cells, run.run_id).toHaveLength(9);
    }
  });

  it("renders all three counts as their own figures, thousand-separated", async () => {
    const markup = await renderCycles(healthyScript());
    const row = runRowOf(markup, SUCCEEDED.run_id);
    expect(Object.keys(row.counts).sort()).toEqual([...RUN_COUNTS].sort());
    expect(row.counts.records_parsed).toBe("12,345");
    expect(row.counts.claims_emitted).toBe("48,010");
    expect(row.counts.records_unlinked).toBe("1,207");
    // A zero is a real count and renders as one, never as the absence dash.
    expect(runRowOf(markup, SKIPPED.run_id).counts.records_parsed).toBe("0");
  });

  it("renders error_summary inline and verbatim", async () => {
    const markup = await renderCycles(healthyScript());
    expect(runRowOf(markup, FAILED.run_id).error).toBe(FAILED.error_summary);
    expect(runRowOf(markup, PARTIAL.run_id).error).toBe(PARTIAL.error_summary);
    // A run with nothing to report shows the table's dash, not an empty cell.
    const clean = runRowOf(markup, SUCCEEDED.run_id);
    expect(clean.error).toBe("");
    expect(clean.cells[RUN_COLUMNS.indexOf("error_summary")]).toBe(EM_DASH);
  });

  it("renders failure_class verbatim, and the dash where the run named none", async () => {
    const markup = await renderCycles(healthyScript());
    expect(runRowOf(markup, FAILED.run_id).failureClass).toBe("structural");
    expect(runRowOf(markup, PARTIAL.run_id).failureClass).toBe("transient");
    const clean = runRowOf(markup, SUCCEEDED.run_id);
    expect(clean.failureClass).toBeUndefined();
    expect(clean.cells[RUN_COLUMNS.indexOf("failure_class")]).toBe(EM_DASH);
  });

  it("renders the source name verbatim, registered or not", async () => {
    const markup = await renderCycles(healthyScript());
    expect(runRowOf(markup, SUCCEEDED.run_id).source).toBe(SOURCE.ticketmaster);
    // A run filed under a name no registry row carries is still a run.
    expect(runRowOf(markup, UNREGISTERED.run_id).source).toBe(SOURCE.unregistered);
    expect(markup).toContain(SOURCE.unregistered);
  });
});

/* ── order, and the states a row can be in ───────────────────────────────── */

describe("the runs the adapters filed", () => {
  it("renders every run, newest first by started_at", async () => {
    const markup = await renderCycles(healthyScript());
    expect(renderedRuns(markup)).toEqual(NEWEST_FIRST.map((row) => row.run_id));

    // The order is this file's own claim, re-derived from the instants: each
    // rendered row started no later than the one above it.
    const instants = renderedRuns(markup).map((id) =>
      Date.parse(runRowOf(markup, id).startedAt ?? ""),
    );
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index]).toBeLessThanOrEqual(instants[index - 1]);
    }
  });

  it("makes a run still in flight legible as one, and never as a missing value", async () => {
    const markup = await renderCycles(healthyScript());
    const flying = runRowOf(markup, IN_FLIGHT.run_id);
    expect(flying.inFlight).toBe(true);
    expect(flying.endedAt).toBeUndefined();
    // Not the dash: the null IS the state, and the cell says so.
    const endedCell = flying.cells[RUN_COLUMNS.indexOf("ended_at")];
    expect(endedCell).not.toBe(EM_DASH);
    expect(endedCell.length).toBeGreaterThan(0);
    // It recorded no outcome either, and the page invents none.
    expect(flying.outcome).toBeUndefined();
    expect(flying.cells[RUN_COLUMNS.indexOf("outcome")]).toBe(EM_DASH);

    // A run that ended reads differently from one that has not.
    const done = runRowOf(markup, SUCCEEDED.run_id);
    expect(done.inFlight).toBe(false);
    expect(done.endedAt).toBe(SUCCEEDED.ended_at);
  });

  it("makes a skipped run legible as itself, not as a failure", async () => {
    const markup = await renderCycles(healthyScript());
    const skipped = runRowOf(markup, SKIPPED.run_id);
    expect(skipped.outcome).toBe("skipped");
    expect(skipped.failureClass).toBeUndefined();
    expect(skipped.error).toBe("");
    // Four outcomes, four different readings: no two rows say the same thing
    // about different states, which is what "legible as such" means.
    const readings = new Set(
      [SUCCEEDED, FAILED, PARTIAL, SKIPPED, IN_FLIGHT].map(
        (run) => runRowOf(markup, run.run_id).cells[RUN_COLUMNS.indexOf("outcome")],
      ),
    );
    expect(readings.size).toBe(5);
  });

  it("states the window it is showing, and never presents it as a count", async () => {
    const markup = await renderCycles(healthyScript());
    const line = cheerio.load(markup)('[data-window="runs"]');
    expect(line.attr("data-window-limit")).toBe(String(RUN_WINDOW));
    expect(line.attr("data-window-truncated")).toBe("false");
    // With rows on screen the page states no figure at all: a window's length
    // is not a total, and no number here may come from `rows.length`
    // (ARCHITECTURE.md §4.3).
    expect(() => readNumber(markup, RUNS_FIGURE)).toThrow();
  });

  it("says so when the window filled its cap", async () => {
    const capped = Array.from({ length: RUN_WINDOW }, (_, index) => ({
      ...SUCCEEDED,
      run_id: `capped-${String(index).padStart(4, "0")}`,
      started_at: new Date(
        Date.parse(SUCCEEDED.started_at) - index * 60_000,
      ).toISOString(),
    }));
    const markup = await renderCycles(healthyScript({ [T.runs]: { data: capped } }));
    expect(renderedRuns(markup)).toHaveLength(RUN_WINDOW);
    expect(cheerio.load(markup)('[data-window="runs"]').attr("data-window-truncated")).toBe(
      "true",
    );
  });
});

/* ── the ?source= facet (the Sources page's seam) ────────────────────────── */

describe("a ?source= link arriving from the Sources page", () => {
  it("narrows the runs half to that source name", async () => {
    const expected = runsFrom(SOURCE.ticketmaster);
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: expected } }),
      { source: SOURCE.ticketmaster },
    );
    expect(runsState(markup)).toBe("ok");
    expect(renderedRuns(markup)).toEqual(expected.map((row) => row.run_id));
    for (const id of renderedRuns(markup)) {
      expect(runRowOf(markup, id).source, id).toBe(SOURCE.ticketmaster);
    }
  });

  it("passes the name to the read, and matches by name rather than by key", async () => {
    const stub = stubClient(healthyScript({ [T.runs]: { data: [] } }));
    readWith.client = stub.asSupabaseClient();
    await CyclesPage({ searchParams: Promise.resolve({ source: SOURCE.bandsintown }) });
    const call = stub.calls.find((recorded) => recorded.table === T.runs);
    expect(call).toBeDefined();
    expect(
      call?.steps.filter((step) => step.method === "eq").map((step) => step.args),
    ).toEqual([["source", SOURCE.bandsintown]]);
  });

  it("says the facet applies to the runs half, and narrows none of the cycles", async () => {
    // `resolution_runs` carries no source, so the cycles are the same cycles
    // with the facet as without it — and the page says which half was narrowed
    // rather than leaving the operator to guess the URL was ignored.
    const plain = await renderCycles(healthyScript());
    const faceted = await renderCycles(
      healthyScript({ [T.runs]: { data: runsFrom(SOURCE.ticketmaster) } }),
      { source: SOURCE.ticketmaster },
    );
    expect(renderedCycles(faceted)).toEqual(renderedCycles(plain));

    const line = cheerio.load(faceted)("[data-source-facet]");
    expect(line.attr("data-source-facet")).toBe(SOURCE.ticketmaster);
    expect(line.attr("data-source-facet-half")).toBe("runs");
    // The name is stated verbatim, so the operator sees which one was meant.
    expect(line.text()).toContain(SOURCE.ticketmaster);
    // No facet, no sentence.
    expect(cheerio.load(plain)("[data-source-facet]").length).toBe(0);
  });

  it("renders the empty state with a stated 0 when the name matches nothing", async () => {
    // Not the error state: a facet that matched nothing is an answer, and a
    // window read that came back with no rows had no matching rows at all
    // (DECISIONS 2026-09-02, "a counted zero is a real figure").
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { data: [] } }),
      { source: NO_SUCH_SOURCE },
    );
    expect(runsState(markup)).toBe("empty");
    expect(renderedRuns(markup)).toEqual([]);
    expect(readNumber(markup, RUNS_FIGURE)).toBe(0);
    expect(cheerio.load(markup)('[data-empty="runs"]').length).toBe(1);
    expect(notProvisioned(markup)).toEqual([]);
    expect(readsFailed(markup)).toEqual([]);
    // The name that matched nothing is still named, so the link is legible.
    expect(markup).toContain(NO_SUCH_SOURCE);
  });

  it("takes the first value when the URL names the source twice", async () => {
    const stub = stubClient(healthyScript({ [T.runs]: { data: [] } }));
    readWith.client = stub.asSupabaseClient();
    const markup = render(
      await CyclesPage({
        searchParams: Promise.resolve({
          source: [SOURCE.bandsintown, SOURCE.ticketmaster],
        }),
      }),
    );
    expect(cheerio.load(markup)("[data-source-facet]").attr("data-source-facet")).toBe(
      SOURCE.bandsintown,
    );
    const call = stub.calls.find((recorded) => recorded.table === T.runs);
    expect(
      call?.steps.filter((step) => step.method === "eq").map((step) => step.args),
    ).toEqual([["source", SOURCE.bandsintown]]);
  });

  it("renders a facet value the URL invented as text, never as markup", async () => {
    const markup = await renderCycles(healthyScript({ [T.runs]: { data: [] } }), {
      source: '"><img src=x onerror=alert(1)>',
    });
    expect(markup).not.toContain("<img");
    const $ = cheerio.load(markup);
    expect($("img").length).toBe(0);
    expect($("[data-source-facet]").text()).toContain('"><img src=x onerror=alert(1)>');
  });
});

/* ── the four states, and the independence of the two halves ─────────────── */

describe("a database without the adapter framework's runs", () => {
  it("names runs in its not-provisioned state, and the cycles half still renders", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } }),
    );
    expect(runsState(markup)).toBe("not_provisioned");
    expect(notProvisioned(markup)).toContain(T.runs);
    expect(renderedRuns(markup)).toEqual([]);
    // The other half is untouched: an absent `runs` is not a broken page.
    expect(renderedCycles(markup)).toHaveLength(CYCLES.length);
    expect(readNumber(markup, "Cycles in this window")).toBe(CYCLES.length);
    // Never a zero that reads like data.
    expect(() => readNumber(markup, RUNS_FIGURE)).toThrow();
  });

  it("names the read that was refused, in the object's own spelling", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { error: permissionDenied(T.runs) } }),
    );
    expect(runsState(markup)).toBe("error");
    expect(readsFailed(markup)).toContain(T.runs);
    // The database's own account reaches the page, not a sentence of ours.
    expect(markup).toContain("permission denied");
    // The header stays put: an error is a line inside the surface, not a card
    // replacing it.
    expect(headers(markup, RUNS_TABLE)).toEqual([...RUN_COLUMNS]);
    expect(renderedCycles(markup)).toHaveLength(CYCLES.length);
  });

  it("reports a transport failure as an error, never as an empty window", async () => {
    const markup = await renderCycles(
      healthyScript({ [T.runs]: { error: transportFailure() } }),
    );
    expect(runsState(markup)).toBe("error");
    expect(readsFailed(markup)).toContain(T.runs);
    expect(cheerio.load(markup)('[data-empty="runs"]').length).toBe(0);
    expect(() => readNumber(markup, RUNS_FIGURE)).toThrow();
  });

  it("renders the empty state with a stated 0 when no adapter has ever run", async () => {
    const markup = await renderCycles(healthyScript({ [T.runs]: { data: [] } }));
    expect(runsState(markup)).toBe("empty");
    expect(renderedRuns(markup)).toEqual([]);
    expect(readNumber(markup, RUNS_FIGURE)).toBe(0);
    expect(notProvisioned(markup)).toEqual([]);
  });

  it("claims no window it never read", async () => {
    // The window line says "a window of at most 200 runs". A refused or absent
    // read returned no window at all, so the line would be describing a table
    // that is not there — while an EMPTY window is still a window the page
    // looked in, and keeps its line.
    for (const [label, script] of [
      ["absent", { [T.runs]: { error: tableNotInSchemaCache(T.runs) } }],
      ["refused", { [T.runs]: { error: permissionDenied(T.runs) } }],
    ] as const) {
      const markup = await renderCycles(healthyScript(script));
      expect(cheerio.load(markup)('[data-window="runs"]').length, label).toBe(0);
    }
    const empty = await renderCycles(healthyScript({ [T.runs]: { data: [] } }));
    expect(cheerio.load(empty)('[data-window="runs"]').length).toBe(1);
  });

  it("keeps a cycles failure to the cycles half", async () => {
    const markup = await renderCycles(
      healthyScript({
        [T.resolutionRuns]: [
          { error: tableNotInSchemaCache(T.resolutionRuns) },
          { error: tableNotInSchemaCache(T.resolutionRuns) },
        ],
      }),
    );
    expect(notProvisioned(markup)).toContain(T.resolutionRuns);
    expect(runsState(markup)).toBe("ok");
    expect(renderedRuns(markup)).toEqual(NEWEST_FIRST.map((row) => row.run_id));
  });
});
