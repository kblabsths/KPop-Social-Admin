import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FN, T } from "@/lib/db/tables";
import {
  ACTIONS_BY_SHAPE,
  CloseSlot,
  NOTICE_BY_SHAPE,
} from "@/components/review/close/slot";
import {
  linkActions,
  linkNotice,
  linkableFact,
} from "@/components/review/close/link-actions";
import {
  closeRefusal,
  decisionValue,
  noteIsRequiredBy,
  refusalWords,
  settleBody,
  settlePath,
  submitSettlement,
  type ActionSpec,
  type ShapeChoices,
} from "@/components/review/close/actions";
import { ChosenControl } from "@/components/review/close/form";
import {
  decisionRefusals,
  isReferenceField,
  noteRequired,
  type VerdictDecision,
} from "@/lib/verdict/decision";
import { shapeOf, type ReviewItemRow } from "@/lib/review/shapes";
import { h, render } from "../ui/markup";
import {
  ID,
  VENUE_ID,
  reviewItemEntityLink,
  reviewItemSourcePattern,
  venueWindow,
  verdictLogEntry,
} from "../../fixtures/rows";
import { stubClient, type Script, type StubClient } from "../../fixtures/stub-client";

/**
 * The `entity_link` FACT item's two actions — campaign admin-window/TASK-0056,
 * spec §7, SPEC F10.
 *
 * **Fixtures, not staging.** No `entity_link` FACT item exists on staging: the
 * one review item there is the source-pattern SIGNAL, which takes dispositions
 * instead. This shape is therefore graded offline, and "built, not walkable on
 * this data" is the honest grade — exactly as M1 graded the same gap.
 *
 * What this file does NOT re-test: the frame. The slot's readiness branches,
 * the note field, the route's gate and its 503 are shape-independent and
 * belong to `tests/offline/review-item/close-slot.test.ts`; the picker panel's
 * own behaviour — the search that filters rather than submits, the nameless
 * row, the window line — belongs to `tests/offline/records/entity-picker.test.ts`.
 * Here they appear only where this shape's own two actions travel through them.
 *
 * Assertions read the DELIVERED markup and the recorded calls, never a copy
 * literal: every operator sentence is compared against the app's own exported
 * words or against the spec under test, so a rewording is a copy change and
 * not a red suite. The machine names ARE pinned — they are the contract
 * (§11, LESSONS 5).
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

/** The signed-in admin the gate answers with, as the log will record them. */
const ACTOR = "qa@example.invalid";

/**
 * The fact item this shape is about, in the state where it CAN be linked: it
 * names `events.venue` — the one reference field the registry declares — of a
 * canonical event row.
 *
 * The fixture's own `entity_id` is null, which is the ordinary state of an
 * `entity_link` item (the column's comment says so, and `shapes.ts` reads
 * `source_id` rather than the fact columns for exactly that reason). Both
 * states are graded here: this one, and the fixture as it ships.
 */
function linkable(overrides: Partial<ReviewItemRow> = {}): ReviewItemRow {
  return reviewItemEntityLink({ entity_id: ID.eventEntity, ...overrides });
}

const ITEM = linkable();
const ITEM_ID = ITEM.review_item_id;

/** The rows the picker read, and the read that produced them. */
function choices(overrides: Partial<ShapeChoices> = {}): ShapeChoices {
  return { window: venueWindow(), note: null, ...overrides };
}

/** This shape's actions, as the shape module answers them. */
function actionsFor(
  item: ReviewItemRow = ITEM,
  given: ShapeChoices | null = choices(),
): readonly ActionSpec[] {
  return linkActions({ item, evidence: [], choices: given });
}

/** The link control and the settle control, on an item that has both. */
function controls(): { link: ActionSpec; settle: ActionSpec } {
  const [link, settle] = actionsFor();
  return { link, settle };
}

/** The close slot as the page renders it for this item, in this readiness. */
function closeMarkup(
  readiness: Parameters<typeof CloseSlot>[0]["readiness"],
  item: ReviewItemRow = ITEM,
  given: ShapeChoices | null = choices(),
): string {
  return render(
    h(CloseSlot, {
      item,
      readiness,
      actions: actionsFor(item, given),
      notice: linkNotice({ item, evidence: [], choices: given }),
    }),
  );
}

