import type { ActionSpec, ShapeActionsInput } from "./actions";

/**
 * The `entity_link` FACT item's verdict actions — SEEDED here, filled by its
 * own ticket (campaign admin-window/TASK-0049 seeds, FEAT-0012 fills).
 *
 * Spec §7 gives this shape two: **link to an existing entity** (the picker,
 * whose choice lands as the admin source's own `external_ref` — ARCHITECTURE.md
 * §9.2), or **settle**, leaving it held so the claim keeps waiting in its
 * bucket.
 *
 * **The empty list is the truthful state, not a placeholder** — see
 * `conflict-actions.tsx` for why: with the function absent no shape may offer
 * a control, and this shape's controls are its own ticket's work.
 *
 * Its own module so the three shapes can be built in parallel without landing
 * in one file (ARCHITECTURE.md §13.9).
 */
export function linkActions(input: ShapeActionsInput): readonly ActionSpec[] {
  void input;
  return [];
}
