import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { render } from "../ui/markup";
import {
  ID,
  fieldProvenanceRow,
  observationRow,
  pendingClaimRow,
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemSourcePattern,
  sourceRow,
  type ObservationRow,
} from "../../fixtures/rows";
import {
  invalidUuidSyntax,
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
} from "../../fixtures/stub-client";
import { oneEach, stateOf, surfaceHooks } from "../../live/parity";

/**
 * The review-item detail page, rendered (campaign admin-window/TASK-0011).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await ReviewItemPage(props))` — no jsdom, no Testing
 * Library, no database. Every read is stubbed at its module boundary, so all
 * four data-surface states are reachable offline.
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which evidence ids render, in which
 * order, in which card, under which view, and where the links go — plus the
 * MACHINE's own strings where rendering them verbatim is the requirement (a
 * claim's value, a source's name, a tier, a status, the missing table, the
 * database's own error message). No class name, no copy of the app's own
 * words and no column header is pinned.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/review-item", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/review-item")>();
  return {
    ...actual,
    readReviewItem: (id: string) =>
      actual.readReviewItem(id, readWith.client as never),
    readItemEvidence: (item: unknown) =>
      actual.readItemEvidence(item as never, readWith.client as never),
  };
});

vi.mock("@/lib/db/claims", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/claims")>();
  return {
    ...actual,
    readPendingClaims: (ids: readonly string[]) =>
      actual.readPendingClaims(ids, readWith.client as never),
  };
});

vi.mock("@/lib/gauges/pending-claims", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/gauges/pending-claims")>();
  return {
    ...actual,
    readAwaitingRowTrend: (options?: unknown) =>
      actual.readAwaitingRowTrend((options ?? {}) as never, readWith.client as never),
  };
});

const pageModule = await import("@/app/queues/[reviewItemId]/page");
const ReviewItemPage = pageModule.default;

/* ── the population ──────────────────────────────────────────────────────── */

/** The two contending claims of the `data_conflict` fixture, in fold order. */
const CLAIM_A = observationRow();
const CLAIM_B = observationRow({
  observation_id: ID.observationB,
  source_id: ID.sourceBandsintown,
  value: "TWICE World Tour",
  status: "pending",
  observed_at: "2026-08-31T23:30:00Z",
  payload_ref: "bandsintown/2026-08-31/forum.json",
});

const TICKETMASTER = sourceRow();
const BANDSINTOWN = sourceRow({
  source_id: ID.sourceBandsintown,
  source: "bandsintown",
  tier: "standard",
});

/**
 * The applied decision. `tier_at_apply` is deliberately DIFFERENT from the
 * winning source's current tier (`official`): the two tiers are different
 * facts (ARCHITECTURE.md §6 trap 5) and a page that showed one for the other
 * would still pass a test where they agreed.
 */
const DECISION = fieldProvenanceRow({ tier_at_apply: "trusted" });

async function renderItem(script: Script, id: string): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await ReviewItemPage({ params: Promise.resolve({ reviewItemId: id }) }));
}

/** A healthy script for the `data_conflict` item: both claims, the decision. */
function conflictScript(overrides: Script = {}): Script {
  const item = reviewItemDataConflict();
  return {
    [T.reviewItems]: { data: item },
    [T.observations]: { data: [CLAIM_A, CLAIM_B] },
    [T.fieldProvenance]: { data: [DECISION], count: 1 },
    [T.sources]: { data: [TICKETMASTER, BANDSINTOWN] },
    [T.pendingClaims]: { data: [] },
    ...overrides,
  };
}

/** The `entity_link` fact item: one stuck claim, no canonical row, a bucket. */
function stuckScript(overrides: Script = {}): Script {
  const item = reviewItemEntityLink();
  return {
    [T.reviewItems]: { data: item },
    [T.observations]: { data: [CLAIM_B] },
    [T.sources]: { data: [BANDSINTOWN] },
    [T.pendingClaims]: {
      data: [
        pendingClaimRow("awaiting_row", {
          observation_id: ID.observationB,
          source_id: ID.sourceBandsintown,
          unmet_requirement: "at least one linked performer",
        }),
      ],
    },
    ...overrides,
  };
}

/**
 * The source-pattern item. Its `observations` reads happen twice — the
 * evidence, then the dial's own windowed scan — so that table is scripted as a
 * queue.
 */
function patternScript(overrides: Script = {}): Script {
  const item = reviewItemSourcePattern();
  return {
    [T.reviewItems]: { data: item },
    [T.observations]: [{ data: [CLAIM_B] }, { data: [] }],
    [T.sources]: { data: [BANDSINTOWN] },
    [T.pendingClaims]: [{ data: [] }, { data: [] }],
    ...overrides,
  };
}

/* ── the addressing the live oracle depends on ───────────────────────────── */

/**
 * The name each graded surface answers to (`data-surface`,
 * `src/app/queues/[reviewItemId]/page.tsx`), as
 * `tests/live/review-item.live.test.ts` addresses them.
 */
const HEADER_HOOK = '[data-surface="what_happened"]';
const EVIDENCE_HOOK = '[data-surface="evidence"]';
const HOOKS = [HEADER_HOOK, EVIDENCE_HOOK];

/* ── reading the markup, structurally ────────────────────────────────────── */

/** The evidence ids the page rendered, in rendered order. */
function evidenceIds(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-evidence]")
    .toArray()
    .map((element) => $(element).attr("data-evidence") ?? "");
}

/** One evidence row, as its cell hooks and its text. */
function rowOf(markup: string, id: string) {
  const $ = cheerio.load(markup);
  const row = $(`[data-evidence="${id}"]`).closest("tr");
  return {
    text: row.text().replace(/\s+/g, " ").trim(),
    tier: row.find("[data-tier-now]").attr("data-tier-now"),
    observedAt: row.find("[data-observed]").attr("data-observed"),
    status: row.find("[data-claim-status]").attr("data-claim-status"),
    payload: row.find("[data-payload]").attr("data-payload"),
    held: row.find("[data-held]").attr("data-held"),
    sourceHref: row.find("a[data-claim-source]").attr("href"),
  };
}

/** The evidence-pair cards, in rendered order — the canonical one is last. */
function pairCards(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-pair] > div > div")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim());
}

function textOf(markup: string): string {
  return cheerio.load(markup).root().text().replace(/\s+/g, " ").trim();
}

