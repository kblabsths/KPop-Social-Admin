import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbResult } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import type { WindowInfo } from "@/lib/gauges/gauge";
import { fetchCycleHealth, CYCLE_HEALTH_DEFAULTS } from "@/lib/gauges/cycle-health";
import { fetchPendingClaims, PENDING_CLAIMS_DEFAULTS } from "@/lib/gauges/pending-claims";
import { fetchQueueHealth, QUEUE_HEALTH_DEFAULTS } from "@/lib/gauges/queue-health";
import {
  fetchResolutionLatency,
  RESOLUTION_LATENCY_DEFAULTS,
} from "@/lib/gauges/resolution-latency";
import { fetchRejectionStamps, REJECTION_STAMP_DEFAULTS } from "@/lib/gauges/settled-values";
import { fetchStandingDisagreements } from "@/lib/gauges/standing-disagreements";
import {
  fieldProvenanceRow,
  observationRow,
  pendingClaimRow,
  resolutionRunRow,
  reviewItemDataConflict,
  sourceRow,
} from "../../fixtures/rows";
import { stubClient, tableNotInSchemaCache } from "../../fixtures/stub-client";

/**
 * The properties acceptance test 11 / M1 EC8 assert about the gauges AS A SET
 * (campaign admin-window/TASK-0007), rather than six times over by hand:
 *
 *  - six modules, one per row of spec §5;
 *  - **every gauge query is bounded** — an explicit cap, and either an explicit
 *    time window or an id set from the previous leg (ARCHITECTURE.md §8: "an
 *    unbounded fetch is a defect");
 *  - a gauge whose backing object is absent reports `not_provisioned` naming
 *    that object, and nothing throws (acceptance test 9);
 *  - no migration, no view, no RPC and no SQL string is added by this module.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const gaugeDir = path.join(repoRoot, "src", "lib", "gauges");

/** One module per row of spec §5's table of six. */
const GAUGE_MODULES = [
  "cycle-health.ts",
  "resolution-latency.ts",
  "pending-claims.ts",
  "queue-health.ts",
  "standing-disagreements.ts",
  "settled-values.ts",
];

const NOW = "2026-09-01T12:00:00.000Z";

/** A stub answering every table a gauge may touch with one plausible row. */
function fullStub() {
  return stubClient({
    [T.resolutionRuns]: { data: [resolutionRunRow()] },
    [T.fieldProvenance]: { data: [fieldProvenanceRow()] },
    [T.observations]: {
      data: [
        observationRow({
          status: "rejected",
          rejected_at: "2026-08-31T06:00:00Z",
          rejected_by: "resolver",
        }),
      ],
    },
    [T.pendingClaims]: { data: [pendingClaimRow("standing_disagreement")] },
    [T.reviewItems]: { data: [reviewItemDataConflict()] },
    [T.sources]: { data: [sourceRow()] },
  });
}

/** The six fetches, by the gauge they belong to. */
const FETCHES: Record<
  string,
  (db: SupabaseClient) => Promise<DbResult<unknown>>
> = {
  "cycle health": (db) => fetchCycleHealth({ now: NOW }, db),
  "resolution latency": (db) => fetchResolutionLatency({ now: NOW }, db),
  "pending claims": (db) => fetchPendingClaims({ now: NOW }, db),
  "queue health": (db) => fetchQueueHealth({ now: NOW }, db),
  "standing disagreements": (db) => fetchStandingDisagreements({ now: NOW }, db),
  "settled values": (db) => fetchRejectionStamps({ now: NOW }, db),
};

/** The table each gauge's FIRST query reads — the one whose absence it reports. */
const FIRST_TABLE: Record<string, string> = {
  "cycle health": T.resolutionRuns,
  "resolution latency": T.fieldProvenance,
  "pending claims": T.observations,
  "queue health": T.reviewItems,
  "standing disagreements": T.observations,
  "settled values": T.observations,
};

function gaugeSource(): { file: string; text: string }[] {
  return fs
    .readdirSync(gaugeDir)
    .filter((name) => name.endsWith(".ts"))
    .map((file) => ({ file, text: fs.readFileSync(path.join(gaugeDir, file), "utf8") }));
}

