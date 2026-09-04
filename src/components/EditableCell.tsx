"use client";

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { orDash } from "@/lib/format";
import { cx } from "@/components/ui/cx";

/**
 * The click-to-edit cell, brought onto the tokens (campaign admin-window,
 * TASK-0004; it survives from the deprecated app and re-earns its place).
 *
 * Click a value, it becomes an input with a 1px accent border; Enter or blur
 * saves, Escape reverts. Confirmation is a green `data` word beside the field
 * for 1.5s; failure is a red `data` line that names the failure, and the field
 * reverts to its old value.
 *
 * It knows nothing about routes or tables: `onSave` is the caller's, and
 * returns what happened rather than throwing. The display is a real button, so
 * editing is reachable by Tab and never only on hover (quality bar 9) — and an
 * edit the operator ends with Enter or Escape puts focus back on that button,
 * so the next Tab continues from this field (`focusVerdict`).
 */
export type SaveOutcome =
  /** Saved. `value` is what the caller actually stored, if it normalised it. */
  | { ok: true; value?: string | null }
  /** Refused. `message` names the failure, in the words the caller was given. */
  | { ok: false; message: string };

const CONFIRMATION_MS = 1500;

/** What this cell's own edit is doing, or what it did. */
export type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

/**
 * The status on screen, and WHICH edit put it there — campaign
 * admin-window/BUG-0075.
 *
 * `edit` is the ordinal of the edit that produced `status`: the cell hands out
 * a new one every time the operator opens it. Carrying it in the state is the
 * whole fix. Before, the confirmation's 1.5s clock was a bare `setTimeout`
 * over a ref cleared in exactly one place (the next successful save), so a
 * clock armed by edit 1 later reset edit 2's status to idle — measured on a
 * production build 2026-09-03: a second edit's in-flight statement vanished
 * 163ms before its own PATCH answered and the button re-enabled under a write
 * still running, and a 403's refusal was readable for 1374ms and then erased
 * itself.
 */
export type EditState = {
  readonly status: Status;
  readonly edit: number;
};

/** Nothing edited yet: no status, and no edit owns one. */
export const IDLE_EDIT_STATE: EditState = { status: { kind: "idle" }, edit: 0 };

/**
 * What happens to a cell. Every event names the edit it belongs to, because
 * "which edit is this about" is precisely what the defect could not answer.
 */
export type EditEvent =
  /** The operator opened the cell; `edit` is the ordinal handed to this visit. */
  | { kind: "editing"; edit: number }
  /** That edit was committed and its write is in flight. */
  | { kind: "committed"; edit: number }
  /** That edit's write answered. */
  | { kind: "settled"; edit: number; outcome: SaveOutcome }
  /** The confirmation clock ARMED BY `edit` fired. */
  | { kind: "elapsed"; edit: number };

/**
 * How long a status stays on screen on its own clock, or `null` if no clock
 * ever retires it.
 *
 * Only a confirmation is on a clock. A refusal is not: it stands until the
 * operator does something about it — reopening the cell is what clears it —
 * and an in-flight statement stands until its own write answers. Exported as a
 * rule rather than buried in `commit()` so the offline suite can drive it
 * (tests/offline is environment node with `renderToStaticMarkup` and no jsdom,
 * STACK.md §4), and so the component ARMS the clock as a function of the
 * state it is in rather than at one call site the other paths forget to clear.
 */
export function confirmationDelayMs(status: Status): number | null {
  return status.kind === "saved" ? CONFIRMATION_MS : null;
}

/**
 * The one rule: a status is only ever replaced or retired by the edit that
 * produced it, or by a later one.
 *
 * Pure and total over (state, event) — a stale event returns the state
 * unchanged BY REFERENCE, which is also what makes `useReducer` bail out and
 * leave a running confirmation clock alone.
 *
 *  - `elapsed` retires a confirmation only if that same edit's save armed it.
 *    An earlier save's clock reaching a later edit's in-flight statement or
 *    refusal is the bug, and it is a no-op here.
 *  - `settled` answers only the edit still on screen; an answer to a
 *    superseded write does not overwrite a newer statement.
 *  - `editing` clears what the operator has now acted on, but never speaks
 *    over a write still in flight.
 */
