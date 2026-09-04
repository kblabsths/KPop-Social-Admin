import type { ReactNode } from "react";
import { orDash } from "@/lib/format";
import { cx } from "./cx";

/**
 * The app's default surface, and most pages are one.
 *
 * Surface fill, 1px border, chrome-filled header row of `micro` labels, rows
 * separated by 1px hairlines, hover fills the row with chrome. **No zebra
 * striping and no vertical rules.** Cells are `data`. A null renders as an em
 * dash in disabled-gray — never blank, never `null`, `N/A` or `none`. A table
 * wider than its column scrolls horizontally *inside its own border*; the page
 * does not.
 *
 * Sorting is a link, not a handler: state lives in the URL, so a sorted view
 * is bookmarkable and survives the back button (quality bar 11).
 *
 * **A row the URL asked for is marked** (`marked`, campaign
 * admin-window/BUG-0054): page fill plus a 1px accent rule down its left edge
 * — accent is the palette's selection job, and both are existing tokens, so
 * the mark adds no colour, no shadow, no motion, and no height. Rows the URL
 * did not ask for render exactly as they did before, hover included.
 *
 * Why the fill is `page` and not `chrome-inverse` (the active nav item's
 * device, which is what a marked row would otherwise borrow): a table row
 * carries more than primary text — a red `error_summary`, a secondary
 * "still running", a badge — and quality bar 12 measures every one of those
 * against the fill behind it. Measured against this palette's own tokens,
 * dark theme on chrome-inverse gives broken 3.57:1, accent 3.69:1 and
 * secondary 3.96:1, all under the 4.5:1 bar, while `page` is one of the three
 * fills `tests/offline/ui/contrast.test.ts` already asserts every text job
 * against. So the marked row changes no string's readability.
 */
export type SortDirection = "asc" | "desc";

export type Column<T> = {
  /** React key for the column, and nothing else. */
  key: string;
  /** The `micro` header label. */
  label: string;
  align?: "left" | "right";
  /**
   * Present on a sortable column: the URL that sorts by it, and the direction
   * it is currently sorted in, if it is the active sort.
   */
  sort?: { href: string; active?: SortDirection };
  /**
   * The cell body. Anything absent — `null`, a falsy `flag && ...` body, an
   * empty string, or the em dash a formatting helper returns — renders as the
   * dash in disabled-gray; the cell never decides that itself
   * (`isAbsent` in `src/lib/format.ts`, campaign admin-window/BUG-0004).
   */
  cell: (row: T) => ReactNode;
};

const ARROW: Record<SortDirection, string> = { asc: "↑", desc: "↓" };
const NEUTRAL_ARROW = "↕";

function SortLink({ label, sort }: { label: string; sort: NonNullable<Column<never>["sort"]> }) {
  return (
    <a
      href={sort.href}
      className="inline-flex items-center gap-1 transition-colors hover:text-ink"
    >
      {label}
      <span
        aria-hidden="true"
        className={sort.active ? "text-accent" : "text-ink-disabled"}
      >
        {sort.active ? ARROW[sort.active] : NEUTRAL_ARROW}
      </span>
    </a>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  placeholder,
  marked,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name for the table. */
  label?: string;
  /**
   * Which row the URL asked for, if any. The row it answers `true` for is
   * drawn as the marked row and carries `data-row-marked`; the accessible
   * marking of what "current" means stays with the caller's own cell, which
   * is where it already is (campaign admin-window/BUG-0054).
   */
  marked?: (row: T) => boolean;
  /**
   * A state *line* — `Loading` or `ErrorLine` — shown in the body while there
   * are no rows, so the header stays put. A surface that simply holds nothing
   * renders `Empty` (or `NotProvisioned`) **in place of** the table, not
   * inside it: those two are cards, and a card inside the table's own border
   * would draw two borders. The three states never share a rendering.
   */
  placeholder?: ReactNode;
}) {
  return (
    // `min-w-0` so the promise above survives the table being laid out as a
    // flex or grid item: those default to a CONTENT-sized minimum width, which
    // makes the track grow to the table's intrinsic width and hands the
    // horizontal scroll to the page (admin-window/BUG-0042). It is inert in
    // normal flow.
    <div className="min-w-0 border border-hairline bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left" aria-label={label}>
          <thead>
            <tr className="bg-chrome">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sort?.active
                      ? column.sort.active === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={cx(
                    "type-micro px-2 py-1.5 text-ink-secondary",
                    column.align === "right" && "text-right",
                  )}
                >
                  {column.sort ? (
                    <SortLink label={column.label} sort={column.sort} />
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && placeholder !== undefined ? (
              <tr className="border-t border-hairline">
                <td colSpan={columns.length} className="p-3">
                  {placeholder}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  data-row-marked={marked?.(row) === true ? "true" : undefined}
                  className={
                    marked?.(row) === true
                      ? // The marked row holds its fill through hover too: what
                        // it says about itself must not change under the
                        // pointer, and hover is the one thing this table
                        // already says with a fill.
                        "border-t border-t-hairline border-l border-l-accent bg-page transition-colors"
                      : "border-t border-hairline transition-colors hover:bg-chrome"
                  }
                >
                  {columns.map((column) => {
                    const body = column.cell(row);
                    return (
                      <td
                        key={column.key}
                        className={cx(
                          "type-data px-2 py-1.5 text-ink",
                          column.align === "right" && "text-right",
                        )}
                      >
                        {orDash(body)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
