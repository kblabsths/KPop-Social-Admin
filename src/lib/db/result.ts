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
 * The response shape a COMPLETE read needs: the rows AND the exact count.
 *
 * `count` is what `{ count: "exact" }` puts on the response. It is `null` when
 * the query did not ask for it — which a complete read treats as a refusal
 * rather than as information (ARCHITECTURE.md §4.3).
 */
export type DbCountedResponse<T> = {
  data: T | null;
  error: unknown;
  count: number | null;
};

/**
 * The most rows one complete read may return.
 *
 * 1000 matches PostgREST's own default `db-max-rows`, so the app never
 * silently fights the platform cap: whichever of the two truncates first, the
 * exact count still exceeds the rows returned and the read refuses. One named
 * constant, handed to the query builder, so no module spells the number
 * (ARCHITECTURE.md §4.3; DECISIONS 2026-09-02).
 */
export const ROW_CAP = 1000;

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
 * A column-absent message's UNQUOTED column reference.
 *
 * Postgres quotes an unqualified reference (`column "severity" does not
 * exist`) but spells a QUALIFIED one bare: `column events.badcol does not
 * exist` — the form a page selecting an explicit column list gets. The
 * trailing `does not exist` is required so that a message carrying no column
 * at all cannot have a word of its prose read as one.
 */
const UNQUOTED_COLUMN_REFERENCE =
  /\bcolumn\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*)\s+does not exist/i;

/** The last dot-segment of a possibly-qualified name — the column itself. */
function lastSegment(name: string): string | null {
  const segments = name.split(".");
  const last = segments[segments.length - 1];
  return last.length > 0 ? last : null;
}

/**
 * The column a column-absent message names, or `null` if it names none.
 *
 * Both spellings must resolve, because both reach us:
 *  - quoted — Postgres `column "severity" does not exist` and `column
 *    "severity" of relation "review_items" does not exist`; PostgREST
 *    `Could not find the 'severity' column of 'review_items' in the schema
 *    cache`. The first quoted token is the column.
 *  - unquoted and qualified — `column events.badcol does not exist`. Read for
 *    quotes alone this yields nothing, and the classification collapsed to the
 *    bare table name, so a fully-provisioned table read as absent
 *    (admin-window/TASK-0002).
 *
 * Either way any qualifier is dropped: the table `classify` reports is the one
 * the query asked for, from `tables.ts` (ARCHITECTURE.md §4.1).
 */
function columnFromMessage(message: string): string | null {
  const quoted = /'([^']+)'|"([^"]+)"/.exec(message);
  const quotedName = quoted?.[1] ?? quoted?.[2];
  if (quotedName) return lastSegment(quotedName);

  const unquoted = UNQUOTED_COLUMN_REFERENCE.exec(message);
  const unquotedName = unquoted?.[1];
  return unquotedName ? lastSegment(unquotedName) : null;
}

/**
 * Turn a database error into a `DbResult`.
 *
 * `missing` is the name from `tables.ts` the query used, so the rendered
 * not-provisioned card names the same string the query did. For a
 * column-absent code the column read out of the database's own message is
 * appended (`review_items.severity`), so the card names the column while still
 * carrying the table — in whichever spelling the message used, quoted or bare
 * and qualified. When the message names no column at all, the card falls back
 * to the object the query asked for rather than guessing a column out of it.
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
    const column = columnFromMessage(message);
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

/**
 * A COMPLETE row-set read: the `ok` array is the WHOLE matching set, or the
 * read refuses (ARCHITECTURE.md §4.3, campaign admin-window/TASK-0026).
 *
 * The `run` callback MUST build its query with `{ count: "exact" }`, a total
 * `.order()` ending in the primary key, and `.range(0, cap - 1)` — `cap` is
 * handed in so the caller never spells the number itself. The server order
 * makes the row set (and therefore any refusal) deterministic; it is not the
 * display order, which stays with the domain module.
 *
 * In order:
 *  - a database error classifies exactly as `readRows` does, so an absent
 *    table still reads as `not_provisioned`;
 *  - `count === null` with no error is a refusal, never a number of our own:
 *    the query was written without `{ count: "exact" }` and we cannot know how
 *    many rows matched (BUG-0007's rule on the user-visible path);
 *  - `count > rows.length` means SOMETHING truncated the set — our cap, or the
 *    server's `db-max-rows`, which our cap alone cannot detect — so the read
 *    refuses with the real number rather than returning a partial array;
 *  - otherwise `ok` with every row.
 *
 * **Every figure, count, oldest-age and exactness claim in this app rests on
 * that property**, which is why no caller carries a "was that all of it?"
 * flag: a partial answer never becomes an `ok`.
 */
export async function readComplete<Row>(
  missing: string,
  run: (db: SupabaseClient, cap: number) => PromiseLike<DbCountedResponse<Row[]>>,
  db?: SupabaseClient,
): Promise<DbResult<Row[]>> {
  try {
    const client = db ?? getDbClient();
    const { data, error, count } = await run(client, ROW_CAP);
    if (error !== null && error !== undefined) return classify(error, missing);

    const rows = data ?? [];
    if (count === null || count === undefined) {
      return {
        kind: "error",
        message:
          `${missing}: the read returned no count, so whether these ` +
          `${rows.length} rows are all of them is unknown; a complete read ` +
          `requires { count: "exact" }.`,
      };
    }
    if (count > rows.length) {
      return {
        kind: "error",
        message:
          `${missing}: the database holds ${count} rows matching this read ` +
          `and it is capped at ${ROW_CAP} (${rows.length} returned); narrow ` +
          `the filter or raise ROW_CAP.`,
      };
    }
    return { kind: "ok", data: rows };
  } catch (thrown) {
    return classify(thrown, missing);
  }
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
 * A `head: true, count: "exact"` read. `ok` carries the count the database
 * gave — and a database that gave none is a refusal, never a zero.
 *
 * This used to substitute a zero for an absent count (BUG-0007's user-visible
 * twin), so a response with `error: null` and `count: null` — exactly what a
 * select written WITHOUT `{ head: true, count: "exact" }` returns — rendered a
 * confident `0` for a table holding 47 rows. A real zero still comes back as `ok` 0; only the
 * absent count refuses (ARCHITECTURE.md §4.3, campaign
 * admin-window/TASK-0026). It still never throws (§4.1).
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
    if (count === null || count === undefined) {
      return {
        kind: "error",
        message:
          `${missing}: the query returned no count, so the number of rows is ` +
          `unknown; a count read requires { head: true, count: "exact" }.`,
      };
    }
    return { kind: "ok", data: count };
  } catch (thrown) {
    return classify(thrown, missing);
  }
}
