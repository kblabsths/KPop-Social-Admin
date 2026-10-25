import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FN, T } from "@/lib/db/tables";
import { CloseSlot } from "@/components/review/close/slot";
import {
  CloseStatus,
  SettledNotice,
  focusReturns,
  noteHint,
} from "@/components/review/close/form";
import {
  noteIsRequiredBy,
  settlePath,
  submitSettlement,
  type ActionSpec,
} from "@/components/review/close/actions";
import type { ReviewItemRow } from "@/lib/review/shapes";
import { h, render } from "../ui/markup";
import {
  ID,
  reviewItemDataConflict,
  verdictLogEntry,
  verdictValue,
} from "../../fixtures/rows";
import {
  functionNotInSchemaCache,
  statementTimeout,
  stubClient,
  undefinedFunction,
  type Script,
  type StubClient,
} from "../../fixtures/stub-client";

/**
 * The close slot — its frame, its seams and its route (campaign
 * admin-window/TASK-0049, spec §7, ARCHITECTURE.md §9.2).
 *
 * **The ABSENT world is graded first.** This file opens with a fixture that
 * withholds both the verdict log and `settle_review_item` — which databases
 * are in that world is ARCHITECTURE.md §9.2's to say, not this file's — and
 * grades the not-provisioned card, naming the object the read named, with no
 * control of any kind. The ready path follows it.
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

/** A database where it is not — the absent world (ARCHITECTURE.md §9.2). */
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

/* ── the pure seams ──────────────────────────────────────────────────────── */

describe("the form's own refusal", () => {
  it("says the note is required only where the list can require it", () => {
    expect(noteIsRequiredBy([spec({ action: "wont_fix" })])).toBe(true);
    expect(noteIsRequiredBy([spec({ action: "fixed" }), spec()])).toBe(false);
    expect(noteIsRequiredBy([])).toBe(false);
    expect(noteHint([spec({ action: "wont_fix" })])).not.toBe(noteHint([]));
  });
});

describe("the body one control posts", () => {
  it("names the item in the path, encoded", () => {
    expect(settlePath(ITEM_ID)).toBe(
      `/api/admin/review-items/${ITEM_ID}/settle`,
    );
    expect(settlePath("a b/c")).toBe("/api/admin/review-items/a%20b%2Fc/settle");
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
    // The machine's own name travels on the hook, not in the sentence
    // (Ben, 2026-10-24) — the words the operator pressed are the words they
    // get back.
    expect($("[data-close-settled]").attr("data-close-settled")).toBe("keep_current");
    expect($.root().text()).not.toContain("keep_current");
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
    // The absent world (ARCHITECTURE.md §9.2 says which databases are in it).
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
});
