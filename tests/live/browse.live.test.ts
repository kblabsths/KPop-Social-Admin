import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import BrowsePage from "@/app/browse/page";
import { recordHref } from "@/lib/records/routes";
import { COLUMNS_PARAM, RECENT_EVENTS } from "@/lib/browse/views";
import type { BrowseRow } from "@/lib/browse/rows";
import { OFFSET_PARAM, PAGE_ROUTES } from "@/lib/paging/bounds";
import {
  boundOf,
  initialPage,
  requestPage,
  type PageState,
} from "@/lib/paging/machine";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import {
  countOrAbsent,
  exactCount,
  gradeSurface,
  independentClient,
  oneEach,
  refusalText,
  renderPage,
  surfaceHooks,
  whileStill,
} from "./parity";

/**
 * Browse against staging (campaign admin-window/TASK-0015).
 *
 * Acceptance test 2's rule, ARCHITECTURE.md §10: what the page RENDERED is
 * compared with a query THIS TEST issues, written independently of the
 * `lib/db` function the page called. Two paths to one answer, or it proves
 * nothing — so nothing below asks `lib/db/browse.ts` what it expects.
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
 * **The STATE KIND of the events surface is named before any row is compared**
 * (ARCHITECTURE.md §10, common violation 6; oracle rewritten by
 * admin-window/TASK-0032): `ok` compares rows, `empty` is a pass with the
 * window counted at 0, `not_provisioned` needs this test's own absence code,
 * and `error` is a FAIL. The surface is the LAST child of the page's one
 * section — the events body, in whichever of its four states it rendered. The
 * two leg notes above it (venues, provenance) are separate reads with separate
 * states, which is why the section as a whole is not the surface.
 */

const view = RECENT_EVENTS;

/**
 * The events surface, by the `data-surface` name `src/app/browse/page.tsx`
 * gives its body: the events body in each of its four states — the table, the
 * `Empty` card, the `NotProvisioned` card, or the table carrying the error
 * line. Structural; no heading or copy is read.
 *
 * A NAME, never a position. This was `section:nth-of-type(1) > :last-child`
 * until admin-window/DEBT-0002, which compounded two fragilities: the page's
 * section ORDER, and the body's position among its section's own children.
 * `stateOf` (`tests/live/parity.ts`) demands the selector match EXACTLY ONE
 * element, so one added section, or one more leg note rendered below the
 * table, either duplicated the match or repointed it at a leg note — silently,
 * because a leg note is a perfectly readable state card. On `/cycles` the same
 * class threw `MarkupReadError` in four live tests (admin-window/BUG-0040,
 * admin-window/BUG-0056).
 *
 * It names the BODY and not the `<Section>` around it, deliberately: the
 * section also carries the column selector and the venues / provenance leg
 * notes, which are separate reads with separate states. Grading them as one
 * surface makes an unreadable venue join look like unreadable events.
 */
const EVENTS = '[data-surface="events"]';

/** Grade the events surface against this test's own count of the window. */
async function gradeEvents(markup: string) {
  return gradeSurface({
    markup,
    within: EVENTS,
    object: T.events,
    counted: async () => {
      const whole = await countOrAbsent(() => exactCount(T.events));
      return whole === "absent" ? "absent" : Math.min(whole, view.window);
    },
  });
}

/** Load the page once; every assertion below reads this one render. */
async function browseMarkup(): Promise<string> {
  return renderPage(BrowsePage, { searchParams: Promise.resolve({}) });
}

/**
 * The event ids the page RENDERED, in rendered order.
 *
 * Read from each row's own record link, which carries the id verbatim — a
 * structural read, so a copy or styling change cannot redden it.
 */
function renderedEventIds(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("tbody tr")
    .toArray()
    .flatMap((tr) => {
      const href = $(tr).find('a[href^="/records/events/"]').first().attr("href");
      return href ? [decodeURIComponent(href.slice("/records/events/".length))] : [];
    });
}

/** The cells of the row at `index`, keyed by their header label. */
function rowByLabel(markup: string, index: number): Record<string, string> {
  const $ = cheerio.load(markup);
  const labels = $("thead th")
    .toArray()
    .map((th) => $(th).text().trim());
  const cells = $("tbody tr")
    .eq(index)
    .find("td")
    .toArray()
    .map((td) => $(td).text().replace(/\s+/g, " ").trim());
  return Object.fromEntries(labels.map((label, i) => [label, cells[i] ?? ""]));
}

