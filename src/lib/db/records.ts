import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readComplete,
  readOne,
  type DbCountedResponse,
  type DbResponse,
  type DbResult,
  type DbUnavailable,
} from "./result";
import { T } from "./tables";
import { currentDecisions } from "../browse/rows";
import {
  fieldProvenanceOf,
  namedSourceIds,
  type FieldDecisionRow,
  type FieldProvenance,
  type SourceNameRow,
} from "../records/provenance";
import {
  decideEdit,
  mappedColumns,
  type AllowedEdit,
  type TableEditConfig,
} from "../edit/config";

/**
 * The record read and the ONE direct update — campaign admin-window/TASK-0017.
 *
 * Every export returns a `DbResult` and never throws (ARCHITECTURE.md §4.1).
 * This module spells no table name of its own: the table, its primary key and
 * its editable columns all come from `src/lib/edit/config.ts`, the one
 * hand-written config (§9). It imports that leaf — and two more, `lib/browse/
 * rows.ts` for the ONE latest-per-fact reduction and `lib/records/provenance.ts`
 * for the per-field shape both this module and the surface need; every one of
 * them imports nothing that can reach a database, and none imports back
 * (§4 rule 7).
 *
 * **Read kinds (§4.3), and there are two here.** The record's own value read,
 * the update and the reference-name read all address exactly one row by
 * primary key and use `.maybeSingle()`, so none is a row-set read — there is
 * no set to be silently partial. A missing row comes back as `ok` carrying `null`, which
 * the caller reports as "no such record" rather than as an absent table. The
 * per-field provenance legs at the foot of this file are COMPLETE reads:
 * "the latest decision on this fact" is only knowable over the whole log, so a
 * truncated one must refuse rather than name a superseded source as current.
 *
 * **There is no insert and no delete here, and there never will be**: no
 * catalog row is created or destroyed from Admin (spec §8, AGENTS.md). The one
 * mutating call in this file is `.update()`, and it runs only for a
 * `pre_cutover` table's allowlisted column.
 */

/** What a PATCH may set: a scalar, or null to clear the field. No json, ever. */
export type EditableValue = string | number | boolean | null;

/** One canonical record, as the edit surface reads it: its pk and its fields. */
export type CanonicalRecord = Record<string, unknown>;

/**
 * The columns a record read asks for: exactly the ones the map declares for
 * this table — its primary key, its editable columns, then its read-only
 * `display` columns, de-duplicated and in that order.
 *
 * Explicit (§4.2) and derived from the config alone, so the surface can never
 * read — or write — a column the map does not carry. The order and the
 * de-duplication are `mappedColumns`' (the one map's own helper), so the read
 * and the drawn order cannot disagree: adding a column to a record surface
 * stays one entry in `lib/edit/config.ts` (admin-window/TASK-0029).
 *
 * A `display` column is read here and written NOWHERE: the update below asks
 * `decideEdit`, which does not read `display` at all.
 */
export function recordColumns(config: TableEditConfig): string {
  return mappedColumns(config).join(", ");
}

/**
 * Postgres's own uuid syntax, as `uuid_in` accepts it — the grammar this
 * predicate mirrors deliberately, rather than the canonical spelling alone
 * (`src/backend/utils/adt/uuid.c`, `string_to_uuid`): 32 hex digits, either
 * case, with a hyphen permitted — never required — after any EVEN number of
 * them up to 28. So `259e2030-00bd-4200-8730-4669e46a0c04`, the same value
 * unhyphenated and the same value uppercased are one id, and each of the three
 * really does resolve to the same staging row (measured on a production build,
 * 2026-09-03: `/records/groups/<id>` renders 11 field rows in all three
 * spellings).
 *
 * Being no stricter than Postgres is the whole point. A canonical-only test
 * would refuse an id the database would have resolved to a real row, and
 * telling an operator that a working id "is not an id" is a worse failure
 * than the one this guard exists to fix.
 *
 * Postgres also accepts a uuid wrapped in BRACES, and this deliberately does
 * not: the brace cannot survive the URL. Next hands a dynamic segment over
 * still percent-encoded — measured the same day, `/records/groups/{<id>}` and
 * `/records/groups/%7B<id>%7D` both reach the page as the literal
 * `%7B<id>%7D` — so what an operator's braced paste actually asks for is a row
 * whose id contains percent signs, which Postgres refuses as well. Answering
 * "that is not an id" is therefore the same answer the database would give,
 * and a brace arm here would be a grammar no request can reach.
 */
