import { describe, expect, it } from "vitest";
import {
  RE_REJECT_REASON,
  aggregateRejectionStamps,
  fetchRejectionStamps,
  readRejectionStampGauge,
  type RejectionRow,
} from "@/lib/gauges/settled-values";
import type { SourceStateRow } from "@/lib/db/gauges";
import { T } from "@/lib/db/tables";
import type { WindowInfo } from "@/lib/gauges/gauge";
import { ID, observationRow, sourceRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
} from "../../fixtures/stub-client";

/**
 * Gauge 6 — settled values (campaign admin-window/TASK-0007).
 *
 * "Who keeps pushing adjudicated values" is `observations.rejected_by =
 * 'resolver'` — migration `20260901000003` calls it "the mechanical
 * re-rejection at step 0b". A `verdict` rejection is the human adjudication
 * itself and is reported beside the re-rejects, never summed into them; that
 * separation is the whole gauge.
 */

const NOW = "2026-09-01T12:00:00.000Z";
// `over` as `windowOf` sets it: this gauge scans `observations`, a table.
const WINDOW: WindowInfo = {
  since: "2026-08-17T12:00:00.000Z",
  until: NOW,
  limit: 900,
  truncated: false,
  over: "table",
};

const SOURCE_A = ID.sourceTicketmaster;
const SOURCE_B = ID.sourceBandsintown;
const SOURCE_UNKNOWN = "01920000-0000-7000-8000-000000000199";

function rejection(
  observationId: string,
  sourceId: string,
  rejectedAt: string,
  rejectedBy: string | null,
): RejectionRow {
  return {
    ...observationRow({
      observation_id: observationId,
      source_id: sourceId,
      status: "rejected",
      rejected_by: rejectedBy,
    }),
    // `rejected_at` is nullable on the table but never null in this row set:
    // the query's `gte` on it cannot return a claim that was never rejected.
    rejected_at: rejectedAt,
  };
}

