import type { ReactNode } from "react";
import type { EvidenceRow } from "@/components/review";
import { EM_DASH } from "@/lib/format";
import type { ReviewItemRow } from "@/lib/review/shapes";
import { factKey, isReferenceField, type VerdictValue } from "@/lib/verdict/decision";
import type { ActionSpec, ShapeActionsInput } from "./actions";

/**
 * The `data_conflict` decision item's three verdict actions — campaign
 * admin-window/TASK-0050, spec §7.
 *
 * Sources disagree about one fact, and the operator closes that disagreement
 * one of exactly three ways:
 *
 *  1. **choose a claimed value** — ONE control per evidence card, so the
 *     operator picks the observation they believe. `choose_claimed_value`,
 *     carrying that card's `observation_id` and no scalar;
 *  2. **supply a different value** — the operator's own, written at the admin
 *     tier. `supply_value`, carrying a scalar and no observation. The value is
 *     typed into the shared edit cell (`EditableCell`, the M1 widget the
 *     record surface already uses) rather than into a second widget spelling
 *     of the same thing, which is what `ActionSpec.supplies` exists to say.
 *     **Offered for a scalar fact and for no other**: a `kind: reference`
 *     field links rows and cannot be typed, so it gets the two remaining
 *     controls and a line saying why the third is missing
 *     (`conflictNotice`, campaign admin-window/BUG-0087);
 *  3. **keep current & settle** — the disagreement is fine as it stands.
 *     `keep_current`, carrying nothing: canonical holds, and the rejections
 *     the verdict implies still land inside the function.
 *
 * **Every control is ONE typed decision and ONE POST**, through the single
 * request path the frame owns (`submitSettlement`, `actions.ts`) and therefore
 * one call to `settle_review_item`. Nothing here fetches, nothing here
 * settles, and there is no second write path: this module returns DATA
 * (ARCHITECTURE.md §9.2, spec §7).
 *
 * **It offers a control whatever the database has**, and that is not a
 * contradiction of "never offer a control that would call a missing function":
 * the readiness question is asked ONCE, above, by `CloseSlot`
 * (`readSettlementReadiness`), which draws the not-provisioned card and
 * renders no control at all while `verdicts` is absent — the normal case for
 * the whole of M2. A second reading of that question here would be the
 * hand-copied probe common violation 9 forbids.
 *
 * It is a module of its own so the three shapes can be built in parallel from
 * isolated worktrees without landing in one file (ARCHITECTURE.md §13.9).
 */

/**
 * The fact this item is about, or null when the row does not name a whole one.
 *
 * `domain`, `entity_id` and `field` are nullable on `review_items` — an
 * `entity_link` fact item about a record that does not exist yet has a null
 * `entity_id`, and the signal shape has all three null (`shapes.ts`). A
 * `data_conflict` row is a fact item by construction, but the columns are
 * still nullable, and a `VerdictValue` cannot be built without all three:
 * the domain, the row the value lands on, and the registry field.
 *
 * So this is a real branch and not a type-appeasing cast. With the fact
 * incomplete, the two value-carrying actions are not offered at all — an
 * action offered with a payload the function would refuse is worse than an
 * action not offered — and `keep_current`, which carries no payload, still is.
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
 * What the control that adopts one claim says.
 *
 * A verb plus its object, naming what gets written (LOOK_AND_FEEL copy bar 1),
 * and it names the value AND the source because the controls stand together in
 * the close: "Use this value" ×2 would be two identical labels for two
 * different writes.
 *
 * A claim whose value is null gets the app's dash and NO qualifier
 * (LESSONS 1): an absent value is a thing a source really claimed, and the
 * label says so rather than dressing it up or hiding the control.
 */
function chooseLabel(row: EvidenceRow): string {
  const value =
    row.value === null || row.value.trim() === "" ? EM_DASH : `“${row.value}”`;
  return `Use ${value} from ${row.source}`;
}

export function conflictActions({
  item,
  evidence,
}: ShapeActionsInput): readonly ActionSpec[] {
  const fact = factOf(item);
  const actions: ActionSpec[] = [];

  if (fact !== null) {
    // One per evidence card, in the evidence's own order — which is the fold
    // order the page renders the cards in, so the Nth control belongs to the
    // Nth card and a control wired to another card is a visible defect.
    for (const row of evidence) {
      actions.push({
        label: chooseLabel(row),
        action: "choose_claimed_value",
        value: {
          ...fact,
          observation_id: row.observationId,
          value: null,
          ref: null,
        },
        // It overwrites canonical: red border, never a red fill.
        variant: "destructive",
      });
    }

    // A REFERENCE field gets no supply control at all — see `conflictNotice`
    // below for the whole reason, and for what the operator is told instead.
    if (!isReferenceField(fact.domain, fact.field)) {
      actions.push({
        label: "Supply a different value",
        action: "supply_value",
        // The scalar is the operator's and does not exist yet; the frame merges
        // it in at submission (`decisionValue`). Everything the SERVER knows
        // about where the value lands is here.
        value: { ...fact, observation_id: null, value: null, ref: null },
        // The fact, as the whole app spells one (`factKey`, the leaf): the
        // control's `supplies` and the notice below are the same string by
        // construction, not by two templates agreeing (admin-window/DEBT-0007).
        supplies: factKey(fact.domain, fact.field),
      });
    }
  }

  actions.push({
    label: "Keep current & settle",
    action: "keep_current",
    // Canonical stands, so nothing is written to it — the rejections this
    // implies are the function's own business, not a payload.
    value: null,
  });

  return actions;
}

/**
 * Why this item has no "supply a different value" control — rendered by the
 * slot, or null when the item HAS one (campaign admin-window/BUG-0087).
 *
 * A `kind: reference` field names another record: its value is an entity id
 * the apply links (`venue_id`, `event_performers`), never text
 * (contracts/admin-observability.md §8, "the apply links rows … instead of
 * writing text"). So the scalar cell is withheld above — and withholding a
 * control silently would leave the operator reading a shorter list with no
 * idea why one shape of item offers three actions and this one two. The
 * absence is RENDERED, with its reason, which is the same bar every other
 * absence on this window meets.
 *
 * It says what IS offered as well as what is not, because both are true and
 * only one of them is visible: adopting a claim carries that observation's id
 * and settles the link honestly, and keeping current settles it as it stands.
 * The entity picker (§8) is the control that will fill the gap; when it lands
 * this line goes with it.
 *
 * The fact is a machine identifier and renders verbatim in mono, as its own
 * element (§11, LESSONS 5).
 */
export function conflictNotice({ item }: ShapeActionsInput): ReactNode {
  const fact = factOf(item);
  if (fact === null || !isReferenceField(fact.domain, fact.field)) return null;
  const name = factKey(fact.domain, fact.field);
  return (
    <p className="type-body text-ink-secondary" data-close-notice={name}>
      <span className="type-data text-ink">{name}</span>{" "}
      names another record rather than holding a value, so there is nothing to
      type here. Adopt one of the claims above, or keep the current value;
      choosing a different record needs the entity picker, which is not built
      yet.
    </p>
  );
}
