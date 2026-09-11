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
 * **It also holds three things that are not verdict vocabulary**: `factKey`,
 * the app's one spelling of a fact identifier (`events.venue`), the one
 * definition of "blank" (`hasVisibleContent`, admin-window/BUG-0089), and the
 * app's one spelling of the em dash character with the absence question over
 * it (`EM_DASH`/`isAbsentText`, admin-window/BUG-0184). All live here for the
 * same structural reason, spelled out at each declaration: the surfaces and
 * guards that need them may import this module, and this module may import
 * nothing.
 *
 * **Absence is not this file's business.** Whether `settle_review_item` is
 * installed is answered by `readSettlementReadiness` reading the `verdicts`
 * table (§9.2), and by the data layer's `not_provisioned` classification — not
 * by a flag here. This module is pure and says nothing about provisioning.
 */

/* ── blank, defined once for the whole app ───────────────────────────────── */

/**
 * The characters that put NO INK on the page — the class
 * `String.prototype.trim()` does not know about (admin-window/BUG-0089).
 *
 * `trim()` strips the Unicode `White_Space` set (plus U+FEFF, which it treats
 * as one) and nothing else, so a note pasted out of a web page or a PDF as
 * U+200B ZERO WIDTH SPACE, U+2060 WORD JOINER or U+00AD SOFT HYPHEN reads as
 * written to it while being unreadable to a person. Three guards all tested
 * blankness with `trim()`, so all three agreed, and all three were wrong the
 * same way.
 *
 * What the class holds, and why each part is in it:
 *
 *   - `\p{White_Space}` — the spaces `trim()` already removed (ASCII, U+00A0,
 *     the U+2000 family, U+3000);
 *   - `\p{Cf}` — the FORMAT characters: U+200B/200C/200D, U+2060, U+00AD,
 *     U+FEFF, the bidi controls. Ink-less by definition, and the family this
 *     defect arrived as;
 *   - `\p{Cc}` — the C0/C1 controls. `trim()` removes five of them (tab, the
 *     two newlines, form feed, carriage return) and leaves the rest;
 *   - the four HANGUL FILLERS (U+115F, U+1160, U+3164, U+FFA0) — letters by
 *     category, blank by rendering, and the ink-less characters best known for
 *     being outside the two C classes.
 *
 * Where the line is DRAWN, so it reads as a ruling rather than an oversight:
 * an assigned printable character is CONTENT even when it looks unhelpful.
 * U+2800 BRAILLE PATTERN BLANK is a braille cell and a lone combining mark is
 * a mark — both stay content. This class means "renders nothing", not "says
 * nothing worth saying".
 */
const INK_LESS = /[\p{White_Space}\p{Cf}\p{Cc}\u115F\u1160\u3164\uFFA0]/gu;

/**
 * This text with every ink-less character removed — what a reader would
 * actually SEE of it.
 *
 * Only ever asked a question of. Nothing stores or sends this: a note with
 * visible content travels byte-identical (`settleBody`), because an operator's
 * words are theirs and this is a test, not a sanitiser.
 */
export function visibleContent(text: string): string {
  return text.replace(INK_LESS, "");
}

/**
 * **The app's one definition of blank**: is there anything here a person could
 * read? Takes `unknown` because a caller's field may be absent or not a string
 * at all, and a non-string has no visible content by definition.
 *
 * Every guard that asks "was this filled in?" asks HERE — `decisionRefusals`'
 * invariants 2, 3 and 6 below, the close form's `closeRefusal`, and
 * `isAbsent` in `lib/format.ts`, which decides whether the verdict log draws
 * the note or the em dash. One definition, so a note the form accepts cannot
 * be one the log renders as nothing (admin-window/BUG-0089, BUG-0085).
 *
 * **Why it lives in this leaf, of all files** — the dependency direction, and
 * it only points one way. This module imports NOTHING and must keep importing
 * nothing (ARCHITECTURE §4 rule 7, pinned by `tests/offline/db/layering.test.ts`),
 * so it can import neither `lib/format.ts` (which imports React) nor a new
 * shared module of its own; `format.ts` has no such constraint and imports
 * this. Putting the definition anywhere else means either breaking the leaf
 * rule or keeping the copies this bug was made of.
 */
