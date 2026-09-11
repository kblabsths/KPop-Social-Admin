import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cheerio from "cheerio";
import { EM_DASH, UTC_ZONE, absoluteUtc } from "@/lib/format";
import { T } from "@/lib/db/tables";
import {
  COLUMNS_PARAM,
  RECENT_EVENTS,
  columnsParamValue,
  configuredKeys,
  shownColumns,
  type BrowseColumnKey,
} from "@/lib/browse/views";
import type { BrowseRow } from "@/lib/browse/rows";
import {
  MAX_PAGE_OFFSET,
  OFFSET_PARAM,
  PAGE_ROUTES,
  pageBound,
  type NotedPageAnswer,
  type PageNote,
} from "@/lib/paging/bounds";
import {
  initialPage,
  pressing,
  requestPage,
  type PageState,
} from "@/lib/paging/machine";
import { recordHref } from "@/lib/records/routes";
import { BrowseTable } from "@/components/browse/browse-table";
import { PagedBrowseTable } from "@/components/browse/paged-browse-table";
import { PageMore, PagingProvider } from "@/components/ui/paging";
import type { DrawnWindow } from "@/components/ui/window-line";
import { codeLinesIn, sourceText } from "../source-tree";
import { h, render, textOf } from "../ui/markup";
import {
  classesOf,
  expectDrawnAsLinkAtRest,
  expectNotDrawnAsLink,
} from "../../fixtures/link-spelling";
import { oneEach, surfaceHooks } from "../../live/parity";
import { ID, eventListingRow, eventRow, fieldProvenanceRow, sourceRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type Script,
} from "../../fixtures/stub-client";

/**
 * The Browse page, rendered (campaign admin-window/TASK-0015).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await BrowsePage(props))` — no jsdom, no Testing
 * Library, no database. `readRecentEvents` is stubbed at the module boundary
 * so the page's four states are all reachable offline; what it reads through
 * is exercised for real in `browse-read.test.ts`.
 *
 * These assert STRUCTURE and BEHAVIOUR — which columns are drawn, in what row
 * order, which links the selector offers, which state renders — never a
 * rendered word or a class LITERAL. Copy and styling belong to the walk; the
 * one rendering rule asserted here is whether a title that navigates says so
 * before the pointer reaches it, read from the app's own link constant
 * (`tests/fixtures/link-spelling.ts`, admin-window/BUG-0108).
 */

const view = RECENT_EVENTS;

/**
 * The page reads through `lib/db/browse`, which reads through the real
 * `result.ts` helpers; handing it a stub client is the honest seam, so the
 * mock below only swaps in the client the reads use.
 */
const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/browse", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/db/browse")>();
  return {
    ...actual,
    readRecentEvents: (v: Parameters<typeof actual.readRecentEvents>[0]) =>
      actual.readRecentEvents(v, readWith.client as never),
  };
});

/**
 * The surface's PROVIDER, spied rather than replaced — campaign
 * admin-window/TASK-0069, moved from the hook to the provider by
 * admin-window/BUG-0172, which made the provider the one thing that holds a
 * paged surface's state (the wrappers consume it, and so does the window line).
 *
 * Three things this tier cannot do on its own, and one it can:
 *
 *  - it has NO DOM, so the control the page renders cannot be clicked. The
 *    press is taken from the widget's own `onPress` prop as the surface hands
 *    it over, which is the same function a click would call;
 *  - `renderToStaticMarkup` renders ONCE, so a state published after the
 *    render never reaches markup. `override` is the one substitution this file
 *    makes: the state the provider STARTS from is replaced by a state the REAL
 *    driver produced from the REAL deps the page built, and the page is
 *    rendered again with it. Nothing else is faked — the provider, the deps,
 *    the driver, the widget, the row markup and the request are all the app's,
 *    and the line and the rows read that one state exactly as they do in a
 *    browser;
 *  - what it CAN do is watch the wire: the press reaches the network through
 *    `fetch`, so "one press, one request" is read off a stubbed global and
 *    needs no DOM at all.
 *
 * By default it DELEGATES, so every other render in this file is unchanged.
 */
const paging = vi.hoisted(() => ({
  calls: [] as {
    initial: { rows: readonly unknown[]; held: number; status: string; notes: unknown };
    deps: { route: string; params: string; size: number };
  }[],
  press: null as null | (() => void),
  override: null as unknown,
}));

vi.mock("@/components/ui/paging", async (importActual) => {
  const actual = await importActual<typeof import("@/components/ui/paging")>();
  return {
    ...actual,
    PagingProvider: (props: {
      initial: (typeof paging.calls)[number]["initial"];
      deps: (typeof paging.calls)[number]["deps"];
      window: unknown;
      children: unknown;
    }) => {
      paging.calls.push({ initial: props.initial, deps: props.deps });
      // The REAL provider, started from the state under test, with a probe
      // added beside the page's own children to hand the press back out. The
      // WINDOW is the page's own, passed straight through: this file overrides
      // the paging STATE and nothing the page composed
      // (admin-window/BUG-0180).
      return h(
        actual.PagingProvider as never,
        {
          initial: (paging.override === null ? props.initial : paging.override) as never,
          window: props.window as never,
          deps: props.deps as never,
        },
        props.children as never,
      );
    },
    // The press, taken from the widget's own `onPress` prop as the surface
    // hands it over — the same function a click would call, in a tier with no
    // DOM to click. The widget itself is the app's and renders unchanged.
    PageMore: (props: { onPress: () => void }) => {
      paging.press = props.onPress;
      return h(actual.PageMore as never, props as never);
    },
  };
});

const { default: BrowsePage } = await import("@/app/browse/page");

/**
 * A window of the shape `/browse` composes — the rows ITS OWN read came back
 * with, and no count beside them (`heldFrom: "this window"`,
 * admin-window/BUG-0174).
 *
 * Handed to the provider by the two renders below that build a wrapper
 * directly, the way the page hands its own (admin-window/BUG-0180). Nothing
 * about this surface can reach the two-reads divergence `/claims` can: once
 * its read has ended, what it holds IS what it counted.
 */
function thisWindow(held: number, limit: number): DrawnWindow {
  return {
    limit,
    held,
    truncated: held >= limit,
    over: "view",
    oldest: null,
    scope: null,
    heldFrom: "this window",
  };
}

const EVENT_NEW = "01920000-0000-7000-8000-000000000b02";
const EVENT_OLD = "01920000-0000-7000-8000-000000000b01";

function population() {
  return [
    eventRow({
      event_id: EVENT_OLD,
      title: "older arrival",
      created_at: "2026-07-01T00:00:00Z",
      // starts LAST though it arrived FIRST: the calendar order is the
      // reverse of the arrival order, so a sort on starts_at cannot pass.
      starts_at: "2027-06-01T18:30:00Z",
      description: "An older blurb.",
      poster_url: "https://example.invalid/posters/old.jpg",
    }),
    eventRow({
      event_id: EVENT_NEW,
      title: "newest arrival",
      created_at: "2026-09-01T00:00:00Z",
      starts_at: "2026-10-01T02:00:00Z",
      description: "A newer blurb.",
      poster_url: "https://example.invalid/posters/new.jpg",
    }),
  ];
}

function healthyScript(overrides: Script = {}): Script {
  const provenance = [
    fieldProvenanceRow({
      entity_id: EVENT_NEW,
      source_id: ID.sourceTicketmaster,
    }),
    fieldProvenanceRow({
      entity_id: EVENT_NEW,
      field: "starts_at",
      source_id: ID.sourceBandsintown,
    }),
  ];
  const sources = [
    sourceRow({ source_id: ID.sourceTicketmaster, source: "ticketmaster" }),
    sourceRow({ source_id: ID.sourceBandsintown, source: "bandsintown" }),
  ];
  const listings = [
    eventListingRow({ event_id: EVENT_NEW, venue_name: "Crypto.com Arena" }),
    eventListingRow({ event_id: EVENT_OLD, venue_name: "The Forum" }),
  ];
  return {
    [T.events]: { data: population() },
    [T.eventListings]: { data: listings, count: listings.length },
    [T.fieldProvenance]: { data: provenance, count: provenance.length },
    [T.sources]: { data: sources, count: sources.length },
    ...overrides,
  };
}

/** Render the page against a scripted database and the given URL state. */
async function renderBrowse(
  script: Script,
  params: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  const markup = render(await BrowsePage({ searchParams: Promise.resolve(params) }));
  // THE SWEEP OVER EVERY FIRST SCREEN THIS FILE RENDERS (campaign
  // admin-window/TASK-0069, the rule QA took off the admin-window/BUG-0168
  // close). Every render of /browse in this suite goes through here, so the
  // rule is graded on every fixture at once rather than on the ones someone
  // remembered.
  //
  // `data-paging="limit"` is `PageMore`'s honest answer to a state that has
  // walked to the ceiling `pageBound` enforces: no control, and a sentence
  // that does not claim the set has ended. On a FIRST screen it is neither —
  // it is a dead end the operator was handed before pressing anything, which
  // is what a state built off the bound grid produces. This surface's drawing
  // rule keeps `held` on the grid by construction, and this is the proof.
  expect(
    markup.includes('data-paging="limit"'),
    `a first screen of /browse drew the limit arm for ${JSON.stringify(params)}`,
  ).toBe(false);
  return markup;
}

/** The table's header labels, in document order. */
function headers(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("thead th")
    .toArray()
    .map((th) => $(th).text().trim());
}

/** Each body row's cells, as trimmed text. */
function bodyRows(markup: string): string[][] {
  const $ = cheerio.load(markup);
  return $("tbody tr")
    .toArray()
    .map((tr) =>
      $(tr)
        .find("td")
        .toArray()
        .map((td) => $(td).text().replace(/\s+/g, " ").trim()),
    );
}

/**
 * Every href a click can FOLLOW — anchors only, never `[href]`.
 *
 * React 19's server renderer hoists each `<img src>` into a
 * `<link rel="preload" as="image" href="…">` in the head (observed on this
 * page's delivered markup, 2026-09-03: two poster preloads pointing at the
 * poster host). Those are resource hints the browser fetches, not places the
 * operator can go, and counting them as links makes the bar-10 assertion
 * below fail on markup that navigates nowhere.
 */
function hrefs(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("a[href]")
    .toArray()
    .map((el) => $(el).attr("href") ?? "");
}

/** The text of each red state line, in document order. */
function alerts(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $('[role="alert"]')
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim());
}

/** The label a configured column renders under. */
function labelOf(key: BrowseColumnKey): string {
  const column = view.columns.find((each) => each.key === key);
  if (!column) throw new Error(`${key} is not configured`);
  return column.label;
}

/**
 * The POSTER column's `<td>`s, in row order, with the document they came
 * from. The column is located by its configured label rather than a literal
 * index, so adding or reordering a column moves this with it.
 */
