/**
 * Browse's curated views — the definition layer (campaign
 * admin-window/TASK-0015).
 *
 * Spec §4: "each view is defined in code — the query, the columns it may show,
 * the default sort — with a runtime column selector over the configured set".
 * This file IS that definition, and v1 ships exactly one view:
 * `RECENT_EVENTS`. A second view is a later decision, not a builder's, so
 * `BROWSE_VIEWS` is asserted to hold one entry rather than merely happening to.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it imports nothing that can
 * reach a database — not `lib/db/**`, not `@supabase/supabase-js`, not
 * `process.env` — and `lib/db/browse.ts` imports it, never the other way. So
 * the view cannot spell a table name either (§4 rule 4, `lib/db/tables.ts`);
 * what it carries is the SHAPE of its query — the sort field, its direction
 * and the size of the window — and `lib/db/browse.ts` binds that to `T`.
 *
 * The column selector's whole behaviour lives here as pure functions over the
 * URL's value, which is what makes "the option set equals the configured set"
 * and "the state round-trips through the URL" testable without a browser.
 */

/** Every column any Browse view may configure. */
export type BrowseColumnKey =
  | "title"
  | "starts_at"
  | "venue"
  | "description"
  | "poster"
  | "sources"
  | "arrived";

/** One configurable column: its key and the `micro` label above it. */
export interface BrowseColumn {
  readonly key: BrowseColumnKey;
  readonly label: string;
}

/**
 * A view's default sort. `field` is the ROW property it orders on and
 * `direction` how; `lib/db/browse.ts` turns the pair into the server-side
 * order and `lib/browse/rows.ts` into the display order.
 */
export interface BrowseSort {
  readonly field: "created_at";
  readonly direction: "desc";
}

/** A curated view: its query's shape, the columns it may show, its sort. */
export interface BrowseView {
  /** Stable id — the view's name in code and in a URL, never prose. */
  readonly id: string;
  /** The heading the section renders. */
  readonly title: string;
  /** Every column this view MAY show, in the fixed order it shows them. */
  readonly columns: readonly BrowseColumn[];
  /** The subset shown when the URL says nothing about columns. */
  readonly defaultColumns: readonly BrowseColumnKey[];
  /** The default sort — Browse has no sortable headers; this is the view. */
  readonly sort: BrowseSort;
  /**
   * How many rows the window holds. Browse is a WINDOW read
   * (ARCHITECTURE.md §4.3): the page names the window it shows rather than
   * claiming to show every event, because `events` is a growing catalog and a
   * complete read of it would refuse the day it passes the platform row cap.
   *
   * It also bounds the `.in(...)` id sets the provenance and venue legs build,
   * which is why it stays at or below `ID_CHUNK` (100) in `lib/db/gauges.ts`.
   */
  readonly window: number;
}

/**
 * The one v1 view: **recent events**.
 *
 * "Everything that came through the pipeline, newest first" — that is ARRIVAL
 * order, `events.created_at desc` (ARCHITECTURE.md §11), not the calendar.
 * `starts_at` is a column this view shows and never its sort.
 *
 * The configured set is the spot-verification columns spec §4 names — title,
 * description, poster image, date, venue and the source(s) behind the row —
 * plus `arrived`, the column the sort is actually on, so the operator can read
 * the order the page claims instead of taking it on faith. Every one of them
 * is on by default: the selector exists to take a column AWAY when the
 * operator is verifying one thing, not to hide the view's own subject.
 */
export const RECENT_EVENTS: BrowseView = {
  id: "recent-events",
  title: "Recent events",
  columns: [
    { key: "title", label: "Title" },
    { key: "starts_at", label: "Starts (UTC)" },
    { key: "venue", label: "Venue" },
    { key: "description", label: "Description" },
    { key: "poster", label: "Poster" },
    { key: "sources", label: "Sources" },
    { key: "arrived", label: "Arrived" },
  ],
  defaultColumns: [
    "title",
    "starts_at",
    "venue",
    "description",
    "poster",
    "sources",
    "arrived",
  ],
  sort: { field: "created_at", direction: "desc" },
  window: 50,
} as const;

/**
 * Every view Browse offers. **Exactly one in v1** — spec §4 and the ticket:
 * "no whole-table browsing, no free-SQL runner, no second curated view".
 */
export const BROWSE_VIEWS: readonly BrowseView[] = [RECENT_EVENTS] as const;

/** The `searchParams` key the column selector's state lives in. */
export const COLUMNS_PARAM = "cols";

