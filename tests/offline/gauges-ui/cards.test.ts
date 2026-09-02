import { describe, expect, it } from "vitest";

import {
  Distribution,
  GaugeCard,
  TrendTable,
  spreadRows,
  type GaugeState,
} from "@/components/gauges";
import {
  aggregateCycleHealth,
  type CycleHealthRows,
} from "@/lib/gauges/cycle-health";
import {
  aggregateQueueHealth,
  type QueueHealthRows,
  type QueueStats,
  type QueueWeek,
} from "@/lib/gauges/queue-health";
import type { WindowInfo } from "@/lib/gauges/gauge";
import { EM_DASH, duration } from "@/lib/format";

import {
  resolutionRunRow,
  reviewItemDataConflict,
  type ReviewItemRow,
} from "../../fixtures/rows";
import { classesOf, h, render, textOf } from "../ui/markup";

/**
 * The three gauge components (campaign admin-window/TASK-0008), rendered
 * against real `lib/gauges` aggregate output — the shape a page actually hands
 * them — with `react-dom/server`. No jsdom, no JSX, no charting dependency
 * (DECISIONS 2026-09-02: the offline glob is `*.test.ts`, so elements are
 * built with `createElement` and the assertions are on emitted markup).
 *
 * What is asserted is behaviour and tokens, never wording: a copy edit to a
 * label must not redden this file. The one text these tests do pin is text the
 * DATA supplies — a count, a duration, the name of the missing table — because
 * that is the gauge's whole job.
 */

const NOW = "2026-09-01T12:00:00.000Z";

function windowOfFixture(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    since: "2026-08-24T00:00:00.000Z",
    until: NOW,
    limit: 800,
    truncated: false,
    ...overrides,
  };
}

/** Two finished cycles — 200s and 1200s — so the spread has real percentiles. */
function cycleRows(overrides: Partial<WindowInfo> = {}): CycleHealthRows {
  return {
    rows: [
      resolutionRunRow({ facts_examined: 12_345 }),
      resolutionRunRow({
        run_id: "01920000-0000-7000-8000-0000000006a2",
        started_at: "2026-09-01T05:00:00Z",
        ended_at: "2026-09-01T05:20:00Z",
        outcome: "failed",
      }),
    ],
    window: windowOfFixture(overrides),
  };
}

/** One cycle still running: nothing in the window is measurable. */
function unfinishedCycleRows(): CycleHealthRows {
  return {
    rows: [resolutionRunRow({ ended_at: null, outcome: null })],
    window: windowOfFixture(),
  };
}

/**
 * 1,200 open `data_conflict` items in a window the platform truncated — the
 * shape that makes every count a floor. `entity_link` gets none, so its stats
 * are the unmeasurable side of the same aggregate.
 */
