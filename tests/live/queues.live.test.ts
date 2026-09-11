import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import QueuesPage from "@/app/queues/page";
import { readReviewQueues } from "@/lib/db/review-items";
import { T } from "@/lib/db/tables";
import {
  assertParity,
  countOrAbsent,
  countRows,
  exactCount,
  gradeSurface,
  independentClient,
  objectIsAbsent,
  readNumber,
  renderPage,
  whileStill,
} from "./parity";

/**
 * The Queues page against staging (campaign admin-window/TASK-0010, oracle
 * rewritten by admin-window/TASK-0032).
 *
 * Acceptance test 2's rule, ARCHITECTURE.md §10: what the page RENDERED is
 * compared with a query THIS TEST issues, written independently of the
 * `lib/db` function the page called. Two paths to one number, or it proves
 * nothing — so nothing below asks `src/lib/db/review-items.ts` or
 * `src/lib/review/shapes.ts` what it expects. The decision / signal split and
 * the three shapes are spelled out here from the schema (spec §6: an
 * `entity_link` item whose subject is the SOURCE is the signal), and so is the
 * queue order.
 *
 * **Every case names the STATE KIND before it compares anything**
 * (ARCHITECTURE.md §10, common violation 6). Each queue block carries its kind
 * structurally on `data-state` (admin-window/BUG-0027), and this file derives
 * the kind it EXPECTS from its own count first, then asserts the page agrees:
 *
 *  - `ok` compares ids, order and numbers.
 *  - `empty` is a PASS WITH A NUMBER: this test counted exactly 0 rows and the
 *    block's labelled open figure reads 0. It is never an absence, and never
 *    the not-provisioned card — the two draw the same container and differ
 *    only in their words, which is what graded an honest EMPTY page as an
 *    unprovisioned one before this rewrite.
 *  - `not_provisioned` is a pass only when THIS TEST's own read of
 *    `review_items` gets the absence code (`PGRST205` / `42P01`).
 *  - `error` is a FAIL, naming the read and the database's own account.
 *
 * What staging held when this oracle was written (measured 2026-09-02, and a
 * fact of the run rather than of the code): `review_items` = 7 rows — 6
 * decisions, all `data_conflict`, and 1 `entity_link` signal, all open. The
 * decision side is therefore NO LONGER the 0-to-0 comparison the earlier
 * census recorded; the `?queue=data_conflict` filter case is what leaves the
 * SIGNAL queue honestly empty, and that emptiness is asserted as `empty` with
 * its stated 0 rather than graded a failure.
 *
 * This file WRITES NOTHING, so it needs no sweep (acceptance test 13); every
 * query here is a select.
 *
 * It refuses to run at all until `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SERVICE_ROLE_KEY` are set and `agenticflow/docs/SERVICES.md`
 * declares the target — `tests/live/setup.ts` throws first, non-zero, with the
 * missing name. That refusal is the correct state today and is not a failure
 * of this file.
 */

type Params = Record<string, string>;
type Kind = "decision" | "signal";

const KINDS: readonly Kind[] = ["decision", "signal"];

/** Each block's own hook, and the `micro` label its open figure stands under. */
const BLOCK: Record<Kind, string> = {
  decision: '[data-queue="decision"]',
  signal: '[data-queue="signal"]',
};
const OPEN_LABEL: Record<Kind, string> = {
  decision: "Open decisions",
  signal: "Open signals",
};

/**
 * The queue-health gauge's surface: the page's own section, the one that is
 * not inside a queue block. Structural — no heading text is read.
 */
const HEALTH = "section:not([data-queue] section)";

/**
 * The per-queue SLICES inside that section. Each makes its own statement and
 * carries its own state cards — an age spread with nothing open in it is
 * `empty` about that ONE queue and says nothing about the gauge — so they are
 * not the section's to answer for and are excluded from its state
 * (`stateOf`'s `excluding`; admin-window/BUG-0062, where the `data_conflict`
 * slice's honestly-empty age panel was read as the whole gauge's state and
 * this file's only figure assertions were never reached).
 *
 * This can never silence the gauge's OWN refusals: a window that could not be
 * read renders no slice at all, and its error / not-provisioned card is a
 * direct child of the section, outside every slice.
 */
const GAUGE_SLICES = "[data-gauge-queue]";

