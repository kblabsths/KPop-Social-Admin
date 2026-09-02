import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  classify,
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

  it("reads a column-absent code as not_provisioned naming the column", () => {
    for (const error of [
      columnNotInSchemaCache(T.reviewItems, "severity"),
      undefinedColumn("severity"),
    ]) {
      const result = classify(error, T.reviewItems);
      expect(result.kind).toBe("not_provisioned");
      // The column is named, and the table it belongs to is still carried.
      expect(result).toMatchObject({ missing: `${T.reviewItems}.severity` });
    }
  });

  it("falls back to the queried name when a column-absent message names nothing", () => {
    expect(
      classify({ code: "PGRST204", message: "schema cache reload failed" }, T.sources),
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

  it("reads a count, defaulting a null count to zero", async () => {
    const stub = stubClient({
      [T.reviewItems]: [{ count: 7 }, { count: null }],
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