function posterColumn(markup: string) {
  const $ = cheerio.load(markup);
  const index = headers(markup).indexOf(labelOf("poster"));
  if (index < 0) throw new Error("the poster column is not on screen");
  const cells = $("tbody tr")
    .toArray()
    .map((tr) => $(tr).find("td").toArray()[index]);
  return { $, cells };
}

describe("the page's rows", () => {
  it("renders the newest arrival first", async () => {
    const markup = await renderBrowse(healthyScript());
    const titleColumn = headers(markup).indexOf(labelOf("title"));
    const rows = bodyRows(markup);
    expect(rows).toHaveLength(2);
    expect(rows[0][titleColumn]).toBe("newest arrival");
    expect(rows[1][titleColumn]).toBe("older arrival");
  });

  it("renders every spot-verification column, sources included", async () => {
    const markup = await renderBrowse(healthyScript());
    const labels = headers(markup);
    for (const key of [
      "title",
      "starts_at",
      "venue",
      "description",
      "poster",
      "sources",
    ] as BrowseColumnKey[]) {
      expect(labels, key).toContain(labelOf(key));
    }
  });

  it("shows the source names the provenance join resolved", async () => {
    const markup = await renderBrowse(healthyScript());
    const column = headers(markup).indexOf(labelOf("sources"));
    const rows = bodyRows(markup);
    expect(rows[0][column]).toContain("ticketmaster");
    expect(rows[0][column]).toContain("bandsintown");
    // The older event has no provenance at all: an absence, not an empty cell.
    expect(rows[1][column]).toBe(EM_DASH);
  });

  /**
   * The rendered twin of the two `joinBrowseRows` pins in `views.test.ts`:
   * `field_provenance` is an append-only decision log
   * (`contracts/data-model.md`, Per-field provenance), so a superseded
   * decision's source is history and an unset decision names no source at
   * all. Neither may reach the Sources cell.
   */
  it("does not name a superseded source, or a decision with no source", async () => {
    const markup = await renderBrowse(
      healthyScript({
        [T.fieldProvenance]: {
          data: [
            // (EVENT_NEW, title) decided twice — only the later one stands.
            fieldProvenanceRow({
              entity_id: EVENT_NEW,
              field: "title",
              source_id: ID.sourceBandsintown,
              applied_at: "2026-01-01T00:00:00Z",
            }),
            fieldProvenanceRow({
              entity_id: EVENT_NEW,
              field: "title",
              source_id: ID.sourceTicketmaster,
              applied_at: "2026-08-01T00:00:00Z",
            }),
            // A verdict unset: source_id is null (scraper migration
            // 20260901000005 §1).
            { ...fieldProvenanceRow({ entity_id: EVENT_NEW, field: "poster_url" }), source_id: null },
          ],
          count: 3,
        },
      }),
    );
    const column = headers(markup).indexOf(labelOf("sources"));
    expect(bodyRows(markup)[0][column]).toBe("ticketmaster");
  });

  it("shows the venue name from the listings view", async () => {
    const markup = await renderBrowse(healthyScript());
    const column = headers(markup).indexOf(labelOf("venue"));
    expect(bodyRows(markup)[0][column]).toBe("Crypto.com Arena");
  });

  /**
   * The poster cell (admin-window/BUG-0048).
   *
   * It shipped as a 24x24 thumbnail wrapped in an anchor straight at the
   * scraped `poster_url` and carrying no `target`, so the one click the
   * column invites replaced the Admin tab with a raw image on a third-party
   * CDN. How BIG the image is, is a Look judgement the walk owns and no
   * markup assertion should pin. The two things that made it a defect are
   * structural and belong here: the image really is the cell (carrying the
   * event's own title as its alt, so it is announced as the row it belongs
   * to), and the cell leads nowhere out of the app.
   */
  it("renders the poster as an image whose alt is the event's own title", async () => {
    const { $, cells } = posterColumn(await renderBrowse(healthyScript()));
    const images = cells.map((td) => $(td).find("img"));
    expect(images[0].attr("src")).toBe(
      "https://example.invalid/posters/new.jpg",
    );
    expect(images[0].attr("alt")).toBe("newest arrival");
    expect(images[1].attr("src")).toBe(
      "https://example.invalid/posters/old.jpg",
    );
    expect(images[1].attr("alt")).toBe("older arrival");
  });

  it("falls back to the event id for the alt of a poster on an untitled row", () => {
    // An `alt=""` image is announced as decoration, which a poster is not.
    // The title cell already stands the machine id in for a missing title;
    // the alt takes the same substitute rather than going empty.
    const markup = render(
      h(BrowseTable, {
        view,
        shown: ["poster"] as BrowseColumnKey[],
        rows: [
          {
            event_id: EVENT_NEW,
            title: null,
            description: null,
            poster_url: "https://example.invalid/posters/untitled.jpg",
            starts_at: null,
            created_at: null,
            venue_name: null,
            sources: [],
          },
        ],
      }),
    );
    const $ = cheerio.load(markup);
    expect($("img").attr("alt")).toBe(EVENT_NEW);
  });

  it("does not let the poster — or anything else — navigate out of the app", async () => {
    const markup = await renderBrowse(healthyScript());
    const { $, cells } = posterColumn(markup);
    // The poster is not a link at all, so there is no tab to lose and no
    // `target` to get wrong: the operator's place in the list survives a
    // click on it because a click on it goes nowhere.
    expect(cells).toHaveLength(2);
    for (const td of cells) {
      expect($(td).find("img").toArray()).toHaveLength(1);
      expect($(td).find("a").toArray()).toHaveLength(0);
    }
    // LOOK_AND_FEEL bar 10, over the whole page: every href Browse renders
    // is an in-app path. Non-vacuous — the row links and the column
    // selector's links are really in this set, and an absolute `https://`
    // href is what this must catch.
    const links = hrefs(markup);
    expect(links).toContain(recordHref("events", EVENT_NEW));
    expect(links.some((href) => href.startsWith("/browse"))).toBe(true);
    expect(links.filter((href) => !href.startsWith("/"))).toEqual([]);
  });

  it("links every row to its own record surface", async () => {
    const markup = await renderBrowse(healthyScript());
    const links = hrefs(markup);
    expect(links).toContain(recordHref("events", EVENT_NEW));
    expect(links).toContain(recordHref("events", EVENT_OLD));
  });

  /**
   * Bar 10 costs most here: every one of the 50 titles goes to its own record
   * surface, and until admin-window/BUG-0108 not one of them said so at rest,
   * so the page read as a static list of event names. The other columns stay
   * out of the link's ink — that is what makes the title column legible as the
   * one way in.
   */
  it("draws every linked title as a link at rest, and nothing else", async () => {
    const markup = await renderBrowse(healthyScript());
    const $ = cheerio.load(markup);
    const anchors = $("tbody a[href]").toArray();
    expect(anchors.length, "no row linked anywhere").toBe(bodyRows(markup).length);
    for (const anchor of anchors) {
      expectDrawnAsLinkAtRest(classesOf($(anchor)), `the title ${$(anchor).text().trim()}`);
    }

    const titleColumn = headers(markup).indexOf(labelOf("title"));
    const others = $("tbody tr")
      .toArray()
      .flatMap((tr) =>
        $(tr)
          .find("td")
          .toArray()
          .filter((_, at) => at !== titleColumn),
      );
    expect(others.length, "no other columns to compare against").toBeGreaterThan(0);
    for (const cell of others) expectNotDrawnAsLink(classesOf($(cell)), "a non-title cell");
  });

  it("draws a row with no record to lead to unlinked, not dead", () => {
    // The record href is the app's one helper and answers null when there is
    // no canonical row (admin-window/DEBT-0001). An event row always carries
    // its id, so this is the branch the table keeps rather than re-adding an
    // events-only variant of the URL: the row still renders, without a link.
    const row = (event_id: string, title: string) => ({
      event_id,
      title,
      description: null,
      poster_url: null,
      starts_at: null,
      created_at: null,
      venue_name: null,
      sources: [],
    });
    const markup = render(
      h(BrowseTable, {
        view,
        shown: ["title"] as BrowseColumnKey[],
        rows: [row(EVENT_NEW, "has a record"), row("", "has none")],
      }),
    );
    const $ = cheerio.load(markup);
    const linked = $("a")
      .toArray()
      .map((anchor) => $(anchor).text());
    expect(linked).toEqual(["has a record"]);
    // Unlinked is not undrawn: the row is still on screen.
    expect(textOf(markup)).toContain("has none");
  });

  /**
   * Voice bar 6 states the zone ONCE per column. It was stated twice — header
   * and all 50 cells — which overflowed the column and wrapped every row onto
   * two lines (admin-window/BUG-0047). The assertion is over the DELIVERED
   * markup, header and cells together, because either end alone can carry it
   * and only the pair can double it.
   */
  it("states the scheduled time in UTC, with the zone in the header ONLY", async () => {
    const markup = await renderBrowse(healthyScript());
    const label = labelOf("starts_at");
    const column = headers(markup).indexOf(label);
    const cells = bodyRows(markup).map((row) => row[column]);
    expect(cells).toHaveLength(2);

    // The value is the absolute instant, never a raw ISO string — and never
    // the zone again, which the header above it already said.
    for (const cell of cells) {
      expect(cell).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }

    // Exactly one utterance of the zone in the whole column, and it is the
    // header's: counted, so a second token anywhere fails this.
    const utterances = (text: string) => text.split(UTC_ZONE).length - 1;
    expect(utterances(label)).toBe(1);
    expect([label, ...cells].reduce((n, t) => n + utterances(t), 0)).toBe(1);
  });

  it("renders a missing scheduled time as the dash, not a bare zone token", () => {
    const markup = render(
      h(BrowseTable, {
        view,
        shown: ["starts_at"] as BrowseColumnKey[],
        rows: [
          {
            event_id: EVENT_NEW,
            title: "no date yet",
            description: null,
            poster_url: null,
            starts_at: null,
            created_at: null,
            venue_name: null,
            sources: [],
          },
        ],
      }),
    );
    const cell = bodyRows(markup)[0][0];
    expect(cell).toBe(EM_DASH);
    expect(cell).not.toContain(UTC_ZONE);

    // And it is the app's ONE absence rendering, not a second em dash this
    // column draws itself (`nullDash`, LESSONS class 1): the cell hands
    // `DataTable` a bare string precisely so `orDash` can wrap it. Asserted on
    // the accessible name, because the dash's TEXT is identical either way —
    // a starts cell that returned its own dash would satisfy the two lines
    // above while quietly dropping out of the shared rendering (QA, BUG-0047).
    const $ = cheerio.load(markup);
    expect($('tbody td [aria-label="no value"]')).toHaveLength(1);
    expect($('tbody td [aria-label="no value"]').text()).toBe(EM_DASH);
  });

  it("carries the absolute instant behind every relative age", async () => {
    const markup = await renderBrowse(healthyScript());
    const $ = cheerio.load(markup);
    const titled = $("tbody [title]")
      .toArray()
      .map((el) => $(el).attr("title") ?? "");
    expect(titled.some((t) => t.endsWith("UTC"))).toBe(true);
  });
});