export function hasVisibleContent(text: unknown): boolean {
  return typeof text === "string" && visibleContent(text).length > 0;
}

/**
 * The app's ONE spelling of the em dash CHARACTER (admin-window/BUG-0184).
 *
 * It is the character and not a meaning. The app writes this glyph for two
 * unrelated jobs: it JOINS the two clauses of a composed sentence
 * (`components/ui/error-line.tsx`, `components/ui/paging.tsx`, the edit fix
 * sentences in `components/edit-refusal.ts`), and it is what `nullDash()`
 * draws for a value that is not there. Naming the constant for the glyph is
 * what lets both jobs share one spelling without one identifier meaning two
 * things (ARCHITECTURE common violations row 18); the MEANING "no value"
 * belongs to `nullDash()` and to `isAbsentText` below.
 *
 * It lives in this leaf for the reason `visibleContent` does: `format.ts`
 * imports React and this module may import nothing, so a leaf that needs the
 * character (`lib/paging/machine.ts`) can reach it only here. `format.ts`
 * RE-EXPORTS this binding, so every `import { EM_DASH } from "@/lib/format"`
 * call site is unchanged and the app still holds one spelling.
 * `tests/offline/verdict/decision.test.ts` pins that it is spelled once.
 */
export const EM_DASH = "—";

/**
 * **Is this string one of the app's spellings of NO VALUE?** — the absence
 * question, as distinct from `hasVisibleContent`'s ink question
 * (admin-window/BUG-0184).
 *
 * Strictly WIDER than `hasVisibleContent`, and that is why both exist: a
 * string is absent when it puts no ink on the page at all, OR when the only
 * ink it puts there is the app's own dash. A lone em dash is an absence in
 * this app by construction — it is what `nullDash()` renders and what
 * `count(null)`, `absoluteUtc(null)` and `relativeAge(null).text` return — so
 * a value that reads back as one is a value nothing filled in.
 *
 * **The two doors this does NOT open.** `hasVisibleContent` is not widened by
 * this and keeps every caller it has: a lone dash an operator TYPED into a
 * close note is content to the note guards, and a source the registry NAMES
 * `—` has a name (`lib/sources/names.ts`). Blank and absent are two questions;
 * this gives the second one a home a leaf can reach, it does not merge them.
 *
 * `isAbsent` in `lib/format.ts` — the app's one absence test over a whole
 * `ReactNode` — delegates its STRING arm to this and nothing else, so there is
 * one body and the two predicates agree by construction rather than by
 * vigilance. `refuse()` in `lib/paging/machine.ts` asks it directly.
 */
export function isAbsentText(text: string): boolean {
  const visible = visibleContent(text);
  return visible === "" || visible === EM_DASH;
}

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

/* ── the fact identifier, spelled once ───────────────────────────────────── */

/**
 * **The app's one spelling of a fact identifier**: a registry domain and a
 * registry field, joined — `events.title`, `events.venue`, `venues.city`.
 *
 * The identifier is not decoration. `isReferenceField` below LOOKS UP the key
 * this returns in `REFERENCE_FIELDS`, so the predicate that decides whether a
 * `venue_id` fact may be settled with typed text is exactly this string; the
 * close slot renders the same string in its withheld-control notice and hands
 * it to the supply control as `supplies`; the claim table and the review
 * item's evidence rows show it to the operator. Every one of those was its own
 * hand-built template literal until admin-window/DEBT-0007 — four copies of one
 * two-part join, agreeing only by everyone reaching for the obvious spelling,
 * with nothing that would notice if one stopped (ARCHITECTURE.md §13.7, the
 * doctrine `settlePath` and `recordFieldApiPath` exist for). One producer now,
 * so the guard and the notice cannot disagree about what a fact is called.
 *
 * It takes the two parts SEPARATELY rather than a `VerdictValue`-shaped
 * object, because two of its callers have no envelope — a claim row and an
 * observation each carry `domain` and `field` as their own columns — and a
 * shared shape invented for them would be a second thing to keep in step.
 *
 * Pure, total, and it validates nothing: an empty domain or a field carrying a
 * dot is joined as given. There is no fact key this app may not name, and a
 * key with no entry in `REFERENCE_FIELDS` is simply not a reference — which
 * is the answer for every scalar in the registry.
 *
 * **Why it lives in this leaf**: it is the one module all four call sites may
 * import, being the one that imports nothing (ARCHITECTURE.md §4 rule 7,
 * pinned by `tests/offline/db/layering.test.ts`) — the same reason
 * `hasVisibleContent` is here. `tests/offline/verdict/decision.test.ts`
 * additionally scans `src/**` for a hand-built two-part join of a domain and a
 * field, so a fifth copy reddens the suite rather than joining the drift.
 */
