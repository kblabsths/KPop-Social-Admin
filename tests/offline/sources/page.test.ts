import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import { render } from "../ui/markup";
import {
  PENDING_CLAIMS,
  PENDING_OBSERVATIONS,
  REJECTIONS,
  RUN,
  RUNS,
  SOURCE,
  SOURCES,
  adjudications,
  awaitingRowClaims,
  daysAgo,
  newestRunFor,
  rerejects,
  runsResponseFor,
} from "./population";
import { observationRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
} from "../../fixtures/stub-client";

/**
 * The Sources page, rendered (campaign admin-window/TASK-0013).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await SourcesPage(props))` — no jsdom, no Testing
 * Library, no database. Every read is stubbed at its module boundary, so all
 * four states are reachable offline.
 *
 * **Every expectation is computed here, from the fixture population, with this
 * file's own predicates** (`newestRunFor`, `rerejects`, `awaitingRowClaims` in
 * `./population.ts`). Asking `src/lib/db/sources.ts` what it expects would
 * only prove the page calls it.
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which sources render, which run is
 * theirs, which state a failed read produces, where a link goes — plus the
 * machine's own strings where rendering them VERBATIM is the requirement (the
 * lifecycle, the tier, the checkpoint, the missing table). No class name and
 * no copy of the app's own words is pinned.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

/**
 * A prepared answer for the awaiting-row trend, for the one case the fixtures
 * cannot express: a series whose stuck-pattern dial IS readable. The seam is a
 * module-private map in `lib/gauges/pending-claims.ts` and is empty by ruling
 * (admin-window/TASK-0024), so the only honest way to exercise the page's other
 * branch is to hand it the shape that seam will one day produce. Unset for
 * every other test, which then reads the real aggregate.
 */
const trendAnswer = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@/lib/db/sources", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/sources")>();
  return { ...actual, listSources: () => actual.listSources(readWith.client as never) };
});

vi.mock("@/lib/gauges/pending-claims", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/pending-claims")>();
  return {
    ...actual,
    readAwaitingRowTrend: (options?: unknown) =>
      trendAnswer.value ??
      actual.readAwaitingRowTrend((options ?? {}) as never, readWith.client as never),
  };
});

vi.mock("@/lib/gauges/settled-values", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/settled-values")>();
  return {
    ...actual,
    readRejectionStampGauge: (options?: unknown) =>
      actual.readRejectionStampGauge((options ?? {}) as never, readWith.client as never),
  };
});

const sourcesModule = await import("@/app/sources/page");
const SourcesPage = sourcesModule.default;

/* ── rendering ───────────────────────────────────────────────────────────── */

/**
 * A database holding the whole population.
 *
 * The reads happen in a fixed order, which is what the queued responses
 * follow: the registry, then one `runs` read per source (in the registry's own
 * order), then the awaiting-row trend's two legs (`observations`, then
 * `pending_claims`), then the rejection gauge's two (`observations`, then the
 * `sources` lookup behind the per-source split).
 *
 * The `runs` queue is derived by THIS FILE from the run population, filtered
 * by name — the answer a database would give to the query the module issues.
 * That the module actually issues that query (the name, the order, the cap) is
 * asserted separately, off the recorded calls, so the pairing cannot be a
 * coincidence of ordering.
 */
function healthyScript(overrides: Script = {}): Script {
  return {
    [T.sources]: [
      { data: [...SOURCES], count: SOURCES.length },
      { data: [...SOURCES] },
    ],
    [T.runs]: SOURCES.map((source) => ({ data: runsResponseFor(source.source) })),
    [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: [...REJECTIONS] }],
    [T.pendingClaims]: { data: [...PENDING_CLAIMS] },
    ...overrides,
  };
}

async function renderSources(
  script: Script,
  params: Record<string, string | string[]> = {},
): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await SourcesPage({ searchParams: Promise.resolve(params) }));
}

/* ── reading the markup, structurally ────────────────────────────────────── */

