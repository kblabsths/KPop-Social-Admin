import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import ClaimsPage from "@/app/claims/page";
import { CLAIM_WINDOW } from "@/components/claims";
import type { ClaimLine } from "@/lib/claims/lines";
import { readPendingClaimRows } from "@/lib/db/claims";
import { readPendingObservations } from "@/lib/db/gauges";
import { T } from "@/lib/db/tables";
import { resolveBounds } from "@/lib/gauges/gauge";
import { fetchPendingClaims, PENDING_CLAIMS_DEFAULTS } from "@/lib/gauges/pending-claims";
import { OFFSET_PARAM, PAGE_ROUTES } from "@/lib/paging/bounds";
import { initialPage, requestPage, type PageState } from "@/lib/paging/machine";
import {
  countRows,
  exactCount,
  gradeSurface,
  independentClient,
  renderPage,
  snapshotAsOf,
  surfaceHooks,
  whileStill,
} from "./parity";

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
 * **And it is red again on purpose, for a second handoff**
 * (admin-window/BUG-0138, 2026-09-10). The page reads no claim population any
 * more: the list is ONE window read ordered `observed_at asc` in the database,
 * and that column reaches `public.pending_claims` only through a scraper
 * migration Ben applies. Until he has applied it to STAGING, the precondition
 * case below — `pending_claims carries observed_at` — FAILS naming the handoff
 * file, and the cases that read the view fail with it. That red is the ticket
 * working as designed: it does not skip, it does not pass, nothing here falls
 * back to the two-step read, and the receipt records a refusal rather than a
 * pass. The offline suite proves the whole change independently and consults
 * no database at all.
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
 *    from THIS FILE's own read of the view, not from `lib/db/claims.ts`;
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
 * does not go red the day that bucket outgrows the cap. That empty branch
 * grades the window line too: an empty window is a window the page looked in,
 * so it states `data-window-held="0"` — the value only an ok-but-empty read
 * may publish (ARCHITECTURE.md §4.3, admin-window/BUG-0070).
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

/**
 * The SIGN-IN GATE, and the one thing this file substitutes — campaign
 * admin-window/TASK-0067.
 *
 * The paged walk below drives the app's own route handler
 * (`GET /api/admin/claims/rows`) against staging, and that handler's first
 * statement is `requireAdmin()`, which reads a NextAuth SESSION. A test
 * process has none, so every page of the walk would be a 401 and the walk
 * would grade nothing about the database — which is this tier's whole subject.
 *
 * So the gate answers as an allowlisted admin here, and NOTHING else is
 * substituted: the route, its bound guard, its facet derivation, its reads and
 * its answers are the app's, against staging. The gate's own behaviour is
 * graded where it can be graded honestly — `tests/offline/paging/
 * claims-route.test.ts` stubs it CLOSED and proves the order of the two (a
 * refused gate issues no read at all), and `tests/http/` drives the real
 * middleware. The count below asserts this handler still ASKS.
 */
const gate = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => {
    gate.calls += 1;
    return { user: { email: "live-suite@admin-window.local" } };
  },
}));

const { GET } = await import("@/app/api/admin/claims/rows/route");

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
 * The page's surfaces, each named by the `data-surface` hook
 * `src/app/claims/page.tsx` gives it. Never read by heading text — the list
 * and the gauge both retitle themselves per tab and keep their names.
 *
 * NAMES, not positions. These were `section:nth-of-type(n)` until
 * admin-window/DEBT-0002, and on THIS page the position was already
 * tab-dependent: the standing tab renders no bucket table, so its list is the
 * first section, and the oracle had to carry a `listOf(tab)` function whose
 * only job was to guess a number. `stateOf` (`tests/live/parity.ts`) demands
 * the selector match EXACTLY ONE element, so one added section — or one
 * `<div>` wrapping an existing one — either duplicates a match or silently
 * repoints the selector at the neighbouring surface; on `/cycles` that cost
 * four live tests (admin-window/BUG-0040, admin-window/BUG-0056). `LIST` is
 * the list on BOTH tabs.
 */
const BUCKETS = '[data-surface="buckets"]';
const LIST = '[data-surface="claims"]';
const GAUGE = '[data-surface="gauge"]';

/**
 * How many elements each hook is expected to reach, per tab. Two of the three
 * surfaces always render; `buckets` renders only where a bucket table belongs,
 * which is a count of 0 or 1 and never 2 — the one thing that would break
 * `stateOf`.
 */
const SURFACE_COUNTS: Record<string, Record<string, number>> = {
  buckets: { [BUCKETS]: 1, [LIST]: 1, [GAUGE]: 1 },
  standing: { [BUCKETS]: 0, [LIST]: 1, [GAUGE]: 1 },
};

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

/**
 * The set the LIST on `tab` renders — the two tabs read two different sets, so
 * one read cannot grade both (admin-window/BUG-0037).
 *
 * The standing tab's list is `bucket = standing_disagreement` and nothing
 * else: `page.tsx` drops the bucket facet on that tab before reading, so a
 * `?bucket=` in the URL never narrows it. The buckets tab's list is the whole
 * view, and a `?bucket=` naming a value outside the offered vocabulary
 * narrows NOTHING there either (`chosen()` in `lib/claims/filters.ts`), so it
 * is graded against the same whole-view read as the bare URL.
 *
 * That set is read ONCE, by `claimsFromDatabase(tab)`, and its LENGTH is the
 * count every surface on that URL is graded against (admin-window/TASK-0075).
 * The pair of count helpers that used to answer this question separately is
 * gone with the second read it was: a count taken beside a read of the same
 * set is not a second opinion, it is a second race.
 */

/**
 * The cap this test's own read of the view will accept. The read must come
 * back UNDER it: a set that reached the cap is a truncated read, and grading a
 * window against a truncated expectation would pass for the wrong reason.
 */
const VIEW_READ_CAP = 5000;