export function reduceEdit(state: EditState, event: EditEvent): EditState {
  switch (event.kind) {
    case "editing":
      // Opening the cell acknowledges the last confirmation or refusal. A
      // write still in flight keeps its statement: it is still in flight.
      if (state.status.kind === "saving") return state;
      if (event.edit < state.edit) return state;
      return { status: { kind: "idle" }, edit: event.edit };
    case "committed":
      if (event.edit < state.edit) return state;
      return { status: { kind: "saving" }, edit: event.edit };
    case "settled":
      if (event.edit !== state.edit) return state;
      return {
        status: event.outcome.ok
          ? { kind: "saved" }
          : { kind: "failed", message: event.outcome.message },
        edit: event.edit,
      };
    case "elapsed":
      // The clock belongs to the confirmation that armed it, and to nothing
      // else on screen.
      if (event.edit !== state.edit || state.status.kind !== "saved") return state;
      return { status: { kind: "idle" }, edit: event.edit };
    default:
      return state;
  }
}

/**
 * What the operator is told, in edit mode, about how this edit ends —
 * campaign admin-window/BUG-0060.
 *
 * The cell used to be one bare input and nothing else: no control, no hint,
 * no `aria-describedby`, and entering edit mode added ZERO text to the page
 * (measured by the verifier 2026-09-03 and again on this branch). Every key
 * that ends an edit was undocumented, so the only commit path M1 ships was
 * discoverable by guessing.
 *
 * It is a HINT rather than a Save button on purpose. The Look pins this
 * widget's mechanism — "click a value, it becomes an input with a 1px accent
 * border; Enter or blur saves, Escape reverts" — and a Save button inside the
 * cell would be a control you cannot click without first blurring the input,
 * i.e. a second commit path racing the one that already fired. Naming the
 * three keys costs no new mechanism and no new failure mode.
 *
 * **It states what LEAVING the field does, which is the half an operator
 * cannot guess.** Blur commits (measured on this branch: PATCH 200, value
 * survives a reload), so clicking away is a save and not a discard — and a
 * surface that saves on blur without saying so is exactly as surprising as one
 * that discards on blur without saying so.
 *
 * The multiline wording is not decoration: in a textarea Enter inserts a line
 * (`onKeyDown` below), so a single sentence claiming "Enter saves" would be
 * false on half this component's renderings.
 */
export function editHint(multiline: boolean): string {
  return multiline
    ? "Leaving the field saves. Enter adds a line. Escape cancels the edit."
    : "Enter or leaving the field saves. Escape cancels the edit.";
}

/**
 * How the edit ENDED — the fact that decides whether focus comes back —
 * campaign admin-window/BUG-0069.
 *
 * Two of the three ways out leave focus nowhere: `commit()` and Escape both
 * unmount the input the operator was typing in, and nothing was told to catch
 * what it dropped. The third — leaving the field — is the operator's own move,
 * and is exactly the case where pulling focus back would be the worse bug.
 */
export type EditEnding =
  /** Enter committed it (single-line). The operator did not move focus. */
  | "committed"
  /** Escape reverted it. The operator did not move focus either. */
  | "cancelled"
  /** The operator left the field — clicked or tabbed elsewhere on purpose. */
  | "left";

/** What to do about focus right now. */
export type FocusVerdict =
  /** Not yet: the field still holds it, or the button cannot take it yet. */
  | "wait"
  /** Put it on this cell's resting control. */
  | "return"
  /** Nothing to do — it is where it should be, or where the operator put it. */
  | "leave";

/**
 * Where focus belongs once an edit ends — campaign admin-window/BUG-0069.
 *
 * Measured by QA on the BUG-0060 pass (2026-09-03, production build against
 * staging): committing with Enter left `document.activeElement` as `<body>`,
 * so the operator's next Tab restarted at the top of the document — the whole
 * nav and every field above — instead of continuing to the next field.
 * `autoFocus` covered the way IN and nothing covered the way out. Escape is
 * the same seam.
 *
 * Two orderings in here are the whole of the fix, and both are why this is a
 * rule rather than a `.focus()` at the end of `commit()`:
 *
 *  - **`saving` waits.** The resting button is `disabled` while the write is
 *    in flight, and a disabled button cannot take focus — focusing it there is
 *    a no-op that silently leaves focus on `<body>` anyway. The verdict is
 *    taken again when the write settles and the control is real.
 *  - **`left`, and anything the operator has since focused, is left alone.**
 *    Blur commits, so clicking a link or tabbing to the next field ends the
 *    edit too; that operator went somewhere on purpose. `focusIsAdrift` is the
 *    caller's reading of `document.activeElement` — true only when focus is on
 *    nothing (the body, the document, or this cell's own button) — so even a
 *    seconds-long write that the operator walks away from mid-flight cannot
 *    have its focus yanked back when the answer arrives.
 *
 * Pure and exported because focus is a browser fact the offline tier cannot
 * see (`tests/offline` is environment node with `renderToStaticMarkup` and no
 * jsdom, STACK.md §4): the decision is pinned here, and the focus itself is
 * measured in a browser walk exactly as its absence was.
 */
