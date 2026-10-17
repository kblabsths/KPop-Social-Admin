import { describe, expect, it } from "vitest";
import {
  BROWSE_VIEWS,
  COLUMNS_PARAM,
  RECENT_EVENTS,
  columnOptions,
  browseQuery,
  columnsHref,
  configuredKeys,
  shownColumns,
  toggledColumns,
  type BrowseColumnKey,
} from "@/lib/browse/views";
import { WINDOW_SIZES } from "@/lib/paging/bounds";
import {
  arrivalOrder,
  currentDecisions,
  joinBrowseRows,
  sourceIdsOf,
  type EventArrivalRow,
  type EventProvenanceRow,
} from "@/lib/browse/rows";
import { sourceFiles, sourceText } from "../source-tree";

/**
 * Browse's view definition and its column-selector algebra (campaign
 * admin-window/TASK-0015), offline and pure — no database, no DOM.
 *
 * These assert BEHAVIOUR: which columns a view configures, that the selector
 * offers exactly them, that a toggle changes exactly one, and that the state
 * survives a trip through the URL. Labels and copy are the walk's business,
 * so nothing here pins a rendered word.
 */

const view = RECENT_EVENTS;

describe("the view definition", () => {
  it("ships exactly one curated view", () => {
    // Spec §4 and the ticket: no whole-table browsing, no free-SQL runner, no
    // second curated view. Adding one is a design decision, not a build one.
    expect(BROWSE_VIEWS).toHaveLength(1);
    expect(BROWSE_VIEWS[0]).toBe(RECENT_EVENTS);
  });

  it("sorts on arrival, never on the scheduled date", () => {
    // ARCHITECTURE.md §11: "everything that came through the pipeline, newest
    // first" is events.created_at desc — arrival order, not the calendar.
    // starts_at is a column this view SHOWS and never its sort.
    expect(view.sort.field).toBe("created_at");
    expect(view.sort.direction).toBe("desc");
    expect(configuredKeys(view)).toContain("starts_at");
  });

  it("gives every configured column a distinct key and a label", () => {
    const keys = configuredKeys(view);
    expect(new Set(keys).size).toBe(keys.length);
    for (const column of view.columns) {
      expect(column.label.trim().length, column.key).toBeGreaterThan(0);
    }
  });

  it("keeps every window size inside the id-set chunk the joins are built on", () => {
    // A window's ids become one `.in(...)` per join leg; `ID_CHUNK` in
    // lib/db/gauges.ts is the size this codebase already decided is a safe
    // PostgREST URL. Going past it would need chunking that does not exist.
    // The size is the operator's choice since page windows (2026-10-16), so
    // the largest choice is what is bounded.
    expect(Math.max(...WINDOW_SIZES)).toBeLessThanOrEqual(100);
  });
});

describe("the columns the URL asks for", () => {
  it("shows the default set when the URL says nothing", () => {
    expect(shownColumns(view, undefined)).toEqual([...view.defaultColumns]);
    expect(shownColumns(view, "")).toEqual([...view.defaultColumns]);
    expect(shownColumns(view, "   ")).toEqual([...view.defaultColumns]);
  });

  it("collapses duplicates and ignores the order the URL wrote", () => {
    expect(shownColumns(view, "venue,title,venue")).toEqual(
      shownColumns(view, "title,venue"),
    );
  });
});

describe("the column selector", () => {
  it("changes exactly the toggled column and nothing else", () => {
    for (const key of configuredKeys(view)) {
      const before = shownColumns(view, undefined);
      const after = toggledColumns(view, before, key);
      const changed = configuredKeys(view).filter(
        (other) => before.includes(other) !== after.includes(other),
      );
      expect(changed, `toggling ${key}`).toEqual([key]);
    }
  });

  it("never offers a view with no columns in it", () => {
    // Toggling off the last one is a no-op: an empty `cols` value cannot be
    // told from an absent one, and a table with no columns is not a view.
    const only: BrowseColumnKey[] = ["title"];
    expect(toggledColumns(view, only, "title")).toEqual(only);
  });
});

/** This route's own path, and an origin to resolve a relative href against. */
const routePath = "/browse";
const origin = "https://admin.invalid";

