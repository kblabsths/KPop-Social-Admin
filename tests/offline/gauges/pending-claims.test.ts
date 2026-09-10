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
import { readPendingClaimRows, readPendingObservations } from "@/lib/db/gauges";
import { T } from "@/lib/db/tables";
import {
  PENDING_CLAIMS_DEFAULTS,
  aggregatePendingClaims as aggregate,
} from "@/lib/gauges/pending-claims";
import { idsOf, resolveBounds, windowOf, type WindowInfo } from "@/lib/gauges/gauge";
import { ID, observationRow, pendingClaimRow } from "../../fixtures/rows";
import { claimView } from "../claims/population";
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
  it("scans observations and windows the view over the SAME interval, both bounded", async () => {
    const stub = withRows(claims(), observations());
    const result = await fetchPendingClaims(
      { now: NOW, days: 90, limit: 900 },
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
    expect(scan.find((s) => s.method === "limit")?.args).toEqual([900]);
    // Oldest first: truncation drops the newest claims and keeps the stuck ones.
    expect(scan.find((s) => s.method === "order")?.args).toEqual([
      "observed_at",
      { ascending: true },
    ]);

    // The claims leg is a WINDOW over the view's own instant, not a lookup by
    // the ids the scan returned (admin-window/TASK-0074): the same lower
    // bound, the same cap, the same oldest-first order, and no `.in()` at all.
    const claimsLeg = stub.calls[1].steps;
    expect(claimsLeg.find((s) => s.method === "gte")?.args).toEqual([
      "observed_at",
      "2026-06-03T12:00:00.000Z",
    ]);
    expect(claimsLeg.find((s) => s.method === "limit")?.args).toEqual([900]);
    expect(claimsLeg.filter((s) => s.method === "order").map((s) => s.args)).toEqual([
      ["observed_at", { ascending: true }],
      // A total order, so which claims are inside a truncated window is
      // decided by the database and not by a tie.
      ["observation_id", { ascending: true }],
    ]);
    expect(claimsLeg.some((s) => s.method === "in")).toBe(false);
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

  /**
   * THE POINT OF admin-window/TASK-0074, asserted where it can be seen.
   *
   * The gauge used to `await` its `observations` scan and then feed the ids it
   * returned into a chunked lookup of the view — so `/claims` waited for the
   * scan, then for the lookup's batches, and the page's longest chain was four
   * sequential round trips deep while every other leg on it was one.
   *
   * **This test fails against that shape**, and is written so that it does:
   * the stub records a call at `.from(…)`, which happens the moment a read is
   * ISSUED, so a claims read that is a second step has not been recorded yet
   * at the instant the fetch first suspends. Sequential: `[observations]`.
   * Concurrent: both.
   */
  it("issues both legs before it waits for either — fails against the sequential shape, where the view is not queried until the scan has answered", async () => {
    const stub = withRows(claims(), observations());
    // Deliberately NOT awaited: everything the fetch issues before its first
    // suspension is what is in flight together.
    const inFlight = fetchPendingClaims({ now: NOW }, stub.asSupabaseClient());
    expect(stub.tablesRead()).toEqual([T.observations, T.pendingClaims]);
    await expect(inFlight).resolves.toMatchObject({ kind: "ok" });
  });

  it("queries the view even when the window held no observation at all", async () => {
    // The old shape skipped the second leg when the scan came back empty — an
    // id-set lookup over no ids is a pointless request (`readRowsByIds` still
    // makes that promise for every join that has one). A windowed read needs
    // no ids, and skipping it could only be done by waiting for the scan,
    // which is the wait this gauge no longer takes. It costs one request that
    // is already in flight beside another, and never a round trip's latency.
    const stub = withRows([], []);
    const result = await fetchPendingClaims({ now: NOW }, stub.asSupabaseClient());
    expect(stub.tablesRead()).toEqual([T.observations, T.pendingClaims]);
    expect(result.kind === "ok" && result.data.claims).toEqual([]);
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
      // The read that refused is named as well as the refusal, and the
      // client's own account reaches the caller intact (BUG-0016).
      reading: T.observations,
      message: expect.stringContaining(`permission denied for table ${T.observations}`),
    });
  });
});

