import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import ReviewItemPage from "@/app/queues/[reviewItemId]/page";
import { T } from "@/lib/db/tables";
import {
  assertState,
  gradeSurface,
  independentClient,
  objectIsAbsent,
  oneEach,
  pageStates,
  renderPage,
  stateOf,
  surfaceHooks,
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
  /** `open` or `settled` — which of the close's two shapes this item is in. */
  status: string;
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
 * The page's two graded surfaces, each named by the `data-surface` hook
 * `src/app/queues/[reviewItemId]/page.tsx` gives it: the item header, and the
 * evidence body — the shape's evidence view, or the state card that replaced
 * it. Structural; no heading text is read.
 *
 * NAMES, not positions. These were `section:nth-of-type(1)` and
 * `section:nth-of-type(2) > :nth-child(2)` until admin-window/DEBT-0002, the
 * second compounding the page's section ORDER with the body's position among
 * its section's own children — so the parked recommendation slot filling in,
 * or one more leg note, repoints it at something that is not the evidence.
 * `stateOf` (`tests/live/parity.ts`) demands the selector match EXACTLY ONE
 * element; on `/cycles` this class threw `MarkupReadError` in four live tests
 * (admin-window/BUG-0040, admin-window/BUG-0056).
 *
 * `EVIDENCE` is deliberately NOT the whole section: the section also carries
 * the separate legs this page reports beside the evidence — the bucket read
 * and the source registry — each of which has its own state and its own
 * object. Grading them as one surface makes an unreadable bucket look like
 * unreadable evidence, and on staging today it does exactly that
 * (`pending_claims` times out — admin-window/TASK-0031 — while the claims
 * themselves render fine).
 */
const HEADER = '[data-surface="what_happened"]';
const EVIDENCE = '[data-surface="evidence"]';
/**
 * The close (campaign admin-window/TASK-0049, spec §7). Its state is a
 * different read's — the settlement readiness, which asks whether the verdict
 * log is in this database at all — so it is graded on its own and is
 * deliberately not part of `SURFACES` below, whose two hooks the M1 oracles
 * address.
 */
const CLOSE = '[data-surface="close"]';
/**
 * The verdict a SETTLED item was settled with — a sub-surface INSIDE the close
 * (campaign admin-window/TASK-0059, spec F13's second half).
 *
 * Its state is a THIRD read's (`readItemVerdict`), so it is excluded wherever
 * the close is graded, exactly as `DIAL` below is excluded from the evidence:
 * an item settled with no row on record is a gap in the log's data, not a
 * close that failed, and folding the two together would make one look like
 * the other. On staging today it never renders at all — the one real item is
 * open and the log's table is absent — and that absence is asserted from THIS
 * test's own reads of both facts, never inferred from an empty page.
 */
const ITEM_VERDICT = '[data-surface="item_verdict"]';

/** The columns every query in this file reads off an item, spelled once. */
const ITEM_COLUMNS =
  "review_item_id, queue, status, source_id, domain, entity_id, field, summary, severity, folded_count, evidence" as const;

/**
 * Both hooks, asserted present and UNIQUE before either is graded — so the
 * next rearrangement of this page fails as one legible assertion here rather
 * than as a `MarkupReadError` from whichever case happened to run first.
 */
const SURFACES = [HEADER, EVIDENCE];

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
      ITEM_COLUMNS,
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

/**
 * An item whose subject IS a source — the `entity_link` source-pattern SIGNAL,
 * which is the one shape staging actually holds and the only one with the two
 * header links. Module-level so the close's oracle and the header's read the
 * same row through one query rather than two copies of it.
 */
async function sourcePatternItem(): Promise<Item | null | "absent"> {
  const { data, error } = await independentClient()
    .from(T.reviewItems)
    .select(
      ITEM_COLUMNS,
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

/**
 * An item this database has already SETTLED — the one shape whose detail
 * carries a verdict inline (campaign admin-window/TASK-0059).
 *
 * `null` means the table answered and holds no settled item, which is staging
 * today and is a state rather than a failure: no verdict block can render, and
 * the oracle below says so instead of asserting against nothing.
 */
async function settledItem(): Promise<Item | null | "absent"> {
  const { data, error } = await independentClient()
    .from(T.reviewItems)
    .select(ITEM_COLUMNS)
    .eq("status", "settled")
    .order("last_evidence_at", { ascending: false })
    .order("review_item_id", { ascending: true })
    .limit(1);
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "PGRST205" || code === "42P01") return "absent";
    throw new Error(`the settled-item query failed: ${(error as Error).message}`);
  }
  return ((data ?? []) as Item[])[0] ?? null;
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

describe("the review item's surface hooks against staging", () => {
  it("names each graded surface once on an item that rendered", async () => {
    const item = await anyItem();
    if (item === "absent" || item === null) return;

    // The oracle's addressing itself, asserted before it is used: each hook
    // has to reach exactly one element, which is the precondition `stateOf`
    // enforces per call (admin-window/DEBT-0002).
    // `nested` empty is the disjointness: grading the evidence never reads the
    // header's state, and neither swallows the other.
    expect(surfaceHooks(await itemMarkup(item.review_item_id), SURFACES)).toEqual({
      counts: oneEach(SURFACES),
      nested: [],
    });
  });

  it("renders no surface at all for an id no row carries", async () => {
    // The two whole-page refusals return before any `<Section>`, so the hooks
    // are absent rather than duplicated — stated as a number, because "the
    // selector matched nothing" is exactly what `stateOf` throws on, and a
    // future ticket must not resurrect them here by accident.
    expect(surfaceHooks(await itemMarkup(NO_SUCH_ID), SURFACES)).toEqual({
      counts: { [HEADER]: 0, [EVIDENCE]: 0 },
      nested: [],
    });
  });
});

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
    assertState(markup, HEADER, "ok");
    const $ = cheerio.load(markup);

    expect(textOf(markup)).toContain(item.summary);
    expect($("[data-severity]").attr("data-severity")).toBe(item.severity);
    expect($("[data-folds]").attr("data-folds")).toBe(String(item.folded_count));
    // The close is the only part of this page that may ever carry a control,
    // and only where its own read answered. While the verdict log is absent —
    // staging today, and `main`'s deploy target for the whole of M2 — the page
    // offers none at all, which is exactly what M1 shipped. Read from the
    // database rather than assumed, so installing the log does not turn a
    // correct page red (campaign admin-window/TASK-0049).
    if (await objectIsAbsent(T.verdicts)) {
      for (const control of ["button", "form", "input", "select", "textarea"]) {
        expect($(control), control).toHaveLength(0);
      }
    }
  });
});

