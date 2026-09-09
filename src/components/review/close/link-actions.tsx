import type { ReactNode } from "react";
import { StateOf } from "@/components/ui";
import type { ReviewItemRow } from "@/lib/review/shapes";
import { factKey, isReferenceField, type VerdictValue } from "@/lib/verdict/decision";
import type { ActionSpec, ShapeActionsInput } from "./actions";

/**
 * The `entity_link` FACT item's two actions — campaign admin-window/TASK-0056,
 * spec §7, SPEC F10.
 *
 * This is the item whose `source_id` is null: the per-FACT one, about a
 * reference that could not be resolved. (The `entity_link` row with
 * `source_id` set is the source-pattern SIGNAL and takes the dispositions of
 * `signal-actions.tsx` instead; `lib/review/shapes.ts` makes that distinction
 * once, and nothing here re-derives it — the page asks `shapeOf` and
 * `ACTIONS_BY_SHAPE` answers.)
 *
 * Its close offers exactly two controls and no third:
 *
 *  1. **link to an existing entity** — the picker of SPEC F12, rendered inside
 *     the close slot. `link_entity`, carrying the chosen row's own id in the
 *     decision's `ref` slot and nothing in `value`: a reference is OBSERVED AS
 *     A REF, and `settle_review_item` writes the confirmed match the link
 *     stage reads in a later cycle (ARCHITECTURE.md §9.2). The window it
 *     chooses from is carried on the spec (`ActionSpec.chooses`), because the
 *     picker offers only rows the read returned;
 *  2. **settle** — leave it held. The item settles and the claim keeps waiting
 *     in its bucket. `settle`, carrying nothing at all.
 *
 * **There is no "create the entity" control here or on any path.** Entity
 * creation is the resolver's, the picker offers only rows that exist, and
 * nothing in this app inserts a catalog row (spec §8, AGENTS.md).
 *
 * **Every control is ONE typed decision and ONE POST**, through the single
 * request path the frame owns (`submitSettlement`, `actions.ts`) and therefore
 * one call to `settle_review_item`. This module returns DATA: it fetches
 * nothing and settles nothing.
 *
 * **Whether any control renders at all is not this module's question.** It is
 * `readSettlementReadiness`', asked once by `CloseSlot` — with `verdicts`
 * absent (staging today, and what `main` deploys against for the whole of M2)
 * the slot draws the not-provisioned card and this list is never rendered. No
 * control here would ever call a function this database does not have, and
 * nothing queues, buffers or works around one (spec §10's one forbidden move).
 *
 * A module of its own so the three shapes can be built in parallel from
 * isolated worktrees without landing in one file (ARCHITECTURE.md §13.9).
 */

/**
 * The whole fact this item is about, or null when the row does not name one.
 *
 * `domain`, `entity_id` and `field` are each nullable on `review_items`, and
 * on THIS shape the middle one is nullable in practice as well as in the
 * schema: an `entity_link` fact item is often about a record with no canonical
 * row yet, so `entity_id` is null (the column's own comment says so, and
 * `shapes.ts` reads `source_id` rather than the fact columns for exactly that
 * reason). A `VerdictValue` cannot be built without all three, and
 * `settle_review_item` refuses a value-carrying decision that omits any of
 * them — so this is a real branch, not a type-appeasing cast, and it is the
 * same branch `conflict-actions.tsx` takes for the same columns.
 */
function factOf(item: ReviewItemRow): Pick<
  VerdictValue,
  "domain" | "entity_id" | "field"
> | null {
  const { domain, entity_id, field } = item;
  if (domain === null || entity_id === null || field === null) return null;
  return { domain, entity_id, field };
}

/**
 * The fact this item's link control would settle, or null when there is none
 * to link — **the one predicate, exported so the page reads it rather than
 * spelling its own** (ARCHITECTURE.md §13.7).
 *
 * Two conditions, and both are the function's, not this surface's taste:
 *
 *  - the item names a WHOLE fact (above), because `settle_review_item` raises
 *    on a value-carrying decision missing `domain`, `entity_id` or `field`;
 *  - that fact is a REFERENCE (`isReferenceField`, the app's one list). Only a
 *    reference field has a row to point at; the `ref` slot on anything else is
 *    refused by the function, and `PAYLOAD_SLOTS` gives `link_entity` no other
 *    slot to travel in.
 *
 * The page asks this BEFORE it reads a window of rows, so an item with nothing
 * to link costs no query at all — the same narrowing the record surface makes
 * before it reads the picker's choices.
 */
export function linkableFact(item: ReviewItemRow): Pick<
  VerdictValue,
  "domain" | "entity_id" | "field"
> | null {
  const fact = factOf(item);
  if (fact === null || !isReferenceField(fact.domain, fact.field)) return null;
  return fact;
}