describe("the selector's state in the URL", () => {
  it("spells the default set as the bare path, which reads back as the default", () => {
    const href = columnsHref(view, routePath, view.defaultColumns);
    expect(href).toBe(routePath);
    const url = new URL(href, origin);
    expect(url.searchParams.get(COLUMNS_PARAM)).toBeNull();
    expect(shownColumns(view, undefined)).toEqual([...view.defaultColumns]);
  });

  it("round-trips through every href the selector actually renders", () => {
    let shown = shownColumns(view, undefined);
    // Walk the selector: toggle each column in turn, following its own href.
    for (const key of configuredKeys(view)) {
      const option = columnOptions(view, shown).find((o) => o.key === key);
      expect(option, key).toBeDefined();
      const toggled = option?.toggled ?? [];
      const url = new URL(columnsHref(view, routePath, toggled), origin);
      shown = shownColumns(
        view,
        url.searchParams.get(COLUMNS_PARAM) ?? undefined,
      );
      expect(shown, key).toEqual([...toggled]);
    }
  });
});

/**
 * What a paged request repeats — campaign admin-window/TASK-0069.
 *
 * `browseQuery` is the screen's own state, serialized, and it is the SAME
 * state `columnsHref` writes into a link: a press continues what is on screen,
 * so the two spellings are read back with `shownColumns`, which is how the
 * page resolves the URL in the first place.
 */
describe("the state a paged request repeats", () => {
  it("says the same thing the selector's own href says", () => {
    // One spelling, read two ways (LESSONS 5): the query a press carries and
    // the query a link carries are the same parameter with the same value.
    for (const keys of [["title", "sources"], ["venue"], configuredKeys(view)] as const) {
      const fromHref = new URL(
        columnsHref(view, routePath, [...keys]),
        origin,
      ).searchParams.get(COLUMNS_PARAM);
      const fromQuery = new URLSearchParams(browseQuery(view, [...keys])).get(
        COLUMNS_PARAM,
      );
      expect(fromQuery, keys.join(",")).toBe(fromHref);
    }
  });
});

