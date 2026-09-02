import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PENDING_CLAIM_BUCKETS,
  RENDERABLE_BUCKETS,
  UNRENDERABLE_BUCKET,
  claimOrder,
  facetOptions,
  isRenderableBucket,
  listClaims,
  readPendingClaims,
  selectClaims,
  type ClaimRow,
} from "@/lib/db/claims";
import { ROW_CAP } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import { CLAIMS, OBSERVATIONS, OBSERVED_AT, SOURCE } from "./population";
import { pendingClaimRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
  type StubClient,
} from "../../fixtures/stub-client";

/**
 * `src/lib/db/claims.ts` — the classification view's one reader (campaign
 * admin-window/TASK-0012).
 *
 * What is asserted here rather than through the page: the read is COMPLETE and
 * says so (ARCHITECTURE.md §4.3), the parked bucket is excluded twice — in the
 * query AND in code, so the returned set is decided by one rule whether or not
 * the server narrowed (§6 trap 4) — the age join is the two-step §4.2
 * describes, and every failure arrives as a `DbResult` naming the object it
 * was reading.
 */

/** The parked bucket, spelled here so this file states what it is testing. */
const PARKED = "in_" + "window";

function scripted(script: Script): StubClient {
  return stubClient(script);
}

/** A database holding the whole fixture population, `in_window` included. */
function wholeView(): Script {
  return {
    [T.pendingClaims]: { data: [...CLAIMS], count: CLAIMS.length },
    [T.observations]: { data: [...OBSERVATIONS] },
  };
}

/** Every step one query recorded, by method name. */
function stepsOf(stub: StubClient, table: string, nth = 0) {
  const call = stub.calls.filter((c) => c.table === table)[nth];
  expect(call, `${table} was not queried`).toBeDefined();
  return call.steps;
}

function argsOf(stub: StubClient, table: string, method: string, nth = 0) {
  return stepsOf(stub, table, nth)
    .filter((step) => step.method === method)
    .map((step) => step.args);
}

describe("the bucket vocabulary", () => {
  it("is the view's six, and the UI may render five of them", () => {
    expect(PENDING_CLAIM_BUCKETS).toHaveLength(6);
    expect([...PENDING_CLAIM_BUCKETS]).toContain(PARKED);
    expect(UNRENDERABLE_BUCKET).toBe(PARKED);
    expect(RENDERABLE_BUCKETS).toHaveLength(5);
    expect(RENDERABLE_BUCKETS).not.toContain(PARKED);
    expect(isRenderableBucket(PARKED)).toBe(false);
    expect(isRenderableBucket("awaiting_row")).toBe(true);
    expect(isRenderableBucket("invented")).toBe(false);
  });
});

