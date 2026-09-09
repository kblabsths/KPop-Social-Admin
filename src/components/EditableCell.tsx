"use client";

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";
import { orDash } from "@/lib/format";
import { hasVisibleContent } from "@/lib/verdict/decision";
import { cx } from "@/components/ui/cx";
import { refusalFix } from "@/components/edit-refusal";
import {
  type HintSide,
  type StatusGrowth,
  cellLayout,
  statusShift,
} from "@/components/edit-cell-layout";

/**
 * The click-to-edit cell, brought onto the tokens (campaign admin-window,
 * TASK-0004; it survives from the deprecated app and re-earns its place).
 *
 * Click a value, it becomes an input with a 1px accent border; Enter or blur
 * saves, Escape reverts. Confirmation is a green `data` word beside the field
 * for 1.5s; failure is a red `data` line that names the failure, and the field
 * reverts to its old value.
 *
 * Two affordances the M1 user-sim walks earned (campaign
 * admin-window/TASK-0053): the value carries a 1px hairline underline AT REST
 * so it reads as editable before anything touches it (`RESTING_AFFORDANCE`),
 * and opening it selects what is there so a straight retype replaces
 * (`selectOnOpen`). Both are the control's, so every regime with a write path
 * gets them from one place.
 *
 * **The cell changes no other row's layout, in any state** (campaign
 * admin-window/BUG-0086): the resting value keeps its box while the cell is
 * open, and the field, its hint AND the line stating the write (`EditStatus`)
 * are all drawn over the top of it, out of the flow (`cellLayout`). Before,
 * opening one cell moved every other editable value on the record; after the
 * first cut, the 46x16 `saving…` line still did it during the commit window,
 * which is precisely when the operator's next click is in the air.
 *
 * **And a pointer opens it at the PRESS, not at the release** (`opensCell`,
 * the same ticket's third cut): committing the open cell puts the operator's
 * own longer value into the resting button, and an auto-layout table
 * re-apportions on that alone — a reflow no layout rule of this cell's can
 * remove. Opening at `pointerdown` makes the reflow harmless, because there is
 * nothing left in the air to swallow.
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
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * The status box is measured and corrected BEFORE the frame it appears in is
 * painted (`fitStatusInsideClip`), which is what `useLayoutEffect` is for — but
 * this is a `"use client"` module that Next still renders on the server, and
 * React warns there that a layout effect does nothing. Neither effect runs
 * during `renderToStaticMarkup` at all, so the choice is made once per
 * environment at module scope, never per render: the hook React actually calls
 * is the same one on every render of a given process, and the rules of hooks
 * hold.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The content edges of the nearest ancestor that CLIPS `el` vertically, or
 * `null` if nothing between it and the document does.
 *
 * Found by asking the boxes themselves rather than by naming a component:
 * `DataTable`'s wrapper is the one that clips the record surface
 * (`overflow-x-auto`, whose other axis computes to `auto`), but the cell is
 * shared and a caller may put it inside any scroller — including one added
 * later by a ticket that never reads this file.
 *
 * The edges are the PADDING box, not the border box: that is the edge overflow
 * clips at, and `clientHeight` already excludes a horizontal scrollbar, so a
 * table wide enough to show one (admin-window/BUG-0042) reports the room a
 * reader actually has.
 */
function clippingBounds(el: HTMLElement): { top: number; bottom: number } | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    // Anything but `visible` clips: `auto`, `scroll`, `hidden`, `clip`.
    if (getComputedStyle(node).overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    const top = rect.top + node.clientTop;
    return { top, bottom: top + node.clientHeight };
  }
  return null;
}

/**
 * Move the status box, if it needs it, so that all of it is inside the
 * container that clips it — campaign admin-window/BUG-0104.
 *
 * The decision is `statusShift`'s and is pinned offline; this is the browser
 * half, which is not observable in a tier with no jsdom (STACK.md §4). Three
 * things about how it applies the answer are load-bearing:
 *
 *  - **It measures the box UNCORRECTED.** The transform is cleared before the
 *    rect is read, so a second run answers about where the box really wants to
 *    be rather than about where the first run put it.
 *  - **It corrects with a transform.** Nothing in the flow moves, so the whole
 *    of BUG-0086 — no part of this cell may move another row's control — is
 *    untouched by the fix, and the box stays as inert to the pointer as it was.
 *  - **A box that already fits is not touched at all** (`statusShift` answers
 *    `0`), so every refusal QA measured inside the container is drawn at the
 *    pixel it was measured at.
 */