const RECORD_ID = /^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i;

/**
 * Does this URL segment spell a record id AT ALL — campaign
 * admin-window/BUG-0065.
 *
 * Every table in the map is keyed by a uuid, so an id that is not one can
 * match no row anywhere and needs no database to say so: the comparison is
 * refused by Postgres before a row is considered, with `22P02 invalid input
 * syntax for type uuid` — which the data layer classifies, correctly, as an
 * arbitrary failure and the surface then renders as "the read failed, reload"
 * (measured on a production build against staging, 2026-09-03). Reloading
 * re-sends the same malformed segment forever, so that advice can never work.
 *
 * The caller asks this BEFORE it reads. That placement is the fix and not an
 * optimisation: it is what makes one bad address produce ONE answer on a
 * resolver-owned table, where three reads would otherwise each report the same
 * refusal separately. And a segment that is not a uuid can equal no uuid
 * primary key in any table, so "no record at this address" is knowable here
 * with certainty — which is what lets the surface answer without either
 * claiming the database failed or claiming it answered.
 *
 * It is a question about the REQUEST, so it takes the raw segment and no
 * config: the map carries a table's primary-key COLUMN, never its type, and
 * inventing a per-table id grammar here would be a second allowlist
 * (ARCHITECTURE.md §9). If a future catalog table were keyed by anything but a
 * uuid, this is the one line that learns it.
 */
export function isRecordId(id: string): boolean {
  return RECORD_ID.test(id);
}

function selectRecord(
  db: SupabaseClient,
  config: TableEditConfig,
  id: string,
): PromiseLike<DbResponse<CanonicalRecord>> {
  return db
    .from(config.table)
    .select(recordColumns(config))
    .eq(config.pk, id)
    .maybeSingle() as unknown as PromiseLike<DbResponse<CanonicalRecord>>;
}

/**
 * One record by primary key: its pk and its editable fields.
 *
 * `ok` carrying `null` means the table answered and holds no such row — a
 * different thing from `not_provisioned`, which means the table itself is
 * absent.
 */
export async function readRecord(
  config: TableEditConfig,
  id: string,
  db?: SupabaseClient,
): Promise<DbResult<CanonicalRecord | null>> {
  return readOne<CanonicalRecord>(
    config.table,
    (client) => selectRecord(client, config, id),
    db,
  );
}

function updateField(
  db: SupabaseClient,
  config: TableEditConfig,
  id: string,
  field: string,
  value: EditableValue,
): PromiseLike<DbResponse<CanonicalRecord>> {
  return db
    .from(config.table)
    .update({ [field]: value })
    .eq(config.pk, id)
    .select(recordColumns(config))
    .maybeSingle() as unknown as PromiseLike<DbResponse<CanonicalRecord>>;
}

/**
 * Write one allowlisted field of one `pre_cutover` record, directly.
 *
 * The `AllowedEdit` argument can only come from `decideEdit()`, so a caller
 * cannot reach this function without having consulted the map — and the map is
 * consulted AGAIN here before any query is built. That second check is not
 * redundant: it is what makes "the row is unchanged" true of the data layer
 * itself and not merely of the route, so a future second caller cannot
 * reintroduce the hole. **A refused edit issues no query at all.**
 *
 * `ok` carrying `null` means no row matched the id — nothing was written.
 * `ok` carrying a record is the row AS STORED after the write, which is what
 * lets the surface show what the database actually kept.
 */
export async function updateRecordField(
  edit: AllowedEdit,
  id: string,
  value: EditableValue,
  db?: SupabaseClient,
): Promise<DbResult<CanonicalRecord | null>> {
  const { config, field } = edit;
  const decision = decideEdit(config.table, field);
  if (!decision.allowed) {
    return {
      kind: "error",
      reading: config.table,
      message: decision.refusal.message,
    };
  }

  return readOne<CanonicalRecord>(
    config.table,
    (client) => updateField(client, decision.edit.config, id, field, value),
    db,
  );
}

/* ── the linked entity behind a reference column ──────────────────────────── */

