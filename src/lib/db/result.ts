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

/**
 * The FUNCTION is absent: PostgREST cannot find the function in its schema
 * cache (`PGRST202`), or Postgres itself says undefined_function (`42883`).
 *
 * The fifth kind of object the window reads (campaign admin-window/TASK-0047).
 * M2 settles a review item through one call to a resolver procedure that does
 * not exist until the handoff migration is installed, so its absence is the
 * NORMAL case for the whole milestone and must reach a page as the same
 * not-provisioned state a missing table does — never as an error, never as a
 * throw (ARCHITECTURE.md §4.1, §4.3).
 *
 * These two codes only ever mean an absence to a caller that ASKED for a
 * function; see `AskedObject`.
 */
const FUNCTION_ABSENT_CODES: ReadonlySet<string> = new Set(["PGRST202", "42883"]);

/**
 * What the caller asked the database for — the thing an absence code is
 * allowed to be an absence OF.
 *
 * A table read and a function call do not share a vocabulary of absence, and
 * the same code means different things to each (`42883` most of all). So the
 * classifier is told what was asked instead of guessing it from the database's
 * prose, and `"table"` is the default because that is what every read in this
 * module does: a caller that says nothing can never claim a function absence.
 */
export type AskedObject = "table" | "function";

/**
 * The absence codes each kind of caller may read as an absence of the object
 * it named. Nothing else is an absence — a code outside its own row is a
 * failure the database is reporting ABOUT something else, and it stays
 * `kind: "error"` carrying the database's own words.
 */
const ABSENCE_CODES: Readonly<Record<AskedObject, ReadonlySet<string>>> = {
  // Plus the column codes, which name a column OF the table that was asked
  // for; they are handled separately because they mine the column's name.
  table: TABLE_ABSENT_CODES,
  function: FUNCTION_ABSENT_CODES,
};

/**
 * A `42883` that is NOT an absent function even when a function WAS asked for.
 *
 * Postgres raises `undefined_function` for a missing OPERATOR as well as for a
 * missing function — `operator does not exist: timestamp with time zone ~~*
 * unknown` is the shape, measured on this project's own staging when an
 * `ilike` was aimed at a non-text column (admin-window/BUG-0058, pinned in
 * `tests/live/residue.live.test.ts`). That is a query this app got WRONG, not
 * an object the database is missing.
 *
 * It is no longer what keeps a TABLE read honest — the kind of object the
 * caller asked for is (admin-window/BUG-0080: `42883` also arrives from a
 * table read as `function to_tsvector(timestamp with time zone) does not
 * exist`, a missing OVERLOAD of a function the caller never named, and no
 * sentence match stays one shape ahead of Postgres). It survives as the
 * narrower guard on the function arm alone, where a function's own body can
 * raise it. It can only ever REFUSE an absence claim, never make one, which is
 * the only direction a prose match is safe in.
 *
 * A `42883` that says nothing at all is still an absent function to a caller
 * that asked for one: the code plus what was asked is what classifies, and
 * this is a single named exception to it, not a requirement that the database
 * explain itself.
 */
const MISSING_OPERATOR = /\boperator does not exist\b/i;

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
 * A part of the account that is a DOCUMENT rather than prose: its first
 * non-blank character is `<`.
 *
 * That is the WHOLE question, and it is asked about the SHAPE of what the
 * client handed back — never about which intermediary sent it and never about
 * which surface will render it (admin-window/BUG-0170). Measured 2026-09-10
 * against staging: a facet value the WAF in FRONT of PostgREST disliked was
 * answered by the WAF, not by PostgREST, so supabase-js handed back a
 * 4,547-character Cloudflare "Attention Required!" page as `error.message` and
 * the whole document reached the operator inside an app-written sentence
 * (`ErrorLine` renders `${reading} — ${failed}`).
 *
 * Three shapes answer `<` and all three are documents: the doctype that page
 * opened with, an `<html …>` fragment sent with no doctype, and an
 * `<?xml …?>` prolog. Nothing else is inspected — no tag stripping, no entity
 * decoding, no length cap on prose, no codepoint blocklist and no second
 * detector for a shape nobody has measured. That restraint is the point
 * (ARCHITECTURE.md §7 common violations row 15, LESSONS 4): a blocklist
 * chased one family at a time is the class this rule was promoted for. A
 * database message that merely CONTAINS angle brackets — `operator does not
 * exist: text <-> integer` — begins with a letter and is untouched.
 */
function isDocument(part: string): boolean {
  return part.startsWith("<");
}

