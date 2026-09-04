import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import ClaimsPage from "@/app/claims/page";
import { CLAIM_WINDOW } from "@/components/claims";
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
 * **That day arrived**: as of 2026-09-02 the view answers and all six cases
 * are green against staging (admin-window/BUG-0037). The banner above is kept
 * because the rule it states is unchanged — if the read regresses, this file
 * goes red again and that red is the signal, never a reason to soften it.
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
 * # The list is a WINDOW, and this file certifies the window
 *
 * The page's read is complete; its LIST is drawn as at most `CLAIM_WINDOW`
 * rows, the longest-waiting first (admin-window/BUG-0041). So "every claim the
 * view holds is rendered" stopped being true by design, and the assertion that
 * said so was red on staging (admin-window/BUG-0057). It is REPLACED, never
 * relaxed, by the stronger property the window has:
 *
 *  - the drawn ids are exactly the first `CLAIM_WINDOW` of the matching set in
 *    the page's stated order — oldest first, an unknown instant last,
 *    `observation_id` breaking every tie — where that order is computed here
 *    from THIS FILE's own two-leg read (the view carries no instant), not from
 *    `lib/db/claims.ts`;
 *  - no claim left undrawn is older than a claim drawn, which is the same
 *    property again without the tie-break, so a window taken from the wrong
 *    end fails even where every instant is equal (staging's first 60 claims
 *    carry 2 distinct instants, measured 2026-09-03 — the cap falls INSIDE a
 *    tie, so the tie-break is what decides membership here);
 *  - the drawn row count is `min(CLAIM_WINDOW, whole)`; and
 *  - the window line's own figures are graded: `data-window-held` equals this
 *    test's count of the matching set and `data-window-truncated` is true
 *    exactly when that count exceeds the cap — which is what makes "the read
 *    is still complete, only the drawing is bounded" a verified claim rather
 *    than a comment.
 *
 * Both tabs are graded that way. The standing tab holds 0 claims on staging
 * today, so its list is an honest EMPTY there — its case still asks this
 * file's own read for that bucket and still windows what it expects, so it
 * does not go red the day that bucket outgrows the cap.
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

/** The bucket the standing tab is the subset of, spelled from the migration. */
const STANDING_BUCKET = "standing_disagreement";

