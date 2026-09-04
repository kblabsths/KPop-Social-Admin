import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { EDITABLE_TABLES, EDIT_CONFIG } from "@/lib/edit/config";
import { T } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import {
  invalidUuidSyntax,
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
} from "../../fixtures/stub-client";

/**
 * The edit surface, rendered (campaign admin-window/TASK-0018).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so every test here is
 * `renderToStaticMarkup(await RecordPage(props))` — no jsdom, no Testing
 * Library, no database. `readRecord` is the real one; only the client under it
 * is a stub, so the page's four states are all reachable offline.
 *
 * These assert BEHAVIOUR — which fields draw an interactive control, which
 * draw none, which state renders, what a value renders as. The rendered words
 * and the class names belong to the walk, with one exception: the fixed
 * anatomy of the line (field, then value, then provenance) is the contract
 * LOOK_AND_FEEL states for this screen, so the column ORDER is asserted
 * positionally rather than by reading a header's copy.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/records", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/records")>();
  return {
    ...actual,
    readRecord: (config: Parameters<typeof actual.readRecord>[0], id: string) =>
      actual.readRecord(config, id, readWith.client as never),
    // The page's SECOND read (admin-window/TASK-0029). Both legs go through
    // the same stub, so a test scripts one client and gets both answers.
    readRecordProvenance: (
      config: Parameters<typeof actual.readRecordProvenance>[0],
      id: string,
    ) => actual.readRecordProvenance(config, id, readWith.client as never),
    // The page's THIRD read (admin-window/BUG-0034): the name of the record a
    // reference column points at. Through the same stub, so a leg left out of
    // a script is a failed read rather than a real one.
    readRecordReference: (
      config: Parameters<typeof actual.readRecordReference>[0],
      id: string,
      record: Parameters<typeof actual.readRecordReference>[2],
    ) =>
      actual.readRecordReference(config, id, record, readWith.client as never),
  };
});

const { default: RecordPage } = await import("@/app/records/[table]/[id]/page");

const IDS: Record<string, string> = {
  groups: "01920000-0000-7000-8000-0000000000a1",
  idols: "01920000-0000-7000-8000-0000000000a2",
  events: "01920000-0000-7000-8000-0000000000a3",
  venues: "01920000-0000-7000-8000-0000000000a4",
};

/**
 * A column that is NOT in the map and is not a key — scripted onto the row on
 * purpose. The page renders whatever the read hands it, so this line proves
 * the widget follows `decideEdit` and not "was the column in the row".
 */
const UNMAPPED_COLUMN = "spotify_id";

/** A row for `table`: its pk, every column the map carries, and one that isn't. */
function scriptedRecord(table: string): Record<string, unknown> {
  const config = EDIT_CONFIG[table];
  const row: Record<string, unknown> = { [config.pk]: IDS[table] };
  for (const column of [...config.editable, ...config.display]) {
    row[column] = `stored ${column}`;
  }
  // A number and an absence among the scalars, so both renderings are covered.
  if (config.editable.includes("member_count")) row.member_count = 4;
  if (config.editable.includes("korean_name")) row.korean_name = null;
  row[UNMAPPED_COLUMN] = "not in the map";
  return row;
}

/**
 * A COMPLETE read's response: the rows plus the exact count they claim. The
 * provenance leg refuses a count it did not get, so a scripted `data` alone is
 * a refusal rather than "no rows" (`readComplete`, ARCHITECTURE §4.3).
 */
function complete(rows: unknown[]) {
  return { data: rows, count: rows.length };
}

/** The venue name the listings view answers with, for the events record. */
const VENUE_NAME = "Olympic Hall";

/**
 * The default script: the record itself, a provenance log that answered and
 * holds nothing, and the listings view naming this event's venue. Every leg is
 * scripted because a resolver-owned table makes THREE reads now
 * (admin-window/TASK-0029, BUG-0034) and an unscripted table is a failed read,
 * not a quiet one.
 */
function defaultScript(table: string): Script {
  return {
    [table]: { data: scriptedRecord(table) },
    field_provenance: complete([]),
    sources: complete([]),
    event_listings: {
      data: { event_id: IDS.events, venue_name: VENUE_NAME },
    },
  };
}

async function renderRecord(
  table: string,
  script?: Script,
  id = IDS[table],
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  readWith.client = stubClient(script ?? defaultScript(table)).asSupabaseClient();
  return renderToStaticMarkup(
    await RecordPage({ params: Promise.resolve({ table, id }) }),
  );
}

/**
 * One rendered line of the surface. The anatomy is fixed for this screen:
 * cell 0 is the field, cell 1 its value, cell 2 its provenance.
 */
interface Line {
  name: string;
  /** Does the value cell offer an interactive control at all? */
  editable: boolean;
  value: string;
  /** Every route out of the value cell, in document order. */
  valueHrefs: (string | undefined)[];
  provenance: string;
  /** The absolute instant behind the relative age, if the line carries one. */
  provenanceTitle: string | undefined;
  /** Does the provenance cell render the app's absence marker? */
  provenanceAbsent: boolean;
}