/**
 * PostgREST's own row ceiling, which no `.limit()` can raise (`db-max-rows`).
 *
 * It is the reason a read's own bound is not the whole story: ask for 5,000 and
 * the server still stops at 1,000, so the guard below refuses at the LESSER of
 * the two. Staging held 877 pending claims when this was written (2026-09-10,
 * admin-window/TASK-0074's census, 877 and 878 measured by QA the same day), so
 * every single-read shape in this file is comfortably under it — and the day it
 * is not, the file says so instead of comparing a page with a truncated tally.
 */
const ROW_CEILING = 1000;

/**
 * Refuse a read that came back AT OR ABOVE what it could have held.
 *
 * The same discipline as the identity proof's two cap guards, applied to every
 * single-read shape this file holds still: a truncated read makes every figure
 * taken from it a statement about the cap rather than about the view, and a
 * page graded against one passes or fails for the wrong reason.
 */
function refuseTruncated(rows: readonly unknown[], bound: number, what: string): void {
  const ceiling = Math.min(bound, ROW_CEILING);
  if (rows.length >= ceiling) {
    throw new Error(
      `${what} came back with ${rows.length} row(s), at or above the ${ceiling} ` +
        `it can hold (its own bound ${bound}, PostgREST's ceiling ${ROW_CEILING}). ` +
        `It is TRUNCATED, so it cannot say what the view holds and nothing may ` +
        `be graded against it.`,
    );
  }
}

/**
 * Count each value, with every known key present as a real 0 and the keys in a
 * FIXED order.
 *
 * The order matters because `whileStill` compares the two reads by
 * `JSON.stringify`: a record whose keys arrive in whatever order PostgREST
 * returned the rows would differ between two identical reads and be reported
 * as a database that moved.
 */
function tally(values: readonly string[], known: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>(known.map((key) => [key, 0]));
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const out: Record<string, number> = {};
  for (const key of [...counts.keys()].sort()) out[key] = counts.get(key) as number;
  return out;
}

/** A claim as this test reads it: its id, and the instant its age comes from. */
interface ClaimInstant {
  id: string;
  /** `null` where `observations` holds no instant for that claim. */
  observedAt: string | null;
}

/**
 * The claims the list on `tab` matches, with their instants — THIS TEST's own
 * read of the view, written without `lib/db/claims.ts`.
 *
 * **ONE ROUND TRIP, and its LENGTH is the count** (admin-window/TASK-0075).
 * Every case that holds this read still against a render takes `whole` from
 * `rows.length` rather than issuing a second `countRows` beside it: two reads
 * inside one held shape can disagree with each other, and QA measured exactly
 * that — `expected 878 to be 877` out of `gradeWindow`'s first assertion, which
 * compared this read with a count taken a moment later.
 *
 * **ONE leg since admin-window/BUG-0138**, because the view carries the
 * instant itself: the scraper handoff carries `observations.observed_at`
 * through `public.pending_claims`. This file does NOT fall back to the old
 * two-step join against `observations` when the column is absent — a fallback
 * here would grade the page against a shape the page does not have, and hide
 * the very refusal the precondition case exists to report.
 */
async function claimsFromDatabase(tab?: string): Promise<ClaimInstant[]> {
  const db = independentClient();
  const scoped = db.from(T.pendingClaims).select("observation_id, observed_at");
  const { data, error } = await (
    tab === "standing"
      ? scoped.eq("bucket", STANDING_BUCKET)
      : scoped.neq("bucket", PARKED_BUCKET)
  )
    .order("observation_id", { ascending: true })
    .limit(VIEW_READ_CAP);
  if (error) throw new Error(`the claim query failed: ${JSON.stringify(error)}`);
  const rows = (data ?? []) as { observation_id: string; observed_at: string | null }[];
  // A truncated read cannot say what the OLDEST claims are, which is the whole
  // of what the window cases grade — and the count they grade the page against
  // is now this read's own length, so a truncation would understate it too.
  refuseTruncated(
    rows,
    VIEW_READ_CAP,
    `this test's own read of the claims the ${tab ?? "buckets"} tab matches`,
  );

  return rows.map((row) => ({ id: row.observation_id, observedAt: row.observed_at }));
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
 * own figures.
 *
 * `whole` is `held`'s own LENGTH — one read, one number (admin-window/
 * TASK-0075). It used to be a separate `countRows` the caller passed in, and
 * the first thing this function did was assert the two agreed; on a live
 * staging they do not have to, and QA measured the red that comes of it
 * (`expected 878 to be 877`, a claim filed between the two reads). A count the
 * caller cannot take at the same instant as the rows is not a second opinion,
 * it is a second race.
 */