/** The keys a view configures, in the view's own order. */
export function configuredKeys(view: BrowseView): BrowseColumnKey[] {
  return view.columns.map((column) => column.key);
}

/** Deterministic, locale-independent ordering by the view's column order. */
function inViewOrder(
  view: BrowseView,
  keys: Iterable<BrowseColumnKey>,
): BrowseColumnKey[] {
  const wanted = new Set(keys);
  return configuredKeys(view).filter((key) => wanted.has(key));
}

/**
 * The value of the `cols` param, as `searchParams` can hand it over: absent, a
 * single string, or an array when the URL repeats the key.
 */
export type ColumnsParam = string | string[] | undefined;

/**
 * The columns to show, from the URL.
 *
 * Absent, empty, or naming nothing this view configures ⇒ the view's default
 * set: the URL saying nothing about columns is a real state, not an error, and
 * a view with no columns is not a view. Anything OUTSIDE the configured set is
 * ignored rather than honoured — a hand-typed `cols=secret_column` can only
 * ever select from what the view already offers.
 *
 * Duplicates collapse and the result is always in the view's own column order,
 * so `?cols=venue,title` and `?cols=title,venue,venue` render identically. The
 * selector is about WHICH columns show, never in what order.
 */
export function shownColumns(
  view: BrowseView,
  param: ColumnsParam,
): BrowseColumnKey[] {
  const raw = (Array.isArray(param) ? param : [param ?? ""])
    .join(",")
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

  const configured = new Set<string>(configuredKeys(view));
  const named = raw.filter((piece): piece is BrowseColumnKey =>
    configured.has(piece),
  );
  if (named.length === 0) return inViewOrder(view, view.defaultColumns);
  return inViewOrder(view, named);
}

/** The `cols` value for a set of keys — the inverse of `shownColumns`. */
export function columnsParamValue(keys: readonly BrowseColumnKey[]): string {
  return keys.join(",");
}

/** Do these two key sets hold the same keys? Order is not part of the state. */
function sameKeys(
  a: readonly BrowseColumnKey[],
  b: readonly BrowseColumnKey[],
): boolean {
  if (a.length !== b.length) return false;
  const inA = new Set(a);
  return b.every((key) => inA.has(key));
}

/**
 * The set after toggling one column.
 *
 * Toggling changes EXACTLY that column: every other key keeps its state, and
 * the result stays in the view's order. Toggling off the last remaining column
 * is a no-op — it returns the set unchanged — because the selector never
 * offers a view with nothing in it, and because an empty `cols` value is
 * indistinguishable from an absent one (which means "the default set").
 */
export function toggledColumns(
  view: BrowseView,
  shown: readonly BrowseColumnKey[],
  key: BrowseColumnKey,
): BrowseColumnKey[] {
  if (!configuredKeys(view).includes(key)) return inViewOrder(view, shown);
  if (shown.includes(key)) {
    if (shown.length <= 1) return inViewOrder(view, shown);
    return inViewOrder(
      view,
      shown.filter((each) => each !== key),
    );
  }
  return inViewOrder(view, [...shown, key]);
}

/**
 * The URL that shows exactly `keys`.
 *
 * The default set is spelled by OMITTING the param: "the URL says nothing
 * about columns" is how the default state is written, so a link back to the
 * default is the page's own bare path and no bookmark carries redundant state.
 */
export function columnsHref(
  view: BrowseView,
  path: string,
  keys: readonly BrowseColumnKey[],
): string {
  if (sameKeys(keys, view.defaultColumns)) return path;
  return `${path}?${COLUMNS_PARAM}=${encodeURIComponent(columnsParamValue(keys))}`;
}

/** One entry of the column selector. */
export interface BrowseColumnOption {
  readonly key: BrowseColumnKey;
  readonly label: string;
  /** Is this column currently shown? */
  readonly shown: boolean;
  /** The set this option's control moves to. */
  readonly toggled: readonly BrowseColumnKey[];
}

/**
 * The selector's options: **exactly the configured set, in the view's order**
 * — every configured column offered, nothing outside it. There is no path by
 * which a column absent from the definition reaches the selector, which is
 * what makes the acceptance criterion structural rather than a promise.
 */
export function columnOptions(
  view: BrowseView,
  shown: readonly BrowseColumnKey[],
): BrowseColumnOption[] {
  return view.columns.map((column) => ({
    key: column.key,
    label: column.label,
    shown: shown.includes(column.key),
    toggled: toggledColumns(view, shown, column.key),
  }));
}