export function factKey(domain: string, field: string): string {
  return `${domain}.${field}`;
}

/* ── which registry fields are references ────────────────────────────────── */

/**
 * The registry fields whose kind is `reference` — a field that LINKS ROWS
 * (`events.venue` -> `venue_id`, `events.performers` -> `event_performers`)
 * rather than holding a value — each entry spelled by `factKey` above, which
 * is how every surface here names a fact, so the list and the lookup cannot be
 * two different two-part joins (admin-window/DEBT-0007).
 *
 * **A mirrored literal, knowingly.** `kind: reference` and the `references:`
 * targets beside it live ONLY in the scraper repo's
 * `registry/domains/<domain>.yaml`. The database does not hold them —
 * `domain_target` carries the target table, `domain_schema` the value schema,
 * and neither says which fields are references — so no read this app can make
 * answers the question, and consulting "the registry's field kind" at runtime
 * is not an option that exists. The resolver's own SQL mirrors the same
 * knowledge as a literal for exactly this reason and says so in place
 * (`field_reference_target`, the pending-claim bucket view of
 * `kspace Scraper/supabase/migrations/20260901000004_*.sql`). This is the
 * Admin side of that mirror.
 *
 * **One place, and the picker replaces it.** Spec §8's entity picker is what
 * brings the registry's field settings to the surfaces that need them; when it
 * lands, the surfaces stop asking this constant and this constant goes. Until
 * then a reference field added to the registry without a line here loses the
 * protection below, which is why the list is spelled once, in the domain leaf
 * both the close slot and the record surface's override already import, rather
 * than hand-copied into each of them (LESSONS 3's drift, and ARCHITECTURE.md
 * §13.7).
 */
export const REFERENCE_FIELDS: readonly string[] = [
  factKey("events", "venue"),
  factKey("events", "performers"),
];

/**
 * Is this fact a reference — a field that links rows rather than holding a
 * scalar?
 *
 * The question a surface asks BEFORE it offers a control for a fact, and the
 * question `decisionRefusals` invariant 6 asks after it — a surface withholding
 * the control is courtesy, the refusal is the contract. A reference's value is
 * an entity, so it travels in the `ref` slot (`link_entity`, or an `override`
 * carrying the picker's choice) and never in the `value` slot that
 * `supply_value` is the sole filler of (`PAYLOAD_SLOTS` below). A free-text
 * control offered for one would settle a `venue_id` fact with typed text, which
 * is the write §8 exists to prevent ("the apply links rows … instead of writing
 * text").
 */