describe("the classification read", () => {
  it("is a complete read: exact count, a total order, and the cap", async () => {
    const stub = scripted(wholeView());
    const result = await listClaims(stub.asSupabaseClient());
    expect(result.kind).toBe("ok");

    const steps = stepsOf(stub, T.pendingClaims);
    expect(steps[0].method).toBe("select");
    expect(steps[0].args[1]).toEqual({ count: "exact" });
    // A total server order ending in the view's key, so the row set — and any
    // refusal — is deterministic.
    expect(argsOf(stub, T.pendingClaims, "order")).toEqual([
      ["bucket", { ascending: true }],
      ["observation_id", { ascending: true }],
    ]);
    expect(argsOf(stub, T.pendingClaims, "range")).toEqual([[0, ROW_CAP - 1]]);
  });

  it("excludes the parked bucket in the query", async () => {
    const stub = scripted(wholeView());
    await listClaims(stub.asSupabaseClient());
    expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
  });

  it("excludes it again in code, so a server that ignored the filter cannot leak it", async () => {
    const stub = scripted(wholeView());
    const result = await listClaims(stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    // The stub answers with the WHOLE population, parked row included — the
    // shape of a server that did not narrow.
    expect(CLAIMS.some((claim) => claim.bucket === PARKED)).toBe(true);
    expect(result.data.map((claim) => claim.bucket)).not.toContain(PARKED);
    expect(result.data).toHaveLength(CLAIMS.length - 1);
  });

  it("refuses rather than truncating when the view outgrows the cap", async () => {
    const result = await listClaims(
      scripted({
        [T.pendingClaims]: { data: [...CLAIMS], count: CLAIMS.length + 4000 },
        [T.observations]: { data: [] },
      }).asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.pendingClaims);
    expect(result.message).toContain(String(CLAIMS.length + 4000));
    expect(result.message).toContain(String(ROW_CAP));
  });

  it("joins the age from observations, by observation_id, in TypeScript", async () => {
    const stub = scripted(wholeView());
    const result = await listClaims(stub.asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    // The second leg filters on the ids the first leg produced, and asks for no
    // more rows than the ids it filtered on.
    const ids = argsOf(stub, T.observations, "in")[0];
    expect(ids[0]).toBe("observation_id");
    const asked = (ids[1] as string[]).length;
    expect(argsOf(stub, T.observations, "limit")).toEqual([[asked]]);

    for (const claim of result.data) {
      expect(claim.observed_at, claim.observation_id).toBe(
        OBSERVED_AT.get(claim.observation_id) ?? null,
      );
    }
  });

  it("keeps a claim whose observation did not come back, with no age at all", async () => {
    // A claim of unknown age is not a claim that arrived this instant — and
    // dropping it would make the rendered count disagree with the view.
    const result = await listClaims(scripted(wholeView()).asSupabaseClient());
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

    const unobserved = CLAIMS.filter((claim) => !OBSERVED_AT.has(claim.observation_id));
    expect(unobserved.length).toBeGreaterThan(0);
    for (const claim of unobserved) {
      if (claim.bucket === PARKED) continue;
      const row = result.data.find((r) => r.observation_id === claim.observation_id);
      expect(row?.observed_at, claim.observation_id).toBeNull();
    }
  });

  it("makes no second query when the first leg returned nothing", async () => {
    const stub = scripted({
      [T.pendingClaims]: { data: [], count: 0 },
      [T.observations]: { data: [] },
    });
    const result = await listClaims(stub.asSupabaseClient());
    expect(result).toEqual({ kind: "ok", data: [] });
    expect(stub.tablesRead()).toEqual([T.pendingClaims]);
  });

  it("chunks the second leg, so no request carries an unbounded id list", async () => {
    const many = Array.from({ length: 250 }, (_, index) =>
      pendingClaimRow("agreeing", {
        observation_id: `claim-${index}`,
        entity_id: `entity-${index}`,
      }),
    );
    const stub = scripted({
      [T.pendingClaims]: { data: many, count: many.length },
      [T.observations]: { data: [] },
    });
    await listClaims(stub.asSupabaseClient());

    const legs = stub.calls.filter((call) => call.table === T.observations);
    expect(legs.length).toBeGreaterThan(1);
    for (const leg of legs) {
      const ids = leg.steps.find((step) => step.method === "in")?.args[1] as string[];
      expect(ids.length).toBeLessThanOrEqual(100);
    }
  });

  it("names the object that is absent, per leg, and never throws", async () => {
    const claimsAbsent = await listClaims(
      scripted({
        [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
        [T.observations]: { data: [] },
      }).asSupabaseClient(),
    );
    expect(claimsAbsent).toEqual({
      kind: "not_provisioned",
      missing: T.pendingClaims,
    });

    const observationsAbsent = await listClaims(
      scripted({
        [T.pendingClaims]: { data: [...CLAIMS], count: CLAIMS.length },
        [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      }).asSupabaseClient(),
    );
    expect(observationsAbsent).toEqual({
      kind: "not_provisioned",
      missing: T.observations,
    });
  });

  it("surfaces any other failure as the database's own words", async () => {
    const result = await listClaims(
      scripted({
        [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
        [T.observations]: { data: [] },
      }).asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.pendingClaims);
    expect(result.message).toContain("permission denied");
  });
});

describe("the id-set read the gauges use", () => {
  it("excludes the parked bucket too, and asks for no more rows than ids", async () => {
    const stub = scripted(wholeView());
    const result = await readPendingClaims(
      CLAIMS.map((claim) => claim.observation_id),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("ok");
    expect(argsOf(stub, T.pendingClaims, "neq")).toEqual([["bucket", PARKED]]);
    const ids = argsOf(stub, T.pendingClaims, "in")[0][1] as string[];
    expect(argsOf(stub, T.pendingClaims, "limit")).toEqual([[ids.length]]);
  });
});

describe("the one predicate", () => {
  const rows: ClaimRow[] = CLAIMS.map((claim) => ({
    ...claim,
    observed_at: OBSERVED_AT.get(claim.observation_id) ?? null,
  }));

  it("drops the parked bucket whatever was asked for", () => {
    expect(selectClaims(rows).map((claim) => claim.bucket)).not.toContain(PARKED);
    expect(selectClaims(rows, { bucket: PARKED })).toEqual([]);
  });

  it("returns exactly the matching claims, per facet", () => {
    const bySource = selectClaims(rows, { source_id: SOURCE.first });
    expect(new Set(bySource.map((claim) => claim.observation_id))).toEqual(
      new Set(
        CLAIMS.filter(
          (claim) => claim.source_id === SOURCE.first && claim.bucket !== PARKED,
        ).map((claim) => claim.observation_id),
      ),
    );

    const byBucketAndDomain = selectClaims(rows, {
      bucket: "awaiting_row",
      domain: "events",
    });
    expect(byBucketAndDomain.map((claim) => claim.observation_id)).toEqual(
      CLAIMS.filter(
        (claim) => claim.bucket === "awaiting_row" && claim.domain === "events",
      ).map((claim) => claim.observation_id),
    );
  });

  it("orders oldest first, unknown ages last, ties broken by the claim's id", () => {
    const ordered = claimOrder(selectClaims(rows));
    const instants = ordered.map((claim) => claim.observed_at);

    const known = instants.filter((at): at is string => at !== null);
    expect(known.map((at) => Date.parse(at))).toEqual(
      [...known].map((at) => Date.parse(at)).sort((a, b) => a - b),
    );
    // Everything without an instant sits after everything with one.
    expect(instants.slice(known.length).every((at) => at === null)).toBe(true);

    // Two claims on the same instant, spelled `Z` and `+00:00`: the id decides,
    // and it decides the same way every render.
    const sameInstant = ordered.filter(
      (claim) =>
        claim.observed_at !== null &&
        Date.parse(claim.observed_at) === Date.parse("2026-08-21T00:00:00Z"),
    );
    expect(sameInstant.length).toBe(2);
    expect(sameInstant.map((claim) => claim.observation_id)).toEqual(
      [...sameInstant.map((claim) => claim.observation_id)].sort(),
    );
  });

  it("offers every bucket the app may render, and every value the rows carry", () => {
    const options = facetOptions(rows);
    expect(options.bucket).toEqual([...RENDERABLE_BUCKETS]);
    expect(options.bucket).not.toContain(PARKED);
    expect(options.source_id).toEqual(
      [...new Set(CLAIMS.map((claim) => claim.source_id))].sort(),
    );
    expect(options.domain).toEqual(
      [...new Set(CLAIMS.map((claim) => claim.domain))].sort(),
    );
  });

  it("still offers a bucket string this app has never heard of", () => {
    // A seventh bucket from a later migration must appear under its own name:
    // a count that silently dropped rows would stop matching the view, which
    // is the one thing this page may not do. The parked one is still gone.
    const options = facetOptions([
      ...rows,
      { ...rows[0], bucket: "invented" as ClaimRow["bucket"] },
    ]);
    expect(options.bucket).toEqual([...RENDERABLE_BUCKETS, "invented"]);
    expect(options.bucket).not.toContain(PARKED);
  });
});

/**
 * The structural half of ARCHITECTURE.md §6 trap 4: "filter it out at the data
 * layer, in `lib/db/claims.ts`, ONCE". A second module querying this view is a
 * second place the exclusion could be forgotten, and no test of behaviour can
 * see it coming.
 */
describe("the view has exactly one reader", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...sourceFiles(full));
      else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
    }
    return found;
  }

  function codeText(file: string): string {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return (
          trimmed.length > 0 &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("*") &&
          !trimmed.startsWith("/*")
        );
      })
      .join("\n");
  }

  it("queries pending_claims from src/lib/db/claims.ts alone", () => {
    const readers = sourceFiles(path.join(repoRoot, "src"))
      .filter((file) => /\.from\(T\.pendingClaims\)/.test(codeText(file)))
      .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"));
    expect(readers).toEqual(["src/lib/db/claims.ts"]);
  });
});