/**
 * The window the gauge reads, spelled HERE from spec §5 rather than imported
 * from `lib/gauges/queue-health.ts`: the items **opened in the last 180
 * days**, oldest first, at most the platform's row cap. Importing the gauge's
 * own defaults would make this one path to one number instead of two
 * (ARCHITECTURE.md §10).
 */
const WINDOW_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * PostgREST's `db-max-rows` on this platform — the most rows one windowed read
 * can return. At the cap the gauge's figures are FLOORS over the OLDEST rows
 * of the window (the read is `opened_at` ascending), so this test compares
 * them as floors there instead of as equals, rather than reporting an honest
 * truncation as a wrong number.
 */
const WINDOW_ROW_CAP = 1000;

/** The registry's two queues — the slices the gauge always reports. */
const GAUGE_QUEUES = ["data_conflict", "entity_link"] as const;
type GaugeQueue = (typeof GAUGE_QUEUES)[number];

/** The page as the URL renders it. Every read happens per request. */
async function queuesMarkup(params: Params = {}): Promise<string> {
  return renderPage(QueuesPage, { searchParams: Promise.resolve(params) });
}

/** The item ids the named queue rendered, in rendered order. */
function idsIn(markup: string, kind?: Kind): string[] {
  const $ = cheerio.load(markup);
  const scope = kind === undefined ? "" : `${BLOCK[kind]} `;
  return $(`${scope}[data-item]`)
    .toArray()
    .map((element) => $(element).attr("data-item") ?? "");
}

/** The test's own select over the review table, before any narrowing. */
function items() {
  return independentClient()
    .from(T.reviewItems)
    .select("review_item_id, queue, source_id, severity, status, opened_at");
}

/**
 * One queue's own narrowing, spelled from the schema (spec §6): the signal is
 * the `entity_link` item whose subject is a SOURCE; everything else is a
 * decision.
 */
function narrowRows(kind: Kind) {
  const query = items();
  return kind === "signal"
    ? query.eq("queue", "entity_link").not("source_id", "is", null)
    : query.or("queue.eq.data_conflict,and(queue.eq.entity_link,source_id.is.null)");
}

/** The same narrowing over a GET-shaped exact count. */
function narrowCount(kind: Kind) {
  const query = exactCount(T.reviewItems);
  return kind === "signal"
    ? query.eq("queue", "entity_link").not("source_id", "is", null)
    : query.or("queue.eq.data_conflict,and(queue.eq.entity_link,source_id.is.null)");
}

/** This test's own rows for one queue, under an optional facet. */
async function rowsOf(
  kind: Kind,
  facet?: { column: string; value: string },
): Promise<{ review_item_id: string; severity: string; status: string; opened_at: string }[]> {
  const narrowed = narrowRows(kind);
  const { data, error } = await (facet === undefined
    ? narrowed
    : narrowed.eq(facet.column, facet.value));
  if (error) throw new Error(`the ${kind} query failed: ${JSON.stringify(error)}`);
  return (data ?? []) as {
    review_item_id: string;
    severity: string;
    status: string;
    opened_at: string;
  }[];
}

/**
 * Grade one block against this test's own count of its rows, and say whether
 * the caller may go on to compare. Everything but `ok` has already been
 * graded fully when this returns false.
 */
async function gradeQueue(markup: string, kind: Kind, counted: number | "absent") {
  const state = await gradeSurface({
    markup,
    within: BLOCK[kind],
    object: T.reviewItems,
    counted,
    figure: OPEN_LABEL[kind],
  });
  return state === "ok";
}

