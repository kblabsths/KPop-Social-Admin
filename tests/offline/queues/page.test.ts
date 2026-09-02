import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { EM_DASH, absoluteUtc } from "@/lib/format";
import { render } from "../ui/markup";
import { readNumber } from "../../live/parity";
import {
  reviewItemEdgePopulation,
  type ReviewItemRow,
} from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type Script,
} from "../../fixtures/stub-client";

/**
 * The Queues page, rendered (campaign admin-window/TASK-0010).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await QueuesPage(props))` — no jsdom, no Testing
 * Library, no database. The two reads are stubbed at their module boundary so
 * every state is reachable offline; the reads themselves are exercised in
 * `tests/offline/review/review-items.test.ts` and
 * `tests/offline/gauges/queue-health.test.ts`.
 *
 * **Every expectation about WHICH items render is computed here, from the
 * fixture population, with this file's own predicates** — `kindOf`, `shapeName`
 * and `inQueueOrder` below are written against the migration and the spec, not
 * imported from `src/lib/review/shapes.ts`. Acceptance test 4 says a filter
 * returns exactly the matching items; asking the app's own classifier what it
 * expects would only prove the page calls it.
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which ids render in which queue, in
 * what order, under which figure, in which state — plus the machine's own
 * strings where rendering them VERBATIM is the requirement (severity, shape,
 * status, the summary, the missing table). No class name and no copy of the
 * app's own words is pinned.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/review-items", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/review-items")>();
  return {
    ...actual,
    listReviewItems: (filter?: unknown) =>
      actual.listReviewItems(filter as never, readWith.client as never),
  };
});

vi.mock("@/lib/gauges/queue-health", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/queue-health")>();
  return {
    ...actual,
    readQueueHealth: (options?: unknown) =>
      actual.readQueueHealth((options ?? {}) as never, readWith.client as never),
  };
});

const queuesModule = await import("@/app/queues/page");
const QueuesPage = queuesModule.default;

/* ── the population, and this file's own reading of it ───────────────────── */

/**
 * All three shapes in BOTH statuses, plus the rows the schema permits and the
 * happy path never produces (a `data_conflict` row carrying a `source_id`, an
 * `entity_link` row carrying both subjects, two rows on the same instant
 * spelled `Z` and `+00:00`). Deliberately not in queue order.
 */
const POPULATION = reviewItemEdgePopulation();

/** The three shapes, spelled from spec §6 rather than imported. */
const SHAPE_NAMES = [
  "data_conflict_fact",
  "entity_link_fact",
  "entity_link_source_pattern",
] as const;

const QUEUE_NAMES = ["data_conflict", "entity_link"] as const;
const KIND_NAMES = ["decision", "signal"] as const;
const STATUS_NAMES = ["open", "settled"] as const;

/**
 * The shape of a row: `source_id` is the whole discriminator (migration
 * `20260901000002` — a subject is either a FACT or a SOURCE), and the
 * `data_conflict` queue has no per-source subject.
 */
function shapeName(item: ReviewItemRow): string {
  if (item.queue !== "entity_link") return SHAPE_NAMES[0];
  return item.source_id === null ? SHAPE_NAMES[1] : SHAPE_NAMES[2];
}

/** Spec §6: the source-pattern item is the signal; the two fact items are decisions. */
function kindOf(item: ReviewItemRow): string {
  return shapeName(item) === SHAPE_NAMES[2] ? "signal" : "decision";
}

/** Spec §4's order: open first, then severity, then age, then the id. */
function inQueueOrder(items: ReviewItemRow[]): ReviewItemRow[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    const age = Date.parse(a.opened_at) - Date.parse(b.opened_at);
    if (age !== 0) return age;
    return a.review_item_id < b.review_item_id ? -1 : 1;
  });
}

/** Every row of the population the URL's facets keep. */
function matching(params: Record<string, string> = {}): ReviewItemRow[] {
  return POPULATION.filter(
    (item) =>
      (params.queue === undefined || item.queue === params.queue) &&
      (params.status === undefined || item.status === params.status) &&
      (params.shape === undefined || shapeName(item) === params.shape) &&
      (params.kind === undefined || kindOf(item) === params.kind),
  );
}

