import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { readItemVerdict } from "@/lib/db/verdict";
import { EM_DASH } from "@/lib/format";
import { render, runTogetherWords, uppercasedIdentifiers } from "../ui/markup";
import {
  ID,
  observationRow,
  reviewItemDataConflict,
  sourceRow,
  verdictLogEntry,
} from "../../fixtures/rows";
import {
  statementTimeout,
  stubClient,
  tableNotInSchemaCache,
  type Script,
} from "../../fixtures/stub-client";
import { oneEach, stateOf, surfaceHooks } from "../../live/parity";

/**
 * **A settled review item's detail carries its own verdict inline** — campaign
 * admin-window/TASK-0059, spec F13's second half.
 *
 * The investigation path ends where the decision was made: an item that is
 * already settled shows WHAT settled it, rather than sending the operator to
 * the log tab to find out what they themselves decided.
 *
 * Four states, and the file grades all four because three of them are
 * absences and the fourth is what happens when there is nothing to render:
 *
 *  1. the log's table is ABSENT — staging today and `main`'s deploy target for
 *     the whole of M2 — and the detail draws the ONE not-provisioned card the
 *     close slot already draws, naming that object, with the rest of the page
 *     exactly as M1 shipped it;
 *  2. the table is there and holds NO ROW for a settled item: an honest gap in
 *     the data, said in the block's own words and distinguishable in the
 *     markup from state 1 — never a blank slot, never a claim that the object
 *     is missing;
 *  3. the table is there and the row is: the action verbatim in mono, the
 *     actor, the note or the unqualified dash, when, and a link to the
 *     observation it wrote or the unqualified dash;
 *  4. an UNSETTLED item renders no verdict block at all. An empty verdict
 *     block on an open item is the "renders X but not the absence of X" defect
 *     LESSONS 1 is about, from the other side.
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which hooks exist, which state kind
 * a surface is in, what crossed the query builder, where a link goes — plus
 * the MACHINE's own strings where rendering them verbatim is the requirement
 * (the action, the actor, the note, the object the read named). No class name
 * and no sentence of the app's own copy is pinned.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/review-item", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/review-item")>();
  return {
    ...actual,
    readReviewItem: (id: string) => actual.readReviewItem(id, readWith.client as never),
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
 * The close's two reads, both of them through the seam that owns this object
 * (ARCHITECTURE.md §9.2): may a settlement be offered at all, and — for a
 * settled item — which verdict settled it. Neither takes a client from the
 * page, so the stub is handed in here and every script below says what this
 * database holds for both.
 */
vi.mock("@/lib/db/verdict", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/verdict")>();
  return {
    ...actual,
    readSettlementReadiness: () =>
      actual.readSettlementReadiness(readWith.client as never),
    // The client the caller hands over wins, so the read's OWN cases below can
    // script a database of their own without going through a page.
    readItemVerdict: (id: string, db?: unknown) =>
      actual.readItemVerdict(id, (db ?? readWith.client) as never),
  };
});

vi.mock("@/lib/gauges/pending-claims", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/pending-claims")>();
  return {
    ...actual,
    readAwaitingRowTrend: (options?: unknown) =>
      actual.readAwaitingRowTrend((options ?? {}) as never, readWith.client as never),
  };
});

const pageModule = await import("@/app/queues/[reviewItemId]/page");
const ReviewItemPage = pageModule.default;

/* ── the addressing ──────────────────────────────────────────────────────── */

/** The close, and the verdict's own sub-surface inside it. */
const CLOSE = '[data-surface="close"]';
const VERDICT = '[data-surface="item_verdict"]';
/** The two surfaces M1 shipped: this ticket may not move either. */
const M1 = ['[data-surface="what_happened"]', '[data-surface="evidence"]'];

/* ── the population ──────────────────────────────────────────────────────── */

const CLAIM = observationRow();
const OTHER = observationRow({
  observation_id: ID.observationB,
  source_id: ID.sourceBandsintown,
  value: "TWICE World Tour",
});
const SOURCES = [sourceRow(), sourceRow({ source_id: ID.sourceBandsintown, source: "bandsintown" })];

const SETTLED = reviewItemDataConflict({ status: "settled" });
const OPEN = reviewItemDataConflict();

