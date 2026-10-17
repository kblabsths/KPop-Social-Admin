import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FN } from "@/lib/db/tables";
import { CloseSlot } from "@/components/review/close/slot";
import { dispositionActions } from "@/components/review/close/signal-actions";
import {
  closeRefusal,
  refusalWords,
  settleBody,
  settlePath,
  submitSettlement,
  type ActionSpec,
} from "@/components/review/close/actions";
import { SettledNotice } from "@/components/review/close/form";
import { decisionRefusals, type VerdictDecision } from "@/lib/verdict/decision";
import type { ReviewItemRow } from "@/lib/review/shapes";
import { h, render } from "../ui/markup";
import { reviewItemSourcePattern, verdictLogEntry } from "../../fixtures/rows";
import { stubClient, type Script, type StubClient } from "../../fixtures/stub-client";

/**
 * The signal item's two dispositions — campaign admin-window/TASK-0051, spec
 * §7, SPEC F10.
 *
 * The `entity_link` source-pattern item is the one shape staging really holds,
 * and it takes no verdict: it closes with a disposition. `fixed` — the
 * breakage was addressed on the surface that owns it — or `wont_fix`, **on
 * which the note is required**.
 *
 * Three guards stand between a blank note and the database. This file proves
 * the first two, as the ticket asks: the FORM's (`closeRefusal`, which sends
 * nothing at all) and `decisionRefusals`', reached through the route. The
 * third is `settle_review_item`'s own `raise`, which lives in the handoff
 * artifact and is graded by its test.
 *
 * What this file deliberately does NOT re-test: the frame itself. The slot's
 * three readiness branches, the note field's own behaviour, the route's gate,
 * its 405s, its forged-actor and forged-item refusals and its absent-function
 * 503 are shape-independent and belong to
 * `tests/offline/review-item/close-slot.test.ts`. Here they appear only where
 * a signal's own two actions are what travels through them.
 *
 * Assertions read the DELIVERED markup and the recorded calls — never a copy
 * literal. Every operator sentence is compared against the app's own exported
 * words or against the spec object under test, so a rewording is a copy change
 * and not a red suite. The two machine names, by contrast, ARE pinned: they
 * are the contract (§11, LESSONS 5).
 */

/* ── the route, driven the way the network drives it ─────────────────────── */

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

/** The signal item staging holds one of, and the id its close addresses. */
const SIGNAL = reviewItemSourcePattern();
const SIGNAL_ID = SIGNAL.review_item_id;

/** The signed-in admin the gate answers with, as the log will record them. */
const ACTOR = "qa@example.invalid";

/** Script the database the next request reads, and keep the stub to ask it. */
function scriptDatabase(script: Script): StubClient {
  const stub = stubClient(script);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

/** A database where the function is installed and hands back its receipt. */
function functionInstalled(action: string): Script {
  return {
    [FN.settleReviewItem]: {
      data: verdictLogEntry({ action, review_item_id: SIGNAL_ID }),
    },
  };
}

/** POST one control's body to the one route, at the signal item's address. */
async function post(
  body: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await POST(
    new Request(
      `http://127.0.0.1/api/admin/review-items/${SIGNAL_ID}/settle`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ reviewItemId: SIGNAL_ID }) },
  );
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { status: response.status, payload };
}

/** The one decision the one call carried, as the function will read it. */
function decisionSent(stub: StubClient): Record<string, unknown> {
  const sent = stub.calls[0].steps[0].args[0] as Record<string, unknown>;
  return sent.p_decision as Record<string, unknown>;
}

beforeEach(() => {
  gate.answer = { user: { email: ACTOR } };
  readWith.client = undefined;
});

/* ── reading the close, structurally ─────────────────────────────────────── */

