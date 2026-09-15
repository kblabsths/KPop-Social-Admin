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
import { isSourceNamed, sourceLabel, sourceNamesOf } from "@/lib/sources/names";
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
  // How many rows the scan came back with (admin-window/DEBT-0006). The
  // aggregates below take their rows as their own argument and never read it;
  // it is stated because a `WindowInfo` is not one without it.
  held: 0,
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
    // TWO distinct sources hold a standing disagreement this read can see.
    //
    // The third (`SOURCE_UNKNOWN`, claim …a04) is the one whose observation
    // this fixture deliberately withholds, and it is not in the claim set: the
    // gauge keeps the claims the `observations` scan returned, which is what
    // `.in(<the scan's ids>)` did at the database when the claims leg was that
    // scan's second step (admin-window/TASK-0074). The figure was 3 here only
    // because the stub answers every query of the view with the same fixed row
    // set — no database ever handed that claim back for these ids. The
    // aggregate's own treatment of a claim with no observation is unchanged
    // and is asserted below, over a bundle rather than over a read.
    const lookup = stub.calls[2].steps;
    expect(lookup.find((s) => s.method === "in")?.args).toEqual([
      "source_id",
      [SOURCE_B, SOURCE_A],
    ]);
    expect(lookup.find((s) => s.method === "limit")?.args).toEqual([2]);
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
      // The account's runs, as `lib/db/result.ts` decided them: every run of
      // this one is the DATABASE's, its own code included (admin-window/BUG-0196).
      authored: [
        { words: `permission denied for table ${T.sources}`, author: "the machine" },
        { words: "(42501)", author: "the machine" },
      ],
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

  /**
   * **ONE question, asked of its owner** (campaign admin-window/DEBT-0022,
   * the class site admin-window/TASK-0060 fixed on `/sources`).
   *
   * "Is this source nameable?" was spelled twice about one gauge: this module
   * counted `sourceById.get(id) === undefined`, while every ROW it produces is
   * labelled by `sourceLabel` (`lib/sources/names.ts`), which also puts an id
   * on screen for a registry row that came back with NO INK in its name. So a
   * blank-named source wore its uuid in the table and was left out of the
   * number under it — the blank-source-name class
   * (admin-window/BUG-0152/54/56/58/59) reaching the gauge, and LESSONS 11's
   * shape exactly.
   *
   * Graded against the owner rather than against a number typed here: the
   * splits this gauge leaves for a surface to label by id, counted with
   * `isSourceNamed` over the gauge's own registry rows, ARE `unnamedSources`.
   * Both directions in one case (LESSONS 8): three of the four spellings of
   * "no ink" must be counted, and a name with ink must not.
   */
  for (const blank of ["", "   ", "\u200b"]) {
    it(`counts a source the registry names ${JSON.stringify(blank)} exactly as one with no row at all`, () => {
      const blanked = sources().map((row) =>
        row.source_id === SOURCE_A ? { ...row, source: blank } : row,
      );
      const gauge = aggregateStandingDisagreements(rows({ sources: blanked }));

      // The population is unchanged — same three splits, same order — so the
      // count below is over the same rows the baseline case counted.
      expect(gauge.bySource.map((entry) => entry.sourceId)).toEqual(
        standing.bySource.map((entry) => entry.sourceId),
      );

      // SOURCE_A's row came back and SOURCE_UNKNOWN's did not; both name
      // nothing a person can read, so both are shown by their id…
      const names = sourceNamesOf(blanked);
      const wearingAnId = gauge.bySource.filter(
        (split) => sourceLabel(names, split.sourceId) === split.sourceId,
      );
      expect(wearingAnId.map((split) => split.sourceId).sort()).toEqual(
        [SOURCE_A, SOURCE_UNKNOWN].sort(),
      );
      expect(
        gauge.bySource.every(
          (split) => (split.source === null) === !isSourceNamed(names, split.sourceId),
        ),
      ).toBe(true);

      // …and the gauge's number is that set's size, not the 1 a
      // `=== undefined` test could see.
      expect(gauge.unnamedSources).toBe(wearingAnId.length);

      // The other direction, same fixture with the ink back: the named source
      // keeps its registry name byte-identical and is not counted.
      expect(standing.bySource[1].source).toBe("ticketmaster");
      expect(standing.unnamedSources).toBe(1);
    });
  }

  it("leaves a name with ink exactly as the registry wrote it, pads included", () => {
    // A name this app finds odd is still a name: it travels byte-identical and
    // is never trimmed, rewritten or swapped for the id (`lib/sources/names.ts`).
    const padded = "  ticketmaster  ";
    const gauge = aggregateStandingDisagreements(
      rows({
        sources: sources().map((row) =>
          row.source_id === SOURCE_A ? { ...row, source: padded } : row,
        ),
      }),
    );
    expect(gauge.bySource[1].source).toBe(padded);
    expect(gauge.unnamedSources).toBe(1);
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
    // Three of the four standing claims: …a04's observation is not in the
    // scan, so the claim is not in the set the scan's ids bound (see the
    // sources-lookup test above).
    expect(result.kind === "ok" && result.data.claims).toBe(3);
  });
});
