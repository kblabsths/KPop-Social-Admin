import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import ClaimsPage from "@/app/claims/page";
import { T } from "@/lib/db/tables";
import { countRows, exactCount, gradeSurface, independentClient, renderPage } from "./parity";

/**
 * The Claims page against staging (campaign admin-window/TASK-0012, oracle
 * rewritten by admin-window/TASK-0032).
 *
 * # THIS FILE IS EXPECTED TO BE RED ON STAGING, AND THAT IS THE POINT
 *
 * `pending_claims` cannot be read from this database: every query shape but an
 * unordered `limit 1` times out at ~8.1s (`57014`, canceling statement due to
 * statement timeout — measured 2026-09-02, admin-window/TASK-0031; the fix is
 * an index that only the scraper repo can carry, so it is a handoff). The page
 * therefore renders its ERROR state honestly, and ARCHITECTURE.md §10 rule 6
 * says an error is a **FAILURE** naming the read and the database's code.
 *
 * Its red is the campaign's only honest signal that the handoff has not
 * landed. Do not weaken these assertions, do not skip this file and do not
 * mark its cases `todo`. It goes green by itself the day the view answers.
 *
 * Before this rewrite it did the opposite: **4 of 6 cases PASSED against a
 * page in its error state**, because the fallback branch only asked that the
 * markup contain the string `pending_claims` — which the red error line
 * carries exactly as well as the gray not-provisioned card does.
 *
 * # The rule this file now follows
 *
 * Acceptance test 3 ("rendered bucket counts equal the classification view's,
 * per bucket, per source filter; `in_window` appears nowhere in the UI") and
 * acceptance test 2's rule, ARCHITECTURE.md §10: what the page RENDERED is
 * compared with a query THIS TEST issues, written independently of the
 * `lib/db` function the page called — so nothing below asks
 * `src/lib/db/claims.ts` what to expect. The buckets are spelled here from the
 * migration (`20260901000004`), and the counts come from this file's own
 * `exactCount` queries against the view.
 *
 * Each surface's STATE KIND is named before anything on it is compared:
 * `ok` compares numbers, `empty` is a pass with a stated 0,
 * `not_provisioned` needs this test's own absence code, `error` fails.
 *
 * This file WRITES NOTHING, so it needs no sweep (acceptance test 13); every
 * query here is a select.
 *
 * It refuses to run at all until `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SERVICE_ROLE_KEY` are set and `agenticflow/docs/SERVICES.md`
 * declares the target — `tests/live/setup.ts` throws first, non-zero, with the
 * missing name.
 */

type Params = Record<string, string>;

/** The five buckets a page may render, spelled from the migration. */
const RENDERED_BUCKETS = [
  "standing_disagreement",
  "awaiting_link",
  "awaiting_row",
  "escalated",
  "agreeing",
];

/** The bucket that is empty by rule and must never reach the UI. */
const PARKED_BUCKET = "in_window";

/**
 * The page's surfaces, in the order `src/app/claims/page.tsx` renders them.
 * The standing tab renders no bucket table at all, so its list is the first
 * section — the order is read structurally, never by heading text.
 */
const BUCKETS = "section:nth-of-type(1)";
const listOf = (tab?: string) =>
  tab === "standing" ? "section:nth-of-type(1)" : "section:nth-of-type(2)";

/** The page as the URL renders it. Every read happens per request. */
async function claimsMarkup(params: Params = {}): Promise<string> {
  return renderPage(ClaimsPage, { searchParams: Promise.resolve(params) });
}

/** The count the page rendered for one bucket. */
function renderedCount(markup: string, bucket: string): number {
  const $ = cheerio.load(markup);
  const cells = $(`[data-bucket="${bucket}"]`)
    .closest("tr")
    .find("[data-bucket-claims]")
    .toArray()
    .map((element) => Number($(element).attr("data-bucket-claims")));
  expect(cells, `${bucket} labels exactly one count`).toHaveLength(1);
  return cells[0];
}

/** The claim ids the list rendered. */
function claimIds(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-claim]")
    .toArray()
    .map((element) => $(element).attr("data-claim") ?? "");
}

/** This test's own count over the view, before any narrowing. */
function claimCount() {
  return exactCount(T.pendingClaims).neq("bucket", PARKED_BUCKET);
}

