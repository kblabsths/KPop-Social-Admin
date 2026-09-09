import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ROW_CAP,
  callFunction,
  classify,
  readComplete,
  readCount,
  readOne,
  readRows,
  type AskedObject,
  type DbResult,
} from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import {
  columnNotInSchemaCache,
  functionNotInSchemaCache,
  missingFunctionOnTableRead,
  missingOperator,
  notNullViolation,
  permissionDenied,
  statementTimeout,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  undefinedColumn,
  undefinedColumnOfRelation,
  undefinedFunction,
  undefinedQualifiedColumn,
  undefinedTable,
} from "../../fixtures/stub-client";
import {
  fieldProvenanceRow,
  observationRow,
  pendingClaimsInEveryBucket,
  PENDING_CLAIM_BUCKETS,
  resolutionRunRow,
  reviewItemShapes,
  runRow,
  sourceRow,
} from "../../fixtures/rows";

/**
 * Acceptance test 9's offline half (campaign admin-window): absence is
 * classified by code, everything else surfaces the database's own words, and
 * no exported read throws for any of it.
 */

/**
 * The function M2 settles a review item through (campaign
 * admin-window/TASK-0047, spec F9/F10).
 *
 * It is spelled in this test and NOT in `lib/db/tables.ts`: this ticket adds
 * no call seam, and the write-surface guard
 * (`tests/offline/edit/config.test.ts`, "the write surface of the whole repo")
 * forbids the name on a code line under `src/` until one exists. Nothing in
 * the classifier knows it — `missing` is whatever the caller passed, which is
 * the whole contract this file grades.
 */
const SETTLE_FUNCTION = "settle_review_item";

/**
 * Every code that means "the object you asked for is not here", with the
 * object kind it is about. Six, since admin-window/TASK-0047 added the two
 * FUNCTION codes to the four about a table, a view or a column
 * (ARCHITECTURE.md §4.1).
 *
 * The fourth column is the read a caller must have ASKED for before the code
 * can mean an absence AT ALL (admin-window/BUG-0080): a column is a column OF
 * the table that was read, and the two function codes say nothing about a
 * table. Every row is graded in both directions below — an absence when its
 * own kind was asked for, an error when the other kind was (LESSONS 3).
 */
const ABSENCE_CODES: ReadonlyArray<
  readonly [string, string, unknown, AskedObject]
> = [
  ["PGRST205", "table", tableNotInSchemaCache(T.verdicts), "table"],
  ["42P01", "table", undefinedTable(T.verdicts), "table"],
  ["PGRST204", "column", columnNotInSchemaCache(T.reviewItems, "severity"), "table"],
  ["42703", "column", undefinedColumn("severity"), "table"],
  ["PGRST202", "function", functionNotInSchemaCache(SETTLE_FUNCTION), "function"],
  ["42883", "function", undefinedFunction(SETTLE_FUNCTION), "function"],
];

/** The name a caller of each kind passes — a table it read, a function it called. */
const ASKED_NAME: Readonly<Record<AskedObject, string>> = {
  table: T.reviewItems,
  function: SETTLE_FUNCTION,
};

/** The kind the caller did NOT ask for. */
const otherThan = (asked: AskedObject): AskedObject =>
  asked === "table" ? "function" : "table";

/**
 * Codes that look nothing like an absence and must never be read as one — the
 * other half of the guard (LESSONS 3: a classifier proves itself on both kinds
 * of input, or its green says only that it classifies nothing).
 *
 * `42883` appears in BOTH lists on purpose, in its two shapes: Postgres raises
 * `undefined_function` for a missing OPERATOR as well as for a missing
 * function, and an `ilike` aimed at a `timestamptz` is a query this app got
 * wrong, not an object the database is missing (measured on staging
 * 2026-09-08; admin-window/BUG-0058 is where it bit).
 */
const NEIGHBOURING_CODES: ReadonlyArray<readonly [string, unknown]> = [
  ["57014 statement timeout", statementTimeout()],
  ["23502 not-null violation", notNullViolation(T.walkSandbox, "label")],
  ["42883 missing OPERATOR", missingOperator()],
];

