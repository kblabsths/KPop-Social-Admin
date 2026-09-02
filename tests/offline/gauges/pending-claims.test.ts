import { describe, expect, it } from "vitest";
import {
  PENDING_CLAIM_BUCKETS,
  RENDERABLE_BUCKETS,
  aggregateAwaitingRowTrend,
  aggregatePendingClaims,
  fetchPendingClaims,
  isRenderableBucket,
  readAwaitingRowTrend,
  readPendingClaims,
  stuckPatternThreshold,
  type PendingClaimRow,
  type PendingObservationRow,
} from "@/lib/gauges/pending-claims";
import { T } from "@/lib/db/tables";
import { ID, observationRow, pendingClaimRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
} from "../../fixtures/stub-client";

/**
 * Gauge 3 — pending claims and the per-source `awaiting_row` trend (campaign
 * admin-window/TASK-0007).
 *
 * Three things this file exists to hold down:
 *  - **`in_window` never reaches the UI** (ARCHITECTURE.md §6 trap 4, spec §4,
 *    M1 EC5) — not as a row, not as a bucket entry, not as a zero, whether or
 *    not the server narrowed;
 *  - age comes from `observations.observed_at` (trap 3), and a claim whose
 *    observation is absent has NO age rather than an age of zero;
 *  - the per-source threshold overlay is **absent**: the dial lives only in
 *    scraper registry YAML and copying it here is the forbidden move
 *    (spec §10, admin-window/TASK-0024).
 */

const NOW = "2026-09-01T12:00:00.000Z";
const WINDOW = { since: "2026-06-03T12:00:00.000Z", until: NOW, limit: 5000, truncated: false };

const SOURCE_A = ID.sourceTicketmaster;
const SOURCE_B = ID.sourceBandsintown;

/** A claim in each bucket (including the unrenderable one) plus three stuck rows. */
function claims(): PendingClaimRow[] {
  return [
    ...PENDING_CLAIM_BUCKETS.map((bucket) => pendingClaimRow(bucket)),
    pendingClaimRow("awaiting_row", {
      observation_id: "01920000-0000-7000-8000-000000000901",
      source_id: SOURCE_B,
      domain: "events",
    }),
    pendingClaimRow("awaiting_row", {
      observation_id: "01920000-0000-7000-8000-000000000902",
      source_id: SOURCE_B,
      domain: "groups",
    }),
    // A claim whose observation is NOT in the second read: age unknown.
    pendingClaimRow("standing_disagreement", {
      observation_id: "01920000-0000-7000-8000-000000000903",
      source_id: SOURCE_A,
    }),
  ];
}

/** `observed_at` for each claim above, except the deliberately-orphaned one. */
function observations(): PendingObservationRow[] {
  const forBucket = PENDING_CLAIM_BUCKETS.map((bucket, index) =>
    observationRow({
      observation_id: pendingClaimRow(bucket).observation_id,
      source_id: SOURCE_A,
      domain: "events",
      // 1h, 2h, 3h … before `until`, so each bucket's age is distinguishable.
      observed_at: new Date(Date.parse(NOW) - (index + 1) * 3_600_000).toISOString(),
    }),
  );
  return [
    ...forBucket,
    observationRow({
      observation_id: "01920000-0000-7000-8000-000000000901",
      source_id: SOURCE_B,
      domain: "events",
      observed_at: "2026-08-30T06:00:00Z",
    }),
    observationRow({
      observation_id: "01920000-0000-7000-8000-000000000902",
      source_id: SOURCE_B,
      domain: "groups",
      observed_at: "2026-08-31T06:00:00Z",
    }),
  ];
}

function rows(overrides: Partial<Parameters<typeof aggregatePendingClaims>[0]> = {}) {
  return {
    claims: claims(),
    observations: observations(),
    window: WINDOW,
    filter: {},
    ...overrides,
  };
}

function withRows(claimRows: PendingClaimRow[], observationRows: PendingObservationRow[]) {
  return stubClient({
    [T.observations]: { data: observationRows },
    [T.pendingClaims]: { data: claimRows },
  });
}

describe("the bucket vocabulary", () => {
  it("spells the view's six buckets", () => {
    expect(PENDING_CLAIM_BUCKETS).toHaveLength(6);
  });

  it("renders every bucket except the one that is empty by rule", () => {
    expect(RENDERABLE_BUCKETS).toHaveLength(5);
    expect(RENDERABLE_BUCKETS).not.toContain("in_window");
    expect(isRenderableBucket("in_window")).toBe(false);
    expect(isRenderableBucket("awaiting_row")).toBe(true);
    // A bucket the view does not have is not renderable either.
    expect(isRenderableBucket("invented")).toBe(false);
  });
});