/* ── the collapse: the claim set the two shapes agree on ─────────────────── */

/**
 * admin-window/TASK-0074 replaced the gauge's second leg — a chunked
 * `.in(<the ids the scan returned>)` lookup of `pending_claims` — with a
 * WINDOW over the view's own `observed_at`, so the two legs are siblings. The
 * ticket's own instruction was to PROVE the sets are the same rather than
 * assume it, and to say so where they are not.
 *
 * Here is the whole of the proof, offline:
 *
 *  - over a fixture where the view's instant and the observation's AGREE — the
 *    schema's real state, since the view carries the column through unchanged
 *    (scraper migration `20260910000001`, `HANDOFF … place 3 of 3`) — the two
 *    shapes produce the same aggregate, figure for figure;
 *  - over a fixture where they DISAGREE, they differ, in exactly one direction
 *    and by exactly the claim that disagrees. That fixture is what the real
 *    view cannot produce, and `tests/live/claims.live.test.ts` is where that
 *    claim about the real view is checked against staging rather than argued.
 *
 * The reference shape below is the pre-TASK-0074 code, kept here rather than
 * in `src/`: a fallback in the product is how a page keeps a cost nobody can
 * see (ARCHITECTURE.md §6 trap 12), but a comparand in a test is how a
 * replacement stays honest.
 */
