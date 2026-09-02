import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readComplete,
  readRows,
  type DbCountedResponse,
  type DbResponse,
  type DbResult,
} from "./result";
import { T } from "./tables";
import {
  currentDecisions,
  eventIdsOf,
  joinBrowseRows,
  sourceIdsOf,
  type BrowseRow,
  type EventArrivalRow,
  type EventProvenanceRow,
  type EventVenueRow,
  type SourceNameRow,
} from "../browse/rows";
import type { BrowseView } from "../browse/views";

/**
 * Browse's reads — campaign admin-window/TASK-0015.
 *
 * Every export returns a `DbResult` and never throws (ARCHITECTURE.md §4.1),
 * and every object is named through `T` alone (§4 rule 4), so a database
 * missing any one of them renders a not-provisioned card naming it instead of
 * a stack trace. The domain — the order, the join, the row shapes — lives in
 * `src/lib/browse/`, which this module imports and never the other way (§4
 * rule 7).
 *
 * **Four reads, joined in TypeScript** (§4.2 "fetch by id sets and join in
 * TypeScript"): `events` decides the window, then the listings view, the
 * provenance table and `sources` fill columns over that window's ids. There is
 * no PostgREST embed here and no helper that "figures one out".
 *
 * **Read kinds, chosen deliberately (§4.3):**
 *  - the events window is a WINDOW read — an explicit order and an explicit
 *    limit, and the page states which window it is showing. `events` is a
 *    growing catalog; a complete read of it would refuse outright the day it
 *    passed the platform row cap, and Browse's subject is "the newest N",
 *    never "all of them". Its rows are never presented as a total.
 *  - the three legs over that window's ids are COMPLETE reads. Each one
 *    answers "exactly the rows for these ids", and the sources behind a row
 *    are shown as THE sources behind it — a silently truncated provenance set
 *    would make that claim wrong rather than refused. Their input is a set of
 *    at most `view.window` ids, so the cap is reached only by a genuinely
 *    extraordinary row count, and then the read says so with the real number.
 */

/** A read that did not produce rows — the two non-`ok` arms of `DbResult`. */
export type DbUnavailable =
  | { kind: "not_provisioned"; missing: string }
  | { kind: "error"; message: string };

/**
 * What Browse's page renders.
 *
 * The legs are reported separately ON PURPOSE. Acceptance criterion: with
 * `field_provenance` absent the event rows still render and the page says
 * which table is missing — either way nothing throws. Folding a failed leg
 * into the whole page's state would trade an honest partial view for a blank
 * one, and folding it into nothing at all would show an empty Sources column
 * as though every event had no sources.
 */
export interface RecentEventsListing {
  /** The window itself. `ok` is the newest rows, in arrival order. */
  events: DbResult<BrowseRow[]>;
  /** Why the Venue column is empty, or `null` when the view answered. */
  venues: DbUnavailable | null;
  /** Why the Sources column is empty, or `null` when provenance answered. */
  provenance: DbUnavailable | null;
}

/**
 * The columns, explicit (§4.2 "Reads are explicit"), spelled once per object.
 * A caller asking for a different set would defeat the not-provisioned
 * classification, which names the column the database complained about.
 */
const EVENT_COLUMNS =
  "event_id, title, description, poster_url, starts_at, created_at";
const LISTING_COLUMNS = "event_id, venue_name";
const PROVENANCE_COLUMNS =
  "provenance_id, entity_id, field, source_id, applied_at";
const SOURCE_COLUMNS = "source_id, source";

/**
 * The events window: `created_at` descending, `event_id` descending to break a
 * tie, and an explicit `limit`.
 *
 * "Newest first" is ARRIVAL order — `events.created_at desc`, because the view
 * is "everything that came through the pipeline, newest first"
 * (ARCHITECTURE.md §11). `starts_at` is a column the view shows, never its
 * sort, and there is no sortable header on this page to change that.
 *
 * The direction comes off the view definition rather than being spelled here:
 * the definition is the authority on its own sort (spec §4).
 */
function eventsWindow(
  db: SupabaseClient,
  view: BrowseView,
): PromiseLike<DbResponse<EventArrivalRow[]>> {
  const ascending = view.sort.direction !== "desc";
  return db
    .from(T.events)
    .select(EVENT_COLUMNS)
    .order(view.sort.field, { ascending })
    .order("event_id", { ascending })
    .limit(view.window) as unknown as PromiseLike<
    DbResponse<EventArrivalRow[]>
  >;
}

/** The venue names for a window's ids, through the listings view. */
function venuesFor(
  db: SupabaseClient,
  ids: readonly string[],
  cap: number,
): PromiseLike<DbCountedResponse<EventVenueRow[]>> {
  return db
    .from(T.eventListings)
    .select(LISTING_COLUMNS, { count: "exact" })
    .in("event_id", ids)
    .order("event_id", { ascending: true })
    .range(0, cap - 1) as unknown as PromiseLike<
    DbCountedResponse<EventVenueRow[]>
  >;
}