describe("classify", () => {
  it("reads a table-absent code as not_provisioned naming the table", () => {
    for (const error of [
      tableNotInSchemaCache(T.reviewItems),
      undefinedTable(T.reviewItems),
    ]) {
      expect(classify(error, T.reviewItems)).toEqual({
        kind: "not_provisioned",
        missing: T.reviewItems,
      });
    }
  });

  /**
   * Every spelling a column-absent message reaches us in must name the column,
   * never collapse to the bare table — a table that is fully provisioned but
   * missing one column would otherwise read as absent.
   */
  const COLUMN_ABSENT_MESSAGE_FORMS: ReadonlyArray<[string, unknown]> = [
    ["PostgREST quoted, PGRST204", columnNotInSchemaCache(T.reviewItems, "severity")],
    ["Postgres quoted, unqualified", undefinedColumn("severity")],
    [
      "Postgres quoted, of relation",
      undefinedColumnOfRelation(T.reviewItems, "severity"),
    ],
    [
      "Postgres UNQUOTED, qualified",
      undefinedQualifiedColumn(T.reviewItems, "severity"),
    ],
  ];

  it.each(COLUMN_ABSENT_MESSAGE_FORMS)(
    "reads a column-absent code as not_provisioned naming the column (%s)",
    (_form, error) => {
      const result = classify(error, T.reviewItems);
      expect(result.kind).toBe("not_provisioned");
      // The column is named, and the table it belongs to is still carried.
      expect(result).toMatchObject({ missing: `${T.reviewItems}.severity` });
    },
  );

  it("never reports a bare table for a column-absent code that named a column", () => {
    for (const [, error] of COLUMN_ABSENT_MESSAGE_FORMS) {
      expect(classify(error, T.reviewItems)).not.toMatchObject({
        missing: T.reviewItems,
      });
    }
  });

  it("falls back to the queried name when a column-absent message names nothing", () => {
    // No column in the message: report the object the query actually asked
    // for, rather than guessing a column name out of the prose.
    expect(
      classify({ code: "PGRST204", message: "schema cache reload failed" }, T.sources),
    ).toEqual({ kind: "not_provisioned", missing: T.sources });
    expect(
      classify({ code: "42703", message: "column does not exist" }, T.sources),
    ).toEqual({ kind: "not_provisioned", missing: T.sources });
  });

  it("carries the database's own message verbatim for any other failure", () => {
    const error = permissionDenied(T.verdicts);
    expect(classify(error, T.verdicts)).toEqual({
      kind: "error",
      // The object the query asked for, so a page composing several reads can
      // say WHICH one refused (admin-window/BUG-0016).
      reading: T.verdicts,
      message: expect.stringContaining(error.message),
    });
  });

  it("carries the message of a thrown Error, a thrown string, and a bare object", () => {
    expect(classify(new Error("fetch failed"), T.runs)).toEqual({
      kind: "error",
      reading: T.runs,
      message: "fetch failed",
    });
    expect(classify("socket hang up", T.runs)).toEqual({
      kind: "error",
      reading: T.runs,
      message: "socket hang up",
    });
    // No message anywhere: still an error, still never an invented sentence.
    expect(classify({ status: 503 }, T.runs).kind).toBe("error");
  });

  it("does not treat an absence code on a different-looking error as ok", () => {
    expect(classify({ code: "PGRST116", message: "no rows" }, T.events).kind).toBe(
      "error",
    );
  });

  /* ── the absent FUNCTION (campaign admin-window/TASK-0047) ─────────────── */

  it("reads a function-absent code as not_provisioned naming the function", () => {
    // The M2 normal case: `settle_review_item` is not installed on the
    // database `main` deploys against, so a call to it must reach a page as
    // the same absence a missing table is — never as an error, never a throw.
    for (const error of [
      functionNotInSchemaCache(SETTLE_FUNCTION),
      undefinedFunction(SETTLE_FUNCTION),
    ]) {
      expect(classify(error, SETTLE_FUNCTION, "function")).toEqual({
        kind: "not_provisioned",
        missing: SETTLE_FUNCTION,
      });
    }
  });

  it.each(ABSENCE_CODES)(
    "reads %s (an absent %s) as not_provisioned for a caller that asked for one",
    (_code, _kind, error, asked) => {
      const result = classify(error, ASKED_NAME[asked], asked);
      expect(result.kind).toBe("not_provisioned");
      expect(result).toMatchObject({ missing: expect.stringContaining(ASKED_NAME[asked]) });
    },
  );

  it.each(ABSENCE_CODES)(
    "leaves %s (an absent %s) an ERROR for a caller that asked for the other kind",
    (_code, _kind, error, asked) => {
      // The other half of the guard, and the whole of admin-window/BUG-0080:
      // the database names the object IT could not find; `missing` is the
      // object WE named. When those are different kinds of thing, the app has
      // learned nothing about what it asked for, so it may not claim it absent.
      const asking = otherThan(asked);
      const result = classify(error, ASKED_NAME[asking], asking);
      expect(result.kind).toBe("error");
      expect(result).not.toHaveProperty("missing");
      if (result.kind !== "error") return;
      expect(result.reading).toBe(ASKED_NAME[asking]);
      expect(result.message).toContain((error as { message: string }).message);
    },
  );

  it("names the function the CALLER passed, never one mined from the message", () => {
    // A 42883 from inside the function names the callee — `apply_resolution`,
    // which `settle_review_item`'s body calls. The card still names what the
    // app asked for, in the app's own spelling (ARCHITECTURE.md §4.1).
    expect(
      classify(undefinedFunction("apply_resolution"), SETTLE_FUNCTION, "function"),
    ).toEqual({ kind: "not_provisioned", missing: SETTLE_FUNCTION });
  });

  it.each(NEIGHBOURING_CODES)(
    "leaves %s red, carrying the database's own words",
    (_label, error) => {
      const result = classify(error, T.groups);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.reading).toBe(T.groups);
      expect(result.message).toContain((error as { message: string }).message);
      // An error is never an absence claim: nothing here says the object is
      // missing, and nothing here carries data.
      expect(result).not.toHaveProperty("missing");
      expect(result).not.toHaveProperty("data");
    },
  );

  /**
   * QA's strict pin for admin-window/BUG-0080, flipped back to a plain
   * `it(...)` by the fix. Nothing else about the case changed.
   */
  it("never calls a PROVISIONED table absent because a TABLE read raised 42883", () => {
    // MEASURED read-only on the declared staging target 2026-09-08
    // (admin-window/TASK-0047 QA): `db.from("groups").select("id")
    // .filter("created_at", "fts", "x")` answers 42883 "function
    // to_tsvector(timestamp with time zone) does not exist" — a non-operator
    // 42883 from a plain TABLE read. `groups` is provisioned and holds rows,
    // so "not_provisioned: groups" is a false claim about an object that is
    // right there — the exact harm the operator exception exists to prevent,
    // reached by the sentence the exception does not match.
    const result = classify(missingFunctionOnTableRead(), T.groups);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.groups);
    expect(result.message).toContain("to_tsvector");
  });

  it("tells the 42883s apart by what the caller asked for", () => {
    // Same code, opposite verdicts, and what separates them is what was ASKED
    // — not the database's prose (admin-window/BUG-0080). Asserted together so
    // a later simplification of either arm reddens here rather than silently
    // turning a provisioned table into an absence.
    expect(
      classify(undefinedFunction(SETTLE_FUNCTION), SETTLE_FUNCTION, "function").kind,
    ).toBe("not_provisioned");
    expect(classify(missingOperator(), T.groups).kind).toBe("error");
    // A 42883 that explains nothing is still an absent function TO A CALLER
    // THAT ASKED FOR ONE: the code plus the question classifies, and the
    // database is never required to explain itself.
    expect(classify({ code: "42883" }, SETTLE_FUNCTION, "function")).toEqual({
      kind: "not_provisioned",
      missing: SETTLE_FUNCTION,
    });
    // The same silent code reaching a TABLE read claims nothing at all.
    expect(classify({ code: "42883" }, T.groups).kind).toBe("error");
    // And a function's own body can still raise the missing OPERATOR, which is
    // not the function being absent either.
    expect(classify(missingOperator(), SETTLE_FUNCTION, "function").kind).toBe("error");
  });

  it("keeps every 42883 a TABLE read can raise red, not just the operator one", () => {
    // The pin above, widened past the one shape it measured (BUG-0080): a
    // `groups` read carrying an `fts`/`plfts` filter raises 42883 saying
    // `function to_tsvector(<type>) does not exist` — a missing OVERLOAD of a
    // function the app never named, from a table that is right there holding
    // rows. Every 42883 a table read can raise is graded here, because the
    // operator sentence was only the first shape anyone had met.
    const shapes: ReadonlyArray<readonly [string, unknown]> = [
      ["a missing function overload", missingFunctionOnTableRead()],
      ["a missing overload on another type", missingFunctionOnTableRead("uuid")],
      ["the missing operator", missingOperator()],
      ["a 42883 that explains nothing", { code: "42883", message: "" }],
      ["PGRST202, which a table read cannot mean", functionNotInSchemaCache("to_tsvector")],
    ];
    for (const [label, error] of shapes) {
      const result = classify(error, T.groups);
      expect(result.kind, label).toBe("error");
      // Nothing here may reach a card as a claim about `groups`.
      expect(result, label).not.toHaveProperty("missing");
      if (result.kind !== "error") continue;
      expect(result.reading, label).toBe(T.groups);
    }
  });

  it("cannot claim a function absence for a caller that did not ask for one", () => {
    // The default is the safe one: a caller that says nothing asked for a
    // TABLE, so a helper or a call site that forgets to say so gets an honest
    // error rather than a confident false absence.
    for (const error of [
      functionNotInSchemaCache(SETTLE_FUNCTION),
      undefinedFunction(SETTLE_FUNCTION),
    ]) {
      expect(classify(error, T.groups).kind).toBe("error");
      expect(classify(error, T.groups, "table").kind).toBe("error");
    }
  });
});

