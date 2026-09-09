/**
 * The verdict decision envelope: ONE typed decision, and the shape
 * `settle_review_item` reads (spec §7, ARCHITECTURE.md §9.2, campaign
 * admin-window/TASK-0042).
 *
 * Every M2 surface that settles a review item or overrides a catalog value
 * builds a `VerdictDecision` and hands it to the one call site
 * (`settleReviewItem` in `lib/db/verdict.ts`); the §9 handoff artifact's SQL
 * reads the same eight action names, and that artifact's own offline test
 * imports `VERDICT_ACTIONS` from here and asserts the migration's `action`
 * CHECK equals it. So the SQL and the UI agree by test rather than by two
 * builders remembering (SPEC named gap 6).
 *
 * **A pure domain leaf** (ARCHITECTURE.md §4 rule 7): this module imports
 * NOTHING — not `lib/db/**`, not `@supabase/supabase-js`, not `process.env`,
 * not React, not a type. `lib/db/**` imports it; it never imports back, so no
 * directory-level cycle can be written into the contract.
 * `tests/offline/db/layering.test.ts` pins that, beside `lib/edit/config.ts`.
 *
 * **What this envelope may NOT carry, because the database already knows it**
 * (ARCHITECTURE.md §9.2):
 *
 *   - no `schema_version` — the gate resolves the domain's registry version
 *     inside the FUNCTION; a version number spelled here is scraper registry
 *     knowledge re-encoded by hand, which spec §10 calls a flagged gap rather
 *     than a silent copy;
 *   - no source name, no tier, no `rejected_by` — the function's own branches.
 *     `ADMIN_SOURCE` below is the NAME of the admin voice, spelled once here
 *     so the handoff artifact's test can pin the SQL's literal to it; it is
 *     not a field, and `VerdictDecision` gains none;
 *   - no canonical column name distinct from the registry field: the registry's
 *     field names ARE the canonical columns' names, with `events.venue` (field)
 *     -> `events.venue_id` (column) the one exception, which is what makes it a
 *     reference rather than a cell;
 *   - no HTTP, no client, no React.
 *
 * **Absence is not this file's business.** Whether `settle_review_item` is
 * installed is answered by `readSettlementReadiness` reading the `verdicts`
 * table (§9.2), and by the data layer's `not_provisioned` classification — not
 * by a flag here. This module is pure and says nothing about provisioning.
 */

/**
 * The eight actions, ruled in ARCHITECTURE.md §9.2 because no contract spelled
 * them and two builders may not each invent one. snake_case, rendered verbatim
 * in mono when a surface shows one (§11) — never uppercased or prettified.
 */
export type VerdictAction =
  /** `data_conflict`: adopt one claimed observation's value. */
  | "choose_claimed_value"
  /** `data_conflict`: the operator's own value, written at the admin tier. */
  | "supply_value"
  /** `data_conflict`: canonical stands; the rejections still land. */
  | "keep_current"
  /** `entity_link` fact: confirm the match to an existing entity. */
  | "link_entity"
  /** `entity_link` fact: leave it held; the claim keeps waiting in its bucket. */
  | "settle"
  /** Signal disposition: the breakage was addressed elsewhere. */
  | "fixed"
  /** Signal disposition: the condition stands. The note is REQUIRED. */
  | "wont_fix"
  /** Item-less, from the record surface: `review_item_id` is null. */
  | "override";

/**
 * The registered `sources` row every admin-tier observation is written under —
 * the admin voice (Ben's answer of 2026-09-08, ARCHITECTURE.md §9.2).
 *
 * A NAME, not an envelope field. Nothing in `src/` sends it: the gate refuses an
 * unregistered source (KS007), so the `settle_review_item` artifact both
 * registers this row and names it in its own constant, and
 * `tests/offline/handoff/settle-review-item.test.ts` asserts the artifact's two
 * literals equal this one. It lives in the leaf because the leaf is the one
 * module both a surface and that test may import (§4 rule 7).
 */
export const ADMIN_SOURCE = "admin";

/** The eight, in the order §9.2 states them. */
export const VERDICT_ACTIONS: readonly VerdictAction[] = [
  "choose_claimed_value",
  "supply_value",
  "keep_current",
  "link_entity",
  "settle",
  "fixed",
  "wont_fix",
  "override",
];

/**
 * The value a verdict carries, when it carries one.
 *
 * Exactly one of the three payload slots below is filled, and which one is
 * legal depends on the action — see `decisionRefusals` invariant 5. The other
 * two are null: two filled slots are two spellings of one fact, which is what
 * `verdicts` declines to carry a `chosen_value` column for (spec §7's
 * Rationale).
 */