/** This test's own read of the window, written without the app's data layer. */
async function windowFromDatabase(): Promise<
  { event_id: string; title: string; created_at: string }[]
> {
  const { data, error } = await independentClient()
    .from(T.events)
    .select("event_id, title, created_at")
    .order("created_at", { ascending: false })
    .order("event_id", { ascending: false })
    .limit(view.window);
  if (error) throw new Error(`the window query failed: ${error.message}`);
  return (data ?? []) as { event_id: string; title: string; created_at: string }[];
}

describe("Browse's surface hook against staging", () => {
  it("names the events surface once, whatever state it rendered in", async () => {
    // The oracle's addressing itself, asserted before it is used: the hook has
    // to reach exactly one element, which is the precondition `stateOf`
    // enforces per call. Read bare AND with a column narrowing, because the
    // `?columns=` branch redraws the table the hook wraps
    // (admin-window/DEBT-0002).
    const renders: [string, string][] = [
      ["bare", await browseMarkup()],
      [
        "one column",
        await renderPage(BrowsePage, {
          searchParams: Promise.resolve({ [COLUMNS_PARAM]: "event_id" }),
        }),
      ],
    ];
    for (const [name, markup] of renders) {
      expect(surfaceHooks(markup, [EVENTS]), name).toEqual({
        counts: oneEach([EVENTS]),
        nested: [],
      });
      // The leg notes stay OUTSIDE it: their states are their own reads', and
      // a surface that swallowed them would grade an unreadable venue join as
      // unreadable events. The body holds at most its own one state card.
      expect(cheerio.load(markup)(EVENTS).find("[data-state]").length, name)
        .toBeLessThanOrEqual(1);
    }
  });
});

