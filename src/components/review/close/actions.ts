import type { ButtonVariant, UnavailableRead } from "@/components/ui";
import type { EvidenceRow } from "@/components/review";
import type { PickerWindow } from "@/components/records/entity-picker";
import type { ReviewItemRow } from "@/lib/review/shapes";
import {
  hasVisibleContent,
  noteRequired,
  type VerdictAction,
  type VerdictValue,
} from "@/lib/verdict/decision";

/**
 * The close slot's shared contract — campaign admin-window/TASK-0049, spec §7.
 *
 * Three shape modules beside this one fill an action list each
 * (`conflict-actions.tsx`, `link-actions.tsx`, `signal-actions.tsx`), and each
 * is written by its own ticket in its own worktree. What they must agree on is
 * here, once: what an action IS, how the control's decision is spelled on the
 * wire, and the ONE request that carries it (ARCHITECTURE.md §13.7 — a helper
 * several tickets need is seeded before them, or it becomes N copies that
 * drift).
 *
 * **An `ActionSpec` is DATA, never a callback.** The list is built on the
 * server (the page picks the shape's builder) and rendered by a client
 * component, so anything in it crosses the server/client boundary and has to
 * survive serialisation. A spec that carried "how to build the decision" as a
 * function could not cross it at all; carrying the decision's PAYLOAD as data
 * does, and it keeps the eight action names the only vocabulary
 * (ARCHITECTURE.md §9.2).
 *
 * **Nothing here talks to a database, and nothing here settles anything.** The
 * one call to `settle_review_item` is `settleReviewItem` in
 * `src/lib/db/verdict.ts`, reached only through the route below — the whole
 * point of the single entry point (spec §7, `tests/offline/review/one-place.test.ts`).
 */

/**
 * One control in the close slot: what it says, which of the eight actions it
 * takes, and the payload that action carries.
 *
 * `value` is null on the settle-only actions (`keep_current`, `settle`,
 * `fixed`, `wont_fix`) — `decisionRefusals` invariant 4 refuses a payload on
 * those and requires one on the rest, so a spec is well-formed or it is
 * refused before it reaches the database.
 */
export interface ActionSpec {
  /**
   * The operator's word for it: a verb plus its object, naming what gets
   * written ("Keep current value", "Mark fixed") — LOOK_AND_FEEL copy bar 1.
   */
  readonly label: string;
  /** Which of the eight (`VERDICT_ACTIONS`). Rendered verbatim in mono (§11). */
  readonly action: VerdictAction;
  /** The payload this control carries, or null for a settle-only action. */
  readonly value: VerdictValue | null;
  /**
   * How the control is drawn. A settlement that writes canonical is
   * `destructive` (red border, never a red fill); everything else is
   * secondary. Presentation only — it decides nothing about the write.
   *
   * A control the operator TYPES into is not a button and takes none: see
   * `supplies` below.
   */
  readonly variant?: ButtonVariant;
  /**
   * The fact this control's value is typed for, as `domain.field`
   * (`events.title`) — present ONLY on a control whose payload the operator
   * supplies, absent on every other (campaign admin-window/TASK-0050, spec
   * §7's "supply a different value").
   *
   * Its presence is the whole discriminator, and it carries a NAME rather
   * than a widget because an `ActionSpec` is DATA that crosses the
   * server/client boundary: the server knows which fact is being decided, the
   * browser knows how to take a value for it, and neither carries the other's
   * half. The value itself is NOT in `spec.value` — it does not exist until
   * the operator types it, which is why `decisionValue` below merges the two
   * rather than a builder guessing one.
   *
   * The string is the field's accessible name, spelled the way the evidence
   * cells already spell a fact (`EvidenceRow.fact`), so an operator hears the
   * same words the page shows.
   */
  readonly supplies?: string;
  /**
   * The window of EXISTING rows this control's payload is CHOSEN from —
   * present ONLY on a control the operator picks a record with, absent on
   * every other (campaign admin-window/TASK-0056, spec §7's "link to an
   * existing entity").
   *
   * The sibling of `supplies`, and deliberately its opposite in one respect:
   * `supplies` carries a NAME because the operator's scalar does not exist
   * until it is typed, while this carries the ROWS because the operator's
   * choice must be one that already exists. The picker offers what the read
   * returned and creates nothing (`components/records/entity-picker.tsx`,
   * SPEC F12), so the window has to cross the server/client boundary with the
   * spec — it is plain data, which is what makes that possible.
   *
   * Its presence routes the operator's contribution into the `ref` slot rather
   * than `value` (`decisionValue` below): a reference is observed as a ref and
   * resolved through `confirmed_matches`, never written as text
   * (ARCHITECTURE.md §9.2, `PAYLOAD_SLOTS` in the leaf). A spec carrying BOTH
   * `supplies` and `chooses` is malformed — one control, one payload — and no
   * builder produces one.
   */
  readonly chooses?: PickerWindow;
}