/** The database every script starts from: the item, its evidence, its sources. */
function itemScript(item = SETTLED, overrides: Script = {}): Script {
  return {
    [T.reviewItems]: { data: item, count: 1 },
    [T.observations]: { data: [CLAIM, OTHER], count: 2 },
    [T.fieldProvenance]: { data: [], count: 0 },
    [T.sources]: { data: SOURCES, count: SOURCES.length },
    [T.pendingClaims]: { data: [], count: 0 },
    ...overrides,
  };
}

/** State 1: the log's table is not in this database at all. */
function logAbsent(item = SETTLED): Script {
  return itemScript(item, {
    [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
  });
}

/**
 * State 2: the table is there and holds nothing for this item.
 *
 * One scripted response answers every read of the object, so the readiness
 * probe and the by-id read both get the empty answer — which is the state.
 */
function noRow(item = SETTLED): Script {
  return itemScript(item, { [T.verdicts]: { data: [], count: 0 } });
}

/**
 * State 3: the table is there and holds the row.
 *
 * A QUEUE, because two different reads hit this object in order: the readiness
 * probe first (which asks for no rows at all), then the by-id read.
 * `observations` is a queue for the same reason — the evidence read, then the
 * verdict's own observation leg.
 */
function withVerdict(
  overrides: Partial<ReturnType<typeof verdictLogEntry>> = {},
  observed: unknown[] = [CLAIM],
): Script {
  const row = verdictLogEntry({ review_item_id: SETTLED.review_item_id, ...overrides });
  return itemScript(SETTLED, {
    [T.verdicts]: [
      { data: [], count: 0 },
      { data: [row], count: 1 },
    ],
    [T.observations]: [
      { data: [CLAIM, OTHER], count: 2 },
      { data: observed, count: observed.length },
    ],
  });
}

async function renderItem(script: Script, id = SETTLED.review_item_id): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await ReviewItemPage({ params: Promise.resolve({ reviewItemId: id }) }));
}

/** The text of one element, whitespace-normalised. */
function textIn(markup: string, selector: string): string {
  return cheerio.load(markup)(selector).text().replace(/\s+/g, " ").trim();
}

/* ── the read ────────────────────────────────────────────────────────────── */