describe("fetchPendingClaims", () => {
  it("scans observations with an explicit window and cap, then joins the view by id", async () => {
    const stub = withRows(claims(), observations());
    const result = await fetchPendingClaims(
      { now: NOW, days: 90, limit: 5000 },
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.observations, T.pendingClaims]);

    const scan = stub.calls[0].steps;
    expect(scan.find((s) => s.method === "eq")?.args).toEqual(["status", "pending"]);
    expect(scan.find((s) => s.method === "gte")?.args).toEqual([
      "observed_at",
      "2026-06-03T12:00:00.000Z",
    ]);
    expect(scan.find((s) => s.method === "limit")?.args).toEqual([5000]);
    // Oldest first: truncation drops the newest claims and keeps the stuck ones.
    expect(scan.find((s) => s.method === "order")?.args).toEqual([
      "observed_at",
      { ascending: true },
    ]);

    const join = stub.calls[1].steps;
    expect(join.find((s) => s.method === "in")?.args[0]).toBe("observation_id");
    expect(join.find((s) => s.method === "limit")?.args[0]).toBeGreaterThan(0);
  });

  it("excludes the unrenderable bucket in the query itself", async () => {
    const stub = withRows(claims(), observations());
    await fetchPendingClaims({ now: NOW }, stub.asSupabaseClient());
    expect(stub.calls[1].steps.find((s) => s.method === "neq")?.args).toEqual([
      "bucket",
      "in_window",
    ]);
  });

  it("narrows by source and domain on the scan, and reports the filter it used", async () => {
    const stub = withRows(claims(), observations());
    const result = await fetchPendingClaims(
      { now: NOW, filter: { source_id: SOURCE_B, domain: "events" } },
      stub.asSupabaseClient(),
    );
    const eqs = stub.calls[0].steps.filter((s) => s.method === "eq").map((s) => s.args);
    expect(eqs).toContainEqual(["source_id", SOURCE_B]);
    expect(eqs).toContainEqual(["domain", "events"]);
    expect(result.kind === "ok" && result.data.filter).toEqual({
      source_id: SOURCE_B,
      domain: "events",
    });
  });

  it("runs no view query when the window held no live claims", async () => {
    const stub = withRows([], []);
    await fetchPendingClaims({ now: NOW }, stub.asSupabaseClient());
    expect(stub.tablesRead()).toEqual([T.observations]);
  });

  it("reports whichever object is absent, by name", async () => {
    const noObservations = stubClient({
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
    });
    await expect(fetchPendingClaims({}, noObservations.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.observations,
    });

    const noView = stubClient({
      [T.observations]: { data: observations() },
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
    });
    await expect(fetchPendingClaims({}, noView.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.pendingClaims,
    });
  });

  it("carries an arbitrary failure through as the database's own words", async () => {
    const stub = stubClient({
      [T.observations]: { error: permissionDenied(T.observations) },
    });
    await expect(fetchPendingClaims({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "error",
      message: `permission denied for table ${T.observations}`,
    });
  });
});

describe("aggregatePendingClaims", () => {
  const summary = aggregatePendingClaims(rows());

  it("reports every renderable bucket, always, so an empty bucket is a zero", () => {
    expect(summary.buckets.map((b) => b.bucket)).toEqual([...RENDERABLE_BUCKETS]);
    for (const bucket of summary.buckets) {
      expect(typeof bucket.claims).toBe("number");
    }
  });

  it("excludes in_window even when the server handed one back", () => {
    // The stub answers whatever the chain built, so the `.neq` above did NOT
    // narrow here: this is the code-side exclusion doing the work.
    expect(summary.claims).toBe(claims().length - 1);
    expect(summary.buckets.some((b) => b.bucket === "in_window")).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("in_window");
  });

  it("counts claims and distinct sources per bucket", () => {
    const awaitingRow = summary.buckets.find((b) => b.bucket === "awaiting_row");
    expect(awaitingRow?.claims).toBe(3);
    expect(awaitingRow?.sources).toBe(2);

    const escalated = summary.buckets.find((b) => b.bucket === "escalated");
    expect(escalated?.claims).toBe(1);
    expect(escalated?.sources).toBe(1);
  });

  it("ages a claim from its observation's observed_at, not from the view", () => {
    const agreeing = summary.buckets.find((b) => b.bucket === "agreeing");
    // `agreeing` is index 5 of the bucket list, so its observation is 6h old.
    expect(agreeing?.age.min).toBe(6 * 3600);
    expect(agreeing?.age.max).toBe(6 * 3600);
  });

  it("gives a claim whose observation is missing no age rather than an age of zero", () => {
    const standing = summary.buckets.find((b) => b.bucket === "standing_disagreement");
    expect(standing?.claims).toBe(2);
    expect(standing?.age.count).toBe(1);
    expect(standing?.age.unmeasurable).toBe(1);
    expect(standing?.age.min).toBe(2 * 3600);
  });

  it("lists the sources and domains present, for the page's filter options", () => {
    expect(summary.sources).toEqual([SOURCE_A, SOURCE_B].sort());
    expect(summary.domains).toEqual(["events", "groups"]);
  });

  it("applies the filter in code, whether or not the server narrowed", () => {
    const filtered = aggregatePendingClaims(rows({ filter: { source_id: SOURCE_B } }));
    expect(filtered.claims).toBe(2);
    expect(filtered.sources).toEqual([SOURCE_B]);
    const byDomain = aggregatePendingClaims(rows({ filter: { domain: "groups" } }));
    expect(byDomain.claims).toBe(1);
  });

  it("reports an empty read as five zero buckets with NULL age figures", () => {
    const empty = aggregatePendingClaims(rows({ claims: [], observations: [] }));
    expect(empty.claims).toBe(0);
    expect(empty.buckets).toHaveLength(5);
    for (const bucket of empty.buckets) {
      expect(bucket.claims).toBe(0);
      expect(bucket.sources).toBe(0);
      expect(bucket.age.p50).toBeNull();
      expect(bucket.age.max).toBeNull();
    }
    expect(empty.age.p50).toBeNull();
    expect(empty.sources).toEqual([]);
  });
});

