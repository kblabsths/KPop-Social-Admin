/**
 * The record surface's URL — campaign admin-window/DEBT-0001.
 *
 * A PURE DOMAIN LEAF, the sibling of `provenance.ts` (ARCHITECTURE.md §4
 * rule 7): it imports NOTHING, so nothing it is called from can be dragged
 * into it and no directory-level cycle can be written through it. It lives
 * here rather than in `lib/browse/rows.ts` or `lib/claims/filters.ts` because
 * both of those are leaves too, and the module map draws `lib/<leaf>/** ->
 * (nothing)`: a leaf importing a leaf is a sideways arrow the contract does
 * not have. Everything above the leaves — `app/**`, `components/**`,
 * `lib/db/**`, `tests/**` — imports this module directly.
 *
 * **This is the one place in `src/` that spells `/records/<domain>/<id>`.**
 * It used to be two, one in `lib/claims/filters.ts` and one in
 * `lib/browse/rows.ts`, which agreed only because two people wrote
 * `encodeURIComponent` the same way — and two spellings of one route is one
 * route that can drift (admin-window/DEBT-0001).
 */

/**
 * The record surface for one canonical row: `/records/<domain>/<id>` — where
 * that record's fields, and the provenance of each of them, are shown at the
 * fact (LOOK_AND_FEEL bar 5: provenance shows at the fact, and there is no
 * provenance page). One URL for every domain: an event row in Browse, a
 * claim's record in Claims, a reference column on the edit surface.
 *
 * `null` when there is no canonical row to link to (`entityId` null or empty)
 * — which is exactly what puts a claim in `awaiting_row`. There is no fact to
 * show provenance for, so the caller names what it is waiting for, or renders
 * the row unlinked, instead of offering a link to something that does not
 * exist. Callers that "always" have an id get the null branch anyway: a
 * second, non-null variant is the drift this one function exists to remove.
 *
 * BOTH halves are percent-encoded, because both are data: an id carrying a
 * `/` or a `?` would otherwise change the path it is supposed to name.
 *
 * It does NOT ask the edit config whether the domain has a surface, though the
 * question is tempting: that map has exactly four consumers and a fifth is a
 * second allowlist growing (`tests/offline/edit/config.test.ts`). A domain
 * with no surface is answered by the route rather than by a second copy of the
 * map: `next.config.ts` rewrites such a URL to a path no route matches, so the
 * operator gets the app's framed 404 (admin-window/BUG-0017), and today every
 * domain the registry can classify a claim into is in the map.
 */
export function recordHref(
  domain: string,
  entityId: string | null,
): string | null {
  if (entityId === null || entityId.length === 0) return null;
  return `/records/${encodeURIComponent(domain)}/${encodeURIComponent(entityId)}`;
}