export interface VerdictValue {
  /** The REGISTRY domain the field belongs to: `events`, `venues`. */
  readonly domain: string;
  /** The canonical row the value lands on. */
  readonly entity_id: string;
  /**
   * The REGISTRY field name — which is the canonical column's own name, except
   * `events.venue`, whose column is `venue_id` (§9.2).
   */
  readonly field: string;
  /** `choose_claimed_value`: the observation whose value is adopted. */
  readonly observation_id: string | null;
  /** `supply_value` / a scalar `override`: the operator's own value. */
  readonly value: string | number | boolean | null;
  /**
   * A reference field's chosen entity id, carried as the admin source's own
   * `external_ref` (§9.2): a reference is observed as a ref, and the link stage
   * resolves `(source, domain, external_ref)` through `confirmed_matches` into
   * the id column. `link_entity`, and an `override` of a reference field.
   */
  readonly ref: string | null;
}

/** One decision, the whole argument `settle_review_item` takes. */
export interface VerdictDecision {
  readonly action: VerdictAction;
  /**
   * Null on `override` and ONLY on `override` (spec §7's item-less row). A body
   * that omits the key says the same thing as an explicit null.
   */
  readonly review_item_id: string | null;
  /** The signed-in admin's identity. */
  readonly actor: string;
  /** The admin's "why" — at their discretion, except on `wont_fix`. */
  readonly note: string | null;
  /**
   * Null on the settle-only actions; see `decisionRefusals` invariant 4. Their
   * ordinary JSON omits the key entirely, which grades the same as null.
   */
  readonly value: VerdictValue | null;
}

/**
 * The keys of `VerdictDecision`, and of its `value` envelope — the exact key
 * sets `settle_review_item` accepts and refuses anything outside of.
 *
 * Neither list is hand-written: each is the keys of a `Record<keyof T, true>`,
 * so `tsc` refuses a missing or an extra entry and the two cannot drift from
 * the interfaces above. `tests/offline/handoff/settle-review-item.test.ts`
 * compares the artifact's own `c_decision_keys` / `c_value_keys` arrays against
 * them, which is how the shape F9 authors stays the shape F10 calls (SPEC
 * named gap 6).
 *
 * Note what is in neither: no `schema_version`, no source name, no tier, no
 * `rejected_by`, no canonical column — the database knows all five.
 */
const DECISION_KEY_SET: Record<keyof VerdictDecision, true> = {
  action: true,
  review_item_id: true,
  actor: true,
  note: true,
  value: true,
};

const VALUE_KEY_SET: Record<keyof VerdictValue, true> = {
  domain: true,
  entity_id: true,
  field: true,
  observation_id: true,
  value: true,
  ref: true,
};

export const DECISION_KEYS: readonly (keyof VerdictDecision)[] = Object.keys(
  DECISION_KEY_SET,
) as (keyof VerdictDecision)[];

export const DECISION_VALUE_KEYS: readonly (keyof VerdictValue)[] = Object.keys(
  VALUE_KEY_SET,
) as (keyof VerdictValue)[];

/**
 * Does this action REQUIRE a note?
 *
 * Only `wont_fix` does (spec §7: "on which the note is required: why the
 * condition stands"), and the function raises on a null or empty one — so a
 * surface that lets a blank through gets a database error where it could have
 * shown a refusal. Everything else takes a note at the admin's discretion.
 */
export function noteRequired(action: VerdictAction): boolean {
  return action === "wont_fix";
}

/** The three slots of `VerdictValue` that can carry the verdict's payload. */
type PayloadSlot = "observation_id" | "value" | "ref";

/**
 * Which payload slots each action may fill. An EMPTY list means the action
 * carries no `VerdictValue` at all — the settle-only actions, whose whole
 * effect is the item's settlement and the rejections it implies.
 *
 * `override` is the one action with two legal slots, because the record
 * surface it comes from edits both scalars and the ONE reference column
 * (`events.venue_id`, F12's picker). `supply_value` takes a scalar alone: a
 * reference chosen by an operator arrives as an `override` from that same
 * record surface, never as a `supply_value` — which is why widening this to a
 * ref-carrying `supply_value` would be a decision for the architect, not an
 * adaptation here (admin-window/TASK-0042).
 */
const PAYLOAD_SLOTS: Readonly<Record<VerdictAction, readonly PayloadSlot[]>> = {
  choose_claimed_value: ["observation_id"],
  supply_value: ["value"],
  keep_current: [],
  link_entity: ["ref"],
  settle: [],
  fixed: [],
  wont_fix: [],
  override: ["value", "ref"],
};

/** Every slot, in the order a refusal reports them. */
const ALL_SLOTS: readonly PayloadSlot[] = ["observation_id", "value", "ref"];

/**
 * A JSON body is an object only when it IS one: `request.json()` answers `null`,
 * an array or a scalar for the bodies `null`, `[]` and `"x"`, and a client that
 * omits a key sends `undefined`, never an explicit null. Everything this module
 * grades therefore arrives as `unknown`, and a missing or wrongly-typed part is
 * graded into a NAMED refusal rather than indexed into a TypeError
 * (admin-window/BUG-0079).
 */
function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/** Is this a `VerdictValue`-shaped envelope at all — an object, not a scalar? */
function isValueObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A slot is FILLED when it holds anything but null or undefined; `false` and `0`
 * fill it. Read as an OWN key: a `__proto__` in a body must be data, never a
 * fourth way to fill a slot.
 */
