import { describe, expect, it } from "vitest";
import {
  STANDING_BUCKET,
  aggregateStandingDisagreements,
  fetchStandingDisagreements,
  readStandingDisagreements,
  selectStanding,
  type SourceStateRow,
} from "@/lib/gauges/standing-disagreements";
import type { PendingClaimRow, PendingObservationRow } from "@/lib/gauges/pending-claims";
import { T } from "@/lib/db/tables";
import type { WindowInfo } from "@/lib/gauges/gauge";
import { ID, observationRow, pendingClaimRow, sourceRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
} from "../../fixtures/stub-client";

/**
 * Gauge 5 — standing disagreements (campaign admin-window/TASK-0007).
 *
 * ARCHITECTURE.md §6 trap 2: there is no standing-disagreements view; it is
 * `pending_claims` filtered to one bucket, so this gauge reuses the claims
 * read and adds the `sources` leg — "who keeps being right from below" is a
 * statement about TIER, and the view carries none (trap 5).
 *
 * The tier reported is `sources.tier`, the source's CURRENT tier. It is not
 * `field_provenance.tier_at_apply`, and the two must not be conflated.
 */

const NOW = "2026-09-01T12:00:00.000Z";
// `over` as `windowOf` sets it: this gauge scans `observations`, a table.
const WINDOW: WindowInfo = {
  since: "2026-06-03T12:00:00.000Z",
  until: NOW,
  limit: 900,
  truncated: false,
  over: "table",
};

const SOURCE_A = ID.sourceTicketmaster;
const SOURCE_B = ID.sourceBandsintown;
const SOURCE_UNKNOWN = "01920000-0000-7000-8000-000000000199";

function claims(): PendingClaimRow[] {
  return [
    pendingClaimRow(STANDING_BUCKET, {
      observation_id: "01920000-0000-7000-8000-000000000a01",
      source_id: SOURCE_B,
      domain: "events",
    }),
    pendingClaimRow(STANDING_BUCKET, {
      observation_id: "01920000-0000-7000-8000-000000000a02",
      source_id: SOURCE_B,
      domain: "groups",
    }),
    pendingClaimRow(STANDING_BUCKET, {
      observation_id: "01920000-0000-7000-8000-000000000a03",
      source_id: SOURCE_A,
      domain: "events",
    }),
    // A contradiction from a source whose `sources` row does not come back.
    pendingClaimRow(STANDING_BUCKET, {
      observation_id: "01920000-0000-7000-8000-000000000a04",
      source_id: SOURCE_UNKNOWN,
      domain: "events",
    }),
    // Not a contradiction: another bucket, and the unrenderable one.
    pendingClaimRow("awaiting_row", {
      observation_id: "01920000-0000-7000-8000-000000000a05",
      source_id: SOURCE_B,
    }),
    pendingClaimRow("in_window", {
      observation_id: "01920000-0000-7000-8000-000000000a06",
      source_id: SOURCE_B,
    }),
  ];
}

function observations(): PendingObservationRow[] {
  return [
    observationRow({
      observation_id: "01920000-0000-7000-8000-000000000a01",
      observed_at: "2026-08-25T12:00:00Z", // 7 days
    }),
    observationRow({
      observation_id: "01920000-0000-7000-8000-000000000a02",
      observed_at: "2026-08-31T12:00:00Z", // 1 day
    }),
    observationRow({
      observation_id: "01920000-0000-7000-8000-000000000a03",
      observed_at: "2026-08-30T12:00:00Z", // 2 days
    }),
    // a04's observation is deliberately absent: its age is unknown.
    observationRow({
      observation_id: "01920000-0000-7000-8000-000000000a05",
      observed_at: "2026-08-31T12:00:00Z",
    }),
  ];
}

function sources(): SourceStateRow[] {
  return [
    sourceRow({ source_id: SOURCE_A, source: "ticketmaster", tier: "official" }),
    sourceRow({
      source_id: SOURCE_B,
      source: "bandsintown",
      tier: "standard",
      lifecycle: "trial",
    }),
  ];
}

function rows(
  overrides: Partial<{
    claims: PendingClaimRow[];
    observations: PendingObservationRow[];
    sources: SourceStateRow[];
  }> = {},
) {
  return {
    claims: {
      claims: overrides.claims ?? claims(),
      observations: overrides.observations ?? observations(),
      window: WINDOW,
      filter: {},
    },
    sources: overrides.sources ?? sources(),
  };
}

function withRows(
  claimRows: PendingClaimRow[],
  observationRows: PendingObservationRow[],
  sourceRows: SourceStateRow[],
) {
  return stubClient({
    [T.observations]: { data: observationRows },
    [T.pendingClaims]: { data: claimRows },
    [T.sources]: { data: sourceRows },
  });
}

describe("selectStanding", () => {
  it("is the claims view narrowed to one bucket, with the unrenderable one gone", () => {
    const standing = selectStanding(rows().claims);
    expect(standing).toHaveLength(4);
    expect(standing.every((claim) => claim.bucket === STANDING_BUCKET)).toBe(true);
  });
});