/**
 * What a shape's builder is handed about the rows a link may point at: the
 * window, and the read's own account of why there is none.
 *
 * Two fields rather than one, for the reason every leg on this window is
 * reported separately: a REFUSED read and a fact that has nothing to link are
 * different states and must not share a rendering (LESSONS 1). `window` null
 * with `note` null means no read was made at all — this item names no
 * linkable reference — and `note` non-null means one was made and refused.
 *
 * Declared structurally rather than imported from `lib/db`, exactly as
 * `UnavailableRead` is: a component imports nothing that can reach a database
 * (ARCHITECTURE.md §4 rule 1). `ReferenceChoices` satisfies it, so the page
 * hands one straight over.
 */
export interface ShapeChoices {
  readonly window: PickerWindow | null;
  readonly note: UnavailableRead | null;
}

/**
 * What a shape's builder is given: the item, and the evidence rows the page
 * already resolved for it.
 *
 * The evidence is here because `data_conflict`'s first action is one control
 * per evidence card (spec §7), so the list is a function of the evidence and
 * not of the item alone. A builder that needs neither ignores both.
 */
export interface ShapeActionsInput {
  readonly item: ReviewItemRow;
  readonly evidence: readonly EvidenceRow[];
  /**
   * The rows this item's fact may be LINKED to, when the page read any
   * (campaign admin-window/TASK-0056). Absent or null on every shape that
   * links nothing, which is every shape but the `entity_link` fact item — a
   * builder that needs none ignores it, exactly as one that needs no evidence
   * ignores that.
   */
  readonly choices?: ShapeChoices | null;
}

/** Every shape module's one export: the actions this shape offers, in order. */
export type ShapeActions = (input: ShapeActionsInput) => readonly ActionSpec[];

/**
 * The ONE mutating URL of the close (the route is
 * `src/app/api/admin/review-items/[reviewItemId]/settle/route.ts`).
 *
 * Spelled once, here, for the same reason `recordFieldApiPath`
 * (`src/components/records/submit.ts`) is: the browser half and the tests both
 * need it, and two spellings of a path is two chances for one of them to be
 * wrong in a way nothing catches.
 */
export function settlePath(reviewItemId: string): string {
  return `/api/admin/review-items/${encodeURIComponent(reviewItemId)}/settle`;
}

/**
 * The body one control posts: the action, the note, and the payload.
 *
 * `review_item_id` and `actor` are deliberately NOT in it. The route stamps
 * both — the item from its own URL, the actor from the signed-in admin — so
 * neither is forgeable by whatever posts here, and `verdicts` cannot be made
 * to log a settlement in someone else's name. The route rebuilds the whole
 * `VerdictDecision` from these three plus those two.
 */
export interface SettleRequestBody {
  readonly action: VerdictAction;
  readonly note: string | null;
  readonly value: VerdictValue | null;
}

/**
 * The payload this control settles with, once the operator's own value — if
 * this control takes one — is in hand.
 *
 * A control that `supplies` a fact declares every part of its `VerdictValue`
 * except the one part only the operator can give (`value`), so this is where
 * the two halves meet, ONCE, for the browser and the tests alike. A control
 * that supplies nothing hands its payload over untouched, so the ordinary
 * button path is exactly what it was.
 *
 * `supplied` is `string | null` because that is what the edit cell hands back:
 * an empty field is a null and not `""` (`EditableCell`'s `commit`). A null
 * reaching here would be refused by `decisionRefusals` invariant 5 as
 * `value_payload_missing`, which is why `closeRefusal` below catches it one
 * round trip earlier.
 */
