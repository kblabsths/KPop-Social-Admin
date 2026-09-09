import type { ButtonVariant } from "@/components/ui";
import type { EvidenceRow } from "@/components/review";
import type { ReviewItemRow } from "@/lib/review/shapes";
import {
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
   */
  readonly variant?: ButtonVariant;
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

/** The body for this control and this note; a blank note is null, not `""`. */
export function settleBody(spec: ActionSpec, note: string): SettleRequestBody {
  const trimmed = note.trim();
  return {
    action: spec.action,
    note: trimmed === "" ? null : trimmed,
    value: spec.value,
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
export function closeRefusal(spec: ActionSpec, note: string): string | null {
  return noteRequired(spec.action) && note.trim() === "" ? "note_required" : null;
}

/**
 * What the operator reads when the form refuses — LOOK_AND_FEEL copy bar 3:
 * name what failed, then what to do, with no apology.
 */
export const NOTE_REFUSAL_WORDS =
  "A won’t-fix needs a note — say why the condition stands, then close it again.";

/** The refusal an identifier reads as. One identifier today; the map is total. */
export function refusalWords(refusal: string): string {
  return refusal === "note_required"
    ? NOTE_REFUSAL_WORDS
    : `The close was refused: ${refusal}.`;
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
 * note never reaches the network, which is what makes "the form refuses it
 * too" a fact about behaviour rather than about a disabled attribute.
 *
 * Pure over its `fetchImpl` parameter, so the offline suite drives every
 * branch with no network and no jsdom (STACK §4).
 */
export async function submitSettlement({
  reviewItemId,
  spec,
  note,
  fetchImpl,
}: {
  reviewItemId: string;
  spec: ActionSpec;
  note: string;
  fetchImpl: FetchLike;
}): Promise<SettleOutcome> {
  const refusal = closeRefusal(spec, note);
  if (refusal !== null) return { ok: false, message: refusalWords(refusal) };

  let response: Response;
  try {
    response = await fetchImpl(settlePath(reviewItemId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settleBody(spec, note)),
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
