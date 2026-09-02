import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RESOLVER_CADENCE_SECONDS,
  groupBy,
  idsOf,
  indexBy,
  mapOk,
  percentile,
  rate,
  resolveBounds,
  secondsBetween,
  spread,
  spreadOfDurations,
  utcDay,
  utcDaysBetween,
  utcWeekStart,
  utcWeeksBetween,
  windowOf,
} from "@/lib/gauges/gauge";
import { chunk, readRowsByIds } from "@/lib/db/gauges";
import type { DbResponse } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
} from "../../fixtures/stub-client";

/**
 * The shared gauge machinery (campaign admin-window/TASK-0007).
 *
 * Two properties everything else in `src/lib/gauges` rests on:
 *  - a fetch is BOUNDED — `resolveBounds` always yields a window and a cap,
 *    whatever the caller passed, including nothing and including junk;
 *  - a figure that cannot be computed is `null`, never `0`.
 */

const NOW = "2026-09-01T12:00:00.000Z";

interface Named {
  source_id: string;
}

/** A minimal `.in(...)` read through the stub, typed as the data layer sees it. */
function sourcesByIds(db: SupabaseClient, ids: string[]) {
  return db
    .from(T.sources)
    .select("source_id")
    .in("source_id", ids)
    .limit(ids.length) as unknown as PromiseLike<DbResponse<Named[]>>;
}

describe("resolveBounds", () => {
  const defaults = { days: 7, limit: 500 };

  it("windows and caps a call that asked for nothing", () => {
    const bounds = resolveBounds({ now: NOW }, defaults);
    expect(bounds.until).toBe(NOW);
    expect(bounds.since).toBe("2026-08-25T12:00:00.000Z");
    expect(bounds.limit).toBe(500);
  });

  it("honours an explicit day count and limit", () => {
    const bounds = resolveBounds({ now: NOW, days: 2, limit: 10 }, defaults);
    expect(bounds.since).toBe("2026-08-30T12:00:00.000Z");
    expect(bounds.limit).toBe(10);
  });

  it("lets an explicit since override the day count", () => {
    const bounds = resolveBounds(
      { now: NOW, days: 2, since: "2026-01-01T00:00:00Z" },
      defaults,
    );
    expect(bounds.since).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to the default rather than producing an unbounded query", () => {
    // `limit: 0`, a negative day count and an unparseable `since` are exactly
    // the inputs that would turn a bounded fetch into a table scan.
    for (const options of [
      { now: NOW, limit: 0 },
      { now: NOW, limit: -5 },
      { now: NOW, limit: Number.NaN },
    ]) {
      expect(resolveBounds(options, defaults).limit).toBe(500);
    }
    expect(resolveBounds({ now: NOW, days: -3 }, defaults).since).toBe(
      "2026-08-25T12:00:00.000Z",
    );
    expect(resolveBounds({ now: NOW, since: "not a date" }, defaults).since).toBe(
      "2026-08-25T12:00:00.000Z",
    );
  });

  it("falls back to the real clock when now is junk", () => {
    const bounds = resolveBounds({ now: "not a date" }, defaults);
    expect(Number.isNaN(Date.parse(bounds.until))).toBe(false);
  });
});

describe("windowOf", () => {
  const bounds = { since: "2026-08-25T12:00:00.000Z", until: NOW, limit: 3 };

  it("is not truncated below the cap", () => {
    expect(windowOf(bounds, 2).truncated).toBe(false);
  });

  it("is truncated at the cap, because more rows may exist unseen", () => {
    expect(windowOf(bounds, 3).truncated).toBe(true);
  });
});