function gradeWindow(markup: string, held: readonly ClaimInstant[]): void {
  const whole = held.length;

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

/**
 * The COLUMN this whole page now rests on (admin-window/BUG-0138, criterion
 * 10).
 *
 * `/claims` reads no claim population any more: the list is one window read
 * ordered `observed_at asc` IN THE DATABASE, and that column reaches
 * `public.pending_claims` only through the scraper handoff Ben applies. So
 * this case is a precondition, not a nicety — every case below grades a page
 * whose reads select that column.
 *
 * **It FAILS when the column is absent. It does not skip and it does not
 * pass**, and no case in this file falls back to the old two-step join against
 * `observations`: a red here is the honest signal that the migration has not
 * been applied to staging, and the receipt records it as a refusal rather than
 * as a pass (the same discipline the banner above records for
 * admin-window/TASK-0031's index).
 */
const HANDOFF = "agenticflow/tracker/for-human/M2-handoff-pending-claims-observed-at.md";

describe("the column the Claims page rests on", () => {
  it("pending_claims carries observed_at", async () => {
    const { error } = await independentClient()
      .from(T.pendingClaims)
      .select("observation_id, observed_at")
      .limit(1);

    const code = (error as { code?: string } | null)?.code;
    if (code === "42703" || code === "PGRST204") {
      throw new Error(
        `staging's ${T.pendingClaims} does not expose observed_at (${code}). ` +
          `The Claims page reads it in every query it makes, so this file is ` +
          `RED until the handoff migration is applied: ${HANDOFF} ` +
          `(target repo "kspace Scraper", apply with supabase db push, ` +
          `STAGING only). Nothing here falls back to the two-step read.`,
      );
    }
    if (error) throw new Error(`the view could not be read: ${JSON.stringify(error)}`);
  });
});

/**
 * THE COLLAPSE, CHECKED AGAINST THE REAL VIEW (admin-window/TASK-0074).
 *
 * The pending-claims gauge used to read its claims as the SECOND step of a
 * two-step join — scan `observations` for the window, then look the view up by
 * the ids that came back. It now WINDOWS the view directly on `observed_at`,
 * beside that scan instead of after it, and the whole change rests on one
 * claim about this database: **the two shapes select the same claims.**
 *
 * That claim is a fact about staging's schema (the view carries
 * `observations.observed_at` through unchanged — scraper migration
 * `20260910000001`), so it is checked HERE, against staging, and not assumed
 * from the SQL. The offline suite proves the app's half — that the shapes
 * agree exactly while the instants agree, and differ by exactly the drifting
 * claim where they do not (`tests/offline/gauges/pending-claims.test.ts`).
 *
 * Both queries are written out in this file, from the migration, without
 * `src/lib/db/claims.ts` — the rule the whole file follows.
 */
describe("the two shapes of the pending-claims gauge against staging", () => {
  /** The gauge's own bounds: 90 days back, capped at the platform's row cap. */
  const GAUGE_DAYS = 90;
  const GAUGE_CAP = 1000;
  const ID_CHUNK = 100;

  interface Claim {
    observation_id: string;
    bucket: string;
    source_id: string;
    domain: string;
  }

  /** The aggregate the page renders off a claim set: buckets, sources, domains. */
  function aggregateOf(claims: readonly Claim[]) {
    const buckets: Record<string, number> = {};
    for (const bucket of RENDERED_BUCKETS) buckets[bucket] = 0;
    for (const claim of claims) {
      buckets[claim.bucket] = (buckets[claim.bucket] ?? 0) + 1;
    }
    return {
      claims: claims.length,
      buckets,
      sources: [...new Set(claims.map((claim) => claim.source_id))].sort(),
      domains: [...new Set(claims.map((claim) => claim.domain))].sort(),
      ids: claims.map((claim) => claim.observation_id).sort(),
    };
  }

  it("the windowed claims read and the id-list join select the same claims", async () => {
    const db = independentClient();
    // ONE instant, captured before either leg is issued and handed to both
    // (`snapshotAsOf`, tests/live/parity.ts; admin-window/TASK-0075). This test
    // writes every query it compares, so the two legs take the SAME explicit
    // upper edge rather than each racing the clock: the scraper files pending
    // claims into staging while this runs, and two claims arriving between the
    // two legs read as two claims one shape selected and the other did not
    // (measured 2026-09-10 — 877 expected, 879 received, both extras carrying a
    // uuidv7 prefix hours newer than the rest of the set). Both edges come from
    // this one helper and neither is re-derived per leg, so what is compared
    // below is the two SHAPES and not the two clocks. No tolerance anywhere:
    // the comparison stays exact identity.
    const asOf = snapshotAsOf();
    const since = snapshotAsOf(GAUGE_DAYS * 86_400_000);

    // SHAPE A — what the gauge does now: one window over the view's own instant.
    const windowed = await db
      .from(T.pendingClaims)
      .select("observation_id, bucket, source_id, domain")
      .neq("bucket", PARKED_BUCKET)
      .gte("observed_at", since)
      .lt("observed_at", asOf)
      .order("observed_at", { ascending: true })
      .order("observation_id", { ascending: true })
      .limit(GAUGE_CAP);
    if (windowed.error) {
      throw new Error(`the windowed claims read failed: ${JSON.stringify(windowed.error)}`);
    }
    const fromWindow = (windowed.data ?? []) as Claim[];

    // SHAPE B — what it used to do: scan `observations`, then look the view up
    // by the ids, in chunks of 100, the way `readRowsByIds` chunks them.
    // …the same window, the same two edges. The id-chunk legs below need no
    // edge of their own: they are bounded by the ids this scan returned.
    const scan = await db
      .from(T.observations)
      .select("observation_id, observed_at")
      .eq("status", "pending")
      .gte("observed_at", since)
      .lt("observed_at", asOf)
      .order("observed_at", { ascending: true })
      // The scan's tiebreak, so shape B is the scan the gauge really issues
      // (admin-window/BUG-0167). Under the cap guard below it cannot change
      // which rows come back — both legs are whole sets, not cuts — and at the
      // cap it is what makes the two cuts one cut; the guard is what keeps
      // this comparison about the shapes either way.
      .order("observation_id", { ascending: true })
      .limit(GAUGE_CAP);
    if (scan.error) throw new Error(`the scan failed: ${JSON.stringify(scan.error)}`);
    const scanned = (scan.data ?? []) as { observation_id: string }[];

    // Neither leg may be at its cap: a truncated read would make this a
    // question about where two windows were cut, not about which claims they
    // hold (the rule `VIEW_READ_CAP` states above).
    expect(
      fromWindow.length,
      `the windowed claims read returned its cap (${GAUGE_CAP}), so this ` +
        `comparison would be about the cap rather than about the two shapes`,
    ).toBeLessThan(GAUGE_CAP);
    expect(
      scanned.length,
      `the observations scan returned its cap (${GAUGE_CAP}), same reason`,
    ).toBeLessThan(GAUGE_CAP);
    // …and non-vacuous: staging really holds pending claims in this window.
    // The window is still 90 days minus the settle margin, and staging held
    // 877 pending claims in it when this was measured (2026-09-10), so the
    // upper edge narrows the set by the seconds it must and by nothing else.
    expect(fromWindow.length).toBeGreaterThan(0);

    const ids = scanned.map((row) => row.observation_id);
    const fromJoin: Claim[] = [];
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
      const chunkIds = ids.slice(start, start + ID_CHUNK);
      const leg = await db
        .from(T.pendingClaims)
        .select("observation_id, bucket, source_id, domain")
        .in("observation_id", chunkIds)
        .neq("bucket", PARKED_BUCKET)
        .limit(chunkIds.length);
      if (leg.error) throw new Error(`an id-list leg failed: ${JSON.stringify(leg.error)}`);
      fromJoin.push(...((leg.data ?? []) as Claim[]));
    }

    // The identity the collapse rests on, stated twice: the claim set, and
    // every figure the gauge renders off it.
    expect(aggregateOf(fromWindow).ids).toEqual(aggregateOf(fromJoin).ids);
    expect(aggregateOf(fromWindow)).toEqual(aggregateOf(fromJoin));
    // And the parked bucket is in neither, on a database that spells it.
    expect(fromWindow.map((claim) => claim.bucket)).not.toContain(PARKED_BUCKET);
  });

  /**
   * THE SAME IDENTITY, IN THE REGIME THE CHECK ABOVE REFUSES TO BE ABOUT
   * (admin-window/BUG-0167, QA).
   *
   * The check above guards both legs against their cap and says why: a
   * truncated read would make it a question about where two windows were cut.
   * But "where two windows were cut" is exactly what BUG-0167 was, and until
   * this case the only evidence the fix holds AT the cap was an offline
   * fixture whose ordering engine compares uuids as JavaScript strings. This
   * one asks Postgres, whose `uuid` order is its own, and asks the gauge's own
   * `fetchPendingClaims` rather than a query the test rewrote.
   *
   * **Staging is a harder fixture than the offline one.** Censused here
   * 2026-09-11: 877 pending observations in the 90-day window across FIVE
   * distinct instants, the largest tie holding 817 rows from index 1. So
   * almost any cap lands inside a tie, and the arbitrary-subset regime is one
   * `order by` clause away rather than a contrived four-row fixture.
   *
   * Race-free by construction, not by tolerance: the caps are drawn from the
   * first `PROBE_DEPTH` rows of the ascending order, and a claim the scraper
   * files while this runs carries `observed_at = now()`, which sorts at the
   * END of that order and can never enter the prefix. A claim ADJUDICATED out
   * of the prefix mid-comparison would, so the whole comparison sits inside
   * `whileStill` on that prefix and re-runs rather than reporting staging's
   * movement as a defect.
   */
  const PROBE_DEPTH = 64;

  it("selects the same claims AT the cap, where staging's boundary instant is tied", async () => {
    const db = independentClient();
    const since = snapshotAsOf(GAUGE_DAYS * 86_400_000);
    const instantOf = (value: string) => new Date(value).toISOString();

    /** The head of the window's own total order — the prefix the caps cut. */
    const prefix = async () => {
      const read = await db
        .from(T.observations)
        .select("observation_id, observed_at")
        .eq("status", "pending")
        .gte("observed_at", since)
        .order("observed_at", { ascending: true })
        .order("observation_id", { ascending: true })
        .limit(PROBE_DEPTH);
      if (read.error) throw new Error(`the census scan failed: ${JSON.stringify(read.error)}`);
      return (read.data ?? []) as { observation_id: string; observed_at: string }[];
    };

    const head = await prefix();
    expect(
      head.length,
      "staging holds too few pending observations in the window for a capped comparison",
    ).toBeGreaterThan(2);

    // A cap that cuts INSIDE a tie: rows `n-1` and `n` share an instant, so
    // an incompletely-ordered `limit n` is free to return either of them.
    const tiedCut = head.findIndex(
      (row, index) => index > 0 && instantOf(row.observed_at) === instantOf(head[index - 1].observed_at),
    );
    const caps = [...new Set([1, tiedCut, Math.floor(head.length / 2), head.length - 1])]
      .filter((cap) => cap >= 1 && cap < head.length)
      .sort((left, right) => left - right);

    const { made } = await whileStill(prefix, async () => {
      const compared: { cap: number; scanned: number; windowed: string[]; joined: string[] }[] = [];
      for (const cap of caps) {
        const options = { since, limit: cap };
        // SHAPE A — the gauge itself: two legs, one cap, one order, intersected.
        const windowed = await fetchPendingClaims(options, db);
        if (windowed.kind !== "ok") throw new Error(`the gauge refused: ${JSON.stringify(windowed)}`);
        // SHAPE B — the id-list join it replaced, over the same scan.
        const scan = await readPendingObservations(
          resolveBounds(options, PENDING_CLAIMS_DEFAULTS),
          {},
          db,
        );
        if (scan.kind !== "ok") throw new Error(`the scan refused: ${JSON.stringify(scan)}`);
        const joined = await readPendingClaimRows(
          scan.data.map((row) => row.observation_id),
          db,
        );
        if (joined.kind !== "ok") throw new Error(`the id-list join refused: ${JSON.stringify(joined)}`);
        compared.push({
          cap,
          scanned: scan.data.length,
          windowed: windowed.data.claims.map((claim) => claim.observation_id).sort(),
          joined: joined.data.map((claim) => claim.observation_id).sort(),
        });
      }
      return compared;
    });

    // Non-vacuous: every cap really truncated, and at least one cut a tie.
    expect(made.length).toBeGreaterThan(1);
    expect(
      tiedCut,
      "no two of staging's oldest pending observations share an instant, so this " +
        "run proved the untied identity only",
    ).toBeGreaterThan(0);
    for (const { cap, scanned } of made) expect(scanned, `cap ${cap}`).toBe(cap);
    // The identity, at every cap, on the database's own ordering.
    for (const { cap, windowed, joined } of made) {
      expect(windowed, `cap ${cap}: the gauge and the id-list join select the same claims`).toEqual(
        joined,
      );
    }
    // …and the largest cap selected something, so this is not an equality of
    // two empty sets.
    expect(made[made.length - 1].joined.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("the Claims page's surface hooks against staging", () => {
  it("names every surface on the page once, on both tabs", async () => {
    // The oracle's addressing itself, asserted before it is used: each hook
    // has to reach exactly one element wherever it renders, which is the
    // precondition `stateOf` enforces per call. Both tabs, because the tab is
    // what changes this page's section ORDER — the very thing the old
    // positional selectors had to encode (admin-window/DEBT-0002).
    // `nested` empty says no surface sits inside another, so grading one never
    // reads a card that belongs to its neighbour.
    for (const [tab, counts] of Object.entries(SURFACE_COUNTS)) {
      const markup = await claimsMarkup({ tab });
      expect(surfaceHooks(markup, Object.keys(counts)), tab).toEqual({
        counts,
        nested: [],
      });
    }
  });
});

/**
 * ONE ROUND TRIP: every claim the bucket table on this URL counts, tallied by
 * bucket in TypeScript (admin-window/TASK-0075, attempt 2).
 *
 * Attempt 1 held six sequential count queries still — `whole` plus one per
 * bucket — and QA measured what that costs: each `whileStill` attempt kept a
 * ~4 s window open, three attempts kept it open three times over, and a scraper
 * cycle wrote through every one of them. The intermittent wrong-count red
 * simply became an intermittent attempts-exhausted red on the same trigger.
 * `whileStill`'s protection decays with the DURATION of the shape it holds, so
 * the shape is now a single `select` at a single instant.
 *
 * `whole` is this read's own LENGTH, and it is what `gradeSurface` is handed —
 * never a second count beside it. The tally is written from the migration's
 * bucket vocabulary, never from `src/lib/db/claims.ts`; `PARKED_BUCKET` is
 * excluded in the query itself, so the tally can never count a parked claim.
 */
async function bucketCensus(
  source?: string,
): Promise<{ whole: number; buckets: Record<string, number> }> {
  const scoped = independentClient()
    .from(T.pendingClaims)
    .select("bucket")
    .neq("bucket", PARKED_BUCKET);
  const { data, error } = await (
    source === undefined ? scoped : scoped.eq("source_id", source)
  ).limit(VIEW_READ_CAP);
  if (error) throw new Error(`the bucket census failed: ${JSON.stringify(error)}`);
  const rows = (data ?? []) as { bucket: string }[];
  refuseTruncated(
    rows,
    VIEW_READ_CAP,
    `this test's own bucket census${source === undefined ? "" : ` of ${source}`}`,
  );
  return {
    whole: rows.length,
    buckets: tally(
      rows.map((row) => row.bucket),
      RENDERED_BUCKETS,
    ),
  };
}

/**
 * ONE ROUND TRIP: the source of every claim the view holds, tallied by source.
 *
 * Two figures the spelling case needs — the whole view's size and the size of
 * the narrowing — come out of this one read, so the "is this really a
 * narrowing" guard can never be two counts disagreeing with each other. Its
 * keys are also the source list the per-source case iterates, so that case
 * enumerates sources without a second read of its own.
 */
async function sourceCensus(): Promise<{ whole: number; bySource: Record<string, number> }> {
  const { data, error } = await independentClient()
    .from(T.pendingClaims)
    .select("source_id")
    .neq("bucket", PARKED_BUCKET)
    .limit(VIEW_READ_CAP);
  if (error) throw new Error(`the source census failed: ${JSON.stringify(error)}`);
  const rows = (data ?? []) as { source_id: string }[];
  refuseTruncated(rows, VIEW_READ_CAP, "this test's own source census");
  return {
    whole: rows.length,
    bySource: tally(
      rows.map((row) => row.source_id),
      [],
    ),
  };
}

describe("the classification buckets against staging", () => {
  it("renders each bucket's count exactly as the view holds it", async () => {
    // The scraper files claims into staging while this runs, so the render and
    // the counts are pinned to one still moment (`whileStill`; the same device
    // cycles.live.test.ts and dashboard.live.test.ts use, ruled for this class
    // on 2026-09-02). A claim arriving between them reads as a count the page
    // got wrong — measured on this very case, 2026-09-10, admin-window/
    // TASK-0075. What is held still is ONE round trip (`bucketCensus`), because
    // the device's protection decays with the duration of the shape it holds:
    // the six-count version of this shape kept the window open ~4 s and QA
    // measured it exhausting all three attempts. Every comparison below is
    // still exact equality — `whileStill` makes the SAME comparison on every
    // attempt and throws rather than passing when the database will not hold
    // still.
    const { made: markup, held } = await whileStill(
      () => bucketCensus(),
      () => claimsMarkup(),
    );
    const state = await gradeSurface({
      markup,
      within: BUCKETS,
      object: T.pendingClaims,
      counted: held.whole,
    });
    if (state !== "ok") return;

    for (const bucket of RENDERED_BUCKETS) {
      expect(renderedCount(markup, bucket), bucket).toBe(held.buckets[bucket]);
    }
  });

  it("renders each bucket's count exactly as the view holds it, per source filter", async () => {
    // Page against database again, so `whileStill` again — once for the whole
    // view, and once per source below, because each narrowed page is its own
    // comparison with its own counts (admin-window/TASK-0075). Each held shape
    // is one round trip.
    const { made: markup, held } = await whileStill(
      () => bucketCensus(),
      () => claimsMarkup(),
    );
    const state = await gradeSurface({
      markup,
      within: BUCKETS,
      object: T.pendingClaims,
      counted: held.whole,
    });
    if (state !== "ok") return;

    // The sources the view actually carries — the census's own keys, so this
    // case enumerates them without a read of its own. It is not part of any
    // comparison: a source that arrives after it simply is not walked here.
    const sources = Object.keys((await sourceCensus()).bySource);

    for (const source of sources) {
      const { made: narrowed, held: counts } = await whileStill(
        () => bucketCensus(source),
        () => claimsMarkup({ source_id: source }),
      );
      // A source with no claim of its own is an EMPTY bucket table with real
      // zeros in it, not an absent view — the page states the figure either
      // way (rule 2).
      const narrowedState = await gradeSurface({
        markup: narrowed,
        within: BUCKETS,
        object: T.pendingClaims,
        counted: counts.whole,
      });
      if (narrowedState !== "ok") continue;
      for (const bucket of RENDERED_BUCKETS) {
        expect(renderedCount(narrowed, bucket), `${source} / ${bucket}`).toBe(
          counts.buckets[bucket],
        );
      }
    }
  });

  /**
   * **One id, one narrowing, against the real database** — admin-window/
   * BUG-0140's property on `/claims` (admin-window/DEBT-0009).
   *
   * `source_id` is a uuid column: PostgREST's `.eq` matches every spelling of
   * one id, and this page also compares in JavaScript, where only one matches.
   * Compared RAW — which is what it did — a real source's id with its hyphens
   * left out, or wearing the whitespace a paste brings, narrowed NOTHING here
   * and the page served every claim under a filter bar reading "all". The two
   * comparisons only agree on a canonicalised value, and this is the case that
   * says so against the database that makes the first of them.
   *
   * Graded against the CANONICAL render, not a literal: the claim is that the
   * two are the same page. It reads and writes nothing of its own beyond the
   * source list the case above already reads.
   */
  it("narrows the same way for every spelling of one source id", async () => {
    // A source to narrow by. Outside every comparison — it only has to be a
    // source the view carries — so it needs no still window of its own.
    const { data, error } = await independentClient()
      .from(T.pendingClaims)
      .select("source_id")
      .neq("bucket", PARKED_BUCKET)
      .limit(1);
    if (error) throw new Error(`the source query failed: ${JSON.stringify(error)}`);
    const source = ((data ?? []) as { source_id: string }[])[0]?.source_id;
    // No claims at all is not this case's question; the case above grades that.
    if (source === undefined) return;

    for (const spelling of [
      source.toUpperCase(),
      source.replace(/-/g, ""),
      ` ${source}\n`,
    ]) {
      if (spelling === source) continue;

      // PAGE against PAGE (admin-window/TASK-0075): `renderedCount(asked)` vs
      // `renderedCount(canonical)` are two renders at two instants, and a claim
      // filed between them is a difference neither spelling caused. So the pair
      // is rendered inside ONE window in which the database did not move, and
      // the two figures the guards below need come out of the SAME one-round-
      // trip census that closes the window. One spelling per window rather than
      // all three in one: a window is as fragile as it is long, and two renders
      // hold still far more often than six do.
      const { made, held } = await whileStill(
        () => sourceCensus(),
        async () => ({
          canonical: await claimsMarkup({ source_id: source }),
          asked: await claimsMarkup({ source_id: spelling }),
        }),
      );
      const whole = held.whole;
      const forSource = held.bySource[source] ?? 0;

      // Non-vacuous: this source really is a narrowing of the whole view, and
      // its page really has claims to count.
      expect(forSource, "the source read for this case carries no claim").toBeGreaterThan(0);
      // The state kind before any figure is read, on a page from inside this
      // window rather than on a bare render taken outside it.
      const state = await gradeSurface({
        markup: made.canonical,
        within: BUCKETS,
        object: T.pendingClaims,
        counted: forSource,
      });
      if (state !== "ok") return;

      for (const bucket of RENDERED_BUCKETS) {
        expect(
          renderedCount(made.asked, bucket),
          `${JSON.stringify(spelling)} / ${bucket}`,
        ).toBe(renderedCount(made.canonical, bucket));
      }
      expect(claimIds(made.asked), JSON.stringify(spelling)).toEqual(
        claimIds(made.canonical),
      );

      // The rows alone cannot discriminate on a database whose view carries
      // ONE source — every claim matches, so the unnarrowed page and the
      // narrowed one draw the same rows and the equalities above pass under
      // the very defect this case is about (measured on staging 2026-09-09:
      // the case was VACUOUS against the pre-fix filter until these two
      // assertions were added). These two say the page UNDERSTOOD the
      // parameter, whatever the view's population: it may not report a
      // narrowing it performed as a dropped parameter, and the chip that is
      // on must be this source's rather than "all".
      const $ = cheerio.load(made.asked);
      expect(
        $("[data-dropped-params]").length,
        `${JSON.stringify(spelling)} was reported as a parameter the page dropped`,
      ).toBe(0);
      const active = $('[data-facet="source_id"] a[aria-current="true"]')
        .toArray()
        .map((element) => $(element).attr("href") ?? "");
      expect(active, JSON.stringify(spelling)).toHaveLength(1);
      expect(active[0], JSON.stringify(spelling)).toContain(encodeURIComponent(source));
      if (forSource < whole) {
        expect(
          RENDERED_BUCKETS.reduce(
            (total, bucket) => total + renderedCount(made.asked, bucket),
            0,
          ),
          JSON.stringify(spelling),
        ).toBeLessThan(whole);
      }
    }
  });

  it("draws the view's longest-waiting window, and states the whole it came from", async () => {
    // The read behind the list is a WINDOW and its `held` is a COUNT
    // (admin-window/BUG-0138): the page draws at most `CLAIM_WINDOW` rows and
    // states a figure the database counted. Both halves are graded from ONE
    // read of this test's own, held still around the render (admin-window/
    // TASK-0075): the expected ids are that read's rows and the expected whole
    // is its LENGTH. This case raced twice over before — page against test
    // read, and test read against a separate count — and QA measured the second
    // of those as `expected 878 to be 877`.
    const { made: markup, held } = await whileStill(
      () => claimsFromDatabase(),
      () => claimsMarkup(),
    );
    const state = await gradeSurface({
      markup,
      within: LIST,
      object: T.pendingClaims,
      counted: held.length,
    });
    if (state !== "ok") return;

    gradeWindow(markup, held);
  });

  it("renders the standing tab as the window of exactly that bucket's subset", async () => {
    // The EMPTY branch races too — the page and this test's own read disagree
    // the instant staging gains a standing claim — so the whole case, both
    // branches, sits inside one still window over ONE read of the bucket
    // (admin-window/TASK-0075).
    const { made: markup, held } = await whileStill(
      () => claimsFromDatabase("standing"),
      () => claimsMarkup({ tab: "standing" }),
    );
    // Nobody contradicting anybody is an EMPTY list with a counted 0 — an
    // honest state, and not the same thing as an absent view.
    const state = await gradeSurface({
      markup,
      within: LIST,
      object: T.pendingClaims,
      counted: held.length,
    });
    if (state !== "ok") {
      // Staging holds 0 standing claims today, so this is the branch that runs
      // there. It is still graded: this test's own read of the bucket must
      // agree that there is nothing, and the list must draw nothing — an
      // emptiness nobody checked is how a broken list passes.
      if (state === "empty") {
        // `held` is the same read the kind was decided from, taken inside the
        // window this render sits in — not a second read of the bucket.
        expect(held).toEqual([]);
        expect(claimIds(markup)).toEqual([]);
        // An empty window is still a window the page LOOKED in, so the line
        // stands beside the Empty card and states a real zero — the only state
        // that may publish `data-window-held="0"` (ARCHITECTURE.md §4.3,
        // admin-window/BUG-0070). Read after the state kind, never instead of
        // it: a refused read publishes no line at all, and `windowLine` would
        // then fail for the right reason.
        const line = windowLine(markup);
        expect(line.limit).toBe(CLAIM_WINDOW);
        expect(line.held).toBe(0);
        expect(line.truncated).toBe(false);
      }
      return;
    }

    // This bucket is NOT assumed to fit under the cap: the day it outgrows
    // `CLAIM_WINDOW` the list becomes a window like any other, and comparing
    // it with the bucket's whole id set would go red for the wrong reason
    // (admin-window/BUG-0057).
    gradeWindow(markup, held);
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
      // Page against database, so the pair is held still around ONE read of
      // the set this URL's list renders (admin-window/TASK-0075). This is the
      // `tab=standing` trap: that tab's set is 0 on staging most of the time,
      // so the kind the page draws is Empty — and the moment the resolver files
      // a standing claim between the render and this test's read, the two
      // disagree about the KIND and the case reds on a page that did nothing
      // wrong. Measured 2026-09-10, on this case.
      const { made: markup, held } = await whileStill(
        () => claimsFromDatabase(params.tab),
        () => claimsMarkup(params),
      );
      // Each surface is graded against the count of the set IT renders: the
      // standing tab's list is one bucket's subset, and grading it against
      // the whole view's count read that tab's honest EMPTY as a mismatch and
      // threw before the assertion below (admin-window/BUG-0037). That count is
      // this read's own LENGTH — one round trip, never a second count.
      await gradeSurface({
        markup,
        within: LIST,
        object: T.pendingClaims,
        counted: held.length,
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
    // The last page-vs-database gate in this file, held still like the rest and
    // graded against ONE read's own length (admin-window/TASK-0075). Nothing
    // below races — the registry read asks for exactly the ids the page
    // rendered — but `gradeSurface` is handed a number here rather than a thunk
    // that reads again, so no comparison in this file is made across two
    // instants.
    const { made: markup, held } = await whileStill(
      () => claimsFromDatabase(),
      () => claimsMarkup(),
    );
    await gradeSurface({
      markup,
      within: LIST,
      object: T.pendingClaims,
      counted: held.length,
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

/* ── paging past the first window, against staging ───────────────────────── */

/**
 * THE PAGED WALK — campaign admin-window/TASK-0067, M3 EC4, SPEC F14.
 *
 * The first screen is a WINDOW, and this file already certifies that window.
 * What is certified here is what the operator can do AFTER it: starting from
 * the page the server rendered, press until the set ends, and check the ids
 * that walk reached against a range walk THIS FILE writes, over the same view,
 * in the order the page states above its list.
 *
 * Three claims, and each is graded from this test's own reads (ARCHITECTURE.md
 * §10 rule 1 — nothing here asks `src/lib/db/claims.ts` what to expect):
 *
 *  - the walk REACHES PAST the first window's last row;
 *  - the distinct ids it reaches are exactly the range walk's enumeration —
 *    no id twice, none skipped;
 *  - and there are as many of them as the HEAD FIGURE the page itself
 *    rendered (`data-window-held`, the count the page states over the set its
 *    list is drawn from).
 *
 * The state kind is named from `data-surface` before any number is compared,
 * and the page's own affordance hook decides whether there is a walk to make
 * at all: on a view that fits in one window there is no control, and this
 * states that instead of inventing one (§10, common violations rows 6-8).
 *
 * **The race, and the device** (admin-window/TASK-0075). The scraper files
 * claims into staging while this runs, and neither the page's read nor the
 * walk may be given an upper edge — they are the APP's reads, not this file's
 * — so the device is `whileStill`: this file's own bounded read of the view is
 * taken, the page is rendered, walked AND enumerated, and the read is taken
 * again; the comparison is only made when the two agree. Every attempt makes
 * the same exact comparison; running out of attempts throws rather than
 * passing. Everything compared is made inside that one window — the oracle
 * included, which is what the 878-vs-877 red of 2026-09-10 was about.
 */
describe("paging past the first window, against staging", () => {
  /** One paging request, through the app's own route handler. */
  async function viaHandler(url: string): Promise<unknown> {
    const response = await GET(new Request(`http://localhost${url}`));
    return response.json();
  }

  /** The bound a walked URL carried, so a walk can say what it asked for. */
  const CAP_PAGES = 200;

  /**
   * Press until the set ends, from the state the FIRST SCREEN leaves behind.
   *
   * The driver is the app's (`requestPage`), the route is the app's, and the
   * loop is this file's: it presses only from `idle`, stops at `exhausted`,
   * and treats a refusal as a failure with the refusal's own words — a walk
   * that silently stopped at a refused page would report a short set as the
   * whole of it.
   */
  async function walk(
    params: string,
  ): Promise<{ rows: ClaimLine[]; bounds: (string | null)[]; presses: number }> {
    const deps = {
      route: PAGE_ROUTES.claims,
      params,
      size: CLAIM_WINDOW,
      fetchJson: viaHandler,
    };
    const bounds: (string | null)[] = [];
    const asked = async (url: string): Promise<unknown> => {
      bounds.push(new URLSearchParams(url.split("?")[1]).get(OFFSET_PARAM));
      return viaHandler(url);
    };

    let state: PageState<ClaimLine> = initialPage<ClaimLine>(CLAIM_WINDOW, true);
    let presses = 0;
    while (state.status === "idle" && presses < CAP_PAGES) {
      state = await requestPage<ClaimLine>(state, { ...deps, fetchJson: asked });
      presses += 1;
      if (state.refusal !== null) {
        throw new Error(
          `the walk was refused at bound ${bounds[bounds.length - 1]}: ` +
            `${state.refusal.object ?? "(no object)"} — ${state.refusal.reason}`,
        );
      }
    }
    expect(presses, "the walk hit its own page cap rather than the end of the set")
      .toBeLessThan(CAP_PAGES);
    return { rows: [...state.rows], bounds, presses };
  }

  /**
   * THE ORACLE: every claim of the unnarrowed view, enumerated by a RANGE walk
   * this file writes, in the order the page states — oldest first, an unknown
   * instant last, `observation_id` breaking every tie.
   *
   * It is not the app's read: its own step, its own edges, its own columns.
   * A page that stopped short would still be "a set of ids"; the only thing
   * that catches it is a second enumeration made independently.
   */
  async function rangeWalk(): Promise<string[]> {
    const db = independentClient();
    const STEP = 500;
    const ids: string[] = [];
    for (let from = 0; from < VIEW_READ_CAP; from += STEP) {
      const { data, error } = await db
        .from(T.pendingClaims)
        .select("observation_id")
        .neq("bucket", PARKED_BUCKET)
        .order("observed_at", { ascending: true, nullsFirst: false })
        .order("observation_id", { ascending: true })
        .range(from, from + STEP - 1);
      if (error) throw new Error(`the range walk failed: ${JSON.stringify(error)}`);
      const rows = (data ?? []) as { observation_id: string }[];
      ids.push(...rows.map((row) => row.observation_id));
      if (rows.length < STEP) return ids;
    }
    throw new Error(
      `this test's own range walk reached ${VIEW_READ_CAP} claims without ` +
        `ending, so it cannot say what the view holds`,
    );
  }

  it("reaches every claim the view holds, once each, and no more", async () => {
    // EVERYTHING this case compares is made inside ONE still window
    // (admin-window/TASK-0075). The oracle used to be issued after the window
    // closed, which left the comparison it exists for racing the scraper: under
    // the full live suite on 2026-09-10 the walk reached 878 ids while the
    // enumeration taken moments later held 877, the odd one out carrying a
    // uuidv7 prefix minted during the walk. So `rangeWalk()` is part of what is
    // MADE, and what is held still is this file's own bounded read of the view
    // — ONE round trip, refusing rather than truncating, and its LENGTH is the
    // count the surface's kind is graded against (never a second count beside
    // it). An id set is also a stricter sentinel than a count: a claim filed
    // while another is resolved moves no count at all.
    const { made, held } = await whileStill(
      () => claimsFromDatabase(),
      async () => {
        const markup = await claimsMarkup();
        const $ = cheerio.load(markup);
        return {
          markup,
          first: claimIds(markup),
          arms: $("[data-paging]")
            .toArray()
            .map((element) => $(element).attr("data-paging") ?? ""),
          // The page's own head figure, read AFTER the state kind below.
          line: $('[data-window="claims"]').attr("data-window-held") ?? null,
          walked: (await walk("")).rows.map((row) => row.observationId),
          // The oracle, made in the same window as the walk it grades.
          enumerated: await rangeWalk(),
        };
      },
      // FIVE attempts, not the default three, and the shape held still is still
      // ONE round trip (`parity.ts`, rule 4 of the 2026-09-10 corollary). What
      // it buys is more INDEPENDENT still windows, never a widened comparison:
      // every attempt makes the same exact comparison and exhaustion throws.
      // This call site alone needs them because its `make` is the longest in
      // the file — a render plus a ~14-request walk plus the enumeration, 7-20 s
      // measured — and staging churns in bursts: on 2026-09-10 this case
      // watched the view go 887 → 879 inside one make while the resolver drained
      // pending claims, and 877 → 887 across a run.
      5,
    );
    const whole = held.length;

    // The state kind, before any number is compared.
    const state = await gradeSurface({
      markup: made.markup,
      within: LIST,
      object: T.pendingClaims,
      counted: whole,
    });
    if (state !== "ok") return;

    // The gate really is asked, once per page of the walk.
    expect(gate.calls, "the paging route answered without asking the gate").toBeGreaterThan(0);

    if (whole <= CLAIM_WINDOW) {
      // A view that fits in one window is not a walk: the page offers no
      // control, and this says so rather than inventing one. Staging held 877
      // claims when this was written, so this is not the branch it runs.
      expect(made.arms, "a view inside one window offered a control").toEqual([]);
      expect(made.walked).toEqual([]);
      return;
    }

    // There IS more, so the page says so — and the walk starts from the rows
    // the server rendered.
    expect(made.arms).toContain("more");
    expect(made.first).toHaveLength(CLAIM_WINDOW);
    expect(made.walked.length, "the walk reached nothing past the first window")
      .toBeGreaterThan(0);
    // …and it really is PAST the first window's last row.
    expect(made.walked).not.toContain(made.first[made.first.length - 1]);

    const reached = [...made.first, ...made.walked];
    expect(new Set(reached).size, "a claim was reached twice").toBe(reached.length);

    // The oracle: an independently written enumeration of the same view, made
    // inside this window.
    expect([...reached].sort()).toEqual([...made.enumerated].sort());

    // …and as many as the page's own head figure states.
    expect(made.line, "the list stated no head figure").not.toBeNull();
    expect(reached).toHaveLength(Number(made.line));
    expect(Number(made.line)).toBe(whole);
  });
});