describe("Browse against staging", () => {
  it("renders the window newest-first by arrival, exactly as the database orders it", async () => {
    const markup = await browseMarkup();
    if ((await gradeEvents(markup)) !== "ok") return;
    const expected = await windowFromDatabase();

    const rendered = renderedEventIds(markup);
    expect(rendered).toEqual(expected.map((row) => row.event_id));

    // The order claim in its own right: every arrival stamp is at or before
    // the one above it, so "newest first" is asserted on the values and not
    // only on the two lists matching.
    const stamps = expected.map((row) => row.created_at);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it("shows no more than the window, and every row the database has when there are fewer", async () => {
    const markup = await browseMarkup();
    if ((await gradeEvents(markup)) !== "ok") return;
    const expected = await windowFromDatabase();

    const { count, error } = await exactCount(T.events);
    if (error) throw new Error(`the count query failed: ${JSON.stringify(error)}`);
    if (typeof count !== "number") {
      throw new Error("the count query returned no count");
    }

    expect(renderedEventIds(markup)).toHaveLength(Math.min(count, view.window));
    expect(expected).toHaveLength(Math.min(count, view.window));
  });

  it("renders the first page of rows with the values the database holds", async () => {
    const markup = await browseMarkup();
    if ((await gradeEvents(markup)) !== "ok") return;

    // The row the PAGE put first, asked of the database by its own id. Reading
    // the id off the render rather than re-deriving "the newest" keeps this a
    // comparison of VALUES — which is what this case is about — and takes the
    // ordering claim, which is the case above's, out of it. It also cannot
    // race a row arriving between the render and the query: measured
    // 2026-09-02, an event inserted mid-test made the two "newest" rows
    // different rows and reddened a correct page.
    const newest = renderedEventIds(markup)[0];
    const { data, error } = await independentClient()
      .from(T.eventListings)
      .select("event_id, title, starts_at, venue_name")
      .eq("event_id", newest)
      .maybeSingle();
    if (error) throw new Error(`the listing query failed: ${error.message}`);
    expect(data, "the listings view has no row for the newest event").toBeTruthy();
    const listing = data as {
      title: string | null;
      starts_at: string | null;
      venue_name: string | null;
    };

    const row = rowByLabel(markup, 0);
    const label = (key: string) =>
      view.columns.find((column) => column.key === key)?.label ?? key;

    expect(row[label("title")]).toBe(listing.title ?? newest);
    expect(row[label("venue")]).toBe(listing.venue_name ?? EM_DASH);

    // The scheduled time renders absolute UTC, to the minute — with the zone
    // stated once, by the column HEADER, and not again in the cell
    // (admin-window/BUG-0047; Voice bar 6).
    expect(label("starts_at")).toContain("UTC");
    if (listing.starts_at) {
      const utc = new Date(listing.starts_at).toISOString().slice(0, 16);
      expect(row[label("starts_at")]).toBe(utc.replace("T", " "));
    }

    // And the row really does link at its own record surface.
    const $ = cheerio.load(markup);
    expect(
      $(`a[href="${recordHref("events", newest)}"]`).length,
    ).toBeGreaterThan(0);
  });

  it("names the same sources behind the newest row as the provenance join does", async () => {
    const markup = await browseMarkup();
    if ((await gradeEvents(markup)) !== "ok") return;
    // Again the row the page put first, by its own id — see the case above.
    const newest = renderedEventIds(markup)[0];

    // The test's own two-step join, written independently of lib/db/browse.ts.
    //
    // `field_provenance` is an APPEND-ONLY DECISION LOG (contracts/data-model.md,
    // Per-field provenance; admin-window/BUG-0010): the current provenance of a
    // fact is its LATEST row, the ones before it are history, and a verdict
    // unset carries a null `source_id`. So this reduction is part of what the
    // test independently computes, not something it takes on the page's word.
    const provenance = await independentClient()
      .from(T.fieldProvenance)
      .select("provenance_id, field, source_id, applied_at")
      .eq("entity_type", T.events)
      .eq("entity_id", newest);
    if (provenance.error) {
      throw new Error(`the provenance query failed: ${provenance.error.message}`);
    }
    const decisions = (provenance.data ?? []) as {
      provenance_id: string;
      field: string;
      source_id: string | null;
      applied_at: string;
    }[];
    const current = new Map<string, (typeof decisions)[number]>();
    for (const row of decisions) {
      const held = current.get(row.field);
      const later =
        held === undefined ||
        Date.parse(row.applied_at) > Date.parse(held.applied_at) ||
        (Date.parse(row.applied_at) === Date.parse(held.applied_at) &&
          row.provenance_id > held.provenance_id);
      if (later) current.set(row.field, row);
    }
    const sourceIds = [
      ...new Set(
        [...current.values()]
          .map((row) => row.source_id)
          .filter((id): id is string => id !== null),
      ),
    ];

    let names: string[] = [];
    if (sourceIds.length > 0) {
      const sources = await independentClient()
        .from(T.sources)
        .select("source_id, source")
        .in("source_id", sourceIds);
      if (sources.error) {
        throw new Error(`the sources query failed: ${sources.error.message}`);
      }
      const bySourceId = new Map(
        ((sources.data ?? []) as { source_id: string; source: string }[]).map(
          (row) => [row.source_id, row.source],
        ),
      );
      names = sourceIds
        .map((id) => bySourceId.get(id) ?? id)
        .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
    }

    const label =
      view.columns.find((column) => column.key === "sources")?.label ?? "sources";
    const cell = rowByLabel(markup, 0)[label];
    expect(cell).toBe(names.length > 0 ? names.join(", ") : EM_DASH);
  });
});

/* ── paging past the first window ────────────────────────────────────────── */

/**
 * `/browse` continues its one curated view, against staging — campaign
 * admin-window/TASK-0069, SPEC F14, M3 EC4.
 *
 * The walk drives the app's OWN route handler (`GET /api/admin/browse/rows`)
 * with the app's OWN driver (`requestPage`), and grades what came back against
 * a query THIS FILE writes: its own columns, its own order, its own range —
 * never `lib/db/browse.ts`.
 *
 * **The one thing substituted is the SIGN-IN GATE.** That handler's first
 * statement is `requireAdmin()`, which reads a NextAuth session; a test process
 * has none, so every page of the walk would be a 401 and the walk would grade
 * nothing about the database. So the gate answers as an allowlisted admin here
 * and nothing else is: the bound guard, the four reads, the leg notes and the
 * answers are the app's, against staging. The gate's own behaviour is graded
 * where it can be graded honestly (`tests/offline/paging/browse-route.test.ts`
 * stubs it CLOSED; `tests/http/` drives the real middleware), and the count
 * below asserts this handler still ASKS.
 *
 * **The state kind is named before any row is compared**, off `data-state`
 * inside the surface `data-surface` names — the same rule the cases above
 * follow (ARCHITECTURE.md §10, common violation 6).
 */
const gate = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => {
    gate.calls += 1;
    return { user: { email: "live-suite@admin-window.local" } };
  },
}));

