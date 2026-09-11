import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { isRecordId } from "@/lib/records/id";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import {
  codeLinesIn,
  codeText,
  implicitInterElementSpaces,
  implicitInterElementSpacesIn,
  sourceFiles,
} from "../source-tree";
import {
  disagreeingCounts,
  factoryTicketIds,
  render,
  runTogetherWords,
  uppercasedIdentifiers,
} from "../ui/markup";
import {
  classesOf,
  expectDrawnAsLinkAtRest,
  expectNotDrawnAsLink,
} from "../../fixtures/link-spelling";
import {
  PENDING_CLAIMS,
  PENDING_OBSERVATIONS,
  REJECTIONS,
  RUN,
  RUNS,
  SOURCE,
  SOURCES,
  SOURCE_NAME,
  adjudications,
  awaitingRowClaims,
  daysAgo,
  manySources,
  newestRunFor,
  rerejects,
  runsResponse,
} from "./population";
import { oneEach, readNumber, surfaceHooks } from "../../live/parity";
import { observationRow, pendingClaimRow, runRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
  type StubClient,
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

/**
 * The BARRIER that proves the three composed reads are ISSUED TOGETHER
 * (campaign admin-window/BUG-0139).
 *
 * While it is armed, each of the page's three reads is started and then held
 * until all three have started. A page that awaits them one after the other
 * therefore never gets its first answer — the read after it is never issued —
 * so the case fails on the timer instead of passing on a stopwatch nobody can
 * trust. Disarmed (every other test in this file), each read is passed
 * straight through.
 */
const together = vi.hoisted(() => {
  const gate = {
    armed: false,
    issued: [] as string[],
    waiting: [] as (() => void)[],
    /** Issue this read now; answer once all three of them have been issued. */
    async hold<T>(name: string, issue: () => Promise<T>): Promise<T> {
      if (!gate.armed) return issue();
      gate.issued.push(name);
      const answer = issue();
      if (gate.issued.length >= 3) gate.release();
      else await new Promise<void>((resolve) => gate.waiting.push(resolve));
      return answer;
    },
    /** Let every held read answer — also how the case cleans up after itself. */
    release(): void {
      for (const go of gate.waiting.splice(0)) go();
    },
  };
  return gate;
});

vi.mock("@/lib/db/sources", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/sources")>();
  return {
    ...actual,
    listSources: () =>
      together.hold("registry", () => actual.listSources(readWith.client as never)),
  };
});

vi.mock("@/lib/gauges/pending-claims", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/pending-claims")>();
  return {
    ...actual,
    readAwaitingRowTrend: (options?: unknown) =>
      together.hold("awaiting_row", async () =>
        trendAnswer.value !== undefined
          ? trendAnswer.value
          : actual.readAwaitingRowTrend((options ?? {}) as never, readWith.client as never),
      ),
  };
});

vi.mock("@/lib/gauges/settled-values", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/settled-values")>();
  return {
    ...actual,
    readRejectionStampGauge: (options?: unknown) =>
      together.hold("rejections", () =>
        actual.readRejectionStampGauge((options ?? {}) as never, readWith.client as never),
      ),
  };
});

const sourcesModule = await import("@/app/sources/page");
const SourcesPage = sourcesModule.default;

/* ── rendering ───────────────────────────────────────────────────────────── */

/**
 * A database holding the whole population.
 *
 * The queued responses follow the order each object is read in: the registry,
 * then the rejection gauge's `sources` lookup behind the per-source split;
 * `observations` is read by the awaiting-row trend first and the rejection
 * gauge second. The three reads are ISSUED together (campaign
 * admin-window/BUG-0139), which changes nothing here — a queue is consumed in
 * the order the requests are made, and each of the three reads its own object.
 *
 * The `runs` response is the whole table in the order the ONE request asks the
 * SERVER for (`RUNS_AS_READ` in `./population`), which is the answer a
 * database would give it. That the module actually issues that query — the
 * count, the order, the cap — is asserted off the recorded calls in
 * `read.test.ts`, so the pairing cannot be a coincidence of ordering.
 */
function healthyScript(overrides: Script = {}): Script {
  return {
    [T.sources]: [
      { data: [...SOURCES], count: SOURCES.length },
      { data: [...SOURCES] },
    ],
    // ONE response for ONE request: the whole run log, in the order the read
    // asks the server for it (campaign admin-window/BUG-0139).
    [T.runs]: runsResponse(),
    [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: [...REJECTIONS] }],
    [T.pendingClaims]: { data: [...PENDING_CLAIMS] },
    ...overrides,
  };
}

/**
 * The stub behind the LAST render, kept so a case can read the query chain a
 * narrowing built and not only the markup it produced. The stub answers from
 * its script and ignores the chain by design ("the script decides the answer,
 * not the chain", `tests/fixtures/stub-client.ts`), so what a read asked the
 * database FOR is invisible in the rendering and visible only here.
 */
let lastStub: StubClient | undefined;

async function renderSources(
  script: Script,
  params: Record<string, string | string[]> = {},
): Promise<string> {
  const stub = stubClient(script);
  lastStub = stub;
  readWith.client = stub.asSupabaseClient();
  return render(await SourcesPage({ searchParams: Promise.resolve(params) }));
}

/** Every value this render asked the database to match `source_id` against. */
function sourceIdsAskedFor(): unknown[] {
  const stub = lastStub;
  if (stub === undefined) throw new Error("no render recorded");
  return stub.calls.flatMap((call) =>
    call.steps
      .filter((step) => step.method === "eq" && step.args[0] === "source_id")
      .map((step) => step.args[1]),
  );
}

/**
 * Each `observations` SCAN of the last render, keyed by its own time column,
 * and the `source_id` values that scan asked the database to match.
 *
 * The page issues two of them — the awaiting-row scan windows on `observed_at`
 * and the settled-values scan on `rejected_at` — and a window line may name a
 * narrowing only if ITS OWN scan carried one (admin-window/TASK-0073,
 * admin-window/BUG-0194). Read per scan rather than over the render, because
 * over the render the two are indistinguishable and one of them could carry
 * nothing unnoticed.
 */
