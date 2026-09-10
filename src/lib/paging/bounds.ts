/**
 * The paging vocabulary — campaign admin-window/TASK-0063.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it imports NOTHING — not
 * `lib/db/**`, not `@supabase/supabase-js`, not `process.env`, not React, not
 * another leaf. `tests/offline/db/layering.test.ts` names it in the leaf set
 * and pins that on two fixtures.
 *
 * It owns TWO questions, and both are asked on both sides of the wire, which
 * is why they live below every caller (ARCHITECTURE.md §4.3 read kind 3,
 * amended 2026-09-10):
 *
 *  1. **Is this bound one this app may serve?** — `pageBound`, which the route
 *     handler asks of the URL it received. The guard that counts is the
 *     server's (LESSONS 8), and it never clamps: a bound out of range is
 *     refused out loud, naming the bound it was given.
 *  2. **Is this parsed body a page answer at all?** — `isPageAnswer`, which
 *     the client asks of whatever came back, so a foreign body is a refusal
 *     rather than a crash.
 *
 * The route paths and the parameter name are spelled HERE and nowhere else:
 * two route handlers and two client wrappers would otherwise each invent one
 * (LESSONS 5 — a shared spelling gets imported, never retyped).
 */

/** The two surfaces that page, and the ONE spelling of their route paths. */
export const PAGE_ROUTES = {
  claims: "/api/admin/claims/rows",
  browse: "/api/admin/browse/rows",
} as const;

/** A surface that pages. There are two, named by §4.3 and by no ticket. */
export type PagedSurface = keyof typeof PAGE_ROUTES;

/** The URL parameter that carries the bound, spelled once. */
export const OFFSET_PARAM = "offset";

/**
 * The largest offset any bound may name.
 *
 * A ceiling, not a page count: it bounds what a request may ask the database
 * to skip, so a hand-typed or looping bound cannot turn into an unbounded
 * seek. Exhaustion normally ends a set long before this.
 */
export const MAX_PAGE_OFFSET = 100000;

/**
 * The bound a request carried, or the reason it is refused.
 *
 * `bound` is the raw value AS SENT — never a repaired, trimmed or clamped
 * spelling of it (ARCHITECTURE.md common violations row 20: what is SHOWN is
 * what was USED). It is carried in its own field rather than inlined into
 * `reason`, so a renderer boxes it as the foreign text it is (row 15) instead
 * of pasting it into a sentence this app wrote.
 */
export type PageBound =
  | { kind: "ok"; offset: number }
  | { kind: "refused"; reason: string; bound: string };

/**
 * A canonical decimal integer, and nothing else: no sign, no whitespace, no
 * leading zero, no exponent, no fraction, no separator, no other digit script.
 *
 * What is USED must be what was SENT. `Number(" 50")`, `Number("+50")`,
 * `Number("050")`, `Number("50.0")` and `Number("1e2")` are all happy to hand
 * back a usable integer for a bound the caller did not write, and a bound the
 * app repaired for itself is a bound nobody agreed to.
 */
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/;

/**
 * The bound a request carried, refused rather than repaired.
 *
 * `size` is the surface's own window, handed in BY THE SERVER; it is never
 * read from the URL — a caller-chosen page size is not part of this mechanism
 * (§4.3 read kind 3, "the size is the surface's own window").
 *
 * A bound is `ok` only when it is a canonical decimal integer that is a
 * multiple of `size`, at least `size`, and at most `MAX_PAGE_OFFSET`. Each
 * other case is refused, naming the bound:
 *
 *  - **absent or empty** — the handler serves what comes AFTER the first
 *    screen, so an unstated bound is a refusal, never a defaulted 0;
 *  - **not canonical** — every spelling listed above `CANONICAL_DECIMAL`;
 *  - **below `size`** — the first screen is the server's, not a page;
 *  - **not a multiple of `size`** — a bound between two screens would either
 *    repeat rows or skip them;
 *  - **above `MAX_PAGE_OFFSET`**.
 *
 * **It never clamps** (M3 EC6) and it never throws. A `size` that is not a
 * positive integer is refused too: no bound can be checked against a window
 * that is not one, and the honest answer to "which offsets are multiples of
 * 0?" is a refusal rather than a guess.
 */
export function pageBound(raw: string | null | undefined, size: number): PageBound {
  const bound = raw ?? "";
  const refuse = (reason: string): PageBound => ({ kind: "refused", reason, bound });

  if (!Number.isInteger(size) || size <= 0) {
    return refuse("this surface has no window size to page by, so no bound can be honoured");
  }
  if (raw === null || raw === undefined) {
    return refuse(`the request named no \`${OFFSET_PARAM}\`, and a page must say how many rows it already holds`);
  }
  if (bound.length === 0) {
    return refuse(`the \`${OFFSET_PARAM}\` was empty, and a page must say how many rows it already holds`);
  }
  if (!CANONICAL_DECIMAL.test(bound)) {
    return refuse(
      `the \`${OFFSET_PARAM}\` must be a plain decimal number — no sign, no spaces, no leading zero, no decimal point and no exponent`,
    );
  }

  const offset = Number(bound);
  if (offset < size) {
    return refuse(`the \`${OFFSET_PARAM}\` must be at least ${size}: the first ${size} rows are the screen the server already rendered`);
  }
  if (offset % size !== 0) {
    return refuse(`the \`${OFFSET_PARAM}\` must be a multiple of ${size}, the window this surface pages by`);
  }
  if (offset > MAX_PAGE_OFFSET) {
    return refuse(`the \`${OFFSET_PARAM}\` must be at most ${MAX_PAGE_OFFSET}`);
  }
  return { kind: "ok", offset };
}

/**
 * What a paging request answers — the JSON shape, on both sides of the wire.
 *
 * The three arms of `DbResult` (§4.1) plus the bound refusal, so a refused
 * page reaches the client naming the SAME object the page's own
 * not-provisioned card would name. `exhausted` is the read's own answer about
 * the end of the set; no arm ever carries a total (§4.3: a concatenation is
 * still not a total).
 */
export type PageAnswer<Row> =
  | { kind: "ok"; rows: Row[]; offset: number; exhausted: boolean }
  | { kind: "not_provisioned"; missing: string }
  | { kind: "error"; reading: string; message: string }
  | { kind: "refused"; reason: string; bound: string };

/** Every field of `shape` present on `value` with the type named. */
function hasFields(value: object, shape: Record<string, "string" | "number" | "boolean" | "array">): boolean {
  const record = value as Record<string, unknown>;
  return Object.entries(shape).every(([field, kind]) =>
    kind === "array" ? Array.isArray(record[field]) : typeof record[field] === kind,
  );
}

/**
 * Is this parsed body a `PageAnswer` at all? A foreign body is a refusal,
 * never a crash.
 *
 * Asked of `unknown` — whatever a route, a proxy, an error page or a logged-out
 * redirect actually put on the wire — so every arm's own fields are checked,
 * not just the discriminant. A body that says `kind: "ok"` and carries no
 * `rows` array is exactly the shape that would otherwise reach a `[...rows]`
 * spread and throw.
 */
export function isPageAnswer(value: unknown): value is PageAnswer<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  switch (kind) {
    case "ok":
      return hasFields(value, { rows: "array", offset: "number", exhausted: "boolean" });
    case "not_provisioned":
      return hasFields(value, { missing: "string" });
    case "error":
      return hasFields(value, { reading: "string", message: "string" });
    case "refused":
      return hasFields(value, { reason: "string", bound: "string" });
    default:
      return false;
  }
}