/** Lines that are code, not commentary — the same filter the layering test uses. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("/*")
    );
  });
}

describe("the module set", () => {
  it("is one file per row of spec §5's table of six", () => {
    for (const gaugeFile of GAUGE_MODULES) {
      expect(fs.existsSync(path.join(gaugeDir, gaugeFile)), gaugeFile).toBe(true);
    }
    expect(Object.keys(FETCHES)).toHaveLength(6);
  });

  it("adds no migration to this repo", () => {
    // M1's exit criterion is zero schema: the two app-owned files and nothing
    // more. The catalog's schema is the scraper repo's.
    const migrations = fs.readdirSync(path.join(repoRoot, "supabase", "migrations"));
    expect(migrations).toHaveLength(2);
  });

  it("builds no view, no RPC and no SQL string", () => {
    for (const { file, text } of gaugeSource()) {
      const code = codeLines(text).join("\n");
      expect(code, file).not.toContain(".rpc(");
      expect(code.toLowerCase(), file).not.toContain("create view");
      expect(code.toLowerCase(), file).not.toContain("percentile_cont");
      expect(code.toLowerCase(), file).not.toContain(" from public.");
    }
  });

  it("uses no count query, so no gauge can render a fabricated zero", () => {
    // `readCount` returns `count ?? 0` (admin-window, relayed on TASK-0003):
    // a count read that failed to produce a count would render as a real 0.
    // The gauges fetch rows and count them in TypeScript instead.
    for (const { file, text } of gaugeSource()) {
      expect(codeLines(text).join("\n"), file).not.toContain("readCount");
    }
  });
});

describe("every gauge query", () => {
  for (const [gauge, fetchGauge] of Object.entries(FETCHES)) {
    it(`is bounded — ${gauge}`, async () => {
      const stub = fullStub();
      const result = await fetchGauge(stub.asSupabaseClient());
      expect(result.kind, gauge).toBe("ok");
      expect(stub.calls.length, gauge).toBeGreaterThan(0);

      for (const call of stub.calls) {
        const methods = call.steps.map((step) => step.method);
        const limit = call.steps.find((step) => step.method === "limit");

        // An explicit cap on every single query.
        expect(limit, `${gauge} → ${call.table} has no limit`).toBeDefined();
        const cap = limit?.args[0] as number;
        expect(Number.isFinite(cap), `${gauge} → ${call.table} limit`).toBe(true);
        expect(cap, `${gauge} → ${call.table} limit`).toBeGreaterThan(0);

        // …and a cap the SERVER will honour. Above `db-max-rows` PostgREST
        // truncates first and says nothing, so `rowCount >= limit` can never
        // fire and the window reports a floor as a total
        // (admin-window/BUG-0009). `PLATFORM_ROW_CAP` is declared below.
        expect(
          cap,
          `${gauge} → ${call.table} asks for more rows than the server returns`,
        ).toBeLessThanOrEqual(PLATFORM_ROW_CAP);

        // …and a window: a time bound on a scan, or the previous leg's id set
        // on a lookup. Neither means the query could walk the whole table.
        expect(
          methods.includes("gte") || methods.includes("in"),
          `${gauge} → ${call.table} is neither windowed nor id-bounded`,
        ).toBe(true);
      }
    });
  }
});

describe("every gauge against a database that lacks its tables", () => {
  for (const [gauge, fetchGauge] of Object.entries(FETCHES)) {
    it(`reports not_provisioned naming the object, and does not throw — ${gauge}`, async () => {
      const missing = FIRST_TABLE[gauge];
      const stub = stubClient({ [missing]: { error: tableNotInSchemaCache(missing) } });
      await expect(fetchGauge(stub.asSupabaseClient())).resolves.toEqual({
        kind: "not_provisioned",
        missing,
      });
    });
  }
});

describe("every gauge against an empty database", () => {
  for (const [gauge, fetchGauge] of Object.entries(FETCHES)) {
    it(`returns ok with no rows rather than an error — ${gauge}`, async () => {
      const stub = stubClient({
        [T.resolutionRuns]: { data: [] },
        [T.fieldProvenance]: { data: [] },
        [T.observations]: { data: [] },
        [T.pendingClaims]: { data: [] },
        [T.reviewItems]: { data: [] },
        [T.sources]: { data: [] },
      });
      const result = await fetchGauge(stub.asSupabaseClient());
      expect(result.kind, gauge).toBe("ok");
    });
  }
});

/* ── the cap the platform enforces, whatever the query asked for ─────────── */