describe("percentile", () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("reports a value that actually occurred (nearest rank, no interpolation)", () => {
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 90)).toBe(9);
    expect(percentile(ten, 95)).toBe(10);
    // Every reported figure is a member of the input — the property linear
    // interpolation would break.
    for (const p of [0, 1, 25, 50, 75, 90, 95, 99, 100]) {
      expect(ten).toContain(percentile(ten, p));
    }
  });

  it("is the single value for a single measurement", () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 99)).toBe(7);
  });

  it("says nothing rather than zero for an empty set", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("spread", () => {
  it("summarises measured values", () => {
    const summary = spread([3, 1, 2]);
    expect(summary).toMatchObject({
      count: 3,
      unmeasurable: 0,
      min: 1,
      max: 3,
      p50: 2,
    });
  });

  it("reports every figure as null when nothing was measurable", () => {
    const summary = spread([], 4);
    expect(summary.count).toBe(0);
    expect(summary.unmeasurable).toBe(4);
    for (const figure of [
      summary.min,
      summary.p50,
      summary.p90,
      summary.p95,
      summary.p99,
      summary.max,
    ]) {
      expect(figure).toBeNull();
    }
  });

  it("treats a non-finite value as unmeasurable rather than sorting it", () => {
    const summary = spread([1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(summary.count).toBe(2);
    expect(summary.unmeasurable).toBe(2);
    expect(summary.max).toBe(3);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    spread(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("counts a null duration as unmeasurable, never as zero", () => {
    const summary = spreadOfDurations([10, null, 20]);
    expect(summary.count).toBe(2);
    expect(summary.unmeasurable).toBe(1);
    expect(summary.min).toBe(10);
  });
});

describe("secondsBetween", () => {
  it("measures a finished duration", () => {
    expect(secondsBetween("2026-09-01T04:00:00Z", "2026-09-01T04:03:20Z")).toBe(200);
  });

  it("agrees across offset spellings, which sort differently as text", () => {
    expect(secondsBetween("2026-09-01T04:00:00+00:00", "2026-09-01T04:00:10Z")).toBe(10);
  });

  it("says nothing rather than zero when an end is missing or unparseable", () => {
    expect(secondsBetween("2026-09-01T04:00:00Z", null)).toBeNull();
    expect(secondsBetween(null, "2026-09-01T04:00:00Z")).toBeNull();
    expect(secondsBetween("2026-09-01T04:00:00Z", "whenever")).toBeNull();
  });

  it("surfaces a negative duration rather than clamping it", () => {
    expect(secondsBetween("2026-09-01T04:00:10Z", "2026-09-01T04:00:00Z")).toBe(-10);
  });
});

describe("rate", () => {
  it("is the ratio when there is a denominator", () => {
    expect(rate(1, 4)).toBe(0.25);
  });

  it("is null, not zero, when there is nothing to divide by", () => {
    expect(rate(0, 0)).toBeNull();
  });
});

describe("calendar helpers", () => {
  it("reads the UTC day", () => {
    expect(utcDay("2026-09-01T23:59:00Z")).toBe("2026-09-01");
    expect(utcDay(null)).toBeNull();
  });

  it("starts a week on Monday, including for a Sunday", () => {
    // 2026-08-31 is a Monday; 2026-09-06 the Sunday that closes its week.
    expect(utcWeekStart("2026-08-31T00:00:00Z")).toBe("2026-08-31");
    expect(utcWeekStart("2026-09-06T23:00:00Z")).toBe("2026-08-31");
    expect(utcWeekStart("2026-09-07T00:00:00Z")).toBe("2026-09-07");
  });

  it("enumerates the days and weeks of a window inclusively", () => {
    expect(utcDaysBetween("2026-08-30T06:00:00Z", "2026-09-01T12:00:00Z")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
    expect(utcWeeksBetween("2026-08-25T00:00:00Z", "2026-09-08T00:00:00Z")).toEqual([
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
    ]);
  });

  it("enumerates nothing for a backwards or unparseable window", () => {
    expect(utcDaysBetween("2026-09-02T00:00:00Z", "2026-09-01T00:00:00Z")).toEqual([]);
    expect(utcWeeksBetween("nope", "2026-09-01T00:00:00Z")).toEqual([]);
  });
});

describe("grouping helpers", () => {
  const rows = [
    { id: "a", group: "x" },
    { id: "b", group: "y" },
    { id: "c", group: "x" },
  ];

  it("groups in first-seen key order", () => {
    expect([...groupBy(rows, (r) => r.group).keys()]).toEqual(["x", "y"]);
    expect(groupBy(rows, (r) => r.group).get("x")?.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("collects unique non-empty ids in first-seen order", () => {
    expect(idsOf([...rows, { id: "a", group: "z" }], (r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(idsOf([{ id: null }, { id: "" }], (r) => r.id)).toEqual([]);
  });

  it("indexes by key", () => {
    expect(indexBy(rows, (r) => r.id).get("b")?.group).toBe("y");
  });
});

describe("mapOk", () => {
  it("maps an ok payload and passes every other state through untouched", () => {
    expect(mapOk({ kind: "ok" as const, data: 2 }, (n) => n * 3)).toEqual({
      kind: "ok",
      data: 6,
    });
    const absent = { kind: "not_provisioned" as const, missing: T.verdicts };
    expect(mapOk(absent, () => 1)).toBe(absent);
  });
});

describe("readRowsByIds", () => {
  it("runs no query at all for an empty id set", async () => {
    const stub = stubClient({});
    const result = await readRowsByIds<Named>(
      T.sources,
      [],
      sourcesByIds,
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: [] });
    expect(stub.calls).toHaveLength(0);
  });

  it("splits a large id set into bounded chunks and concatenates the rows", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const stub = stubClient({ [T.sources]: { data: [{ source_id: "s" }] } });
    const result = await readRowsByIds<Named>(
      T.sources,
      ids,
      sourcesByIds,
      stub.asSupabaseClient(),
    );
    expect(stub.calls).toHaveLength(3);
    // Every chunk is bounded: no request carries more than ID_CHUNK ids.
    for (const call of stub.calls) {
      const inStep = call.steps.find((step) => step.method === "in");
      expect((inStep?.args[1] as string[]).length).toBeLessThanOrEqual(100);
    }
    expect(result.kind === "ok" && result.data).toHaveLength(3);
  });

  it("returns the first non-ok result rather than a half-filled set", async () => {
    const stub = stubClient({
      [T.sources]: { error: tableNotInSchemaCache(T.sources) },
    });
    const result = await readRowsByIds<Named>(
      T.sources,
      ["a"],
      sourcesByIds,
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "not_provisioned", missing: T.sources });
  });

  it("carries an arbitrary failure through as the database's own words", async () => {
    const stub = stubClient({ [T.sources]: { error: permissionDenied(T.sources) } });
    const result = await readRowsByIds<Named>(
      T.sources,
      ["a"],
      sourcesByIds,
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({
      kind: "error",
      message: `permission denied for table ${T.sources}`,
    });
  });
});

describe("chunk", () => {
  it("splits into bounded pieces and keeps every item", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("the cadence constant", () => {
  it("is resolver.md §12's 15 minutes, in seconds", () => {
    expect(RESOLVER_CADENCE_SECONDS).toBe(900);
  });
});
