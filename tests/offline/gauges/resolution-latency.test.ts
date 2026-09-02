import { describe, expect, it } from "vitest";
import {
  aggregateResolutionLatency,
  fetchResolutionLatency,
  readResolutionLatency,
  type ObservedAtRow,
  type ProvenanceApplyRow,
} from "@/lib/gauges/resolution-latency";
import { T } from "@/lib/db/tables";
import { ID, fieldProvenanceRow, observationRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
} from "../../fixtures/stub-client";

/**
 * Gauge 2 — resolution latency (campaign admin-window/TASK-0007).
 *
 * The pair is `observations.observed_at` → `field_provenance.applied_at`,
 * joined in TypeScript by `observation_id` (ARCHITECTURE.md §4.2), never by a
 * PostgREST embed. The assertions that matter: an apply whose observation is
 * missing has no latency rather than a zero one, and the grouping key is the
 * provenance table's own spelling of the canonical table (`entity_type`),
 * reported under spec §5's word, `domain`.
 */

const NOW = "2026-09-01T12:00:00.000Z";
const WINDOW = { since: "2026-08-25T12:00:00.000Z", until: NOW, limit: 2000, truncated: false };

const OBS = {
  fast: "01920000-0000-7000-8000-000000000301",
  slow: "01920000-0000-7000-8000-000000000302",
  other: "01920000-0000-7000-8000-000000000303",
  missing: "01920000-0000-7000-8000-000000000304",
};

function applies(): ProvenanceApplyRow[] {
  return [
    fieldProvenanceRow({
      provenance_id: "01920000-0000-7000-8000-000000000411",
      entity_type: "events",
      observation_id: OBS.fast,
      applied_at: "2026-09-01T04:10:00Z",
    }),
    fieldProvenanceRow({
      provenance_id: "01920000-0000-7000-8000-000000000412",
      entity_type: "events",
      observation_id: OBS.slow,
      applied_at: "2026-09-01T05:00:00Z",
    }),
    fieldProvenanceRow({
      provenance_id: "01920000-0000-7000-8000-000000000413",
      entity_type: "groups",
      observation_id: OBS.other,
      applied_at: "2026-09-01T06:00:00Z",
    }),
    // The apply whose observation the second read did not return.
    fieldProvenanceRow({
      provenance_id: "01920000-0000-7000-8000-000000000414",
      entity_type: "events",
      observation_id: OBS.missing,
      applied_at: "2026-09-01T07:00:00Z",
    }),
  ];
}

function observations(): ObservedAtRow[] {
  return [
    observationRow({
      observation_id: OBS.fast,
      observed_at: "2026-09-01T04:00:00Z", // 600s
      domain: "events",
    }),
    observationRow({
      observation_id: OBS.slow,
      observed_at: "2026-09-01T04:00:00Z", // 3600s
      domain: "events",
    }),
    observationRow({
      observation_id: OBS.other,
      observed_at: "2026-09-01T05:58:00Z", // 120s
      domain: "groups",
    }),
  ];
}

function withRows(provenance: ProvenanceApplyRow[], observed: ObservedAtRow[]) {
  return stubClient({
    [T.fieldProvenance]: { data: provenance },
    [T.observations]: { data: observed },
  });
}

