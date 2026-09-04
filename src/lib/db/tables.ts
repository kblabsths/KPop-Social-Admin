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
  // The ONE name here that is NOT the scraper repo's: `walk_sandbox` exists on
  // the staging project only, created by hand, and never in production
  // (ARCHITECTURE.md §9.1, campaign admin-window/TASK-0034).
  walkSandbox: "walk_sandbox",
} as const;

/** The key side of `T` — e.g. `"reviewItems"`. */
export type TableKey = keyof typeof T;

/** The value side of `T` — e.g. `"review_items"`. */
export type TableName = (typeof T)[TableKey];

/** Every name in `T`, for structural tests and for exhaustive iteration. */
export const TABLE_NAMES: readonly TableName[] = Object.values(T);

/** What kind of database object a name in `T` is. */
export type ObjectKind = "table" | "view";

/**
 * Table or view, for every name in `T` — the ONE place the app knows which
 * (campaign admin-window/BUG-0077).
 *
 * A window line ends on this word ("…not the whole table."), and before this
 * map the word was a prop each call site chose by hand: `/claims` and
 * `/sources` render the SAME window — `windowOf` over `observations` — and
 * said "view" and "table" respectively, so one read was described as two.
 * The object a window was read over is a fact of the READ, so it is derived
 * here, from the same constant the query passed to `.from()`, and no renderer
 * gets a say.
 *
 * It belongs in this file for the reason every name does (ARCHITECTURE.md §4
 * rule 4, enforced by `tests/offline/db/layering.test.ts`): the kind is part of
 * what the name means, and a second module holding half the answer is the
 * drift this map exists to end.
 *
 * `Record<TableName, …>` and not a set of views: adding a name to `T` without
 * saying what it is becomes a **compile error** rather than a silent default
 * to "table".
 *
 * The two views are the scraper repo's (`kspace Scraper/supabase/migrations/`,
 * read 2026-09-04): `create or replace view public.pending_claims`
 * (`20260901000004`) and `CREATE VIEW "public"."event_listings"`
 * (`20260825000004`). Every other name is `create table`. `verdicts` does not
 * exist yet and is declared a table because that is what the design that
 * brings it calls it (`contracts/admin-observability.md` §7, "The `verdicts`
 * table"); `walk_sandbox` is the hand-created staging table of
 * ARCHITECTURE.md §9.1.
 */
const OBJECT_KIND: Record<TableName, ObjectKind> = {
  [T.reviewItems]: "table",
  [T.observations]: "table",
  [T.fieldProvenance]: "table",
  [T.pendingClaims]: "view",
  [T.sources]: "table",
  [T.resolutionRuns]: "table",
  [T.runs]: "table",
  [T.events]: "table",
  [T.eventListings]: "view",
  [T.venues]: "table",
  [T.groups]: "table",
  [T.idols]: "table",
  [T.eventPerformers]: "table",
  [T.verdicts]: "table",
  [T.walkSandbox]: "table",
};

/**
 * Is this name a table or a view?
 *
 * Total over `TableName` by construction — there is no "unknown" arm to
 * fall back to, because a name the app can query is a name this file spelled.
 */
export function objectKindOf(name: TableName): ObjectKind {
  return OBJECT_KIND[name];
}