/* ── the window it is showing ─────────────────────────────────────────────── */

/** The events window line: its published facts and its sentence. */
function windowLine(markup: string) {
  const line = cheerio.load(markup)('[data-window="events"]');
  return {
    lines: line.length,
    limit: line.attr("data-window-limit"),
    held: line.attr("data-window-held"),
    truncated: line.attr("data-window-truncated"),
    text: line.text().replace(/\s+/g, " ").trim(),
  };
}

/**
 * `count` events, newest arrival first, a day apart — a window that fills.
 *
 * `from` is where in that one descending run the slice starts, so the PAGE a
 * press brings back (admin-window/TASK-0069) is the continuation of the first
 * screen rather than a second population that happens to have other ids.
 */
function arrivals(count: number, from = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = from + offset;
    return eventRow({
      event_id: `01920000-0000-7000-8000-0000000b${String(index).padStart(4, "0")}`,
      title: `arrival ${index}`,
      created_at: new Date(Date.parse("2026-09-01T00:00:00Z") - index * 86_400_000)
        .toISOString(),
    });
  });
}

/**
 * Bar 13 on `/browse` (admin-window/BUG-0109). The catalog arm carried NO
 * truncation clause at all, so a window holding 50 of 50 — where older events
 * certainly exist — and one holding two, which are the whole catalog, rendered
 * the identical sentence. Both directions are graded, on two populations.
 */
describe("the events window states whether it filled", () => {
  it("publishes the read's own facts, and says the window did not fill", async () => {
    const markup = await renderBrowse(healthyScript());
    const line = windowLine(markup);
    expect(line.lines).toBe(1);
    expect(line.limit).toBe(String(view.window));
    expect(line.held).toBe(String(population().length));
    expect(line.truncated).toBe("false");
    // The bottom of the list is the CATALOG's floor, not the window's, so the
    // line names the oldest arrival it holds — the fixture's own instant,
    // rendered the way this app renders one.
    const oldest = [...population()].sort((a, b) =>
      (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1,
    )[0].created_at;
    expect(line.text).toContain(absoluteUtc(oldest));
  });

  it("says the window filled its cap, and names no floor of its own", async () => {
    const full = arrivals(view.window);
    const markup = await renderBrowse(healthyScript({ [T.events]: { data: full } }));
    const line = windowLine(markup);
    expect(line.held).toBe(String(view.window));
    expect(line.truncated).toBe("true");
    // Its last row is the cap's, not the catalog's: older events exist and
    // are not shown, so the line must not offer that row as a floor.
    expect(line.text).not.toContain(absoluteUtc(full[full.length - 1].created_at));
  });

  it("keeps its line on a read that found nothing, and drops it on one that did not happen", async () => {
    // The line follows the READ, not the rows (ARCHITECTURE.md §4.3).
    const empty = await renderBrowse(healthyScript({ [T.events]: { data: [] } }));
    expect(windowLine(empty).held).toBe("0");
    expect(windowLine(empty).truncated).toBe("false");

    const absent = await renderBrowse(
      healthyScript({ [T.events]: { error: tableNotInSchemaCache(T.events) } }),
    );
    expect(windowLine(absent).lines).toBe(0);
  });
});

describe("the column selector on the page", () => {
  /** The selector's chips: their label and the href each one points at. */
  function options(markup: string): { label: string; href: string; active: boolean }[] {
    const $ = cheerio.load(markup);
    return $('[role="group"] a')
      .toArray()
      .map((a) => ({
        label: $(a).text().trim(),
        href: $(a).attr("href") ?? "",
        active: $(a).attr("aria-current") === "true",
      }));
  }

  it("offers exactly the configured column set — every one, nothing else", async () => {
    const markup = await renderBrowse(healthyScript());
    expect(options(markup).map((o) => o.label)).toEqual(
      view.columns.map((c) => c.label),
    );
  });

  it("offers the same set when the URL shows only one column", async () => {
    const markup = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: "title",
    });
    expect(options(markup).map((o) => o.label)).toEqual(
      view.columns.map((c) => c.label),
    );
    expect(headers(markup)).toEqual([labelOf("title")]);
  });

  it("marks the shown columns active and the hidden ones not", async () => {
    const markup = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: columnsParamValue(["title", "sources"]),
    });
    const active = options(markup)
      .filter((o) => o.active)
      .map((o) => o.label);
    expect(active).toEqual([labelOf("title"), labelOf("sources")]);
  });

  it("hides exactly the column a chip's link takes away", async () => {
    const before = await renderBrowse(healthyScript());
    const venueChip = options(before).find((o) => o.label === labelOf("venue"));
    expect(venueChip).toBeDefined();

    const url = new URL(venueChip?.href ?? "", "https://admin.invalid");
    const after = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: url.searchParams.get(COLUMNS_PARAM) ?? undefined,
    });

    const gone = headers(before).filter((h) => !headers(after).includes(h));
    expect(gone).toEqual([labelOf("venue")]);
  });

  it("round-trips its state through the URL for every configured column", async () => {
    for (const key of configuredKeys(view)) {
      const markup = await renderBrowse(healthyScript(), {
        [COLUMNS_PARAM]: columnsParamValue([key]),
      });
      expect(headers(markup), key).toEqual([labelOf(key)]);
    }
  });

  it("ignores a column the view does not configure", async () => {
    const markup = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: "title,ticket_url",
    });
    expect(headers(markup)).toEqual([labelOf("title")]);
  });

  it("shows the default set when the URL says nothing about columns", async () => {
    const markup = await renderBrowse(healthyScript());
    expect(headers(markup)).toEqual(
      shownColumns(view, undefined).map((key) => labelOf(key)),
    );
  });
});

describe("every state renders without throwing", () => {
  it("renders the rows when the database is whole", async () => {
    const markup = await renderBrowse(healthyScript());
    expect(bodyRows(markup)).toHaveLength(2);
  });

  it("renders an empty state, not a table of nothing, when there are no events", async () => {
    const markup = await renderBrowse({ [T.events]: { data: [] } });
    expect(markup).toContain("<h1");
    expect(bodyRows(markup)).toEqual([]);
    expect(cheerio.load(markup)("table").length).toBe(0);
  });

  it("names the missing table when events itself is absent", async () => {
    const markup = await renderBrowse({
      [T.events]: { error: tableNotInSchemaCache(T.events) },
    });
    expect(markup).toContain(T.events);
    expect(markup).not.toContain("0 events");
    expect(cheerio.load(markup)("table").length).toBe(0);
  });

  it("shows the database's own words when a read fails", async () => {
    const markup = await renderBrowse({
      [T.events]: { error: permissionDenied(T.events) },
    });
    expect(markup).toContain(permissionDenied(T.events).message);
    expect(cheerio.load(markup)('[role="alert"]').length).toBeGreaterThan(0);
  });

  it("still renders the event rows with field_provenance absent, and says so", async () => {
    // The acceptance criterion, at the surface: rows render AND the page names
    // the missing table. Either way nothing throws.
    const markup = await renderBrowse(
      healthyScript({
        [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
      }),
    );
    expect(bodyRows(markup)).toHaveLength(2);
    expect(markup).toContain(T.fieldProvenance);

    const column = headers(markup).indexOf(labelOf("sources"));
    for (const row of bodyRows(markup)) expect(row[column]).toBe(EM_DASH);
  });

  it("still renders the event rows with the listings view absent, and says so", async () => {
    const markup = await renderBrowse(
      healthyScript({
        [T.eventListings]: { error: tableNotInSchemaCache(T.eventListings) },
      }),
    );
    expect(bodyRows(markup)).toHaveLength(2);
    expect(markup).toContain(T.eventListings);

    const column = headers(markup).indexOf(labelOf("venue"));
    for (const row of bodyRows(markup)) expect(row[column]).toBe(EM_DASH);
  });

  it("renders with no database credential in the environment", async () => {
    const restore = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.includes("SUPABASE")) delete process.env[key];
    }
    try {
      readWith.client = undefined;
      const markup = render(await BrowsePage());
      expect(markup).toContain("<h1");
      expect(cheerio.load(markup)('[role="alert"]').length).toBeGreaterThan(0);
    } finally {
      process.env = restore;
    }
  });

  /**
   * admin-window/BUG-0016: the whole error state used to be "TypeError: fetch
   * failed", which names none of Browse's four reads and drops the cause the
   * client put in `details`. Both halves are asserted here at the surface.
   */
  it("names which read failed, so the legs are told apart on screen", async () => {
    const markup = await renderBrowse(
      healthyScript({
        [T.eventListings]: { error: transportFailure() },
        [T.fieldProvenance]: { error: transportFailure() },
      }),
    );

    const lines = alerts(markup);
    expect(lines).toHaveLength(2);
    // Two legs refused with the SAME client message; only the read they name
    // tells them apart, which is the operator's whole question.
    expect(lines.some((line) => line.includes(T.eventListings))).toBe(true);
    expect(lines.some((line) => line.includes(T.fieldProvenance))).toBe(true);
    // The rows still render: a failed leg is its own state, not the page's.
    expect(bodyRows(markup)).toHaveLength(2);
  });

  it("shows the cause the client put in details, not the wrapper alone", async () => {
    const markup = await renderBrowse({ [T.events]: { error: transportFailure() } });

    const lines = alerts(markup);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("bad port");
    expect(lines[0]).toContain(T.events);
    // Still the state LINE inside the table, and still nothing thrown.
    expect(cheerio.load(markup)("thead th").length).toBeGreaterThan(0);
  });

  it("names the sources read when the FOURTH leg is the one that refused", async () => {
    // Browse makes four reads and the sources read is the last of them; it
    // reports through the provenance slot, so without its own `reading` an
    // operator would be told the provenance read failed when it did not
    // (criterion 1's fourth leg, QA on BUG-0016).
    const markup = await renderBrowse(
      healthyScript({ [T.sources]: { error: transportFailure() } }),
    );

    const lines = alerts(markup);
    expect(lines.some((line) => line.includes(T.sources))).toBe(true);
    expect(lines.some((line) => line.includes(T.fieldProvenance))).toBe(false);
    // The events still render: one leg's refusal is not the page's.
    expect(bodyRows(markup)).toHaveLength(2);
  });

  it("never renders a credential the client's account quoted", async () => {
    // The account now carries `details` verbatim onto a screen, so the scrub
    // in `result.ts` is the only thing between a quoted request and the
    // markup. Asserted end to end, at the surface, not at the seam.
    const jwtShaped = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ role: "not-a-real-role" })).toString("base64url"),
      "n0tar3alsignaturevalue",
    ].join(".");
    const host = "abcdefghijklmnopqrst.supabase.co";

    const markup = await renderBrowse({
      [T.events]: {
        error: {
          code: "",
          hint: `retry with sb_secret_000notarealsecret000`,
          message: "TypeError: fetch failed",
          details: `GET https://${host}/rest/v1/events?apikey=${jwtShaped} failed`,
        },
      },
    });

    expect(markup).not.toContain(jwtShaped);
    for (const segment of jwtShaped.split(".")) {
      expect(markup).not.toContain(segment);
    }
    expect(markup).not.toContain("sb_secret_000notarealsecret000");
    // The host stays: it is what the database could not be reached at.
    expect(alerts(markup)[0]).toContain(host);
    expect(alerts(markup)[0]).toContain(T.events);
  });

  it("keeps an absent object gray and unnamed by the red line", async () => {
    // Red means broken, never unavailable: a table-absent code is still the
    // not-provisioned card, not an error line (BUG-0016 criterion 4).
    const markup = await renderBrowse({
      [T.events]: { error: tableNotInSchemaCache(T.events) },
    });
    expect(alerts(markup)).toEqual([]);
    expect(markup).toContain(T.events);
  });

  it("gives the page exactly one h1 in every state", async () => {
    for (const script of [
      healthyScript(),
      { [T.events]: { data: [] } },
      { [T.events]: { error: tableNotInSchemaCache(T.events) } },
      { [T.events]: { error: permissionDenied(T.events) } },
    ] as Script[]) {
      const markup = await renderBrowse(script);
      expect([...markup.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    }
  });
});