describe("arrival order", () => {
  const at = (id: string, created_at: string | null): EventArrivalRow => ({
    event_id: id,
    title: id,
    description: null,
    poster_url: null,
    starts_at: null,
    created_at,
  });

  it("puts the newest arrival first, whatever order the rows came in", () => {
    const rows = [
      at("b", "2026-08-01T00:00:00Z"),
      at("c", "2026-09-01T00:00:00Z"),
      at("a", "2026-07-01T00:00:00Z"),
    ];
    expect(arrivalOrder(rows).map((r) => r.event_id)).toEqual(["c", "b", "a"]);
  });

  it("breaks a tie on the id, so two rows never swap between renders", () => {
    const rows = [
      at("a", "2026-09-01T00:00:00Z"),
      at("b", "2026-09-01T00:00:00Z"),
    ];
    expect(arrivalOrder(rows).map((r) => r.event_id)).toEqual(["b", "a"]);
    expect(arrivalOrder([...rows].reverse()).map((r) => r.event_id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("sorts a row with no arrival stamp last rather than first", () => {
    const rows = [at("none", null), at("dated", "2026-01-01T00:00:00Z")];
    expect(arrivalOrder(rows).map((r) => r.event_id)).toEqual(["dated", "none"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [
      at("a", "2026-07-01T00:00:00Z"),
      at("b", "2026-09-01T00:00:00Z"),
    ];
    arrivalOrder(rows);
    expect(rows.map((r) => r.event_id)).toEqual(["a", "b"]);
  });
});

describe("the join", () => {
  const event = (id: string): EventArrivalRow => ({
    event_id: id,
    title: `event ${id}`,
    description: null,
    poster_url: null,
    starts_at: null,
    created_at: "2026-09-01T00:00:00Z",
  });

  /**
   * One row of the append-only decision log. A fact identity is
   * `(entity_id, field)`, so two decisions on the same field are the same
   * fact decided twice — and `source_id` is null on a verdict unset.
   */
  const decision = (
    entity_id: string,
    field: string,
    source_id: string | null,
    applied_at = "2026-01-01T00:00:00Z",
    provenance_id = `${entity_id}/${field}/${applied_at}/${source_id}`,
  ): EventProvenanceRow => ({
    provenance_id,
    entity_id,
    field,
    source_id,
    applied_at,
  });

  it("names the distinct sources behind a row, alphabetically", () => {
    const rows = joinBrowseRows({
      events: [event("e1")],
      venues: [],
      // Three facts of the same row, two of them won by the same source.
      provenance: [
        decision("e1", "title", "s2"),
        decision("e1", "starts_at", "s1"),
        decision("e1", "description", "s1"),
      ],
      sources: [
        { source_id: "s1", source: "ticketmaster" },
        { source_id: "s2", source: "bandsintown" },
      ],
    });
    expect(rows[0].sources).toEqual(["bandsintown", "ticketmaster"]);
  });

  it("keeps a source id whose sources row never arrived, rather than dropping it", () => {
    const rows = joinBrowseRows({
      events: [event("e1")],
      venues: [],
      provenance: [decision("e1", "title", "s9")],
      sources: [],
    });
    expect(rows[0].sources).toEqual(["s9"]);
  });

  /**
   * Both directions in ONE join (LESSONS 8): the blank-named source
   * falls back to its id while its sibling's name travels byte-identical —
   * never trimmed, never swapped for an id the app could have shown instead.
   */
  it("falls back per source, leaving a named sibling in the same read its name", () => {
    for (const blank of ["", "   ", "\u200b"]) {
      const rows = joinBrowseRows({
        events: [event("e1")],
        venues: [],
        provenance: [
          decision("e1", "title", "s1"),
          decision("e1", "starts_at", "s2"),
        ],
        sources: [
          { source_id: "s1", source: blank },
          { source_id: "s2", source: "  bandsintown  " },
        ],
      });
      expect(rows[0].sources, JSON.stringify(blank)).toEqual(
        ["s1", "  bandsintown  "].sort(),
      );
    }
  });

  /**
   * `field_provenance` is an APPEND-ONLY DECISION LOG, not a current-state
   * table: `contracts/data-model.md`, Per-field provenance — "The latest row
   * per fact identity is the current provenance; the rows before it are that
   * fact's decision history", and the schema agrees (scraper migration
   * 20260818000000: `COMMENT ON TABLE field_provenance IS 'The decision
   * log ... Append-only'`; trigger `field_provenance_reject_rewrite` refuses
   * every update and delete; the only key is `provenance_id`).
   *
   * So the sources BEHIND a row are the sources of the latest decision per
   * fact identity — never the union of every decision ever made on it.
   *
   * The unset is the LATEST decision on its fact, so it supersedes the sourced
   * one it replaced: the field's value went back to null and no source is
   * behind it any more.
   */
  it("drops the source a later verdict unset took the field away from", () => {
    const rows = joinBrowseRows({
      events: [event("e1")],
      venues: [],
      provenance: [
        decision("e1", "poster_url", "s2", "2026-01-01T00:00:00Z"),
        decision("e1", "poster_url", null, "2026-08-01T00:00:00Z"),
        decision("e1", "title", "s1", "2026-02-01T00:00:00Z"),
      ],
      sources: [
        { source_id: "s1", source: "ticketmaster" },
        { source_id: "s2", source: "bandsintown" },
      ],
    });
    expect(rows[0].sources).toEqual(["ticketmaster"]);
  });

  it("keeps the same fact's decisions apart per entity", () => {
    const rows = joinBrowseRows({
      events: [event("e1"), event("e2")],
      venues: [],
      // Same field, different entities: two facts, not one decided twice.
      provenance: [
        decision("e1", "title", "s1", "2026-01-01T00:00:00Z"),
        decision("e2", "title", "s2", "2026-08-01T00:00:00Z"),
      ],
      sources: [
        { source_id: "s1", source: "ticketmaster" },
        { source_id: "s2", source: "bandsintown" },
      ],
    });
    const byId = new Map(rows.map((r) => [r.event_id, r]));
    expect(byId.get("e1")?.sources).toEqual(["ticketmaster"]);
    expect(byId.get("e2")?.sources).toEqual(["bandsintown"]);
  });

  it("lists each source id once, in first-seen order", () => {
    expect(
      sourceIdsOf([
        { source_id: "s2" },
        { source_id: "s1" },
        { source_id: "s2" },
      ]),
    ).toEqual(["s2", "s1"]);
  });
});

/**
 * The latest-per-fact reduction on its own (campaign admin-window/BUG-0010).
 *
 * `contracts/data-model.md`, Per-field provenance: the latest row per fact
 * identity is the current provenance, the rows before it are history, and rows
 * are never updated or deleted — so the log grows and only this reduction
 * keeps the Sources column from growing with it.
 */
describe("the current provenance of a fact", () => {
  const log = (
    entity_id: string,
    field: string,
    source_id: string | null,
    applied_at: string,
    provenance_id: string,
  ): EventProvenanceRow => ({
    provenance_id,
    entity_id,
    field,
    source_id,
    applied_at,
  });

  it("keeps one decision per fact identity, whatever the log's order", () => {
    const rows = [
      log("e1", "title", "s1", "2026-01-01T00:00:00Z", "p1"),
      log("e1", "title", "s2", "2026-08-01T00:00:00Z", "p2"),
      log("e1", "title", "s3", "2026-04-01T00:00:00Z", "p3"),
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const current = currentDecisions(order);
      expect(current).toHaveLength(1);
      expect(current[0].source_id).toBe("s2");
    }
  });

  it("keeps every distinct fact of the same entity", () => {
    const current = currentDecisions([
      log("e1", "title", "s1", "2026-01-01T00:00:00Z", "p1"),
      log("e1", "starts_at", "s2", "2026-01-01T00:00:00Z", "p2"),
    ]);
    expect(current.map((row) => row.field).sort()).toEqual([
      "starts_at",
      "title",
    ]);
  });

  it("breaks a tied timestamp on the time-ordered primary key", () => {
    // `provenance_id` is uuid v7, so the key itself carries the later instant
    // when two rows share an `applied_at`.
    const tied = [
      log("e1", "title", "s_first", "2026-01-01T00:00:00Z", "p1"),
      log("e1", "title", "s_last", "2026-01-01T00:00:00Z", "p2"),
    ];
    for (const order of [tied, [...tied].reverse()]) {
      expect(currentDecisions(order)[0].source_id).toBe("s_last");
    }
  });

  it("keeps a verdict unset as the current decision it is", () => {
    const current = currentDecisions([
      log("e1", "poster_url", "s1", "2026-01-01T00:00:00Z", "p1"),
      log("e1", "poster_url", null, "2026-08-01T00:00:00Z", "p2"),
    ]);
    expect(current).toHaveLength(1);
    expect(current[0].source_id).toBeNull();
  });
});

describe("what Browse must NOT contain", () => {
  // The walk and the read are `tests/offline/source-tree.ts` — one copy for
  // every structural rule in this suite, tolerant of the probe
  // `db/layering.test.ts` writes and deletes under the source tree in a
  // parallel worker (admin-window/BUG-0032). `sourceText` is the RAW file:
  // both rules below must see a forbidden call even where a comment could
  // hide it.

  it("has no SQL-executing route and no whole-table browser", () => {
    // The ticket's own check, asserted here too so it survives a refactor of
    // the check list: no `select * from`, no execute_sql. Both are the shape
    // of a route that runs SQL a caller supplied, which this app has never had
    // and must never grow — PostgREST cannot execute SQL, so the ban is about
    // not BUILDING such a path (AGENTS.md, STACK.md §2).
    const forbidden = new RegExp(
      ["select\\s+\\*\\s+from", "execute_sql"].join("|"),
      "i",
    );
    const offenders = sourceFiles().filter((file) => forbidden.test(sourceText(file)));
    expect(offenders).toEqual([]);
  });

  it("calls a database procedure from the settlement seam alone", () => {
    // INVERTED for M2 (campaign admin-window/TASK-0048). `.rpc(` used to sit in
    // the list above, banned outright, because through M1 nothing settled
    // anything. M2 settles a review item through ONE call to
    // `settle_review_item` (ARCHITECTURE.md §9.2), so the ban became a
    // location.
    //
    // This scan reads the RAW file, not code lines, so a comment spelling the
    // call counts as spelling it — which is stricter than the code-line rules
    // in `tests/offline/edit/config.test.ts` and `…/review/one-place.test.ts`
    // that own this property, and is kept that way on purpose: a whole-table
    // browser would arrive commented out first.
    const procedureCall = /\.rpc\(/;
    const callers = sourceFiles().filter((file) => procedureCall.test(sourceText(file)));
    expect(callers).toEqual(["src/lib/db/verdict.ts"]);
  });

  it("defines its views in exactly one file", () => {
    const definition = new RegExp("BROWSE_VIEWS\\s*[:=]");
    const files = sourceFiles().filter((file) => definition.test(sourceText(file)));
    expect(files).toEqual(["src/lib/browse/views.ts"]);
  });
});
