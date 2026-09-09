import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { ClaimList, type ClaimLine } from "@/components/claims/claim-list";
import { isRecordId } from "@/lib/db/records";
import { SHAPES, shapeOf } from "@/lib/review/shapes";
import { EM_DASH, counted } from "@/lib/format";
import { T } from "@/lib/db/tables";
import { h, render, uppercasedIdentifiers } from "../ui/markup";
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
  transportFailure,
  type Script,
} from "../../fixtures/stub-client";
import {
  anchorClasses,
  classesOf,
  expectDrawnAsLinkAtRest,
  expectLinkSpellingReachesTheGlyphs,
  expectNotDrawnAsLink,
  faceOf,
} from "../../fixtures/link-spelling";
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

/**
 * The close's own read (campaign admin-window/TASK-0049). It takes no client
 * from the page — like every other read in `lib/db`, it resolves the app's
 * own inside its `try` — so the stub is handed in here, and every script in
 * this file says what this database holds for it.
 */
vi.mock("@/lib/db/verdict", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/verdict")>();
  return {
    ...actual,
    readSettlementReadiness: () =>
      actual.readSettlementReadiness(readWith.client as never),
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

/**
 * The close's own read, in the state this database is really in.
 *
 * `readSettlementReadiness` reads the presence of the verdict log
 * (ARCHITECTURE.md §9.2), which is absent on staging and in production and
 * stays absent for the whole of M2 — so every script below carries that
 * absence by default and the close slot renders its not-provisioned card.
 * `withSettlement` is the other half, for the ready state.
 */
const SETTLEMENT_ABSENT: Script = {
  [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
};

/** The same script against a database where the verdict log IS installed. */
function withSettlement(script: Script): Script {
  return { ...script, [T.verdicts]: { data: [], count: 0 } };
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
    ...SETTLEMENT_ABSENT,
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
    ...SETTLEMENT_ABSENT,
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
    ...SETTLEMENT_ABSENT,
    ...overrides,
  };
}

/**
 * The signal item at the size staging really produces it — campaign
 * admin-window/BUG-0096.
 *
 * The one real review item on staging folds the same fact 700 times and
 * resolves to 91 folded records, which is what made the close 3,483px of
 * evidence away from the summary it closes. `patternScript` above carries ONE
 * claim, so it can never catch a placement that only breaks once the evidence
 * is tall: this script is the long twin of it, and the two are asserted to
 * place the close identically.
 *
 * 104 ids crosses `ID_CHUNK` (100, `src/lib/db/result.ts`), so the evidence
 * read really chunks here — the observations queue below is the two chunks and
 * then the dial's own windowed scan.
 */
const FOLDED = Array.from({ length: 104 }, (_, index) =>
  observationRow({
    observation_id: `01920000-0000-7000-8000-${String(900000000000 + index)}`,
    source_id: ID.sourceBandsintown,
    value: "The Forum, Inglewood",
    status: "pending",
    payload_ref: `bandsintown/2026-08-31/forum-${index}.json`,
  }),
);

/** The source-pattern item carrying all 104 of them, in fold order. */
function longPatternScript(overrides: Script = {}): Script {
  const item = reviewItemSourcePattern({
    evidence: FOLDED.map((claim) => claim.observation_id),
    folded_count: 700,
  });
  return {
    [T.reviewItems]: { data: item },
    [T.observations]: [
      { data: FOLDED.slice(0, 100) },
      { data: FOLDED.slice(100) },
      { data: [] },
    ],
    [T.sources]: { data: [BANDSINTOWN] },
    [T.pendingClaims]: [{ data: [] }, { data: [] }, { data: [] }],
    ...SETTLEMENT_ABSENT,
    ...overrides,
  };
}

/* ── two folded records that differ only in WHICH record ─────────────────── */

/**
 * The pair that made this table unreadable — campaign admin-window/BUG-0122.
 *
 * On staging's one signal item (`01a06287-…`, 91 folded records) two rows were
 * byte-identical across every column the view drew — same fact, same performer
 * payload, same source, same tier, same age, same payload pointer — while being
 * two DIFFERENT stuck events. The fold is by source and by symptom, so a
 * source-pattern item is EXPECTED to hold rows that agree everywhere but in the
 * record they are about; the record is therefore the only thing that can tell
 * them apart, and it is what the view dropped.
 *
 * Four rows, because the record identity has four states worth pinning: two
 * canonical rows that exist (a link each, to two different records), one claim
 * whose row does not exist yet (the source's own `external_ref`, which is the
 * only name anything holds for it), and one carrying neither (the table's
 * dash — invented identity is worse than a named absence).
 */
const PERFORMERS = [
  { ids: { spotify: "4Kxlr1PRlDKEB0ekOCyHgX" }, ref: "K8vZ917GQmV", name: "BIGBANG" },
];

/** The two stuck events the pair is about. Distinct, and nothing else is. */
const STUCK_EVENT_A = "01920000-0000-7000-8000-000000000203";
const STUCK_EVENT_B = "01920000-0000-7000-8000-000000000204";

/** One folded `events.performers` claim, identical to its siblings but for `overrides`. */
function foldedPerformer(overrides: Partial<ObservationRow>): ObservationRow {
  return observationRow({
    field: "performers",
    domain: "events",
    value: PERFORMERS,
    source_id: ID.sourceBandsintown,
    status: "pending",
    observed_at: "2026-09-01T08:00:00Z",
    payload_ref: "sha256/7b/7b50",
    ...overrides,
  });
}

const BIGBANG_A = foldedPerformer({
  observation_id: "01920000-0000-7000-8000-000000000311",
  entity_id: STUCK_EVENT_A,
  external_ref: "1AvZZ_8GkDIyaGr",
});
const BIGBANG_B = foldedPerformer({
  observation_id: "01920000-0000-7000-8000-000000000312",
  entity_id: STUCK_EVENT_B,
  external_ref: "vvG1IZ_eJSfUoL",
});
/** No canonical row yet — which is why this claim is stuck at all. */
const BIGBANG_UNLINKED = foldedPerformer({
  observation_id: "01920000-0000-7000-8000-000000000313",
  entity_id: null,
  external_ref: "k7vGF_oRKjGkH",
});
/** Neither identity: the row can only say that it has nothing to say. */
const BIGBANG_ANONYMOUS = foldedPerformer({
  observation_id: "01920000-0000-7000-8000-000000000314",
  entity_id: null,
  external_ref: null,
});

const FOLDED_PAIR = [BIGBANG_A, BIGBANG_B, BIGBANG_UNLINKED, BIGBANG_ANONYMOUS];

/** The source-pattern item folding those four. */
function foldedPairScript(overrides: Script = {}): Script {
  const item = reviewItemSourcePattern({
    evidence: FOLDED_PAIR.map((claim) => claim.observation_id),
  });
  return {
    [T.reviewItems]: { data: item },
    [T.observations]: [{ data: FOLDED_PAIR }, { data: [] }],
    [T.sources]: { data: [BANDSINTOWN] },
    [T.pendingClaims]: [{ data: [] }, { data: [] }],
    ...SETTLEMENT_ABSENT,
    ...overrides,
  };
}

/**
 * One claim as `/claims` renders it, so the two surfaces can be asked the same
 * question about the same two values (the anatomy rule: one fact, one
 * rendering, one name, on every screen). Only the two columns under test are
 * read off it.
 */
const CLAIMS_PAGE_LINE: ClaimLine = {
  observationId: ID.observationA,
  bucket: "awaiting_row",
  domain: "events",
  field: "performers",
  entityId: ID.eventEntity,
  sourceId: ID.sourceTicketmaster,
  source: TICKETMASTER.source,
  observedAt: CLAIM_A.observed_at,
  unmetRequirement: "at least one linked performer",
  sourceHref: `/sources?source_id=${ID.sourceTicketmaster}`,
  provenanceHref: `/records/events/${ID.eventEntity}`,
};

/* ── the addressing the live oracle depends on ───────────────────────────── */

/**
 * The name each graded surface answers to (`data-surface`,
 * `src/app/queues/[reviewItemId]/page.tsx`), as
 * `tests/live/review-item.live.test.ts` addresses them.
 */
const HEADER_HOOK = '[data-surface="what_happened"]';
const EVIDENCE_HOOK = '[data-surface="evidence"]';
const HOOKS = [HEADER_HOOK, EVIDENCE_HOOK];
/**
 * The close's own `data-surface` name. It is graded separately from the two
 * above because its state comes from a different read — the settlement
 * readiness — so an oracle folding it into the evidence would report an
 * absent verdict log as unreadable evidence.
 */
const CLOSE_HOOK = "close";

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
    /** WHICH record this row is about, however the view could name it. */
    record: row.find("[data-record]").attr("data-record"),
    /** The way to that record, when the app holds an address for it. */
    recordHref: row.find("a[data-record]").attr("href"),
    /** The fact it states about that record, as `domain.field`. */
    fact: row.find("[data-fact]").attr("data-fact"),
  };
}

