/**
 * **Is THIS surface's rendering scoped by the URL?** The one question the four
 * states turn on, from TWO facts and nothing else — the one owner of that
 * rule, for every route (campaign admin-window/DEBT-0008).
 *
 * It was `/queues`' alone, as `isBlockNarrowed` in
 * `src/lib/review/queue-filters.ts` (admin-window/BUG-0133), and the M2
 * structure walk found two more surfaces answering the same question from the
 * URL alone — `/claims` and `/sources`. The rule is now declared HERE, once,
 * and the three surfaces call it: a third hand-written copy would be born
 * without the six bugs that have landed on this one decision (BUG-0110,
 * BUG-0125, BUG-0129, BUG-0131, BUG-0133, BUG-0135), which is exactly the
 * class ARCHITECTURE.md Common violations row 9 promoted to a rule (§13.7).
 *
 * Fact 1 is STRUCTURAL — can a facet of this URL remove a row of this
 * surface's kind at all, whatever the table holds. It is derived from the
 * facet vocabulary and never from a row count, so it is each domain's own
 * question and is answered by the caller: `isNarrowed(filter, within)` for
 * `/queues`, `isNarrowed(filter)` for `/claims`, `filter.source_id !== undefined`
 * for `/sources`. A boolean is the whole of what this rule needs from it, and
 * taking a boolean is what keeps this leaf free of every filter type in the
 * app (the same reason `lib/url/dropped-params.ts` takes a plain record).
 *
 * Fact 2 is the surface's own POPULATION — the size of the set it renders with
 * NO url facet at all — against the size of what it is rendering now. The
 * rendered set is a subset of the population, so equal sizes mean the SAME
 * SET: the facet removed nothing and there is no scope to claim. When a
 * surface's population is zero, no facet has removed anything from it — every
 * URL leaves exactly the rows the bare page shows, which is none — and a
 * surface that said a filter emptied it would be blaming a filter for its own
 * zero and telling the reader to widen a filter that hides nothing.
 *
 * Both facts are required and neither is weakened:
 * - a facet that really removed rows: structural AND fewer rows than the
 *   population — the surface still names its scope;
 * - a facet the surface applies anyway (`/queues?kind=decision` on the
 *   decision block): not structurally narrowing at all — never named
 *   (admin-window/BUG-0129, admin-window/BUG-0131);
 * - any facet over a surface holding NOTHING: population 0, rendered 0 — no
 *   longer named (admin-window/BUG-0133, admin-window/DEBT-0008).
 *
 * **Fact 2 is a read the page almost always already has** — an unnarrowed
 * count, or the unnarrowed rows themselves — so this costs a comparison, not a
 * query; where it does cost a query, that query is a bounded `head: true`
 * count and never a row read (admin-window/BUG-0135).
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it imports nothing at all,
 * reaches no database and renders nothing, so no cycle can be written through
 * it and the rule is testable without rendering anything.
 */

/** What a surface is showing, and what it would show with no URL facet. */
export interface SurfacePopulation {
  /** How many rows this surface is rendering under the URL's filter. */
  rendered: number;
  /** How many rows it holds with no URL facet at all. */
  population: number;
}

/**
 * The two facts, ANDed — the whole rule.
 *
 * `structural` is fact 1, answered by the caller's own facet vocabulary;
 * `surface` is fact 2. Nothing else decides which arm an empty surface renders.
 */
export function isSurfaceNarrowed(
  structural: boolean,
  surface: SurfacePopulation,
): boolean {
  return structural && surface.rendered !== surface.population;
}
