import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { NAV_ITEMS, isNavItemActive } from "@/components/shell/nav-items";
import { EDITABLE_TABLES, EDIT_CONFIG, mappedColumns } from "@/lib/edit/config";
import { T } from "@/lib/db/tables";
import { EM_DASH, isAbsent } from "@/lib/format";
import { isRecordId } from "@/lib/db/records";
import {
  invalidUuidSyntax,
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  type Script,
  type StubClient,
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
    // The page's FIFTH read (admin-window/TASK-0055): the rows a reference
    // field may be pointed at. Through the same stub, so a script that leaves
    // `venues` out is a FAILED leg — which draws the read-only link — rather
    // than a real read of a real database.
    readReferenceChoices: (
      config: Parameters<typeof actual.readReferenceChoices>[0],
    ) => actual.readReferenceChoices(config, readWith.client as never),
  };
});

// The page's FOURTH leg (campaign admin-window/TASK-0054): may the override
// path be offered at all? Through the same stub, so a test scripts one client
// and gets every answer — and so an unscripted readiness is a failed read
// rather than a quiet "yes".
vi.mock("@/lib/db/verdict", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/verdict")>();
  return {
    ...actual,
    readSettlementReadiness: () =>
      actual.readSettlementReadiness(readWith.client as never),
  };
});

const { default: RecordPage } = await import("@/app/records/[table]/[id]/page");

/**
 * One well-formed uuid per mapped table — every loop over `EDITABLE_TABLES`
 * takes its address from here, so a table entering the map without an id
 * reaches the page with `undefined` and the loop reports it.
 *
 * `walk_sandbox` is keyed by a uuid like the rest (architect, 2026-09-04,
 * ARCHITECTURE §9.1 item 9): `isRecordId` gates every record page BEFORE any
 * read, so a non-uuid key would draw the not-an-id card at the sandbox's own
 * address and neither state this entry owes would ever be reachable. Its value
 * is the FIRST SEEDED row of the staging fixture, so the address the offline
 * suite renders and the address a walker types are one string.
 *
 * That the unknown-id loop below also uses it is not a contradiction: the row's
 * existence is decided by the scripted read (`missingRowScript` answers
 * `data: null`), exactly as it is for the other four, whose ids stand for no
 * row in any database either.
 */
const IDS: Record<string, string> = {
  events: "01920000-0000-7000-8000-0000000000a3",
  venues: "01920000-0000-7000-8000-0000000000a4",
  walk_sandbox: "00000000-0000-4000-8000-000000000001",
};

/**
 * A well-formed id to ask an UNMAPPED table for. It belongs to no entry in the
 * map by construction — every table the map carries takes its address from
 * `IDS` above — which is what the not-on-the-map loop needs: the refusal must
 * be about the TABLE, and an id that looks wrong would prove nothing.
 */
const OFF_MAP_ID = "01920000-0000-7000-8000-0000000000a1";

/**
 * The one table left with a direct write path (`sandbox`, ARCHITECTURE §9).
 *
 * `groups` and `idols` stood here until Ben struck the direct catalog edit on
 * 2026-09-08 and they left the map with it, so every assertion about a drawn
 * CONTROL now has exactly one subject. The assertions that used to run over
 * the two of them are unchanged in what they claim; only their subject moved,
 * and the struck pair is asserted absent in `NOT_ON_THE_MAP` below.
 */
const DIRECT_WRITE_TABLE = "walk_sandbox";

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
  if (config.editable.includes("tally")) row.tally = 4;
  if (config.editable.includes("note")) row.note = null;
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

/**
 * The stub the LAST `renderRecord` rendered against, so a test can ask what
 * the page actually read — including the answer "nothing at all", which is
 * what a request the page can settle without a database looks like from here
 * (admin-window/BUG-0065).
 */
let lastStub: StubClient | null = null;

/**
 * The readiness leg's answer when a test does not say: the settlement table is
 * THERE, so the override path is open and a mapped column draws its cell.
 *
 * Spread FIRST below, so a script naming it wins — the absent case is the one
 * this milestone is graded on first, and it is scripted explicitly wherever it
 * is asserted (`OVERRIDE_ABSENT`).
 */
const OVERRIDE_READY: Script = { verdicts: { data: [] } };

/** The graded normal case: the object that records an override is not there. */
const OVERRIDE_ABSENT: Script = {
  verdicts: { error: tableNotInSchemaCache("verdicts") },
};

/**
 * The rows the entity picker's window read comes back with — the `venues` a
 * reference field may be pointed at (campaign admin-window/TASK-0055).
 *
 * A row with a NULL name is in here on purpose: it exists, so it is offered,
 * and its label is the app's absence marker (LESSONS 1). Scripted for every
 * render below rather than per test, so the picker is actually reachable
 * wherever the override path is open — an unscripted `venues` reads as a
 * FAILED leg, which draws the read-only link and would leave every assertion
 * about the picker passing against a page that never drew one.
 *
 * The `venues` record page overrides this with its own row: it has no
 * reference, so it makes no choices read at all.
 */
const VENUE_CHOICES: Script = {
  venues: {
    data: [
      { venue_id: "01920000-0000-7000-8000-0000000000a4", name: "Olympic Hall" },
      { venue_id: "01920000-0000-7000-8000-0000000000b1", name: "Gocheok Sky Dome" },
      { venue_id: "01920000-0000-7000-8000-0000000000b2", name: null },
    ],
  },
};