/**
 * The type step LOOK_AND_FEEL's scale calls mono (`data`, 11/16, mono) — the
 * one §11 means by "machine identifiers render verbatim in mono". Named once,
 * as a typography contract rather than as styling: it is the same step
 * `SettledNotice` already renders a settled action in, and the point of the
 * assertion is that the two agree (copy bar 2, the word never changes).
 */
const MONO_STEP = "type-data";

/** The signal's own actions, as the shape module answers them. */
function signalActions(item: ReviewItemRow = SIGNAL): readonly ActionSpec[] {
  return dispositionActions({ item, evidence: [] });
}

/** The close slot as the page renders it for this item, in this readiness. */
function closeMarkup(
  readiness: Parameters<typeof CloseSlot>[0]["readiness"],
  item: ReviewItemRow = SIGNAL,
): string {
  return render(h(CloseSlot, { item, readiness, actions: signalActions(item) }));
}

/** The actions the slot actually offered, in rendered order. */
function offered(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-close-action]")
    .toArray()
    .map((element) => $(element).attr("data-close-action") ?? "");
}

/* ── the two dispositions ────────────────────────────────────────────────── */

describe("the signal item's dispositions", () => {
  it("carry no value, so neither is a settlement the payload rules can refuse", () => {
    const actions = signalActions();
    // Never vacuous: a loop over an unfilled list would assert nothing.
    expect(actions).toHaveLength(2);
    for (const spec of actions) {
      expect(spec.value, spec.action).toBeNull();
      // A signal writes no canonical value, so neither control is drawn as
      // the destructive one (`ActionSpec.variant`).
      expect(spec.variant ?? "secondary", spec.action).toBe("secondary");
      // The operator's words are the operator's, and are not the machine's
      // name reworded (LESSONS 5).
      expect(spec.label.trim().length, spec.action).toBeGreaterThan(0);
      expect(spec.label, spec.action).not.toBe(spec.action);
    }
  });

  it("do not vary with the item or with what it folded", () => {
    // A signal closes the same two ways whatever evidence it carries, so the
    // list is a constant of the shape and not a function of the row.
    const other = dispositionActions({
      item: reviewItemSourcePattern({ folded_count: 41, severity: "low" }),
      evidence: [],
    });
    expect(other).toHaveLength(2);
    expect(other).toEqual(signalActions());
  });
});

/* ── the close, with the verdict log installed ───────────────────────────── */

describe("the signal's close once the verdict log is installed", () => {
  const markup = closeMarkup({ kind: "ok" });

  it("puts the operator's words on the control and the machine's name on the hook", () => {
    const $ = cheerio.load(markup);
    expect(signalActions()).toHaveLength(2);
    for (const spec of signalActions()) {
      const control = $(`[data-close-action="${spec.action}"]`);
      expect(control, spec.action).toHaveLength(1);

      // Copy bar 1's words are what the operator reads, and the machine's own
      // name is the hook — the frame's rule, and the same one
      // `conflict-actions.test.ts` holds `keep_current` to. The label is NOT
      // that name reworded: "Close as won’t fix" is the button's sentence,
      // `wont_fix` is the action, and neither is derived from the other.
      const said = control.text().replace(/\s+/g, " ").trim();
      expect(said, spec.action).toBe(spec.label);
      expect(spec.label, spec.action).not.toBe(spec.action);
      // The snake_case name never reaches the sentence: "Close as won’t fix"
      // is copy, `wont_fix` is the action, and the control says the first and
      // hooks the second. (`fixed` is a word English also uses, which is why
      // this reads the identifier's own spelling rather than a substring.)
      if (spec.action.includes("_")) {
        expect(said, spec.action).not.toContain(spec.action);
      }
      expect(control.attr("data-close-action"), spec.action).toBe(spec.action);
    }
  });

  it("says each name verbatim in mono where the operator reads it: the settled state", () => {
    // §11's "render verbatim in mono" is met where the name actually reaches
    // the eye — the state that replaces the controls once the write lands
    // (`SettledNotice`), which is also what keeps the word the same between
    // control, confirmation and verdict log (copy bar 2). The control itself
    // carries the name on its hook, by the frame's rule above.
    expect(signalActions()).toHaveLength(2);
    for (const spec of signalActions()) {
      const $ = cheerio.load(
        render(h(SettledNotice, { action: spec.action, label: spec.label })),
      );
      const identifier = $(`.${MONO_STEP}`);
      expect(identifier, spec.action).toHaveLength(1);
      // Verbatim: not uppercased, not Title Cased, not de-underscored.
      expect(identifier.text(), spec.action).toBe(spec.action);
      expect($("[data-close-settled]").attr("data-close-settled"), spec.action).toBe(
        spec.action,
      );
    }
  });

  it("puts the note field beside them, described by its own hint", () => {
    const $ = cheerio.load(markup);
    // Beside THESE two, not beside an empty list.
    expect(offered(markup)).toEqual(["fixed", "wont_fix"]);
    const note = $("[data-close-note]");
    expect(note).toHaveLength(1);
    const hint = $(`#${note.attr("aria-describedby")}`);
    expect(hint).toHaveLength(1);
    expect(hint.text().trim().length).toBeGreaterThan(0);
  });
});

