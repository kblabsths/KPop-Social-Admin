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

/** One query, from `.from(table)` — or `.rpc(name)` — to the await. */
export interface RecordedCall {
  /** The object the call named: a table/view for `.from`, a function for `.rpc`. */
  table: string;
  steps: RecordedStep[];
  /**
   * Which kind of object that name is (campaign admin-window/TASK-0047).
   * Absent means `"table"`, so every call site written before functions
   * existed reads unchanged.
   */
  kind?: "table" | "function";
}

export interface StubClient {
  /** Cast to the real client type, for handing to a `lib/db` read. */
  asSupabaseClient(): SupabaseClient;
  /** Every query built through this stub, in order. */
  readonly calls: RecordedCall[];
  /** The table names read, in order — the names the query actually used. */
  tablesRead(): string[];
  /** The function names CALLED, in order — `.rpc(name)`, never a `.from`. */
  functionsCalled(): string[];
}

/**
 * A script: one response per OBJECT, or a queue of responses per object.
 *
 * The key is the name the query names — a table or view for `.from(name)`, a
 * function for `.rpc(name)`. One namespace, because PostgREST answers both
 * over the same connection and a test scripting a call scripts one answer.
 */
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

  function query(
    table: string,
    kind: "table" | "function" = "table",
    initial?: RecordedStep,
  ): unknown {
    const call: RecordedCall = { table, steps: initial ? [initial] : [], kind };
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
    /**
     * A PostgREST function call (campaign admin-window/TASK-0047).
     *
     * Same builder, same script, same recording as `.from` — supabase-js
     * returns a filter builder from `.rpc()` too, so the arguments are just
     * the first recorded step and the script decides the answer. The M2 close
     * calls one function, and its ABSENCE is the case that has to render
     * (ARCHITECTURE.md §4.1); without this a test of that path would have to
     * hand-roll a second fake client.
     */
    rpc(name: string, args?: unknown) {
      return query(name, "function", {
        method: "rpc",
        args: args === undefined ? [] : [args],
      });
    },
  };

  return {
    asSupabaseClient: () => client as unknown as SupabaseClient,
    calls,
    tablesRead: () =>
      calls.filter((call) => call.kind !== "function").map((call) => call.table),
    functionsCalled: () =>
      calls.filter((call) => call.kind === "function").map((call) => call.table),
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

/* ── the FUNCTION shapes (campaign admin-window/TASK-0047) ───────────────── */

/**
 * PGRST202 — PostgREST cannot find the FUNCTION in its schema cache.
 *
 * Measured against staging 2026-09-08 on `ubfjjqlvnpnoborczbdb.supabase.co`,
 * read-only, by calling the function M2 settles through before it is
 * installed: `db.rpc("settle_review_item", { p_decision })` answers
 *
 *   code    PGRST202
 *   message Could not find the function public.settle_review_item(p_decision)
 *           in the schema cache
 *   hint    Perhaps you meant to call the function public.<some other function>
 *
 * and writes nothing, because there is nothing there to write.
 *
 * **The trap this shape carries**, for whoever builds the call seam: PostgREST
 * answers PGRST202 for an existing function called with the WRONG ARGUMENT
 * NAMES too, and the app cannot tell the two apart from the code. The
 * argument names in the call are therefore part of the contract; get them
 * wrong and a provisioned function renders as an absent one.
 */
export function functionNotInSchemaCache(fn: string, args = "p_decision") {
  return {
    code: "PGRST202",
    details: null,
    hint: `Perhaps you meant to call the function public.${fn}_v2`,
    message: `Could not find the function public.${fn}(${args}) in the schema cache`,
  };
}

/**
 * 42883 — Postgres's own `undefined_function`, as it spells a missing
 * function: the shape a call that got PAST the schema cache raises, e.g. a
 * function whose own body calls one that is not installed.
 */
export function undefinedFunction(fn: string, args = "jsonb") {
  return {
    code: "42883",
    details: null,
    hint: "No function matches the given name and argument types. You might need to add explicit type casts.",
    message: `function public.${fn}(${args}) does not exist`,
  };
}

/**
 * 42883 again — and NOT an absent function: Postgres raises
 * `undefined_function` for a missing OPERATOR as well.
 *
 * Measured against staging 2026-09-08, read-only, by aiming an `ilike` at a
 * `timestamptz` column — the exact query that broke the residue sweep
 * (admin-window/BUG-0058): `code 42883`, `message "operator does not exist:
 * timestamp with time zone ~~* unknown"`. The table is right there; the QUERY
 * was wrong. Classifying it as an absence would be a false claim about a
 * provisioned object, so it stays an error carrying those words.
 */
export function missingOperator(left = "timestamp with time zone", operator = "~~*") {
  return {
    code: "42883",
    details: null,
    hint: "No operator matches the given name and argument types. You might need to add explicit type casts.",
    message: `operator does not exist: ${left} ${operator} unknown`,
  };
}

/**
 * 42883 a third time — raised by a plain TABLE read, and naming a function the
 * caller never asked for.
 *
 * Measured read-only on `ubfjjqlvnpnoborczbdb.supabase.co` 2026-09-08
 * (admin-window/TASK-0047 QA): `db.from("groups").select("id").filter(
 * "created_at", "fts", "x")` — a full-text filter aimed at a `timestamptz` —
 * answers `code 42883`, `message "function to_tsvector(timestamp with time
 * zone) does not exist"`. `plfts` on a `uuid` gives the same shape.
 *
 * The absent function is real, but it is an OVERLOAD Postgres does not have,
 * not the object the query asked for: `groups` is right there holding rows.
 * The operator sentence is therefore not the only 42883 a provisioned table
 * can raise, which is what `missingOperator` alone does not cover.
 */
export function missingFunctionOnTableRead(argumentType = "timestamp with time zone") {
  return {
    code: "42883",
    details: null,
    hint: "No function matches the given name and argument types. You might need to add explicit type casts.",
    message: `function to_tsvector(${argumentType}) does not exist`,
  };
}

/**
 * 23502 — `not_null_violation`. A NEIGHBOUR of the absence codes and not one
 * of them: clearing a `not null` cell is refused by the database and the
 * surface must show that refusal (ARCHITECTURE.md §9.1's deliberate walkable
 * error path), never call the object absent.
 */
export function notNullViolation(table: string, column: string) {
  return {
    code: "23502",
    details: `Failing row contains (…).`,
    hint: null,
    message: `null value in column "${column}" of relation "${table}" violates not-null constraint`,
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