/** The source ids the registry table rendered, in rendered order. */
function sourceIds(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-source]")
    .toArray()
    .map((element) => $(element).attr("data-source") ?? "");
}

/** One registry row, as its hooks and its cell texts. */
function sourceRowOf(markup: string, sourceId: string) {
  const $ = cheerio.load(markup);
  const row = $(`[data-source="${sourceId}"]`).closest("tr");
  const cell = (hook: string) => row.find(`[${hook}]`).attr(hook);
  return {
    name: row.find("[data-source-name]").attr("data-source-name"),
    kind: cell("data-source-kind"),
    lifecycle: cell("data-source-lifecycle"),
    tier: cell("data-source-tier"),
    checkpoint: cell("data-source-checkpoint"),
    lastRunId: cell("data-source-last-run"),
    lastRunAt: cell("data-source-last-run-at"),
    outcome: cell("data-source-outcome"),
    runState: cell("data-source-run-state"),
    note: row.find("[data-source-note]").text().trim(),
    itemsHref: row.find("[data-source-items]").attr("href"),
    runsHref: row.find("[data-source-runs]").attr("href"),
    narrowHref: row.find("[data-source]").attr("href"),
    titles: row
      .find("[title]")
      .toArray()
      .map((element) => $(element).attr("title")),
    text: row.text().replace(/\s+/g, " ").trim(),
  };
}

/** The cells of one trend row, by the source it names: the measures, in order. */
function trendRow(markup: string, label: string, sourceId: string): string[] {
  const $ = cheerio.load(markup);
  const table = $(`table[aria-label="${label}"]`);
  const row = table.find(`[data-trend-source="${sourceId}"]`).closest("tr");
  return row
    .find("td")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim());
}

/** The source ids a trend table listed, in rendered order. */
function trendSources(markup: string, label: string): string[] {
  const $ = cheerio.load(markup);
  return $(`table[aria-label="${label}"] [data-trend-source]`)
    .toArray()
    .map((element) => $(element).attr("data-trend-source") ?? "");
}

/** How many columns a table rendered. */
function columnCount(markup: string, label: string): number {
  return cheerio.load(markup)(`table[aria-label="${label}"] th`).length;
}

/** Every row of a table, as its cell texts. */
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

/** The narrowing chips: their labels, hrefs and active state. */
function chips(markup: string) {
  const $ = cheerio.load(markup);
  return $(`[data-facet="source_id"] a`)
    .toArray()
    .map((element) => ({
      label: $(element).text().trim(),
      href: $(element).attr("href") ?? "",
      active: $(element).attr("aria-current") === "true",
    }));
}

/**
 * Everything the settled-values section SAYS, minus its window line.
 *
 * The window line carries `until` — the instant of the render — so it differs
 * between two renders by construction; every other word in the section is a
 * function of the rows alone. Selected by the gauge's own `data-window` hook
 * rather than by a heading, so no copy is pinned.
 */
function settledValuesSays(markup: string): string {
  const $ = cheerio.load(markup);
  const section = $('[data-window="rejections"]').closest("section");
  section.find("[data-window]").remove();
  return section.text().replace(/\s+/g, " ").trim();
}

const AWAITING_BY_SOURCE = "Awaiting-row claims by source";
const AWAITING_BY_DAY = "Awaiting-row claims by day";
const REJECTED_BY_SOURCE = "Re-rejected values by source";
const REJECTED_BY_WEEK = "Re-rejected values by week";

/* ── the state rows ──────────────────────────────────────────────────────── */