/* ── the first guard: the form refuses, and sends nothing ────────────────── */

/**
 * Notes with NOTHING VISIBLE in them (admin-window/BUG-0089): the whitespace
 * `String.prototype.trim()` did remove, beside the Cf format characters it did
 * not — what an operator gets by PASTING out of a web page, a PDF or a
 * spreadsheet export. The same list `tests/offline/verdict/decision.test.ts`
 * grades the second guard on, because the two guards must agree about which
 * notes are blank.
 */
const INVISIBLE_ONLY: readonly string[] = [
  "\u200b", // zero-width space
  "\u2060", // word joiner
  "\u00ad", // soft hyphen
  "\ufeff", // byte-order mark
  "\u00a0", // non-breaking space
  "\u3164", // hangul filler
  "  \u200b  ",
  "\u200b\u2060\u00ad\ufeff\u00a0\t\n",
];

describe("a won’t-fix with no note", () => {
  const [fixed, wontFix] = signalActions();

  /** A fetch that records what it was asked for and answers `response`. */
  function recordingFetch(response: Response) {
    const calls: { url: string; init: { method: string; body: string } }[] = [];
    return {
      calls,
      fetchImpl: async (
        url: string,
        init: { method: string; headers: Record<string, string>; body: string },
      ) => {
        calls.push({ url, init });
        return response;
      },
    };
  }

  it("is refused by the form in every blank spelling, and never in a written one", () => {
    // The input it MUST flag…
    for (const note of ["", "   ", "\n\t "]) {
      expect(closeRefusal(wontFix, note), JSON.stringify(note)).toBe("note_required");
    }
    // …and the ones it must NOT, or the guard above passes vacuously
    // (LESSONS 3): a real note, and the other disposition, which takes one at
    // the admin's discretion.
    expect(closeRefusal(wontFix, "the source is retired; the pattern stands")).toBeNull();
    expect(closeRefusal(fixed, "")).toBeNull();
  });

  it("accepts a note that has anything visible in it, however it is padded", () => {
    // The fixture the guard must NOT flag, or the one above is vacuous
    // (LESSONS 3): the characters are refused for being all there is, not for
    // being there. And an invisible note on the OTHER disposition is still no
    // refusal — `fixed` takes a note at the admin's discretion.
    for (const written of ["\u200bthe source is retired; the pattern stands\u200b", "\u2800", "0"]) {
      expect(closeRefusal(wontFix, written), JSON.stringify(written)).toBeNull();
    }
    for (const invisible of INVISIBLE_ONLY) {
      expect(closeRefusal(fixed, invisible), JSON.stringify(invisible)).toBeNull();
    }
  });

  it("puts no invisible-only note on the wire, in any spelling", async () => {
    for (const invisible of INVISIBLE_ONLY) {
      const { calls, fetchImpl } = recordingFetch(
        Response.json({ ok: true, verdict: verdictLogEntry({ action: "wont_fix" }) }),
      );
      const outcome = await submitSettlement({
        reviewItemId: SIGNAL_ID,
        spec: wontFix,
        note: invisible,
        fetchImpl,
      });
      expect(calls, JSON.stringify(invisible)).toEqual([]);
      expect(outcome, JSON.stringify(invisible)).toEqual({
        ok: false,
        message: refusalWords("note_required"),
      });
    }
  });

  /**
   * The second half of the same fact, on the disposition that takes a note at
   * the admin's discretion: an invisible-only note is not refused there, but
   * it is not CONTENT either — it reaches `verdicts.note` as the null it reads
   * as, so the log dashes it rather than drawing an empty cell.
   */
  it("sends an invisible-only optional note as null, and a written one whole", async () => {
    for (const invisible of INVISIBLE_ONLY) {
      expect(settleBody(fixed, invisible).note, JSON.stringify(invisible)).toBeNull();
    }
    expect(settleBody(fixed, "  addressed in the source's own surface  ").note).toBe(
      "addressed in the source's own surface",
    );
    expect(settleBody(fixed, "\u200bhalf visible\u200b").note).toBe("\u200bhalf visible\u200b");
  });
});