export function decisionValue(
  spec: ActionSpec,
  supplied: string | null,
): VerdictValue | null {
  if (spec.value === null) return null;
  // A CHOSEN row travels in `ref`, a TYPED value in `value`, and which slot is
  // filled is the whole difference between linking a row and writing text over
  // one (`PAYLOAD_SLOTS`, ARCHITECTURE.md §9.2). The discriminator is the
  // spec's, so no call site decides it twice and a control cannot fill the
  // slot its action may not (admin-window/TASK-0056).
  if (spec.chooses !== undefined) return { ...spec.value, ref: supplied };
  if (spec.supplies !== undefined) return { ...spec.value, value: supplied };
  return spec.value;
}

/**
 * The body for this control and this note; a blank note is null, not `""`.
 *
 * Blank is the app's one definition of it (`hasVisibleContent`), so a note of
 * nothing but invisible characters travels as the null it reads as rather than
 * as content nobody can see (admin-window/BUG-0089). A note that HAS visible
 * content is sent as the operator wrote it, trimmed at the ends and otherwise
 * byte-identical: this is a blankness test, never a sanitiser, and an
 * operator's words are not ours to rewrite.
 */
export function settleBody(
  spec: ActionSpec,
  note: string,
  supplied: string | null = null,
): SettleRequestBody {
  const trimmed = note.trim();
  return {
    action: spec.action,
    note: hasVisibleContent(note) ? trimmed : null,
    value: decisionValue(spec, supplied),
  };
}

/**
 * The form's own refusal identifier, or null when it has none — **the
 * courtesy guard, and not the contract**.
 *
 * `wont_fix` needs a note and the FUNCTION raises without one (spec §7); this
 * catches it one round trip earlier, in the same words `decisionRefusals`
 * uses, so the two guards can never disagree about which case they mean. A
 * client that skips this file entirely still meets `decisionRefusals` in the
 * route and the function's own `raise` behind it — three guards, on purpose.
 *
 * It returns an IDENTIFIER, never operator copy (LESSONS 5): the words a
 * person reads are `noteRefusalWords` below.
 */
export function closeRefusal(
  spec: ActionSpec,
  note: string,
  supplied: string | null = null,
): string | null {
  // Blank by VISIBLE CONTENT, not by `trim()`: a note of zero-width spaces or
  // soft hyphens — what a paste out of a web page or a PDF yields — is a note
  // with nothing in it to read, and `wont_fix` is the one action whose note is
  // the contract (admin-window/BUG-0089). The same one definition
  // `decisionRefusals` and `isAbsent` read, so no two guards can disagree
  // about which notes are blank.
  if (noteRequired(spec.action) && !hasVisibleContent(note)) return "note_required";
  // A control that takes a value and was given none. `decisionRefusals`
  // invariant 4 spells that same case `value_required`, and this borrows the
  // identifier rather than inventing a second name for one fact. A supplied
  // value of invisible characters is "none" for the same reason a note is: it
  // would otherwise be written to canonical as a value nobody can see.
  if (spec.supplies !== undefined && !hasVisibleContent(supplied)) {
    return "value_required";
  }
  // A control that LINKS a row and was handed no row. Its own identifier
  // rather than `value_required`'s, because the two are different acts: one
  // asks for a value nobody typed, this one for a record nobody picked, and
  // `decisionRefusals` would grade the empty one `value_payload_missing`
  // (invariant 5) one round trip later (admin-window/TASK-0056).
  if (spec.chooses !== undefined && !hasVisibleContent(supplied)) {
    return "ref_required";
  }
  return null;
}

/**
 * What the operator reads when the form refuses — LOOK_AND_FEEL copy bar 3:
 * name what failed, then what to do, with no apology.
 */
export const NOTE_REFUSAL_WORDS =
  "A won’t-fix needs a note — say why the condition stands, then close it again.";

/** The words for a control that takes a value and was handed an empty field. */
export const VALUE_REFUSAL_WORDS =
  "This action settles the fact with a value — type the one canonical should hold, then save it.";

/**
 * The words for a fact that LINKS a row instead of holding one
 * (admin-window/BUG-0091). `decisionRefusals` invariant 6 names this one, and
 * this form cannot produce it — the close slot offers no cell for a reference
 * fact at all (admin-window/BUG-0087) — so the words exist for the day a
 * caller hands the leaf's identifier here rather than as a branch a control
 * can reach today.
 */
