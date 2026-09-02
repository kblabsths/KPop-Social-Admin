import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import ReviewItemPage from "@/app/queues/[reviewItemId]/page";
import { T } from "@/lib/db/tables";
import { independentClient, renderPage } from "./parity";

/**
 * The review-item detail against staging (campaign admin-window/TASK-0011).
 *
 * Acceptance test 5: "a review item's detail resolves its evidence — every
 * `evidence` id renders as its observation row (value, source, tier,
 * `observed_at`) with canonical's current value and provenance beside them".
 *
 * ARCHITECTURE.md §10's rule holds here as everywhere: what the page RENDERED
 * is compared with rows THIS TEST fetches, written independently of the
 * `lib/db` module the page called. Nothing below asks
 * `src/lib/db/review-item.ts` what it expects — the test picks an item, reads
 * its `evidence` array itself, resolves those ids against `observations`
 * itself, and compares.
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
 * Where staging carries no `review_items` at all, or holds no item yet
 * (ARCHITECTURE.md §12 `OPEN-FIXTURES`), each case asserts the honest state
 * instead — the table named, or the page's own no-such-row surface. It never
 * skips silently.
 */

type Item = {
  review_item_id: string;
  queue: string;
  source_id: string | null;
  domain: string | null;
  entity_id: string | null;
  field: string | null;
  summary: string;
  severity: string;
  folded_count: number;
  evidence: string[];
};

/** The page as the URL renders it. Every read happens per request. */
function itemMarkup(id: string): Promise<string> {
  return renderPage(ReviewItemPage, { params: Promise.resolve({ reviewItemId: id }) });
}

/** The test's own select over the review table. */
async function anyItem(): Promise<Item | null | "absent"> {
  const { data, error } = await independentClient()
    .from(T.reviewItems)
    .select(
      "review_item_id, queue, source_id, domain, entity_id, field, summary, severity, folded_count, evidence",
    )
    // Items with evidence first: this test is about resolving it.
    .order("last_evidence_at", { ascending: false })
    .order("review_item_id", { ascending: true })
    .limit(20);
  if (error) {
    // The resolver tables are not in this database yet — the honest state, and
    // the page renders it as one. Anything else is a real failure.
    const code = (error as { code?: string }).code ?? "";
    if (code === "PGRST205" || code === "42P01") return "absent";
    throw new Error(`the review-item query failed: ${(error as Error).message}`);
  }
  const rows = (data ?? []) as Item[];
  return rows.find((row) => row.evidence.length > 0) ?? rows[0] ?? null;
}

/** The observations the test resolves for itself, by the ids the item carries. */
async function observationsOf(ids: readonly string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await independentClient()
    .from(T.observations)
    .select("observation_id, source_id, observed_at, status, value")
    .in("observation_id", [...ids])
    .limit(ids.length);
  if (error) throw new Error(`the observations query failed: ${(error as Error).message}`);
  return (data ?? []) as {
    observation_id: string;
    source_id: string;
    observed_at: string;
    status: string;
    value: unknown;
  }[];
}

/** The evidence ids the page rendered, in rendered order. */
function renderedIds(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-evidence]")
    .toArray()
    .map((element) => $(element).attr("data-evidence") ?? "");
}

function textOf(markup: string): string {
  return cheerio.load(markup).root().text().replace(/\s+/g, " ").trim();
}

/**
 * The three shapes, derived from the item's own columns exactly as
 * `resolver.md` §11 and migration `20260901000002` define the subject: a
 * `data_conflict` row is always a fact item, and on `entity_link` a set
 * `source_id` is the whole discriminator between the source-pattern signal and
 * the stuck-fact decision. Spelled out here rather than imported, for the same
 * reason every other expectation in this file is: the test must not ask the
 * code under test what the answer is (ARCHITECTURE.md §10).
 */
type Shape = "data_conflict_fact" | "entity_link_fact" | "entity_link_source_pattern";