describe("the registry, rendered", () => {
  it("renders every source the registry holds, in the read's order", async () => {
    const markup = await renderSources(healthyScript());
    expect(sourceIds(markup)).toEqual(SOURCES.map((source) => source.source_id));
  });

  it("renders each source's lifecycle, tier, kind and checkpoint verbatim", async () => {
    const markup = await renderSources(healthyScript());
    for (const source of SOURCES) {
      const row = sourceRowOf(markup, source.source_id);
      expect(row.name, source.source).toBe(source.source);
      expect(row.lifecycle, source.source).toBe(source.lifecycle);
      expect(row.tier, source.source).toBe(source.tier);
      expect(row.kind, source.source).toBe(source.kind);
      expect(row.checkpoint, source.source).toBe(source.checkpoint ?? undefined);
      // The database's own words, unparaphrased.
      expect(row.text, source.source).toContain(source.lifecycle);
      expect(row.text, source.source).toContain(source.tier);
    }
  });

  it("renders a source with no checkpoint as the dash, not a blank", async () => {
    const markup = await renderSources(healthyScript());
    const row = sourceRowOf(markup, SOURCE.bandsintown);
    expect(row.checkpoint).toBeUndefined();
    expect(row.text).toContain(EM_DASH);
  });

  it("matches each source's last run by NAME", async () => {
    const markup = await renderSources(healthyScript());
    for (const source of SOURCES) {
      const expected = newestRunFor(source.source);
      const row = sourceRowOf(markup, source.source_id);
      expect(row.lastRunId, source.source).toBe(expected?.run_id);
      expect(row.lastRunAt, source.source).toBe(expected?.started_at);
    }
  });

  it("asks the runs table for each source's newest run, by name, one row", async () => {
    // The pairing above must not be an accident of response ordering: the
    // query itself carries the name, the newest-first order and the cap.
    const client = stubClient(healthyScript());
    readWith.client = client.asSupabaseClient();
    await render(await SourcesPage({ searchParams: Promise.resolve({}) }));

    const runCalls = client.calls.filter((call) => call.table === T.runs);
    expect(runCalls).toHaveLength(SOURCES.length);
    runCalls.forEach((call, index) => {
      const steps = new Map(call.steps.map((step) => [step.method, step.args]));
      expect(steps.get("eq"), `call ${index}`).toEqual([
        "source",
        SOURCES[index].source,
      ]);
      expect(call.steps.filter((step) => step.method === "order")[0].args).toEqual([
        "started_at",
        { ascending: false },
      ]);
      expect(steps.get("limit")).toEqual([1]);
    });
  });

  it("renders a source that has never run as the dash — not a blank, not a zero", async () => {
    const markup = await renderSources(healthyScript());
    expect(newestRunFor("bandsintown")).toBeNull();
    const row = sourceRowOf(markup, SOURCE.bandsintown);
    expect(row.lastRunId).toBeUndefined();
    expect(row.outcome).toBeUndefined();
    expect(row.text).toContain(EM_DASH);
    expect(row.text).not.toMatch(/\b0\b/);
  });

  it("never shows a run whose source name is in no registry row", async () => {
    const markup = await renderSources(healthyScript());
    expect(RUNS.some((run) => run.run_id === RUN.orphan)).toBe(true);
    expect(markup).not.toContain(RUN.orphan);
    expect(markup).not.toContain("eventbrite");
  });

  it("reads a run still in flight as running, with no outcome invented", async () => {
    const markup = await renderSources(healthyScript());
    const row = sourceRowOf(markup, SOURCE.fandom);
    expect(row.lastRunId).toBe(RUN.fandomInFlight);
    expect(row.outcome).toBeUndefined();
    expect(row.runState).toBe("running");
  });

  it("shows the run's age relatively, with the absolute instant in the title", async () => {
    const markup = await renderSources(healthyScript());
    const row = sourceRowOf(markup, SOURCE.ticketmaster);
    // 2026-09-01T03:00:00Z, as the app spells an absolute UTC instant.
    expect(row.titles).toContain("2026-09-01 03:00 UTC");
  });

  it("renders the source's note when it has one, and the dash when it has not", async () => {
    const markup = await renderSources(healthyScript());
    const paused = SOURCES.find((source) => source.source_id === SOURCE.bandsintown);
    expect(sourceRowOf(markup, SOURCE.bandsintown).note).toBe(paused?.note);
    expect(sourceRowOf(markup, SOURCE.fandom).note).toBe("");
  });
});

/* ── where a source leads ────────────────────────────────────────────────── */

