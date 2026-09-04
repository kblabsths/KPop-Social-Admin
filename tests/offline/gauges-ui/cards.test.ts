import { describe, expect, it } from "vitest";

import {
  Distribution,
  type DistributionRow,
  GaugeCard,
  type EmptyWords,
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
import { classesOf, h, render, tagsOf, textOf } from "../ui/markup";

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
    // As `windowOf` sets it — the cycle-health scan is over `resolution_runs`.
    over: "table",
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

/**
 * The words each rows surface must now carry for the case it holds nothing.
 * They are the CALLER's — the component cannot invent them (ARCHITECTURE §7,
 * admin-window/TASK-0030) — so the tests below assert they arrive verbatim.
 */
const WEEKS_EMPTY: EmptyWords = {
  holds: "weeks in this window",
  filledBy: "an item opens in this queue",
};

const SPREAD_EMPTY: EmptyWords = {
  holds: "measured cycles",
  filledBy: "a cycle finishes and the resolver records its duration",
};

function weekTable(state?: GaugeState, rows: QueueWeek[] = CONFLICTS.weeks): string {
  return render(
    h(TrendTable<QueueWeek>, {
      label: "opens and settles per week",
      period: "week",
      rows,
      rowKey: (week: QueueWeek) => week.weekStart,
      rowLabel: (week: QueueWeek) => week.weekStart,
      measures: [
        { key: "opened", label: "opened", value: (week: QueueWeek) => week.opened },
        { key: "settled", label: "settled", value: (week: QueueWeek) => week.settled },
      ],
      empty: WEEKS_EMPTY,
      state,
    }),
  );
}

function ageDistribution(
  state?: GaugeState,
  rows: DistributionRow[] = spreadRows(CYCLES.duration),
): string {
  return render(
    h(Distribution, {
      label: "cycle duration",
      dimension: "percentile",
      measure: "duration",
      rows,
      format: duration,
      empty: SPREAD_EMPTY,
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

  // admin-window/BUG-0018 — the same invariant as the test above, for the two
  // ways an absence reaches this card as a non-null `value`: the app's own
  // formatters return the em dash as a STRING (`duration(null)`, `count(null)`,
  // `relativeAge(null).text`), and an arithmetic figure can arrive non-finite.
  // Both render as the dash, so neither may carry a floor qualifier or a
  // palette colour — a health tone on a figure nobody measured is the reading
  // this gauge exists to prevent (spec §5). The card asks `isAbsent` instead of
  // `value === null`, which is why these two now hold.
  it("never qualifies or colours an absence that arrived as a formatted string", () => {
    const html = card({
      label: "median duration",
      // exactly what a page renders a seconds figure with: the helper this
      // ticket added, over an aggregate percentile that is null
      value: duration(UNMEASURED.duration.p50),
      floor: true,
      tone: "broken",
    });
    expect(textOf(html)).toContain(EM_DASH);
    expect(classesOf(html)).not.toContain("type-body");
    expect(classesOf(html)).not.toContain("text-broken");
  });

  // admin-window/BUG-0018 (see above).
  it("never qualifies or colours a non-finite figure", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const html = card({ label: "writes per fact", value, floor: true, tone: "broken" });
      expect(textOf(html), String(value)).toContain(EM_DASH);
      expect(classesOf(html), String(value)).not.toContain("type-body");
      expect(classesOf(html), String(value)).not.toContain("text-broken");
    }
  });

  it("says why it cannot measure, whether or not the caller gave a reason", () => {
    // the reason reaches the dash even though the value is a non-null string,
    // which is the arm admin-window/BUG-0018 could not reach at all
    const stated = card({
      label: "median duration",
      value: duration(UNMEASURED.duration.p50),
      absent: "no cycle in this window has finished",
    });
    expect(textOf(stated)).toContain(EM_DASH);
    expect(textOf(stated)).toContain("no cycle in this window has finished");

    // and a formatted absence the caller did not annotate still carries a
    // sub-line: a dash with no words at all says nothing an operator can act on
    const unstated = card({ label: "writes per fact", value: Number.NaN });
    expect(textOf(unstated)).toContain(EM_DASH);
    expect(classesOf(unstated)).toContain("type-data");
    // a measured figure with no sub-detail carries no sub-line, so the line
    // above is the absence speaking and not the card's default anatomy
    expect(classesOf(card({ label: "facts examined", value: 12 }))).not.toContain("type-data");
  });

  // admin-window/BUG-0019 — the reason path now asks the same definition the
  // value path does, so this is a plain `it` (it was pinned `it.fails` while
  // the card decided the reason with `??`, which catches only null/undefined).
  it("says why it cannot measure even when the caller's reason is itself blank", () => {
    // A blank reason is one the union's third arm accepts, since it demands
    // `absent: string` and "" is a string. Whatever its whitespace spelling, it
    // states nothing, so the card must fall back to words rather than render
    // the dash bare — the reading LOOK_AND_FEEL forbids and the very reason the
    // UNSTATED_REASON fallback exists.
    for (const absent of ["", "   ", "\n\t "]) {
      const html = card({ label: "median duration", value: null, absent });
      const beside = textOf(html).replace(EM_DASH, "").replace("median duration", "").trim();
      expect(textOf(html), JSON.stringify(absent)).toContain(EM_DASH);
      expect(classesOf(html), JSON.stringify(absent)).toContain("type-data");
      expect(beside.length, JSON.stringify(absent)).toBeGreaterThan(0);
      // and the words are the ones an unannotated absence gets: a stated-but-
      // empty reason and no reason at all are the same absence, not two
      // renderings (no wording is pinned — the two markups are compared)
      expect(html, JSON.stringify(absent)).toBe(
        card({ label: "median duration", value: Number.NaN }),
      );
    }

    // a reason that does carry words is still the caller's, untouched
    const stated = card({ label: "median duration", value: null, absent: "  no cycle yet  " });
    expect(textOf(stated)).toContain("no cycle yet");
  });

  // admin-window/BUG-0019, QA's attack pass: the spellings the fix's own case
  // does not name, and the arm it must never reach.
  it("treats every spelling of a stated-nothing reason as the same absence, and leaves a measured figure alone", () => {
    // the reason is asked the app's ONE definition (`isAbsent`), so the
    // spellings that definition already calls absences — the em dash a
    // formatter emits, and unicode whitespace `trim` eats — must render the
    // same card as no reason at all, not a sub-line the eye cannot read
    const unstated = card({ label: "median duration", value: Number.NaN });
    for (const absent of [EM_DASH, `  ${EM_DASH}  `, "\u00a0", "\u2003"]) {
      expect(card({ label: "median duration", value: null, absent }), JSON.stringify(absent)).toBe(
        unstated,
      );
    }

    // and the fallback is unreachable from a MEASURED figure: whatever the
    // caller left in `absent`, a card that has a number renders exactly the
    // card it would render without one — the words never appear beside a value
    for (const value of [0, 12, duration(3200)]) {
      for (const absent of ["", "   ", "no cycle in this window has finished"]) {
        expect(
          card({ label: "median duration", value, absent }),
          `${JSON.stringify(value)} / ${JSON.stringify(absent)}`,
        ).toBe(card({ label: "median duration", value }));
      }
    }
    // a measured card's own sub-line survives a stray blank reason
    expect(textOf(card({ label: "facts examined", value: 7, sub: "12 rows", absent: "" }))).toContain(
      "12 rows",
    );

    // a reason is DATA (it can quote a source name), so it reaches the page as
    // text and never as markup
    const injected = card({
      label: "median duration",
      value: null,
      absent: '<script>alert("x")</script>',
    });
    expect(injected).not.toContain("<script>");
    expect(tagsOf(injected)).toEqual(["div", "span", "span", "span", "span"]);
  });

  it("takes its absence from the app's one definition, not a guard of its own", () => {
    // the spellings the two tests above do not cover: `isAbsent` treats a blank
    // string and a bare em dash as absences, so the card must too — one guard,
    // one meaning, in GaugeCard, StatCard and DataTable alike (BUG-0004)
    for (const value of ["", "   ", EM_DASH]) {
      const html = card({ label: "median duration", value, floor: true, tone: "broken" });
      expect(textOf(html), JSON.stringify(value)).toContain(EM_DASH);
      expect(classesOf(html), JSON.stringify(value)).toContain("text-ink-disabled");
      expect(classesOf(html), JSON.stringify(value)).not.toContain("type-body");
      expect(classesOf(html), JSON.stringify(value)).not.toContain("text-broken");
    }
  });

  it("never mistakes a measured zero for an absence, in either spelling", () => {
    // a real zero keeps its qualifier and its colour: "zero cycles failed" is a
    // reading, and suppressing it would be the mirror image of BUG-0018
    const zero = card({ label: "failed cycles", value: 0, floor: true, tone: "broken" });
    expect(textOf(zero)).toContain("0");
    expect(textOf(zero)).not.toContain(EM_DASH);
    expect(classesOf(zero)).toContain("type-body");
    expect(classesOf(zero)).toContain("text-broken");

    // and the same zero after a formatter has been over it
    const formatted = card({ label: "median duration", value: duration(0), tone: "healthy" });
    expect(textOf(formatted)).toContain(duration(0));
    expect(textOf(formatted)).not.toContain(EM_DASH);
    expect(classesOf(formatted)).toContain("text-healthy");
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
        empty: { holds: "queues", filledBy: "the resolver opens a review item" },
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
        empty: SPREAD_EMPTY,
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
        empty: SPREAD_EMPTY,
      }),
    );
    const without = render(
      h(Distribution, {
        label: "cycle duration",
        dimension: "percentile",
        measure: "duration",
        rows,
        format: duration,
        empty: SPREAD_EMPTY,
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
        empty: SPREAD_EMPTY,
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

/**
 * The typed state contract of admin-window/TASK-0030, asserted where only a
 * rendering can prove it: the eyebrow survives onto the card that replaces a
 * gauge, and a rows surface has no headers-only rendering left to reach.
 */
describe("the state contract these three components share", () => {
  const SURFACE_STATES = STATES.filter(
    (state) => state.kind === "empty" || state.kind === "not_provisioned",
  );

  it("keeps the gauge's own label on the card that replaces it, in all three components", () => {
    // The two surface states replace the WHOLE gauge, so the label is the only
    // thing left saying which knob is missing. A screen of these without it
    // names the absent tables and no gauges.
    const byComponent: [string, (state: GaugeState) => string][] = [
      ["GaugeCard", (state) => card({ label: "cycle health", state })],
      [
        "TrendTable",
        (state) =>
          render(
            h(TrendTable<QueueWeek>, {
              label: "cycle health",
              period: "week",
              rows: CONFLICTS.weeks,
              rowKey: (week: QueueWeek) => week.weekStart,
              rowLabel: (week: QueueWeek) => week.weekStart,
              measures: [{ key: "opened", label: "opened", value: (week: QueueWeek) => week.opened }],
              empty: WEEKS_EMPTY,
              state,
            }),
          ),
      ],
      [
        "Distribution",
        (state) =>
          render(
            h(Distribution, {
              label: "cycle health",
              dimension: "percentile",
              measure: "duration",
              rows: spreadRows(CYCLES.duration),
              format: duration,
              empty: SPREAD_EMPTY,
              state,
            }),
          ),
      ],
    ];

    for (const [component, renderState] of byComponent) {
      for (const state of SURFACE_STATES) {
        const html = renderState(state);
        const where = `${component}/${state.kind}`;
        expect(textOf(html), where).toContain("cycle health");
        // as the eyebrow: a `micro` label, the position StatCard gives it
        expect(classesOf(html), where).toContain("type-micro");
        expect(textOf(html).indexOf("cycle health"), where).toBe(0);
      }
    }
  });

  it("renders the caller's own empty words instead of a headers-only table", () => {
    for (const [component, html, words] of [
      ["TrendTable", weekTable(undefined, []), WEEKS_EMPTY],
      ["Distribution", ageDistribution(undefined, []), SPREAD_EMPTY],
    ] as const) {
      // the rendering that says nothing at all is gone: no table, no header row
      expect(html, component).not.toContain("<table");
      expect(html, component).not.toContain("<thead");
      // and what stands there instead carries the caller's words and the
      // gauge's own eyebrow
      expect(textOf(html), component).toContain(words.holds);
      expect(textOf(html), component).toContain(words.filledBy);
      expect(classesOf(html), component).toContain("border-hairline");
      expect(classesOf(html), component).toContain("type-micro");
    }
    expect(textOf(weekTable(undefined, []))).toContain("opens and settles per week");
    expect(textOf(ageDistribution(undefined, []))).toContain("cycle duration");
  });

  it("lets an explicit state win over the empty case it would have rendered", () => {
    // A page that knows WHY the surface is empty — a filter that matched
    // nothing — says so in its own words, and a read still in flight or
    // refused is not an empty series at all.
    const stated: GaugeState = {
      kind: "empty",
      holds: "cycles matching this filter",
      filledBy: "widen the window",
    };
    for (const [component, html] of [
      ["TrendTable", weekTable(stated, [])],
      ["Distribution", ageDistribution(stated, [])],
    ] as const) {
      expect(textOf(html), component).toContain("cycles matching this filter");
      expect(textOf(html), component).not.toContain(WEEKS_EMPTY.filledBy);
      expect(textOf(html), component).not.toContain(SPREAD_EMPTY.filledBy);
    }

    for (const [component, html] of [
      ["TrendTable", weekTable(STATES[0], [])],
      ["Distribution", ageDistribution(STATES[0], [])],
    ] as const) {
      // loading: the header stays put, and no empty card claims the series is
      // empty when nobody has read it yet
      expect(html, component).toContain("<thead");
      expect(html, component).toMatch(/role="status"/);
      expect(textOf(html), component).not.toContain(WEEKS_EMPTY.filledBy);
    }
  });

  it("cannot be handed rows with no words for the case they are absent", () => {
    // The compile-time half: `tsc --noEmit` covers `tests/**`, so if `empty`
    // ever goes optional again these directives become unused-directive errors
    // and the build reddens. Never rendered — not compiling is the assertion.
    const headersOnlyTrend = () =>
      // @ts-expect-error `empty` is required: a headers-only table is unwritable
      h(TrendTable<QueueWeek>, {
        label: "opens per week",
        period: "week",
        rows: [],
        rowKey: (week: QueueWeek) => week.weekStart,
        rowLabel: (week: QueueWeek) => week.weekStart,
        measures: [],
      });
    const headersOnlySpread = () =>
      // @ts-expect-error `empty` is required: a headers-only table is unwritable
      h(Distribution, {
        label: "cycle duration",
        dimension: "percentile",
        measure: "duration",
        rows: [],
      });
    expect([typeof headersOnlyTrend, typeof headersOnlySpread]).toEqual([
      "function",
      "function",
    ]);
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
    { name: "TrendTable/no-rows", html: weekTable(undefined, []) },
    ...STATES.map((state) => ({ name: `TrendTable/${state.kind}`, html: weekTable(state) })),
    { name: "Distribution", html: ageDistribution() },
    { name: "Distribution/no-rows", html: ageDistribution(undefined, []) },
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
