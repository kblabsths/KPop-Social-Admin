/**
 * The paging vocabulary — campaign admin-window/TASK-0063, rewritten for PAGE
 * WINDOWS on 2026-10-16 (Ben's ruling of 2026-09-11: "only show items 1-50 or
 * 51-100 at a time (adjustable as 20, 50, and 100)").
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it imports NOTHING — not
 * `lib/db/**`, not `@supabase/supabase-js`, not `process.env`, not React, not
 * another leaf. `tests/offline/db/layering.test.ts` names it in the leaf set
 * and pins that on two fixtures.
 *
 * It owns THREE questions, and every one is asked on both sides of the wire,
 * which is why they live below every caller (ARCHITECTURE.md §4.3 read kind 3):
 *
 *  1. **Which window does this URL name, and may this app serve it?** —
 *     `windowBound`, which the two PAGES ask of their `searchParams` on a cold
 *     load and the two ROUTE HANDLERS ask of the query a client request
 *     carries. The guard that counts is the server's (LESSONS 8), and it never
 *     clamps: a window out of range is refused out loud, naming the parameter
 *     and the value it was given.
 *  2. **Where does a window START, and which window holds a given row?** —
 *     `offsetOf`, `firstRowOf`, `containingWindow`: the arithmetic every
 *     sentence, every read and every control shares, spelled once.
 *  3. **Is this parsed body a page answer at all?** — `isPageAnswer`, which
 *     the client asks of whatever came back, so a foreign body is a refusal
 *     rather than a crash.
 *
 * The route paths and the parameter names are spelled HERE and nowhere else:
 * two route handlers, two pages and one client control would otherwise each
 * invent one (LESSONS 5 — a shared spelling gets imported, never retyped).
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

/**
 * The URL parameters that name a window — on the PAGE's own address
 * (`/claims?page=3&size=20`) and on the route request the client makes, in
 * the same two spellings. Page position lives in the URL (LOOK_AND_FEEL bar
 * 11): reload, Back and a shared link land on the window the address names.
 */
export const PAGE_PARAM = "page";
export const SIZE_PARAM = "size";

/**
 * The window sizes an operator may choose — Ben's three, and no other
 * (2026-09-11). A `?size=` naming any other number is refused, never rounded
 * to the nearest of these.
 */
export const WINDOW_SIZES = [20, 50, 100] as const;
export type WindowSize = (typeof WINDOW_SIZES)[number];

/** The size a URL that names none pages by. */
export const DEFAULT_WINDOW_SIZE: WindowSize = 50;

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
 * the first screen and its other windows would be ONE surface under TWO cache
 * policies.
 *
 * Declared HERE, once, beside `PAGE_ROUTES` and the parameter names — the
 * vocabulary both routes already share — because a second string typed into a
 * second route is how the two drift (LESSONS 5). Every arm of every paging
 * answer carries it: the `ok` page, `not_provisioned`, `error` and the 400
 * refusal alike.
 */
export const PAGE_ANSWER_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";

/**
 * The largest offset any window may START at.
 *
 * A ceiling, not a page count: it bounds what a request may ask the database
 * to skip, so a hand-typed or looping page number cannot turn into an
 * unbounded seek. Exhaustion normally ends a set long before this. A window
 * whose first row would sit past it is refused by name, and the control
 * offers no "next" into it (`stoppedAtTheCeiling`, `components/ui/paging.tsx`).
 */
export const MAX_PAGE_OFFSET = 100000;

/**
 * ONE WINDOW, NAMED: its 1-based position in the order and how many rows it
 * holds at most. Two numbers, and they are the whole of what the URL says.
 */
export interface PageWindow {
  readonly page: number;
  readonly size: WindowSize;
}

/** Two windows are the same window exactly when both numbers agree. */
export function sameWindow(a: PageWindow, b: PageWindow): boolean {
  return a.page === b.page && a.size === b.size;
}

/** Where a window STARTS in the order — the `.range()` offset of its read. */
export function offsetOf(window: PageWindow): number {
  return (window.page - 1) * window.size;
}

/** The 1-based index of the first row a window holds — what a sentence says. */
export function firstRowOf(window: PageWindow): number {
  return offsetOf(window) + 1;
}

/**
 * THE WINDOW AT ANOTHER SIZE THAT HOLDS THIS WINDOW'S FIRST ROW — design
 * question 1 of the page-windows ticket, answered once here.
 *
 * On rows 51–100 at size 50, switching to 20 lands on rows 41–60 (page 3),
 * because row 51 is in it; switching to 100 lands on rows 1–100 (page 1).
 * The operator keeps the row they were reading from; nothing jumps to the
 * start and nothing rounds to the "nearest" page.
 */
export function containingWindow(window: PageWindow, size: WindowSize): PageWindow {
  return { page: Math.floor(offsetOf(window) / size) + 1, size };
}