/**
 * The client's own account of a failure (admin-window/BUG-0016).
 *
 * `message` alone is not the account. supabase-js wraps a transport failure as
 * `message: "TypeError: fetch failed"` and puts the REAL cause in `details`,
 * so a reader of `message` alone ships exactly the generic wrapper the Feel
 * forbids ("errors are never swallowed and never replaced with a generic
 * message"). Everything below is about what survives into the `DbResult`.
 */
describe("the database client's own account", () => {
  it("carries the cause out of details when the message is only a wrapper", () => {
    const result = classify(transportFailure(), T.events);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    // The cause, verbatim — this is the whole bug: it used to be dropped.
    expect(result.message).toContain("bad port");
    expect(result.message).toContain("Caused by");
    // And never the wrapper standing alone.
    expect(result.message).not.toBe(transportFailure().message);
  });

  it("says the wrapper once, not twice, when details repeats it", () => {
    // supabase-js's `details` opens with a copy of `message`. Printing both
    // tells an operator nothing and pushes the cause off the line.
    const result = classify(transportFailure(), T.events);
    if (result.kind !== "error") throw new Error("expected an error");
    const wrapper = transportFailure().message;
    expect(result.message.split(wrapper)).toHaveLength(2);
  });

  it("does not read an EMPTY code as a code, or print one", () => {
    // The transport failure comes back with code "" and hint "". Neither is
    // information, and "" is not an absence code.
    const result = classify(transportFailure(), T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).not.toContain("()");
    expect(result.message.trim()).toBe(result.message);
  });

  it("carries message, details, hint and code, in that order", () => {
    // The code was `42883` until admin-window/TASK-0047 taught the classifier
    // that an absent FUNCTION is `not_provisioned` — which would give this
    // case no message to order. The case is about the ORDER of the account's
    // four fields, so it now uses a code that is still an error; nothing else
    // about it changed.
    const error = {
      code: "42501",
      message: "permission denied for function settle",
      details: "the resolver called it with two arguments",
      hint: "No function matches the given name and argument types.",
    };
    const result = classify(error, T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    const at = (part: string) => result.message.indexOf(part);
    expect(at(error.message)).toBeGreaterThanOrEqual(0);
    expect(at(error.details)).toBeGreaterThan(at(error.message));
    expect(at(error.hint)).toBeGreaterThan(at(error.details));
    expect(at(error.code)).toBeGreaterThan(at(error.hint));
  });

  it("follows a thrown Error's cause chain", () => {
    // The other shape of the same failure: a fetch that throws straight
    // through arrives as an Error whose `cause` is the real one.
    const thrown = new Error("TypeError: fetch failed", {
      cause: new Error("bad port"),
    });
    const result = classify(thrown, T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("bad port");
  });

  it("survives a cause that points back at itself", () => {
    const looping: { message: string; cause?: unknown } = { message: "outer" };
    looping.cause = looping;
    const result = classify(looping, T.sources);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("outer");
  });

  it("survives a cause chain that cycles between TWO errors", () => {
    // The self-pointing cause above is the easy cycle. A ping-pong between two
    // errors never repeats a node, so a depth guard is the only thing stopping
    // it, and each node must still be said exactly once (QA, BUG-0016).
    const outer: { message: string; cause?: unknown } = { message: "outer" };
    const inner: { message: string; cause?: unknown } = { message: "inner" };
    outer.cause = inner;
    inner.cause = outer;

    const result = classify(outer, T.sources);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    for (const node of ["outer", "inner"]) {
      expect(result.message.split(node)).toHaveLength(2);
    }
  });

  it("names the read that failed, in the spelling the query used", () => {
    for (const table of [T.events, T.fieldProvenance, T.sources]) {
      expect(classify(transportFailure(), table)).toMatchObject({
        kind: "error",
        reading: table,
      });
    }
  });

  it("invents nothing when the client said nothing at all", () => {
    // No message, no details: still an error, still never a sentence of ours.
    const result = classify({}, T.runs);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.toLowerCase()).not.toContain("something went wrong");
    expect(result.message.toLowerCase()).not.toContain("sorry");
  });
});

/**
 * The account reaches a screen, so it must not carry a credential.
 *
 * The host of an unreachable database IS the client's own account of what it
 * could not reach and stays. A key never may — including the one place a
 * `NAME=value` rule misses it, a DSN's password between the colon and the `@`.
 */
describe("the account never carries a credential", () => {
  const HOST = "abcdefghijklmnopqrst.supabase.co";

  /**
   * A JWT-SHAPED string, assembled at runtime.
   *
   * It has to have the real three-segment shape or it does not exercise the
   * rule, and a literal of that shape in a source file is what a secret
   * scanner is for — so the segments are encoded here instead of pasted.
   * Nothing in it is or ever was a credential.
   */
  const jwtShaped = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role: "not-a-real-role" })).toString("base64url"),
    "n0tar3alsignaturevalue",
  ].join(".");

  const cases: ReadonlyArray<[string, string, string]> = [
    [
      "a JWT",
      `GET https://${HOST}/rest/v1/events failed with apikey ${jwtShaped}`,
      jwtShaped,
    ],
    [
      "a named key in a query string",
      `connect ECONNREFUSED https://${HOST}/rest/v1/events?apikey=sbp_0000notarealkey0000`,
      "sbp_0000notarealkey0000",
    ],
    [
      "a DSN password, mid-line between the colon and the @",
      `could not connect to postgresql://postgres:n0tar3alpassw0rd@${HOST}:5432/postgres`,
      "n0tar3alpassw0rd",
    ],
    [
      "an Authorization header dump",
      `401 from https://${HOST}/rest/v1/events; Authorization: Bearer sb_secret_000notarealsecret000`,
      "sb_secret_000notarealsecret000",
    ],
  ];

  it.each(cases)("redacts %s while keeping the host", (_label, detail, secret) => {
    const result = classify(
      { code: "", hint: "", message: "TypeError: fetch failed", details: detail },
      T.events,
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).not.toContain(secret);
    // The host is what an operator needs in order to know where to look.
    expect(result.message).toContain(HOST);
  });

  /**
   * The rule is about the VALUE, not the field that happened to carry it.
   *
   * The cases above all ride `details`, because `details` is the field this
   * bug taught the account to read. The account now composes `message`,
   * `details`, `hint`, every `cause` in the chain and the `code`, and a
   * credential reaching a screen from any of them is the same leak — so the
   * scrub is asserted per CARRIER, not per case (admin-window/BUG-0016, QA).
   */
  const carriers: ReadonlyArray<[string, (secret: string) => unknown]> = [
    [
      "message",
      (secret) => ({
        code: "",
        message: `GET https://${HOST}/rest/v1/events rejected apikey ${secret}`,
      }),
    ],
    [
      "hint",
      (secret) => ({
        code: "",
        message: `TypeError: fetch failed reaching ${HOST}`,
        hint: `retry with apikey ${secret}`,
      }),
    ],
    [
      "a thrown Error's cause",
      (secret) =>
        new Error(`TypeError: fetch failed reaching ${HOST}`, {
          cause: new Error(`Authorization: Bearer ${secret}`),
        }),
    ],
    [
      "a cause three links down the chain",
      (secret) => ({
        message: `TypeError: fetch failed reaching ${HOST}`,
        cause: {
          message: "socket hang up",
          cause: {
            message: "retrying",
            cause: { message: `apikey ${secret}` },
          },
        },
      }),
    ],
    [
      "the code",
      (secret) => ({
        message: `TypeError: fetch failed reaching ${HOST}`,
        code: secret,
      }),
    ],
  ];

  it.each(carriers)("redacts a JWT arriving in %s", (_label, build) => {
    const result = classify(build(jwtShaped), T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    expect(result.message).not.toContain(jwtShaped);
    // No segment of it either: a key printed in halves is still the key.
    for (const segment of jwtShaped.split(".")) {
      expect(result.message).not.toContain(segment);
    }
    // Scrubbing must not become swallowing — the rest of the account stays.
    expect(result.message).toContain(HOST);
  });
});

