/**
 * The only place a table or view name is spelled (ARCHITECTURE.md §4 rule 4).
 *
 * A page, a component or a `lib/**` module containing the literal
 * `"review_items"` is a defect: a typo'd name must be one grep away, and the
 * not-provisioned card must name the same string the query used. Adding a name
 * here is the only way a new object enters the app.
 *
 * The names are the scraper repo's — schema truth is
 * `kspace Scraper/supabase/migrations/`, never this file.
 * `verdicts` does not exist yet (it arrives with M2's handoff migration); it is
 * named here on purpose, so a read of it classifies as `not_provisioned`
 * against today's database instead of being spelled inline later.
 */
export const T = {
  reviewItems: "review_items",
  observations: "observations",
  fieldProvenance: "field_provenance",
  pendingClaims: "pending_claims",
  sources: "sources",
  resolutionRuns: "resolution_runs",
  runs: "runs",
  events: "events",
  eventListings: "event_listings",
  venues: "venues",
  groups: "groups",
  idols: "idols",
  eventPerformers: "event_performers",
  verdicts: "verdicts",
} as const;

/** The key side of `T` — e.g. `"reviewItems"`. */
export type TableKey = keyof typeof T;

/** The value side of `T` — e.g. `"review_items"`. */
export type TableName = (typeof T)[TableKey];

/** Every name in `T`, for structural tests and for exhaustive iteration. */
export const TABLE_NAMES: readonly TableName[] = Object.values(T);