/* ── the addressing the live oracle depends on ───────────────────────────── */

/**
 * The name the events BODY answers to (`data-surface`,
 * `src/app/browse/page.tsx`), as `tests/live/browse.live.test.ts` addresses
 * it.
 */
const EVENTS_HOOK = '[data-surface="events"]';

describe("the surface hooks the live parity oracle addresses", () => {
  /**
   * The live oracle grades ONE surface and `stateOf` (`tests/live/parity.ts`)
   * refuses any selector matching other than exactly one element. Until
   * admin-window/DEBT-0002 it addressed this body as
   * `section:nth-of-type(1) > :last-child`, compounding the page's section
   * ORDER with the body's position among its section's own children: one added
   * section, or one more leg note rendered below the table, either duplicates
   * the match or repoints it at a leg note — silently, because a leg note is a
   * perfectly readable state card. On `/cycles` the same class threw
   * `MarkupReadError` in four live tests (admin-window/BUG-0040,
   * admin-window/BUG-0056).
   *
   * Nothing offline could see any of that — `npm test` runs the offline and
   * isolated projects only — so the live oracle's addressing had no pin in CI.
   * These cases are that pin, in the file that owns this page's markup.
   */
  it("gives the events surface exactly one element, in every state", async () => {
    const states: [string, string][] = [
      ["populated", await renderBrowse(healthyScript())],
      [
        "one column",
        await renderBrowse(healthyScript(), { [COLUMNS_PARAM]: "event_id" }),
      ],
      ["empty", await renderBrowse(healthyScript({ [T.eventListings]: { data: [], count: 0 } }))],
      // The states that swap the body for a card are exactly where a wrapper
      // is most likely to appear or vanish.
      ["absent", await renderBrowse(healthyScript({ [T.eventListings]: { error: tableNotInSchemaCache(T.eventListings) } }))],
      ["refused", await renderBrowse(healthyScript({ [T.eventListings]: { error: permissionDenied(T.eventListings) } }))],
      // Both leg notes rendering above the body: the branch where the old
      // `> :last-child` addressing was one element away from reading a leg.
      [
        "both legs unavailable",
        await renderBrowse(
          healthyScript({
            [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
            [T.sources]: { error: permissionDenied(T.sources) },
          }),
        ),
      ],
    ];
    for (const [name, markup] of states) {
      expect(surfaceHooks(markup, [EVENTS_HOOK]), name).toEqual({
        counts: oneEach([EVENTS_HOOK]),
        nested: [],
      });
    }
  });

  it("holds the events body and nothing else — the leg notes stay outside it", async () => {
    // A hook that is unique but points at the wrong surface is the same bug
    // wearing a different hat. The venues and provenance legs are separate
    // reads with separate states: a surface that swallowed them would grade an
    // unreadable venue join as unreadable events.
    const populated = cheerio.load(await renderBrowse(healthyScript()));
    expect(populated(EVENTS_HOOK).find("tbody tr").length).toBeGreaterThan(0);
    expect(populated(EVENTS_HOOK).find("[data-state]").length).toBe(0);

    const legsBroken = cheerio.load(
      await renderBrowse(
        healthyScript({
          [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
          [T.sources]: { error: permissionDenied(T.sources) },
        }),
      ),
    );
    // The legs' own cards render on the page, and none of them is inside the
    // events surface — which still holds the table it read fine.
    expect(legsBroken("[data-state]").length).toBeGreaterThan(0);
    expect(legsBroken(EVENTS_HOOK).find("[data-state]").length).toBe(0);
    expect(legsBroken(EVENTS_HOOK).find("tbody tr").length).toBeGreaterThan(0);
  });
});

/* ── the affordance that continues the one curated view ──────────────────── */

/**
 * `/browse` pages further down its one curated view — campaign
 * admin-window/TASK-0069, SPEC F14.
 *
 * What is asserted HERE is what this surface decides. The five states
 * `PageMore` draws, the driver's rules and the bound guard are pinned where
 * they live (`tests/offline/ui/paging.test.ts`, `tests/offline/paging/
 * machine.test.ts`, `tests/offline/paging/bounds.test.ts`); this file grades
 * the page's drawing rule, what it hands down, where the pieces SIT, and what
 * a press does to the markup.
 *
 * **The drawing rule is a FULL first window.** Browse's events read is a
 * WINDOW read with no count beside it at all, so there is no total to compare
 * against and a `total`-derived affordance would never be reachable. The
 * honest signal is that the window came back full, asked of `pageBound` — the
 * one function that answers "is this `held` a bound this surface can page
 * from" — so a short window is never `more: true` and no state is ever built
 * off the bound grid (QA, admin-window/BUG-0168). `renderBrowse` sweeps every
 * first screen in this file for the `limit` arm, which is what that state
 * would produce.
 */

/** Every paging element in the markup, by the arm it drew. */
function pagingArms(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-paging]")
    .toArray()
    .map((element) => $(element).attr("data-paging") ?? "");
}

/** Every paging element's own markup, for a byte comparison of two renders. */
function pagingHtml(markup: string): string {
  return cheerio.load(markup)("[data-paging]").toString();
}

/** How many times the paging hook is spelled at all — refusals included. */
function pagingOccurrences(markup: string): number {
  return (markup.match(/data-paging/g) ?? []).length;
}

/** The control's own words, without pinning the sentence around them. */
function controlText(markup: string): string {
  const found = markup.match(/<button[^>]*>([^]*?)<\/button>/);
  return found?.[1]?.replace(/<[^>]*>/g, "") ?? "";
}

/** The bound one request carried. */
function boundOf(url: string): string | null {
  return new URLSearchParams(url.split("?")[1]).get(OFFSET_PARAM);
}

/** The event ids the page RENDERED, read off each row's own record link. */
function eventIds(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("tbody tr")
    .toArray()
    .flatMap((tr) => {
      const href = $(tr).find('a[href^="/records/events/"]').first().attr("href");
      return href ? [decodeURIComponent(href.slice("/records/events/".length))] : [];
    });
}

/** A recording stub for the ONE network call this app makes. */
function recordingFetch(answer: unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    // `Response.json`, because that is what `/api/admin/browse/rows` really
    // answers with, and `fetchJson` reads the DECLARED content type before it
    // reads a body (admin-window/TASK-0076).
    return Promise.resolve(Response.json(answer));
  });
  return urls;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A database whose events window answers `count` rows, legs all fine. */
function windowScript(count: number, overrides: Script = {}): Script {
  const events = arrivals(count);
  const listings = events.map((event) =>
    eventListingRow({ event_id: event.event_id, venue_name: "Crypto.com Arena" }),
  );
  return {
    [T.events]: { data: events },
    [T.eventListings]: { data: listings, count: listings.length },
    [T.fieldProvenance]: { data: [], count: 0 },
    [T.sources]: { data: [], count: 0 },
    ...overrides,
  };
}

/** The shaped rows a PAGE of the same view carries over the wire. */
function pageRows(count: number, from: number): BrowseRow[] {
  return arrivals(count, from).map((event) => ({
    event_id: event.event_id,
    title: event.title,
    description: event.description,
    poster_url: event.poster_url,
    starts_at: event.starts_at,
    created_at: event.created_at,
    venue_name: "Crypto.com Arena",
    sources: [],
  }));
}

/** An `ok` page answer with this surface's own leg notes on it. */
function pageAnswer(
  from: number,
  notes: Record<string, PageNote | null>,
  rows = view.window,
): NotedPageAnswer<BrowseRow, Record<string, PageNote | null>> {
  return {
    kind: "ok",
    rows: pageRows(rows, from),
    offset: from,
    exhausted: rows < view.window,
    notes,
  };
}

/**
 * The state the REAL driver reaches from the REAL deps the wrapper built, fed
 * `answers` in order. Only React's second render is substituted — see the
 * spy's comment above.
 */
async function pressedWith(...answers: unknown[]): Promise<PageState<BrowseRow>> {
  const call = paging.calls[0];
  if (call === undefined) throw new Error("the page drew no paging wrapper");
  let state = call.initial as unknown as PageState<BrowseRow>;
  for (const answer of answers) {
    state = await requestPage<BrowseRow>(state, {
      ...(call.deps as { route: string; params: string; size: number }),
      fetchJson: () => Promise.resolve(answer),
    });
  }
  return state;
}

