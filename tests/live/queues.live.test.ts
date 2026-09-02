import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import QueuesPage from "@/app/queues/page";
import { T } from "@/lib/db/tables";
import { assertParity, countRows, independentClient, readNumber, renderPage } from "./parity";

/**
 * The Queues page against staging (campaign admin-window/TASK-0010).
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
 * This file WRITES NOTHING, so it needs no sweep (acceptance test 13); every
 * query here is a select.
 *
 * It refuses to run at all until `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SERVICE_ROLE_KEY` are set and `agenticflow/docs/SERVICES.md`
 * declares the target — `tests/live/setup.ts` throws first, non-zero, with the
 * missing name. That refusal is the correct state today and is not a failure
 * of this file.
 *
 * Where staging does not carry `review_items` at all (ARCHITECTURE.md §12
 * `OPEN-FIXTURES`), each case asserts the honest not-provisioned rendering
 * instead, naming the table. It never skips silently.
 */

type Params = Record<string, string>;

/** The page as the URL renders it. Every read happens per request. */
async function queuesMarkup(params: Params = {}): Promise<string> {
  return renderPage(QueuesPage, { searchParams: Promise.resolve(params) });
}

/** Did the lists render at all, or is this the not-provisioned state? */
function listsRendered(markup: string): boolean {
  return cheerio.load(markup)("[data-queue] table").length > 0;
}