function idsOf(items: ReviewItemRow[]): string[] {
  return items.map((item) => item.review_item_id);
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function healthyScript(overrides: Script = {}): Script {
  return {
    [T.reviewItems]: { data: POPULATION, count: POPULATION.length },
    ...overrides,
  };
}

async function renderQueues(
  script: Script,
  params: Record<string, string | string[]> = {},
): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await QueuesPage({ searchParams: Promise.resolve(params) }));
}

/* ── reading the markup, structurally ────────────────────────────────────── */

/** The two queue blocks, in rendered order. */
function blocksOf(markup: string) {
  const $ = cheerio.load(markup);
  return { $, blocks: $("[data-queue]").toArray() };
}

/** The item ids the named queue rendered, in rendered order. */
function idsIn(markup: string, kind?: string): string[] {
  const $ = cheerio.load(markup);
  const scope = kind === undefined ? "" : `[data-queue="${kind}"] `;
  return $(`${scope}[data-item]`)
    .toArray()
    .map((element) => $(element).attr("data-item") ?? "");
}

/** The `<tr>` carrying one item, as its cell hooks and text. */
function rowOf(markup: string, id: string) {
  const $ = cheerio.load(markup);
  const row = $(`[data-item="${id}"]`).closest("tr");
  return {
    href: $(`[data-item="${id}"]`).attr("href"),
    text: row.text().replace(/\s+/g, " ").trim(),
    severity: row.find("[data-severity]").attr("data-severity"),
    shape: row.find("[data-shape]").attr("data-shape"),
    status: row.find("[data-status]").attr("data-status"),
    folds: row.find("[data-folds]").attr("data-folds"),
    titles: row
      .find("[title]")
      .toArray()
      .map((element) => $(element).attr("title")),
  };
}

/** The chips of one facet: their labels, hrefs and active state. */
function chipsOf(markup: string, facet: string) {
  const $ = cheerio.load(markup);
  return $(`[data-facet="${facet}"] a`)
    .toArray()
    .map((element) => ({
      label: $(element).text().trim(),
      href: $(element).attr("href") ?? "",
      active: $(element).attr("aria-current") === "true",
    }));
}

function textOf(markup: string): string {
  return cheerio.load(markup).root().text();
}

/* ── two queues of equal standing ────────────────────────────────────────── */