describe("readItemVerdict", () => {
  it("asks for this item's rows only, completely, newest first", async () => {
    const stub = stubClient({
      [T.verdicts]: { data: [verdictLogEntry({ observation_id: null })], count: 1 },
    });
    await readItemVerdict(SETTLED.review_item_id, stub.asSupabaseClient() as never);

    const call = stub.calls[0];
    expect(call.table).toBe(T.verdicts);
    const steps = Object.fromEntries(call.steps.map((step) => [step.method, step.args]));

    // By ID: the filter is the item, not a scan of the log narrowed later.
    expect(steps.eq).toEqual(["review_item_id", SETTLED.review_item_id]);
    // A COMPLETE read (ARCHITECTURE.md §4.3, kind 1): an exact count and a
    // bounded range, so a truncated set refuses instead of becoming "the
    // verdict". A `.limit()` here would be the window read this is not.
    expect(steps.select?.[1]).toEqual({ count: "exact" });
    expect(steps.range?.[0]).toBe(0);
    expect((steps.range?.[1] as number) > 0).toBe(true);
    expect(call.steps.filter((step) => step.method === "limit")).toEqual([]);
    // A TOTAL order ending in the primary key, so two verdicts sharing an
    // instant cannot swap places between reloads.
    expect(call.steps.filter((step) => step.method === "order").map((step) => step.args)).toEqual([
      ["created_at", { ascending: false }],
      ["verdict_id", { ascending: false }],
    ]);
  });

  it("says the object is not provisioned when the log is not in this database", async () => {
    const stub = stubClient({ [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) } });
    const result = await readItemVerdict(
      SETTLED.review_item_id,
      stub.asSupabaseClient() as never,
    );

    expect(result.kind).toBe("not_provisioned");
    if (result.kind !== "not_provisioned") return;
    // Named in the spelling the query used.
    expect(result.missing).toBe(T.verdicts);
  });

  it("answers a real null when the log holds no row for this item", async () => {
    const stub = stubClient({ [T.verdicts]: { data: [], count: 0 } });
    const result = await readItemVerdict(
      SETTLED.review_item_id,
      stub.asSupabaseClient() as never,
    );

    // Not an absence of the object and not a refusal: the read answered.
    expect(result).toEqual({ kind: "ok", data: null });
    // And it asked `observations` nothing — there was no observation to place.
    expect(stub.tablesRead()).toEqual([T.verdicts]);
  });

  it("resolves the observation's fact, and asks for that id alone", async () => {
    const stub = stubClient({
      [T.verdicts]: { data: [verdictLogEntry()], count: 1 },
      [T.observations]: { data: [CLAIM], count: 1 },
    });
    const result = await readItemVerdict(
      SETTLED.review_item_id,
      stub.asSupabaseClient() as never,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.data === null) throw new Error("no verdict read");
    expect(result.data.verdict.verdict_id).toBe(ID.verdict);
    expect(result.data.fact?.observation_id).toBe(CLAIM.observation_id);
    expect(result.data.factUnavailable).toBeNull();

    const leg = stub.calls.find((call) => call.table === T.observations);
    const inStep = leg?.steps.find((step) => step.method === "in");
    expect(inStep?.args).toEqual(["observation_id", [ID.observationA]]);
  });

  it("asks observations nothing at all for a settle-only verdict", async () => {
    const stub = stubClient({
      [T.verdicts]: { data: [verdictLogEntry({ observation_id: null })], count: 1 },
    });
    const result = await readItemVerdict(
      SETTLED.review_item_id,
      stub.asSupabaseClient() as never,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.data === null) throw new Error("no verdict read");
    expect(result.data.fact).toBeNull();
    expect(result.data.factUnavailable).toBeNull();
    expect(stub.tablesRead()).toEqual([T.verdicts]);
  });

  it("keeps the verdict when only the observation leg refuses", async () => {
    // The leg that RESOLVES the link failed; the verdict itself is in hand.
    // Dropping it would tell an operator no decision was ever taken
    // (admin-window/BUG-0021).
    const stub = stubClient({
      [T.verdicts]: { data: [verdictLogEntry()], count: 1 },
      [T.observations]: { error: statementTimeout() },
    });
    const result = await readItemVerdict(
      SETTLED.review_item_id,
      stub.asSupabaseClient() as never,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.data === null) throw new Error("no verdict read");
    expect(result.data.verdict.action).toBe(verdictLogEntry().action);
    expect(result.data.fact).toBeNull();
    expect(result.data.factUnavailable?.kind).toBe("error");
  });

  it("takes the newest verdict whatever order the transport returned them in", async () => {
    // `verdicts.review_item_id` carries no uniqueness, so two rows for one
    // item are possible; the set is re-sorted here rather than trusted from
    // the wire, which a `.limit(1)` could not do.
    const older = verdictLogEntry({
      verdict_id: `${ID.verdict}-old`,
      created_at: "2026-09-01T00:00:00.000Z",
      action: "keep_current",
    });
    const newer = verdictLogEntry({ created_at: "2026-09-08T12:00:00.000Z" });
    const stub = stubClient({
      [T.verdicts]: { data: [older, newer], count: 2 },
      [T.observations]: { data: [CLAIM], count: 1 },
    });
    const result = await readItemVerdict(
      SETTLED.review_item_id,
      stub.asSupabaseClient() as never,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.data === null) throw new Error("no verdict read");
    expect(result.data.verdict.verdict_id).toBe(newer.verdict_id);
  });

  it("refuses rather than picking a verdict out of a truncated set", async () => {
    // A complete read whose count exceeds the rows it got back cannot answer
    // "the verdict": it does not know which rows it is missing.
    const stub = stubClient({
      [T.verdicts]: { data: [verdictLogEntry({ observation_id: null })], count: 4 },
    });
    const result = await readItemVerdict(
      SETTLED.review_item_id,
      stub.asSupabaseClient() as never,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.verdicts);
  });
});

/* ── state 1: the log's table is absent ──────────────────────────────────── */

