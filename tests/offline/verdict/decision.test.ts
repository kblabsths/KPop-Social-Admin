import { describe, expect, it } from "vitest";
import {
  REFERENCE_FIELDS,
  VERDICT_ACTIONS,
  decisionRefusals,
  isReferenceField,
  noteRequired,
  type VerdictAction,
  type VerdictDecision,
  type VerdictValue,
} from "@/lib/verdict/decision";

/**
 * The verdict decision envelope — campaign admin-window/TASK-0042, the leaf
 * every other M2 surface builds and the §9 handoff artifact's SQL reads.
 *
 * The bar this file holds: one WELL-FORMED decision per action refuses
 * nothing, and each of the six invariants of `decisionRefusals` has an input
 * it MUST flag beside one it must NOT (LESSONS 3 — a guard proved on one
 * fixture can be vacuous). The action set is iterated, never hand-listed, so a
 * ninth action cannot arrive unseen.
 */

/** A `VerdictValue` with every payload slot empty; each fixture fills one. */
function valueOf(overrides: Partial<VerdictValue> = {}): VerdictValue {
  return {
    domain: "events",
    entity_id: "11111111-1111-4111-8111-111111111111",
    field: "title",
    observation_id: null,
    value: null,
    ref: null,
    ...overrides,
  };
}

function decisionOf(overrides: Partial<VerdictDecision> = {}): VerdictDecision {
  return {
    action: "keep_current",
    review_item_id: "22222222-2222-4222-8222-222222222222",
    actor: "admin@example.test",
    note: null,
    value: null,
    ...overrides,
  };
}

/**
 * One WELL-FORMED decision per action — the eight fixtures of acceptance
 * criterion 3, keyed by action so the iteration below cannot silently skip one.
 */
const WELL_FORMED: Readonly<Record<VerdictAction, VerdictDecision>> = {
  choose_claimed_value: decisionOf({
    action: "choose_claimed_value",
    value: valueOf({ observation_id: "33333333-3333-4333-8333-333333333333" }),
  }),
  supply_value: decisionOf({
    action: "supply_value",
    value: valueOf({ value: "BLACKPINK at the Forum" }),
  }),
  keep_current: decisionOf({ action: "keep_current" }),
  link_entity: decisionOf({
    action: "link_entity",
    value: valueOf({
      domain: "venues",
      field: "venue",
      ref: "44444444-4444-4444-8444-444444444444",
    }),
  }),
  settle: decisionOf({ action: "settle" }),
  fixed: decisionOf({ action: "fixed" }),
  wont_fix: decisionOf({
    action: "wont_fix",
    note: "the source has been paused; the condition stands until it returns",
  }),
  override: decisionOf({
    action: "override",
    review_item_id: null,
    value: valueOf({ value: "Seoul Olympic Stadium" }),
  }),
};

/**
 * The four actions that carry a `VerdictValue`; the other four are settle-only.
 * Module-scope because two blocks read it — invariant 4 and the absent-key
 * bodies below — and a ninth action must not be judged by two hand-lists.
 */
const VALUE_CARRYING: readonly VerdictAction[] = [
  "choose_claimed_value",
  "supply_value",
  "override",
  "link_entity",
];

const SETTLE_ONLY: readonly VerdictAction[] = VERDICT_ACTIONS.filter(
  (action) => !VALUE_CARRYING.includes(action),
);

/** The one fixture that is not keyed by action: an override of a REFERENCE. */
const REFERENCE_OVERRIDE: VerdictDecision = decisionOf({
  action: "override",
  review_item_id: null,
  value: valueOf({
    field: "venue",
    ref: "55555555-5555-4555-8555-555555555555",
  }),
});