const { GET } = await import("@/app/api/admin/browse/rows/route");

/** How many presses this walk makes. Enough to be past the first window. */
const WALK_PAGES = 2;

/** Every paging element the page drew, by the arm it drew. */
function pagingArms(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-paging]")
    .toArray()
    .map((element) => $(element).attr("data-paging") ?? "");
}

/**
 * THE ORACLE: the newest `limit` events by ARRIVAL, enumerated by a range
 * query this file writes — its own columns, its own total order, ONE round
 * trip, so the shape held still by `whileStill` stays small (TASK-0075).
 *
 * It is not the app's read. A page that stopped short, repeated a row or
 * skipped one would still be "a list of ids"; only a second enumeration made
 * independently catches it.
 */
async function newestByArrival(limit: number): Promise<string[]> {
  const { data, error } = await independentClient()
    .from(T.events)
    .select("event_id, created_at")
    .order("created_at", { ascending: false })
    .order("event_id", { ascending: false })
    .range(0, limit - 1);
  if (error) throw new Error(`the oracle's window query failed: ${error.message}`);
  return ((data ?? []) as { event_id: string }[]).map((row) => row.event_id);
}

describe("paging past the first window, against staging", () => {
  /** One paging request, through the app's own route handler. */
  async function viaHandler(url: string): Promise<unknown> {
    const response = await GET(new Request(`http://localhost${url}`));
    return response.json();
  }

  /**
   * Press `presses` times from the state the FIRST SCREEN leaves behind.
   *
   * The driver is the app's, the route is the app's, and the loop is this
   * file's: it presses only from `idle`, stops at `exhausted`, and treats a
   * refusal as a failure carrying the refusal's own words — a walk that
   * silently stopped at a refused page would report a short set as the whole
   * of it.
   */
  async function walk(
    held: number,
    presses: number,
  ): Promise<{ rows: BrowseRow[]; bounds: (string | null)[]; notes: unknown }> {
    const bounds: (string | null)[] = [];
    const asked = async (url: string): Promise<unknown> => {
      bounds.push(new URLSearchParams(url.split("?")[1]).get(OFFSET_PARAM));
      return viaHandler(url);
    };

    let state: PageState<BrowseRow> = initialPage<BrowseRow>(held, true, "");
    let made = 0;
    while (state.status === "idle" && made < presses) {
      state = await requestPage<BrowseRow>(state, {
        route: PAGE_ROUTES.browse,
        params: "",
        size: view.window,
        fetchJson: asked,
      });
      made += 1;
      if (state.refusal !== null) {
        throw new Error(
          `the walk was refused at bound ${bounds[bounds.length - 1]}: ` +
            refusalText(state.refusal),
        );
      }
    }
    return { rows: [...state.rows], bounds, notes: state.notes };
  }

  it("reaches an event beyond the first window's last row, in the order the database holds", async () => {
    const reach = view.window * (WALK_PAGES + 1);
    const { made, held } = await whileStill(
      () => newestByArrival(reach),
      async () => {
        const markup = await browseMarkup();
        const first = renderedEventIds(markup);
        // The walk starts from the rows the SERVER rendered, and only where
        // that screen is a bound this surface can page from at all.
        const walked =
          first.length === view.window
            ? await walk(first.length, WALK_PAGES)
            : { rows: [] as BrowseRow[], bounds: [] as (string | null)[], notes: null };
        return {
          markup,
          first,
          arms: pagingArms(markup),
          walked: walked.rows.map((row) => row.event_id),
          bounds: walked.bounds,
          notes: walked.notes,
        };
      },
    );

    // The state kind, before any id is compared.
    if ((await gradeEvents(made.markup)) !== "ok") return;

    if (held.length <= view.window) {
      // A catalog that fits in one window is not a walk: the page offers no
      // control, and this says so rather than inventing one.
      expect(made.arms, "a catalog inside one window offered a control").toEqual([]);
      expect(made.walked).toEqual([]);
      return;
    }

    // There IS more, so the page says so — and the walk starts from the rows
    // the server rendered.
    expect(made.arms).toContain("more");
    expect(made.first).toHaveLength(view.window);
    expect(made.walked.length, "the walk reached nothing past the first window")
      .toBeGreaterThan(0);
    // …and it really is PAST the first window's last row.
    expect(made.walked).not.toContain(made.first[made.first.length - 1]);

    // The gate really is asked, once per page of the walk.
    expect(gate.calls, "the paging route answered without asking the gate")
      .toBeGreaterThanOrEqual(made.bounds.length);
    // Every press carried an EXPLICIT bound, on the window's own grid.
    expect(made.bounds).toEqual(
      made.bounds.map((_, index) => String(view.window * (index + 1))),
    );

    const reached = [...made.first, ...made.walked];
    expect(new Set(reached).size, "an event was reached twice").toBe(reached.length);

    // THE ORACLE: the same ids, in the same arrival order, from a query
    // written independently of the app's data layer.
    expect(reached).toEqual(held.slice(0, reached.length));

    // Every leg of every page reported, and a leg that refused would have
    // reached the state rather than leaving a silently empty column.
    expect(made.notes === null || typeof made.notes === "object").toBe(true);
  });
});