export function focusVerdict({
  editing,
  ending,
  status,
  focusIsAdrift,
}: {
  /** Is the cell still in edit mode? Then the field itself holds focus. */
  editing: boolean;
  /** How the last edit ended, or `null` if none has since focus was settled. */
  ending: EditEnding | null;
  /** What this cell's edit is doing, or did. */
  status: Status;
  /** Is focus on nothing the operator chose? Read from `document`. */
  focusIsAdrift: boolean;
}): FocusVerdict {
  if (editing) return "wait";
  if (ending === null || ending === "left") return "leave";
  if (status.kind === "saving") return "wait";
  return focusIsAdrift ? "return" : "leave";
}

/**
 * Is focus on nothing in particular — so that returning it takes it from
 * nobody? The browser half of `focusVerdict`, kept to one expression.
 *
 * The button itself counts as adrift: focusing what is already focused is a
 * no-op, and it keeps the resting state of a re-entered cell from reading as
 * "the operator moved".
 */
function focusIsAdrift(button: HTMLButtonElement | null): boolean {
  const owner = button?.ownerDocument;
  if (!owner) return false;
  const active = owner.activeElement;
  return (
    active === null ||
    active === owner.body ||
    active === owner.documentElement ||
    active === button
  );
}

/**
 * The line beside the field: what this edit is doing, or what it did —
 * campaign admin-window/BUG-0066.
 *
 * Pure over `Status` and exported for the same reason `EditField` below is:
 * `saving` is React state a click produces, and the offline suite renders with
 * `renderToStaticMarkup` and no jsdom (STACK.md §4), so a status rendered only
 * from inside `EditableCell` is a status no offline test can reach. Rendering
 * every kind through ONE unit is also what keeps them comparable: the
 * in-flight state and the confirmation are the same element in the same slot,
 * so an operator (and a screen reader) is told which of the two this is.
 *
 * Before this, `saving` rendered nothing at all: from commit until the PATCH
 * answered, the cell showed the new value in a disabled button and stated no
 * work, so a write in flight and a write that had landed differed only by 50%
 * opacity. On a remote database that window is seconds long, and a verifier
 * who reloaded inside it read the pre-write value and filed a data-loss bug
 * that was not one (measured 2026-09-03: a 2.087s write, nothing on the page
 * matching /settl|saving|writing/, zero live regions).
 *
 * `saving` and `saved` announce politely (`role="status"`, as the confirmation
 * already did); a refusal interrupts (`role="alert"`). The word never lands on
 * the button itself — the Look's button rule says a disabled control's label
 * does not change, so the statement of work stands beside the field.
 */
export function EditStatus({ status }: { status: Status }) {
  switch (status.kind) {
    case "saving":
      return (
        <span className="type-data text-ink-secondary" role="status">
          saving…
        </span>
      );
    case "saved":
      return (
        <span className="type-data text-healthy" role="status">
          saved
        </span>
      );
    case "failed":
      return (
        <span className="type-data text-broken" role="alert">
          {status.message}
        </span>
      );
    default:
      return null;
  }
}

const FIELD_CLASS =
  "type-data w-full rounded-control border border-accent bg-surface px-1 py-0.5 text-ink";

/**
 * The cell in edit mode: the field, and the line that says how the edit ends.
 *
 * Pure over its props and exported so the offline suite can render edit mode
 * at all — `EditableCell` reaches this state only from a click, which
 * `renderToStaticMarkup` cannot produce, so the state that carries the hint
 * would otherwise be provable only in a browser.
 *
 * The hint is wired with `aria-describedby`, not merely placed nearby: a
 * screen-reader operator lands on the input and must hear how to commit
 * without hunting for a sibling span.
 */
