import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/ui";
import {
  absoluteUtcInZonedColumn,
  isAbsent,
  relativeAge,
  type Timestamp,
} from "@/lib/format";
import type { BrowseRow } from "@/lib/browse/rows";
import type { BrowseColumnKey, BrowseView } from "@/lib/browse/views";
import { recordHref } from "@/lib/records/routes";

/**
 * The recent-events table (campaign admin-window/TASK-0015).
 *
 * A pure sync component over plain props (ARCHITECTURE.md §4 rule 1, §5): the
 * page reads and shapes, this renders. The columns it draws are the view
 * definition's, filtered to the ones the URL says are shown — the cell bodies
 * live here because a cell is markup, and the definition of WHICH columns
 * exist lives in `src/lib/browse/views.ts` because that is the contract.
 *
 * LOOK_AND_FEEL, Voice bar 6: ages are relative with the absolute in the title
 * attribute (`arrived`), scheduled times are absolute UTC with the zone stated
 * once in the column header and NOT again in the cell (`starts_at` — the
 * header reads "Starts (UTC)", the cell "2026-08-31 02:30"). Nothing here
 * decides how an absence renders: a cell returns `null` and `DataTable` draws
 * the em dash in disabled-gray, so every dash on every page reads the same.
 */

/** One cell body, given the row and the reference instant for an age. */
type CellBody = (row: BrowseRow, now: Timestamp) => ReactNode;

const CELLS: Record<BrowseColumnKey, CellBody> = {
  /**
   * The investigation never leaves the app (bar 10): the title is the link to
   * the record's edit surface, which is read-only for events in M1. An event
   * with no title still links — its machine id stands in, verbatim in mono —
   * because a row you cannot open is a dead end.
   *
   * The URL is the app's ONE record href (`lib/records/routes.ts`), which
   * answers null when there is no canonical row to lead to. An event row
   * always carries its `event_id`, so that branch does not arise here today —
   * the row simply renders unlinked rather than this file re-adding an
   * events-only, never-null variant of the same template
   * (admin-window/DEBT-0001).
   */
  title: (row) => {
    const label = row.title ?? row.event_id;
    const href = recordHref("events", row.event_id);
    return href === null ? (
      label
    ) : (
      <a href={href} className="transition-colors hover:text-accent">
        {label}
      </a>
    );
  },

  /**
   * The scheduled time, absolute UTC — WITHOUT the zone token, because the
   * column header ("Starts (UTC)", `lib/browse/views.ts`) states it once for
   * the whole column. Which form a call site takes is decided in
   * `lib/format.ts`; here the only claim is that this column has a zoned
   * header (admin-window/BUG-0047).
   *
   * An instant is ONE atom: the table's auto layout squeezes this column to
   * make room for the title, and a broken stamp reads as two half-dates and
   * doubles every row's height. Dropping the token was not enough on its own
   * — measured 2026-09-03 at 1440x900, the shorter value simply took a
   * narrower column (135px → 114px) and all 50 rows still wrapped — so the
   * value declares itself unbreakable and the column keeps the width it
   * needs. An ABSENCE stays a bare string so `DataTable`'s `orDash` draws the
   * one shared em dash rather than this file drawing a second kind.
   */
  starts_at: (row) => {
    const stamp = absoluteUtcInZonedColumn(row.starts_at);
    return isAbsent(stamp) ? (
      stamp
    ) : (
      <span className="whitespace-nowrap">{stamp}</span>
    );
  },

  venue: (row) => row.venue_name,

  /**
   * Clamped to two lines with the whole text in the title attribute: a
   * description runs to 5,000 characters and a table whose row height is set
   * by one blurb stops being scannable. Nothing is lost — the full value is
   * one hover away, and the record page carries it in full.
   */
  description: (row) =>
    row.description ? (
      <span className="line-clamp-2" title={row.description}>
        {row.description}
      </span>
    ) : null,

  /**
   * The poster itself, at the row's own height, linking to the full image.
   * Spot-verification is looking at the thing: a poster that belongs to
   * another event is visible in a thumbnail and invisible in a URL.
   */
  poster: (row) =>
    row.poster_url ? (
      <a href={row.poster_url} className="inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image
            would need every poster host allowlisted in next.config.ts and
            would proxy arbitrary scraped URLs through the app's optimizer;
            this is an internal 24px thumbnail behind the admin gate. */}
        <img
          src={row.poster_url}
          alt={row.title ?? row.event_id}
          className="h-6 w-6 object-cover"
        />
      </a>
    ) : null,

  /**
   * The sources behind the row, from the provenance join — distinct and
   * alphabetical (`joinBrowseRows`). No sources at all renders as the dash,
   * because `DataTable` treats an empty list as an absence.
   */
  sources: (row) => (row.sources.length > 0 ? row.sources.join(", ") : null),

  /**
   * Arrival — the column this view is actually sorted on. Relative, with the
   * absolute UTC instant in the title attribute.
   */
  arrived: (row, now) => {
    const age = relativeAge(row.created_at, now);
    return age.title === "" ? null : <span title={age.title}>{age.text}</span>;
  },
};

export function BrowseTable({
  view,
  shown,
  rows,
  now,
  placeholder,
}: {
  view: BrowseView;
  /** The columns the URL says are shown, as `shownColumns` resolved them. */
  shown: readonly BrowseColumnKey[];
  rows: readonly BrowseRow[];
  /** The instant ages are measured from. Defaults to now; a test pins it. */
  now?: Timestamp;
  /** A state LINE shown in the table body while there are no rows. */
  placeholder?: ReactNode;
}) {
  const reference = now ?? new Date();
  const columns: Column<BrowseRow>[] = view.columns
    .filter((column) => shown.includes(column.key))
    .map((column) => ({
      key: column.key,
      label: column.label,
      cell: (row: BrowseRow) => CELLS[column.key](row, reference),
    }));

  return (
    <DataTable<BrowseRow>
      columns={columns}
      rows={[...rows]}
      rowKey={(row) => row.event_id}
      label={view.title}
      placeholder={placeholder}
    />
  );
}