describe("a source's links", () => {
  it("links to its review items and to its runs, as real URLs", async () => {
    const markup = await renderSources(healthyScript());
    for (const source of SOURCES) {
      const row = sourceRowOf(markup, source.source_id);
      expect(row.itemsHref, source.source).toBe(`/queues?source_id=${source.source_id}`);
      // Runs are matched by NAME, so the runs link carries the name.
      expect(row.runsHref, source.source).toBe(`/cycles?source=${source.source}`);
    }
  });

  it("narrows this page to one source, and back out again", async () => {
    const markup = await renderSources(healthyScript());
    expect(sourceRowOf(markup, SOURCE.fandom).narrowHref).toBe(
      `/sources?source_id=${SOURCE.fandom}`,
    );

    const narrowed = await renderSources(healthyScript(), {
      source_id: SOURCE.fandom,
    });
    expect(sourceIds(narrowed)).toEqual([SOURCE.fandom]);
    // Clicking the source you are already in clears the narrowing.
    expect(sourceRowOf(narrowed, SOURCE.fandom).narrowHref).toBe("/sources");
  });

  it("offers one chip per source, plus the one that clears the narrowing", async () => {
    const narrowed = await renderSources(healthyScript(), {
      source_id: SOURCE.ticketmaster,
    });
    const rendered = chips(narrowed);
    expect(rendered.map((chip) => chip.href)).toEqual([
      "/sources",
      ...SOURCES.map((source) => `/sources?source_id=${source.source_id}`),
    ]);
    expect(rendered.filter((chip) => chip.active).map((chip) => chip.href)).toEqual([
      `/sources?source_id=${SOURCE.ticketmaster}`,
    ]);
  });

  it("narrows nothing when the URL names a source the registry does not hold", async () => {
    // A hand-typed id lands on the whole registry, not on a blank page that
    // reads like an empty database.
    const markup = await renderSources(healthyScript(), { source_id: "nobody" });
    expect(sourceIds(markup)).toEqual(SOURCES.map((source) => source.source_id));
  });

  it("takes the first value when the URL repeats the facet", async () => {
    const markup = await renderSources(healthyScript(), {
      source_id: [SOURCE.fandom, SOURCE.ticketmaster],
    });
    expect(sourceIds(markup)).toEqual([SOURCE.fandom]);
  });
});

/* ── the four states ─────────────────────────────────────────────────────── */

describe("the four data-surface states", () => {
  it("names `sources` when the registry table is not in this database", async () => {
    const markup = await renderSources(
      healthyScript({ [T.sources]: { error: tableNotInSchemaCache(T.sources) } }),
    );
    expect(notProvisioned(markup)).toContain(T.sources);
    expect(sourceIds(markup)).toEqual([]);
  });

  it("names `runs` when the run table is not in this database", async () => {
    // The two legs report separately: an absent `runs` must not be reported as
    // an absent `sources`, and must not read as "these sources never ran".
    const markup = await renderSources(
      healthyScript({ [T.runs]: { error: tableNotInSchemaCache(T.runs) } }),
    );
    expect(notProvisioned(markup)).toContain(T.runs);
    expect(notProvisioned(markup)).not.toContain(T.sources);
    expect(sourceIds(markup)).toEqual([]);
  });

  it("shows the database's own words when the registry read fails", async () => {
    const markup = await renderSources(
      healthyScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
    );
    expect(readsFailed(markup)).toContain(T.sources);
    expect(markup).toContain(`permission denied for table ${T.sources}`);
    expect(sourceIds(markup)).toEqual([]);
  });

  it("tells an empty registry apart from an absent one", async () => {
    const markup = await renderSources(
      healthyScript({ [T.sources]: [{ data: [], count: 0 }, { data: [] }] }),
    );
    const $ = cheerio.load(markup);
    expect($("[data-empty]").attr("data-empty")).toBe("registry");
    expect(notProvisioned(markup)).not.toContain(T.sources);
    expect(sourceIds(markup)).toEqual([]);
  });

  it("renders per request rather than at build time", async () => {
    // A page prerendered where the app has no credential ships a frozen error
    // state that never re-reads (relayed from QA on admin-window/TASK-0009).
    expect(sourcesModule.dynamic).toBe("force-dynamic");
  });
});

