import type { ReactNode } from "react";

import { Identifier } from "@/components/ui";
import type { ActionSpec, ShapeActionsInput, ShapeCandidate } from "./actions";

/**
 * A REFERENCE item's answers — campaign admin-window, 2026-10-22.
 *
 * This is the shape Admin could not see until today. A reference item asks one
 * question in the resolver's own words —
 *
 *   ticketmaster "Yeonjun": 10 catalog names match closely, none exactly
 *   (Yeonjun, Yeonjun, Yeonjun, Yeonjung, …) - which one is this, or none of them
 *
 * — and Admin answered it with `fixed` / `wont_fix`, because it read the item
 * as the stuck-record-pattern shape. Those two dispositions cannot answer
 * "which one is this". Ben's words for what that cost: "the worst thing you
 * could do is hide them from me."
 *
 * **Both real answers, and nothing invented.** `link_entity` names the row the
 * sighting is, chosen from the candidates the resolver ranked;
 * `rule_not_kpop` says the catalog will never hold it. The dispositions stay
 * below them, because an item really can be handled elsewhere — but they are
 * no longer the only thing on offer.
 *
 * **The value shape is the function's, assembled by the frame.**
 * `settle_review_item`'s reference arm takes `{ domain, ref }` and REFUSES
 * `entity_id`, `field`, `observation_id` and `value` on a reference item
 * (KS029). `decisionValue` merges a chosen row into `spec.value` as `ref`, so
 * a spec carrying `value: { domain }` plus `chooses` produces exactly
 * `{ domain, ref }` with nothing spelled twice.
 *
 * **One control per DOMAIN present.** `spec.value` is fixed per control while
 * the domain belongs to the chosen row, so candidates are grouped and each
 * group gets its own control. In production every item's candidates sit in one
 * table, so this is one control in practice — but a mixed set would otherwise
 * send a row from `idols` under `domain: "venues"`, which the function would
 * rightly refuse.
 */

/**
 * Ben's own words for the control (2026-10-23): "Select this artist".
 *
 * A verb plus its object, naming what gets written (copy bar 1) — and it reads
 * as the confirmation of a selection, which is what it now is: the options are
 * a table above and this button settles the row the operator picked.
 */
const LINK_LABEL: Readonly<Record<string, string>> = {
  groups: "Select this group",
  idols: "Select this artist",
  venues: "Select this venue",
};

/** The operator's word for the ruling — a verb plus its object (copy bar 1). */
// Ben's wording, 2026-10-23.
const NOT_KPOP_LABEL = "Not a KPOP act";

/** The candidates of one domain, keeping the resolver's ranking. */
function byDomain(
  candidates: readonly ShapeCandidate[],
): { domain: string; rows: readonly ShapeCandidate[] }[] {
  const order: string[] = [];
  const groups = new Map<string, ShapeCandidate[]>();
  for (const candidate of candidates) {
    const held = groups.get(candidate.domain);
    if (held === undefined) {
      order.push(candidate.domain);
      groups.set(candidate.domain, [candidate]);
    } else {
      held.push(candidate);
    }
  }
  return order.map((domain) => ({ domain, rows: groups.get(domain) ?? [] }));
}

export function referenceActions({
  candidates,
}: ShapeActionsInput): readonly ActionSpec[] {
  const proposed = candidates ?? [];
  const specs: ActionSpec[] = [];

  for (const { domain, rows } of byDomain(proposed)) {
    specs.push({
      label: LINK_LABEL[domain] ?? "This is this record",
      action: "link_entity",
      // The domain is the control's; the row is the operator's, merged in as
      // `ref` by `decisionValue`. The other slots are spelled NULL rather than
      // omitted, for the reason every builder here spells them: the envelope's
      // shape is fixed and `decisionRefusals` counts filled slots, so an
      // absent key and a null key must not be two ways of saying the same
      // thing. `entity_id` and `field` are the two a reference verdict does
      // not carry at all — the function refuses them (KS029).
      value: { domain, observation_id: null, value: null, ref: null },
      // Destructive, because this one WRITES: a confirmed match re-points what
      // the resolver links on its next cycle.
      variant: "destructive",
      // THE OPTIONS ARE THE QUESTION, so they are on screen (Ben, twice). A
      // handful of fixed, ranked rows is not a search.
      expanded: true,
      chooses: {
        // The resolver's ranking, not re-sorted — the order IS its judgment
        // about which match is closest.
        options: rows.map((row) => ({
          id: row.id,
          name: row.name,
          // What makes ten namesakes ten different people: the group, the
          // agency, the real name, the birth year — and a face.
          detail: row.detail,
          imageUrl: row.imageUrl,
        })),
        limit: rows.length,
        held: rows.length,
        // The candidate set is FIXED when the item opens (`20260911000009`),
        // so it is never a truncated window: this is every candidate the
        // resolver proposed, not the first page of them.
        truncated: false,
        over: "table",
        domain,
      },
    });
  }

  // Only for an ACT. `settle_review_item` refuses `rule_not_kpop` on a venue
  // reference item, and a control that cannot be honoured is not drawn
  // (SPEC F10) — so the ruling is offered only where the candidates say the
  // question is about the catalog, or where there are none at all and the
  // item's own words are the only guide (handled by the caller, which withholds
  // the whole list on a venue item).
  const venueOnly =
    proposed.length > 0 && proposed.every((row) => row.domain === "venues");
  if (!venueOnly) {
    specs.push({
      label: NOT_KPOP_LABEL,
      action: "rule_not_kpop",
      // No payload: the ruling is the answer and the function refuses a value.
      value: null,
      variant: "secondary",
    });
  }

  return specs;
}

/**
 * What a reference item's close WITHHOLDS, and why — or nothing when it
 * withholds nothing.
 *
 * It replaces `patternNotice`, which said this app could not record the answer
 * at all. It can now (`20261021000002`), so that notice is deleted rather than
 * reworded: it described a gap, and a notice that outlives its gap is a lie
 * with a long tail.
 *
 * What remains worth saying is the one state where the question is real and the
 * controls cannot reach it: the resolver proposed NO candidate, so there is
 * nothing to pick from. "Add the row" is still not Admin's to do — inserting a
 * catalog row is under Never in `AGENTS.md`, and the provenance argument
 * depends on it — so the operator is told that plainly instead of being handed
 * a picker with an empty list.
 */
export function referenceNotice({
  candidates,
}: ShapeActionsInput): ReactNode {
  if (candidates === null || candidates === undefined) {
    return <>The candidates could not be read, so no row can be chosen here.</>;
  }
  if (candidates.length > 0) return null;
  return (
    <>
      The resolver proposed no candidate for this name, so there is no row to
      choose. If it belongs in the catalog, the row has to arrive through the
      pipeline — Admin writes no catalog row. If it does not belong,{" "}
      <Identifier>rule_not_kpop</Identifier> is the answer.
    </>
  );
}