/** The item ids the named queue rendered, in rendered order. */
function idsIn(markup: string, kind?: string): string[] {
  const $ = cheerio.load(markup);
  const scope = kind === undefined ? "" : `[data-queue="${kind}"] `;
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

/** The test's own count query, before any narrowing. */
function itemCount() {
  return independentClient()
    .from(T.reviewItems)
    .select("*", { head: true, count: "exact" });
}

/** The PostgREST spelling of "this item is a signal" / "…a decision". */
const SIGNAL = (query: ReturnType<typeof items>) =>
  query.eq("queue", "entity_link").not("source_id", "is", null);
const DECISION = (query: ReturnType<typeof items>) =>
  query.or("queue.eq.data_conflict,and(queue.eq.entity_link,source_id.is.null)");

describe("the two queues against staging", () => {
  it("renders the open decision count the database holds", async () => {
    const markup = await queuesMarkup();
    if (!listsRendered(markup)) {
      expect(markup).toContain(T.reviewItems);
      return;
    }

    await assertParity({
      markup,
      label: "Open decisions",
      expected: () =>
        countRows(() =>
          independentClient()
            .from(T.reviewItems)
            .select("*", { head: true, count: "exact" })
            .eq("status", "open")
            .or("queue.eq.data_conflict,and(queue.eq.entity_link,source_id.is.null)"),
        ),
    });
  });

  it("renders the open signal count the database holds", async () => {
    const markup = await queuesMarkup();
    if (!listsRendered(markup)) {
      expect(markup).toContain(T.reviewItems);
      return;
    }

    await assertParity({
      markup,
      label: "Open signals",
      expected: () =>
        countRows(() =>
          independentClient()
            .from(T.reviewItems)
            .select("*", { head: true, count: "exact" })
            .eq("status", "open")
            .eq("queue", "entity_link")
            .not("source_id", "is", null),
        ),
    });
  });

  it("renders every row the table holds, split between the two queues", async () => {
    // The list is a COMPLETE read (ARCHITECTURE.md §4.3): with no filter, the
    // ids on screen are every id in the table — no paging, nothing dropped.
    const markup = await queuesMarkup();
    if (!listsRendered(markup)) {
      expect(markup).toContain(T.reviewItems);
      return;
    }

    const whole = await countRows(() => itemCount());
    const rendered = idsIn(markup);
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(rendered).toHaveLength(whole);

    for (const [kind, narrow] of [
      ["decision", DECISION],
      ["signal", SIGNAL],
    ] as const) {
      const { data, error } = await narrow(items());
      if (error) throw new Error(`the ${kind} query failed: ${error.message}`);
      const expected = (data ?? []) as { review_item_id: string }[];
      expect(new Set(idsIn(markup, kind)), kind).toEqual(
        new Set(expected.map((row) => row.review_item_id)),
      );
    }
  });

  it("orders each queue open first, then severity, then age", async () => {
    const markup = await queuesMarkup();
    if (!listsRendered(markup)) {
      expect(markup).toContain(T.reviewItems);
      return;
    }

    for (const [kind, narrow] of [
      ["decision", DECISION],
      ["signal", SIGNAL],
    ] as const) {
      const { data, error } = await narrow(items());
      if (error) throw new Error(`the ${kind} query failed: ${error.message}`);
      const rows = (data ?? []) as {
        review_item_id: string;
        severity: string;
        status: string;
        opened_at: string;
      }[];
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
    for (const [facet, value, narrow] of [
      ["queue", "data_conflict", (q: ReturnType<typeof items>) => q.eq("queue", "data_conflict")],
      ["queue", "entity_link", (q: ReturnType<typeof items>) => q.eq("queue", "entity_link")],
      ["status", "open", (q: ReturnType<typeof items>) => q.eq("status", "open")],
      ["status", "settled", (q: ReturnType<typeof items>) => q.eq("status", "settled")],
    ] as const) {
      const markup = await queuesMarkup({ [facet]: value });
      if (!listsRendered(markup)) {
        expect(markup).toContain(T.reviewItems);
        return;
      }
      const { data, error } = await narrow(items());
      if (error) throw new Error(`the ${facet}=${value} query failed: ${error.message}`);
      const expected = (data ?? []) as { review_item_id: string }[];

      expect(new Set(idsIn(markup)), `${facet}=${value}`).toEqual(
        new Set(expected.map((row) => row.review_item_id)),
      );
      expect(idsIn(markup), `${facet}=${value}`).toHaveLength(expected.length);
    }
  });

  it("returns exactly the matching items for every shape value", async () => {
    // The three shapes, spelled from spec §6: the discriminator is `source_id`.
    for (const [shape, narrow] of [
      [
        "data_conflict_fact",
        (q: ReturnType<typeof items>) => q.eq("queue", "data_conflict"),
      ],
      [
        "entity_link_fact",
        (q: ReturnType<typeof items>) =>
          q.eq("queue", "entity_link").is("source_id", null),
      ],
      [
        "entity_link_source_pattern",
        (q: ReturnType<typeof items>) =>
          q.eq("queue", "entity_link").not("source_id", "is", null),
      ],
    ] as const) {
      const markup = await queuesMarkup({ shape });
      if (!listsRendered(markup)) {
        expect(markup).toContain(T.reviewItems);
        return;
      }
      const { data, error } = await narrow(items());
      if (error) throw new Error(`the ${shape} query failed: ${error.message}`);
      const expected = (data ?? []) as { review_item_id: string }[];

      expect(new Set(idsIn(markup)), shape).toEqual(
        new Set(expected.map((row) => row.review_item_id)),
      );
      expect(idsIn(markup), shape).toHaveLength(expected.length);
    }
  });
});

describe("the queue-health gauge against staging", () => {
  it("renders each queue's open count over its own window", async () => {
    const markup = await queuesMarkup();
    const $ = cheerio.load(markup);
    if ($("[data-gauge-queue]").length === 0) {
      expect(markup).toContain(T.reviewItems);
      return;
    }

    // The gauge is a WINDOW read, not a total: its figure counts the items
    // opened inside the window it names, so the whole-table count is its
    // ceiling and never its equal by definition.
    const whole = await countRows(() => itemCount().eq("status", "open"));
    // Read the figure by its LABEL, the way every other parity assertion in
    // this suite does. A regex over the slice's text cannot: `.text()`
    // concatenates the figure with the severity sub-line beside it, so an
    // open count of 4 followed by "1 high, 3 low" reads back as 41 — measured
    // on the offline edge population 2026-09-02 (4 -> 41, 3 -> 31), which
    // would fail this assertion against correct code.
    for (const queue of ["data_conflict", "entity_link"]) {
      expect(readNumber(markup, `${queue} open`), queue).toBeLessThanOrEqual(whole);
    }
  });
});