/* ── the two per-source trends ───────────────────────────────────────────── */

describe("the awaiting-row trend", () => {
  it("lists one row per source with an awaiting-row claim, busiest first", async () => {
    const markup = await renderSources(healthyScript());
    expect(trendSources(markup, AWAITING_BY_SOURCE)).toEqual([
      SOURCE.ticketmaster,
      SOURCE.bandsintown,
    ]);
  });

  it("counts each source's awaiting-row claims, and nothing else's", async () => {
    const markup = await renderSources(healthyScript());
    for (const sourceId of [SOURCE.ticketmaster, SOURCE.bandsintown]) {
      const cells = trendRow(markup, AWAITING_BY_SOURCE, sourceId);
      // period cell, then the claims measure.
      expect(cells[1], sourceId).toBe(String(awaitingRowClaims(sourceId)));
    }
  });

  it("names each source by its registry name, linking back to it", async () => {
    const markup = await renderSources(healthyScript());
    const cells = trendRow(markup, AWAITING_BY_SOURCE, SOURCE.ticketmaster);
    expect(cells[0]).toBe("ticketmaster");
  });

  it("draws no threshold line while the dial is unreadable", async () => {
    const markup = await renderSources(healthyScript());
    // period + claims + days-with-a-claim, and no fourth column: the
    // per-source stuck-pattern dial lives only in the scraper registry
    // (admin-window/TASK-0024), so there is no line to draw and no default is
    // substituted.
    expect(columnCount(markup, AWAITING_BY_SOURCE)).toBe(3);
  });

  it("draws the line the moment the dial becomes readable, and no default before", async () => {
    // The page reads the dial the gauge carries and substitutes nothing of its
    // own: with a threshold present the trend gains that column, carrying the
    // gauge's number; with none it has no such column (asserted above).
    const window = {
      since: daysAgo(7),
      until: daysAgo(0),
      limit: 1000,
      truncated: false,
    };
    trendAnswer.value = {
      kind: "ok",
      data: {
        window,
        series: [
          {
            sourceId: SOURCE.ticketmaster,
            claims: 4,
            points: [{ day: daysAgo(1).slice(0, 10), claims: 4 }],
            threshold: { count: 3, windowDays: 7 },
          },
        ],
      },
    };
    try {
      const markup = await renderSources(healthyScript());
      expect(columnCount(markup, AWAITING_BY_SOURCE)).toBe(4);
      expect(trendRow(markup, AWAITING_BY_SOURCE, SOURCE.ticketmaster)[3]).toBe("3");
    } finally {
      trendAnswer.value = undefined;
    }
  });

  it("becomes that source's days when the page is narrowed to one source", async () => {
    const markup = await renderSources(healthyScript(), {
      source_id: SOURCE.ticketmaster,
    });
    const rows = tableRows(markup, AWAITING_BY_DAY);
    expect(rows.length).toBeGreaterThan(0);
    const plotted = rows.reduce((total, cells) => total + Number(cells[1]), 0);
    expect(plotted).toBe(awaitingRowClaims(SOURCE.ticketmaster));
  });

  it("plots the days of the source the URL asked for, not the first series it was handed", async () => {
    // The narrowing is applied twice today — once at the query and once in
    // `selectClaims` — so the real read hands this section one series and
    // taking the first would look right. The RENDERING must not depend on
    // that (admin-window/BUG-0022): handed a fleet-shaped trend, busiest
    // first, it still plots the source the URL named. The seam is the same
    // prepared answer the threshold test above uses.
    const day = daysAgo(1).slice(0, 10);
    trendAnswer.value = {
      kind: "ok",
      data: {
        window: { since: daysAgo(7), until: daysAgo(0), limit: 1000, truncated: false },
        series: [
          {
            sourceId: SOURCE.ticketmaster,
            claims: 9,
            points: [{ day, claims: 9 }],
            threshold: null,
          },
          {
            sourceId: SOURCE.bandsintown,
            claims: 2,
            points: [{ day, claims: 2 }],
            threshold: null,
          },
        ],
      },
    };
    try {
      const markup = await renderSources(healthyScript(), {
        source_id: SOURCE.bandsintown,
      });
      const rows = tableRows(markup, AWAITING_BY_DAY);
      const plotted = rows.reduce((total, cells) => total + Number(cells[1]), 0);
      expect(plotted).toBe(2);
    } finally {
      trendAnswer.value = undefined;
    }
  });

  it("says a narrowed source has none, rather than showing the fleet's", async () => {
    const markup = await renderSources(healthyScript(), { source_id: SOURCE.fandom });
    expect(awaitingRowClaims(SOURCE.fandom)).toBe(0);
    expect(trendSources(markup, AWAITING_BY_SOURCE)).toEqual([]);
    expect(markup).not.toContain(AWAITING_BY_DAY);
  });

  it("names the gauge's own table when the claims view is absent", async () => {
    const markup = await renderSources(
      healthyScript({
        [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
      }),
    );
    expect(notProvisioned(markup)).toContain(T.pendingClaims);
    // The registry itself is unaffected — one absent object does not blank the
    // page.
    expect(sourceIds(markup)).toEqual(SOURCES.map((source) => source.source_id));
  });
});

describe("the settled-values trend", () => {
  it("counts each source's re-rejects and adjudications separately", async () => {
    const markup = await renderSources(healthyScript());
    for (const sourceId of [SOURCE.ticketmaster, SOURCE.bandsintown]) {
      const cells = trendRow(markup, REJECTED_BY_SOURCE, sourceId);
      expect(cells[1], `${sourceId} re-rejected`).toBe(String(rerejects(sourceId)));
      expect(cells[2], `${sourceId} adjudicated`).toBe(String(adjudications(sourceId)));
    }
  });

  it("orders the sources by who keeps pushing adjudicated values", async () => {
    const markup = await renderSources(healthyScript());
    expect(trendSources(markup, REJECTED_BY_SOURCE)).toEqual([
      SOURCE.ticketmaster,
      SOURCE.bandsintown,
    ]);
  });

  it("becomes that source's weeks when the page is narrowed to one source", async () => {
    const markup = await renderSources(healthyScript(), {
      source_id: SOURCE.bandsintown,
    });
    const rows = tableRows(markup, REJECTED_BY_WEEK);
    expect(rows.length).toBeGreaterThan(0);
    const rerejected = rows.reduce((total, cells) => total + Number(cells[1]), 0);
    expect(rerejected).toBe(rerejects(SOURCE.bandsintown));
  });

  it("says a narrowed source has none, rather than showing the fleet's", async () => {
    const markup = await renderSources(healthyScript(), { source_id: SOURCE.fandom });
    expect(rerejects(SOURCE.fandom)).toBe(0);
    expect(trendSources(markup, REJECTED_BY_SOURCE)).toEqual([]);
    expect(markup).not.toContain(REJECTED_BY_WEEK);
  });

  it("counts a stamp with no reason as neither a re-reject nor an adjudication", async () => {
    const markup = await renderSources(healthyScript());
    const unattributed = REJECTIONS.filter((row) => row.rejected_by === null);
    expect(unattributed).toHaveLength(1);
    const cells = trendRow(markup, REJECTED_BY_SOURCE, SOURCE.bandsintown);
    // all rejections = re-rejects + adjudications + the unattributed one.
    expect(Number(cells[3])).toBe(
      rerejects(SOURCE.bandsintown) + adjudications(SOURCE.bandsintown) + 1,
    );
  });

  // Was pinned `it.fails` while admin-window/BUG-0022 was live; plain `it()`
  // since the fix scoped the section's closing sentence to the same rows its
  // cards are over.
  it("keeps a stranger's rejection out of a narrowed source's figures", async () => {
    // Narrowed to ticketmaster, ONLY ticketmaster's rows may move any figure
    // this section reports — the page's own rule (`RejectionSection`: "the
    // figures answer the question the URL asked … not the fleet's total
    // wearing one source's name"). So adding a rejection that belongs to
    // bandsintown must leave the narrowed rendering unchanged.
    const mine = REJECTIONS.filter((row) => row.source_id === SOURCE.ticketmaster);
    const stranger = observationRow({
      observation_id: "01920000-0000-7000-8000-00000000ff01",
      source_id: SOURCE.bandsintown,
      status: "rejected",
      rejected_at: daysAgo(3),
      // The column is nullable and written by convention (migration
      // 20260901000003), so a stamp with no reason at all is a real row.
      rejected_by: null,
    });
    const params = { source_id: SOURCE.ticketmaster };
    const withoutStranger = await renderSources(
      healthyScript({
        [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: mine }],
      }),
      params,
    );
    const withStranger = await renderSources(
      healthyScript({
        [T.observations]: [
          { data: [...PENDING_OBSERVATIONS] },
          { data: [...mine, stranger] },
        ],
      }),
      params,
    );
    expect(settledValuesSays(withStranger)).toBe(settledValuesSays(withoutStranger));
  });

  it("keeps an unregistered source's rejection out of a narrowed source's figures", async () => {
    // The second clause of the same sentence (admin-window/BUG-0022): a source
    // with no `sources` row is reported so the operator knows a name is an id.
    // Whose id, though, is the URL's question — a rejection from a source that
    // is not in the registry at all must not appear on a page narrowed to
    // ticketmaster.
    const mine = REJECTIONS.filter((row) => row.source_id === SOURCE.ticketmaster);
    const unregistered = observationRow({
      observation_id: "01920000-0000-7000-8000-00000000ff02",
      // No `sources` row is scripted for this id, so its split is name-less.
      source_id: "01920000-0000-7000-8000-0000000001ff",
      status: "rejected",
      rejected_at: daysAgo(2),
      rejected_by: "resolver",
    });
    const params = { source_id: SOURCE.ticketmaster };
    const alone = await renderSources(
      healthyScript({
        [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: mine }],
      }),
      params,
    );
    const withUnregistered = await renderSources(
      healthyScript({
        [T.observations]: [
          { data: [...PENDING_OBSERVATIONS] },
          { data: [...mine, unregistered] },
        ],
      }),
      params,
    );
    expect(settledValuesSays(withUnregistered)).toBe(settledValuesSays(alone));
  });

  it("still reports a narrowed source's OWN unattributed rejection", async () => {
    // The other half of the fix: scoping the sentence must not silence it. The
    // one fixture rejection carrying no reason belongs to bandsintown, so on a
    // page narrowed to bandsintown its presence has to change what the section
    // says — a fact dropped would read identically to a fact absent.
    const noReason = REJECTIONS.filter((row) => row.rejected_by === null);
    expect(noReason).toHaveLength(1);
    expect(noReason[0].source_id).toBe(SOURCE.bandsintown);
    const attributed = REJECTIONS.filter((row) => row.rejected_by !== null);
    const params = { source_id: SOURCE.bandsintown };
    const withIt = await renderSources(healthyScript(), params);
    const withoutIt = await renderSources(
      healthyScript({
        [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: attributed }],
      }),
      params,
    );
    expect(settledValuesSays(withIt)).not.toBe(settledValuesSays(withoutIt));
  });

  it("names the observations table when the stamps cannot be read", async () => {
    const markup = await renderSources(
      healthyScript({
        [T.observations]: [
          { data: [...PENDING_OBSERVATIONS] },
          { error: tableNotInSchemaCache(T.observations) },
        ],
      }),
    );
    expect(notProvisioned(markup)).toContain(T.observations);
    expect(sourceIds(markup)).toEqual(SOURCES.map((source) => source.source_id));
  });
});