describe("the affordance that continues the recent-events view", () => {
  beforeEach(() => {
    paging.calls = [];
    paging.press = null;
    paging.override = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws exactly one control on a FULL first window, and leaves the first screen alone", async () => {
    const markup = await renderBrowse(windowScript(view.window));

    // The first screen: the window read's own rows, in its own arrival order,
    // under the same window line and the same columns the page drew before
    // this ticket — the four things the criterion names.
    expect(eventIds(markup)).toEqual(arrivals(view.window).map((row) => row.event_id));
    const line = windowLine(markup);
    expect(line.lines).toBe(1);
    expect(line.limit).toBe(String(view.window));
    expect(line.held).toBe(String(view.window));
    expect(line.truncated).toBe("true");
    expect(headers(markup)).toEqual(configuredKeys(view).map((key) => labelOf(key)));

    // …and ONE addition below it.
    expect(pagingArms(markup)).toEqual(["more"]);
    expect(controlText(markup)).toContain(String(view.window));

    const $ = cheerio.load(markup);
    // Below the rows, OUTSIDE the surface the live oracle grades, and outside
    // the table: the row markup is untouched and the control is not a row.
    expect($(EVENTS_HOOK).find("[data-paging]")).toHaveLength(0);
    expect($("table").find("[data-paging]")).toHaveLength(0);
    expect($(EVENTS_HOOK).find("table")).toHaveLength(1);
  });

  it("draws none where the window came back SHORT, empty, absent or refused", async () => {
    // 1. A SHORT window — the read that filled this screen is the read that
    //    says the set has ended, and the window line states it in its own
    //    numbers. No control, and no sentence claiming there is more.
    const short = await renderBrowse(windowScript(view.window - 1));
    expect(eventIds(short)).toHaveLength(view.window - 1);
    expect(windowLine(short).truncated).toBe("false");
    expect(pagingOccurrences(short)).toBe(0);

    // 2. An EMPTY `ok` window: the Empty card and the window line stand
    //    exactly as they did, and no control is offered for rows that do not
    //    exist.
    const empty = await renderBrowse({ [T.events]: { data: [] } });
    expect(windowLine(empty).held).toBe("0");
    expect(pagingOccurrences(empty)).toBe(0);

    // 3. and 4. The two states that carry no rows at all.
    for (const [why, error] of [
      ["an absent events table", tableNotInSchemaCache(T.events)],
      ["a refused events read", permissionDenied(T.events)],
    ] as const) {
      const broken = await renderBrowse({ [T.events]: { error } });
      expect(pagingOccurrences(broken), why).toBe(0);
    }

    // The wrapper was never rendered in any of them, so nothing downstream
    // had to be honest about a state that cannot be honoured.
    expect(paging.calls).toEqual([]);
  });

  it("hands the hook the rows it RENDERED, at this app's own route and window", async () => {
    await renderBrowse(windowScript(view.window));
    expect(paging.calls).toHaveLength(1);
    const { initial, deps } = paging.calls[0];
    // `held` is the rendered row count; there is no count on this surface and
    // nothing here is derived from the limit the read asked for.
    expect(initial.held).toBe(view.window);
    expect(initial.rows).toEqual([]);
    expect(initial.status).toBe("idle");
    // A first screen renders its OWN legs; this state holds no note at all.
    expect(initial.notes).toBeNull();
    expect(deps.route).toBe(PAGE_ROUTES.browse);
    expect(deps.size).toBe(view.window);
  });

  it("carries the COLUMN STATE the page rendered, and writes no offset into any URL", async () => {
    const shownNow: BrowseColumnKey[] = ["title", "venue"];
    const urls = recordingFetch(pageAnswer(view.window, { venues: null, provenance: null }));
    const markup = await renderBrowse(windowScript(view.window), {
      [COLUMNS_PARAM]: columnsParamValue(shownNow),
    });

    // The screen really is the narrowed one, and it still pages.
    expect(headers(markup)).toEqual(shownNow.map((key) => labelOf(key)));
    expect(pagingArms(markup)).toEqual(["more"]);

    const carried = new URLSearchParams(paging.calls[0].deps.params);
    expect(carried.get(COLUMNS_PARAM)).toBe(columnsParamValue(shownNow));
    expect([...carried.keys()]).toEqual([COLUMNS_PARAM]);

    // …and the same state reaches the wire, with the bound beside it.
    paging.press?.();
    await settle();
    const asked = new URLSearchParams(urls[0].split("?")[1]);
    expect(asked.get(COLUMNS_PARAM)).toBe(columnsParamValue(shownNow));
    expect(asked.get(OFFSET_PARAM)).toBe(String(view.window));

    // PAGING NEVER REWRITES THE URL: no link this page offers — the column
    // selector's included — carries an offset, so changing a column re-renders
    // the first screen from the server and the paged-in rows are discarded.
    for (const href of hrefs(markup)) {
      expect(
        new URLSearchParams(href.split("?")[1] ?? "").get(OFFSET_PARAM),
        href,
      ).toBeNull();
    }

    // The default column set spells no state at all, so a bookmark of the
    // default screen carries nothing redundant.
    paging.calls = [];
    await renderBrowse(windowScript(view.window));
    expect(paging.calls[0].deps.params).toBe("");
  });

  it("one press issues one request at an explicit bound; no press issues none", async () => {
    const urls = recordingFetch(pageAnswer(view.window, { venues: null, provenance: null }));

    await renderBrowse(windowScript(view.window));
    // Zero presses, zero requests: the first screen is the server's.
    expect(urls).toEqual([]);

    const press = paging.press;
    if (press === null) throw new Error("the wrapper handed the widget no press");
    press();
    await settle();

    expect(urls).toHaveLength(1);
    expect(boundOf(urls[0])).toBe(String(view.window));
    expect(urls[0].startsWith(PAGE_ROUTES.browse)).toBe(true);
  });

  it("a refused page leaves the rendered rows exactly as they were and names the object", async () => {
    // TWO fixtures, the way a guard proves itself (LESSONS 8): a page that
    // MUST refuse, and one that must not. Both states are produced by the REAL
    // driver from the REAL deps this page handed it.
    const script = windowScript(view.window);
    const firstScreen = await renderBrowse(script);
    const first = eventIds(firstScreen);
    expect(first).toHaveLength(view.window);

    // A. the page that must REFUSE — the table went away between two reads.
    paging.override = await pressedWith({ kind: "not_provisioned", missing: T.events });
    const afterRefusal = await renderBrowse(script);
    expect(eventIds(afterRefusal)).toEqual(first);
    const $ = cheerio.load(afterRefusal);
    const refusal = $("[data-paging-refusal]");
    expect(refusal).toHaveLength(1);
    expect(refusal.text()).toContain(T.events);
    // Beside the rows, never inside the table and never inside the surface
    // the live oracle grades as the events read.
    expect($("table").find("[data-paging-refusal]")).toHaveLength(0);
    expect($(EVENTS_HOOK).find("[data-paging-refusal]")).toHaveLength(0);
    // …and the control is still there, because the same bound is retryable.
    expect(pagingArms(afterRefusal)).toContain("more");

    // B. the page that must NOT refuse — a full window, appended in order.
    paging.calls = [];
    paging.override = null;
    await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, { venues: null, provenance: null }),
    );
    const afterPage = await renderBrowse(script);
    expect(cheerio.load(afterPage)("[data-paging-refusal]")).toHaveLength(0);
    expect(eventIds(afterPage)).toEqual([
      ...first,
      ...pageRows(view.window, view.window).map((row) => row.event_id),
    ]);
    // The first screen's rows are untouched, and the new ones are BELOW them.
    expect(eventIds(afterPage).slice(0, view.window)).toEqual(first);
  });

  it("renders a PAGED leg's report below the table, in the same hook and words the first screen uses", async () => {
    // The account the PAGE's own card carries for the same object, on a
    // first-screen fixture where the same table is absent. The paged note must
    // reach the operator as the same sentence — read off the app, never pinned
    // here as a literal.
    const onFirstScreen = cheerio.load(
      await renderBrowse(
        windowScript(view.window, {
          [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
        }),
      ),
    );
    const asTheCardSaysIt = onFirstScreen(`[data-not-provisioned="${T.fieldProvenance}"]`);
    expect(asTheCardSaysIt).toHaveLength(1);

    // …and now a page whose FIRST-screen legs all answered, whose PAGED read
    // finds `field_provenance` absent.
    paging.calls = [];
    const script = windowScript(view.window);
    await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, {
        venues: null,
        provenance: { kind: "not_provisioned", missing: T.fieldProvenance },
      }),
    );
    const markup = await renderBrowse(script);
    const $ = cheerio.load(markup);

    // The page's rows landed…
    expect(eventIds(markup)).toHaveLength(view.window * 2);
    // …and the leg that refused is reported, once, through the SAME hook and
    // in the same words.
    const note = $(`[data-not-provisioned="${T.fieldProvenance}"]`);
    expect(note).toHaveLength(1);
    expect(note.text().replace(/\s+/g, " ").trim()).toBe(
      asTheCardSaysIt.text().replace(/\s+/g, " ").trim(),
    );
    // OUTSIDE the surface the oracle grades — a `StateOf` inside it carries
    // `data-state` and would grade an unreadable provenance leg as an
    // unreadable events window — and ABOVE the control.
    expect($(EVENTS_HOOK).find("[data-state]")).toHaveLength(0);
    const at = markup.indexOf(`data-not-provisioned="${T.fieldProvenance}"`);
    expect(at).toBeGreaterThan(markup.indexOf('data-surface="events"'));
    expect(at).toBeLessThan(markup.indexOf("data-paging"));
  });

  it("renders a FAILED paged leg through data-read-failed, carrying the database's own account", async () => {
    const failure = permissionDenied(T.eventListings);
    const script = windowScript(view.window);
    await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, {
        venues: { kind: "error", reading: T.eventListings, message: failure.message },
        provenance: null,
      }),
    );
    const markup = await renderBrowse(script);
    const $ = cheerio.load(markup);

    const note = $(`[data-read-failed="${T.eventListings}"]`);
    expect(note).toHaveLength(1);
    // The answer's own message, neither reworded nor truncated by this surface.
    expect(note.text()).toContain(failure.message);
    expect($(EVENTS_HOOK).find("[data-state]")).toHaveLength(0);
    // Red means broken: it is an error line, not a not-provisioned card.
    expect(alerts(markup).some((line) => line.includes(T.eventListings))).toBe(true);
  });

  it("reports ONE OBJECT ONCE: a leg the page named is not named again below the rows", async () => {
    // `field_provenance` is absent for the FIRST screen and for the PAGED
    // read. The page names it above the table, so the wrapper does not.
    const script = windowScript(view.window, {
      [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
    });
    await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, {
        venues: null,
        provenance: { kind: "not_provisioned", missing: T.fieldProvenance },
      }),
    );
    const markup = await renderBrowse(script);
    const $ = cheerio.load(markup);

    expect(eventIds(markup)).toHaveLength(view.window * 2);
    expect($(`[data-not-provisioned="${T.fieldProvenance}"]`)).toHaveLength(1);
    // …and the one occurrence is the PAGE's, above the table where it has
    // always stood.
    expect(markup.indexOf(`data-not-provisioned="${T.fieldProvenance}"`)).toBeLessThan(
      markup.indexOf('data-surface="events"'),
    );
  });

  it("keeps a refused leg reported after a later page whose legs answered", async () => {
    // The rows the refused leg left unfilled are still on screen, so the note
    // that explains them may not vanish one press later.
    const script = windowScript(view.window);
    await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, {
        venues: null,
        provenance: { kind: "not_provisioned", missing: T.fieldProvenance },
      }),
      pageAnswer(view.window * 2, { venues: null, provenance: null }),
    );
    const markup = await renderBrowse(script);

    expect(eventIds(markup)).toHaveLength(view.window * 3);
    expect(
      cheerio.load(markup)(`[data-not-provisioned="${T.fieldProvenance}"]`),
    ).toHaveLength(1);
  });

  it("renders no note at all from a state that has taken in no page, or from legs that answered", async () => {
    // A first screen, unpressed: the wrapper holds no note, and the page's own
    // legs answered, so nothing is reported anywhere.
    const first = await renderBrowse(windowScript(view.window));
    const $first = cheerio.load(first);
    expect($first("[data-not-provisioned]")).toHaveLength(0);
    expect($first("[data-read-failed]")).toHaveLength(0);

    // A page whose legs ANSWERED reports nothing either.
    paging.override = await pressedWith(
      pageAnswer(view.window, { venues: null, provenance: null }),
    );
    const after = cheerio.load(await renderBrowse(windowScript(view.window)));
    expect(after("[data-not-provisioned]")).toHaveLength(0);
    expect(after("[data-read-failed]")).toHaveLength(0);
  });

  it("gives the events surface exactly one element wrapping the table alone, in every PAGED state", async () => {
    // The same pin the unpaged states carry, over the states this ticket adds:
    // one element, never nested, holding the table and no `[data-state]`.
    const script = windowScript(view.window);
    const states: [string, string][] = [];

    await renderBrowse(script);
    states.push(["paged, legs fine", await renderBrowse(script)]);

    paging.calls = [];
    await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, {
        venues: { kind: "error", reading: T.eventListings, message: "refused" },
        provenance: { kind: "not_provisioned", missing: T.fieldProvenance },
      }),
    );
    states.push(["paged, both legs broken", await renderBrowse(script)]);
    states.push([
      "paged, both legs broken on the first screen too",
      await renderBrowse(
        windowScript(view.window, {
          [T.eventListings]: { error: permissionDenied(T.eventListings) },
          [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
        }),
      ),
    ]);

    paging.override = await pressedWith({
      kind: "error",
      reading: T.events,
      message: "refused",
    });
    states.push(["paged, the page refused", await renderBrowse(script)]);

    for (const [name, markup] of states) {
      expect(surfaceHooks(markup, [EVENTS_HOOK]), name).toEqual({
        counts: oneEach([EVENTS_HOOK]),
        nested: [],
      });
      const $ = cheerio.load(markup);
      expect($(EVENTS_HOOK).find("[data-state]").length, name).toBe(0);
      expect($(EVENTS_HOOK).find("tbody tr").length, name).toBeGreaterThan(0);
      expect($(EVENTS_HOOK).children().length, name).toBe(1);
    }
  });

  it("spells the window ONCE: the control names the number the driver grades against", async () => {
    // The window is the PROVIDER's dep here, so the surface is driven at a
    // window that is NOT 50 and the same 7-row answer is read twice: it LANDS
    // against a window of 7 (the next press moves on to 14) and is REFUSED
    // against a window of 8 (the next press asks for 8 again) — so the number
    // the driver graded the page against is the number the control renders in
    // its label.
    const consumer = async (
      windowSize: number,
    ): Promise<{ bounds: (string | null)[]; label: string }> => {
      const served = 7;
      const urls = recordingFetch({
        kind: "ok",
        rows: pageRows(served, windowSize),
        offset: windowSize,
        exhausted: false,
        notes: { venues: null, provenance: null },
      });
      const markup = render(
        h(
          PagingProvider,
          {
            initial: initialPage<BrowseRow>(windowSize, true),
            window: thisWindow(windowSize, windowSize),
            deps: { route: PAGE_ROUTES.browse, params: "", size: windowSize },
            children: null,
          },
          h(PagedBrowseTable, {
            surface: "events",
            view,
            shown: configuredKeys(view),
            initial: pageRows(windowSize, 0),
            reported: [],
          }),
        ),
      );
      paging.press?.();
      await settle();
      paging.press?.();
      await settle();
      return { bounds: urls.map(boundOf), label: controlText(markup) };
    };

    const landed = await consumer(7);
    const refused = await consumer(8);

    expect(landed.bounds).toEqual(["7", "14"]);
    expect(refused.bounds).toEqual(["8", "8"]);
    expect(landed.label).toContain("7");
    expect(landed.label).not.toContain("8");
    expect(landed.label).not.toContain(String(view.window));
    expect(refused.label).toContain("8");
    expect(refused.label).not.toContain("7");
  });

  it("draws no control from a SHORT first window, and says the set is complete rather than claiming a ceiling", async () => {
    // Where a surface is started from a short window — which `/browse` never
    // does, because that rule IS the question its page asks before drawing any
    // of this — it says `exhausted` and never `limit`: the read that returned
    // 37 of 50 rows is the read that ended the set, so there is no ceiling to
    // announce and no dead end to hand the operator. The state is built the
    // way the page builds it, off the one function that answers "is this a
    // bound this surface can page from" (admin-window/BUG-0168).
    recordingFetch({ kind: "ok", rows: [], offset: view.window, exhausted: true });
    const short = 37;
    const more = pageBound(String(short), view.window).kind === "ok";
    expect(more, "a short window is not a bound this surface can page from").toBe(false);
    const markup = render(
      h(
        PagingProvider,
        {
          initial: initialPage<BrowseRow>(short, more),
          window: thisWindow(short, view.window),
          deps: { route: PAGE_ROUTES.browse, params: "", size: view.window },
          children: null,
        },
        h(PagedBrowseTable, {
          surface: "events",
          view,
          shown: configuredKeys(view),
          initial: pageRows(short, 0),
          reported: [],
        }),
      ),
    );
    expect(eventIds(markup)).toHaveLength(37);
    expect(pagingArms(markup)).toEqual(["exhausted"]);
    expect(/<button/.test(markup)).toBe(false);
  });

  // QA's pin, admin-window/BUG-0172 — RED until the window line moved inside
  // client-land, green from the fix that put it there, and kept here as the
  // regression it is.
  it("does not claim rows are withheld once the walk has reached the end of the set", async () => {
    // QA, admin-window/BUG-0172: the window line above the table was a
    // SERVER-rendered claim about the rows below it, and a press changes those
    // rows underneath it. Once the driver reports `exhausted` — the read's own
    // answer that the set has ended — the page published two contradictory
    // facts about the SAME question: the paging hook said every row is on
    // screen, and the window hook still said rows are withheld (LESSONS 11:
    // one row, one verdict; LESSONS 2: a sentence claims only the scope its
    // read had).
    //
    // Both handles are the app's own machine-readable statements about that
    // one question — no word of either sentence is pinned here.
    const script = windowScript(view.window);
    await renderBrowse(script);
    // ONE press whose page ends the set: short, and says so.
    paging.override = await pressedWith(
      pageAnswer(view.window, { venues: null, provenance: null }, view.window - 10),
    );
    const markup = await renderBrowse(script);

    // The walk really did reach the end, and the rows really are all drawn.
    expect(pagingArms(markup)).toEqual(["exhausted"]);
    expect(eventIds(markup)).toHaveLength(view.window * 2 - 10);

    // …so nothing on this page may still say rows are being held back.
    expect(windowLine(markup).truncated).not.toBe("true");
  });

  /* ── the window line of a surface a press CONTINUES ───────────────────── */

  /**
   * The line and the rows, one verdict — admin-window/BUG-0172.
   *
   * The window line was the PAGE's, server-rendered above a wrapper that
   * changes the rows underneath it, so after a press the page published two
   * answers to one question: `[data-paging="exhausted"]` under 120 rows and
   * `[data-window-truncated="true"]` above them. Every case below reads the
   * app's own machine-readable statements — the window hooks and the paging
   * arm — and pins no word of either sentence (LESSONS 11).
   */

  /** The window line's own markup, for a byte comparison of two renders. */
  const lineHtml = (markup: string): string =>
    cheerio.load(markup)('[data-window="events"]').toString();

  /**
   * The defect sentence a CONTINUED window must never reach: this surface is
   * drawn paged only on a window that FILLED, so "the window did not fill — 50
   * of at most 50" is a claim no press can make true (criterion 3). An absence
   * check, deliberately, because the criterion is about a sentence being
   * unreachable rather than about which one replaces it.
   */
  const DID_NOT_FILL = "did not fill";

  it("states the rows the operator now holds, and drops the withheld claim when the read ends the set", async () => {
    const script = windowScript(view.window);

    // 1. OFFERED — the first screen, before any press: the line the page has
    //    always rendered, over the rows it rendered.
    const offered = await renderBrowse(script);
    expect(pagingArms(offered)).toEqual(["more"]);
    expect(windowLine(offered).lines).toBe(1);
    expect(windowLine(offered).held).toBe(String(view.window));
    expect(windowLine(offered).truncated).toBe("true");

    // 2. A PRESS that lands a full page: the rows below grew, and so did the
    //    figure above them — the line was stuck at 50 under 100 rows.
    paging.override = await pressedWith(
      pageAnswer(view.window, { venues: null, provenance: null }),
    );
    const continued = await renderBrowse(script);
    expect(eventIds(continued)).toHaveLength(view.window * 2);
    expect(windowLine(continued).lines).toBe(1);
    expect(windowLine(continued).held).toBe(String(view.window * 2));
    expect(windowLine(continued).truncated).toBe("true");
    expect(pagingArms(continued)).toEqual(["more"]);
    expect(windowLine(continued).text).not.toContain(DID_NOT_FILL);

    // 3. THE PRESS THAT ENDS THE SET — QA's own case, one layer wider: the
    //    line agrees with the paging arm about the one question both answer.
    paging.override = await pressedWith(
      pageAnswer(view.window, { venues: null, provenance: null }),
      pageAnswer(view.window * 2, { venues: null, provenance: null }, view.window - 10),
    );
    const exhausted = await renderBrowse(script);
    expect(pagingArms(exhausted)).toEqual(["exhausted"]);
    expect(eventIds(exhausted)).toHaveLength(view.window * 3 - 10);
    expect(windowLine(exhausted).lines).toBe(1);
    expect(windowLine(exhausted).truncated).toBe("false");
    expect(windowLine(exhausted).held).toBe(String(view.window * 3 - 10));
    // The set is complete on screen; the window did not "fail to fill" — it
    // filled, and was then continued to the end.
    expect(windowLine(exhausted).text).not.toContain(DID_NOT_FILL);
  });

  it("takes continuability from the page's own statement, not from the rows it drew [admin-window/BUG-0183]", async () => {
    // CRITERION 2. The line used to learn that a press can continue this
    // window from `drawn` being PRESENT — a fact about the rows on screen,
    // standing in for a fact about a control. The page states it now, and this
    // is the state that turns on it alone: a press that ENDED the set and
    // appended ZERO rows, so the rows on screen are still exactly the first
    // screen's and no figure in the window tells the two apart.
    //
    // Graded by comparing the two renderings against each other, so no word of
    // either sentence is pinned.
    const script = windowScript(view.window);
    const first = await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, { venues: null, provenance: null }, 0),
    );
    const ended = await renderBrowse(script);

    // The press really landed, really ended the set, and appended nothing: the
    // rows below are the first screen's own, to the row.
    expect(pagingArms(first)).toEqual(["more"]);
    expect(pagingArms(ended)).toEqual(["exhausted"]);
    expect(eventIds(ended)).toEqual(eventIds(first));
    expect(windowLine(ended).held).toBe(windowLine(first).held);
    expect(windowLine(ended).limit).toBe(windowLine(first).limit);
    // …and the line moved anyway, because the page said this window could be
    // continued and the read has now said it cannot be continued further.
    expect(windowLine(ended).truncated).toBe("false");
    expect(windowLine(first).truncated).toBe("true");
    expect(windowLine(ended).text).not.toBe(windowLine(first).text);
    // The window filled and was then continued to the end; it never "failed to
    // fill", whatever the two reads' figures look like.
    expect(windowLine(ended).text).not.toContain(DID_NOT_FILL);
  });

  it("says the set is complete when its read ends, because it has no second read to disagree with [admin-window/BUG-0180]", async () => {
    // Criterion 4. `/claims` counts its matching set and draws its rows in TWO
    // reads, so a press can end the set short of the count and the sentence
    // under the table may not call that view complete. `/browse` reads no
    // count beside its rows at all (`heldFrom: "this window"`), so once its
    // read has ended what it holds IS what it counted: the verdict is `true`
    // by construction and this surface's markup does not move in any state.
    //
    // Graded by rendering the app's own widget over the SAME state and each
    // verdict, so no word of either sentence is pinned here (LESSONS 5) — and
    // it cannot pass vacuously: the agreeing reconstruction must MATCH the
    // page and the diverged one must not.
    const script = windowScript(view.window);
    // The first screen, which is what hands the driver the deps a press uses.
    await renderBrowse(script);
    paging.override = await pressedWith(
      pageAnswer(view.window, { venues: null, provenance: null }),
      pageAnswer(view.window * 2, { venues: null, provenance: null }, view.window - 10),
    );
    const exhausted = await renderBrowse(script);
    const held = view.window * 3 - 10;
    expect(pagingArms(exhausted)).toEqual(["exhausted"]);
    expect(eventIds(exhausted)).toHaveLength(held);

    const widget = (readsAgree: boolean): string =>
      pagingHtml(
        render(
          h(PageMore, {
            state: { rows: [], held, status: "exhausted", refusal: null, notes: null },
            holds: "events",
            size: view.window,
            readsAgree,
            // What this surface offers at the bound ceiling: nothing, because
            // `?columns=` removes no row (admin-window/BUG-0198). The arm
            // under test here is the exhausted one, which reads no next step
            // either way — this is the wrapper's own answer, spelled so the
            // fixture is the surface this file is about.
            nextStep: null,
            onPress: () => {},
          }),
        ),
      );
    expect(pagingHtml(exhausted)).toBe(widget(true));
    expect(pagingHtml(exhausted)).not.toBe(widget(false));
  });

  /** The line's sentence, with no word of it pinned — read for what it omits. */
  const lineText = (markup: string): string => windowLine(markup).text;

  /** The cap clause, in the one spelling every window line in the app uses. */
  const A_CAP = "at most";

  it("the window line in every state a press can end in", async () => {
    // admin-window/BUG-0174, criterion 6: offered, loading, refused, refused at
    // the bound ceiling, and exhausted — every one driven by the REAL driver
    // from the REAL deps this page handed it, and every one graded on the two
    // things a state may never get wrong. The words are the designer's; what is
    // asserted is that the line publishes ONE window and agrees with the
    // sentence under the table about whether rows are held back (LESSONS 11).
    const script = windowScript(view.window);
    await renderBrowse(script);
    const deps = paging.calls[0].deps as { route: string; params: string; size: number };
    const initial = paging.calls[0].initial as unknown as PageState<BrowseRow>;
    const answering = (state: PageState<BrowseRow>, answer: unknown) =>
      requestPage<BrowseRow>(state, { ...deps, fetchJson: () => Promise.resolve(answer) });

    const landed = await pressedWith(pageAnswer(view.window, { venues: null, provenance: null }));
    const ended = await answering(
      landed,
      pageAnswer(view.window * 2, { venues: null, provenance: null }, view.window - 10),
    );
    const refused = await answering(landed, {
      kind: "error",
      reading: T.events,
      message: "refused",
    });
    const atCeiling = initialPage<BrowseRow>(MAX_PAGE_OFFSET + view.window, true);
    const ceilingRefusal = await answering(atCeiling, {
      kind: "refused",
      reason: "the `offset` must be at most 100000",
      bound: String(MAX_PAGE_OFFSET + view.window),
    });

    // The ceiling state goes around `renderBrowse`, and only it does: that
    // helper's sweep grades that no FIRST screen of this file draws the limit
    // arm, and this is the state where drawing it is correct.
    const rendered = async (): Promise<string> => {
      readWith.client = stubClient(script).asSupabaseClient();
      return render(await BrowsePage({ searchParams: Promise.resolve({}) }));
    };

    const states: [string, string, PageState<BrowseRow> | null, boolean, number][] = [
      ["offered", "more", null, false, view.window],
      ["loading", "loading", pressing(initial), false, view.window],
      ["refused", "more", refused, false, view.window * 2],
      [
        "refused at the bound ceiling",
        "limit",
        ceilingRefusal,
        true,
        MAX_PAGE_OFFSET + view.window,
      ],
      ["exhausted", "exhausted", ended, false, view.window * 3 - 10],
    ];

    for (const [name, arm, state, ceiling, held] of states) {
      paging.override = state;
      const markup = ceiling ? await rendered() : await renderBrowse(script);
      const line = windowLine(markup);
      expect(pagingArms(markup), name).toContain(arm);
      expect(line.lines, name).toBe(1);
      expect(line.truncated, name).toBe(arm === "exhausted" ? "false" : "true");
      // `held` on this surface is the rows its own reads came back with, so it
      // grows with the rows a press appends and stands where one appended none
      // (criterion 4).
      expect(line.held, name).toBe(String(held));
      expect(line.text, name).not.toContain(DID_NOT_FILL);
    }

    // …and the states a press CONTINUED state no cap of their own, while the
    // two that have taken in no row still render the first screen's sentence.
    for (const [name, state] of [
      ["refused", refused],
      ["exhausted", ended],
    ] as const) {
      paging.override = state;
      expect(lineText(await renderBrowse(script)), name).not.toContain(A_CAP);
    }
    for (const [name, state] of [
      ["offered", null],
      ["loading", pressing(initial)],
    ] as const) {
      paging.override = state;
      expect(lineText(await renderBrowse(script)), name).toContain(A_CAP);
    }
  });

  it("is one element while a press is in FLIGHT, and says what the rows still say", async () => {
    const script = windowScript(view.window);
    const { initial } = paging.calls[0] ?? (await renderBrowse(script), paging.calls[0]);
    paging.override = pressing(initial as unknown as PageState<BrowseRow>);
    const loading = await renderBrowse(script);
    expect(pagingArms(loading)).toEqual(["loading"]);
    expect(windowLine(loading).lines).toBe(1);
    // A press in flight has taken in no row and ended nothing: the line is the
    // one the first screen published, truncation included.
    expect(windowLine(loading).truncated).toBe("true");
    expect(windowLine(loading).held).toBe(String(view.window));
    expect(windowLine(loading).text).not.toContain(DID_NOT_FILL);
  });

  it("a refused press settles nothing: the line is what it was before it", async () => {
    const script = windowScript(view.window);
    await renderBrowse(script);
    const landed = await pressedWith(pageAnswer(view.window, { venues: null, provenance: null }));

    paging.override = landed;
    const before = await renderBrowse(script);
    // The same state, then one press the server refuses: no row is appended
    // and no bound moves, so the line may not move either.
    paging.override = await requestPage<BrowseRow>(landed, {
      ...(paging.calls[0].deps as { route: string; params: string; size: number }),
      fetchJson: () => Promise.resolve({ kind: "error", reading: T.events, message: "refused" }),
    });
    const after = await renderBrowse(script);

    expect(cheerio.load(after)("[data-paging-refusal]")).toHaveLength(1);
    expect(pagingArms(after)).toEqual(["more"]);
    expect(lineHtml(after)).toBe(lineHtml(before));
  });

  it("at the bound ceiling it still says rows are not shown", async () => {
    // The state a walk reaches after `MAX_PAGE_OFFSET` rows: every further
    // bound is past the ceiling `pageBound` enforces, so `PageMore` draws its
    // limit sentence and NO control — and that sentence does not claim the set
    // has ended, because nothing established that. The line must agree: rows
    // this surface could show are not shown, and it says so.
    //
    // The held is seeded rather than pressed to: 2,000 full pages is what puts
    // a real operator here, and the state is built the way the surface's own
    // state is built (`initialPage`), then driven through the REAL driver with
    // the refusal this app's route answers a bound past the ceiling with.
    const script = windowScript(view.window);
    await renderBrowse(script);
    const deps = paging.calls[0].deps as { route: string; params: string; size: number };
    const atCeiling = initialPage<BrowseRow>(MAX_PAGE_OFFSET + view.window, true);

    // The two renders below go around `renderBrowse`, and only these two do:
    // its sweep grades that no FIRST screen of this file draws the limit arm,
    // and the state under test here is the one state where drawing it is
    // correct. The database, the page and the render are otherwise identical.
    const rendered = async (): Promise<string> => {
      readWith.client = stubClient(script).asSupabaseClient();
      return render(await BrowsePage({ searchParams: Promise.resolve({}) }));
    };

    paging.override = atCeiling;
    const before = await rendered();
    expect(pagingArms(before)).toEqual(["limit"]);
    expect(windowLine(before).truncated).toBe("true");
    expect(windowLine(before).lines).toBe(1);
    expect(windowLine(before).text).not.toContain(DID_NOT_FILL);

    paging.override = await requestPage<BrowseRow>(atCeiling, {
      ...deps,
      fetchJson: () =>
        Promise.resolve({
          kind: "refused",
          reason: "the `offset` must be at most 100000",
          bound: String(MAX_PAGE_OFFSET + view.window),
        }),
    });
    const after = await rendered();
    expect(pagingArms(after)).toEqual(["limit"]);
    expect(cheerio.load(after)("[data-paging-refusal]")).toHaveLength(1);
    expect(lineHtml(after)).toBe(lineHtml(before));
  });

  it("spells no leg key and imports no lib/db type", async () => {
    // The wrapper renders the non-null notes the record HOLDS, in the record's
    // own order, so its output cannot drift from the route's key spelling —
    // and it sits below the `StateOf` seam (ARCHITECTURE.md §4).
    const WRAPPER = "src/components/browse/paged-browse-table.tsx";
    const whole = sourceText(WRAPPER);
    // Read off the WHOLE file, comments included, exactly as this ticket's
    // structural checks read it: a docstring that merely NAMES the spelling it
    // avoids reddens the check and stays green under a comment-stripped read,
    // which is how a check and its test come to disagree (LESSONS 12).
    expect(whole).not.toContain("@/lib/db");
    expect(whole).not.toContain("BROWSE_VIEWS");
    expect(whole).not.toContain("view.window");

    // The LEG KEYS are read off the code alone: the docstring has every right
    // to explain that this surface has a venue leg and a provenance leg. What
    // it may not do is SPELL one, because the record's keys are the route's
    // and this file renders whatever the record holds.
    const code = codeLinesIn(whole).join("\n");
    for (const key of ["venues", "provenance"]) {
      expect(code, `the wrapper spells the leg key ${key}`).not.toContain(key);
    }
  });
});