describe("the action set", () => {
  it("carries the eight names, in the order §9.2 states them", () => {
    expect(VERDICT_ACTIONS).toEqual([
      "choose_claimed_value",
      "supply_value",
      "keep_current",
      "link_entity",
      "settle",
      "fixed",
      "wont_fix",
      "override",
    ]);
  });

  it("has a well-formed fixture for every action it carries", () => {
    // The ratchet under every iteration below: a ninth action lands here
    // first, as a missing fixture, rather than passing untested.
    expect(Object.keys(WELL_FORMED).sort()).toEqual([...VERDICT_ACTIONS].sort());
  });
});

describe("isReferenceField", () => {
  /**
   * The predicate every surface asks before it offers a control for a fact
   * (campaign admin-window/BUG-0087). Proved on both sides, as a guard must
   * be (LESSONS 3): a field it MUST call a reference, and fields it must NOT.
   */
  it("calls every field the registry declares a reference one", () => {
    // Iterated off the constant, so a field added there is proved by the same
    // line rather than by remembering to add an assertion.
    expect(REFERENCE_FIELDS.length).toBeGreaterThan(0);
    for (const spelling of REFERENCE_FIELDS) {
      const [domain, field] = spelling.split(".");
      expect(isReferenceField(domain, field), spelling).toBe(true);
    }
  });

  it("calls a scalar fact no such thing", () => {
    // The `events` scalars the conflict surface deals in, and a venues one:
    // a predicate that answered true for these would withhold the supply
    // control from every conflict there is.
    for (const field of ["title", "description", "starts_at", "poster_url"]) {
      expect(isReferenceField("events", field), field).toBe(false);
    }
    for (const field of ["name", "city", "country", "address"]) {
      expect(isReferenceField("venues", field), field).toBe(false);
    }
  });

  it("answers about the WHOLE fact, never the field name alone", () => {
    // `venue` is a reference of `events` and nothing at all of `venues` —
    // the domain is half the question, and a predicate that dropped it would
    // silently withhold the control on another domain's like-named field.
    expect(isReferenceField("events", "venue")).toBe(true);
    expect(isReferenceField("venues", "venue")).toBe(false);
    expect(isReferenceField("groups", "performers")).toBe(false);
    // And it is not a prefix or substring test.
    expect(isReferenceField("events", "venue_id")).toBe(false);
    expect(isReferenceField("events", "ven")).toBe(false);
    expect(isReferenceField("", "")).toBe(false);
  });

  it("names the fields the reference-carrying actions exist for", () => {
    // The constant is registry knowledge mirrored by hand; this pins WHICH
    // fields it claims, so a silent edit to the list is a visible diff here.
    expect([...REFERENCE_FIELDS].sort()).toEqual([
      "events.performers",
      "events.venue",
    ]);
  });
});

describe("noteRequired", () => {
  it("is true for wont_fix and false for every other action", () => {
    // Iterated, never hand-listed (acceptance criterion 4).
    for (const action of VERDICT_ACTIONS) {
      expect(noteRequired(action), action).toBe(action === "wont_fix");
    }
  });

  it("names exactly one action across the whole set", () => {
    expect(VERDICT_ACTIONS.filter(noteRequired)).toEqual(["wont_fix"]);
  });
});

describe("a well-formed decision", () => {
  it("refuses nothing, for every one of the eight actions", () => {
    for (const action of VERDICT_ACTIONS) {
      expect(decisionRefusals(WELL_FORMED[action]), action).toEqual([]);
    }
  });

  it("refuses nothing for an override of a reference field", () => {
    // §9.2: a reference is chosen as a ref, not as a scalar — the second legal
    // payload shape of the one action that has two.
    expect(decisionRefusals(REFERENCE_OVERRIDE)).toEqual([]);
  });

  it("accepts a false and a zero as supplied values", () => {
    // A filled slot is "not null", so the two falsy scalars a form can produce
    // are values, not absences.
    for (const supplied of [false, 0]) {
      const decision = decisionOf({
        action: "supply_value",
        value: valueOf({ field: "is_flagged", value: supplied }),
      });
      expect(decisionRefusals(decision), String(supplied)).toEqual([]);
    }
  });

  it("accepts an optional note on an action that does not require one", () => {
    expect(
      decisionRefusals(decisionOf({ action: "settle", note: "held for the next cycle" })),
    ).toEqual([]);
  });
});

