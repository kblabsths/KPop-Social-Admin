import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import CyclesPage from "@/app/cycles/page";
import { RUN_COLUMNS, RUN_COUNTS, RUN_WINDOW } from "@/lib/db/runs";
import { T } from "@/lib/db/tables";
import { ALWAYS_HOOKED, columnsFromHooks } from "../fixtures/run-hooks";
import {
  assertState,
  gradeSurface,
  independentClient,
  objectIsAbsent,
  readNumber,
  renderPage,
  whileStill,
} from "./parity";

/**
 * The adapter-runs half of `/cycles` against staging (campaign
 * admin-window/TASK-0016).
 *
 * Acceptance test 2, as ARCHITECTURE.md §10 states it: what the page RENDERED
 * is compared with queries THIS TEST issues, written independently of the
 * `lib/db` function the page called. Two paths to one set of rows, or it
 * proves nothing — so nothing below calls `readRuns`, and the newest-first
 * order is re-derived here from `started_at` rather than asked of the module
 * that produced it.
 *
 * (`RUN_COLUMNS`, `RUN_COUNTS` and `RUN_WINDOW` are imported as the RULING's
 * vocabulary — the nine column names Ben settled on 2026-09-02 and the size of
 * the window the page states — never as an answer: every value compared below
 * comes from this file's own query.)
 *
 * **The state kind is named before any number is compared** (ARCHITECTURE.md
 * §10, common violation 6). The runs section carries its kind structurally on
 * `data-state`, and this file branches on that:
 *
 *  - `error` is always a FAIL, and the failure names the read and the
 *    database's own account. A live suite that can go green while a page is
 *    broken is the one thing this suite exists not to be.
 *  - `empty` is a PASS WITH A NUMBER: this test's own count of the same rows
 *    is exactly 0 and the page's labelled figure reads 0.
 *  - `not_provisioned` is a pass only when this test's own read of `runs` gets
 *    the absence code (`PGRST205` / `42P01`). It is never inferred from "no
 *    rows rendered".
 *  - `ok` compares rows, order, columns and counts.
 *
 * This file WRITES NOTHING, so it needs no sweep (acceptance test 13); every
 * query here is a select.
 *
 * It refuses to run at all until `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SERVICE_ROLE_KEY` are set and `agenticflow/docs/SERVICES.md`
 * declares the target — `tests/live/setup.ts` throws first, non-zero, with the
 * missing name. That refusal is the correct state today and is not a failure
 * of this file.
 */

type Params = Record<string, string>;

/** The label the empty state's figure stands under, as an operator reads it. */
const RUNS_FIGURE = "Runs in this window";

/** The runs half's own hook — the surface every case below grades. */
const RUNS = '[data-surface="runs"]';

interface StagingRun {
  run_id: string;
  source: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  error_summary: string | null;
  failure_class: string | null;
  records_parsed: number;
  claims_emitted: number;
  records_unlinked: number;
}

/** The page as the URL renders it. Every read happens per request. */
async function cyclesMarkup(params: Params = {}): Promise<string> {
  return renderPage(CyclesPage, { searchParams: Promise.resolve(params) });
}

/** The run rows the page rendered, as their hooks and count cells. */
function renderedRuns(markup: string) {
  const $ = cheerio.load(markup);
  return $("[data-run]")
    .toArray()
    .map((element) => {
      const marker = $(element);
      const row = marker.closest("tr");
      const counts: Record<string, string> = {};
      row.find("[data-run-count]").each((_, cell) => {
        counts[$(cell).attr("data-run-count") ?? ""] = $(cell).text().trim();
      });
      return {
        runId: marker.attr("data-run") ?? "",
        source: marker.attr("data-run-source") ?? "",
        startedAt: row.find("[data-run-started]").attr("data-run-started"),
        endedAt: row.find("[data-run-ended]").attr("data-run-ended"),
        inFlight: row.find("[data-run-inflight]").length > 0,
        outcome: row.find("[data-run-outcome]").attr("data-run-outcome"),
        failureClass: row
          .find("[data-run-failure-class]")
          .attr("data-run-failure-class"),
        error: row.find("[data-run-error]").text().trim(),
        counts,
      };
    });
}

