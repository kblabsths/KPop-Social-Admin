import type { ActionSpec, ShapeActionsInput } from "./actions";

/**
 * The source-pattern SIGNAL item's dispositions — SEEDED here, filled by its
 * own ticket (campaign admin-window/TASK-0049 seeds).
 *
 * A signal takes no verdict: it closes with a disposition (spec §7). `fixed`
 * — the breakage was addressed elsewhere, on the surface that owns it — or
 * `wont_fix`, **on which the note is required**: why the condition stands.
 * Either way the item settles and the row carries the disposition.
 *
 * The note guard is the frame's, not this module's: `closeRefusal`
 * (`actions.ts`) refuses a blank note for any action `noteRequired` names, the
 * route's `decisionRefusals` refuses it again, and the function raises on it —
 * three guards, so this module states an action and nothing about validation.
 *
 * **The empty list is the truthful state, not a placeholder** — see
 * `conflict-actions.tsx`.
 */
export function dispositionActions(input: ShapeActionsInput): readonly ActionSpec[] {
  void input;
  return [];
}