/**
 * The header over the cell a hook sits in — what this surface CALLS that value.
 *
 * Read off the delivered markup on both sides, so the same question can be put
 * to two different surfaces and their answers compared. It pins no word: what
 * it asserts is that two screens agree, not what they agreed on.
 */
function headerOverCell(markup: string, hook: string): string {
  const $ = cheerio.load(markup);
  const cell = $(hook).first().closest("td");
  expect(cell, `no table cell carries ${hook}`).toHaveLength(1);
  const index = cell.prevAll("td").length;
  return $(cell)
    .closest("table")
    .find("thead th")
    .eq(index)
    .text()
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * The page's graded surfaces, by name, in the order the DOCUMENT carries them
 * (campaign admin-window/BUG-0096).
 *
 * Order is read off the delivered markup rather than off a class name, a
 * pixel or a grid declaration: a stylesheet is presentation and a rendered
 * offline page has no layout at all, but "the operator meets the close before
 * the evidence" is a fact about the document either way, and it is the one the
 * live oracle and a browser both inherit. Nested names (the settled item's
 * `item_verdict`, inside the close) appear here too, which is harmless — every
 * assertion below is about the relative position of two names.
 */
function surfaceOrder(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-surface]")
    .toArray()
    .map((element) => $(element).attr("data-surface") ?? "");
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

  it("draws every route out of an evidence row as this app draws a link, at rest", async () => {
    // **BUG-0099 (admin-window).** The `source` column is "the source, in one
    // click" (LOOK_AND_FEEL bar 10), and on a 91-row evidence table it was
    // indistinguishable from the mono values beside it until the pointer
    // arrived. Asserted against the app's one link spelling
    // (`components/cycles/links.ts`), never a class literal.
    for (const [shape, script, id] of [
      ["the conflict item", conflictScript(), reviewItemDataConflict().review_item_id],
      ["the source-pattern item", patternScript(), reviewItemSourcePattern().review_item_id],
    ] as const) {
      const markup = await renderItem(script, id);
      const $ = cheerio.load(markup);
      const rows = $("[data-evidence]")
        .toArray()
        .map((element) => $(element).closest("tr"));
      expect(rows.length, `${shape} renders evidence rows`).toBeGreaterThan(0);

      let seen = 0;
      for (const row of rows) {
        for (const classes of anchorClasses($, row)) {
          expectDrawnAsLinkAtRest(classes, `an anchor in ${shape}'s evidence row`);
          seen += 1;
        }
        // The second fixture on the same row (LESSONS 3): the values that go
        // nowhere must not wear the link's ink, or the affordance says
        // nothing about which cell is the way through.
        for (const inert of ["[data-tier-now]", "[data-claim-status]", "[data-payload]"]) {
          for (const cell of row.find(inert).toArray()) {
            expectNotDrawnAsLink(classesOf($(cell)), `${inert} in ${shape}`);
          }
        }
      }
      expect(seen, `${shape} has at least one route out`).toBeGreaterThan(0);
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

  /**
   * **admin-window/BUG-0122** — the table's first two columns, and the reason
   * a stranger closed the tab at this one (user-sims Priya and Devin,
   * 2026-09-09). A source-pattern item folds many records that agree on
   * everything but the record, so a row that cannot name its record is a dead
   * end, and two such rows are the same dead end drawn twice.
   */
  it("tells two folded records apart by the record each one is about", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(foldedPairScript(), item.review_item_id);
    const a = rowOf(markup, BIGBANG_A.observation_id);
    const b = rowOf(markup, BIGBANG_B.observation_id);

    // These two claims agree on every OTHER cell the view draws — same fact,
    // same value, same source, same tier, same age, same payload pointer.
    expect([a.fact, a.tier, a.observedAt, a.payload, a.sourceHref]).toEqual([
      b.fact,
      b.tier,
      b.observedAt,
      b.payload,
      b.sourceHref,
    ]);

    // ...so the row is told apart by the record it is about, or not at all.
    expect(a.record).toBe(STUCK_EVENT_A);
    expect(b.record).toBe(STUCK_EVENT_B);
    expect(a.recordHref).toBe(`/records/events/${STUCK_EVENT_A}`);
    expect(b.recordHref).toBe(`/records/events/${STUCK_EVENT_B}`);
    expect(a.text).not.toBe(b.text);
  });

  it("gives no two folded records about different records the same row", async () => {
    // The property, over the whole table rather than over the pinned pair: no
    // two rows naming two different source records render the same text.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(foldedPairScript(), item.review_item_id);
    const identified = FOLDED_PAIR.filter(
      (claim) => claim.entity_id !== null || claim.external_ref !== null,
    );
    expect(identified.length).toBeGreaterThan(1);

    const texts = identified.map((claim) => rowOf(markup, claim.observation_id).text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("names a folded record with no canonical row by the source's own reference", async () => {
    // The claim is stuck BECAUSE the row does not exist, so there is no
    // address to link to and none is invented (LOOK_AND_FEEL bar 10's honest
    // half). What the app does hold is the source's own reference for that
    // record, verbatim.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(foldedPairScript(), item.review_item_id);
    const $ = cheerio.load(markup);
    const row = $(`[data-evidence="${BIGBANG_UNLINKED.observation_id}"]`).closest("tr");
    const cell = row.find("[data-record]");

    expect(cell).toHaveLength(1);
    expect(cell.text().trim()).toBe(BIGBANG_UNLINKED.external_ref);
    expect(cell.attr("data-record")).toBe(BIGBANG_UNLINKED.external_ref);
    // It goes nowhere, and it does not pretend to.
    expect(cell.is("a")).toBe(false);
    expect(cell.closest("td").find("a")).toHaveLength(0);
    expectNotDrawnAsLink(classesOf(cell), "a record this app holds no address for");
    // It is a machine identifier: rendered in the table's own mono cell.
    expect(faceOf(classesOf(cell.closest("td")))).toEqual(["type-data"]);
  });

  it("renders the table's dash for a folded record it can name no way at all", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(foldedPairScript(), item.review_item_id);
    const $ = cheerio.load(markup);
    const row = $(`[data-evidence="${BIGBANG_ANONYMOUS.observation_id}"]`).closest("tr");

    expect(row.find("[data-record]")).toHaveLength(0);
    // The first cell is the record cell, and absence there is the app's one
    // dash — never a blank, never a borrowed id (LESSONS 1).
    expect(row.find("td").first().text().trim()).toBe(EM_DASH);
  });

  it("draws only the record cell as the way to the record", async () => {
    // One destination, one label (admin-window/BUG-0043): the fact cell states
    // a fact and goes nowhere; the record cell is the single route out of the
    // row to the record it is about.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(foldedPairScript(), item.review_item_id);
    const $ = cheerio.load(markup);
    const row = $(`[data-evidence="${BIGBANG_A.observation_id}"]`).closest("tr");

    const toRecord = row
      .find("a")
      .toArray()
      .map((anchor) => $(anchor).attr("href") ?? "")
      .filter((href) => href.startsWith("/records/"));
    expect(toRecord).toEqual([`/records/events/${STUCK_EVENT_A}`]);

    const factCell = row.find("[data-fact]");
    expect(factCell.is("a")).toBe(false);
    expectNotDrawnAsLink(classesOf(factCell), "the fact cell of a folded record");
    expectDrawnAsLinkAtRest(
      classesOf(row.find("a[data-record]")),
      "the record cell of a folded record",
    );
  });

  /**
   * The anatomy rule, as a comparison rather than as a pinned word: the same
   * fact renders the same way, and answers to the same name, on every screen
   * that draws it (LOOK_AND_FEEL's consistency rule; the Voice's glossary is
   * one name per concept). `/claims` has drawn `domain.field` and the record's
   * id as two separate columns since admin-window/TASK-0012; the review item
   * called the first of them `record` and drew the second nowhere.
   */
  it("names the fact and the record what /claims names them", async () => {
    const item = reviewItemSourcePattern();
    const evidence = await renderItem(foldedPairScript(), item.review_item_id);
    const claims = render(h(ClaimList, { rows: [CLAIMS_PAGE_LINE], label: "Claims" }));

    // The value spelled `domain.field` — one name for it, on both screens.
    expect(headerOverCell(evidence, "[data-fact]")).toBe(
      headerOverCell(claims, "[data-claim]"),
    );
    // The entity the claim is about — likewise.
    expect(headerOverCell(evidence, "[data-record]")).toBe(
      headerOverCell(claims, "a[data-claim-provenance]"),
    );
    // Non-vacuity: two different headers, neither of them empty.
    expect(headerOverCell(evidence, "[data-fact]").length).toBeGreaterThan(0);
    expect(headerOverCell(evidence, "[data-record]")).not.toBe(
      headerOverCell(evidence, "[data-fact]"),
    );
  });

  /**
   * The shape staging actually holds (QA, admin-window/BUG-0122): on item
   * `01a06287-...` three of the 91 folded claims SHARE an `external_ref` with
   * another claim -- one source record stuck on two different facts -- so the
   * record cell alone does not separate 91 rows into 91 (measured read-only:
   * 91 rows, 88 distinct `external_ref`). The row is a sentence, and it is the
   * whole sentence that has to be distinguishable: two claims about the same
   * record still differ, because they state different facts about it.
   */
  it("keeps two claims about ONE record apart by the fact each states", async () => {
    const sameRef = "vvG10Z_2MDlr-4";
    const ticketUrl = foldedPerformer({
      observation_id: "01920000-0000-7000-8000-000000000321",
      entity_id: null,
      external_ref: sameRef,
      field: "ticket_url",
      value: "https://www.ticketmaster.com/sean-healy",
    });
    const performers = foldedPerformer({
      observation_id: "01920000-0000-7000-8000-000000000322",
      entity_id: null,
      external_ref: sameRef,
    });
    const item = reviewItemSourcePattern({
      evidence: [ticketUrl.observation_id, performers.observation_id],
    });
    const markup = await renderItem(
      {
        [T.reviewItems]: { data: item },
        [T.observations]: [{ data: [ticketUrl, performers] }, { data: [] }],
        [T.sources]: { data: [BANDSINTOWN] },
        [T.pendingClaims]: [{ data: [] }, { data: [] }],
        ...SETTLEMENT_ABSENT,
      },
      item.review_item_id,
    );
    const a = rowOf(markup, ticketUrl.observation_id);
    const b = rowOf(markup, performers.observation_id);

    // Same record, named the same way on both rows...
    expect(a.record).toBe(sameRef);
    expect(b.record).toBe(sameRef);
    // ...and still two distinguishable rows, by the fact each one states.
    expect(a.fact).not.toBe(b.fact);
    expect(a.text).not.toBe(b.text);
  });

  /**
   * The record cell is the one place this surface renders a FOREIGN string --
   * a reference the source published, not an id this app minted (STACK.md's
   * trust boundary: this service is internet-reachable and holds the service
   * role). It is rendered verbatim, as text, and it stays inside its own cell
   * and its own attribute.
   */
  it("renders a source's reference as text, whatever the source published", async () => {
    const hostile = '<script>alert(1)</script>" onmouseover="alert(2)';
    const claim = foldedPerformer({
      observation_id: "01920000-0000-7000-8000-000000000323",
      entity_id: null,
      external_ref: hostile,
    });
    const item = reviewItemSourcePattern({ evidence: [claim.observation_id] });
    const markup = await renderItem(
      {
        [T.reviewItems]: { data: item },
        [T.observations]: [{ data: [claim] }, { data: [] }],
        [T.sources]: { data: [BANDSINTOWN] },
        [T.pendingClaims]: [{ data: [] }, { data: [] }],
        ...SETTLEMENT_ABSENT,
      },
      item.review_item_id,
    );
    const $ = cheerio.load(markup);
    const cell = $(`[data-evidence="${claim.observation_id}"]`).closest("tr").find("[data-record]");

    // Verbatim, and as TEXT: LESSONS 5's "render verbatim in mono" does not
    // mean "render as markup".
    expect(cell.text()).toBe(hostile);
    expect(cell.attr("data-record")).toBe(hostile);
    // Neither the element nor the attribute was broken out of.
    expect($("script")).toHaveLength(0);
    expect($("[onmouseover]")).toHaveLength(0);
  });

  it("keeps the per-fact views out of it: they are about one record already", async () => {
    // Criterion 5: `ConflictEvidence` and `StuckFactEvidence` are each about a
    // single record, which the item header names — a record column there would
    // repeat it on every row.
    for (const [shape, script, id] of [
      ["the conflict item", conflictScript(), reviewItemDataConflict().review_item_id],
      ["the stuck fact item", stuckScript(), reviewItemEntityLink().review_item_id],
    ] as const) {
      const $ = cheerio.load(await renderItem(script, id));
      expect($("[data-evidence]").length, `${shape} renders evidence`).toBeGreaterThan(0);
      expect($("[data-record]"), `${shape} grew a record column`).toHaveLength(0);
      expect($("[data-fact]"), `${shape} grew a fact column`).toHaveLength(0);
    }
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

  /**
   * The dial's window line, by the rule every other window on the app is
   * graded by (ARCHITECTURE.md §4.3): the line follows the READ, so its
   * absence means "this read did not happen" and never "this read found
   * nothing".
   *
   * It is graded HERE and not in `tests/offline/absence/pages.test.ts` for the
   * reason that file's `WINDOWED` comment gives: the dial renders only for a
   * source-pattern item and that file's populated fixture builds a fact item,
   * so its two legs cannot reach this surface. The dial published no
   * `data-window` hook at all before admin-window/DEBT-0006 and no test read
   * it after, which is the state `/queues` was in when DEBT-0006 was filed
   * (qa-DEBT-0006, 2026-09-04).
   */
  it("states the dial's window on a read that happened, and on no other state", async () => {
    const item = reviewItemSourcePattern();

    const healthy = cheerio.load(await renderItem(patternScript(), item.review_item_id));
    const line = healthy('[data-dial] [data-window="awaiting_row"]');
    expect(line, "the dial published no window line on a healthy read").toHaveLength(1);
    // A SCAN: bounded in rows and in time, so it states all five facts.
    for (const hook of [
      "data-window-since",
      "data-window-until",
      "data-window-limit",
      "data-window-held",
      "data-window-truncated",
    ]) {
      expect(line.attr(hook), `the dial's window published no ${hook}`).toBeDefined();
    }

    // The trend read refused, both ways. A window line here would describe a
    // table the page could not read, and `truncated="false"` would be a
    // confident boolean about a read that returned nothing.
    for (const [state, response] of [
      ["not provisioned", { error: tableNotInSchemaCache(T.observations) }],
      ["failed", { error: transportFailure() }],
    ] as const) {
      const refused = cheerio.load(
        await renderItem(
          patternScript({ [T.observations]: [{ data: [CLAIM_B] }, response] }),
          item.review_item_id,
        ),
      );
      expect(
        refused("[data-window]"),
        `the dial still stated a window over a trend read that ${state}`,
      ).toHaveLength(0);
    }
  });
});

/* ── the close, and the recommendation slot ──────────────────────────────── */

/** The three shapes, each with its own healthy script and its own id. */
const SHAPED = [
  ["conflict", conflictScript, reviewItemDataConflict().review_item_id],
  ["stuck", stuckScript, reviewItemEntityLink().review_item_id],
  ["pattern", patternScript, reviewItemSourcePattern().review_item_id],
] as const;

/**
 * The sweeps above and below iterate `SHAPED`, and `SHAPED` is HAND-LISTED —
 * the compiler's `Record<Shape, …>` in `shape-views.tsx` forces a fourth VIEW
 * to exist, but nothing forces a fourth ENTRY here, so every per-shape rule in
 * this file would silently keep grading three (QA, admin-window/BUG-0128).
 * This is the forcing function: the day `Shape` gains a member, the sweep list
 * is red until it grows, and the fixtures are checked to be the shapes they
 * are named for rather than three spellings of one.
 */
describe("the per-shape sweeps grade every Shape the app declares", () => {
  it("has one entry per Shape, and one fixture per shape", () => {
    expect(SHAPED).toHaveLength(SHAPES.length);
    const graded = [
      reviewItemDataConflict(),
      reviewItemEntityLink(),
      reviewItemSourcePattern(),
    ].map(shapeOf);
    expect([...graded].sort()).toEqual([...SHAPES].sort());
  });
});

describe("the close, with the verdict log absent", () => {
  it("renders no control at all, on any shape", async () => {
    // The graded-first state and the one `main` deploys against: the function
    // that settles is not installed, so the slot offers nothing — no verdict
    // action, no note field, and no disabled button standing in for one
    // (spec §10's one forbidden move is a workaround; this is the absence of
    // one).
    for (const [name, script, id] of SHAPED) {
      const $ = cheerio.load(await renderItem(script(), id));
      for (const control of ["button", "form", "input", "select", "textarea"]) {
        expect($(control), `${name}: ${control}`).toHaveLength(0);
      }
      expect($("[data-close-action]"), name).toHaveLength(0);
    }
  });

  it("leaves the signal item's own anatomy exactly as M1 shipped it", async () => {
    // The shape whose dispositions M2 fills is the one staging really holds,
    // so this is where a filled action list could regress the page: with the
    // verdict log absent the close offers neither control, and everything
    // above it renders as it did before there were any (spec §6's anatomy).
    const item = reviewItemSourcePattern();
    const markup = await renderItem(patternScript(), item.review_item_id);
    const $ = cheerio.load(markup);

    expect($("[data-close-action]")).toHaveLength(0);
    expect(
      $(`[data-surface="${CLOSE_HOOK}"]`).find(`[data-not-provisioned="${T.verdicts}"]`),
    ).toHaveLength(1);

    // The machine's own sentence, verbatim — it is the item.
    expect(textOf(markup)).toContain(item.summary);
    expect($("[data-severity]").attr("data-severity")).toBe(item.severity);
    expect($("[data-folds]").attr("data-folds")).toBe(String(item.folded_count));
    // The fold count is READ as a number beside the item: "asked again ×N".
    expect($("[data-folds]").text()).toContain(String(item.folded_count));
    // An age is relative, with the absolute in the title (Voice bar 6).
    const titles = $("[title]")
      .toArray()
      .map((element) => $(element).attr("title") ?? "");
    expect(titles.some((title) => title.includes(item.opened_at.slice(0, 10)))).toBe(
      true,
    );
  });

  it("names the absent object in the close slot, as an absence and not a failure", async () => {
    for (const [name, script, id] of SHAPED) {
      const markup = await renderItem(script(), id);
      const $ = cheerio.load(markup);
      const close = $(`[data-surface="${CLOSE_HOOK}"]`);
      expect(close, name).toHaveLength(1);
      expect(close.find('[data-state="not_provisioned"]'), name).toHaveLength(1);
      // The object, in the spelling the query used, standing alone in its own
      // element — and never inside a red error line.
      expect(close.find(`[data-not-provisioned="${T.verdicts}"]`), name).toHaveLength(1);
      expect(close.find('[role="alert"]'), name).toHaveLength(0);
      // The rest of the detail is untouched: both M1 surfaces still render.
      expect(surfaceHooks(markup, HOOKS), name).toEqual({
        counts: oneEach(HOOKS),
        nested: [],
      });
    }
  });

  it("renders the close as its own section, and the recommendation slot as nothing", async () => {
    // The anatomy is three parts now (spec §6): what happened, the evidence,
    // and the close. The recommendation slot between 1 and 2 still renders
    // nothing at all — its producer is parked.
    const $ = cheerio.load(
      await renderItem(conflictScript(), reviewItemDataConflict().review_item_id),
    );
    expect($("h2")).toHaveLength(3);
  });
});

describe("the close, with the verdict log present", () => {
  /**
   * What each shape offers once the log is there, as the shape modules stand
   * today — each filled by its own ticket, in its own worktree.
   *
   * `data_conflict` is filled (campaign admin-window/TASK-0050): spec §7's
   * three, with one `choose_claimed_value` per evidence card, and the conflict
   * script resolves two. The source-pattern SIGNAL is filled too (campaign
   * admin-window/TASK-0051): it takes no verdict and closes with a
   * disposition, so it offers those two and nothing that carries a value. The
   * `entity_link` FACT item is filled too (campaign admin-window/TASK-0056),
   * and on THIS script it offers `settle` alone: its picker needs a whole
   * reference fact, and the stuck fixture's `entity_id` is null — the ordinary
   * state of an item opened before its canonical row exists, and the reason
   * the page makes no window read for it at all. The picker beside the settle
   * control is graded on a linkable fixture in
   * `tests/offline/review-item/link-actions.test.ts`.
   */
  const OFFERED: Readonly<Record<string, readonly string[]>> = {
    conflict: [
      "choose_claimed_value",
      "choose_claimed_value",
      "supply_value",
      "keep_current",
    ],
    stuck: ["settle"],
    pattern: ["fixed", "wont_fix"],
  };

  it("renders the note field and this shape's actions, on every shape", async () => {
    for (const [name, script, id] of SHAPED) {
      const $ = cheerio.load(await renderItem(withSettlement(script()), id));
      const close = $(`[data-surface="${CLOSE_HOOK}"]`);
      expect(close.find("[data-close-note]"), name).toHaveLength(1);
      expect(
        close
          .find("[data-close-action]")
          .toArray()
          .map((element) => $(element).attr("data-close-action")),
        name,
      ).toEqual(OFFERED[name]);
      // Every control on offer is live: nothing rests disabled, on any shape.
      // A disabled control standing in for one this database cannot perform is
      // exactly what the not-provisioned card exists to render instead.
      expect(close.find("button[disabled]"), name).toHaveLength(0);
      // A read that answered is not an emptiness and not an absence.
      expect(close.find("[data-state]"), name).toHaveLength(0);
    }
  });

  it("says the signal's two names on the page as hooks, and prettifies neither", async () => {
    // WHICH actions the signal offers is the table above; this is the other
    // half, and the one only a rendered page can answer. The frame's rule is
    // that the operator reads copy and the machine's name is the hook, so what
    // the page owes here is the name reaching it VERBATIM — never uppercased
    // by a type step, never Title Cased into prose (§11, LESSONS 5). The shape
    // staging really holds is this one (campaign admin-window/TASK-0051).
    const id = reviewItemSourcePattern().review_item_id;
    const markup = await renderItem(withSettlement(patternScript()), id);
    const $ = cheerio.load(markup);
    const close = $(`[data-surface="${CLOSE_HOOK}"]`);

    expect(OFFERED.pattern).toHaveLength(2);
    for (const action of OFFERED.pattern) {
      expect(markup, action).toContain(`data-close-action="${action}"`);
      // The control says the operator's words, not the machine's name.
      const said = close.find(`[data-close-action="${action}"]`).text();
      expect(said.trim().length, action).toBeGreaterThan(0);
    }
    expect(uppercasedIdentifiers(markup)).toEqual([]);
    for (const prettified of ["WONT_FIX", "Wont Fix", "Won't fix"]) {
      expect(markup, prettified).not.toContain(prettified);
    }
  });

  it("leaves every other part of the detail exactly as it was", async () => {
    for (const [name, script, id] of SHAPED) {
      const markup = await renderItem(withSettlement(script()), id);
      expect(surfaceHooks(markup, HOOKS), name).toEqual({
        counts: oneEach(HOOKS),
        nested: [],
      });
      expect(cheerio.load(markup)('[data-state="error"]'), name).toHaveLength(0);
    }
  });
});

/* ── where the close sits ────────────────────────────────────────────────── */

/**
 * The close is reachable without exhausting the evidence — campaign
 * admin-window/BUG-0096.
 *
 * The designer's early walk measured the close slot at y=3,781 on the one real
 * review item: `what_happened` 128px tall, then 3,483px of evidence — 91
 * folded records and the source's trend — and only then the controls that
 * settle the item. Four screenfuls of scrolling to reach the thing the page
 * exists for, and FEAT-0010 fills that slot with three controls.
 *
 * The bar is LOOK_AND_FEEL's ("Review item detail — the evidence pair, and the
 * close beside it"), and the ticket allows three placements: beside, above, or
 * pinned. This build renders the close ABOVE — first in document order — and
 * these tests grade THAT, structurally, because document order is what a
 * browser, the live oracle and this offline render all agree on without any
 * test reading a stylesheet.
 *
 * The load-bearing half is the SECOND test: the placement is decided by the
 * page, once, so it cannot depend on how tall a shape's evidence happens to
 * be. A fix living inside a view would pass the first test and fail that one.
 */
describe("the close is reachable without exhausting the evidence", () => {
  it("comes before the evidence on every shape, in both states of the close", async () => {
    for (const [name, script, id] of SHAPED) {
      for (const [state, built] of [
        ["absent", script()],
        ["present", withSettlement(script())],
      ] as const) {
        const where = `${name}/${state}`;
        const markup = await renderItem(built, id);
        const order = surfaceOrder(markup);

        // Each name still answers for exactly one element — the whole point of
        // `data-surface` (`stateOf` refuses a selector matching two).
        expect(order.filter((one) => one === CLOSE_HOOK), where).toHaveLength(1);
        expect(order.filter((one) => one === "evidence"), where).toHaveLength(1);
        expect(
          order.indexOf(CLOSE_HOOK),
          `${where}: the close precedes the evidence it closes`,
        ).toBeLessThan(order.indexOf("evidence"));

        // Neither surface is inside the other: the close is its own section,
        // graded by its own read, and the evidence body is untouched.
        const $ = cheerio.load(markup);
        expect($(`[data-surface="${CLOSE_HOOK}"]`).find(EVIDENCE_HOOK), where).toHaveLength(0);
        expect($(EVIDENCE_HOOK).find(`[data-surface="${CLOSE_HOOK}"]`), where).toHaveLength(0);
      }
    }
  });

  it("places it the same way when the signal folds a hundred records", async () => {
    // The long twin of the pattern script: 104 resolved claims instead of one,
    // which is the shape that produced the 3,483px measurement. The placement
    // must not turn on the height of what follows it.
    const short = await renderItem(patternScript(), reviewItemSourcePattern().review_item_id);
    const long = await renderItem(
      longPatternScript(),
      reviewItemSourcePattern().review_item_id,
    );

    // The fixture really is long: every folded record resolved and rendered.
    expect(evidenceIds(long)).toHaveLength(FOLDED.length);
    expect(evidenceIds(long).length).toBeGreaterThan(100);
    expect(evidenceIds(short)).toHaveLength(1);
    expect(cheerio.load(long)("[data-unresolved]")).toHaveLength(0);

    for (const [where, markup] of [
      ["short", short],
      ["long", long],
    ] as const) {
      const order = surfaceOrder(markup);
      expect(order.indexOf(CLOSE_HOOK), where).toBeLessThan(order.indexOf("evidence"));
    }

    // Same relative order, both heights — asserted as the sequence itself so a
    // change that only reorders the tall page is caught too.
    expect(surfaceOrder(long)).toEqual(surfaceOrder(short));

    // And the evidence view kept its own anatomy through the move: the
    // source-pattern view is still its table of folded records with the
    // source's dial beside it (LOOK_AND_FEEL, the evidence pair).
    const $ = cheerio.load(long);
    expect($(EVIDENCE_HOOK).find('[data-evidence-view="source-pattern"]')).toHaveLength(1);
    expect($(EVIDENCE_HOOK).find("[data-dial]")).toHaveLength(1);
    expect($(EVIDENCE_HOOK).find("table").length).toBeGreaterThan(0);
  });

  it("keeps the contended fact's pair in its fixed order, canonical rightmost", async () => {
    // The other half of the same guarantee (criterion 3): moving the close
    // must not have touched what the evidence pair renders or the order it
    // renders it in — contenders left, the current canonical value last.
    const item = reviewItemDataConflict();
    const markup = await renderItem(conflictScript(), item.review_item_id);
    const cards = pairCards(markup);
    const order = surfaceOrder(markup);

    expect(cards).toHaveLength(item.evidence.length + 1);
    expect(cards.at(-1)).toContain(String(CLAIM_A.value));
    expect(cards.at(-1)).toContain(DECISION.tier_at_apply);
    // …and the pair itself is still inside the evidence surface, below the
    // close rather than hoisted into it.
    expect(cheerio.load(markup)(EVIDENCE_HOOK).find("[data-pair]")).toHaveLength(1);
    expect(order.indexOf(CLOSE_HOOK)).toBeLessThan(order.indexOf("evidence"));
  });
});

/* ── the three counts, and what each one counts ──────────────────────────── */

/**
 * **admin-window/BUG-0124** — the three figures on the signal's page, and the
 * completeness claim over the smallest of them.
 *
 * Both M2 user-sims (2026-09-09) read the same screen and could not reconcile
 * `asked again ×700` in the header, `stuck records 769` on the dial and the 91
 * rows the evidence table listed under a lede saying the rows were every
 * record the signal had folded. One of them said outright that, asked to
 * summarise the signal in one line, they would have quoted the wrong number.
 * The dial was already right — it prints its scope under its figure — so what
 * these tests grade is the other two: every figure states what it counts, the
 * fold count is stated against the count of what the block below lists, and no
 * sentence claims a completeness this app never read.
 *
 * The words are the designer's; what is asserted is that each figure wears a
 * noun (`counted`, the app's own formatter — never a copy of the sentence),
 * that the second figure equals what the block below really lists, and that no
 * third number appears between them.
 */

/** The header's fold sentence: its text, its hook, and the figures in it. */
function foldScopeOf(markup: string) {
  const $ = cheerio.load(markup);
  const stated = $("[data-fold-scope]");
  expect(stated, "the header states what its fold count counts").toHaveLength(1);
  const text = stated.text().replace(/\s+/g, " ").trim();
  return {
    text,
    /** The evidence-id count it published, or undefined on a read that did not happen. */
    evidenceIds: stated.attr("data-fold-evidence-ids"),
    /** Every number in the sentence, in order. */
    // A digit-led run, so the sentence's commas are not read as zeroes.
    figures: (text.match(/\d[\d,]*/g) ?? []).map((figure) =>
      Number(figure.replace(/,/g, "")),
    ),
  };
}

/**
 * The accounting sentence's two figures, read from the sentence's OWN element.
 *
 * `accountingIn` above reads the page's whole text, which is safe on the two
 * fact shapes and not on this one: the dial's trend table ends in a bare `0`
 * immediately above the sentence, so a page-wide match reads `2026-09-090` +
 * `1 of 1` as `901 of 1`. Same parse, narrower input.
 */
function accountingOfBlock(markup: string): [number, number] {
  const block = cheerio.load(markup)("[data-evidence-accounting]");
  expect(block, "the evidence block states its accounting").toHaveLength(1);
  return accountingIn(block.html() ?? "");
}

/** How many evidence ids the block below really lists: rows, plus ids named unresolved. */
function idsListed(markup: string): number {
  return evidenceIds(markup).length + attrsOf(markup, "[data-unresolved]").length;
}

/**
 * The trap fixture: the fold count, the evidence-id count and the dial's
 * stuck-record count are all the SAME number.
 *
 * Three ones on one page is the case a fix that merely printed the numbers
 * closer together would pass while still being unreadable — the sims' actual
 * complaint is that a figure says nothing about its population, and where the
 * populations coincide only the nouns can tell them apart. One fold, one
 * evidence id resolving to one claim, and one `awaiting_row` claim for this
 * source in the dial's own window.
 */
function coincidingScript(overrides: Script = {}): Script {
  const item = reviewItemSourcePattern({
    folded_count: 1,
    evidence: [ID.observationB],
  });
  return {
    [T.reviewItems]: { data: item },
    // The evidence read, then the dial's own windowed scan.
    [T.observations]: [{ data: [CLAIM_B] }, { data: [CLAIM_B] }],
    [T.sources]: { data: [BANDSINTOWN] },
    [T.pendingClaims]: [
      { data: [] },
      {
        data: [
          pendingClaimRow("awaiting_row", {
            observation_id: ID.observationB,
            source_id: ID.sourceBandsintown,
          }),
        ],
      },
    ],
    ...SETTLEMENT_ABSENT,
    ...overrides,
  };
}

describe("every figure says what it counts", () => {
  it("states what a fold is, and the evidence-id count it stands over", async () => {
    // The staging-shaped signal: 700 folds over an evidence array of a
    // different size entirely (`longPatternScript`, 104 ids).
    const item = reviewItemSourcePattern();
    const markup = await renderItem(longPatternScript(), item.review_item_id);
    const $ = cheerio.load(markup);
    const scope = foldScopeOf(markup);

    // Both figures, each wearing its own noun (LOOK_AND_FEEL Voice bar 6).
    expect(scope.text).toContain(counted(700, "fold"));
    expect(scope.text).toContain(counted(idsListed(markup), "evidence id"));

    // The second figure IS the population the block below lists — read off
    // the markup, so the sentence cannot drift from the table under it.
    expect(idsListed(markup)).toBe(FOLDED.length);
    expect(Number(scope.evidenceIds)).toBe(idsListed(markup));

    // …and there is no third number between them: no ratio, no percentage, no
    // score (spec criterion 5; VISION non-goal "no severity formula").
    expect([...new Set(scope.figures)].sort((a, b) => a - b)).toEqual(
      [700, FOLDED.length].sort((a, b) => a - b),
    );
    expect(scope.text).not.toContain("%");

    // The machine's own number is still rendered verbatim beside the sentence.
    expect($("[data-folds]").attr("data-folds")).toBe("700");
    expect($("[data-folds]").text()).toContain("700");
  });

  it("says so plainly when the two counts are the same number", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(coincidingScript(), item.review_item_id);
    const scope = foldScopeOf(markup);

    expect(idsListed(markup)).toBe(1);
    expect(Number(scope.evidenceIds)).toBe(1);
    // One fold, one evidence id — and the singular noun on each, so neither
    // figure reads as the other one (admin-window/BUG-0046's rule, applied to
    // the pair this ticket relates).
    expect(scope.text).toContain(counted(1, "fold"));
    expect(scope.text).toContain(counted(1, "evidence id"));
    expect([...new Set(scope.figures)]).toEqual([1]);
  });

  it("keeps the third figure on its own scope when all three coincide", async () => {
    const item = reviewItemSourcePattern();
    const markup = await renderItem(coincidingScript(), item.review_item_id);
    const $ = cheerio.load(markup);

    // The dial reads the same number as the other two, from a different read
    // entirely — the source's stuck records in ITS window, not this item's
    // folds and not this item's evidence.
    const dial = $("[data-dial]").text().replace(/\s+/g, " ").trim();
    expect(dial).toContain("1");
    expect(dial).toMatch(/stuck records/);
    // Its own scope is stated with it: the window it was read over, published
    // as the hook the §4.3 rule grades (`data-window`), and named in words
    // beside the figure.
    expect($('[data-dial] [data-window="awaiting_row"]')).toHaveLength(1);
    expect(dial).toMatch(/window/i);

    // And the evidence block's own accounting still accounts for the ids it
    // looked at, untouched by this ticket.
    expect(accountingOfBlock(markup)).toEqual([1, 1]);
  });

  it("states no evidence-id count when that read did not happen", async () => {
    // The rule a window line follows (ARCHITECTURE.md §4.3): a count over a
    // read that never returned is not published at all. The fold count is the
    // machine's own column and still renders, with what a fold IS.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(
      patternScript({
        [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      }),
      item.review_item_id,
    );
    const $ = cheerio.load(markup);
    const scope = foldScopeOf(markup);

    expect(scope.evidenceIds).toBeUndefined();
    // No figure at all in the sentence: the fold count is stated once, in the
    // mono span that carries the column, and nothing counts rows nobody read.
    expect(scope.figures).toEqual([]);
    expect(scope.text.length).toBeGreaterThan(0);
    expect($("[data-folds]").text()).toContain(String(item.folded_count));
  });

  it("states it on every shape, inside the header surface", async () => {
    for (const [name, script, id] of SHAPED) {
      const $ = cheerio.load(await renderItem(script(), id));
      expect($(`${HEADER_HOOK} [data-fold-scope]`), name).toHaveLength(1);
    }
  });
});

/**
 * The retired sentence, kept as the input the guard below MUST flag
 * (LESSONS 3: a guard that never saw a failing spelling passes vacuously).
 * It is the string the source-pattern lede carried until admin-window/BUG-0124,
 * and `! grep -q` over `shape-views.tsx` is the other half of the same check.
 *
 * Module scope so the rule has ONE spelling in this file: the shape whose lede
 * this ticket rewrote and the two shapes it did not are graded by the same
 * regex (QA, admin-window/BUG-0124).
 */
const RETIRED_CLAIM = "Every record folded into this signal is listed here";
const CLAIMS_A_TOTAL = /\b(every|all|complete|entire)\b/i;

describe("the lede claims only what the read supports", () => {
  it("flags the claim it is banning", () => {
    expect(RETIRED_CLAIM).toMatch(CLAIMS_A_TOTAL);
  });

  it("says what the table holds, and nothing about the folds", async () => {
    // 700 folds over 104 evidence ids: a lede calling the rows below every
    // folded record is false HERE, and unknowable everywhere else —
    // `folded_count` and `evidence` are two columns this app never compares.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(longPatternScript(), item.review_item_id);
    const lede = cheerio.load(markup)(
      '[data-evidence-view="source-pattern"] [data-lede]',
    );

    expect(lede, "the source-pattern view leads with a lede").toHaveLength(1);
    const text = lede.text().replace(/\s+/g, " ").trim();
    expect(text).not.toMatch(CLAIMS_A_TOTAL);
    // It names the population instead — the same noun the header states the
    // fold count against and the accounting sentence accounts for.
    expect(text).toContain("evidence ids");
    // Nothing in it is a figure: the counts are stated where they are read.
    expect(text).not.toMatch(/\d/);
  });

  it("leaves the accounting sentence and the dial's own line alone", async () => {
    // Criterion 4: this ticket adds a sentence, it does not reword the two
    // that were already right.
    const item = reviewItemSourcePattern();
    const markup = await renderItem(longPatternScript(), item.review_item_id);
    const listed = idsListed(markup);

    expect(accountingOfBlock(markup)).toEqual([listed, listed]);
    expect(cheerio.load(markup)('[data-dial] [data-window="awaiting_row"]')).toHaveLength(
      1,
    );
  });
});

/* ── QA attack (admin-window/BUG-0124) ───────────────────────────────────────
 *
 * The three arms of the fold sentence the fix's own fixtures do not reach, and
 * the completeness rule read across ALL THREE shapes rather than the one whose
 * lede was rewritten. Each assertion is about a POPULATION the markup itself
 * carries — the ids the block lists, the figures the sentence prints — never
 * about the words chosen to carry them.
 */

/** The item's evidence array, and how many DISTINCT ids are in it. */
function patternWith(ids: readonly string[], folds: number) {
  return reviewItemSourcePattern({ evidence: [...ids], folded_count: folds });
}

describe("the fold sentence over reads the fix's fixtures do not reach", () => {
  it("publishes a real 0 and invents no second figure when the item carries no evidence id", async () => {
    // The read HAPPENED and found nothing — §4.3's distinction between an
    // empty window and an unmade one. The hook must say `0`, not vanish the
    // way it does on a refused read, and the sentence may print no figure the
    // page did not read.
    const item = patternWith([], 700);
    const markup = await renderItem(
      patternScript({
        [T.reviewItems]: { data: item },
        [T.observations]: [{ data: [] }, { data: [] }],
      }),
      item.review_item_id,
    );
    const scope = foldScopeOf(markup);

    expect(idsListed(markup)).toBe(0);
    expect(scope.evidenceIds).toBe("0");
    expect(scope.text).toContain(counted(700, "fold"));
    // Whatever spelling the absence takes, every figure in the sentence is one
    // of the two counts this page actually holds.
    for (const figure of scope.figures) expect([700, 0]).toContain(figure);
    expect(accountingOfBlock(markup)).toEqual([0, 0]);
  });

  it("counts what the block LISTS, never what the evidence array stores", async () => {
    // The array appends an id every time a claim folds in again, so `stored`
    // and `distinct` come apart — 4 stored, 2 listed. The header's second
    // figure is the population below it; the stored count is the accounting
    // sentence's to state, and it does.
    const listed = FOLDED.slice(0, 2);
    const item = patternWith(
      listed.flatMap((claim) => [claim.observation_id, claim.observation_id]),
      700,
    );
    const markup = await renderItem(
      patternScript({
        [T.reviewItems]: { data: item },
        [T.observations]: [{ data: listed }, { data: [] }],
      }),
      item.review_item_id,
    );
    const scope = foldScopeOf(markup);

    expect(idsListed(markup)).toBe(2);
    expect(scope.evidenceIds).toBe("2");
    expect(scope.text).toContain(counted(2, "evidence id"));
    // The stored 4 is not smuggled into the header as a third population.
    expect(scope.figures).not.toContain(4);
    expect([...new Set(scope.figures)].sort((a, b) => a - b)).toEqual([2, 700]);
    expect(accountingOfBlock(markup)).toEqual([2, 2]);
  });

  it("states both figures where the folds are FEWER than the ids listed", async () => {
    // The staging signal folds far more often than it lists; the opposite
    // order must read as two counts too, not as one narrowing the other.
    const listed = FOLDED.slice(0, 3);
    const item = patternWith(listed.map((claim) => claim.observation_id), 2);
    const markup = await renderItem(
      patternScript({
        [T.reviewItems]: { data: item },
        [T.observations]: [{ data: listed }, { data: [] }],
      }),
      item.review_item_id,
    );
    const scope = foldScopeOf(markup);

    expect(idsListed(markup)).toBe(3);
    expect(scope.evidenceIds).toBe("3");
    expect(scope.text).toContain(counted(2, "fold"));
    expect(scope.text).toContain(counted(3, "evidence id"));
    expect([...new Set(scope.figures)].sort((a, b) => a - b)).toEqual([2, 3]);
  });
});

describe("no shape's lede claims a completeness its read cannot support", () => {
  /** Every lede the shape's evidence view renders, as text. */
  async function ledesOf(script: Script, id: string): Promise<string[]> {
    const $ = cheerio.load(await renderItem(script, id));
    return $("[data-lede]")
      .toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim());
  }

  it("holds on all three shapes", async () => {
    // The rule is graded ONCE, over every shape a `Shape` can be — the
    // `entity_link` fact view folded in here when its own lede stopped
    // claiming a total (admin-window/BUG-0128), so a fourth shape's lede is
    // graded the day the compiler forces a fourth view into the map.
    for (const [name, script, id] of SHAPED) {
      const ledes = await ledesOf(script(), id);
      expect(ledes.length, name).toBeGreaterThan(0);
      for (const text of ledes) expect(text, name).not.toMatch(CLAIMS_A_TOTAL);
    }
  });

  /**
   * **admin-window/BUG-0128** — the fixture on which the retired sentence was
   * not merely unknowable but false: two evidence ids, one of which names no
   * claim this database holds. The lede said every claim the record held was
   * below while the accounting under it said one of two resolved and the
   * unresolved line printed the id that resolved to nothing.
   *
   * What is asserted is the same pair the source-pattern lede is held to: the
   * lede names the POPULATION the block actually carries, and carries no
   * figure of its own — the counts belong to the sentences that read them,
   * which this test reads off the same markup.
   */
  it("names the population on the fact shape where an evidence id resolved to nothing", async () => {
    const orphan = "01920000-0000-7000-8000-000000000999";
    const item = reviewItemEntityLink({
      evidence: [ID.observationB, orphan],
      folded_count: 700,
    });
    const script = stuckScript({ [T.reviewItems]: { data: item } });
    const markup = await renderItem(script, item.review_item_id);

    // The page's own read, stated on the page: two ids, one claim, one id
    // naming nothing this database holds.
    expect(accountingIn(markup)).toEqual([1, 2]);
    expect(attrsOf(markup, "[data-unresolved]")).toEqual([orphan]);

    const lede = cheerio.load(markup)(
      '[data-evidence-view="stuck-fact"] [data-lede]',
    );
    expect(lede, "the entity_link fact view leads with a lede").toHaveLength(1);
    const text = lede.text().replace(/\s+/g, " ").trim();
    // It names what the block holds — the claims behind this item's evidence
    // ids — the same population the accounting sentence above accounts for.
    expect(text).toContain("evidence ids");
    // Nothing in it is a figure: neither the 2 ids, the 1 claim nor the 700
    // folds is the lede's to state.
    expect(text).not.toMatch(/\d/);
  });
});

/**
 * **admin-window/BUG-0130** — a lede may not send the operator to a table this
 * page did not render.
 *
 * The rule is structural, not a word ban: it reads the view's own markup and
 * fires only when the lede says "table" while `[data-evidence-view]` carries
 * none — which happens exactly when no evidence id resolved and `ClaimRows`
 * rendered `Empty` instead of `DataTable`. In the healthy state the same read
 * finds the table and the rule passes.
 *
 * Graded ONCE, over every `Shape` the app declares and BOTH states of the
 * evidence block — QA's strict pin is folded in here rather than left beside a
 * healthy-only sweep, which is what let the empty state ship ungraded twice
 * (admin-window/BUG-0124, admin-window/BUG-0128). The word is conditioned, not
 * banned: the healthy leg asserts that a lede naming a table really is
 * rendered over one, so a copy change that drops the noun everywhere cannot
 * turn this green vacuously.
 */
describe("no lede sends the operator to a table the page did not render", () => {
  /** One view's lede, and what the view really rendered under it. */
  async function viewOf(script: Script, id: string) {
    const view = cheerio.load(await renderItem(script, id))("[data-evidence-view]");
    return {
      lede: view.find("[data-lede]").text().replace(/\s+/g, " ").trim(),
      tables: view.find("table").length,
      empties: view.find("[data-state='empty']").length,
    };
  }

  /**
   * The same item, with every evidence read answering with no claim.
   *
   * The item is the shape's own fixture, untouched: only the reads behind it
   * are emptied, so each shape reaches the empty state the way the database
   * produces it — ids that name no row this database holds.
   */
  function nothingResolves(script: Script): Script {
    return {
      ...script,
      [T.observations]: [{ data: [] }, { data: [] }],
      [T.pendingClaims]: { data: [] },
    };
  }

  it("names a table only where the block rendered one, on every shape, in both states", async () => {
    let namesATable = 0;
    for (const [name, script, id] of SHAPED) {
      // Healthy: the word and the element agree, so a red on the empty leg is
      // the empty state's doing and not this rule banning a noun.
      const held = await viewOf(script(), id);
      expect(held.lede.length, `${name}/held`).toBeGreaterThan(0);
      expect(held.tables, `${name}/held`).toBeGreaterThan(0);
      if (/\btable\b/i.test(held.lede)) namesATable += 1;

      // The state this rule is about: the empty card stands where the table
      // would be, saying in the app's own words that there are no claims.
      const bare = await viewOf(nothingResolves(script()), id);
      expect(bare.empties, `${name}/bare`).toBeGreaterThan(0);
      expect(bare.tables, `${name}/bare`).toBe(0);
      // The view still leads with a sentence — the fix is words that follow
      // the read, never a lede that disappears with its table.
      expect(bare.lede.length, `${name}/bare`).toBeGreaterThan(0);
      expect(bare.lede, `${name}/bare`).not.toMatch(/\btable\b/i);
    }
    // The antecedent is live: some shipped lede really does name its table in
    // the held state, so the empty leg above is a condition and not a ban.
    expect(namesATable).toBeGreaterThan(0);
  });
});

describe("the recommendation slot renders nothing", () => {
  it("says neither word, on any shape, in either state", async () => {
    // Spec §6: the slot exists in the anatomy and its producer is parked. The
    // assertion is on the DELIVERED markup, both states of the close, so a
    // scaffolded heading or hint cannot slip in with the actions later.
    for (const [name, script, id] of SHAPED) {
      for (const [state, built] of [
        ["absent", script()],
        ["present", withSettlement(script())],
      ] as const) {
        const markup = (await renderItem(built, id)).toLowerCase();
        expect(markup, `${name}/${state}`).not.toContain("recommend");
        expect(markup, `${name}/${state}`).not.toContain("recommendation");
      }
    }
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

  it("draws the whole of each out-link's words in the link's one ink", async () => {
    /*
     * **admin-window/BUG-0117.** `ItemLink.value` is "WHAT it is narrowed to,
     * as the app names it — shown beside the label": part of the link's own
     * words, not a caption under them. It carried `text-ink-secondary`, and a
     * descendant's `text-*` outranks the ink an anchor passes down, so each
     * out-link read half in accent and half in the ink of a value that goes
     * nowhere — with the underline intact and the anchor's own classes
     * perfectly correct, which is why grading the anchor alone never saw it.
     *
     * The value keeps its mono FACE (ARCHITECTURE §7: mono carries every value
     * the database produced) and the space before it; only the ink moved.
     */
    for (const [shape, script, id] of [
      ["the conflict item", conflictScript(), reviewItemDataConflict().review_item_id],
      ["the source-pattern item", patternScript(), reviewItemSourcePattern().review_item_id],
    ] as const) {
      const $ = cheerio.load(await renderItem(script, id));
      const outLinks = $("a[data-out]").toArray();
      expect(outLinks.length, `${shape} renders a way out`).toBeGreaterThan(0);

      let valued = 0;
      for (const anchor of outLinks) {
        const inside = $(anchor)
          .find("*")
          .toArray()
          .map((element) => classesOf($(element)));
        expectLinkSpellingReachesTheGlyphs(
          classesOf($(anchor)),
          inside,
          `${shape}: the out-link "${$(anchor).text().trim()}"`,
        );
        const value = $(anchor).find("span").first();
        if (value.length === 0) continue;
        valued += 1;
        // The words are unchanged: the value is still mono, still inside the
        // link, still separated from the label by a space.
        expect(faceOf(classesOf(value)), `${shape}: the value keeps its face`).toEqual([
          "type-data",
        ]);
        expect(value.text().startsWith(" "), `${shape}: label and value run together`).toBe(
          true,
        );
        expect(value.text().trim().length).toBeGreaterThan(0);
      }
      // Non-vacuity: an out-link that names what it is narrowed to is on the
      // page, so a green result is not a page that stopped rendering values.
      expect(valued, `${shape} names what an out-link narrows to`).toBeGreaterThan(0);
    }
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
 * PATCH route (admin-window/BUG-0068). The page used to hand the segment
 * straight to PostgREST, which refuses it with `22P02`, and the surface then
 * reported a FAILED READ — the state whose recovery line is "reload", advice
 * that can never work because the reload re-sends the same segment forever.
 * Since admin-window/BUG-0076 the page asks `isRecordId` before it reads.
 *
 * Four claims, and the last two are what keep the fix honest: no read is
 * issued and no failure is reported; the answer is not the state that means
 * the table answered and held no such row; an id Postgres WOULD accept is
 * still read for, in each of its three legal spellings; and a well-formed id
 * that matches nothing still reaches the no-such-row state through a real
 * read.
 */
describe("a queues address that is not a review-item id", () => {
  const REAL = ID.reviewItemDataConflict;

  /**
   * The mistyped spellings, in the classes QA measured against staging on a
   * production build for the record page (admin-window/BUG-0065): a segment
   * that is no kind of uuid, a uuid one character short, and a uuid carrying a
   * trailing space — which a browser sends as `%20` and which Next hands the
   * page still percent-encoded, so both spellings are here and both must
   * answer the same way. `walk-1` is the segment the pin was found on.
   *
   * A BRACED uuid is Postgres-legal and belongs here rather than below for the
   * same reason it does on the record page: the segment arrives still
   * percent-encoded, so what the URL actually asks for carries percent signs
   * and is an id by nobody's grammar.
   */
  const MISTYPED_IDS = [
    "walk-1",
    "not-a-uuid",
    REAL.slice(0, -1),
    `${REAL}%20`,
    `${REAL} `,
    `%7B${REAL}%7D`,
  ];

  /**
   * Every spelling of a uuid Postgres itself accepts (`string_to_uuid`):
   * canonical, uppercased, and with the hyphens left out. Each names the SAME
   * row, so the gate must NOT flag one — the second fixture every guard owes
   * (LESSONS 3), and the failure it protects against is telling an operator
   * that a working id is not an id, which is worse than the bug being fixed.
   */
  const WELL_FORMED_IDS = [REAL, REAL.toUpperCase(), REAL.replace(/-/g, "")];

  /**
   * Render one address with the database scripted to answer the way it really
   * would: `22P02` on the item read. A page that settles the address first
   * never gets that far, which is what makes the recorded calls the assertion.
   */
  async function renderAddress(id: string) {
    const stub = stubClient({ [T.reviewItems]: { error: invalidUuidSyntax(id) } });
    readWith.client = stub.asSupabaseClient();
    const markup = render(
      await ReviewItemPage({ params: Promise.resolve({ reviewItemId: id }) }),
    );
    return { markup, stub };
  }

  /** The one state card the surface answered with, as its text reads. */
  function emptyText(markup: string): string {
    const cards = cheerio.load(markup)('[data-state="empty"]');
    expect(cards.length, "one empty card, not several").toBe(1);
    return cards.text().replace(/\s+/g, " ").trim();
  }

  it.each(MISTYPED_IDS)("answers %o having read nothing at all", async (id) => {
    const { markup, stub } = await renderAddress(id);
    const $ = cheerio.load(markup);

    // No query was issued — not the item's, and not one of the evidence, bucket
    // or dial legs that follow it. A malformed address is decided from the
    // REQUEST (admin-window/BUG-0076).
    expect(stub.calls, "a segment that can be no review_item_id needs no read")
      .toHaveLength(0);
    // It is answered, and not as a failure of a database never asked.
    expect($("[data-state]").length, "the address is answered").toBeGreaterThan(0);
    expect($('[data-state="error"]').length, "nothing failed").toBe(0);
    // ONE answer, not one per leg: the evidence block and the dial are silent.
    expect($("[data-state]").length, "state cards").toBe(1);
    expect($("[data-evidence], [data-evidence-view], [data-dial]").length).toBe(0);
    // The operator still sees the address they asked for, verbatim.
    expect($(`[data-review-item]`).attr("data-review-item")).toBe(id);
  });

  it.each(MISTYPED_IDS)(
    "does not answer %o with the state that means the table held no such row",
    async (id) => {
      // Both are a single empty card, and they are DIFFERENT cards: "that is
      // not an id" is not "the table answered and holds no such row". The Look
      // separates emptinesses by their words alone, so this is the assertion
      // that keeps the two apart — without pinning either one's copy.
      const mistyped = emptyText((await renderAddress(id)).markup);
      const unknown = emptyText(
        await renderItem({ ...conflictScript(), [T.reviewItems]: { data: null } }, REAL),
      );
      expect(mistyped).not.toBe(unknown);
    },
  );

  it.each(WELL_FORMED_IDS)(
    "still reads the database for %s, an id Postgres accepts",
    async (id) => {
      const stub = stubClient(conflictScript());
      readWith.client = stub.asSupabaseClient();
      const markup = render(
        await ReviewItemPage({ params: Promise.resolve({ reviewItemId: id }) }),
      );

      expect(stub.tablesRead(), "the item is read").toContain(T.reviewItems);
      // ...and what came back is rendered as the item, not as any state card.
      // The close is excluded and graded on its own: its state belongs to a
      // different read (the settlement readiness), which on this database —
      // and on staging — is the absent one.
      const $ = cheerio.load(markup);
      const outsideTheClose = $("[data-state]")
        .toArray()
        .filter((element) => $(element).closest(`[data-surface="${CLOSE_HOOK}"]`).length === 0);
      expect(outsideTheClose.length).toBe(0);
      expect(evidenceIds(markup)).toEqual([ID.observationA, ID.observationB]);
    },
  );

  it("leaves the no-such-row state to a well-formed id that matches nothing", async () => {
    const stub = stubClient({
      ...conflictScript(),
      [T.reviewItems]: { data: null },
    });
    readWith.client = stub.asSupabaseClient();
    const markup = render(
      await ReviewItemPage({ params: Promise.resolve({ reviewItemId: REAL }) }),
    );

    // The read happened, and its ANSWER — not the request — is what emptied the
    // surface. Unchanged by admin-window/BUG-0076.
    expect(stub.tablesRead()).toContain(T.reviewItems);
    expect(cheerio.load(markup)('[data-state="empty"]').length).toBe(1);
  });

  it("asks the one id grammar this repo has, and no copy of it", async () => {
    // The gate is `isRecordId` (`src/lib/db/records.ts`) — the same function
    // the record page and the PATCH route ask (ARCHITECTURE §9.1 item 9). The
    // claim is that the PAGE agrees with it on every fixture above, which is
    // what a second regex here would break silently.
    for (const id of MISTYPED_IDS) {
      expect(isRecordId(id), `${JSON.stringify(id)} is no id`).toBe(false);
      expect((await renderAddress(id)).stub.calls).toHaveLength(0);
    }
    for (const id of WELL_FORMED_IDS) {
      expect(isRecordId(id), `${id} is an id Postgres accepts`).toBe(true);
    }
  });
});

/* ── the same table name, one route over ──────────────────────────────────── */

/**
 * The queues detail page's two empty state cards name `review_items` in the
 * app's own prose face — campaign admin-window/BUG-0120's QA pass, 2026-09-09.
 *
 * BUG-0112 gave the record page's regime note the app's identifier-in-prose
 * spelling and BUG-0120 gave the record page's two empty cards the same one,
 * so `/records/<table>/<bad id>` now says the table's name in one face
 * wherever it stands. This route's cards were named as a residual by that
 * fix's builder and never moved: measured on the production build against
 * staging (1440x900, light and dark, `/queues/x` and
 * `/queues/00000000-0000-4000-8000-000000000099`), `review_items` renders
 * Geist 12px — the app's prose — while the id one line above it renders
 * Geist Mono 11px. LOOK_AND_FEEL Voice bar 5 does not stop at a route:
 * machine identifiers "render verbatim in mono", and a table name is the
 * machine's word on whichever surface prints it.
 *
 * The yardstick is the page's OWN machine word — the review-item id it draws
 * above the card — so nothing here pins a face literal and a restyle moves
 * both sides together. Only the type STEP is compared (`faceOf` keeps `type-*`
 * and drops ink): the identifier is `type-data text-ink`, the app's one
 * identifier-in-prose spelling, exactly as `NotProvisioned` emits it inside a
 * `text-ink-secondary` paragraph — and pinning ink here would pin a colour.
 *
 * Landed as `it.fails` while the divergence stood; the wrap arrived with
 * admin-window/BUG-0121 and these are ordinary tests as of 2026-09-09.
 */
describe("a table name in a queues empty state card", () => {
  /** The face this page gives a word the machine produced: the id it echoes. */
  function machineFace($: cheerio.CheerioAPI): string[] {
    const identity = $("[data-review-item]");
    expect(identity.length, "the address is echoed back, once").toBe(1);
    return faceOf(classesOf(identity));
  }

  /** How many times the one empty card says the table's name. */
  function saidInTheCard($: cheerio.CheerioAPI): number {
    const card = $('[data-state="empty"]');
    expect(card.length, "one empty card, not several").toBe(1);
    return card.text().split(T.reviewItems).length - 1;
  }

  /** The face of every element inside the card whose whole text is that name. */
  function drawnAsTheMachineWord($: cheerio.CheerioAPI): string[][] {
    return $('[data-state="empty"]')
      .find("*")
      .toArray()
      .filter((element) => $(element).text() === T.reviewItems)
      .map((element) => faceOf(classesOf($(element))));
  }

  it("sets the name in the machine's face on an address that is no id", async () => {
    const id = "not-a-uuid";
    readWith.client = stubClient({
      [T.reviewItems]: { error: invalidUuidSyntax(id) },
    }).asSupabaseClient();
    const $ = cheerio.load(
      render(await ReviewItemPage({ params: Promise.resolve({ reviewItemId: id }) })),
    );
    // Non-vacuous: this state really does print the table's name.
    expect(saidInTheCard($), "the card names the table").toBe(1);
    expect(drawnAsTheMachineWord($)).toEqual([machineFace($)]);
  });

  it("sets the name in the machine's face on an id no row has", async () => {
    const $ = cheerio.load(
      await renderItem(
        { ...conflictScript(), [T.reviewItems]: { data: null } },
        ID.reviewItemDataConflict,
      ),
    );
    expect(saidInTheCard($), "the card names the table").toBe(1);
    expect(drawnAsTheMachineWord($)).toEqual([machineFace($)]);
  });

  /** The text of everything the card draws in the page's machine face, in order. */
  function inTheMachinesFace($: cheerio.CheerioAPI): string[] {
    const machine = machineFace($).join(" ");
    return $('[data-state="empty"]')
      .find("*")
      .toArray()
      .filter((element) => faceOf(classesOf($(element))).join(" ") === machine)
      .map((element) => $(element).text());
  }

  /**
   * The other half of the same rule, and the trap next door: "review item" —
   * two words — is the app's OWN noun for the thing, prose and not a machine
   * word, and it opens the first line of both cards ("No review item at this
   * address"). So the machine's face may reach the identifier and nothing
   * else: anything else the card draws at the data step is prose prettified
   * into the machine's voice, which is the same defect pointing the other way.
   *
   * Asked of BOTH cards — campaign admin-window/BUG-0121's QA pass. The guard
   * arrived covering the not-an-id card alone, which left the no-such-row card
   * pinned in one direction only: its two pins ask that the identifier IS in
   * the machine's face and say nothing about what else may be, so a later hand
   * wrapping "row with that id in" would have shipped green. The two cards are
   * one rule and the rule is graded on both.
   */
  it.each([
    ["an address that is no id", async () => renderItem({}, "not-a-uuid")],
    [
      "an id no row has",
      async () =>
        renderItem(
          { ...conflictScript(), [T.reviewItems]: { data: null } },
          "00000000-0000-4000-8000-000000000099",
        ),
    ],
  ] as const)("draws nothing but the identifier in the machine's face on %s", async (_what, markup) => {
    const $ = cheerio.load(await markup());
    // Non-vacuous: the identifier IS drawn that way, and it is the only thing.
    expect(inTheMachinesFace($)).toEqual([T.reviewItems]);
  });
});