/** The window after this one, at the same size. `null` for a page below 1. */
export function nextWindow(window: PageWindow): PageWindow {
  return { page: window.page + 1, size: window.size };
}

/** The window before this one, or `null` on the first. */
export function previousWindow(window: PageWindow): PageWindow | null {
  return window.page <= 1 ? null : { page: window.page - 1, size: window.size };
}

/**
 * The window a URL named, or the reason it is refused.
 *
 * `param` and `bound` are the parameter's NAME and its raw value AS SENT —
 * never a repaired, trimmed or clamped spelling of it (ARCHITECTURE.md common
 * violations row 20: what is SHOWN is what was USED). They are carried in
 * their own fields rather than inlined into `reason`, so a renderer boxes them
 * as the foreign text they are (row 15) instead of pasting them into a
 * sentence this app wrote.
 */
export type WindowBound =
  | { kind: "ok"; window: PageWindow; offset: number }
  | { kind: "refused"; reason: string; param: string; bound: string };

/**
 * A canonical decimal integer, and nothing else: no sign, no whitespace, no
 * leading zero, no exponent, no fraction, no separator, no other digit script.
 *
 * What is USED must be what was SENT. `Number(" 50")`, `Number("+50")`,
 * `Number("050")`, `Number("50.0")` and `Number("1e2")` are all happy to hand
 * back a usable integer for a value the caller did not write, and a value the
 * app repaired for itself is a value nobody agreed to.
 */
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/;

/** The raw window parameters as a page or a route receives them. */
export interface RawWindow {
  readonly page: string | null | undefined;
  readonly size: string | null | undefined;
}

/**
 * The window a URL named, refused rather than repaired.
 *
 * ABSENT means the default, on both sides of the wire: a page with no
 * `?page=` is the first window, and one with no `?size=` pages by
 * `DEFAULT_WINDOW_SIZE`. That is a stated default and not a repair — `/claims`
 * with no parameters has always rendered its first window — and it is the
 * same rule for the route so the client never has to spell a default of its
 * own. PRESENT means verbatim: an empty value, a non-canonical spelling, a
 * page below 1, a size that is not one of `WINDOW_SIZES`, or a window whose
 * first row would sit past `MAX_PAGE_OFFSET` is refused, naming the parameter
 * and the value it was given.
 *
 * **It never clamps** (M3 EC6; design question 2 of the page-windows ticket)
 * and it never throws. `?page=999` is NOT refused by this function when its
 * offset is under the ceiling: whether rows exist there is the READ's to
 * answer, and an empty window is still a window (§4.3) — the surface states
 * that the read happened and found nothing at it, and offers the way back.
 */
export function windowBound(raw: RawWindow): WindowBound {
  const sizeRaw = raw.size ?? null;
  const pageRaw = raw.page ?? null;

  let size: WindowSize = DEFAULT_WINDOW_SIZE;
  if (sizeRaw !== null) {
    const refuse = (reason: string): WindowBound => ({
      kind: "refused",
      reason,
      param: SIZE_PARAM,
      bound: sizeRaw,
    });
    if (sizeRaw.length === 0) {
      return refuse(`the \`${SIZE_PARAM}\` was empty, and a window must say how many rows it holds`);
    }
    if (!CANONICAL_DECIMAL.test(sizeRaw)) {
      return refuse(
        `the \`${SIZE_PARAM}\` must be a plain decimal number — no sign, no spaces, no leading zero, no decimal point and no exponent`,
      );
    }
    const asked = Number(sizeRaw);
    const known = WINDOW_SIZES.find((each) => each === asked);
    if (known === undefined) {
      return refuse(`the \`${SIZE_PARAM}\` must be one of ${WINDOW_SIZES.join(", ")}`);
    }
    size = known;
  }

  let page = 1;
  if (pageRaw !== null) {
    const refuse = (reason: string): WindowBound => ({
      kind: "refused",
      reason,
      param: PAGE_PARAM,
      bound: pageRaw,
    });
    if (pageRaw.length === 0) {
      return refuse(`the \`${PAGE_PARAM}\` was empty, and a window must say which one it is`);
    }
    if (!CANONICAL_DECIMAL.test(pageRaw)) {
      return refuse(
        `the \`${PAGE_PARAM}\` must be a plain decimal number — no sign, no spaces, no leading zero, no decimal point and no exponent`,
      );
    }
    page = Number(pageRaw);
    if (page < 1) {
      return refuse(`the \`${PAGE_PARAM}\` must be at least 1: the first window is window 1`);
    }
    const offset = (page - 1) * size;
    if (offset > MAX_PAGE_OFFSET) {
      return refuse(
        `the \`${PAGE_PARAM}\` must be at most ${largestPage(size)} at a size of ${size}: this app serves no window starting past row ${MAX_PAGE_OFFSET + 1}`,
      );
    }
  }

  const window: PageWindow = { page, size };
  return { kind: "ok", window, offset: offsetOf(window) };
}