describe("the windowed claims leg against the id-list join it replaced", () => {
  const SINCE = "2026-06-03T12:00:00.000Z";

  /** The shape this gauge had before the collapse — the comparand, not a fallback. */
  async function idListJoin(db: ReturnType<typeof stubClient>) {
    const bounds = resolveBounds({ now: NOW }, PENDING_CLAIMS_DEFAULTS);
    const client = db.asSupabaseClient();
    const observations = await readPendingObservations(bounds, {}, client);
    if (observations.kind !== "ok") return observations;
    const claims = await readPendingClaimRows(
      idsOf(observations.data, (row) => row.observation_id),
      client,
    );
    if (claims.kind !== "ok") return claims;
    return {
      kind: "ok" as const,
      data: {
        claims: claims.data,
        observations: observations.data,
        window: windowOf(bounds, observations.data.length, T.observations),
        filter: {},
      },
    };
  }

  /**
   * A fixture database: the scan answers with the rows it is given, and the
   * view answers the QUERY it was asked — `.gte`, `.neq`, `.in`, `.order`,
   * `.limit` and the projection, the way PostgREST would (`claimView`,
   * ../claims/population). Both shapes read the same one.
   */
  function fixture(
    claimRows: ReturnType<typeof pendingClaimRow>[],
    observationRows: ReturnType<typeof observationRow>[],
  ) {
    return stubClient({
      [T.observations]: { data: observationRows },
      [T.pendingClaims]: claimView(claimRows),
    });
  }

  const INSIDE = ["2026-08-01T00:00:00Z", "2026-08-15T00:00:00Z", "2026-08-20T00:00:00Z"];

  /** Three claims, each instant carried through the view unchanged. */
  function agreeing() {
    const claimRows = [
      pendingClaimRow("standing_disagreement", {
        observation_id: "01920000-0000-7000-8000-000000000b01",
        source_id: SOURCE_A,
        observed_at: INSIDE[0],
      }),
      pendingClaimRow("awaiting_row", {
        observation_id: "01920000-0000-7000-8000-000000000b02",
        source_id: SOURCE_B,
        observed_at: INSIDE[1],
      }),
      // The parked bucket, which neither shape may ever return.
      pendingClaimRow("in_window", {
        observation_id: "01920000-0000-7000-8000-000000000b03",
        source_id: SOURCE_B,
        observed_at: INSIDE[2],
      }),
      pendingClaimRow("agreeing", {
        observation_id: "01920000-0000-7000-8000-000000000b04",
        source_id: SOURCE_A,
        observed_at: INSIDE[2],
      }),
    ];
    const observationRows = claimRows.map((claim) =>
      observationRow({
        observation_id: claim.observation_id,
        source_id: claim.source_id,
        domain: claim.domain,
        observed_at: claim.observed_at as string,
        status: "pending",
      }),
    );
    // A pending observation the view holds NO claim for — a claim in no bucket
    // at all (`where classified.bucket is not null`). Both shapes must ignore
    // it, and it is why the scan's row count is not the claim count.
    observationRows.push(
      observationRow({
        observation_id: "01920000-0000-7000-8000-000000000b05",
        source_id: SOURCE_A,
        observed_at: "2026-08-02T00:00:00Z",
        status: "pending",
      }),
    );
    return { claimRows, observationRows };
  }

  it("produces the same aggregate, figure for figure, where the instants agree", async () => {
    const { claimRows, observationRows } = agreeing();
    const windowed = await fetchPendingClaims({ now: NOW }, fixture(claimRows, observationRows).asSupabaseClient());
    const joined = await idListJoin(fixture(claimRows, observationRows));

    expect(windowed.kind).toBe("ok");
    expect(joined.kind).toBe("ok");
    if (windowed.kind !== "ok" || joined.kind !== "ok") return;

    // The claim SET first, so a failure says which claim moved…
    expect(windowed.data.claims.map((claim) => claim.observation_id)).toEqual(
      joined.data.claims.map((claim) => claim.observation_id),
    );
    // …then every figure the page renders off it.
    expect(aggregate(windowed.data)).toEqual(aggregate(joined.data));
    // Non-vacuous: the fixture really holds claims, and the parked one is in
    // neither answer.
    expect(aggregate(windowed.data).claims).toBe(3);
    expect(JSON.stringify(windowed.data.claims)).not.toContain("in_window");
  });

  it("keeps a claim out when the scan did not return its observation, exactly as the id list did", async () => {
    // The truncation shape: a claim of the window whose observation is not
    // among the rows the scan came back with. The id list could not ask for
    // it; the windowed read is intersected with the scan's ids so that it does
    // not return it either — and no claim is ever counted whose age nothing in
    // hand can state.
    const { claimRows, observationRows } = agreeing();
    const unscanned = pendingClaimRow("escalated", {
      observation_id: "01920000-0000-7000-8000-000000000b06",
      source_id: SOURCE_B,
      observed_at: INSIDE[1],
    });
    const withUnscanned = [...claimRows, unscanned];

    const windowed = await fetchPendingClaims({ now: NOW }, fixture(withUnscanned, observationRows).asSupabaseClient());
    const joined = await idListJoin(fixture(withUnscanned, observationRows));
    if (windowed.kind !== "ok" || joined.kind !== "ok") throw new Error("both shapes read ok");

    expect(windowed.data.claims.map((claim) => claim.observation_id)).toEqual(
      joined.data.claims.map((claim) => claim.observation_id),
    );
    expect(aggregate(windowed.data)).toEqual(aggregate(joined.data));
    expect(
      windowed.data.claims.some((claim) => claim.observation_id === unscanned.observation_id),
    ).toBe(false);
  });

  it("differs by exactly the claim whose own instant sits outside the window its observation is inside", async () => {
    // THE FIXTURE THE COLLAPSE COULD BE WRONG ON, and the reason the live test
    // exists: a view row whose `observed_at` disagrees with the observation's.
    // The real view cannot produce one — its `observed_at` IS
    // `observations.observed_at`, selected from the same CTE row — so this is
    // a database that does not exist, written down so that the difference the
    // collapse would make is a measured fact rather than a hope.
    const { claimRows, observationRows } = agreeing();
    const drifted = pendingClaimRow("standing_disagreement", {
      observation_id: "01920000-0000-7000-8000-000000000b07",
      source_id: SOURCE_A,
      // Outside the 90-day window…
      observed_at: "2026-05-01T00:00:00Z",
    });
    // …while its observation is inside it, so the scan returns the id.
    const observed = observationRow({
      observation_id: drifted.observation_id,
      source_id: SOURCE_A,
      observed_at: "2026-08-05T00:00:00Z",
      status: "pending",
    });
    const claimsWithDrift = [...claimRows, drifted];
    const observationsWithDrift = [...observationRows, observed];

    const windowed = await fetchPendingClaims(
      { now: NOW },
      fixture(claimsWithDrift, observationsWithDrift).asSupabaseClient(),
    );
    const joined = await idListJoin(fixture(claimsWithDrift, observationsWithDrift));
    if (windowed.kind !== "ok" || joined.kind !== "ok") throw new Error("both shapes read ok");

    const inJoined = joined.data.claims.map((claim) => claim.observation_id);
    const inWindowed = windowed.data.claims.map((claim) => claim.observation_id);
    expect(inJoined).toContain(drifted.observation_id);
    expect(inWindowed).not.toContain(drifted.observation_id);
    // …and in NOTHING else: the two sets differ by that one claim.
    expect(inJoined.filter((id) => !inWindowed.includes(id))).toEqual([
      drifted.observation_id,
    ]);
    expect(inWindowed.filter((id) => !inJoined.includes(id))).toEqual([]);
    expect(aggregate(windowed.data).claims).toBe(aggregate(joined.data).claims - 1);
  });

  /**
   * QA (admin-window/TASK-0074): THE REGIME THE PROOF ABOVE EXCLUDES.
   *
   * Both legs carry the SAME cap (`GAUGE_ROW_CAP`, 1000) and the census says
   * staging holds 877 claims in the 90-day window, so the truncated regime is
   * ~14% of growth away. The two legs do not truncate the same way:
   *
   *  - the claims leg orders `observed_at asc, observation_id asc` — a TOTAL
   *    order, which is exactly what its own test above asserts, "so which
   *    claims are inside a truncated window is decided by the database and not
   *    by a tie";
   *  - the `observations` scan it must agree with orders by `observed_at`
   *    ALONE (`readPendingObservations`, src/lib/db/gauges.ts), so at the cap
   *    Postgres returns an ARBITRARY subset of the rows tied on the boundary
   *    instant.
   *
   * Below, the scan came back with the tie subset {c02, c03, c04} and the
   * claims leg — ordered totally — took {c01, c02, c03}. The intersection is
   * {c02, c03}: the id-list join returned all three claims the scan asked
   * about, the windowed shape returns two of them.
   */
  it.fails(
    "PIN admin-window/BUG-0167: at the cap, a tie on the boundary instant costs claims the id list kept",
    async () => {
      const TIED = "2026-08-01T00:00:00Z";
      const ids = [
        "01920000-0000-7000-8000-000000000c01",
        "01920000-0000-7000-8000-000000000c02",
        "01920000-0000-7000-8000-000000000c03",
        "01920000-0000-7000-8000-000000000c04",
      ];
      const claimRows = ids.map((observation_id) =>
        pendingClaimRow("standing_disagreement", {
          observation_id,
          source_id: SOURCE_A,
          observed_at: TIED,
        }),
      );
      // What `order by observed_at limit 3` may legally hand back over four
      // rows of one instant: any three of them.
      const scanned = ids.slice(1).map((observation_id) =>
        observationRow({ observation_id, source_id: SOURCE_A, observed_at: TIED, status: "pending" }),
      );

      const bounds = { now: NOW, days: 90, limit: 3 } as const;
      const windowed = await fetchPendingClaims(
        bounds,
        stubClient({
          [T.observations]: { data: scanned },
          [T.pendingClaims]: claimView(claimRows),
        }).asSupabaseClient(),
      );

      const joinDb = stubClient({
        [T.observations]: { data: scanned },
        [T.pendingClaims]: claimView(claimRows),
      }).asSupabaseClient();
      const scan = await readPendingObservations(
        resolveBounds(bounds, PENDING_CLAIMS_DEFAULTS),
        {},
        joinDb,
      );
      if (scan.kind !== "ok") throw new Error("the scan reads ok");
      const joined = await readPendingClaimRows(
        idsOf(scan.data, (row) => row.observation_id),
        joinDb,
      );
      if (joined.kind !== "ok" || windowed.kind !== "ok") throw new Error("both shapes read ok");

      // The id list returned every claim the scan asked about…
      expect(joined.data.map((claim) => claim.observation_id)).toEqual(ids.slice(1));
      // …and this is the identity the collapse rests on. It does not hold here.
      expect(windowed.data.claims.map((claim) => claim.observation_id)).toEqual(
        joined.data.map((claim) => claim.observation_id),
      );
    },
  );

  it("windows the claims read on the bound the scan carries, and on the view's own column", async () => {
    const { claimRows, observationRows } = agreeing();
    const stub = fixture(claimRows, observationRows);
    await fetchPendingClaims({ now: NOW }, stub.asSupabaseClient());
    for (const call of stub.calls) {
      expect(
        call.steps.find((step) => step.method === "gte")?.args,
        call.table,
      ).toEqual(["observed_at", SINCE]);
    }
  });
});

