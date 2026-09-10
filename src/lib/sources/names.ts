/**
 * How a source is LABELLED, in one place — campaign admin-window/BUG-0043.
 *
 * `observations`, `pending_claims`, `review_items` and `field_provenance` all
 * key a source by `source_id`, a uuid. An operator does not read uuids: the
 * registry's `sources.source` is the name every log line, registry file and
 * adapter spells, and it is what `/sources`, `/browse` and a record's
 * provenance already show. A screen that prints the uuid where the app holds
 * the name is the "a machine identifier is not a label" defect — three of them
 * shipped at once on `/claims` and the review item (BUG-0043), and each was a
 * different hand-rolled `nameOf.get(id) ?? id` away from being right.
 *
 * So the two halves of that rule live here, once:
 *
 *  - `sourceNamesOf` — the id→name lookup a read's registry rows give;
 *  - `sourceLabel` — name it, or render the id VERBATIM when the registry
 *    NAMES NOTHING (LOOK_AND_FEEL Voice bar 5: the id is then genuinely the
 *    only thing known, and a blank or a guess would be worse than a uuid).
 *
 * **"Names nothing" is decided by INK, not by `null`** (admin-window/BUG-0154).
 * The fallback was `??`, which catches `null` and `undefined` only, so a
 * registry row that EXISTED with a blank name took neither branch: the lookup
 * found it, `??` saw a string, and whitespace reached the screen as an evidence
 * cell with nothing in it and an anchor with nothing to read or click, beside a
 * sibling row that named its own source. The question "is there anything here a
 * person could read" is the app's, answered in ONE place — `hasVisibleContent`
 * in `lib/verdict/decision.ts` — and asked here rather than answered a fifth
 * time (BUG-0089/BUG-0136/BUG-0146 are that question answered twice).
 *
 * A name with ink travels BYTE-IDENTICAL: not trimmed, not rewritten, not
 * swapped for the id. That includes a name this app finds odd — an em dash is
 * a character with ink, and `isAbsent`'s dash branch (`lib/format.ts`)
 * recognises the string the app's OWN formatters return, not a producer's
 * value. The registry is the scraper repo's to vet (`CHECK (source ~
 * '^[a-z0-9_]+$')`), so this app states the rule instead of assuming it holds.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it reaches nothing that can
 * reach a database — not `lib/db/**`, not `@supabase/supabase-js`, not
 * `process.env`, not React — and takes the registry rows a caller already
 * read. Its ONE import is another LEAF, which rule 7 ¶2 permits for exactly
 * this reason. The row type is structural on purpose — `lib/db/sources.ts`'s
 * `SourceRow`, the review item's narrow one and the two `SourceNameRow`s in
 * `lib/browse/rows.ts` and `lib/records/provenance.ts` all satisfy it, so
 * nothing here adds a fifth name for `{ source_id, source }`.
 */
import { hasVisibleContent } from "@/lib/verdict/decision";

/**
 * The lookup a surface labels its source ids by. Later rows win a repeat id.
 *
 * A faithful record of what the registry ANSWERED, blank names included: what
 * to say when a name is unreadable is `sourceLabel`'s rule and lives there
 * alone, so a caller that reads this map for another purpose still sees the
 * row as it is.
 */
export function sourceNamesOf(
  rows: readonly { source_id: string; source: string }[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) names.set(row.source_id, row.source);
  return names;
}

/**
 * What a source is called on screen: the registry's name, or the id verbatim.
 *
 * The fallback is not a failure mode to be hidden — a source the registry has
 * no row for is a real thing an operator may see (a retired row, a claim from
 * a source registered after this read, a registry leg that refused), and its
 * id is the only true thing the app can say about it. A row that exists and
 * names nothing READABLE is the same situation and gets the same answer
 * (admin-window/BUG-0154): there are two ways for the registry to name no
 * source and only one thing to say about either.
 *
 * **The one owner of this rule.** Every surface that labels a source id calls
 * here — the review item's header link, its evidence rows and its canonical
 * side, `/claims`, `/sources`' dial. A retyped `?? sourceId` beside it is the
 * defect this ticket removed from `lib/db/review-item.ts` (LESSONS 5).
 *
 * **A cell handed a label asks `hasVisibleContent` too, never `isAbsent`**
 * (admin-window/BUG-0156). The two source cells guarded their anchors with
 * `isAbsent` (`lib/format.ts`), whose dash branch recognises the bare em dash
 * one of the app's OWN formatters returns — a different question. So a source
 * the registry NAMES `—` was kept verbatim here and then rendered as an
 * absence there: the link gone, the cell labelled `no value`, and the page
 * explaining a dash that stood for a name. One question, one predicate: this
 * one (LESSONS 4, LESSONS 11).
 */
export function sourceLabel(
  names: ReadonlyMap<string, string>,
  sourceId: string,
): string {
  const name = names.get(sourceId);
  return name !== undefined && hasVisibleContent(name) ? name : sourceId;
}