function lines(markup: string): Line[] {
  const $ = cheerio.load(markup);
  return $("tbody tr")
    .toArray()
    .map((tr) => {
      const cells = $(tr).find("td");
      const value = cells.eq(1);
      const provenance = cells.eq(2);
      return {
        name: cells.eq(0).text().trim(),
        editable:
          value.find("button, input, textarea, select, [contenteditable]").length > 0,
        value: value.text().trim(),
        valueHrefs: value
          .find("a")
          .toArray()
          .map((anchor) => $(anchor).attr("href")),
        provenance: provenance.text().trim(),
        provenanceTitle: provenance.find("[title]").first().attr("title"),
        provenanceAbsent: provenance.find('[aria-label="no value"]').length > 0,
      };
    });
}

function lineFor(markup: string, name: string): Line {
  const found = lines(markup).find((line) => line.name === name);
  if (!found) throw new Error(`no line for ${name} in the rendered surface`);
  return found;
}

/** Every interactive control in the whole page, not just inside the table. */
function controlCount(markup: string): number {
  const $ = cheerio.load(markup);
  return $("button, input, textarea, select, [contenteditable]").length;
}

/* ── the widget follows the map, table by table ───────────────────────────── */

describe("which fields edit", () => {
  it("offers a control for every column the map carries, on both pre-cutover tables", async () => {
    for (const table of ["groups", "idols"]) {
      const markup = await renderRecord(table);
      const editable = EDIT_CONFIG[table].editable;
      expect(editable.length, table).toBeGreaterThan(0);
      for (const column of editable) {
        expect(lineFor(markup, column).editable, `${table}.${column}`).toBe(true);
      }
    }
  });

  it("offers none for a column absent from the map, though the row carries it", async () => {
    for (const table of ["groups", "idols"]) {
      const markup = await renderRecord(table);
      expect(lineFor(markup, UNMAPPED_COLUMN).editable, table).toBe(false);
      // ...and it is still SHOWN: read-only is not hidden.
      expect(lineFor(markup, UNMAPPED_COLUMN).value, table).toContain("not in the map");
    }
  });

  it("never offers a control for the primary key", async () => {
    for (const table of EDITABLE_TABLES) {
      const markup = await renderRecord(table);
      expect(lineFor(markup, EDIT_CONFIG[table].pk).editable, table).toBe(false);
    }
  });

  it("renders a resolver-owned table with no editable field anywhere on the page", async () => {
    for (const table of ["events", "venues"]) {
      expect(EDIT_CONFIG[table].regime, table).toBe("resolver_owned");
      const markup = await renderRecord(table);
      // Not "no enabled control" — no control at all: nothing to re-enable
      // from a console, and no button toward a write path that does not exist.
      expect(controlCount(markup), table).toBe(0);
    }
  });

  it("proves that negative is not vacuous: a pre-cutover table does draw controls", async () => {
    expect(controlCount(await renderRecord("groups"))).toBeGreaterThan(0);
  });

  it("edits through the EditableCell primitive, not a hand-rolled input", async () => {
    // The claim the ticket's `grep EditableCell src/app/records` gestures at,
    // asserted as behaviour instead of as text: the cell the page renders for
    // a mapped field is markup-identical to the primitive rendered directly.
    // A hand-rolled input — one that does not revert on Escape, or confirm, or
    // name its failure — reddens this.
    const { EditableCell } = await import("@/components/EditableCell");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const primitive = renderToStaticMarkup(
      createElement(EditableCell, {
        value: "stored name",
        onSave: async () => ({ ok: true }) as const,
        label: "name of groups",
      }),
    );
    expect(await renderRecord("groups")).toContain(primitive);
  });

  it("names the field in each control's accessible name", async () => {
    const markup = await renderRecord("groups");
    const $ = cheerio.load(markup);
    const labels = $("button[aria-label]")
      .toArray()
      .map((button) => $(button).attr("aria-label") ?? "");
    for (const column of EDIT_CONFIG.groups.editable) {
      expect(labels.some((label) => label.includes(column)), column).toBe(true);
    }
  });
});

/* ── the values on the line ───────────────────────────────────────────────── */

describe("what a line shows", () => {
  it("shows the stored value, including a number, as the database gave it", async () => {
    const markup = await renderRecord("groups");
    expect(lineFor(markup, "name").value).toContain("stored name");
    expect(lineFor(markup, "member_count").value).toContain("4");
  });

  it("shows an empty column as the absence, still editable", async () => {
    const line = lineFor(await renderRecord("groups"), "korean_name");
    expect(line.value).toContain(EM_DASH);
    // An unset column is how a value is first set: absence never hides a field.
    expect(line.editable).toBe(true);
  });

  it("draws a line for a mapped column the read returned nothing for", async () => {
    const config = EDIT_CONFIG.groups;
    const markup = await renderRecord("groups", {
      groups: { data: { [config.pk]: IDS.groups } },
    });
    for (const column of config.editable) {
      expect(lineFor(markup, column).value, column).toContain(EM_DASH);
    }
  });

  it("shows the record's id whatever the read did", async () => {
    const failed = await renderRecord("groups", {
      groups: { error: permissionDenied("groups") },
    });
    expect(failed).toContain(IDS.groups);
  });
});

