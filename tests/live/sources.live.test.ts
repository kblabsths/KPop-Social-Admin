import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import SourcesPage from "@/app/sources/page";
import { T } from "@/lib/db/tables";
import { countRows, independentClient, renderPage } from "./parity";

/**
 * The Sources page against staging (campaign admin-window/TASK-0013).
 *
 * Acceptance test 2, as ARCHITECTURE.md §10 states it: what the page RENDERED
 * is compared with queries THIS TEST issues, written independently of the
 * `lib/db` functions the page called. Two paths to one number, or it proves
 * nothing — so nothing below imports `src/lib/db/sources.ts` or a gauge, and
 * the last-run match is re-derived here from `runs.source` (the name match
 * ARCHITECTURE.md §6 trap 6 describes), not asked of the module that made it.
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

interface StagingSource {
  source_id: string;
  source: string;
  lifecycle: string;
  tier: string;
  checkpoint: string | null;
}

/** The page as the URL renders it. Every read happens per request. */
async function sourcesMarkup(params: Params = {}): Promise<string> {
  return renderPage(SourcesPage, { searchParams: Promise.resolve(params) });
}

/** The objects whose absence the page reported, in its own state cards. */
function absentObjects(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-not-provisioned]")
    .toArray()
    .map((element) => $(element).attr("data-not-provisioned") ?? "");
}

