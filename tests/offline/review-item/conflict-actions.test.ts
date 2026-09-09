import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FN, T } from "@/lib/db/tables";
import { EVIDENCE_VIEW_BY_SHAPE, type EvidenceRow } from "@/components/review";
import { ACTIONS_BY_SHAPE, CloseSlot } from "@/components/review/close/slot";
import { conflictActions } from "@/components/review/close/conflict-actions";
import {
  closeRefusal,
  decisionValue,
  refusalWords,
  settleBody,
  submitSettlement,
  type ActionSpec,
} from "@/components/review/close/actions";
import { EM_DASH } from "@/lib/format";
import type { ReviewItemRow } from "@/lib/review/shapes";
import {
  decisionRefusals,
  type VerdictDecision,
} from "@/lib/verdict/decision";
import {
  factoryTicketIds,
  h,
  render,
  runTogetherWords,
  uppercasedIdentifiers,
} from "../ui/markup";
import {
  ID,
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemSourcePattern,
  verdictLogEntry,
} from "../../fixtures/rows";
import { functionNotInSchemaCache, stubClient, type Script, type StubClient } from "../../fixtures/stub-client";

/**
 * The `data_conflict` item's three verdict actions — campaign
 * admin-window/TASK-0050, spec §7.
 *
 * **The absence is graded FIRST because it is the normal case.** `verdicts`
 * and `settle_review_item` are on neither staging nor production and will not
 * be until Ben installs M2's handoff migrations, so the state `main` deploys
 * against for the whole milestone is the one this file opens with: the close
 * slot draws the not-provisioned card, offers no control of any kind, and the
 * evidence cards below it render exactly as M1 shipped them.
 *
 * **Fixtures, not staging** (the ticket's own words): no `data_conflict` item
 * exists on staging, so the three actions are graded offline against the
 * conflict fixture. "Built, not walkable on this data" is the honest grade,
 * exactly as M1 graded the same gap.
 *
 * Three tiers, as the close slot's own file has them: the LIST (what the shape
 * offers, and what each control's decision carries), the FRAME (what renders,
 * and what does not), and the ROUTE — driven the way the network drives it,
 * with the gate stubbed open and the database behind a RECORDING stub, so
 * "exactly one call to `settle_review_item`, per control" is observed rather
 * than asserted.
 */

/* ── the route's environment ─────────────────────────────────────────────── */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));
const gate = vi.hoisted(() => ({
  answer: { user: { email: "qa@example.invalid" } } as unknown,
}));

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(async () => gate.answer),
}));

vi.mock("@/lib/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDbClient: () => {
      if (readWith.client === undefined) {
        throw new Error("the settle route was driven without a scripted database");
      }
      return readWith.client as SupabaseClient;
    },
  };
});

const { POST } = await import(
  "@/app/api/admin/review-items/[reviewItemId]/settle/route"
);

const ACTOR = "qa@example.invalid";
const ITEM_ID = ID.reviewItemDataConflict;