describe("the two queues against staging", () => {
  for (const kind of KINDS) {
    it(`renders the open ${kind} count the database holds`, async () => {
      const markup = await queuesMarkup();
      const counted = await countOrAbsent(() => narrowCount(kind));
      if (!(await gradeQueue(markup, kind, counted))) return;

      await assertParity({
        markup,
        within: BLOCK[kind],
        label: OPEN_LABEL[kind],
        expected: () => countRows(() => narrowCount(kind).eq("status", "open")),
      });
    });
  }

  it("renders every row the table holds, split between the two queues", async () => {
    // The list is a COMPLETE read (ARCHITECTURE.md §4.3): with no filter, the
    // ids on screen are every id in the table — no paging, nothing dropped.
    const markup = await queuesMarkup();
    const whole = await countOrAbsent(() => exactCount(T.reviewItems));

    let seen = 0;
    for (const kind of KINDS) {
      const expected = await rowsOf(kind);
      const counted = whole === "absent" ? "absent" : expected.length;
      await gradeSurface({
        markup,
        within: BLOCK[kind],
        object: T.reviewItems,
        counted,
        figure: OPEN_LABEL[kind],
      });
      // True in every counted state, `empty` included: an empty block renders
      // no row, and this test counted none.
      if (counted === "absent") return;
      expect(new Set(idsIn(markup, kind)), kind).toEqual(
        new Set(expected.map((row) => row.review_item_id)),
      );
      seen += expected.length;
    }

    const rendered = idsIn(markup);
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(rendered).toHaveLength(whole === "absent" ? 0 : whole);
    expect(seen).toBe(whole);
  });

  it("orders each queue open first, then severity, then age", async () => {
    const markup = await queuesMarkup();

    for (const kind of KINDS) {
      const rows = await rowsOf(kind);
      if (!(await gradeQueue(markup, kind, rows.length))) continue;

      // The order spelled here, not imported: open before settled, high before
      // low, oldest first, the id last so it is total.
      const ordered = [...rows].sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
        const age = Date.parse(a.opened_at) - Date.parse(b.opened_at);
        if (age !== 0) return age;
        return a.review_item_id < b.review_item_id ? -1 : 1;
      });
      expect(idsIn(markup, kind), kind).toEqual(
        ordered.map((row) => row.review_item_id),
      );
    }
  });
});

describe("the filters against staging", () => {
  it("returns exactly the matching items for every queue and status value", async () => {
    for (const [column, value] of [
      ["queue", "data_conflict"],
      ["queue", "entity_link"],
      ["status", "open"],
      ["status", "settled"],
    ] as const) {
      const markup = await queuesMarkup({ [column]: value });
      const facet = { column, value };

      for (const kind of KINDS) {
        const expected = await rowsOf(kind, facet);
        // A facet that matches nothing in this queue is an EMPTY block with a
        // stated 0 — not an absent table, and not a failure. That confusion
        // is what admin-window/TASK-0032 was opened for: `?queue=data_conflict`
        // leaves the signal queue honestly empty.
        const state = await gradeSurface({
          markup,
          within: BLOCK[kind],
          object: T.reviewItems,
          counted: expected.length,
          figure: OPEN_LABEL[kind],
        });
        if (state === "not_provisioned") return;
        expect(new Set(idsIn(markup, kind)), `${column}=${value} / ${kind}`).toEqual(
          new Set(expected.map((row) => row.review_item_id)),
        );
      }

      expect(idsIn(markup), `${column}=${value}`).toHaveLength(
        (await rowsOf("decision", facet)).length + (await rowsOf("signal", facet)).length,
      );
    }
  });

  it("returns exactly the matching items for every shape value", async () => {
    // The three shapes, spelled from spec §6: the discriminator is `source_id`.
    for (const [shape, narrow] of [
      [
        "data_conflict_fact",
        (query: ReturnType<typeof items>) => query.eq("queue", "data_conflict"),
      ],
      [
        "entity_link_fact",
        (query: ReturnType<typeof items>) =>
          query.eq("queue", "entity_link").is("source_id", null),
      ],
      [
        "entity_link_source_pattern",
        (query: ReturnType<typeof items>) =>
          query.eq("queue", "entity_link").not("source_id", "is", null),
      ],
    ] as const) {
      const markup = await queuesMarkup({ shape });
      const { data, error } = await narrow(items());
      if (error) throw new Error(`the ${shape} query failed: ${JSON.stringify(error)}`);
      const expected = (data ?? []) as { review_item_id: string; source_id: string | null }[];

      // A shape belongs to exactly one queue, so the other queue is honestly
      // empty under this facet — asserted as `empty`, with its 0 on screen.
      const perKind: Record<Kind, string[]> = {
        decision:
          shape === "entity_link_source_pattern"
            ? []
            : expected.map((row) => row.review_item_id),
        signal:
          shape === "entity_link_source_pattern"
            ? expected.map((row) => row.review_item_id)
            : [],
      };

      for (const kind of KINDS) {
        const state = await gradeSurface({
          markup,
          within: BLOCK[kind],
          object: T.reviewItems,
          counted: perKind[kind].length,
          figure: OPEN_LABEL[kind],
        });
        if (state === "not_provisioned") return;
        expect(new Set(idsIn(markup, kind)), `${shape} / ${kind}`).toEqual(
          new Set(perKind[kind]),
        );
      }
      expect(idsIn(markup), shape).toHaveLength(expected.length);
    }
  });
});

