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
 *   - no source name, no tier, no `rejected_by` — the function's own branches;
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
  /** Null on `override` and ONLY on `override` (spec §7's item-less row). */
  readonly review_item_id: string | null;
  /** The signed-in admin's identity. */
  readonly actor: string;
  /** The admin's "why" — at their discretion, except on `wont_fix`. */
  readonly note: string | null;
  /** Null on the settle-only actions; see `decisionRefusals` invariant 4. */
  readonly value: VerdictValue | null;
}

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

/** A slot is FILLED when it holds anything but null. `false` and `0` fill it. */
function filled(value: VerdictValue, slot: PayloadSlot): boolean {
  return value[slot] !== null && value[slot] !== undefined;
}

/** Non-blank after trim — the test a required text field actually has to pass. */
function present(text: string | null): boolean {
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
 *     value-carrying actions and null on the settle-only ones.
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
  const action = decision.action;
  const known = VERDICT_ACTIONS.includes(action);

  if (!known) refusals.push("unknown_action");

  if (known) {
    // 2. The item, and the one action that goes without it.
    if (action === "override") {
      if (decision.review_item_id !== null) refusals.push("review_item_forbidden");
    } else if (!present(decision.review_item_id)) {
      refusals.push("review_item_required");
    }

    // 3. The note `wont_fix` cannot settle without.
    if (noteRequired(action) && !present(decision.note)) {
      refusals.push("note_required");
    }

    // 4 and 5. The payload.
    const slots = PAYLOAD_SLOTS[action];
    const value = decision.value;
    if (slots.length === 0) {
      if (value !== null) refusals.push("value_forbidden");
    } else if (value === null) {
      refusals.push("value_required");
    } else {
      const usedSlots = ALL_SLOTS.filter((slot) => filled(value, slot));
      if (usedSlots.length === 0) refusals.push("value_payload_missing");
      else if (usedSlots.length > 1) refusals.push("value_payload_ambiguous");
      else if (!slots.includes(usedSlots[0])) refusals.push("value_payload_not_allowed");
    }
  }

  // 6. Who decided. Independent of the action, so it is checked either way.
  if (!present(decision.actor)) refusals.push("actor_required");

  return refusals;
}