/* ── the provenance slot ──────────────────────────────────────────────────── */

describe("the provenance slot", () => {
  it("stands on every line, and holds an absence on a pre-cutover table", async () => {
    // groups/idols carry no `field_provenance` row by construction, so there
    // is nothing to show — and nothing is invented into the slot. What may
    // eventually stand there is admin-window/TASK-0025, still unanswered.
    for (const table of ["groups", "idols"]) {
      const drawn = lines(await renderRecord(table));
      expect(drawn.length, table).toBeGreaterThan(0);
      for (const line of drawn) {
        expect(line.provenanceAbsent, `${table}.${line.name}`).toBe(true);
      }
    }
  });

  it("names no source, tier, apply time or lock state anywhere", async () => {
    const markup = await renderRecord("groups");
    for (const invented of [
      "ticketmaster",
      "bandsintown",
      "admin-set",
      "admin_locked",
      "official",
      "applied",
    ]) {
      expect(markup.toLowerCase(), invented).not.toContain(invented);
    }
  });
});

/* ── the four data-surface states, and the surfaces that do not exist ─────── */

describe("the states", () => {
  it("reports an absent table as not provisioned, naming it", async () => {
    const markup = await renderRecord("groups", {
      groups: { error: tableNotInSchemaCache("groups") },
    });
    expect(markup).toContain("groups");
    expect(controlCount(markup)).toBe(0);
  });

  it("reports a failed read in the database's own words", async () => {
    const markup = await renderRecord("groups", {
      groups: { error: permissionDenied("groups") },
    });
    expect(markup).toContain(permissionDenied("groups").message);
  });

  it("reports a table that holds no such row as its own state", async () => {
    const missingRow = await renderRecord("groups", { groups: { data: null } });
    const absentTable = await renderRecord("groups", {
      groups: { error: tableNotInSchemaCache("groups") },
    });
    // Three different states never share a rendering (LOOK_AND_FEEL).
    expect(missingRow).not.toBe(absentTable);
    expect(controlCount(missingRow)).toBe(0);
  });

  /**
   * The unknown-id state's own words, isolated from the rest of the page —
   * campaign admin-window/BUG-0052. There is exactly one empty card on this
   * screen, and it is the state under test.
   */
  function emptyText(markup: string): string {
    const $ = cheerio.load(markup);
    const cards = $('[data-state="empty"]');
    expect(cards.length).toBe(1);
    return cards.text().replace(/\s+/g, " ").trim();
  }

  /**
   * Just the "what fills it" half of that card — the last line of the state,
   * which is the sentence this ticket is about. Isolating it is what lets the
   * two regimes be compared without the id sentence (which names the table and
   * so always differs) making the comparison vacuous.
   */
  function emptyFiller(markup: string): string {
    const $ = cheerio.load(markup);
    return $('[data-state="empty"] p').last().text().replace(/\s+/g, " ").trim();
  }

  /** The unknown-id render: the row read answers, and holds nothing. */
  function missingRowScript(table: string): Script {
    return { ...defaultScript(table), [table]: { data: null } };
  }

  it("tells a pre-cutover operator the record is reached by id, naming no surface that could list it", async () => {
    for (const table of ["groups", "idols"]) {
      expect(EDIT_CONFIG[table].regime, table).toBe("pre_cutover");
      const text = emptyText(await renderRecord(table, missingRowScript(table)));
      // The bug: the state pointed at Browse, which is the recent-events view
      // and structurally cannot list a pre-cutover table (spec F7). No page of
      // this app can, so the state may name none of them.
      for (const item of NAV_ITEMS) {
        expect(text, `${table} names ${item.label}`).not.toContain(item.label);
      }
      // ...and it still says what fills the surface (Voice bar 4): the id.
      expect(text, table).toMatch(/\bid\b/i);
    }
  });

  it("keeps naming Browse for a resolver-owned table, which Browse does list", async () => {
    // The other fixture of the guard above: were the fix a blanket deletion,
    // this would go red — the empty state of a table Browse DOES lead to must
    // still send the operator there.
    const filler = emptyFiller(await renderRecord("events", missingRowScript("events")));
    expect(EDIT_CONFIG.events.regime).toBe("resolver_owned");
    expect(filler).toContain("Browse");
  });

  /**
   * A MISTYPED id is not a failed read — QA, campaign admin-window/BUG-0052.
   *
   * A pre-cutover record is reached "by its id alone", and the empty state
   * this ticket wrote tells the operator to check the id in the address bar.
   * Hand-carrying an id is therefore the sanctioned path, and mistyping one is
   * the error that path invites. Measured on a production build against
   * staging, 2026-09-03: `/records/groups/not-a-uuid` (and a uuid one
   * character short, and one with a trailing space) answers 200 with the
   * generic READ-FAILED state — the database's `invalid input syntax for type
   * uuid ... (22P02)` over the recovery line "Reload to try the read again".
   * Reloading cannot ever parse a malformed id, so the operator is stranded on
   * unactionable advice in the same moment BUG-0052 set out to rescue.
   *
   * A malformed id is a bad REQUEST, decidable without a database. Whatever
   * state answers it, it must not be the one that means "the database failed".
   */
  // Strict xfail (admin-window/BUG-0065): `it.fails` passes only while the
  // body throws, so the day a fix lands this test goes RED as an XPASS and
  // sends the reader to the ticket. The fixing builder deletes `.fails`.
  it.fails("does not report a mistyped id as a failed database read", async () => {
    const markup = await renderRecord(
      "groups",
      { ...defaultScript("groups"), groups: { error: invalidUuidSyntax("not-a-uuid") } },
      "not-a-uuid",
    );
    const $ = cheerio.load(markup);
    // Something answered for the request at all...
    expect($("[data-state]").length).toBeGreaterThan(0);
    // ...and it is not the failed-read state.
    expect($('[data-state="error"]').length).toBe(0);
  });

  it("says something different on each side of the cutover, from one map", async () => {
    const preCutover = emptyFiller(await renderRecord("groups", missingRowScript("groups")));
    const resolverOwned = emptyFiller(await renderRecord("events", missingRowScript("events")));
    expect(preCutover).not.toBe(resolverOwned);
  });

  /**
   * Table names that must NOT reach a record page. The segment is attacker-
   * controlled on an internet-reachable surface, so the map lookup is a gate
   * and gets attacked as one: a real table Admin may never touch, the same
   * name in another case, a traversal attempt, and the four keys every plain
   * JavaScript object answers to. A lookup written `table in EDIT_CONFIG`
   * would hand `Object.prototype`'s keys an `undefined` config and render a
   * page — or throw — for each of the last four.
   */
  const NOT_ON_THE_MAP = [
    "scraped_events",
    "event_listings",
    "Groups",
    "GROUPS",
    "groups ",
    "../groups",
    "groups/../events",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "",
  ];

  it.each(NOT_ON_THE_MAP)(
    "has no record page for %o, a table the map does not carry",
    async (table) => {
      readWith.client = stubClient({}).asSupabaseClient();
      // `notFound()` throws NEXT_HTTP_ERROR_FALLBACK;404 and terminates the
      // segment (Next 16, `04-functions/not-found.md`) — the page's twin of the
      // route's 404 for the same table.
      await expect(
        RecordPage({ params: Promise.resolve({ table, id: IDS.groups }) }),
      ).rejects.toThrow(/404/);
    },
  );

  it("renders exactly one h1 per record page", async () => {
    for (const table of EDITABLE_TABLES) {
      const markup = await renderRecord(table);
      expect([...markup.matchAll(/<h1[\s>]/g)].length, table).toBe(1);
    }
  });
});

