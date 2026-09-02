import type { ReactNode } from "react";
import { nullDash } from "@/lib/format";
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
  /** The cell body. Return null for a missing value — it renders as the dash. */
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
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name for the table. */
  label?: string;
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
    <div className="border border-hairline bg-surface">
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
                  className="border-t border-hairline transition-colors hover:bg-chrome"
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
                        {body === null || body === undefined || body === "" ? nullDash() : body}
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
