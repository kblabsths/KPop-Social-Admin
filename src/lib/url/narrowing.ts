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
 * question and is answered by the caller: `isNarrowedBeyond(filter, within)`
 * for `/queues`, `hasNarrowingFacet(filter)` for `/claims`,
 * `filter.source_id !== undefined` for `/sources` — one name per question
 * (admin-window/DEBT-0010). A boolean is the whole of what this rule needs from it, and
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

/**
 * **Did THIS FAMILY of facets remove rows from this surface?** — the
 * ATTRIBUTION question, one level below `isSurfaceNarrowed`'s "is this surface
 * narrowed at all" (architect ruling 2026-09-11, ARCHITECTURE.md §4.3;
 * admin-window/BUG-0192).
 *
 * A clause that points at a control — "under the filters above", "matching
 * these filters" — or at a named facet is a claim about rows THIS read lost to
 * THAT subject, so it may render only where that subject's own effect is
 * established. **Presence is never evidence of effect**: one chip earned two
 * opposite verdicts on two staging URLs while `hasChipFacet`'s presence answer
 * and `isSurfaceNarrowed`'s effect answer were ANDed as though they were one
 * question (admin-window/BUG-0191's residual, measured on staging
 * 2026-09-11). A clause that merely states what the read CARRIED ("in the
 * events domain", admin-window/BUG-0160) is not an attribution and keeps its
 * presence gate.
 *
 * Three states, and only one of them costs anything:
 *
 *  - **not in force** — nothing to attribute, whatever the rows did;
 *  - **in force, and no facet outside the family is** — every row this surface
 *    lost, it lost to this family, so the surface's own two facts ARE the
 *    family's effect (`isSurfaceNarrowed`) and no read is added;
 *  - **both in force** — the two families' effects are not separable from the
 *    two facts, and the answer is bought: the rows the same read draws with
 *    this family's facets DROPPED, against the rows it drew. Equal means the
 *    others did all of it and this family removed nothing.
 *
 * **An absent `withoutFamily` answers false**, which is the page saying
 * NOTHING about that control rather than guessing: silence is true in every
 * state, and an attribution is not. That is also the honest answer where the
 * count refused — a clause no read supports is exactly what this rule exists
 * to stop.
 *
 * It stays a PURE LEAF beside `isSurfaceNarrowed` (ARCHITECTURE.md §4 rule 7):
 * booleans and numbers, no filter type, no import — so the same rule serves
 * any surface's families and no page can reach a database through it.
 */
export function isFamilyNarrowing(args: {
  /** A facet of the family the clause names is set on this read. */
  inForce: boolean;
  /** A facet OUTSIDE that family is set on this read. */
  othersInForce: boolean;
  /** This surface's own two facts. */
  surface: SurfacePopulation;
  /**
   * Rows the same read draws with the family's facets dropped — supplied only
   * where both families are in force, which is the only state that needs it,
   * and absent where the read that would establish it did not answer.
   */
  withoutFamily?: number;
}): boolean {
  if (!args.inForce) return false;
  if (!args.othersInForce) return isSurfaceNarrowed(true, args.surface);
  return (
    args.withoutFamily !== undefined && args.surface.rendered !== args.withoutFamily
  );
}

/* ── the narrowings a surface renders NO control for ──────────────────────── */

/**
 * One narrowing a read carried that its surface renders no control for — the
 * facet, the value the query used, and the app's words around it.
 *
 * **It lives here, in the leaf that owns URL meaning, and not in one page's
 * filter module** (admin-window/TASK-0072). It was `src/lib/claims/filters.ts`'
 * alone, so `/sources` — whose two scan lines carry the same defect one page
 * over (admin-window/FEAT-0016) — could not say the same sentence without
 * retyping the shape, and a retyped spelling is the class that has already
 * taken five bugs on this family (LESSONS 5). The facet VOCABULARY stays each
 * surface's own (`CLAIMS_UNCHIPPED_FACETS`); the shape is one declaration.
 *
 * The words are handed back in THREE pieces rather than as one sentence
 * because the same phrase is rendered through two channels: a window line's
 * `scope` is prose the line joins at render, while a caption or an empty card
 * is markup, where the value is a machine identifier and takes the app's one
 * identifier face (`ui/Identifier`, LOOK_AND_FEEL Voice bar 5). One spelling,
 * two faces — never two spellings.
 */
export interface UnchippedNarrowing {
  /** The parameter it narrows, as the URL spells it. */
  facet: string;
  /** The value, verbatim as the query carried it. */
  value: string;
  /** The words before it, so the phrase reads straight after the row noun. */
  before: string;
  /** The words after it. */
  after: string;
}

/**
 * One facet a surface renders no control for: how to read it off that
 * surface's own filter, and what to call it in a sentence.
 *
 * Generic over the FILTER rather than over a facet union, which is what keeps
 * this leaf free of every filter type in the app — the same reason
 * `isSurfaceNarrowed` takes a boolean. A surface declares its table once,
 * beside its filters, where the type checker can still hold it total over that
 * surface's own facet set.
 */
export interface UnchippedFacet<Filter> {
  /** The parameter's name — what the sentence spells and the URL carries. */
  facet: string;
  /** The words before the value. */
  before: string;
  /** The words after it. */
  after: string;
  /** This facet's value on that filter, or `undefined` where it is not set. */
  value: (filter: Filter) => string | undefined;
}

/**
 * Every narrowing this filter applied that the surface renders no control for,
 * in the order its facets were declared — empty when it carries none.
 *
 * It answers what the READ carried, not whether the read came back smaller: a
 * surface asks `isSurfaceNarrowed` that second question and decides from both
 * whether to say any of this at all (admin-window/DEBT-0008).
 */
export function unchippedNarrowings<Filter>(
  filter: Filter,
  facets: readonly UnchippedFacet<Filter>[],
): UnchippedNarrowing[] {
  return facets.flatMap((facet) => {
    const value = facet.value(filter);
    return value === undefined
      ? []
      : [{ facet: facet.facet, value, before: facet.before, after: facet.after }];
  });
}

/** The same narrowing as one phrase — what a window line's `scope` takes. */
export function unchippedPhrase(narrowing: UnchippedNarrowing): string {
  return `${narrowing.before}${narrowing.value}${narrowing.after}`;
}
