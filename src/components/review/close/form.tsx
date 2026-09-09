"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EditableCell, type SaveOutcome } from "@/components/EditableCell";
import { Button } from "@/components/ui";
import type { VerdictAction } from "@/lib/verdict/decision";
import {
  closeRefusal,
  noteIsRequiredBy,
  refusalWords,
  submitSettlement,
  type ActionSpec,
} from "./actions";

/**
 * The close slot's one interactive part — campaign admin-window/TASK-0049.
 *
 * It is the ONLY client module of the close, and it exists so that
 * `slot.tsx` can stay a pure synchronous component the page renders on the
 * server (ARCHITECTURE.md §5) while the note field and the controls still
 * carry state. A `"use client"` module's exports become client references, so
 * the shape builders and their by-shape map may not live here: the page calls
 * those on the server and hands this component plain data.
 *
 * What it does NOT do, and must never grow: a second write path. Every control
 * here posts the same body to the same route
 * (`submitSettlement`, `src/components/review/close/actions.ts`), which calls
 * the one seam, which makes the one call to `settle_review_item` (spec §7,
 * ARCHITECTURE.md §9.2). There is no queued write, no retry buffer and no
 * "until Ben installs it" fallback — with the function absent this component
 * is never rendered at all, because `slot.tsx` draws the not-provisioned card
 * instead (spec §10's one forbidden move).
 *
 * The M1 edit cell (`src/components/EditableCell.tsx`) is the precedent for
 * everything else here: the statement of work is a live region beside the
 * controls and never the control's own label; a refusal interrupts and a
 * confirmation announces politely; focus comes back to the control the
 * operator pressed once the write answers, because a disabled button drops it
 * (admin-window/BUG-0066, admin-window/BUG-0069).
 */

/** What this slot's settlement is doing, or what it did. */
export type CloseState =
  | { kind: "idle" }
  | { kind: "settling"; action: VerdictAction }
  /** It landed. The controls are gone: the item's new state stands in their place. */
  | { kind: "settled"; action: VerdictAction; label: string }
  | { kind: "refused"; message: string };

/** Nothing has been pressed yet. */
export const IDLE_CLOSE_STATE: CloseState = { kind: "idle" };

/**
 * What a control is told when another settlement is already in flight.
 *
 * The buttons are `disabled` for the whole of a write, but the edit cell's
 * resting control is not — a cell cannot be disabled without dropping focus —
 * so this is the state's own guard, and it is words rather than silence
 * because the cell has to be handed an outcome to revert on.
 */
const IN_FLIGHT_WORDS =
  "A settlement is already in flight; wait for it to answer, then try again.";

/**
 * Where focus belongs once a settlement answers — the same rule
 * `focusVerdict` states for the edit cell, narrowed to this surface's one
 * shape (admin-window/BUG-0069).
 *
 * A control is `disabled` for the whole of the write, and a disabled button
 * cannot hold focus, so the browser drops it on `<body>` and the operator's
 * next Tab restarts at the top of the document. Returning it is only right
 * while it is adrift: an operator who clicked elsewhere mid-write went
 * somewhere on purpose and must not have it yanked back.
 *
 * Pure and exported because focus is a browser fact the offline tier cannot
 * see (`tests/offline` is node with no jsdom, STACK §4): the DECISION is
 * pinned here, and the focus itself is a browser measurement.
 */
export function focusReturns({
  state,
  focusIsAdrift,
}: {
  state: CloseState;
  /** Is focus on nothing the operator chose? Read from `document`. */
  focusIsAdrift: boolean;
}): boolean {
  // Still in flight: the control cannot hold focus yet, and the verdict is
  // taken again when the write answers.
  if (state.kind === "settling") return false;
  // Settled: the controls are replaced by the item's new state, so there is
  // nothing left to focus.
  if (state.kind === "settled") return false;
  return focusIsAdrift;
}

/**
 * Is focus on nothing in particular, so that returning it takes it from
 * nobody?
 *
 * The browser half of `focusReturns`. A near-twin of the private
 * `focusIsAdrift` in `src/components/EditableCell.tsx` — that one is not
 * exported and that file is the M1 edit surface, so the two live apart until
 * someone lifts one of them into a shared module; see this ticket's handoff.
 */
function focusIsAdrift(control: HTMLButtonElement | null): boolean {
  const owner = control?.ownerDocument;
  if (!owner) return false;
  const active = owner.activeElement;
  return (
    active === null ||
    active === owner.body ||
    active === owner.documentElement ||
    active === control
  );
}

/**
 * The line beside the controls: what this settlement is doing, or what it did.
 *
 * Pure over `CloseState` and exported for the reason `EditStatus` is: the
 * in-flight state is React state a click produces, and the offline suite
 * renders with `renderToStaticMarkup` and no jsdom, so a status reachable only
 * from inside the form is a status no offline test can reach.
 *
 * A refusal interrupts (`role="alert"`); everything else announces politely
 * (`role="status"`). The word never lands on the control itself — a disabled
 * button's label does not change (LOOK_AND_FEEL, the button rule).
 */
export function CloseStatus({ state }: { state: CloseState }) {
  switch (state.kind) {
    case "settling":
      return (
        <span className="type-data text-ink-secondary" role="status">
          settling…
        </span>
      );
    case "refused":
      return (
        <span className="type-data text-broken" role="alert">
          {state.message}
        </span>
      );
    default:
      return null;
  }
}

/**
 * The state that replaces the controls once the item is settled
 * (LOOK_AND_FEEL bar 7: a settlement resolves in place, with no reload and no
 * instruction to refresh).
 *
 * The action keeps its name through the whole flow (copy bar 2): the label the
 * operator pressed is what this says, and the machine's own action name stands
 * beside it verbatim in mono (§11).
 */