describe("the classification buckets against staging", () => {
  it("renders each bucket's count exactly as the view holds it", async () => {
    const markup = await claimsMarkup();
    const state = await gradeSurface({
      markup,
      within: BUCKETS,
      object: T.pendingClaims,
      counted: () => countRows(() => claimCount()),
    });
    if (state !== "ok") return;

    for (const bucket of RENDERED_BUCKETS) {
      const expected = await countRows(() =>
        exactCount(T.pendingClaims).eq("bucket", bucket),
      );
      expect(renderedCount(markup, bucket), bucket).toBe(expected);
    }
  });

  it("renders each bucket's count exactly as the view holds it, per source filter", async () => {
    const markup = await claimsMarkup();
    const state = await gradeSurface({
      markup,
      within: BUCKETS,
      object: T.pendingClaims,
      counted: () => countRows(() => claimCount()),
    });
    if (state !== "ok") return;

    // The sources the view actually carries, read by this test.
    const { data, error } = await independentClient()
      .from(T.pendingClaims)
      .select("source_id")
      .neq("bucket", PARKED_BUCKET)
      .limit(1000);
    if (error) throw new Error(`the source query failed: ${JSON.stringify(error)}`);
    const sources = [
      ...new Set(((data ?? []) as { source_id: string }[]).map((row) => row.source_id)),
    ];

    for (const source of sources) {
      const narrowed = await claimsMarkup({ source_id: source });
      const held = await countRows(() => claimCount().eq("source_id", source));
      // A source with no claim of its own is an EMPTY bucket table with real
      // zeros in it, not an absent view — the page states the figure either
      // way (rule 2).
      const narrowedState = await gradeSurface({
        markup: narrowed,
        within: BUCKETS,
        object: T.pendingClaims,
        counted: held,
      });
      if (narrowedState !== "ok") continue;
      for (const bucket of RENDERED_BUCKETS) {
        const expected = await countRows(() =>
          exactCount(T.pendingClaims).eq("bucket", bucket).eq("source_id", source),
        );
        expect(renderedCount(narrowed, bucket), `${source} / ${bucket}`).toBe(expected);
      }
    }
  });

  it("lists every claim the view holds — a complete read, nothing dropped", async () => {
    const markup = await claimsMarkup();
    const state = await gradeSurface({
      markup,
      within: listOf(),
      object: T.pendingClaims,
      counted: () => countRows(() => claimCount()),
    });
    if (state !== "ok") return;

    const whole = await countRows(() => claimCount());
    const rendered = claimIds(markup);
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(rendered).toHaveLength(whole);
  });

  it("renders the standing tab as exactly that bucket's subset", async () => {
    const markup = await claimsMarkup({ tab: "standing" });
    // Nobody contradicting anybody is an EMPTY list with a counted 0 — an
    // honest state, and not the same thing as an absent view.
    const state = await gradeSurface({
      markup,
      within: listOf("standing"),
      object: T.pendingClaims,
      counted: () =>
        countRows(() => exactCount(T.pendingClaims).eq("bucket", "standing_disagreement")),
    });
    if (state !== "ok") return;

    const { data, error } = await independentClient()
      .from(T.pendingClaims)
      .select("observation_id")
      .eq("bucket", "standing_disagreement")
      .limit(1000);
    if (error) throw new Error(`the standing query failed: ${JSON.stringify(error)}`);
    expect(new Set(claimIds(markup))).toEqual(
      new Set(((data ?? []) as { observation_id: string }[]).map((row) => row.observation_id)),
    );
  });
});

describe("the parked bucket against staging", () => {
  it("is a string the database still spells, and the page never does", async () => {
    // Both halves matter: the view carries the vocabulary (it is empty BY
    // RULE, not by absence), and no rendering of this page carries the word —
    // in any tab, under any filter, including a URL that asks for it by name
    // (LOOK_AND_FEEL quality bar 3; spec §4).
    //
    // The state kind is named first, because a page that could not read the
    // view spells nothing at all: "the word is absent" off an ERROR page is
    // the vacuous pass this rewrite exists to stop.
    for (const params of [
      {},
      { tab: "standing" },
      { bucket: PARKED_BUCKET },
      { bucket: PARKED_BUCKET, tab: "standing" },
    ] as Params[]) {
      const markup = await claimsMarkup(params);
      await gradeSurface({
        markup,
        within: listOf(params.tab),
        object: T.pendingClaims,
        counted: () => countRows(() => claimCount()),
      });
      expect(markup, JSON.stringify(params)).not.toContain(PARKED_BUCKET);
    }
  });

  it("holds no row in the view either, so nothing was hidden that exists", async () => {
    // This test's own read of the same view. A refusal here is a refusal, not
    // a zero: the count that cannot be made proves nothing about what the
    // view holds (admin-window/BUG-0007).
    expect(
      await countRows(() => exactCount(T.pendingClaims).eq("bucket", PARKED_BUCKET)),
    ).toBe(0);
  });
});
