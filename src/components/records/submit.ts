import type { SaveOutcome } from "@/components/EditableCell";
import { scalarText } from "./values";

/**
 * The browser's call to the app's ONE write route
 * (campaign admin-window/TASK-0018; the route is
 * `src/app/api/admin/records/[table]/[id]/route.ts`, TASK-0017).
 *
 * Judgment recorded. ARCHITECTURE.md §4 rule 1 says a component "never
 * fetches" — that rule is about SERVER reads: a surface must render from plain
 * props so it is testable with no database, and that property is kept here
 * (nothing on this page reads through this module; it runs only when an
 * operator commits an edit, and `fetch` is a parameter, so the offline suite
 * drives it with no network at all). An inline edit has to reach the route
 * from the browser somewhere, and the widget's own directory is where it
 * belongs; `src/lib/edit/config.ts` may not hold it, being the pure leaf that
 * imports nothing (§4 rule 7).
 *
 * This module makes no decision about WHAT may be edited. The map decides
 * that, at the surface (`fields.ts`) and again, server-side, in the route —
 * a forged request that skips this file entirely is refused there, which is
 * the half that actually holds (acceptance test 7).
 */

/** The route that writes one field of one record. The only mutating URL here. */
export function recordFieldApiPath(table: string, id: string): string {
  return `/api/admin/records/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
}

/** What `submitFieldEdit` calls; `globalThis.fetch` in a browser, a stub in a test. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Write one field, and report what happened in the words the caller was given.
 *
 * `value` is ALWAYS in the body — `null` clears the column, and an omitted key
 * is refused by the route as malformed (admin-window/BUG-0011): a widget bug
 * must never read as "clear this vetted column" and be answered `{"ok":true}`.
 *
 * A refusal carries the route's own message unchanged (LOOK_AND_FEEL: "the app
 * shows what the database said"), and `EditableCell` reverts the field and
 * shows it as the red line. On success the STORED value comes back, so a
 * column the database normalised shows what it actually kept rather than what
 * was typed.
 */
export async function submitFieldEdit(
  table: string,
  id: string,
  field: string,
  next: string | null,
  fetchImpl: FetchLike,
): Promise<SaveOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(recordFieldApiPath(table, id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field, value: next }),
    });
  } catch (thrown) {
    return { ok: false, message: messageOf(thrown) };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const payload = (typeof body === "object" && body !== null ? body : {}) as {
    error?: unknown;
    record?: unknown;
  };

  if (!response.ok) {
    const stated = typeof payload.error === "string" ? payload.error : "";
    return {
      ok: false,
      // A refusal with no readable body still has to name something an
      // operator can act on, so the status stands in rather than a blank line.
      message: stated !== "" ? stated : `the edit was refused (${response.status})`,
    };
  }

  const record = payload.record;
  if (typeof record === "object" && record !== null && field in record) {
    return { ok: true, value: scalarText((record as Record<string, unknown>)[field]) };
  }
  return { ok: true };
}
