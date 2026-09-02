import type { SupabaseClient } from "@supabase/supabase-js";
import { getDbClient } from "./client";

/**
 * The data-layer contract (ARCHITECTURE.md §4.1): every exported read in
 * `lib/db/**` returns one of these, never throws, and never returns a bare
 * array. That is how acceptance test 9 — "against a database lacking the
 * resolver tables, every page renders its not-provisioned state; nothing
 * throws" — is structural instead of per-page discipline.
 */
export type DbResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_provisioned"; missing: string }
  | { kind: "error"; message: string };

/** The shape every PostgREST response has, narrowed to what a read needs. */
export type DbResponse<T> = { data: T | null; error: unknown };

/**
 * The object is absent: PostgREST cannot find the table/view in its schema
 * cache (`PGRST205`), or Postgres itself says undefined_table (`42P01`).
 */
const TABLE_ABSENT_CODES: ReadonlySet<string> = new Set(["PGRST205", "42P01"]);

/**
 * The column is absent: PostgREST cannot find the column in its schema cache
 * (`PGRST204`), or Postgres itself says undefined_column (`42703`).
 */
const COLUMN_ABSENT_CODES: ReadonlySet<string> = new Set(["PGRST204", "42703"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** The error's own `code`, if it carries one. */
function errorCode(error: unknown): string | null {
  const record = asRecord(error);
  const code = record?.code;
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  return null;
}

/**
 * The database's own message, verbatim.
 *
 * LOOK_AND_FEEL, Interaction: "the app shows what the database said" — this
 * never substitutes a friendlier sentence of our own.
 */
function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const record = asRecord(error);
  const message = record?.message;
  if (typeof message === "string") return message;
  if (record !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * The first quoted name in a message, unqualified.
 *
 * Postgres says `column "severity" does not exist`; PostgREST says
 * `Could not find the 'severity' column of 'review_items' in the schema
 * cache`. In both, the first quoted token is the column, which is how a
 * column-absent classification can name the column and not just its table.
 */
function firstQuotedName(message: string): string | null {
  const match = /'([^']+)'|"([^"]+)"/.exec(message);
  const quoted = match?.[1] ?? match?.[2];
  if (!quoted) return null;
  const segments = quoted.split(".");
  const last = segments[segments.length - 1];
  return last.length > 0 ? last : null;
}

/**
 * Turn a database error into a `DbResult`.
 *
 * `missing` is the name from `tables.ts` the query used, so the rendered
 * not-provisioned card names the same string the query did. For a
 * column-absent code the column read out of the database's own message is
 * appended (`review_items.severity`), so the card names the column while still
 * carrying the table.
 *
 * Everything that is not one of the four absence codes is `kind: "error"`
 * carrying the database's message verbatim.
 */
export function classify(error: unknown, missing: string): DbResult<never> {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (code !== null && TABLE_ABSENT_CODES.has(code)) {
    return { kind: "not_provisioned", missing };
  }

  if (code !== null && COLUMN_ABSENT_CODES.has(code)) {
    const column = firstQuotedName(message);
    if (column === null || column === missing || missing.endsWith(`.${column}`)) {
      return { kind: "not_provisioned", missing };
    }
    return { kind: "not_provisioned", missing: `${missing}.${column}` };
  }

  return { kind: "error", message };
}

/**
 * Run one PostgREST query and classify whatever comes back.
 *
 * The client is resolved INSIDE the try, so an unset credential name — which
 * makes `getDbClient()` throw — becomes an error state rather than an
 * exception escaping into a page. Pass `db` to read through a different
 * client (the offline stub, or a live test's staging client).
 */
async function runQuery<T>(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<T>>,
  db?: SupabaseClient,
): Promise<DbResult<T | null>> {
  try {
    const client = db ?? getDbClient();
    const { data, error } = await run(client);
    if (error !== null && error !== undefined) return classify(error, missing);
    return { kind: "ok", data: data ?? null };
  } catch (thrown) {
    return classify(thrown, missing);
  }
}

/** A row-set read. `ok` always carries an array — an empty one when there are no rows. */
export async function readRows<Row>(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<Row[]>>,
  db?: SupabaseClient,
): Promise<DbResult<Row[]>> {
  const result = await runQuery<Row[]>(missing, run, db);
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: result.data ?? [] };
}

/** A single-row read (`.maybeSingle()`). `ok` carries `null` when there is no row. */
export async function readOne<Row>(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<Row>>,
  db?: SupabaseClient,
): Promise<DbResult<Row | null>> {
  return runQuery<Row>(missing, run, db);
}

/**
 * A `head: true, count: "exact"` read. `ok` carries the count, `0` when
 * PostgREST returns none — a count query's payload is the count, not the data.
 */
export async function readCount(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<{ count: number | null; error: unknown }>,
  db?: SupabaseClient,
): Promise<DbResult<number>> {
  try {
    const client = db ?? getDbClient();
    const { count, error } = await run(client);
    if (error !== null && error !== undefined) return classify(error, missing);
    return { kind: "ok", data: count ?? 0 };
  } catch (thrown) {
    return classify(thrown, missing);
  }
}