/**
 * Criterion 4: the classification is UNCHANGED. `details` is now read for the
 * account, and it must not be read for the classification — an absent object
 * still renders gray and names itself, and only genuine failures render red.
 */
describe("the account does not disturb the classification", () => {
  it("still reads an absent table as not_provisioned when details names something else", () => {
    expect(
      classify(
        {
          ...tableNotInSchemaCache(T.verdicts),
          details: `Perhaps you meant the table 'public.${T.reviewItems}'`,
        },
        T.verdicts,
      ),
    ).toEqual({ kind: "not_provisioned", missing: T.verdicts });
  });

  it("still names the column from the MESSAGE when details quotes another name", () => {
    // The mined column must come from `message`; a quoted identifier in
    // `details` must not be able to take its place.
    expect(
      classify(
        {
          ...undefinedQualifiedColumn(T.events, "badcol"),
          details: "column 'starts_at' is the closest match",
        },
        T.events,
      ),
    ).toEqual({ kind: "not_provisioned", missing: `${T.events}.badcol` });
  });

  it("keeps a transport failure red rather than reading it as an absence", () => {
    // "Red means broken, never unavailable": a database that refuses to answer
    // is broken, whatever its empty code might tempt a reader into.
    expect(classify(transportFailure(), T.events).kind).toBe("error");
  });
});