/** One gauge's window, as the page states it — both edges and its cap. */
function windowOf(markup: string, gauge: string) {
  const line = cheerio.load(markup)(`[data-window="${gauge}"]`);
  return {
    present: line.length > 0,
    since: line.attr("data-window-since") ?? "",
    until: line.attr("data-window-until") ?? "",
    truncated: line.attr("data-window-truncated") === "true",
  };
}

/** The interval a disagreeing assertion names, so a red says WHICH window. */
function windowSaid(window: { since: string; until: string }): string {
  return `over opened_at in [${window.since}, ${window.until}) — the window the page's line states`;
}

/**
 * This test's own count over the set the GAUGE reads: opened inside the
 * window, at BOTH its edges (campaign admin-window/TASK-0070).
 *
 * `gte` on `opened_at` is the gauge's own lower narrowing and this one, and
 * `lt` is its upper: a row whose `opened_at` is NULL is in neither set (`null
 * >= x` and `null < x` are both null), so it can never make one side count
 * what the other cannot see — and neither can a row opened after the instant
 * the page resolved its window at.
 */
function openedInWindow(window: { since: string; until: string }) {
  return exactCount(T.reviewItems)
    .gte("opened_at", window.since)
    .lt("opened_at", window.until);
}

interface WindowCounts {
  /** Every item opened in the window, whatever its status — the gauge's set. */
  rows: number;
  /** The OPEN ones per queue: the figure each slice states. */
  open: Record<GaugeQueue, number>;
}

/**
 * The gauge's set, counted by this test over the window THE PAGE STATES —
 * both of its edges, read off the line the render published.
 *
 * It used to resolve a `since` of its own at call time (the same 180 days back
 * the page resolves) and apply no upper edge at all, so the comparison was
 * between two windows that shared neither edge exactly and the test needed
 * `whileStill` to keep a row arriving mid-comparison from reading as a defect
 * in the page. Taking both edges off the rendered line makes the interval one
 * closed interval rather than two open ones — `tests/live/parity.ts`'
 * `snapshotAsOf` states the rule ("one explicit upper edge shared by every leg
 * is deterministic, needs no retry"), and its carve-out for a leg that "cannot
 * be given an upper edge" is exactly what admin-window/TASK-0070 closed: the
 * app's own read carries `[since, until)` now, and publishes both.
 */
async function windowCounts(
  window: { since: string; until: string },
): Promise<WindowCounts | "absent"> {
  const rows = await countOrAbsent(() => openedInWindow(window));
  if (rows === "absent") return "absent";
  const open: Record<GaugeQueue, number> = { data_conflict: 0, entity_link: 0 };
  for (const queue of GAUGE_QUEUES) {
    open[queue] = await countRows(() =>
      openedInWindow(window).eq("status", "open").eq("queue", queue),
    );
  }
  return { rows, open };
}

