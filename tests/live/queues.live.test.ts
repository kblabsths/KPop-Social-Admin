import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import QueuesPage from "@/app/queues/page";
import { T } from "@/lib/db/tables";
import {
  assertParity,
  countOrAbsent,
  countRows,
  exactCount,
  gradeSurface,
  independentClient,
  readNumber,
  renderPage,
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

describe("the queue-health gauge against staging", () => {
  it("renders each queue's open count over its own window", async () => {
    const markup = await queuesMarkup();
    // The gauge is its own read of the same table, so it is its own surface
    // with its own state — graded before a figure is read off it.
    const open = await countOrAbsent(() => exactCount(T.reviewItems).eq("status", "open"));
    const state = await gradeSurface({
      markup,
      within: HEALTH,
      object: T.reviewItems,
      counted: open,
    });
    if (state !== "ok" || open === "absent") return;

    // The gauge is a WINDOW read, not a total: its figure counts the items
    // opened inside the window it names, so the open count is its ceiling and
    // never its equal by definition.
    //
    // Read the figure by its LABEL, the way every other parity assertion in
    // this suite does. A regex over the slice's text cannot: `.text()`
    // concatenates the figure with the severity sub-line beside it, so an
    // open count of 4 followed by "1 high, 3 low" reads back as 41 — measured
    // on the offline edge population 2026-09-02 (4 -> 41, 3 -> 31), which
    // would fail this assertion against correct code.
    for (const queue of ["data_conflict", "entity_link"]) {
      expect(readNumber(markup, `${queue} open`), queue).toBeLessThanOrEqual(open);
    }
  });
});
