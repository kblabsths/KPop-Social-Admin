import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import BrowsePage from "@/app/browse/page";
import { eventRecordHref } from "@/lib/browse/rows";
import { RECENT_EVENTS } from "@/lib/browse/views";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import {
  countOrAbsent,
  exactCount,
  gradeSurface,
  independentClient,
  renderPage,
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
 * The events surface: the last child of the page's one section, which is the
 * body in each of its four states — the table, the `Empty` card, the
 * `NotProvisioned` card, or the table carrying the error line
 * (`src/app/browse/page.tsx`). Structural; no heading or copy is read.
 */
const EVENTS = "section:nth-of-type(1) > :last-child";

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

    // The scheduled time renders absolute UTC, to the minute.
    if (listing.starts_at) {
      const utc = new Date(listing.starts_at).toISOString().slice(0, 16);
      expect(row[label("starts_at")]).toBe(`${utc.replace("T", " ")} UTC`);
    }

    // And the row really does link at its own record surface.
    const $ = cheerio.load(markup);
    expect(
      $(`a[href="${eventRecordHref(newest)}"]`).length,
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