export function isReferenceField(domain: string, field: string): boolean {
  return REFERENCE_FIELDS.includes(factKey(domain, field));
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
 *
 * This table is about the SLOT and knows nothing about the FACT: `["value"]`
 * says a scalar may ride in `value`, not that the field this decision names
 * holds a scalar at all. Invariant 7 is the half that reads the fact
 * (admin-window/BUG-0091).
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
 * Non-blank BY VISIBLE CONTENT — the test a required text field actually has
 * to pass. Takes `unknown` because the caller's field may be absent or not a
 * string; anything that is not a string has no visible content at all.
 *
 * `hasVisibleContent` is the app's ONE definition of blank (above); this is
 * the local name the invariants below read by, and it delegates rather than
 * repeating the test.
 */
function present(text: unknown): boolean {
  return hasVisibleContent(text);
}

/**
 * The `domain.field` a payload envelope names, or null when it names no fact a
 * predicate could answer about.
 *
 * Both parts must really be STRINGS. `isReferenceField` interpolates them, and
 * an envelope carrying `{domain: {}, field: []}` would otherwise be asked about
 * under a coerced spelling — a graded body is never trusted to hold the type it
 * declares (admin-window/BUG-0079). A fact this cannot read is simply not a
 * reference, and the other invariants keep grading it.
 */
function factOf(value: unknown): { domain: string; field: string } | null {
  const holder = asRecord(value);
  const { domain, field } = holder;
  if (typeof domain !== "string" || typeof field !== "string") return null;
  return { domain, field };
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
 * The seven invariants, in the order they are checked:
 *
 *  1. `unknown_action` — the action is not one of the eight. Data can arrive
 *     from a form as any string, so this is checked at runtime rather than
 *     left to the type. When it fires, the action-dependent invariants (2-5)
 *     are NOT evaluated — there is no rule to evaluate them against — while
 *     `actor` still is, because invariant 7 does not depend on the action.
 *  2. `review_item_required` / `review_item_forbidden` — `review_item_id` is
 *     null on `override`, and a non-blank id on every other action. An id of
 *     nothing but ink-less characters — spaces, or the invisible ones
 *     `trim()` leaves behind — is refused as `review_item_required`: it is the
 *     same defect as a blank note, and `verdicts.review_item_id` is a uuid FK
 *     that no such string can satisfy.
 *  3. `note_required` — a null note, or one with no VISIBLE CONTENT
 *     (`hasVisibleContent`), where `noteRequired(action)`. A present-but-blank
 *     note is exactly the shape a form alone lets through, and the function
 *     would RAISE on it. Blank is not "empty after `trim()`": a note of zero-
 *     width spaces or soft hyphens is a note nobody can read, and it settled
 *     the item until admin-window/BUG-0089.
 *  4. `value_required` / `value_forbidden` — a `VerdictValue` is present on the
 *     value-carrying actions and absent (or null) on the settle-only ones. A
 *     `value` that is present but not an envelope — a string, a number, an
 *     array — is `value_required` too: it is not a `VerdictValue`, and invariant
 *     5 only reads the slots of one that is.
 *  5. `value_payload_missing` / `value_payload_ambiguous` /
 *     `value_payload_not_allowed` — exactly one payload slot is filled, and it
 *     is one this action may fill (`PAYLOAD_SLOTS`).
 *  6. `reference_field_not_scalar` — the `value` slot is filled for a fact
 *     `isReferenceField` calls a REFERENCE. A reference links rows
 *     (`events.venue` -> `venue_id`), so its value is an entity and travels in
 *     `ref`; typed text in `value` is the write spec §8 exists to prevent
 *     ("the apply links rows … instead of writing text"). Asked of the FACT,
 *     not of the action, so it holds for a hand-crafted `supply_value`, for the
 *     scalar arm of an `override`, and for any later action that fills that
 *     slot — while `link_entity` and a ref-carrying `override` are untouched,
 *     because neither fills `value` (admin-window/BUG-0091). Until this landed
 *     the rule lived only in the close slot's list of controls, which FEAT-0010
 *     calls the courtesy layer (admin-window/BUG-0087).
 *  7. `actor_required` — a blank actor, by the same visible-content test.
 *     `verdicts.actor` is not null, and the verdict log is the record of every
 *     admin data action.
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

    // 6. A reference is LINKED, never typed. Read off the fact rather than off
    //    the action, and independent of invariant 5's arithmetic: a filled
    //    `value` slot on a reference fact is refused whether it is the only
    //    filled slot, one of two, or in a slot this action may not fill at all.
    //    An envelope that is not an envelope reaches `factOf` as no fact and is
    //    invariant 4's business, not this one's.
    if (isValueObject(value) && filled(value, "value")) {
      const fact = factOf(value);
      if (fact !== null && isReferenceField(fact.domain, fact.field)) {
        refusals.push("reference_field_not_scalar");
      }
    }
  }

  // 7. Who decided. Independent of the action, so it is checked either way.
  if (!present(body.actor)) refusals.push("actor_required");

  return refusals;
}