/*
 * Invariant by invariant. Each block carries the input the guard MUST flag and
 * the input it must NOT — the two fixtures of LESSONS 3.
 */

describe("invariant 1 — the action is one of the eight", () => {
  it("flags an action outside the set", () => {
    // The cast is the point: a form posts a string, and the type erases.
    const decision = decisionOf({ action: "approve" as VerdictAction });
    expect(decisionRefusals(decision)).toContain("unknown_action");
  });

  it("does not flag any action inside the set", () => {
    for (const action of VERDICT_ACTIONS) {
      expect(decisionRefusals(WELL_FORMED[action]), action).not.toContain("unknown_action");
    }
  });

  it("still checks the actor, and no action-dependent invariant, on an unknown action", () => {
    // There is no rule to judge 2-5 against once the action is unknown; the
    // actor does not depend on the action, so it is still judged.
    const decision = decisionOf({ action: "approve" as VerdictAction, actor: "  " });
    expect(decisionRefusals(decision)).toEqual(["unknown_action", "actor_required"]);
  });
});

/**
 * Notes with NOTHING VISIBLE in them — admin-window/BUG-0089’s fixture, and
 * the one `String.prototype.trim()` cannot see. Whitespace it did strip
 * (U+00A0, U+FEFF) sits beside the Cf characters it did not (U+200B zero-width
 * space, U+2060 word joiner, U+00AD soft hyphen), because a guard that
 * disagreed with itself about which blanks count is what the bug was.
 */
const INVISIBLE_ONLY: readonly string[] = [
  "\u200b", // zero-width space — a paste out of a rendered web page
  "\u2060", // word joiner
  "\u00ad", // soft hyphen — a paste out of a PDF
  "\ufeff", // byte-order mark — a paste out of a spreadsheet export
  "\u00a0", // non-breaking space
  "\u3164", // hangul filler: ink-less, and in neither C class
  "\u0001", // a C0 control `trim()` leaves alone
  "  \u200b  ", // the mixture an operator actually produces
  "\u200b\u2060\u00ad\ufeff\u00a0\t\n",
];

/**
 * The fixtures the same guard must NOT flag, or it is vacuous: real words,
 * words WRAPPED in the characters above (present is not the same as
 * only), and U+2800 BRAILLE PATTERN BLANK — an assigned printable character,
 * which the leaf’s own docstring rules is content even though it looks empty.
 */
const VISIBLE_NOTES: readonly string[] = [
  "the source has been paused; the condition stands until it returns",
  "\u200bwhy it stands\u200b",
  "\u00ad-\u00ad",
  "0",
  "\u2800",
];

