import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROWSE_VIEWS,
  COLUMNS_PARAM,
  RECENT_EVENTS,
  columnOptions,
  columnsHref,
  columnsParamValue,
  configuredKeys,
  shownColumns,
  toggledColumns,
  type BrowseColumnKey,
} from "@/lib/browse/views";
import {
  arrivalOrder,
  eventRecordHref,
  joinBrowseRows,
  sourceIdsOf,
  type EventArrivalRow,
} from "@/lib/browse/rows";

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
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("the view definition", () => {
  it("ships exactly one curated view", () => {
    // Spec §4 and the ticket: no whole-table browsing, no free-SQL runner, no
    // second curated view. Adding one is a design decision, not a build one.
    expect(BROWSE_VIEWS).toHaveLength(1);
    expect(BROWSE_VIEWS[0]).toBe(RECENT_EVENTS);
  });

  it("carries its query, the columns it may show, and its default sort", () => {
    expect(view.sort).toEqual({ field: "created_at", direction: "desc" });
    expect(view.window).toBeGreaterThan(0);
    expect(configuredKeys(view).length).toBeGreaterThan(0);
  });

  it("sorts on arrival, never on the scheduled date", () => {
    // ARCHITECTURE.md §11: "everything that came through the pipeline, newest
    // first" is events.created_at desc — arrival order, not the calendar.
    // starts_at is a column this view SHOWS and never its sort.
    expect(view.sort.field).toBe("created_at");
    expect(view.sort.direction).toBe("desc");
    expect(configuredKeys(view)).toContain("starts_at");
  });

  it("configures every spot-verification column the spec names", () => {
    // title, description, poster image, date, venue, and the sources behind
    // the row (contracts/admin-observability.md §4).
    for (const key of [
      "title",
      "description",
      "poster",
      "starts_at",
      "venue",
      "sources",
    ] as BrowseColumnKey[]) {
      expect(configuredKeys(view), key).toContain(key);
    }
  });

  it("gives every configured column a distinct key and a label", () => {
    const keys = configuredKeys(view);
    expect(new Set(keys).size).toBe(keys.length);
    for (const column of view.columns) {
      expect(column.label.trim().length, column.key).toBeGreaterThan(0);
    }
  });

  it("defaults to a non-empty subset of what it configures", () => {
    expect(view.defaultColumns.length).toBeGreaterThan(0);
    for (const key of view.defaultColumns) {
      expect(configuredKeys(view)).toContain(key);
    }
  });

  it("keeps its window inside the id-set chunk the joins are built on", () => {
    // The window's ids become one `.in(...)` per join leg; `ID_CHUNK` in
    // lib/db/gauges.ts is the size this codebase already decided is a safe
    // PostgREST URL. Going past it would need chunking that does not exist.
    expect(view.window).toBeLessThanOrEqual(100);
  });
});

describe("the columns the URL asks for", () => {
  it("shows the default set when the URL says nothing", () => {
    expect(shownColumns(view, undefined)).toEqual([...view.defaultColumns]);
    expect(shownColumns(view, "")).toEqual([...view.defaultColumns]);
    expect(shownColumns(view, "   ")).toEqual([...view.defaultColumns]);
  });

  it("shows exactly the configured columns the URL names", () => {
    expect(shownColumns(view, "venue,title")).toEqual(["title", "venue"]);
  });

  it("ignores anything the view does not configure", () => {
    // A hand-typed column can only ever select from what the view offers.
    expect(shownColumns(view, "title,ticket_url,venue_id,../../etc")).toEqual([
      "title",
    ]);
    expect(shownColumns(view, "not_a_column")).toEqual([
      ...view.defaultColumns,
    ]);
  });

  it("collapses duplicates and ignores the order the URL wrote", () => {
    expect(shownColumns(view, "venue,title,venue")).toEqual(
      shownColumns(view, "title,venue"),
    );
  });

  it("reads a repeated key the same as one comma-joined value", () => {
    expect(shownColumns(view, ["title", "venue"])).toEqual(["title", "venue"]);
  });
});

describe("the column selector", () => {
  it("offers exactly the view's configured set — every one, nothing else", () => {
    const offered = columnOptions(view, view.defaultColumns).map((o) => o.key);
    expect(offered).toEqual(configuredKeys(view));
  });

  it("offers the same set no matter which columns are currently shown", () => {
    for (const shown of [
      view.defaultColumns,
      ["title"] as BrowseColumnKey[],
      ["sources", "venue"] as BrowseColumnKey[],
    ]) {
      expect(columnOptions(view, shown).map((o) => o.key)).toEqual(
        configuredKeys(view),
      );
    }
  });

  it("marks exactly the shown columns as shown", () => {
    const shown: BrowseColumnKey[] = ["title", "sources"];
    const options = columnOptions(view, shown);
    for (const option of options) {
      expect(option.shown, option.key).toBe(shown.includes(option.key));
    }
  });

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

  it("toggles a hidden column back on, restoring the set it came from", () => {
    const before = shownColumns(view, undefined);
    const without = toggledColumns(view, before, "venue");
    expect(without).not.toContain("venue");
    expect(toggledColumns(view, without, "venue")).toEqual(before);
  });

  it("never offers a view with no columns in it", () => {
    // Toggling off the last one is a no-op: an empty `cols` value cannot be
    // told from an absent one, and a table with no columns is not a view.
    const only: BrowseColumnKey[] = ["title"];
    expect(toggledColumns(view, only, "title")).toEqual(only);
  });
});

