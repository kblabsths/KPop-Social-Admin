import { describe, expect, it, vi } from "vitest";
import * as cheerio from "cheerio";
import { EM_DASH, UTC_ZONE } from "@/lib/format";
import { T } from "@/lib/db/tables";
import {
  COLUMNS_PARAM,
  RECENT_EVENTS,
  columnsParamValue,
  configuredKeys,
  shownColumns,
  type BrowseColumnKey,
} from "@/lib/browse/views";
import { recordHref } from "@/lib/records/routes";
import { BrowseTable } from "@/components/browse/browse-table";
import { h, render, textOf } from "../ui/markup";
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
 * rendered word or a class name. Copy and styling belong to the walk.
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

const { default: BrowsePage } = await import("@/app/browse/page");

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
  return render(await BrowsePage({ searchParams: Promise.resolve(params) }));
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

/** Every href in the markup. */
function hrefs(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[href]")
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

  it("renders the poster as an image the operator can actually look at", async () => {
    const markup = await renderBrowse(healthyScript());
    const $ = cheerio.load(markup);
    const sources = $("img")
      .toArray()
      .map((img) => $(img).attr("src"));
    expect(sources).toContain("https://example.invalid/posters/new.jpg");
  });

  it("links every row to its own record surface", async () => {
    const markup = await renderBrowse(healthyScript());
    const links = hrefs(markup);
    expect(links).toContain(recordHref("events", EVENT_NEW));
    expect(links).toContain(recordHref("events", EVENT_OLD));
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