/**
 * The decision log behind a window's events — every decision, not the current
 * ones: `field_provenance` is append-only and PostgREST has no "distinct on",
 * so the whole log for these ids comes back and the latest-per-fact reduction
 * happens in TypeScript (`currentDecisions`, §4.2 "join in TypeScript").
 *
 * That is exactly why this leg is a COMPLETE read (§4.3): "the latest decision"
 * is only knowable over the complete set, so a truncated log must refuse rather
 * than name a superseded source as current.
 *
 * `entity_type` on `field_provenance` is the CANONICAL TABLE the fact lives in
 * (the column's own comment in migration `20260818000000`), so it is filtered
 * with the same name `tables.ts` gives that table — one spelling, one place.
 * It also pins the entity-type third of the fact identity, leaving
 * `(entity_id, field)` to identify a fact within this result.
 *
 * The order is the decision order — `applied_at`, then `provenance_id` — and
 * it ends in the primary key, which is what lets `readComplete` tell a whole
 * set from a truncated one reproducibly.
 */
function provenanceFor(
  db: SupabaseClient,
  ids: readonly string[],
  cap: number,
): PromiseLike<DbCountedResponse<EventProvenanceRow[]>> {
  return db
    .from(T.fieldProvenance)
    .select(PROVENANCE_COLUMNS, { count: "exact" })
    .eq("entity_type", T.events)
    .in("entity_id", ids)
    .order("entity_id", { ascending: true })
    .order("applied_at", { ascending: true })
    .order("provenance_id", { ascending: true })
    .range(0, cap - 1) as unknown as PromiseLike<
    DbCountedResponse<EventProvenanceRow[]>
  >;
}

/** The names of the sources those decisions name. */
function sourcesFor(
  db: SupabaseClient,
  ids: readonly string[],
  cap: number,
): PromiseLike<DbCountedResponse<SourceNameRow[]>> {
  return db
    .from(T.sources)
    .select(SOURCE_COLUMNS, { count: "exact" })
    .in("source_id", ids)
    .order("source_id", { ascending: true })
    .range(0, cap - 1) as unknown as PromiseLike<
    DbCountedResponse<SourceNameRow[]>
  >;
}

/** The non-`ok` arm of a result, for a leg that fills a column. */
function unavailable(result: DbResult<unknown>): DbUnavailable | null {
  if (result.kind === "ok") return null;
  return result;
}

/**
 * The recent-events view: the newest `view.window` events by arrival, each
 * with its venue name and the distinct sources behind its applied fields.
 *
 * A leg is skipped entirely when the window is empty — an `.in()` over no ids
 * is a pointless round trip, and no rows is the honest answer. The sources leg
 * is skipped when the CURRENT decisions name no source, and a provenance leg
 * that failed takes the sources leg's place in the report: the two together
 * answer one question ("which sources are behind this row"), so one failure is
 * one note.
 */
export async function readRecentEvents(
  view: BrowseView,
  db?: SupabaseClient,
): Promise<RecentEventsListing> {
  const window = await readRows<EventArrivalRow>(
    T.events,
    (client) => eventsWindow(client, view),
    db,
  );
  if (window.kind !== "ok") {
    return { events: window, venues: null, provenance: null };
  }

  const ids = eventIdsOf(window.data);
  if (ids.length === 0) {
    return { events: { kind: "ok", data: [] }, venues: null, provenance: null };
  }

  const venues = await readComplete<EventVenueRow>(
    T.eventListings,
    (client, cap) => venuesFor(client, ids, cap),
    db,
  );

  const provenance = await readComplete<EventProvenanceRow>(
    T.fieldProvenance,
    (client, cap) => provenanceFor(client, ids, cap),
    db,
  );

  // The current provenance of each fact, over the COMPLETE log: superseded
  // decisions are that fact's history and name nothing that is behind the row
  // now (contracts/data-model.md, Per-field provenance). The reduction happens
  // before the sources leg so that only sources still behind a value are
  // looked up at all.
  const decisions =
    provenance.kind === "ok" ? currentDecisions(provenance.data) : [];

  let sources: DbResult<SourceNameRow[]> = { kind: "ok", data: [] };
  const sourceIds = sourceIdsOf(decisions);
  if (sourceIds.length > 0) {
    sources = await readComplete<SourceNameRow>(
      T.sources,
      (client, cap) => sourcesFor(client, sourceIds, cap),
      db,
    );
  }

  const rows = joinBrowseRows({
    events: window.data,
    venues: venues.kind === "ok" ? venues.data : [],
    provenance: decisions,
    sources: sources.kind === "ok" ? sources.data : [],
  });

  return {
    events: { kind: "ok", data: rows },
    venues: unavailable(venues),
    provenance: unavailable(provenance) ?? unavailable(sources),
  };
}