async function renderRecord(
  table: string,
  script?: Script,
  id = IDS[table],
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const stub = stubClient({
    ...OVERRIDE_READY,
    ...VENUE_CHOICES,
    ...(script ?? defaultScript(table)),
  });
  lastStub = stub;
  readWith.client = stub.asSupabaseClient();
  return renderToStaticMarkup(
    await RecordPage({ params: Promise.resolve({ table, id }) }),
  );
}

/** The tables the last render queried, in order. */
function tablesRead(): string[] {
  if (lastStub === null) throw new Error("nothing has been rendered yet");
  return lastStub.tablesRead();
}

/**
 * One rendered line of the surface. The anatomy is fixed for this screen:
 * cell 0 is the field, cell 1 its value, cell 2 its provenance.
 */
interface Line {
  name: string;
  /** Does the value cell offer an interactive control at all? */
  editable: boolean;
  /**
   * WHICH widget it offers, when the widget names itself: `picker` for the
   * entity picker (admin-window/TASK-0055), `undefined` for the click-to-edit
   * cell and for a line with no control. "A control" and "a text cell" are
   * different claims, and `editable` alone cannot tell them apart.
   */
  widget: string | undefined;
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
        widget: value.find("[data-widget]").first().attr("data-widget"),
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

/* ── the addresses every loop below renders at ────────────────────────────── */

describe("the id fixture", () => {
  it("carries a well-formed uuid for every table in the map", () => {
    // Without this, a table entering `EDIT_CONFIG` without an `IDS` entry
    // renders at `undefined` — which `isRecordId` refuses before any read, so
    // the loops below would go on passing against the not-an-id card instead
    // of against the record they mean to assert on (LESSONS 3: a loop that
    // never saw the input it is about passes vacuously).
    for (const table of EDITABLE_TABLES) {
      expect(IDS[table], `${table} has no address in the fixture`).toBeTypeOf(
        "string",
      );
      expect(IDS[table], table).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      // ...and the grammar that matters is the PAGE's own gate, not the
      // canonical spelling above: `isRecordId` is what every render below
      // passes through before a read is issued (`lib/db/records.ts`), and it
      // is the exact predicate the sandbox's key ruling turned on (architect,
      // 2026-09-04, §9.1 item 9 — `walk-1` failed it, so neither state the
      // sandbox owes was reachable at its own address). Asserting the regex
      // alone would leave the loops passing against a fixture the page
      // refuses, which is the vacuity this describe exists to prevent
      // (QA, admin-window/TASK-0035).
      expect(isRecordId(IDS[table]), `${table}'s address is one the record page refuses before it reads`).toBe(true);
    }
    // The negative fixture, and the measured one: `walk-1` — the sandbox's
    // key before the ruling — is what this gate refuses, which is why the
    // assertion above is not vacuous.
    expect(isRecordId("walk-1")).toBe(false);
  });
});

/* ── the widget follows the map, table by table ───────────────────────────── */

describe("which fields edit", () => {
  it("offers a control for every column the map carries, on the directly-written table", async () => {
    const table = DIRECT_WRITE_TABLE;
    const markup = await renderRecord(table);
    const editable = EDIT_CONFIG[table].editable;
    expect(editable.length, table).toBeGreaterThan(0);
    for (const column of editable) {
      expect(lineFor(markup, column).editable, `${table}.${column}`).toBe(true);
    }
  });

  it("offers none for a column absent from the map, though the row carries it", async () => {
    const table = DIRECT_WRITE_TABLE;
    const markup = await renderRecord(table);
    expect(lineFor(markup, UNMAPPED_COLUMN).editable, table).toBe(false);
    // ...and it is still SHOWN: read-only is not hidden.
    expect(lineFor(markup, UNMAPPED_COLUMN).value, table).toContain("not in the map");
  });

  it("never offers a control for the primary key", async () => {
    for (const table of EDITABLE_TABLES) {
      const markup = await renderRecord(table);
      expect(lineFor(markup, EDIT_CONFIG[table].pk).editable, table).toBe(false);
    }
  });

  it("renders a resolver-owned table read-only when the override path is absent", async () => {
    // THE graded normal case (FEAT-0011 criterion 2): with nothing to record
    // an override, `events` and `venues` render exactly the read-only page M1
    // shipped. Not "no enabled control" — no control at all: nothing to
    // re-enable from a console, and no button toward a write path that does
    // not exist.
    for (const table of ["events", "venues"]) {
      expect(EDIT_CONFIG[table].regime, table).toBe("resolver_owned");
      const markup = await renderRecord(table, {
        ...defaultScript(table),
        ...OVERRIDE_ABSENT,
      });
      const $ = cheerio.load(markup);
      expect(controlCount(markup), table).toBe(0);
      expect($("input, textarea, select, form").length, table).toBe(0);
      // ...and every mapped column still DRAWS, with its value: read-only is
      // not hidden.
      for (const column of EDIT_CONFIG[table].editable) {
        expect(lineFor(markup, column).editable, `${table}.${column}`).toBe(false);
        expect(lineFor(markup, column).value, `${table}.${column}`).toContain(
          `stored ${column}`,
        );
      }
      // ...including the reference line, which is where the PICKER would have
      // stood (admin-window/TASK-0055, criterion 6): no picker, no search box,
      // no window line, and the link the operator came for still there.
      const reference = EDIT_CONFIG[table].reference;
      if (reference !== null) {
        const line = lineFor(markup, reference.field);
        expect(line.widget, `${table}.${reference.field}`).toBeUndefined();
        expect(line.editable, `${table}.${reference.field}`).toBe(false);
        expect(line.valueHrefs.length, `${table}.${reference.field}`).toBe(1);
      }
      expect($("[data-window]").length, table).toBe(0);
    }
  });

  it("reads no choices for a picker it is not going to draw", async () => {
    // The read is as narrow as the readiness one: the rows a reference may be
    // pointed at are only worth a round trip where a control could be drawn
    // over them. With the override path closed, the graded normal case makes
    // no `venues` read and shows no card for one (admin-window/TASK-0055).
    await renderRecord("events", { ...defaultScript("events"), ...OVERRIDE_ABSENT });
    expect(tablesRead()).not.toContain("venues");
    // The second fixture, so the negative is not green by the read having
    // gone missing altogether: with the path OPEN, the same page reads them.
    await renderRecord("events");
    expect(tablesRead()).toContain("venues");
  });

  it("draws the picker over the rows the choices read returned, and states its window", async () => {
    const markup = await renderRecord("events");
    const line = lineFor(markup, "venue_id");
    expect(line.widget).toBe("picker");
    // The window line follows the LIST, which is inside the panel the operator
    // opens — so at rest the page states no window for it and claims nothing
    // about how many venues exist. What it does carry at rest is the current
    // link and the one control that opens the picker.
    expect(line.valueHrefs.length).toBe(1);
    // ...and nothing on the resting page is a text field for this line.
    const $ = cheerio.load(markup);
    expect($('td [data-widget="picker"] input, td [data-widget="picker"] textarea').length).toBe(0);
  });

  it("falls back to the read-only link when the choices read did not answer", async () => {
    // A refused or absent `venues` costs the PICKER and nothing else: every
    // value stays, the reference still links, and the leg says for itself what
    // happened (the same rule the name relation and the provenance log follow).
    const markup = await renderRecord("events", {
      ...defaultScript("events"),
      venues: { error: tableNotInSchemaCache("venues") },
    });
    const line = lineFor(markup, "venue_id");
    expect(line.widget).toBeUndefined();
    expect(line.editable).toBe(false);
    expect(line.valueHrefs.length).toBe(1);
    expect(markup).toContain("venues");
    expect(lineFor(markup, "title").value).toContain("stored title");
    // The cells of the editable columns are untouched by it.
    expect(lineFor(markup, "title").editable).toBe(true);
  });

  it("names the reason, in the app's voice and in the database's own word", async () => {
    for (const table of ["events", "venues"]) {
      const markup = await renderRecord(table, {
        ...defaultScript(table),
        ...OVERRIDE_ABSENT,
      });
      const $ = cheerio.load(markup);
      // Said once, above the table, never per line.
      const note = $('[data-note="override-unavailable"]');
      expect(note.length, table).toBe(1);
      expect($('tbody [data-note="override-unavailable"]').length, table).toBe(0);
      // The delivered HTML, whitespace-normalised: the consequence in words,
      // with no two of them run together.
      const said = note.text().replace(/\s+/g, " ").trim();
      expect(said, table).toContain("read-only");
      expect(said, table).toContain("resolution pipeline");
      expect(said, table).not.toMatch(/[a-z][A-Z]/);
      // ...and the card beside it names the object that is missing, in the
      // spelling the query used (LOOK_AND_FEEL state 3).
      expect($('[data-state="not_provisioned"]').length, table).toBeGreaterThan(0);
      expect($('[data-not-provisioned="verdicts"]').length, table).toBe(1);
    }
  });

  it("offers the cell on every mapped column once the path is open", async () => {
    // The other fixture of the pair above: the same page, the same map, one
    // different answer from the database.
    for (const table of ["events", "venues"]) {
      const markup = await renderRecord(table);
      const editable = EDIT_CONFIG[table].editable;
      expect(editable.length, table).toBeGreaterThan(0);
      for (const column of editable) {
        expect(lineFor(markup, column).editable, `${table}.${column}`).toBe(true);
      }
      // Every column that edits as a CELL is a column the map calls editable:
      // no picker stands where a cell should, and no cell where a picker
      // should (admin-window/TASK-0055).
      for (const column of editable) {
        expect(lineFor(markup, column).widget, `${table}.${column}`).toBeUndefined();
      }
      // The key never edits, and no unmapped column the read happened to
      // return does either.
      expect(lineFor(markup, EDIT_CONFIG[table].pk).editable, table).toBe(false);
      expect(lineFor(markup, UNMAPPED_COLUMN).editable, table).toBe(false);
      for (const column of EDIT_CONFIG[table].display) {
        const line = lineFor(markup, column);
        // A displayed column offers no CELL. The one displayed column the map
        // calls a reference offers the picker instead — never a text cell,
        // because a reference names a row and a cell can only send text
        // (SPEC F12, admin-window/TASK-0055). Every other displayed column
        // offers nothing at all.
        const isReference = EDIT_CONFIG[table].reference?.field === column;
        expect(line.widget, `${table}.${column}`).toBe(
          isReference ? "picker" : undefined,
        );
        expect(line.editable, `${table}.${column}`).toBe(isReference);
      }
      // Nothing is said about an absent path when the path is there.
      expect(
        cheerio.load(markup)('[data-note="override-unavailable"]').length,
        table,
      ).toBe(0);
    }
  });

  it("asks the settlement question once, and only where it can change anything", async () => {
    // The directly-written table needs no asking — its own read already
    // answered — so the sandbox still makes exactly one read, and the
    // resolver-owned pair asks the one seam once.
    for (const table of ["events", "venues"]) {
      await renderRecord(table);
      expect(tablesRead().filter((name) => name === "verdicts"), table).toEqual([
        "verdicts",
      ]);
    }
    await renderRecord(DIRECT_WRITE_TABLE);
    expect(tablesRead()).toEqual([DIRECT_WRITE_TABLE]);
  });

  it("proves that negative is not vacuous: the sandbox does draw controls", async () => {
    expect(controlCount(await renderRecord(DIRECT_WRITE_TABLE))).toBeGreaterThan(0);
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
        value: "stored label",
        onSave: async () => ({ ok: true }) as const,
        label: `label of ${DIRECT_WRITE_TABLE}`,
      }),
    );
    expect(await renderRecord(DIRECT_WRITE_TABLE)).toContain(primitive);
  });

  it("names the field in each control's accessible name", async () => {
    const markup = await renderRecord(DIRECT_WRITE_TABLE);
    const $ = cheerio.load(markup);
    const labels = $("button[aria-label]")
      .toArray()
      .map((button) => $(button).attr("aria-label") ?? "");
    for (const column of EDIT_CONFIG[DIRECT_WRITE_TABLE].editable) {
      expect(labels.some((label) => label.includes(column)), column).toBe(true);
    }
  });
});