describe("aggregateAwaitingRowTrend", () => {
  const trend = aggregateAwaitingRowTrend(
    rows({
      window: { since: "2026-08-29T12:00:00.000Z", until: NOW, limit: 5000, truncated: false },
    }),
  );

  it("plots only the awaiting_row bucket, one series per source, busiest first", () => {
    expect(trend.series.map((s) => s.sourceId)).toEqual([SOURCE_B, SOURCE_A]);
    expect(trend.series[0].claims).toBe(2);
    expect(trend.series[1].claims).toBe(1);
  });

  it("gives every day of the window a point, zeros included", () => {
    const days = trend.series[0].points.map((p) => p.day);
    expect(days).toEqual(["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01"]);
    expect(trend.series[0].points.map((p) => p.claims)).toEqual([0, 1, 1, 0]);
  });

  it("counts a claim it cannot place on a day without moving it to one", () => {
    // SOURCE_A's awaiting_row claim is 4h old, inside the window, so it plots;
    // the point total across days never exceeds the series' claim count.
    for (const series of trend.series) {
      const plotted = series.points.reduce((sum, point) => sum + point.claims, 0);
      expect(plotted).toBeLessThanOrEqual(series.claims);
    }
  });

  it("renders NO threshold line — the dial is not in this repo", () => {
    for (const series of trend.series) {
      expect(series.threshold).toBeNull();
    }
  });

  it("reports an empty read as no series at all", () => {
    const empty = aggregateAwaitingRowTrend(rows({ claims: [], observations: [] }));
    expect(empty.series).toEqual([]);
  });
});

describe("the stuck-pattern threshold seam", () => {
  /**
   * admin-window/TASK-0024 is the blocked question "where does Admin read
   * `resolver.stuck_pattern`?". Until it is answered the seam yields nothing
   * for every source — a value here would be the hand-copy spec §10 forbids.
   */
  it("yields nothing for any source", () => {
    for (const sourceId of [SOURCE_A, SOURCE_B, "", "ticketmaster"]) {
      expect(stuckPatternThreshold(sourceId)).toBeNull();
    }
  });

  it("puts no threshold figure anywhere in a rendered trend", () => {
    const serialised = JSON.stringify(aggregateAwaitingRowTrend(rows()));
    expect(serialised).toContain('"threshold":null');
    expect(serialised).not.toContain("stuck_pattern");
  });
});

describe("readPendingClaims and readAwaitingRowTrend", () => {
  it("fetch and aggregate in one call", async () => {
    const stub = withRows(claims(), observations());
    const buckets = await readPendingClaims({ now: NOW }, stub.asSupabaseClient());
    expect(buckets.kind === "ok" && buckets.data.buckets).toHaveLength(5);

    const stub2 = withRows(claims(), observations());
    const trend = await readAwaitingRowTrend({ now: NOW }, stub2.asSupabaseClient());
    expect(trend.kind === "ok" && trend.data.series.length).toBe(2);
  });

  it("pass a not-provisioned database straight through", async () => {
    const stub = stubClient({
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
    });
    await expect(readAwaitingRowTrend({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.observations,
    });
  });
});
