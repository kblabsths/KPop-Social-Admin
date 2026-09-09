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
import { ChosenControl, SettledNotice } from "@/components/review/close/form";
import {
  VERDICT_ACTIONS,
  decisionRefusals,
  isReferenceField,
  noteRequired,
  type VerdictDecision,
} from "@/lib/verdict/decision";
import { SHAPES, shapeOf, type ReviewItemRow } from "@/lib/review/shapes";
import { h, render, uppercasedIdentifiers } from "../ui/markup";
import {
  ID,
  VENUE_ID,
  reviewItemDataConflict,
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
 * **The absence is graded FIRST**, because it is the normal case: `verdicts`
 * and `settle_review_item` are not on staging and will not be until Ben
 * installs M2's handoffs, so the first `describe` below is the state `main`
 * deploys against — both actions exist, and the slot offers neither.
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

/* ── the absent state: the normal one, graded first ──────────────────────── */

describe("the entity_link fact item's close while the verdict log is absent", () => {
  it("offers neither control, and names the object that is missing", () => {
    // Both actions exist and the slot still offers nothing: the reason is the
    // missing object, never an empty list (spec §10 — no control may call a
    // function this database does not have, and nothing queues one).
    expect(actionsFor()).toHaveLength(2);

    const markup = closeMarkup({ kind: "not_provisioned", missing: T.verdicts });
    const $ = cheerio.load(markup);

    expect($('[data-state="not_provisioned"]')).toHaveLength(1);
    expect($(`[data-not-provisioned="${T.verdicts}"]`)).toHaveLength(1);
    expect($(`[data-not-provisioned="${T.verdicts}"]`).text()).toContain(T.verdicts);
    // Said as an absence, in gray — never as the red failure line.
    expect($('[role="alert"]')).toHaveLength(0);
    // No control of any kind: not a disabled button, not a search box, not a
    // picker panel standing open with nothing behind it.
    for (const control of ["button", "form", "input", "select", "textarea"]) {
      expect($(control), control).toHaveLength(0);
    }
    expect(offered(markup)).toEqual([]);
  });

  it("offers neither when the readiness read itself was refused", () => {
    const markup = closeMarkup({
      kind: "error",
      reading: T.verdicts,
      message: "canceling statement due to statement timeout",
    });
    const $ = cheerio.load(markup);
    expect($('[data-state="error"]')).toHaveLength(1);
    expect(offered(markup)).toEqual([]);
    for (const control of ["button", "form", "input", "select", "textarea"]) {
      expect($(control), control).toHaveLength(0);
    }
  });
});

/* ── the two actions ─────────────────────────────────────────────────────── */

describe("the entity_link fact item's two actions", () => {
  it("are exactly two of the eight action names, in spec §7's order", () => {
    const actions = actionsFor();
    expect(actions.map((spec) => spec.action)).toEqual(["link_entity", "settle"]);
    for (const spec of actions) {
      expect(VERDICT_ACTIONS, spec.action).toContain(spec.action);
    }
  });

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

  it("gives the link control the rows the read returned, and only those", () => {
    const { link, settle } = controls();
    // The window travels ON the spec, because the picker offers only rows that
    // exist and a control cannot go looking for its own.
    expect(link.chooses?.options).toEqual(venueWindow().options);
    expect(link.chooses?.domain).toBe("venues");
    // It CHOOSES a record; it does not take typed text. The two discriminators
    // are mutually exclusive by construction, and `supply_value`'s is the one
    // this control must not carry.
    expect(link.supplies).toBeUndefined();
    // And settle takes neither: it is an ordinary button.
    expect(settle.chooses).toBeUndefined();
    expect(settle.supplies).toBeUndefined();
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
  it("gives the source-pattern row the dispositions and neither of these two", () => {
    // `source_id` SET is the signal. `shapes.ts` is the one place that
    // distinction is made (§11) and this reads it rather than re-deriving one.
    const signal = reviewItemSourcePattern();
    expect(signal.source_id).not.toBeNull();
    expect(shapeOf(signal)).toBe("entity_link_source_pattern");

    const actions = ACTIONS_BY_SHAPE[shapeOf(signal)]({
      item: signal,
      evidence: [],
      choices: choices(),
    });
    expect(actions.map((spec) => spec.action)).toEqual(["fixed", "wont_fix"]);
    for (const spec of actions) {
      expect(["link_entity", "settle"], spec.action).not.toContain(spec.action);
    }
    // Even handed a window of rows, a signal is offered nothing to link: a
    // mis-shaped item cannot silently take the other shape's action set.
    expect(actions.every((spec) => spec.chooses === undefined)).toBe(true);
  });

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

  it("offers link_entity on no other shape", () => {
    const items: Record<string, ReviewItemRow> = {
      data_conflict_fact: reviewItemDataConflict(),
      entity_link_source_pattern: reviewItemSourcePattern(),
    };
    for (const shape of SHAPES) {
      if (shape === "entity_link_fact") continue;
      const actions = ACTIONS_BY_SHAPE[shape]({
        item: items[shape],
        evidence: [],
        choices: choices(),
      });
      for (const spec of actions) {
        expect(["link_entity", "settle"], `${shape}: ${spec.action}`).not.toContain(
          spec.action,
        );
      }
    }
  });

  it("turns on source_id alone, not on which columns the row filled in", () => {
    // The trap `shapes.ts` calls out: an `entity_link` fact item usually has a
    // null `entity_id`, so a shape read off the fact columns would misfile
    // exactly the commonest item. It is still the FACT shape, and it still
    // gets these two actions — one of which is withheld, for its own reason.
    const withoutRow = reviewItemEntityLink();
    expect(withoutRow.entity_id).toBeNull();
    expect(shapeOf(withoutRow)).toBe("entity_link_fact");
    expect(
      ACTIONS_BY_SHAPE[shapeOf(withoutRow)]({
        item: withoutRow,
        evidence: [],
      }).map((spec) => spec.action),
    ).toEqual(["settle"]);
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

  it("puts the operator's words on each control and the machine's name on the hook", () => {
    const $ = cheerio.load(markup);
    for (const spec of actionsFor()) {
      const control = $(`[data-close-action="${spec.action}"]`);
      expect(control, spec.action).toHaveLength(1);
      const said = control.text().replace(/\s+/g, " ").trim();
      expect(said, spec.action).toBe(spec.label);
      expect(spec.label, spec.action).not.toBe(spec.action);
      if (spec.action.includes("_")) {
        expect(said, spec.action).not.toContain(spec.action);
      }
    }
  });

  it("prettifies neither name: no title case, and no uppercasing step", () => {
    expect(uppercasedIdentifiers(markup)).toEqual([]);
    for (const prettified of ["LINK_ENTITY", "Link_entity", "Link Entity"]) {
      expect(markup, prettified).not.toContain(prettified);
    }
    // …and the names are there, verbatim, so the above is not vacuous.
    for (const action of ["link_entity", "settle"]) {
      expect(markup, action).toContain(`data-close-action="${action}"`);
    }
  });

  it("says each name verbatim in mono where the operator reads it", () => {
    // The state that replaces the controls once the write lands, which is what
    // keeps the word the same between control, confirmation and verdict log
    // (copy bar 2). The control itself carries the name on its hook.
    for (const spec of actionsFor()) {
      const $ = cheerio.load(
        render(h(SettledNotice, { action: spec.action, label: spec.label })),
      );
      const identifier = $(".type-data");
      expect(identifier, spec.action).toHaveLength(1);
      expect(identifier.text(), spec.action).toBe(spec.action);
    }
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

  it("cannot settle with a row the read did not return", () => {
    // The guard `optionFor` makes true of the SUBMISSION and not only of the
    // list: an id produced any other way — a stale click, a console call —
    // reaches the same check. Proved on the input it must flag and the one it
    // must not (LESSONS 3).
    const chosen: string[] = [];
    const control = h(ChosenControl, {
      spec: link,
      open: true,
      query: "",
      disabled: false,
      onToggle: () => {},
      onQuery: () => {},
      onChoose: (id: string) => chosen.push(id),
    });
    // The rendering itself submits nothing; the guard's own two fixtures are
    // asserted through the payload builder below, which is the one place a
    // chosen id becomes a decision.
    expect(render(control)).toContain(VENUE_ID.olympicHall);
    expect(chosen).toEqual([]);
  });

  it("marks nothing as the current row: this item is here because nothing linked", () => {
    const $ = cheerio.load(opened());
    expect($("[aria-current]")).toHaveLength(0);
  });

  /**
   * QA, campaign admin-window/TASK-0056 — the close's re-use of the SHARED
   * picker has to carry the shared picker's own in-flight rule with it
   * (admin-window/BUG-0097, pinned for the record surface by
   * `tests/offline/records/entity-picker.test.ts`: "offers no option that would
   * start a second write while one is saving").
   *
   * `ChosenControl`'s `disabled` prop IS that state — its own words: "a
   * settlement is in flight, so this control may not start a second one" — and
   * `CloseForm` passes `disabled={settling}` while leaving `open` untouched, so
   * a panel the operator opened stays open, and live, for the whole of another
   * control's settlement. A row clicked there reaches `settle`'s in-flight
   * guard, which returns without setting any state, so the choice is dropped
   * with nothing said.
   *
   * Landed as a STRICT pin (`it.fails`) on admin-window/BUG-0102, observed red
   * as a plain `it` against the landed tree at 6a93776; the fix flipped it
   * back to a plain `it`, having first watched the strict pin redden as an
   * XPASS against the fixed tree. It now holds the rule for this surface the
   * way `tests/offline/records/entity-picker.test.ts` holds it for the record
   * surface: `ChosenControl` hands the shared panel the real status
   * (`saving` while it is disabled), so the rows go busy and stay drawn.
   */
  it(
    "offers no live option while a settlement is in flight (admin-window/BUG-0102)",
    () => {
      const $ = cheerio.load(
        render(
          h(ChosenControl, {
            spec: link,
            open: true,
            query: "",
            // Exactly what `CloseForm` hands this control while it settles.
            disabled: true,
            onToggle: () => {},
            onQuery: () => {},
            onChoose: () => {},
          }),
        ),
      );
      const options = $("li button");
      // Not vacuous: the rows stay DRAWN while a write is in flight (BUG-0097's
      // rule is that they cannot act, not that they vanish).
      expect(options.length).toBeGreaterThan(0);
      const live = options
        .toArray()
        .filter((element) => $(element).attr("disabled") === undefined);
      expect(live.map((element) => $(element).text().trim())).toEqual([]);
      // …and the counter-case, or the assertion above would pass on a picker
      // that is dead at rest too: with nothing in flight every row can act.
      const resting = cheerio.load(opened());
      expect(resting("li button[disabled]")).toHaveLength(0);
      expect(resting("li button").length).toBe(options.length);
    },
  );

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

  it("is refused by the envelope when the ref is missing or in the wrong slot", async () => {
    // The other half of the same fact — the inputs the rules MUST flag, so the
    // empty refusals above are a claim about these decisions and not about a
    // grader that passes everything (LESSONS 3).
    const base = {
      action: "link_entity",
      review_item_id: ITEM_ID,
      actor: ACTOR,
      note: null,
    };
    expect(
      decisionRefusals({
        ...base,
        value: { ...link.value, ref: null },
      } as VerdictDecision),
    ).toContain("value_payload_missing");
    // A reference settled with TYPED TEXT — the write spec §8 exists to
    // prevent — is refused twice over: the slot is not this action's, and the
    // fact is a reference.
    const typed = decisionRefusals({
      ...base,
      value: { ...link.value, value: "The Forum" },
    } as VerdictDecision);
    expect(typed).toContain("value_payload_not_allowed");
    expect(typed).toContain("reference_field_not_scalar");
    // And settle carries no payload at all: one handed one is refused.
    expect(
      decisionRefusals({
        ...base,
        action: "settle",
        value: { ...link.value, ref: VENUE_ID.skyDome },
      } as VerdictDecision),
    ).toContain("value_forbidden");
  });

  it("keeps the pressed action's own name through to what the operator is told", async () => {
    for (const [spec, chosen] of [
      [link, VENUE_ID.nameless],
      [settle, null],
    ] as const) {
      const outcome = await submitSettlement({
        reviewItemId: ITEM_ID,
        spec,
        note: "",
        supplied: chosen,
        fetchImpl: async () =>
          Response.json({ ok: true, verdict: verdictLogEntry({ action: spec.action }) }),
      });
      expect(outcome, spec.action).toEqual({ ok: true, action: spec.action });
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