/* ── the values on the line ───────────────────────────────────────────────── */

describe("what a line shows", () => {
  it("shows the stored value, including a number, as the database gave it", async () => {
    const markup = await renderRecord(DIRECT_WRITE_TABLE);
    expect(lineFor(markup, "label").value).toContain("stored label");
    expect(lineFor(markup, "tally").value).toContain("4");
  });

  it("shows an empty column as the absence, still editable", async () => {
    const line = lineFor(await renderRecord(DIRECT_WRITE_TABLE), "note");
    expect(line.value).toContain(EM_DASH);
    // An unset column is how a value is first set: absence never hides a field.
    expect(line.editable).toBe(true);
  });

  it("draws a line for a mapped column the read returned nothing for", async () => {
    const config = EDIT_CONFIG[DIRECT_WRITE_TABLE];
    const markup = await renderRecord(DIRECT_WRITE_TABLE, {
      [DIRECT_WRITE_TABLE]: { data: { [config.pk]: IDS[DIRECT_WRITE_TABLE] } },
    });
    for (const column of config.editable) {
      expect(lineFor(markup, column).value, column).toContain(EM_DASH);
    }
  });

  it("shows the record's id whatever the read did", async () => {
    const failed = await renderRecord(DIRECT_WRITE_TABLE, {
      [DIRECT_WRITE_TABLE]: { error: permissionDenied(DIRECT_WRITE_TABLE) },
    });
    expect(failed).toContain(IDS[DIRECT_WRITE_TABLE]);
  });
});

