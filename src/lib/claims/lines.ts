import { sourceHref } from "@/lib/claims/filters";
import { recordHref } from "@/lib/records/routes";
import { sourceLabel } from "@/lib/sources/names";

/**
 * What a CLAIM is, and what one looks like once a list has shaped it —
 * campaign admin-window/TASK-0065.
 *
 * A pure domain LEAF (ARCHITECTURE.md §4 rule 7): it holds the bucket
 * vocabulary the view spells, the row interfaces this app reasons over, and
 * the one pure mapping from those rows to the line a table renders. It
 * imports nothing that can reach a database — no client, no `process.env`, no
 * table name — so `src/lib/db/claims.ts` imports it and re-exports the row
 * types, exactly as `src/lib/db/review-items.ts` does with
 * `src/lib/review/shapes.ts`.
 *
 * **Why the shaping lives here rather than on the page.** `claimLines` was
 * declared in `src/app/claims/page.tsx` and `ClaimLine` in
 * `src/components/claims/claim-list.tsx`, which was fine while the first
 * screen was the only caller. The claims route handler
 * (admin-window/TASK-0066) must answer with rows shaped exactly as the first
 * screen's, and a second copy of that mapping is LESSONS 5 — a shared
 * spelling gets imported, never retyped. It is a pure function over rows plus
 * a name map, so its home is the leaf layer wherever its first caller
 * happened to sit (common violations row 17).
 *
 * **Why the vocabulary came with the rows.** `PendingClaimRow.bucket` is
 * typed on `PendingClaimBucket`, and a leaf may not import `lib/db/**` back —
 * not even a type — so the union and the constant it is derived from are
 * declared here beside the row they type. That is the shape `lib/review/
 * shapes.ts` already has (`ReviewQueue`, `ReviewSeverity`, `ReviewStatus`
 * declared beside `ReviewItemRow`), and `src/lib/db/claims.ts` re-exports both
 * names so no caller of that module changed. What did NOT move is the
 * EXCLUSION: `UNRENDERABLE_BUCKET`, `RENDERABLE_BUCKETS`, `isRenderableBucket`
 * and the `narrowed()` that applies the exclusion to every query stay in
 * `src/lib/db/claims.ts`, which is the one module that may query this view
 * (ARCHITECTURE.md §6 trap 4).
 *
 * The question this leaf owns, for the next reader who wants to widen it
 * (rule 7 ¶2): **what one pending claim IS, and what one row of a claims list
 * says**. Which claims a surface may show is a different question and belongs
 * to `src/lib/db/claims.ts`; which claims a URL asked for is
 * `src/lib/claims/filters.ts`.
 */

/* ── the bucket vocabulary ───────────────────────────────────────────────── */

/**
 * The six buckets, spelled as the view spells them (migration
 * `20260901000004`, `pending_claims.bucket`), in the view's own precedence
 * order — most blocking first, `agreeing` last.
 */
export const PENDING_CLAIM_BUCKETS = [
  "in_window",
  "standing_disagreement",
  "awaiting_link",
  "awaiting_row",
  "escalated",
  "agreeing",
] as const;

export type PendingClaimBucket = (typeof PENDING_CLAIM_BUCKETS)[number];

/* ── the rows ────────────────────────────────────────────────────────────── */

/** The `pending_claims` view's classification columns — migration `20260901000004`. */
export interface PendingClaimRow {
  observation_id: string;
  /** The view spells the canonical table `domain` (ARCHITECTURE.md §6 trap 1). */
  domain: string;
  entity_id: string | null;
  field: string;
  source_id: string;
  bucket: PendingClaimBucket;
  /** Named only on `awaiting_row`; null in every other bucket. */
  unmet_requirement: string | null;
}

/**
 * A claim with the instant the source observed it — the claim's AGE, which
 * every claims surface renders.
 *
 * The column is `observations.observed_at`, carried through the view unchanged
 * by the scraper handoff (admin-window/BUG-0138). Upstream it is `NOT NULL`,
 * so a null instant is defensive rather than expected: a claim carrying one
 * sorts last and renders the dash — never "now", and never dropped.
 */
export interface ClaimRow extends PendingClaimRow {
  observed_at: string | null;
}

/* ── the line a list renders ─────────────────────────────────────────────── */

/**
 * One claim as a claims LIST renders it — the shape
 * `src/components/claims/claim-list.tsx` takes, built here so the first screen
 * and the route handler that continues it hand over the same rows.
 *
 * **A source is NAMED, never spelled as a uuid** (admin-window/BUG-0043): the
 * cell says `ticketmaster` while its link still narrows by `source_id`, so one
 * screen never carries two labels for one destination. An id the registry has
 * no row for stays on screen verbatim — the id is then the only true thing the
 * app can say. That fallback is `sourceLabel`'s and only `sourceLabel`'s
 * (`lib/sources/names.ts`), and since admin-window/BUG-0154 it answers a row
 * whose name has no INK the same way.
 *
 * **Every claim leads somewhere twice** (LOOK_AND_FEEL bar 10): to its SOURCE,
 * and to the record where its fact's provenance is shown — each one click,
 * each a real URL. A claim whose record does not exist yet has no provenance
 * link, which the row says in its own words.
 */
export interface ClaimLine {
  /** `pending_claims.observation_id` — the claim, and the row's key. */
  observationId: string;
  bucket: string;
  domain: string;
  field: string;
  /** The canonical row this claim is about; null while it has none. */
  entityId: string | null;
  /** The claim's source, as the machine keys it — what the link narrows by. */
  sourceId: string;
  /**
   * What that source is CALLED: the registry's `sources.source`, which is the
   * name `/sources`, `/browse` and every provenance line already show — or the
   * id verbatim when the registry names nothing readable for it: no row, or a
   * row whose name has no ink in it (admin-window/BUG-0043, BUG-0154;
   * `sourceLabel` in `lib/sources/names.ts`).
   */
  source: string;
  /** When the claim was made — `observations.observed_at`; null if unknown. */
  observedAt: string | null;
  /** What an `awaiting_row` claim still needs, named. Null in other buckets. */
  unmetRequirement: string | null;
  /** The source's page, narrowed to it. */
  sourceHref: string;
  /** Where the fact's provenance is shown, or null when there is no row yet. */
  provenanceHref: string | null;
}

/**
 * One claim, as the list renders it: its row, its age, and its two links.
 *
 * The source is carried twice on purpose (admin-window/BUG-0043): `sourceId`
 * is the machine value the link narrows by and the row is keyed on, `source`
 * is what the cell SAYS — the registry's name, or that same id verbatim when
 * the registry holds no row for it.
 *
 * One claim as the list renders it, in the order the database returned them.
 */
export function claimLines(
  claims: readonly ClaimRow[],
  names: ReadonlyMap<string, string>,
): ClaimLine[] {
  // In the order the database returned them, unchanged: the window read is
  // `observed_at asc, observation_id asc` over a `.range()` of its own, so a
  // re-sort here could only disagree with the rows that were selected
  // (admin-window/BUG-0138, admin-window/TASK-0065).
  return claims.map((claim) => ({
    observationId: claim.observation_id,
    bucket: claim.bucket,
    domain: claim.domain,
    field: claim.field,
    entityId: claim.entity_id,
    sourceId: claim.source_id,
    source: sourceLabel(names, claim.source_id),
    observedAt: claim.observed_at,
    unmetRequirement: claim.unmet_requirement,
    sourceHref: sourceHref(claim.source_id),
    provenanceHref: recordHref(claim.domain, claim.entity_id),
  }));
}