describe("with the log's table absent, on a settled item", () => {
  it("draws exactly one not-provisioned card, naming the object, and no verdict block", async () => {
    const markup = await renderItem(logAbsent());
    const $ = cheerio.load(markup);

    // One card, the close slot's own — not a second one from the verdict
    // block saying the same thing twice.
    expect($(`${CLOSE} [data-not-provisioned="${T.verdicts}"]`)).toHaveLength(1);
    expect($(`[data-not-provisioned="${T.verdicts}"]`)).toHaveLength(1);
    expect(stateOf(markup, CLOSE)).toBe("not_provisioned");
    // No block at all: the read never happened, so there is nothing to say.
    expect($(VERDICT)).toHaveLength(0);
    expect($("[data-item-verdict]")).toHaveLength(0);
    // Said as an absence, never as a failure.
    expect($(CLOSE).find('[role="alert"]')).toHaveLength(0);
  });

  it("leaves the rest of the detail exactly as M1 shipped it", async () => {
    const markup = await renderItem(logAbsent());
    const $ = cheerio.load(markup);

    expect(surfaceHooks(markup, M1)).toEqual({ counts: oneEach(M1), nested: [] });
    expect($(`[data-review-item="${SETTLED.review_item_id}"]`).text()).toBe(
      SETTLED.review_item_id,
    );
    // The item's own sentence, and its evidence, are untouched by the close.
    expect(textIn(markup, '[data-surface="what_happened"]')).toContain(SETTLED.summary);
    expect($("[data-evidence]")).toHaveLength(2);
    expect($('[data-state="error"]')).toHaveLength(0);
  });

  it("offers no control, and reads the same on an open item", async () => {
    for (const [name, item] of [
      ["settled", SETTLED],
      ["open", OPEN],
    ] as const) {
      const $ = cheerio.load(await renderItem(logAbsent(item), item.review_item_id));
      for (const control of ["button", "form", "input", "select", "textarea"]) {
        expect($(control), `${name}: ${control}`).toHaveLength(0);
      }
      expect($(VERDICT), name).toHaveLength(0);
    }
  });
});

/* ── state 2: the table is there, the row is not ─────────────────────────── */

describe("with the log's table present but no row for a settled item", () => {
  it("says so as an emptiness, distinguishable from the absent object", async () => {
    const markup = await renderItem(noRow());
    const $ = cheerio.load(markup);

    // The block RENDERS — the read happened and answered — and it is empty,
    // not unprovisioned. The two draw the same container and are told apart
    // by `data-state` alone (ARCHITECTURE.md §10).
    expect($(VERDICT)).toHaveLength(1);
    expect(stateOf(markup, VERDICT)).toBe("empty");
    expect($(VERDICT).find('[data-state="not_provisioned"]')).toHaveLength(0);
    expect($(`[data-not-provisioned="${T.verdicts}"]`)).toHaveLength(0);
    // It claims nothing about the object being missing.
    expect($(VERDICT).text()).not.toContain(T.verdicts);
    // And it is not a blank slot: the card says what is missing and why.
    expect(textIn(markup, VERDICT).length).toBeGreaterThan(20);
  });

  it("is a different markup state from the absent object, on the same item", async () => {
    // The pair, side by side — this is the assertion the two absences exist
    // for, and neither passes by looking like the other.
    const absent = cheerio.load(await renderItem(logAbsent()));
    const empty = cheerio.load(await renderItem(noRow()));

    expect(absent(`[data-state="not_provisioned"]`).length).toBeGreaterThan(0);
    expect(absent(`[data-state="empty"]`)).toHaveLength(0);
    expect(empty(`${VERDICT} [data-state="empty"]`)).toHaveLength(1);
    expect(empty(`${VERDICT} [data-state="not_provisioned"]`)).toHaveLength(0);
  });

  it("keeps the close out of it: the close's own read answered", async () => {
    const markup = await renderItem(noRow());
    // The block's emptiness belongs to the block. Excluded, the close is in
    // the state its OWN read put it in — which is why the sub-surface exists.
    expect(stateOf(markup, CLOSE, VERDICT)).toBe("ok");
    expect(surfaceHooks(markup, M1)).toEqual({ counts: oneEach(M1), nested: [] });
  });
});

/* ── state 3: the verdict itself ─────────────────────────────────────────── */