function fitStatusInsideClip(el: HTMLElement | null): void {
  if (el === null) return;
  el.style.transform = "";
  const clip = clippingBounds(el);
  if (clip === null) return;
  const rect = el.getBoundingClientRect();
  const shift = statusShift({
    boxTop: rect.top,
    boxBottom: rect.bottom,
    clipTop: clip.top,
    clipBottom: clip.bottom,
  });
  if (shift !== 0) el.style.transform = `translateY(${shift}px)`;
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
 *
 * **A refusal is TWO halves, like every read error in this app** (campaign
 * admin-window/BUG-0098): the database's own words verbatim in mono, and one
 * sentence in the app's voice naming what to do — `error-line.tsx`'s `failed`
 * and `retry`, at the field. The second half is DERIVED from the first
 * (`refusalFix`, `components/edit-refusal.ts`) and never written here, so a
 * refusal this cell has never rendered still carries a fix and no call site
 * can ship one without it. Both halves are inside the one `role="alert"`, so
 * what a screen reader is interrupted with is what the screen says.
 *
 * **It stands beside the value without taking space beside it** (`STATUS_BOX`,
 * campaign admin-window/BUG-0086): it is drawn where it always appeared, one
 * step to the right of the resting value, but out of the row's flow, because
 * it appears and vanishes on its own clock while the cell is closed — 46x16
 * plus the container's 8px gap was enough to re-apportion the table's columns
 * inside a single mousedown→mouseup and swallow the operator's next click.
 * Being out of the flow, it hangs over whatever is beside it, so it is opaque
 * (`bg-surface`) to stay readable and inert to the pointer so a click aimed at
 * what it covers reaches that thing.
 *
 * **And it grows towards the rows rather than past the table's edge**
 * (`statusGrowth`, campaign admin-window/BUG-0101): out of the flow means the
 * box hangs over a NEIGHBOUR, and the last line of a record has no neighbour
 * below it — only `DataTable`'s clipping container. Told `up`, the box hangs
 * from the row's bottom edge and extends over the lines above instead. The
 * caller decides, because the caller is what knows the order.
 *
 * **And then it is MEASURED against the container, because no ordinal rule can
 * be** (`statusShift`, campaign admin-window/BUG-0104). A box overflows because
 * it is taller than the room below its own row, and its height is the
 * database's sentence: QA measured the same refusal drawn 61px outside the
 * container on the SECOND-to-last field, which `statusGrowth` correctly tells
 * `down`. So the anchor decides the direction and a measured correction — `0`
 * for every box that already fits — decides how far the box must move to be
 * read in full. It is applied as a transform, so nothing in any row's flow
 * moves and BUG-0086 is paid nothing for it.
 *
 * It is positioned against the cell's own `relative` box, so it renders inside
 * `EditableCell` and nowhere else.
 */
export function EditStatus({
  status,
  growth = "down",
}: {
  status: Status;
  /**
   * Which edge of the row the box hangs from, from `statusGrowth` — the
   * surface knows where this line sits among its neighbours and the cell does
   * not (campaign admin-window/BUG-0101). Omitted, it grows down, which is
   * what every line but a record's last one does.
   */
  growth?: StatusGrowth;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const message = status.kind === "failed" ? status.message : null;

  /**
   * ...and then it is moved, if it must be, to where all of it is readable —
   * campaign admin-window/BUG-0104.
   *
   * The anchor above is ordinal and the box's height is the database's
   * sentence, so an anchor alone cannot know whether this box clears the
   * container: on the second-to-last of six fields the 23502 refusal is 120px
   * tall with 62px of room below its own row, and it was drawn 61px outside.
   * The correction is measured, not derived (`fitStatusInsideClip`), and it is
   * `0` for every box that already fits.
   *
   * The dependencies are the three things that change the box's geometry: what
   * kind of status it is, the words a refusal carries (the height IS those
   * words), and which edge it hangs from. A window resize moves the container
   * under a refusal that is already on screen — a refusal stands until the
   * operator reopens the cell, so that is a real state and not a transient one.
   */
  useIsomorphicLayoutEffect(() => {
    const refit = () => fitStatusInsideClip(boxRef.current);
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [status.kind, message, growth]);

  // `top-0`: the box's top edge on the row's, extending downward over the
  // lines below. `bottom-0`: its bottom edge on the row's, extending upward
  // over the lines above — the last line's answer, because what is below it is
  // not a line but the table's own clipping container.
  const box = cx(STATUS_BOX, growth === "up" ? "bottom-0" : "top-0");
  switch (status.kind) {
    case "saving":
      return (
        <span ref={boxRef} className={cx(box, "type-data text-ink-secondary")} role="status">
          saving…
        </span>
      );
    case "saved":
      return (
        <span ref={boxRef} className={cx(box, "type-data text-healthy")} role="status">
          saved
        </span>
      );
    case "failed":
      return (
        // Both halves at the field, the anatomy `ui/error-line.tsx` already
        // ships for every READ (campaign admin-window/BUG-0098): the
        // database's own refusal verbatim in mono, then one sentence in the
        // app's voice naming what to do. The two faces are on the two spans
        // and never stacked on one element — `type-data` and `type-body` are
        // utilities of equal specificity, so which one won would be decided by
        // the order Tailwind emitted them in (`app/globals.css`).
        <span
          ref={boxRef}
          className={cx(box, "flex flex-col gap-0.5 text-broken")}
          role="alert"
        >
          <span className="type-data">{status.message}</span>
          <span className="type-body">{refusalFix(status.message)}</span>
        </span>
      );
    default:
      return null;
  }
}

/**
 * What makes an editable value LOOK editable before anything touches it —
 * campaign admin-window/TASK-0053, LOOK_AND_FEEL "Inputs and inline edit".
 *
 * A 1px hairline underline under the value, in the RESTING state: no hover,
 * no focus, no click. A stranger walking M1 found the edit affordance by
 * tabbing rather than by looking, and said a mouse-first colleague would read
 * the whole page as read-only — a control nobody can see is a control nobody
 * uses.
 *
 * Three choices in it, each forced by the Look rather than picked:
 *
 *  - **Underline, not colour and not weight.** Colour is reserved for state
 *    (the palette's five jobs) and weight belongs to the type scale, so
 *    neither is free to mean "editable".
 *  - **Hairline, not accent.** This app draws a link at rest as accent ink
 *    plus an underline (`text-accent underline`, `components/cycles/links.ts`),
 *    so an accent underline here would be the app already saying "this goes
 *    somewhere". The hairline token — every border and divider in the app —
 *    is the quiet rule that says "this is a field".
 *  - **The token, never a value.** `decoration-hairline` resolves through
 *    `--color-hairline` and flips itself between themes, so there is no
 *    `dark:` variant to keep in step and no hex to drift from the palette.
 *
 * It rides on the resting BUTTON, which is the whole value including the em
 * dash an absent value renders as: an empty column is exactly the one an
 * operator most needs to know they may fill in.
 */
const RESTING_AFFORDANCE = "underline decoration-hairline decoration-1 underline-offset-2";

/**
 * The edit-mode subtree's box: over the resting value, out of the row's flow
 * (`cellLayout`, campaign admin-window/BUG-0086).
 *
 * `min-w-full` so the editor is never narrower than the value it replaces, and
 * `w-max` so a cell resting on one character still opens a field an operator
 * can type into. Neither width can move anything: a box taken out of the flow
 * contributes nothing to the flow it was taken out of.
 *
 * It is inert to the pointer as a whole and the FIELD alone takes that back
 * (`pointer-events-auto` below), so the only part of this layer a click can
 * land on is the part an operator means to click.
 */
const FLOAT_BOX =
  "pointer-events-none absolute top-0 left-0 z-10 block w-max min-w-full";

/**
 * The hint's own box — out of the flow, and INERT to the pointer.
 *
 * It hangs over a neighbouring row, and on this surface that row carries
 * another editable value, so a click aimed at that value has to pass straight
 * through the hint. That is hit-testing and not merely painting: the defect
 * being fixed is a click that reached the wrong element.
 *
 * Opaque, in the table's own fill, with a hairline border and the control
 * radius, so it reads as one floating line rather than as two rows of text
 * printed over each other. No shadow and no colour of its own — it is the same
 * secondary `data` line it was when it sat in the flow.
 */
const HINT_BOX =
  "type-data pointer-events-none absolute left-0 w-max rounded-control border border-hairline bg-surface px-1 py-0.5 text-ink-secondary";

const FIELD_CLASS =
  "type-data pointer-events-auto block w-full rounded-control border border-accent bg-surface px-1 py-0.5 text-ink";

/**
 * The status line's own box: one `gap-2` step to the right of the resting
 * value, and out of the row's flow (`cellLayout(...).status`, campaign
 * admin-window/BUG-0086).
 *
 * `left-full ml-2` reproduces the flex gap it used to sit after, so nothing an
 * operator sees moves; `absolute` is what takes it out of the flow, which is
 * the whole of BUG-0086's fix here. `w-max` keeps `saving…` on one line and
 * `max-w-xs` wraps a long refusal into a panel instead of a line running off
 * the table — a refusal is the database's own sentence and can be a hundred
 * characters. `bg-surface` because it now hangs over whatever is beside the
 * value, and `pointer-events-none` because that thing may be another editable
 * value and this line is not a control.
 *
 * **It carries no VERTICAL anchor** (campaign admin-window/BUG-0101). It used
 * to hold `top-0` and therefore always grew downward, past the fields table's
 * `overflow-x-auto` container on the last line of a record — QA measured the
 * app-voice half of a refusal painted nowhere at all, 28px below the
 * container's edge. Which edge the box hangs from is `statusGrowth`'s answer,
 * added by `EditStatus` below, exactly as the hint's side is `hintSide`'s.
 *
 * It carries no TYPE utility, and that is deliberate since the refusal grew
 * its second half (admin-window/BUG-0098): `type-data` and `type-body` are
 * `@utility` rules of equal specificity (`app/globals.css`), so an element
 * carrying the box's face AND a child's would resolve by the order Tailwind
 * emitted the two, not by the order they were written. Each arm of
 * `EditStatus` puts the face on the element whose words it describes.
 */
const STATUS_BOX =
  "pointer-events-none absolute left-full z-10 ml-2 w-max max-w-xs rounded-control bg-surface px-1 py-0.5";

/**
 * The field opens with its value SELECTED, so a straight retype replaces it —
 * campaign admin-window/TASK-0053, LOOK_AND_FEEL "Inputs and inline edit".
 *
 * A stranger walking M1 wrote `7OCSOC` over a catalog value because the caret
 * sat at the end of the old one and nothing was selected. Correcting a value
 * is this control's whole job, and a cell that opens unselected is a trap
 * every operator falls into once per field.
 *
 * Three things about how it is done are load-bearing:
 *
 *  - **`select()`, never `setSelectionRange(0, value.length)`.** The DOM's own
 *    "all of it" needs no index arithmetic, so a textarea holding newlines
 *    cannot be selected short or long by a length this code computed — and it
 *    reads the field rather than writing it, so no value is touched.
 *  - **A ref callback, and a MODULE-LEVEL one.** React re-invokes a ref
 *    callback whose identity changed on every render; an inline arrow here
 *    would re-select the whole field after every keystroke, which is a worse
 *    bug than the one being fixed. This function is one stable reference, so
 *    React attaches it on mount and detaches it on unmount, and "on open" is
 *    exactly when it runs.
 *  - **It runs AFTER `autoFocus`.** React commits a host node's `autoFocus`
 *    before it attaches that node's ref, so the field already holds focus by
 *    the time the selection is made and nothing re-collapses it to a caret.
 *
 * The selection itself is a browser fact the offline tier cannot see
 * (`tests/offline` is environment node with `renderToStaticMarkup` and no
 * jsdom, STACK.md §4), which is why this is an exported unit rather than an
 * inline handler: offline pins that the field carries it and that it selects
 * without writing, and the walk measures `selectionStart`/`selectionEnd` in a
 * real browser exactly as `focusVerdict`'s focus is measured.
 */
export function selectOnOpen(
  field: HTMLInputElement | HTMLTextAreaElement | null,
): void {
  // Unmount hands back null: there is no field, and nothing to select.
  if (field === null) return;
  field.select();
}

/**
 * A press that might open the cell, described in the three facts that decide
 * it — campaign admin-window/BUG-0086.
 */
export type OpenPress = {
  /**
   * Which handler saw it. A pointer press arrives at `pointerdown`; a keyboard
   * activation (Enter, Space) and an assistive-technology activation arrive
   * only as `click`, with no pointer event before them.
   */
  source: "pointerdown" | "click";
  /** `MouseEvent.button`: 0 is the primary press. A keyboard click reports 0. */
  button: number;
  /**
   * `MouseEvent.detail` — the click count. **A click the browser synthesised
   * from a key, or from `.click()`, reports 0**, and a click that came from a
   * pointer reports 1 or more. That is the whole discriminator.
   */
  detail: number;
  /** Is this cell already open? Then the press is not an opening one. */
  editing: boolean;
  /** Is the resting control disabled — a write of this cell in flight? */
  disabled: boolean;
};

/**
 * Does this press open the cell? — campaign admin-window/BUG-0086, the third
 * cut and the one that kills the class rather than one of its causes.
 *
 * **The defect.** The cell used to open on `click`, which is dispatched at
 * MOUSEUP. Between the operator's mousedown and their mouseup, the record
 * table can re-apportion its columns and carry the button they pressed out
 * from under the pointer — so no `click` is dispatched at that button at all
 * and the press is swallowed. Two cuts removed two causes of that reflow (the
 * open field and its hint, then the transient `saving…` line; both are still
 * fixed, `cellLayout`), and QA found a third that no layout rule can reach:
 * the value ITSELF. Blur commits, so pressing another value commits the open
 * one, its resting button reappears carrying the NEW, longer value, and the
 * auto table layout re-apportions on that. Measured by QA on a production
 * build against staging, 2026-09-09, both themes: with an ordinary 56-character
 * correction in `note` — "Checked against the venue listing; corrected
 * 2026-09-08." — every other value in the column moved 59.48px LEFT inside a
 * 120ms press (34 chars: 0px and the press opens; 71: 86.51px; 122: 138.59px),
 * `elementFromPoint` at the press point became a `<td>` of another row, and
 * nothing opened. The resting value IS the row's box and must be, or nothing
 * holds the row's height, so the reflow is the surface working as designed.
 *
 * **The rule.** A press that lands on the value opens it AT POINTERDOWN, before
 * anything can move. A reflow between down and up cannot swallow a cell that is
 * already open, whatever the operator typed and however wide it made the value.
 *
 * Both halves of the discriminator are load-bearing:
 *
 *  - **`pointerdown` opens, and only for the primary button** (`button === 0`),
 *    so the press that raises a context menu opens nothing.
 *  - **`click` opens only when it came from no pointer at all** (`detail === 0`
 *    — a key or `.click()`). That keeps Enter and Space working on a control
 *    that is a real `<button>`, and it is also the second half of the fix: the
 *    stray `click` that a reflowed press produces lands wherever the pointer
 *    ended up, which may be ANOTHER value's button, and a cell opens with its
 *    whole value selected (`selectOnOpen`), so the next keystroke would replace
 *    the wrong field. QA raised that as the risk this defect carries. A
 *    pointer-borne click never opens anything here, so the risk is closed
 *    rather than made less likely.
 *
 * `editing` and `disabled` are refusals the caller would otherwise repeat at
 * two call sites: a press on a cell already open re-arms its edit ordinal, and
 * a press while this cell's own write is in flight is one the resting control
 * has already refused as `disabled` (a disabled button dispatches no `click`,
 * but pointer events reach it in some browsers).
 *
 * Pure and exported for the reason `focusVerdict` and `selectOnOpen` are:
 * which event opened the cell is a browser fact and `tests/offline` is
 * environment node with `renderToStaticMarkup` and no jsdom (STACK.md §4). The
 * decision is pinned offline; the press itself is measured in a walk.
 */
export function opensCell(press: OpenPress): boolean {
  if (press.editing || press.disabled) return false;
  if (press.button !== 0) return false;
  return press.source === "pointerdown" ? true : press.detail === 0;
}

/**
 * What an edit COMMITS: the draft, or `null` when there is nothing in it to
 * read — campaign admin-window/BUG-0095.
 *
 * Blank is the app's ONE definition of it (`hasVisibleContent`,
 * `lib/verdict/decision.ts`) and not `draft.trim() === ""`. The two disagree
 * on exactly the characters a paste out of a web page or a PDF carries: U+200B
 * ZERO WIDTH SPACE, U+2060 WORD JOINER, U+00AD SOFT HYPHEN, U+FEFF and the
 * hangul fillers are not `White_Space`, so `trim()` kept them and the cell
 * committed them as CONTENT — while `isAbsent` (which asks the same one
 * definition) drew the value as the em dash. The operator emptied a field by
 * pasting an invisible character, was told the save landed, and the column
 * held a character the page then rendered as no value at all; on a `not null`
 * column that faked the clear the database exists to refuse (23502).
 *
 * It is a blankness TEST, never a sanitiser — the same rule `settleBody`
 * (`components/review/close/actions.ts`) follows for a note. A draft with
 * anything visible in it commits as the operator wrote it, trimmed at the ends
 * and otherwise byte-identical: `"\u200bBLACKPINK\u200b"` keeps its zero
 * width spaces, and `"\u2800"` (BRAILLE PATTERN BLANK, an assigned printable
 * character) is content.
 *
 * Exported as a unit because the offline tier renders with
 * `renderToStaticMarkup` and cannot type into a field (STACK.md §4), so the
 * commit path is reachable there only through this seam. The ROUTE asks the
 * same question of every body it is handed, forged or not — the route is the
 * contract, this is the courtesy (admin-window/BUG-0089's thesis).
 */
export function committedValue(draft: string): string | null {
  return hasVisibleContent(draft) ? draft.trim() : null;
}

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
 *
 * The field opens focused (`autoFocus`) and with its value selected
 * (`selectOnOpen` as the ref) — both renderings, input and textarea alike.
 */
export function EditField({
  value,
  label,
  hintId,
  multiline = false,
  side = "below",
  onChange,
  onBlur,
  onKeyDown,
}: {
  value: string;
  /** The field's accessible name: "label of walk_sandbox". */
  label: string;
  /** The id of the hint this field is described by. Unique per cell. */
  hintId: string;
  multiline?: boolean;
  /** Which side the hint hangs on — `hintSide` decides it (BUG-0086). */
  side?: HintSide;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const shared = {
    autoFocus: true,
    // Opening the cell selects what is already there (`selectOnOpen` above).
    // One stable reference for both renderings, so React runs it on mount and
    // never again while the operator types.
    ref: selectOnOpen,
    "aria-label": label,
    "aria-describedby": hintId,
    value,
    onChange,
    onBlur,
    onKeyDown,
    className: FIELD_CLASS,
  };
  return (
    // The whole subtree is the float (`FLOAT_BOX`): opening a cell adds
    // nothing to the row's flow, so no other row's control moves under the
    // pointer that is about to click it (campaign admin-window/BUG-0086).
    <span className={FLOAT_BOX}>
      {multiline ? <textarea rows={4} {...shared} /> : <input {...shared} />}
      <span
        id={hintId}
        className={cx(HINT_BOX, side === "above" ? "bottom-full mb-1" : "top-full mt-1")}
      >
        {editHint(multiline)}
      </span>
    </span>
  );
}

export function EditableCell({
  value,
  onSave,
  label,
  multiline = false,
  hintSide: side = "below",
  statusGrowth: growth = "down",
}: {
  value: string | null;
  /** Persist the new value. Returns the outcome; an empty field saves null. */
  onSave: (next: string | null) => Promise<SaveOutcome>;
  /** Which field this is, for the accessible name: "spotify_id of BLACKPINK". */
  label: string;
  multiline?: boolean;
  /**
   * Which side the open cell's hint hangs on, from `hintSide` — the caller
   * knows where this cell sits among its neighbours and the cell does not
   * (campaign admin-window/BUG-0086). Omitted, it hangs below.
   */
  hintSide?: HintSide;
  /**
   * Which way the status line grows, from `statusGrowth` — the same knowledge
   * and the same reason, for the part that appears while the cell is CLOSED
   * (campaign admin-window/BUG-0101). Omitted, it grows down.
   */
  statusGrowth?: StatusGrowth;
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

    const next = committedValue(draft);
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

  /** Enter edit mode, from whichever press `opensCell` accepted. */
  function open() {
    reverting.current = false;
    edits.current += 1;
    dispatch({ kind: "editing", edit: edits.current });
    setEditing(true);
  }

  const disabled = status.kind === "saving";
  const layout = cellLayout({ editing, statusShown: status.kind !== "idle" });

  return (
    // `relative`: the field, its hint and the status line are all drawn
    // against this box (`FLOAT_BOX`, `STATUS_BOX`), out of the row's flow, so
    // nothing this cell ever does moves another row (campaign
    // admin-window/BUG-0086). The box the row sees is the button's, always.
    <span className="relative inline-flex flex-wrap items-baseline">
      <button
        ref={button}
        type="button"
        aria-label={label}
        disabled={disabled}
        // The pointer opens the cell HERE, at the press, rather than at the
        // release (campaign admin-window/BUG-0086, `opensCell`): committing
        // the cell that is currently open re-apportions the table's columns,
        // and a button that moves between mousedown and mouseup never sees a
        // click at all.
        onPointerDown={(event) => {
          if (
            !opensCell({
              source: "pointerdown",
              button: event.button,
              detail: event.detail,
              editing,
              disabled,
            })
          ) {
            return;
          }
          // The browser's own default for this press is to move focus to the
          // nearest focusable element AT the press point — which is this
          // button, which the very same press is about to hide
          // (`layout.value === "flow-hidden"`). Chromium then finds nothing
          // focusable there and clears focus to the body, blurring the field
          // that just opened and closing it again. Focus is this control's own
          // business in every other path already (`autoFocus`, `focusVerdict`),
          // so it is here too.
          event.preventDefault();
          open();
        }}
        // A keyboard activation — Enter, Space, or an assistive technology's
        // `.click()` — reaches the control only as a click, and carries no
        // pointer. `opensCell` opens for exactly those, and never for the
        // click a pointer press produces: that one may be dispatched at
        // whatever the reflow put under the pointer, and opening THAT cell
        // would arm a retype over the wrong field.
        onClick={(event) => {
          if (
            !opensCell({
              source: "click",
              button: event.button,
              detail: event.detail,
              editing,
              disabled,
            })
          ) {
            return;
          }
          open();
        }}
        className={cx(
          "type-data cursor-text rounded-control px-1 py-0.5 text-left text-ink transition-colors hover:bg-chrome",
          RESTING_AFFORDANCE,
          status.kind === "saving" && "cursor-not-allowed opacity-50",
          // Open: the value still holds the box it held — that is what keeps
          // every other row where it was — and `visibility: hidden` is what
          // takes it out of the eye, the pointer AND the tab order at once,
          // so the field over it is the only thing anyone can reach.
          layout.value === "flow-hidden" && "invisible",
        )}
      >
        {orDash(shown)}
      </button>
      {layout.field === "absent" ? null : (
        <EditField
          value={draft}
          label={label}
          hintId={hintId}
          multiline={multiline}
          side={side}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            // Leaving the field is the operator's own move; the edit still
            // saves, but focus stays where they put it.
            if (ending.current === null) ending.current = "left";
            void commit();
          }}
          onKeyDown={onKeyDown}
        />
      )}
      {layout.status === "absent" ? null : <EditStatus status={status} growth={growth} />}
    </span>
  );
}