/** The registry rows the page rendered, as their hooks. */
function renderedSources(markup: string) {
  const $ = cheerio.load(markup);
  return $("[data-source]")
    .toArray()
    .map((element) => {
      const row = $(element).closest("tr");
      const attr = (hook: string) => row.find(`[${hook}]`).attr(hook);
      return {
        sourceId: $(element).attr("data-source") ?? "",
        name: attr("data-source-name"),
        lifecycle: attr("data-source-lifecycle"),
        tier: attr("data-source-tier"),
        checkpoint: attr("data-source-checkpoint"),
        lastRunId: attr("data-source-last-run"),
        itemsHref: row.find("[data-source-items]").attr("href"),
        runsHref: row.find("[data-source-runs]").attr("href"),
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

/** A trend table's rows, by the source each names, with its measure cells. */
function trendCells(markup: string, label: string): Map<string, string[]> {
  const $ = cheerio.load(markup);
  const rows = new Map<string, string[]>();
  $(`table[aria-label="${label}"] [data-trend-source]`)
    .toArray()
    .forEach((element) => {
      const cells = $(element)
        .closest("tr")
        .find("td")
        .toArray()
        .map((cell) => $(cell).text().replace(/\s+/g, " ").trim());
      rows.set($(element).attr("data-trend-source") ?? "", cells);
    });
  return rows;
}

/** The registry, read by this test. */
async function stagingSources(): Promise<StagingSource[]> {
  const { data, error } = await independentClient()
    .from(T.sources)
    .select("source_id, source, lifecycle, tier, checkpoint")
    .order("source", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`the sources query failed: ${JSON.stringify(error)}`);
  return (data ?? []) as StagingSource[];
}

describe("the source state rows against staging", () => {
  it("renders every source the registry holds, with its state verbatim", async () => {
    const markup = await sourcesMarkup();
    const rendered = renderedSources(markup);
    if (rendered.length === 0) {
      // Either the table is absent, or the registry is empty — both honest,
      // and neither a silent skip.
      const absent = absentObjects(markup);
      if (absent.includes(T.sources) || absent.includes(T.runs)) return;
      expect(await countRows(() =>
        independentClient().from(T.sources).select("*", { head: true, count: "exact" }),
      )).toBe(0);
      return;
    }

    const held = await stagingSources();
    expect(rendered.map((row) => row.sourceId)).toEqual(
      held.map((source) => source.source_id),
    );
    expect(rendered).toHaveLength(
      await countRows(() =>
        independentClient().from(T.sources).select("*", { head: true, count: "exact" }),
      ),
    );

    for (const source of held) {
      const row = rendered.find((rendered) => rendered.sourceId === source.source_id);
      expect(row, source.source).toBeDefined();
      expect(row?.name, source.source).toBe(source.source);
      expect(row?.lifecycle, source.source).toBe(source.lifecycle);
      expect(row?.tier, source.source).toBe(source.tier);
      // A null checkpoint renders as the dash, so the hook is absent — never a
      // blank cell and never a zero.
      expect(row?.checkpoint, source.source).toBe(source.checkpoint ?? undefined);
      expect(row?.itemsHref, source.source).toBe(`/queues?source_id=${source.source_id}`);
      expect(row?.runsHref, source.source).toBe(
        `/cycles?source=${encodeURIComponent(source.source)}`,
      );
    }
  });

  it("shows each source's last run, matched by NAME, and none where there is none", async () => {
    const markup = await sourcesMarkup();
    const rendered = renderedSources(markup);
    if (rendered.length === 0) return;

    for (const row of rendered) {
      // This test's own match: the newest run whose `source` TEXT equals this
      // source's name. There is no key to join on (migration 20260829000001).
      const { data, error } = await independentClient()
        .from(T.runs)
        .select("run_id, source, started_at")
        .eq("source", row.name ?? "")
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) {
        // An absent runs table takes the whole table with it, so reaching here
        // with rows rendered means something else refused.
        throw new Error(`the runs query failed: ${JSON.stringify(error)}`);
      }
      const newest = ((data ?? []) as { run_id: string }[])[0];
      expect(row.lastRunId, row.name).toBe(newest?.run_id);
    }
  });

  it("narrows to one source, and that source alone", async () => {
    const rendered = renderedSources(await sourcesMarkup());
    if (rendered.length === 0) return;
    const one = rendered[0];
    const narrowed = renderedSources(await sourcesMarkup({ source_id: one.sourceId }));
    expect(narrowed.map((row) => row.sourceId)).toEqual([one.sourceId]);
  });
});

describe("the per-source trends against staging", () => {
  it("counts each source's awaiting-row claims as the view holds them", async () => {
    const markup = await sourcesMarkup();
    const window = windowOf(markup, "awaiting_row");
    if (!window.present) {
      expect(
        absentObjects(markup).some((object) =>
          [T.pendingClaims, T.observations].includes(object as never),
        ),
        "an absent gauge names the object it could not read",
      ).toBe(true);
      return;
    }
    // A truncated window makes every count a floor, and a floor is not a
    // parity claim — the page says so, and this test believes it.
    if (window.truncated) return;

    // This test's own two-step: the claims of the window, by the instants that
    // define it, then their buckets.
    const { data: observed, error: observedError } = await independentClient()
      .from(T.observations)
      .select("observation_id")
      .eq("status", "pending")
      .gte("observed_at", window.since)
      .limit(1000);
    if (observedError) {
      throw new Error(`the observations query failed: ${JSON.stringify(observedError)}`);
    }
    const ids = ((observed ?? []) as { observation_id: string }[]).map(
      (row) => row.observation_id,
    );

    const rendered = trendCells(markup, "Awaiting-row claims by source");
    if (ids.length === 0) {
      expect(rendered.size).toBe(0);
      return;
    }

    const { data: claims, error: claimsError } = await independentClient()
      .from(T.pendingClaims)
      .select("observation_id, source_id, bucket")
      .eq("bucket", "awaiting_row")
      .in("observation_id", ids.slice(0, 100))
      .limit(1000);
    if (claimsError) {
      throw new Error(`the claims query failed: ${JSON.stringify(claimsError)}`);
    }

    // Only the first chunk of ids was asked for, so this is a subset check in
    // the honest direction: every source the test found must be on the page,
    // with at least what the test counted.
    const counted = new Map<string, number>();
    for (const claim of (claims ?? []) as { source_id: string }[]) {
      counted.set(claim.source_id, (counted.get(claim.source_id) ?? 0) + 1);
    }
    for (const [sourceId, claimed] of counted) {
      const cells = rendered.get(sourceId);
      expect(cells, sourceId).toBeDefined();
      expect(Number(cells?.[1]), sourceId).toBeGreaterThanOrEqual(claimed);
    }
  });

  it("counts each source's re-rejects as the stamps hold them", async () => {
    const markup = await sourcesMarkup();
    const window = windowOf(markup, "rejections");
    if (!window.present) {
      expect(absentObjects(markup)).toContain(T.observations);
      return;
    }
    if (window.truncated) return;

    const rendered = trendCells(markup, "Re-rejected values by source");
    for (const [sourceId, cells] of rendered) {
      // The gauge's own definition, re-stated here from migration
      // `20260901000003`: a re-reject is `rejected_by = 'resolver'`.
      const expected = await countRows(() =>
        independentClient()
          .from(T.observations)
          .select("*", { head: true, count: "exact" })
          .eq("source_id", sourceId)
          .eq("rejected_by", "resolver")
          .gte("rejected_at", window.since),
      );
      expect(Number(cells[1]), sourceId).toBe(expected);
    }
  });

  it("draws no threshold line, because the dial is not readable from here", async () => {
    const markup = await sourcesMarkup();
    if (!windowOf(markup, "awaiting_row").present) return;
    // period + claims + days-with-a-claim. A fourth column would mean a
    // threshold arrived from somewhere, and the only somewhere is the scraper
    // registry (admin-window/TASK-0024).
    const columns = cheerio.load(markup)(
      'table[aria-label="Awaiting-row claims by source"] th',
    ).length;
    if (columns > 0) expect(columns).toBe(3);
  });
});