/** The largest page number `windowBound` serves at a size — the ceiling, as a page. */
export function largestPage(size: WindowSize): number {
  return Math.floor(MAX_PAGE_OFFSET / size) + 1;
}

/**
 * A query string with THIS window written into it — the one composition every
 * URL that names a window goes through: the route request a press makes and
 * the `href` every control carries.
 *
 * The window OVERRIDES rather than joins: whatever a surface serialized into
 * `facets`, the query this returns carries each of the two parameters exactly
 * ONCE and that occurrence is this window. It is composed with
 * `URLSearchParams`, not by concatenation, because appending is not overriding
 * (admin-window/BUG-0166): `?page=9&page=4` is a legal query whose FIRST
 * occurrence is what a handler reading `searchParams.get()` gets. `delete` then
 * `append` so the window is written LAST and the surface's own facets survive
 * in the order the caller wrote them; a leading `?` or `&` on `facets` is
 * tolerated because a caller composing a query string has every reason to
 * include one.
 */
export function windowQuery(facets: string, window: PageWindow): string {
  const query = new URLSearchParams(facets.replace(/^[?&]+/, "").replace(/&+$/, ""));
  query.delete(PAGE_PARAM);
  query.delete(SIZE_PARAM);
  query.append(PAGE_PARAM, String(window.page));
  query.append(SIZE_PARAM, String(window.size));
  return query.toString();
}

/**
 * The arm that carries ROWS, named so a surface can extend it without
 * re-spelling the whole answer.
 *
 * `exhausted` is the read's own answer about the end of the set; it never
 * carries a total (§4.3: a window is still not a total), and `page`/`size`
 * ECHO the window the request named rather than being recomputed from
 * `rows.length`.
 */
export interface PageOk<Row> {
  kind: "ok";
  rows: Row[];
  page: number;
  size: number;
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
  | { kind: "refused"; reason: string; param: string; bound: string };

/**
 * What a paging request answers — the JSON shape, on both sides of the wire.
 *
 * The three arms of `DbResult` (§4.1) plus the window refusal, so a refused
 * window reaches the client naming the SAME parameter the page's own refusal
 * card would name.
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
 *    existed: the whole account is the machine's, drawn wholly in mono;
 *  - **the field is a SEGMENT LIST** — every element carries words and one of
 *    the two authors (`isAccountSegments`).
 *
 * A field that is PRESENT and is neither is foreign data, and the answer is
 * refused whole — the same call `isPageNotes` makes about a leg's report.
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
 * which is what lets a surface render a window's note through the same
 * primitive the first screen uses — and this leaf still names no `DbResult`,
 * not even as a type (ARCHITECTURE.md §4 rule 7).
 *
 * The window refusal is deliberately NOT an arm: a leg does not carry a
 * window, and the window was already accepted by the time a leg ran.
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
 * foreign data is a refusal, never something a surface renders. A record
 * carrying ANY value that is not a note or `null` is not a notes record — one
 * unreadable leg refuses the whole window rather than being skipped, which
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
 * those reports above the table — so a window whose provenance leg refused
 * must not reach the client as events with a silently empty Sources column.
 * **The legs travel with the answer or not at all.**
 *
 * The notes ride the `ok` arm ONLY: the other three arms have no rows and so
 * no columns for a leg to have failed to fill. `Notes` is the surface's own
 * type — this leaf may not name a `DbResult`, not even as a type (§4 rule 7),
 * which is why the shape is a parameter and `lib/db/browse.ts` supplies it.
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
      return hasFields(value, { rows: "array", page: "number", size: "number", exhausted: "boolean" });
    case "not_provisioned":
      return hasFields(value, { missing: "string" });
    case "error":
      return (
        hasFields(value, { reading: "string", message: "string" }) &&
        carriesReadableAuthorship(value)
      );
    case "refused":
      return hasFields(value, { reason: "string", param: "string", bound: "string" });
    default:
      return false;
  }
}

/**
 * DID THE SET END WITHIN THIS WINDOW — the ONE derivation of `exhausted`,
 * asked by the route of the rows its read returned and by each page of the
 * rows its first screen read (ARCHITECTURE.md §4.3 kind 3, full-or-exhausted).
 *
 * A window that came back SHORT of its size returned everything past its
 * start, so the set ends inside it; a FULL window says nothing about what
 * follows. No count is consulted: a count and a window are two reads.
 */
export function endsWithin(served: number, size: number): boolean {
  return served < size;
}

/**
 * The two window parameters as a PAGE receives them — Next hands
 * `searchParams` over as `string | string[] | undefined` per key — reduced to
 * the FIRST value of each, as `URLSearchParams.get()` answers it. One
 * spelling for both pages and the browse route (LESSONS 5).
 */
export function rawWindowOf(
  params: Readonly<Record<string, string | string[] | undefined>>,
): RawWindow {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  return { page: first(params[PAGE_PARAM]), size: first(params[SIZE_PARAM]) };
}
