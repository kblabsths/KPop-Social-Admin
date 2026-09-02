import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import DashboardPage from "@/app/page";
import { DASHBOARD_WINDOW } from "@/lib/db/dashboard";
import { T } from "@/lib/db/tables";
import {
  assertParity,
  countOrAbsent,
  countRows,
  exactCount,
  gradeSurface,
  independentClient,
  renderPage,
  whileStill,
} from "./parity";

/**
 * The Dashboard against staging (campaign admin-window/TASK-0009).
 *
 * Acceptance test 2's rule, ARCHITECTURE.md §10: what the page RENDERED is
 * compared with a query THIS TEST issues, written independently of the
 * `lib/db` function the page called. Two paths to one number, or it proves
 * nothing — so nothing below asks `src/lib/db/dashboard.ts` or
 * `src/lib/review/shapes.ts` what it expects. In particular the decision /
 * signal split is spelled out here from the schema (spec §6: an `entity_link`
 * item whose subject is the SOURCE is the signal), not imported.
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
 * admin-window/TASK-0032). The page's three surfaces are graded on their own,
 * each against the kind THIS TEST's own count implies: `ok` compares numbers,
 * `empty` is a pass with a stated 0, `not_provisioned` needs this test's own
 * absence code (`PGRST205` / `42P01`), and `error` is a FAIL naming the read.
 * Nothing is inferred from "no rows rendered", and no card's WORDS are read —
 * `Empty` and `NotProvisioned` draw the same container.
 */

/** Load the page once per assertion; every read happens per request. */
async function dashboardMarkup(): Promise<string> {
  return renderPage(DashboardPage, undefined);
}

/**
 * The page's three surfaces, in the order `src/app/page.tsx` renders them.
 * Structural — no heading text is read, because copy is the designer's.
 */
const ATTENTION = "section:nth-of-type(1)";
const CYCLES = "section:nth-of-type(2)";
const RUNS = "section:nth-of-type(3)";

/**
 * Grade the attention summary against this test's own count of the table
 * behind it.
 *
 * `emptyAtZero: false` states a property of THIS surface: its two figures
 * stand in the same place whether or not anything is open, so a quiet morning
 * is `ok` showing 0 and never the empty card (LOOK_AND_FEEL bar 1). The
 * counted zero still has to be on screen — the parity assertion that follows
 * reads it.
 */
async function gradeAttention(markup: string) {
  return gradeSurface({
    markup,
    within: ATTENTION,
    object: T.reviewItems,
    counted: () => countOrAbsent(() => exactCount(T.reviewItems)),
    emptyAtZero: false,
  });
}

/** The rows of the named table, header-keyed, in rendered order. */
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
      return Object.fromEntries(labels.map((label, index) => [label, cells[index] ?? ""]));
    });
}

/** The ids the rendered lines link to, in rendered order. */
function lineIds(markup: string, parameter: string): string[] {
  const $ = cheerio.load(markup);
  return $(`a[href^="/cycles?${parameter}="]`)
    .toArray()
    .map((element) => $(element).attr("href") ?? "")
    .map((href) => new URL(href, "https://x.invalid").searchParams.get(parameter) ?? "")
    .filter((id, index, all) => all.indexOf(id) === index);
}

describe("the attention summary against staging", () => {
  it("renders the open decision count the database holds", async () => {
    const markup = await dashboardMarkup();
    if ((await gradeAttention(markup)) !== "ok") return;

    await assertParity({
      markup,
      within: ATTENTION,
      label: "Open decisions",
      expected: () =>
        countRows(() =>
          exactCount(T.reviewItems)
            .eq("status", "open")
            // A decision is everything that is not the per-source signal:
            // a `data_conflict` item, or an `entity_link` item about a fact.
            .or(
              "queue.eq.data_conflict,and(queue.eq.entity_link,source_id.is.null)",
            ),
        ),
    });
  });

  it("renders the open signal count the database holds", async () => {
    const markup = await dashboardMarkup();
    if ((await gradeAttention(markup)) !== "ok") return;

    await assertParity({
      markup,
      within: ATTENTION,
      label: "Open signals",
      expected: () =>
        countRows(() =>
          exactCount(T.reviewItems)
            .eq("status", "open")
            .eq("queue", "entity_link")
            .not("source_id", "is", null),
        ),
    });
  });

  it("counts open items alone — the two figures plus the settled ones are the table", async () => {
    const markup = await dashboardMarkup();
    if ((await gradeAttention(markup)) !== "ok") return;

    const whole = await countRows(() => exactCount(T.reviewItems));
    const settled = await countRows(() =>
      exactCount(T.reviewItems).neq("status", "open"),
    );
    const $ = cheerio.load(markup);
    const rendered = $('a[href^="/queues?"]')
      .toArray()
      .map((card) => Number($(card).children().eq(1).text().replace(/,/g, "")));

    expect(rendered).toHaveLength(2);
    expect(rendered.reduce((a, b) => a + b, 0) + settled).toBe(whole);
  });

  it("shows the oldest open item of each kind, as the database orders them", async () => {
    const markup = await dashboardMarkup();
    if ((await gradeAttention(markup)) !== "ok") return;

    for (const [kind, narrow] of [
      [
        "decision",
        (query: ReturnType<typeof openItems>) =>
          query.or("queue.eq.data_conflict,and(queue.eq.entity_link,source_id.is.null)"),
      ],
      [
        "signal",
        (query: ReturnType<typeof openItems>) =>
          query.eq("queue", "entity_link").not("source_id", "is", null),
      ],
    ] as const) {
      const { data, error } = await narrow(openItems())
        .order("opened_at", { ascending: true })
        .limit(1);
      if (error) throw new Error(`the oldest-item query failed: ${error.message}`);
      const oldest = (data ?? [])[0] as { opened_at: string } | undefined;
      const card = cheerio.load(markup)(`a[href*="kind=${kind}"]`);

      if (oldest === undefined) {
        // Nothing open of this kind: no age to show, and no dash pretending
        // there is one.
        expect(card.find("[title]"), kind).toHaveLength(0);
        continue;
      }
      const titles = card
        .find("[title]")
        .toArray()
        .map((element) => cheerio.load(markup)(element).attr("title"));
      expect(titles.length, kind).toBeGreaterThan(0);
      // The title carries the absolute instant of that very row.
      const stamp = new Date(oldest.opened_at);
      const utc = `${stamp.getUTCFullYear()}-${String(stamp.getUTCMonth() + 1).padStart(2, "0")}`;
      expect(titles.join(" "), kind).toContain(utc);
    }
  });
});