describe("a settled item renders the verdict that settled it", () => {
  it("carries the action, the actor, the note, when, and the observation's link", async () => {
    const row = verdictLogEntry({
      review_item_id: SETTLED.review_item_id,
      note: "bandsintown's title is the marketing one",
    });
    const markup = await renderItem(withVerdict({ note: row.note }));
    const $ = cheerio.load(markup);

    expect($(VERDICT)).toHaveLength(1);
    // The action is the machine's own name, rendered verbatim (§11, LESSONS 5).
    expect($("[data-verdict-action]").attr("data-verdict-action")).toBe(row.action);
    expect($("[data-verdict-action]").text().trim()).toBe(row.action);
    expect(uppercasedIdentifiers(markup)).toEqual([]);

    expect($("[data-verdict-actor]").text().trim()).toBe(row.actor);
    expect($("[data-verdict-note]").text().trim()).toBe(row.note);
    // The instant is relative with the absolute in the title (Voice bar 6).
    const when = $("[data-verdict-when]");
    expect(when.attr("data-verdict-when")).toBe(row.created_at);
    expect(when.attr("title")).toContain(row.created_at.slice(0, 10));
    expect(when.text().trim()).not.toBe("");

    // The observation leads where a rendered observation already leads in this
    // app: the record surface of the fact it is about.
    const link = $(`a[data-verdict-observation="${row.observation_id}"]`);
    expect(link).toHaveLength(1);
    expect(link.attr("href")).toBe(`/records/${CLAIM.domain}/${CLAIM.entity_id}`);
    expect(link.text().trim()).toBe(row.observation_id);
  });

  it("is in its ok state and offers no control", async () => {
    const markup = await renderItem(withVerdict());
    const $ = cheerio.load(markup);

    expect(stateOf(markup, VERDICT)).toBe("ok");
    expect(stateOf(markup, CLOSE, VERDICT)).toBe("ok");
    // A settled item is closed: nothing on this page settles it again.
    for (const control of ["button", "form", "input", "select", "textarea"]) {
      expect($(CLOSE).find(control), control).toHaveLength(0);
    }
    expect($("[data-close-action]")).toHaveLength(0);
    // …and the status line the close already shipped is still there.
    expect($("[data-close-item-status]").attr("data-close-item-status")).toBe("settled");
  });

  it("renders the dash, and says what it means, when the verdict carried no value", async () => {
    // A settle-only verdict observed nothing and its admin left no note: two
    // structural nulls, each the app's one dash with no qualifier (LESSONS 1).
    const markup = await renderItem(withVerdict({ observation_id: null, note: null }, []));
    const $ = cheerio.load(markup);

    expect($(VERDICT).text()).toContain(EM_DASH);
    expect($("[data-verdict-note]")).toHaveLength(0);
    expect($("[data-verdict-observation]")).toHaveLength(0);
    // Never blank: an absence is a rendered dash, in the app's own element.
    expect($(VERDICT).find('[aria-label="no value"]').length).toBeGreaterThanOrEqual(2);
    // Said ONCE, and structurally: a hook, not a sentence an oracle greps.
    expect($(VERDICT).find("[data-absence-note]")).toHaveLength(1);
    // Still `ok`: a verdict that observed nothing is a verdict, not an absence.
    expect(stateOf(markup, VERDICT)).toBe("ok");
  });

  it("dashes a note that is present but blank, rather than leaving an empty element", async () => {
    // admin-window/BUG-0085's shape: `isAbsent` TRIMS, and the guard has to
    // run BEFORE the element is built or the absence is invisible to `orDash`.
    const markup = await renderItem(withVerdict({ note: "   " }));
    const $ = cheerio.load(markup);

    expect($("[data-verdict-note]")).toHaveLength(0);
    expect($(VERDICT).find('[aria-label="no value"]').length).toBeGreaterThanOrEqual(1);
    expect($(VERDICT).find("[data-absence-note]")).toHaveLength(1);
  });

  it("dashes an actor the row left blank, and still says whose verdict it is not", async () => {
    const markup = await renderItem(withVerdict({ actor: "" }));
    const $ = cheerio.load(markup);

    expect($("[data-verdict-actor]")).toHaveLength(0);
    expect($(VERDICT).find('[aria-label="no value"]').length).toBeGreaterThanOrEqual(1);
    // The verdict still renders: a missing actor costs a name, not a decision.
    expect($("[data-verdict-action]").attr("data-verdict-action")).toBe(
      verdictLogEntry().action,
    );
  });

  it("renders an unresolvable observation id verbatim, unlinked, and never dashed", async () => {
    // The verdict really does carry the id, so a dash would claim it observed
    // nothing — a different verdict. The leg simply could not place it.
    const markup = await renderItem(withVerdict({}, []));
    const $ = cheerio.load(markup);

    const shown = $(`[data-verdict-observation="${ID.observationA}"]`);
    expect(shown).toHaveLength(1);
    expect(shown.is("a")).toBe(false);
    expect(shown.text().trim()).toBe(ID.observationA);
  });

  it("reports a refused observation leg beside the verdict, not instead of it", async () => {
    const markup = await renderItem(
      itemScript(SETTLED, {
        [T.verdicts]: [
          { data: [], count: 0 },
          { data: [verdictLogEntry({ review_item_id: SETTLED.review_item_id })], count: 1 },
        ],
        [T.observations]: [
          { data: [CLAIM, OTHER], count: 2 },
          { error: statementTimeout() },
        ],
      }),
    );
    const $ = cheerio.load(markup);

    // The verdict is on screen…
    expect($("[data-verdict-action]").attr("data-verdict-action")).toBe(
      verdictLogEntry().action,
    );
    // …and the leg that failed names its OWN object, in its own card.
    expect($(`${VERDICT} [data-read-failed="${T.observations}"]`)).toHaveLength(1);
    expect($(`[data-verdict-observation="${ID.observationA}"]`).is("a")).toBe(false);
  });

  it("names no ticket id and glues no word to the element beside it", async () => {
    // The delivered HTML is the only evidence: JSX drops a whitespace run
    // containing a newline, so a source that plainly shows a space can render
    // `settled withchoose_claimed_value` (admin-window/BUG-0045).
    const markup = await renderItem(withVerdict());
    const block = cheerio.load(markup)(VERDICT).html() ?? "";

    expect(runTogetherWords(block)).toEqual([]);
    expect(runTogetherWords(markup)).toEqual([]);
    // The label and the value it labels are separated by real text, not a gap.
    const line = cheerio.load(markup)("[data-verdict-action]").closest("p").text();
    expect(line).toContain(` ${verdictLogEntry().action}`);
  });
});