export function EditField({
  value,
  label,
  hintId,
  multiline = false,
  onChange,
  onBlur,
  onKeyDown,
}: {
  value: string;
  /** The field's accessible name: "short_name of groups". */
  label: string;
  /** The id of the hint this field is described by. Unique per cell. */
  hintId: string;
  multiline?: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const shared = {
    autoFocus: true,
    "aria-label": label,
    "aria-describedby": hintId,
    value,
    onChange,
    onBlur,
    onKeyDown,
    className: FIELD_CLASS,
  };
  return (
    <>
      {multiline ? <textarea rows={4} {...shared} /> : <input {...shared} />}
      <span id={hintId} className="type-data text-ink-secondary">
        {editHint(multiline)}
      </span>
    </>
  );
}

export function EditableCell({
  value,
  onSave,
  label,
  multiline = false,
}: {
  value: string | null;
  /** Persist the new value. Returns the outcome; an empty field saves null. */
  onSave: (next: string | null) => Promise<SaveOutcome>;
  /** Which field this is, for the accessible name: "spotify_id of BLACKPINK". */
  label: string;
  multiline?: boolean;
}) {
  const [shown, setShown] = useState<string | null>(value);
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const [cell, dispatch] = useReducer(reduceEdit, IDLE_EDIT_STATE);
  const reverting = useRef(false);
  /** Ordinals handed out one per visit to edit mode; see `EditState.edit`. */
  const edits = useRef(0);
  /** The resting control focus is returned to; see `focusVerdict`. */
  const button = useRef<HTMLButtonElement>(null);
  /** How the edit on screen ended, until focus has been dealt with. */
  const ending = useRef<EditEnding | null>(null);
  const hintId = useId();
  const status = cell.status;

  /**
   * The confirmation's clock, armed FROM the state it belongs to.
   *
   * This is why the defect cannot come back at a call site: there is no ref to
   * forget to clear. React tears the timeout down whenever the state changes
   * (and on unmount), and the one it arms carries the ordinal of the edit whose
   * confirmation is on screen — so a clock outliving its own status is both
   * cleared here and ignored by `reduceEdit`.
   */
  useEffect(() => {
    const delay = confirmationDelayMs(cell.status);
    if (delay === null) return;
    const edit = cell.edit;
    const timer = setTimeout(() => dispatch({ kind: "elapsed", edit }), delay);
    return () => clearTimeout(timer);
  }, [cell]);

  /**
   * Focus, returned to the cell the operator was in — campaign
   * admin-window/BUG-0069.
   *
   * Sequenced against the settled state rather than fired from `commit()`,
   * because the control it aims at is `disabled` for the whole of the write:
   * this runs again on every status change, so the commit path's return lands
   * the moment the button can hold it, and Escape's lands at once.
   */
  useEffect(() => {
    const verdict = focusVerdict({
      editing,
      ending: ending.current,
      status: cell.status,
      focusIsAdrift: focusIsAdrift(button.current),
    });
    if (verdict === "wait") return;
    // Decided: this ending is spent either way, so a later status change
    // cannot re-fire it at whatever the operator has focused by then.
    ending.current = null;
    if (verdict === "return") button.current?.focus();
  }, [editing, cell]);

  async function commit() {
    if (reverting.current) return;
    setEditing(false);

    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === shown) return; // nothing changed; no call, no confirmation

    const edit = edits.current;
    const previous = shown;
    setShown(next);
    dispatch({ kind: "committed", edit });

    let outcome: SaveOutcome;
    try {
      outcome = await onSave(next);
    } catch (error) {
      outcome = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.ok) {
      // The caller may have normalised what it stored; show that, not the draft.
      if (outcome.value !== undefined) {
        setShown(outcome.value);
        setDraft(outcome.value ?? "");
      }
    } else {
      setShown(previous);
      setDraft(previous ?? "");
    }
    dispatch({ kind: "settled", edit, outcome });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // In multiline mode Enter inserts a newline; that edit saves on blur.
    if (event.key === "Enter" && !multiline) {
      event.preventDefault();
      ending.current = "committed";
      void commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      ending.current = "cancelled";
      reverting.current = true;
      setDraft(shown ?? "");
      setEditing(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      {editing ? (
        <EditField
          value={draft}
          label={label}
          hintId={hintId}
          multiline={multiline}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            // Leaving the field is the operator's own move; the edit still
            // saves, but focus stays where they put it.
            if (ending.current === null) ending.current = "left";
            void commit();
          }}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          ref={button}
          type="button"
          aria-label={label}
          disabled={status.kind === "saving"}
          onClick={() => {
            reverting.current = false;
            edits.current += 1;
            dispatch({ kind: "editing", edit: edits.current });
            setEditing(true);
          }}
          className={cx(
            "type-data cursor-text rounded-control px-1 py-0.5 text-left text-ink transition-colors hover:bg-chrome",
            status.kind === "saving" && "cursor-not-allowed opacity-50",
          )}
        >
          {orDash(shown)}
        </button>
      )}
      <EditStatus status={status} />
    </span>
  );
}