describe("fetchResolutionLatency", () => {
  it("scans field_provenance with an explicit window and cap, then joins by id", async () => {
    const stub = withRows(applies(), observations());
    const result = await fetchResolutionLatency(
      { now: NOW, days: 7, limit: 2000 },
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.fieldProvenance, T.observations]);

    const scan = stub.calls[0].steps;
    expect(scan.find((s) => s.method === "gte")?.args).toEqual([
      "applied_at",
      "2026-08-25T12:00:00.000Z",
    ]);
    expect(scan.find((s) => s.method === "limit")?.args).toEqual([2000]);

    // The second leg is bounded by the id set the first produced — four
    // applies, four distinct observation ids.
    const join = stub.calls[1].steps;
    expect(join.find((s) => s.method === "in")?.args).toEqual([
      "observation_id",
      [OBS.fast, OBS.slow, OBS.other, OBS.missing],
    ]);
    expect(join.find((s) => s.method === "limit")?.args).toEqual([4]);
    // No PostgREST embed: the select list names columns only.
    expect(String(scan.find((s) => s.method === "select")?.args[0])).not.toContain("(");
  });

  it("runs no second query when the window held no applies", async () => {
    const stub = withRows([], []);
    const result = await fetchResolutionLatency({ now: NOW }, stub.asSupabaseClient());
    expect(result.kind === "ok" && result.data.applies).toEqual([]);
    expect(stub.tablesRead()).toEqual([T.fieldProvenance]);
  });

  it("reports whichever leg is absent, by name", async () => {
    const missingProvenance = stubClient({
      [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
    });
    await expect(
      fetchResolutionLatency({}, missingProvenance.asSupabaseClient()),
    ).resolves.toEqual({ kind: "not_provisioned", missing: T.fieldProvenance });

    const missingObservations = stubClient({
      [T.fieldProvenance]: { data: applies() },
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
    });
    await expect(
      fetchResolutionLatency({}, missingObservations.asSupabaseClient()),
    ).resolves.toEqual({ kind: "not_provisioned", missing: T.observations });
  });

  it("carries an arbitrary failure through as the database's own words", async () => {
    const stub = stubClient({
      [T.fieldProvenance]: { error: permissionDenied(T.fieldProvenance) },
    });
    await expect(fetchResolutionLatency({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "error",
      message: `permission denied for table ${T.fieldProvenance}`,
    });
  });
});

describe("aggregateResolutionLatency", () => {
  const latency = aggregateResolutionLatency({
    applies: applies(),
    observations: observations(),
    window: WINDOW,
  });

  it("measures observed_at to applied_at across every domain", () => {
    expect(latency.applies).toBe(4);
    expect(latency.overall.count).toBe(3);
    expect(latency.overall.min).toBe(120);
    expect(latency.overall.max).toBe(3600);
    expect(latency.overall.p50).toBe(600);
  });

  it("splits by domain, in a stable order", () => {
    expect(latency.byDomain.map((d) => d.domain)).toEqual(["events", "groups"]);
    const events = latency.byDomain[0];
    expect(events.applies).toBe(3);
    expect(events.latency.count).toBe(2);
    expect(events.latency.min).toBe(600);
    expect(events.latency.max).toBe(3600);
  });

  it("counts an apply whose observation is missing as unmeasurable, exactly once", () => {
    expect(latency.unmatchedApplies).toBe(1);
    expect(latency.overall.unmeasurable).toBe(1);
    expect(latency.byDomain[0].latency.unmeasurable).toBe(1);
  });

  it("carries the cadence the latency is judged against", () => {
    expect(latency.cadenceSeconds).toBe(900);
  });

  it("reports an empty window as nulls, not zero-second latencies", () => {
    const empty = aggregateResolutionLatency({
      applies: [],
      observations: [],
      window: WINDOW,
    });
    expect(empty.applies).toBe(0);
    expect(empty.byDomain).toEqual([]);
    expect(empty.overall.count).toBe(0);
    expect(empty.overall.p50).toBeNull();
    expect(empty.overall.max).toBeNull();
    expect(empty.unmatchedApplies).toBe(0);
  });

  it("surfaces a negative latency rather than hiding a clock disagreement", () => {
    const negative = aggregateResolutionLatency({
      applies: [
        fieldProvenanceRow({ observation_id: ID.observationA, applied_at: "2026-09-01T03:00:00Z" }),
      ],
      observations: [
        observationRow({ observation_id: ID.observationA, observed_at: "2026-09-01T04:00:00Z" }),
      ],
      window: WINDOW,
    });
    expect(negative.overall.min).toBe(-3600);
    expect(negative.overall.unmeasurable).toBe(0);
  });
});

describe("readResolutionLatency", () => {
  it("fetches and aggregates in one call", async () => {
    const stub = withRows(applies(), observations());
    const result = await readResolutionLatency({ now: NOW }, stub.asSupabaseClient());
    expect(result.kind === "ok" && result.data.overall.count).toBe(3);
  });
});
