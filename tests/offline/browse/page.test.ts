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
  DEFAULT_WINDOW_SIZE,
  PAGE_PARAM,
  PAGE_ROUTES,
  SIZE_PARAM,
  largestPage,
  windowBound,
  type NotedPageAnswer,
  type PageNote,
  type PageWindow,
} from "@/lib/paging/bounds";
import {
  pressing,
  requestPage,
  type PageDeps,
  type PageState,
  type RowIdKey,
} from "@/lib/paging/machine";
import { recordHref } from "@/lib/records/routes";
import { BrowseTable } from "@/components/browse/browse-table";
import { functionPaths } from "../../fixtures/client-props";
import { h, render, textOf } from "../ui/markup";
import {
  classesOf,
  expectDrawnAsLinkAtRest,
  expectNotDrawnAsLink,
} from "../../fixtures/link-spelling";
import { oneEach, surfaceHooks } from "../../fixtures/surface-state";
import { ID, eventListingRow, eventRow, fieldProvenanceRow, sourceRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type RecordedCall,
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

/** The window size every address in this suite that names none renders at. */
const SIZE = DEFAULT_WINDOW_SIZE;

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
    // The window the page asks for — offset and size — rides through: the
    // mock swaps in the client and nothing else.
    readRecentEvents: (
      v: Parameters<typeof actual.readRecentEvents>[0],
      _db: unknown,
      offset?: number,
      size?: number,
    ) => actual.readRecentEvents(v, readWith.client as never, offset, size),
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
    initial: { rows: readonly unknown[]; window: unknown; status: string; notes: unknown };
    deps: { route: string; path: string; params: string; idKey: string };
    window: unknown;
  }[],
  /** The move, taken from the surface the provider publishes — what a click calls. */
  goTo: null as null | ((window: { page: number; size: 20 | 50 | 100 }) => void),
  override: null as unknown,
}));