function queueRows(): QueueHealthRows {
  const items: ReviewItemRow[] = Array.from({ length: 1200 }, (_, index) =>
    reviewItemDataConflict({
      review_item_id: `01920000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      opened_at: "2026-08-26T06:00:00Z",
    }),
  );
  return { items, window: windowOfFixture({ limit: 1000, truncated: true }) };
}

const CYCLES = aggregateCycleHealth(cycleRows());
const UNMEASURED = aggregateCycleHealth(unfinishedCycleRows());
const QUEUES = aggregateQueueHealth(queueRows());
const CONFLICTS: QueueStats = QUEUES.queues[0];

const STATES: GaugeState[] = [
  { kind: "loading", what: "cycles" },
  { kind: "empty", holds: "cycles", filledBy: "the resolver files one each run" },
  {
    kind: "not_provisioned",
    missing: "resolution_runs",
    arrivesWith: "a scraper-repo migration",
  },
  {
    kind: "error",
    reading: "resolution_runs",
    failed: "permission denied for table",
    retry: "reload",
  },
];

/** The markup each component emits for each of the four states, by kind. */
function statesOf(renderState: (state: GaugeState) => string): Map<string, string> {
  return new Map(STATES.map((state) => [state.kind, renderState(state)]));
}

function card(props: Parameters<typeof GaugeCard>[0]): string {
  return render(h(GaugeCard, props));
}

function weekTable(state?: GaugeState): string {
  return render(
    h(TrendTable<QueueWeek>, {
      label: "opens and settles per week",
      period: "week",
      rows: CONFLICTS.weeks,
      rowKey: (week: QueueWeek) => week.weekStart,
      rowLabel: (week: QueueWeek) => week.weekStart,
      measures: [
        { key: "opened", label: "opened", value: (week: QueueWeek) => week.opened },
        { key: "settled", label: "settled", value: (week: QueueWeek) => week.settled },
      ],
      state,
    }),
  );
}

function ageDistribution(state?: GaugeState): string {
  return render(
    h(Distribution, {
      label: "cycle duration",
      dimension: "percentile",
      measure: "duration",
      rows: spreadRows(CYCLES.duration),
      format: duration,
      state,
    }),
  );
}

describe("the fixtures these components render", () => {
  it("are real aggregate output, with a measurable side and an unmeasurable one", () => {
    expect(CYCLES.factsExamined).toBe(12_757);
    expect(CYCLES.duration.p50).toBe(200);
    expect(CYCLES.duration.max).toBe(1200);
    expect(UNMEASURED.duration.p50).toBeNull();
    expect(UNMEASURED.duration.unmeasurable).toBe(1);
    expect(QUEUES.items).toBe(1200);
    expect(QUEUES.window.truncated).toBe(true);
    expect(CONFLICTS.weeks.some((week) => week.opened === 1200)).toBe(true);
    expect(CONFLICTS.weeks.every((week) => week.settled === null)).toBe(true);
    expect(QUEUES.queues[1].openAge.p50).toBeNull();
  });
});

describe("GaugeCard", () => {
  it("renders the aggregate's figure thousand-separated, in the card anatomy", () => {
    const html = card({ label: "facts examined", value: CYCLES.factsExamined });
    const classes = classesOf(html);
    expect(textOf(html)).toContain("12,757");
    expect(classes).toContain("type-micro");
    expect(classes).toContain("type-figure");
    // square, 1px border, surface fill, 12px padding — LOOK_AND_FEEL's anatomy
    expect(classes).toContain("border-hairline");
    expect(classes).toContain("bg-surface");
    expect(classes).toContain("p-3");
  });

  it("renders an unmeasurable figure as the dash with its reason, never as a zero", () => {
    const html = card({
      label: "median duration",
      value: UNMEASURED.duration.p50,
      absent: "no cycle in this window has finished",
    });
    expect(textOf(html)).toContain(EM_DASH);
    expect(textOf(html)).toContain("no cycle in this window has finished");
    // the whole card carries no digit at all: a zero here would tune the
    // cadence knob in the opposite direction to "not measurable yet"
    expect(textOf(html)).not.toMatch(/\d/);
    expect(classesOf(html)).toContain("text-ink-disabled");
  });

  it("qualifies a figure the window truncated, and leaves an untruncated one alone", () => {
    const floor = card({
      label: "items",
      value: QUEUES.items,
      floor: QUEUES.window.truncated,
    });
    const exact = card({
      label: "items",
      value: QUEUES.items,
      floor: CYCLES.window.truncated,
    });
    expect(textOf(floor)).toContain("1,200");
    expect(textOf(exact)).toContain("1,200");
    // the floor carries one extra line of the app's own words beside the
    // number; the exact figure carries none
    expect(classesOf(floor)).toContain("type-body");
    expect(classesOf(exact)).not.toContain("type-body");
    expect(textOf(floor).length).toBeGreaterThan(textOf(exact).length);
  });

  it("never qualifies or colours a figure it does not have", () => {
    const html = card({
      label: "median duration",
      value: UNMEASURED.duration.p50,
      absent: "no cycle has finished",
      floor: true,
      tone: "broken",
    });
    expect(classesOf(html)).not.toContain("type-body");
    expect(classesOf(html)).not.toContain("text-broken");
  });

  it("colours the figure only when it carries a palette state", () => {
    expect(classesOf(card({ label: "failed", value: 2, tone: "broken" }))).toContain(
      "text-broken",
    );
    expect(classesOf(card({ label: "failed", value: 2 }))).not.toContain("text-broken");
  });

  it("renders all four states through the ui primitives, none of them as a number", () => {
    const states = statesOf((state) => card({ label: "cycles", state }));

    expect(states.get("loading")).toMatch(/role="status"/);
    expect(states.get("error")).toMatch(/role="alert"/);
    expect(classesOf(states.get("error") ?? "")).toContain("text-broken");
    // gray, never red: a missing table is unavailable, not broken
    expect(classesOf(states.get("not_provisioned") ?? "")).not.toContain("text-broken");
    expect(textOf(states.get("not_provisioned") ?? "")).toContain("resolution_runs");
    expect(textOf(states.get("error") ?? "")).toContain("resolution_runs");
    expect(classesOf(states.get("empty") ?? "")).not.toContain("type-figure");

    for (const [kind, html] of states) {
      expect(html.length, kind).toBeGreaterThan(10);
      expect(textOf(html), kind).not.toMatch(/\d/);
    }
  });
});

describe("TrendTable", () => {
  it("draws a per-period series by the data-table rule, one row per period", () => {
    const html = weekTable();
    expect(html).toMatch(/<th[^>]*class="[^"]*type-micro/);
    expect(html).toMatch(/<tr[^>]*class="[^"]*bg-chrome/);
    expect(html).toMatch(/<td[^>]*class="[^"]*type-data/);
    expect(html.match(/<tr/g) ?? []).toHaveLength(CONFLICTS.weeks.length + 1);
    expect(textOf(html)).toContain("1,200");
    // no bespoke layout and no chart: the series is a table
    expect(html).toContain("<table");
  });

  it("renders a measure the aggregate cannot compute as the dash, never as a zero", () => {
    const html = weekTable();
    // `settled` is null for every week until `verdicts` lands: one dash per
    // week, and no zero standing in for an unknowable settle count
    const dashes = classesOf(html).filter((name) => name === "text-ink-disabled");
    expect(dashes).toHaveLength(CONFLICTS.weeks.length);
    expect(textOf(html)).toContain(EM_DASH);
  });

  it("carries a per-source series with its own units, and dashes an unmeasured one", () => {
    const html = render(
      h(TrendTable<QueueStats>, {
        label: "queues",
        period: "queue",
        rows: QUEUES.queues,
        rowKey: (queue: QueueStats) => queue.queue,
        rowLabel: (queue: QueueStats) => queue.queue,
        measures: [
          { key: "open", label: "open", value: (queue: QueueStats) => queue.open },
          {
            key: "age",
            label: "median open age",
            value: (queue: QueueStats) => queue.openAge.p50,
            format: duration,
          },
        ],
      }),
    );
    expect(textOf(html)).toContain(duration(CONFLICTS.openAge.p50));
    expect(textOf(html)).toContain("6d");
    // the queue with no items has no median age — a dash, not "0s"
    expect(textOf(html)).toContain(EM_DASH);
    expect(textOf(html)).not.toContain("0s");
  });

  it("renders all four states: the lines inside the table, the cards in its place", () => {
    const states = statesOf((state) => weekTable(state));

    for (const kind of ["loading", "error"]) {
      const html = states.get(kind) ?? "";
      // the header stays put while a read is in flight or refused
      expect(html, kind).toContain("<thead");
      expect(html, kind).not.toContain("1,200");
    }
    expect(states.get("loading")).toMatch(/role="status"/);
    expect(states.get("error")).toMatch(/role="alert"/);

    for (const kind of ["empty", "not_provisioned"]) {
      const html = states.get(kind) ?? "";
      // a card replaces the table rather than nesting inside its border
      expect(html, kind).not.toContain("<table");
      expect(classesOf(html), kind).toContain("border-hairline");
    }
    expect(textOf(states.get("not_provisioned") ?? "")).toContain("resolution_runs");
  });
});

describe("Distribution", () => {
  it("renders one row per percentile of the spread, in the aggregate's units", () => {
    const html = ageDistribution();
    expect(html.match(/<tr/g) ?? []).toHaveLength(spreadRows(CYCLES.duration).length + 1);
    expect(textOf(html)).toContain(duration(CYCLES.duration.p50));
    expect(textOf(html)).toContain(duration(CYCLES.duration.max));
    expect(html).toMatch(/<td[^>]*class="[^"]*type-data/);
  });

  it("draws its bars from tokens, in proportion to the largest value", () => {
    const html = ageDistribution();
    const widths = [...html.matchAll(/width:\s*([0-9.]+)%/g)].map((match) => match[1]);
    // the max is a full bar; p50 is its share of the max (200s of 1200s)
    expect(widths).toContain("100.0");
    expect(widths).toContain("16.7");
    // the bar is a fill built from palette tokens, not an svg from a library
    expect(html).toContain("bg-chrome-inverse");
    expect(html).not.toContain("<svg");
    // and it is decoration: the number is the answer
    expect(html).toMatch(/aria-hidden="true"/);
  });

  it("draws no bar for a percentile the aggregate could not measure", () => {
    const html = render(
      h(Distribution, {
        label: "cycle duration",
        dimension: "percentile",
        measure: "duration",
        rows: spreadRows(UNMEASURED.duration),
        format: duration,
      }),
    );
    expect(html).not.toMatch(/width:/);
    expect(textOf(html)).toContain(EM_DASH);
    expect(textOf(html)).not.toContain("0s");
    expect(classesOf(html)).toContain("text-ink-disabled");
  });

  it("adds the detail column only when it is labelled", () => {
    const rows = spreadRows(CYCLES.duration).map((row) => ({ ...row, detail: "2 cycles" }));
    const withDetail = render(
      h(Distribution, {
        label: "cycle duration",
        dimension: "percentile",
        measure: "duration",
        rows,
        format: duration,
        detailLabel: "cycles",
      }),
    );
    const without = render(
      h(Distribution, {
        label: "cycle duration",
        dimension: "percentile",
        measure: "duration",
        rows,
        format: duration,
      }),
    );
    expect(textOf(withDetail)).toContain("2 cycles");
    expect(textOf(without)).not.toContain("2 cycles");
  });

  it("scales against an explicit max, so two distributions can be compared", () => {
    const html = render(
      h(Distribution, {
        label: "cycle duration",
        dimension: "percentile",
        measure: "duration",
        rows: spreadRows(CYCLES.duration),
        format: duration,
        max: CYCLES.duration.max === null ? undefined : CYCLES.duration.max * 2,
      }),
    );
    const widths = [...html.matchAll(/width:\s*([0-9.]+)%/g)].map((match) => match[1]);
    expect(widths).toContain("50.0");
    expect(widths).not.toContain("100.0");
  });

  it("renders all four states: the lines inside the table, the cards in its place", () => {
    const states = statesOf((state) => ageDistribution(state));

    for (const kind of ["loading", "error"]) {
      const html = states.get(kind) ?? "";
      expect(html, kind).toContain("<thead");
      expect(html, kind).not.toMatch(/width:/);
    }
    expect(states.get("loading")).toMatch(/role="status"/);
    expect(states.get("error")).toMatch(/role="alert"/);

    for (const kind of ["empty", "not_provisioned"]) {
      const html = states.get(kind) ?? "";
      expect(html, kind).not.toContain("<table");
    }
    expect(textOf(states.get("not_provisioned") ?? "")).toContain("resolution_runs");
    expect(classesOf(states.get("not_provisioned") ?? "")).not.toContain("text-broken");
  });
});

describe("token discipline across the three gauge components", () => {
  const SAMPLES: { name: string; html: string }[] = [
    { name: "GaugeCard", html: card({ label: "facts examined", value: CYCLES.factsExamined }) },
    {
      name: "GaugeCard/floor",
      html: card({ label: "items", value: QUEUES.items, floor: true, tone: "attention" }),
    },
    {
      name: "GaugeCard/absent",
      html: card({ label: "p50", value: null, absent: "nothing finished" }),
    },
    ...STATES.map((state) => ({
      name: `GaugeCard/${state.kind}`,
      html: card({ label: "cycles", state }),
    })),
    { name: "TrendTable", html: weekTable() },
    ...STATES.map((state) => ({ name: `TrendTable/${state.kind}`, html: weekTable(state) })),
    { name: "Distribution", html: ageDistribution() },
    ...STATES.map((state) => ({
      name: `Distribution/${state.kind}`,
      html: ageDistribution(state),
    })),
  ];

  function offenders(predicate: (className: string) => boolean): string[] {
    return SAMPLES.flatMap((sample) =>
      classesOf(sample.html)
        .filter(predicate)
        .map((className) => `${sample.name}: ${className}`),
    );
  }

  it("uses no arbitrary value, no literal colour and no raw ramp step", () => {
    expect(offenders((name) => name.includes("["))).toEqual([]);
    expect(offenders((name) => /#[0-9a-f]{3,8}/i.test(name))).toEqual([]);
    expect(
      offenders((name) =>
        /-(gray|slate|zinc|neutral|stone|purple|violet|green|emerald|amber|orange|yellow|red|rose|blue|sky|indigo|pink|fuchsia)-\d{2,3}$/.test(
          name,
        ),
      ),
    ).toEqual([]);
    expect(offenders((name) => name.startsWith("dark:"))).toEqual([]);
  });

  it("sizes text only through the five type steps", () => {
    const steps = SAMPLES.flatMap((sample) =>
      classesOf(sample.html).filter((name) => name.startsWith("type-")),
    );
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(["type-figure", "type-title", "type-body", "type-data", "type-micro"]).toContain(
        step,
      );
    }
    expect(offenders((name) => /^(text-(xs|sm|base|lg|xl|\d?xl)|text-\[)/.test(name))).toEqual(
      [],
    );
  });

  it("spaces only on the 2/4/6/8/12/16/24 scale and rounds only controls", () => {
    const SPACING =
      /^-?(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|top|right|bottom|left|inset|w|h|size|min-w|min-h|max-w|max-h)-([0-9.]+)$/;
    const IN_SCALE = new Set(["0", "0.5", "1", "1.5", "2", "3", "4", "6"]);
    expect(
      offenders((name) => {
        const match = SPACING.exec(name);
        return match !== null && !IN_SCALE.has(match[2]);
      }),
    ).toEqual([]);
    expect(offenders((name) => name.startsWith("rounded") && name !== "rounded-control")).toEqual(
      [],
    );
    expect(offenders((name) => name.startsWith("shadow"))).toEqual([]);
  });

  it("carries exactly one inline style — the distribution bar's data-driven width", () => {
    for (const sample of SAMPLES) {
      const styles = [...sample.html.matchAll(/style="([^"]*)"/g)].map((match) => match[1]);
      for (const style of styles) {
        expect(style, sample.name).toMatch(/^width:[0-9.]+%$/);
      }
      if (sample.name !== "Distribution") expect(styles, sample.name).toEqual([]);
    }
  });
});