/** The five buckets a page may render, spelled from the migration. */
const RENDERED_BUCKETS = [
  STANDING_BUCKET,
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

/** This test's own count of the standing tab's set — one bucket, not the view. */
function standingCount() {
  return exactCount(T.pendingClaims).eq("bucket", STANDING_BUCKET);
}

/**
 * The count of the set the LIST on `tab` renders — the two tabs read two
 * different sets, so one count cannot grade both (admin-window/BUG-0037).
 *
 * The standing tab's list is `bucket = standing_disagreement` and nothing
 * else: `page.tsx` drops the bucket facet on that tab before reading, so a
 * `?bucket=` in the URL never narrows it. The buckets tab's list is the whole
 * view, and a `?bucket=` naming a value outside the offered vocabulary
 * narrows NOTHING there either (`chosen()` in `lib/claims/filters.ts`), so it
 * is graded against the same whole-view count as the bare URL.
 */
function listCount(tab?: string): Promise<number> {
  return countRows(() => (tab === "standing" ? standingCount() : claimCount()));
}

/**
 * The cap this test's own read of the view will accept. The read must come
 * back UNDER it: a set that reached the cap is a truncated read, and grading a
 * window against a truncated expectation would pass for the wrong reason.
 */
const VIEW_READ_CAP = 5000;

/**
 * How many ids one instant query names. A single request naming every claim
 * would put ~32KB of uuids in a URL; the chunking is this file's own, and
 * nothing about it is shared with the app's read.
 */
const INSTANT_CHUNK = 200;

/** A claim as this test reads it: its id, and the instant its age comes from. */
interface ClaimInstant {
  id: string;
  /** `null` where `observations` holds no instant for that claim. */
  observedAt: string | null;
}

/**
 * The claims the list on `tab` matches, with their instants — THIS TEST's own
 * two-leg read, written without `lib/db/claims.ts`.
 *
 * Two legs because the view carries no age at all (migration
 * `20260901000004`): the ids come from `pending_claims`, the instants from
 * `observations` by id. A claim with no instant row keeps a `null` and is not
 * dropped — dropping it would silently shorten what this test expects.
 */
async function claimsFromDatabase(tab?: string): Promise<ClaimInstant[]> {
  const db = independentClient();
  const scoped = db.from(T.pendingClaims).select("observation_id");
  const { data, error } = await (
    tab === "standing"
      ? scoped.eq("bucket", STANDING_BUCKET)
      : scoped.neq("bucket", PARKED_BUCKET)
  )
    .order("observation_id", { ascending: true })
    .limit(VIEW_READ_CAP);
  if (error) throw new Error(`the claim query failed: ${JSON.stringify(error)}`);
  const ids = ((data ?? []) as { observation_id: string }[]).map(
    (row) => row.observation_id,
  );
  expect(
    ids.length,
    `this test read ${VIEW_READ_CAP} claims, so its own read of the view is ` +
      `truncated and cannot say what the oldest ones are`,
  ).toBeLessThan(VIEW_READ_CAP);

  const observedAt = new Map<string, string | null>();
  for (let from = 0; from < ids.length; from += INSTANT_CHUNK) {
    const chunk = ids.slice(from, from + INSTANT_CHUNK);
    const { data: instants, error: failed } = await db
      .from(T.observations)
      .select("observation_id, observed_at")
      .in("observation_id", chunk)
      .limit(chunk.length);
    if (failed) {
      throw new Error(`the instant query failed: ${JSON.stringify(failed)}`);
    }
    for (const row of (instants ?? []) as {
      observation_id: string;
      observed_at: string | null;
    }[]) {
      observedAt.set(row.observation_id, row.observed_at);
    }
  }

  return ids.map((id) => ({ id, observedAt: observedAt.get(id) ?? null }));
}

/**
 * A claim's position on the age axis. An unknown instant is `Infinity` — the
 * page states that a claim whose instant is unknown sorts LAST, and nothing
 * unknown may count as old.
 */
function ageOf(claim: ClaimInstant): number {
  if (claim.observedAt === null) return Number.POSITIVE_INFINITY;
  const at = Date.parse(claim.observedAt);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/**
 * The order the page states above the list: oldest first, an unknown instant
 * last, `observation_id` breaking every tie. Spelled here from that sentence,
 * so the expectation is this file's own and not the app's comparator.
 */
function oldestFirst(claims: readonly ClaimInstant[]): ClaimInstant[] {
  return [...claims].sort((a, b) => {
    const at = ageOf(a);
    const bt = ageOf(b);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : 1;
  });
}

/** The figures the list's window line states about itself. */
function windowLine(markup: string): {
  limit: number;
  held: number;
  truncated: boolean;
} {
  const line = cheerio.load(markup)('[data-window="claims"]');
  expect(line, "the list states its window exactly once").toHaveLength(1);
  return {
    limit: Number(line.attr("data-window-limit")),
    held: Number(line.attr("data-window-held")),
    truncated: line.attr("data-window-truncated") === "true",
  };
}

/**
 * Grade one tab's list as a WINDOW of the set it matches: the drawn ids, their
 * number, the age boundary between drawn and undrawn, and the window line's
 * own figures. `whole` is the caller's own count of that set.
 */
function gradeWindow(markup: string, held: readonly ClaimInstant[], whole: number): void {
  expect(held, "this test's own read holds every claim it counted").toHaveLength(
    whole,
  );

  const rendered = claimIds(markup);
  expect(new Set(rendered).size, "no claim is drawn twice").toBe(rendered.length);
  expect(rendered).toHaveLength(Math.min(CLAIM_WINDOW, whole));
  expect(rendered).toEqual(
    oldestFirst(held)
      .slice(0, CLAIM_WINDOW)
      .map((claim) => claim.id),
  );

  // The same property without the tie-break: nothing left undrawn is older
  // than anything drawn. Equal instants satisfy it, so this holds through the
  // tie the cap actually falls inside on staging.
  const drawn = new Set(rendered);
  const ages = (keep: boolean) =>
    held.filter((claim) => drawn.has(claim.id) === keep).map(ageOf);
  const inside = ages(true);
  const outside = ages(false);
  if (inside.length > 0 && outside.length > 0) {
    expect(
      Math.max(...inside),
      "an undrawn claim is older than a drawn one, so this is not the oldest window",
    ).toBeLessThanOrEqual(Math.min(...outside));
  }

  // The read is complete and only the drawing is bounded — stated on screen,
  // and graded here against this test's own count rather than the rows.
  const line = windowLine(markup);
  expect(line.limit).toBe(CLAIM_WINDOW);
  expect(line.held).toBe(whole);
  expect(line.truncated).toBe(whole > CLAIM_WINDOW);
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

  it("draws the view's longest-waiting window, and states the whole it came from", async () => {
    const markup = await claimsMarkup();
    const state = await gradeSurface({
      markup,
      within: listOf(),
      object: T.pendingClaims,
      counted: () => countRows(() => claimCount()),
    });
    if (state !== "ok") return;

    // The read behind the list is still COMPLETE — what is bounded is the
    // drawing (admin-window/BUG-0041, admin-window/BUG-0057). Both halves are
    // graded: `whole` is this test's own count of the matching set, and the
    // ids come from this test's own two-leg read of it.
    gradeWindow(markup, await claimsFromDatabase(), await countRows(() => claimCount()));
  });

  it("renders the standing tab as the window of exactly that bucket's subset", async () => {
    const markup = await claimsMarkup({ tab: "standing" });
    // Nobody contradicting anybody is an EMPTY list with a counted 0 — an
    // honest state, and not the same thing as an absent view.
    const state = await gradeSurface({
      markup,
      within: listOf("standing"),
      object: T.pendingClaims,
      counted: () => listCount("standing"),
    });
    if (state !== "ok") {
      // Staging holds 0 standing claims today, so this is the branch that runs
      // there. It is still graded: this test's own read of the bucket must
      // agree that there is nothing, and the list must draw nothing — an
      // emptiness nobody checked is how a broken list passes.
      if (state === "empty") {
        expect(await claimsFromDatabase("standing")).toEqual([]);
        expect(claimIds(markup)).toEqual([]);
      }
      return;
    }

    // This bucket is NOT assumed to fit under the cap: the day it outgrows
    // `CLAIM_WINDOW` the list becomes a window like any other, and comparing
    // it with the bucket's whole id set would go red for the wrong reason
    // (admin-window/BUG-0057).
    gradeWindow(
      markup,
      await claimsFromDatabase("standing"),
      await countRows(() => standingCount()),
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
    const asked: Params[] = [
      {},
      { tab: "standing" },
      { bucket: PARKED_BUCKET },
      { bucket: PARKED_BUCKET, tab: "standing" },
    ];
    const checked: string[] = [];

    for (const params of asked) {
      const markup = await claimsMarkup(params);
      // Each surface is graded against the count of the set IT renders: the
      // standing tab's list is one bucket's subset, and grading it against
      // the whole view's count read that tab's honest EMPTY as a mismatch and
      // threw before the assertion below (admin-window/BUG-0037).
      await gradeSurface({
        markup,
        within: listOf(params.tab),
        object: T.pendingClaims,
        counted: () => listCount(params.tab),
      });
      expect(markup, JSON.stringify(params)).not.toContain(PARKED_BUCKET);
      checked.push(JSON.stringify(params));
    }

    // The property is only verified where the assertion was REACHED, so the
    // count of reached sets is itself asserted: a future early return or a
    // throw part-way leaves this list short and reds the test.
    expect(checked).toEqual(asked.map((params) => JSON.stringify(params)));
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

/**
 * admin-window/BUG-0043 — the LIVE oracle for what a source is called.
 *
 * The offline suite stubs the registry leg at its module boundary, so it
 * cannot see the two things only staging shows: that the label read the app
 * issues (`select("source_id, source").in("source_id", …)` against `sources`)
 * is a query this database actually answers, and that the ids
 * `pending_claims` carries really do resolve to registry rows here. The
 * defect this pins is what a walk found on 877 rendered rows — every SOURCE
 * cell reading `01a05782-8e7f-752c-ae60-3ce4c51962f6` while `/sources`,
 * `/browse` and every provenance line read `ticketmaster` (LESSONS 5).
 *
 * The expectation is computed from THIS FILE's own read of the registry
 * (ARCHITECTURE §10 rule 1), never from `lib/db/sources.ts`, and it is graded
 * both ways: a source the registry names must be NAMED, and one it does not
 * must still be its own id, verbatim.
 */
describe("a source is named against staging", () => {
  /** This file's own registry read of exactly the ids the page rendered. */
  async function registryNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await independentClient()
      .from(T.sources)
      .select("source_id, source")
      .in("source_id", [...ids]);
    if (error) {
      // A registry this test cannot read proves nothing about the labels; it
      // is a refusal, never an empty registry (admin-window/BUG-0007).
      throw new Error(`this test could not read ${T.sources}: ${JSON.stringify(error)}`);
    }
    return new Map(
      (data as { source_id: string; source: string }[]).map((row) => [
        row.source_id,
        row.source,
      ]),
    );
  }

  it("says the registry's name in every SOURCE cell, and still links by the id", async () => {
    const markup = await claimsMarkup();
    await gradeSurface({
      markup,
      within: listOf(),
      object: T.pendingClaims,
      counted: () => listCount(),
    });

    const $ = cheerio.load(markup);
    const cells = $("[data-claim-source]")
      .toArray()
      .map((element) => ({
        id: $(element).attr("data-claim-source") ?? "",
        says: $(element).text().trim(),
        href: $(element).attr("href") ?? "",
      }));
    expect(cells.length, "the window drew rows to grade").toBeGreaterThan(0);

    const named = await registryNames([...new Set(cells.map((cell) => cell.id))]);
    // Without at least one registered source among them, "no cell shows a
    // uuid" would pass vacuously (LESSONS 3: a guard proves itself on two
    // fixtures — here, on staging's own data).
    expect(named.size, "at least one rendered source is in the registry").toBeGreaterThan(0);

    for (const cell of cells) {
      expect(cell.says, cell.id).toBe(named.get(cell.id) ?? cell.id);
      if (named.has(cell.id)) {
        // The name is the WORD; the uuid survives only as the destination.
        expect(cell.says, cell.id).not.toContain(cell.id);
      }
      expect(cell.href, cell.id).toContain(encodeURIComponent(cell.id));
    }
  });

  it("names the source_id chips the same way, each still narrowing by its id", async () => {
    const markup = await claimsMarkup();
    const $ = cheerio.load(markup);
    const chips = $('[data-facet="source_id"] a')
      .toArray()
      .map((element) => ({
        label: $(element).text().trim(),
        href: $(element).attr("href") ?? "",
      }));
    // The first chip is the "no narrowing" one and carries no source id.
    const narrowing = chips.slice(1);
    expect(narrowing.length, "the facet offers at least one source").toBeGreaterThan(0);

    const ids = narrowing.map((chip) => {
      const value = new URL(chip.href, "http://localhost").searchParams.get("source_id");
      expect(value, chip.label).not.toBeNull();
      return value as string;
    });
    const named = await registryNames(ids);
    expect(named.size).toBeGreaterThan(0);

    narrowing.forEach((chip, index) => {
      expect(chip.label, ids[index]).toBe(named.get(ids[index]) ?? ids[index]);
    });
    // The chips read in the order their labels sort — the same facet on
    // `/sources` reads that way, and the anatomy does not change between
    // screens.
    expect(narrowing.map((chip) => chip.label)).toEqual(
      [...narrowing.map((chip) => chip.label)].sort(),
    );
  });
});
