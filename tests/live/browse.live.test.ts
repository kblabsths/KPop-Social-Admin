import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import BrowsePage from "@/app/browse/page";
import { eventRecordHref } from "@/lib/browse/rows";
import { RECENT_EVENTS } from "@/lib/browse/views";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import { independentClient, renderPage } from "./parity";

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
 */

const view = RECENT_EVENTS;

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
    const expected = await windowFromDatabase();

    const { count, error } = await independentClient()
      .from(T.events)
      .select("*", { head: true, count: "exact" });
    if (error) throw new Error(`the count query failed: ${error.message}`);
    if (typeof count !== "number") {
      throw new Error("the count query returned no count");
    }

    expect(renderedEventIds(markup)).toHaveLength(Math.min(count, view.window));
    expect(expected).toHaveLength(Math.min(count, view.window));
  });

  it("renders the first page of rows with the values the database holds", async () => {
    const markup = await browseMarkup();
    const expected = await windowFromDatabase();
    if (expected.length === 0) return; // an empty catalog is a legitimate state

    const newest = expected[0];
    const { data, error } = await independentClient()
      .from(T.eventListings)
      .select("event_id, title, starts_at, venue_name")
      .eq("event_id", newest.event_id)
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

    expect(row[label("title")]).toBe(listing.title ?? newest.event_id);
    expect(row[label("venue")]).toBe(listing.venue_name ?? EM_DASH);

    // The scheduled time renders absolute UTC, to the minute.
    if (listing.starts_at) {
      const utc = new Date(listing.starts_at).toISOString().slice(0, 16);
      expect(row[label("starts_at")]).toBe(`${utc.replace("T", " ")} UTC`);
    }

    // And the row really does link at its own record surface.
    const $ = cheerio.load(markup);
    expect(
      $(`a[href="${eventRecordHref(newest.event_id)}"]`).length,
    ).toBeGreaterThan(0);
  });

  it("names the same sources behind the newest row as the provenance join does", async () => {
    const markup = await browseMarkup();
    const expected = await windowFromDatabase();
    if (expected.length === 0) return;
    const newest = expected[0];

    // The test's own two-step join, written independently of lib/db/browse.ts.
    const provenance = await independentClient()
      .from(T.fieldProvenance)
      .select("source_id")
      .eq("entity_type", T.events)
      .eq("entity_id", newest.event_id);
    if (provenance.error) {
      throw new Error(`the provenance query failed: ${provenance.error.message}`);
    }
    const sourceIds = [
      ...new Set(
        ((provenance.data ?? []) as { source_id: string }[]).map(
          (row) => row.source_id,
        ),
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