/** The actions the slot actually offered, in rendered order. */
function offered(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-close-action]")
    .toArray()
    .map((element) => $(element).attr("data-close-action") ?? "");
}

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
      data: verdictLogEntry({ action, review_item_id: ITEM_ID }),
    },
  };
}

/** POST one control's body to the one route, at this item's address. */
async function post(
  body: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await POST(
    new Request(`http://127.0.0.1/api/admin/review-items/${ITEM_ID}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ reviewItemId: ITEM_ID }) },
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

beforeEach(() => {
  gate.answer = { user: { email: ACTOR } };
  readWith.client = undefined;
});

/* ── the two actions ─────────────────────────────────────────────────────── */

describe("the entity_link fact item's two actions", () => {
  it("carries the fact in the link's payload and nothing at all in settle's", () => {
    const { link, settle } = controls();

    // Everything the SERVER knows: which row, which registry field, which
    // domain. The chosen entity is not here — it does not exist until the
    // operator picks one — and no other payload slot is filled.
    expect(link.value).toEqual({
      domain: "events",
      entity_id: ID.eventEntity,
      field: "venue",
      observation_id: null,
      value: null,
      ref: null,
    });
    // The fact really is a reference, which is what makes `ref` its slot.
    expect(isReferenceField("events", "venue")).toBe(true);

    // Settle carries nothing: the item closes and canonical is untouched.
    expect(settle.value).toBeNull();

    for (const spec of [link, settle]) {
      // Neither writes over canonical, so neither is drawn destructive.
      expect(spec.variant ?? "secondary", spec.action).toBe("secondary");
      // The operator's words are the operator's, not the machine's name
      // reworded (LESSONS 5).
      expect(spec.label.trim().length, spec.action).toBeGreaterThan(0);
      expect(spec.label, spec.action).not.toBe(spec.action);
    }
  });

  it("needs a note on neither, so the field beside them says so", () => {
    expect(noteRequired("link_entity")).toBe(false);
    expect(noteRequired("settle")).toBe(false);
    expect(noteIsRequiredBy(actionsFor())).toBe(false);
    // Never vacuous: the same helper DOES say so for the shape that requires
    // one (LESSONS 3).
    expect(
      noteIsRequiredBy(
        ACTIONS_BY_SHAPE.entity_link_source_pattern({
          item: reviewItemSourcePattern(),
          evidence: [],
        }),
      ),
    ).toBe(true);
  });

  it("does not vary with the evidence the item folded", () => {
    // Neither action is a function of the evidence: this item's question is
    // which row to point at, not which claim to believe.
    const withFolds = linkActions({
      item: linkable({ folded_count: 9, severity: "high" }),
      evidence: [],
      choices: choices(),
    });
    expect(withFolds.map((spec) => spec.action)).toEqual(["link_entity", "settle"]);
    expect(withFolds[0].value).toEqual(controls().link.value);
  });
});

/* ── the shape distinction, read from shapes.ts ──────────────────────────── */

describe("the shape distinction between the fact item and the signal", () => {
  it("gives the fact row these two and neither disposition", () => {
    // `source_id` NULL, same queue, is the fact item.
    expect(ITEM.source_id).toBeNull();
    expect(ITEM.queue).toBe("entity_link");
    expect(shapeOf(ITEM)).toBe("entity_link_fact");

    const actions = ACTIONS_BY_SHAPE[shapeOf(ITEM)]({
      item: ITEM,
      evidence: [],
      choices: choices(),
    });
    expect(actions.map((spec) => spec.action)).toEqual(["link_entity", "settle"]);
    for (const spec of actions) {
      expect(["fixed", "wont_fix"], spec.action).not.toContain(spec.action);
    }
  });
});

/* ── the close, with the verdict log installed ───────────────────────────── */

describe("the close once the verdict log is installed", () => {
  const markup = closeMarkup({ kind: "ok" });

  it("contains exactly the two controls and no other", () => {
    const $ = cheerio.load(markup);
    expect(offered(markup)).toEqual(["link_entity", "settle"]);
    // Two buttons at rest: the picker's own toggle, and settle. The panel is
    // closed until the operator opens it, so no option is on screen yet.
    expect($("button")).toHaveLength(2);
    // The note field beside them, and nothing else that takes an input: no
    // third action, no free-text box for the reference, no second form.
    expect($("textarea")).toHaveLength(1);
    for (const control of ["form", "input", "select"]) {
      expect($(control), control).toHaveLength(0);
    }
    // A read that answered is neither an emptiness nor an absence.
    expect($("[data-state]")).toHaveLength(0);
    // Nothing is withheld on this item, so no line says anything is.
    expect($("[data-close-notice]")).toHaveLength(0);
  });
});

/* ── the picker inside the close, and what it will not offer ─────────────── */

describe("the link control's picker", () => {
  const { link } = controls();

  /** The control with its panel open — the state a click produces. */
  function opened(query = ""): string {
    return render(
      h(ChosenControl, {
        spec: link,
        open: true,
        query,
        disabled: false,
        onToggle: () => {},
        onQuery: () => {},
        onChoose: () => {},
      }),
    );
  }

  it("offers exactly the rows the read returned, each carrying its own id", () => {
    const $ = cheerio.load(opened());
    // Every row, INCLUDING the one with no name: it exists and can be linked.
    const offeredIds = $("li button")
      .toArray()
      .map((element) => $(element).text());
    expect(offeredIds).toHaveLength(venueWindow().options.length);
    for (const option of venueWindow().options) {
      expect(offeredIds.some((text) => text.includes(option.id)), option.id).toBe(true);
    }
  });

  it("offers no way to create an entity, in either of its states", () => {
    // The claim is structural, not a word search: every control the close
    // draws is either one of the two actions or one of the window's own rows.
    // A "create" affordance would be a control that is neither, so there is
    // nowhere for one to hide.
    const windowIds = venueWindow().options.map((option) => option.id);
    for (const [state, html] of [
      ["closed", closeMarkup({ kind: "ok" })],
      ["open", opened()],
    ] as const) {
      const $ = cheerio.load(html);
      const strays = $("button")
        .toArray()
        .filter((element) => {
          const node = $(element);
          const labelled = node.closest("[data-close-action]").length > 0;
          const listed = windowIds.some((id) => node.text().includes(id));
          return !labelled && !listed;
        });
      expect(strays.map((element) => $(element).text()), state).toEqual([]);
      // The only text input anywhere near this control is the panel's search
      // box, and it exists only while the panel is open. It FILTERS the rows
      // already read and is never itself a value, which is why an operator
      // cannot type an entity into being here.
      const search = $('input[type="search"]');
      expect(search, state).toHaveLength(state === "open" ? 1 : 0);
      expect($("input").length, state).toBe(search.length);
    }
  });

  it("marks nothing as the current row: this item is here because nothing linked", () => {
    const $ = cheerio.load(opened());
    expect($("[aria-current]")).toHaveLength(0);
  });

  /**
   * QA, campaign admin-window/BUG-0102 — the pin above grades the panel's ROWS
   * (`li button`), which is where the dropped click was. It does not grade the
   * control's own entry point, and after BUG-0102's fix that entry point is
   * what the operator actually meets during a settlement: `CloseForm` clears
   * `choosing` as the settlement goes in flight, so the panel is gone and the
   * toggle is the only control of this action left on screen. A toggle that
   * stayed live there would let the operator re-open the picker mid-settlement
   * and land straight back in the state BUG-0102 was filed about.
   *
   * So the rule is graded of the WHOLE control, in both of the states
   * `CloseForm` can hand it while `settling` is true — panel open (the
   * component's contract for any caller) and panel closed (what this form now
   * renders) — with the same two states at rest as the counter-case, or a
   * control that is dead in every state would pass. Interactivity only: which
   * buttons can act, never a word or a class.
   */
  it("goes inert as a whole while a settlement is in flight, and is live again when none is", () => {
    function buttons(open: boolean, disabled: boolean) {
      const $ = cheerio.load(
        render(
          h(ChosenControl, {
            spec: link,
            open,
            query: "",
            disabled,
            onToggle: () => {},
            onQuery: () => {},
            onChoose: () => {},
          }),
        ),
      );
      const all = $("button").toArray();
      return {
        total: all.length,
        live: all.filter((element) => $(element).attr("disabled") === undefined).length,
      };
    }

    for (const open of [true, false]) {
      const settling = buttons(open, true);
      const resting = buttons(open, false);
      // Drawn either way — the same controls exist in both states, so the
      // assertion below is about acting and not about vanishing.
      expect(settling.total, `open=${open}`).toBeGreaterThan(0);
      expect(settling.total, `open=${open}`).toBe(resting.total);
      // In flight: nothing in this control can act, the toggle included.
      expect(settling.live, `open=${open}`).toBe(0);
      // …and the counter-case, or "nothing can act" would pass on a control
      // that can never act: at rest every one of them can.
      expect(resting.live, `open=${open}`).toBe(resting.total);
    }
    // The open state is the one that carries the rows, so the two states are
    // not the same assertion twice.
    expect(buttons(true, false).total).toBeGreaterThan(buttons(false, false).total);
  });
});

/* ── one control, one decision, one call ─────────────────────────────────── */

describe("settling the entity_link fact item", () => {
  const { link, settle } = controls();

  it("builds the link's payload with the chosen row in ref, and nothing in value", () => {
    const built = decisionValue(link, VENUE_ID.skyDome);
    expect(built).toEqual({
      domain: "events",
      entity_id: ID.eventEntity,
      field: "venue",
      observation_id: null,
      value: null,
      ref: VENUE_ID.skyDome,
    });
    // Settle's payload is null however it is called: it fills no slot at all.
    expect(decisionValue(settle, VENUE_ID.skyDome)).toBeNull();
  });

  it("refuses a link with nothing chosen, and does not refuse one with a row", () => {
    // The input it MUST flag…
    for (const nothing of [null, "", "   ", "​"]) {
      expect(closeRefusal(link, "", nothing), JSON.stringify(nothing)).toBe(
        "ref_required",
      );
    }
    // …and the ones it must NOT, or the guard above passes vacuously
    // (LESSONS 3): a real row, and the settle control, which chooses nothing.
    expect(closeRefusal(link, "", VENUE_ID.olympicHall)).toBeNull();
    expect(closeRefusal(settle, "")).toBeNull();
    // The words a person reads, never the branch identifier (LESSONS 5).
    expect(refusalWords("ref_required")).not.toContain("ref_required");
    expect(refusalWords("ref_required").length).toBeGreaterThan(20);
  });

  it("posts one request to the one route, carrying one action and one payload", async () => {
    const cases: ReadonlyArray<
      readonly [ActionSpec, string | null, Record<string, unknown> | null]
    > = [
      [
        link,
        VENUE_ID.olympicHall,
        {
          domain: "events",
          entity_id: ID.eventEntity,
          field: "venue",
          observation_id: null,
          value: null,
          ref: VENUE_ID.olympicHall,
        },
      ],
      [settle, null, null],
    ];

    for (const [spec, chosen, expected] of cases) {
      const { calls, fetchImpl } = recordingFetch(
        Response.json({ ok: true, verdict: verdictLogEntry({ action: spec.action }) }),
      );
      const outcome = await submitSettlement({
        reviewItemId: ITEM_ID,
        spec,
        note: "",
        supplied: chosen,
        fetchImpl,
      });

      expect(outcome, spec.action).toEqual({ ok: true, action: spec.action });
      // EXACTLY one call, to the one route, for either control.
      expect(calls, spec.action).toHaveLength(1);
      expect(calls[0].url, spec.action).toBe(settlePath(ITEM_ID));
      expect(calls[0].init.method, spec.action).toBe("POST");
      expect(JSON.parse(calls[0].init.body), spec.action).toEqual({
        action: spec.action,
        // A blank note travels as null, never as `""`.
        note: null,
        value: expected,
      });
    }
  });

  it("makes exactly one call to the one function, with one typed decision", async () => {
    const cases: ReadonlyArray<readonly [ActionSpec, string | null]> = [
      [link, VENUE_ID.skyDome],
      [settle, null],
    ];

    for (const [spec, chosen] of cases) {
      const stub = scriptDatabase(functionInstalled(spec.action));
      const { status, payload } = await post(settleBody(spec, "", chosen));

      expect(status, spec.action).toBe(200);
      expect(payload.ok, spec.action).toBe(true);
      // One call, and it is the function — no table is touched on this path.
      expect(stub.calls, spec.action).toHaveLength(1);
      expect(stub.functionsCalled(), spec.action).toEqual([FN.settleReviewItem]);
      expect(stub.tablesRead(), spec.action).toEqual([]);

      const decision = decisionSent(stub);
      expect(decision.action, spec.action).toBe(spec.action);
      // Stamped by the server from the URL and the session, never sent.
      expect(decision.review_item_id, spec.action).toBe(ITEM_ID);
      expect(decision.actor, spec.action).toBe(ACTOR);
      expect(decision.note, spec.action).toBeNull();
      expect(decision.value, spec.action).toEqual(decisionValue(spec, chosen));
      // Well-formed by the envelope's own rules, not only by this test's.
      expect(
        decisionRefusals(decision as unknown as VerdictDecision),
        spec.action,
      ).toEqual([]);
    }
  });
});

/* ── the picker withheld, and why ────────────────────────────────────────── */

describe("an entity_link fact item with nothing to link", () => {
  it("offers settle alone where the item names no canonical row yet", () => {
    // The commonest item on this queue: opened before the row exists.
    const item = reviewItemEntityLink();
    expect(linkableFact(item)).toBeNull();
    expect(actionsFor(item, null).map((spec) => spec.action)).toEqual(["settle"]);

    const markup = closeMarkup({ kind: "ok" }, item, null);
    const $ = cheerio.load(markup);
    expect(offered(markup)).toEqual(["settle"]);
    expect($("button")).toHaveLength(1);
    // The absence is RENDERED with its reason, never a shorter list with no
    // explanation (LESSONS 1, the rule admin-window/BUG-0087 set).
    const notice = $("[data-close-notice]");
    expect(notice).toHaveLength(1);
    expect(notice.attr("data-close-notice")).toBe("events.venue");
    expect(notice.text()).toContain("events.venue");
    expect(notice.text().trim().length).toBeGreaterThan(60);
  });

  it("offers settle alone where the fact is not a reference at all", () => {
    // A `ref` on a scalar fact has no slot to travel in and the function
    // refuses it, so no control is offered for one.
    const item = linkable({ field: "title" });
    expect(isReferenceField("events", "title")).toBe(false);
    expect(linkableFact(item)).toBeNull();
    expect(actionsFor(item, null).map((spec) => spec.action)).toEqual(["settle"]);
  });

  it("names the object when the rows themselves could not be read", () => {
    // A refused read costs the PICKER and nothing else: settle still stands,
    // and the refusal is the app's own card rather than a silent absence.
    const refused = {
      window: null,
      note: { kind: "error" as const, reading: T.venues, message: "statement timeout" },
    };
    const markup = closeMarkup({ kind: "ok" }, ITEM, refused);
    const $ = cheerio.load(markup);

    expect(offered(markup)).toEqual(["settle"]);
    expect($(`[data-read-failed="${T.venues}"]`)).toHaveLength(1);
    expect($(`[data-read-failed="${T.venues}"]`).text()).toContain(T.venues);
    // And the settle control is untouched by any of it.
    expect($("[data-close-note]")).toHaveLength(1);
  });

  it("still offers the picker over an EMPTY window, which says so itself", () => {
    // A window that answered and holds nothing is not the same state as no
    // read at all: the control renders, and the panel's own labelled
    // emptiness says the picker creates none (LOOK_AND_FEEL, the three
    // emptinesses never share a rendering).
    const empty = choices({ window: venueWindow({ options: [], held: 0 }) });
    expect(actionsFor(ITEM, empty).map((spec) => spec.action)).toEqual([
      "link_entity",
      "settle",
    ]);
    expect(
      linkNotice({ item: ITEM, evidence: [], choices: empty }),
    ).toBeNull();
  });

  it("is the map's own answer, not this test's", () => {
    // Derived, never re-derived: the page asks `shapeOf` and the maps answer.
    const item = reviewItemEntityLink();
    expect(
      ACTIONS_BY_SHAPE[shapeOf(item)]({ item, evidence: [] }).map((spec) => spec.action),
    ).toEqual(["settle"]);
    expect(NOTICE_BY_SHAPE[shapeOf(item)]({ item, evidence: [] })).not.toBeNull();
  });
});
