import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RUN_COLUMNS, RUN_COUNTS, RUN_WINDOW } from "@/lib/db/runs";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import { readNumber } from "../../live/parity";
import { APPLIES, CYCLES, OBSERVED } from "../cycles/population";
import { RUN_CELL_HOOK, columnsFromHooks } from "../../fixtures/run-hooks";
import { runRow, type RunRow as RunFixture } from "../../fixtures/rows";
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

/**
 * The **Dashboard**, rendered against the same stubbed client — the app's other
 * rendering of the `runs` row (admin-window/BUG-0064).
 *
 * It is here, in the file that owns this table's vocabulary, because the claim
 * under test spans two pages: whatever either surface calls a column, they must
 * call it the same thing. It reaches the database through the same
 * `getDbClient()` seam already mocked above, so no second mock is needed and
 * the Dashboard's own suite keeps owning everything else about that page.
 *
 * The run carries an outcome and an error line so both hooked cells render;
 * the counts the Dashboard does not show are the fixture's own.
 */
const { default: DashboardPage } = await import("@/app/page");

/** What the Dashboard's runs table calls itself. */
const DASHBOARD_RUNS_TABLE = "runs";

async function renderDashboard(): Promise<string> {
  readWith.client = stubClient({
    [T.reviewItems]: { data: [] },
    [T.resolutionRuns]: { data: [] },
    [T.runs]: {
      data: [
        runRow({
          run_id: "0192f0c2-0000-7000-8000-0000000000db",
          outcome: "failed",
          error_summary: "ticketmaster: 429 rate limited after 3 retries",
        }),
      ],
    },
  }).asSupabaseClient();
  return render(await DashboardPage());
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

/**
 * The columns one rendered run row really has, in rendered order, named by the
 * machine hook each cell carries — never by its header
 * (`tests/fixtures/run-hooks.ts`, shared with the live oracle).
 */
function columnsOf(markup: string, runId: string): (string | null)[] {
  const $ = cheerio.load(markup);
  return columnsFromHooks(
    $(`[data-run="${runId}"]`).closest("tr").children("td").toArray(),
    (cell, selector) => $(cell as never).find(selector).length,
  );
}

/**
 * The header sitting above the cell that carries a given machine hook.
 *
 * The seam that lets two surfaces be compared as two INDEPENDENTLY read
 * strings: the Dashboard and this page render the same `runs` columns through
 * different components, and the question is whether they call them the same
 * thing (admin-window/BUG-0064). Nothing here pins a word.
 */
function headerAbove(markup: string, table: string, hook: string): string {
  const $ = cheerio.load(markup);
  const cell = $(`table[aria-label="${table}"] ${hook}`).first().closest("td");
  const siblings = cell.parent().children("td").toArray();
  const index = siblings.findIndex((element) => element === cell[0]);
  return index === -1 ? "" : (headers(markup, table)[index] ?? "");
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
    // The ruled set and the ruled order, read off the CELLS' machine hooks —
    // the columns the row really has, whatever the header row calls them
    // (admin-window/BUG-0064). `FAILED` is the fixture that populates all
    // nine, so every hook is really on screen and nothing is asserted
    // vacuously.
    expect(columnsOf(markup, FAILED.run_id)).toEqual([...RUN_COLUMNS]);
    // And the header row is that same width: one label per ruled column.
    expect(headers(markup, RUNS_TABLE)).toHaveLength(RUN_COLUMNS.length);
  });

  it("shows no tenth column — not the primary key, not one of the other thirteen", async () => {
    const markup = await renderCycles(healthyScript());
    // Read off the hooks, not off the headers: the headers are the app's
    // words, so asking them whether they contain `checkpoint_before` would
    // pass whatever the table rendered (LESSONS 3 — no vacuous guard).
    const header = columnsOf(markup, FAILED.run_id);
    expect(header).toHaveLength(9);
    expect(headers(markup, RUNS_TABLE)).toHaveLength(9);
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
    // replacing it. No row rendered, so there is no hook to read a column off
    // — what this pins is the SHAPE the failed read still draws: all nine
    // columns headed, and the failure reported across them rather than in one.
    expect(headers(markup, RUNS_TABLE)).toHaveLength(RUN_COLUMNS.length);
    expect(
      cheerio.load(markup)(`table[aria-label="${RUNS_TABLE}"] tbody td`).attr("colspan"),
    ).toBe(String(RUN_COLUMNS.length));
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

/* ── the values an ADAPTER wrote, not the values our fixtures like ───────── */

/**
 * `runs.source`, `outcome`, `failure_class` and `error_summary` are foreign
 * text: an adapter writes them, this app never validates them, and the
 * ecosystem's whole point is that a fact renders as the producer filed it. The
 * facet's URL-controlled string is already pinned above; these are the ROW's,
 * which arrive by a different path (a scraper insert) and are the path the
 * trust boundary names.
 */
describe("a run carrying values this app has never heard of", () => {
  /**
   * A population of one row, so the assertions are about that row alone.
   *
   * The overrides are cast because the shared fixture narrows `outcome` and
   * `failure_class` to the words the migration's check constraints allow
   * today, while the COLUMNS are plain text and `RunRow` in `src/lib/db/runs.ts`
   * types them `string | null` on purpose. A word this app has never heard of
   * is exactly what these tests are about, so it is written here rather than
   * by widening the fixture's union for every other test.
   */
  async function renderOne(overrides: Record<string, unknown>): Promise<string> {
    const only = {
      ...runRow({ run_id: "0192f0c2-0000-7000-8000-0000000000aa" }),
      ...overrides,
    } as unknown as RunFixture;
    return renderCycles(healthyScript({ [T.runs]: { data: [only] } }));
  }

  const ONLY = "0192f0c2-0000-7000-8000-0000000000aa";

  it("renders an outcome and a failure_class outside the constraint's words verbatim", async () => {
    // Neither word is in `runs_outcome_check` / `runs_failure_class_check`
    // (migration 20260829000001). A value the database holds and this app has
    // never heard of must reach the operator as it was filed — never narrowed
    // away, never replaced with a word of ours, and never turned into the
    // absence dash.
    const markup = await renderOne({
      outcome: "abandoned",
      failure_class: "quota",
      error_summary: "upstream said no",
      records_parsed: 7,
      claims_emitted: 0,
      records_unlinked: 3,
    });
    expect(runsState(markup)).toBe("ok");
    const row = runRowOf(markup, ONLY);
    expect(row.outcome).toBe("abandoned");
    expect(row.failureClass).toBe("quota");
    expect(row.cells[RUN_COLUMNS.indexOf("outcome")]).toBe("abandoned");
    expect(row.cells[RUN_COLUMNS.indexOf("failure_class")]).toBe("quota");
    expect(row.cells[RUN_COLUMNS.indexOf("failure_class")]).not.toBe(EM_DASH);
    // The rest of the row is unaffected by the word it does not know.
    expect(row.counts.records_parsed).toBe("7");
    expect(row.counts.records_unlinked).toBe("3");
  });

  it("renders adapter-written text as text, never as markup", async () => {
    // An `error_summary` is whatever the adapter's exception said, and a
    // `source` is whatever it filed under. Neither may reach the document as
    // an element.
    const error = '</td><script>alert(1)</script>';
    const source = '"><img src=x onerror=alert(1)>';
    const markup = await renderOne({
      source,
      outcome: "failed",
      failure_class: "<b>structural</b>",
      error_summary: error,
    });
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    const $ = cheerio.load(markup);
    expect($("script").length).toBe(0);
    expect($("img").length).toBe(0);
    // Still legible, and still the producer's own text.
    const row = runRowOf(markup, ONLY);
    expect(row.error).toBe(error);
    expect(row.source).toBe(source);
    expect(row.failureClass).toBe("<b>structural</b>");
    expect(runsState(markup)).toBe("ok");
  });
});

/* ── one page, one vocabulary (admin-window/BUG-0044's neighbour) ─────────── */

describe("what the adapter-runs half calls its columns", () => {
  /**
   * The Cycles table directly above this one stopped heading its columns with
   * raw database names (admin-window/BUG-0044) and this half did too
   * (admin-window/BUG-0064), so the page speaks one vocabulary: the SAME
   * column (`error_summary`) is no longer headed two different ways within one
   * screen, and no longer reads ERROR on `/` and ERROR_SUMMARY here.
   *
   * Properties, never a copy of nine strings: no header is a raw column name,
   * and the two surfaces that render the same column agree on what it is
   * called. Which words those are is the designer's call, and nothing below
   * pins one.
   */

  /**
   * What is wrong with a header of the runs table, or `null` when nothing is.
   *
   * A predicate rather than an inline regex so the test can prove it
   * DISCRIMINATES — handed a spelling it must flag as well as the headers it
   * must clear (LESSONS 3), which is what stops it from rotting into a check
   * that passes on an empty header row.
   */
  function headerFault(header: string): string | null {
    if (header.trim() === "") return "no header at all";
    if (/_/.test(header)) return "raw column name";
    return null;
  }

  it("heads no column with a raw database column name", async () => {
    const markup = await renderCycles(healthyScript());
    const set = headers(markup, RUNS_TABLE);
    // Non-vacuous: one header per column the row really rendered.
    expect(set).toHaveLength(columnsOf(markup, FAILED.run_id).length);
    expect(set).toHaveLength(RUN_COLUMNS.length);

    // The predicate discriminates: the spellings this table used to render are
    // exactly the ones it flags, and the words it renders now are cleared.
    expect(headerFault("started_at")).toBe("raw column name");
    expect(headerFault("error_summary")).toBe("raw column name");
    expect(headerFault("")).toBe("no header at all");
    expect(headerFault("started")).toBeNull();

    for (const header of set) {
      expect(headerFault(header), header).toBeNull();
    }

    // The machine names did not go anywhere — they are on the CELLS, which is
    // what every offline and live reader of this table selects by.
    expect(columnsOf(markup, FAILED.run_id)).toEqual([...RUN_COLUMNS]);
  });

  it("calls the columns it shares with the Dashboard what the Dashboard calls them", async () => {
    // Two surfaces, two renders, two independently read header rows: the
    // Dashboard's runs table (`src/app/page.tsx`) shows four of these nine
    // columns and already heads them in the app's words. `runs.started_at`
    // reading STARTED on `/` and STARTED_AT here is what filed this ticket.
    const here = headers(await renderCycles(healthyScript()), RUNS_TABLE);
    const dashboard = headers(await renderDashboard(), DASHBOARD_RUNS_TABLE);

    // Non-vacuous: the other surface really rendered its four headers.
    expect(dashboard).toHaveLength(4);
    expect(dashboard.filter((header) => header.trim() === "")).toEqual([]);

    // Every word the Dashboard heads a shared column with is a word this
    // table heads a column with. No literal is named on either side.
    expect(here).toEqual(expect.arrayContaining(dashboard));

    // And the pairing holds where both surfaces mark the cell: the column an
    // operator reads as one thing on `/` is that same thing here.
    for (const [mine, theirs] of [
      [RUN_CELL_HOOK.outcome, "[data-outcome]"],
      [RUN_CELL_HOOK.error_summary, "[data-error-line]"],
    ]) {
      const label = headerAbove(
        await renderCycles(healthyScript()),
        RUNS_TABLE,
        mine,
      );
      expect(label, mine).not.toBe("");
      expect(headerAbove(await renderDashboard(), DASHBOARD_RUNS_TABLE, theirs)).toBe(
        label,
      );
    }
  });
});
