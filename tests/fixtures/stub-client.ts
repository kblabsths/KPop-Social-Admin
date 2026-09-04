import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A stub Supabase client that returns a SCRIPTED PostgREST response
 * (campaign admin-window). The offline suite never touches a network, so this
 * is how every `lib/db/**` read is exercised.
 *
 * It records the chain each query built (`.select().eq().order()` …) so a test
 * can assert the shape of the query as well as what it did with the answer,
 * and it accepts any builder method: the script decides the answer, not the
 * chain.
 */

/** What a scripted query resolves to. Any omitted field defaults to null. */
export interface ScriptedResponse {
  data?: unknown;
  error?: unknown;
  /** For `head: true, count: "exact"` reads. */
  count?: number | null;
}

/** One step of a query chain, as it was called. */
export interface RecordedStep {
  method: string;
  args: unknown[];
}

/** One query, from `.from(table)` to the await. */
export interface RecordedCall {
  table: string;
  steps: RecordedStep[];
}

export interface StubClient {
  /** Cast to the real client type, for handing to a `lib/db` read. */
  asSupabaseClient(): SupabaseClient;
  /** Every query built through this stub, in order. */
  readonly calls: RecordedCall[];
  /** The table names read, in order — the names the query actually used. */
  tablesRead(): string[];
}

/** A script: one response per table, or a queue of responses per table. */
export type Script = Record<string, ScriptedResponse | ScriptedResponse[]>;

function settled(response: ScriptedResponse) {
  return {
    data: response.data ?? null,
    error: response.error ?? null,
    count: response.count ?? null,
    status: response.error ? 400 : 200,
    statusText: response.error ? "Bad Request" : "OK",
  };
}