vi.mock("@/components/ui/paging", async (importActual) => {
  const actual = await importActual<typeof import("@/components/ui/paging")>();
  // A probe beside the page's own children: it draws nothing and hands the
  // provider's `goTo` out — the same function a click on a move link calls,
  // in a tier with no DOM to click.
  function Probe(): null {
    paging.goTo = actual.usePaging().goTo;
    return null;
  }
  return {
    ...actual,
    PagingProvider: (props: {
      initial: (typeof paging.calls)[number]["initial"];
      deps: (typeof paging.calls)[number]["deps"];
      window: unknown;
      children: unknown;
    }) => {
      paging.calls.push({ initial: props.initial, deps: props.deps, window: props.window });
      // The REAL provider, started from the state under test. The WINDOW is
      // the page's own, passed straight through: this file overrides the
      // paging STATE and nothing the page composed (admin-window/BUG-0180).
      return h(
        actual.PagingProvider as never,
        {
          initial: (paging.override === null ? props.initial : paging.override) as never,
          window: props.window as never,
          deps: props.deps as never,
        },
        props.children as never,
        h(Probe),
      );
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
const EVENT_ID: RowIdKey<BrowseRow> = "event_id";

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
  // `data-paging="limit"` is the controls' honest answer to a window that
  // starts at the ceiling `windowBound` enforces: no "next", and a sentence
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
    from: line.attr("data-window-from"),
    drawn: line.attr("data-window-drawn"),
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
    expect(line.limit).toBe(String(SIZE));
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
    const full = arrivals(SIZE);
    const markup = await renderBrowse(healthyScript({ [T.events]: { data: full } }));
    const line = windowLine(markup);
    expect(line.held).toBe(String(SIZE));
    expect(line.truncated).toBe("true");
    // Its last row is the cap's, not the catalog's: older events exist and
    // are not shown, so the line must not offer that row as a floor.
    expect(line.text).not.toContain(absoluteUtc(full[full.length - 1].created_at));
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
});

describe("every state renders without throwing", () => {
  it("renders an empty state, not a table of nothing, when there are no events", async () => {
    const markup = await renderBrowse({ [T.events]: { data: [] } });
    expect(markup).toContain("<h1");
    expect(bodyRows(markup)).toEqual([]);
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
   * The live oracle grades ONE surface and `stateOf` (`tests/fixtures/surface-state.ts`)
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
 * the controls draw, the driver's rules and the window guard are pinned where
 * they live (`tests/offline/ui/paging.test.ts`, `tests/offline/paging/
 * machine.test.ts`, `tests/offline/paging/bounds.test.ts`); this file grades
 * the page's drawing rule, what it hands down, where the pieces SIT, and what
 * a press does to the markup.
 *
 * **The drawing rule is a FULL first window.** Browse's events read is a
 * WINDOW read with no count beside it at all, so there is no total to compare
 * against and a `total`-derived affordance would never be reachable. The
 * honest signal is that the window came back full, graded by `endsWithin` — the
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

/** How many times the paging hook is spelled at all — refusals included. */
function pagingOccurrences(markup: string): number {
  return (markup.match(/data-paging/g) ?? []).length;
}

/** The control's own words, without pinning the sentence around them. */
/** Every move link in the markup, by the direction it offers, in order. */
function movesOf(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-paging-move]")
    .toArray()
    .map((element) => $(element).attr("data-paging-move") ?? "");
}

/** The window one address or request names, read as the guard reads it. */
function windowOf(url: string): PageWindow | null {
  const query = new URLSearchParams(url.split("?")[1]);
  const bound = windowBound({ page: query.get(PAGE_PARAM), size: query.get(SIZE_PARAM) });
  return bound.kind === "ok" ? bound.window : null;
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
    // The catalog answers the WINDOW the read asked for, as the database does:
    // the rows inside `.range(from, to)` and no other.
    [T.events]: (call: RecordedCall) => {
      const range = call.steps.find((step) => step.method === "range")?.args as [number, number] | undefined;
      if (range === undefined) throw new Error("the events read carried no range");
      return { data: events.slice(range[0], range[1] + 1) };
    },
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
/** The route's answer for a window: its rows in arrival order, from the window's own start. */
function pageAnswer(
  window: PageWindow,
  notes: Record<string, PageNote | null>,
  rows = window.size,
): NotedPageAnswer<BrowseRow, Record<string, PageNote | null>> {
  return {
    kind: "ok",
    rows: pageRows(rows, (window.page - 1) * window.size),
    page: window.page,
    size: window.size,
    exhausted: rows < window.size,
    notes,
  };
}

/**
 * The state the REAL driver reaches from the REAL deps the wrapper built, fed
 * `answers` in order. Only React's second render is substituted — see the
 * spy's comment above.
 */
/** ONE move to `to`, answered with `answer`, from the state the page seeded. */
async function pressedWith(to: PageWindow, answer: unknown): Promise<PageState<BrowseRow>> {
  const call = paging.calls[0];
  if (call === undefined) throw new Error("the page drew no paging wrapper");
  return requestPage<BrowseRow>(
    call.initial as unknown as PageState<BrowseRow>,
    { ...(call.deps as Omit<PageDeps<BrowseRow>, "fetchJson">), fetchJson: () => Promise.resolve(answer) },
    to,
  );
}

describe("the window that moves the recent-events view", () => {
  beforeEach(() => {
    paging.calls = [];
    paging.goTo = null;
    paging.override = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // An override left standing would be drawn by every later render of a
    // surface that windows — which, under page windows, is every `ok` read.
    paging.override = null;
    paging.calls = [];
  });

  const W2: PageWindow = { page: 2, size: SIZE };
  const W3: PageWindow = { page: 3, size: SIZE };
  const idsOf = (count: number, from: number): string[] => arrivals(count, from).map((row) => row.event_id);
  const depsOf = () => paging.calls[0].deps as Omit<PageDeps<BrowseRow>, "fetchJson">;
  const initialOf = () => paging.calls[0].initial as unknown as PageState<BrowseRow>;

  it.each([
    ["the first window, by default", {}, [0, 50], { limit: "50", from: "1", drawn: "50", truncated: "true" }, "more", ["next"]],
    ["rows 21–40", { [PAGE_PARAM]: "2", [SIZE_PARAM]: "20" }, [20, 40], { limit: "20", from: "21", drawn: "20", truncated: "true" }, "more", ["previous", "next"]],
    ["the last window, short", { [PAGE_PARAM]: "3" }, [100, 120], { limit: "50", from: "101", drawn: "20", truncated: "false" }, "exhausted", ["previous"]],
    ["an empty window past the end", { [PAGE_PARAM]: "7", [SIZE_PARAM]: "20" }, [120, 120], { limit: "20", from: "121", drawn: "0", truncated: "false" }, "exhausted", ["previous"]],
  ] as const)("renders %s for the address, with the controls ABOVE the table and the line stating the window", async (_what, params, [from, to], figures, arm, moves) => {
    const markup = await renderBrowse(windowScript(120), { ...params });

    expect(eventIds(markup)).toEqual(idsOf(120, 0).slice(from, to));
    const line = windowLine(markup);
    expect(line.lines).toBe(1);
    // `held` on this surface is the rows ITS OWN read came back with.
    expect({ limit: line.limit, held: line.held, truncated: line.truncated, from: line.from, drawn: line.drawn }).toEqual({
      ...figures,
      held: figures.drawn,
    });
    expect(line.text).not.toContain("did not fill");
    expect(pagingArms(markup)).toEqual([arm]);
    expect(movesOf(markup)).toEqual([...moves]);
    expect(headers(markup)).toEqual(configuredKeys(view).map((key) => labelOf(key)));

    const $ = cheerio.load(markup);
    // ABOVE the table, OUTSIDE the surface the oracle grades, and nothing of
    // the affordance after the last row (LOOK_AND_FEEL bar 14).
    expect($(EVENTS_HOOK).find("[data-paging]")).toHaveLength(0);
    expect(markup.indexOf("data-paging")).toBeLessThan(markup.indexOf('data-surface="events"'));
    expect(markup.slice(markup.lastIndexOf("</table>"))).not.toMatch(/data-paging/);
    expect($(EVENTS_HOOK).find("table")).toHaveLength(1);
    // Every move is this surface's own address at the neighbouring window.
    for (const move of moves) {
      const href = $(`[data-paging-move="${move}"]`).attr("href") ?? "";
      expect(href.startsWith("/browse?"), move).toBe(true);
      expect(windowOf(href)?.size, move).toBe(Number(figures.limit));
    }
  });

  it("draws no paging element where no move could change the screen, where the table is absent or the read refused", async () => {
    // A first window the read ended inside, holding no more rows than the
    // smallest size: nothing any link could change.
    const few = await renderBrowse(windowScript(12));
    expect(eventIds(few)).toHaveLength(12);
    expect(windowLine(few).truncated).toBe("false");
    expect(pagingOccurrences(few)).toBe(0);
    // …but one row more than the smallest size, and the size chips stand.
    const sizable = await renderBrowse(windowScript(21));
    expect(pagingArms(sizable)).toEqual(["exhausted"]);
    expect(movesOf(sizable)).toEqual([]);
    expect(cheerio.load(sizable)("[data-paging-size]")).toHaveLength(3);
    // An EMPTY first window: the Empty card and the line stand as they did.
    const empty = await renderBrowse({ [T.events]: { data: [] } });
    expect(windowLine(empty).held).toBe("0");
    expect(pagingOccurrences(empty)).toBe(0);
    // The two states that carry no rows at all.
    for (const [why, error] of [
      ["an absent events table", tableNotInSchemaCache(T.events)],
      ["a refused events read", permissionDenied(T.events)],
    ] as const) {
      const broken = await renderBrowse({ [T.events]: { error } });
      expect(pagingOccurrences(broken), why).toBe(0);
    }
  });

  it.each([
    ["a page that is a word", { [PAGE_PARAM]: "abc" }, PAGE_PARAM],
    ["a size this app does not offer", { [SIZE_PARAM]: "30" }, SIZE_PARAM],
    ["a page past the ceiling", { [PAGE_PARAM]: String(largestPage(SIZE) + 1) }, PAGE_PARAM],
  ] as const)("refuses an address naming %s BY NAME: nothing read, no rows, no control, and the first window offered with the columns kept", async (_what, params, param) => {
    const stub = stubClient(windowScript(120));
    readWith.client = stub.asSupabaseClient();
    const shownNow: BrowseColumnKey[] = ["title", "venue"];
    const markup = render(
      await BrowsePage({ searchParams: Promise.resolve({ [COLUMNS_PARAM]: columnsParamValue(shownNow), ...params }) }),
    );
    const $ = cheerio.load(markup);
    const refusal = $(`[data-window-refused="${param}"]`);
    expect(refusal).toHaveLength(1);
    expect(refusal.attr("role")).toBe("alert");
    expect(eventIds(markup)).toEqual([]);
    expect($('[data-window="events"]')).toHaveLength(0);
    expect(pagingOccurrences(markup)).toBe(0);
    expect(paging.calls).toEqual([]);
    // Nothing was read at all — not the window, not a leg.
    expect(stub.calls).toEqual([]);
    // The one surface still answers to its name, exactly once.
    expect(surfaceHooks(markup, [EVENTS_HOOK])).toEqual({ counts: oneEach([EVENTS_HOOK]), nested: [] });
    // The way back keeps the column state, and names no window.
    const back = refusal.find("a").attr("href") ?? "";
    expect(back.startsWith("/browse")).toBe(true);
    expect(new URLSearchParams(back.split("?")[1] ?? "").get(COLUMNS_PARAM)).toBe(columnsParamValue(shownNow));
    expect(new URLSearchParams(back.split("?")[1] ?? "").get(PAGE_PARAM)).toBeNull();
    expect($("[data-dropped-param]")).toHaveLength(0);
    expect(refusal.text()).not.toContain(String(Object.values(params)[0]));
  });

  it("hands the client provider DATA only, and seeds it with the window the address named", async () => {
    // admin-window/BUG-0226: a function prop takes the page to 500 and no
    // offline render can see it, so the VALUE handed across is graded.
    const shownNow: BrowseColumnKey[] = ["title", "venue"];
    await renderBrowse(windowScript(120), { [PAGE_PARAM]: "2", [SIZE_PARAM]: "20", [COLUMNS_PARAM]: columnsParamValue(shownNow) });
    const { initial, deps, window } = paging.calls[0];
    expect(functionPaths({ initial, deps, window })).toEqual([]);

    const seeded = initialOf();
    expect(seeded.window).toEqual({ page: 2, size: 20 });
    expect(seeded.rows.map((row) => row.event_id)).toEqual(idsOf(120, 0).slice(20, 40));
    expect(seeded.exhausted).toBe(false);
    expect(seeded.notes).toBeNull();
    expect(seeded.screen).toContain(idsOf(120, 0)[20]);
    // The COLUMN STATE the page rendered rides in the facets a move carries;
    // the default set spells no state at all.
    expect(depsOf()).toEqual({
      route: PAGE_ROUTES.browse,
      path: "/browse",
      params: `${COLUMNS_PARAM}=${encodeURIComponent(columnsParamValue(shownNow)).replace(/%2C/g, "%2C")}`,
      idKey: EVENT_ID,
    });
    paging.calls = [];
    await renderBrowse(windowScript(120));
    expect(depsOf().params).toBe("");
  });

  it("one move issues one request for the window asked, carrying the column state; no move issues none", async () => {
    const shownNow: BrowseColumnKey[] = ["title", "venue"];
    const urls = recordingFetch(pageAnswer(W2, { venues: null, provenance: null }));
    await renderBrowse(windowScript(120), { [COLUMNS_PARAM]: columnsParamValue(shownNow) });
    expect(urls).toEqual([]);

    paging.goTo?.(W2);
    await settle();
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith(PAGE_ROUTES.browse)).toBe(true);
    const asked = new URLSearchParams(urls[0].split("?")[1]);
    expect(asked.get(COLUMNS_PARAM)).toBe(columnsParamValue(shownNow));
    expect(windowOf(urls[0])).toEqual(W2);
  });

  it("a refused move leaves the window exactly as it was and names the object; a landed move REPLACES it", async () => {
    const script = windowScript(120);
    const firstScreen = await renderBrowse(script);
    const first = eventIds(firstScreen);
    expect(first).toEqual(idsOf(120, 0).slice(0, 50));

    // A. the move that must REFUSE — the table went away between two reads:
    //    the clause, outside the surface, and no control of any kind.
    paging.override = await pressedWith(W2, { kind: "not_provisioned", missing: T.events });
    const afterRefusal = await renderBrowse(script);
    expect(eventIds(afterRefusal)).toEqual(first);
    const $ = cheerio.load(afterRefusal);
    expect($("[data-paging-refusal]")).toHaveLength(1);
    expect($("[data-paging-refusal]").text()).toContain(T.events);
    expect($(EVENTS_HOOK).find("[data-paging-refusal]")).toHaveLength(0);
    expect(pagingArms(afterRefusal)).toEqual([]);
    expect($("[data-paging-move], [data-paging-size]")).toHaveLength(0);

    // A′. a READ that failed is retryable: the controls stand.
    paging.override = await pressedWith(W2, { kind: "error", reading: T.events, message: "canceling statement due to statement timeout" });
    const afterReadFailure = await renderBrowse(script);
    expect(eventIds(afterReadFailure)).toEqual(first);
    expect(cheerio.load(afterReadFailure)("[data-paging-refusal]")).toHaveLength(1);
    expect(pagingArms(afterReadFailure)).toEqual(["more"]);

    // B. the move that LANDS: window 2 and only window 2, under a line that
    //    says so.
    paging.override = await pressedWith(W2, pageAnswer(W2, { venues: null, provenance: null }));
    const afterMove = await renderBrowse(script);
    expect(cheerio.load(afterMove)("[data-paging-refusal]")).toHaveLength(0);
    expect(eventIds(afterMove)).toEqual(idsOf(120, 0).slice(50, 100));
    expect(windowLine(afterMove)).toMatchObject({ lines: 1, held: "50", from: "51", drawn: "50", truncated: "true" });
    expect(movesOf(afterMove)).toEqual(["previous", "next"]);
  });

  it("renders a moved-to window's leg reports ABOVE the table, in the hook and words the first screen uses, each object once", async () => {
    // The account the PAGE's own card carries for the same object, on a
    // first-screen fixture where the same table is absent.
    const onFirstScreen = cheerio.load(
      await renderBrowse(windowScript(120, { [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) } })),
    );
    const asTheCardSaysIt = onFirstScreen(`[data-not-provisioned="${T.fieldProvenance}"]`);
    expect(asTheCardSaysIt).toHaveLength(1);

    paging.calls = [];
    const script = windowScript(120);
    await renderBrowse(script);
    paging.override = await pressedWith(
      W2,
      pageAnswer(W2, {
        venues: { kind: "error", reading: T.eventListings, message: "permission denied for view event_listings" },
        provenance: { kind: "not_provisioned", missing: T.fieldProvenance },
      }),
    );
    const markup = await renderBrowse(script);
    const $ = cheerio.load(markup);
    expect(eventIds(markup)).toHaveLength(50);
    const note = $(`[data-not-provisioned="${T.fieldProvenance}"]`);
    expect(note).toHaveLength(1);
    expect(note.text().replace(/\s+/g, " ").trim()).toBe(asTheCardSaysIt.text().replace(/\s+/g, " ").trim());
    const failed = $(`[data-read-failed="${T.eventListings}"]`);
    expect(failed).toHaveLength(1);
    expect(failed.text()).toContain("permission denied for view event_listings");
    expect(alerts(markup).some((line) => line.includes(T.eventListings))).toBe(true);
    // Below the controls, above the surface, never inside it.
    expect($(EVENTS_HOOK).find("[data-state]")).toHaveLength(0);
    const at = (needle: string) => markup.indexOf(needle);
    expect(at("data-paging")).toBeLessThan(at(`data-not-provisioned="${T.fieldProvenance}"`));
    expect(at(`data-not-provisioned="${T.fieldProvenance}"`)).toBeLessThan(at('data-surface="events"'));

    // ONE OBJECT ONCE: a leg the PAGE already named above the table is not
    // named again by the window.
    paging.calls = [];
    const reportedScript = windowScript(120, { [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) } });
    await renderBrowse(reportedScript);
    paging.override = await pressedWith(W2, pageAnswer(W2, { venues: null, provenance: { kind: "not_provisioned", missing: T.fieldProvenance } }));
    const once = await renderBrowse(reportedScript);
    expect(cheerio.load(once)(`[data-not-provisioned="${T.fieldProvenance}"]`)).toHaveLength(1);
    expect(once.indexOf(`data-not-provisioned="${T.fieldProvenance}"`)).toBeLessThan(once.indexOf('data-surface="events"'));

    // …and a window whose legs ANSWERED reports nothing, nor does a first screen.
    paging.calls = [];
    await renderBrowse(script);
    paging.override = await pressedWith(W2, pageAnswer(W2, { venues: null, provenance: null }));
    const quiet = cheerio.load(await renderBrowse(script));
    expect(quiet("[data-not-provisioned], [data-read-failed]")).toHaveLength(0);
  });

  it("gives the events surface exactly one element wrapping the table alone, in every windowed state", async () => {
    const script = windowScript(120);
    const states: [string, string][] = [];
    await renderBrowse(script);
    states.push(["windowed, legs fine", await renderBrowse(script)]);
    paging.calls = [];
    await renderBrowse(script);
    paging.override = await pressedWith(
      W2,
      pageAnswer(W2, {
        venues: { kind: "error", reading: T.eventListings, message: "refused" },
        provenance: { kind: "not_provisioned", missing: T.fieldProvenance },
      }),
    );
    states.push(["windowed, both legs broken", await renderBrowse(script)]);
    states.push([
      "windowed, both legs broken on the first screen too",
      await renderBrowse(
        windowScript(120, {
          [T.eventListings]: { error: permissionDenied(T.eventListings) },
          [T.fieldProvenance]: { error: tableNotInSchemaCache(T.fieldProvenance) },
        }),
      ),
    ]);
    paging.override = await pressedWith(W2, { kind: "error", reading: T.events, message: "refused" });
    states.push(["windowed, the move refused", await renderBrowse(script)]);

    for (const [name, markup] of states) {
      expect(surfaceHooks(markup, [EVENTS_HOOK]), name).toEqual({ counts: oneEach([EVENTS_HOOK]), nested: [] });
      const $ = cheerio.load(markup);
      expect($(EVENTS_HOOK).find("[data-state]").length, name).toBe(0);
      expect($(EVENTS_HOOK).find("tbody tr").length, name).toBeGreaterThan(0);
      expect($(EVENTS_HOOK).children().length, name).toBe(1);
    }
  });

  it("the window line in every state a move can end in", async () => {
    // admin-window/BUG-0174 criterion 6, under windows: `held` on this
    // surface is the rows its own read came back with, so it is the rows on
    // screen in every state; the truncation verdict is the read's own.
    const script = windowScript(120);
    await renderBrowse(script);
    const initial = initialOf();
    const landed = await pressedWith(W2, pageAnswer(W2, { venues: null, provenance: null }));
    const ended = await requestPage<BrowseRow>(landed, { ...depsOf(), fetchJson: () => Promise.resolve(pageAnswer(W3, { venues: null, provenance: null }, 20)) }, W3);
    const refused = await requestPage<BrowseRow>(landed, { ...depsOf(), fetchJson: () => Promise.resolve({ kind: "error", reading: T.events, message: "refused" }) }, W3);
    const absent = await requestPage<BrowseRow>(landed, { ...depsOf(), fetchJson: () => Promise.resolve({ kind: "not_provisioned", missing: T.events }) }, W3);

    const states: [string, string | null, PageState<BrowseRow> | null, string, string, string][] = [
      ["offered", "more", null, "1", "50", "true"],
      ["loading", "loading", pressing(initial), "1", "50", "true"],
      ["refused, retryable", "more", refused, "51", "50", "true"],
      ["refused, not provisioned", null, absent, "51", "50", "true"],
      ["exhausted", "exhausted", ended, "101", "20", "false"],
    ];
    for (const [name, arm, state, from, held, truncated] of states) {
      paging.override = state;
      const markup = await renderBrowse(script);
      if (arm === null) expect(pagingArms(markup), name).toEqual([]);
      else expect(pagingArms(markup), name).toEqual([arm]);
      expect(windowLine(markup), name).toMatchObject({ lines: 1, held, from, drawn: held, truncated });
      expect(windowLine(markup).text, name).not.toContain("did not fill");
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