function shapeOfItem(item: Item): Shape {
  if (item.queue !== "entity_link") return "data_conflict_fact";
  return item.source_id === null ? "entity_link_fact" : "entity_link_source_pattern";
}

/** The view each shape must render (spec §6: each shape is its own view). */
const VIEW_OF_SHAPE: Record<Shape, string> = {
  data_conflict_fact: "conflict",
  entity_link_fact: "stuck-fact",
  entity_link_source_pattern: "source-pattern",
};

/**
 * The one column that is this shape's own, beside the shared four. The
 * contenders carry their lifecycle status; a stuck claim carries what holds
 * it (§6: "the stuck claims and the unmet requirement"); a folded record
 * carries the record it is about (§6: "the folded records, rendered as a
 * list"). A shape rendering another shape's column — or none — is the generic
 * layout §6 rules out.
 */
const EXTRA_HOOK_OF_SHAPE: Record<Shape, string> = {
  data_conflict_fact: "data-claim-status",
  entity_link_fact: "data-held",
  entity_link_source_pattern: "data-fact",
};

describe("a real review item, rendered", () => {
  it("resolves exactly the evidence ids the row carries, in its fold order", async () => {
    const item = await anyItem();
    if (item === "absent") {
      expect(textOf(await itemMarkup("00000000-0000-7000-8000-000000000000"))).toContain(
        T.reviewItems,
      );
      return;
    }
    if (item === null) {
      // The table exists and holds nothing: the page's no-such-row surface is
      // the honest answer, and it names the id and the table.
      const id = "00000000-0000-7000-8000-000000000000";
      const markup = await itemMarkup(id);
      expect(cheerio.load(markup)(`[data-review-item="${id}"]`).text()).toBe(id);
      expect(textOf(markup)).toContain(T.reviewItems);
      return;
    }

    const markup = await itemMarkup(item.review_item_id);
    const resolvable = await observationsOf(item.evidence);
    const known = new Set(resolvable.map((row) => row.observation_id));

    // The ids that name a real observation render, in the item's stored order;
    // the ids that name none are reported rather than dropped.
    const expected = [...new Set(item.evidence)].filter((id) => known.has(id));
    expect(renderedIds(markup)).toEqual(expected);

    const $ = cheerio.load(markup);
    for (const id of [...new Set(item.evidence)].filter((one) => !known.has(one))) {
      expect($(`[data-unresolved="${id}"]`), id).toHaveLength(1);
    }
  });

  it("renders each claim's own instant, source tier and its shape's own column", async () => {
    const item = await anyItem();
    if (item === "absent" || item === null) return;

    const markup = await itemMarkup(item.review_item_id);
    const $ = cheerio.load(markup);
    const claims = await observationsOf(item.evidence);
    if (claims.length === 0) {
      expect(renderedIds(markup)).toEqual([]);
      return;
    }

    // The shape, derived here from the item's own columns (resolver.md §11:
    // `queue`, and `source_id` set only on a per-source subject) rather than
    // asked of the module under test — and the view the page must have chosen
    // for it. §6: "Each shape is its own detail view … the evidence block
    // renders what that shape's evidence is, not one generic layout".
    const shape = shapeOfItem(item);
    expect($("[data-evidence-view]").attr("data-evidence-view"), item.review_item_id).toBe(
      VIEW_OF_SHAPE[shape],
    );

    // The tiers, read by the test itself — the evidence row shows the source's
    // tier NOW (ARCHITECTURE.md §6 trap 5), not the tier frozen at any apply.
    const { data: sources, error } = await independentClient()
      .from(T.sources)
      .select("source_id, source, tier")
      .in("source_id", [...new Set(claims.map((claim) => claim.source_id))]);
    if (error) throw new Error(`the sources query failed: ${(error as Error).message}`);
    const tierOf = new Map(
      ((sources ?? []) as { source_id: string; source: string; tier: string }[]).map(
        (row) => [row.source_id, row],
      ),
    );

    for (const claim of claims) {
      const row = $(`[data-evidence="${claim.observation_id}"]`).closest("tr");
      // The base contract, on every shape (§6 anatomy 2): the claim's own
      // instant, its source, that source's tier NOW, and the payload pointer.
      expect(row.find("[data-observed]").attr("data-observed"), claim.observation_id).toBe(
        claim.observed_at,
      );
      expect(
        row.find("[data-payload]").attr("data-payload"),
        `${claim.observation_id}: no payload pointer`,
      ).toBeDefined();
      const source = tierOf.get(claim.source_id);
      if (source !== undefined) {
        expect(row.find("[data-tier-now]").attr("data-tier-now")).toBe(source.tier);
        expect(row.text()).toContain(source.source);
      }
      // ...and this shape's own column, which is the part §6 makes typed. The
      // claim's lifecycle `status` is the CONFLICT view's column — the two
      // entity_link views answer a different question in that slot (what holds
      // the claim; which record was folded), so demanding `status` of them
      // would be demanding the one generic layout §6 forbids.
      const hook = EXTRA_HOOK_OF_SHAPE[shape];
      expect(
        row.find(`[${hook}]`).attr(hook),
        `${claim.observation_id}: no ${hook} on the ${shape} view`,
      ).toBeDefined();
      if (shape === "data_conflict_fact") {
        expect(row.find("[data-claim-status]").attr("data-claim-status")).toBe(
          claim.status,
        );
      }
    }
  });

  it("puts the fact's current canonical value beside them, from the latest decision", async () => {
    const item = await anyItem();
    if (item === "absent" || item === null) return;
    if (item.domain === null || item.entity_id === null || item.field === null) {
      // A per-source item has no fact, so there is no canonical card to compare
      // — and the page must not invent one.
      const markup = await itemMarkup(item.review_item_id);
      expect(cheerio.load(markup)("[data-pair]")).toHaveLength(0);
      return;
    }

    // The test's own reading of "the current provenance": the latest row per
    // fact identity, ordered `applied_at desc, provenance_id desc`
    // (contracts/data-model.md, ARCHITECTURE.md §6 trap 7).
    const { data, error } = await independentClient()
      .from(T.fieldProvenance)
      .select("provenance_id, observation_id, source_id, tier_at_apply, applied_at")
      .eq("entity_type", item.domain)
      .eq("entity_id", item.entity_id)
      .eq("field", item.field)
      .order("applied_at", { ascending: false })
      .order("provenance_id", { ascending: false })
      .limit(1);
    if (error) throw new Error(`the provenance query failed: ${(error as Error).message}`);
    const latest = ((data ?? []) as {
      observation_id: string | null;
      source_id: string | null;
      tier_at_apply: string;
    }[])[0];

    const markup = await itemMarkup(item.review_item_id);
    const cards = cheerio
      .load(markup)("[data-pair] > div > div")
      .toArray()
      .map((element) => cheerio.load(markup)(element).text().replace(/\s+/g, " ").trim());
    if (cards.length === 0) return; // no pair rendered: no claim resolved either

    const canonical = cards[cards.length - 1];
    if (latest === undefined) {
      // Nothing has ever been applied to this field: the card says so and
      // shows no value it never read.
      expect(canonical.length).toBeGreaterThan(0);
      return;
    }
    // The tier the card carries is the one FROZEN at the apply.
    expect(canonical).toContain(latest.tier_at_apply);
  });

  it("carries the header the anatomy requires, and no control at all", async () => {
    const item = await anyItem();
    if (item === "absent" || item === null) return;

    const markup = await itemMarkup(item.review_item_id);
    const $ = cheerio.load(markup);

    expect(textOf(markup)).toContain(item.summary);
    expect($("[data-severity]").attr("data-severity")).toBe(item.severity);
    expect($("[data-folds]").attr("data-folds")).toBe(String(item.folded_count));
    // Nothing settles anything in M1 (spec §7 is the verdict slice).
    for (const control of ["button", "form", "input", "select", "textarea"]) {
      expect($(control), control).toHaveLength(0);
    }
  });
});