/* ── what the URL asked for that this page did not do (BUG-0202) ─────────── */

/**
 * The dropped-parameter sentence, on THIS page (campaign admin-window/BUG-0202).
 *
 * Tomas hand-edited a Browse URL: "`?cols=banana` renders all seven columns
 * and says nothing… `?table=venues` and `?q=BTS` are swallowed without a
 * word" (`M3-usersim-tomas.md`). He shares a column view BY URL, so a `cols`
 * the recipient's page discards is the case that matters most: the recipient
 * reads the sender's chosen view off a default one, and nothing on screen says
 * the choice was dropped (LOOK_AND_FEEL bar 13).
 *
 * Every case below is graded at the SURFACE, through the two hooks the shared
 * line ships (`data-dropped-params`, `data-dropped-param`), never against the
 * app's copy: the rule and its words belong to `lib/url/dropped-params.ts` and
 * `components/ui/dropped-params.tsx`, which carry their own suites. What is
 * this page's to prove is WHICH narrowing it hands over — the columns the
 * render actually chose, never the URL's raw text — and that nothing else on
 * the page moved.
 */
describe("a parameter this page did not apply", () => {
  /** What the page says it did not apply: the shared line's two hooks. */
  function droppedLine(markup: string) {
    const $ = cheerio.load(markup);
    const line = $("[data-dropped-params]");
    return {
      lines: line.length,
      total: line.length === 0 ? 0 : Number(line.attr("data-dropped-params")),
      names: line
        .find("[data-dropped-param]")
        .toArray()
        .map((element) => $(element).attr("data-dropped-param") ?? ""),
      text: line.text().replace(/\s+/g, " ").trim(),
    };
  }

  /** The whole page with that one line removed — everything this ticket promised not to move. */
  function withoutDroppedLine(markup: string): string {
    const $ = cheerio.load(markup);
    $("[data-dropped-params]").remove();
    return $.html();
  }

  /** The default view's column labels, as the page draws them with no `cols` at all. */
  const DEFAULT_HEADERS = shownColumns(view, undefined).map((key) => labelOf(key));

  /** ZERO WIDTH SPACE: a key a reader would see nothing of at all. */
  const NO_INK = "​";

  /** RIGHT-TO-LEFT OVERRIDE: a key this sentence may not spell, in one. */
  const UNSPELLABLE_KEY = "co‮ls";

  it("names a cols value that chose no column as a parameter it did not apply", async () => {
    // The bare page says nothing, because nothing was asked and dropped.
    const bare = await renderBrowse(healthyScript());
    expect(droppedLine(bare).lines).toBe(0);

    // The URL of the finding. The page still draws the seven default columns
    // — that half is correct and unchanged — and now names the parameter it
    // could not use, so the default view cannot be read as a chosen one.
    const banana = await renderBrowse(healthyScript(), { [COLUMNS_PARAM]: "banana" });
    expect(headers(banana)).toEqual(DEFAULT_HEADERS);
    expect(droppedLine(banana).names).toEqual([COLUMNS_PARAM]);
    expect(droppedLine(banana).total).toBe(1);
    // The NAME is spelled; the VALUE never is (LOOK_AND_FEEL bar 3).
    expect(droppedLine(banana).text).not.toContain("banana");

    // A list in which NO token names a configured column is the same case.
    const none = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: "nope,alsonope",
    });
    expect(headers(none)).toEqual(DEFAULT_HEADERS);
    expect(droppedLine(none).names).toEqual([COLUMNS_PARAM]);

    // The guard's passing fixtures. A value that chose a column APPLIED, and
    // is not named — including the partial case this ticket deliberately keeps
    // silent: `cols` counts as applied when at least one of its tokens named a
    // column, and the fat-fingered token inside an otherwise-good list is not
    // a sentence of its own (the rule's vocabulary is per KEY, not per token).
    for (const value of ["title", "title,banana"]) {
      const applied = await renderBrowse(healthyScript(), { [COLUMNS_PARAM]: value });
      // Non-vacuous: that URL really did choose the columns on screen.
      expect(headers(applied), value).toEqual([labelOf("title")]);
      expect(droppedLine(applied).lines, value).toBe(0);
    }
  });

  it("names a key this route does not read at all, whatever it is called", async () => {
    // The two Tomas typed, plus keys other surfaces of this app offer and this
    // one never looks at. `?tab=` is one too, because this route has no tab
    // strip to consume it — so the caller hands the rule an empty consumed
    // list, exactly as `/cycles` and `/sources`, the other tabless routes, do.
    for (const key of ["table", "q", "limit", "tab", "columns"]) {
      const markup = await renderBrowse(healthyScript(), { [key]: "venues" });
      expect(droppedLine(markup).names, key).toEqual([key]);
      // Nothing was narrowed or re-columned by it: the default view stands.
      expect(headers(markup), key).toEqual(DEFAULT_HEADERS);
      expect(bodyRows(markup), key).toHaveLength(2);
    }

    // Two at once are both named, in the order the URL carried them, and an
    // APPLIED `cols` beside them is not named at all.
    const several = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: "title",
      table: "venues",
      q: "BTS",
    });
    expect(droppedLine(several).names).toEqual(["table", "q"]);
    expect(droppedLine(several).total).toBe(2);
    expect(headers(several)).toEqual([labelOf("title")]);
  });

  it("says nothing for a request that named nothing, and counts a name it may not spell", async () => {
    // The module's own rules, reached through this caller: a key with no
    // value, a value with no key, and a key a reader would see nothing of all
    // asked for nothing, so there is no narrowing to have dropped
    // (admin-window/BUG-0127, admin-window/BUG-0136). `?cols=` is the URL
    // saying nothing about columns, which is a real state and not an error.
    const silent: [string, Record<string, string>][] = [
      ["cols carrying no value", { [COLUMNS_PARAM]: "" }],
      ["a key this route does not read, carrying no value", { table: "" }],
      ["a value with no key at all", { "": "banana" }],
      ["a key with no ink in it", { [NO_INK]: "1" }],
    ];
    for (const [name, params] of silent) {
      const markup = await renderBrowse(healthyScript(), params);
      expect(droppedLine(markup).lines, name).toBe(0);
      expect(headers(markup), name).toEqual(DEFAULT_HEADERS);
    }

    // ...and the arm it MUST flag: a key outside the renderable allowlist is
    // still reported, COUNTED rather than spelled, so no bidi control from a
    // URL sits inside a sentence this app wrote (admin-window/BUG-0137).
    const unspellable = await renderBrowse(healthyScript(), {
      [UNSPELLABLE_KEY]: "1",
    });
    expect(droppedLine(unspellable).total).toBe(1);
    expect(droppedLine(unspellable).names).toEqual([]);
    expect(unspellable).not.toContain(UNSPELLABLE_KEY);
  });

  it("states it over every state of the read, because it is a fact of the URL", async () => {
    // The line stands above the section rather than inside it, so it renders
    // the same over an `ok` read, a refusal, an events table that is not there
    // and a window that came back empty — the states where there is no table
    // to read the column choice off at all, and where a silent drop is
    // therefore least recoverable.
    const states: [string, Script][] = [
      ["absent events", healthyScript({ [T.events]: { error: tableNotInSchemaCache(T.events) } })],
      ["refused events", healthyScript({ [T.events]: { error: permissionDenied(T.events) } })],
      ["empty window", healthyScript({ [T.events]: { data: [] } })],
    ];
    for (const [name, script] of states) {
      const markup = await renderBrowse(script, { [COLUMNS_PARAM]: "banana" });
      expect(droppedLine(markup).names, name).toEqual([COLUMNS_PARAM]);
      // Non-vacuous: each of these really is a state with no event on screen,
      // so the sentence above is standing over a page that drew no rows —
      // the read's own state is still the page's answer about the read.
      expect(markup, name).not.toContain("newest arrival");
    }
  });

  it("moves nothing else on the page", async () => {
    // The column chips and their hrefs, the window line, the table, the rows
    // and every leg note are what they were at the same URL before this line
    // existed: a dropped parameter reaches no read and no column set, so the
    // page under the line is the bare page, byte for byte.
    const bare = await renderBrowse(healthyScript());
    const urls: Record<string, string>[] = [
      { [COLUMNS_PARAM]: "banana" },
      { table: "venues" },
      { q: "BTS" },
      { [UNSPELLABLE_KEY]: "1" },
    ];
    for (const params of urls) {
      const markup = await renderBrowse(healthyScript(), params);
      // Non-vacuous: there IS a line in each of these renders to remove.
      expect(droppedLine(markup).total, JSON.stringify(params)).toBe(1);
      expect(withoutDroppedLine(markup), JSON.stringify(params)).toBe(
        withoutDroppedLine(bare),
      );
    }
    // And a page that dropped nothing renders no line to remove at all, so
    // the comparison above is between a page WITH the sentence and the page
    // as it stands today rather than between two stripped renders.
    expect(droppedLine(bare).lines).toBe(0);
    expect(withoutDroppedLine(bare)).toBe(cheerio.load(bare).html());
  });

  it("reads a repeated cols the same way the columns did", async () => {
    // Two readings of one key answer one question — this page's own decides
    // which columns the render CARRIED (`namedColumns`, which reads a repeated
    // key as one comma-joined list, exactly as `shownColumns` does), and
    // `lib/url/dropped-params.ts`' `firstValue` decides what the SENTENCE
    // judges. A URL repeating the key is the seam where they could come to
    // disagree, and a disagreement is the finding itself twice over: a page
    // that re-columned by a value while reporting it dropped, or one that
    // swallowed a usable value in silence.
    const usableSecond = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: ["banana", "title"],
    });
    // The second value chose the column on screen, so `cols` APPLIED and the
    // page claims no dropped parameter it did in fact act on.
    expect(headers(usableSecond)).toEqual([labelOf("title")]);
    expect(droppedLine(usableSecond).lines).toBe(0);

    const usableNeither = await renderBrowse(healthyScript(), {
      [COLUMNS_PARAM]: ["banana", "nope"],
    });
    // Neither value chose anything, so the default set stands AND the line
    // says so.
    expect(headers(usableNeither)).toEqual(DEFAULT_HEADERS);
    expect(droppedLine(usableNeither).names).toEqual([COLUMNS_PARAM]);
  });
});