/* ── the resolver-owned surface: what it displays, and its provenance ─────── */

/**
 * Campaign admin-window/TASK-0029, from Ben's ruling of 2026-09-02: a
 * resolver-owned record page shows the columns an operator came to see,
 * read-only, with per-field provenance beside each. Before it, `/records/
 * events/<id>` — the link every Browse row carries — rendered `event_id` and
 * nothing else.
 */
describe("a resolver-owned record", () => {
  const TICKETMASTER = "01920000-0000-7000-8000-000000000101";

  /** One decision row, with only the columns this surface reads. */
  function decided(overrides: Record<string, unknown> = {}) {
    return {
      provenance_id: "01920000-0000-7000-8000-000000000401",
      entity_id: IDS.events,
      field: "title",
      source_id: TICKETMASTER,
      applied_at: "2026-08-30T04:12:00Z",
      admin_locked: false,
      ...overrides,
    };
  }

  function withProvenance(rows: unknown[], sources: unknown[] = []): Script {
    return {
      events: { data: scriptedRecord("events") },
      field_provenance: complete(rows),
      sources: complete(sources),
    };
  }

  it("draws a line per displayed column, with the value the read returned", async () => {
    for (const table of ["events", "venues"]) {
      const markup = await renderRecord(table);
      const display = EDIT_CONFIG[table].display;
      expect(display.length, table).toBeGreaterThan(0);
      for (const column of display) {
        expect(lineFor(markup, column).value, `${table}.${column}`).toContain(
          `stored ${column}`,
        );
      }
    }
  });

  it("stops the Browse link dead-ending: the page shows more than the id", async () => {
    // The record href is the primary navigation target from the app's main
    // list screen; a page holding only the id the operator clicked told them
    // nothing they did not already have.
    const drawn = lines(await renderRecord("events"));
    expect(drawn.map((line) => line.name)).not.toEqual(["event_id"]);
    expect(drawn.length).toBeGreaterThan(1);
  });

  it("offers no control on any of them, however the map lists them", async () => {
    for (const table of ["events", "venues"]) {
      const markup = await renderRecord(table);
      // Not "no enabled control" — none at all: `display` is the read-only
      // half of the map and cannot become writable by being listed.
      expect(controlCount(markup), table).toBe(0);
      for (const column of EDIT_CONFIG[table].display) {
        expect(lineFor(markup, column).editable, `${table}.${column}`).toBe(false);
      }
    }
  });

  it("shows a displayed column the read returned nothing for as the absence", async () => {
    const markup = await renderRecord("events", {
      events: { data: { event_id: IDS.events } },
      field_provenance: complete([]),
      sources: complete([]),
    });
    for (const column of EDIT_CONFIG.events.display) {
      expect(lineFor(markup, column).value, column).toContain(EM_DASH);
    }
  });

  it("names the source and the age of the value beside the field", async () => {
    const markup = await renderRecord(
      "events",
      withProvenance(
        [decided()],
        [{ source_id: TICKETMASTER, source: "ticketmaster" }],
      ),
    );
    const title = lineFor(markup, "title");
    expect(title.provenance).toContain("ticketmaster");
    expect(title.provenance).toContain("applied");
    // Relative on screen, absolute on hover (LOOK_AND_FEEL, Voice bar 6).
    expect(title.provenance).toMatch(/\b(just now|\d+[mhd] ago)\b/);
    expect(title.provenanceTitle).toContain("2026-08-30");
  });

  it("names the admin, not a source, on a fact a human pinned", async () => {
    const markup = await renderRecord(
      "events",
      withProvenance(
        [decided({ admin_locked: true })],
        [{ source_id: TICKETMASTER, source: "ticketmaster" }],
      ),
    );
    const provenance = lineFor(markup, "title").provenance;
    expect(provenance).toContain("admin-set");
    expect(provenance).not.toContain("ticketmaster");
  });

  it("says a fact whose current decision is a verdict unset names no source", async () => {
    const markup = await renderRecord(
      "events",
      withProvenance([decided({ source_id: null })]),
    );
    const provenance = lineFor(markup, "title").provenance;
    expect(provenance).not.toContain(EM_DASH);
    expect(provenance.length).toBeGreaterThan(0);
  });

  it("reports the latest decision per fact, never a superseded source", async () => {
    const markup = await renderRecord(
      "events",
      withProvenance(
        [
          decided({
            provenance_id: "01920000-0000-7000-8000-0000000004a1",
            applied_at: "2026-07-01T00:00:00Z",
            source_id: "01920000-0000-7000-8000-000000000102",
          }),
          decided({
            provenance_id: "01920000-0000-7000-8000-0000000004a2",
            applied_at: "2026-08-30T04:12:00Z",
          }),
        ],
        [
          { source_id: TICKETMASTER, source: "ticketmaster" },
          { source_id: "01920000-0000-7000-8000-000000000102", source: "bandsintown" },
        ],
      ),
    );
    const provenance = lineFor(markup, "title").provenance;
    expect(provenance).toContain("ticketmaster");
    expect(provenance).not.toContain("bandsintown");
  });

  it("does not call a fact admin-set on a lock the log has already superseded", async () => {
    // `admin_locked` is read off the CURRENT decision, and the reduction runs
    // first. A fact a human pinned once and the resolver has since re-decided
    // answers to the source that holds it now — reading the lock off any row
    // of the history would pin it forever.
    const markup = await renderRecord(
      "events",
      withProvenance(
        [
          decided({
            provenance_id: "01920000-0000-7000-8000-0000000004b1",
            applied_at: "2026-07-01T00:00:00Z",
            admin_locked: true,
          }),
          decided({
            provenance_id: "01920000-0000-7000-8000-0000000004b2",
            applied_at: "2026-08-30T04:12:00Z",
            source_id: "01920000-0000-7000-8000-000000000102",
          }),
        ],
        [
          { source_id: TICKETMASTER, source: "ticketmaster" },
          { source_id: "01920000-0000-7000-8000-000000000102", source: "bandsintown" },
        ],
      ),
    );
    const provenance = lineFor(markup, "title").provenance;
    expect(provenance).toContain("bandsintown");
    expect(provenance).not.toContain("admin-set");
  });

  /**
   * **BUG-0034 (admin-window), fixed.** Ben's ruling names `venue` among the
   * columns "an operator came to see"; the map resolves it to `events.venue_id`
   * because that is the only venue-bearing column of the table, and the page
   * drew a bare uuid the operator could neither read nor follow — strictly
   * LESS than the `venue_name` the Browse row they clicked already showed
   * them. QA pinned this as a strict `it.fails` xfail; the link landed, so it
   * is an ordinary assertion now, and its shape is deliberately unchanged.
   */
  it("reaches the venue record page from an event's venue line", async () => {
    const venueId = IDS.venues;
    const markup = await renderRecord("events", {
      events: { data: { ...scriptedRecord("events"), venue_id: venueId } },
      field_provenance: complete([]),
      sources: complete([]),
      event_listings: { data: { event_id: IDS.events, venue_name: VENUE_NAME } },
    });
    const hrefs = cheerio
      .load(markup)("a")
      .toArray()
      .map((anchor) => cheerio.load(markup)(anchor).attr("href"));
    expect(hrefs, `hrefs seen: ${JSON.stringify(hrefs)}`).toContain(
      `/records/venues/${venueId}`,
    );
  });

  /** An events record whose venue line carries `venueId`. */
  function eventWithVenue(venueId: string | null, script: Script = {}): Script {
    return {
      events: { data: { ...scriptedRecord("events"), venue_id: venueId } },
      field_provenance: complete([]),
      sources: complete([]),
      ...script,
    };
  }

  it("shows the venue's name, and its id, on the line that links to it", async () => {
    const venueId = IDS.venues;
    const markup = await renderRecord(
      "events",
      eventWithVenue(venueId, {
        event_listings: { data: { event_id: IDS.events, venue_name: VENUE_NAME } },
      }),
    );
    const line = lineFor(markup, "venue_id");
    // The name Browse showed on the row the operator clicked — the record page
    // must not be less informative than the row that linked to it...
    expect(line.value).toContain(VENUE_NAME);
    // ...and the id stays on screen: it is the machine's word for the row.
    expect(line.value).toContain(venueId);
    expect(line.valueHrefs).toEqual([`/records/venues/${venueId}`]);
    // A route out is not a write path: the line still offers no control.
    expect(line.editable).toBe(false);
  });

  it("resolves that name from the same view Browse reads, keyed by the event", async () => {
    const db = stubClient(
      eventWithVenue(IDS.venues, {
        event_listings: { data: { event_id: IDS.events, venue_name: VENUE_NAME } },
      }),
    );
    readWith.client = db.asSupabaseClient();
    const { renderToStaticMarkup } = await import("react-dom/server");
    renderToStaticMarkup(
      await RecordPage({
        params: Promise.resolve({ table: "events", id: IDS.events }),
      }),
    );
    // Two names shown differently for the same venue is the bug this ticket is
    // about, so the leg is the listings view, addressed by the event's own key.
    const listings = db.calls.find((call) => call.table === "event_listings");
    expect(listings, `tables read: ${db.tablesRead().join(", ")}`).toBeDefined();
    expect(listings?.steps.find((step) => step.method === "eq")?.args).toEqual([
      "event_id",
      IDS.events,
    ]);
  });

  it("still links the venue when the listings view is absent, and says so", async () => {
    const venueId = IDS.venues;
    const markup = await renderRecord(
      "events",
      eventWithVenue(venueId, {
        event_listings: { error: tableNotInSchemaCache("event_listings") },
      }),
    );
    const line = lineFor(markup, "venue_id");
    // The name is what the failed leg cost; the way through is not.
    expect(line.valueHrefs).toEqual([`/records/venues/${venueId}`]);
    expect(line.value).toContain(venueId);
    expect(line.value).not.toContain(VENUE_NAME);
    // The leg answers for itself, naming the view, and every other value stays.
    expect(markup).toContain("event_listings");
    expect(lineFor(markup, "title").value).toContain("stored title");
    expect(controlCount(markup)).toBe(0);
  });

  it("still links the venue when the name read is refused", async () => {
    const failure = permissionDenied("event_listings");
    const markup = await renderRecord(
      "events",
      eventWithVenue(IDS.venues, { event_listings: { error: failure } }),
    );
    expect(lineFor(markup, "venue_id").valueHrefs).toEqual([
      `/records/venues/${IDS.venues}`,
    ]);
    expect(markup).toContain(failure.message);
  });

  it("links the id itself when the view answered and named no venue", async () => {
    // A row the view knows nothing about, and a null name: both are "no name",
    // and neither is a reason to strand the operator on a uuid.
    for (const scripted of [
      { data: null },
      { data: { event_id: IDS.events, venue_name: null } },
    ]) {
      const markup = await renderRecord(
        "events",
        eventWithVenue(IDS.venues, { event_listings: scripted }),
      );
      const line = lineFor(markup, "venue_id");
      expect(line.valueHrefs).toEqual([`/records/venues/${IDS.venues}`]);
      expect(line.value).toContain(IDS.venues);
      // Nothing failed, so nothing is reported.
      expect(markup).not.toContain("event_listings");
    }
  });

  it("draws an event with no venue as the absence, and reads no view for it", async () => {
    const db = stubClient(eventWithVenue(null));
    readWith.client = db.asSupabaseClient();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const markup = renderToStaticMarkup(
      await RecordPage({
        params: Promise.resolve({ table: "events", id: IDS.events }),
      }),
    );
    const line = lineFor(markup, "venue_id");
    expect(line.value).toContain(EM_DASH);
    expect(line.valueHrefs).toEqual([]);
    // There is no linked row to name, so there is no round trip and no card.
    expect(db.tablesRead()).not.toContain("event_listings");
    expect(markup).not.toContain("event_listings");
  });

  it("makes no name read for a table the map gives no reference", async () => {
    for (const table of ["venues", "groups", "idols"]) {
      expect(EDIT_CONFIG[table].reference, table).toBeNull();
      const db = stubClient({
        [table]: { data: scriptedRecord(table) },
        field_provenance: complete([]),
        sources: complete([]),
      });
      readWith.client = db.asSupabaseClient();
      const { renderToStaticMarkup } = await import("react-dom/server");
      const markup = renderToStaticMarkup(
        await RecordPage({ params: Promise.resolve({ table, id: IDS[table] }) }),
      );
      expect(db.tablesRead(), table).not.toContain("event_listings");
      // ...and no line of theirs pretends to lead anywhere.
      for (const line of lines(markup)) {
        expect(line.valueHrefs, `${table}.${line.name}`).toEqual([]);
      }
    }
  });

  it("keeps the venue line's provenance coming from field_provenance", async () => {
    // A reference field is still a field: the link says where the value POINTS,
    // and `field_provenance` on `venue_id` still says who decided it.
    const markup = await renderRecord("events", {
      ...eventWithVenue(IDS.venues, {
        event_listings: { data: { event_id: IDS.events, venue_name: VENUE_NAME } },
      }),
      field_provenance: complete([
        decided({
          provenance_id: "01920000-0000-7000-8000-0000000004c1",
          field: "venue_id",
        }),
      ]),
      sources: complete([{ source_id: TICKETMASTER, source: "ticketmaster" }]),
    });
    const line = lineFor(markup, "venue_id");
    expect(line.provenance).toContain("ticketmaster");
    expect(line.provenanceAbsent).toBe(false);
    expect(line.valueHrefs).toEqual([`/records/venues/${IDS.venues}`]);
  });

  it("leaves a field the log says nothing about as the absence", async () => {
    const markup = await renderRecord(
      "events",
      withProvenance(
        [decided()],
        [{ source_id: TICKETMASTER, source: "ticketmaster" }],
      ),
    );
    // Not a blank and not a zero — the app's one absence marker.
    expect(lineFor(markup, "description").provenanceAbsent).toBe(true);
    expect(lineFor(markup, "venue_id").provenanceAbsent).toBe(true);
  });

  it("keeps every value on screen when the provenance table is absent", async () => {
    const markup = await renderRecord("events", {
      events: { data: scriptedRecord("events") },
      field_provenance: { error: tableNotInSchemaCache("field_provenance") },
    });
    // The values leg answered, so the record still renders in full...
    for (const column of EDIT_CONFIG.events.display) {
      expect(lineFor(markup, column).value, column).toContain(`stored ${column}`);
      expect(lineFor(markup, column).provenanceAbsent, column).toBe(true);
    }
    // ...and the provenance leg says for itself what is missing, by name.
    expect(markup).toContain("field_provenance");
    expect(controlCount(markup)).toBe(0);
  });

  it("keeps every value on screen when the provenance read is refused", async () => {
    const failure = permissionDenied("field_provenance");
    const markup = await renderRecord("events", {
      events: { data: scriptedRecord("events") },
      field_provenance: { error: failure },
    });
    expect(lineFor(markup, "title").value).toContain("stored title");
    // A failed read is reported in the database's own words, naming the read.
    expect(markup).toContain(failure.message);
    expect(markup).toContain("field_provenance");
  });

  it("tells an absent provenance table apart from a provenance table holding nothing", async () => {
    const absent = await renderRecord("events", {
      events: { data: scriptedRecord("events") },
      field_provenance: { error: tableNotInSchemaCache("field_provenance") },
    });
    const empty = await renderRecord("events");
    expect(absent).not.toBe(empty);
    // The empty case reports nothing at all: there is no failure to report.
    expect(empty).not.toContain("field_provenance");
  });

  it("still reports a failed VALUE read without a provenance line in its place", async () => {
    const markup = await renderRecord("events", {
      events: { error: permissionDenied("events") },
      field_provenance: complete([]),
      sources: complete([]),
    });
    expect(markup).toContain(IDS.events);
    expect(lines(markup)).toEqual([]);
  });

  it("makes no provenance read for a pre-cutover table", async () => {
    // `field_provenance` carries rows for resolver-owned entities; groups and
    // idols are unprovenanced by construction, and the page says so once in
    // words rather than reading a log that could only answer "no rows".
    for (const table of ["groups", "idols"]) {
      const db = stubClient({ [table]: { data: scriptedRecord(table) } });
      readWith.client = db.asSupabaseClient();
      const { renderToStaticMarkup } = await import("react-dom/server");
      renderToStaticMarkup(
        await RecordPage({ params: Promise.resolve({ table, id: IDS[table] }) }),
      );
      expect(db.tablesRead(), table).toEqual([table]);
    }
  });
  /* ── the legend that says what an empty provenance cell means ──────────── */

  /**
   * Campaign admin-window/BUG-0053: a resolver-owned record drew a whole
   * PROVENANCE column of the app's absence marker with no line anywhere
   * saying what one means, while the pre-cutover branch of the same page
   * explained its own. Both document-blind user-sims hit it independently.
   *
   * These assert the legend as BEHAVIOUR rather than as a sentence: how many
   * times it is said, where it stands, that it does not vary with the record's
   * data (a legend, not a verdict the rows could contradict), that the dash it
   * explains is untouched, and which states own the explanation instead. The
   * only literals are the app's own em dash and the table name from the one
   * registry — both read from the source of truth, so a change to either moves
   * copy and test together.
   */
  describe("the legend under the table", () => {
    /** Every rendering of the legend on the page, whitespace-normalised. */
    function legend(markup: string): string[] {
      const $ = cheerio.load(markup);
      return $('[data-note="provenance-absence"]')
        .toArray()
        .map((node) => $(node).text().replace(/\s+/g, " ").trim());
    }

    /** A provenance row per displayed column — the most-sourced record there is. */
    function everyDisplayColumnSourced(): Script {
      return withProvenance(
        EDIT_CONFIG.events.display.map((field, index) =>
          decided({
            field,
            provenance_id: `01920000-0000-7000-8000-00000000050${index}`,
          }),
        ),
        [{ source_id: TICKETMASTER, source: "ticketmaster" }],
      );
    }

    it("says once what an empty provenance cell means, and leaves the dash alone", async () => {
      const markup = await renderRecord("events");
      const said = legend(markup);
      // Once per record — never per row (Ben's ruling on TASK-0025).
      expect(said.length).toBe(1);
      // It explains the app's own absence marker, read from the one place
      // that character is spelled, so copy and marker cannot drift apart.
      expect(said[0]).toContain(EM_DASH);
      // ...and it is a sentence, not a bare glyph repeated above the table.
      expect(said[0].length).toBeGreaterThan(40);
      // The table name is this page's signal that a LEG FAILED (`LegNote`
      // prints it); the ordinary case must not borrow that signal.
      expect(said[0]).not.toContain(T.fieldProvenance);

      // ...and the table is still the OK state: rows, each with the dash.
      const drawn = lines(markup);
      expect(drawn.length).toBeGreaterThan(1);
      for (const line of drawn) {
        expect(line.provenanceAbsent, line.name).toBe(true);
      }
    });

    it("stands above the table, never inside a row", async () => {
      const $ = cheerio.load(await renderRecord("events"));
      expect($('[data-note="provenance-absence"]').length).toBe(1);
      expect($('tbody [data-note="provenance-absence"]').length).toBe(0);
      expect($('td [data-note="provenance-absence"]').length).toBe(0);
    });

    it("reads the same however much of the record is sourced", async () => {
      // A legend describes the COLUMN. One that varied with the data would be
      // a claim about this record — and on the partly-sourced record below it
      // would be a false one ("nothing here is traceable" beside a line that
      // names ticketmaster).
      const none = await renderRecord("events");
      const some = await renderRecord(
        "events",
        withProvenance(
          [decided()],
          [{ source_id: TICKETMASTER, source: "ticketmaster" }],
        ),
      );
      const most = await renderRecord("events", everyDisplayColumnSourced());
      expect(legend(some)).toEqual(legend(none));
      expect(legend(most)).toEqual(legend(none));
    });

    it("stands beside real provenance without denying it", async () => {
      // The contrast case the user-sim opened second: some fields sourced,
      // some not, on one record.
      const markup = await renderRecord(
        "events",
        withProvenance(
          [decided()],
          [{ source_id: TICKETMASTER, source: "ticketmaster" }],
        ),
      );
      expect(legend(markup).length).toBe(1);
      const sourced = lineFor(markup, "title");
      expect(sourced.provenanceAbsent).toBe(false);
      expect(sourced.provenance).toContain("ticketmaster");
      expect(lineFor(markup, "description").provenanceAbsent).toBe(true);
    });

    it("still has dashes to explain on the most-sourced record possible", async () => {
      // Not a vacuous legend even at full coverage: the primary key and any
      // column outside the map carry no decision and never will.
      const markup = await renderRecord("events", everyDisplayColumnSourced());
      expect(lineFor(markup, EDIT_CONFIG.events.pk).provenanceAbsent).toBe(true);
      expect(lineFor(markup, UNMAPPED_COLUMN).provenanceAbsent).toBe(true);
    });

    it("says nothing on a pre-cutover record, whose regime note already explains it", async () => {
      // The other fixture of the guard above, and the asymmetry the ticket is
      // about: the branch that needed no legend is not given a second one.
      for (const table of ["groups", "idols"]) {
        expect(EDIT_CONFIG[table].regime, table).toBe("pre_cutover");
        expect(legend(await renderRecord(table)), table).toEqual([]);
      }
    });

    it("leaves a provenance leg that failed to explain its own dashes", async () => {
      // Same column of dashes, a completely different reason — and the leg
      // says that reason in the database's own words. Claiming "no row stands
      // behind this value" over a read that never happened would be a lie.
      const absent = await renderRecord("events", {
        events: { data: scriptedRecord("events") },
        field_provenance: { error: tableNotInSchemaCache(T.fieldProvenance) },
      });
      expect(legend(absent)).toEqual([]);
      expect(cheerio.load(absent)('[data-state="not_provisioned"]').length)
        .toBeGreaterThan(0);

      const refused = await renderRecord("events", {
        events: { data: scriptedRecord("events") },
        field_provenance: { error: permissionDenied(T.fieldProvenance) },
      });
      expect(legend(refused)).toEqual([]);
      expect(cheerio.load(refused)('[data-state="error"]').length).toBeGreaterThan(0);
    });

    it("says nothing when there is no field table to read", async () => {
      // The unknown-id state draws no PROVENANCE column, so there is no dash
      // on screen for a legend to be about.
      const markup = await renderRecord("events", {
        ...defaultScript("events"),
        events: { data: null },
      });
      expect(lines(markup)).toEqual([]);
      expect(legend(markup)).toEqual([]);
    });
  });
});