/* ── state 4: an unsettled item renders no verdict block ─────────────────── */

describe("an unsettled item", () => {
  it("renders no verdict block at all, in either database", async () => {
    for (const [name, script] of [
      ["log present", noRow(OPEN)],
      ["log absent", logAbsent(OPEN)],
    ] as const) {
      const $ = cheerio.load(await renderItem(script, OPEN.review_item_id));
      expect($(VERDICT), name).toHaveLength(0);
      expect($("[data-item-verdict]"), name).toHaveLength(0);
      expect($("[data-verdict-action]"), name).toHaveLength(0);
      expect($("[data-absence-note]"), name).toHaveLength(0);
    }
  });

  it("leaves the close exactly as its own ticket shipped it", async () => {
    const markup = await renderItem(noRow(OPEN), OPEN.review_item_id);
    const $ = cheerio.load(markup);

    // The read answered, so the slot is in its ok state with the note field
    // and this shape's controls — unchanged by this ticket.
    expect(stateOf(markup, CLOSE)).toBe("ok");
    expect($(CLOSE).find("[data-close-note]")).toHaveLength(1);
    expect(
      $(CLOSE)
        .find("[data-close-action]")
        .toArray()
        .map((element) => $(element).attr("data-close-action")),
    ).toEqual(["choose_claimed_value", "choose_claimed_value", "supply_value", "keep_current"]);
    expect($("[data-close-item-status]")).toHaveLength(0);
  });

  it("never asks the log for a verdict an open item cannot have", async () => {
    // The by-id read never happens on an open item: the ONE read of the object
    // is the readiness probe the close already makes. An absent block means a
    // read that did not happen, here as everywhere (ARCHITECTURE.md §4.3).
    const stub = stubClient(noRow(OPEN));
    readWith.client = stub.asSupabaseClient();
    await render(
      await ReviewItemPage({ params: Promise.resolve({ reviewItemId: OPEN.review_item_id }) }),
    );

    expect(stub.calls.filter((call) => call.table === T.verdicts)).toHaveLength(1);
  });
});

