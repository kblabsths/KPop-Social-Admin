import type { ActionSpec, ShapeActionsInput } from "./actions";

/**
 * The `data_conflict` decision item's verdict actions — SEEDED here, filled by
 * its own ticket (campaign admin-window/TASK-0049 seeds, FEAT-0011 fills).
 *
 * Spec §7 gives this shape three: **choose a claimed value** (one control per
 * evidence card, so the operator picks the observation they believe),
 * **supply a different value** (the override form), and **keep current &
 * settle** (the disagreement is fine as it stands; canonical holds and the
 * rejections still land).
 *
 * **The empty list is the truthful state, not a placeholder.** Neither
 * `verdicts` nor `settle_review_item` exists on staging or in production
 * (ARCHITECTURE.md §9.2), so no shape may offer a control that would call a
 * missing function — and until this shape's own ticket lands, offering one
 * that builds an untested decision would be worse than offering none. The
 * close slot renders the note field and says that no action is on offer yet;
 * it never renders a disabled button standing in for one.
 *
 * It is a module of its own so the three shapes can be built in parallel from
 * isolated worktrees without landing in one file (ARCHITECTURE.md §13.9).
 */
export function conflictActions(input: ShapeActionsInput): readonly ActionSpec[] {
  void input;
  return [];
}
