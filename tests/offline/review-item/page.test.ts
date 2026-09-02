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
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
} from "../../fixtures/stub-client";

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
   * accounting sentence divides the DEDUPLICATED claim count by the RAW array
   * length, so an item carrying [A, A, B] with every id resolving reports "2
   * of 3 evidence ids resolved to a claim" and lists no unresolved id at all.
   *
   * The assertion is behavioural, not a copy of the sentence: whatever words
   * the page uses, resolved + unresolved must account for every id it claims
   * to have looked at. Here nothing is unresolved, so the two numbers in that
   * accounting must agree.
   *
   * PINNED `it.fails` (strict) for admin-window/BUG-0021: it is green only
   * while the divergence is live, so a fix turns it RED and the fix flips it
   * back to a plain `it()`. Watched failing as a plain `it()` against
   * run/admin-window @ 552a243: "AssertionError: 2 of 3 reported resolved,
   * but no id is listed as unresolved: expected 1 to be +0".
   */
  it.fails("accounts for every evidence id when one is repeated", async () => {
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