function sourceIdsAskedForPerScan(): Record<string, unknown[]> {
  const stub = lastStub;
  if (stub === undefined) throw new Error("no render recorded");
  const scans: Record<string, unknown[]> = {};
  for (const call of stub.calls) {
    const edge = call.steps.find((step) => step.method === "gte");
    if (call.table !== T.observations || edge === undefined) continue;
    scans[String(edge.args[0])] = call.steps
      .filter((step) => step.method === "eq" && step.args[0] === "source_id")
      .map((step) => step.args[1]);
  }
  return scans;
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

/**
 * The settled-values section's CLOSING SENTENCE — its words below its figures,
 * with the tables and the window line left out.
 *
 * Addressed structurally (the gauge's own hook, then the last paragraph of its
 * section) rather than by any word in it, so nothing here pins the app's copy;
 * what the cases below read out of it is the NUMBERS it states.
 */
function settledValuesSentence(markup: string): string {
  const $ = cheerio.load(markup);
  const section = $('[data-window="rejections"]').closest("section");
  section.find("[data-window]").remove();
  const paragraph = section.find("p").last();
  expect(paragraph.length, "the settled-values section said nothing at all").toBe(1);
  // A table's empty state is a paragraph too; a case that read one of those
  // would be grading the wrong sentence.
  expect(paragraph.closest("table").length, "read a paragraph inside the table").toBe(0);
  return paragraph.text().replace(/\s+/g, " ").trim();
}

/** Every figure a sentence states, in the order it states them. */
function figuresIn(sentence: string): string[] {
  return sentence.match(/\d[\d,]*/g) ?? [];
}

/**
 * The trend rows WEARING AN ID: the ones whose label is the source's own id,
 * which is what the app says when the registry named nothing for it
 * (`sourceLabel`, `src/lib/sources/names.ts`).
 *
 * Read off the rendered table, so a case can compare what the rows say with
 * what the sentence under them counts without either being retyped here.
 */
function wearingAnId(markup: string, label: string): string[] {
  return trendSources(markup, label).filter(
    (sourceId) => trendRow(markup, label, sourceId)[0] === sourceId,
  );
}

const AWAITING_BY_SOURCE = "Awaiting-row claims by source";
const AWAITING_BY_DAY = "Awaiting-row claims by day";
const REJECTED_BY_SOURCE = "Re-rejected values by source";
const REJECTED_BY_WEEK = "Re-rejected values by week";
/**
 * The settled-values headline CARD, addressed by the label it is drawn with —
 * `readNumber`'s hook, the same one the live parity oracle uses
 * (`tests/live/parity.ts`). One spelling in this file, so a case reads a card
 * rather than re-deciding which one it meant.
 */
const REJECTED_FIGURE = "Re-rejected claims in this window";

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

  /**
   * **The registry's own name column is a source LABEL like any other**
   * (admin-window/TASK-0060, the last site of BUG-0154's class).
   *
   * It rendered `{row.source}` raw — no fallback of any spelling, which is why
   * the `?? sourceId` scanner in `names.test.ts` never saw it — so a registry
   * row that EXISTED with an ink-less name drew the registry's own cell as an
   * anchor with nothing to read and nothing visible to click, on the one page
   * whose whole subject is the registry, while the chips above it and the two
   * trends below it named that same source by its id.
   *
   * The hook is asserted beside the ink: `data-source-name` is what the live
   * parity oracle reads, and an attribute that disagreed with the cell would
   * make that oracle grade a page no operator sees.
   */
  for (const blank of ["", "   ", "\u200b"]) {
    it(`names a registry row the registry names ${JSON.stringify(blank)} by its id`, async () => {
      const blanked = SOURCES.map((row) =>
        row.source_id === SOURCE.ticketmaster ? { ...row, source: blank } : row,
      );
      const markup = await renderSources(
        healthyScript({
          [T.sources]: [{ data: blanked, count: blanked.length }, { data: blanked }],
        }),
      );
      const $ = cheerio.load(markup);
      const spelling = JSON.stringify(blank);
      // The id VERBATIM, as the ink of the link an operator clicks...
      expect($(`[data-source="${SOURCE.ticketmaster}"]`).text(), spelling).toBe(
        SOURCE.ticketmaster,
      );
      // ...and in the hook, which says the same thing the cell does.
      expect(sourceRowOf(markup, SOURCE.ticketmaster).name, spelling).toBe(
        SOURCE.ticketmaster,
      );
      // Non-vacuity in the same read (LESSONS 8): the sibling row still reads
      // as its name, so this is a per-ROW fallback and not a blanked table.
      expect($(`[data-source="${SOURCE.bandsintown}"]`).text(), spelling).toBe(
        SOURCE_NAME[SOURCE.bandsintown],
      );
      expect(sourceRowOf(markup, SOURCE.bandsintown).name, spelling).toBe(
        SOURCE_NAME[SOURCE.bandsintown],
      );
    });
  }

  it("leaves a registry name with ink in it exactly as the registry wrote it", async () => {
    // The other direction: a name the app can read is never trimmed and never
    // swapped for the id, in the cell or in the hook.
    const padded = "  ticketmaster  ";
    const rows = SOURCES.map((row) =>
      row.source_id === SOURCE.ticketmaster ? { ...row, source: padded } : row,
    );
    const markup = await renderSources(
      healthyScript({
        [T.sources]: [{ data: rows, count: rows.length }, { data: rows }],
      }),
    );
    const cell = cheerio.load(markup)(`[data-source="${SOURCE.ticketmaster}"]`);
    expect(cell.text()).toBe(padded);
    expect(cell.text()).toHaveLength(padded.length);
    expect(sourceRowOf(markup, SOURCE.ticketmaster).name).toBe(padded);
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

  it("one runs request, whatever the registry holds", async () => {
    // The pairing above must not be an accident of response ordering, and the
    // read that makes it must not grow with the registry: this page read
    // `runs` once per registered source, in a loop, and that is most of the
    // 2.0-2.3 s Ben measured on the walk instance (admin-window/BUG-0139).
    //
    // TWO fixtures, because a per-source loop passes the first one on its own:
    // three sources, and 300. The registry's size may not change the number of
    // requests the page makes.
    const many = manySources(300);
    const fixtures: [string, Script, number][] = [
      ["3 sources", healthyScript(), SOURCES.length],
      [
        "300 sources",
        {
          ...healthyScript(),
          [T.sources]: [
            { data: many.sources, count: many.sources.length },
            { data: many.sources },
          ],
          [T.runs]: { data: many.runs, count: many.runs.length },
        },
        many.sources.length,
      ],
    ];

    const calls: number[] = [];
    for (const [name, script, registrySize] of fixtures) {
      const client = stubClient(script);
      readWith.client = client.asSupabaseClient();
      const markup = render(await SourcesPage({ searchParams: Promise.resolve({}) }));
      // The page really did render that registry, so the counts below are over
      // a page that did the work rather than one that refused early.
      expect(sourceIds(markup), name).toHaveLength(registrySize);
      expect(client.calls.filter((call) => call.table === T.runs), name).toHaveLength(1);
      calls.push(client.calls.length);
    }
    // The same number of requests for 3 sources and for 300, and the whole
    // page costs at most six of them: registry + runs, and two per gauge.
    expect(calls[1], "300 sources cost more requests than 3").toBe(calls[0]);
    expect(calls[0], "the page made more than six requests").toBeLessThanOrEqual(6);
  });

  it("renders the run log's own refusal instead of a registry that is quietly wrong", async () => {
    // `runs` has no retention policy, so the complete read this page now makes
    // will one day outgrow the cap. When it does the page says so with the
    // real number — it must not render a registry whose last-run column is a
    // fold over a truncated log (admin-window/BUG-0139, ARCHITECTURE §4.3).
    const capped = Array.from({ length: 1000 }, (_, index) =>
      runRow({
        run_id: `01920000-0000-7000-8000-0000000d${String(index).padStart(4, "0")}`,
        source: "ticketmaster",
        started_at: "2026-09-01T03:00:00Z",
      }),
    );
    const markup = await renderSources(
      healthyScript({ [T.runs]: { data: capped, count: 1500 } }),
    );
    expect(readsFailed(markup)).toContain(T.runs);
    expect(markup).toContain("1500");
    expect(sourceIds(markup)).toEqual([]);
    // The neighbours are untouched: one leg's refusal removes no other leg's
    // rows (§4.1, common violations row 14).
    expect(trendSources(markup, AWAITING_BY_SOURCE)).toEqual([
      SOURCE.ticketmaster,
      SOURCE.bandsintown,
    ]);
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

  /**
   * A narrowing chip is a source LABELLED BY ITS ID — its whole href is
   * `?source_id=<uuid>` — so what it is called is `sourceLabel`'s one rule
   * (`src/lib/sources/names.ts`), the same rule the trend rows below it obey
   * since admin-window/BUG-0158. `SourceChips` still spells the label as the
   * registry's raw `source.source`, so a registry row that EXISTS with an
   * ink-less name renders a chip with nothing to read and nothing visible to
   * click — BUG-0154's harm on a CONTROL — on the same page and in the same
   * render where the trend row for that very source now names it by its id.
   *
   * Both directions in one render (LESSONS 8): the blank-named chip must say
   * the id, its named sibling must still say its registry name and never a
   * uuid.
   *
   * **Fixed and flipped to a plain `it` by admin-window/BUG-0159**, which gave
   * `SourceChips` the page's registry names map and the app's one rule
   * (`sourceLabel`). It stood here as `it.fails` while the divergence did: the
   * three cases were watched RED as a plain `it` on the tree that landed
   * BUG-0158 (`expected '' to be '01920000-...0101'`), and the `it.fails` was
   * watched red again — `Error: Expect test to fail` — the moment the fix
   * landed, which is what flipped it.
   */
  for (const blank of ["", "   ", "\u200b"]) {
    it(`names a chip whose registry row names ${JSON.stringify(blank)} by its id`, async () => {
      const blanked = SOURCES.map((row) =>
        row.source_id === SOURCE.ticketmaster ? { ...row, source: blank } : row,
      );
      const markup = await renderSources(
        healthyScript({
          [T.sources]: [
            { data: blanked, count: blanked.length },
            { data: blanked },
          ],
        }),
      );
      const chipFor = (id: string) =>
        chips(markup).find((chip) => chip.href === `/sources?source_id=${id}`);

      // The page's OTHER answer for this same source, in this same render: the
      // trend row names it by its id. Non-vacuity, and the inconsistency.
      expect(trendRow(markup, AWAITING_BY_SOURCE, SOURCE.ticketmaster)[0]).toBe(
        SOURCE.ticketmaster,
      );

      const blankNamed = chipFor(SOURCE.ticketmaster);
      expect(blankNamed, "the blank-named chip did not render").toBeDefined();
      expect((blankNamed as { label: string }).label).toBe(SOURCE.ticketmaster);

      // The sibling chip is unchanged: this is a per-ROW fallback.
      const named = chipFor(SOURCE.bandsintown);
      expect(named, "the named chip did not render").toBeDefined();
      expect((named as { label: string }).label).toBe(
        SOURCE_NAME[SOURCE.bandsintown],
      );
    });
  }

  /**
   * The chip's whole job, exercised where an operator actually needs it: the
   * chip for the source the URL is NARROWED TO. QA's re-check of
   * admin-window/BUG-0159 — the three cases above render the page unnarrowed,
   * so nothing pinned what the operator reads once the blank-named chip is the
   * SELECTED one and the registry table beside it is down to that single row.
   * A chip that is `aria-current` and says nothing is a selection an operator
   * cannot read or clear.
   *
   * Non-vacuous in the same render (LESSONS 8): the selected chip says the id,
   * exactly one chip is selected, and the two unselected siblings still say
   * their registry names and never a uuid.
   */
  it("names the SELECTED chip by its id when the registry names it nothing", async () => {
    const blanked = SOURCES.map((row) =>
      row.source_id === SOURCE.ticketmaster ? { ...row, source: "" } : row,
    );
    const markup = await renderSources(
      healthyScript({
        [T.sources]: [
          { data: blanked, count: blanked.length },
          { data: blanked },
        ],
      }),
      { source_id: SOURCE.ticketmaster },
    );
    const rendered = chips(markup);
    const selected = rendered.filter((chip) => chip.active);
    expect(selected.map((chip) => chip.href)).toEqual([
      `/sources?source_id=${SOURCE.ticketmaster}`,
    ]);
    expect(selected[0].label).toBe(SOURCE.ticketmaster);
    for (const sourceId of [SOURCE.bandsintown, SOURCE.fandom]) {
      const sibling = rendered.find(
        (chip) => chip.href === `/sources?source_id=${sourceId}`,
      );
      expect(sibling, `the chip for ${sourceId} did not render`).toBeDefined();
      expect((sibling as { label: string }).label).toBe(SOURCE_NAME[sourceId]);
    }
  });

  /**
   * Bar 10: the registry's ten routes — each source's own narrowing, its
   * review items and its runs — were drawn in plain ink with no decoration
   * until admin-window/BUG-0108, so the "links" column read as two words and
   * the source name read as a label.
   */
  it("draws its three kinds of link as links at rest", async () => {
    const markup = await renderSources(healthyScript());
    const $ = cheerio.load(markup);
    for (const hook of ["[data-source]", "[data-source-items]", "[data-source-runs]"]) {
      const anchors = $(`${hook}[href]`).toArray();
      expect(anchors.length, `${hook} rendered no links at all`).toBeGreaterThan(0);
      for (const anchor of anchors) {
        expectDrawnAsLinkAtRest(classesOf($(anchor)), hook);
      }
    }
    // The registry's other cells are readings, not routes.
    for (const inert of ["[data-source-kind]", "[data-source-outcome]"]) {
      const cells = $(inert).toArray();
      expect(cells.length, `no ${inert} to compare against`).toBeGreaterThan(0);
      for (const cell of cells) expectNotDrawnAsLink(classesOf($(cell)), inert);
    }
  });

  it("narrows nothing when the URL names something that is not an id at all", async () => {
    // A hand-typed word lands on the whole registry, not on a blank page that
    // reads like an empty database — and, since admin-window/BUG-0139 hands
    // the URL's value to the gauge's QUERY, not on an error card either:
    // `observations.source_id` is a uuid column, so comparing it to `nobody`
    // is refused by Postgres itself (`22P02`) and every surface would then
    // advise a reload that re-sends the same URL forever
    // (admin-window/BUG-0065's ruling, whose `isRecordId` is the one grammar).
    const markup = await renderSources(healthyScript(), { source_id: "nobody" });
    expect(sourceIds(markup)).toEqual(SOURCES.map((source) => source.source_id));
    expect(readsFailed(markup)).toEqual([]);
    expect(notProvisioned(markup)).toEqual([]);
    // The gauges are unnarrowed too, so the figures read the same set the
    // table renders.
    expect(trendSources(markup, AWAITING_BY_SOURCE)).toEqual([
      SOURCE.ticketmaster,
      SOURCE.bandsintown,
    ]);
  });

  it("narrows to nothing, and says so, when the URL names a well-formed id the registry lacks", async () => {
    // A `source_id` that IS an id but is nobody's: the narrowing is real, so
    // the table renders "nothing matched" rather than the whole registry —
    // told apart from the registry that holds nothing by the hook, never by
    // its words — and the gauges answer the SAME narrowing the table renders.
    //
    // In EVERY spelling of that id, for the reason the case below gives: an
    // id the registry lacks is still an id, so canonicalising the URL's value
    // may not turn a real narrowing into no narrowing at all (the direction
    // that would render the whole registry and read as "these three matched").
    for (const spelling of spellingsOf("01920000-0000-7000-8000-0000000000ff")) {
      const markup = await renderSources(healthyScript(), { source_id: spelling });
      expect(sourceIds(markup), spelling).toEqual([]);
      expect(
        cheerio.load(markup)("[data-empty]").attr("data-empty"),
        spelling,
      ).toBe("narrowing");
      expect(notProvisioned(markup), spelling).toEqual([]);
      expect(readsFailed(markup), spelling).toEqual([]);
      expect(trendSources(markup, AWAITING_BY_SOURCE), spelling).toEqual([]);
      expect(trendSources(markup, REJECTED_BY_SOURCE), spelling).toEqual([]);
    }
  });

  /**
   * Every spelling of one uuid Postgres itself accepts and a URL can carry:
   * canonical, uppercased, hyphen-less, and mixed — each names the SAME row
   * (`isRecordId`, `src/lib/records/id.ts`; the rule
   * `tests/offline/records/page.test.ts` states for `/records`).
   *
   * The guard proves itself on both inputs (LESSONS 3): every spelling but the
   * first must DIFFER from the canonical one, or a loop over four identical
   * strings would pass while nothing was canonicalised at all.
   */
  function spellingsOf(canonical: string): string[] {
    const spellings = [
      canonical,
      canonical.toUpperCase(),
      canonical.replace(/-/g, ""),
      canonical.replace(/-/g, "").toUpperCase(),
      // Mixed: the last group uppercased, the rest left alone.
      `${canonical.slice(0, 24)}${canonical.slice(24).toUpperCase()}`,
      // A hyphen after EVERY group of four, which is the other arm of
      // `isRecordId`'s grammar (`-?` between all eight groups) and the one no
      // case had reached. Postgres accepts it: measured read-only on staging
      // 2026-09-09, `sources` filtered `eq source_id` by
      // 01a0-1808-8c6f-78aa-b7a7-b07d-db3b-057a returns count=1 and the row
      // prints back as 01a01808-8c6f-78aa-b7a7-b07ddb3b057a
      // (`agenticflow/tracker/evidence/BUG-0139/qa/spelling-probe.mjs`).
      (canonical.replace(/-/g, "").match(/.{4}/g) ?? []).join("-"),
    ];
    for (const spelling of spellings.slice(1)) {
      expect(
        spelling,
        `${canonical} carries no hex letter, so this spelling is the canonical one and proves nothing`,
      ).not.toBe(canonical);
      expect(isRecordId(spelling), `${spelling} is an id Postgres accepts`).toBe(true);
    }
    return spellings;
  }

  it("narrows to the source the URL names, in every uuid spelling Postgres accepts", async () => {
    // The narrowing comes from the URL alone (admin-window/BUG-0139) and was
    // then compared to `source_id` as a JAVASCRIPT STRING (`selectSources`,
    // `selectPendingClaims`), while the same value went to the awaiting-row gauge's
    // QUERY, where Postgres compares it as a UUID — so a registered source
    // named in one of the other spellings was DENIED by the page while the
    // database it had just read matched it (admin-window/BUG-0140; measured
    // read-only on staging 2026-09-09: `sources` filtered `eq source_id` by
    // the canonical, uppercased, hyphen-less and upper-hyphen-less spellings
    // of one registered id returns count=1 for each).
    //
    // The registry here is `manySources`', whose ids carry a hex LETTER — the
    // population's own ids are all digits, so uppercasing one of those spells
    // the same string and the case would prove nothing. Its one source is
    // given a pending claim and a rejection stamp of its own, so all three
    // sections have something to say about the narrowing.
    const { sources: registry, runs } = manySources(1);
    const only = registry[0];
    const script = healthyScript({
      [T.sources]: [
        { data: [...registry], count: registry.length },
        { data: [...registry] },
      ],
      [T.runs]: { data: [...runs], count: runs.length },
      [T.observations]: [
        {
          data: [
            observationRow({
              observation_id: "01920000-0000-7000-8000-0000000d0001",
              source_id: only.source_id,
              status: "pending",
              observed_at: daysAgo(1),
            }),
          ],
        },
        {
          data: [
            observationRow({
              observation_id: "01920000-0000-7000-8000-0000000d0002",
              source_id: only.source_id,
              status: "rejected",
              rejected_at: daysAgo(2),
              rejected_by: "resolver",
            }),
          ],
        },
      ],
      [T.pendingClaims]: {
        data: [
          pendingClaimRow("awaiting_row", {
            observation_id: "01920000-0000-7000-8000-0000000d0001",
            source_id: only.source_id,
          }),
        ],
      },
    });

    // Every spelling lands on ONE state: that source's registry row, that
    // source's gauge rows, and the chip and row link that spell the narrowing
    // back as the canonical id.
    for (const spelling of spellingsOf(only.source_id)) {
      const markup = await renderSources(script, { source_id: spelling });
      expect(sourceIds(markup), spelling).toEqual([only.source_id]);
      expect(readsFailed(markup), spelling).toEqual([]);
      expect(notProvisioned(markup), spelling).toEqual([]);
      // The gauges answer the SAME narrowing the table renders — the half of
      // the defect that had the query match rows the fold then dropped. A
      // narrowed page plots that source's own days and weeks, so the claim
      // and the stamp it holds are what those two sections count.
      const days = tableRows(markup, AWAITING_BY_DAY);
      expect(days.length, spelling).toBeGreaterThan(0);
      expect(
        days.reduce((total, cells) => total + Number(cells[1]), 0),
        spelling,
      ).toBe(1);
      const weeks = tableRows(markup, REJECTED_BY_WEEK);
      expect(weeks.length, spelling).toBeGreaterThan(0);
      expect(
        weeks.reduce((total, cells) => total + Number(cells[1]), 0),
        spelling,
      ).toBe(1);
      expect(
        chips(markup)
          .filter((chip) => chip.active)
          .map((chip) => chip.href),
        spelling,
      ).toEqual([`/sources?source_id=${only.source_id}`]);
      expect(sourceRowOf(markup, only.source_id).narrowHref, spelling).toBe("/sources");
      // The half of the defect the RENDERING cannot show. Postgres compares a
      // uuid by VALUE, so the awaiting-row gauge's query matches every
      // spelling and its rows come back whatever the URL spelled; the fold
      // then compares the same value as a STRING. The two agree only if the
      // query was given the canonical spelling too, and the stub — which
      // ignores the chain and answers from its script — renders identically
      // either way. So this is asserted off the recorded call log: every
      // `source_id` this render put in front of the database is the one
      // spelling, whichever spelling the URL carried.
      const asked = sourceIdsAskedFor();
      expect(asked.length, spelling).toBeGreaterThan(0);
      expect([...new Set(asked)], spelling).toEqual([only.source_id]);
    }
  });

  it("issues its three reads together, so neither gauge waits behind the registry", async () => {
    // The registry, the awaiting-row trend and the settled-values gauge need
    // nothing from each other, and this page awaited them one after the other
    // (admin-window/BUG-0139). Each read is held until all three have been
    // ISSUED: a page that reads them in sequence never gets past the first.
    together.armed = true;
    together.issued = [];
    const timer = { at: undefined as ReturnType<typeof setTimeout> | undefined };
    const givesUp = new Promise<never>((_, reject) => {
      timer.at = setTimeout(
        () =>
          reject(
            new Error(
              `only ${together.issued.join(", ") || "none"} was issued: the reads are sequential`,
            ),
          ),
        2000,
      );
    });
    try {
      const markup = await Promise.race([renderSources(healthyScript()), givesUp]);
      expect(together.issued.slice().sort()).toEqual([
        "awaiting_row",
        "registry",
        "rejections",
      ]);
      // And the page it rendered is still the whole page.
      expect(sourceIds(markup)).toEqual(SOURCES.map((source) => source.source_id));
      expect(trendSources(markup, AWAITING_BY_SOURCE).length).toBeGreaterThan(0);
      expect(trendSources(markup, REJECTED_BY_SOURCE).length).toBeGreaterThan(0);
    } finally {
      if (timer.at !== undefined) clearTimeout(timer.at);
      together.armed = false;
      together.release();
    }
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

  it("keeps blaming the registry when a source id is in the URL and it holds nothing", async () => {
    // The two-fact rule (ARCHITECTURE.md §4.3, admin-window/DEBT-0008): the
    // URL alone said "narrowing" here, because a well-formed id in the URL IS
    // a structural narrowing — but a registry holding no rows had none for
    // that id to remove, so nothing was matched away and no filter may be
    // offered as the reason. Told apart from the case above by the FACT, not
    // by the words, and the arm is the same one the bare URL renders.
    const empty = healthyScript({ [T.sources]: [{ data: [], count: 0 }, { data: [] }] });
    const narrowed = await renderSources(empty, {
      source_id: "01920000-0000-7000-8000-0000000000ff",
    });
    const bare = await renderSources(empty);
    const cardOf = (markup: string): string =>
      cheerio.load(markup)("[data-empty]").text().replace(/\s+/g, " ").trim();

    expect(sourceIds(narrowed)).toEqual([]);
    expect(cheerio.load(narrowed)("[data-empty]").attr("data-empty")).toBe("registry");
    expect(cardOf(narrowed)).toBe(cardOf(bare));
    expect(notProvisioned(narrowed)).not.toContain(T.sources);
    // Non-vacuous the other way: over a registry that HOLDS rows, the same
    // shape of id still narrows and still says so (the case above pins every
    // spelling of it).
    const overRows = await renderSources(healthyScript(), {
      source_id: "01920000-0000-7000-8000-0000000000ff",
    });
    expect(cheerio.load(overRows)("[data-empty]").attr("data-empty")).toBe("narrowing");
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
    // `selectPendingClaims` — so the real read hands this section one series and
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

describe("the trend tables' own links", () => {
  it("draws each per-source trend row as a link at rest", async () => {
    const markup = await renderSources(healthyScript());
    const $ = cheerio.load(markup);
    const anchors = $("[data-trend-source][href]").toArray();
    expect(anchors.length, "no trend rows linked anywhere").toBeGreaterThan(0);
    for (const anchor of anchors) {
      expectDrawnAsLinkAtRest(classesOf($(anchor)), "a trend row's source");
    }
  });

  /**
   * What a trend row is CALLED is `sourceLabel`'s one rule
   * (`src/lib/sources/names.ts`) — asked over a names map, not spelled here as
   * `{name ?? sourceId}` (admin-window/BUG-0158, QA's attack on BUG-0156).
   * `??` sees only `null`, so a registry row that EXISTED with an ink-less
   * name took neither branch and both trends drew an anchor with nothing to
   * read and nothing visible to click, beside sibling rows naming their source.
   *
   * BOTH tables, because they label from DIFFERENT reads: the awaiting-row
   * trend takes the map this page builds from its own registry read, the
   * settled-values trend takes the one the gauge built from the `sources` rows
   * IT read (`RejectionSection`). The script blanks the same source in both
   * responses, so a fix that reached only one of them fails here.
   */
  for (const blank of ["", "   ", "\u200b"]) {
    it(`names a source the registry names ${JSON.stringify(blank)} by its id, in both trends`, async () => {
      const blanked = SOURCES.map((row) =>
        row.source_id === SOURCE.ticketmaster ? { ...row, source: blank } : row,
      );
      const markup = await renderSources(
        healthyScript({
          [T.sources]: [
            { data: blanked, count: blanked.length },
            { data: blanked },
          ],
        }),
      );
      for (const table of [AWAITING_BY_SOURCE, REJECTED_BY_SOURCE]) {
        // The id VERBATIM, which is the only true thing left to say about it.
        expect(trendRow(markup, table, SOURCE.ticketmaster)[0], table).toBe(
          SOURCE.ticketmaster,
        );
        // Non-vacuity, in the same read: the sibling still reads as its name,
        // so this is a per-ROW fallback and not a blanked trend.
        expect(trendRow(markup, table, SOURCE.bandsintown)[0], table).toBe(
          SOURCE_NAME[SOURCE.bandsintown],
        );
      }
    });
  }

  it("leaves a registry name with ink in it exactly as the registry wrote it", async () => {
    // The other direction (LESSONS 8): a name the app can read is never
    // trimmed and never swapped for the id, on either trend.
    const padded = "  ticketmaster  ";
    const rows = SOURCES.map((row) =>
      row.source_id === SOURCE.ticketmaster ? { ...row, source: padded } : row,
    );
    const markup = await renderSources(
      healthyScript({
        [T.sources]: [{ data: rows, count: rows.length }, { data: rows }],
      }),
    );
    for (const table of [AWAITING_BY_SOURCE, REJECTED_BY_SOURCE]) {
      const $ = cheerio.load(markup);
      const anchor = $(`table[aria-label="${table}"] [data-trend-source="${SOURCE.ticketmaster}"]`);
      expect(anchor.text(), table).toBe(padded);
      expect(anchor.text(), table).toHaveLength(padded.length);
    }
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

  /**
   * **The sentence counts what the rows above it show** (admin-window/TASK-0060).
   *
   * The closing sentence says how many of these sources are named by their id.
   * It answered that itself — `split.source === null` — while the rows were
   * labelled by `sourceLabel`, which also names by id a row that EXISTS with an
   * ink-less name. So on a blank-named registry row the table showed a uuid
   * where a name goes and the sentence under it said nothing had happened: one
   * page, two answers about one row (LESSONS 11), and the number stated
   * disagreed with the rows beside it.
   *
   * The fixture drops the one rejection carrying no reason, so the sentence's
   * ONLY figure is the count under test — with the unattributed clause present
   * a case could not tell which number it was reading.
   */
  it("states the number of rows it named by id, on a row the registry left blank", async () => {
    const attributed = REJECTIONS.filter((row) => row.rejected_by !== null);
    const script = (rows: typeof SOURCES): Script =>
      healthyScript({
        [T.sources]: [{ data: rows, count: rows.length }, { data: rows }],
        [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: attributed }],
      });
    const blanked = SOURCES.map((row) =>
      row.source_id === SOURCE.ticketmaster ? { ...row, source: "   " } : row,
    );

    const withBlank = await renderSources(script(blanked));
    const allNamed = await renderSources(script(SOURCES));

    // Both fixtures really are two rows of one table, or the counts below are
    // over a table that rendered nothing.
    for (const [name, markup] of [["blank", withBlank], ["named", allNamed]] as const) {
      expect(trendSources(markup, REJECTED_BY_SOURCE).sort(), name).toEqual(
        [SOURCE.ticketmaster, SOURCE.bandsintown].sort(),
      );
    }

    // The row the registry named nothing for wears its id; its sibling does
    // not (LESSONS 8 — one input the count MUST take, one it must not).
    const worn = wearingAnId(withBlank, REJECTED_BY_SOURCE);
    expect(worn).toEqual([SOURCE.ticketmaster]);
    // ...and the sentence states THAT number, read off the rows rather than
    // typed in here.
    expect(figuresIn(settledValuesSentence(withBlank))).toEqual([String(worn.length)]);

    // The other direction, same population with a name on it: no row wears an
    // id and the sentence states no figure at all — so the agreement above is
    // not a sentence that always says "1".
    expect(wearingAnId(allNamed, REJECTED_BY_SOURCE)).toEqual([]);
    expect(figuresIn(settledValuesSentence(allNamed))).toEqual([]);
    expect(settledValuesSentence(withBlank)).not.toBe(settledValuesSentence(allNamed));
  });

  it("reports a blank-named source it is NARROWED to as its own, once", async () => {
    // Narrowed, the sentence is about one row and says so without a figure —
    // and it must still be said: the operator is looking at a uuid where a
    // name belongs and is owed the reason. Graded by difference against the
    // same narrowing with a name on the row, so no copy is pinned.
    const params = { source_id: SOURCE.ticketmaster };
    const blanked = SOURCES.map((row) =>
      row.source_id === SOURCE.ticketmaster ? { ...row, source: "\u200b" } : row,
    );
    const withBlank = await renderSources(
      healthyScript({
        [T.sources]: [{ data: blanked, count: blanked.length }, { data: blanked }],
      }),
      params,
    );
    const allNamed = await renderSources(healthyScript(), params);

    // The narrowed branch really is what rendered — the weeks table, not the
    // per-source one — so the clause under test is the narrowed spelling.
    expect(columnCount(withBlank, REJECTED_BY_WEEK)).toBeGreaterThan(0);
    expect(settledValuesSentence(withBlank)).not.toBe(settledValuesSentence(allNamed));
    // One row, so one mention of it: the narrowed clause carries no count and
    // must not have grown the fleet's.
    expect(figuresIn(settledValuesSentence(withBlank))).toEqual(
      figuresIn(settledValuesSentence(allNamed)),
    );
  });

  /**
   * **BOTH ways the registry names nothing, counted by one number**
   * (admin-window/TASK-0060, QA attack).
   *
   * The sentence's words claim the REGISTRY gave these sources no name — a
   * claim over two different states that look identical to an operator: a row
   * that did not come back at all, and a row that came back with no ink in it.
   * The cases above prove each mechanism alone; this one puts them in ONE
   * render, where a count answering the question its own way can still agree
   * with the rows by accident on a single-row fixture.
   *
   * The gauge's own registry lookup is the one that is starved (the page's
   * complete read still names both, so the chips and the registry table above
   * are untouched): ticketmaster comes back blank, bandsintown does not come
   * back. Both rows are then labelled by `sourceLabel` with their ids, and the
   * sentence under them must state 2 — not the 1 that `split.source === null`
   * could see.
   */
  it("counts a blank-named source and a source with no registry row alike", async () => {
    const attributed = REJECTIONS.filter((row) => row.rejected_by !== null);
    const lookup = (rows: typeof SOURCES): Script =>
      healthyScript({
        // [0] is the page's own complete registry read, [1] is the gauge's.
        [T.sources]: [{ data: [...SOURCES], count: SOURCES.length }, { data: rows }],
        [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: attributed }],
      });
    const blanked = (rows: typeof SOURCES): typeof SOURCES =>
      rows.map((row) =>
        row.source_id === SOURCE.ticketmaster ? { ...row, source: "   " } : row,
      );
    const withoutBandsintown = SOURCES.filter(
      (row) => row.source_id !== SOURCE.bandsintown,
    );

    const bothWays = await renderSources(lookup(blanked(withoutBandsintown)));
    const blankOnly = await renderSources(lookup(blanked(SOURCES)));
    const missingOnly = await renderSources(lookup(withoutBandsintown));
    const allNamed = await renderSources(lookup(SOURCES));

    // Every fixture rendered the same two-row population, or the counts below
    // are over tables that differ for another reason.
    for (const [what, markup] of [
      ["both", bothWays],
      ["blank", blankOnly],
      ["missing", missingOnly],
      ["named", allNamed],
    ] as const) {
      expect(trendSources(markup, REJECTED_BY_SOURCE).sort(), what).toEqual(
        [SOURCE.ticketmaster, SOURCE.bandsintown].sort(),
      );
    }

    // Both rows wear an id, and the sentence states THAT number — read off the
    // rendered rows, never typed in here.
    expect(wearingAnId(bothWays, REJECTED_BY_SOURCE).sort()).toEqual(
      [SOURCE.ticketmaster, SOURCE.bandsintown].sort(),
    );
    expect(figuresIn(settledValuesSentence(bothWays))).toEqual(["2"]);

    // Each mechanism ALONE is one row and one, so the 2 above is the sum of
    // two states and not one state counted twice (LESSONS 8).
    for (const [what, markup, worn] of [
      ["blank", blankOnly, SOURCE.ticketmaster],
      ["missing", missingOnly, SOURCE.bandsintown],
    ] as const) {
      expect(wearingAnId(markup, REJECTED_BY_SOURCE), what).toEqual([worn]);
      expect(figuresIn(settledValuesSentence(markup)), what).toEqual(["1"]);
    }

    // The words are true of both states or of neither: a missing row and a
    // blank one are one fact to an operator, so the page says the same thing
    // about them. (Graded by identity between two renders, so no copy is
    // pinned — whatever the sentence says, it says it once for both.)
    expect(settledValuesSentence(blankOnly)).toBe(settledValuesSentence(missingOnly));
    // And it is not a sentence that always says something: named, it does not.
    expect(figuresIn(settledValuesSentence(allNamed))).toEqual([]);
    expect(wearingAnId(allNamed, REJECTED_BY_SOURCE)).toEqual([]);
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

  /**
   * **The line and the figures agree in kind, under every URL** —
   * admin-window/BUG-0194, filed by QA against the landed TASK-0073 tree and
   * ruled fixed AT THE READ (architect, 2026-09-11).
   *
   * It stood here as `it.fails` while the two halves disagreed:
   * `readRejectionStampGauge()` took no filter, so the scan was the fleet's
   * while `RejectionSection` reported one source's rows out of it — both cards
   * moved between the two URLs under a sentence, a cap and a truncation verdict
   * that were byte-identical to the fleet's rendering. TASK-0073's rule is that
   * a window line states the read that HAPPENED, so the only way to agreement
   * was to move the READ; `readRejectionStampGauge({ filter })` now narrows at
   * the query (`tests/offline/gauges/settled-values.test.ts` grades the `eq`)
   * and the line follows the filter it was given, with the cap and the verdict
   * belonging to the population the figures are over (admin-window/BUG-0114).
   *
   * Non-vacuous in both directions, off the rendering alone: the figures are
   * asserted to move first, and the bare head is asserted to name nothing.
   */
  it("names the narrowing its own figures carry [BUG-0194]", async () => {
    const bare = await renderSources(healthyScript());
    const narrowed = await renderSources(healthyScript(), {
      source_id: SOURCE.ticketmaster,
    });

    /**
     * This section's head: the sentence about the read, and the cards whose
     * figures sit under it — its WORDS (every digit masked, so two clocks
     * and two counts cannot make two renderings differ on their own) and its
     * FIGURES, read off the same markup.
     */
    const headOf = (markup: string) => {
      const $ = cheerio.load(markup);
      const line = $('[data-window="rejections"]');
      expect(line.length).toBe(1);
      const cards = line.next();
      const text = (node: ReturnType<typeof $>) =>
        node.text().replace(/\s+/g, " ").trim();
      const whole = `${text(line)} ${text(cards)}`.trim();
      return {
        whole,
        words: whole.replace(/[\d,]+/g, "#").trim(),
        figures: text(cards).match(/\d[\d,]*/g) ?? [],
      };
    };

    // The narrowing really does move this section's figures — otherwise the
    // agreement below would be about a page that says nothing either way.
    expect(headOf(bare).figures.length).toBeGreaterThan(0);
    expect(headOf(narrowed).figures).not.toEqual(headOf(bare).figures);

    // ...and the words over them move with them, which is the whole ticket.
    expect(headOf(narrowed).words).not.toBe(headOf(bare).words);

    // What the words say is the facet the read carried, spelled as the URL
    // spells it — and the bare head, whose read carried none, names none.
    expect(headOf(narrowed).whole).toContain(SOURCE.ticketmaster);
    expect(headOf(bare).whole).not.toContain(SOURCE.ticketmaster);

    // The figures under that sentence are that read's rows: one source's
    // re-rejects narrowed, and every source's bare.
    expect(readNumber(narrowed, REJECTED_FIGURE)).toBe(rerejects(SOURCE.ticketmaster));
    expect(readNumber(bare, REJECTED_FIGURE)).toBe(
      SOURCES.reduce((total, source) => total + rerejects(source.source_id), 0),
    );
  });

  it("names its narrowing over real zeros when the narrowed scan matched nothing", async () => {
    // A well-formed `source_id` the scan came back empty for: the line STILL
    // names what it was narrowed to, and the cards render real zeros with
    // their own sub-line rather than dropping (ARCHITECTURE.md §4.3 — a
    // narrowed scan that returned nothing is still a window).
    const markup = await renderSources(
      healthyScript({
        // The rejection scan is the SECOND `observations` read of this page.
        [T.observations]: [{ data: [...PENDING_OBSERVATIONS] }, { data: [] }],
      }),
      { source_id: SOURCE.ticketmaster },
    );

    const $ = cheerio.load(markup);
    const line = $('[data-window="rejections"]');
    expect(line.length).toBe(1);
    expect(line.text()).toContain(SOURCE.ticketmaster);
    // The rows really are none — otherwise this case proves nothing.
    expect(trendSources(markup, REJECTED_BY_SOURCE)).toEqual([]);
    // Both cards are drawn, as real zeros, and the second keeps its own
    // sub-line over the population it counted.
    expect(readNumber(markup, REJECTED_FIGURE)).toBe(0);
    const cards = line.next().text().replace(/\s+/g, " ").trim();
    expect(cards).toContain("0");
    expect(cards.match(/\d[\d,]*/g) ?? []).toEqual(["0", "0", "0"]);
  });

  it("costs no extra round trip, and one rejection scan, at either URL", async () => {
    // The new fact is carried by the read that already happened: narrowing is
    // an `eq` on the scan, never a second query (LESSONS 10 — count the round
    // trips the page issues).
    const measure = async (params: Record<string, string>) => {
      await renderSources(healthyScript(), params);
      const stub = lastStub;
      if (stub === undefined) throw new Error("no render recorded");
      return {
        calls: stub.calls.length,
        scans: stub.calls.filter((call) =>
          call.steps.some(
            (step) => step.method === "gte" && step.args[0] === "rejected_at",
          ),
        ).length,
      };
    };

    const bare = await measure({});
    const narrowed = await measure({ source_id: SOURCE.ticketmaster });
    expect(bare.scans, "the bare URL issued more than one rejection scan").toBe(1);
    expect(narrowed.scans, "the narrowed URL issued more than one rejection scan").toBe(1);
    expect(narrowed.calls, "the narrowed URL cost more requests than the bare one").toBe(
      bare.calls,
    );
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
        [T.runs]: { data: [], count: 0 },
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

  it("never uppercases a machine identifier into a sans micro label", async () => {
    // The `micro` step is uppercase sans, so an identifier put inside one is
    // rewritten on screen — `source_id` reached the walk as `SOURCE_ID` above
    // its own chips (admin-window/BUG-0049, LOOK_AND_FEEL Voice bar 5). The
    // identifier still has to be THERE: the group's label is the URL parameter
    // it sets, which is the whole reason it is spelled that way.
    for (const [state, script] of Object.entries({
      healthy: healthyScript(),
      empty: healthyScript({
        [T.sources]: [{ data: [], count: 0 }, { data: [] }],
        [T.observations]: [{ data: [] }, { data: [] }],
        [T.pendingClaims]: { data: [] },
        [T.runs]: { data: [], count: 0 },
      }),
      absent: healthyScript({
        [T.sources]: [
          { error: tableNotInSchemaCache(T.sources) },
          { error: tableNotInSchemaCache(T.sources) },
        ],
      }),
    })) {
      // The guard proves itself before it clears the page: the spelling that
      // shipped MUST be found, or the assertion below is vacuous.
      expect(
        uppercasedIdentifiers('<span class="type-micro">source_id</span>'),
      ).toEqual(["source_id"]);
      const markup = await renderSources(script);
      expect(uppercasedIdentifiers(markup), state).toEqual([]);
      expect(markup, state).not.toContain("SOURCE_ID");
    }

    // and it is still on screen, verbatim, in the group it names — the guard
    // must not be satisfiable by deleting the label. (Only the registry state
    // renders chips at all: with no sources there is nothing to narrow.)
    const $ = cheerio.load(await renderSources(healthyScript()));
    expect($('[data-facet="source_id"]').text().replace(/\s+/g, " ").trim())
      .toContain("source_id");
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

/* ── the two scan-window lines' scope (admin-window/TASK-0073, SPEC F15) ─── */

/**
 * **Each of this page's two window lines names the narrowing ITS OWN READ
 * carried** — the defect admin-window/BUG-0163 fixed on `/claims` one page
 * over, here (campaign admin-window/TASK-0073, SPEC F15, M3 EC8).
 *
 * The rule is ARCHITECTURE.md §4.3's: a window line states the read that
 * HAPPENED. So the scope is unconditional on what came back — a narrowed scan
 * that returned nothing still names its narrowing — and it names what the READ
 * carried, never what the URL spelled. Each line is graded against ITS OWN
 * scan, and this page issues two of them:
 *
 *  - the awaiting-row trend is `readAwaitingRowTrend({ filter })` — narrowed at
 *    the query, so `?source_id=` really is that scan's population and its line
 *    says so;
 *  - the settled-values gauge is `readRejectionStampGauge({ filter })` —
 *    narrowed at the query too **since admin-window/BUG-0194**, so its line
 *    names the narrowing as well. It took no filter at all until then while
 *    `RejectionSection` narrowed the ROWS it returned anyway, so that
 *    sentence's cap and its truncation verdict ("a window of at most N rows")
 *    stood over a population its own figures were not over —
 *    admin-window/BUG-0114's defect with its halves swapped. The section still
 *    re-selects the rows it is handed (`selectPendingClaims`' idiom), which is
 *    a defence if a future caller hands it a wider read and not a second
 *    narrowing.
 *
 * Nothing here pins the app's words. The value a case asserts is the id THIS
 * TEST put in the URL, and where a case needs the phrase itself it computes it
 * by DIFFERENCE between the two renders rather than retyping the sentence.
 */
/**
 * The instant of a render, which differs between two renders by construction.
 *
 * Module-scope because two sections mask it: the window lines' own words, and
 * the whole-page comparison of admin-window/BUG-0201 below. Two spellings of
 * one mask is the class LESSONS 5 names.
 */
const INSTANT = /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/g;

describe("what the two scan-window lines say they read", () => {
  /**
   * The files this section's line and figures come out of: the component that
   * renders both lines, and the two modules the settled-values read now runs
   * through (admin-window/BUG-0194). None of them may spell a narrowing
   * sentence of its own — the phrase is composed from `lib/url/narrowing.ts`
   * and this surface's facet table, and a retyped one is LESSONS 5's class
   * even when it renders the right words.
   */
  const SAY_NOTHING = [
    "src/components/sources/trends.tsx",
    "src/lib/gauges/settled-values.ts",
    "src/lib/db/gauges.ts",
  ];

  /**
   * One window line's words, with both instants masked.
   *
   * `until` is the moment the window was measured back from, so two renders
   * never share it and a raw comparison of two lines is a comparison of two
   * clocks. Masked, what is left is exactly what the page CHOSE to say.
   */
  function lineOf(markup: string, gauge: string): string {
    const line = cheerio.load(markup)(`[data-window="${gauge}"]`);
    expect(line.length, gauge).toBe(1);
    return line.text().replace(/\s+/g, " ").trim().replace(INSTANT, "<instant>");
  }

  /**
   * The words one line has that the other does not — the narrowing phrase,
   * recovered by difference so no copy is retyped into this file.
   *
   * Both inputs are masked lines of the same gauge, so the only thing that can
   * differ is what the page added for the narrowing.
   */
  function addedTo(bare: string, narrowed: string): string {
    let head = 0;
    while (head < bare.length && bare[head] === narrowed[head]) head += 1;
    let tail = 0;
    while (
      tail < bare.length - head &&
      bare[bare.length - 1 - tail] === narrowed[narrowed.length - 1 - tail]
    ) {
      tail += 1;
    }
    return narrowed.slice(head, narrowed.length - tail);
  }

  it("names the narrowing each scan carried, and names it in no line whose read did not", async () => {
    const bare = await renderSources(healthyScript());
    const bareScans = sourceIdsAskedForPerScan();
    const narrowed = await renderSources(healthyScript(), {
      source_id: SOURCE.ticketmaster,
    });
    const narrowedScans = sourceIdsAskedForPerScan();

    // BOTH reads carry the facet (admin-window/BUG-0194). The awaiting-row scan
    // always did; the settled-values scan took none at all while the figures
    // under its line were narrowed anyway, so one sentence described a
    // population its own figures were not over.
    for (const gauge of ["awaiting_row", "rejections"]) {
      // The id the URL asked for is in the narrowed line and in no bare one...
      expect(lineOf(narrowed, gauge), gauge).toContain(SOURCE.ticketmaster);
      expect(lineOf(bare, gauge), gauge).not.toContain(SOURCE.ticketmaster);
      // ...and the two URLs really are two different sentences over two
      // different reads; the defect was that they were byte-identical.
      expect(lineOf(narrowed, gauge), gauge).not.toBe(lineOf(bare, gauge));
    }

    // Each sentence is about the read that HAPPENED, graded per scan: the page
    // issues two `observations` scans, told apart by the column each windows
    // on, and under the narrowed URL both carried the `eq` while under the bare
    // URL neither did. A line naming a narrowing its own query never made is
    // this whole family of bugs.
    expect(narrowedScans).toEqual({
      observed_at: [SOURCE.ticketmaster],
      rejected_at: [SOURCE.ticketmaster],
    });
    expect(bareScans).toEqual({ observed_at: [], rejected_at: [] });

    // Non-vacuous on the figures too: the settled-values section really does
    // report different numbers at the two URLs, and now says which population
    // they are over. (The stub answers from its script and ignores the chain,
    // so these figures are `RejectionSection` re-selecting the rows it was
    // handed — the `selectPendingClaims` idiom, kept deliberately.)
    expect(rerejects(SOURCE.ticketmaster)).not.toBe(
      SOURCES.reduce((total, source) => total + rerejects(source.source_id), 0),
    );
    expect(readNumber(narrowed, REJECTED_FIGURE)).toBe(rerejects(SOURCE.ticketmaster));
    expect(readNumber(bare, REJECTED_FIGURE)).toBe(
      SOURCES.reduce((total, source) => total + rerejects(source.source_id), 0),
    );
  });

  it("still names its narrowing when the narrowed scan came back with nothing", async () => {
    // The line follows the READ, not the rows (ARCHITECTURE.md §4.3): a scan
    // that carried `?source_id=` and matched no observation at all is still a
    // scan of one source's claims, and a sentence that dropped the narrowing
    // here would describe the whole table's emptiness.
    const nothing = healthyScript({
      [T.observations]: [{ data: [] }, { data: [...REJECTIONS] }],
    });
    const markup = await renderSources(nothing, { source_id: SOURCE.ticketmaster });

    // The rows really are none — otherwise this case proves nothing.
    expect(trendSources(markup, AWAITING_BY_SOURCE)).toEqual([]);
    expect(readNumber(markup, "Awaiting-row claims in this window")).toBe(0);
    expect(lineOf(markup, "awaiting_row")).toContain(SOURCE.ticketmaster);
  });

  it("names nothing for a parameter this page DROPPED", async () => {
    // A facet that never reaches a filter narrowed no read, so it may appear in
    // no scope: `?source_id=` carrying something that is not a uuid is dropped
    // by the page (it can equal no row anywhere), and a parameter this route
    // does not read at all was never a facet of it.
    const bare = await renderSources(healthyScript());
    const dropped: [string, Record<string, string>][] = [
      ["a source_id that is not an id", { source_id: "nobody" }],
      ["a parameter this route does not read", { bucket: "awaiting_row" }],
    ];
    for (const [name, params] of dropped) {
      const markup = await renderSources(healthyScript(), params);
      for (const gauge of ["awaiting_row", "rejections"]) {
        expect(lineOf(markup, gauge), `${name}: ${gauge}`).toBe(lineOf(bare, gauge));
        for (const value of Object.values(params)) {
          expect(lineOf(markup, gauge), `${name}: ${gauge}`).not.toContain(value);
        }
      }
    }
    // Non-vacuous: on this same page a facet that DID reach a filter moves one
    // of the two lines, so "unchanged" here is a fact about the parameter and
    // not about a page that never says anything.
    const real = await renderSources(healthyScript(), {
      source_id: SOURCE.ticketmaster,
    });
    expect(lineOf(real, "awaiting_row")).not.toBe(lineOf(bare, "awaiting_row"));
  });

  it("writes the narrowing sentence nowhere in the components that render the lines", async () => {
    // LESSONS 5: the phrase, its composition and its subtraction are imported
    // (`lib/url/narrowing.ts`, `components/ui/window-line.tsx`) and this
    // surface declares only its own facet TABLE, in `lib/sources/routes.ts`. A
    // hand-written sentence beside the line fails this ticket even when it
    // renders the right words.
    const bare = lineOf(await renderSources(healthyScript()), "awaiting_row");
    const narrowed = lineOf(
      await renderSources(healthyScript(), { source_id: SOURCE.ticketmaster }),
      "awaiting_row",
    );
    // The phrase as RENDERED, recovered by difference — never retyped here.
    const phrase = addedTo(bare, narrowed);
    expect(phrase).toContain(SOURCE.ticketmaster);
    // It spells the parameter as the URL spells it, so an operator reading the
    // line off the screen can write the narrowing back into the address bar.
    expect(phrase).toContain("source_id");

    // The words either side of the value — everything the app chose to say —
    // appear in no component that renders these lines.
    const words = phrase
      .split(SOURCE.ticketmaster)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      // The scanner on an input it MUST flag: a component that retyped this
      // sentence would read exactly like this.
      expect(codeLinesIn(`  measured={\`Claims observed ${word} \${id}\`}`).join("\n")).toContain(
        word,
      );
      // ...and on the files themselves, none of which does.
      for (const file of SAY_NOTHING) {
        expect(codeText(file), `${file}: ${word}`).not.toContain(word);
      }
    }
  });
});

/* -- what the URL asked for that this page did not do (BUG-0201) ---------- */

/**
 * The dropped-parameter sentence, on THIS page (campaign admin-window/BUG-0201).
 *
 * Tomas asked `/sources` for one source with `?source_id=deadbeef` and got the
 * whole registry back under no notice of any kind, with both gauges quietly
 * reporting every source: "if I had glanced at that screen believing I had
 * narrowed to one source, I would have read three sources' rows as one
 * source's story" (`M3-usersim-tomas.md`). The page really may not narrow by
 * that value - it can equal no row anywhere - so dropping it is right and
 * dropping it SILENTLY is the bug (LOOK_AND_FEEL bar 13).
 *
 * Every case below is graded at the SURFACE, through the two hooks the shared
 * line ships (`data-dropped-params`, `data-dropped-param`), never against the
 * app's copy: the rule and its words belong to `lib/url/dropped-params.ts` and
 * `components/ui/dropped-params.tsx`, which carry their own suites. What is
 * this page's to prove is WHICH narrowing it hands over - the filter its reads
 * carried, never the URL - and that nothing else on the page moved.
 */
describe("a parameter this page did not apply", () => {
  /** What the page says it did not apply: the shared line's two hooks. */
  function droppedLine(markup: string) {
    const $ = cheerio.load(markup);
    const line = $("[data-dropped-params]");
    return {
      lines: line.length,
      total: line.length === 0 ? 0 : Number(line.attr("data-dropped-params")),
      names: line
        .find("[data-dropped-param]")
        .toArray()
        .map((element) => $(element).attr("data-dropped-param") ?? ""),
      text: line.text().replace(/\s+/g, " ").trim(),
    };
  }

  /**
   * The edge of a window, as its own hook carries it: an ISO instant with
   * MILLISECONDS, which two renders never share either. Masked beside the
   * words, so what is compared below is what the page chose and not its clock
   * - a fixture instant (`2026-09-01T05:00:00Z`, no fraction) is stable and
   * deliberately outside this pattern, so a row's own timestamps still count.
   */
  const WINDOW_EDGE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

  /** A render with both of its clocks masked and nothing else touched. */
  function masked(markup: string): string {
    return markup.replace(INSTANT, "<instant>").replace(WINDOW_EDGE, "<edge>");
  }

  /**
   * The whole page with that one line removed and both clocks masked - which
   * is everything this ticket promised not to move.
   */
  function withoutDroppedLine(markup: string): string {
    const $ = cheerio.load(markup);
    $("[data-dropped-params]").remove();
    return masked($.html());
  }

  /** The same id, spelled the way a paste that lost the hyphens spells it. */
  const HYPHENLESS = SOURCE.ticketmaster.replace(/-/g, "");

  /** ZERO WIDTH SPACE: a key a reader would see nothing of at all. */
  const NO_INK = "​";

  /** RIGHT-TO-LEFT OVERRIDE: a key this sentence may not spell, in one. */
  const UNSPELLABLE_KEY = "so‮rce";

  it("names a source_id it could not use as a parameter it did not apply", async () => {
    // The bare page says nothing, because nothing was asked and dropped.
    const bare = await renderSources(healthyScript());
    expect(droppedLine(bare).lines).toBe(0);

    // The URL of the finding. The page still answers with the WHOLE registry
    // - that half is correct and unchanged - and now names the parameter it
    // could not use, so three sources' rows cannot be read as one source's.
    const unusable = await renderSources(healthyScript(), { source_id: "deadbeef" });
    expect(sourceIds(unusable)).toEqual(SOURCES.map((source) => source.source_id));
    expect(droppedLine(unusable).names).toEqual(["source_id"]);
    expect(droppedLine(unusable).total).toBe(1);
    // The NAME is spelled; the VALUE never is (LOOK_AND_FEEL bar 3).
    expect(droppedLine(unusable).text).not.toContain("deadbeef");

    // An id this page really did narrow by is NOT named - in every spelling
    // canonicalisation accepts, since the read carried the canonical one.
    for (const spelling of [SOURCE.ticketmaster, HYPHENLESS]) {
      const narrowed = await renderSources(healthyScript(), { source_id: spelling });
      // Non-vacuous: that URL really did narrow the table to the one source.
      expect(sourceIds(narrowed), spelling).toEqual([SOURCE.ticketmaster]);
      expect(droppedLine(narrowed).lines, spelling).toBe(0);
    }
    // The guard's other passing fixture: a well-formed id the registry does
    // not hold still NARROWED, so it is not a dropped parameter - what came
    // back is `data-empty="narrowing"`'s to say and it already says it.
    const absent = await renderSources(healthyScript(), {
      source_id: "01920000-0000-7000-8000-0000000000ff",
    });
    expect(cheerio.load(absent)("[data-empty]").attr("data-empty")).toBe("narrowing");
    expect(droppedLine(absent).lines).toBe(0);
  });

  it("names a key this route does not read at all, whatever it is called", async () => {
    // `?q=`, `?table=` and `?limit=` are keys other surfaces of this app offer
    // and this one never looks at; `?tab=` is one too, because this route has
    // no tab strip to consume it - so the caller hands the rule an empty
    // consumed list, exactly as `/cycles`, the other tabless route, does.
    for (const key of ["q", "table", "limit", "tab"]) {
      const markup = await renderSources(healthyScript(), { [key]: "sources" });
      expect(droppedLine(markup).names, key).toEqual([key]);
      // Nothing was narrowed by it, and the registry it answered with is whole.
      expect(sourceIds(markup), key).toEqual(SOURCES.map((source) => source.source_id));
    }

    // Two at once are both named, in the order the URL carried them, and an
    // applied facet beside them is not named at all.
    const several = await renderSources(healthyScript(), {
      source_id: SOURCE.ticketmaster,
      table: "sources",
      limit: "-1",
    });
    expect(droppedLine(several).names).toEqual(["table", "limit"]);
    expect(droppedLine(several).total).toBe(2);
    expect(sourceIds(several)).toEqual([SOURCE.ticketmaster]);
  });

  it("says nothing for a request that named nothing, and counts a name it may not spell", async () => {
    // The module's own rules, reached through this caller: a key with no
    // value, a value with no key, and a key a reader would see nothing of all
    // asked for nothing, so there is no narrowing to have dropped
    // (admin-window/BUG-0127, admin-window/BUG-0136).
    const silent: [string, Record<string, string>][] = [
      ["a facet carrying no value", { source_id: "" }],
      ["a key this route does not read, carrying no value", { table: "" }],
      ["a value with no key at all", { "": "deadbeef" }],
      ["a key with no ink in it", { [NO_INK]: "1" }],
    ];
    for (const [name, params] of silent) {
      const markup = await renderSources(healthyScript(), params);
      expect(droppedLine(markup).lines, name).toBe(0);
    }

    // ...and the arm it MUST flag: a key outside the renderable allowlist is
    // still reported, COUNTED rather than spelled, so no bidi control from a
    // URL sits inside a sentence this app wrote (admin-window/BUG-0137).
    const unspellable = await renderSources(healthyScript(), {
      [UNSPELLABLE_KEY]: "1",
    });
    expect(droppedLine(unspellable).total).toBe(1);
    expect(droppedLine(unspellable).names).toEqual([]);
    expect(unspellable).not.toContain(UNSPELLABLE_KEY);
  });

  it("states it over a read that refused, because it is a fact of the URL", async () => {
    // The line stands beside the chip row rather than inside a section, so it
    // renders the same over an `ok` read, a refusal and a registry that is not
    // there - the two states where the chips themselves are not drawn at all.
    const states: [string, Script][] = [
      [
        "absent registry",
        healthyScript({ [T.sources]: { error: tableNotInSchemaCache(T.sources) } }),
      ],
      [
        "refused registry",
        healthyScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
      ],
    ];
    for (const [name, script] of states) {
      const markup = await renderSources(script, { source_id: "deadbeef" });
      expect(droppedLine(markup).names, name).toEqual(["source_id"]);
      // The read's own state is still the page's answer about the read.
      expect(sourceIds(markup), name).toEqual([]);
    }
  });

  it("moves nothing else on the page", async () => {
    // The registry table, both gauges, every window line and every scope
    // phrase are what they were at the same URL before this line existed: a
    // dropped parameter reaches no filter, so the page under the line is the
    // bare page, byte for byte with the render instants masked.
    const bare = await renderSources(healthyScript());
    const urls: Record<string, string>[] = [
      { source_id: "deadbeef" },
      { table: "sources" },
      { [UNSPELLABLE_KEY]: "1" },
    ];
    for (const params of urls) {
      const markup = await renderSources(healthyScript(), params);
      // Non-vacuous: there IS a line in each of these renders to remove.
      expect(droppedLine(markup).total, JSON.stringify(params)).toBe(1);
      expect(withoutDroppedLine(markup), JSON.stringify(params)).toBe(
        withoutDroppedLine(bare),
      );
    }
    // And a page that dropped nothing renders no line to remove at all, so
    // the comparison above is between a page WITH the sentence and the page
    // as it stands today rather than between two stripped renders.
    expect(droppedLine(bare).lines).toBe(0);
    expect(withoutDroppedLine(bare)).toBe(masked(cheerio.load(bare).html()));
  });
});

/* ── where this page's presentation lives (admin-window/DEBT-0004) ───────── */

/**
 * The structural half of ARCHITECTURE.md §13.6, asserted here rather than left
 * to the next builder's discipline: this page ships its own
 * `src/components/sources/` module, the page file defines no component of its
 * own, nothing in that module can reach a database, and the URL work sits in a
 * pure leaf below both of them.
 *
 * It was 793 lines with six components written where the page function is
 * (common violation 10). Each rule below is stated with BOTH fixtures — the
 * input it must flag and the input it must not.
 */
describe("the module this page's presentation lives in", () => {
  const PAGE = "src/app/sources/page.tsx";
  const MODULE = "src/components/sources/";
  const LEAF = "src/lib/sources/routes.ts";

  /** A component DEFINITION at the top level of a file, in either spelling. */
  const COMPONENT = /^(export\s+)?(default\s+)?function\s+[A-Z]/m;

  /** Anything below the page that awaits — §5's one-async-boundary rule. */
  const AWAITS = /\basync\b|\bawait\b/;

  it("contains the page, the module and the leaf these rules are about", () => {
    const files = sourceFiles();
    expect(files).toContain(PAGE);
    expect(files).toContain("src/components/sources/index.ts");
    expect(files).toContain(LEAF);
    expect(files.filter((file) => file.startsWith(MODULE)).length).toBeGreaterThan(1);
  });

  it("keeps every component out of the page file", () => {
    // The scanner must see a component where there is one...
    expect(COMPONENT.test("function SourceChips({ sources }: Props) {")).toBe(true);
    expect(COMPONENT.test("export function RejectionSection() {")).toBe(true);
    // ...and the page, which defines only its async page function, is clean.
    expect(COMPONENT.test(codeText(PAGE))).toBe(false);
  });

  it("keeps the components off lib/db and off the client library", () => {
    const files = sourceFiles().filter((file) => file.startsWith(MODULE));
    for (const file of files) {
      const text = codeText(file);
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/db\//);
      expect(text, file).not.toContain("@supabase/supabase-js");
      expect(text, file).not.toMatch(AWAITS);
    }
    // The same scanners on inputs they MUST flag.
    expect(/from\s+["']@\/lib\/db\//.test('import { listSources } from "@/lib/db/sources";')).toBe(
      true,
    );
    expect(AWAITS.test("const sources = await listSources();")).toBe(true);
  });

  it("keeps the URL leaf below lib/db: it imports nothing at all", () => {
    // ARCHITECTURE §4 rule 7 — a pure domain leaf reaches no database, not even
    // by a type-only import, so no directory-level cycle can be written into
    // it. The page and the chips both read the facet from here.
    const importLine = /^\s*import\b|\brequire\s*\(|\bfrom\s+["']/;
    expect(importLine.test('import { T } from "@/lib/db/tables";')).toBe(true);
    expect(codeText(LEAF).split("\n").filter((line) => importLine.test(line))).toEqual([]);
  });

  it("leaves the page function the only async component on the route", () => {
    expect(codeText(PAGE)).toMatch(/export default async function SourcesPage/);
  });
});
