import type { ReactNode } from "react";
import { StateOf, type UnavailableRead } from "@/components/ui";
import type { ReviewItemRow, Shape } from "@/lib/review/shapes";
import type { ActionSpec, ShapeActions, ShapeActionsInput } from "./actions";
import { conflictActions, conflictNotice } from "./conflict-actions";
import { CloseForm } from "./form";
import { linkActions } from "./link-actions";
import { dispositionActions } from "./signal-actions";

/**
 * **The close** — the last part of a review item's anatomy (spec §6 step 3,
 * §7; campaign admin-window/TASK-0049). M1 rendered its SPACE and settled
 * nothing; this is the frame every §7 action lands in.
 *
 * A pure synchronous component over plain props (ARCHITECTURE.md §5): the page
 * is the route's only async boundary, so it reads and shapes, and this
 * renders. What it renders is decided by ONE question — may this surface offer
 * a settlement at all? — answered by `readSettlementReadiness`
 * (`src/lib/db/verdict.ts`), which reads the presence of the table the verdict
 * log lives in and never calls the function to find out (ARCHITECTURE.md §9.2,
 * DECISIONS 2026-09-08).
 *
 * **The absent answer is the NORMAL one and is graded first.** Neither that
 * table nor `settle_review_item` exists on staging or in production, and
 * neither will until Ben installs M2's handoff migrations — that is the
 * database `main` deploys against for the whole milestone. So the first branch
 * below is the one that runs today: the not-provisioned card, naming the
 * object the read named, with **no control of any kind** — no disabled button,
 * no form, no note field standing in for one. A control that would call a
 * missing function is exactly what this branch exists to not offer.
 *
 * **There is no Admin-side workaround for the absent function** (spec §10's
 * one forbidden move): no queued write, no pending-overrides table, no retry
 * buffer, no flag-guarded direct write. The surface degrades to what M1 ships,
 * with the reason named, and that is the whole of the answer.
 *
 * **The recommendation slot renders nothing** and is not here at all: its
 * producer is parked (spec §6), so the words `recommend` and `recommendation`
 * appear nowhere in this detail's markup.
 */

/**
 * Which shape's actions a review item gets — the map, and the only place a
 * shape is turned into an action list (spec §7's three shapes,
 * ARCHITECTURE.md §13.9).
 *
 * A `Record<Shape, …>`, like `EVIDENCE_VIEW_BY_SHAPE` beside it, so a fourth
 * shape fails to COMPILE rather than falling through to another shape's
 * actions (§6 trap 11). Nothing here re-derives a shape: `shapeOf` in
 * `src/lib/review/shapes.ts` is the app's one spelling of that, and the page
 * hands the result in.
 *
 * It lives in this module and not in `actions.ts` because the three shape
 * modules import that one: a map there would import them back and write a
 * cycle into the contract. It is called on the SERVER — the page builds the
 * list — which is also why neither this module nor a shape module may become
 * a client module (`form.tsx` is the one that is, and it takes plain data).
 */
export const ACTIONS_BY_SHAPE: Record<Shape, ShapeActions> = {
  data_conflict_fact: conflictActions,
  entity_link_fact: linkActions,
  entity_link_source_pattern: dispositionActions,
};

/**
 * A shape's answer to "what is NOT offered here, and why" — a line, or null
 * when everything spec §7 lists for this shape is on screen.
 *
 * The second half of the map above, and it exists for one case: a
 * `data_conflict` on a `kind: reference` field, whose free-text control is
 * withheld because a reference links rows rather than carrying text
 * (campaign admin-window/BUG-0087, spec §8). A withheld control that says
 * nothing is a shorter list with no reason — the same silent absence the rest
 * of this window renders rather than blanks.
 *
 * A `Record<Shape, …>` for the reason `ACTIONS_BY_SHAPE` is one: a fourth
 * shape fails to COMPILE rather than falling through to another shape's line.
 * The other two shapes answer null, and their nulls are not placeholders — an
 * `entity_link` fact item HAS its picker action (`link_entity`), and a signal
 * item names no fact at all, so neither withholds anything.
 */
export type ShapeNotice = (input: ShapeActionsInput) => ReactNode;

export const NOTICE_BY_SHAPE: Record<Shape, ShapeNotice> = {
  data_conflict_fact: conflictNotice,
  entity_link_fact: () => null,
  entity_link_source_pattern: () => null,
};

/**
 * What an item that is already closed says, instead of a control that cannot
 * work.
 *
 * A settled item stays browsable (spec §4), so its detail renders like any
 * other — but offering it a settle control would offer an action the function
 * would refuse. The status is the machine's own word and renders verbatim in
 * mono (§11). The verdict this item settled with is the verdict log's to show;
 * this line claims nothing about it.
 */
function SettledItem({ status }: { status: string }) {
  return (
    <p className="type-body text-ink-secondary" data-close-item-status={status}>
      This item is already{" "}
      <span className="type-data text-ink">{status}</span>. There is nothing
      left to close.
    </p>
  );
}

export function CloseSlot({
  item,
  readiness,
  actions,
  notice = null,
}: {
  /** The item being closed — its id addresses the route, its status decides. */
  item: ReviewItemRow;
  /**
   * May a settlement be offered? The result of `readSettlementReadiness`,
   * handed down as plain data: `ok` and the surface may offer one, and the two
   * unavailable arms render as the state they are.
   *
   * Declared structurally rather than imported from `lib/db`, exactly as
   * `StateOf` declares `UnavailableRead` — a component never imports the data
   * layer (ARCHITECTURE.md §4 rule 1).
   */
  readiness: { kind: "ok" } | UnavailableRead;
  /** This shape's controls, from `ACTIONS_BY_SHAPE`. Empty is a real answer. */
  actions: readonly ActionSpec[];
  /**
   * What this shape withholds and why, from `NOTICE_BY_SHAPE` — null on every
   * item that is offered the whole of its shape's §7 actions, which is all of
   * them but a conflict on a reference field.
   */
  notice?: ReactNode;
}) {
  if (readiness.kind !== "ok") {
    // The graded-first state, and the whole of what this slot renders today:
    // the card names the object the read named, and offers nothing.
    return <StateOf result={readiness} />;
  }

  if (item.status === "settled") return <SettledItem status={item.status} />;

  return (
    <>
      {actions.length === 0 ? (
        // Truthful, and deliberately not an `Empty` card: nothing about the
        // READ was empty — it answered, and this app simply offers this shape
        // no action yet. A state card here would say the database was empty,
        // which is a different claim (LOOK_AND_FEEL: the three emptinesses
        // never share a rendering).
        <p className="type-body text-ink-secondary">
          No verdict action is offered for this item yet.
        </p>
      ) : null}
      {/* Above the controls, because it is the reason the list below is the
          length it is. It is not a state card: nothing was unread and nothing
          was empty (LOOK_AND_FEEL: the emptinesses never share a rendering). */}
      {notice}
      <CloseForm reviewItemId={item.review_item_id} actions={actions} />
    </>
  );
}
