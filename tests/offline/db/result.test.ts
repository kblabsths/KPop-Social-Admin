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
      message: error.message,
    });
  });

  it("carries the message of a thrown Error, a thrown string, and a bare object", () => {
    expect(classify(new Error("fetch failed"), T.runs)).toEqual({
      kind: "error",
      message: "fetch failed",
    });
    expect(classify("socket hang up", T.runs)).toEqual({
      kind: "error",
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
    expect(result).toEqual({ kind: "error", message: error.message });
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
    expect(refused.message).toContain(T.reviewItems);
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
      message: permissionDenied(T.observations).message,
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
    expect(result.message).toContain(T.reviewItems);
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
    expect(result.message).toContain(T.reviewItems);
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

    await expect(readRows(T.sources, thrower, client)).resolves.toEqual({
      kind: "error",
      message: boom.message,
    });
    await expect(readOne(T.sources, thrower, client)).resolves.toEqual({
      kind: "error",
      message: boom.message,
    });
    await expect(readCount(T.sources, thrower, client)).resolves.toEqual({
      kind: "error",
      message: boom.message,
    });
    await expect(readComplete(T.sources, thrower, client)).resolves.toEqual({
      kind: "error",
      message: boom.message,
    });
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