export function stubClient(script: Script): StubClient {
  const calls: RecordedCall[] = [];
  const queues: Record<string, ScriptedResponse[]> = {};
  for (const [table, scripted] of Object.entries(script)) {
    queues[table] = Array.isArray(scripted) ? [...scripted] : [scripted];
  }

  function nextResponse(table: string): ScriptedResponse {
    const queue = queues[table];
    if (queue === undefined) {
      throw new Error(
        `stub client: no scripted response for table '${table}'`,
      );
    }
    // A single scripted response answers every read of that table; a queue is
    // consumed one per read and its last entry answers the rest.
    return queue.length > 1 ? (queue.shift() as ScriptedResponse) : queue[0];
  }

  function query(table: string): unknown {
    const call: RecordedCall = { table, steps: [] };
    calls.push(call);
    const resolve = () => Promise.resolve(settled(nextResponse(table)));

    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property === "symbol") return undefined;
          if (property === "then") {
            return (
              onFulfilled?: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => resolve().then(onFulfilled, onRejected);
          }
          if (property === "catch") {
            return (onRejected?: (reason: unknown) => unknown) =>
              resolve().catch(onRejected);
          }
          if (property === "finally") {
            return (onFinally?: () => void) => resolve().finally(onFinally);
          }
          return (...args: unknown[]) => {
            call.steps.push({ method: property, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const client = {
    from(table: string) {
      return query(table);
    },
  };

  return {
    asSupabaseClient: () => client as unknown as SupabaseClient,
    calls,
    tablesRead: () => calls.map((call) => call.table),
  };
}

/* ── the error shapes a real PostgREST/Postgres failure carries ───────────── */

/** PGRST205 — the table or view is not in PostgREST's schema cache. */
export function tableNotInSchemaCache(table: string) {
  return {
    code: "PGRST205",
    details: null,
    hint: null,
    message: `Could not find the table 'public.${table}' in the schema cache`,
  };
}

/** 42P01 — Postgres's own undefined_table. */
export function undefinedTable(table: string) {
  return {
    code: "42P01",
    details: null,
    hint: null,
    message: `relation "public.${table}" does not exist`,
  };
}

/** PGRST204 — the column is not in PostgREST's schema cache. */
export function columnNotInSchemaCache(table: string, column: string) {
  return {
    code: "PGRST204",
    details: null,
    hint: null,
    message: `Could not find the '${column}' column of '${table}' in the schema cache`,
  };
}

/** 42703 — Postgres's own undefined_column, quoted (an unqualified reference). */
export function undefinedColumn(column: string) {
  return {
    code: "42703",
    details: null,
    hint: null,
    message: `column "${column}" does not exist`,
  };
}

/**
 * 42703 with the message Postgres spells for a QUALIFIED reference — bare, no
 * quotes at all: `column events.badcol does not exist`. This is what a page
 * selecting an explicit column list off a table gets.
 */
export function undefinedQualifiedColumn(table: string, column: string) {
  return {
    code: "42703",
    details: null,
    hint: null,
    message: `column ${table}.${column} does not exist`,
  };
}

/** 42703 as Postgres spells it for an INSERT/UPDATE target column. */
export function undefinedColumnOfRelation(table: string, column: string) {
  return {
    code: "42703",
    details: null,
    hint: null,
    message: `column "${column}" of relation "${table}" does not exist`,
  };
}

/**
 * 22P02 — `invalid_text_representation`: the id in the URL is not a uuid at
 * all, so Postgres refuses the comparison before any row is considered.
 *
 * Measured against staging on a production build, 2026-09-03 (QA, campaign
 * admin-window/BUG-0052): `GET /records/groups/not-a-uuid` answers 200 and the
 * page renders this error, and so does a uuid one character short, and so does
 * one carrying a trailing space (which reaches the query as `%20`).
 */
export function invalidUuidSyntax(id: string) {
  return {
    code: "22P02",
    details: null,
    hint: null,
    message: `invalid input syntax for type uuid: "${id}"`,
  };
}

/**
 * 42501 — permission denied. An ARBITRARY failure as far as the data layer is
 * concerned: it is not an absence, so it must surface the database's own
 * message verbatim.
 */
export function permissionDenied(table: string) {
  return {
    code: "42501",
    details: null,
    hint: null,
    message: `permission denied for table ${table}`,
  };
}

/**
 * 57014 — Postgres's own `query_canceled`: the statement ran past the
 * database's `statement_timeout` and was killed.
 *
 * Measured against staging 2026-09-02 (admin-window/TASK-0031: `pending_claims`
 * cannot be read). The shape matters twice over: it is a real, populated
 * PostgREST error body — and a `head: true` count never receives it, because a
 * HEAD response has no body for supabase-js to parse, so the same failure
 * arrives as `code=undefined, msg=""` (admin-window/TASK-0032).
 */
export function statementTimeout() {
  return {
    code: "57014",
    details: null,
    hint: null,
    message: "canceling statement due to statement timeout",
  };
}

/**
 * The SAME failure as a `head: true` count receives it: nothing at all.
 *
 * supabase-js parses the error out of the response BODY, and a HEAD response
 * carries none — so a real 57014 arrived as an error object with no code and
 * an empty message, and a timeout was reported as a blank. This is the shape
 * `countRows` must refuse to describe as anything but "no parseable error"
 * (admin-window/TASK-0032).
 */
export function unparseableFailure() {
  return { code: undefined, details: undefined, hint: undefined, message: "" };
}

/**
 * What supabase-js hands back when the TRANSPORT fails — probed against the
 * http harness's sentinel URL (admin-window/BUG-0016).
 *
 * The shape is the point: `message` is a bare wrapper that names nothing,
 * the real cause lives in `details`, and `hint`/`code` come back EMPTY —
 * an empty code must not be read as an absence code. The cause string differs
 * per environment ("bad port" here); the shape does not.
 */
export function transportFailure(cause = "bad port") {
  return {
    code: "",
    details:
      "TypeError: fetch failed\n" +
      `    Caused by: Error: ${cause}\n` +
      `        Error: ${cause}\n` +
      "            at makeNetworkError (node:internal/deps/undici/undici:6027:35)",
    hint: "",
    message: "TypeError: fetch failed",
  };
}