/** Three weeks of rejections across three sources. */
function rejections(): RejectionRow[] {
  return [
    // bandsintown: three re-rejects, spread over two weeks, plus one verdict.
    rejection("01920000-0000-7000-8000-000000000b01", SOURCE_B, "2026-08-25T06:00:00Z", "resolver"),
    rejection("01920000-0000-7000-8000-000000000b02", SOURCE_B, "2026-08-26T06:00:00Z", "resolver"),
    rejection("01920000-0000-7000-8000-000000000b03", SOURCE_B, "2026-09-01T06:00:00Z", "resolver"),
    rejection("01920000-0000-7000-8000-000000000b04", SOURCE_B, "2026-08-25T07:00:00Z", "verdict"),
    // ticketmaster: one re-reject, one verdict.
    rejection("01920000-0000-7000-8000-000000000b05", SOURCE_A, "2026-08-31T06:00:00Z", "resolver"),
    rejection("01920000-0000-7000-8000-000000000b06", SOURCE_A, "2026-08-31T07:00:00Z", "verdict"),
    // an unnamed source, and a stamp carrying no reason at all.
    rejection("01920000-0000-7000-8000-000000000b07", SOURCE_UNKNOWN, "2026-08-31T08:00:00Z", "verdict"),
    rejection("01920000-0000-7000-8000-000000000b08", SOURCE_A, "2026-08-31T09:00:00Z", null),
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

function withRows(rejectionRows: RejectionRow[], sourceRows: SourceStateRow[]) {
  return stubClient({
    [T.observations]: { data: rejectionRows },
    [T.sources]: { data: sourceRows },
  });
}

const sourceOf = (values: ReturnType<typeof aggregateRejectionStamps>, id: string) =>
  values.bySource.find((entry) => entry.sourceId === id);

describe("fetchRejectionStamps", () => {
  it("scans observations by rejection stamp, windowed and capped, then names the sources", async () => {
    const stub = withRows(rejections(), sources());
    const result = await fetchRejectionStamps(
      { now: NOW, days: 15, limit: 900 },
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    expect(stub.tablesRead()).toEqual([T.observations, T.sources]);

    const scan = stub.calls[0].steps;
    // `gte` on the nullable stamp is also the "was ever rejected" filter: a
    // claim never adjudicated has a null stamp and cannot satisfy it.
    expect(scan.find((s) => s.method === "gte")?.args).toEqual([
      "rejected_at",
      "2026-08-17T12:00:00.000Z",
    ]);
    expect(scan.find((s) => s.method === "limit")?.args).toEqual([900]);
    expect(scan.find((s) => s.method === "order")?.args).toEqual([
      "rejected_at",
      { ascending: false },
    ]);

    const lookup = stub.calls[1].steps;
    expect(lookup.find((s) => s.method === "in")?.args).toEqual([
      "source_id",
      [SOURCE_B, SOURCE_A, SOURCE_UNKNOWN],
    ]);
    expect(lookup.find((s) => s.method === "limit")?.args).toEqual([3]);
  });

  it("bounds the query even when the caller passes nothing", async () => {
    const stub = withRows([], []);
    await fetchRejectionStamps({}, stub.asSupabaseClient());
    const steps = stub.calls[0].steps;
    expect(steps.some((s) => s.method === "gte")).toBe(true);
    expect(steps.find((s) => s.method === "limit")?.args[0]).toBeGreaterThan(0);
    // No rejections means no sources lookup.
    expect(stub.tablesRead()).toEqual([T.observations]);
  });

  it("reports whichever object is absent, by name", async () => {
    const noObservations = stubClient({
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
    });
    await expect(fetchRejectionStamps({}, noObservations.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.observations,
    });

    const noSources = stubClient({
      [T.observations]: { data: rejections() },
      [T.sources]: { error: tableNotInSchemaCache(T.sources) },
    });
    await expect(fetchRejectionStamps({}, noSources.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.sources,
    });
  });

  it("carries an arbitrary failure through as the database's own words", async () => {
    const stub = stubClient({ [T.observations]: { error: permissionDenied(T.observations) } });
    await expect(fetchRejectionStamps({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "error",
      // The read that refused is named as well as the refusal, and the
      // client's own account reaches the caller intact (BUG-0016).
      reading: T.observations,
      message: expect.stringContaining(`permission denied for table ${T.observations}`),
    });
  });
});

describe("aggregateRejectionStamps", () => {
  const values = aggregateRejectionStamps({
    rejections: rejections(),
    sources: sources(),
    window: WINDOW,
  });

  it("counts the re-rejects apart from the human adjudications", () => {
    expect(RE_REJECT_REASON).toBe("resolver");
    expect(values.rejections).toBe(8);
    expect(values.rerejected).toBe(4);
    expect(values.byReason).toEqual({ verdict: 3, resolver: 4, window: 0 });
    // The reserved reason is present as a zero, never invented as a count.
    expect(values.byReason.window).toBe(0);
  });

  it("reports a stamp with no reason rather than counting it as a re-reject", () => {
    expect(values.unattributed).toBe(1);
    expect(values.rerejected + values.byReason.verdict + values.unattributed).toBe(
      values.rejections,
    );
  });

  it("keeps each unattributed stamp with the source that pushed it", () => {
    // What is missing is the REASON, not the source: `observations.source_id`
    // is not nullable, so an unattributed rejection belongs to exactly one
    // source and a reader narrowed to a source can be told whether it is
    // theirs (admin-window/BUG-0022). Fleet-wide, the splits add back up.
    expect(sourceOf(values, SOURCE_A)?.unattributed).toBe(1);
    expect(sourceOf(values, SOURCE_B)?.unattributed).toBe(0);
    expect(sourceOf(values, SOURCE_UNKNOWN)?.unattributed).toBe(0);
    expect(
      values.bySource.reduce((sum, entry) => sum + entry.unattributed, 0),
    ).toBe(values.unattributed);
    // Every one of a source's rejections is either reasoned or unattributed.
    for (const entry of values.bySource) {
      const reasoned = Object.values(entry.byReason).reduce((sum, n) => sum + n, 0);
      expect(reasoned + entry.unattributed, entry.sourceId).toBe(entry.total);
    }
  });

  it("ranks sources by re-rejects, most first", () => {
    expect(values.bySource.map((entry) => entry.sourceId)).toEqual([
      SOURCE_B,
      SOURCE_A,
      SOURCE_UNKNOWN,
    ]);
    expect(sourceOf(values, SOURCE_B)).toMatchObject({
      source: "bandsintown",
      tier: "standard",
      rerejected: 3,
      adjudicated: 1,
      total: 4,
    });
    expect(sourceOf(values, SOURCE_A)).toMatchObject({
      source: "ticketmaster",
      tier: "official",
      rerejected: 1,
      adjudicated: 1,
      total: 3,
    });
  });

  it("reports an unnamed source as an id, never as a guessed name", () => {
    expect(sourceOf(values, SOURCE_UNKNOWN)).toMatchObject({
      source: null,
      tier: null,
      rerejected: 0,
      adjudicated: 1,
    });
    expect(values.unnamedSources).toBe(1);
  });

  it("puts each rejection in the week it happened, zeros included", () => {
    const bandsintown = sourceOf(values, SOURCE_B);
    expect(bandsintown?.weeks.map((week) => week.weekStart)).toEqual([
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
    expect(bandsintown?.weeks.map((week) => week.rerejected)).toEqual([0, 2, 1]);
    expect(bandsintown?.weeks.map((week) => week.adjudicated)).toEqual([0, 1, 0]);
  });

  it("never counts an unattributed stamp into a weekly series", () => {
    const ticketmaster = sourceOf(values, SOURCE_A);
    const plotted = ticketmaster?.weeks.reduce(
      (sum, week) => sum + week.rerejected + week.adjudicated,
      0,
    );
    // Three rejections, one of which carries no reason.
    expect(plotted).toBe(2);
    expect(ticketmaster?.total).toBe(3);
  });

  it("counts a reason the check constraint may gain later under its own name", () => {
    const later = aggregateRejectionStamps({
      rejections: [
        rejection("01920000-0000-7000-8000-000000000b09", SOURCE_A, "2026-08-31T06:00:00Z", "appeal"),
      ],
      sources: sources(),
      window: WINDOW,
    });
    expect(later.byReason.appeal).toBe(1);
    expect(later.rerejected).toBe(0);
  });

  it("reports an empty window as zero counts and no sources", () => {
    const empty = aggregateRejectionStamps({ rejections: [], sources: [], window: WINDOW });
    expect(empty.rejections).toBe(0);
    expect(empty.rerejected).toBe(0);
    expect(empty.bySource).toEqual([]);
    expect(empty.byReason).toEqual({ verdict: 0, resolver: 0, window: 0 });
    expect(empty.unattributed).toBe(0);
  });
});

describe("readRejectionStampGauge", () => {
  it("fetches and aggregates in one call", async () => {
    const stub = withRows(rejections(), sources());
    const result = await readRejectionStampGauge({ now: NOW, days: 15 }, stub.asSupabaseClient());
    expect(result.kind === "ok" && result.data.rerejected).toBe(4);
  });

  it("passes a not-provisioned database straight through", async () => {
    const stub = stubClient({
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
    });
    await expect(readRejectionStampGauge({}, stub.asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.observations,
    });
  });
});