/** The newest runs, read by THIS TEST, in the order it expects them. */
async function stagingRuns(limit: number, source?: string): Promise<StagingRun[]> {
  const base = independentClient()
    .from(T.runs)
    .select(
      [
        "run_id",
        "source",
        "started_at",
        "ended_at",
        "outcome",
        "error_summary",
        "failure_class",
        "records_parsed",
        "claims_emitted",
        "records_unlinked",
      ].join(", "),
    );
  const narrowed = source === undefined ? base : base.eq("source", source);
  const { data, error } = await narrowed
    .order("started_at", { ascending: false })
    .order("run_id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`the runs query failed: ${JSON.stringify(error)}`);
  return (data ?? []) as unknown as StagingRun[];
}

/**
 * Grade the state kind the runs half is in, and say whether the caller may go
 * on to compare rows.
 *
 * The four rules live in `gradeSurface` (`tests/live/parity.ts`), which every
 * live oracle in this suite now shares — an `error` fails naming the read and
 * what the database said, a `not_provisioned` is checked against this test's
 * own absence code, an `empty` is a pass carrying 0 on screen and 0 in the
 * database. What is local here is the COUNT: this test's own read of the runs
 * the window would hold.
 */
async function gradeState(markup: string, source?: string): Promise<boolean> {
  const kind = await gradeSurface({
    markup,
    within: RUNS,
    object: T.runs,
    figure: RUNS_FIGURE,
    counted: async () =>
      (await objectIsAbsent(T.runs))
        ? "absent"
        : (await stagingRuns(RUN_WINDOW, source)).length,
  });
  if (kind === "ok") return true;
  if (kind === "empty") expect(renderedRuns(markup)).toHaveLength(0);
  return false;
}

describe("the adapter framework's runs against staging", () => {
  it("renders the newest runs, newest first, as the table holds them", async () => {
    // The adapters file runs while this test runs, so the render and the query
    // are pinned to one still moment: a run arriving between them would read
    // as a run the page dropped (`whileStill`, tests/live/parity.ts).
    const { made: markup, held } = await whileStill(
      () => stagingRuns(RUN_WINDOW),
      () => cyclesMarkup(),
    );
    if (!(await gradeState(markup))) return;

    const rendered = renderedRuns(markup);
    expect(rendered.map((row) => row.runId)).toEqual(held.map((row) => row.run_id));

    // The order is this test's own claim, re-derived from the instants rather
    // than trusted to the query: each rendered row started no later than the
    // one above it.
    const instants = rendered.map((row) => Date.parse(row.startedAt ?? ""));
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index], rendered[index].runId).toBeLessThanOrEqual(
        instants[index - 1],
      );
    }
  });

  it("renders exactly the nine ruled columns, and no tenth", async () => {
    const markup = await cyclesMarkup();
    if (!(await gradeState(markup))) return;

    // The ruled SET and ORDER, read off each cell's own machine hook — the
    // headers are the app's words now (admin-window/BUG-0064), and the hooks
    // are where the column names live. The same seam every other assertion in
    // this file selects by, and the same map the offline render reads
    // (`tests/fixtures/run-hooks.ts`).
    //
    // Every rendered row, because staging's rows are whatever the adapters
    // filed: a nullable column renders the dash and no hook, which is correct,
    // so a column is graded on the rows that HAVE it and the always-hooked six
    // are what keeps the grade from passing on nothing.
    const $ = cheerio.load(markup);
    const seen = new Set<string>();
    for (const row of $("[data-run]").toArray()) {
      const cells = $(row).closest("tr").children("td").toArray();
      const rendered = columnsFromHooks(cells, (cell, selector) =>
        $(cell as never).find(selector).length,
      );
      expect(rendered, $(row).attr("data-run")).toHaveLength(RUN_COLUMNS.length);
      rendered.forEach((column, index) => {
        if (column === null) return;
        // Whatever this cell is, it sits where the ruling puts that column.
        expect(column, `${$(row).attr("data-run")} cell ${index}`).toBe(
          RUN_COLUMNS[index],
        );
        seen.add(column);
      });
      for (const column of ALWAYS_HOOKED) {
        expect(rendered, `${$(row).attr("data-run")} ${column}`).toContain(column);
      }
    }
    // Non-vacuous: the six a row cannot render without were all observed.
    expect([...ALWAYS_HOOKED].filter((column) => !seen.has(column))).toEqual([]);

    const headers = $('table[aria-label="Adapter runs"] th')
      .toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim());
    expect(headers).toHaveLength(9);
    // The primary key is the row key, never a column.
    expect(headers).not.toContain("run_id");
    // No header is a raw database column name, so the page speaks one
    // vocabulary against real rows too, not only against fixtures.
    expect(headers.filter((header) => /_/.test(header) || header.trim() === "")).toEqual(
      [],
    );
  });

  it("renders every count, every failure class and every error line the row carries", async () => {
    const markup = await cyclesMarkup();
    if (!(await gradeState(markup))) return;

    const rendered = renderedRuns(markup);
    const held = new Map(
      (await stagingRuns(RUN_WINDOW)).map((row) => [row.run_id, row]),
    );

    for (const row of rendered.slice(0, 20)) {
      const source = held.get(row.runId);
      expect(source, row.runId).toBeDefined();
      if (source === undefined) continue;

      for (const counter of RUN_COUNTS) {
        // The page renders the figure thousand-separated; the comparison is
        // against the NUMBER, so a formatting change never reddens parity.
        expect(
          Number(row.counts[counter].replace(/,/g, "")),
          `${row.runId}.${counter}`,
        ).toBe(source[counter]);
      }

      // `error_summary` is inline and verbatim, or absent — never trimmed and
      // never replaced with a sentence of the app's own.
      expect(row.error, row.runId).toBe(
        source.error_summary === null ? "" : String(source.error_summary),
      );
      // `failure_class` is a machine identifier, rendered verbatim.
      expect(row.failureClass, row.runId).toBe(source.failure_class ?? undefined);
      // The source is the run's own text, whatever the registry holds.
      expect(row.source, row.runId).toBe(source.source);
    }
  });

  it("reads a run still in flight and a completed run as what they are", async () => {
    const markup = await cyclesMarkup();
    if (!(await gradeState(markup))) return;

    const held = new Map(
      (await stagingRuns(RUN_WINDOW)).map((row) => [row.run_id, row]),
    );
    for (const row of renderedRuns(markup)) {
      const source = held.get(row.runId);
      expect(source, row.runId).toBeDefined();
      if (source === undefined) continue;

      if (source.ended_at === null) {
        // No end recorded: still running, and never the absence dash.
        expect(row.inFlight, row.runId).toBe(true);
        expect(row.endedAt, row.runId).toBeUndefined();
      } else {
        expect(row.inFlight, row.runId).toBe(false);
        expect(row.endedAt, row.runId).toBe(source.ended_at);
      }
      // The producer's own word, verbatim — `skipped` included, which is a
      // healthy outcome and never a failure.
      expect(row.outcome, row.runId).toBe(source.outcome ?? undefined);
    }
  });
});