describe("reads against a scripted PostgREST response", () => {
  it("returns ok with the rows the database returned", async () => {
    const items = reviewItemShapes();
    const stub = stubClient({ [T.reviewItems]: { data: items } });

    const result = await readRows(
      T.reviewItems,
      (db) => db.from(T.reviewItems).select("*").eq("status", "open"),
      stub.asSupabaseClient(),
    );

    expect(result).toEqual({ kind: "ok", data: items });
    // The query used the name from tables.ts, which is the name a
    // not-provisioned card would have to print.
    expect(stub.tablesRead()).toEqual([T.reviewItems]);
    expect(stub.calls[0].steps.map((step) => step.method)).toEqual([
      "select",
      "eq",
    ]);
  });

  it("returns ok with an empty array when there are no rows", async () => {
    const stub = stubClient({ [T.pendingClaims]: { data: null } });
    const result = await readRows(
      T.pendingClaims,
      (db) => db.from(T.pendingClaims).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: [] });
  });

  it("returns not_provisioned when the table is not in the schema cache", async () => {
    const stub = stubClient({
      [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
    });
    const result = await readRows(
      T.verdicts,
      (db) => db.from(T.verdicts).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "not_provisioned", missing: T.verdicts });
  });

  it("returns not_provisioned naming the column when a selected column is absent", async () => {
    // The real surface of the bare-qualified 42703: a read selecting an
    // explicit column list off a table that exists but lacks one column.
    const stub = stubClient({
      [T.events]: { error: undefinedQualifiedColumn(T.events, "badcol") },
    });
    const result = await readRows(
      T.events,
      (db) => db.from(T.events).select("event_id,badcol"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({
      kind: "not_provisioned",
      missing: `${T.events}.badcol`,
    });
  });

  it("returns the database's message when the read is refused", async () => {
    const error = permissionDenied(T.observations);
    const stub = stubClient({ [T.observations]: { error } });
    const result = await readRows(
      T.observations,
      (db) => db.from(T.observations).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({
      kind: "error",
      reading: T.observations,
      message: expect.stringContaining(error.message),
    });
  });

  it("reads one row, and null when there is none", async () => {
    const observation = observationRow();
    const stub = stubClient({
      [T.observations]: [{ data: observation }, { data: null }],
    });
    const client = stub.asSupabaseClient();

    await expect(
      readOne(T.observations, (db) => db.from(T.observations).select("*").maybeSingle(), client),
    ).resolves.toEqual({ kind: "ok", data: observation });
    await expect(
      readOne(T.observations, (db) => db.from(T.observations).select("*").maybeSingle(), client),
    ).resolves.toEqual({ kind: "ok", data: null });
  });

  it("reads a count, and refuses a null count instead of reporting zero", async () => {
    // BUG-0007's user-visible twin (fixed by admin-window/TASK-0026): a
    // response with `error: null` and `count: null` — what a select written
    // WITHOUT `{ head: true, count: "exact" }` returns — used to render a
    // confident 0 for a table holding rows. A counted 0 is still an ok 0.
    const stub = stubClient({
      [T.reviewItems]: [{ count: 7 }, { count: 0 }, { count: null }],
    });
    const client = stub.asSupabaseClient();

    await expect(
      readCount(
        T.reviewItems,
        (db) => db.from(T.reviewItems).select("*", { count: "exact", head: true }),
        client,
      ),
    ).resolves.toEqual({ kind: "ok", data: 7 });
    await expect(
      readCount(
        T.reviewItems,
        (db) => db.from(T.reviewItems).select("*", { count: "exact", head: true }),
        client,
      ),
    ).resolves.toEqual({ kind: "ok", data: 0 });

    const refused = await readCount(
      T.reviewItems,
      // The defective spelling: no count asked for, so none comes back.
      (db) => db.from(T.reviewItems).select("*"),
      client,
    );
    expect(refused.kind).toBe("error");
    if (refused.kind !== "error") return;
    // The object is carried by the result rather than spelled into the prose:
    // every error arm names its read (admin-window/BUG-0016).
    expect(refused.reading).toBe(T.reviewItems);
    expect(refused.message).toContain('count: "exact"');
    // Never a number the database did not give.
    expect(refused).not.toHaveProperty("data");
  });

  it("classifies an absent table on a count read too", async () => {
    const stub = stubClient({
      [T.resolutionRuns]: { error: undefinedTable(T.resolutionRuns) },
    });
    await expect(
      readCount(
        T.resolutionRuns,
        (db) => db.from(T.resolutionRuns).select("*", { count: "exact", head: true }),
        stub.asSupabaseClient(),
      ),
    ).resolves.toEqual({ kind: "not_provisioned", missing: T.resolutionRuns });
  });

  it("keeps a TABLE read that raised 42883 red, and reads the same table again", async () => {
    // admin-window/BUG-0080, through the helper a page actually uses rather
    // than through `classify` alone: the filter Postgres could not build
    // (`fts` on a timestamptz) raises 42883, and `groups` is provisioned and
    // full of rows. Anything but an error here is the card telling an operator
    // to install a table that is right there.
    const stub = stubClient({
      [T.groups]: [{ error: missingFunctionOnTableRead() }, { data: [{ group_id: "g1" }] }],
    });
    const client = stub.asSupabaseClient();
    const search = await readRows(
      T.groups,
      (db) => db.from(T.groups).select("group_id").filter("created_at", "fts", "x"),
      client,
    );

    expect(search.kind).toBe("error");
    expect(search).not.toHaveProperty("missing");
    if (search.kind !== "error") return;
    expect(search.reading).toBe(T.groups);
    // The database's own words, not a sentence of ours.
    expect(search.message).toContain(missingFunctionOnTableRead().message);

    // And the table really is readable — the refusal was about the QUERY.
    await expect(
      readRows(T.groups, (db) => db.from(T.groups).select("group_id"), client),
    ).resolves.toEqual({ kind: "ok", data: [{ group_id: "g1" }] });
  });

  it("keeps an absent-FUNCTION code on a COUNT of a table an error, never a zero", async () => {
    // The two ways a count can go wrong meet here: a 42883 from a table read
    // is an error (BUG-0080) — and, like every refusal, it carries no number
    // (LESSONS 2, ARCHITECTURE.md §4.3).
    const stub = stubClient({
      [T.groups]: { error: functionNotInSchemaCache("to_tsvector") },
    });
    const result = await readCount(
      T.groups,
      (db) => db.from(T.groups).select("*", { count: "exact", head: true }),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    expect(result).not.toHaveProperty("data");
    expect(result).not.toHaveProperty("missing");
  });

  /* ── the absent FUNCTION, through the read path (admin-window/TASK-0047) ── */

  it("returns not_provisioned when the FUNCTION is not in the schema cache", async () => {
    // The whole M2 path in miniature: a real call, through the seam that says
    // a FUNCTION was asked for, against a PostgREST that answers PGRST202 —
    // and what comes back is the absence card's input, not an exception.
    const stub = stubClient({
      [SETTLE_FUNCTION]: { error: functionNotInSchemaCache(SETTLE_FUNCTION) },
    });
    const result = await callFunction(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: { action: "keep_current" } }),
      stub.asSupabaseClient(),
    );

    expect(result).toEqual({
      kind: "not_provisioned",
      missing: SETTLE_FUNCTION,
    });
    // The call really went through the client seam, as a FUNCTION call
    // carrying its one argument — not as a table read.
    expect(stub.functionsCalled()).toEqual([SETTLE_FUNCTION]);
    expect(stub.tablesRead()).toEqual([]);
    expect(stub.calls[0].steps[0]).toEqual({
      method: "rpc",
      args: [{ p_decision: { action: "keep_current" } }],
    });
  });

  it("never turns the absent function into a number", async () => {
    // ARCHITECTURE.md §4.3 and LESSONS 2: an absent object is a refusal, never
    // a confident zero — and a null count is a refusal even when nothing is
    // absent at all. Both, over the same function, so this change cannot have
    // quietly made an unreadable object render as "0 settled".
    const absent = stubClient({
      [SETTLE_FUNCTION]: { error: undefinedFunction(SETTLE_FUNCTION) },
    });
    const refusedAbsent = await callFunction(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
      absent.asSupabaseClient(),
    );
    expect(refusedAbsent).toEqual({
      kind: "not_provisioned",
      missing: SETTLE_FUNCTION,
    });
    expect(refusedAbsent).not.toHaveProperty("data");

    const silent = stubClient({ [SETTLE_FUNCTION]: { count: null } });
    const refusedSilent = await readCount(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
      silent.asSupabaseClient(),
    );
    expect(refusedSilent.kind).toBe("error");
    expect(refusedSilent).not.toHaveProperty("data");
  });

  it("keeps a CALL to an absent function an absence, and a refused call red", async () => {
    // The two verdicts a caller must be able to tell apart, through the same
    // helper: the function is not installed (absence), and the function is
    // there but the call was refused (error, in the database's own words).
    const absent = stubClient({
      [SETTLE_FUNCTION]: { error: functionNotInSchemaCache(SETTLE_FUNCTION) },
    });
    await expect(
      callFunction(
        SETTLE_FUNCTION,
        (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
        absent.asSupabaseClient(),
      ),
    ).resolves.toEqual({ kind: "not_provisioned", missing: SETTLE_FUNCTION });

    const refused = stubClient({
      [SETTLE_FUNCTION]: { error: permissionDenied(SETTLE_FUNCTION) },
    });
    const result = await callFunction(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
      refused.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(SETTLE_FUNCTION);
    expect(result.message).toContain("permission denied");
  });
});

/**
 * The complete read (ARCHITECTURE.md §4.3, campaign admin-window/TASK-0026).
 *
 * The property under test in every case below is one sentence: **an `ok` array
 * is the whole matching set.** So each branch is checked twice — that the
 * refusal happens, and that no array escapes with it.
 */
describe("readComplete", () => {
  /** The query a complete read is contractually required to build. */
  const completeQuery =
    (table: string) =>
    (db: SupabaseClient, cap: number) =>
      db
        .from(table)
        .select("*", { count: "exact" })
        .order("review_item_id", { ascending: true })
        .range(0, cap - 1);

  it("returns ok with every row when the exact count matches what came back", async () => {
    const items = reviewItemShapes();
    const stub = stubClient({
      [T.reviewItems]: { data: items, count: items.length },
    });
    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: items });
  });

  it("returns an empty ok when the database counted nothing", async () => {
    // A counted zero is information; only an ABSENT count is a refusal.
    const stub = stubClient({ [T.pendingClaims]: { data: null, count: 0 } });
    const result = await readComplete(
      T.pendingClaims,
      completeQuery(T.pendingClaims),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: [] });
  });

  it("hands the cap to the query rather than letting the caller spell it", async () => {
    const stub = stubClient({ [T.reviewItems]: { data: [], count: 0 } });
    await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    const range = stub.calls[0].steps.find((step) => step.method === "range");
    expect(range?.args).toEqual([0, ROW_CAP - 1]);
  });

  it("classifies a database error exactly as a window read does", async () => {
    const absent = stubClient({
      [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
    });
    expect(
      await readComplete(T.verdicts, completeQuery(T.verdicts), absent.asSupabaseClient()),
    ).toEqual({ kind: "not_provisioned", missing: T.verdicts });

    const refused = stubClient({
      [T.observations]: { error: permissionDenied(T.observations) },
    });
    expect(
      await readComplete(
        T.observations,
        completeQuery(T.observations),
        refused.asSupabaseClient(),
      ),
    ).toEqual({
      kind: "error",
      reading: T.observations,
      message: expect.stringContaining(permissionDenied(T.observations).message),
    });
  });

  it("refuses a null count instead of fabricating completeness, and returns no array", async () => {
    // The defective spelling: a select without `{ count: "exact" }` answers
    // `error: null, count: null`. Whether those rows are all of them is
    // unknowable, so they must not surface as an ok set.
    const items = reviewItemShapes();
    const stub = stubClient({ [T.reviewItems]: { data: items, count: null } });
    const result = await readComplete(
      T.reviewItems,
      (db) => db.from(T.reviewItems).select("*"),
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.reviewItems);
    expect(result.message).toContain('count: "exact"');
    expect(result).not.toHaveProperty("data");
  });

  it("refuses a truncated set, naming the object, the count and the cap", async () => {
    // What the server's own db-max-rows does to a big table: ROW_CAP rows
    // back, and a count that says there are far more.
    const rows = Array.from({ length: ROW_CAP }, (_, index) => ({
      review_item_id: `row-${index}`,
    }));
    const held = 1732;
    const stub = stubClient({ [T.reviewItems]: { data: rows, count: held } });

    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.reviewItems);
    expect(result.message).toContain(String(held));
    expect(result.message).toContain(String(ROW_CAP));
    // Never a partial array: the whole point of the branch.
    expect(result).not.toHaveProperty("data");
  });

  it("refuses truncation regardless of where the cap bit, cap or server", async () => {
    // One row short of the count is still a truncated set. Nothing here
    // assumes ROW_CAP was the thing that cut it.
    const items = reviewItemShapes();
    const stub = stubClient({
      [T.reviewItems]: { data: items, count: items.length + 1 },
    });
    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
  });
});

