import { describe, expect, it } from "vitest";
import {
  aggregateResolutionLatency,
  fetchResolutionLatency,
  readResolutionLatency,
  type ObservedAtRow,
  type ProvenanceApplyRow,
} from "@/lib/gauges/resolution-latency";
import { T } from "@/lib/db/tables";
import type { WindowInfo } from "@/lib/gauges/gauge";
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
// `over` as `windowOf` sets it: this gauge scans `field_provenance`, a table.
const WINDOW: WindowInfo = {
  since: "2026-08-25T12:00:00.000Z",
  until: NOW,
  limit: 900,
  truncated: false,
  over: "table",
};

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
      { now: NOW, days: 7, limit: 900 },
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.fieldProvenance, T.observations]);

    const scan = stub.calls[0].steps;
    expect(scan.find((s) => s.method === "gte")?.args).toEqual([
      "applied_at",
      "2026-08-25T12:00:00.000Z",
    ]);
    expect(scan.find((s) => s.method === "limit")?.args).toEqual([900]);

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
      // The read that refused is named as well as the refusal, and the
      // client's own account reaches the caller intact (BUG-0016).
      reading: T.fieldProvenance,
      message: expect.stringContaining(`permission denied for table ${T.fieldProvenance}`),
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

/**
 * A VERDICT UNSET is not an apply with a broken join (campaign
 * admin-window, QA of BUG-0010).
 *
 * `field_provenance.source_id` and `.observation_id` dropped NOT NULL in
 * scraper migration `20260901000005`, whose own column comment is the
 * contract: "null on a verdict unset ... A reader takes a null here as 'no
 * applied observation'" (and `contracts/data-model.md`, Per-field provenance).
 * `readProvenanceApplies` filters on `applied_at` alone, so those rows are in
 * the window's row set like any other.
 *
 * `unmatchedApplies` is documented in `src/lib/gauges/resolution-latency.ts`
 * as "applies whose observation was not in the second fetch ... a large value
 * means the join, not the resolver, is what the reader is looking at". An
 * unset never named an observation to fetch, so counting it there reports a
 * join defect that does not exist.
 */