/* ── the provenance slot ──────────────────────────────────────────────────── */

describe("the provenance slot", () => {
  it("stands on every line, and holds an absence on the directly-written table", async () => {
    // The walk sandbox carries no `field_provenance` row by construction, so
    // there is nothing to show — and nothing is invented into the slot. What
    // may eventually stand there is admin-window/TASK-0025, still unanswered.
    const table = DIRECT_WRITE_TABLE;
    const drawn = lines(await renderRecord(table));
    expect(drawn.length, table).toBeGreaterThan(0);
    for (const line of drawn) {
      expect(line.provenanceAbsent, `${table}.${line.name}`).toBe(true);
    }
  });

  it("names no source, tier, apply time or lock state anywhere", async () => {
    const markup = await renderRecord(DIRECT_WRITE_TABLE);
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
    const markup = await renderRecord(DIRECT_WRITE_TABLE, {
      [DIRECT_WRITE_TABLE]: { error: tableNotInSchemaCache(DIRECT_WRITE_TABLE) },
    });
    expect(markup).toContain(DIRECT_WRITE_TABLE);
    expect(controlCount(markup)).toBe(0);
  });

  it("reports a failed read in the database's own words", async () => {
    const markup = await renderRecord(DIRECT_WRITE_TABLE, {
      [DIRECT_WRITE_TABLE]: { error: permissionDenied(DIRECT_WRITE_TABLE) },
    });
    expect(markup).toContain(permissionDenied(DIRECT_WRITE_TABLE).message);
  });

  it("reports a table that holds no such row as its own state", async () => {
    const missingRow = await renderRecord(DIRECT_WRITE_TABLE, {
      [DIRECT_WRITE_TABLE]: { data: null },
    });
    const absentTable = await renderRecord(DIRECT_WRITE_TABLE, {
      [DIRECT_WRITE_TABLE]: { error: tableNotInSchemaCache(DIRECT_WRITE_TABLE) },
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

  it("tells the operator the record is reached by id, naming no surface that could list it", async () => {
    const table = DIRECT_WRITE_TABLE;
    expect(EDIT_CONFIG[table].regime, table).toBe("sandbox");
    const text = emptyText(await renderRecord(table, missingRowScript(table)));
    // The bug: the state pointed at Browse, which is the recent-events view
    // and structurally cannot list a table with no listing (spec F7). No page
    // of this app can, so the state may name none of them.
    for (const item of NAV_ITEMS) {
      expect(text, `${table} names ${item.label}`).not.toContain(item.label);
    }
    // ...and it still says what fills the surface (Voice bar 4): the id.
    expect(text, table).toMatch(/\bid\b/i);
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
  // Fixed in admin-window/BUG-0065; QA's strict `it.fails` marker removed with
  // the fix, so this reddens if the failed-read state ever comes back. The
  // script still carries the 22P02 the database WOULD answer with, and the
  // page never gets that far.
  it("does not report a mistyped id as a failed database read", async () => {
    const markup = await renderRecord(
      DIRECT_WRITE_TABLE,
      {
        ...defaultScript(DIRECT_WRITE_TABLE),
        [DIRECT_WRITE_TABLE]: { error: invalidUuidSyntax("not-a-uuid") },
      },
      "not-a-uuid",
    );
    const $ = cheerio.load(markup);
    // Something answered for the request at all...
    expect($("[data-state]").length).toBeGreaterThan(0);
    // ...and it is not the failed-read state.
    expect($('[data-state="error"]').length).toBe(0);
  });

  /**
   * The three spellings QA measured against staging on a production build,
   * 2026-09-03 (admin-window/BUG-0065): a segment that is no kind of uuid, a
   * uuid one character short, and a uuid carrying a trailing space — which a
   * browser sends as `%20` and Next hands the page decoded.
   */
  const MISTYPED_IDS = [
    "not-a-uuid",
    "00000000-0000-0000-0000-00000000000",
    // The trailing space as the page really receives it: Next hands a dynamic
    // segment over still percent-encoded (measured 2026-09-03 on a production
    // build — `/records/groups/<id>%20` echoes `%20` back on screen), so the
    // decoded spelling is here too and both answer the same way.
    "00000000-0000-0000-0000-000000000000%20",
    "00000000-0000-0000-0000-000000000000 ",
    "%7B01920000-0000-7000-8000-0000000000a1%7D",
  ];

  /**
   * Every spelling of a uuid Postgres itself accepts and a URL can carry
   * (`string_to_uuid`): canonical, uppercased, and with the hyphens left out.
   * Each names the SAME row, so the guard must NOT flag one — the second
   * fixture every guard owes (ARCHITECTURE §10 / LESSONS 3), and the failure
   * it protects against is telling an operator that a working id is not an id.
   * All three were driven against staging on a production build, 2026-09-03,
   * and each rendered the same 11-field `groups` record.
   *
   * A BRACED uuid is Postgres-legal and absent on purpose: a dynamic segment
   * reaches the page still percent-encoded, so `{id}` arrives as `%7Bid%7D`
   * and is not an id by anyone's grammar (`RECORD_ID`, lib/db/records.ts).
   */
  const WELL_FORMED_IDS = [
    "01920000-0000-7000-8000-0000000000a1",
    "01920000-0000-7000-8000-0000000000A1",
    "019200000000700080000000000000a1",
  ];

  it.each(MISTYPED_IDS)(
    "answers %o without reading anything, on every table the map carries",
    async (id) => {
      for (const table of EDITABLE_TABLES) {
        const markup = await renderRecord(table, defaultScript(table), id);
        const $ = cheerio.load(markup);
        // No query was issued: a malformed id is decided from the request.
        expect(tablesRead(), `${table} read for ${JSON.stringify(id)}`).toEqual([]);
        // It is answered, and not as a failure of a database never asked.
        expect($("[data-state]").length, table).toBeGreaterThan(0);
        expect($('[data-state="error"]').length, table).toBe(0);
        // ONE answer, not one per read leg — the resolver-owned pair reported
        // the same refusal twice before this fix.
        expect($("[data-state]").length, `${table} state cards`).toBe(1);
        // The operator still sees the address they asked for.
        expect(markup, table).toContain(id.trim());
      }
    },
  );

  it.each(MISTYPED_IDS)(
    "does not answer %o with the unknown-id state, in either regime",
    async (id) => {
      for (const table of [DIRECT_WRITE_TABLE, "events"]) {
        const mistyped = await renderRecord(table, defaultScript(table), id);
        const unknown = await renderRecord(table, missingRowScript(table));
        // Both states are a single card, and they are different cards: a
        // mistyped id is not "the table answered and holds no such row".
        expect(emptyText(mistyped), table).not.toBe(emptyText(unknown));
      }
    },
  );

  it.each(WELL_FORMED_IDS)(
    "still reads the database for %o, an id Postgres accepts",
    async (id) => {
      for (const table of EDITABLE_TABLES) {
        const markup = await renderRecord(table, defaultScript(table), id);
        expect(tablesRead(), `${table} read for ${id}`).toContain(table);
        // ...and what came back is rendered as a record, not as any state card.
        expect(cheerio.load(markup)("[data-state]").length, table).toBe(0);
      }
    },
  );

  it("leaves the unknown-id state to a well-formed id that matches no row", async () => {
    for (const table of EDITABLE_TABLES) {
      const markup = await renderRecord(table, missingRowScript(table));
      // The read happened, and its answer — not the request — is what emptied
      // the surface (admin-window/BUG-0052, unchanged by BUG-0065).
      expect(tablesRead(), table).toContain(table);
      expect(cheerio.load(markup)('[data-state="empty"]').length, table).toBe(1);
    }
  });

  it("says something different in each regime, from one map", async () => {
    const direct = emptyFiller(
      await renderRecord(DIRECT_WRITE_TABLE, missingRowScript(DIRECT_WRITE_TABLE)),
    );
    const resolverOwned = emptyFiller(await renderRecord("events", missingRowScript("events")));
    expect(direct).not.toBe(resolverOwned);
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
    // The two Ben struck on 2026-09-08. They rendered a record page until the
    // map lost them; the whole of the strike is that this page now refuses
    // them exactly as it refuses the raw archive (ARCHITECTURE §9).
    "groups",
    "idols",
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
        RecordPage({ params: Promise.resolve({ table, id: OFF_MAP_ID }) }),
      ).rejects.toThrow(/404/);
    },
  );

  it("renders exactly one h1 per record page", async () => {
    for (const table of EDITABLE_TABLES) {
      const markup = await renderRecord(table);
      expect([...markup.matchAll(/<h1[\s>]/g)].length, table).toBe(1);
    }
  });

  /**
   * Fixed in admin-window/BUG-0073; QA's strict `it.fails` marker removed with
   * the fix, the assertions kept exactly as QA wrote them.
   *
   * The defect: the h1 was `` `${config.table} record` `` in `type-title`, and
   * `type-title` is sans with `text-transform: uppercase` — so the TABLE NAME,
   * a machine identifier, was rewritten on screen. Measured in Chromium
   * against staging, both colour schemes, 2026-09-03: at
   * `/records/walk_sandbox/00000000-0000-4000-8000-000000000001` the h1's
   * `textContent` was `walk_sandbox record` and its `innerText` — what the
   * operator reads — was `WALK_SANDBOX RECORD`, while the row id three lines
   * lower rendered in mono at `text-transform: none`.
   *
   * Voice copy bar 5: machine identifiers "render verbatim in mono and are
   * never prettified into Title Case prose". This was the same defect
   * admin-window/BUG-0049 removed from the `micro` eyebrow; its guard
   * (`uppercasedIdentifiers`, `tests/offline/ui/markup.ts`) read `type-micro`
   * elements only, so the h1 was invisible to it — it now reads every
   * uppercasing step, this one included.
   *
   * The remedy took the same shape: `Page` renders an `{identifier, words}`
   * title as a mono span beside the sans word, so only `record` is inside the
   * uppercasing element (`src/components/ui/page.tsx`).
   *
   * What is asserted is the STRUCTURAL property that fix established — the
   * identifier is never inside the element that uppercases — and, second, that
   * it is still on the page, so the guard cannot be satisfied by deleting the
   * word rather than by moving it out of the sans step.
   */
  it("keeps the table identifier out of the uppercasing h1", async () => {
    for (const table of EDITABLE_TABLES) {
      const markup = await renderRecord(table);
      const $ = cheerio.load(markup);
      const uppercasing = $("[class]")
        .toArray()
        .filter((element) =>
          ($(element).attr("class") ?? "").split(/\s+/).includes("type-title"),
        )
        .map((element) => $(element).text().replace(/\s+/g, " ").trim());
      expect(uppercasing.filter((text) => text.includes(table)), table).toEqual([]);
      // and the identifier is still there, so the remedy cannot be deletion
      expect(markup.includes(table), table).toBe(true);
    }
  });
});

/* ── the walk sandbox, the one table that is usually not there ────────────── */

/**
 * Campaign admin-window/TASK-0035. The sandbox is in the map and in nothing
 * else, so `/records/walk_sandbox/<uuid>` is its whole surface — and it has to
 * render honestly in BOTH the states it will be found in: absent (production,
 * forever, and any unseeded staging project) and present (seeded staging).
 */
describe("the walk sandbox", () => {
  const SANDBOX = "walk_sandbox";

  it("is reachable at its own address and from no other surface", async () => {
    // "One entry in the one map, and nothing else": the sandbox is a staging
    // fixture an operator must never trip over, so the window's navigation
    // must lead nowhere near it while `/records/walk_sandbox/<uuid>` still
    // answers. Both halves, because either alone is passable
    // (QA, admin-window/TASK-0035).
    expect(NAV_ITEMS.length, "a nav with no items proves nothing").toBeGreaterThan(0);
    for (const item of NAV_ITEMS) {
      expect(item.href, item.label).not.toContain(SANDBOX);
      expect(isNavItemActive(`/records/${SANDBOX}/${IDS[SANDBOX]}`, item.href), item.label).toBe(false);
    }
    const markup = await renderRecord(SANDBOX);
    expect([...markup.matchAll(/<h1[\s>]/g)].length).toBe(1);
    expect(markup).toContain(SANDBOX);
  });

  it("renders the not-provisioned card naming it where the table is absent", async () => {
    const markup = await renderRecord(SANDBOX, {
      [SANDBOX]: { error: tableNotInSchemaCache(T.walkSandbox) },
    });
    const card = cheerio.load(markup)('[data-state="not_provisioned"]');
    expect(card.length).toBe(1);
    expect(card.text()).toContain(T.walkSandbox);
    // Nothing to edit behind a table that is not there — and nothing threw.
    expect(controlCount(markup)).toBe(0);
    // The state is the DATABASE's answer, not a refusal decided from the
    // address: the read was issued. This is the assertion that goes red if the
    // sandbox is ever re-keyed to something `isRecordId` refuses, which was
    // measured on this ticket (builder-93, 2026-09-04) to make the card
    // unreachable at the sandbox's own address.
    expect(tablesRead()).toContain(T.walkSandbox);
  });

  it("draws every mapped column, and the key without a control, where it is present", async () => {
    const config = EDIT_CONFIG[SANDBOX];
    const markup = await renderRecord(SANDBOX);
    for (const column of [config.pk, ...config.editable]) {
      expect(lineFor(markup, column).value, column).not.toBe("");
    }
    expect(lineFor(markup, config.pk).editable).toBe(false);
    expect(markup).toContain(IDS[SANDBOX]);
  });

  it("draws a false boolean and a zero as their own values, never as the absence", async () => {
    // The seam this entry opens: `walk_sandbox` puts the map's FIRST boolean
    // column (`is_flagged`) and its first zero-defaulted integer (`tally`) on
    // the edit surface — no catalog table has either. Both are values, and the
    // surface must say so: the app's own absence predicate calls a raw boolean
    // an absence outright (asserted below, so this is not a straw man), so a
    // line that reached the cell without `scalarText` would draw the em dash
    // over `false` and tell an operator the column is empty when the database
    // holds `false`. `0` is the same trap one falsy step away
    // (QA, admin-window/TASK-0035).
    expect(isAbsent(false), "the app's absence predicate treats a raw boolean as an absence").toBe(true);
    const markup = await renderRecord(SANDBOX, {
      [SANDBOX]: {
        data: {
          sandbox_id: IDS[SANDBOX],
          label: "First sandbox row",
          note: "a note",
          tally: 0,
          is_flagged: false,
          observed_on: "2026-01-15",
        },
      },
    });
    for (const [column, shown] of [
      ["is_flagged", "false"],
      ["tally", "0"],
    ] as const) {
      const line = lineFor(markup, column);
      expect(line.value, column).toBe(shown);
      expect(line.value, column).not.toContain(EM_DASH);
      // ...and it is still the editable cell: a value the surface can draw is
      // a value a walker can rewrite.
      expect(line.editable, column).toBe(true);
    }
    // The other fixture, so the pair above cannot pass vacuously: the em dash
    // is what a column that really is empty draws, on this same line.
    const cleared = await renderRecord(SANDBOX, {
      [SANDBOX]: {
        data: {
          sandbox_id: IDS[SANDBOX],
          label: "First sandbox row",
          note: "a note",
          tally: null,
          is_flagged: null,
          observed_on: "2026-01-15",
        },
      },
    });
    for (const column of ["is_flagged", "tally"]) {
      expect(lineFor(cleared, column).value, column).toContain(EM_DASH);
    }
  });

  it("leaves an unset nullable column as the absence, still editable", async () => {
    // The em-dash absence-then-fill path the entry's nullable columns exist
    // for: a walker finds the dash, types a value, and saves it.
    const markup = await renderRecord(SANDBOX, {
      [SANDBOX]: {
        data: {
          sandbox_id: IDS[SANDBOX],
          label: "stored label",
          tally: 3,
          is_flagged: false,
          note: null,
          observed_on: null,
        },
      },
    });
    for (const column of ["note", "observed_on"]) {
      const line = lineFor(markup, column);
      expect(line.value, column).toContain(EM_DASH);
      expect(line.editable, column).toBe(true);
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

  it("draws a line per mapped column, with the value the read returned", async () => {
    // Over `mappedColumns` rather than `display`: after Ben's allowlist of
    // 2026-09-08 the columns an operator came to see are mostly EDITABLE ones,
    // and `venues` displays none at all. What the page owes is a line per
    // column the map names, whichever half names it.
    for (const table of ["events", "venues"]) {
      const markup = await renderRecord(table);
      const columns = mappedColumns(EDIT_CONFIG[table]).filter(
        (column) => column !== EDIT_CONFIG[table].pk,
      );
      expect(columns.length, table).toBeGreaterThan(0);
      for (const column of columns) {
        expect(lineFor(markup, column).value, `${table}.${column}`).toContain(
          `stored ${column}`,
        );
      }
      // ...and in the map's own order, so the move between the lists cannot
      // silently reorder a page (FEAT-0011 criterion 8).
      expect(
        lines(markup).map((line) => line.name).slice(0, mappedColumns(EDIT_CONFIG[table]).length),
        table,
      ).toEqual([...mappedColumns(EDIT_CONFIG[table])]);
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

  it("offers no cell on a displayed column, however the map lists it", async () => {
    // `display` is the read-only half of the map and cannot become writable by
    // being listed — with the write path OPEN, which is the only state in
    // which this claim can fail.
    //
    // What "writable" means here is the CELL: a displayed column is never
    // handed to the click-to-edit widget, so nothing on this page submits its
    // value as text (admin-window/TASK-0055). The one displayed column the map
    // calls a reference offers the picker instead, which submits an entity's
    // id and never a value — a different widget answering a different
    // question, and `decideEdit` still refuses the column
    // (`tests/offline/edit/config.test.ts`, "refuses every displayed column").
    for (const table of ["events", "venues"]) {
      const markup = await renderRecord(table);
      for (const column of EDIT_CONFIG[table].display) {
        const line = lineFor(markup, column);
        const isReference = EDIT_CONFIG[table].reference?.field === column;
        expect(line.widget, `${table}.${column}`).toBe(
          isReference ? "picker" : undefined,
        );
        expect(line.editable, `${table}.${column}`).toBe(isReference);
      }
      // The pk is never a control either, and the page draws some control —
      // otherwise the loop above is green over a read-only page.
      expect(lineFor(markup, EDIT_CONFIG[table].pk).editable, table).toBe(false);
      expect(controlCount(markup), table).toBeGreaterThan(0);
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
    // A route out is not a write path — and the control this line now offers
    // is not one either: it is the picker, which links a row
    // (admin-window/TASK-0055). The link the operator came for is unchanged
    // beside it, which is the whole of what BUG-0034 asked for.
    expect(line.widget).toBe("picker");
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
    // A failed name read costs the NAME and nothing else: the reference line
    // still links, and the picker over it is unaffected — the name relation
    // and the choices read are different legs (admin-window/TASK-0055).
    expect(line.widget).toBe("picker");
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
    for (const table of ["venues", DIRECT_WRITE_TABLE]) {
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
    // and `field_provenance` on the venue fact still says who decided it.
    //
    // The log spells that fact `venue`, not `venue_id` — the registry field
    // name, which is the canonical column's name for every other fact and this
    // one alone differs (admin-window/BUG-0090; staging holds 11 `events.venue`
    // rows and zero `venue_id` rows). The decision still has to land on the
    // `venue_id` LINE, because that is the line the operator reads.
    const markup = await renderRecord("events", {
      ...eventWithVenue(IDS.venues, {
        event_listings: { data: { event_id: IDS.events, venue_name: VENUE_NAME } },
      }),
      field_provenance: complete([
        decided({
          provenance_id: "01920000-0000-7000-8000-0000000004c1",
          field: "venue",
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
    for (const column of mappedColumns(EDIT_CONFIG.events).slice(1)) {
      expect(lineFor(markup, column).value, column).toContain(`stored ${column}`);
      expect(lineFor(markup, column).provenanceAbsent, column).toBe(true);
    }
    // ...and the provenance leg says for itself what is missing, by name.
    expect(markup).toContain("field_provenance");
    // Every leg answers for itself: a provenance leg that failed says nothing
    // about the WRITE path, so the cells the map allows are still cells.
    expect(lineFor(markup, "title").editable).toBe(true);
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

  it("makes no provenance read for the directly-written table", async () => {
    // `field_provenance` carries rows for resolver-owned entities; the walk
    // sandbox is a staging fixture, unprovenanced by construction, and the
    // page says so once in words rather than reading a log that could only
    // answer "no rows".
    const table = DIRECT_WRITE_TABLE;
    const db = stubClient({ [table]: { data: scriptedRecord(table) } });
    readWith.client = db.asSupabaseClient();
    const { renderToStaticMarkup } = await import("react-dom/server");
    renderToStaticMarkup(
      await RecordPage({ params: Promise.resolve({ table, id: IDS[table] }) }),
    );
    expect(db.tablesRead(), table).toEqual([table]);
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

    it("says nothing on a directly-written record, whose regime note already explains it", async () => {
      // The other fixture of the guard above, and the asymmetry the ticket is
      // about: the branch that needed no legend is not given a second one.
      const table = DIRECT_WRITE_TABLE;
      expect(EDIT_CONFIG[table].regime, table).toBe("sandbox");
      expect(legend(await renderRecord(table)), table).toEqual([]);
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

    /* ── QA (admin-window/BUG-0053): the criterion's other named surface, and
       the state the gate's third clause owns ─────────────────────────────── */

    it("says it on EVERY resolver-owned table, not only the one the ticket named", async () => {
      // The criterion names `/records/venues/<id>` beside `/records/events/<id>`,
      // and the gate keys on the REGIME rather than on a table name — so every
      // table on that side of the cutover owes the operator the same sentence,
      // and a future table added to the map inherits it without a test edit.
      const resolverOwned = EDITABLE_TABLES.filter(
        (table) => EDIT_CONFIG[table].regime === "resolver_owned",
      );
      expect(resolverOwned.length).toBeGreaterThan(1);
      const said = legend(await renderRecord("events"));
      for (const table of resolverOwned) {
        const markup = await renderRecord(table);
        // Same sentence, said once — the anatomy does not change per table.
        expect(legend(markup), table).toEqual(said);
        // ...and it is not vacuous there either: the primary key carries no
        // decision on any table, so there is always a dash to explain.
        expect(lineFor(markup, EDIT_CONFIG[table].pk).provenanceAbsent, table).toBe(
          true,
        );
      }
    });

    it("says nothing when the RECORD read failed, though the provenance leg answered", async () => {
      // The gate's third clause. Every leg answers for itself, so a healthy
      // provenance leg does not entitle the page to caption a column that was
      // never drawn: the record's own refusal is the whole page here, and a
      // legend about an empty cell beside it would describe nothing on screen.
      for (const failure of [
        { error: permissionDenied("events") },
        { error: tableNotInSchemaCache("events") },
      ]) {
        const markup = await renderRecord("events", {
          ...defaultScript("events"),
          events: failure,
        });
        expect(lines(markup)).toEqual([]);
        expect(legend(markup)).toEqual([]);
        // ...and the record's own leg still reports, so the page is not silent.
        const $ = cheerio.load(markup);
        expect(
          $('[data-state="error"], [data-state="not_provisioned"]').length,
        ).toBeGreaterThan(0);
      }
    });
  });
});
