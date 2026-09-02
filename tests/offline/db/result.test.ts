import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ROW_CAP,
  classify,
  readComplete,
  readCount,
  readOne,
  readRows,
  type DbResult,
} from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import {
  columnNotInSchemaCache,
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  undefinedColumn,
  undefinedColumnOfRelation,
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
    const error = {
      code: "42883",
      message: "function public.settle(uuid) does not exist",
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
    // The evidence side spells the canonical table entity_type; review_items
    // spells the same thing domain.
    expect(fieldProvenanceRow().entity_type).toBe(observationRow().entity_type);
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