/**
 * The close, against staging (campaign admin-window/TASK-0049, spec §7,
 * ARCHITECTURE.md §9.2).
 *
 * **The absent answer is the graded-first one**: the verdict log is not in
 * this database and will not be until Ben installs M2's handoff migrations, so
 * the slot must draw the not-provisioned card naming that object and offer no
 * control. The state kind is read STRUCTURALLY from `data-state` (rule 5,
 * common violation 6) and the absence is established by this test's OWN read
 * of the same object — never inferred from the words on the card, and never
 * from "no control rendered".
 *
 * The ready branch is written out too, so the day the migration lands this
 * oracle grades that state instead of going quiet: an `error` fails either
 * way, which is the one thing this page may never be in.
 */
describe("the close against staging", () => {
  it("offers no control while the verdict log is absent, and names it", async () => {
    const item = await anyItem();
    if (item === "absent" || item === null) return;

    const markup = await itemMarkup(item.review_item_id);
    const $ = cheerio.load(markup);

    // The oracle's own addressing: one close, exactly one.
    expect(surfaceHooks(markup, [CLOSE])).toEqual({
      counts: oneEach([CLOSE]),
      nested: [],
    });

    if (await objectIsAbsent(T.verdicts)) {
      assertState(markup, CLOSE, "not_provisioned");
      // Named in the spelling the query used, and said as an absence: gray,
      // never the red line (rule 5).
      expect($(CLOSE).text()).toContain(T.verdicts);
      expect($(CLOSE).find('[role="alert"]')).toHaveLength(0);
      for (const control of ["button", "form", "input", "select", "textarea"]) {
        expect($(CLOSE).find(control), control).toHaveLength(0);
      }
      return;
    }

    // Installed: the read answered, so the slot is in its ok state and the
    // note field stands. A settle control only exists once a shape's own
    // ticket fills its action list. The verdict sub-surface is excluded: a
    // settled item with no row on record is that BLOCK's emptiness, and
    // grading it as the close's would report it as a close that failed
    // (campaign admin-window/TASK-0059).
    expect(stateOf(markup, CLOSE, ITEM_VERDICT)).toBe("ok");
    expect($(CLOSE).find("[data-close-note]")).toHaveLength(1);
  });

  it("grades the signal item's page: not_provisioned in the close, the rest of it not", async () => {
    // The one shape staging really holds, and the one whose two dispositions
    // M2 fills (campaign admin-window/TASK-0051). The STATE KIND is named
    // before any number is compared, and the absence is established by THIS
    // test's own read of the object — never inferred from "no control
    // rendered" (ARCHITECTURE.md §10, rule 5).
    const item = await sourcePatternItem();
    if (item === "absent" || item === null) return;
    expect(shapeOfItem(item)).toBe("entity_link_source_pattern");

    const markup = await itemMarkup(item.review_item_id);
    const $ = cheerio.load(markup);

    // The header read answered: the close's state is the CLOSE's own read and
    // never leaks upward into the anatomy M1 shipped.
    assertState(markup, HEADER, "ok");
    // The evidence surface is graded against the ids this item carries, so a
    // signal with nothing resolvable is `empty` rather than a failure — and an
    // `error` is a failure either way.
    await gradeEvidence(markup, item);

    if (await objectIsAbsent(T.verdicts)) {
      assertState(markup, CLOSE, "not_provisioned");
      expect($(CLOSE).text()).toContain(T.verdicts);
      // Neither disposition is offered, because the object that records one
      // is not in this database (spec §10: no control calls a missing
      // function, and nothing queues the write).
      expect($(CLOSE).find("[data-close-action]")).toHaveLength(0);
      // And the anatomy above it still says what M1 said.
      expect(textOf(markup)).toContain(item.summary);
      expect($("[data-severity]").attr("data-severity")).toBe(item.severity);
      expect($("[data-folds]").attr("data-folds")).toBe(String(item.folded_count));
      return;
    }

    // Installed: this shape's close offers exactly its two dispositions, in
    // spec §7's order, with both machine names verbatim (§11). Graded with
    // the verdict sub-surface excluded, for the reason above.
    expect(stateOf(markup, CLOSE, ITEM_VERDICT)).toBe("ok");
    expect(
      $(CLOSE)
        .find("[data-close-action]")
        .toArray()
        .map((element) => $(element).attr("data-close-action")),
    ).toEqual(["fixed", "wont_fix"]);
  });

  it("never settles anything by rendering the page", async () => {
    const item = await anyItem();
    if (item === "absent" || item === null) return;

    // The page is a READ. Rendering it must not change the item's status —
    // the one call that settles is behind the POST route, which nothing here
    // touches (spec §7's one entry point). Read by this test, before and
    // after, rather than trusted from the render.
    const statusNow = async (): Promise<string | null> => {
      const { data, error } = await independentClient()
        .from(T.reviewItems)
        .select("status")
        .eq("review_item_id", item.review_item_id)
        .maybeSingle();
      if (error) throw new Error(`the status read failed: ${(error as Error).message}`);
      return (data as { status: string } | null)?.status ?? null;
    };

    const before = await statusNow();
    await itemMarkup(item.review_item_id);
    expect(await statusNow()).toBe(before);
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
    assertState(markup, HEADER, "ok");
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

/**
 * The inline verdict, against staging (campaign admin-window/TASK-0059, spec
 * F13's second half).
 *
 * **The state kind is named before anything is compared** (ARCHITECTURE.md
 * §10, rule 5, common violation 6), and it is named from THIS test's own
 * reads of the two facts that decide it: whether the log's table is in this
 * database at all, and whether the item is settled. Neither is inferred from
 * what the page rendered, and neither is read off the page's prose.
 *
 * Staging today answers both the same way it has all milestone: the log's
 * table is absent and the one real item is open, so the block renders nowhere
 * and the close draws its one not-provisioned card. The installed branches are
 * written out anyway, so the day Ben installs M2's handoff migration this
 * oracle grades that state instead of going quiet.
 */
describe("a settled item's verdict, against staging", () => {
  it("renders no verdict block on an item this database has not settled", async () => {
    const item = await anyItem();
    if (item === "absent" || item === null) return;
    if (item.status === "settled") return; // graded by the case below

    const markup = await itemMarkup(item.review_item_id);
    // An OPEN item was settled by nothing, so there is no verdict and no
    // block — never an empty one, which is the "renders X but not the absence
    // of X" defect from the other side (LESSONS 1).
    expect(
      surfaceHooks(markup, [ITEM_VERDICT]),
      `${item.review_item_id} is ${item.status}`,
    ).toEqual({ counts: { [ITEM_VERDICT]: 0 }, nested: [] });
    expect(cheerio.load(markup)("[data-verdict-action]")).toHaveLength(0);
    // And the close is still exactly the state its own read put it in.
    assertState(
      markup,
      CLOSE,
      (await objectIsAbsent(T.verdicts)) ? "not_provisioned" : "ok",
    );
  });

  it("carries the row the log holds for a settled item, or says the gap", async () => {
    const item = await settledItem();
    if (item === "absent" || item === null) return;
    expect(item.status).toBe("settled");

    const markup = await itemMarkup(item.review_item_id);
    const $ = cheerio.load(markup);

    if (await objectIsAbsent(T.verdicts)) {
      // The log is not in this database: the close draws the one card naming
      // that object, and no verdict block is rendered beside it.
      assertState(markup, CLOSE, "not_provisioned");
      expect($(CLOSE).text()).toContain(T.verdicts);
      expect($(ITEM_VERDICT)).toHaveLength(0);
      return;
    }

    // Installed. The block is a surface of its own and exactly one of it.
    expect(surfaceHooks(markup, [ITEM_VERDICT])).toEqual({
      counts: oneEach([ITEM_VERDICT]),
      nested: [],
    });
    // The close is in the state its OWN read put it in, whatever the block is.
    expect(stateOf(markup, CLOSE, ITEM_VERDICT)).toBe("ok");

    // The expectation, read by this test rather than asked of `lib/db`
    // (ARCHITECTURE.md §10): the newest verdict this log holds for the item.
    const { data, error } = await independentClient()
      .from(T.verdicts)
      .select("verdict_id, actor, action, observation_id, note, created_at")
      .eq("review_item_id", item.review_item_id)
      .order("created_at", { ascending: false })
      .order("verdict_id", { ascending: false })
      .limit(1);
    if (error) throw new Error(`the verdict query failed: ${(error as Error).message}`);
    const held = ((data ?? []) as {
      actor: string;
      action: string;
      observation_id: string | null;
      note: string | null;
      created_at: string;
    }[])[0];

    if (held === undefined) {
      // The table is there and holds no row for this settled item: a gap in
      // the DATA, which is a different state from the absent object and draws
      // a different card. Read structurally, never from the words on it.
      expect(stateOf(markup, ITEM_VERDICT)).toBe("empty");
      expect($(ITEM_VERDICT).text()).not.toContain(T.verdicts);
      return;
    }

    expect(stateOf(markup, ITEM_VERDICT)).toBe("ok");
    // The machine's own name, verbatim — never prettified (§11, LESSONS 5).
    expect($("[data-verdict-action]").attr("data-verdict-action")).toBe(held.action);
    expect($("[data-verdict-action]").text().trim()).toBe(held.action);
    expect($("[data-verdict-when]").attr("data-verdict-when")).toBe(held.created_at);

    // Each nullable column is rendered or dashed, and never blank: the hook
    // stands exactly where the row carries a value.
    expect($("[data-verdict-actor]")).toHaveLength(
      held.actor.trim() === "" ? 0 : 1,
    );
    expect($("[data-verdict-note]")).toHaveLength(
      held.note === null || held.note.trim() === "" ? 0 : 1,
    );
    expect($("[data-verdict-observation]")).toHaveLength(
      held.observation_id === null ? 0 : 1,
    );
    if (held.observation_id !== null) {
      // The id is the verdict's own, rendered verbatim whether or not this app
      // could resolve where it leads.
      expect($("[data-verdict-observation]").text().trim()).toBe(held.observation_id);
    }
  });
});