describe("the two queues", () => {
  it("renders exactly two, one per kind", async () => {
    const markup = await renderQueues(healthyScript());
    const { $, blocks } = blocksOf(markup);

    expect(blocks.map((block) => $(block).attr("data-queue"))).toEqual([
      ...KIND_NAMES,
    ]);
  });

  it("gives them equal standing — same parent, same element, same classes", async () => {
    const markup = await renderQueues(healthyScript());
    const { $, blocks } = blocksOf(markup);

    // Siblings of one parent: neither is nested inside, beside or beneath the
    // other (LOOK_AND_FEEL quality bar 2).
    expect($(blocks[0]).parent().get(0)).toBe($(blocks[1]).parent().get(0));
    expect($(blocks[0]).find("[data-queue]")).toHaveLength(0);
    expect($(blocks[1]).find("[data-queue]")).toHaveLength(0);
    // Same element and same classes: neither is styled as the primary inbox,
    // so neither can be wider or of a different type scale.
    expect(blocks[0].tagName).toBe(blocks[1].tagName);
    expect($(blocks[0]).attr("class")).toBe($(blocks[1]).attr("class"));
    // The heading of each is the same level, and there is one per queue.
    expect($(blocks[0]).find("h2")).toHaveLength(1);
    expect($(blocks[1]).find("h2")).toHaveLength(1);
  });

  it("keeps them equal when a filter empties one of them", async () => {
    // Arriving from the Dashboard's "open signals" link must not delete the
    // decision queue: equal standing is a property of the page, not of the
    // unfiltered page.
    const markup = await renderQueues(healthyScript(), { kind: "signal" });
    const { $, blocks } = blocksOf(markup);

    expect(blocks).toHaveLength(2);
    expect($(blocks[0]).attr("class")).toBe($(blocks[1]).attr("class"));
    expect(idsIn(markup, "decision")).toEqual([]);
    expect(idsIn(markup, "signal").length).toBeGreaterThan(0);
  });

  it("splits the population by kind, with nothing in both and nothing dropped", async () => {
    const markup = await renderQueues(healthyScript());

    for (const kind of KIND_NAMES) {
      expect(new Set(idsIn(markup, kind)), kind).toEqual(
        new Set(idsOf(matching({ kind }))),
      );
    }
    expect(idsIn(markup).length).toBe(POPULATION.length);
  });

  it("counts the open items of the view it rendered", async () => {
    // `?status=settled` renders a real zero: every item on screen is settled,
    // and the figure counts what is shown rather than the whole table. (The
    // line beside it names that scope, so the zero cannot be read as "nothing
    // is open" — wording, and so not pinned here.)
    const markup = await renderQueues(healthyScript(), { status: "settled" });
    expect(matching({ kind: "decision", status: "settled" }).length).toBeGreaterThan(0);
    expect(matching({ kind: "decision", status: "open" }).length).toBeGreaterThan(0);

    expect(readNumber(markup, "Open decisions")).toBe(0);
  });

  it("states its sort on screen, in each queue", async () => {
    // LOOK_AND_FEEL bar 6: a ranked list states its sort. The words are the
    // contract's own ("open first, severity then age"), which is why this
    // asserts them and nothing else about the copy.
    const markup = await renderQueues(healthyScript());
    const { $, blocks } = blocksOf(markup);

    for (const block of blocks) {
      const said = $(block).text().toLowerCase();
      expect(said, $(block).attr("data-queue")).toContain("open first");
      expect(said).toContain("severity");
      expect(said).toContain("age");
    }
  });

  it("shows each queue's open count under its own figure", async () => {
    // Quality bar 1: the Queues page answers "how much is open in each queue"
    // above the fold. Counted here from the population, independently.
    const markup = await renderQueues(healthyScript());

    expect(readNumber(markup, "Open decisions")).toBe(
      matching({ kind: "decision", status: "open" }).length,
    );
    expect(readNumber(markup, "Open signals")).toBe(
      matching({ kind: "signal", status: "open" }).length,
    );
  });
});

/* ── the order ───────────────────────────────────────────────────────────── */

