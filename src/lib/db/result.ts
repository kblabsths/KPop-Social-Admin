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
  | { kind: "error"; reading: string; message: string };

/**
 * A read that produced no rows — the two non-`ok` arms.
 *
 * Both name the object they were reading, in the same spelling `tables.ts`
 * gave the query: `not_provisioned` because the object is what is absent, and
 * `error` because a page composing several reads (Browse makes four) must be
 * able to say WHICH read refused. A line reading only "TypeError: fetch
 * failed" names none of them (admin-window/BUG-0016).
 */
export type DbUnavailable = Extract<
  DbResult<unknown>,
  { kind: "not_provisioned" | "error" }
>;

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
 * The `message` field alone, verbatim — what CLASSIFICATION reads.
 *
 * Kept separate from the full account below on purpose: the column-absent
 * arm mines this string for the column the database named, so it must see
 * exactly what the database put in `message`. A `details` payload quoting some
 * other identifier would otherwise be read as the missing column, and the
 * classification is required to be unchanged (admin-window/BUG-0016).
 */
function messageOf(error: unknown): string {
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

/** What replaces anything key-shaped before a string can reach a screen. */
const REDACTED = "[redacted]";

/**
 * Value shapes that must never be rendered, whatever carried them.
 *
 * A transport failure quotes the request it tried, so the host of the database
 * URL can legitimately appear in an error line — that is the database's own
 * account of what it could not reach. A CREDENTIAL never may, and a
 * `NAME=value` rule alone misses the one that hurts most: a Postgres DSN
 * carries its password mid-line, between the colon and the `@`. Both are
 * covered here.
 */
const SECRET_SHAPES: ReadonlyArray<readonly [RegExp, string]> = [
  // A JWT — the shape of the service-role and anon keys.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, REDACTED],
  // Supabase's newer opaque key format.
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, REDACTED],
  // A DSN's password: scheme://user:HERE@host.
  [
    /((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^\s:@/]+:)[^\s@]+(?=@)/gi,
    `$1${REDACTED}`,
  ],
  // A named credential in a query string, a header dump or a JSON body.
  [
    /(\b(?:apikey|api_key|anon_key|service_role_key|access_token|refresh_token|token|secret|password|passwd|pwd)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;}"']+)/gi,
    `$1${REDACTED}`,
  ],
  [/([?&]key=)[^\s&]+/gi, `$1${REDACTED}`],
  // An Authorization header, however it was quoted.
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
];

/** The same string with every credential-shaped value replaced. */
function withoutSecrets(text: string): string {
  let scrubbed = text;
  for (const [shape, replacement] of SECRET_SHAPES) {
    scrubbed = scrubbed.replace(shape, replacement);
  }
  return scrubbed;
}

/** How far a `cause` chain is followed before we stop reading it. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Every field of the client's own account, in a FIXED order:
 * `message`, `details`, `hint`, then whatever its `cause` says.
 *
 * Both shapes of the same failure reach us and both must give up their cause:
 *  - supabase-js hands back an OBJECT — `message: "TypeError: fetch failed"`
 *    with the real cause ("Caused by: Error: bad port …") in `details`;
 *  - a fetch that throws straight through is an `Error` whose `cause` is the
 *    real one.
 * Reading `message` alone discarded the only field carrying what actually went
 * wrong (admin-window/BUG-0016).
 */
function accountParts(error: unknown, depth: number): string[] {
  const record = asRecord(error);
  // No `message` field: `messageOf` serialises the whole object, which already
  // carries every field there is — appending them again would only repeat it.
  if (record === null || typeof record.message !== "string") {
    return [messageOf(error)];
  }

  const parts = [messageOf(error)];
  for (const field of ["details", "hint"] as const) {
    const value = record[field];
    if (typeof value === "string") parts.push(value);
  }

  const cause = record.cause;
  if (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH) {
    parts.push(...accountParts(cause, depth + 1));
  }
  return parts;
}

/**
 * The database client's own account of the failure — everything it said,
 * nothing of ours.
 *
 * LOOK_AND_FEEL, Interaction: "the app shows what the database said … Errors
 * are never swallowed and never replaced with a generic message." So this
 * substitutes no friendlier sentence, and it also refuses to throw away the
 * fields where the cause actually lives.
 *
 * A part that another part already contains is dropped rather than repeated —
 * supabase-js's `details` opens with a copy of `message`, and printing the
 * wrapper twice tells an operator nothing. The `code` is a machine identifier
 * rather than prose, so it trails in parentheses, and only when the account
 * does not already spell it.
 */
function errorMessage(error: unknown): string {
  const kept: string[] = [];
  for (const raw of accountParts(error, 0)) {
    const part = raw.trim();
    if (part.length === 0) continue;
    if (kept.some((held) => held.includes(part))) continue;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (part.includes(kept[index])) kept.splice(index, 1);
    }
    kept.push(part);
  }

  let account = kept.join(" ");
  const code = errorCode(error)?.trim() ?? "";
  if (code.length > 0 && !account.includes(code)) {
    account = account.length > 0 ? `${account} (${code})` : `(${code})`;
  }
  return withoutSecrets(account);
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

  if (code !== null && TABLE_ABSENT_CODES.has(code)) {
    return { kind: "not_provisioned", missing };
  }

  if (code !== null && COLUMN_ABSENT_CODES.has(code)) {
    const column = columnFromMessage(messageOf(error));
    if (column === null || column === missing || missing.endsWith(`.${column}`)) {
      return { kind: "not_provisioned", missing };
    }
    return { kind: "not_provisioned", missing: `${missing}.${column}` };
  }

  return { kind: "error", reading: missing, message: errorMessage(error) };
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
        reading: missing,
        message:
          `the read returned no count, so whether these ${rows.length} rows ` +
          `are all of them is unknown; a complete read requires ` +
          `{ count: "exact" }.`,
      };
    }
    if (count > rows.length) {
      return {
        kind: "error",
        reading: missing,
        message:
          `the database holds ${count} rows matching this read and it is ` +
          `capped at ${ROW_CAP} (${rows.length} returned); narrow the filter ` +
          `or raise ROW_CAP.`,
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
        reading: missing,
        message:
          `the query returned no count, so the number of rows is unknown; a ` +
          `count read requires { head: true, count: "exact" }.`,
      };
    }
    return { kind: "ok", data: count };
  } catch (thrown) {
    return classify(thrown, missing);
  }
}