describe("invariant 2 — the item, and the one action without it", () => {
  it("flags a null review_item_id on every non-override action", () => {
    for (const action of VERDICT_ACTIONS.filter((one) => one !== "override")) {
      const decision = decisionOf({ ...WELL_FORMED[action], review_item_id: null });
      expect(decisionRefusals(decision), action).toContain("review_item_required");
    }
  });

  it("flags an all-whitespace review_item_id, which a form alone would let through", () => {
    const decision = decisionOf({ ...WELL_FORMED.fixed, review_item_id: "   " });
    expect(decisionRefusals(decision)).toContain("review_item_required");
  });

  it("flags a review_item_id with nothing visible in it", () => {
    // A uuid FK cannot be satisfied by a string of invisible characters any
    // more than by spaces, and both are the shape a form alone lets through
    // (admin-window/BUG-0089).
    for (const invisible of INVISIBLE_ONLY) {
      const decision = decisionOf({ ...WELL_FORMED.fixed, review_item_id: invisible });
      expect(decisionRefusals(decision), JSON.stringify(invisible)).toContain(
        "review_item_required",
      );
    }
  });

  it("flags an override that carries an item", () => {
    const decision = decisionOf({
      ...WELL_FORMED.override,
      review_item_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(decisionRefusals(decision)).toContain("review_item_forbidden");
  });

  it("does not flag the item as present or absent on the eight well-formed decisions", () => {
    for (const action of VERDICT_ACTIONS) {
      const refusals = decisionRefusals(WELL_FORMED[action]);
      expect(refusals, action).not.toContain("review_item_required");
      expect(refusals, action).not.toContain("review_item_forbidden");
    }
  });
});

describe("invariant 3 — the note wont_fix cannot settle without", () => {
  it("flags a null note on wont_fix", () => {
    const decision = decisionOf({ ...WELL_FORMED.wont_fix, note: null });
    expect(decisionRefusals(decision)).toContain("note_required");
  });

  it("flags a present-but-blank note on wont_fix", () => {
    // The second shape a form alone lets through (acceptance criterion 5): the
    // field was filled in, with nothing.
    for (const blank of ["", "   ", "\n\t "]) {
      const decision = decisionOf({ ...WELL_FORMED.wont_fix, note: blank });
      expect(decisionRefusals(decision), JSON.stringify(blank)).toContain("note_required");
    }
  });

  /**
   * A note whose every character is invisible is a note nobody can read, and
   * `wont_fix` is the one action whose note is the CONTRACT ("say why the
   * condition stands", spec §7). The guard used to decide blankness with
   * `String.prototype.trim()`, which strips the Unicode WhiteSpace set and
   * U+FEFF but not the Cf format characters — so a note pasted as a
   * zero-width space, a word joiner or a soft hyphen was graded as written,
   * settled the item, and landed in `verdicts.note` as content `isAbsent()`
   * (trim() again) then drew as a blank cell with no dash, the very rendering
   * admin-window/BUG-0085 was filed to remove.
   *
   * Fixed in admin-window/BUG-0089: all three guards ask
   * `hasVisibleContent` — one definition of blank, in the leaf both others
   * import.
   */
  it("flags a note whose every character is invisible on wont_fix", () => {
    for (const invisible of INVISIBLE_ONLY) {
      const decision = decisionOf({ ...WELL_FORMED.wont_fix, note: invisible });
      expect(decisionRefusals(decision), JSON.stringify(invisible)).toContain(
        "note_required",
      );
    }
  });

  it("keeps a note that has anything visible in it, however it is padded", () => {
    // The other fixture the guard needs or it passes vacuously (LESSONS 3):
    // the invisible characters are refused for being ALL there is, never for
    // being present. A note wrapped in them still says what it says, and is
    // not this guard’s business to rewrite.
    for (const written of VISIBLE_NOTES) {
      const decision = decisionOf({ ...WELL_FORMED.wont_fix, note: written });
      expect(decisionRefusals(decision), JSON.stringify(written)).toEqual([]);
    }
  });

  it("does not flag an invisible-only note on an action that requires none", () => {
    // The forbidden branch of the same fixture: a note is at the admin’s
    // discretion everywhere but `wont_fix`, so an unreadable one there is not
    // a refusal — the widened test must not turn an optional field into a
    // required one.
    for (const action of VERDICT_ACTIONS.filter((one) => !noteRequired(one))) {
      for (const invisible of INVISIBLE_ONLY) {
        const decision = decisionOf({ ...WELL_FORMED[action], note: invisible });
        expect(decisionRefusals(decision), `${action} ${JSON.stringify(invisible)}`)
          .not.toContain("note_required");
      }
    }
  });

  it("does not flag a missing note on any action that does not require one", () => {
    for (const action of VERDICT_ACTIONS.filter((one) => !noteRequired(one))) {
      const decision = decisionOf({ ...WELL_FORMED[action], note: null });
      expect(decisionRefusals(decision), action).not.toContain("note_required");
    }
  });
});

describe("invariant 4 — which actions carry a value at all", () => {
  it("flags a null value on every value-carrying action", () => {
    for (const action of VALUE_CARRYING) {
      const decision = decisionOf({ ...WELL_FORMED[action], value: null });
      expect(decisionRefusals(decision), action).toContain("value_required");
    }
  });

  it("flags a value on every settle-only action", () => {
    for (const action of SETTLE_ONLY) {
      const decision = decisionOf({
        ...WELL_FORMED[action],
        value: valueOf({ value: "smuggled in" }),
      });
      expect(decisionRefusals(decision), action).toContain("value_forbidden");
    }
  });

  it("does not flag the value as required or forbidden on the well-formed eight", () => {
    for (const action of VERDICT_ACTIONS) {
      const refusals = decisionRefusals(WELL_FORMED[action]);
      expect(refusals, action).not.toContain("value_required");
      expect(refusals, action).not.toContain("value_forbidden");
    }
  });
});

describe("invariant 5 — exactly one payload slot, and one this action may fill", () => {
  it("flags a value carrying no payload at all", () => {
    const decision = decisionOf({ action: "supply_value", value: valueOf() });
    expect(decisionRefusals(decision)).toContain("value_payload_missing");
  });

  it("flags two payload slots filled at once", () => {
    const decision = decisionOf({
      action: "choose_claimed_value",
      value: valueOf({
        observation_id: "33333333-3333-4333-8333-333333333333",
        value: "and also this",
      }),
    });
    expect(decisionRefusals(decision)).toContain("value_payload_ambiguous");
  });

  it("flags an override that fills both of its two legal slots", () => {
    const decision = decisionOf({
      ...WELL_FORMED.override,
      value: valueOf({ value: "a name", ref: "55555555-5555-4555-8555-555555555555" }),
    });
    expect(decisionRefusals(decision)).toContain("value_payload_ambiguous");
  });

  it("flags a slot the action may not fill", () => {
    // choose_claimed_value adopts an observation, never a scalar; supply_value
    // supplies a scalar, never an observation or (in M2) a ref; link_entity
    // confirms a match, never a scalar.
    const wrongSlot: readonly VerdictDecision[] = [
      decisionOf({ action: "choose_claimed_value", value: valueOf({ value: "typed by hand" }) }),
      decisionOf({
        action: "supply_value",
        value: valueOf({ observation_id: "33333333-3333-4333-8333-333333333333" }),
      }),
      decisionOf({
        action: "supply_value",
        value: valueOf({ ref: "55555555-5555-4555-8555-555555555555" }),
      }),
      decisionOf({ action: "link_entity", value: valueOf({ value: "The Forum" }) }),
    ];
    for (const decision of wrongSlot) {
      expect(decisionRefusals(decision), decision.action).toContain("value_payload_not_allowed");
    }
  });

  it("does not flag the payload of any well-formed decision", () => {
    for (const decision of [...Object.values(WELL_FORMED), REFERENCE_OVERRIDE]) {
      const refusals = decisionRefusals(decision);
      expect(refusals, decision.action).not.toContain("value_payload_missing");
      expect(refusals, decision.action).not.toContain("value_payload_ambiguous");
      expect(refusals, decision.action).not.toContain("value_payload_not_allowed");
    }
  });
});

describe("invariant 6 — who decided", () => {
  it("flags a blank actor", () => {
    for (const blank of ["", "   ", "\n"]) {
      const decision = decisionOf({ ...WELL_FORMED.settle, actor: blank });
      expect(decisionRefusals(decision), JSON.stringify(blank)).toContain("actor_required");
    }
  });

  it("flags an actor with nothing visible in it, and keeps one that has words", () => {
    // The same one definition of blank, on the other required text field:
    // `verdicts.actor` is the record of WHO decided, and an actor of
    // zero-width spaces names nobody (admin-window/BUG-0089).
    for (const invisible of INVISIBLE_ONLY) {
      const decision = decisionOf({ ...WELL_FORMED.settle, actor: invisible });
      expect(decisionRefusals(decision), JSON.stringify(invisible)).toContain(
        "actor_required",
      );
    }
    // …and the fixture it must not flag: an ordinary address, padded.
    const padded = decisionOf({ ...WELL_FORMED.settle, actor: "\u200badmin@example.test" });
    expect(decisionRefusals(padded)).toEqual([]);
  });

  it("does not flag an actor on any well-formed decision", () => {
    for (const action of VERDICT_ACTIONS) {
      expect(decisionRefusals(WELL_FORMED[action]), action).not.toContain("actor_required");
    }
  });
});

describe("a decision with several problems at once", () => {
  it("names every refusal that applies, so a caller sees them in one pass", () => {
    const decision = decisionOf({
      action: "wont_fix",
      review_item_id: null,
      actor: " ",
      note: "   ",
      value: valueOf({ value: "not allowed here" }),
    });
    expect(decisionRefusals(decision)).toEqual([
      "review_item_required",
      "note_required",
      "value_forbidden",
      "actor_required",
    ]);
  });
});

/*
 * The malformed body — what `decisionRefusals` is handed by the one seam that
 * calls it with data it did not build (TASK-0049: "the body is parsed into a
 * `VerdictDecision`; then `decisionRefusals` — a refused decision is a 400
 * naming the refusal and never reaches the database").
 *
 * `request.json()` produces an ABSENT key, never an explicit `null`: a client
 * that omits `value` on a settle-only action, or omits `review_item_id` on the
 * item-less `override`, sends the ordinary JSON for that decision. The guard
 * must GRADE those bodies, because grading them is the whole reason it runs
 * before the database rather than after (admin-window/TASK-0042, QA).
 */

/** A body as it arrives from `request.json()` — untyped, keys possibly absent. */
function bodyAsDecision(body: Record<string, unknown>): VerdictDecision {
  return body as unknown as VerdictDecision;
}

/**
 * The same decision with one key DELETED — `request.json()`'s rendering of a key
 * the client simply did not send, which is a different value (`undefined`) from
 * the explicit `null` every fixture above carries.
 */
function withoutKey(decision: VerdictDecision, key: keyof VerdictDecision): VerdictDecision {
  const body: Record<string, unknown> = { ...decision };
  delete body[key];
  return bodyAsDecision(body);
}

/*
 * These three were QA's strict xfails on admin-window/BUG-0079 (a crash and two
 * false refusals). The guard now grades an absent key exactly as it grades an
 * explicit null, so they are plain `it` and must stay green: an absent optional
 * key is the ORDINARY body for the decision it describes, not a malformation.
 */
describe("a body whose optional keys are absent, not null", () => {
  const ITEM = "22222222-2222-4222-8222-222222222222";

  it("grades a supply_value body that omits `value` as value_required [admin-window/BUG-0079]", () => {
    // Currently throws `TypeError: Cannot read properties of undefined`
    // instead of refusing — a crash where the campaign's one pre-database
    // guard owes a named refusal.
    const body = bodyAsDecision({
      action: "supply_value",
      review_item_id: ITEM,
      actor: "admin@example.test",
      note: null,
    });
    expect(decisionRefusals(body)).toEqual(["value_required"]);
  });

  it("refuses nothing for a settle body that omits `value` [admin-window/BUG-0079]", () => {
    // `settle` carries no value at all; omitting the key is the ordinary
    // JSON for it, and it is currently refused as `value_forbidden`.
    const body = bodyAsDecision({
      action: "settle",
      review_item_id: ITEM,
      actor: "admin@example.test",
      note: null,
    });
    expect(decisionRefusals(body)).toEqual([]);
  });

  it("refuses nothing for an override body that omits `review_item_id` [admin-window/BUG-0079]", () => {
    // The one item-less action: a client that leaves the key out is saying
    // exactly what an explicit null says, and is currently refused as
    // `review_item_forbidden` — the refusal for carrying an item.
    const body = bodyAsDecision({
      action: "override",
      actor: "admin@example.test",
      note: null,
      value: {
        domain: "events",
        entity_id: "11111111-1111-4111-8111-111111111111",
        field: "title",
        observation_id: null,
        value: "Seoul Olympic Stadium",
        ref: null,
      },
    });
    expect(decisionRefusals(body)).toEqual([]);
  });

  it("grades a __proto__ key in a parsed body as ordinary data", () => {
    // A JSON payload naming `__proto__` must neither pollute nor divert the
    // payload-slot reading: the own keys are what is graded.
    const value = JSON.parse(
      '{"__proto__":{"observation_id":"injected"},"domain":"events",' +
        '"entity_id":"11111111-1111-4111-8111-111111111111","field":"title",' +
        '"observation_id":null,"value":"a supplied name","ref":null}',
    ) as VerdictValue;
    const decision = decisionOf({ action: "supply_value", value });
    expect(decisionRefusals(decision)).toEqual([]);
    expect(({} as Record<string, unknown>).observation_id).toBeUndefined();
  });

  it("grades an absurdly long actor and value without throwing", () => {
    const decision = decisionOf({
      action: "supply_value",
      actor: "a".repeat(100_000),
      value: valueOf({ value: "z".repeat(500_000) }),
    });
    expect(decisionRefusals(decision)).toEqual([]);
  });
  it("grades an absent `value` as value_required on every value-carrying action", () => {
    // Criterion 1, iterated over the set rather than the three names the ticket
    // spells: a ninth value-carrying action gets the same grading for free.
    for (const action of VALUE_CARRYING) {
      const body = withoutKey(WELL_FORMED[action], "value");
      expect(decisionRefusals(body), action).toEqual(["value_required"]);
    }
  });

  it("refuses nothing for an absent `value` on every settle-only action", () => {
    // Criterion 2: omitting the key IS the ordinary JSON for these four.
    for (const action of SETTLE_ONLY) {
      const body = withoutKey(WELL_FORMED[action], "value");
      expect(decisionRefusals(body), action).toEqual([]);
    }
  });

  it("still flags a value that IS present on every settle-only action", () => {
    // The second fixture of the pair (LESSONS 3): loosening `!== null` to
    // `!= null` must not stop `value_forbidden` from firing on a real value.
    for (const action of SETTLE_ONLY) {
      const body = bodyAsDecision({
        ...WELL_FORMED[action],
        value: valueOf({ value: "smuggled in" }),
      });
      expect(decisionRefusals(body), action).toContain("value_forbidden");
    }
  });

  it("still flags an override that carries an item, absent key or not", () => {
    // The pair for criterion 3: absence is accepted, a carried id is refused.
    const carried = bodyAsDecision({
      ...WELL_FORMED.override,
      review_item_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(decisionRefusals(carried)).toEqual(["review_item_forbidden"]);
  });

  it("grades every other key absent, on every action, without throwing", () => {
    // The whole body reduced to its action: nothing throws, everything that is
    // missing is NAMED. `note` is only owed by wont_fix; `value` only by the
    // value-carrying four.
    for (const action of VERDICT_ACTIONS) {
      const expected = [
        ...(action === "override" ? [] : ["review_item_required"]),
        ...(action === "wont_fix" ? ["note_required"] : []),
        ...(VALUE_CARRYING.includes(action) ? ["value_required"] : []),
        "actor_required",
      ];
      expect(decisionRefusals(bodyAsDecision({ action })), action).toEqual(expected);
    }
  });

  it("grades a `value` of the wrong type as value_required, never a crash", () => {
    // A parsed body can carry anything in the slot. A non-object is not a
    // `VerdictValue`, so invariant 4 owns it (invariant 5 reads slots, and a
    // scalar has none); the settle-only actions still see it as a carried value.
    for (const wrong of ["a string", 7, true, []]) {
      const carrying = bodyAsDecision({ ...WELL_FORMED.supply_value, value: wrong });
      expect(decisionRefusals(carrying), JSON.stringify(wrong)).toEqual(["value_required"]);
      const settleOnly = bodyAsDecision({ ...WELL_FORMED.settle, value: wrong });
      expect(decisionRefusals(settleOnly), JSON.stringify(wrong)).toEqual(["value_forbidden"]);
    }
  });

  it("grades a body that is not an object at all, never a crash", () => {
    // `request.json()` yields these for the bodies `null`, `[]`, `"x"` and `4`.
    for (const body of [null, undefined, [], "x", 4]) {
      expect(decisionRefusals(body as unknown as VerdictDecision), JSON.stringify(body)).toEqual([
        "unknown_action",
        "actor_required",
      ]);
    }
  });

  it("reads the payload slots as OWN keys, so a prototype cannot fill one", () => {
    // The object-literal twin of QA's JSON.parse case: here `__proto__` really
    // does set the prototype, and an inherited `ref` must not read as a second
    // filled slot (which would refuse a well-formed supply_value as ambiguous).
    const value = {
      __proto__: { ref: "inherited-not-sent" },
      domain: "events",
      entity_id: "11111111-1111-4111-8111-111111111111",
      field: "title",
      observation_id: null,
      value: "a supplied name",
    } as unknown as VerdictValue;
    expect(decisionRefusals(decisionOf({ action: "supply_value", value }))).toEqual([]);
  });

  it("lets no `__proto__` key in a parsed BODY satisfy an invariant it did not send", () => {
    // The body-level twin of the value-level case above (QA, admin-window/
    // BUG-0079). `actor` is the one invariant checked on every action and
    // `verdicts.actor` is the log of who decided, so a forged body that spells
    // the identity under `__proto__` instead of as its own key must be refused
    // as `actor_required` — never credited with an inherited actor — and must
    // leave `Object.prototype` untouched for every later body in the process.
    const body = JSON.parse(
      '{"action":"settle","review_item_id":"22222222-2222-4222-8222-222222222222",' +
        '"__proto__":{"actor":"forged@attacker.test","value":{"ref":"r"}}}',
    ) as Record<string, unknown>;
    expect(decisionRefusals(bodyAsDecision(body))).toEqual(["actor_required"]);
    expect(({} as Record<string, unknown>).actor).toBeUndefined();
    expect(decisionRefusals(WELL_FORMED.settle)).toEqual([]);
  });

  it("grades a re-submitted body identically and never writes to it", () => {
    // The double-submit an operator makes by clicking twice, and the retry a
    // route makes on the same parsed body: the guard is a pure read, so the
    // second grading is the first, and nothing it returns can travel back into
    // the body the caller is about to send to the database.
    const body = JSON.parse(
      JSON.stringify({
        action: "supply_value",
        review_item_id: "22222222-2222-4222-8222-222222222222",
        actor: "admin@example.test",
        note: null,
        value: valueOf({ value: "BLACKPINK at the Forum" }),
      }),
    ) as Record<string, unknown>;
    const beforeGrading = JSON.stringify(body);
    const first = decisionRefusals(bodyAsDecision(body));
    const second = decisionRefusals(bodyAsDecision(body));
    expect(first).toEqual([]);
    expect(second).toEqual(first);
    expect(JSON.stringify(body)).toEqual(beforeGrading);

    // A caller that keeps and mutates the returned array cannot poison the
    // next grading of the same body, and a frozen body grades without throwing.
    (first as string[]).push("actor_required");
    expect(decisionRefusals(bodyAsDecision(body))).toEqual([]);
    expect(decisionRefusals(Object.freeze(WELL_FORMED.wont_fix))).toEqual([]);
  });
});