describe("a verdict unset in the apply window", () => {
  /** The row shape the database returns for an unset — both keys null. */
  function unsetRow(overrides: Partial<ProvenanceApplyRow> = {}): ProvenanceApplyRow {
    return fieldProvenanceRow({
      provenance_id: "01920000-0000-7000-8000-000000000415",
      entity_type: "events",
      field: "poster_url",
      applied_at: "2026-09-01T08:00:00Z",
      // No cast: the fixture and the row type both admit the null the
      // database writes here (admin-window/BUG-0012).
      source_id: null,
      observation_id: null,
      ...overrides,
    });
  }

  /** One measurable apply (600s) beside one unset — the ticket's measurement. */
  const mixed = aggregateResolutionLatency({
    applies: [
      fieldProvenanceRow({
        observation_id: OBS.fast,
        entity_type: "events",
        applied_at: "2026-09-01T04:10:00Z",
      }),
      unsetRow(),
    ],
    observations: [
      observationRow({
        observation_id: OBS.fast,
        observed_at: "2026-09-01T04:00:00Z",
        domain: "events",
      }),
    ],
    window: WINDOW,
  });

  it("is not counted as an apply whose observation the join lost", () => {
    expect(mixed.overall.count).toBe(1);
    expect(mixed.unmatchedApplies).toBe(0);
  });

  it("is not counted among the applies, overall or per domain", () => {
    expect(mixed.applies).toBe(1);
    expect(mixed.byDomain).toHaveLength(1);
    expect(mixed.byDomain[0].applies).toBe(1);
  });

  it("is not an unmeasurable apply either — it is not one of the measurements", () => {
    expect(mixed.overall.unmeasurable).toBe(0);
    expect(mixed.byDomain[0].latency.unmeasurable).toBe(0);
  });

  it("is counted honestly on its own, overall and per domain", () => {
    expect(mixed.verdictUnsets).toBe(1);
    expect(mixed.byDomain[0].verdictUnsets).toBe(1);
  });

  it("does not disturb the measured latency it sits beside", () => {
    expect(mixed.overall.p50).toBe(600);
    expect(mixed.byDomain[0].latency.count).toBe(1);
    expect(mixed.byDomain[0].latency.min).toBe(600);
  });

  it("still names its domain when the window held nothing else for it", () => {
    const onlyUnsets = aggregateResolutionLatency({
      applies: [unsetRow({ entity_type: "groups" }), unsetRow({ entity_type: "groups" })],
      observations: [],
      window: WINDOW,
    });

    expect(onlyUnsets.applies).toBe(0);
    expect(onlyUnsets.verdictUnsets).toBe(2);
    expect(onlyUnsets.unmatchedApplies).toBe(0);
    const groups = onlyUnsets.byDomain.find((entry) => entry.domain === "groups");
    expect(groups?.applies).toBe(0);
    expect(groups?.verdictUnsets).toBe(2);
    // A count of zero applies, not a latency of zero seconds.
    expect(groups?.latency.p50).toBeNull();
  });

  it("keeps a real lost join distinguishable from an unset", () => {
    const both = aggregateResolutionLatency({
      applies: [
        fieldProvenanceRow({ observation_id: OBS.missing, entity_type: "events" }),
        unsetRow(),
      ],
      observations: [],
      window: WINDOW,
    });

    expect(both.unmatchedApplies).toBe(1);
    expect(both.verdictUnsets).toBe(1);
    expect(both.applies).toBe(1);
    // The lost join IS an unmeasurable apply; the unset is not an apply.
    expect(both.overall.unmeasurable).toBe(1);
  });

  it("asks the join for no null id", async () => {
    const stub = withRows(
      [
        fieldProvenanceRow({ observation_id: OBS.fast, applied_at: "2026-09-01T04:10:00Z" }),
        unsetRow(),
      ],
      [observationRow({ observation_id: OBS.fast, observed_at: "2026-09-01T04:00:00Z" })],
    );
    await fetchResolutionLatency({ now: NOW }, stub.asSupabaseClient());

    const join = stub.calls[1].steps;
    expect(join.find((step) => step.method === "in")?.args).toEqual([
      "observation_id",
      [OBS.fast],
    ]);
  });

  it("is read rather than filtered away, so its count can be a real one", async () => {
    const stub = withRows([unsetRow()], []);
    const result = await readResolutionLatency({ now: NOW }, stub.asSupabaseClient());

    // The scan narrows on applied_at alone. A server-side
    // `.not("observation_id", "is", null)` would keep the unset out of the row
    // set entirely, and `verdictUnsets` could then only ever be a fabricated 0.
    const narrowing = stub.calls[0].steps
      .filter((step) => step.method !== "select" && step.method !== "order")
      .flatMap((step) => step.args.map((arg) => String(arg)));
    expect(narrowing).not.toContain("observation_id");
    expect(result.kind === "ok" && result.data.verdictUnsets).toBe(1);
    expect(result.kind === "ok" && result.data.applies).toBe(0);
  });
});

/**
 * QA attack on the seam BUG-0012's fix created (admin-window, QA of BUG-0012).
 *
 * The fix split one row set into two populations, so the questions it opened
 * are: which column decides the split, do the two populations still add up to
 * what was read, and does the split move a boundary the reader depends on
 * (`window.truncated`, which BUG-0009 already had to repair).
 */
