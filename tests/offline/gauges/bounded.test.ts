import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbResult } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import { fetchCycleHealth } from "@/lib/gauges/cycle-health";
import { fetchPendingClaims } from "@/lib/gauges/pending-claims";
import { fetchQueueHealth } from "@/lib/gauges/queue-health";
import { fetchResolutionLatency } from "@/lib/gauges/resolution-latency";
import { fetchRejectionStamps } from "@/lib/gauges/settled-values";
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
