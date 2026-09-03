import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import CyclesPage from "@/app/cycles/page";
import { CYCLE_COUNTERS, CYCLE_WINDOW } from "@/lib/db/cycles";
import { T } from "@/lib/db/tables";
import {
  countOrAbsent,
  countRows,
  exactCount,
  gradeSurface,
  independentClient,
  objectIsAbsent,
  readNumber,
  renderPage,
  stateOf,
  whileStill,
} from "./parity";

/**
 * The Cycles & runs page against staging (campaign admin-window/TASK-0014).
 *
 * Acceptance test 2 ("a parity check per page asserts the rendered numbers
 * against direct SQL on staging … cycle rows") and test 11 (the gauges render
 * from staging rows), as ARCHITECTURE.md §10 states the rule: what the page
 * RENDERED is compared with queries THIS TEST issues, written independently of
 * the `lib/db` functions the page called. Two paths to one number, or it
 * proves nothing — so nothing below imports `src/lib/db/cycles.ts` or a gauge
 * module's read, and the newest-first order is re-derived here from
 * `started_at` rather than asked of the module that produced it.
 *
 * (`CYCLE_COUNTERS` and `CYCLE_WINDOW` are imported as the CONTRACT's
 * vocabulary — the eight column names the query asks for and the size of the
 * window the page states — not as an answer: every count compared below comes
 * from this file's own query.)
 *
 * This file WRITES NOTHING, so it needs no sweep (acceptance test 13); every
 * query here is a select.
 *
 * It refuses to run at all until `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SERVICE_ROLE_KEY` are set and `agenticflow/docs/SERVICES.md`
 * declares the target — `tests/live/setup.ts` throws first, non-zero, with the
 * missing name. That refusal is the correct state today and is not a failure
 * of this file.
 *
 * **Every case names the STATE KIND before it compares a number**
 * (ARCHITECTURE.md §10, common violation 6; oracle rewritten by
 * admin-window/TASK-0032). Each surface is graded against the kind THIS TEST's
 * own count implies: `ok` compares numbers, `empty` is a pass with a stated 0,
 * `not_provisioned` needs this test's own absence code, `error` is a FAIL
 * naming the read and the database's code. The cards' words are never read —
 * `Empty` and `NotProvisioned` draw the same container.
 */

type Params = Record<string, string>;

/**
 * The surfaces this file grades, each named by the `data-surface` hook
 * `src/app/cycles/page.tsx` gives it. Structural — no heading text is read.
 * (The runs half is graded by `runs.live.test.ts` through its own hook,
 * `[data-surface="runs"]`.)
 *
 * NAMES, not positions. These three were `section:nth-of-type(1|3|4)` until
 * admin-window/BUG-0056: admin-window/BUG-0040 added a lead section above the
 * cycles and wrapped the runs window in a `<div>`, so `:nth-of-type(1)`
 * matched two surfaces — the new lead, and the runs section that had become
 * the first `section` inside that div — and `stateOf` rightly refused to read
 * a state of two surfaces. The gauges' selectors survived only by luck (+1
 * section above, -1 below, cancelling). A hook does not move when the page is
 * rearranged, which is the whole point: `stateOf` still demands exactly one
 * match, and now a reorder cannot silently hand it a different surface.
 */
const CYCLES = '[data-surface="cycles"]';
const HEALTH = '[data-surface="cycle_health"]';
const LATENCY = '[data-surface="resolution_latency"]';

/**
 * Every surface hook this page is expected to carry, including the lead
 * section this file does not otherwise grade and the runs window
 * `runs.live.test.ts` owns. Asserted to be present and UNIQUE before any of
 * them is graded, so the next reorder fails as one legible assertion here
 * rather than as four `MarkupReadError`s scattered across the file.
 */
const SURFACES = [
  '[data-surface="latest_run"]',
  CYCLES,
  '[data-surface="runs"]',
  HEALTH,
  LATENCY,
];

interface StagingCycle {
  run_id: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  errors: number;
  error_summary: string | null;
}

/** The page as the URL renders it. Every read happens per request. */
async function cyclesMarkup(params: Params = {}): Promise<string> {
  return renderPage(CyclesPage, { searchParams: Promise.resolve(params) });
}