/* ── the block's own dash contract ───────────────────────────────────────── */

/**
 * How this block accounts for the dashes it puts on screen — the invariant
 * behind admin-window/BUG-0092, measured structurally.
 *
 * Two numbers and a hook, and nothing about wording:
 *
 *  - `appDashes` — dashes drawn by the app's ONE dash element (`orDash`,
 *    `lib/format.ts`), which is the only absence rendering this app has;
 *  - `strayDashes` — em dashes reaching the screen as bare text instead, from
 *    a value that never went through it (LESSONS 1: "Every nullable value goes
 *    through `lib/format.ts`'s dash"). The block's own dash-meaning sentence
 *    carries an em dash of its own and is removed before counting, exactly as
 *    the log tab's note says it must be;
 *  - `absenceNotes` — the `data-absence-note` hook, which is what makes "said
 *    once" a structural claim rather than a copy one.
 *
 * Deliberately fixture-scoped: an operator's note may legitimately contain an
 * em dash, so this is asked only of rows whose values carry none.
 */
function dashAccounting(markup: string): {
  appDashes: number;
  strayDashes: number;
  absenceNotes: number;
} {
  const $ = cheerio.load(markup);
  const block = $(VERDICT);
  const drawn = block.find('[aria-label="no value"]');
  const inDrawn = drawn
    .toArray()
    .reduce((total, element) => total + ($(element).text().split(EM_DASH).length - 1), 0);
  const absenceNotes = block.find("[data-absence-note]").length;
  block.find("[data-absence-note]").remove();
  return {
    appDashes: drawn.length,
    strayDashes: block.text().split(EM_DASH).length - 1 - inDrawn,
    absenceNotes,
  };
}

describe("the dashes the block draws", () => {
  /**
   * The invariant both cases below assert, filed as admin-window/BUG-0092 and
   * fixed in admin-window/TASK-0059: every dash the block puts on screen is
   * the app's one dash element, and a dash on screen carries exactly one
   * dash-meaning line — on all four of its absent-able lines, actor and when
   * included. Neither prescribes a shape: the block may stop dashing these
   * values or may explain every dash it draws, and either satisfies them.
   */

  it(
    "explains the dash it draws for a blank actor",
    async () => {
      // Every other line carries a value, so the actor's dash is the only one
      // on screen — and it stands there with nothing saying what it means.
      const markup = await renderItem(
        withVerdict({ actor: "   ", note: "the marketing title, not the billed one" }),
      );
      const seen = dashAccounting(markup);

      expect(seen.appDashes).toBeGreaterThan(0);
      expect({ dashOnScreen: seen.appDashes > 0, notes: seen.absenceNotes }).toEqual({
        dashOnScreen: true,
        notes: 1,
      });
    },
  );

  it(
    "draws an unparseable instant with the app's own dash",
    async () => {
      // `relativeAge` answers `{ text: EM_DASH, title: "" }` for an instant it
      // cannot read, and this block renders that text directly — where the
      // log's own `created` column hands it over as null so the table's
      // `orDash` draws it (`components/queues/verdict-log.tsx`). The same
      // column, two renderings, one of them outside the app's one dash.
      const markup = await renderItem(
        withVerdict({ created_at: "settled last tuesday", note: "a note" }),
      );
      const seen = dashAccounting(markup);

      expect({ stray: seen.strayDashes, drawn: seen.appDashes }).toEqual({
        stray: 0,
        drawn: 1,
      });
    },
  );

  it("draws and explains both structural dashes on a settle-only verdict", async () => {
    // The state the block gets RIGHT, pinned beside the two it does not, so a
    // fix for BUG-0092 cannot buy the invariant by dropping this line.
    const markup = await renderItem(withVerdict({ observation_id: null, note: null }, []));
    const seen = dashAccounting(markup);

    expect(seen).toEqual({ appDashes: 2, strayDashes: 0, absenceNotes: 1 });
  });

  it("draws no dash, and no dash-meaning line, on a verdict that carries everything", async () => {
    const markup = await renderItem(withVerdict({ note: "a note" }));

    expect(dashAccounting(markup)).toEqual({
      appDashes: 0,
      strayDashes: 0,
      absenceNotes: 0,
    });
  });
});