describe("the order", () => {
  it("renders each queue open first, then severity, then age", async () => {
    const markup = await renderQueues(healthyScript());

    for (const kind of KIND_NAMES) {
      expect(idsIn(markup, kind), kind).toEqual(
        idsOf(inQueueOrder(matching({ kind }))),
      );
    }
  });

  it("keeps settled items browsable, below the open ones", async () => {
    const markup = await renderQueues(healthyScript());

    for (const kind of KIND_NAMES) {
      const rendered = idsIn(markup, kind);
      const settled = idsOf(matching({ kind, status: "settled" }));
      expect(settled.length, kind).toBeGreaterThan(0);
      for (const id of settled) expect(rendered).toContain(id);
      const firstSettled = rendered.findIndex((id) => settled.includes(id));
      const lastOpen = rendered.reduce(
        (last, id, index) => (settled.includes(id) ? last : index),
        -1,
      );
      expect(firstSettled, kind).toBeGreaterThan(lastOpen);
    }
  });

  it("breaks a tie on the id, whichever way the instant was spelled", async () => {
    // The population holds two items on the same instant, one spelled `Z` and
    // one `+00:00`; a lexical comparison of those two strings disagrees with
    // the instants they name.
    const markup = await renderQueues(healthyScript());
    const tied = POPULATION.filter(
      (item) => Date.parse(item.opened_at) === Date.parse("2026-08-11T00:00:00Z"),
    );
    expect(tied.length).toBeGreaterThan(1);

    const rendered = idsIn(markup, "decision");
    const positions = idsOf(inQueueOrder(tied)).map((id) => rendered.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

/* ── the filters: exactly the matching items ─────────────────────────────── */

describe("every filter returns exactly the matching items", () => {
  const cases: Record<string, string>[] = [
    {},
    ...QUEUE_NAMES.map((queue) => ({ queue })),
    ...SHAPE_NAMES.map((shape) => ({ shape })),
    ...KIND_NAMES.map((kind) => ({ kind })),
    ...STATUS_NAMES.map((status) => ({ status })),
  ];

  for (const params of cases) {
    const name = Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    it(`renders exactly the items matching ${name === "" ? "no filter" : name}`, async () => {
      const markup = await renderQueues(healthyScript(), params);
      const rendered = idsIn(markup);
      const expected = idsOf(matching(params));

      // No extras, none missing, and no item rendered twice.
      expect(new Set(rendered)).toEqual(new Set(expected));
      expect(rendered).toHaveLength(expected.length);
    });
  }

  it("combines two facets with AND", async () => {
    const params = { queue: "entity_link", status: "open" };
    const markup = await renderQueues(healthyScript(), params);

    expect(new Set(idsIn(markup))).toEqual(new Set(idsOf(matching(params))));
    expect(idsIn(markup).length).toBeGreaterThan(0);
  });

  it("renders no rows at all for a combination nothing matches", async () => {
    // `data_conflict` items are decisions by construction, so this pair is
    // empty for any population.
    const params = { queue: "data_conflict", kind: "signal" };
    expect(matching(params)).toHaveLength(0);

    const markup = await renderQueues(healthyScript(), params);
    expect(idsIn(markup)).toEqual([]);
    expect(cheerio.load(markup)("[data-queue] table")).toHaveLength(0);
    // Both queues still stand, and each says why it holds nothing.
    expect(cheerio.load(markup)("[data-queue]")).toHaveLength(2);
    expect(textOf(markup).length).toBeGreaterThan(0);
  });

  it("shows the whole table when the URL names a value that does not exist", async () => {
    const markup = await renderQueues(healthyScript(), { shape: "not_a_shape" });
    expect(new Set(idsIn(markup))).toEqual(new Set(idsOf(POPULATION)));
  });

  it("marks the chip the URL is on, for every facet", async () => {
    const markup = await renderQueues(healthyScript(), {
      kind: "signal",
      status: "settled",
    });

    const active = (facet: string) =>
      chipsOf(markup, facet).filter((chip) => chip.active).map((chip) => chip.label);
    expect(active("kind")).toEqual(["signal"]);
    expect(active("status")).toEqual(["settled"]);
    // The facets the URL says nothing about are on their "all" chip, which is
    // the first of each group.
    expect(active("queue")).toHaveLength(1);
    expect(active("shape")).toHaveLength(1);
    expect(active("queue")[0]).toBe(chipsOf(markup, "queue")[0].label);
  });

  it("offers a chip for every value of every facet", async () => {
    const markup = await renderQueues(healthyScript());

    expect(chipsOf(markup, "shape").map((chip) => chip.label).slice(1)).toEqual([
      ...SHAPE_NAMES,
    ]);
    expect(chipsOf(markup, "queue").map((chip) => chip.label).slice(1)).toEqual([
      ...QUEUE_NAMES,
    ]);
    expect(chipsOf(markup, "kind").map((chip) => chip.label).slice(1)).toEqual([
      ...KIND_NAMES,
    ]);
    expect(chipsOf(markup, "status").map((chip) => chip.label).slice(1)).toEqual([
      ...STATUS_NAMES,
    ]);
  });

  it("keeps the state in the URL, so every filtered view is a link", async () => {
    const markup = await renderQueues(healthyScript(), { kind: "decision" });

    for (const chip of chipsOf(markup, "status").slice(1)) {
      const url = new URL(chip.href, "https://x.invalid");
      expect(url.pathname).toBe("/queues");
      expect(url.searchParams.get("kind")).toBe("decision");
      expect(url.searchParams.get("status")).toBe(chip.label);
    }
  });
});

/* ── a row reads as one sentence ─────────────────────────────────────────── */

describe("a row", () => {
  it("carries what happened, how old, and how many times folded", async () => {
    const markup = await renderQueues(healthyScript());

    for (const item of POPULATION) {
      const row = rowOf(markup, item.review_item_id);
      expect(row.text, item.review_item_id).toContain(item.summary);
      // The registry's own words, verbatim — no score, no rank beside them.
      expect(row.severity).toBe(item.severity);
      expect(row.status).toBe(item.status);
      expect(row.shape).toBe(shapeName(item));
      expect(row.folds).toBe(String(item.folded_count));
      // Relative age, with the absolute instant in the title (Voice bar 6).
      expect(row.titles).toContain(absoluteUtc(item.opened_at));
    }
  });

  it("opens the item's own detail page", async () => {
    const markup = await renderQueues(healthyScript());

    for (const item of POPULATION) {
      expect(rowOf(markup, item.review_item_id).href).toBe(
        `/queues/${item.review_item_id}`,
      );
    }
  });

  it("shows no severity number anywhere — the ranking formula is parked", async () => {
    const markup = await renderQueues(healthyScript());
    const $ = cheerio.load(markup);

    for (const cell of $("[data-severity]").toArray()) {
      const text = $(cell).text().trim();
      expect(["high", "low"]).toContain(text);
    }
    expect(textOf(markup)).not.toContain("%");
  });
});

/* ── nothing settles anything in M1 ──────────────────────────────────────── */

describe("no settle control", () => {
  it("renders no control that could write anything", async () => {
    const markup = await renderQueues(healthyScript());
    const $ = cheerio.load(markup);

    for (const control of ["form", "button", "input", "select", "textarea"]) {
      expect($(control), control).toHaveLength(0);
    }
    // Every interactive element on the page is a link.
    expect($("a").length).toBeGreaterThan(0);
  });
});

/* ── the queue-health gauge ──────────────────────────────────────────────── */

describe("the queue-health gauge", () => {
  it("renders one slice per queue with the open count that queue holds", async () => {
    const markup = await renderQueues(healthyScript());
    const $ = cheerio.load(markup);

    expect(
      $("[data-gauge-queue]")
        .toArray()
        .map((element) => $(element).attr("data-gauge-queue")),
    ).toEqual([...QUEUE_NAMES]);

    for (const queue of QUEUE_NAMES) {
      expect(readNumber(markup, `${queue} open`), queue).toBe(
        matching({ queue, status: "open" }).length,
      );
    }
  });

  it("counts folded items per queue from the rows it read", async () => {
    const markup = await renderQueues(healthyScript());

    for (const queue of QUEUE_NAMES) {
      expect(readNumber(markup, `${queue} folded`), queue).toBe(
        matching({ queue }).filter((item) => item.folded_count > 0).length,
      );
    }
  });

  it("renders the age distribution and the weekly series", async () => {
    const markup = await renderQueues(healthyScript());
    const $ = cheerio.load(markup);

    for (const queue of QUEUE_NAMES) {
      expect($(`table[aria-label="${queue} open age"]`), queue).toHaveLength(1);
      const weeks = $(`table[aria-label="${queue} by week"] tbody tr`);
      expect(weeks.length, queue).toBeGreaterThan(0);
    }
  });

  it("renders every settled-per-week cell as a dash, never a zero", async () => {
    // No column records when an item settled (`verdicts` is M2's), so a zero
    // there would read as "nothing settled" instead of "not knowable".
    const markup = await renderQueues(healthyScript());
    const $ = cheerio.load(markup);

    for (const queue of QUEUE_NAMES) {
      const cells = $(`table[aria-label="${queue} by week"] tbody tr`)
        .toArray()
        .map((row) => $(row).find("td").last().text().trim());
      expect(cells.length, queue).toBeGreaterThan(0);
      for (const cell of cells) expect(cell, queue).toBe(EM_DASH);
    }
  });
});

/* ── the states ──────────────────────────────────────────────────────────── */

describe("against a database without the review table", () => {
  const absent: Script = {
    [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
  };

  it("renders, names the missing table on every surface, and throws nothing", async () => {
    const markup = await renderQueues(absent);
    const $ = cheerio.load(markup);

    expect(markup.length).toBeGreaterThan(0);
    // Both queues and the gauge each say which object is missing.
    for (const block of $("[data-queue]").toArray()) {
      expect($(block).text(), $(block).attr("data-queue")).toContain(T.reviewItems);
    }
    expect(textOf(markup)).toContain(T.reviewItems);
  });

  it("shows no count and no table — a missing table is never a zero", async () => {
    const markup = await renderQueues(absent);
    const $ = cheerio.load(markup);

    expect($("table")).toHaveLength(0);
    expect(textOf(markup)).not.toMatch(/(?<!\d)0(?!\d)/);
    expect(() => readNumber(markup, "Open decisions")).toThrow();
  });

  it("keeps the filters usable, so the state is still reachable", async () => {
    const markup = await renderQueues(absent, { kind: "signal" });
    expect(chipsOf(markup, "kind").filter((chip) => chip.active)).toHaveLength(1);
  });
});

describe("when a read fails", () => {
  it("names the read that refused, on each surface, and keeps the headers", async () => {
    const markup = await renderQueues({
      [T.reviewItems]: { error: permissionDenied(T.reviewItems) },
    });
    const $ = cheerio.load(markup);
    const lines = $('[role="alert"]')
      .toArray()
      .map((element) => $(element).text());

    // Two queues plus the gauge, each reporting its own read.
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toContain(T.reviewItems);
    // The error is a LINE inside each list, so the table header stays put.
    expect($('[data-queue] table')).toHaveLength(2);
    expect(idsIn(markup)).toEqual([]);
  });

  it("carries the client's whole account of a transport failure, untrimmed", async () => {
    const markup = await renderQueues({
      [T.reviewItems]: { error: transportFailure() },
    });
    const text = textOf(markup);

    expect(text).toContain("Caused by");
    expect(text).toContain("makeNetworkError");
  });

  it("refuses rather than rendering a partial list when the read has no count", async () => {
    // A complete read that came back without a count is a refusal, never a
    // number of our own (ARCHITECTURE.md §4.3): the page shows no items and
    // names the read.
    const markup = await renderQueues({ [T.reviewItems]: { data: POPULATION } });

    expect(idsIn(markup)).toEqual([]);
    expect(textOf(markup)).toContain(T.reviewItems);
    expect(() => readNumber(markup, "Open decisions")).toThrow();
  });

  it("refuses rather than rendering a truncated list", async () => {
    // The database holds more rows than the read returned: an `ok` array must
    // never be a partial answer on a page that promises exactness.
    const markup = await renderQueues({
      [T.reviewItems]: { data: POPULATION, count: POPULATION.length + 7 },
    });

    expect(idsIn(markup)).toEqual([]);
    expect(textOf(markup)).toContain(T.reviewItems);
    // No paging offer and no "showing N of M": the refusal is the answer.
    expect(textOf(markup)).not.toMatch(/showing\s+\d+\s+of\s+\d+/i);
  });
});

describe("with the table present and empty", () => {
  it("says what each queue holds and what fills it, and shows a real zero", async () => {
    const markup = await renderQueues({ [T.reviewItems]: { data: [], count: 0 } });
    const $ = cheerio.load(markup);

    expect($("[data-queue]")).toHaveLength(2);
    expect($("[data-queue] table")).toHaveLength(0);
    expect(idsIn(markup)).toEqual([]);
    for (const block of $("[data-queue]").toArray()) {
      expect($(block).text().trim().length).toBeGreaterThan(0);
    }
    // The gauge read the same empty table and reports zeros it really counted.
    expect(readNumber(markup, "data_conflict open")).toBe(0);
  });
});

/* ── the route ───────────────────────────────────────────────────────────── */

describe("the route", () => {
  it("renders per request, never prerendered at build with no credential", async () => {
    expect(queuesModule.dynamic).toBe("force-dynamic");
  });

  it("renders standing alone, with no searchParams at all", async () => {
    readWith.client = stubClient(healthyScript()).asSupabaseClient();
    const markup = render(await QueuesPage());

    expect(markup.length).toBeGreaterThan(0);
    expect(new Set(idsIn(markup))).toEqual(new Set(idsOf(POPULATION)));
  });
});

/* ── the URL as an operator (or a stale bookmark) can actually spell it ───── */

/**
 * `searchParams` the way Next hands a REAL query string over: the value for a
 * key, or an array of them when the key repeats
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
 *
 * The cases above pass parameter objects; these drive the whole URL path —
 * percent-encoding, repeats, empty values and all — because that is what the
 * Dashboard's link and a hand-edited address bar actually deliver.
 */
function paramsOf(query: string): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const key of new URLSearchParams(query).keys()) {
    const values = new URLSearchParams(query).getAll(key);
    params[key] = values.length === 1 ? values[0] : values;
  }
  return params;
}

describe("a hand-edited URL", () => {
  /**
   * Each case: the query string, and the narrowing it is allowed to apply.
   * `{}` means "narrows nothing" — an unusable value shows the whole table
   * rather than an empty page that reads as an empty database.
   */
  const cases: [string, Record<string, string>][] = [
    // Contradictory but individually valid: a `data_conflict` row is a fact
    // item by construction, so this pair matches nothing and must render
    // EXACTLY nothing — the AND is real, not "the second one wins".
    [
      "shape=entity_link_fact&queue=data_conflict",
      { shape: "entity_link_fact", queue: "data_conflict" },
    ],
    ["kind=decision&shape=entity_link_source_pattern", {
      kind: "decision",
      shape: "entity_link_source_pattern",
    }],
    // A repeated key is ambiguous state; the first value is the answer.
    ["kind=decision&kind=signal", { kind: "decision" }],
    ["status=open&status=settled", { status: "open" }],
    // Unusable values, every way one arrives.
    ["kind=Decision", {}],
    ["kind=decision%20", {}],
    ["queue=", {}],
    ["queue=decision", {}],
    ["shape=entity_link_fact%2Cin_window", {}],
    [`shape=${"x".repeat(10_000)}`, {}],
  ];

  for (const [query, expected] of cases) {
    const name = query.length > 60 ? `${query.slice(0, 40)}… (${query.length} chars)` : query;

    it(`renders exactly the items ?${name} matches`, async () => {
      const markup = await renderQueues(healthyScript(), paramsOf(query));
      const rendered = idsIn(markup);

      expect(new Set(rendered)).toEqual(new Set(idsOf(matching(expected))));
      expect(rendered).toHaveLength(matching(expected).length);
      // Whatever the URL said, both queues still stand and nothing writes.
      expect(cheerio.load(markup)("[data-queue]")).toHaveLength(2);
      for (const control of ["form", "button", "input", "select", "textarea"]) {
        expect(cheerio.load(markup)(control), control).toHaveLength(0);
      }
    });
  }

  it("renders nothing at all for the two contradictory pairs", async () => {
    // The pins above are only worth something if these pairs really are empty.
    expect(matching({ shape: "entity_link_fact", queue: "data_conflict" })).toHaveLength(0);
    expect(matching({ kind: "decision", shape: "entity_link_source_pattern" })).toHaveLength(0);

    const markup = await renderQueues(
      healthyScript(),
      paramsOf("shape=entity_link_fact&queue=data_conflict"),
    );
    expect(idsIn(markup)).toEqual([]);
    expect(cheerio.load(markup)("[data-queue] table")).toHaveLength(0);
  });

  it("never echoes an oversized value back into the page", async () => {
    // A rejected value must not survive into a chip href or an attribute:
    // the page reflects only what it understood.
    const long = "x".repeat(10_000);
    const markup = await renderQueues(healthyScript(), paramsOf(`shape=${long}`));

    expect(markup).not.toContain("x".repeat(200));
    for (const chip of chipsOf(markup, "shape")) {
      expect(chip.href.length).toBeLessThan(200);
    }
  });

  it("lands filtered on the link the Dashboard sends, with the other queue intact", async () => {
    // SEAM (admin-window/TASK-0009 → TASK-0010): the Dashboard's attention
    // counts link to `/queues?kind=decision|signal`. Driven here as the query
    // string it emits, so a parameter renamed on either side of the seam
    // shows up as items in the wrong queue rather than as a link that
    // silently opens the unfiltered page.
    for (const kind of KIND_NAMES) {
      const markup = await renderQueues(healthyScript(), paramsOf(`kind=${kind}`));

      expect(new Set(idsIn(markup)), kind).toEqual(new Set(idsOf(matching({ kind }))));
      expect(idsIn(markup, kind).length, kind).toBeGreaterThan(0);
      // Equal standing survives the arrival: the other queue is still there.
      expect(cheerio.load(markup)("[data-queue]"), kind).toHaveLength(2);
    }
  });
});