/** The cycle rows the page rendered, as their hooks and counter cells. */
function renderedCycles(markup: string) {
  const $ = cheerio.load(markup);
  return $("[data-cycle]")
    .toArray()
    .map((element) => {
      const marker = $(element);
      const row = marker.closest("tr");
      const counts: Record<string, string> = {};
      row.find("[data-cycle-count]").each((_, cell) => {
        counts[$(cell).attr("data-cycle-count") ?? ""] = $(cell).text().trim();
      });
      return {
        runId: marker.attr("data-cycle") ?? "",
        state: marker.attr("data-cycle-state"),
        outcome: marker.attr("data-cycle-outcome"),
        startedAt: row.find("[data-cycle-started]").attr("data-cycle-started"),
        error: row.find("[data-cycle-error]").text().trim(),
        counts,
      };
    });
}

/** One gauge's window, as the page states it. */
function windowOf(markup: string, gauge: string) {
  const line = cheerio.load(markup)(`[data-window="${gauge}"]`);
  return {
    present: line.length > 0,
    since: line.attr("data-window-since") ?? "",
    truncated: line.attr("data-window-truncated") === "true",
  };
}

/** The newest cycles, read by THIS TEST, in the order it expects them. */
async function stagingCycles(limit: number): Promise<StagingCycle[]> {
  const { data, error } = await independentClient()
    .from(T.resolutionRuns)
    .select("run_id, started_at, ended_at, outcome, errors, error_summary")
    .order("started_at", { ascending: false })
    .order("run_id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`the cycles query failed: ${JSON.stringify(error)}`);
  return (data ?? []) as StagingCycle[];
}

describe("the resolver's cycles against staging", () => {
  it("names every surface on the page once, whatever order they are in", async () => {
    // The oracle's addressing itself, asserted before it is used: each hook
    // has to reach exactly one element, which is the precondition `stateOf`
    // enforces per call. Rendered with a facet as well as bare, because the
    // `?source=` and `?cycle=` branches add sentences and swap the lead's
    // whole body — none of that may duplicate or drop a surface
    // (admin-window/BUG-0056).
    const $bare = cheerio.load(await cyclesMarkup());
    const $faceted = cheerio.load(await cyclesMarkup({ source: "ticketmaster" }));
    for (const hook of SURFACES) {
      expect($bare(hook).length, hook).toBe(1);
      expect($faceted(hook).length, hook).toBe(1);
    }
  });

  it("renders the newest cycles, newest first, as the table holds them", async () => {
    // The resolver writes cycles while this runs, so the render and the query
    // are pinned to one still moment (`whileStill`) — otherwise a row arriving
    // between them reads as a row the page dropped.
    const { made: markup, held } = await whileStill(
      () => stagingCycles(CYCLE_WINDOW),
      () => cyclesMarkup(),
    );
    // Absent, empty or refused: three different kinds, and this test decides
    // which one it expects from its own count before reading the page.
    const state = await gradeSurface({
      markup,
      within: CYCLES,
      object: T.resolutionRuns,
      counted: () => countOrAbsent(() => exactCount(T.resolutionRuns)),
    });
    if (state !== "ok") return;

    const rendered = renderedCycles(markup);
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

  it("renders every count and every error line the row carries", async () => {
    const markup = await cyclesMarkup();
    if (stateOf(markup, CYCLES) !== "ok") return;
    const rendered = renderedCycles(markup);

    for (const row of rendered.slice(0, 20)) {
      const { data, error } = await independentClient()
        .from(T.resolutionRuns)
        .select(["run_id", ...CYCLE_COUNTERS, "error_summary"].join(", "))
        .eq("run_id", row.runId)
        .limit(1);
      if (error) throw new Error(`the counters query failed: ${JSON.stringify(error)}`);
      const held = ((data ?? []) as unknown as Record<string, number | string | null>[])[0];
      expect(held, row.runId).toBeDefined();

      for (const counter of CYCLE_COUNTERS) {
        // The page renders the figure thousand-separated; the comparison is
        // against the NUMBER, so a formatting change never reddens parity.
        expect(Number(row.counts[counter].replace(/,/g, "")), `${row.runId}.${counter}`).toBe(
          held[counter],
        );
      }
      // `error_summary` is inline and verbatim, or absent — never trimmed and
      // never replaced with a sentence of the app's own.
      expect(row.error, row.runId).toBe(
        held.error_summary === null ? "" : String(held.error_summary),
      );
    }
  });

  it("reads a running, a skipped and a dead cycle as what they are", async () => {
    const markup = await cyclesMarkup();
    if (stateOf(markup, CYCLES) !== "ok") return;
    const rendered = renderedCycles(markup);

    const held = new Map(
      (await stagingCycles(CYCLE_WINDOW)).map((row) => [row.run_id, row]),
    );
    for (const row of rendered) {
      const source = held.get(row.runId);
      expect(source, row.runId).toBeDefined();
      if (source === undefined) continue;

      if (source.outcome !== null) {
        // The producer's own word, verbatim — including `skipped`, which is a
        // healthy outcome and never a failure.
        expect(row.state, row.runId).toBe("outcome");
        expect(row.outcome, row.runId).toBe(source.outcome);
      } else if (source.ended_at !== null) {
        expect(row.state, row.runId).toBe("unrecorded");
      } else {
        // A null `ended_at` is running or dead depending only on its age
        // against the resolver's cadence (migration 20260901000001).
        expect(["running", "died"], row.runId).toContain(row.state);
      }
    }
  });

  it("marks the cycle a Dashboard link asks for", async () => {
    const markup = await cyclesMarkup();
    if (stateOf(markup, CYCLES) !== "ok") return;
    const one = renderedCycles(markup)[0].runId;
    const marked = cheerio.load(await cyclesMarkup({ cycle: one }));
    expect(marked(`[data-cycle="${one}"]`).attr("aria-current")).toBe("true");
    expect(marked('[data-cycle-found="true"]').attr("data-cycle-asked")).toBe(one);
  });
});

describe("the two gauges on this page against staging", () => {
  it("counts the cycles of its window as the table holds them", async () => {
    const markup = await cyclesMarkup();
    const window = windowOf(markup, "cycle_health");
    const state = await gradeSurface({
      markup,
      within: HEALTH,
      object: T.resolutionRuns,
      counted: async () => {
        if (!window.present) {
          return (await objectIsAbsent(T.resolutionRuns)) ? "absent" : 0;
        }
        return countRows(() =>
          exactCount(T.resolutionRuns).gte("started_at", window.since),
        );
      },
      emptyAtZero: false,
      figure: "Cycles in this window",
    });
    if (state !== "ok") return;
    // A truncated window makes every count a floor, and a floor is not a
    // parity claim — the page says so, and this test believes it.
    if (window.truncated) return;

    const expected = await countRows(() =>
      exactCount(T.resolutionRuns).gte("started_at", window.since),
    );
    // `readNumber` reads the figure STRUCTURALLY — the number standing beside
    // its label — so a restyle or a copy change never reddens this parity.
    expect(readNumber(markup, "Cycles in this window")).toBe(expected);
  });

  it("separates the applies it measured from the decisions that name no claim", async () => {
    const markup = await cyclesMarkup();
    const window = windowOf(markup, "resolution_latency");
    const state = await gradeSurface({
      markup,
      within: LATENCY,
      object: T.fieldProvenance,
      counted: async () => {
        if (!window.present) {
          return (await objectIsAbsent(T.fieldProvenance)) ? "absent" : 0;
        }
        return countRows(() =>
          exactCount(T.fieldProvenance).gte("applied_at", window.since),
        );
      },
      emptyAtZero: false,
      figure: "Applies in this window",
    });
    if (state !== "ok") return;
    if (window.truncated) return;

    // This test's own split of the same window: a decision that names an
    // observation is an apply, one that names none is not (migration
    // 20260901000005; admin-window/BUG-0012). The two counts must not be the
    // same number unless staging really holds no unsets.
    const applies = await countRows(() =>
      exactCount(T.fieldProvenance)
        .gte("applied_at", window.since)
        .not("observation_id", "is", null),
    );
    const decisions = await countRows(() =>
      exactCount(T.fieldProvenance).gte("applied_at", window.since),
    );

    expect(readNumber(markup, "Applies in this window")).toBe(applies);
    expect(readNumber(markup, "Unset by a human decision")).toBe(decisions - applies);
  });
});