/**
 * The cap boundary and the window/complete split (QA attack on
 * admin-window/TASK-0026). The branch above is decided by `count > rows`, so
 * the one row on either side of the cap is where an off-by-one would live, and
 * a refusal that carried rows would be the whole ticket lost.
 */
describe("readComplete at the cap boundary", () => {
  const completeQuery =
    (table: string) =>
    (db: SupabaseClient, cap: number) =>
      db
        .from(table)
        .select("*", { count: "exact" })
        .order("review_item_id", { ascending: true })
        .range(0, cap - 1);

  const capRows = (n: number) =>
    Array.from({ length: n }, (_, index) => ({ review_item_id: `row-${index}` }));

  it("returns every row when the matching set is exactly the cap, and refuses at one more", async () => {
    // A table holding exactly ROW_CAP matching rows IS a whole matching set:
    // 1000 counted, 1000 returned. Refusing here would make the cap a limit on
    // what the app can ever show; returning ok at 1001 would make an `ok`
    // array a partial one.
    const full = stubClient({
      [T.reviewItems]: { data: capRows(ROW_CAP), count: ROW_CAP },
    });
    const complete = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      full.asSupabaseClient(),
    );
    expect(complete.kind).toBe("ok");
    if (complete.kind !== "ok") return;
    expect(complete.data).toHaveLength(ROW_CAP);

    const overflowing = stubClient({
      [T.reviewItems]: { data: capRows(ROW_CAP), count: ROW_CAP + 1 },
    });
    const refused = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      overflowing.asSupabaseClient(),
    );
    expect(refused.kind).toBe("error");
    if (refused.kind !== "error") return;
    expect(refused.message).toContain(String(ROW_CAP + 1));
    expect(refused).not.toHaveProperty("data");
  });

  it("refuses a counted set that came back with no rows at all", async () => {
    // `data: null` with `error: null` and a count of 12: whatever produced it,
    // an empty array here would render as "nothing matches" for a set the
    // database says holds 12 rows. Complete-or-refuse means refuse.
    const stub = stubClient({ [T.reviewItems]: { data: null, count: 12 } });
    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("12");
    expect(result).not.toHaveProperty("data");
  });

  it("leaves window reads alone: readRows over a counted response still returns its window", async () => {
    // The six gauge modules read through `readRows` and name their window
    // (ARCHITECTURE.md §4.3, §8). A count on the response is not their
    // business: complete-read refusal must never bleed into a window read.
    const stub = stubClient({
      [T.reviewItems]: { data: capRows(3), count: 1732 },
    });
    const result = await readRows(
      T.reviewItems,
      (db) => db.from(T.reviewItems).select("*").order("opened_at").limit(3),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data).toHaveLength(3);
  });
});

