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
 *    holds no row for it (LOOK_AND_FEEL Voice bar 5: the id is then genuinely
 *    the only thing known, and a blank or a guess would be worse than a uuid).
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it imports nothing, reaches
 * no database, and takes the registry rows a caller already read. The row type
 * is structural on purpose — `lib/db/sources.ts`'s `SourceRow`, the review
 * item's narrow one and the two `SourceNameRow`s in `lib/browse/rows.ts` and
 * `lib/records/provenance.ts` all satisfy it, so nothing here adds a fifth
 * name for `{ source_id, source }`.
 */

/** The lookup a surface labels its source ids by. Later rows win a repeat id. */
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
 * id is the only true thing the app can say about it.
 */
export function sourceLabel(
  names: ReadonlyMap<string, string>,
  sourceId: string,
): string {
  return names.get(sourceId) ?? sourceId;
}
