import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { EM_DASH, absoluteUtc } from "@/lib/format";
import { disagreeingCounts, render, uppercasedIdentifiers } from "../ui/markup";
import { readNumber, stateOf as surfaceStateOf } from "../../live/parity";
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
import {
  classesOf,
  expectDrawnAsLinkAtRest,
  expectNotDrawnAsLink,
} from "../../fixtures/link-spelling";

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
    // The page's own read since admin-window/BUG-0133: the filtered rows AND
    // each block's unfiltered population, from the same module boundary.
    readReviewQueues: (filter?: unknown) =>
      actual.readReviewQueues(filter as never, readWith.client as never),
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

/**
 * The verdict tab's read, stubbed at the same boundary as the other two
 * (campaign admin-window/TASK-0058). What the log RENDERS is
 * `tests/offline/queues/verdict-log.test.ts`; this file needs the seam only so
 * the two tabs' reads can be told apart on one stub.
 */
vi.mock("@/lib/db/verdict", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/verdict")>();
  return {
    ...actual,
    readVerdictLog: (limit?: unknown) =>
      actual.readVerdictLog(limit as never, readWith.client as never),
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

function squash(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The label each queue's open figure stands under — the same string the live
 * parity test reads the number by. Spelled here, not imported: a rename on
 * either side has to show up as a failure.
 */
const OPEN_LABEL: Record<string, string> = {
  decision: "Open decisions",
  signal: "Open signals",
};

/** One queue block's whole rendering — every child of its `[data-queue]` hook. */
function blockHtml(markup: string, kind: string): string {
  return cheerio.load(markup)(`[data-queue="${kind}"]`).html() ?? "";
}

/** The text of one block's rows region — its table, or the card standing in for it. */
function rowsRegion(markup: string, kind: string): string {
  return squash(cheerio.load(markup)(`[data-queue="${kind}"] [data-rows]`).text());
}

/** Which of the four states the named queue block says it is in. */
function stateOf(markup: string, kind: string): string | undefined {
  return cheerio.load(markup)(`[data-queue="${kind}"]`).attr("data-state");
}

/**
 * The block's two regions, by position: where the labelled figure sits among
 * the section's own children, and where the rows region does. Positions, not
 * classes — "the count sits in a fixed position" is a structural claim.
 */
function regionsOf(markup: string, kind: string) {
  const $ = cheerio.load(markup);
  const children = $(`[data-queue="${kind}"] section`).children().toArray();
  return {
    figure: children.findIndex((child) =>
      squash($(child).text()).startsWith(OPEN_LABEL[kind]),
    ),
    rows: children.findIndex((child) => $(child).is("[data-rows]")),
  };
}

/**
 * The sub-line standing under a queue's open figure: everything the figure's
 * card says apart from its label and the number itself.
 */
function openSub(markup: string, kind: string): string {
  const $ = cheerio.load(markup);
  const card = $(`[data-queue="${kind}"] section`)
    .children()
    .filter((_, child) => squash($(child).text()).startsWith(OPEN_LABEL[kind]))
    .first();
  const parts = card
    .children()
    .toArray()
    .map((child) => squash($(child).text()))
    .filter((text) => text !== OPEN_LABEL[kind] && !/^-?[\d,]+$/.test(text));
  return parts.join(" ");
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

  it("draws what happened as this app draws a link, at rest", async () => {
    // **BUG-0099 (admin-window).** The row's one route out announced itself
    // only under the pointer, so a reader who had not moved the mouse saw a
    // table of plain sentences. Asserted against the app's one link spelling
    // (`components/cycles/links.ts`), never a class literal.
    const markup = await renderQueues(healthyScript());
    const $ = cheerio.load(markup);

    for (const item of POPULATION) {
      const summary = $(`[data-item="${item.review_item_id}"]`);
      expect(summary.length, item.review_item_id).toBe(1);
      expectDrawnAsLinkAtRest(classesOf(summary), `the ${item.review_item_id} row's summary`);
      // The second fixture on the same row (LESSONS 3): what does NOT go
      // anywhere must not wear the link's ink, or the affordance says nothing.
      for (const inert of ["[data-severity]", "[data-shape]", "[data-folds]"]) {
        const cell = summary.closest("tr").find(inert);
        expect(cell.length, `${item.review_item_id} ${inert}`).toBeGreaterThan(0);
        expectNotDrawnAsLink(classesOf(cell), `${inert} on ${item.review_item_id}`);
      }
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

/**
 * The prose the page ships, checked against the RENDERED markup rather than
 * the source (campaign admin-window/BUG-0046).
 */
describe("the copy the operator actually reads", () => {
  it("never uppercases a queue name into a sans micro label, in any state", async () => {
    // The `micro` step is uppercase sans, so a queue name concatenated into
    // one is rewritten on screen: the walk saw `DATA_CONFLICT OPEN` on the
    // health card three pixels under the `data_conflict` subsection heading —
    // the same identifier, two spellings, one screen (admin-window/BUG-0049,
    // LOOK_AND_FEEL Voice bar 5).
    for (const [state, script] of Object.entries({
      healthy: healthyScript(),
      // the queue-health slices fall to their EMPTY cards here, which is where
      // the eyebrow moves onto a state card instead of a figure card
      empty: healthyScript({ [T.reviewItems]: { data: [], count: 0 } }),
      absent: { [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) } },
      refused: { [T.reviewItems]: { error: permissionDenied(T.reviewItems) } },
    } satisfies Record<string, Script>)) {
      // The guard proves itself before it clears the page: the spelling that
      // shipped MUST be found, or the assertion below is vacuous.
      expect(
        uppercasedIdentifiers('<span class="type-micro">data_conflict open</span>'),
      ).toEqual(["data_conflict open"]);
      const markup = await renderQueues(script);
      expect(uppercasedIdentifiers(markup), state).toEqual([]);
      for (const queue of QUEUE_NAMES) {
        expect(markup, `${state}/${queue}`).not.toContain(queue.toUpperCase());
      }
    }
  });

  it("keeps the queue name on its health cards, spelled as the heading spells it", async () => {
    // The remedy is not deletion: the card still says WHICH queue it counts,
    // verbatim, and `readNumber` finding a figure under `data_conflict open`
    // is also the proof that the identifier and our word are separated by a
    // real space and not a flex gap.
    const markup = await renderQueues(healthyScript());
    const $ = cheerio.load(markup);

    for (const queue of QUEUE_NAMES) {
      const slice = $(`[data-gauge-queue="${queue}"]`);
      expect(slice, queue).toHaveLength(1);
      // the subsection heading, and every eyebrow under it, spell it one way
      const spellings = slice
        .find("*")
        .toArray()
        .map((element) => $(element).text().replace(/\s+/g, " ").trim())
        .filter((text) => text.toLowerCase().includes(queue));
      expect(spellings.length, queue).toBeGreaterThan(0);
      for (const spelling of spellings) expect(spelling, queue).toContain(queue);

      expect(readNumber(markup, `${queue} open`), queue).toBeTypeOf("number");
      expect($(`table[aria-label="${queue} by week"]`), queue).toHaveLength(1);
    }
  });

  it("agrees every count with its noun when each queue holds exactly one item", async () => {
    // The staging shape that produced "of 1 items read here" on the walk: one
    // folded item in the entity_link queue. The whole population puts several
    // items in each queue, so the defect cannot render against it — narrowing
    // to one per queue is what makes the guard below non-vacuous.
    expect(disagreeingCounts("<p>of 1 items read here</p>")).toEqual(["1 items"]);

    const single = QUEUE_NAMES.map(
      (queue) => POPULATION.find((item) => item.queue === queue) as ReviewItemRow,
    );
    // The fixture really is singular: one item in each queue, so every gauge
    // sub-line counting items in a queue is counting to one.
    for (const queue of QUEUE_NAMES) {
      expect(single.filter((item) => item.queue === queue), queue).toHaveLength(1);
    }

    const markup = await renderQueues(
      healthyScript({ [T.reviewItems]: { data: single, count: single.length } }),
    );
    expect(disagreeingCounts(markup)).toEqual([]);
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

const EMPTY_TABLE: Script = { [T.reviewItems]: { data: [], count: 0 } };

describe("with the table present and empty", () => {
  it("says what each queue holds and what fills it, and shows a real zero", async () => {
    const markup = await renderQueues(EMPTY_TABLE);
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

  it("renders each queue's open figure as a counted zero (admin-window/BUG-0027)", async () => {
    // A queue that holds nothing was COUNTED, so its figure is on the page and
    // reads 0 — quality bar 1 asks the Queues page for the open count of each
    // queue, and one of two counts vanishing at zero does not answer it.
    const markup = await renderQueues(EMPTY_TABLE);

    for (const kind of KIND_NAMES) {
      expect(readNumber(markup, OPEN_LABEL[kind]), kind).toBe(0);
      expect(stateOf(markup, kind), kind).toBe("empty");
    }
  });

  it("keeps the figure where it sits when the queue has rows, and the card below it", async () => {
    // "Counts sit in fixed positions": the same slot of the same block, so an
    // operator scanning the same spot every morning can tell a quiet queue
    // from a broken page.
    const empty = regionsOf(await renderQueues(EMPTY_TABLE), "decision");
    const populated = regionsOf(await renderQueues(healthyScript()), "decision");

    expect(empty.figure).toBeGreaterThanOrEqual(0);
    expect(empty.figure).toBe(populated.figure);
    expect(empty.rows).toBe(populated.rows);
    // The rows region is BELOW the figure, and it is where the card went.
    expect(empty.rows).toBeGreaterThan(empty.figure);
  });

  it("puts the Empty card in the rows region, with no table", async () => {
    const markup = await renderQueues(EMPTY_TABLE);
    const $ = cheerio.load(markup);

    for (const kind of KIND_NAMES) {
      const rows = $(`[data-queue="${kind}"] [data-rows]`);
      expect(rows, kind).toHaveLength(1);
      expect(rows.find("table"), kind).toHaveLength(0);
      // The card the page passes stands there rather than nothing at all.
      expect(squash(rows.text()).length, kind).toBeGreaterThan(0);
    }
    // Each card speaks about ITS OWN queue: the two say different things, so
    // neither is a shared "No data" placeholder (LOOK_AND_FEEL, Voice bar 4).
    expect(squash($('[data-queue="decision"] [data-rows]').text())).not.toBe(
      squash($('[data-queue="signal"] [data-rows]').text()),
    );
  });

  it("keeps the two queues at equal standing while both are empty", async () => {
    // TASK-0010's pins, re-run in this state: the fix must not buy the figure
    // by making one queue a different kind of block from the other.
    const markup = await renderQueues(EMPTY_TABLE);
    const { $, blocks } = blocksOf(markup);

    expect(blocks).toHaveLength(2);
    expect($(blocks[0]).parent().get(0)).toBe($(blocks[1]).parent().get(0));
    expect(blocks[0].tagName).toBe(blocks[1].tagName);
    expect($(blocks[0]).attr("class")).toBe($(blocks[1]).attr("class"));
    expect($(blocks[0]).find("h2")).toHaveLength(1);
    expect($(blocks[1]).find("h2")).toHaveLength(1);
    expect(regionsOf(markup, "decision")).toEqual(regionsOf(markup, "signal"));
  });
});

describe("a zero that a filter produced", () => {
  it("names its scope, so a filtered 0 never reads as a whole-queue 0", async () => {
    // Arriving on the Dashboard's "open signals" link empties the decision
    // queue on screen while the database holds plenty. The sub-line under that
    // zero says more than the unfiltered zero's does — it names the scope —
    // which is the behaviour, not the wording, and is what is pinned here.
    const filtered = await renderQueues(healthyScript(), { kind: "signal" });
    const whole = await renderQueues(EMPTY_TABLE);

    expect(matching({ kind: "decision", status: "open" }).length).toBeGreaterThan(0);
    expect(readNumber(filtered, OPEN_LABEL.decision)).toBe(0);
    expect(stateOf(filtered, "decision")).toBe("empty");

    const scoped = openSub(filtered, "decision");
    const unscoped = openSub(whole, "decision");
    expect(unscoped.length).toBeGreaterThan(0);
    expect(scoped).toContain(unscoped);
    expect(scoped.length).toBeGreaterThan(unscoped.length);
  });

  // The RULE, landed strict as `it.fails` by QA when it failed on this tree
  // and turned into a passing pin by the fix (admin-window/BUG-0129).
  it(
    "does not scope a block by the one facet that cannot narrow it (BUG-0129)",
    async () => {
      // SEAM, and the URL the Dashboard's own zero attention card links to
      // (`/queues?kind=decision`, `src/app/page.tsx` `queueHref`): each block
      // is ALREADY narrowed to its own kind (`selectItems(result.data,
      // { kind })`), so `?kind=decision` removes not one row from the decision
      // block. Its rendered set is identical with and without the facet —
      // asserted below, not assumed — and a scope claim about a filter that
      // changed nothing is a claim the page's own read does not support:
      // "empty" and "nothing matched your filters" are two different states
      // and never share a rendering (LOOK_AND_FEEL, the four states).
      //
      // The sibling test above pins the TRUE half of the same rule —
      // `?kind=signal` really does empty the decision block, and that zero
      // must say so.
      for (const kind of KIND_NAMES) {
        const params = paramsOf(`kind=${kind}`);

        // 1. the rows are the same rows, so nothing about this block was filtered
        const populated = await renderQueues(healthyScript(), params);
        const plain = await renderQueues(healthyScript());
        expect(idsIn(populated, kind), kind).toEqual(idsIn(plain, kind));
        expect(idsIn(populated, kind).length, kind).toBeGreaterThan(0);
        expect(openSub(populated, kind), `${kind} sub-line`).toBe(openSub(plain, kind));

        // 2. and with the table empty, the card still says what fills this
        //    queue rather than blaming a filter that removed nothing
        const empty = await renderQueues(EMPTY_TABLE, params);
        const emptyPlain = await renderQueues(EMPTY_TABLE);
        const rowsOf = (markup: string) =>
          squash(cheerio.load(markup)(`[data-queue="${kind}"] [data-rows]`).text());
        expect(stateOf(empty, kind), kind).toBe("empty");
        expect(rowsOf(empty), `${kind} empty card`).toBe(rowsOf(emptyPlain));
      }
    },
  );

  it("still reads as filtered when a facet BESIDE the block's own kind narrows it", async () => {
    // The other half of the rule above, on the URL where the two facets meet:
    // `?kind=decision&status=settled` discounts nothing but the kind. `status`
    // really does remove rows from the decision block, so its zero names the
    // scope exactly as it does without the kind facet — the fix may not turn a
    // block's whole narrowing off just because one facet cannot narrow it.
    const params = paramsOf("kind=decision&status=settled");
    const filtered = await renderQueues(healthyScript(), params);
    const plain = await renderQueues(healthyScript());
    const unscoped = openSub(await renderQueues(EMPTY_TABLE), "decision");

    // The rows really are a narrower set than this block's own kind selection.
    expect(idsIn(filtered, "decision")).toEqual(
      idsOf(inQueueOrder(matching({ kind: "decision", status: "settled" }))),
    );
    expect(idsIn(filtered, "decision").length).toBeGreaterThan(0);
    expect(idsIn(filtered, "decision").length).toBeLessThan(
      idsIn(plain, "decision").length,
    );
    // So its zero says more than the unfiltered zero: it names the scope.
    expect(readNumber(filtered, OPEN_LABEL.decision)).toBe(0);
    expect(openSub(filtered, "decision")).toContain(unscoped);
    expect(openSub(filtered, "decision").length).toBeGreaterThan(unscoped.length);
  });

  it("blames NO filter on an empty table, whatever facet is beside the kind", async () => {
    // Same seam, the other state — and the assertion INVERTED by
    // admin-window/BUG-0133, which is the ticket that owns this state. It used
    // to read "`status` is a reason the block is empty and the card may say
    // so": it is not. With nothing in the table there was no row for `status`
    // to remove, the block renders exactly what the bare `/queues` renders, and
    // "Widen a filter above" is advice that leads to the same zero. A table
    // with no rows and a filter that matched nothing never share a rendering
    // (LOOK_AND_FEEL, the four states).
    //
    // The true half of the rule — a facet that really DID remove rows still
    // names its scope — is pinned on the POPULATED table by the two siblings
    // above and below, so this pair still proves itself both ways.
    const rowsOf = (markup: string) =>
      squash(cheerio.load(markup)(`[data-queue="decision"] [data-rows]`).text());
    const filtered = await renderQueues(EMPTY_TABLE, paramsOf("kind=decision&status=settled"));

    expect(stateOf(filtered, "decision")).toBe("empty");
    expect(rowsOf(filtered)).toBe(rowsOf(await renderQueues(EMPTY_TABLE)));
    // and it is the SAME card the facet draws without the kind beside it
    expect(rowsOf(filtered)).toBe(
      rowsOf(await renderQueues(EMPTY_TABLE, paramsOf("status=settled"))),
    );
  });

  it("names its scope on EITHER block when the OTHER kind's facet empties it", async () => {
    // The true half of the rule, both ways round. The sibling above drives
    // only `?kind=signal` against the decision block, so a scope decision that
    // discounted a HARD-CODED kind rather than the block's own would satisfy
    // it while lying on the mirror URL: with `isNarrowed(filter, { kind:
    // "decision" })` in place of the block's own narrowing, `?kind=decision`
    // leaves the empty SIGNAL block claiming nothing filtered it. Measured on
    // this tree: that mutation reddens this test and no other beside it.
    for (const kind of KIND_NAMES) {
      const other = kind === "decision" ? "signal" : "decision";
      const filtered = await renderQueues(healthyScript(), { kind: other });
      const unscoped = openSub(await renderQueues(EMPTY_TABLE), kind);

      // the facet really did empty THIS block
      expect(idsIn(filtered, kind), kind).toEqual([]);
      expect(matching({ kind }).length, kind).toBeGreaterThan(0);
      expect(readNumber(filtered, OPEN_LABEL[kind]), kind).toBe(0);
      // so its zero says more than the unfiltered zero: it names the scope
      const scoped = openSub(filtered, kind);
      expect(scoped, kind).toContain(unscoped);
      expect(scoped.length, kind).toBeGreaterThan(unscoped.length);
    }
  });

  it("leaves a block's WHOLE rendering untouched under its own kind facet", async () => {
    // Stronger than the ids-and-sub-line pin above, and the claim the fix
    // actually makes: `/queues?kind=K` and `/queues` render the K block
    // identically, so nothing anywhere inside it — figure, sub-line, card,
    // rows — can come to disagree about whether that facet narrowed it.
    for (const kind of KIND_NAMES) {
      for (const [name, script] of [
        ["populated", healthyScript()],
        ["empty", EMPTY_TABLE],
      ] as const) {
        const own = await renderQueues(script, paramsOf(`kind=${kind}`));
        const plain = await renderQueues(script);
        expect(blockHtml(own, kind), `${kind}/${name}`).toBe(blockHtml(plain, kind));
      }
    }
  });

  it("decides the scope claim from the value the URL actually selected", async () => {
    // The scope claim rides the SAME reading of the URL the rows do
    // (`filterFrom`): a value outside the vocabulary selects nothing, so it
    // may scope nothing either — a block that blamed `?kind=Decision` would
    // be naming a filter the page refused. And a repeated key is the FIRST
    // value for the claim exactly as it is for the rows.
    for (const query of ["kind=bogus", "kind=", "kind=Decision", "kind=decision%20"]) {
      for (const kind of KIND_NAMES) {
        for (const script of [healthyScript(), EMPTY_TABLE]) {
          const markup = await renderQueues(script, paramsOf(query));
          expect(blockHtml(markup, kind), `?${query} ${kind}`).toBe(
            blockHtml(await renderQueues(script), kind),
          );
        }
      }
    }

    // `?kind=decision&kind=signal` reads as `kind=decision`: the decision
    // block is untouched and the signal block — which that value really did
    // empty — names its scope.
    const both = paramsOf("kind=decision&kind=signal");
    expect(blockHtml(await renderQueues(healthyScript(), both), "decision")).toBe(
      blockHtml(await renderQueues(healthyScript()), "decision"),
    );
    const emptied = await renderQueues(healthyScript(), both);
    expect(idsIn(emptied, "signal")).toEqual([]);
    expect(openSub(emptied, "signal")).toContain(
      openSub(await renderQueues(EMPTY_TABLE), "signal"),
    );
    expect(openSub(emptied, "signal").length).toBeGreaterThan(
      openSub(await renderQueues(EMPTY_TABLE), "signal").length,
    );
  });

  // QA landed this STRICT as `it.fails`; the fix turned it red ("Expect test to
  // fail"), which was the signal to drop `.fails` and keep it as the passing
  // rule — the same way admin-window/BUG-0129's own pin above worked.
  it(
    "does not scope a block by a facet in ANOTHER NAME that cannot narrow it either (admin-window/BUG-0131)",
    async () => {
      // Same rule as the pin above, and the half the by-value exclusion does
      // not reach: `within` is `{ kind }`, so only a `kind` facet can ever be
      // discounted. But the signal queue is `shapesOfKind("signal")` — the
      // single shape `entity_link_source_pattern` — and every row of that
      // shape is `queue: "entity_link"` (`shapeOf`, src/lib/review/shapes.ts:
      // 121), so BOTH of those facets select exactly the signal block's own
      // set and remove not one row from it. Each is one click from this
      // page's own chip row (`/queues?shape=entity_link_source_pattern`,
      // `/queues?queue=entity_link`).
      for (const query of ["shape=entity_link_source_pattern", "queue=entity_link"]) {
        const params = paramsOf(query);

        // 1. the facet removed nothing from this block
        const populated = await renderQueues(healthyScript(), params);
        const plain = await renderQueues(healthyScript());
        expect(idsIn(populated, "signal"), query).toEqual(idsIn(plain, "signal"));
        expect(idsIn(populated, "signal").length, query).toBeGreaterThan(0);

        // 2. so it may not be given as the reason the figure is what it is
        expect(openSub(populated, "signal"), `${query} sub-line`).toBe(
          openSub(plain, "signal"),
        );

        // 3. nor as the reason the queue is empty when the table is
        const empty = await renderQueues(EMPTY_TABLE, params);
        expect(rowsRegion(empty, "signal"), `${query} empty card`).toBe(
          rowsRegion(await renderQueues(EMPTY_TABLE), "signal"),
        );
      }
    },
  );

  /**
   * The facet values each KIND implies — every value a row of that kind must
   * carry, so a URL naming it removes not one row from that block.
   *
   * Spelled here from spec §6 and migration `20260901000002`, never imported:
   * the signal queue is the single shape `entity_link_source_pattern`, and that
   * shape exists only under `queue: "entity_link"`; the decision queue spans two
   * shapes and both queues, so it implies nothing but its own kind. Asking
   * `src/lib/review/queue-filters.ts` what it expects would only prove the page
   * calls it (this file's header rule).
   */
  const IMPLIED_BY_KIND: Record<string, Record<string, string>> = {
    decision: { kind: "decision" },
    signal: {
      kind: "signal",
      shape: SHAPE_NAMES[2],
      queue: QUEUE_NAMES[1],
    },
  };

  /** Every facet the URL offers, with every value it may carry. */
  const EVERY_FACET_VALUE: Record<string, readonly string[]> = {
    kind: KIND_NAMES,
    queue: QUEUE_NAMES,
    shape: SHAPE_NAMES,
    status: STATUS_NAMES,
  };

  /** Every `facet=value` the URL can carry, once, as a flat list. */
  const EVERY_FACET_URL = Object.keys(EVERY_FACET_VALUE).flatMap((facet) =>
    EVERY_FACET_VALUE[facet].map((value) => ({ facet, value })),
  );

  it("leaves a block untouched by EVERY value its kind implies, and by no other", async () => {
    // The rule the fix states, swept over the whole URL vocabulary rather than
    // the two values the pin above names: a block renders identically to the
    // unfiltered page under a facet its own kind implies, and differently under
    // every facet that really does remove rows from it. Both blocks, populated
    // and empty — the empty half is where "nothing here yet" and "nothing
    // matched your filters" would otherwise share one rendering.
    for (const kind of KIND_NAMES) {
      for (const { facet, value } of EVERY_FACET_URL) {
        const implied = IMPLIED_BY_KIND[kind][facet] === value;
        const where = `${facet}=${value} on ${kind}`;

        // The fixture itself decides which case this is, from the rows: a
        // value the kind implies removes none of that kind's rows, and every
        // other value removes at least one. If this ever disagrees with
        // `IMPLIED_BY_KIND`, the population stopped covering the case and the
        // sweep below would be passing vacuously.
        expect(
          matching({ kind, [facet]: value }).length === matching({ kind }).length,
          `${where}: removes no rows`,
        ).toBe(implied);

        const params = paramsOf(`${facet}=${value}`);
        for (const [name, script] of [
          ["populated", healthyScript()],
          ["empty", EMPTY_TABLE],
        ] as const) {
          const own = blockHtml(await renderQueues(script, params), kind);
          const plain = blockHtml(await renderQueues(script), kind);
          // On the POPULATED table the structural rule decides: a block is
          // identical to its unfiltered self under a value its kind implies,
          // and different under every value that really removes rows from it.
          // On the EMPTY table nothing was there for ANY facet to remove, so
          // every block renders identically under every URL — the empty half
          // of this sweep asserted the opposite until admin-window/BUG-0133,
          // and that was the defect (LOOK_AND_FEEL, the four states).
          const identical = name === "empty" || implied;
          if (identical) expect(own, `${where}/${name}`).toBe(plain);
          else expect(own, `${where}/${name}`).not.toBe(plain);
        }
      }
    }
  });

  it("adds the scope claim to the open figure only where the facet removed rows", async () => {
    // The figure's sub-line, held against the SAME rendered rows with no filter
    // at all: feed the page exactly the rows the URL leaves and ask for no
    // narrowing, and any difference in the sub-line is the scope claim and
    // nothing else. So the claim is pinned by its presence and absence rather
    // than by its words.
    for (const kind of KIND_NAMES) {
      for (const { facet, value } of EVERY_FACET_URL) {
        const implied = IMPLIED_BY_KIND[kind][facet] === value;
        const where = `${facet}=${value} on ${kind}`;
        const rows = matching({ [facet]: value });

        const claimed = openSub(
          await renderQueues(healthyScript(), paramsOf(`${facet}=${value}`)),
          kind,
        );
        const unscoped = openSub(
          await renderQueues({ [T.reviewItems]: { data: rows, count: rows.length } }),
          kind,
        );

        if (implied) {
          expect(claimed, where).toBe(unscoped);
        } else {
          expect(claimed, where).not.toBe(unscoped);
          expect(claimed.length, `${where}: length`).toBeGreaterThan(unscoped.length);
        }
      }
    }
  });

  // Landed red by QA as a strict `it.fails` pin (admin-window/BUG-0133) and
  // flipped to `it` by the fix: a block whose own queue is empty no longer
  // blames a filter for the zero that emptiness produced.
  it(
    "does not blame a filter for a zero on a queue that holds nothing anyway (admin-window/BUG-0133)",
    async () => {
      // The trigger BUG-0131's structural rule does not reach, and the state
      // staging is in today (0 decision items): when a block's OWN queue is
      // empty, NO url facet can have removed a row from it — every facet
      // leaves exactly the rows the unfiltered page shows, which is none. So
      // the same rule applies as for a facet the kind implies: the block may
      // not name the filter as the reason for its zero, and may not tell the
      // reader to widen a filter that is hiding nothing.
      //
      // Held against the SAME script rendered with no filter at all, so no
      // wording is pinned — only the presence of a scope claim that the read
      // does not support.
      const signals = matching({ kind: "signal" });
      const SIGNALS_ONLY: Script = {
        [T.reviewItems]: { data: signals, count: signals.length },
      };
      expect(signals.length).toBeGreaterThan(0);
      expect(matching({ kind: "decision" }).length).toBeGreaterThan(0); // fixture holds some
      const plain = await renderQueues(SIGNALS_ONLY);
      expect(idsIn(plain, "decision")).toEqual([]); // ...but this script holds none

      for (const query of [
        "shape=data_conflict_fact",
        "queue=data_conflict",
        "shape=entity_link_fact",
        "status=open",
        "kind=signal",
      ]) {
        const filtered = await renderQueues(SIGNALS_ONLY, paramsOf(query));
        // the facet removed not one decision row: there were none to remove
        expect(idsIn(filtered, "decision"), query).toEqual(idsIn(plain, "decision"));
        expect(stateOf(filtered, "decision"), query).toBe("empty");
        // so the zero and the card read exactly as they do unfiltered
        expect(openSub(filtered, "decision"), `${query} sub-line`).toBe(
          openSub(plain, "decision"),
        );
        expect(rowsRegion(filtered, "decision"), `${query} card`).toBe(
          rowsRegion(plain, "decision"),
        );
      }
    },
  );

  it("scopes the zero of a queue that has rows but nothing open, too", async () => {
    // `?status=settled` leaves rows on screen and a real zero above them.
    const markup = await renderQueues(healthyScript(), { status: "settled" });

    expect(readNumber(markup, OPEN_LABEL.decision)).toBe(0);
    expect(stateOf(markup, "decision")).toBe("ok");
    expect(openSub(markup, "decision")).toContain(
      openSub(await renderQueues(EMPTY_TABLE), "decision"),
    );
  });
});

/* ── one queue quiet, the other busy ─────────────────────────────────────── */

describe("one queue quiet while the other is busy", () => {
  // The shape the defect was FOUND in (BUG-0027, live parity run against
  // staging): the table held signal items only, so the decision queue was
  // empty and the signal queue was not — with no filter on the page. Every
  // other empty-state case here empties BOTH queues (an empty table) or
  // empties one WITH a filter, and neither reaches this seam: a queue whose
  // zero is real, unscoped, and standing beside a populated sibling.
  const SIGNALS = matching({ kind: "signal" });
  const SIGNALS_ONLY: Script = {
    [T.reviewItems]: { data: SIGNALS, count: SIGNALS.length },
  };

  /** The figure the open card shows, as rendered text — a number or a dash. */
  function openFigure(markup: string, kind: string): string {
    const $ = cheerio.load(markup);
    const card = $(`[data-queue="${kind}"] section`)
      .children()
      .filter((_, child) => squash($(child).text()).startsWith(OPEN_LABEL[kind]))
      .first();
    const parts = card
      .children()
      .toArray()
      .map((child) => squash($(child).text()))
      .filter((text) => text !== OPEN_LABEL[kind]);
    return parts[0] ?? "";
  }

  it("shows BOTH figures — the quiet queue's counted zero and the busy one's count", async () => {
    const markup = await renderQueues(SIGNALS_ONLY);

    expect(SIGNALS.length).toBeGreaterThan(0);
    expect(SIGNALS.filter((item) => item.status === "open").length).toBeGreaterThan(0);
    expect(readNumber(markup, OPEN_LABEL.decision)).toBe(0);
    expect(readNumber(markup, OPEN_LABEL.signal)).toBe(
      SIGNALS.filter((item) => item.status === "open").length,
    );
    expect(stateOf(markup, "decision")).toBe("empty");
    expect(stateOf(markup, "signal")).toBe("ok");
  });

  it("renders that zero as a number, never as the absence dash", async () => {
    // `orDash` colours an absence with an em dash, and `count(0)` must not
    // reach it: "the read counted nothing" and "the read counted zero" are
    // different facts and the live oracle distinguishes them.
    const markup = await renderQueues(SIGNALS_ONLY);

    expect(openFigure(markup, "decision")).toBe("0");
    expect(openFigure(markup, "decision")).not.toContain(EM_DASH);
    expect(openFigure(markup, "signal")).not.toContain(EM_DASH);
  });

  it("leaves that zero unscoped — no filter is what emptied it", async () => {
    // The scope suffix is a claim about the URL. A queue that is quiet on its
    // own must not borrow it, or a whole-queue zero reads as a filtered one.
    const quiet = await renderQueues(SIGNALS_ONLY);
    const both = await renderQueues(EMPTY_TABLE);
    const filtered = await renderQueues(healthyScript(), { kind: "signal" });

    expect(openSub(quiet, "decision")).toBe(openSub(both, "decision"));
    expect(openSub(filtered, "decision")).toContain(openSub(quiet, "decision"));
    expect(openSub(filtered, "decision").length).toBeGreaterThan(
      openSub(quiet, "decision").length,
    );
  });

  it("keeps equal standing and both fixed positions in the mixed state", async () => {
    // The asymmetric render is where a per-state layout would show: one block
    // holding a card and one holding a table must still be the same block.
    const markup = await renderQueues(SIGNALS_ONLY);
    const { $, blocks } = blocksOf(markup);
    const populated = await renderQueues(healthyScript());

    expect(blocks).toHaveLength(2);
    expect($(blocks[0]).parent().get(0)).toBe($(blocks[1]).parent().get(0));
    expect(blocks[0].tagName).toBe(blocks[1].tagName);
    expect($(blocks[0]).attr("class")).toBe($(blocks[1]).attr("class"));
    expect(regionsOf(markup, "decision")).toEqual(regionsOf(markup, "signal"));
    expect(regionsOf(markup, "decision")).toEqual(regionsOf(populated, "decision"));
  });

  it("gives the quiet queue the card and the busy queue the table, each in its rows region", async () => {
    const markup = await renderQueues(SIGNALS_ONLY);
    const $ = cheerio.load(markup);

    const quiet = $('[data-queue="decision"] [data-rows]');
    const busy = $('[data-queue="signal"] [data-rows]');
    expect(quiet.find("table")).toHaveLength(0);
    expect(squash(quiet.text()).length).toBeGreaterThan(0);
    expect(busy.find("table")).toHaveLength(1);
    expect(idsIn(markup, "decision")).toEqual([]);
    expect(new Set(idsIn(markup, "signal"))).toEqual(new Set(idsOf(SIGNALS)));
  });

  it("states a real 0 when the Dashboard's decision link opens a quiet decision queue", async () => {
    // SEAM: the Dashboard links its attention counts to `/queues?kind=…`, and
    // TASK-0032's oracle rule is that an empty page is a PASS WITH A STATED 0.
    // Driven for both ways a decision queue can be quiet on arrival.
    for (const script of [SIGNALS_ONLY, EMPTY_TABLE]) {
      const markup = await renderQueues(script, paramsOf("kind=decision"));

      expect(cheerio.load(markup)("[data-queue]")).toHaveLength(2);
      expect(readNumber(markup, OPEN_LABEL.decision)).toBe(0);
      expect(readNumber(markup, OPEN_LABEL.signal)).toBe(0);
      expect(stateOf(markup, "decision")).toBe("empty");
    }
  });

  it("says one of exactly four states on every block of every state, always", async () => {
    // `data-state` is a contract a live reader branches on: a fifth value, a
    // missing attribute or a block that says nothing would silently turn a
    // failure into a pass.
    const scripts: Record<string, string | string[]>[] = [{}, paramsOf("kind=decision"), { status: "settled" }];
    const states = new Set(["ok", "empty", "error", "not_provisioned"]);

    for (const script of [
      healthyScript(),
      SIGNALS_ONLY,
      EMPTY_TABLE,
      { [T.reviewItems]: { error: permissionDenied(T.reviewItems) } },
      { [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) } },
      { [T.reviewItems]: { error: transportFailure() } },
    ] as Script[]) {
      for (const params of scripts) {
        const { $, blocks } = blocksOf(await renderQueues(script, params));
        expect(blocks).toHaveLength(2);
        for (const block of blocks) {
          const state = $(block).attr("data-state");
          expect(states.has(state ?? ""), `${state}`).toBe(true);
        }
      }
    }
  });
});

describe("the four states, on the block itself", () => {
  /** state name → the script that puts both queues in it, and whether it counted. */
  const cases: [string, Script, boolean][] = [
    ["ok", healthyScript(), true],
    ["empty", EMPTY_TABLE, true],
    ["error", { [T.reviewItems]: { error: permissionDenied(T.reviewItems) } }, false],
    [
      "not_provisioned",
      { [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) } },
      false,
    ],
  ];

  for (const [state, script, counted] of cases) {
    it(`says data-state="${state}" and ${counted ? "shows" : "shows no"} figure`, async () => {
      // The state is readable BEFORE any number is (ARCHITECTURE.md §10): an
      // error is always a failure, an empty is a pass with a stated 0, and
      // neither is inferred from "no rows rendered".
      const markup = await renderQueues(script);

      for (const kind of KIND_NAMES) {
        expect(stateOf(markup, kind), kind).toBe(state);
        if (counted) {
          expect(readNumber(markup, OPEN_LABEL[kind]), kind).toBeGreaterThanOrEqual(0);
        } else {
          // A table that is not there, or a read that refused, counted
          // nothing — and nothing is not a zero.
          expect(() => readNumber(markup, OPEN_LABEL[kind]), kind).toThrow();
        }
      }
    });
  }
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

/* ── the queue-health SECTION, graded the way the live oracle grades it ──── */

/**
 * The live oracle's own two selectors, spelled here (admin-window/BUG-0062):
 * the gauge's section, and the per-queue slices inside it that carry their own
 * state cards. `tests/live/queues.live.test.ts` grades the section with
 * `stateOf(markup, HEALTH, GAUGE_SLICES)`, and staging can only ever exhibit
 * whichever of the four states it happens to be in that hour. These four cases
 * put the page in all four, deterministically, so the exclusion's BOUNDS are
 * pinned: it must silence a slice's own emptiness and nothing else.
 */
const HEALTH_SURFACE = "section:not([data-queue] section)";
const HEALTH_SLICES = "[data-gauge-queue]";

describe("the queue-health section's state, as the live oracle reads it", () => {
  /** Rows in ONE queue only, so the other queue's slice is honestly empty. */
  const ONE_QUEUE_ONLY: Script = (() => {
    const rows = matching({ queue: "entity_link" });
    return { [T.reviewItems]: { data: rows, count: rows.length } };
  })();

  it("stays ok while a slice of it is empty, and the slice really is empty", async () => {
    const markup = await renderQueues(ONE_QUEUE_ONLY);
    const $ = cheerio.load(markup);

    // The condition the live oracle met on staging: the gauge holds rows, and
    // one slice inside it carries an emptiness of its own.
    expect($(`${HEALTH_SLICES} [data-state="empty"]`).length).toBeGreaterThan(0);
    expect(readNumber(markup, "data_conflict open")).toBe(0);
    expect(readNumber(markup, "entity_link open")).toBe(
      matching({ queue: "entity_link", status: "open" }).length,
    );
    // A sub-panel's emptiness is not the gauge's state.
    expect(surfaceStateOf(markup, HEALTH_SURFACE, HEALTH_SLICES)).toBe("ok");
  });

  it("is ok with a real zero when the window holds nothing at all", async () => {
    // Every figure is stated as a counted zero and the section draws no empty
    // card of its own — which is what lets the live oracle grade a counted 0
    // as `ok` rather than as an emptiness.
    const markup = await renderQueues(EMPTY_TABLE);
    const $ = cheerio.load(markup);

    expect($(HEALTH_SLICES)).toHaveLength(2);
    for (const queue of QUEUE_NAMES) {
      expect(readNumber(markup, `${queue} open`), queue).toBe(0);
    }
    expect(surfaceStateOf(markup, HEALTH_SURFACE, HEALTH_SLICES)).toBe("ok");
  });

  it("still reports NOT_PROVISIONED through the exclusion", async () => {
    const markup = await renderQueues({
      [T.reviewItems]: { error: tableNotInSchemaCache(T.reviewItems) },
    });

    expect(surfaceStateOf(markup, HEALTH_SURFACE, HEALTH_SLICES)).toBe("not_provisioned");
  });

  it("still reports ERROR through the exclusion", async () => {
    const markup = await renderQueues({
      [T.reviewItems]: { error: permissionDenied(T.reviewItems) },
    });

    expect(surfaceStateOf(markup, HEALTH_SURFACE, HEALTH_SLICES)).toBe("error");
  });
});

/* ── the two tabs of this one route ──────────────────────────────────────── */

/**
 * The verdict log is a TAB of `/queues`, not a seventh page (campaign
 * admin-window/TASK-0058, spec F13, DECISIONS 2026-09-04).
 *
 * What belongs here is the ROUTE's half of that claim — the strip, where each
 * tab goes, and which reads each tab makes. What the log itself renders is
 * `tests/offline/queues/verdict-log.test.ts`, and the six-link sidebar is the
 * shell suite's, which already asserts it.
 */
describe("the tab strip", () => {
  const tabsIn = (markup: string) => {
    const $ = cheerio.load(markup);
    return $("[data-tab]")
      .toArray()
      .map((element) => ({
        tab: $(element).attr("data-tab") ?? "",
        active: $(element).attr("data-active") === "true",
        href: $(element).find("a").attr("href") ?? "",
      }));
  };

  it("offers both tabs on both tabs, exactly one of them current", async () => {
    const cases: [Record<string, string>, string][] = [
      [{}, "queues"],
      [{ tab: "verdict_log" }, "verdict_log"],
    ];
    for (const [params, current] of cases) {
      const markup = await renderQueues(healthyScript(), params);
      const tabs = tabsIn(markup);

      expect(tabs.map((tab) => tab.tab), current).toEqual(["queues", "verdict_log"]);
      expect(tabs.filter((tab) => tab.active).map((tab) => tab.tab)).toEqual([current]);
    }
  });

  it("spells the default tab by OMITTING it, so one state has one URL", async () => {
    const tabs = tabsIn(await renderQueues(healthyScript(), { tab: "verdict_log" }));

    expect(tabs.find((tab) => tab.tab === "queues")?.href).toBe("/queues");
    expect(tabs.find((tab) => tab.tab === "verdict_log")?.href).toBe(
      "/queues?tab=verdict_log",
    );
  });

  it("carries the filter across, so the queue you were in is the one you return to", async () => {
    const tabs = tabsIn(
      await renderQueues(healthyScript(), { kind: "signal", status: "open" }),
    );

    for (const tab of tabs) {
      expect(tab.href, tab.tab).toContain("kind=signal");
      expect(tab.href, tab.tab).toContain("status=open");
    }
  });

  it("lands an unusable tab value on the queues, never on an error page", async () => {
    for (const value of ["Verdict_log", "verdicts", "", "queues"]) {
      const markup = await renderQueues(healthyScript(), { tab: value });

      expect(tabsIn(markup).filter((tab) => tab.active).map((tab) => tab.tab), value).toEqual(
        ["queues"],
      );
      expect(new Set(idsIn(markup)), value).toEqual(new Set(idsOf(POPULATION)));
    }
  });
});

describe("each tab reads only what it renders", () => {
  it("asks verdicts nothing on the queues tab", async () => {
    const stub = stubClient(healthyScript());
    readWith.client = stub.asSupabaseClient();
    render(await QueuesPage({ searchParams: Promise.resolve({}) }));

    expect(stub.tablesRead()).toContain(T.reviewItems);
    expect(stub.tablesRead()).not.toContain(T.verdicts);
  });

  it("asks review_items nothing on the verdict tab, and renders no queue block", async () => {
    const stub = stubClient({
      ...healthyScript(),
      [T.verdicts]: { data: [], count: 0 },
    });
    readWith.client = stub.asSupabaseClient();
    const markup = render(
      await QueuesPage({ searchParams: Promise.resolve({ tab: "verdict_log" }) }),
    );

    expect(stub.tablesRead()).toContain(T.verdicts);
    expect(stub.tablesRead()).not.toContain(T.reviewItems);
    // The queue blocks, their filter chips and the health gauge belong to the
    // other tab: a page showing both would be two pages in one.
    const $ = cheerio.load(markup);
    expect($("[data-queue]")).toHaveLength(0);
    expect($("[data-facet]")).toHaveLength(0);
    expect($('[data-window="queue_health"]')).toHaveLength(0);
  });

  it("keeps every data-surface name on this route unique", async () => {
    // The name is how a live oracle addresses one surface and exactly one
    // (ARCHITECTURE.md §10, common violation 8); two surfaces answering to one
    // name is `matches 2 surfaces` at the next live run.
    const urls: Record<string, string>[] = [{}, { tab: "verdict_log" }];
    for (const params of urls) {
      const $ = cheerio.load(await renderQueues(healthyScript(), params));
      const names = $("[data-surface]")
        .toArray()
        .map((element) => $(element).attr("data-surface") ?? "");
      expect(new Set(names).size, JSON.stringify(params)).toBe(names.length);
    }
  });
});
