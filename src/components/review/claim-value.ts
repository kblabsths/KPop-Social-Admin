import { scalarText } from "@/components/records/values";

/**
 * How a claim's stored value becomes the text a card or a cell shows
 * (campaign admin-window/TASK-0011).
 *
 * `observations.value` is jsonb — the ONE json column in the system
 * (ARCHITECTURE.md §6 trap 8) — and a reference-class value is an object (or
 * an array of them) carrying a `ref` key. So this never assumes a string: a
 * scalar renders as itself, and anything else renders as its JSON text, in the
 * mono `data` type its caller uses.
 *
 * `null` is a real absence and stays one, so the app's single dash
 * (`orDash`/`isAbsent`, `src/lib/format.ts`) renders it like every other
 * missing value rather than the literal word "null".
 *
 * The scalar half is `scalarText` in `src/components/records/values.ts` — the
 * landed one — rather than a second hand-written type switch beside it.
 */
export function claimValueText(value: unknown): string | null {
  const scalar = scalarText(value);
  if (scalar !== null) return scalar;
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
