/**
 * How a stored value becomes the text a cell shows, and back again
 * (campaign admin-window/TASK-0018).
 *
 * Its own module, importing NOTHING, because both sides of the edit need it:
 * the server component that renders the resting value, and the `"use client"`
 * editor that shows what the database actually kept after a write. A second
 * hand-written copy in the client file is how the two would drift.
 *
 * A catalog editable column is a typed scalar (`src/lib/edit/config.ts`); json
 * is written from nowhere in this app. So a value that is NOT a scalar is not
 * a thing this surface can edit as a cell, and `scalarText` says so by
 * returning `null` for it — the caller renders it read-only rather than
 * offering an input over an object it could never send back.
 */

/** The text for a scalar; `null` for an absence AND for a non-scalar. */
export function scalarText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  return null;
}

/**
 * Is this value one this surface could edit as a cell at all?
 *
 * Distinct from `scalarText(v) === null`, which is also true of a real `null`:
 * an empty column is perfectly editable (that is how a value is first set),
 * an object is not.
 */
export function isEditableValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}