describe("the ?source= facet against staging", () => {
  it("narrows the runs half to the source name, matched by name", async () => {
    const plain = await cyclesMarkup();
    if (!(await gradeState(plain))) return;

    // A name staging actually carries, taken from what rendered.
    const name = renderedRuns(plain)[0].source;
    const markup = await cyclesMarkup({ source: name });
    if (!(await gradeState(markup, name))) return;

    const rendered = renderedRuns(markup);
    const held = await stagingRuns(RUN_WINDOW, name);
    expect(rendered.map((row) => row.runId)).toEqual(held.map((row) => row.run_id));
    for (const row of rendered) {
      expect(row.source, row.runId).toBe(name);
    }

    // The page says which half the facet narrowed, naming the source verbatim.
    const line = cheerio.load(markup)("[data-source-facet]");
    expect(line.attr("data-source-facet")).toBe(name);
    expect(line.attr("data-source-facet-half")).toBe("runs");
  });

  it("renders the empty state with a 0 for a name nothing was filed under", async () => {
    // A name no run can carry. The honest answer is an emptiness with a
    // counted zero — never the error state (DECISIONS 2026-09-02).
    const name = `no-such-source-${Date.now()}`;
    const markup = await cyclesMarkup({ source: name });

    if (await objectIsAbsent(T.runs)) {
      assertState(markup, RUNS, "not_provisioned");
      return;
    }
    // Nothing can carry this name, so this test counted 0 and the page must
    // say EMPTY with a 0 on it — never the error state (DECISIONS 2026-09-02).
    expect(await stagingRuns(1, name)).toHaveLength(0);
    assertState(markup, RUNS, "empty");
    expect(readNumber(markup, RUNS_FIGURE)).toBe(0);
    expect(markup).toContain(name);
  });

  it("leaves the resolver's cycles unnarrowed, because they carry no source", async () => {
    const cyclesOf = (markup: string) =>
      cheerio
        .load(markup)("[data-cycle]")
        .toArray()
        .map((element) => cheerio.load(markup)(element).attr("data-cycle") ?? "");

    // Two renders, compared with each other, so they must see the same
    // database: the resolver files a cycle every cadence, and one arriving
    // between the two renders is not the facet narrowing anything.
    const { made } = await whileStill(
      async () => cyclesOf(await cyclesMarkup()),
      async () => {
        const plain = await cyclesMarkup();
        if (!(await gradeState(plain))) return null;
        const name = renderedRuns(plain)[0].source;
        return { plain, faceted: await cyclesMarkup({ source: name }) };
      },
    );
    if (made === null) return;
    expect(cyclesOf(made.faceted)).toEqual(cyclesOf(made.plain));
  });
});
