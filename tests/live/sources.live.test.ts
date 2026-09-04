import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import SourcesPage from "@/app/sources/page";
import { T } from "@/lib/db/tables";
import {
  type Counted,
  countOrAbsent,
  countRows,
  exactCount,
  gradeSurface,
  independentClient,
  objectIsAbsent,
  oneEach,
  renderPage,
  stateOf,
  surfaceHooks,
} from "./parity";

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
 * **Every case names the STATE KIND before it compares anything**
 * (ARCHITECTURE.md §10, common violation 6; oracle rewritten by
 * admin-window/TASK-0032). Each of this page's three surfaces is graded on its
 * own, against the kind THIS TEST's own count implies:
 *
 *  - `ok` compares rows and numbers.
 *  - `empty` is a PASS WITH A NUMBER — this test counted exactly 0. Before
 *    this rewrite an honest emptiness fell into the not-provisioned branch and
 *    was graded a failure, because `Empty` and `NotProvisioned` draw the same
 *    container and were told apart by their WORDS.
 *  - `not_provisioned` is a pass only when this test's own read of the same
 *    object gets the absence code (`PGRST205` / `42P01`).
 *  - `error` is a FAIL naming the read and the database's own account.
 *
 * The surfaces are named structurally, in the order `src/app/sources/page.tsx`
 * renders them; no heading text is read, because copy is the designer's
 * jurisdiction.
 */

type Params = Record<string, string>;

/**
 * This page's three surfaces — the registry, the awaiting-row trend, the
 * settled-values trend — each named by the `data-surface` hook
 * `src/app/sources/page.tsx` gives it. Each is its own read, so each is its
 * own state.
 *
 * NAMES, not positions. These three were `section:nth-of-type(1|2|3)` until
 * admin-window/DEBT-0002, which made every assertion below hostage to that
 * file's element ORDER: `stateOf` (`tests/live/parity.ts`) demands the
 * selector match EXACTLY ONE element, so one added section — or one `<div>`
 * wrapping an existing one — either duplicates a match or silently repoints
 * the selector at the neighbouring surface. On `/cycles` that is exactly what
 * happened: admin-window/BUG-0040 added a section and a wrapper, and four live
 * tests threw `MarkupReadError` (admin-window/BUG-0056). A hook does not move
 * when the page is rearranged.
 *
 * The two trend surfaces answer to the same names their window lines already
 * carry (`data-window="awaiting_row"`, `data-window="rejections"`) — a
 * different attribute, so nothing collides, and the surface and the figure
 * inside it are called one thing.
 */
const REGISTRY = '[data-surface="registry"]';
const AWAITING_TREND = '[data-surface="awaiting_row"]';
const REJECTIONS = '[data-surface="rejections"]';

/**
 * Every surface hook this page is expected to carry, asserted present and
 * UNIQUE before any of them is graded — so the next reorder fails as one
 * legible assertion here rather than as scattered `MarkupReadError`s.
 */
const SURFACES = [REGISTRY, AWAITING_TREND, REJECTIONS];

/** The `micro` labels the two trend figures stand under, as an operator reads them. */
const AWAITING_FIGURE = "Awaiting-row claims in this window";
const REJECTED_FIGURE = "Re-rejected claims in this window";

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

describe("the Sources page's surface hooks against staging", () => {
  it("names every surface on the page once, whatever order they are in", async () => {
    // The oracle's addressing itself, asserted before it is used: each hook
    // has to reach exactly one element, which is the precondition `stateOf`
    // enforces per call. Rendered bare AND narrowed, because the `?source_id=`
    // branch swaps the registry's body between a table and a card — and a
    // branch that adds or drops a wrapper is where this class does its damage
    // (admin-window/DEBT-0002).
    const renders: [string, string][] = [
      ["bare", await sourcesMarkup()],
      [
        "narrowed",
        await sourcesMarkup({ source_id: "00000000-0000-7000-8000-000000000000" }),
      ],
    ];
    // `nested` empty says no surface sits inside another, so grading one never
    // reads a card that belongs to its neighbour.
    for (const [name, markup] of renders) {
      expect(surfaceHooks(markup, SURFACES), name).toEqual({
        counts: oneEach(SURFACES),
        nested: [],
      });
    }
  });
});

describe("the source state rows against staging", () => {
  it("renders every source the registry holds, with its state verbatim", async () => {
    const markup = await sourcesMarkup();
    // The kind this test expects comes from its OWN count, and the registry
    // surface must be in it: a registry that holds nothing renders `empty`,
    // and that is a pass with a stated 0 — never the not-provisioned card.
    const counted = await countOrAbsent(() => exactCount(T.sources));
    const state = await gradeSurface({
      markup,
      within: REGISTRY,
      object: T.sources,
      counted,
    });
    if (state !== "ok" || counted === "absent") return;

    const rendered = renderedSources(markup);
    const held = await stagingSources();
    expect(rendered.map((row) => row.sourceId)).toEqual(
      held.map((source) => source.source_id),
    );
    expect(rendered).toHaveLength(counted);

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
    const state = await gradeSurface({
      markup,
      within: REGISTRY,
      object: T.sources,
      counted: () => countOrAbsent(() => exactCount(T.sources)),
    });
    if (state !== "ok") return;
    const rendered = renderedSources(markup);

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
    const markup = await sourcesMarkup();
    const state = await gradeSurface({
      markup,
      within: REGISTRY,
      object: T.sources,
      counted: () => countOrAbsent(() => exactCount(T.sources)),
    });
    if (state !== "ok") return;

    const one = renderedSources(markup)[0];
    const narrowedMarkup = await sourcesMarkup({ source_id: one.sourceId });
    // One source is one row, so the narrowed registry is `ok` with exactly it.
    await gradeSurface({
      markup: narrowedMarkup,
      within: REGISTRY,
      object: T.sources,
      counted: 1,
    });
    expect(renderedSources(narrowedMarkup).map((row) => row.sourceId)).toEqual([
      one.sourceId,
    ]);
  });
});