/**
 * The two figures the evidence block's accounting states, as numbers:
 * `[resolved, ids it looked at]`.
 *
 * The sentence's wording is the designer's and is not pinned — only that it
 * states an accounting at all, and that its arithmetic matches what is
 * rendered beside it (admin-window/BUG-0021). Thousands separators are the
 * app's number formatting, not part of the figure, and the noun agrees with
 * the total it follows — an item carrying one id says "1 evidence id"
 * (admin-window/BUG-0046), which this reads as readily as the plural. Only
 * the two figures are the assertion.
 */
function accountingIn(markup: string): [number, number] {
  const match = textOf(markup).match(/([\d,]+) of ([\d,]+) evidence ids? resolved/);
  expect(match, "the page accounts for the evidence ids it looked at").not.toBeNull();
  const [, resolved, total] = match as RegExpMatchArray;
  return [Number(resolved.replace(/,/g, "")), Number(total.replace(/,/g, ""))];
}

function attrsOf(markup: string, selector: string): string[] {
  const $ = cheerio.load(markup);
  return $(selector)
    .toArray()
    .map((element) => $(element).attr(selector.replace(/[[\]]/g, "")) ?? "");
}

/* ── the shared anatomy: what happened ───────────────────────────────────── */

describe("what happened", () => {
  it("carries the summary, the severity, the age and the fold count", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(conflictScript(), item.review_item_id);
    const $ = cheerio.load(markup);

    // The machine's own sentence, verbatim — it is the item.
    expect(textOf(markup)).toContain(item.summary);
    expect($("[data-severity]").attr("data-severity")).toBe(item.severity);
    expect($("[data-status]").attr("data-status")).toBe(item.status);
    expect($("[data-folds]").attr("data-folds")).toBe(String(item.folded_count));
    // The fold count is READ as a number beside the item, not just carried in
    // an attribute: "asked again ×N" (spec §6).
    expect($("[data-folds]").text()).toContain(String(item.folded_count));
    // An age is relative with the absolute in the title (Voice bar 6).
    const titles = $("[title]")
      .toArray()
      .map((element) => $(element).attr("title") ?? "");
    expect(titles.some((title) => title.includes("2026-08-30"))).toBe(true);
  });

  it("renders the id verbatim whatever the reads did", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(conflictScript(), item.review_item_id);
    expect(
      cheerio.load(markup)(`[data-review-item="${item.review_item_id}"]`).text(),
    ).toBe(item.review_item_id);
  });
});

/* ── the shared anatomy: evidence, resolved ──────────────────────────────── */