/**
 * What an account says INSTEAD of a document: counted, never spelled.
 *
 * The clause quotes no part of what arrived — not its `<title>`, not its first
 * line, not a tag — because the rule is that text this app did not author
 * never sits inside a sentence this app wrote. What survives is the one fact
 * an operator needs and the document cannot be trusted to state: something
 * other than the database answered, and this much of it arrived. The number is
 * the length of the part exactly as the client delivered it, before any
 * trimming of ours, so it is the same number a reader gets from
 * `error.message.length`.
 *
 * The URL-value predicate in `src/lib/url/spellable.ts` is deliberately NOT
 * called here and not widened to reach this: it answers the URL-value
 * question, and a shared predicate answering a second question gets widened by
 * whichever question broke last (LESSONS 4; that module's own doc refuses it
 * too). Nothing in this file names it — the check that keeps it that way is
 * this ticket's, in the tracker.
 */
function documentInstead(raw: string): string {
  return (
    `a ${raw.length}-character markup document arrived here instead of the ` +
    `database's own words`
  );
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
 * A part that is a DOCUMENT rather than prose does not cross at all: it is
 * replaced by `documentInstead`'s counted clause before anything else looks at
 * it, so no surface below this function needs a reduction of its own.
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
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    // The ONE place the app decides what an account may carry, for every read
    // in `lib/db/**`: a document-shaped part becomes an app-authored,
    // bounded description of what arrived; prose crosses verbatim. Every
    // surface — the claims card, the paging routes' error arms — inherits
    // this with no line of its own (admin-window/BUG-0170).
    const part = isDocument(trimmed) ? documentInstead(raw) : trimmed;
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
 * A function-absent code names nothing further: `missing` is the name the
 * caller passed, which is the name it called (admin-window/TASK-0047).
 *
 * **An absence claim is about the object the caller ASKED for** (`asked`,
 * default `"table"`; ARCHITECTURE.md §4.3, §10). A table read may never claim
 * an absent function and a function call may never claim an absent table: the
 * database reports a missing object it names ITSELF, and `missing` is the
 * object WE named, so a code outside the caller's own vocabulary is a failure
 * about some third thing and stays an error. Postgres raises `42883` at a
 * plain table read for a missing OVERLOAD of a function nobody asked for
 * (`function to_tsvector(timestamp with time zone) does not exist`, measured
 * on staging 2026-09-08) — reading that as an absence told an operator to
 * install a table that is right there, holding rows (admin-window/BUG-0080).
 *
 * Everything that is not an absence code OF WHAT WAS ASKED is `kind: "error"`
 * carrying the database's message verbatim.
 */
export function classify(
  error: unknown,
  missing: string,
  asked: AskedObject = "table",
): DbResult<never> {
  const code = errorCode(error);
  const refuse = (): DbResult<never> => ({
    kind: "error",
    reading: missing,
    message: errorMessage(error),
  });
  if (code === null) return refuse();

  if (ABSENCE_CODES[asked].has(code)) {
    // The absent OPERATOR shares `42883` with the absent function, and a
    // function's own body can raise it; it is not an absence of what was
    // asked for, so it falls through to `error`.
    if (asked === "function" && MISSING_OPERATOR.test(messageOf(error))) {
      return refuse();
    }
    return { kind: "not_provisioned", missing };
  }

  // A column is absent OF the table that was asked for, so it is an absence
  // only for a table read — the column codes cannot describe a function call.
  if (asked === "table" && COLUMN_ABSENT_CODES.has(code)) {
    const column = columnFromMessage(messageOf(error));
    if (column === null || column === missing || missing.endsWith(`.${column}`)) {
      return { kind: "not_provisioned", missing };
    }
    return { kind: "not_provisioned", missing: `${missing}.${column}` };
  }

  return refuse();
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
  asked: AskedObject = "table",
): Promise<DbResult<T | null>> {
  try {
    const client = db ?? getDbClient();
    const { data, error } = await run(client);
    if (error !== null && error !== undefined) return classify(error, missing, asked);
    return { kind: "ok", data: data ?? null };
  } catch (thrown) {
    return classify(thrown, missing, asked);
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
 * A call to a database FUNCTION — the one read kind whose caller may be told
 * the function itself is absent.
 *
 * The `run` callback is what actually calls the function through the client's
 * procedure seam — spelled at the CALL SITE, never here, because no module
 * under `src/` may carry that call today (`tests/offline/browse/views.test.ts`,
 * "has no SQL-executing route and no whole-table browser"). `fn` is the name the
 * call used, so the not-provisioned card names what the app asked for. Which
 * is the whole reason this exists as its own seam rather than as a table read
 * with a function's name in it: absence is claimed about what was ASKED, and
 * only a caller that came through here asked for a function
 * (admin-window/TASK-0047 established the absence, admin-window/BUG-0080
 * narrowed it to this seam).
 *
 * M2's normal case: the resolver procedure is not installed until the handoff
 * migration is, so `not_provisioned` naming it is what the close slot renders,
 * every time, until it is (ARCHITECTURE.md §4.1, §4.3). It never throws, and
 * `ok` carries whatever the function returned — `null` when it returned
 * nothing.
 */
export async function callFunction<T>(
  fn: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<T>>,
  db?: SupabaseClient,
): Promise<DbResult<T | null>> {
  return runQuery<T>(fn, run, db, "function");
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

/* ── the second leg of a two-step join (ARCHITECTURE.md §4.2) ─────────────── */

/**
 * How many ids go into one `.in(...)`. PostgREST puts the list in the URL, so
 * an unchunked `.in()` over a 1,000-row id set builds a request long enough to
 * be refused by a proxy. Chunking keeps every request bounded.
 */
export const ID_CHUNK = 100;

/**
 * How many chunk requests may be in flight at once (admin-window/TASK-0062).
 *
 * `readRowsByIds` walked its chunks ONE AT A TIME, so a two-step join over an
 * id set spanning n chunks cost n round trips end to end and `/claims` paid
 * that latency on every load (admin-window/BUG-0138, FEAT-0014). The chunks
 * are independent reads of the same object, so they are issued together — but
 * BOUNDED: an unbounded fan-out over a 1,000-id set would open ten concurrent
 * requests at a database three repos share, which is the failure mode this
 * constant exists to prevent, not a number to raise when a page feels slow.
 */
export const CHUNK_FANOUT = 4;

/** Split a list into chunks of at most `size`. */
export function chunk<T2>(items: readonly T2[], size = ID_CHUNK): T2[][] {
  if (size <= 0) return [[...items]];
  const chunks: T2[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * The second leg of a two-step join (ARCHITECTURE.md §4.2): query A returned
 * rows, `ids` are its keys, and this runs query B `.in(...)` over them in
 * bounded chunks and concatenates the results.
 *
 * No ids means no query at all — an empty `.in()` is a pointless round trip,
 * and `ok: []` is the honest answer.
 *
 * The chunks are issued in BATCHES of at most `CHUNK_FANOUT`, batches in
 * chunk-index order, and every refusal guarantee the sequential loop made is
 * unchanged (admin-window/TASK-0062; SPEC F16 — only the clock moves):
 *
 *  - the rows concatenate in CHUNK-INDEX order, never completion order, so the
 *    result is the id set's own order however the requests interleave;
 *  - a batch holding a non-`ok` returns its LOWEST-INDEX one UNCHANGED —
 *    which is the answer the sequential loop gave, since it would have reached
 *    that chunk first — so a missing table still reaches the page as
 *    `not_provisioned` naming that table, and the rows already collected are
 *    discarded rather than returned as a half-filled `ok`;
 *  - no batch is started after a refusal is known, so a refused read still
 *    issues strictly fewer requests than there are chunks.
 *
 * Batches, rather than a promise pool that refills as each request lands: the
 * pool is equally bounded but its refusal depends on WHICH request happened to
 * land first, and a guarantee that only usually holds is not a guarantee. Here
 * the batch is awaited whole and scanned in index order, so the answer is the
 * same on every run.
 *
 * It lives here, beside the read kinds, rather than in `lib/db/gauges.ts`
 * where campaign admin-window/TASK-0007 first needed it: §4.2's two-step is
 * every reader's rule, and `lib/db/claims.ts` is the second module to join on
 * an id set (admin-window/TASK-0012). `gauges.ts` re-exports both names, so
 * every existing caller and test still imports them from where they were.
 */
export async function readRowsByIds<Row>(
  missing: string,
  ids: readonly string[],
  run: (db: SupabaseClient, chunkIds: string[]) => PromiseLike<DbResponse<Row[]>>,
  db?: SupabaseClient,
): Promise<DbResult<Row[]>> {
  if (ids.length === 0) return { kind: "ok", data: [] };
  const chunks = chunk(ids);
  const collected: Row[] = [];
  for (let start = 0; start < chunks.length; start += CHUNK_FANOUT) {
    // One batch, issued together. `readRows` never throws and never rejects
    // (ARCHITECTURE.md §4.1), so `Promise.all` here settles with one
    // `DbResult` per chunk rather than losing the others to a rejection.
    const batch = await Promise.all(
      chunks
        .slice(start, start + CHUNK_FANOUT)
        .map((chunkIds) =>
          readRows<Row>(missing, (client) => run(client, chunkIds), db),
        ),
    );
    // Scanned in chunk-index order, so both the row order and WHICH refusal
    // comes back are the sequential loop's answers, not the network's.
    for (const result of batch) {
      if (result.kind !== "ok") return result;
      collected.push(...result.data);
    }
  }
  return { kind: "ok", data: collected };
}