/* ── refusals, once the legs are concurrent ──────────────────────────────── */

/**
 * A refusal may not depend on which request happened to land first, and it may
 * never become a partial answer (FEAT-0014's one way this can be wrong;
 * LESSONS 10, common violations row 19).
 */
describe("a refusal from either leg", () => {
  const both = () =>
    stubClient({
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
    });

  it("is the OBSERVATIONS one when both legs refuse — pinned, not raced", async () => {
    // The answer the sequential shape gave, because the scan was the read that
    // had already happened. Ten runs, so a race would have to be lucky ten
    // times to hide.
    for (let run = 0; run < 10; run += 1) {
      await expect(fetchPendingClaims({ now: NOW }, both().asSupabaseClient())).resolves.toEqual({
        kind: "not_provisioned",
        missing: T.observations,
      });
    }
  });

  it("is the observations one when both legs fail for an arbitrary reason", async () => {
    const stub = stubClient({
      [T.observations]: { error: permissionDenied(T.observations) },
      [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
    });
    const result = await fetchPendingClaims({ now: NOW }, stub.asSupabaseClient());
    expect(result).toMatchObject({ kind: "error", reading: T.observations });
  });

  it("is never a half-filled gauge and never a zero", async () => {
    // The view absent while the scan is healthy: the gauge refuses NAMING the
    // view. An `ok` carrying no claims here would render five zero buckets
    // over a database that never answered — a figure of exactly the kind
    // `gauge.ts` refuses to invent.
    const stub = stubClient({
      [T.observations]: { data: observations() },
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
    });
    const result = await fetchPendingClaims({ now: NOW }, stub.asSupabaseClient());
    expect(result).toEqual({ kind: "not_provisioned", missing: T.pendingClaims });
    expect(result.kind === "ok").toBe(false);

    // …and the same through both façades, so no caller can turn it into rows.
    await expect(readPendingClaims({ now: NOW }, stubClient({
      [T.observations]: { data: observations() },
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
    }).asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.pendingClaims,
    });
    await expect(readAwaitingRowTrend({ now: NOW }, stubClient({
      [T.observations]: { data: observations() },
      [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
    }).asSupabaseClient())).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.pendingClaims,
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
      window: { ...WINDOW, since: "2026-08-29T12:00:00.000Z" },
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