export const REFERENCE_REFUSAL_WORDS =
  "This fact points at another record, so it is chosen rather than typed — pick the record it should point at.";

/**
 * The words for a link control that was submitted with nothing chosen
 * (campaign admin-window/TASK-0056).
 *
 * Its own sentence rather than `REFERENCE_REFUSAL_WORDS` above, which answers a
 * different question: that one explains why there is no field to TYPE in, this
 * one says the picker was left empty. Name what failed, then what to do, with
 * no apology (LOOK_AND_FEEL copy bar 3).
 */
export const REF_REFUSAL_WORDS =
  "Nothing is chosen yet — pick the record this fact should point at, then link it.";

/**
 * The refusal an identifier reads as. The map is TOTAL over the identifiers
 * this form produces, so no raw identifier reaches operator copy through the
 * fallback (LESSONS 5).
 */
export function refusalWords(refusal: string): string {
  if (refusal === "note_required") return NOTE_REFUSAL_WORDS;
  if (refusal === "value_required") return VALUE_REFUSAL_WORDS;
  if (refusal === "ref_required") return REF_REFUSAL_WORDS;
  if (refusal === "reference_field_not_scalar") return REFERENCE_REFUSAL_WORDS;
  return `The close was refused: ${refusal}.`;
}

/**
 * Whether the note is required by any action on offer, for the field's own
 * hint.
 *
 * A note is at the admin's discretion everywhere except `wont_fix` (spec §7),
 * so the hint is a function of the list rather than a sentence written twice.
 */
export function noteIsRequiredBy(actions: readonly ActionSpec[]): boolean {
  return actions.some((spec) => noteRequired(spec.action));
}

/** What `submitSettlement` calls: `globalThis.fetch`, or a stub in a test. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

/** What happened to one settlement attempt. */
export type SettleOutcome =
  /** It landed. `action` is what settled it, for the state that replaces the controls. */
  | { ok: true; action: VerdictAction }
  /**
   * It did not. `message` is what the operator reads — the route's own words
   * where the route answered, the form's where the form refused before
   * sending, and `missing` names the absent object where the answer was that
   * one (ARCHITECTURE.md §9.2: the same card, drawn after the click).
   */
  | { ok: false; message: string; missing?: string };

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Settle this item with this control, through the ONE route.
 *
 * The local refusal happens FIRST and sends nothing: a `wont_fix` with a blank
 * note — and a value-supplying control with an empty field — never reaches the
 * network, which is what makes "the form refuses it too" a fact about
 * behaviour rather than about a disabled attribute.
 *
 * Pure over its `fetchImpl` parameter, so the offline suite drives every
 * branch with no network and no jsdom (STACK §4).
 */
export async function submitSettlement({
  reviewItemId,
  spec,
  note,
  supplied = null,
  fetchImpl,
}: {
  reviewItemId: string;
  spec: ActionSpec;
  note: string;
  /**
   * The value the operator typed, on a control that `supplies` one; null
   * everywhere else, and null from a control that supplies one and was left
   * empty — which the local refusal below turns away without sending.
   */
  supplied?: string | null;
  fetchImpl: FetchLike;
}): Promise<SettleOutcome> {
  const refusal = closeRefusal(spec, note, supplied);
  if (refusal !== null) return { ok: false, message: refusalWords(refusal) };

  let response: Response;
  try {
    response = await fetchImpl(settlePath(reviewItemId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settleBody(spec, note, supplied)),
    });
  } catch (thrown) {
    return { ok: false, message: messageOf(thrown) };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const payload = (typeof body === "object" && body !== null ? body : {}) as {
    error?: unknown;
    missing?: unknown;
  };

  if (!response.ok) {
    const stated = typeof payload.error === "string" ? payload.error : "";
    return {
      ok: false,
      // A refusal with no readable body still names something to act on, so
      // the status stands in rather than a blank line.
      message: stated !== "" ? stated : `the settlement was refused (${response.status})`,
      ...(typeof payload.missing === "string" ? { missing: payload.missing } : {}),
    };
  }
  return { ok: true, action: spec.action };
}