/* ── one control, one decision, one call ─────────────────────────────────── */

describe("settling the signal", () => {
  const [fixed, wontFix] = signalActions();

  const cases: ReadonlyArray<readonly [ActionSpec, string, string | null]> = [
    // `fixed` needs no note: the fix was made on the surface that owns it.
    [fixed, "", null],
    [wontFix, "  the condition stands: the source is retired  ", "the condition stands: the source is retired"],
  ];

  it("posts one request to the one route, carrying one action and no payload", async () => {
    for (const [spec, note, expected] of cases) {
      const calls: { url: string; init: { method: string; body: string } }[] = [];
      const outcome = await submitSettlement({
        reviewItemId: SIGNAL_ID,
        spec,
        note,
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return Response.json({ ok: true, verdict: verdictLogEntry({ action: spec.action }) });
        },
      });

      expect(outcome, spec.action).toEqual({ ok: true, action: spec.action });
      expect(calls, spec.action).toHaveLength(1);
      expect(calls[0].url, spec.action).toBe(settlePath(SIGNAL_ID));
      expect(calls[0].init.method, spec.action).toBe("POST");
      // A blank note is null, never `""`; the value is null on both.
      expect(JSON.parse(calls[0].init.body), spec.action).toEqual({
        action: spec.action,
        note: expected,
        value: null,
      });
    }
  });

  it("makes exactly one call to the one function, with one typed decision", async () => {
    for (const [spec, note, expected] of cases) {
      const stub = scriptDatabase(functionInstalled(spec.action));
      const { status, payload } = await post(settleBody(spec, note));

      expect(status, spec.action).toBe(200);
      expect(payload.ok, spec.action).toBe(true);
      // One call, and it is the function — no table is touched on this path.
      expect(stub.calls, spec.action).toHaveLength(1);
      expect(stub.functionsCalled(), spec.action).toEqual([FN.settleReviewItem]);
      expect(stub.tablesRead(), spec.action).toEqual([]);

      const decision = decisionSent(stub);
      expect(decision, spec.action).toEqual({
        action: spec.action,
        // Stamped by the server from the URL and the session, never sent.
        review_item_id: SIGNAL_ID,
        actor: ACTOR,
        note: expected,
        value: null,
      });
      // Well-formed by the envelope's own rules, not only by this test's.
      expect(
        decisionRefusals(decision as unknown as VerdictDecision),
        spec.action,
      ).toEqual([]);
    }
  });
});