describe("the per-source trends against staging", () => {
  /**
   * The awaiting-row claims of the window the page states, counted by THIS
   * TEST: the pending observations of the window, then their `awaiting_row`
   * claims — every id, in chunks, so the number is exact rather than a floor.
   *
   * With no window line the read produced no window at all, and the only kind
   * that may then pass is `not_provisioned` — on this test's own absence code,
   * never on "no rows rendered" (rule 5).
   */
  async function awaitingClaimsInWindow(
    window: ReturnType<typeof windowOf>,
  ): Promise<Counted> {
    if (!window.present) {
      return (await objectIsAbsent(T.pendingClaims)) ? "absent" : 0;
    }
    const { data, error } = await independentClient()
      .from(T.observations)
      .select("observation_id")
      .eq("status", "pending")
      .gte("observed_at", window.since)
      .limit(1000);
    if (error) throw new Error(`the observations query failed: ${JSON.stringify(error)}`);
    const ids = ((data ?? []) as { observation_id: string }[]).map(
      (row) => row.observation_id,
    );

    let claims = 0;
    for (let at = 0; at < ids.length; at += 100) {
      claims += await countRows(() =>
        exactCount(T.pendingClaims)
          .eq("bucket", "awaiting_row")
          .in("observation_id", ids.slice(at, at + 100)),
      );
    }
    return claims;
  }

  it("counts each source's awaiting-row claims as the view holds them", async () => {
    const markup = await sourcesMarkup();
    const window = windowOf(markup, "awaiting_row");

    // The kind first, and this one is RED on staging today — correctly.
    // `pending_claims` cannot be read (admin-window/TASK-0031: every shape but
    // an unordered `limit 1` times out at ~8.1s, `57014`), so this surface is
    // honestly in its ERROR state and rule 6 says an error is a FAILURE naming
    // the read. It is not skipped, not weakened and not marked todo: its red is
    // the campaign's signal that the scraper-repo handoff has not landed. It
    // goes green by itself the day `pending_claims` answers.
    const state = await gradeSurface({
      markup,
      within: AWAITING_TREND,
      object: T.pendingClaims,
      counted: () => awaitingClaimsInWindow(window),
      figure: AWAITING_FIGURE,
    });
    if (state !== "ok") return;

    // A truncated window makes every count a floor, and a floor is not a
    // parity claim — the page says so, and this test believes it.
    if (window.truncated) return;

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

    // This test's own per-source split of the same window, every id counted.
    const counted = new Map<string, number>();
    for (let at = 0; at < ids.length; at += 100) {
      const { data, error } = await independentClient()
        .from(T.pendingClaims)
        .select("observation_id, source_id, bucket")
        .eq("bucket", "awaiting_row")
        .in("observation_id", ids.slice(at, at + 100))
        .limit(1000);
      if (error) throw new Error(`the claims query failed: ${JSON.stringify(error)}`);
      for (const claim of (data ?? []) as { source_id: string }[]) {
        counted.set(claim.source_id, (counted.get(claim.source_id) ?? 0) + 1);
      }
    }

    const rendered = trendCells(markup, "Awaiting-row claims by source");
    expect([...rendered.keys()].sort()).toEqual([...counted.keys()].sort());
    for (const [sourceId, claimed] of counted) {
      expect(Number(rendered.get(sourceId)?.[1]), sourceId).toBe(claimed);
    }
  });

  it("counts each source's re-rejects as the stamps hold them", async () => {
    const markup = await sourcesMarkup();
    const window = windowOf(markup, "rejections");

    // The gauge's own definition, re-stated here from migration
    // `20260901000003`: a re-reject is `rejected_by = 'resolver'`. The window
    // is the one the page states.
    const rerejected = async (): Promise<Counted> => {
      if (!window.present) {
        return (await objectIsAbsent(T.observations)) ? "absent" : 0;
      }
      return countRows(() =>
        exactCount(T.observations)
          .eq("rejected_by", "resolver")
          .gte("rejected_at", window.since),
      );
    };

    // Staging holds no re-rejected value in this window, so this case grades an
    // EMPTY surface today: a pass with a stated 0 on both sides, and NOT
    // coverage of the per-source rendering, which needs a re-reject to exist.
    const state = await gradeSurface({
      markup,
      within: REJECTIONS,
      object: T.observations,
      counted: rerejected,
      figure: REJECTED_FIGURE,
    });
    if (state !== "ok") return;
    if (window.truncated) return;

    const rendered = trendCells(markup, "Re-rejected values by source");
    for (const [sourceId, cells] of rendered) {
      const expected = await countRows(() =>
        exactCount(T.observations)
          .eq("source_id", sourceId)
          .eq("rejected_by", "resolver")
          .gte("rejected_at", window.since),
      );
      expect(Number(cells[1]), sourceId).toBe(expected);
    }
  });

  it("draws no threshold line, because the dial is not readable from here", async () => {
    const markup = await sourcesMarkup();
    // Only an `ok` trend has columns to count; every other kind rendered a
    // state card instead, which this file grades in the case above.
    if (stateOf(markup, AWAITING_TREND) !== "ok") return;
    // period + claims + days-with-a-claim. A fourth column would mean a
    // threshold arrived from somewhere, and the only somewhere is the scraper
    // registry (admin-window/TASK-0024).
    const columns = cheerio.load(markup)(
      'table[aria-label="Awaiting-row claims by source"] th',
    ).length;
    if (columns > 0) expect(columns).toBe(3);
  });
});
