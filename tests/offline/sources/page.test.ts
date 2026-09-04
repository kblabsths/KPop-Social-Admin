import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import {
  implicitInterElementSpaces,
  implicitInterElementSpacesIn,
} from "../source-tree";
import {
  disagreeingCounts,
  factoryTicketIds,
  render,
  runTogetherWords,
} from "../ui/markup";
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
import { oneEach, readNumber, surfaceHooks } from "../../live/parity";
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

  it("renders the absence when a fleet-shaped series holds no row for the narrowed source", async () => {
    // The other half of finding the series BY ID (admin-window/BUG-0022): the
    // narrowed source may not be IN the series at all. Handed a series that is
    // entirely a stranger's, the section must render this source's absence —
    // never the stranger's days under this source's name, and never the
    // stranger listed on a page the URL narrowed away from it.
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
        ],
      },
    };
    try {
      const markup = await renderSources(healthyScript(), {
        source_id: SOURCE.bandsintown,
      });
      // No per-day table: there are no days of this source's to plot.
      expect(markup).not.toContain(AWAITING_BY_DAY);
      // And no stranger's row standing in for them.
      expect(trendSources(markup, AWAITING_BY_SOURCE)).toEqual([]);
      // The control: the SAME prepared series, unnarrowed, does list that
      // stranger — so the absence above is the narrowing's doing and not a
      // selector that matches nothing.
      const unnarrowed = await renderSources(healthyScript());
      expect(trendSources(unnarrowed, AWAITING_BY_SOURCE)).toEqual([
        SOURCE.ticketmaster,
      ]);
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

  it("reports no unattributed rejection when the narrowed source has no rejection at all", async () => {
    // The empty scope (`scope = []`, the page's own rule at RejectionSection):
    // fandom has nothing adjudicated in this window, so the section's figures
    // are a real zero over its rows. Two strangers' rows are moved around it —
    // one added, one taken away — and the words must not move at all. Compared
    // against the render where the FLEET holds no unattributed row either: an
    // empty scope and an empty fleet have to read the same, which is what
    // "not the fleet's total wearing one source's name" means.
    const params = { source_id: SOURCE.fandom };
    expect(rerejects(SOURCE.fandom) + adjudications(SOURCE.fandom)).toBe(0);
    const attributedOnly = REJECTIONS.filter((row) => row.rejected_by !== null);
    const strangerNoReason = observationRow({
      observation_id: "01920000-0000-7000-8000-00000000fb01",
      source_id: SOURCE.ticketmaster,
      status: "rejected",
      rejected_at: daysAgo(3),
      rejected_by: null,
    });

    const asFixtured = await renderSources(healthyScript(), params);
    const withAnotherStranger = await renderSources(
      healthyScript({
        [T.observations]: [
          { data: [...PENDING_OBSERVATIONS] },
          { data: [...REJECTIONS, strangerNoReason] },
        ],
      }),
      params,
    );
    const withNoneAnywhere = await renderSources(
      healthyScript({
        [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: attributedOnly }],
      }),
      params,
    );
    expect(settledValuesSays(withAnotherStranger)).toBe(settledValuesSays(asFixtured));
    expect(settledValuesSays(withNoneAnywhere)).toBe(settledValuesSays(asFixtured));
    // The control: the same population unnarrowed says something else, so the
    // three equalities above are not three empty strings.
    expect(settledValuesSays(asFixtured)).not.toBe(
      settledValuesSays(await renderSources(healthyScript())),
    );
  });

  it("reports a narrowed source whose rejections all carry no reason as its own count", async () => {
    // The boundary the other way: every one of this source's rejections is
    // unattributed, so the clause is the whole story of its column — and four
    // of a stranger's must not be added to it. Three renders, one narrowing:
    // the fact must be invariant to the stranger's rows and must still change
    // when the same rows carry a reason instead (dropped and reported-as-zero
    // would otherwise read identically).
    const params = { source_id: SOURCE.fandom };
    const mineNoReason = [0, 1, 2].map((n) =>
      observationRow({
        observation_id: `01920000-0000-7000-8000-00000000fc0${n}`,
        source_id: SOURCE.fandom,
        status: "rejected",
        rejected_at: daysAgo(2 + n),
        rejected_by: null,
      }),
    );
    const mineReasoned = mineNoReason.map((row) => ({ ...row, rejected_by: "resolver" }));
    const strangersNoReason = [0, 1, 2, 3].map((n) =>
      observationRow({
        observation_id: `01920000-0000-7000-8000-00000000fd0${n}`,
        source_id: SOURCE.ticketmaster,
        status: "rejected",
        rejected_at: daysAgo(2 + n),
        rejected_by: null,
      }),
    );
    const say = async (rows: unknown[]) =>
      settledValuesSays(
        await renderSources(
          healthyScript({
            [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: rows }],
          }),
          params,
        ),
      );

    const mineAlone = await say([...REJECTIONS, ...mineNoReason]);
    const mineAndStrangers = await say([
      ...REJECTIONS,
      ...mineNoReason,
      ...strangersNoReason,
    ]);
    const sameRowsWithReasons = await say([...REJECTIONS, ...mineReasoned]);

    // Four more of ticketmaster's unattributed rows: not this page's figure.
    expect(mineAndStrangers).toBe(mineAlone);
    // Same three rows, same total, a reason on each: this page's figure moves.
    expect(sameRowsWithReasons).not.toBe(mineAlone);
  });

  it("counts the narrowed source itself once when its own registry row did not come back", async () => {
    // `unnamedSources` was the FLEET's count; scoped, it is 0 or 1 under a
    // narrowing (admin-window/BUG-0022). Here the gauge's own `sources` lookup
    // comes back without ticketmaster — the registry read that fed the chips
    // still had it, which is why the narrowing was accepted — so the narrowed
    // split is name-less and the operator is told its name is an id. Adding
    // TWO further unregistered sources' rejections must not turn that 1 into a
    // 3: the clause counts the scope, not the fleet.
    const lookupWithoutTicketmaster = SOURCES.filter(
      (source) => source.source_id !== SOURCE.ticketmaster,
    );
    const script = (rows: unknown[]): Script => ({
      ...healthyScript(),
      [T.sources]: [
        { data: [...SOURCES], count: SOURCES.length },
        { data: lookupWithoutTicketmaster },
      ],
      [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: rows }],
    });
    const strangers = [0, 1].map((n) =>
      observationRow({
        observation_id: `01920000-0000-7000-8000-00000000fe0${n}`,
        source_id: `01920000-0000-7000-8000-00000000ee0${n}`,
        status: "rejected",
        rejected_at: daysAgo(2 + n),
        rejected_by: "resolver",
      }),
    );
    const params = { source_id: SOURCE.ticketmaster };

    const named = settledValuesSays(await renderSources(healthyScript(), params));
    const unnamed = settledValuesSays(
      await renderSources(script([...REJECTIONS]), params),
    );
    const unnamedPlusStrangers = settledValuesSays(
      await renderSources(script([...REJECTIONS, ...strangers]), params),
    );

    // The fact is reported at all: a name-less split reads differently.
    expect(unnamed).not.toBe(named);
    // And it is this source's fact alone.
    expect(unnamedPlusStrangers).toBe(unnamed);
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

/**
 * The prose the page ships, checked against the RENDERED markup rather than
 * the source (campaign admin-window/BUG-0045).
 *
 * Both defects here were invisible in the file: `.tsx` carried an
 * `(admin-window/TASK-0024)` a reader skims past as a comment, and JSX
 * silently eats a line-broken space, so a `</span>` and the next word arrive
 * glued together on screen. Nothing about the app's WORDING is pinned — the
 * sentence may be rewritten freely; what may not come back is a build id or a
 * missing space.
 */
describe("the copy the operator actually reads", () => {
  it("names no factory ticket, in any of the page's states", async () => {
    for (const [state, script] of Object.entries({
      healthy: healthyScript(),
      empty: healthyScript({
        [T.sources]: [{ data: [], count: 0 }, { data: [] }],
        [T.observations]: [{ data: [] }, { data: [] }],
        [T.pendingClaims]: { data: [] },
        [T.runs]: [],
      }),
      refused: healthyScript({
        [T.observations]: [
          { error: permissionDenied(T.observations) },
          { error: permissionDenied(T.observations) },
        ],
      }),
    })) {
      // The guard proves itself before it clears the page: a build id in copy
      // MUST be found, or the assertion below is vacuous.
      expect(factoryTicketIds("<p>an open question (admin-window/TASK-0024)</p>")).toEqual([
        "admin-window/TASK-0024",
      ]);
      expect(factoryTicketIds(await renderSources(script)), state).toEqual([]);
    }
  });

  it("puts a space between a mono identifier and the word after it", async () => {
    // Two fixtures, same guard: the run-together spelling the walk saw must
    // trip it, and this page must not.
    expect(runTogetherWords('<span class="type-data">stuck_pattern</span>dial lives')).toEqual([
      "</span>dial",
    ]);
    expect(runTogetherWords(await renderSources(healthyScript()))).toEqual([]);
  });

  it("agrees every count with its noun when the window holds exactly one source", async () => {
    // The staging shape that produced "1 sources holding one" on the walk
    // (admin-window/BUG-0046): the awaiting-row window holding claims from a
    // single source. The healthy population has two, so the defect could not
    // render — this narrowing is what makes the guard below non-vacuous.
    expect(disagreeingCounts("<p>1 sources holding one</p>")).toEqual(["1 sources"]);

    const markup = await renderSources(
      healthyScript({
        [T.observations]: [
          {
            data: PENDING_OBSERVATIONS.filter(
              (row) => row.source_id === SOURCE.bandsintown,
            ),
          },
          { data: [...REJECTIONS] },
        ],
        [T.pendingClaims]: {
          data: PENDING_CLAIMS.filter(
            (claim) => claim.source_id === SOURCE.bandsintown,
          ),
        },
      }),
    );

    // The fixture really is singular, so the assertion below has something to
    // catch: one source, holding one awaiting-row claim.
    expect(readNumber(markup, "Sources with awaiting-row claims")).toBe(1);
    expect(readNumber(markup, "Awaiting-row claims in this window")).toBe(1);
    expect(disagreeingCounts(markup)).toEqual([]);
  });
  it("writes every inter-element space as an explicit expression, which no transform may drop", () => {
    // The rendered assertions above CANNOT fail on this defect: vitest's JSX
    // transform keeps the space that `next build`'s transform drops (measured
    // on the delivered HTML of :8781, 2026-09-03). The source rule is what
    // actually guards it, so it stands beside them.
    //
    // Two fixtures: the pre-fix spelling of this page must trip the scanner...
    expect(
      implicitInterElementSpacesIn('          <span className=\"type-data text-ink\">stuck_pattern</span> dial lives only'),
    ).toEqual(['1: <span className=\"type-data text-ink\">stuck_pattern</span> dial lives only']);
    // ...and the page as it stands must be clean of it.
    expect(implicitInterElementSpaces("src/app/sources/page.tsx")).toEqual([]);
  });
});

/* ── the addressing the live oracle depends on ───────────────────────────── */

/**
 * The name each surface answers to (`data-surface`, `src/app/sources/page.tsx`),
 * as `tests/live/sources.live.test.ts` addresses them. The two trend surfaces
 * take the names their window lines already carry.
 */
const SURFACE_HOOKS = {
  registry: '[data-surface="registry"]',
  awaiting_row: '[data-surface="awaiting_row"]',
  rejections: '[data-surface="rejections"]',
} as const;

const HOOKS = Object.values(SURFACE_HOOKS);

describe("the surface hooks the live parity oracle addresses", () => {
  /**
   * The live oracle grades ONE surface at a time and `stateOf`
   * (`tests/live/parity.ts`) refuses any selector matching other than exactly
   * one element. Until admin-window/DEBT-0002 it addressed these three
   * POSITIONALLY — `section:nth-of-type(n)` — so one added section, or one
   * `<div>` wrapped around an existing one, either duplicates a match or
   * silently repoints the selector at the neighbouring surface. On `/cycles`
   * that is not hypothetical: admin-window/BUG-0040's lead section and its
   * wrapper made `:nth-of-type(1)` match two surfaces and four live tests
   * threw (admin-window/BUG-0056).
   *
   * Nothing offline could see any of that — `npm test` runs the offline and
   * isolated projects only — so the live oracle's addressing had no pin in CI.
   * These cases are that pin, in the file that owns this page's markup.
   */
  it("gives each surface exactly one element, in every state and under a narrowing", async () => {
    const populated = await renderSources(healthyScript());
    const narrowed = await renderSources(healthyScript(), {
      source_id: SOURCE.ticketmaster,
    });
    // The registry that holds nothing, and the narrowing that matched nothing:
    // two different emptinesses, and one of them renders an extra `<div>`
    // wrapper around its card.
    const empty = await renderSources(
      healthyScript({ [T.sources]: [{ data: [], count: 0 }, { data: [] }] }),
    );
    const matchedNothing = await renderSources(healthyScript(), {
      source_id: "00000000-0000-7000-8000-000000000000",
    });
    // The states that swap a surface's table for a card are exactly where a
    // wrapper is most likely to appear or vanish.
    const absent = await renderSources({
      [T.sources]: { error: tableNotInSchemaCache(T.sources) },
      [T.runs]: { error: tableNotInSchemaCache(T.runs) },
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
    });
    const refused = await renderSources({
      [T.sources]: { error: permissionDenied(T.sources) },
      [T.runs]: { error: permissionDenied(T.runs) },
      [T.observations]: { error: permissionDenied(T.observations) },
      [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
    });
    // One read failing while its neighbours succeed — the branch no whole-page
    // script reaches, and the one where a wrapper appears in one surface only.
    const partial = await renderSources(
      healthyScript({ [T.observations]: { error: permissionDenied(T.observations) } }),
    );

    const states: [string, string][] = [
      ["populated", populated],
      ["narrowed", narrowed],
      ["registry empty", empty],
      ["narrowing matched nothing", matchedNothing],
      ["absent", absent],
      ["refused", refused],
      ["one read refused", partial],
    ];
    for (const [name, markup] of states) {
      // `nested` empty is the second half: a hook can be unique and still
      // swallow its neighbour's state cards.
      expect(surfaceHooks(markup, HOOKS), name).toEqual({
        counts: oneEach(HOOKS),
        nested: [],
      });
    }
  });

  it("keeps each surface's own table and window line inside its own hook", async () => {
    // A hook that is unique but points at the wrong surface is the same bug
    // wearing a different hat, so each name is checked against what that
    // surface actually reads.
    const $ = cheerio.load(await renderSources(healthyScript()));

    expect($(SURFACE_HOOKS.registry).find("[data-source]").length).toBe(SOURCES.length);
    expect(
      $(SURFACE_HOOKS.awaiting_row).find(`table[aria-label="${AWAITING_BY_SOURCE}"]`).length,
    ).toBe(1);
    expect($(SURFACE_HOOKS.awaiting_row).find('[data-window="awaiting_row"]').length).toBe(1);
    expect(
      $(SURFACE_HOOKS.rejections).find(`table[aria-label="${REJECTED_BY_SOURCE}"]`).length,
    ).toBe(1);
    expect($(SURFACE_HOOKS.rejections).find('[data-window="rejections"]').length).toBe(1);

    // The three never bleed into each other: the registry holds no trend row,
    // and neither trend holds the other's window line.
    expect($(SURFACE_HOOKS.registry).find("[data-trend-source], [data-window]").length).toBe(0);
    expect($(SURFACE_HOOKS.awaiting_row).find('[data-window="rejections"]').length).toBe(0);
    expect($(SURFACE_HOOKS.rejections).find('[data-window="awaiting_row"]').length).toBe(0);
  });
});