/**
 * What the reference leg produced: the linked row's readable NAME, and its own
 * account of why it has none.
 *
 * A third read, reported separately for the same reason the provenance leg is
 * (`RecordProvenance` below): a refused or absent name relation must leave
 * every value on screen, and the reference cell still links its id. The name
 * is a nicety; the ROUTE OUT is the fix (admin-window/BUG-0034).
 */
export interface RecordReference {
  /** The linked row's name, or `null` when the read named none. */
  name: string | null;
  /** Why there is no name, or `null` when the read answered. */
  note: DbUnavailable | null;
}

/** No reference on this record, and nothing to report for one. */
const NO_REFERENCE: RecordReference = { name: null, note: null };

/**
 * How the linked row's readable name is read, per REFERENCING table.
 *
 * It lives here rather than in the map because it is a relation name, and
 * ARCHITECTURE.md §4 rule 4 (pinned by `tests/offline/db/layering.test.ts`)
 * leaves `lib/db/tables.ts` the only file in `src/` that spells one — so this
 * spells none of its own either, and every string below comes from `T`.
 *
 * `events` reads its venue's name through the **`event_listings` view**, which
 * is the one place the events × venues join is already spelled and the same
 * leg Browse reads (`venuesFor` in `lib/db/browse.ts`, `LISTING_COLUMNS`).
 * That matters beyond convenience: the record page an operator clicks INTO
 * from a Browse row must not name the venue differently from the row they
 * clicked. The view is one row per event, keyed by the event's own primary
 * key, which is why the read below filters on `config.pk`.
 */
const NAME_RELATIONS: Readonly<
  Record<string, { readonly relation: string; readonly column: string }>
> = {
  [T.events]: { relation: T.eventListings, column: "venue_name" },
};

/** One row of a name relation: the record's key, and the linked row's name. */
type ReferenceNameRow = Record<string, unknown>;

function referenceNameFor(
  db: SupabaseClient,
  relation: string,
  key: string,
  column: string,
  id: string,
): PromiseLike<DbResponse<ReferenceNameRow>> {
  return db
    .from(relation)
    .select(`${key}, ${column}`)
    .eq(key, id)
    .maybeSingle() as unknown as PromiseLike<DbResponse<ReferenceNameRow>>;
}

/**
 * The linked entity behind this record's reference column — the venue an event
 * points at (admin-window/BUG-0034).
 *
 * **It issues no query at all** unless there is something to name: a table
 * whose map entry carries no `reference`, a record that was not read, a
 * reference column holding no id (an event with no venue), or a reference the
 * data layer has no name relation for. A read whose only possible answer is
 * "nothing" is a round trip and a not-provisioned card the page has no
 * business showing.
 *
 * Addressed by primary key with `.maybeSingle()`, so it is not a row-set read
 * and has no completeness question: `ok` carrying no row means the relation
 * answered and knows nothing about this record, which reads as no name — never
 * as an absent relation.
 */
export async function readRecordReference(
  config: TableEditConfig,
  id: string,
  record: CanonicalRecord | null,
  db?: SupabaseClient,
): Promise<RecordReference> {
  const reference = config.reference;
  if (reference === null || record === null) return NO_REFERENCE;

  const linkedId = record[reference.field];
  if (typeof linkedId !== "string" || linkedId.length === 0) return NO_REFERENCE;

  const source = NAME_RELATIONS[config.table];
  if (source === undefined) return NO_REFERENCE;

  const row = await readOne<ReferenceNameRow>(
    source.relation,
    (client) =>
      referenceNameFor(client, source.relation, config.pk, source.column, id),
    db,
  );
  if (row.kind !== "ok") return { name: null, note: row };

  const name = row.data?.[source.column];
  return { name: typeof name === "string" && name.length > 0 ? name : null, note: null };
}

/* ── per-field provenance ─────────────────────────────────────────────────── */

/**
 * What the provenance leg produced for one record.
 *
 * Reported SEPARATELY from the record's values, exactly as Browse reports its
 * legs (`RecentEventsListing`): a refused or absent `field_provenance` must
 * leave the values on screen and say for itself what happened. Two reads, two
 * answers — folding them would trade an honest partial record for a blank one.
 */