function filled(value: unknown, slot: PayloadSlot): boolean {
  const holder = asRecord(value);
  if (!Object.prototype.hasOwnProperty.call(holder, slot)) return false;
  return holder[slot] !== null && holder[slot] !== undefined;
}

/**
 * Non-blank after trim — the test a required text field actually has to pass.
 * Takes `unknown` because the caller's field may be absent or not a string.
 */
function present(text: unknown): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

/**
 * Every reason this decision may not be sent, as NAMED refusals — empty when
 * the decision is well-formed.
 *
 * The names are identifiers for a caller to branch on, in the manner of
 * `EditRefusal.kind` (`lib/edit/config.ts`); the words an operator reads are
 * the surface's, never one of these strings rendered raw (LESSONS 5).
 *
 * **It never throws — a malformed body is refusals, not an exception.** This is
 * the campaign's one pre-database guard, and the route that calls it parses an
 * arbitrary JSON body first, so an ABSENT key (`request.json()` never invents an
 * explicit null for a key the client omitted), a wrongly-typed field, a
 * `__proto__` key, or a body that is not an object at all must all come back as
 * NAMED refusals: a crash here turns the settle route's 400 into a 500
 * (admin-window/BUG-0079). Absent and null are the same fact throughout —
 * omitting `value` on a settle, or `review_item_id` on an override, is the
 * ordinary JSON for that decision and refuses nothing.
 *
 * The six invariants, in the order they are checked:
 *
 *  1. `unknown_action` — the action is not one of the eight. Data can arrive
 *     from a form as any string, so this is checked at runtime rather than
 *     left to the type. When it fires, the action-dependent invariants (2-5)
 *     are NOT evaluated — there is no rule to evaluate them against — while
 *     `actor` still is, because invariant 6 does not depend on the action.
 *  2. `review_item_required` / `review_item_forbidden` — `review_item_id` is
 *     null on `override`, and a non-blank id on every other action. An
 *     all-whitespace id is refused as `review_item_required`: it is the same
 *     defect as a blank note, and `verdicts.review_item_id` is a uuid FK that
 *     no blank string can satisfy.
 *  3. `note_required` — a null, empty or all-whitespace note where
 *     `noteRequired(action)`. A present-but-blank note is exactly the shape a
 *     form alone lets through, and the function would RAISE on it.
 *  4. `value_required` / `value_forbidden` — a `VerdictValue` is present on the
 *     value-carrying actions and absent (or null) on the settle-only ones. A
 *     `value` that is present but not an envelope — a string, a number, an
 *     array — is `value_required` too: it is not a `VerdictValue`, and invariant
 *     5 only reads the slots of one that is.
 *  5. `value_payload_missing` / `value_payload_ambiguous` /
 *     `value_payload_not_allowed` — exactly one payload slot is filled, and it
 *     is one this action may fill (`PAYLOAD_SLOTS`).
 *  6. `actor_required` — a blank actor. `verdicts.actor` is not null, and the
 *     verdict log is the record of every admin data action.
 *
 * All refusals that apply are returned, so a caller sees every problem at
 * once rather than one per round trip.
 */
export function decisionRefusals(decision: VerdictDecision): readonly string[] {
  const refusals: string[] = [];
  // Graded as a parsed body, not as a built object: the type is what a caller
  // MEANT to hand over, and the one seam that calls this hands it whatever the
  // client sent. An absent key reads as `undefined` and is graded exactly as an
  // explicit `null` — `== null` throughout (admin-window/BUG-0079).
  const body = asRecord(decision);
  const action = body.action as VerdictAction;
  const known = VERDICT_ACTIONS.includes(action);

  if (!known) refusals.push("unknown_action");

  if (known) {
    // 2. The item, and the one action that goes without it. A client omitting
    //    the key on an override says exactly what an explicit null says.
    if (action === "override") {
      if (body.review_item_id != null) refusals.push("review_item_forbidden");
    } else if (!present(body.review_item_id)) {
      refusals.push("review_item_required");
    }

    // 3. The note `wont_fix` cannot settle without.
    if (noteRequired(action) && !present(body.note)) {
      refusals.push("note_required");
    }

    // 4 and 5. The payload. A value that is absent, null, or not an envelope at
    //    all is refused by invariant 4 — invariant 5 reads slots, and a scalar
    //    has none — so `filled()` is never reached with a non-object.
    const slots = PAYLOAD_SLOTS[action];
    const value = body.value;
    if (slots.length === 0) {
      if (value != null) refusals.push("value_forbidden");
    } else if (!isValueObject(value)) {
      refusals.push("value_required");
    } else {
      const usedSlots = ALL_SLOTS.filter((slot) => filled(value, slot));
      if (usedSlots.length === 0) refusals.push("value_payload_missing");
      else if (usedSlots.length > 1) refusals.push("value_payload_ambiguous");
      else if (!slots.includes(usedSlots[0])) refusals.push("value_payload_not_allowed");
    }
  }

  // 6. Who decided. Independent of the action, so it is checked either way.
  if (!present(body.actor)) refusals.push("actor_required");

  return refusals;
}
