import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { EDITABLE_TABLES, EDIT_CONFIG } from "@/lib/edit/config";
import { EM_DASH } from "@/lib/format";
import {
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
  for (const column of config.editable) row[column] = `stored ${column}`;
  // A number and an absence among the scalars, so both renderings are covered.
  if (config.editable.includes("member_count")) row.member_count = 4;
  if (config.editable.includes("korean_name")) row.korean_name = null;
  row[UNMAPPED_COLUMN] = "not in the map";
  return row;
}

async function renderRecord(
  table: string,
  script?: Script,
  id = IDS[table],
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  readWith.client = stubClient(
    script ?? { [table]: { data: scriptedRecord(table) } },
  ).asSupabaseClient();
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
  provenance: string;
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
        provenance: provenance.text().trim(),
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