export interface RecordProvenance {
  /** The current provenance of each displayed field, keyed by column name. */
  fields: ReadonlyMap<string, FieldProvenance>;
  /** Why the provenance column is empty, or `null` when the read answered. */
  note: DbUnavailable | null;
}

/** Nothing to show and nothing to report — the pre-cutover answer. */
const NO_PROVENANCE: RecordProvenance = { fields: new Map(), note: null };

/**
 * The columns explicitly, spelled once. `admin_locked` is READ (spec §8's
 * "admin stickiness is visible"); this app writes it nowhere, and the
 * structural guard in `tests/offline/edit/config.test.ts` is what keeps that
 * true (admin-window/BUG-0028 narrowed it to writes so this select is legal).
 */
const PROVENANCE_COLUMNS =
  "provenance_id, entity_id, field, source_id, applied_at, admin_locked";
const SOURCE_COLUMNS = "source_id, source";

/**
 * The decision log behind ONE record's displayed fields — every decision on
 * them, not the current ones: the log is append-only and PostgREST has no
 * "distinct on", so the whole log comes back and the latest-per-fact reduction
 * happens in TypeScript (`currentDecisions`, §4.2).
 *
 * A COMPLETE read (§4.3) for that reason: "the latest decision" is knowable
 * only over the complete set, so a truncated log must refuse rather than name
 * a superseded source as current.
 *
 * `entity_type` on `field_provenance` is the CANONICAL TABLE the fact lives in
 * (the column's own comment in migration `20260818000000`), so it is filtered
 * with the table name the map carries — the same string every other query for
 * this record uses. The order is the decision order and ends in the primary
 * key, which is what lets `readComplete` tell a whole set from a truncated one.
 */
function provenanceFor(
  db: SupabaseClient,
  config: TableEditConfig,
  id: string,
  cap: number,
): PromiseLike<DbCountedResponse<FieldDecisionRow[]>> {
  return db
    .from(T.fieldProvenance)
    .select(PROVENANCE_COLUMNS, { count: "exact" })
    .eq("entity_type", config.table)
    .eq("entity_id", id)
    .in("field", [...config.display])
    .order("field", { ascending: true })
    .order("applied_at", { ascending: true })
    .order("provenance_id", { ascending: true })
    .range(0, cap - 1) as unknown as PromiseLike<
    DbCountedResponse<FieldDecisionRow[]>
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

/**
 * The current provenance of one record's displayed fields.
 *
 * **A table with no `display` columns issues no query at all** and answers
 * with nothing to show and nothing to report. That is the pre-cutover case:
 * `field_provenance` carries rows for resolver-owned entities, `groups` and
 * `idols` are unprovenanced by construction, and their record page says so
 * once in words rather than per field (Ben's ruling on
 * admin-window/TASK-0025). Reading the log for them would be a round trip
 * whose only possible answer is "no rows" — or a not-provisioned card on a
 * page that has no provenance to miss.
 *
 * Two legs, one note: the source-name lookup answers the same question the
 * log does ("who is behind this value"), so a failure of either is one note,
 * as Browse already folds them.
 */
export async function readRecordProvenance(
  config: TableEditConfig,
  id: string,
  db?: SupabaseClient,
): Promise<RecordProvenance> {
  if (config.display.length === 0) return NO_PROVENANCE;

  const log = await readComplete<FieldDecisionRow>(
    T.fieldProvenance,
    (client, cap) => provenanceFor(client, config, id, cap),
    db,
  );
  if (log.kind !== "ok") return { fields: new Map(), note: log };

  // The current decision per fact, over the COMPLETE log: a superseded
  // decision is that fact's history and is behind nothing now
  // (contracts/data-model.md, Per-field provenance). ONE implementation of
  // that rule exists in this repo and this is it — never a second.
  const current = currentDecisions(log.data);

  const sourceIds = namedSourceIds(current);
  let sources: DbResult<SourceNameRow[]> = { kind: "ok", data: [] };
  if (sourceIds.length > 0) {
    sources = await readComplete<SourceNameRow>(
      T.sources,
      (client, cap) => sourcesFor(client, sourceIds, cap),
      db,
    );
  }

  return {
    fields: fieldProvenanceOf(current, sources.kind === "ok" ? sources.data : []),
    note: sources.kind === "ok" ? null : sources,
  };
}