/**
 * PostgREST refuses to return more rows than its `db-max-rows`, and says
 * nothing about having done so — ARCHITECTURE.md §4.3, which fixes Supabase's
 * default at 1000 and sets the app's own `ROW_CAP` to the same figure "so the
 * app never silently fights the platform cap".
 *
 * A gauge's `limit` is therefore only its real cap while it is at or under
 * this figure. Above it, the server truncates first, hands back exactly this
 * many rows, and `rowCount >= bounds.limit` is false — so `window.truncated`
 * stays `false` and every count in the aggregate is presented as a total when
 * it is a floor. That is the one thing `WindowInfo.truncated` exists to
 * prevent (`gauge.ts`: "Every count in the aggregate is then a FLOOR, not a
 * total — the card must say so").
 */
const PLATFORM_ROW_CAP = 1000;

/** As many rows as the server is willing to hand this gauge back. */
function rowsTheServerWillGive(requestedLimit: number): number {
  return Math.min(requestedLimit, PLATFORM_ROW_CAP);
}

function repeat<Row>(count: number, build: (index: number) => Row): Row[] {
  return Array.from({ length: count }, (_unused, index) => build(index));
}

/**
 * Each gauge's scanning read, its declared default cap, and how to reach the
 * window its result carries. The scan is the read whose truncation decides
 * whether the gauge's counts are totals or floors.
 */
const SCANS: {
  gauge: string;
  limit: number;
  fill: (rows: number) => Record<string, { data: unknown }>;
  run: (db: SupabaseClient) => Promise<DbResult<unknown>>;
  windowOf: (data: unknown) => WindowInfo;
}[] = [
  {
    gauge: "cycle health",
    limit: CYCLE_HEALTH_DEFAULTS.limit,
    fill: (rows) => ({
      [T.resolutionRuns]: { data: repeat(rows, (i) => resolutionRunRow({ run_id: `run-${i}` })) },
    }),
    run: (db) => fetchCycleHealth({ now: NOW }, db),
    windowOf: (data) => (data as { window: WindowInfo }).window,
  },
  {
    gauge: "resolution latency",
    limit: RESOLUTION_LATENCY_DEFAULTS.limit,
    fill: (rows) => ({
      [T.fieldProvenance]: {
        data: repeat(rows, (i) =>
          fieldProvenanceRow({ provenance_id: `prov-${i}`, observation_id: `obs-${i}` }),
        ),
      },
      [T.observations]: { data: [] },
    }),
    run: (db) => fetchResolutionLatency({ now: NOW }, db),
    windowOf: (data) => (data as { window: WindowInfo }).window,
  },
  {
    gauge: "pending claims",
    limit: PENDING_CLAIMS_DEFAULTS.limit,
    fill: (rows) => ({
      [T.observations]: {
        data: repeat(rows, (i) =>
          observationRow({ observation_id: `obs-${i}`, status: "pending" }),
        ),
      },
      [T.pendingClaims]: { data: [] },
    }),
    run: (db) => fetchPendingClaims({ now: NOW }, db),
    windowOf: (data) => (data as { window: WindowInfo }).window,
  },
  {
    gauge: "queue health",
    limit: QUEUE_HEALTH_DEFAULTS.limit,
    fill: (rows) => ({
      [T.reviewItems]: {
        data: repeat(rows, (i) => reviewItemDataConflict({ review_item_id: `item-${i}` })),
      },
    }),
    run: (db) => fetchQueueHealth({ now: NOW }, db),
    windowOf: (data) => (data as { window: WindowInfo }).window,
  },
  {
    gauge: "standing disagreements",
    limit: PENDING_CLAIMS_DEFAULTS.limit,
    fill: (rows) => ({
      [T.observations]: {
        data: repeat(rows, (i) =>
          observationRow({ observation_id: `obs-${i}`, status: "pending" }),
        ),
      },
      [T.pendingClaims]: { data: [] },
      [T.sources]: { data: [] },
    }),
    run: (db) => fetchStandingDisagreements({ now: NOW }, db),
    windowOf: (data) => (data as { claims: { window: WindowInfo } }).claims.window,
  },
  {
    gauge: "settled values",
    limit: REJECTION_STAMP_DEFAULTS.limit,
    fill: (rows) => ({
      [T.observations]: {
        data: repeat(rows, (i) =>
          observationRow({
            observation_id: `obs-${i}`,
            status: "rejected",
            rejected_at: "2026-08-25T06:00:00Z",
            rejected_by: "resolver",
          }),
        ),
      },
      [T.sources]: { data: [] },
    }),
    run: (db) => fetchRejectionStamps({ now: NOW }, db),
    windowOf: (data) => (data as { window: WindowInfo }).window,
  },
];