/** This test's own read of the cycles window the Dashboard renders. */
async function newestCycles() {
  const { data, error } = await independentClient()
    .from(T.resolutionRuns)
    .select("run_id, started_at, applied, escalated, errors, outcome")
    .order("started_at", { ascending: false })
    .order("run_id", { ascending: false })
    .limit(DASHBOARD_WINDOW);
  if (error) throw new Error(`the cycles query failed: ${JSON.stringify(error)}`);
  return (data ?? []) as {
    run_id: string;
    started_at: string;
    applied: number;
    escalated: number;
    errors: number;
    outcome: string | null;
  }[];
}

/** This test's own read of the runs window the Dashboard renders. */
async function newestRuns() {
  const { data, error } = await independentClient()
    .from(T.runs)
    .select("run_id, source, started_at, outcome, error_summary")
    .order("started_at", { ascending: false })
    .order("run_id", { ascending: false })
    .limit(DASHBOARD_WINDOW);
  if (error) throw new Error(`the runs query failed: ${JSON.stringify(error)}`);
  return (data ?? []) as {
    run_id: string;
    source: string;
    outcome: string | null;
    error_summary: string | null;
  }[];
}

/** The test's own open-items query, before either kind narrows it. */
function openItems() {
  return independentClient()
    .from(T.reviewItems)
    .select("review_item_id, opened_at")
    .eq("status", "open");
}

describe("last night's cycles against staging", () => {
  it("renders the newest cycles, newest first, exactly as the database orders them", async () => {
    // The resolver writes cycles while this runs, so the render and the query
    // are pinned to one still moment (`whileStill`, tests/live/parity.ts): a
    // cycle arriving between them reads as a row the page dropped.
    const { made: markup, held: expected } = await whileStill(
      newestCycles,
      dashboardMarkup,
    );
    // Not provisioned, genuinely empty, or refused: three different kinds, and
    // the surface says which one it is in. Only `ok` has rows to compare.
    const state = await gradeSurface({
      markup,
      within: CYCLES,
      object: T.resolutionRuns,
      counted: () => countOrAbsent(() => exactCount(T.resolutionRuns)),
    });
    if (state !== "ok") return;

    expect(lineIds(markup, "cycle")).toEqual(expected.map((row) => row.run_id));

    // Every number in every rendered row, against the row the database holds.
    const rendered = rowsOf(markup, "cycles");
    expect(rendered).toHaveLength(expected.length);
    rendered.forEach((row, index) => {
      expect(row.applied).toBe(String(expected[index].applied));
      expect(row.escalated).toBe(String(expected[index].escalated));
      expect(row.errors).toBe(String(expected[index].errors));
    });

    // "Newest first" asserted on the values too, not only on the two lists
    // agreeing.
    const stamps = expected.map((row) => Date.parse(row.started_at));
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
  });

  it("shows no more cycles than its window", async () => {
    const { made: markup, held: whole } = await whileStill(
      () => countOrAbsent(() => exactCount(T.resolutionRuns)),
      dashboardMarkup,
    );
    const state = await gradeSurface({
      markup,
      within: CYCLES,
      object: T.resolutionRuns,
      counted: whole,
    });
    if (state !== "ok" || whole === "absent") return;
    expect(rowsOf(markup, "cycles")).toHaveLength(Math.min(whole, DASHBOARD_WINDOW));
  });
});

describe("last night's adapter runs against staging", () => {
  it("renders the newest runs, newest first, with the source the database holds", async () => {
    // Pinned to one still moment, for the reason the cycles case gives.
    const { made: markup, held: expected } = await whileStill(
      newestRuns,
      dashboardMarkup,
    );
    const state = await gradeSurface({
      markup,
      within: RUNS,
      object: T.runs,
      counted: () => countOrAbsent(() => exactCount(T.runs)),
    });
    if (state !== "ok") return;

    expect(lineIds(markup, "run")).toEqual(expected.map((row) => row.run_id));

    const rendered = rowsOf(markup, "runs");
    expect(rendered).toHaveLength(expected.length);
    rendered.forEach((row, index) => {
      expect(row.source).toBe(expected[index].source);
      // The outcome is the producer's own word, rendered verbatim; a run with
      // none is either still running or the table's dash.
      if (expected[index].outcome !== null) {
        expect(row.outcome).toBe(expected[index].outcome);
      }
      // The error line is verbatim — not trimmed, not summarised.
      if (expected[index].error_summary !== null) {
        expect(row.error).toBe(expected[index].error_summary);
      }
    });
  });
});
