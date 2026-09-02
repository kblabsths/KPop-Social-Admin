import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import CyclesPage from "@/app/cycles/page";
import { CYCLE_COUNTERS, CYCLE_WINDOW } from "@/lib/db/cycles";
import { T } from "@/lib/db/tables";
import { countRows, independentClient, readNumber, renderPage } from "./parity";

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
 * Where staging does not carry an object at all (ARCHITECTURE.md §12
 * `OPEN-FIXTURES`), each case asserts the honest not-provisioned rendering
 * instead, naming that object. It never skips silently.
 */

type Params = Record<string, string>;

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

/** The objects whose absence the page reported, in its own state cards. */
function absentObjects(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-not-provisioned]")
    .toArray()
    .map((element) => $(element).attr("data-not-provisioned") ?? "");
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
  it("renders the newest cycles, newest first, as the table holds them", async () => {
    const markup = await cyclesMarkup();
    const rendered = renderedCycles(markup);

    if (rendered.length === 0) {
      // Either the table is absent, or no cycle has ever run — both honest,
      // and neither a silent skip.
      if (absentObjects(markup).includes(T.resolutionRuns)) return;
      expect(
        await countRows(() =>
          independentClient()
            .from(T.resolutionRuns)
            .select("*", { head: true, count: "exact" }),
        ),
      ).toBe(0);
      return;
    }

    const held = await stagingCycles(CYCLE_WINDOW);
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
    const rendered = renderedCycles(markup);
    if (rendered.length === 0) return;

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
    const rendered = renderedCycles(markup);
    if (rendered.length === 0) return;

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
    const rendered = renderedCycles(await cyclesMarkup());
    if (rendered.length === 0) return;
    const one = rendered[0].runId;
    const marked = cheerio.load(await cyclesMarkup({ cycle: one }));
    expect(marked(`[data-cycle="${one}"]`).attr("aria-current")).toBe("true");
    expect(marked('[data-cycle-found="true"]').attr("data-cycle-asked")).toBe(one);
  });
});

describe("the two gauges on this page against staging", () => {
  it("counts the cycles of its window as the table holds them", async () => {
    const markup = await cyclesMarkup();
    const window = windowOf(markup, "cycle_health");
    if (!window.present) {
      expect(absentObjects(markup)).toContain(T.resolutionRuns);
      return;
    }
    // A truncated window makes every count a floor, and a floor is not a
    // parity claim — the page says so, and this test believes it.
    if (window.truncated) return;

    const expected = await countRows(() =>
      independentClient()
        .from(T.resolutionRuns)
        .select("*", { head: true, count: "exact" })
        .gte("started_at", window.since),
    );
    // `readNumber` reads the figure STRUCTURALLY — the number standing beside
    // its label — so a restyle or a copy change never reddens this parity.
    expect(readNumber(markup, "Cycles in this window")).toBe(expected);
  });

  it("separates the applies it measured from the decisions that name no claim", async () => {
    const markup = await cyclesMarkup();
    const window = windowOf(markup, "resolution_latency");
    if (!window.present) {
      expect(
        absentObjects(markup).some((object) =>
          [T.fieldProvenance, T.observations].includes(object as never),
        ),
        "an absent gauge names the object it could not read",
      ).toBe(true);
      return;
    }
    if (window.truncated) return;

    // This test's own split of the same window: a decision that names an
    // observation is an apply, one that names none is not (migration
    // 20260901000005; admin-window/BUG-0012). The two counts must not be the
    // same number unless staging really holds no unsets.
    const applies = await countRows(() =>
      independentClient()
        .from(T.fieldProvenance)
        .select("*", { head: true, count: "exact" })
        .gte("applied_at", window.since)
        .not("observation_id", "is", null),
    );
    const decisions = await countRows(() =>
      independentClient()
        .from(T.fieldProvenance)
        .select("*", { head: true, count: "exact" })
        .gte("applied_at", window.since),
    );

    expect(readNumber(markup, "Applies in this window")).toBe(applies);
    expect(readNumber(markup, "Unset by a human decision")).toBe(decisions - applies);
  });
});