describe("the selector's state in the URL", () => {
  const routePath = "/browse";
  const origin = "https://admin.invalid";

  it("round-trips a non-default set through the query string", () => {
    const chosen: BrowseColumnKey[] = ["title", "sources"];
    const url = new URL(columnsHref(view, routePath, chosen), origin);
    expect(url.pathname).toBe(routePath);
    expect(
      shownColumns(view, url.searchParams.get(COLUMNS_PARAM) ?? undefined),
    ).toEqual(chosen);
  });

  it("round-trips every single-column set the selector can reach", () => {
    for (const key of configuredKeys(view)) {
      const url = new URL(columnsHref(view, routePath, [key]), origin);
      expect(
        shownColumns(view, url.searchParams.get(COLUMNS_PARAM) ?? undefined),
        key,
      ).toEqual([key]);
    }
  });

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

  it("percent-encodes the value it puts in the URL", () => {
    const value = columnsParamValue(["title", "sources"]);
    expect(columnsHref(view, routePath, ["title", "sources"])).toBe(
      `${routePath}?${COLUMNS_PARAM}=${encodeURIComponent(value)}`,
    );
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

  it("ignores the scheduled date entirely", () => {
    // The event that STARTS soonest is the oldest arrival; arrival wins.
    // "soon" arrived FIRST and starts LAST; "later" arrived last and starts
    // first — so a sort on starts_at gives the opposite of the right answer.
    const soon = {
      ...at("soon", "2026-07-01T00:00:00Z"),
      starts_at: "2027-01-01T00:00:00Z",
    };
    const later = {
      ...at("later", "2026-09-01T00:00:00Z"),
      starts_at: "2026-09-05T00:00:00Z",
    };
    expect(arrivalOrder([soon, later]).map((r) => r.event_id)).toEqual([
      "later",
      "soon",
    ]);
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

  it("names the distinct sources behind a row, alphabetically", () => {
    const rows = joinBrowseRows({
      events: [event("e1")],
      venues: [],
      provenance: [
        { entity_id: "e1", source_id: "s2" },
        { entity_id: "e1", source_id: "s1" },
        { entity_id: "e1", source_id: "s1" },
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
      provenance: [{ entity_id: "e1", source_id: "s9" }],
      sources: [],
    });
    expect(rows[0].sources).toEqual(["s9"]);
  });

  it("attributes provenance to the row it belongs to and no other", () => {
    const rows = joinBrowseRows({
      events: [event("e1"), event("e2")],
      venues: [],
      provenance: [{ entity_id: "e1", source_id: "s1" }],
      sources: [{ source_id: "s1", source: "ticketmaster" }],
    });
    const byId = new Map(rows.map((r) => [r.event_id, r]));
    expect(byId.get("e1")?.sources).toEqual(["ticketmaster"]);
    expect(byId.get("e2")?.sources).toEqual([]);
  });

  it("still renders every event when no provenance came back at all", () => {
    const rows = joinBrowseRows({
      events: [event("e1"), event("e2")],
      venues: [{ event_id: "e1", venue_name: "The Forum" }],
      provenance: [],
      sources: [],
    });
    expect(rows.map((r) => r.event_id).sort()).toEqual(["e1", "e2"]);
    expect(rows.every((r) => r.sources.length === 0)).toBe(true);
  });

  it("fills the venue name from the listing and leaves it null without one", () => {
    const rows = joinBrowseRows({
      events: [event("e1"), event("e2")],
      venues: [{ event_id: "e1", venue_name: "The Forum" }],
      provenance: [],
      sources: [],
    });
    const byId = new Map(rows.map((r) => [r.event_id, r]));
    expect(byId.get("e1")?.venue_name).toBe("The Forum");
    expect(byId.get("e2")?.venue_name).toBeNull();
  });

  it("returns rows in arrival order", () => {
    const older = { ...event("old"), created_at: "2026-01-01T00:00:00Z" };
    const newer = { ...event("new"), created_at: "2026-09-01T00:00:00Z" };
    const rows = joinBrowseRows({
      events: [older, newer],
      venues: [],
      provenance: [],
      sources: [],
    });
    expect(rows.map((r) => r.event_id)).toEqual(["new", "old"]);
  });

  it("lists each source id once, in first-seen order", () => {
    expect(
      sourceIdsOf([
        { entity_id: "e1", source_id: "s2" },
        { entity_id: "e2", source_id: "s1" },
        { entity_id: "e3", source_id: "s2" },
      ]),
    ).toEqual(["s2", "s1"]);
  });
});

describe("the record link", () => {
  it("points an event row at its own record surface", () => {
    expect(eventRecordHref("2f0b-c11e")).toBe("/records/events/2f0b-c11e");
  });

  it("encodes an id that would otherwise change the path", () => {
    expect(eventRecordHref("a/b?c")).toBe("/records/events/a%2Fb%3Fc");
  });
});

describe("what Browse must NOT contain", () => {
  /** Every TypeScript source file under `src/`, as absolute paths. */
  function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mts)$/.test(entry.name)) found.push(full);
      }
    };
    walk(path.join(repoRoot, "src"));
    return found;
  }

  it("has no SQL-executing route and no whole-table browser", () => {
    // The ticket's own check, asserted here too so it survives a refactor of
    // the check list: no `select * from`, no rpc call, no execute_sql.
    const forbidden = new RegExp(
      ["select\\s+\\*\\s+from", "\\.rpc\\(", "execute_sql"].join("|"),
      "i",
    );
    const offenders = sourceFiles().filter((file) =>
      forbidden.test(fs.readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("defines its views in exactly one file", () => {
    const definition = new RegExp("BROWSE_VIEWS\\s*[:=]");
    const files = sourceFiles().filter((file) =>
      definition.test(fs.readFileSync(file, "utf8")),
    );
    expect(files.map((f) => path.relative(repoRoot, f))).toEqual([
      path.join("src", "lib", "browse", "views.ts"),
    ]);
  });
});
