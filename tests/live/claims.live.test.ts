import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import ClaimsPage from "@/app/claims/page";
import { T } from "@/lib/db/tables";
import { countRows, independentClient, renderPage } from "./parity";

/**
 * The Claims page against staging (campaign admin-window/TASK-0012).
 *
 * Acceptance test 3: "rendered bucket counts equal the classification view's,
 * per bucket, per source filter; `in_window` appears nowhere in the UI" — and
 * acceptance test 2's rule, ARCHITECTURE.md §10: what the page RENDERED is
 * compared with a query THIS TEST issues, written independently of the
 * `lib/db` function the page called. Two paths to one number, or it proves
 * nothing — so nothing below asks `src/lib/db/claims.ts` what to expect. The
 * buckets are spelled here from the migration (`20260901000004`), and the
 * counts come from this file's own `head: true, count: "exact"` queries
 * against the view.
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
 * Where staging does not carry `pending_claims` at all (ARCHITECTURE.md §12
 * `OPEN-FIXTURES`), each case asserts the honest not-provisioned rendering
 * instead, naming the view. It never skips silently.
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

/** The page as the URL renders it. Every read happens per request. */
async function claimsMarkup(params: Params = {}): Promise<string> {
  return renderPage(ClaimsPage, { searchParams: Promise.resolve(params) });
}

/** Did the classification table render at all, or is this an absent view? */
function bucketsRendered(markup: string): boolean {
  return cheerio.load(markup)("[data-bucket]").length > 0;
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
  return independentClient()
    .from(T.pendingClaims)
    .select("*", { head: true, count: "exact" });
}

describe("the classification buckets against staging", () => {
  it("renders each bucket's count exactly as the view holds it", async () => {
    const markup = await claimsMarkup();
    if (!bucketsRendered(markup)) {
      expect(markup).toContain(T.pendingClaims);
      return;
    }

    for (const bucket of RENDERED_BUCKETS) {
      const expected = await countRows(() => claimCount().eq("bucket", bucket));
      expect(renderedCount(markup, bucket), bucket).toBe(expected);
    }
  });

  it("renders each bucket's count exactly as the view holds it, per source filter", async () => {
    const markup = await claimsMarkup();
    if (!bucketsRendered(markup)) {
      expect(markup).toContain(T.pendingClaims);
      return;
    }

    // The sources the view actually carries, read by this test.
    const { data, error } = await independentClient()
      .from(T.pendingClaims)
      .select("source_id")
      .neq("bucket", PARKED_BUCKET)
      .limit(1000);
    if (error) throw new Error(`the source query failed: ${error.message}`);
    const sources = [
      ...new Set(((data ?? []) as { source_id: string }[]).map((row) => row.source_id)),
    ];

    for (const source of sources) {
      const narrowed = await claimsMarkup({ source_id: source });
      if (!bucketsRendered(narrowed)) {
        expect(narrowed).toContain(T.pendingClaims);
        return;
      }
      for (const bucket of RENDERED_BUCKETS) {
        const expected = await countRows(() =>
          claimCount().eq("bucket", bucket).eq("source_id", source),
        );
        expect(renderedCount(narrowed, bucket), `${source} / ${bucket}`).toBe(expected);
      }
    }
  });

  it("lists every claim the view holds — a complete read, nothing dropped", async () => {
    const markup = await claimsMarkup();
    if (!bucketsRendered(markup)) {
      expect(markup).toContain(T.pendingClaims);
      return;
    }

    const whole = await countRows(() => claimCount().neq("bucket", PARKED_BUCKET));
    const rendered = claimIds(markup);
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(rendered).toHaveLength(whole);
  });

  it("renders the standing tab as exactly that bucket's subset", async () => {
    const markup = await claimsMarkup({ tab: "standing" });
    const rendered = claimIds(markup);
    if (rendered.length === 0) {
      // Either the view is absent, or nobody is contradicting anybody — both
      // are honest, and neither is a silent skip.
      const standing = await countRows(() =>
        claimCount().eq("bucket", "standing_disagreement"),
      ).catch(() => null);
      expect(standing === null || standing === 0).toBe(true);
      return;
    }

    const { data, error } = await independentClient()
      .from(T.pendingClaims)
      .select("observation_id")
      .eq("bucket", "standing_disagreement")
      .limit(1000);
    if (error) throw new Error(`the standing query failed: ${error.message}`);
    expect(new Set(rendered)).toEqual(
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
    for (const params of [
      {},
      { tab: "standing" },
      { bucket: PARKED_BUCKET },
      { bucket: PARKED_BUCKET, tab: "standing" },
    ] as Params[]) {
      const markup = await claimsMarkup(params);
      expect(markup, JSON.stringify(params)).not.toContain(PARKED_BUCKET);
    }
  });

  it("holds no row in the view either, so nothing was hidden that exists", async () => {
    const held = await countRows(() => claimCount().eq("bucket", PARKED_BUCKET)).catch(
      (error: unknown) => {
        // An absent view is the not-provisioned case, asserted above.
        expect(String(error)).toContain(T.pendingClaims);
        return 0;
      },
    );
    expect(held).toBe(0);
  });
});
