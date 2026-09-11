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
 *
 * Its ONE import is another leaf, `../account/authored` — the app's one
 * spelling of "who wrote these words" and the one validator of its shape, so
 * the error arm's authorship crosses the wire in the vocabulary the author
 * used (rule 7 ¶2, admin-window/BUG-0196).
 */

// ONE LINE, deliberately: the leaf-closure guard in
// `tests/offline/db/layering.test.ts` reads imports LINE BY LINE.
import { isAccountSegments, type AccountSegment } from "../account/authored";

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
 * What a paging route answers `Cache-Control` with — the SAME directives every
 * gated PAGE in this app already answers (admin-window/TASK-0068).
 *
 * Next sets exactly this string on a dynamically rendered page
 * (`node_modules/next/dist/server/base-server.js`, read on 16.2.2), so every
 * screen behind the sign-in gate is already unstorable. A Route Handler
 * answers with NO `Cache-Control` at all unless it writes one — and the rows
 * these routes serve are the only admin answers a browser store, a corporate
 * proxy or anything later placed in front of Railway could keep. Without this
 * the first screen and its continuation would be ONE surface under TWO cache
 * policies.
 *
 * Declared HERE, once, beside `PAGE_ROUTES` and `OFFSET_PARAM` — the
 * vocabulary both routes already share — because a second string typed into a
 * second route is how the two drift (LESSONS 5). Every arm of every paging
 * answer carries it: the `ok` page, `not_provisioned`, `error` and the 400
 * refusal alike.
 */
export const PAGE_ANSWER_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";

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
 * The arm that carries ROWS, named so a surface can extend it without
 * re-spelling the whole answer.
 *
 * `exhausted` is the read's own answer about the end of the set; it never
 * carries a total (§4.3: a concatenation is still not a total), and `offset`
 * ECHOES the bound the request carried rather than being recomputed from
 * `rows.length`.
 */
export interface PageOk<Row> {
  kind: "ok";
  rows: Row[];
  offset: number;
  exhausted: boolean;
}

/**
 * The three arms that carry NO rows, named once so a surface extending the
 * `ok` arm does not re-spell them (and cannot accidentally re-spell one of
 * them differently).
 */
export type PageWithoutRows =
  | { kind: "not_provisioned"; missing: string }
  | { kind: "error"; reading: string; message: string; authored?: readonly AccountSegment[] }
  | { kind: "refused"; reason: string; bound: string };

/**
 * What a paging request answers — the JSON shape, on both sides of the wire.
 *
 * The three arms of `DbResult` (§4.1) plus the bound refusal, so a refused
 * page reaches the client naming the SAME object the page's own
 * not-provisioned card would name.
 */
export type PageAnswer<Row> = PageOk<Row> | PageWithoutRows;

/**
 * The error arm's OPTIONAL authorship, as the wire may carry it — campaign
 * admin-window/BUG-0196.
 *
 * Two answers are `true`, and the difference between them is the whole rule:
 *
 *  - **the field is ABSENT** — the answer says nothing about who wrote its
 *    `message`, and its absence MEANS what this app rendered before the fact
 *    existed: the whole account is the machine's, drawn wholly in mono. A
 *    `{kind, reading, message}` answer — what a forced answer, a live probe
 *    and any client older than this ticket sends — is still a `PageAnswer`,
 *    and a validator made stricter here would refuse it as "something this app
 *    cannot read" and put a fourth question on the wire that §4.1 refuses;
 *  - **the field is a SEGMENT LIST** — every element carries words and one of
 *    the two authors (`isAccountSegments`).
 *
 * A field that is PRESENT and is neither is foreign data, and the answer is
 * refused whole — the same call `isPageNotes` makes about a leg's report:
 * rendering an account this app cannot read is the one thing worse than
 * dropping it, and silently ignoring the field would put the words back in the
 * machine's face while claiming they were graded.
 */
function carriesReadableAuthorship(value: object): boolean {
  const authored = (value as { authored?: unknown }).authored;
  return authored === undefined || isAccountSegments(authored);
}