describe("fetchStandingDisagreements", () => {
  it("reuses the claims read and adds a bounded sources lookup", async () => {
    const stub = withRows(claims(), observations(), sources());
    const result = await fetchStandingDisagreements({ now: NOW }, stub.asSupabaseClient());

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.observations, T.pendingClaims, T.sources]);

    const scan = stub.calls[0].steps;
    expect(scan.some((s) => s.method === "gte")).toBe(true);
    expect(scan.find((s) => s.method === "limit")?.args[0]).toBeGreaterThan(0);

    // The sources leg is a lookup, bounded by the id set the claims produced —
    // three distinct sources hold a standing disagreement here.
    const lookup = stub.calls[2].steps;
    expect(lookup.find((s) => s.method === "in")?.args).toEqual([
      "source_id",
      [SOURCE_B, SOURCE_A, SOURCE_UNKNOWN],
    ]);
    expect(lookup.find((s) => s.method === "limit")?.args).toEqual([3]);
  });

  it("runs no sources lookup when nothing is standing", async () => {
    const stub = withRows(
      [pendingClaimRow("awaiting_row", { observation_id: ID.observationA })],
      [observationRow({ observation_id: ID.observationA })],
      sources(),
    );
    await fetchStandingDisagreements({ now: NOW }, stub.asSupabaseClient());
    expect(stub.tablesRead()).toEqual([T.observations, T.pendingClaims]);
  });

  it("reports whichever object is absent, by name", async () => {
    const noSources = stubClient({
      [T.observations]: { data: observations() },
      [T.pendingClaims]: { data: claims() },
      [T.sources]: { error: tableNotInSchemaCache(T.sources) },
    });
    await expect(
      fetchStandingDisagreements({}, noSources.asSupabaseClient()),
    ).resolves.toEqual({ kind: "not_provisioned", missing: T.sources });

    const noView = stubClient({
      [T.observations]: { data: observations() },
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
    });
    await expect(fetchStandingDisagreements({}, noView.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.pendingClaims,
    });
  });

  it("carries an arbitrary failure through as the database's own words", async () => {
    const stub = stubClient({
      [T.observations]: { data: observations() },
      [T.pendingClaims]: { data: claims() },
      [T.sources]: { error: permissionDenied(T.sources) },
    });
    await expect(fetchStandingDisagreements({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "error",
      // The read that refused is named as well as the refusal, and the
      // client's own account reaches the caller intact (BUG-0016).
      reading: T.sources,
      message: expect.stringContaining(`permission denied for table ${T.sources}`),
    });
  });
});

describe("aggregateStandingDisagreements", () => {
  const standing = aggregateStandingDisagreements(rows());

  it("counts only live contradictions, never another bucket", () => {
    expect(standing.claims).toBe(4);
    expect(JSON.stringify(standing)).not.toContain("in_window");
    expect(JSON.stringify(standing)).not.toContain("awaiting_row");
  });

  it("splits per source, most contradictions first", () => {
    expect(standing.bySource.map((entry) => entry.sourceId)).toEqual([
      SOURCE_B,
      SOURCE_A,
      SOURCE_UNKNOWN,
    ]);
    expect(standing.bySource[0].claims).toBe(2);
  });

  it("names the source and its CURRENT tier — the 'from below' half of the question", () => {
    expect(standing.bySource[0]).toMatchObject({
      source: "bandsintown",
      tier: "standard",
      lifecycle: "trial",
    });
    expect(standing.bySource[1]).toMatchObject({ source: "ticketmaster", tier: "official" });
  });

  it("reports an unnamed source as an id, never as a guessed name", () => {
    const unknown = standing.bySource[2];
    expect(unknown.sourceId).toBe(SOURCE_UNKNOWN);
    expect(unknown.source).toBeNull();
    expect(unknown.tier).toBeNull();
    expect(standing.unnamedSources).toBe(1);
  });

  it("ages contradictions from observed_at and names the oldest per source", () => {
    expect(standing.age.count).toBe(3);
    expect(standing.age.max).toBe(7 * 86_400);
    expect(standing.bySource[0].oldestObservedAt).toBe("2026-08-25T12:00:00Z");
    expect(standing.bySource[1].oldestObservedAt).toBe("2026-08-30T12:00:00Z");
  });

  it("gives a contradiction with no observation no age and no oldest instant", () => {
    const unknown = standing.bySource[2];
    expect(unknown.claims).toBe(1);
    expect(unknown.age.count).toBe(0);
    expect(unknown.age.unmeasurable).toBe(1);
    expect(unknown.age.p50).toBeNull();
    expect(unknown.oldestObservedAt).toBeNull();
  });

  it("lists the domains a source disagrees about", () => {
    expect(standing.bySource[0].domains).toEqual(["events", "groups"]);
    expect(standing.bySource[1].domains).toEqual(["events"]);
  });

  it("reports an empty read as no sources and NULL age figures", () => {
    const empty = aggregateStandingDisagreements(
      rows({ claims: [], observations: [], sources: [] }),
    );
    expect(empty.claims).toBe(0);
    expect(empty.bySource).toEqual([]);
    expect(empty.unnamedSources).toBe(0);
    expect(empty.age.p50).toBeNull();
    expect(empty.age.max).toBeNull();
  });
});

describe("readStandingDisagreements", () => {
  it("fetches and aggregates in one call", async () => {
    const stub = withRows(claims(), observations(), sources());
    const result = await readStandingDisagreements({ now: NOW }, stub.asSupabaseClient());
    expect(result.kind === "ok" && result.data.claims).toBe(4);
  });
});
