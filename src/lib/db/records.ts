import type { SupabaseClient } from "@supabase/supabase-js";
import { readOne, type DbResponse, type DbResult } from "./result";
import {
  decideEdit,
  type AllowedEdit,
  type TableEditConfig,
} from "../edit/config";

/**
 * The record read and the ONE direct update — campaign admin-window/TASK-0017.
 *
 * Every export returns a `DbResult` and never throws (ARCHITECTURE.md §4.1).
 * This module spells no table name of its own: the table, its primary key and
 * its editable columns all come from `src/lib/edit/config.ts`, the one
 * hand-written config (§9). It imports that leaf; the leaf imports nothing
 * (§4 rule 7).
 *
 * **Read kind (§4.3):** both queries below address exactly one row by primary
 * key and use `.maybeSingle()`, so neither is a row-set read — there is no set
 * to be silently partial, and neither `readRows` nor `readComplete` applies.
 * A missing row comes back as `ok` carrying `null`, which the caller reports
 * as "no such record" rather than as an absent table.
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
 * The columns a record read asks for: the primary key plus exactly the
 * editable ones. Explicit (§4.2) and derived from the config alone, so the
 * surface can never read — or write — a column the map does not carry.
 */
export function recordColumns(config: TableEditConfig): string {
  return [config.pk, ...config.editable].join(", ");
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