describe("every evidence id resolves to a claim", () => {
  it("renders each id as a row with its value, source, tier and instant", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(conflictScript(), item.review_item_id);

    for (const claim of [CLAIM_A, CLAIM_B]) {
      const row = rowOf(markup, claim.observation_id);
      const source = claim.source_id === ID.sourceTicketmaster ? TICKETMASTER : BANDSINTOWN;
      expect(row.text, claim.observation_id).toContain(String(claim.value));
      expect(row.text).toContain(source.source);
      // The tier of an evidence row is the SOURCE's current tier, never the
      // tier frozen at the apply (ARCHITECTURE.md §6 trap 5).
      expect(row.tier).toBe(source.tier);
      expect(row.tier).not.toBe(DECISION.tier_at_apply);
      expect(row.observedAt).toBe(claim.observed_at);
      expect(row.status).toBe(claim.status);
      expect(row.payload).toBe(claim.payload_ref);
      expect(row.sourceHref).toBe(`/sources?source_id=${source.source_id}`);
    }
  });

  it("renders them in the item's stored fold order", async () => {
    // `review_items.evidence` is a uuid[] in fold order (§6 trap 10), and the
    // fixture's order is asserted here rather than assumed sorted.
    const item = reviewItemDataConflict({
      evidence: [ID.observationB, ID.observationA],
    });
    const markup = await renderItem(
      conflictScript({ [T.reviewItems]: { data: item } }),
      item.review_item_id,
    );
    expect(evidenceIds(markup)).toEqual([ID.observationB, ID.observationA]);
  });

  it("names an id that resolves to no claim instead of dropping it", async () => {
    const missing = "01920000-0000-7000-8000-0000000009ff";
    const item = reviewItemDataConflict({ evidence: [ID.observationA, missing] });
    const markup = await renderItem(
      conflictScript({
        [T.reviewItems]: { data: item },
        [T.observations]: { data: [CLAIM_A] },
      }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([ID.observationA]);
    expect(
      cheerio.load(markup)(`[data-unresolved="${missing}"]`).text().trim(),
    ).toBe(missing);
  });

  /**
   * A REPEATED evidence id — campaign admin-window, QA attack on TASK-0011.
   *
   * `review_items.evidence` is a plain `uuid[]` with no uniqueness
   * (`20260901000002`: `evidence uuid[] default '{}' not null`) and
   * `contracts/resolver.md` §11 folds by APPENDING to it, so the same
   * observation id can sit in the array twice. `readItemEvidence` already
   * knows this — it calls `distinct()` before resolving — but the page's
   * accounting sentence divided the DEDUPLICATED claim count by the RAW array
   * length, so an item carrying [A, A, B] with every id resolving reported "2
   * of 3 evidence ids resolved to a claim" and listed no unresolved id at all.
   *
   * The assertion is behavioural, not a copy of the sentence: whatever words
   * the page uses, resolved + unresolved must account for every id it claims
   * to have looked at. Here nothing is unresolved, so the two numbers in that
   * accounting must agree.
   *
   * Was PINNED `it.fails` (strict) for admin-window/BUG-0021 and is a plain
   * `it()` again since the fix: both figures now come from the read's one
   * accounting (`ItemEvidence.ids`), so they cannot diverge.
   */
  it("accounts for every evidence id when one is repeated", async () => {
    const item = reviewItemDataConflict({
      evidence: [ID.observationA, ID.observationA, ID.observationB],
    });
    const markup = await renderItem(
      conflictScript({ [T.reviewItems]: { data: item } }),
      item.review_item_id,
    );

    // Nothing failed to resolve: both distinct ids came back.
    expect(cheerio.load(markup)("[data-unresolved]")).toHaveLength(0);

    // …so the page must not tell the operator that an id went unaccounted
    // for. Read the two figures out of its own accounting sentence.
    const accounting = textOf(markup).match(
      /(\d+) of (\d+) evidence ids resolved/,
    );
    expect(accounting, "the page states how many evidence ids resolved").not.toBeNull();
    const [, resolved, total] = accounting as RegExpMatchArray;
    expect(
      Number(total) - Number(resolved),
      `${resolved} of ${total} reported resolved, but no id is listed as unresolved`,
    ).toBe(0);
  });

  /**
   * The mixed case behind admin-window/BUG-0021: a repeat AND an id that
   * names no row, each appearing twice in `evidence`.
   *
   * Two properties, both behavioural: the unresolved list is exactly the
   * distinct ids with no claim — once each, not once per occurrence — and the
   * page's own accounting covers exactly the rows and ids it rendered. The
   * words are not pinned; the two figures are read out of whatever sentence
   * the page writes and checked against what is on screen beside it.
   */
  it("names each unresolved id once and counts it in the same accounting", async () => {
    const missing = "01920000-0000-7000-8000-0000000009ff";
    const item = reviewItemDataConflict({
      evidence: [ID.observationA, missing, ID.observationA, missing],
    });
    const markup = await renderItem(
      conflictScript({
        [T.reviewItems]: { data: item },
        [T.observations]: { data: [CLAIM_A] },
      }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([ID.observationA]);
    expect(attrsOf(markup, "[data-unresolved]")).toEqual([missing]);

    const [resolved, total] = accountingIn(markup);
    expect(resolved, "the rows on screen are what it calls resolved").toBe(
      evidenceIds(markup).length,
    );
    expect(
      total - resolved,
      "every id it says is unaccounted for is named below the sentence",
    ).toBe(attrsOf(markup, "[data-unresolved]").length);
  });

  /**
   * A hostile `payload_ref` — campaign admin-window, QA attack on TASK-0011.
   *
   * `observations.payload_ref` is scraper-written text: it is FOREIGN data on
   * a surface behind the service role (STACK.md's trust boundary), so a value
   * shaped like a `javascript:` URL must reach the operator as text and never
   * as something clickable. The pointer is rendered verbatim by design (no
   * object-storage base URL exists as a name in this app), and this pins that
   * "verbatim" never quietly becomes "linked" the day a base URL arrives.
   */
  it("renders a hostile payload pointer as text, never as a link", async () => {
    const hostile = "javascript:alert(document.domain)";
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      conflictScript({
        [T.observations]: {
          data: [observationRow({ payload_ref: hostile }), CLAIM_B],
        },
      }),
      item.review_item_id,
    );
    const $ = cheerio.load(markup);

    expect($(`[data-payload="${hostile}"]`)).toHaveLength(1);
    expect($(`[data-payload="${hostile}"]`).is("a")).toBe(false);
    for (const link of $("a[href]").toArray()) {
      expect($(link).attr("href")?.startsWith("javascript:"), "href").toBe(false);
    }
  });

  /**
   * A source-pattern item that folded FAR more records than one chunk — the
   * boundary `readRowsByIds` chunks at (`ID_CHUNK` = 100,
   * `src/lib/db/result.ts`). 200 ids is two chunks plus a remainder-free edge,
   * and every one of them must reach the folded-record list: a pattern signal
   * that showed only its first hundred records would understate the very
   * thing it exists to report.
   */
  it("renders every folded record of a large source-pattern item", async () => {
    const ids = Array.from(
      { length: 200 },
      (_, index) =>
        `01920000-0000-7000-8000-${(900000 + index).toString().padStart(12, "0")}`,
    );
    const rows = ids.map((observation_id, index) =>
      observationRow({
        observation_id,
        source_id: ID.sourceBandsintown,
        entity_id: null,
        value: `record ${index}`,
      }),
    );
    const item = reviewItemSourcePattern({ evidence: ids });
    const markup = await renderItem(
      patternScript({
        [T.reviewItems]: { data: item },
        [T.observations]: [
          { data: rows.slice(0, 100) },
          { data: rows.slice(100) },
          { data: [] },
        ],
      }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual(ids);
    expect(cheerio.load(markup)("[data-unresolved]")).toHaveLength(0);
  });

  it("renders an honest empty block when NO id resolves", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      conflictScript({ [T.observations]: { data: [] } }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([]);
    // Both ids are named, and the surface says it holds nothing — it does not
    // throw and it does not render an empty table.
    for (const id of item.evidence) {
      expect(cheerio.load(markup)(`[data-unresolved="${id}"]`)).toHaveLength(1);
    }
    expect(cheerio.load(markup)("table tbody tr")).toHaveLength(0);
  });

  /**
   * The pure-repeat case: an id that folded in three times and nothing else
   * (admin-window/BUG-0021, QA re-attack). The read deduplicates before it
   * resolves, so one claim renders — and the accounting must be stated over
   * the ids the read looked at, not over the array's length. Behavioural:
   * whatever words the page uses, the numerator is the rows on screen and the
   * denominator is those rows plus the ids named unresolved.
   */
  it("counts a claim once however many times it folded in", async () => {
    const item = reviewItemDataConflict({
      evidence: [ID.observationA, ID.observationA, ID.observationA],
    });
    const markup = await renderItem(
      conflictScript({
        [T.reviewItems]: { data: item },
        [T.observations]: { data: [CLAIM_A] },
      }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([ID.observationA]);
    expect(attrsOf(markup, "[data-unresolved]")).toEqual([]);
    expect(accountingIn(markup)).toEqual([1, 1]);
  });

  /**
   * An item carrying an EMPTY `evidence` array — the column's own default
   * (`evidence uuid[] default '{}' not null`, migration 20260901000002), so
   * every item is this before its first fold. The block must render its empty
   * state and the accounting must still be arithmetically true rather than
   * absent or invented.
   */
  it("accounts for an item that carries no evidence id at all", async () => {
    const item = reviewItemDataConflict({ evidence: [] });
    const markup = await renderItem(
      conflictScript({
        [T.reviewItems]: { data: item },
        // The evidence read asks for nothing; the winner is still resolved.
        [T.observations]: [{ data: [] }, { data: [CLAIM_A] }],
      }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([]);
    expect(attrsOf(markup, "[data-unresolved]")).toEqual([]);
    expect(accountingIn(markup)).toEqual([0, 0]);
  });

  /**
   * Deduplication happens BEFORE the id list is chunked — the seam between
   * admin-window/BUG-0021's accounting and `readRowsByIds`' `ID_CHUNK` = 100
   * (`src/lib/db/result.ts`). 250 stored ids deduplicating to 150 is two
   * chunks of the distinct list, not three of the raw one: an implementation
   * that chunked first would send a third request and lose rows to it, and
   * the accounting would stop matching what is on screen.
   */
  it("keeps the accounting whole when the distinct ids cross a chunk boundary", async () => {
    const distinctIds = Array.from(
      { length: 150 },
      (_, index) =>
        `01920000-0000-7000-8000-${(910000 + index).toString().padStart(12, "0")}`,
    );
    // Every id once, then the first hundred of them folded in a second time.
    const stored = [...distinctIds, ...distinctIds.slice(0, 100)];
    const rows = distinctIds.map((observation_id, index) =>
      observationRow({
        observation_id,
        source_id: ID.sourceBandsintown,
        entity_id: null,
        value: `record ${index}`,
      }),
    );
    const item = reviewItemSourcePattern({ evidence: stored });
    const markup = await renderItem(
      patternScript({
        [T.reviewItems]: { data: item },
        [T.observations]: [
          { data: rows.slice(0, 100) },
          { data: rows.slice(100) },
          { data: [] },
        ],
      }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual(distinctIds);
    expect(attrsOf(markup, "[data-unresolved]")).toEqual([]);
    expect(accountingIn(markup)).toEqual([150, 150]);
  });

  /**
   * A source registry that ANSWERED but holds no row for one of the claims'
   * sources — the ordinary case the degrading `sources` leg falls back to
   * (admin-window/BUG-0021). A subset is not a refusal: the labelled claim
   * keeps its tier, the unlabelled one shows its source id and no tier, and
   * nothing is reported as unavailable.
   */
  it("labels only the claims the registry answered for, and calls that no refusal", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      conflictScript({ [T.sources]: { data: [TICKETMASTER] } }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([ID.observationA, ID.observationB]);
    expect(rowOf(markup, ID.observationA).tier).toBe(TICKETMASTER.tier);

    const unlabelled = rowOf(markup, ID.observationB);
    expect(unlabelled.tier, "no registry row, so no tier is invented").toBeFalsy();
    expect(unlabelled.sourceHref, "the link is still real").toContain(
      ID.sourceBandsintown,
    );
    expect(
      cheerio.load(markup)("[role=alert]"),
      "a registry with fewer rows than asked for is not a refusal",
    ).toHaveLength(0);
    expect(accountingIn(markup)).toEqual([2, 2]);
  });
});

/* ── the canonical side ──────────────────────────────────────────────────── */

describe("the current canonical value, beside the contenders", () => {
  it("renders it as the rightmost card, with the tier frozen at the apply", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(conflictScript(), item.review_item_id);
    const cards = pairCards(markup);

    // One card per contender, canonical LAST (LOOK_AND_FEEL, the evidence pair).
    expect(cards).toHaveLength(item.evidence.length + 1);
    const canonical = cards[cards.length - 1];
    expect(canonical).toContain(String(CLAIM_A.value));
    expect(canonical).toContain(TICKETMASTER.source);
    // The canonical card's tier is `tier_at_apply`, not the source's tier now.
    expect(canonical).toContain(DECISION.tier_at_apply);
    expect(canonical).not.toContain(TICKETMASTER.tier);
  });

  it("takes the LATEST decision, by applied_at then provenance_id", async () => {
    const older = fieldProvenanceRow({
      provenance_id: "01920000-0000-7000-8000-000000000402",
      applied_at: "2026-08-01T00:00:00Z",
      observation_id: ID.observationB,
      source_id: ID.sourceBandsintown,
      tier_at_apply: "standard",
    });
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      // Deliberately not in applied_at order.
      conflictScript({ [T.fieldProvenance]: { data: [older, DECISION], count: 2 } }),
      item.review_item_id,
    );

    const canonical = pairCards(markup).at(-1) ?? "";
    expect(canonical).toContain(String(CLAIM_A.value));
    expect(canonical).toContain(DECISION.tier_at_apply);
    expect(canonical).not.toContain(older.tier_at_apply);
  });

  it("shows no value when the applied claim is no longer live", async () => {
    // Trap 7: the current canonical value is the winning observation ONLY
    // while it is still live. A superseded winner leaves no current value, and
    // the card says which status it now carries rather than showing its value.
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      conflictScript({
        [T.observations]: {
          data: [{ ...CLAIM_A, status: "superseded" }, CLAIM_B],
        },
      }),
      item.review_item_id,
    );

    const canonical = pairCards(markup).at(-1) ?? "";
    expect(canonical).toContain("superseded");
    expect(canonical).not.toContain(String(CLAIM_A.value));
  });

  it("says there is no canonical row when the record does not exist yet", async () => {
    const item = reviewItemEntityLink();
    const markup = await renderItem(stuckScript(), item.review_item_id);
    const cards = pairCards(markup);

    // The pair still renders — the stuck claim stands against an empty
    // canonical card, which is what an entity_link fact item IS.
    expect(cards).toHaveLength(item.evidence.length + 1);
    // No provenance read happened at all: there is no fact to read one for.
    expect(textOf(markup)).not.toContain(T.fieldProvenance);
  });
});

/* ── three shapes, three views ───────────────────────────────────────────── */

describe("each shape gets its own view", () => {
  it("renders three distinct views over the same anatomy", async () => {
    // Rendered one after another on purpose: every render swaps the one stub
    // client this file injects, so three at once would read each other's script.
    const names: string[] = [];
    for (const [script, id] of [
      [conflictScript(), reviewItemDataConflict().review_item_id],
      [stuckScript(), reviewItemEntityLink().review_item_id],
      [patternScript(), reviewItemSourcePattern().review_item_id],
    ] as const) {
      const markup = await renderItem(script, id);
      names.push(
        cheerio.load(markup)("[data-evidence-view]").attr("data-evidence-view") ?? "",
      );
    }

    expect(new Set(names).size).toBe(3);
    expect(names.every((name) => name.length > 0)).toBe(true);
  });

  it("gives the entity_link fact item the unmet requirement its claims wait on", async () => {
    const item = reviewItemEntityLink();
    const markup = await renderItem(stuckScript(), item.review_item_id);
    const row = rowOf(markup, ID.observationB);

    // The classification view's own words: the bucket, and the requirement it
    // names (resolver.md §7).
    expect(row.held).toContain("awaiting_row");
    expect(row.held).toContain("at least one linked performer");
  });

  it("gives the source-pattern item a record list and its own dial, and no pair", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(patternScript(), item.review_item_id);
    const $ = cheerio.load(markup);

    // The folded records, as a list: every row names the fact it is about.
    expect($(`[data-evidence="${ID.observationB}"]`)).toHaveLength(1);
    expect($("[data-fact]").attr("data-fact")).toBe(
      `${CLAIM_B.domain}.${CLAIM_B.field}`,
    );
    // The per-source dial is beside it...
    expect($("[data-dial]")).toHaveLength(1);
    // ...and there is no canonical card: the subject is a SOURCE, not a fact.
    expect($("[data-pair]")).toHaveLength(0);
  });

  it("draws the dial's trend without a threshold line", async () => {
    // The threshold is a source-registry dial in the scraper repo and the seam
    // that would read it is empty (admin-window/TASK-0024). No number of ours
    // may stand in for it, so the dial states the gap instead.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(patternScript(), item.review_item_id);
    const dial = cheerio.load(markup)("[data-dial]").text();

    expect(dial).not.toMatch(/threshold[^.]*\b\d+\b/i);
  });

  it("does not read the dial for a fact item", async () => {
    // The dial belongs to one shape. A script with no second `observations`
    // response would throw if the trend were read here.
    const item = reviewItemDataConflict();
    const markup = await renderItem(conflictScript(), item.review_item_id);
    expect(cheerio.load(markup)("[data-dial]")).toHaveLength(0);
  });
});

/* ── the close, and the recommendation slot ──────────────────────────────── */

describe("nothing settles anything in M1", () => {
  it("renders no control at all, on any shape", async () => {
    for (const [name, script, id] of [
      ["conflict", conflictScript(), reviewItemDataConflict().review_item_id],
      ["stuck", stuckScript(), reviewItemEntityLink().review_item_id],
      ["pattern", patternScript(), reviewItemSourcePattern().review_item_id],
    ] as const) {
      const $ = cheerio.load(await renderItem(script, id));
      // No verdict action, no settle control, no note field, and no disabled
      // button standing in for one (spec §7 is the verdict slice).
      for (const control of ["button", "form", "input", "select", "textarea"]) {
        expect($(control), `${name}: ${control}`).toHaveLength(0);
      }
    }
  });

  it("renders the recommendation and close slots as nothing", async () => {
    // Both slots exist in the anatomy and render NOTHING in M1, so the page
    // carries exactly the two sections that do render: what happened, and the
    // evidence.
    const $ = cheerio.load(
      await renderItem(conflictScript(), reviewItemDataConflict().review_item_id),
    );
    expect($("h2")).toHaveLength(2);
  });
});

/* ── links out ───────────────────────────────────────────────────────────── */

describe("the investigation continues", () => {
  it("links a fact item to its claims and to its record", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(conflictScript(), item.review_item_id);
    const hrefs = attrsOf(markup, "[data-out]");

    // Spelled here, not imported: a URL is a contract with the other pages.
    expect(hrefs).toContain(`/claims?domain=${item.domain}`);
    expect(hrefs).toContain(`/records/${item.domain}/${item.entity_id}`);
  });

  it("links a source-pattern item to its claims and its source", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(patternScript(), item.review_item_id);
    const hrefs = attrsOf(markup, "[data-out]");

    expect(hrefs).toContain(`/claims?source_id=${item.source_id}`);
    expect(hrefs).toContain(`/sources?source_id=${item.source_id}`);
  });

  it("offers no record link when the record does not exist yet", async () => {
    // An entity_link fact item's record is exactly what is missing; a link to
    // it would go nowhere.
    const item = reviewItemEntityLink();
    const markup = await renderItem(stuckScript(), item.review_item_id);
    expect(
      attrsOf(markup, "[data-out]").some((href) => href.startsWith("/records/")),
    ).toBe(false);
  });

  /**
   * admin-window/BUG-0043 — one page, one destination, ONE label.
   *
   * The header's `Its source` link and the evidence cells directly below it
   * point at the same `/sources?source_id=…` href, and the header printed the
   * uuid while the cells read the source's name. Both now come from the one
   * registry map the evidence read builds, so they cannot drift apart, and a
   * stranger reading the page is not left checking whether two labels over one
   * id mean two different things (user-sim Tomas, 2026-09-03).
   */
  it("names the source in both header links, in the evidence table's own words", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(patternScript(), item.review_item_id);
    const $ = cheerio.load(markup);
    const sourceId = item.source_id as string;
    const toSource = `/sources?source_id=${sourceId}`;

    for (const href of [toSource, `/claims?source_id=${sourceId}`]) {
      const link = $(`a[data-out="${href}"]`);
      expect(link, href).toHaveLength(1);
      expect(link.text(), href).toContain(BANDSINTOWN.source);
      // The uuid is not what the link SAYS, only where it goes.
      expect(link.text(), href).not.toContain(sourceId);
      expect(link.attr("href"), href).toBe(href);
    }

    // The same href, in the evidence table below: the same word.
    const headerLabel = $(`a[data-out="${toSource}"] span`).text().trim();
    const cellLabel = $(`a[data-claim-source][href="${toSource}"]`)
      .first()
      .text()
      .trim();
    expect(cellLabel).toBe(BANDSINTOWN.source);
    expect(headerLabel).toBe(cellLabel);
  });

  it("keeps the id verbatim when the registry named nothing", async () => {
    // The other fixture of the pair: a registry that answered and holds no row
    // for this source. The id is then the only true thing the page can say, so
    // it says it (LOOK_AND_FEEL Voice bar 5) rather than blanking the link.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(
      patternScript({ [T.sources]: { data: [] } }),
      item.review_item_id,
    );
    const $ = cheerio.load(markup);
    const sourceId = item.source_id as string;
    const link = $(`a[data-out="/sources?source_id=${sourceId}"]`);
    expect(link).toHaveLength(1);
    expect(link.text()).toContain(sourceId);
    expect(link.text()).not.toContain(BANDSINTOWN.source);
  });

  /**
   * admin-window/BUG-0043, the case the fixture pair above cannot reach: the
   * item's source is named because THE ITEM names it, not because one of its
   * claims happened to be on this page carrying the name.
   *
   * The page's earlier per-source label did exactly that — it searched the
   * evidence rows for a claim of the same source and fell back to the uuid
   * when it found none — so an item whose evidence contends between OTHER
   * sources, and an item with no evidence at all, both read as uuids in the
   * header while `/sources` named them. The registry read now resolves the
   * item's own `source_id` whether or not any claim carries it.
   */
  it("names the item's own source when its evidence carries a different one", async () => {
    const item = reviewItemSourcePattern({ evidence: [CLAIM_A.observation_id] });
    const markup = await renderItem(
      patternScript({
        [T.reviewItems]: { data: item },
        [T.observations]: [{ data: [CLAIM_A] }, { data: [] }],
        [T.sources]: { data: [BANDSINTOWN, TICKETMASTER] },
      }),
      item.review_item_id,
    );
    const $ = cheerio.load(markup);
    const sourceId = item.source_id as string;

    // The header names the ITEM's source — bandsintown — though the only
    // claim below it belongs to ticketmaster.
    for (const href of [
      `/sources?source_id=${sourceId}`,
      `/claims?source_id=${sourceId}`,
    ]) {
      const link = $(`a[data-out="${href}"]`);
      expect(link, href).toHaveLength(1);
      expect(link.text(), href).toContain(BANDSINTOWN.source);
      expect(link.text(), href).not.toContain(sourceId);
    }
    // ... and the evidence row still names ITS own source, not the header's:
    // one map, two sources, neither borrowing the other's name.
    const cell = $(`a[data-claim-source][href="/sources?source_id=${CLAIM_A.source_id}"]`);
    expect(cell.first().text().trim()).toBe(TICKETMASTER.source);
    expect(rowOf(markup, CLAIM_A.observation_id).text).not.toContain(sourceId);
    // The dial on this shape is about the same source, and says the same word.
    expect($("[data-dial]").text()).toContain(BANDSINTOWN.source);
    expect($("[data-dial]").text()).not.toContain(sourceId);
  });

  it("names the item's own source when it has no evidence to borrow a name from", async () => {
    const item = reviewItemSourcePattern({ evidence: [] });
    const markup = await renderItem(
      patternScript({
        [T.reviewItems]: { data: item },
        [T.observations]: [{ data: [] }, { data: [] }],
        [T.sources]: { data: [BANDSINTOWN] },
      }),
      item.review_item_id,
    );
    const $ = cheerio.load(markup);
    const sourceId = item.source_id as string;
    for (const href of [
      `/sources?source_id=${sourceId}`,
      `/claims?source_id=${sourceId}`,
    ]) {
      const link = $(`a[data-out="${href}"]`);
      expect(link, href).toHaveLength(1);
      expect(link.text(), href).toContain(BANDSINTOWN.source);
      expect(link.text(), href).not.toContain(sourceId);
      // The link still GOES to the id: naming it changed the words, not the
      // destination.
      expect(link.attr("href"), href).toBe(href);
    }
  });
});

/* ── the states ──────────────────────────────────────────────────────────── */

describe("the four data-surface states", () => {
  it("renders the item's own surface for an id no row matches, and does not route", async () => {
    // admin-window/BUG-0017: an id that resolves to nothing is a state of this
    // page, at 200 — never `notFound()`. The id is named verbatim and the
    // table it is not in is named too.
    const id = "01920000-0000-7000-8000-0000000005ff";
    const markup = await renderItem(
      { ...conflictScript(), [T.reviewItems]: { data: null } },
      id,
    );

    expect(cheerio.load(markup)(`[data-review-item="${id}"]`).text()).toBe(id);
    expect(textOf(markup)).toContain(T.reviewItems);
    expect(cheerio.load(markup)("[data-evidence]")).toHaveLength(0);
  });

  it("names the missing table when the item's own table is absent", async () => {
    const markup = await renderItem(
      {
        ...conflictScript(),
        [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
      },
      ID.reviewItemDataConflict,
    );
    expect(textOf(markup)).toContain(T.reviewItems);
  });

  it("names the read that refused when the evidence table is absent", async () => {
    // The header still renders: the item was read. Only the evidence block is
    // replaced, and it names `observations` rather than the item's table.
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      conflictScript({
        [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      }),
      item.review_item_id,
    );

    expect(textOf(markup)).toContain(item.summary);
    expect(textOf(markup)).toContain(T.observations);
    expect(cheerio.load(markup)("[data-evidence]")).toHaveLength(0);
  });

  it("shows the database's own words, naming the read, when one refuses", async () => {
    const failure = permissionDenied(T.sources);
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      conflictScript({ [T.sources]: { error: failure } }),
      item.review_item_id,
    );
    const $ = cheerio.load(markup);
    const line = $("[role=alert]").text();

    // The read is named (BUG-0016) and the message is verbatim, not replaced.
    expect(line).toContain(T.sources);
    expect(line).toContain(failure.message);
  });

  it("keeps the evidence when only the classification view refuses", async () => {
    // The claims read fine; only what is HOLDING them could not be read. The
    // rows stay and the refusal is reported separately, naming its own object.
    const item = reviewItemEntityLink();
    const markup = await renderItem(
      stuckScript({ [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) } }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([ID.observationB]);
    expect(cheerio.load(markup)("[role=alert]").text()).toContain(T.pendingClaims);
  });

  /**
   * The source registry is a LABEL leg — admin-window/BUG-0021 (QA's second
   * finding on TASK-0011: a refusing leg used to blank the claims that did
   * arrive).
   *
   * Its refusal costs the operator a name and a current tier, never a claim,
   * so the evidence stays on screen with each claim's source id verbatim and
   * no tier, and the refusal is reported beside it naming `sources` — the same
   * pattern the classification leg above already uses.
   */
  it("keeps the evidence when only the source registry refuses", async () => {
    const item = reviewItemDataConflict();
    const markup = await renderItem(
      conflictScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([ID.observationA, ID.observationB]);
    // No name and no tier were read, so neither is shown or invented.
    const row = rowOf(markup, ID.observationA);
    expect(row.text, "the source id stands in for the name").toContain(
      CLAIM_A.source_id,
    );
    // (The row's payload pointer happens to carry the source's name as text,
    // so absence of the NAME is asserted on the source cell's own link, not on
    // the whole row.)
    expect(row.sourceHref, "the link is still real").toContain(CLAIM_A.source_id);
    expect(row.tier, "no tier was read, so none is shown").toBeFalsy();
    expect(cheerio.load(markup)("[role=alert]").text()).toContain(T.sources);
    // …and the accounting still covers every id the read looked at.
    expect(accountingIn(markup)).toEqual([2, 2]);
  });

  it("keeps the folded records when only the dial's read refuses", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(
      patternScript({
        [T.observations]: [
          { data: [CLAIM_B] },
          { error: tableNotInSchemaCache(T.observations) },
        ],
      }),
      item.review_item_id,
    );

    expect(evidenceIds(markup)).toEqual([ID.observationB]);
    expect(cheerio.load(markup)("[data-dial]").text()).toContain(T.observations);

    // The live oracle's ONE `excluding` caller, graded against the markup this
    // page really renders (review-item.live.test.ts's `gradeEvidence`: within
    // the evidence surface, excluding `[data-dial]`). The dial is a PROPER
    // DESCENDANT of that surface, which is what makes the exclusion legal at
    // all under admin-window/BUG-0036 — assert that from the DOM rather than
    // from the JSX, so a refactor that lifts the dial out of the view (or
    // wraps the view in it) reddens here instead of silently un-excluding.
    //
    // Graded through the SURFACE HOOK the oracle really passes, not through
    // the view's own hook: since admin-window/DEBT-0002 that `within` is
    // `[data-surface="evidence"]`, and the view sits inside it.
    const $ = cheerio.load(markup);
    expect($(EVIDENCE_HOOK)).toHaveLength(1);
    expect($(EVIDENCE_HOOK).find("[data-evidence-view]")).toHaveLength(1);
    expect($(EVIDENCE_HOOK).find("[data-dial]")).toHaveLength(1);
    expect(stateOf(markup, EVIDENCE_HOOK)).not.toBe("ok");
    expect(stateOf(markup, EVIDENCE_HOOK, "[data-dial]")).toBe("ok");
  });
});

/* ── the jsonb value ─────────────────────────────────────────────────────── */

describe("a claim's value", () => {
  it("renders a reference-class value as its JSON text, not as [object Object]", async () => {
    // `observations.value` is jsonb and a reference-class value is an object
    // carrying a `ref` key (§6 trap 8).
    const reference: ObservationRow = {
      ...CLAIM_A,
      field: "venue",
      value: { ref: "the-forum-inglewood" },
    };
    const item = reviewItemDataConflict({ evidence: [ID.observationA] });
    const markup = await renderItem(
      conflictScript({
        [T.reviewItems]: { data: item },
        [T.observations]: { data: [reference] },
      }),
      item.review_item_id,
    );

    const row = rowOf(markup, ID.observationA);
    expect(row.text).toContain("the-forum-inglewood");
    expect(row.text).not.toContain("object Object");
  });
});

/* ── the table scrolls inside its own border, not the page ───────────────── */

describe("a table wider than its column", () => {
  /**
   * LOOK_AND_FEEL, Component rules / Data table: "Tables that exceed their
   * width scroll horizontally *inside their own border*; the page does not."
   *
   * `DataTable` has always carried the scroll container. What broke the rule
   * on this page was an ANCESTOR (admin-window/BUG-0042): the source-pattern
   * view lays its records column and its dial out as a grid, and a grid item's
   * `min-width` is `auto` — its CONTENT's minimum. The payload column's
   * unbreakable `sha256/…` pointers therefore sized the `2fr` track to the
   * table's intrinsic width, the grid outgrew the content pane, and the
   * horizontal scroll landed on `main` while the table's right border sat off
   * screen and the lede paragraph was stretched out with it.
   *
   * So the pin is on the ANCESTOR CHAIN rather than on the table: no ancestor
   * of a table may be a track of a content-sized container that is free to
   * grow. A later wrapper that reintroduces one reddens here.
   */
  const layoutOf = (node: { attr(name: string): string | undefined }) =>
    new Set((node.attr("class") ?? "").split(/\s+/).filter(Boolean));

  /** A container that sizes its children by their content unless stopped. */
  const growsToItsChildren = (classes: Set<string>) =>
    [...classes].some(
      (name) =>
        name === "grid" ||
        name.endsWith(":grid") ||
        ((name === "flex" || name.endsWith(":flex")) && !classes.has("flex-col")),
    );

  it.each([
    ["a data_conflict item", () => conflictScript(), reviewItemDataConflict()],
    ["an entity_link fact item", () => stuckScript(), reviewItemEntityLink()],
    ["a source-pattern item", () => patternScript(), reviewItemSourcePattern()],
  ] as const)("keeps %s's horizontal scroll inside the table's border", async (
    _name,
    script,
    item,
  ) => {
    const $ = cheerio.load(await renderItem(script(), item.review_item_id));
    const tables = $("table").toArray();
    expect(tables.length).toBeGreaterThan(0);

    for (const table of tables) {
      const ancestors = $(table)
        .parents()
        .toArray()
        .map((element) => $(element));

      // The scroll container is an ancestor of the table and sits INSIDE the
      // bordered box, so the table's own border is on screen on both sides.
      const scrollers = ancestors.filter((node) =>
        layoutOf(node).has("overflow-x-auto"),
      );
      expect(scrollers).toHaveLength(1);
      expect(layoutOf(scrollers[0].parent()).has("border")).toBe(true);

      // Nothing above the table may hand that scroll back to the page: an
      // ancestor that is a track of a content-sized container is pinned to a
      // zero minimum, so the track takes its share and the table overflows
      // into its own scroll container instead of into `main`.
      for (const node of ancestors) {
        const parent = node.parent();
        if (parent.length === 0) continue;
        if (!growsToItsChildren(layoutOf(parent))) continue;
        expect(layoutOf(node).has("min-w-0")).toBe(true);
      }
    }
  });
});

/* ── the addressing the live oracle depends on ───────────────────────────── */

describe("the surface hooks the live parity oracle addresses", () => {
  /**
   * The live oracle grades ONE surface at a time and `stateOf`
   * (`tests/live/parity.ts`) refuses any selector matching other than exactly
   * one element. Until admin-window/DEBT-0002 it addressed the header as
   * `section:nth-of-type(1)` and the evidence body as
   * `section:nth-of-type(2) > :nth-child(2)` — the second compounding this
   * page's section ORDER with the body's position among its section's own
   * children, so the parked recommendation slot filling in, or one more leg
   * note, repoints it at something that is not the evidence. On `/cycles` the
   * same class made one selector match two surfaces and four live tests threw
   * (admin-window/BUG-0040, admin-window/BUG-0056).
   *
   * Nothing offline could see any of that — `npm test` runs the offline and
   * isolated projects only — so the live oracle's addressing had no pin in CI.
   * These cases are that pin, in the file that owns this page's markup.
   */
  it("gives each surface exactly one element, in every shape and every state", async () => {
    const conflict = reviewItemDataConflict();
    const stuck = reviewItemEntityLink();
    const pattern = reviewItemSourcePattern();

    const states: [string, string][] = [
      ["conflict", await renderItem(conflictScript(), conflict.review_item_id)],
      ["stuck fact", await renderItem(stuckScript(), stuck.review_item_id)],
      ["source pattern", await renderItem(patternScript(), pattern.review_item_id)],
      // No evidence at all: the view is replaced by its empty rendering.
      [
        "no evidence",
        await renderItem(
          conflictScript({ [T.observations]: { data: [] } }),
          conflict.review_item_id,
        ),
      ],
      // The states that swap the body for a card are exactly where a wrapper
      // is most likely to appear or vanish.
      [
        "evidence absent",
        await renderItem(
          conflictScript({ [T.observations]: { error: tableNotInSchemaCache(T.observations) } }),
          conflict.review_item_id,
        ),
      ],
      [
        "evidence refused",
        await renderItem(
          conflictScript({ [T.observations]: { error: permissionDenied(T.observations) } }),
          conflict.review_item_id,
        ),
      ],
      // One leg failing while the evidence reads fine: the bucket read and the
      // source registry render their own cards BESIDE the evidence, and
      // neither may land inside its surface.
      [
        "buckets refused",
        await renderItem(
          stuckScript({ [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) } }),
          stuck.review_item_id,
        ),
      ],
      [
        "registry refused",
        await renderItem(
          conflictScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
          conflict.review_item_id,
        ),
      ],
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

  it("renders no surface at all for the two whole-page refusals", async () => {
    // Both return before any `<Section>`, so the hooks are absent rather than
    // duplicated — stated as a number, because "the selector matched nothing"
    // is exactly what `stateOf` throws on, and a future ticket must not
    // resurrect them here by accident.
    const missingRow = await renderItem(
      { ...conflictScript(), [T.reviewItems]: { data: null } },
      "01920000-0000-7000-8000-0000000005ff",
    );
    const refusedRead = await renderItem(
      { ...conflictScript(), [T.reviewItems]: { error: permissionDenied(T.reviewItems) } },
      reviewItemDataConflict().review_item_id,
    );

    for (const [name, markup] of [
      ["no such row", missingRow],
      ["review table refused", refusedRead],
    ] as [string, string][]) {
      expect(surfaceHooks(markup, HOOKS), name).toEqual({
        counts: { [HEADER_HOOK]: 0, [EVIDENCE_HOOK]: 0 },
        nested: [],
      });
    }
  });

  it("keeps each surface's own content inside its own hook", async () => {
    // A hook that is unique but points at the wrong surface is the same bug
    // wearing a different hat, so each name is checked against what that
    // surface actually reads — including the legs, which belong to NEITHER.
    const item = reviewItemEntityLink();
    const $ = cheerio.load(
      await renderItem(
        stuckScript({ [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) } }),
        item.review_item_id,
      ),
    );

    expect($(HEADER_HOOK).find("[data-severity]").length).toBe(1);
    expect($(EVIDENCE_HOOK).find("[data-evidence-view]").length).toBe(1);
    expect($(EVIDENCE_HOOK).find("[data-evidence]").length).toBeGreaterThan(0);

    // The header holds no evidence, and the evidence holds no header.
    expect($(HEADER_HOOK).find("[data-evidence], [data-evidence-view]").length).toBe(0);
    expect($(EVIDENCE_HOOK).find("[data-severity]").length).toBe(0);

    // The bucket leg refused: its card renders on the page and OUTSIDE the
    // evidence surface, so grading the evidence never reads it as the
    // evidence's own failure (the exact confusion admin-window/TASK-0031
    // produces on staging).
    const refusals = $('[data-state="error"]');
    expect(refusals.length).toBeGreaterThan(0);
    expect($(EVIDENCE_HOOK).find('[data-state="error"]').length).toBe(0);
  });
});


/* ── an address that can be no review-item id ─────────────────────────────── */

/**
 * The queues detail page's half of the mistyped-address question — QA, found
 * attacking campaign admin-window/BUG-0068.
 *
 * `review_items.review_item_id` is a `uuid` (scraper migration
 * `20260901000002_the_review_item_opens_once_per_subject.sql`, line 39), so a
 * segment that is not a uuid can equal no key in that table: "no such item" is
 * knowable here without a database, exactly as it is on the record page
 * (`isRecordId`, `src/lib/db/records.ts`, admin-window/BUG-0065) and on the
 * PATCH route (admin-window/BUG-0068). This page instead hands the segment
 * straight to PostgREST (`src/app/queues/[reviewItemId]/page.tsx:399`), which
 * refuses it with `22P02`, and the surface reports a FAILED READ — the state
 * whose recovery line is "reload", advice that can never work because the
 * reload re-sends the same segment forever.
 *
 * Both halves are asserted: no read is issued, and whatever state answers, it
 * is not the one that means the database failed.
 */
describe("a queues address that is not a review-item id", () => {
  // PINNED `it.fails` (strict) for admin-window/BUG-0076: green only while the
  // divergence is live, so the fix turns it RED and is flipped back to a plain
  // `it()` in the same commit — the convention admin-window/BUG-0013 used.
  // Watched RED as a plain `it()` on run/admin-window @ 2bbe138, one half at a
  // time: "expected [ { table: 'review_items', ... } ] to have a length of +0
  // but got 1", and "expected [ 'error' ] to not include 'error'".
  it.fails("does not report an address that can be no id as a failed database read", async () => {
    const stub = stubClient({
      // The script carries the error the database WOULD answer with. A page
      // that decides the address first never gets that far.
      [T.reviewItems]: { error: invalidUuidSyntax("walk-1") },
    });
    readWith.client = stub.asSupabaseClient();
    const markup = render(
      await ReviewItemPage({ params: Promise.resolve({ reviewItemId: "walk-1" }) }),
    );

    const states = cheerio
      .load(markup)("[data-state]")
      .toArray()
      .map((element) => element.attribs["data-state"]);
    expect(states, "the answer to a bad address is not a failed read").not.toContain("error");
    expect(stub.calls, "a segment that can be no review_item_id needs no read").toHaveLength(0);
  });
});