/* ── one order, walked three times, against staging ──────────────────────── */

/**
 * THE PAGED READS ARE ONE TOTAL ORDER HERE TOO — campaign
 * admin-window/BUG-0216, criterion 7.
 *
 * `/browse` pages through the SAME driver, the same `PageState` and the same
 * `usePageRows` as `/claims`, so the defect that repeated a claim id on
 * `/claims` reaches this surface by construction and is fixed here by the same
 * change: the state declares the bound its pages were taken after, and stops
 * being drawn under a first screen that no longer ends there.
 *
 * The walk above grades ONE walk against an oracle, which cannot see an order
 * that is merely UNSTABLE — a bound that means a different row on two requests
 * is how a paged surface repeats one row and drops another. So this walks the
 * same head three times and asks for the same three properties `/claims`'
 * repeated walk does, at this surface's scale: 120 events, three windows, so
 * the walk is the whole of what this surface can page.
 */
describe("the same paged order, walked three times, against staging", () => {
  const WALKS = 3;

  /** One paging request, through the app's own route handler. */
  async function viaHandler(url: string): Promise<unknown> {
    const response = await GET(new Request(`http://localhost${url}`));
    return response.json();
  }

  /**
   * The head of the order as the OPERATOR reaches it: the server's first
   * screen, then `WALK_PAGES` presses through the app's own driver.
   */
  async function walkHead(): Promise<string[]> {
    const first = renderedEventIds(await browseMarkup());
    if (first.length < view.window) return first;
    let state: PageState<BrowseRow> = initialPage<BrowseRow>(
      first.length,
      true,
      boundOf(first, (id) => id),
    );
    let made = 0;
    while (state.status === "idle" && made < WALK_PAGES) {
      state = await requestPage<BrowseRow>(state, {
        route: PAGE_ROUTES.browse,
        params: "",
        size: view.window,
        fetchJson: viaHandler,
      });
      made += 1;
      if (state.refusal !== null) {
        throw new Error(`the walk was refused: ${refusalText(state.refusal)}`);
      }
    }
    return [...first, ...state.rows.map((row) => row.event_id)];
  }

  it("reaches the same events, in the same places, on every walk — none twice, none skipped", async () => {
    const reach = view.window * (WALK_PAGES + 1);
    const { made, held } = await whileStill(
      () => newestByArrival(reach),
      async () => {
        const walks: string[][] = [];
        for (let walk = 0; walk < WALKS; walk += 1) walks.push(await walkHead());
        return walks;
      },
    );

    if (held.length <= view.window) {
      // A catalog inside one window is not a walk: every walk is the first
      // screen, and this says so rather than inventing a press.
      expect(made.every((walk) => walk.length === held.length)).toBe(true);
      return;
    }

    made.forEach((walk, index) => {
      const what = `walk ${index + 1} of ${WALKS}`;
      expect(new Set(walk).size, `${what}: an event was reached twice`).toBe(walk.length);
      // No event skipped: the walk IS the head of the order the oracle wrote.
      expect(walk, `${what}: the walked set is not the order's head`).toEqual(
        held.slice(0, walk.length),
      );
    });

    for (let index = 1; index < WALKS; index += 1) {
      expect(
        made[index],
        `walk ${index + 1} put different events at the same bounds as walk 1`,
      ).toEqual(made[0]);
    }
  }, 120_000);
});