/** Every field of `shape` present on `value` with the type named. */
function hasFields(value: object, shape: Record<string, "string" | "number" | "boolean" | "array">): boolean {
  const record = value as Record<string, unknown>;
  return Object.entries(shape).every(([field, kind]) =>
    kind === "array" ? Array.isArray(record[field]) : typeof record[field] === kind,
  );
}

/**
 * ONE leg's own report — campaign admin-window/TASK-0076.
 *
 * The two rowless arms, spelled exactly as `PageWithoutRows` spells them.
 * Structurally a `DbUnavailable` and a `StateOf`-renderable `UnavailableRead`,
 * which is what lets a surface render a paged note through the same primitive
 * the first screen uses — and this leaf still names no `DbResult`, not even as
 * a type (ARCHITECTURE.md §4 rule 7).
 *
 * The bound refusal is deliberately NOT an arm: a leg does not carry a bound,
 * and the page's own bound was already accepted by the time a leg ran.
 */
export type PageNote =
  | { kind: "not_provisioned"; missing: string }
  | { kind: "error"; reading: string; message: string; authored?: readonly AccountSegment[] };

/**
 * A surface's legs, by the SURFACE's own key. `null` = that leg answered.
 *
 * The keys are the surface's, never this leaf's: Browse spells `venues` and
 * `provenance` (`lib/db/browse.ts`), and a surface that grows a third leg
 * grows a third key without touching this file.
 */
export type PageNotes = Readonly<Record<string, PageNote | null>>;

/** One leg's report, or `null` — the same shape-check `isPageAnswer` makes. */
function isPageNote(value: unknown): value is PageNote | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  switch ((value as { kind?: unknown }).kind) {
    case "not_provisioned":
      return hasFields(value, { missing: "string" });
    case "error":
      return (
        hasFields(value, { reading: "string", message: "string" }) &&
        carriesReadableAuthorship(value)
      );
    default:
      return false;
  }
}

/**
 * Is this parsed value a notes record at all?
 *
 * The same question `isPageAnswer` asks of the body, asked of the field:
 * foreign data is a refusal, never something a surface renders. Rendering a
 * note this app cannot read is the one thing worse than dropping it, so a
 * record carrying ANY value that is not a note or `null` is not a notes record
 * — one unreadable leg refuses the whole page rather than being skipped, which
 * would be the silently-empty-column defect wearing a different hat.
 *
 * An EMPTY record is a notes record: a surface with no legs that ran still
 * reported, and there is nothing unreadable about it.
 */
export function isPageNotes(value: unknown): value is PageNotes {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isPageNote);
}

/**
 * A page answer whose `ok` arm ALSO carries this surface's own leg notes.
 *
 * Browse is read by FOUR queries (ARCHITECTURE.md §4.3): the events window
 * decides the rows, and the venue and provenance legs FILL columns over that
 * window's ids. Each leg reports its own refusal, and the first screen renders
 * those reports above the table — so a page whose provenance leg refused must
 * not reach the client as events with a silently empty Sources column. **The
 * legs travel with the answer or not at all.**
 *
 * The notes ride the `ok` arm ONLY: the other three arms have no rows and so
 * no columns for a leg to have failed to fill. `Notes` is the surface's own
 * type — this leaf may not name a `DbResult`, not even as a type (§4 rule 7),
 * which is why the shape is a parameter and `lib/db/browse.ts` supplies it.
 *
 * `isPageAnswer` accepts one unchanged: it checks each arm's OWN fields and an
 * extra field is not a missing one, so a client that does not know about notes
 * reads the page exactly as before.
 */
export type NotedPageAnswer<Row, Notes> =
  | (PageOk<Row> & { notes: Notes })
  | PageWithoutRows;


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
      return (
        hasFields(value, { reading: "string", message: "string" }) &&
        carriesReadableAuthorship(value)
      );
    case "refused":
      return hasFields(value, { reason: "string", bound: "string" });
    default:
      return false;
  }
}