/**
 * What each control says. A verb plus its object, naming what gets written
 * (LOOK_AND_FEEL copy bar 1), and neither is the machine's name reworded: the
 * action travels as the spec's `action` and the surface renders it verbatim in
 * mono beside the label (copy bar 5, §11).
 *
 * "leaving it held" is in the settle control's own words because that is what
 * the operator is choosing — the item closes and the claim keeps waiting in
 * its bucket (spec §7) — and a bare "Settle" would read as the end of the
 * matter rather than as the deferral it is.
 */
const LINK_LABEL = "Link to an existing entity";
const SETTLE_LABEL = "Settle & leave it held";

export function linkActions({
  item,
  choices = null,
}: ShapeActionsInput): readonly ActionSpec[] {
  const actions: ActionSpec[] = [];
  const fact = linkableFact(item);
  const window = choices?.window ?? null;

  // Offered only where all three of the fact, the reference and the ROWS are
  // in hand. A picker with no window would be a control that cannot choose,
  // and an action offered with a payload the function would refuse is worse
  // than an action not offered — `linkNotice` below says so on screen rather
  // than leaving a shorter list with no reason (admin-window/BUG-0087's rule).
  if (fact !== null && window !== null) {
    actions.push({
      label: LINK_LABEL,
      action: "link_entity",
      // Everything the SERVER knows about which fact is being settled. The
      // chosen row does not exist until the operator picks it, and the frame
      // merges it into `ref` at submission (`decisionValue`) — which is why
      // `ref` is null here rather than guessed.
      value: { ...fact, observation_id: null, value: null, ref: null },
      chooses: window,
    });
  }

  // Always offered, and last: an operator who cannot or will not link may
  // still close the item, and this control carries no payload at all, so it is
  // well-formed whatever the item names. It writes nothing to canonical, so it
  // is not drawn `destructive`.
  actions.push({
    label: SETTLE_LABEL,
    action: "settle",
    value: null,
  });

  return actions;
}

/**
 * Why this item has no link control — a line, or null when it HAS one
 * (the rule campaign admin-window/BUG-0087 set for the conflict shape,
 * applied to this one).
 *
 * A withheld control that says nothing is a shorter list with no reason: an
 * operator would see one shape of `entity_link` item offering two controls and
 * another offering one, with nothing on screen to tell them apart. The absence
 * is RENDERED, with its cause, which is the bar every other absence on this
 * window meets (LESSONS 1).
 *
 * Three causes, three different sentences, because they are three different
 * states and a shared rendering would flatten them:
 *
 *  - the venue read REFUSED — its own card, naming the object it named, in the
 *    app's one pair of state renderings (`StateOf`). A refused read is never
 *    silently an emptiness;
 *  - the item names no whole fact, or no reference — there is nothing to point
 *    at, which is the ordinary state of an `entity_link` item about a record
 *    that has no canonical row yet;
 *  - it names one and the read returned no rows at all — a window that exists
 *    and is empty, which the picker itself would say if it were drawn.
 *
 * The fact is a machine identifier and renders verbatim in mono, as its own
 * element (§11, LESSONS 5).
 */
export function linkNotice({ item, choices = null }: ShapeActionsInput): ReactNode {
  const fact = linkableFact(item);
  const window = choices?.window ?? null;
  if (fact !== null && window !== null) return null;

  // The hook is the FACT this item is about, spelled the way the whole app
  // spells one, exactly as `conflictNotice` hooks its own line; an item naming
  // no whole fact falls back to the queue's own name, which is the most
  // specific true thing left to say.
  const named =
    item.domain === null || item.field === null
      ? null
      : factKey(item.domain, item.field);
  const hook = named ?? item.queue;

  if (choices?.note != null) {
    return (
      <div data-close-notice={hook}>
        <p className="type-body text-ink-secondary">
          The rows this fact could be linked to could not be read, so the
          picker is not offered. Settling still leaves the item held.
        </p>
        <StateOf result={choices.note} />
      </div>
    );
  }

  if (fact === null) {
    return (
      <p className="type-body text-ink-secondary" data-close-notice={hook}>
        {named === null ? null : (
          <>
            <span className="type-data text-ink">{named}</span>{" "}
          </>
        )}
        names no record this app can link: an entity_link item is opened before
        the canonical row exists, and a link needs the row, the field and a
        reference to point at. Settling leaves the item held, and the claim
        keeps waiting in its bucket until the resolver has somewhere to put it.
      </p>
    );
  }

  // The fact IS linkable and no read was made: this app has no search for the
  // domain the field points at. Not an emptiness — an empty window still
  // renders the picker, which says for itself that it matched nothing — and
  // not a refusal either, so it is neither of those two renderings.
  return (
    <p className="type-body text-ink-secondary" data-close-notice={hook}>
      <span className="type-data text-ink">{factKey(fact.domain, fact.field)}</span>{" "}
      points at another record, and this app has no search for the rows behind
      it, so the picker is not offered here. Settling leaves the item held.
    </p>
  );
}