export function SettledNotice({
  action,
  label,
}: {
  action: VerdictAction;
  label: string;
}) {
  return (
    <p className="type-body text-ink" role="status" data-close-settled={action}>
      Settled: {label}{" "}
      <span className="type-data text-ink-secondary">{action}</span>
    </p>
  );
}

/**
 * A control the operator TYPES into — campaign admin-window/TASK-0050, spec
 * §7's "supply a different value".
 *
 * It is the shared edit cell (`EditableCell`, the M1 widget the record surface
 * already writes through) and NOT a second widget spelling of the same thing:
 * the resting hairline underline, the select-on-open, "Enter or leaving the
 * field saves. Escape cancels", the statement of work beside the field and the
 * focus return all come from that one control, so the two places an operator
 * types a catalog value behave identically.
 *
 * The cell rests EMPTY — its dash — rather than pre-filled with canonical:
 * this action exists to write a value canonical does not hold, and a cell that
 * opened holding the current one would settle the item with it on a stray
 * Enter. The dash is also the app's own invitation to fill a field in.
 *
 * What it says beside the cell is the action's own label plus the fact the
 * value lands on, and the fact is a machine identifier: it renders verbatim in
 * mono, as its own element, never folded into the sans sentence (§11,
 * LESSONS 5).
 *
 * `onSupply` returns the cell's own outcome, so a refusal reverts the field
 * and stands in red exactly as a refused record edit does.
 */
export function SuppliedControl({
  spec,
  onSupply,
}: {
  spec: ActionSpec;
  onSupply: (next: string | null) => Promise<SaveOutcome>;
}) {
  return (
    <span
      data-close-action={spec.action}
      className="inline-flex flex-wrap items-baseline gap-2"
    >
      <span className="type-body text-ink">{spec.label} for</span>{" "}
      <span className="type-data text-ink-secondary">{spec.supplies}</span>{" "}
      <EditableCell value={null} label={spec.supplies ?? spec.label} onSave={onSupply} />
    </span>
  );
}

/** The note field's own words — a hint, not a placeholder inside the field. */
export function noteHint(actions: readonly ActionSpec[]): string {
  return noteIsRequiredBy(actions)
    ? "Required on a won’t-fix: why the condition stands. Optional on every other action."
    : "Optional — the reason this was settled the way it was.";
}

export function CloseForm({
  reviewItemId,
  actions,
}: {
  reviewItemId: string;
  /** The shape's controls, in the order spec §7 lists them. May be empty. */
  actions: readonly ActionSpec[];
}) {
  const [state, setState] = useState<CloseState>(IDLE_CLOSE_STATE);
  const [note, setNote] = useState("");
  /** The control the operator pressed, so focus can come back to it. */
  const pressed = useRef<HTMLButtonElement | null>(null);
  const noteId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!focusReturns({ state, focusIsAdrift: focusIsAdrift(pressed.current) })) return;
    pressed.current?.focus();
  }, [state]);

  async function settle(
    spec: ActionSpec,
    control: HTMLButtonElement | null,
    supplied: string | null = null,
  ) {
    if (state.kind === "settling") {
      return { ok: false as const, message: IN_FLIGHT_WORDS };
    }
    pressed.current = control;

    // The form's guard, run before the in-flight statement so a refusal that
    // never reached the network does not claim work was under way. It is not
    // the contract — `submitSettlement` refuses the same case for any caller,
    // the route's `decisionRefusals` refuses it again, and the function
    // raises — it is what keeps this statement honest.
    const refusal = closeRefusal(spec, note, supplied);
    if (refusal !== null) {
      const message = refusalWords(refusal);
      setState({ kind: "refused", message });
      return { ok: false as const, message };
    }

    setState({ kind: "settling", action: spec.action });
    const outcome = await submitSettlement({
      reviewItemId,
      spec,
      note,
      supplied,
      fetchImpl: fetch,
    });
    setState(
      outcome.ok
        ? { kind: "settled", action: spec.action, label: spec.label }
        : { kind: "refused", message: outcome.message },
    );
    return outcome.ok
      ? { ok: true as const }
      : { ok: false as const, message: outcome.message };
  }

  if (state.kind === "settled") {
    return <SettledNotice action={state.action} label={state.label} />;
  }

  const settling = state.kind === "settling";
  return (
    <div className="flex flex-col gap-2" data-close-state={state.kind}>
      <label className="type-body text-ink" htmlFor={noteId}>
        Note
      </label>
      <span id={hintId} className="type-body text-ink-secondary">
        {noteHint(actions)}
      </span>
      <textarea
        id={noteId}
        data-close-note=""
        aria-describedby={hintId}
        rows={3}
        value={note}
        disabled={settling}
        onChange={(event) => setNote(event.target.value)}
        className="type-data w-full rounded-control border border-hairline bg-surface px-2 py-1 text-ink"
      />
      {actions.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((spec, index) =>
            // A control whose payload the operator types is the shared edit
            // cell; every other control is a button. One list, two renderings,
            // and the same single request path underneath.
            spec.supplies === undefined ? (
              <Button
                key={`${spec.action}-${index}`}
                data-close-action={spec.action}
                variant={spec.variant ?? "secondary"}
                disabled={settling}
                onClick={(event) => void settle(spec, event.currentTarget)}
              >
                {spec.label}
              </Button>
            ) : (
              <SuppliedControl
                key={`${spec.action}-${index}`}
                spec={spec}
                onSupply={(next) => settle(spec, null, next)}
              />
            ),
          )}
        </div>
      )}
      <CloseStatus state={state} />
    </div>
  );
}