function scriptDatabase(script: Script): StubClient {
  const stub = stubClient(script);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

/** A database where the function IS installed and answers with its receipt. */
function functionInstalled(action = "keep_current"): Script {
  return { [FN.settleReviewItem]: { data: verdictLogEntry({ action }) } };
}

/**
 * Post one control's body the way the browser posts it, and hand back the
 * stub so the call it made — or did not make — can be asked about.
 */
async function post(
  body: unknown,
  reviewItemId: string = ITEM_ID,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const request = new Request(
    `http://127.0.0.1/api/admin/review-items/${reviewItemId}/settle`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const response = await POST(request, {
    params: Promise.resolve({ reviewItemId }),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { status: response.status, payload };
}

beforeEach(() => {
  gate.answer = { user: { email: ACTOR } };
  readWith.client = undefined;
});

/* ── the evidence this item is about ─────────────────────────────────────── */

/**
 * One resolved claim, as the page hands it to both the evidence view and the
 * shape's action builder — the same rows, which is what makes "one control per
 * evidence card" checkable at all.
 *
 * Local to this file because no builder for `EvidenceRow` exists anywhere in
 * `tests/fixtures/` (grepped); its ids and values come from the shared row
 * fixtures so a failure names a recognisable claim.
 */
function evidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    observationId: ID.observationA,
    value: "TWICE 5TH WORLD TOUR",
    source: "ticketmaster",
    sourceHref: `/sources/${ID.sourceTicketmaster}`,
    tier: "official",
    observedAt: "2026-08-31T22:10:00Z",
    status: "pending",
    payloadRef: "ticketmaster/2026-08-31/G5vYZ9d1.json",
    fact: "events.title",
    recordHref: `/records/events/${ID.eventEntity}`,
    held: null,
    ...overrides,
  };
}

/** The TWO cards spec §7's first action needs one control each for. */
function twoCards(): EvidenceRow[] {
  return [
    evidenceRow(),
    evidenceRow({
      observationId: ID.observationB,
      value: "TWICE World Tour",
      source: "bandsintown",
      sourceHref: `/sources/${ID.sourceBandsintown}`,
      tier: "standard",
      observedAt: "2026-09-01T04:00:00Z",
    }),
  ];
}

/** The list this shape offers for an item and its evidence. */
function actionsFor(
  item: ReviewItemRow = reviewItemDataConflict(),
  evidence: readonly EvidenceRow[] = twoCards(),
): readonly ActionSpec[] {
  return ACTIONS_BY_SHAPE.data_conflict_fact({ item, evidence });
}

/** The decision the route builds from one control's body. */
function decisionOf(spec: ActionSpec, note = "", supplied: string | null = null): VerdictDecision {
  const body = settleBody(spec, note, supplied);
  return {
    action: body.action,
    review_item_id: ITEM_ID,
    actor: ACTOR,
    note: body.note,
    value: body.value,
  };
}

/* ── the list: three actions, and nothing else ───────────────────────────── */

describe("the data_conflict item's action list", () => {
  it("offers one control per evidence card, then supply, then keep current", () => {
    const evidence = twoCards();
    const actions = actionsFor(reviewItemDataConflict(), evidence);

    expect(actions.map((spec) => spec.action)).toEqual([
      "choose_claimed_value",
      "choose_claimed_value",
      "supply_value",
      "keep_current",
    ]);
    // The controls are the shape's whole vocabulary — the eight action names
    // exist, and this shape takes exactly these three of them.
    expect(new Set(actions.map((spec) => spec.action)).size).toBe(3);
  });

  it("grows and shrinks with the evidence, one choose control per card", () => {
    for (const cards of [0, 1, 2, 3]) {
      const evidence = twoCards()
        .slice(0, Math.min(cards, 2))
        .concat(
          cards > 2
            ? [evidenceRow({ observationId: ID.observationA, source: "eventbrite" })]
            : [],
        );
      const actions = actionsFor(reviewItemDataConflict(), evidence);
      const chosen = actions.filter((spec) => spec.action === "choose_claimed_value");
      expect(chosen, `${cards} card(s)`).toHaveLength(evidence.length);
      // The other two stand whatever the evidence does: an item with no
      // resolved claim can still be settled with the operator's own value or
      // left as it stands.
      expect(
        actions.filter((spec) => spec.action !== "choose_claimed_value").map((s) => s.action),
        `${cards} card(s)`,
      ).toEqual(["supply_value", "keep_current"]);
    }
  });

  it("carries the observation id of the card each control sits on", () => {
    const evidence = twoCards();
    const actions = actionsFor(reviewItemDataConflict(), evidence);
    const chosen = actions.filter((spec) => spec.action === "choose_claimed_value");

    // Two DIFFERENT cards, so a control wired to the wrong one fails here.
    expect(evidence[0].observationId).not.toBe(evidence[1].observationId);
    expect(chosen.map((spec) => spec.value?.observation_id)).toEqual([
      evidence[0].observationId,
      evidence[1].observationId,
    ]);
    // And nothing else in its payload: an adopted claim carries no scalar and
    // no ref (`decisionRefusals` invariant 5 would refuse two filled slots).
    for (const spec of chosen) {
      expect(spec.value).toMatchObject({
        domain: "events",
        entity_id: ID.eventEntity,
        field: "title",
        value: null,
        ref: null,
      });
    }
  });

  it("names the value and the source it adopts, and the dash for a null one", () => {
    const evidence = [
      evidenceRow(),
      evidenceRow({ observationId: ID.observationB, value: null, source: "bandsintown" }),
    ];
    const [first, second] = actionsFor(reviewItemDataConflict(), evidence);

    // Two controls stand side by side: the label has to say which write it is.
    expect(first.label).not.toBe(second.label);
    expect(first.label).toContain("TWICE 5TH WORLD TOUR");
    expect(first.label).toContain("ticketmaster");
    // A claim of nothing is a claim: the dash, with no qualifier (LESSONS 1).
    expect(second.label).toContain(EM_DASH);
    expect(second.label.toLowerCase()).not.toContain("null");
    expect(second.label.toLowerCase()).not.toContain("unknown");
    expect(second.label.toLowerCase()).not.toContain("missing");
  });

  it("says the fact the supplied value is typed for, and pre-fills none", () => {
    const supply = actionsFor().find((spec) => spec.action === "supply_value");
    expect(supply?.supplies).toBe("events.title");
    // The scalar does not exist until the operator types it.
    expect(supply?.value).toMatchObject({ observation_id: null, value: null, ref: null });
    // Every other control is a button and takes no typed value.
    for (const spec of actionsFor().filter((s) => s.action !== "supply_value")) {
      expect(spec.supplies, spec.action).toBeUndefined();
    }
  });

  it("keeps current with no payload at all", () => {
    const keep = actionsFor().find((spec) => spec.action === "keep_current");
    expect(keep?.value).toBeNull();
    expect(keep?.supplies).toBeUndefined();
  });

  it("offers only keep-current when the row names no whole fact", () => {
    // The two value-carrying actions need a domain, a row and a field to land
    // on; a `VerdictValue` cannot be built without all three, and an action
    // offered with a payload the function would refuse is worse than one not
    // offered. `keep_current` carries no payload and still stands.
    for (const missing of [{ domain: null }, { entity_id: null }, { field: null }]) {
      const item = reviewItemDataConflict(missing);
      const actions = actionsFor(item);
      expect(actions.map((spec) => spec.action), JSON.stringify(missing)).toEqual([
        "keep_current",
      ]);
    }
  });

  it("is the list the by-shape map hands the data_conflict shape, and no other shape's", () => {
    const evidence = twoCards();
    expect(ACTIONS_BY_SHAPE.data_conflict_fact({ item: reviewItemDataConflict(), evidence })).toEqual(
      conflictActions({ item: reviewItemDataConflict(), evidence }),
    );
    // The other two shapes are their own tickets' work and are untouched here.
    for (const [shape, item] of [
      ["entity_link_fact", reviewItemEntityLink()],
      ["entity_link_source_pattern", reviewItemSourcePattern()],
    ] as const) {
      const other = ACTIONS_BY_SHAPE[shape]({ item, evidence });
      expect(
        other.some((spec) => spec.action === "choose_claimed_value"),
        shape,
      ).toBe(false);
    }
  });
});

/* ── each control's decision is well-formed ──────────────────────────────── */

describe("the decision each control carries", () => {
  it("is refused by nothing — `decisionRefusals` is empty for all three", () => {
    const actions = actionsFor();
    const supplied = "TWICE 5TH WORLD TOUR: ENCORE";
    for (const spec of actions) {
      const decision = decisionOf(spec, "the operator's reason", supplied);
      expect(decisionRefusals(decision), spec.action).toEqual([]);
    }
  });

  it("fills exactly the payload slot its action may fill", () => {
    const actions = actionsFor();
    const [firstChoice] = actions;
    expect(settleBody(firstChoice, "").value).toMatchObject({
      observation_id: ID.observationA,
      value: null,
      ref: null,
    });

    const supply = actions.find((spec) => spec.action === "supply_value") as ActionSpec;
    expect(settleBody(supply, "", "TWICE World Tour").value).toMatchObject({
      observation_id: null,
      value: "TWICE World Tour",
      ref: null,
    });
    // The merge is the frame's one place, and it leaves a button's payload alone.
    expect(decisionValue(firstChoice, "ignored")).toEqual(firstChoice.value);

    const keep = actions.find((spec) => spec.action === "keep_current") as ActionSpec;
    expect(settleBody(keep, "canonical stands").value).toBeNull();
  });

  it("refuses an empty supplied value locally, and sends nothing", async () => {
    const supply = actionsFor().find((spec) => spec.action === "supply_value") as ActionSpec;
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return Response.json({ ok: true });
    };

    // The input it MUST flag: an empty cell — `EditableCell` hands back null
    // for a blank field, and a whitespace-only one is the same defect.
    for (const empty of [null, "", "   "]) {
      expect(closeRefusal(supply, "", empty), JSON.stringify(empty)).toBe("value_required");
      const outcome = await submitSettlement({
        reviewItemId: ITEM_ID,
        spec: supply,
        note: "",
        supplied: empty,
        fetchImpl,
      });
      expect(outcome.ok, JSON.stringify(empty)).toBe(false);
    }
    expect(calls).toEqual([]);

    // …and the one it must NOT: a real value, on the same control.
    expect(closeRefusal(supply, "", "TWICE World Tour")).toBeNull();
    const sent = await submitSettlement({
      reviewItemId: ITEM_ID,
      spec: supply,
      note: "",
      supplied: "TWICE World Tour",
      fetchImpl,
    });
    expect(sent.ok).toBe(true);
    expect(calls).toHaveLength(1);

    // The two button controls take no value and are refused for none of it.
    for (const spec of actionsFor().filter((s) => s.action !== "supply_value")) {
      expect(closeRefusal(spec, "", null), spec.action).toBeNull();
    }
  });

  it("tells the operator what to do, never the identifier (LESSONS 5)", () => {
    const words = refusalWords("value_required");
    expect(words).not.toContain("value_required");
    expect(words).not.toContain("_");
    expect(words.length).toBeGreaterThan(20);
  });
});

/* ── the route: one call per control, and one only ───────────────────────── */

describe("each control settles through exactly one call", () => {
  it("makes ONE call to the one function, carrying the whole typed decision", async () => {
    const cases: ReadonlyArray<readonly [ActionSpec, string | null]> = actionsFor().map(
      (spec) => [spec, spec.action === "supply_value" ? "TWICE World Tour" : null] as const,
    );
    expect(cases).toHaveLength(4);

    for (const [spec, supplied] of cases) {
      const stub = scriptDatabase(functionInstalled(spec.action));
      const note = "the operator's reason";
      const { status, payload } = await post(settleBody(spec, note, supplied));

      expect(status, spec.action).toBe(200);
      expect(payload.ok, spec.action).toBe(true);
      // Exactly one interaction, and it is the function — not a read, not a
      // second write, not a retry.
      expect(stub.calls, spec.action).toHaveLength(1);
      expect(stub.functionsCalled(), spec.action).toEqual([FN.settleReviewItem]);
      expect(stub.tablesRead(), spec.action).toEqual([]);

      const args = stub.calls[0].steps[0].args[0] as Record<string, unknown>;
      expect(Object.keys(args), spec.action).toEqual(["p_decision"]);
      expect(args.p_decision, spec.action).toEqual(decisionOf(spec, note, supplied));
    }
  });

  it("stamps the item and the actor itself, whatever the control sent", async () => {
    const [choice] = actionsFor();
    const stub = scriptDatabase(functionInstalled("choose_claimed_value"));
    await post({
      ...settleBody(choice, ""),
      // Forged, and ignored: the verdict log records who was signed in.
      actor: "someone.else@example.invalid",
    });
    const decision = (stub.calls[0].steps[0].args[0] as Record<string, unknown>)
      .p_decision as Record<string, unknown>;
    expect(decision.review_item_id).toBe(ITEM_ID);
    expect(decision.actor).toBe(ACTOR);
  });

  it("answers 503 naming the absent function, still after exactly one call", async () => {
    // The normal case for the whole of M2: the control was rendered because
    // `verdicts` was there, and the function was not.
    const keep = actionsFor().find((spec) => spec.action === "keep_current") as ActionSpec;
    const stub = scriptDatabase({
      [FN.settleReviewItem]: { error: functionNotInSchemaCache(FN.settleReviewItem) },
    });
    const { status, payload } = await post(settleBody(keep, ""));
    expect(status).toBe(503);
    expect(payload.missing).toBe(FN.settleReviewItem);
    expect(stub.functionsCalled()).toEqual([FN.settleReviewItem]);
  });
});

/* ── the frame: what the slot renders, and what it does not ──────────────── */

function slotMarkup(
  readiness: Parameters<typeof CloseSlot>[0]["readiness"],
  item: ReviewItemRow = reviewItemDataConflict(),
  evidence: readonly EvidenceRow[] = twoCards(),
): string {
  return render(
    h(CloseSlot, { item, readiness, actions: actionsFor(item, evidence) }),
  );
}

describe("the close slot with the verdict log present", () => {
  it("renders exactly these controls and no other", () => {
    const evidence = twoCards();
    const $ = cheerio.load(slotMarkup({ kind: "ok" }, reviewItemDataConflict(), evidence));

    expect(
      $("[data-close-action]")
        .toArray()
        .map((element) => $(element).attr("data-close-action")),
    ).toEqual([
      "choose_claimed_value",
      "choose_claimed_value",
      "supply_value",
      "keep_current",
    ]);
    expect($('[data-close-action="choose_claimed_value"]')).toHaveLength(evidence.length);

    // "No other control": the note field, and every control that is one of
    // the four above (the supply cell's resting button is inside its own).
    expect($("textarea")).toHaveLength(1);
    expect($("[data-close-note]")).toHaveLength(1);
    expect($("select")).toHaveLength(0);
    // The cell rests as a button, so no input is open before anyone clicks.
    expect($("input")).toHaveLength(0);
    expect($("form")).toHaveLength(0);
    expect(
      $("button")
        .toArray()
        .filter((element) => $(element).closest("[data-close-action]").length === 0),
    ).toEqual([]);
  });

  it("puts the operator's words on the control and the machine's name on the hook", () => {
    const $ = cheerio.load(slotMarkup({ kind: "ok" }));
    const keep = $('[data-close-action="keep_current"]');
    expect(keep.text()).toContain("Keep current");
    // The action name is the hook, never the label.
    expect(keep.text()).not.toContain("keep_current");

    const supply = $('[data-close-action="supply_value"]');
    expect(supply.text()).toContain("Supply a different value");
    // The fact is a machine identifier and renders verbatim beside the words.
    expect(supply.text()).toContain("events.title");
  });

  it("reads as sentences: no run-together words, no ticket ids, no uppercased identifier", () => {
    const markup = slotMarkup({ kind: "ok" });
    expect(runTogetherWords(markup)).toEqual([]);
    expect(factoryTicketIds(markup)).toEqual([]);
    expect(uppercasedIdentifiers(markup)).toEqual([]);
  });

  it("offers nothing on an item that is already settled", () => {
    const $ = cheerio.load(
      slotMarkup({ kind: "ok" }, reviewItemDataConflict({ status: "settled" })),
    );
    expect($("[data-close-action]")).toHaveLength(0);
    for (const control of ["button", "input", "select", "textarea", "form"]) {
      expect($(control), control).toHaveLength(0);
    }
  });
});

describe("the close slot with the verdict log absent — the graded-first case", () => {
  it("renders none of the three controls, and the not-provisioned card instead", () => {
    for (const readiness of [
      { kind: "not_provisioned", missing: T.verdicts } as const,
      { kind: "not_provisioned", missing: FN.settleReviewItem } as const,
    ]) {
      const $ = cheerio.load(slotMarkup(readiness));
      expect($('[data-state="not_provisioned"]')).toHaveLength(1);
      expect(
        $("*")
          .toArray()
          .some((element) => $(element).text().trim() === readiness.missing),
        readiness.missing,
      ).toBe(true);
      expect($("[data-close-action]"), readiness.missing).toHaveLength(0);
      expect($("[data-close-note]"), readiness.missing).toHaveLength(0);
      for (const control of ["button", "form", "input", "select", "textarea"]) {
        expect($(control), `${control} / ${readiness.missing}`).toHaveLength(0);
      }
    }
  });

  it("offers nothing even though this shape HAS three actions to offer", () => {
    // The point of the branch: the controls are withheld because the function
    // is missing, not because the list is empty. It is not.
    expect(actionsFor().length).toBeGreaterThan(0);
    const $ = cheerio.load(slotMarkup({ kind: "not_provisioned", missing: T.verdicts }));
    expect($("[data-close-action]")).toHaveLength(0);
  });

  it("says a refused read as an error line, and still offers no control", () => {
    const $ = cheerio.load(
      slotMarkup({ kind: "error", reading: T.verdicts, message: "canceling statement" }),
    );
    expect($('[data-state="error"]')).toHaveLength(1);
    expect($("[data-close-action]")).toHaveLength(0);
  });
});

/* ── the evidence cards below it, unchanged ──────────────────────────────── */

const ConflictEvidence = EVIDENCE_VIEW_BY_SHAPE.data_conflict_fact;

const EMPTY_WORDS = {
  holds: "claims on this item",
  filledBy:
    "The resolver appends an observation id to `evidence` each time this item folds; this one carries none.",
};

function evidenceMarkup(rows: readonly EvidenceRow[]): string {
  return render(
    h(ConflictEvidence, {
      rows,
      unresolved: [],
      empty: EMPTY_WORDS,
      canonical: {
        value: "TWICE 5TH WORLD TOUR",
        provenance: "ticketmaster · official at apply · applied 3d ago",
      },
      dial: null,
    }),
  );
}

describe("the evidence cards this ticket does not touch", () => {
  it("renders one contender card per claim, with the canonical card last", () => {
    const $ = cheerio.load(evidenceMarkup(twoCards()));
    expect($("[data-pair]")).toHaveLength(1);
    // The claims' own hooks, one per claim, in fold order.
    expect(
      $("[data-evidence]")
        .toArray()
        .map((element) => $(element).attr("data-evidence")),
    ).toEqual([ID.observationA, ID.observationB]);
    // No verdict control lives in the evidence block: the close owns them all.
    expect($("[data-close-action]")).toHaveLength(0);
  });

  it("renders a null claim value as the dash, with no qualifier (LESSONS 1)", () => {
    const $ = cheerio.load(
      evidenceMarkup([evidenceRow({ value: null }), evidenceRow({ observationId: ID.observationB })]),
    );
    const dashes = $('[aria-label="no value"]');
    expect(dashes.length).toBeGreaterThan(0);
    expect(dashes.first().text()).toBe(EM_DASH);
    // The dash stands alone: no "(none)", no "unknown", no explanatory word.
    const text = $.root().text().toLowerCase();
    expect(text).not.toContain("(none)");
    expect(text).not.toContain("no value recorded");
  });

  it("renders its labelled empty state when the item resolved no claim at all", () => {
    const $ = cheerio.load(evidenceMarkup([]));
    expect($('[data-state="empty"]')).toHaveLength(1);
    expect($.root().text()).toContain(EMPTY_WORDS.holds);
    // Still a real block, never a bare slot.
    expect($("[data-evidence-view]")).toHaveLength(1);
  });
});