describe("a gauge read the server truncated at its own cap", () => {
  for (const scan of SCANS) {
    it(`says so, so its counts are read as a floor — ${scan.gauge}`, async () => {
      const handedBack = rowsTheServerWillGive(scan.limit);
      const stub = stubClient(scan.fill(handedBack) as Record<string, { data: unknown }>);
      const result = await scan.run(stub.asSupabaseClient());
      expect(result.kind, scan.gauge).toBe("ok");
      if (result.kind !== "ok") return;

      const window = scan.windowOf(result.data);
      expect(
        window.truncated,
        `${scan.gauge}: asked for ${scan.limit}, the server gave ${handedBack} — ` +
          "more rows may exist unseen, so every count is a floor",
      ).toBe(true);
    });
  }
});

describe("a gauge asked for more rows than the platform will return", () => {
  it("is not possible: every declared default cap is at or under the cap", () => {
    // The defect admin-window/BUG-0009 recorded, as a property: five of six
    // gauges declared 2000 or 5000 and the sixth 800, so the five could never
    // observe their own truncation. Read off the DEFAULTS the gauges export,
    // so lowering the number in a test cannot make this pass.
    for (const scan of SCANS) {
      expect(scan.limit, `${scan.gauge} default limit`).toBeLessThanOrEqual(PLATFORM_ROW_CAP);
    }
    expect(CYCLE_HEALTH_DEFAULTS.limit).toBeLessThanOrEqual(PLATFORM_ROW_CAP);
  });

  it("is not possible for a caller either: an oversized limit is clamped", async () => {
    // A page passing its own limit must not be able to reintroduce the defect.
    const asked = PLATFORM_ROW_CAP * 50;
    const stub = stubClient({
      [T.reviewItems]: {
        data: repeat(PLATFORM_ROW_CAP, (i) =>
          reviewItemDataConflict({ review_item_id: `item-${i}` }),
        ),
      },
    });
    const result = await fetchQueueHealth({ now: NOW, limit: asked }, stub.asSupabaseClient());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const limitStep = stub.calls[0].steps.find((step) => step.method === "limit");
    expect(limitStep?.args).toEqual([PLATFORM_ROW_CAP]);

    const { window } = result.data as { window: WindowInfo };
    expect(window.limit).toBe(PLATFORM_ROW_CAP);
    expect(window.truncated).toBe(true);
  });
});

/**
 * The negative twin of "a gauge read the server truncated at its own cap"
 * (campaign admin-window/BUG-0009, QA re-check). Clamping every scan to the
 * platform cap made truncation DECIDABLE; it must not have made it
 * unconditional. A read that stopped one row under the cap saw its whole
 * window, and a card that caveats it as a floor is as wrong as one that
 * presents a floor as a total.
 */
