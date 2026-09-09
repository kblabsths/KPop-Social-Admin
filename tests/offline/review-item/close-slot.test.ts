import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerdictAction } from "@/lib/verdict/decision";
import { FN, T } from "@/lib/db/tables";
import {
  CloseSlot,
  ACTIONS_BY_SHAPE,
} from "@/components/review/close/slot";
import {
  CloseStatus,
  SettledNotice,
  focusReturns,
  noteHint,
} from "@/components/review/close/form";
import {
  closeRefusal,
  noteIsRequiredBy,
  refusalWords,
  settleBody,
  settlePath,
  submitSettlement,
  type ActionSpec,
} from "@/components/review/close/actions";
import { SHAPES, type ReviewItemRow, type Shape } from "@/lib/review/shapes";
import { h, render } from "../ui/markup";
import {
  ID,
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemSourcePattern,
  verdictLogEntry,
  verdictValue,
} from "../../fixtures/rows";
import {
  functionNotInSchemaCache,
  statementTimeout,
  stubClient,
  tableNotInSchemaCache,
  undefinedFunction,
  type Script,
  type StubClient,
} from "../../fixtures/stub-client";

/**
 * The close slot — its frame, its seams and its route (campaign
 * admin-window/TASK-0049, spec §7, ARCHITECTURE.md §9.2).
 *
 * **The ABSENT case is graded first, because it is the normal one.** Neither
 * the verdict log nor `settle_review_item` exists on staging or in production
 * and neither will until Ben installs M2's handoff migrations, so the state
 * this file opens with is the one `main` deploys against for the whole
 * milestone: the not-provisioned card, naming the object the read named, with
 * no control of any kind. The ready path follows it.
 *
 * Three tiers, in one file because they are one behaviour:
 *
 *  - the FRAME, rendered with `renderToStaticMarkup` and no jsdom — the page
 *    is the route's only async boundary and every child is a pure sync
 *    component (ARCHITECTURE.md §5);
 *  - the SEAMS (`actions.ts`), pure over an injected `fetch`, so what one
 *    control sends — and what it refuses to send — is graded with no network;
 *  - the ROUTE, driven the way the network would drive it, with the gate
 *    stubbed OPEN on purpose (that is the adversary's premise: a caller who
 *    IS an allowlisted admin is still held to the refusals) and the database
 *    behind a RECORDING stub, so "no database call was even attempted" is
 *    observable rather than asserted.
 *
 * Assertions are structure and behaviour: which controls exist, what crossed
 * the wire, how many calls were made, which status came back. The app's own
 * sentences are the designer's and are not pinned.
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

const { POST, ...OTHER_HANDLERS } = await import(
  "@/app/api/admin/review-items/[reviewItemId]/settle/route"
);

/** Script the database the next request reads, and keep the stub to ask it. */
function scriptDatabase(script: Script): StubClient {
  const stub = stubClient(script);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

const ITEM_ID = ID.reviewItemDataConflict;

/** Drive the handler the way the network would: a Request and route params. */
async function settle(
  body: unknown,
  reviewItemId: string = ITEM_ID,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const request = new Request(
    `http://127.0.0.1/api/admin/review-items/${reviewItemId}/settle`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
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

/** A database where the function is INSTALLED and returns its receipt. */
function functionInstalled(action = "keep_current"): Script {
  return { [FN.settleReviewItem]: { data: verdictLogEntry({ action }) } };
}

/** A database where it is not — staging today, and `main`'s deploy target. */
function functionAbsent(): Script {
  return {
    [FN.settleReviewItem]: { error: functionNotInSchemaCache(FN.settleReviewItem) },
  };
}

beforeEach(() => {
  gate.answer = { user: { email: "qa@example.invalid" } };
  readWith.client = undefined;
});

/* ── the frame: the absent answer, graded first ──────────────────────────── */

/** One control of each kind the slot must never render while it cannot settle. */
const CONTROLS = ["button", "form", "input", "select", "textarea"];

function slotMarkup({
  item = reviewItemDataConflict(),
  readiness,
  actions = [],
}: {
  item?: ReviewItemRow;
  readiness: Parameters<typeof CloseSlot>[0]["readiness"];
  actions?: readonly ActionSpec[];
}): string {
  return render(h(CloseSlot, { item, readiness, actions }));
}

/** A fabricated control, so the ready state can be graded before any shape fills its list. */
function spec(overrides: Partial<ActionSpec> = {}): ActionSpec {
  return {
    label: "Keep current value",
    action: "keep_current",
    value: null,
    ...overrides,
  };
}

describe("the close slot with the verdict log absent", () => {
  it("renders the not-provisioned state naming the object, and no control at all", () => {
    const markup = slotMarkup({
      readiness: { kind: "not_provisioned", missing: T.verdicts },
    });
    const $ = cheerio.load(markup);

    expect($('[data-state="not_provisioned"]')).toHaveLength(1);
    // Named in the spelling the query used, in its own element — the way the
    // absence sweep reads it (`tests/offline/absence/pages.test.ts`).
    expect(
      $("*")
        .toArray()
        .some((element) => $(element).text().trim() === T.verdicts),
    ).toBe(true);
    for (const control of CONTROLS) expect($(control), control).toHaveLength(0);
    expect($("[data-close-action]")).toHaveLength(0);
    expect($("[data-close-note]")).toHaveLength(0);
  });

  it("offers nothing even when the shape HAS actions to offer", () => {
    // The whole point of the branch: a control is not offered because the
    // function is missing, not because the list happens to be empty today.
    const $ = cheerio.load(
      slotMarkup({
        readiness: { kind: "not_provisioned", missing: T.verdicts },
        actions: [spec(), spec({ action: "wont_fix", label: "Close as won’t fix" })],
      }),
    );
    for (const control of CONTROLS) expect($(control), control).toHaveLength(0);
    expect($("[data-close-action]")).toHaveLength(0);
  });

  it("says a refused read as an error line, and still offers no control", () => {
    const $ = cheerio.load(
      slotMarkup({
        readiness: {
          kind: "error",
          reading: T.verdicts,
          message: statementTimeout().message,
        },
        actions: [spec()],
      }),
    );
    expect($('[data-state="error"]')).toHaveLength(1);
    expect($.root().text()).toContain(statementTimeout().message);
    for (const control of CONTROLS) expect($(control), control).toHaveLength(0);
  });
});

/* ── the frame: the ready answer ─────────────────────────────────────────── */

describe("the close slot with the verdict log present", () => {
  it("renders the note field and this shape's controls, in the list's order", () => {
    const actions = [
      spec({ label: "Mark fixed", action: "fixed" }),
      spec({ label: "Close as won’t fix", action: "wont_fix" }),
    ];
    const $ = cheerio.load(slotMarkup({ readiness: { kind: "ok" }, actions }));

    expect($("[data-close-note]")).toHaveLength(1);
    expect(
      $("[data-close-action]")
        .toArray()
        .map((element) => $(element).attr("data-close-action")),
    ).toEqual(["fixed", "wont_fix"]);
    // The operator's own words are on the control (copy bar 1), and the
    // machine's action name is the hook — never the label.
    expect($('[data-close-action="fixed"]').text()).toContain("Mark fixed");
    expect($('[data-state]')).toHaveLength(0);
  });

  it("renders the note field and no control at all for a shape with no actions yet", () => {
    const $ = cheerio.load(slotMarkup({ readiness: { kind: "ok" }, actions: [] }));

    expect($("[data-close-note]")).toHaveLength(1);
    expect($("[data-close-action]")).toHaveLength(0);
    expect($("button")).toHaveLength(0);
    // It says WHY, and says nothing about the database: the read answered.
    expect($.root().text().trim().length).toBeGreaterThan(0);
    expect($('[data-state="empty"]')).toHaveLength(0);
    expect($('[data-state="not_provisioned"]')).toHaveLength(0);
  });

  it("offers no control on an item that is already settled", () => {
    // A settled item stays browsable (spec §4); a settle control on it would
    // offer an action the function refuses.
    const $ = cheerio.load(
      slotMarkup({
        item: reviewItemDataConflict({ status: "settled" }),
        readiness: { kind: "ok" },
        actions: [spec()],
      }),
    );
    for (const control of CONTROLS) expect($(control), control).toHaveLength(0);
    expect($("[data-close-item-status]").attr("data-close-item-status")).toBe("settled");
    // The status is the machine's own word, rendered verbatim.
    expect($.root().text()).toContain("settled");
  });

  it("names no ticket and no recommendation, in either state", () => {
    for (const readiness of [
      { kind: "ok" } as const,
      { kind: "not_provisioned", missing: T.verdicts } as const,
    ]) {
      const text = cheerio
        .load(slotMarkup({ readiness, actions: [spec()] }))
        .root()
        .text()
        .toLowerCase();
      expect(text).not.toContain("recommend");
    }
  });
});

/* ── the by-shape map ────────────────────────────────────────────────────── */

describe("the shape's action list", () => {
  /**
   * The actions each shape offers over NO evidence, as the shape modules stand
   * today — each written by its own ticket, in its own worktree.
   *
   * `data_conflict` is filled (campaign admin-window/TASK-0050): with no
   * evidence card there is no claim to adopt, and its other two actions stand
   * regardless, so the operator can still supply a value or leave the fact as
   * it is. Its own suite grades the whole list
   * (`tests/offline/review-item/conflict-actions.test.ts`). The other two ship
   * an empty list until their tickets fill them, and this table is what those
   * tickets amend — one place, rather than a claim repeated per shape.
   */
  const OFFERED: Readonly<Record<Shape, readonly VerdictAction[]>> = {
    data_conflict_fact: ["supply_value", "keep_current"],
    entity_link_fact: [],
    entity_link_source_pattern: [],
  };

  it("answers for every shape, with the actions that shape offers and no other", () => {
    const items: Record<string, ReviewItemRow> = {
      data_conflict_fact: reviewItemDataConflict(),
      entity_link_fact: reviewItemEntityLink(),
      entity_link_source_pattern: reviewItemSourcePattern(),
    };
    for (const shape of SHAPES) {
      const actions = ACTIONS_BY_SHAPE[shape]({ item: items[shape], evidence: [] });
      expect(actions.map((spec) => spec.action), shape).toEqual(OFFERED[shape]);
      // Whatever a shape offers, the frame's own invariant holds: a settle-only
      // action carries no payload and a value-carrying one carries an envelope,
      // which is `decisionRefusals` invariant 4 seen from this side.
      for (const spec of actions) {
        expect(typeof spec.label, `${shape} ${spec.action}`).toBe("string");
        expect(spec.label.length, `${shape} ${spec.action}`).toBeGreaterThan(0);
      }
    }
    // Total by construction: every shape has an entry, so a fourth shape is a
    // compile error rather than a missing action list.
    expect(Object.keys(ACTIONS_BY_SHAPE).sort()).toEqual([...SHAPES].sort());
  });
});

/* ── the pure seams ──────────────────────────────────────────────────────── */

describe("the form's own refusal", () => {
  it("refuses a won’t-fix with no note, and does not refuse one with a note", () => {
    const wontFix = spec({ action: "wont_fix", label: "Close as won’t fix" });
    // The input it MUST flag, in every blank spelling…
    for (const note of ["", "   ", "\n\t "]) {
      expect(closeRefusal(wontFix, note), JSON.stringify(note)).toBe("note_required");
    }
    // …and the ones it must NOT: a real note, and every other action, which
    // takes a note at the admin's discretion (spec §7).
    expect(closeRefusal(wontFix, "the source is retired")).toBeNull();
    for (const action of ["fixed", "keep_current", "settle", "link_entity"] as const) {
      expect(closeRefusal(spec({ action }), ""), action).toBeNull();
    }
  });

  it("reads as words an operator can act on, never as the identifier", () => {
    const words = refusalWords("note_required");
    expect(words).not.toContain("note_required");
    expect(words.length).toBeGreaterThan(20);
  });

  it("says the note is required only where the list can require it", () => {
    expect(noteIsRequiredBy([spec({ action: "wont_fix" })])).toBe(true);
    expect(noteIsRequiredBy([spec({ action: "fixed" }), spec()])).toBe(false);
    expect(noteIsRequiredBy([])).toBe(false);
    expect(noteHint([spec({ action: "wont_fix" })])).not.toBe(noteHint([]));
  });
});

describe("the body one control posts", () => {
  it("carries the action and the payload, and blanks the note to null", () => {
    const value = verdictValue({ observation_id: ID.observationA });
    const chosen = spec({ action: "choose_claimed_value", value });
    expect(settleBody(chosen, "  because it is right  ")).toEqual({
      action: "choose_claimed_value",
      note: "because it is right",
      value,
    });
    expect(settleBody(spec(), "   ")).toEqual({
      action: "keep_current",
      note: null,
      value: null,
    });
  });

  it("names the item in the path, encoded", () => {
    expect(settlePath(ITEM_ID)).toBe(
      `/api/admin/review-items/${ITEM_ID}/settle`,
    );
    expect(settlePath("a b/c")).toBe("/api/admin/review-items/a%20b%2Fc/settle");
  });

  it("does not carry the actor or the item: the server stamps both", () => {
    // A body that could name them is a verdict log anyone past the gate could
    // write in someone else's name.
    expect(Object.keys(settleBody(spec(), "note")).sort()).toEqual([
      "action",
      "note",
      "value",
    ]);
  });
});

describe("submitting one settlement", () => {
  /** A fetch that records what it was asked for and answers `response`. */
  function recordingFetch(response: Response) {
    const calls: { url: string; init: { method: string; body: string } }[] = [];
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, init });
      return response;
    };
    return { calls, fetchImpl };
  }

  it("sends nothing at all when the form refuses it first", async () => {
    const { calls, fetchImpl } = recordingFetch(Response.json({ ok: true }));
    const outcome = await submitSettlement({
      reviewItemId: ITEM_ID,
      spec: spec({ action: "wont_fix" }),
      note: "  ",
      fetchImpl,
    });
    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("posts one request to the one route, and reports what settled", async () => {
    const { calls, fetchImpl } = recordingFetch(
      Response.json({ ok: true, verdict: verdictLogEntry() }),
    );
    const outcome = await submitSettlement({
      reviewItemId: ITEM_ID,
      spec: spec({ action: "fixed" }),
      note: "fixed on the source page",
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: true, action: "fixed" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(settlePath(ITEM_ID));
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      action: "fixed",
      note: "fixed on the source page",
      value: null,
    });
  });

  it("carries a refusal's own words back, and the absent object with them", async () => {
    const refused = await submitSettlement({
      reviewItemId: ITEM_ID,
      spec: spec(),
      note: "",
      fetchImpl: recordingFetch(
        Response.json({ error: "the decision was refused: unknown_action" }, { status: 400 }),
      ).fetchImpl,
    });
    expect(refused).toEqual({
      ok: false,
      message: "the decision was refused: unknown_action",
    });

    const absent = await submitSettlement({
      reviewItemId: ITEM_ID,
      spec: spec(),
      note: "",
      fetchImpl: recordingFetch(
        Response.json(
          { error: `${FN.settleReviewItem} is not present in this database`, missing: FN.settleReviewItem },
          { status: 503 },
        ),
      ).fetchImpl,
    });
    expect(absent.ok).toBe(false);
    expect(absent).toMatchObject({ missing: FN.settleReviewItem });
  });

  it("reports a transport failure and a bodyless refusal without throwing", async () => {
    const thrown = await submitSettlement({
      reviewItemId: ITEM_ID,
      spec: spec(),
      note: "",
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
    });
    expect(thrown).toEqual({ ok: false, message: "fetch failed" });

    const bodyless = await submitSettlement({
      reviewItemId: ITEM_ID,
      spec: spec(),
      note: "",
      fetchImpl: async () => new Response("<html>gateway</html>", { status: 502 }),
    });
    expect(bodyless.ok).toBe(false);
    expect((bodyless as { message: string }).message).toContain("502");
  });
});

describe("what the operator is told while it settles", () => {
  it("announces work in flight politely and a refusal as an interruption", () => {
    const settling = cheerio.load(
      render(h(CloseStatus, { state: { kind: "settling", action: "fixed" } })),
    );
    expect(settling('[role="status"]')).toHaveLength(1);
    expect(settling('[role="alert"]')).toHaveLength(0);

    const refused = cheerio.load(
      render(h(CloseStatus, { state: { kind: "refused", message: "no note" } })),
    );
    expect(refused('[role="alert"]').text()).toContain("no note");

    expect(render(h(CloseStatus, { state: { kind: "idle" } }))).toBe("");
  });

  it("keeps the action's name from the button through to the settled state", () => {
    const $ = cheerio.load(
      render(h(SettledNotice, { action: "keep_current", label: "Keep current value" })),
    );
    expect($.root().text()).toContain("Keep current value");
    // The machine's own name renders verbatim beside it (§11).
    expect($("[data-close-settled]").attr("data-close-settled")).toBe("keep_current");
  });

  it("returns focus only when the write has answered and focus is adrift", () => {
    const settling = { kind: "settling", action: "fixed" } as const;
    // In flight: the control is disabled and cannot hold focus yet.
    expect(focusReturns({ state: settling, focusIsAdrift: true })).toBe(false);
    // Answered, and focus is on nothing the operator chose: take it back.
    expect(
      focusReturns({ state: { kind: "refused", message: "x" }, focusIsAdrift: true }),
    ).toBe(true);
    // Answered, but the operator moved on: leave it where they put it.
    expect(
      focusReturns({ state: { kind: "refused", message: "x" }, focusIsAdrift: false }),
    ).toBe(false);
    // Settled: the controls are gone, so there is nothing to focus.
    expect(
      focusReturns({
        state: { kind: "settled", action: "fixed", label: "Mark fixed" },
        focusIsAdrift: true,
      }),
    ).toBe(false);
  });
});

/* ── the route ───────────────────────────────────────────────────────────── */

describe("the settle route", () => {
  it("is POST and nothing else, so every other method is answered 405", () => {
    // Next answers a method a route file does not export with 405; exporting
    // one would BE the second entry point. This is that claim, structurally.
    expect(typeof POST).toBe("function");
    expect(Object.keys(OTHER_HANDLERS)).toEqual([]);
  });

  it("runs the gate first: a refused caller reaches no database at all", async () => {
    gate.answer = { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
    const stub = scriptDatabase(functionInstalled());
    const { status } = await settle({ action: "keep_current", note: null, value: null });
    expect(status).toBe(403);
    expect(stub.calls).toEqual([]);
  });

  it("makes exactly ONE call, and it is the one function", async () => {
    const stub = scriptDatabase(functionInstalled());
    const { status, payload } = await settle({
      action: "keep_current",
      note: "canonical stands",
      value: null,
    });

    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(stub.calls).toHaveLength(1);
    expect(stub.functionsCalled()).toEqual([FN.settleReviewItem]);
    expect(stub.tablesRead()).toEqual([]);
  });

  it("stamps the item from the URL and the actor from the session", async () => {
    const stub = scriptDatabase(functionInstalled());
    await settle({
      action: "keep_current",
      note: null,
      value: null,
      // Forged, and ignored: the log records who was signed in.
      actor: "someone.else@example.invalid",
    });

    const sent = stub.calls[0].steps[0].args[0] as Record<string, unknown>;
    const decision = sent.p_decision as Record<string, unknown>;
    expect(decision.review_item_id).toBe(ITEM_ID);
    expect(decision.actor).toBe("qa@example.invalid");
  });

  it("refuses a body naming a different item, and calls nothing", async () => {
    const stub = scriptDatabase(functionInstalled());
    const { status } = await settle({
      action: "keep_current",
      note: null,
      value: null,
      review_item_id: ID.reviewItemEntityLink,
    });
    expect(status).toBe(400);
    expect(stub.calls).toEqual([]);
  });

  it("answers 400 naming the refusal, with no database call, on every refused decision", async () => {
    const refused: ReadonlyArray<readonly [string, unknown, string]> = [
      ["an action that is not one of the eight", { action: "delete_everything" }, "unknown_action"],
      ["a won’t-fix with no note", { action: "wont_fix", note: null }, "note_required"],
      ["a won’t-fix with a blank note", { action: "wont_fix", note: "   " }, "note_required"],
      ["an item-less override, which this route never takes", { action: "override" }, "review_item_forbidden"],
      ["a settle carrying a payload", { action: "settle", value: verdictValue() }, "value_forbidden"],
      ["a value action carrying none", { action: "choose_claimed_value" }, "value_required"],
      ["a body with no action key at all", { note: "why" }, "unknown_action"],
    ];

    for (const [what, body, refusal] of refused) {
      const stub = scriptDatabase(functionInstalled());
      const { status, payload } = await settle(body);
      expect(status, what).toBe(400);
      expect(String(payload.error), what).toContain(refusal);
      expect(payload.refusals, what).toContain(refusal);
      // The claim this route exists to make: a refused decision never reaches
      // the database.
      expect(stub.calls, what).toEqual([]);
    }
  });

  it("refuses a body that is no decision at all, and calls nothing", async () => {
    // Every shape a client can send that is not an object carrying an action:
    // a 400 that says what is wrong with the body, and no database call. The
    // route's own guard answers these before `decisionRefusals` sees them,
    // which is the record route's order too — either way nothing is sent.
    for (const body of ["{not json", '"nope"', "[]", "null", "7"]) {
      const stub = scriptDatabase(functionInstalled());
      const { status, payload } = await settle(body);
      expect(status, body).toBe(400);
      expect(String(payload.error).length, body).toBeGreaterThan(0);
      expect(stub.calls, body).toEqual([]);
    }
  });

  it("answers a segment that is no id at all without asking the database", async () => {
    const stub = scriptDatabase(functionInstalled());
    const { status } = await settle(
      { action: "keep_current", note: null, value: null },
      "not-an-id",
    );
    expect(status).toBe(404);
    expect(stub.calls).toEqual([]);
  });

  it("answers the absent function 503, naming it, after exactly one call", async () => {
    // The normal case for the whole of M2, and the one `main` deploys against.
    for (const script of [
      functionAbsent(),
      { [FN.settleReviewItem]: { error: undefinedFunction(FN.settleReviewItem) } },
    ]) {
      const stub = scriptDatabase(script);
      const { status, payload } = await settle({
        action: "keep_current",
        note: null,
        value: null,
      });
      expect(status).toBe(503);
      expect(payload.missing).toBe(FN.settleReviewItem);
      expect(String(payload.error)).toContain(FN.settleReviewItem);
      expect(stub.functionsCalled()).toEqual([FN.settleReviewItem]);
    }
  });

  it("says what the database said when the call failed for another reason", async () => {
    const stub = scriptDatabase({
      [FN.settleReviewItem]: { error: statementTimeout() },
    });
    const { status, payload } = await settle({
      action: "keep_current",
      note: null,
      value: null,
    });
    expect(status).toBe(500);
    expect(String(payload.error)).toContain(statementTimeout().message);
    expect(stub.functionsCalled()).toEqual([FN.settleReviewItem]);
  });

  it("hands the whole decision over as the one argument the function takes", async () => {
    const stub = scriptDatabase(functionInstalled("choose_claimed_value"));
    const value = verdictValue({ observation_id: ID.observationA });
    await settle({ action: "choose_claimed_value", note: "this one", value });

    const args = stub.calls[0].steps[0].args[0] as Record<string, unknown>;
    // `p_decision` is a WIRE CONTRACT: PostgREST resolves an RPC by argument
    // names too, and answers the absence code for the wrong ones — a
    // provisioned function would render as an absent one.
    expect(Object.keys(args)).toEqual(["p_decision"]);
    expect(args.p_decision).toEqual({
      action: "choose_claimed_value",
      review_item_id: ITEM_ID,
      actor: "qa@example.invalid",
      note: "this one",
      value,
    });
  });

  it("never reads a table on this path", async () => {
    // The one database interaction is the function. A read here would be a
    // second path with the seam's name on the door.
    const stub = scriptDatabase({
      ...functionInstalled(),
      [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
    });
    await settle({ action: "keep_current", note: null, value: null });
    expect(stub.tablesRead()).toEqual([]);
  });
});