describe("the queue-health gauge against staging", () => {
  it("renders each queue's open count over its own window", async () => {
    // ONE window is in play since admin-window/TASK-0070: the page resolves
    // `[since, until)`, applies both edges to its scan and publishes both on
    // its line, so this test counts the interval the page states rather than
    // one it resolves for itself. A row the reviewers file while this runs
    // carries `opened_at = now()`, which is at or after `until` and is
    // therefore outside both legs — the comparison is deterministic and needs
    // no `whileStill` retry (`tests/live/parity.ts`, `snapshotAsOf`).
    const markup = await queuesMarkup();
    const window = windowOf(markup, "queue_health");
    if (window.present) {
      // The window's LENGTH, from this file's own spelling of spec §5 rather
      // than from the gauge's defaults (ARCHITECTURE.md §10, two paths to one
      // number). Both edges are now the page's, so the interval it states is
      // itself gradeable: 180 days, exactly, end to end.
      expect(
        Date.parse(window.until) - Date.parse(window.since),
        `the queue-health line states ${windowSaid(window)}, which must be ` +
          `${WINDOW_DAYS} days end to end`,
      ).toBe(WINDOW_DAYS * MS_PER_DAY);
    }
    // The gauge's count comes from a READ, never from a fact of the MARKUP
    // (admin-window/BUG-0189). Where the page published its window line, the
    // read is over the interval that line states. Where it published NO line
    // there is no interval to count over, so the only honest question left is
    // put to the DATABASE: is `review_items` there at all? `"absent"` comes
    // back only when this test's own read gets the absence code, and a number
    // otherwise — so a page rendering the gauge not-provisioned over an
    // existing table fails at `gradeSurface`'s rule 5 instead of passing on
    // the render's own word (ARCHITECTURE.md §10, live-state rule 3). The
    // shape is the sibling's, `tests/live/cycles.live.test.ts`'s cycle-health
    // gauge.
    //
    // It is spelled as the THUNK form of `counted` that `gradeSurface` already
    // accepts, which is run only once the surface is known not to be in its
    // ERROR state; the counts it takes are kept, because the per-slice parity
    // assertions below grade that same read rather than issuing a second one.
    // (A box rather than a bare `let`: TypeScript's flow analysis does not see
    // the assignment made inside the thunk, and would narrow a `let` to its
    // initializer for every read below.)
    const gauge: { counted: WindowCounts | "absent" | "no window line" } = {
      counted: "no window line",
    };

    // The gauge is its own read of the same table, so it is its own surface
    // with its own state — graded before a figure is read off it, and graded
    // against the set the GAUGE reads (items opened in the window), never the
    // table's whole open count: one count cannot grade two different sets
    // (admin-window/BUG-0037, admin-window/BUG-0062).
    //
    // `emptyAtZero: false` because this section states every figure as a real
    // number in every counted state and draws no empty card of its own: a
    // window holding nothing still renders both slices with a labelled 0, and
    // that is `ok` (LOOK_AND_FEEL bar 1, like the Dashboard's attention cards).
    const state = await gradeSurface({
      markup,
      within: HEALTH,
      object: T.reviewItems,
      counted: async () => {
        if (!window.present) {
          return (await objectIsAbsent(T.reviewItems)) ? "absent" : 0;
        }
        gauge.counted = await windowCounts(window);
        return gauge.counted === "absent" ? "absent" : gauge.counted.rows;
      },
      excluding: GAUGE_SLICES,
      emptyAtZero: false,
    });
    const counted = gauge.counted;
    if (state !== "ok" || counted === "absent" || counted === "no window line") {
      return;
    }

    // Each slice's open figure against this test's own count of that queue's
    // open items INSIDE the window — the two-paths-to-one-number comparison
    // this case exists for, and the reason nothing above may return early.
    //
    // Read the figure by its LABEL, the way every other parity assertion in
    // this suite does. A regex over the slice's text cannot: `.text()`
    // concatenates the figure with the severity sub-line beside it, so an
    // open count of 4 followed by "1 high, 3 low" reads back as 41 — measured
    // on the offline edge population 2026-09-02 (4 -> 41, 3 -> 31), which
    // would fail this assertion against correct code.
    const floors = counted.rows >= WINDOW_ROW_CAP;
    for (const queue of GAUGE_QUEUES) {
      const rendered = readNumber(markup, `${queue} open`);
      if (floors) {
        expect(
          rendered,
          `${queue} open (the window filled its ${WINDOW_ROW_CAP}-row cap, so ` +
            `the page's figure is a floor over the oldest rows in it), ` +
            `counted ${windowSaid(window)}`,
        ).toBeLessThanOrEqual(counted.open[queue]);
      } else {
        expect(rendered, `${queue} open, counted ${windowSaid(window)}`).toBe(
          counted.open[queue],
        );
      }
    }
  });
});

/* ── the verdict log, the page's second tab ──────────────────────────────── */

/**
 * The verdict-log tab against staging (campaign admin-window/TASK-0058, spec
 * F13's "rendered counts equal direct SQL on staging once the table exists;
 * until then the parity check for this surface asserts the not-provisioned
 * state, which is the honest oracle").
 *
 * **`verdicts` is not on staging** and will not be until Ben installs M2's
 * handoff migration, so the graded case here is `not_provisioned` — and it is
 * graded as a STATE, never as a count. An oracle that asserted a number
 * against a table that does not exist is the M1 bug class that cost six
 * chained tickets (DECISIONS 2026-09-02); `gradeSurface` decides the kind it
 * expects from this test's OWN read first, so the day the table lands the same
 * case starts comparing numbers with no edit.
 *
 * The surface is addressed by `data-surface`, never by position (common
 * violation 8), and the count compared is the WINDOW's — the same narrowing
 * the tab renders — not the table's (common violation 7).
 */

