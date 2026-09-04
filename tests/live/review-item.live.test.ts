import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import ReviewItemPage from "@/app/queues/[reviewItemId]/page";
import { T } from "@/lib/db/tables";
import {
  assertState,
  gradeSurface,
  independentClient,
  pageStates,
  renderPage,
} from "./parity";

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
 * **The STATE KIND is named structurally, never from prose** (ARCHITECTURE.md
 * §10, common violation 6; oracle rewritten by admin-window/TASK-0032). Where
 * staging carries no `review_items` at all, this test's own read gets the
 * absence code and the page must render `not_provisioned`; where the table
 * answers and holds no such row, the page must render `empty` — the two draw
 * the same container and differ only in their words, so `data-state` is what
 * separates them. An `error` fails.
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

/** An id no row can carry — for the two states that are about a missing row. */
const NO_SUCH_ID = "00000000-0000-7000-8000-000000000000";

/**
 * The evidence surface: the body of the second section, which is the
 * `Section`'s first child after its heading — the shape's evidence view, or
 * the state card that replaced it
 * (`src/app/queues/[reviewItemId]/page.tsx`). Structural; no heading text is
 * read.
 *
 * Deliberately NOT the whole section: the section also carries the separate
 * legs this page reports beside the evidence — the bucket read and the source
 * registry — each of which has its own state and its own object. Grading them
 * as one surface makes an unreadable bucket look like unreadable evidence, and
 * on staging today it does exactly that (`pending_claims` times out —
 * admin-window/TASK-0031 — while the claims themselves render fine).
 */
const EVIDENCE = "section:nth-of-type(2) > :nth-child(2)";

/**
 * The dial embedded in a source-pattern evidence view is its OWN read of
 * `pending_claims`, with its own state — and on staging today it is in its
 * error state, because that view times out (admin-window/TASK-0031). Its
 * failure is not the evidence's failure: the claims below it render fine, and
 * this file compares claims. Excluded by name rather than silently.
 */
const DIAL = "[data-dial]";

/** The page as the URL renders it. Every read happens per request. */
function itemMarkup(id: string): Promise<string> {
  return renderPage(ReviewItemPage, { params: Promise.resolve({ reviewItemId: id }) });
}

/**
 * Grade the evidence surface against the ids the ITEM carries: an item with no
 * evidence renders the empty state, one with evidence renders rows, and a
 * refused read fails naming what it was reading.
 */
async function gradeEvidence(markup: string, item: Item) {
  return gradeSurface({
    markup,
    within: EVIDENCE,
    object: T.observations,
    counted: (await observationsOf(item.evidence)).length,
    excluding: DIAL,
  });
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
      // This test's own read got the absence code, so the page must say the
      // table is not provisioned — the gray card, not the red line and not the
      // empty one (rule 5).
      const markup = await itemMarkup(NO_SUCH_ID);
      expect(pageStates(markup)).toEqual(["not_provisioned"]);
      expect(textOf(markup)).toContain(T.reviewItems);
      return;
    }
    if (item === null) {
      // The table exists and holds nothing: the page's no-such-row surface is
      // an EMPTY state — a read that answered — and it names the id.
      const markup = await itemMarkup(NO_SUCH_ID);
      expect(pageStates(markup)).toEqual(["empty"]);
      expect(cheerio.load(markup)(`[data-review-item="${NO_SUCH_ID}"]`).text()).toBe(
        NO_SUCH_ID,
      );
      return;
    }

    const markup = await itemMarkup(item.review_item_id);
    // The evidence surface answered, or nothing below it means anything.
    await gradeEvidence(markup, item);
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
    if ((await gradeEvidence(markup, item)) !== "ok") {
      // An item whose evidence resolves to nothing renders the empty state,
      // asserted above; there is no claim row to compare.
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
      await gradeEvidence(markup, item);
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
    // "What happened" is its own read of the same row: it renders the header
    // or it renders a state card, and this case is about the header.
    assertState(markup, "section:nth-of-type(1)", "ok");
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

/**
 * admin-window/BUG-0043 — the live oracle for the two header links.
 *
 * A source-pattern item's header carries `Its claims` and `Its source`, both
 * narrowed by the item's `source_id`, and both printed that uuid while the
 * evidence cells directly below — pointing at the SAME href — read the
 * source's name. One page, one destination, two labels; a document-blind
 * user-sim stopped on it to check whether one of them was wrong.
 *
 * Only staging can answer whether the ids this table carries resolve to
 * registry rows at all, so the expectation is read here, from `sources`,
 * independently of `lib/db/review-item.ts`.
 */
describe("the header names its source, against staging", () => {
  /** An item whose subject IS a source — the only shape with these links. */
  async function sourcePatternItem(): Promise<Item | null | "absent"> {
    const { data, error } = await independentClient()
      .from(T.reviewItems)
      .select(
        "review_item_id, queue, source_id, domain, entity_id, field, summary, severity, folded_count, evidence",
      )
      .not("source_id", "is", null)
      .order("last_evidence_at", { ascending: false })
      .order("review_item_id", { ascending: true })
      .limit(1);
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      if (code === "PGRST205" || code === "42P01") return "absent";
      throw new Error(`the source-pattern query failed: ${(error as Error).message}`);
    }
    return ((data ?? []) as Item[])[0] ?? null;
  }

  it("says the name the registry holds, in both links and in the cells below", async () => {
    const item = await sourcePatternItem();
    if (item === "absent" || item === null) return;
    const sourceId = item.source_id as string;

    // This test's own registry read — the expectation, not the app's.
    const { data, error } = await independentClient()
      .from(T.sources)
      .select("source_id, source")
      .eq("source_id", sourceId);
    if (error) {
      throw new Error(`this test could not read ${T.sources}: ${JSON.stringify(error)}`);
    }
    const registered = ((data ?? []) as { source: string }[])[0]?.source ?? null;

    const markup = await itemMarkup(item.review_item_id);
    assertState(markup, "section:nth-of-type(1)", "ok");
    const $ = cheerio.load(markup);

    const toSource = `/sources?source_id=${sourceId}`;
    const expected = registered ?? sourceId;
    for (const href of [toSource, `/claims?source_id=${sourceId}`]) {
      const link = $(`a[data-out="${href}"]`);
      expect(link, href).toHaveLength(1);
      expect(link.text().trim(), href).toContain(expected);
      expect(link.attr("href"), href).toBe(href);
      if (registered !== null) {
        // A registered source is NAMED: the uuid is where it goes, not what
        // it says.
        expect(link.text(), href).not.toContain(sourceId);
      }
    }

    // The evidence cells that point at the same destination say the same
    // word — the self-contradiction this ticket is about was on one screen.
    const cells = $(`a[data-claim-source][href="${toSource}"]`)
      .toArray()
      .map((element) => $(element).text().trim());
    for (const said of cells) expect(said).toBe(expected);
  });
});