describe("a gauge read that stopped one row under the cap", () => {
  for (const scan of SCANS) {
    it(`is not a floor, so its counts are read as totals — ${scan.gauge}`, async () => {
      const handedBack = rowsTheServerWillGive(scan.limit) - 1;
      const stub = stubClient(scan.fill(handedBack) as Record<string, { data: unknown }>);
      const result = await scan.run(stub.asSupabaseClient());
      expect(result.kind, scan.gauge).toBe("ok");
      if (result.kind !== "ok") return;

      const window = scan.windowOf(result.data);
      expect(
        window.truncated,
        `${scan.gauge}: the server gave ${handedBack} of the ${window.limit} asked for — ` +
          "the window was read whole, so nothing is a floor",
      ).toBe(false);
      expect(window.limit, `${scan.gauge} window limit`).toBeLessThanOrEqual(PLATFORM_ROW_CAP);
    });
  }
});

/**
 * The second leg of a two-step join is bounded by its OWN id list, not by the
 * scan's cap (ARCHITECTURE.md §4.2, `ID_CHUNK`). `every gauge query is bounded`
 * above only asks that each leg sit under the platform cap, which a leg asking
 * for 1000 rows over 100 ids passes while silently dropping rows for a
 * one-to-many key. This asserts the tighter property the join actually needs:
 * a leg may never ask for more rows than the ids it filtered on, at any scan
 * size — including a first leg that came back full.
 */
describe("the second leg of every join", () => {
  const FULL = PLATFORM_ROW_CAP;

  const JOINS: { gauge: string; run: (db: SupabaseClient) => Promise<DbResult<unknown>> }[] = [
    {
      gauge: "resolution latency",
      run: (db) => fetchResolutionLatency({ now: NOW }, db),
    },
    { gauge: "pending claims", run: (db) => fetchPendingClaims({ now: NOW }, db) },
    {
      gauge: "standing disagreements",
      run: (db) => fetchStandingDisagreements({ now: NOW }, db),
    },
    { gauge: "settled values", run: (db) => fetchRejectionStamps({ now: NOW }, db) },
  ];

  /** Every scannable table filled to the cap with DISTINCT join keys. */
  function distinctKeyStub() {
    return stubClient({
      [T.fieldProvenance]: {
        data: repeat(FULL, (i) =>
          fieldProvenanceRow({ provenance_id: `prov-${i}`, observation_id: `obs-${i}` }),
        ),
      },
      [T.observations]: {
        data: repeat(FULL, (i) =>
          observationRow({
            observation_id: `obs-${i}`,
            source_id: `src-${i}`,
            status: "pending",
            rejected_at: "2026-08-25T06:00:00Z",
            rejected_by: "resolver",
          }),
        ),
      },
      [T.pendingClaims]: {
        data: repeat(FULL, (i) =>
          pendingClaimRow("standing_disagreement", { observation_id: `obs-${i}` }),
        ),
      },
      [T.sources]: { data: repeat(FULL, (i) => sourceRow({ source_id: `src-${i}` })) },
    });
  }

  for (const join of JOINS) {
    it(`asks for no more rows than the ids it filtered on — ${join.gauge}`, async () => {
      const stub = distinctKeyStub();
      const result = await join.run(stub.asSupabaseClient());
      expect(result.kind, join.gauge).toBe("ok");

      const legs = stub.calls.filter((call) =>
        call.steps.some((step) => step.method === "in"),
      );
      expect(legs.length, `${join.gauge}: expected at least one id-set leg`).toBeGreaterThan(0);

      for (const leg of legs) {
        const inStep = leg.steps.find((step) => step.method === "in");
        const ids = inStep?.args[1] as unknown[];
        const limitArg = leg.steps.find((step) => step.method === "limit")?.args[0] as number;
        expect(Array.isArray(ids), `${join.gauge}: ${leg.table} leg filtered on an id list`).toBe(
          true,
        );
        expect(
          limitArg,
          `${join.gauge}: the ${leg.table} leg filtered on ${ids.length} ids but asked for ` +
            `${limitArg} rows — anything above the id count is a row set nothing bounds`,
        ).toBeLessThanOrEqual(ids.length);
      }
    });
  }
});