describe("the apply/unset split", () => {
  function row(overrides: Partial<ProvenanceApplyRow>): ProvenanceApplyRow {
    return fieldProvenanceRow({
      entity_type: "events",
      applied_at: "2026-09-01T04:10:00Z",
      ...overrides,
    });
  }

  /**
   * `20260901000005` drops NOT NULL on BOTH columns in one statement and only
   * `apply_resolution`'s unset branch writes them (both null, line 490); no
   * constraint ties the pair, so a half-null row is reachable in the schema.
   * The reader contract names one of the two as the discriminator:
   * `observation_id` — "a reader takes a null here as 'no applied
   * observation'". These pin that reading, not the other one.
   */
  it("reads a null observation_id as the unset, whatever source_id holds", () => {
    const halfNull = aggregateResolutionLatency({
      applies: [row({ source_id: ID.sourceTicketmaster, observation_id: null })],
      observations: [],
      window: WINDOW,
    });

    expect(halfNull.verdictUnsets).toBe(1);
    expect(halfNull.applies).toBe(0);
    expect(halfNull.unmatchedApplies).toBe(0);
    expect(halfNull.overall.unmeasurable).toBe(0);
  });

  it("reads a row naming an observation as an apply, whatever source_id holds", () => {
    const halfNull = aggregateResolutionLatency({
      applies: [row({ source_id: null, observation_id: OBS.fast })],
      observations: [
        observationRow({ observation_id: OBS.fast, observed_at: "2026-09-01T04:00:00Z" }),
      ],
      window: WINDOW,
    });

    expect(halfNull.applies).toBe(1);
    expect(halfNull.verdictUnsets).toBe(0);
    expect(halfNull.overall.count).toBe(1);
    expect(halfNull.overall.p50).toBe(600);
  });

  /**
   * Every row read is in exactly one population, and the per-domain breakdown
   * a page renders adds back up to the totals beside it. A reader who
   * differences `applies` against a cycle's write counts is doing exactly this
   * arithmetic.
   */
  it("splits every row read into exactly one population, per domain and overall", () => {
    const spread = aggregateResolutionLatency({
      applies: [
        row({ provenance_id: ID.provenance, observation_id: OBS.fast }),
        row({ observation_id: OBS.slow, applied_at: "2026-09-01T05:00:00Z" }),
        row({ observation_id: OBS.missing }),
        row({ source_id: null, observation_id: null }),
        row({ entity_type: "groups", observation_id: OBS.other, applied_at: "2026-09-01T06:00:00Z" }),
        row({ entity_type: "groups", source_id: null, observation_id: null }),
      ],
      observations: observations(),
      window: WINDOW,
    });

    const totalRead = 6;
    expect(spread.applies + spread.verdictUnsets).toBe(totalRead);
    expect(spread.byDomain.reduce((sum, d) => sum + d.applies, 0)).toBe(spread.applies);
    expect(spread.byDomain.reduce((sum, d) => sum + d.verdictUnsets, 0)).toBe(
      spread.verdictUnsets,
    );
    // The unmatched apply is unmeasurable; neither unset is.
    expect(spread.unmatchedApplies).toBe(1);
    expect(spread.overall.count + spread.overall.unmeasurable).toBe(spread.applies);
    expect(
      spread.byDomain.reduce((sum, d) => sum + d.latency.count + d.latency.unmeasurable, 0),
    ).toBe(spread.applies);
  });

  it("runs no second query when the window held nothing but unsets", async () => {
    const stub = withRows([fieldProvenanceRow({ source_id: null, observation_id: null })], []);
    const result = await readResolutionLatency({ now: NOW }, stub.asSupabaseClient());

    expect(stub.tablesRead()).toEqual([T.fieldProvenance]);
    expect(result.kind === "ok" && result.data.verdictUnsets).toBe(1);
  });

  /**
   * Truncation is decided on the rows the SERVER returned, not on the applies
   * among them (admin-window/BUG-0009). A window filled to the cap by unsets
   * is still a floor, and a reader told `applies: 0, truncated: false` would
   * read "the resolver applied nothing this week" off a page it never saw.
   */
  it("still decides truncation on every row returned when they are all unsets", async () => {
    const unsets = Array.from({ length: 3 }, (_, index) =>
      fieldProvenanceRow({
        provenance_id: `01920000-0000-7000-8000-00000000042${index}`,
        source_id: null,
        observation_id: null,
      }),
    );
    const stub = withRows(unsets, []);
    const result = await readResolutionLatency(
      { now: NOW, limit: 3 },
      stub.asSupabaseClient(),
    );

    expect(result.kind === "ok" && result.data.window.truncated).toBe(true);
    expect(result.kind === "ok" && result.data.applies).toBe(0);
    expect(result.kind === "ok" && result.data.verdictUnsets).toBe(3);
  });
});