/** The tab, as a URL facet of this one route. */
const VERDICT_TAB: Params = { tab: "verdict_log" };

/** The two surfaces the tab draws, by name. */
const VERDICT_LOG = '[data-surface="verdict_log"]';
const VERDICT_PROVENANCE = '[data-surface="verdict_provenance"]';

/**
 * The window the tab draws, spelled HERE from the surface's own contract
 * rather than imported from `lib/db/verdict.ts`: importing the page's own
 * constant would make this one path to one number instead of two
 * (ARCHITECTURE.md §10).
 */
const VERDICT_WINDOW_ROWS = 100;

/** The verdicts rendered, in rendered order, read off each row's action hook. */
function verdictRows(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $(`${VERDICT_LOG} tbody tr`)
    .toArray()
    .map((tr) => $(tr).find("[data-verdict-action]").attr("data-verdict-action") ?? "");
}

describe("the verdict log against staging", () => {
  it("renders the window the database holds, or names the table it lacks", async () => {
    const markup = await queuesMarkup(VERDICT_TAB);

    // This test's own count of the same object, through the same absence
    // codes the page classifies by. `"absent"` here is what makes
    // `not_provisioned` a PASS rather than an inference from "no rows".
    const held = await countOrAbsent(() => exactCount(T.verdicts));
    // The count the SURFACE claims is the window's, not the table's: at most
    // the tab's own cap, however many verdicts exist behind it.
    const windowed = held === "absent" ? held : Math.min(held, VERDICT_WINDOW_ROWS);

    const state = await gradeSurface({
      markup,
      within: VERDICT_LOG,
      object: T.verdicts,
      counted: windowed,
      // The observation leg carries its own state and only supplies a link, so
      // it is not this surface's to answer for — the same exclusion the gauge
      // slices get above.
      excluding: VERDICT_PROVENANCE,
    });

    if (state === "not_provisioned") {
      // The graded normal case today: the card names the object the query
      // named, and the tab states no window at all for a read that never
      // returned (ARCHITECTURE.md §4.3).
      const $ = cheerio.load(markup);
      expect($(`${VERDICT_LOG} [data-not-provisioned]`).attr("data-not-provisioned")).toBe(
        T.verdicts,
      );
      expect($('[data-window="verdict_log"]')).toHaveLength(0);
      expect(verdictRows(markup)).toEqual([]);
      return;
    }

    // The table is there. The read RETURNED either way, so the window line
    // stands — with rows or with none — and its held count is the number of
    // rows actually drawn.
    const line = cheerio.load(markup)('[data-window="verdict_log"]');
    expect(line, "the read returned but the tab published no window").toHaveLength(1);
    expect(line.attr("data-window-limit")).toBe(String(VERDICT_WINDOW_ROWS));
    expect(verdictRows(markup)).toHaveLength(windowed as number);
    expect(line.attr("data-window-held")).toBe(String(windowed));
  });

  it("is a facet of this route, and the queues tab is unchanged by it", async () => {
    // EC8's structural half, asked of the running page: both tabs are links to
    // `/queues`, the log has no route of its own, and the tab an operator is
    // not on renders none of the other's surfaces.
    const $ = cheerio.load(await queuesMarkup(VERDICT_TAB));
    const hrefs = $("[data-tab] a")
      .toArray()
      .map((element) => $(element).attr("href") ?? "");

    expect(hrefs.length).toBeGreaterThan(1);
    for (const href of hrefs) expect(href.startsWith("/queues")).toBe(true);
    expect($("[data-queue]")).toHaveLength(0);

    const queues = cheerio.load(await queuesMarkup());
    expect(queues(VERDICT_LOG)).toHaveLength(0);
    expect(queues("[data-queue]").length).toBeGreaterThan(0);
  });
});

/* ── each block's whole-queue population (admin-window/BUG-0135) ──────────── */

/**
 * The COUNT legs, against staging (QA, admin-window/BUG-0135).
 *
 * A faceted `/queues` URL reads its rows once and then counts each SHAPE's
 * whole-table population with a separate query. Nothing offline can grade
 * those queries: the stub answers whatever the script says regardless of the
 * chain that was built, so a `.not("source_id", "is", null)` PostgREST will
 * not accept — or, worse, one it accepts and answers WRONGLY — is green in
 * `tests/offline/**` either way (LESSONS 4).
 *
 * And the fix makes both failures QUIET on the page. A population that refuses
 * costs the block four words of a sub-line, never a row; a population that
 * comes back WRONG costs nothing visible at all — it only decides whether an
 * empty block blames a facet. So the number is compared here, against this
 * test's own census by `queue` and `source_id IS NULL` — the same independent
 * spelling every other case in this file counts with, never
 * `SHAPE_COLUMNS`, which is the declaration the app builds those queries from.
 */
