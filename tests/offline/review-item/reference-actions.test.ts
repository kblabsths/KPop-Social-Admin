import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import {
  referenceActions,
  referenceNotice,
} from "@/components/review/close/reference-actions";
import { CloseSlot } from "@/components/review/close/slot";
import type { ShapeActionsInput, ShapeCandidate } from "@/components/review/close/actions";
import { shapeOf, type ReviewItemRow } from "@/lib/review/shapes";
import { classesOf, h, render, textOf } from "../ui/markup";
import { ID, reviewItemSourcePattern } from "../../fixtures/rows";

/**
 * A REFERENCE item's close — the shape Admin could not see until 2026-10-22,
 * and which had no test file at all until this one.
 *
 * Two things are graded here, both of them things Ben reported from the
 * deployed app on 2026-10-23 and neither of them visible to a type:
 *
 *  1. **The button row's ORDER does not depend on which buttons exist.** He
 *     opened a Hatsune Miku item — a name with no candidates — and found
 *     "Not a KPOP act" sitting where "Select this artist" had been, with
 *     "Create a new artist" behind it: *"the buttons should always stay in the
 *     same order"*. The cause was a blocked control positioned by a slice of
 *     the live actions, so the absent control shifted it.
 *  2. **The empty-candidates notice is ONE SENTENCE.** It spent four clauses
 *     telling the operator what the row of buttons underneath already showed
 *     them.
 *
 * The order is read off the RENDERED markup rather than the specs, because the
 * spec list and the row the operator sees are two different orderings — the
 * row interleaves the blocked control, and that interleaving was the bug.
 */

/** The item Ben was looking at: a sighted name, with the source's own ref. */
function referenceItem(overrides: Partial<ReviewItemRow> = {}): ReviewItemRow {
  return reviewItemSourcePattern({
    source_id: ID.sourceTicketmaster,
    external_ref: "K8vZ917-Rw0",
    summary: "ticketmaster \"Yeonjun\": no catalog name is close.",
    evidence: [],
    ...overrides,
  });
}

function candidate(overrides: Partial<ShapeCandidate> = {}): ShapeCandidate {
  return {
    id: ID.idolEntity,
    domain: "idols",
    name: "Yeonjun",
    group: "TOMORROW X TOGETHER",
    agency: "BigHit Music",
    fullName: "Choi Yeon-jun",
    birthday: "1999-09-13",
    imageUrl: null,
    ...overrides,
  };
}

function input(
  candidates: readonly ShapeCandidate[] | null,
  item: ReviewItemRow = referenceItem(),
): ShapeActionsInput {
  return { item, evidence: [], candidates };
}

/** The visible text of every button in the close, in document order. */
function buttonRow(
  candidates: readonly ShapeCandidate[] | null,
  item: ReviewItemRow = referenceItem(),
): string[] {
  const html = render(
    h(CloseSlot, {
      item,
      readiness: { kind: "ok" },
      actions: referenceActions(input(candidates, item)),
      notice: referenceNotice(input(candidates, item)),
      blocked: [
        {
          label: "Create a new artist",
          because: "the catalog domains are not registered yet",
          before: "rule_not_kpop",
        },
      ],
    }),
  );
  const $ = cheerio.load(html);
  // Not inside the candidates table: a selectable row there IS a `<button>`
  // (one per row, spanning every column), and those are the answer's options
  // rather than the answer's controls.
  return $("button")
    .filter((_, element) => $(element).parents("table").length === 0)
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("the shape", () => {
  it("is the reference one once the item carries an external_ref", () => {
    expect(shapeOf(referenceItem())).toBe("entity_link_reference");
    // The same row WITHOUT the ref is the stuck-record pattern — the one
    // reading that put 125 of production's 126 items under the wrong shape.
    expect(shapeOf(reviewItemSourcePattern())).toBe("entity_link_source_pattern");
  });
});

describe("the button row's order", () => {
  it("puts the create control between the selection and the ruling", () => {
    expect(buttonRow([candidate()])).toEqual([
      "Select this artist",
      "Create a new artist",
      "Not a KPOP act",
    ]);
  });

  it("keeps that order when there is no candidate to select", () => {
    // The Hatsune Miku case. The selection control is gone — correctly, there
    // is nothing to select — and the two that remain must not move up into
    // its place.
    expect(buttonRow([])).toEqual(["Create a new artist", "Not a KPOP act"]);
  });

  it("keeps that order when the candidates could not be read at all", () => {
    expect(buttonRow(null)).toEqual(["Create a new artist", "Not a KPOP act"]);
  });

  it("withholds the ruling on a venue item and still does not reorder", () => {
    // A venue reference is not a k-pop-act question, so `rule_not_kpop` is not
    // offered (KS029 refuses it). The create control has no anchor left and
    // renders at the end rather than nowhere.
    const venue = referenceItem({ domain: "venues" });
    const row = buttonRow(
      [candidate({ id: ID.venueEntity, domain: "venues", name: "The Forum" })],
      venue,
    );
    expect(row).not.toContain("Not a KPOP act");
    expect(row[row.length - 1]).toBe("Create a new artist");
  });
});

describe("the notice", () => {
  it("says the one thing the operator cannot see, in one sentence", () => {
    expect(render(referenceNotice(input([])))).toBe(
      '<p class="type-body text-ink-secondary" data-close-notice="reference">' +
        "The resolver proposed no candidates for this name.</p>",
    );
  });

  it("says one sentence when the read itself failed", () => {
    expect(textOf(render(referenceNotice(input(null))))).toBe(
      "The candidates could not be read.",
    );
  });

  it("takes the PROSE step, the one the item's own summary takes", () => {
    // Both are sentences the operator reads, so both are `type-body` — 14px.
    // This notice rendered as a bare fragment until 2026-10-24 and so
    // inherited the document's 16px, which is the mismatch Ben saw.
    const classes = classesOf(render(referenceNotice(input([]))));
    expect(classes).toContain("type-body");
    expect(classes.filter((name) => name.startsWith("type-"))).toEqual(["type-body"]);
  });

  it("says nothing at all when there are candidates to choose from", () => {
    expect(referenceNotice(input([candidate()]))).toBeNull();
  });
});
