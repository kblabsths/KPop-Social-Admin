/**
 * Browse's row shapes and the joins over them (campaign
 * admin-window/TASK-0015).
 *
 * A PURE DOMAIN LEAF alongside `views.ts` (ARCHITECTURE.md §4 rule 7): it
 * imports nothing that can reach a database, and it declares the row
 * interfaces BOTH sides need — `lib/db/browse.ts` reads rows of these shapes
 * and hands them straight back here to be ordered and joined.
 *
 * Why a join in TypeScript at all: PostgREST embedding is available only where
 * a foreign key exists, and §4.2's standing rule is "fetch by id sets and join
 * in TypeScript" — query A returns rows, query B takes its ids, the join
 * happens here where it unit-tests offline against captured fixtures.
 */

/**
 * The events window: the columns `events` itself owns, including the arrival
 * stamp the whole view is ordered by.
 */
export interface EventArrivalRow {
  event_id: string;
  title: string | null;
  description: string | null;
  poster_url: string | null;
  starts_at: string | null;
  created_at: string | null;
}

/**
 * The venue name, read through the listings view — the one place the
 * events × venues join is already spelled, so no consumer re-implements it.
 */
export interface EventVenueRow {
  event_id: string;
  venue_name: string | null;
}

/**
 * One applied-field decision behind an event: `entity_id` is the event, and
 * `source_id` the source whose claim won that field.
 */
export interface EventProvenanceRow {
  entity_id: string;
  source_id: string;
}

/** A source's id and the name an operator reads. */
export interface SourceNameRow {
  source_id: string;
  source: string;
}

/** One rendered Browse row: an event with everything the view may show. */
export interface BrowseRow {
  event_id: string;
  title: string | null;
  description: string | null;
  poster_url: string | null;
  starts_at: string | null;
  created_at: string | null;
  venue_name: string | null;
  /** The distinct sources behind this row, alphabetical. */
  sources: readonly string[];
}

/** The route an event row links to — read-only for events in M1. */
export function eventRecordHref(eventId: string): string {
  return `/records/events/${encodeURIComponent(eventId)}`;
}

/** Locale-independent string order, so a row set sorts the same everywhere. */
function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * ARRIVAL ORDER: `created_at` descending — "everything that came through the
 * pipeline, newest first" (spec §4; ARCHITECTURE.md §11). `starts_at` is a
 * column this view shows and never its sort.
 *
 * This function is the one authority on the display order, exactly as
 * `queueOrder` is for review items; the server-side order the read asks for is
 * an optimisation that happens to agree with it. A row whose `created_at` is
 * absent sorts last — it cannot claim a position in an arrival order it does
 * not carry — and `event_id` descending breaks every tie, so the order is
 * total and two rows on the same instant never swap between renders.
 */
export function arrivalOrder(
  rows: readonly EventArrivalRow[],
): EventArrivalRow[] {
  return [...rows].sort((a, b) => {
    const left = a.created_at ?? "";
    const right = b.created_at ?? "";
    if (left !== right) {
      if (left === "") return 1;
      if (right === "") return -1;
      return compare(right, left);
    }
    return compare(b.event_id, a.event_id);
  });
}

/** The pieces the four reads produce, ready to be joined into rows. */
export interface BrowseJoinInput {
  events: readonly EventArrivalRow[];
  venues: readonly EventVenueRow[];
  provenance: readonly EventProvenanceRow[];
  sources: readonly SourceNameRow[];
}

/**
 * Join the four reads into the rows the table renders, in arrival order.
 *
 * The events read decides which rows exist; the other three only fill columns,
 * so a venue name or a provenance set that never arrived leaves a null or an
 * empty list — the row still renders, and the page says separately which table
 * was missing. That is what makes the missing-`field_provenance` case a page
 * that still shows its events rather than a page that shows nothing.
 *
 * A `source_id` with no matching `sources` row keeps its id verbatim: the
 * decision behind the field is real whether or not the source row was read,
 * and dropping it would silently understate how many sources are behind a row.
 */
export function joinBrowseRows(input: BrowseJoinInput): BrowseRow[] {
  const venueOf = new Map<string, string | null>();
  for (const row of input.venues) venueOf.set(row.event_id, row.venue_name);

  const nameOf = new Map<string, string>();
  for (const row of input.sources) nameOf.set(row.source_id, row.source);

  const sourceIdsOf = new Map<string, Set<string>>();
  for (const row of input.provenance) {
    const set = sourceIdsOf.get(row.entity_id) ?? new Set<string>();
    set.add(row.source_id);
    sourceIdsOf.set(row.entity_id, set);
  }

  return arrivalOrder(input.events).map((event) => {
    const names = [...(sourceIdsOf.get(event.event_id) ?? new Set<string>())]
      .map((sourceId) => nameOf.get(sourceId) ?? sourceId)
      .sort(compare);
    return {
      event_id: event.event_id,
      title: event.title,
      description: event.description,
      poster_url: event.poster_url,
      starts_at: event.starts_at,
      created_at: event.created_at,
      venue_name: venueOf.get(event.event_id) ?? null,
      sources: names,
    };
  });
}

/** The distinct source ids the provenance rows name, in first-seen order. */
export function sourceIdsOf(
  provenance: readonly EventProvenanceRow[],
): string[] {
  return [...new Set(provenance.map((row) => row.source_id))];
}

/** The event ids of a window, in the order the window holds them. */
export function eventIdsOf(events: readonly EventArrivalRow[]): string[] {
  return events.map((event) => event.event_id);
}