describe("no exported read throws", () => {
  const failures: Array<[string, unknown]> = [
    ["table not in schema cache", tableNotInSchemaCache(T.reviewItems)],
    ["undefined_table", undefinedTable(T.reviewItems)],
    ["column not in schema cache", columnNotInSchemaCache(T.reviewItems, "severity")],
    ["undefined_column", undefinedColumn("severity")],
    ["permission denied", permissionDenied(T.reviewItems)],
    ["a bare object", { status: 500 }],
    ["a string", "socket hang up"],
  ];

  it.each(failures)("resolves rather than rejecting on %s", async (_label, error) => {
    const stub = stubClient({ [T.reviewItems]: { error } });
    const client = stub.asSupabaseClient();

    const results: DbResult<unknown>[] = [
      await readRows(T.reviewItems, (db) => db.from(T.reviewItems).select("*"), client),
      await readOne(T.reviewItems, (db) => db.from(T.reviewItems).select("*").maybeSingle(), client),
      await readCount(
        T.reviewItems,
        (db) => db.from(T.reviewItems).select("*", { count: "exact", head: true }),
        client,
      ),
      await readComplete(
        T.reviewItems,
        (db, cap) =>
          db
            .from(T.reviewItems)
            .select("*", { count: "exact" })
            .order("review_item_id")
            .range(0, cap - 1),
        client,
      ),
    ];

    for (const result of results) {
      expect(["not_provisioned", "error"]).toContain(result.kind);
    }
  });

  it("turns a query that throws on its way out into an error result", async () => {
    const boom = new Error("TypeError: db.from is not a function");
    const thrower = () => {
      throw boom;
    };
    const client = stubClient({}).asSupabaseClient();

    const thrown = { kind: "error", reading: T.sources, message: boom.message };
    await expect(readRows(T.sources, thrower, client)).resolves.toEqual(thrown);
    await expect(readOne(T.sources, thrower, client)).resolves.toEqual(thrown);
    await expect(readCount(T.sources, thrower, client)).resolves.toEqual(thrown);
    await expect(readComplete(T.sources, thrower, client)).resolves.toEqual(thrown);
  });

  it("turns an unset credential name into an error result, not a crash", async () => {
    // No client passed, so the read resolves one itself — inside the same try
    // that classifies. This is the deploy-time case the ground rules name:
    // every push to main must leave the app renderable.
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    try {
      const result = await readRows(T.sources, (db) => db.from(T.sources).select("*"));
      expect(result.kind).toBe("error");
      expect(result).toMatchObject({ message: expect.stringContaining("SUPABASE_URL") });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the fixture builders the suite reads through", () => {
  it("carries a review item in each of the three shapes", () => {
    const [dataConflict, entityLinkFact, sourcePattern] = reviewItemShapes();

    // A per-fact item names its fact and carries no source.
    expect(dataConflict.queue).toBe("data_conflict");
    expect(dataConflict.source_id).toBeNull();
    expect(dataConflict.domain).not.toBeNull();
    expect(entityLinkFact.queue).toBe("entity_link");
    expect(entityLinkFact.source_id).toBeNull();

    // The source-pattern item is the other subject shape: source set, the
    // other three null — the null shape the subject index compares.
    expect(sourcePattern.source_id).not.toBeNull();
    expect(sourcePattern.domain).toBeNull();
    expect(sourcePattern.entity_id).toBeNull();
    expect(sourcePattern.field).toBeNull();
  });

  it("carries a pending claim in every bucket, in_window included", () => {
    const claims = pendingClaimsInEveryBucket();
    expect(claims.map((claim) => claim.bucket)).toEqual([...PENDING_CLAIM_BUCKETS]);
    // Only awaiting_row names an unmet requirement; a bare awaiting_row is a
    // defect and every other bucket carries null.
    for (const claim of claims) {
      expect(claim.unmet_requirement === null).toBe(claim.bucket !== "awaiting_row");
    }
  });

  it("carries a cycle, a run, a source, an observation and a provenance row", () => {
    expect(resolutionRunRow().outcome).toBe("succeeded");
    // runs.source is text with no foreign key: it matches sources.source by name.
    expect(runRow().source).toBe(sourceRow().source);
    expect(observationRow().source_id).toBe(sourceRow().source_id);
    // `field_provenance` spells the canonical table entity_type; `observations`
    // and `review_items` spell the same thing domain, and the values agree —
    // `observations.entity_type` was dropped by scraper migration
    // `20260819000002` (admin-window/BUG-0024).
    expect(fieldProvenanceRow().entity_type).toBe(observationRow().domain);
    expect(reviewItemShapes()[0].domain).toBe(observationRow().domain);
  });
});

/**
 * Compile-time only: proves the read seam accepts a REAL supabase-js query
 * builder, so a page ticket coding against this contract type-checks.
 * `tsc --noEmit` is the assertion; the runtime check just keeps it referenced.
 */
async function acceptsARealQueryBuilder(
  db: SupabaseClient,
): Promise<DbResult<{ source_id: string }[]>> {
  return readRows<{ source_id: string }>(
    T.sources,
    (client) => client.from(T.sources).select("source_id"),
    db,
  );
}

it("types the read seam against the real client", () => {
  expect(typeof acceptsARealQueryBuilder).toBe("function");
});