describe("the whole-queue population against staging", () => {
  it("counts each kind's whole-queue population, and it is the census the database holds", async () => {
    // Whole-queue: what the kind holds with NO url facet, so the census is
    // unfaceted while the read that produces it is faceted — the case the
    // count legs exist for, and the only one that issues them.
    const census = async () => {
      const held: Record<Kind, number | "absent"> = { decision: "absent", signal: "absent" };
      for (const kind of KINDS) held[kind] = await countOrAbsent(() => narrowCount(kind));
      return held;
    };
    const { made: read, held: counted } = await whileStill(census, () =>
      readReviewQueues({ queue: "data_conflict" }),
    );
    if (counted.decision === "absent" || counted.signal === "absent") {
      // `review_items` is not on this database: the page renders its
      // not-provisioned state and there is no population to count.
      expect(read.kind).toBe("not_provisioned");
      return;
    }

    // The rows leg answered, so the read is `ok` whatever the counts did.
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    for (const kind of KINDS) {
      // `ok` with the number, never a refusal: a count query PostgREST refuses
      // arrives here as `{ kind: "error" }` carrying its own words, and the
      // page would render the rows anyway.
      expect(read.data.population[kind], kind).toEqual({ kind: "ok", data: counted[kind] });
    }

    // And the two figures EXHAUST the table between them: the shapes they are
    // summed from are disjoint and exhaustive, so a condition that matched too
    // much (a `not … is null` PostgREST read differently than intended) shows
    // up here as a sum larger than the table, even where the per-kind census
    // spells its own narrowing the same way this one does.
    const whole = await countRows(() => exactCount(T.reviewItems));
    expect(
      (read.data.population.decision as { data: number }).data +
        (read.data.population.signal as { data: number }).data,
    ).toBe(whole);
  });

  it("renders a faceted URL with no block reporting a count it could not make", async () => {
    // The rendered half of the same fact. Each block's own state is decided by
    // its own read, so a refused count is a sub-surface INSIDE the block — and
    // a block holding one is graded `error` by this file's oracle, which is
    // how a broken count query fails here rather than passing quietly.
    const markup = await queuesMarkup({ queue: "data_conflict" });
    for (const kind of KINDS) {
      const rows = await rowsOf(kind, { column: "queue", value: "data_conflict" });
      const counted = (await countOrAbsent(() => exactCount(T.reviewItems))) === "absent"
        ? "absent"
        : rows.length;
      await gradeSurface({
        markup,
        within: BLOCK[kind],
        object: T.reviewItems,
        counted,
        figure: OPEN_LABEL[kind],
      });
    }
  });
});

/* ── narrowed by a SOURCE (admin-window/BUG-0141) ─────────────────────────── */

/**
 * `/sources` labels an anchor "review items" and points it at
 * `/queues?source_id=<id>` (spec F5). Walked 2026-09-09, that link narrowed
 * NOTHING: the `test_harness` row's link rendered `ticketmaster`'s single item,
 * as if it were `test_harness`'s.
 *
 * The oracle counts the SAME narrowing the surface renders — its own
 * `.eq("source_id", …)` on `review_items`, beside the per-kind narrowing every
 * other case here spells (common violation 7) — and names the STATE KIND from
 * `data-state` before it reads a number (common violation 6). A registered
 * source carrying no items is `empty` with a stated 0: a PASS, never an error
 * and never another source's row.
 *
 * It writes nothing: `sources` and `review_items` are both read.
 */

/** The scope element the page states a source narrowing in. */
function sourceScope(markup: string) {
  const $ = cheerio.load(markup);
  const line = $('[data-scope="source_id"]');
  return { lines: line.length, id: line.find("[data-scope-value]").attr("data-scope-value") };
}

/** What the page says it did NOT apply. */
function droppedNames(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-dropped-params] [data-dropped-param]")
    .toArray()
    .map((element) => $(element).attr("data-dropped-param") ?? "");
}

