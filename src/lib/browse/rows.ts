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
 * One row of the append-only decision log behind an event.
 *
 * `field_provenance` is NOT a current-state table (`contracts/data-model.md`,
 * Per-field provenance; scraper migration `20260818000000`: "The decision
 * log ... Append-only", trigger `field_provenance_reject_rewrite` refusing
 * every update and delete, `provenance_id` the only key). One fact identity —
 * here `(entity_id, field)`, the entity type being fixed by the read's own
 * `.eq("entity_type", ...)` — carries as many rows as it has ever had
 * decisions, and only the LATEST of them is that fact's current provenance.
 *
 * `source_id` is nullable because a verdict unset names no winning
 * observation (scraper migration `20260901000005`: "null on a verdict
 * unset"); such a decision is current provenance that contributes no source.
 */
export interface EventProvenanceRow {
  /** The primary key — uuid v7, so it is itself time-ordered. */
  provenance_id: string;
  entity_id: string;
  /** The canonical column this decision applied. */
  field: string;
  /** The source whose claim won the field; null on a verdict unset. */
  source_id: string | null;
  /** When the decision was applied — the log's own ordering. */
  applied_at: string;
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
 * Which of two decisions on the same fact is the later one.
 *
 * `applied_at` is the decision's own timestamp and decides it. When two
 * stamps are equal — or one is not a readable instant — `provenance_id`
 * decides, and that is not an arbitrary tie-break: the key is uuid v7, so it
 * is time-ordered too. The order is therefore TOTAL, which is what makes
 * "the latest decision" the same row on every render.
 */
function instantOf(appliedAt: string): number {
  const parsed = Date.parse(appliedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function laterDecision<Row extends EventProvenanceRow>(a: Row, b: Row): Row {
  const left = instantOf(a.applied_at);
  const right = instantOf(b.applied_at);
  if (left !== right) return left > right ? a : b;
  return compare(a.provenance_id, b.provenance_id) >= 0 ? a : b;
}

/**
 * The CURRENT provenance of every fact the log covers: the latest decision per
 * `(entity_id, field)`, with the decision history dropped.
 *
 * `contracts/data-model.md`, Per-field provenance: "The latest row per fact
 * identity is the current provenance; the rows before it are that fact's
 * decision history." A superseded decision names a source that is no longer
 * behind anything, so it must not reach the Sources column — on an append-only
 * log the union of every decision only ever grows.
 *
 * Unset decisions are KEPT here: a verdict unset is current provenance whose
 * `source_id` is null, and keeping it is what makes it supersede the sourced
 * decision it replaced. Callers that want source ids drop the nulls after this
 * reduction, never before it.
 *
 * The input is expected to be the COMPLETE set of decisions for the entities
 * in question (`readComplete`, ARCHITECTURE.md §4.3) — a truncated log would
 * make "the latest" a lie, which is why the read refuses rather than truncates.
 * Idempotent: reducing an already-reduced set returns it unchanged.
 *
 * GENERIC IN THE ROW, and domain-agnostic despite the row type's name
 * (admin-window/TASK-0011): the reduction reads only `entity_id`, `field`,
 * `applied_at` and `provenance_id`, and the canonical table is fixed by the
 * caller's own `.eq("entity_type", ...)`, so a review item's fact reduces by
 * the same rule an event's does — and a caller that also needs
 * `tier_at_apply` keeps it, instead of a second copy of "which decision is
 * later" being written next to a wider row type.
 */
export function currentDecisions<Row extends EventProvenanceRow>(
  provenance: readonly Row[],
): Row[] {
  const latest = new Map<string, Row>();
  for (const row of provenance) {
    const identity = `${row.entity_id}\u0000${row.field}`;
    const incumbent = latest.get(identity);
    latest.set(identity, incumbent ? laterDecision(incumbent, row) : row);
  }
  return [...latest.values()];
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
 * The sources behind a row are read through `currentDecisions`: one source per
 * fact the row still holds, never the union of every decision ever made on it,
 * and nothing at all from a fact whose latest decision is a verdict unset.
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
  for (const row of currentDecisions(input.provenance)) {
    // A verdict unset is the current decision and names no source: it
    // contributes nothing rather than an empty name.
    if (row.source_id === null) continue;
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

/**
 * The distinct source ids the given decisions name, in first-seen order.
 *
 * A decision that names no source (a verdict unset) contributes no id — there
 * is nothing to look a name up by, and `.in("source_id", [null])` is not a
 * query anyone meant to write. Hand this the CURRENT decisions
 * (`currentDecisions`), not the raw log, or it asks for the names of sources
 * that are no longer behind anything.
 */
export function sourceIdsOf(
  provenance: readonly Pick<EventProvenanceRow, "source_id">[],
): string[] {
  const named = provenance
    .map((row) => row.source_id)
    .filter((id): id is string => id !== null);
  return [...new Set(named)];
}

/** The event ids of a window, in the order the window holds them. */
export function eventIdsOf(events: readonly EventArrivalRow[]): string[] {
  return events.map((event) => event.event_id);
}