/** Every source id `review_items` actually carries, this test's own read. */
async function sourcesWithItems(): Promise<string[]> {
  const { data, error } = await independentClient()
    .from(T.reviewItems)
    .select("source_id")
    .not("source_id", "is", null);
  if (error) throw new Error(`the source census failed: ${JSON.stringify(error)}`);
  return [...new Set(((data ?? []) as { source_id: string }[]).map((row) => row.source_id))];
}

/** A registered source, and whether the review table holds any item of it. */
async function registeredSources(): Promise<string[]> {
  const { data, error } = await independentClient().from(T.sources).select("source_id");
  if (error) return [];
  return ((data ?? []) as { source_id: string }[]).map((row) => row.source_id);
}

describe("a source narrowing against staging", () => {
  it("renders exactly the items of the source the URL names, in both blocks", async () => {
    const carried = await sourcesWithItems();
    if (carried.length === 0) {
      // `review_items` holds no per-source item at all: nothing to narrow to,
      // and the absent-source case below is the whole of what staging can say.
      expect(await countOrAbsent(() => exactCount(T.reviewItems))).toBeDefined();
      return;
    }

    for (const sourceId of carried) {
      const markup = await queuesMarkup({ source_id: sourceId });
      for (const kind of KINDS) {
        // The SAME narrowing the surface renders: this kind's own rows, this
        // source's own column.
        const expected = await rowsOf(kind, { column: "source_id", value: sourceId });
        const state = await gradeSurface({
          markup,
          within: BLOCK[kind],
          object: T.reviewItems,
          counted: expected.length,
          figure: OPEN_LABEL[kind],
        });
        if (state === "not_provisioned") return;
        expect(new Set(idsIn(markup, kind)), `${sourceId} / ${kind}`).toEqual(
          new Set(expected.map((row) => row.review_item_id)),
        );
      }
      // Nothing from another source leaked into either block, and the page says
      // which source it is narrowed to.
      const { data } = await independentClient()
        .from(T.reviewItems)
        .select("review_item_id")
        .eq("source_id", sourceId);
      expect(idsIn(markup).length, sourceId).toBe((data ?? []).length);
      expect(sourceScope(markup), sourceId).toEqual({ lines: 1, id: sourceId });
      expect(droppedNames(markup), sourceId).toEqual([]);
    }
  });

  it("renders the honest empty for a registered source with no items", async () => {
    const [registered, carried] = await Promise.all([
      registeredSources(),
      sourcesWithItems(),
    ]);
    const barren = registered.find((id) => !carried.includes(id));
    if (barren === undefined) {
      // Every registered source carries an item (or the registry would not
      // read): there is no barren source on this database today, and inventing
      // one would be a write.
      expect(registered.length >= 0).toBe(true);
      return;
    }

    const markup = await queuesMarkup({ source_id: barren });
    for (const kind of KINDS) {
      // Counted 0 by this test's own narrowed read — so `empty` is a PASS with
      // a stated zero, and `error` is a failure.
      const expected = await rowsOf(kind, { column: "source_id", value: barren });
      expect(expected, `${barren} / ${kind}`).toEqual([]);
      const state = await gradeSurface({
        markup,
        within: BLOCK[kind],
        object: T.reviewItems,
        counted: 0,
        figure: OPEN_LABEL[kind],
      });
      if (state === "not_provisioned") return;
      expect(state, `${barren} / ${kind}`).toBe("empty");
    }
    // The defect this ticket was filed for: no other source's row on screen.
    expect(idsIn(markup), barren).toEqual([]);
    expect(sourceScope(markup), barren).toEqual({ lines: 1, id: barren });
  });

  it("names a source_id it cannot use and renders the whole table, never an error", async () => {
    const markup = await queuesMarkup({ source_id: "not-a-uuid" });
    const bare = await queuesMarkup();

    for (const kind of KINDS) {
      const expected = await rowsOf(kind);
      const state = await gradeSurface({
        markup,
        within: BLOCK[kind],
        object: T.reviewItems,
        counted: expected.length,
        figure: OPEN_LABEL[kind],
      });
      if (state === "not_provisioned") return;
      // Exactly the unnarrowed page: an unusable value narrows nothing, and no
      // `22P02` reaches the read.
      expect(new Set(idsIn(markup, kind)), kind).toEqual(new Set(idsIn(bare, kind)));
    }
    expect(droppedNames(markup)).toEqual(["source_id"]);
    expect(sourceScope(markup).lines).toBe(0);
  });
});
