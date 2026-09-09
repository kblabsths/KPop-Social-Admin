import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  EDITABLE_TABLES,
  EDIT_CONFIG,
  columnOfRegistryField,
  decideEdit,
  editConfigFor,
  isEditable,
  mappedColumns,
  mappedRegistryFields,
  registryFieldOf,
  writePathFor,
  type TableEditConfig,
} from "@/lib/edit/config";
import { isReferenceField } from "@/lib/verdict/decision";
import { TABLE_NAMES } from "@/lib/db/tables";
import { codeLines, repoRoot, sourceFiles, sourceText } from "../source-tree";

/**
 * The edit config map — campaign admin-window/TASK-0017, acceptance test 7's
 * direct-write half and M1 EC10.
 *
 * Two halves. The first proves the MAP IS THE SINGLE SOURCE of what may be
 * edited: what it carries, and that `decideEdit` — the one decision both the
 * route and the data layer take — answers from it and from nothing else. The
 * second is structural, asserted against the source tree in the manner of
 * `tests/offline/db/layering.test.ts`: no second allowlist, no insert, no
 * delete, no write path to a resolver-owned table.
 */

const CONFIG_MODULE = "src/lib/edit/config.ts";
const RECORDS_MODULE = "src/lib/db/records.ts";
/**
 * The settlement seam (campaign admin-window/TASK-0048): the ONE module in
 * `src/` allowed to call a database procedure, and the one that spells the
 * procedure's argument name.
 */
const VERDICT_MODULE = "src/lib/db/verdict.ts";
/** Where every database object name is spelled — table, view or function (§4 rule 4). */
const TABLES_MODULE = "src/lib/db/tables.ts";
const ROUTE_MODULE = "src/app/api/admin/records/[table]/[id]/route.ts";
/**
 * The widget's two readers (campaign admin-window/TASK-0018). config.ts's own
 * docstring names them in advance — "the route, the data layer and (later) the
 * widget all read this map" — and they READ it: the page resolves the table's
 * config, `fields.ts` asks `decideEdit` per column. Neither declares a column
 * list, which is what the rule below is actually about.
 */
const PAGE_MODULE = "src/app/records/[table]/[id]/page.tsx";
const FIELDS_MODULE = "src/components/records/fields.ts";

/**
 * The two tables Ben struck from the edit surface on 2026-09-08 — *"admin
 * edits catalog tables only through the observation pipeline; do not
 * re-implement direct edits"* (ARCHITECTURE §9, DECISIONS 2026-09-08).
 *
 * They are named HERE, in the test, and nowhere in `src/`: that is the whole
 * point. The map cannot say "not these two" — it says nothing about them at
 * all — so the assertion that they are absent has to spell them somewhere, and
 * a test is where a name that must NOT appear in the product belongs.
 */
const STRUCK_TABLES = ["groups", "idols"] as const;

/**
 * The two tables Admin may write only as an OVERRIDE (FEAT-0011). No write
 * verb anywhere under `src/` may name either one: their values change through
 * the settlement function, and the one `.update(` in this repo refuses them by
 * write path (`updateRecordField`, proved in
 * `tests/offline/edit/records.test.ts`).
 */
const RESOLVER_OWNED = ["events", "venues"] as const;

/**
 * The exact allowlists those two carried until the strike (`config.ts` as of
 * the commit before this one), so the refusal is proved over the whole vetted
 * set rather than a sample: a partial restoration cannot slip through.
 */
const STRUCK_ALLOWLISTS: Readonly<Record<string, readonly string[]>> = {
  groups: [
    "name",
    "korean_name",
    "short_name",
    "company",
    "status",
    "type",
    "member_count",
    "debut_date",
    "image_url",
    "bio",
  ],
  idols: [
    "stage_name",
    "real_name",
    "korean_name",
    "position",
    "nationality",
    "gender",
    "bio",
    "birth_date",
    "image_url",
    "status",
    "height_cm",
    "weight_kg",
    "blood_type",
    "mbti",
    "agency",
    "birth_place",
  ],
};

/**
 * **Where the teeth are, now that the type no longer carries them**
 * (ARCHITECTURE §9, 2026-09-08). A `Regime` member is not what stops the
 * struck path returning — a catalog table re-added under `sandbox` would be
 * exactly it. So the pin is this: over any map, the tables whose write path is
 * `direct`.
 *
 * Taking a map rather than reading `EDIT_CONFIG` directly is what lets the
 * rule be proved on TWO fixtures (LESSONS 3): one it must flag and one it must
 * not. A guard that has only ever seen the passing input passes vacuously.
 */
function directWriteTables(
  map: Readonly<Record<string, TableEditConfig>>,
): string[] {
  return Object.values(map)
    .filter((config) => writePathFor(config.regime) === "direct")
    .map((config) => config.table)
    .sort();
}

/**
 * Every `<table>.<column>` an entry names in BOTH of its lists — empty over a
 * map that keeps the two halves disjoint.
 *
 * A column MOVES from `display` into `editable` and never stands in both (Ben,
 * 2026-09-08): `decideEdit` reads `editable` alone, so a column in both would
 * be writable while the map called it read-only. Taking a map rather than
 * reading `EDIT_CONFIG` is what lets the rule be proved on TWO fixtures
 * (LESSONS 3) — one it must flag, one it must not.
 */
function overlappingColumns(
  map: Readonly<Record<string, TableEditConfig>>,
): string[] {
  return Object.values(map)
    .flatMap((config) =>
      config.display
        .filter((column) => config.editable.includes(column))
        .map((column) => `${config.table}.${column}`),
    )
    .sort();
}

/* ── the map ──────────────────────────────────────────────────────────────── */

describe("the map", () => {
  it("carries exactly the two resolver-owned tables and the walk sandbox, keyed by their own name", () => {
    expect(EDITABLE_TABLES).toEqual(["events", "venues", "walk_sandbox"]);
    for (const [key, config] of Object.entries(EDIT_CONFIG)) {
      expect(config.table, key).toBe(key);
    }
  });

  it("carries no groups and no idols entry: the struck direct edit left with them", () => {
    // Ben's strike, 2026-09-08 (ARCHITECTURE §9, DECISIONS 2026-09-08): admin
    // edits catalog tables only through the observation pipeline. Absence from
    // the map IS the mechanism — `editConfigFor` answers null, the record URL
    // is a routed 404 and a PATCH is refused `unknown_table` — so this asserts
    // the absence at every door the map opens.
    for (const table of STRUCK_TABLES) {
      expect(EDITABLE_TABLES, table).not.toContain(table);
      expect(Object.keys(EDIT_CONFIG), table).not.toContain(table);
      expect(editConfigFor(table), table).toBeNull();
      expect(decideEdit(table, "name").allowed, table).toBe(false);
    }

    // ...and the TABLES are untouched. `lib/db/tables.ts` still spells both,
    // which is what "they stay as test tables until they are removed" means
    // here: the residue sweep and the schema description still reach them.
    for (const table of STRUCK_TABLES) {
      expect(TABLE_NAMES, table).toContain(table);
    }
  });

  it("names every table in tables.ts, so a typo here is one red test away", () => {
    // ARCHITECTURE §4 rule 4's reason, preserved without the import cycle rule
    // 7 forbids: the leaf spells the names, and this asserts they are the same
    // strings the rest of the app queries by.
    for (const table of EDITABLE_TABLES) {
      expect(TABLE_NAMES, table).toContain(table);
    }
  });

  it("refuses every column the struck allowlists used to carry", () => {
    // Not a token sample: the WHOLE vetted set each table carried until the
    // strike, so a partial restoration cannot pass. The refusal is the
    // table's, not the column's — an unmapped table has no fields.
    for (const [table, columns] of Object.entries(STRUCK_ALLOWLISTS)) {
      for (const column of columns) {
        const decision = decideEdit(table, column);
        expect(decision.allowed, `${table}.${column}`).toBe(false);
        if (decision.allowed) continue;
        expect(decision.refusal.kind, `${table}.${column}`).toBe("unknown_table");
        expect(decision.refusal.message, `${table}.${column}`).toContain(table);
        expect(isEditable(table, column), `${table}.${column}`).toBe(false);
      }
    }
  });

  it("gives the walk sandbox its staging-only key, regime and column set", () => {
    // The staging-only walk fixture (ARCHITECTURE §9.1, campaign
    // admin-window/TASK-0034's ruling). Its five editable columns are one per
    // coercion the write path can be asked for, and they are asserted exactly
    // because a name the database does not spell reads back as
    // `not_provisioned` and makes the map a lie.
    expect(EDIT_CONFIG.walk_sandbox.pk).toBe("sandbox_id");
    // `sandbox`, re-ruled 2026-09-08 (§9.1 item 5): it had shared the retired
    // regime name with groups/idols, and the strike left it sharing its answer
    // with nothing.
    expect(EDIT_CONFIG.walk_sandbox.regime).toBe("sandbox");
    expect(writePathFor(EDIT_CONFIG.walk_sandbox.regime)).toBe("direct");
    expect([...EDIT_CONFIG.walk_sandbox.editable]).toEqual([
      "label",
      "note",
      "tally",
      "is_flagged",
      "observed_on",
    ]);
    expect([...EDIT_CONFIG.walk_sandbox.display]).toEqual([]);
    expect(EDIT_CONFIG.walk_sandbox.reference).toBeNull();
  });

  it("gives a direct write path to the walk sandbox and to nothing else", () => {
    // THE PIN (ARCHITECTURE §9): the strike is kept by this assertion, not by
    // the type. Fixture 1 — the shipped map — must NOT be flagged: exactly one
    // table writes directly, and it is the staging fixture.
    expect(directWriteTables(EDIT_CONFIG)).toEqual(["walk_sandbox"]);

    // Fixture 2 — a map that re-adds a catalog table with a direct path, which
    // is precisely the struck shape — MUST be flagged. Without this half the
    // assertion above has never seen an input it should reject.
    const restored: Record<string, TableEditConfig> = {
      ...EDIT_CONFIG,
      groups: {
        table: "groups",
        pk: "id",
        regime: "sandbox",
        editable: ["name"],
        display: [],
        reference: null,
      },
    };
    expect(directWriteTables(restored)).toEqual(["groups", "walk_sandbox"]);
    expect(directWriteTables(restored)).not.toEqual(
      directWriteTables(EDIT_CONFIG),
    );
  });

  it("sends every regime the map uses down exactly one write path", () => {
    // `writePathFor` is TOTAL over `Regime` (there is no "no path" arm to fall
    // into, because a table Admin may not write is not in the map), so every
    // entry answers, and only the sandbox answers `direct`.
    for (const config of Object.values(EDIT_CONFIG)) {
      const path = writePathFor(config.regime);
      expect(["direct", "override"], config.table).toContain(path);
      expect(path === "direct", config.table).toBe(
        config.table === "walk_sandbox",
      );
    }
    expect(writePathFor("sandbox")).toBe("direct");
    expect(writePathFor("resolver_owned")).toBe("override");
  });

  it("leaves created_at outside the sandbox's map, so no read ever asks for it", () => {
    // §9.1 item 2: the read selects `mappedColumns` explicitly, so a column
    // the map does not name is never read and never drawn. `created_at` is
    // set once at seed and is the one sandbox column deliberately excluded.
    expect(mappedColumns(EDIT_CONFIG.walk_sandbox)).not.toContain("created_at");
    expect([...mappedColumns(EDIT_CONFIG.walk_sandbox)]).toEqual([
      "sandbox_id",
      "label",
      "note",
      "tally",
      "is_flagged",
      "observed_on",
    ]);
  });

  it("gives the sandbox every column the write path coerces, one of each", () => {
    // The POINT of the column set (§9.1 item 2): the widget is a single text
    // cell, so each editable column exists to make PostgREST answer one type
    // question on the way in. The columns are asserted against the DDL Ben
    // pastes (`agenticflow/tracker/for-human/TASK-0034.md`), in the idiom the
    // resolver-owned tables' `CANONICAL_COLUMNS` case uses above: a map name
    // that is not a column of the table is one red test away, not one
    // production page away.
    const SANDBOX_COLUMNS: Readonly<Record<string, string>> = {
      // uuid, not text: the architect's key ruling (2026-09-04, §9.1 item 9)
      // is exactly this column's type, and the DDL Ben pastes spells it
      // `sandbox_id uuid` (QA, admin-window/TASK-0035).
      sandbox_id: "uuid",
      label: "text",
      note: "text",
      tally: "integer",
      is_flagged: "boolean",
      observed_on: "date",
      created_at: "timestamptz",
    };
    for (const column of mappedColumns(EDIT_CONFIG.walk_sandbox)) {
      expect(SANDBOX_COLUMNS, column).toHaveProperty(column);
    }
    // One editable column of each coercion the surface can be asked for, and
    // at least one of them nullable so the em-dash absence-then-fill path is
    // walkable (`note` and `observed_on` are the DDL's nullable pair).
    const types = EDIT_CONFIG.walk_sandbox.editable.map(
      (column) => SANDBOX_COLUMNS[column],
    );
    expect(new Set(types)).toEqual(new Set(["text", "integer", "boolean", "date"]));
  });

  it("gives the resolver-owned tables their real keys and the override path", () => {
    for (const table of ["events", "venues"]) {
      const config = EDIT_CONFIG[table];
      expect(config.regime, table).toBe("resolver_owned");
      expect(writePathFor(config.regime), table).toBe("override");
      // Not empty any more, and that is the whole of FEAT-0011: they are
      // editable — through the override path and through nothing else.
      expect(config.editable.length, table).toBeGreaterThan(0);
    }
    // The primary keys the canonical storage migration gave them.
    expect(EDIT_CONFIG.events.pk).toBe("event_id");
    expect(EDIT_CONFIG.venues.pk).toBe("venue_id");
  });

  it("carries Ben's answer of 2026-09-08 as the editable list of each, exactly", () => {
    // `EDIT_ALLOWLIST_EVENTS_VENUES`, SPEC named gap 7, answered 2026-09-08
    // (DECISIONS 2026-09-08; ARCHITECTURE §9). A builder never picks an
    // editable column: this is a closed list, asserted verbatim and in order,
    // so widening it is a deliberate edit to the map AND to this line.
    expect([...EDIT_CONFIG.events.editable]).toEqual([
      "title",
      "description",
      "poster_url",
      "starts_at",
    ]);
    expect([...EDIT_CONFIG.venues.editable]).toEqual([
      "name",
      "city",
      "country",
      "address",
    ]);
  });

  it("leaves the CHECK-constrained and unruled columns out of both lists", () => {
    // Out because Ben did not rule them in — the first three are
    // CHECK-constrained, the rest are unruled — never because a builder judged
    // them. A column in NEITHER list is not read, not drawn, and refused
    // server-side by the one code path (FEAT-0011 criterion 8).
    const OUT: Readonly<Record<string, readonly string[]>> = {
      events: ["event_type", "status", "time_precision", "ends_at", "ticket_url"],
      venues: ["aliases", "latitude", "longitude", "timezone", "website", "image_url"],
    };
    for (const [table, columns] of Object.entries(OUT)) {
      const config = EDIT_CONFIG[table];
      for (const column of columns) {
        // Real columns of the table — the exclusion is a ruling, not a typo.
        expect(CANONICAL_COLUMNS[table], `${table}.${column}`).toContain(column);
        expect(config.editable, `${table}.${column}`).not.toContain(column);
        expect(config.display, `${table}.${column}`).not.toContain(column);
        expect(mappedColumns(config), `${table}.${column}`).not.toContain(column);
        expect(isEditable(table, column), `${table}.${column}`).toBe(false);
      }
    }
  });

  /**
   * The canonical columns of the two resolver-owned tables, transcribed from
   * the scraper repo's `20260825000002_canonical_event_storage_stands_up.sql`
   * (`CREATE TABLE "public"."events"` and `"public"."venues"`) — the migration
   * that stood the canonical storage up, and the schema truth for both. This
   * is `tests/fixtures/rows.ts`' idiom applied to a column SET: a name in the
   * map that is not a column of its table is a read that would come back
   * `not_provisioned`, and it must be one red test away rather than one
   * production page away.
   */
  const CANONICAL_COLUMNS: Readonly<Record<string, readonly string[]>> = {
    events: [
      "event_id",
      "title",
      "event_type",
      "status",
      "starts_at",
      "ends_at",
      "time_precision",
      "description",
      "poster_url",
      "ticket_url",
      "venue_id",
      "created_at",
    ],
    venues: [
      "venue_id",
      "name",
      "aliases",
      "address",
      "city",
      "country",
      "latitude",
      "longitude",
      "timezone",
      "website",
      "image_url",
      "created_at",
    ],
  };

  it("leaves the reference alone in events' display list, and venues' empty", () => {
    // Ben's ruling of 2026-09-02 named the columns an operator came to SEE;
    // his ruling of 2026-09-08 made eight of them writable, and a column MOVES
    // from `display` into `editable` rather than standing in both (DECISIONS
    // 2026-09-08). What is left displayed is the one column that may never be
    // a cell: the reference.
    expect([...EDIT_CONFIG.events.display]).toEqual(["venue_id"]);
    expect([...EDIT_CONFIG.venues.display]).toEqual([]);
  });

  it("draws the same lines in the same order the move found them in", () => {
    // The move is invisible except for the controls appearing: `mappedColumns`
    // orders pk -> editable -> display, so both record pages draw exactly
    // these lines, in exactly this order (FEAT-0011 criterion 8). Pinned
    // literally, so a re-ordering of either list cannot pass unnoticed.
    expect([...mappedColumns(EDIT_CONFIG.events)]).toEqual([
      "event_id",
      "title",
      "description",
      "poster_url",
      "starts_at",
      "venue_id",
    ]);
    expect([...mappedColumns(EDIT_CONFIG.venues)]).toEqual([
      "venue_id",
      "name",
      "city",
      "country",
      "address",
    ]);
  });

  it("keeps the two lists disjoint on every entry, and says so on a probe that is not", () => {
    // A column in BOTH would be writable while the map called it read-only,
    // since `decideEdit` reads `editable` alone (Ben, 2026-09-08). Fixture 1 —
    // the shipped map — must not be flagged.
    expect(overlappingColumns(EDIT_CONFIG)).toEqual([]);

    // Fixture 2 — an entry naming one column in both — must be. Without it
    // the assertion above has never seen an input it should reject.
    const probe: Record<string, TableEditConfig> = {
      ...EDIT_CONFIG,
      probe_table: {
        table: "probe_table",
        pk: "probe_id",
        regime: "resolver_owned",
        editable: ["title", "city"],
        display: ["city"],
        reference: null,
      },
    };
    expect(overlappingColumns(probe)).toEqual(["probe_table.city"]);
  });

  it("names a real column of that table in every list it carries", () => {
    // Both halves now: a name in `editable` that the table does not have would
    // be an override the gate could never apply, and a name in `display` a
    // read that comes back `PGRST204`.
    for (const table of ["events", "venues"]) {
      const columns = CANONICAL_COLUMNS[table];
      expect(columns, table).toContain(EDIT_CONFIG[table].pk);
      for (const column of mappedColumns(EDIT_CONFIG[table])) {
        expect(columns, `${table}.${column}`).toContain(column);
      }
    }
  });

  it("leaves the sandbox no display list — it edits its columns", () => {
    // Its columns are already on screen through `editable`; a name in both
    // would be one line drawn once either way, and the empty list is what
    // says "nothing extra to show" rather than "not decided yet".
    expect([...EDIT_CONFIG.walk_sandbox.display]).toEqual([]);
    expect(EDIT_CONFIG.walk_sandbox.editable.length).toBeGreaterThan(0);
  });

  it("gives events the one reference the surface links through, and no other table one", () => {
    // admin-window/BUG-0034: `venue_id` is a LINK, and the map is where the
    // surface learns that — `events` is the only table with one in M1.
    expect(EDIT_CONFIG.events.reference).toEqual({
      field: "venue_id",
      domain: "venues",
      registryField: "venue",
    });
    for (const table of ["venues", "walk_sandbox"]) {
      expect(EDIT_CONFIG[table].reference, table).toBeNull();
    }
  });

  it("names each reference the fact the decision log spells, not the column", () => {
    // admin-window/BUG-0090. `field_provenance.field` holds the REGISTRY field
    // name; the map's `field` is the CANONICAL COLUMN. They are the same
    // string everywhere but here, which is why the pairing lives on the entry
    // that already knows this column links rather than holds.
    //
    // The two spellings are pinned to each other across the two leaves that
    // each mirror the scraper's registry: `isReferenceField` answers for
    // `events.venue` (`REFERENCE_FIELDS`) and must not answer for the column
    // name, so a `registryField` edited to the column would redden here rather
    // than silently return the em dash BUG-0090 measured.
    for (const config of Object.values(EDIT_CONFIG)) {
      const reference = config.reference;
      if (reference === null) continue;
      expect(
        isReferenceField(config.table, reference.registryField),
        config.table,
      ).toBe(true);
      // ...and the column's own name is NOT the registry's field name, which
      // is the whole reason the pairing exists.
      expect(
        isReferenceField(config.table, reference.field),
        config.table,
      ).toBe(false);
      expect(reference.registryField, config.table).not.toBe(reference.field);
    }
  });

  it("maps column to logged field and back, and leaves every scalar alone", () => {
    // admin-window/BUG-0090, both directions and the identity case. The read
    // asks in the log's vocabulary and the surface draws in the schema's, so
    // the round trip has to be exact or a decision lands on a line that does
    // not exist.
    const events = EDIT_CONFIG.events;
    expect(registryFieldOf(events, "venue_id")).toBe("venue");
    expect(columnOfRegistryField(events, "venue")).toBe("venue_id");
    expect([...mappedRegistryFields(events)]).toContain("venue");
    expect([...mappedRegistryFields(events)]).not.toContain("venue_id");

    for (const config of Object.values(EDIT_CONFIG)) {
      const fields = mappedRegistryFields(config);
      const columns = mappedColumns(config);
      // One name per column, in the columns' own order: a translation, never
      // a filter and never a re-ordering.
      expect(fields.length, config.table).toBe(columns.length);
      expect(new Set(fields).size, config.table).toBe(fields.length);
      for (const [index, column] of columns.entries()) {
        const field = fields[index];
        expect(field, `${config.table}.${column}`).toBe(
          registryFieldOf(config, column),
        );
        // Round trip: whatever the name, it comes back to its own column.
        expect(columnOfRegistryField(config, field), `${config.table}.${column}`)
          .toBe(column);
        // The reference is the ONLY column whose two names differ; every
        // scalar is queried by its own name exactly as it always was.
        const isReference = config.reference?.field === column;
        expect(field === column, `${config.table}.${column}`).toBe(!isReference);
      }
      // A logged field the map does not know is its own answer, so an
      // unexpected row keys on itself rather than on the reference's column.
      expect(columnOfRegistryField(config, "not_a_mapped_field")).toBe(
        "not_a_mapped_field",
      );
    }
  });

  it("keeps every reference a displayed column, never an editable one", () => {
    // A reference is a third QUESTION about a displayed column, not a third
    // list of columns: one that is not displayed would be drawn nowhere, and
    // one that is editable would offer a control over a link (AGENTS.md).
    for (const config of Object.values(EDIT_CONFIG)) {
      const reference = config.reference;
      if (reference === null) continue;
      expect(config.display, config.table).toContain(reference.field);
      expect(config.editable, config.table).not.toContain(reference.field);
      // It points at a table this app has a record surface for, spelled as
      // the map keys it — the link is `/records/<domain>/<id>`.
      expect(EDITABLE_TABLES, config.table).toContain(reference.domain);
      expect(reference.domain, config.table).not.toBe(config.table);
    }
  });

  it("never lists one column as both editable and displayed", () => {
    // The two halves of the map answer different questions and a column in
    // both would make "is this line read-only?" depend on which list won.
    for (const config of Object.values(EDIT_CONFIG)) {
      for (const column of config.display) {
        expect(config.editable, `${config.table}.${column}`).not.toContain(column);
        expect(column, config.table).not.toBe(config.pk);
      }
      expect(new Set(config.display).size, config.table).toBe(config.display.length);
    }
  });

  it("lists no id, key, bookkeeping timestamp, link or json column as editable", () => {
    // "user-facing fields only: never ids, keys or timestamps" (spec §8). The
    // patterns are the shapes those columns take in this schema.
    //
    // The timestamp pattern is the BOOKKEEPING ones by name, narrowed from
    // `/_at$/` when Ben answered the allowlist on 2026-09-08: `events.starts_at`
    // is in his list, and it is a user-facing FACT about the event — when it
    // begins — not a row's own history. The columns spec §8 means are the ones
    // the pipeline writes about the row itself, and every one of them is still
    // banned here and asserted absent below.
    const forbidden = [
      /^id$/,
      /_id$/,
      /^created_at$/,
      /^updated_at$/,
      /^applied_at$/,
      /_synced_at$/,
      /^created/,
      /^updated/,
      /key/i,
      /^social_links$/,
      /^aliases$/,
      /^performers?$/,
      /^venue$/,
    ];
    for (const config of Object.values(EDIT_CONFIG)) {
      for (const column of config.editable) {
        for (const pattern of forbidden) {
          expect(pattern.test(column), `${config.table}.${column}`).toBe(false);
        }
        // A primary key never edits, not even its own table's.
        expect(column, config.table).not.toBe(config.pk);
      }
    }
    // The narrowing above is a ruling about `starts_at`, not a hole: every
    // bookkeeping timestamp this schema has is still absent from every list.
    for (const config of Object.values(EDIT_CONFIG)) {
      for (const column of ["created_at", "updated_at", "last_synced_at", "applied_at"]) {
        expect(config.editable, `${config.table}.${column}`).not.toContain(column);
      }
    }
    // ...and the one Ben ruled IN is there, so this case cannot pass by the
    // list being empty.
    expect(EDIT_CONFIG.events.editable).toContain("starts_at");
  });

  it("carries no per-column flag and no second list: the entry is six keys", () => {
    // "Widening the list later is ONE edit to those two entries" (Ben,
    // 2026-09-08). A per-column flag or a "future columns" scaffold would
    // show up as a seventh key on an entry; a second list would show up as an
    // export of this module. Both are pinned as values rather than as prose.
    for (const config of Object.values(EDIT_CONFIG)) {
      expect(Object.keys(config).sort(), config.table).toEqual([
        "display",
        "editable",
        "pk",
        "reference",
        "regime",
        "table",
      ]);
    }
  });
});

/* ── the map's columns, in one order ──────────────────────────────────────── */

describe("mappedColumns", () => {
  it("is the primary key, then editable, then display, in declared order", () => {
    for (const config of Object.values(EDIT_CONFIG)) {
      expect([...mappedColumns(config)], config.table).toEqual([
        config.pk,
        ...config.editable,
        ...config.display,
      ]);
    }
  });

  it("de-duplicates, so a column named twice is still drawn once", () => {
    const columns = mappedColumns({
      table: "probe_table",
      pk: "id",
      regime: "sandbox",
      editable: ["name", "company"],
      display: ["company", "id", "bio"],
      reference: null,
    });
    expect([...columns]).toEqual(["id", "name", "company", "bio"]);
  });

  it("answers nothing about writing: a displayed column is still refused", () => {
    // The point of the helper is the READ and the ORDER. `decideEdit` is the
    // only answer to "may this be written", and it does not read `display`.
    for (const table of ["events", "venues"]) {
      for (const column of EDIT_CONFIG[table].display) {
        expect(mappedColumns(EDIT_CONFIG[table]), column).toContain(column);
        expect(isEditable(table, column), `${table}.${column}`).toBe(false);
      }
    }
  });
});

/* ── the one decision ─────────────────────────────────────────────────────── */

describe("decideEdit", () => {
  it("accepts a column the map carries", () => {
    const decision = decideEdit("walk_sandbox", "label");
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.edit.field).toBe("label");
      expect(decision.edit.config).toBe(EDIT_CONFIG.walk_sandbox);
    }
    expect(isEditable("walk_sandbox", "tally")).toBe(true);
  });

  it("refuses a column the map does not carry, naming the field", () => {
    // Real, writable columns of the one table with a direct write path that
    // the map leaves out — the route could technically reach them, and the map
    // is what stops it (spec §8).
    for (const field of ["created_at", "sandbox_note", "label_2"]) {
      const decision = decideEdit("walk_sandbox", field);
      expect(decision.allowed, field).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.kind).toBe("field_not_editable");
        expect(decision.refusal.message).toContain(field);
        expect(decision.refusal.message).toContain("walk_sandbox");
      }
    }
  });

  it("refuses an id, key or timestamp column spelled correctly", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["walk_sandbox", "sandbox_id"],
      ["walk_sandbox", "created_at"],
      ["events", "event_id"],
      ["events", "created_at"],
      ["venues", "venue_id"],
    ];
    for (const [table, field] of cases) {
      const decision = decideEdit(table, field);
      expect(decision.allowed, `${table}.${field}`).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.message).toContain(table);
      }
    }
  });

  it("allows a mapped column of a resolver-owned table, by the override path", () => {
    // FEAT-0011's core: these edit — and the decision says HOW, so no caller
    // has to ask the table's name.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["events", "title"],
      ["events", "description"],
      ["events", "poster_url"],
      ["events", "starts_at"],
      ["venues", "name"],
      ["venues", "city"],
      ["venues", "country"],
      ["venues", "address"],
    ];
    for (const [table, field] of cases) {
      const decision = decideEdit(table, field);
      expect(decision.allowed, `${table}.${field}`).toBe(true);
      if (decision.allowed) {
        expect(decision.edit.path, `${table}.${field}`).toBe("override");
        expect(decision.edit.field, `${table}.${field}`).toBe(field);
        expect(decision.edit.config, `${table}.${field}`).toBe(EDIT_CONFIG[table]);
      }
    }
  });

  it("refuses an unmapped column of a resolver-owned table, naming the field", () => {
    // The refusal is the ORDINARY one — the same `field_not_editable` an
    // unmapped column of the sandbox gets, naming the field (FEAT-0011
    // criterion 5). There is no "this table is read-only" arm any more, and
    // the link column is refused like every other unmapped name: it is a row
    // elsewhere, not a field here (AGENTS.md).
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["events", "venue_id"],
      ["events", "event_type"],
      ["events", "status"],
      ["events", "time_precision"],
      ["events", "ends_at"],
      ["events", "ticket_url"],
      ["events", "performers"],
      ["events", "created_at"],
      ["venues", "timezone"],
      ["venues", "aliases"],
      ["venues", "website"],
    ];
    for (const [table, field] of cases) {
      const decision = decideEdit(table, field);
      expect(decision.allowed, `${table}.${field}`).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.kind, `${table}.${field}`).toBe("field_not_editable");
        expect(decision.refusal.message, `${table}.${field}`).toContain(field);
        expect(decision.refusal.message, `${table}.${field}`).toContain(table);
      }
    }
  });

  it("carries the write path the REGIME decides, on every allowed decision", () => {
    // FEAT-0011 criterion 1: the path is `writePathFor(regime)`'s answer and
    // nothing else — not a table name, not a config key. Over the whole map,
    // on every column it allows.
    for (const config of Object.values(EDIT_CONFIG)) {
      for (const field of config.editable) {
        const decision = decideEdit(config.table, field);
        expect(decision.allowed, `${config.table}.${field}`).toBe(true);
        if (decision.allowed) {
          expect(decision.edit.path, `${config.table}.${field}`).toBe(
            writePathFor(config.regime),
          );
        }
      }
    }
  });

  it("takes the path from the regime alone, on two entries that differ in everything else", () => {
    // "No configuration key can move a table between paths" (FEAT-0011
    // criterion 1). Two configs sharing only their regime answer the same
    // path; the same two with the regime swapped answer the other one.
    const spare: TableEditConfig = {
      table: "one_table",
      pk: "one_id",
      regime: "resolver_owned",
      editable: ["a"],
      display: ["b"],
      reference: { field: "b", domain: "venues", registryField: "b" },
    };
    const other: TableEditConfig = {
      table: "another_table",
      pk: "another_id",
      regime: "resolver_owned",
      editable: [],
      display: [],
      reference: null,
    };
    expect(writePathFor(spare.regime)).toBe(writePathFor(other.regime));
    expect(writePathFor(spare.regime)).toBe("override");
    const asSandbox: TableEditConfig = { ...spare, regime: "sandbox" };
    expect(writePathFor(asSandbox.regime)).toBe("direct");
  });

  it("refuses every displayed column of every table, naming the field", () => {
    // Criterion: `display` is READ-ONLY and cannot become writable by being
    // listed. The refusal is the ordinary one — the column is not in
    // `editable` — which is the same refusal `events.performers` gets.
    const displayed = Object.values(EDIT_CONFIG).flatMap((config) =>
      config.display.map((field) => [config.table, field] as const),
    );
    // Not vacuous: the map really does display something.
    expect(displayed.length).toBeGreaterThan(0);
    for (const [table, field] of displayed) {
      const decision = decideEdit(table, field);
      expect(decision.allowed, `${table}.${field}`).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.kind, `${table}.${field}`).toBe("field_not_editable");
      }
    }
  });

  it("ignores a display list entirely, however it is spelled", () => {
    // A forged config claiming a column is displayed changes no answer:
    // `decideEdit` reads the MAP, and the map's answer comes from `editable`
    // alone.
    expect(isEditable("walk_sandbox", "created_at")).toBe(false);
    expect(isEditable("events", "venue_id")).toBe(false);
    for (const config of Object.values(EDIT_CONFIG)) {
      for (const column of config.display) {
        expect(isEditable(config.table, column), column).toBe(false);
      }
    }
  });

  it("refuses a table the map does not carry, naming the table", () => {
    for (const table of [
      // The two Ben struck lead the list: after 2026-09-08 they are unknown
      // tables to this map, exactly like the archive and the app-owned ones.
      "groups",
      "idols",
      "event_performers",
      "scraped_events",
      "events_legacy",
      "admin_allowed_emails",
      "profiles",
      "",
      "groups; drop table groups",
    ]) {
      const decision = decideEdit(table, "name");
      expect(decision.allowed, table).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.kind).toBe("unknown_table");
      }
    }
    expect(editConfigFor("event_performers")).toBeNull();
  });

  it("is not fooled by a name inherited from Object.prototype", () => {
    // `EDIT_CONFIG["constructor"]` is truthy on a bare object literal; a
    // lookup that trusted it would hand a function to the write path.
    for (const table of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(editConfigFor(table), table).toBeNull();
      expect(isEditable(table, "name"), table).toBe(false);
    }
    for (const field of ["constructor", "toString", "__proto__"]) {
      expect(isEditable("walk_sandbox", field), field).toBe(false);
    }
  });
});

/* ── the source tree ──────────────────────────────────────────────────────── */

/*
 * The walk and the two readers are `tests/offline/source-tree.ts`
 * (admin-window/BUG-0032). They used to be a private copy here, hardened
 * against the probe `db/layering.test.ts` writes and deletes under the source
 * tree in a parallel worker; two sibling files carried the same copy
 * UNhardened and reddened on it. One copy now, with the same behaviour this
 * file already relied on: dot- and double-underscore-prefixed names skipped,
 * a vanished path skipped, everything else read exactly as before.
 */

function filesWhereCodeMatches(pattern: RegExp, base: string = repoRoot): string[] {
  return sourceFiles(base).filter((file) =>
    codeLines(file, base).some((line) => pattern.test(line)),
  );
}

describe("there is no second allowlist", () => {
  it("contains the modules these rules are about", () => {
    const files = sourceFiles();
    for (const file of [
      CONFIG_MODULE,
      RECORDS_MODULE,
      ROUTE_MODULE,
      PAGE_MODULE,
      FIELDS_MODULE,
    ]) {
      expect(files, file).toContain(file);
    }
  });

  it("declares the map in config.ts alone, and reads it in its consumers", () => {
    // The write path (route, data layer) and the surface (page, fields) — and
    // nothing else. A fifth file matching this is a second allowlist growing.
    expect(filesWhereCodeMatches(/EDIT_CONFIG|decideEdit|editConfigFor/)).toEqual([
      ROUTE_MODULE,
      RECORDS_MODULE,
      CONFIG_MODULE,
      PAGE_MODULE,
      FIELDS_MODULE,
    ].sort());
  });

  it("spells no allowlist of column names outside the map", () => {
    // The retired routes' shape: a per-table set of field literals inside the
    // route. Its return in any file is the defect this rule exists for.
    expect(filesWhereCodeMatches(/ALLOWED_FIELDS|allowedFields|EDITABLE_FIELDS/)).toEqual([]);
  });

  it("keeps config.ts a pure leaf that imports nothing", () => {
    // ARCHITECTURE §4 rule 7: the leaf reaches no database, not even by a
    // type-only import, so no directory-level cycle can be written into it.
    const imports = codeLines(CONFIG_MODULE).filter((line) =>
      /^\s*import\b|\brequire\s*\(|\bfrom\s+["']/.test(line),
    );
    expect(imports).toEqual([]);
  });
});

/* ── writing a named column ───────────────────────────────────────────────── */

/**
 * The column whose WRITE is forbidden and whose READ is required: `admin_locked`
 * on `field_provenance`, which spec §8 asks the provenance display to show
 * ("admin-set Jun 12" — admin stickiness visible at the fact).
 */
const ADMIN_LOCKED = "admin_locked";

/** The verbs that write through PostgREST. A `.select(` read is not one. */
const WRITE_VERB = /\.(?:update|upsert|insert)\(/;

/** Files with one CODE LINE carrying both the column name and a write verb. */
function filesWithWriteLineNaming(column: string, base: string = repoRoot): string[] {
  const named = new RegExp(column);
  return filesWhereCodeMatches(named, base).filter((file) =>
    codeLines(file, base).some((line) => named.test(line) && WRITE_VERB.test(line)),
  );
}

/**
 * The write verbs as the PARSER sees them: a call whose callee is a property
 * access spelling one of these names. `WRITE_VERB` above asks the same
 * question of one code LINE, which is all the ruled line pin needs.
 */
const WRITE_VERBS = new Set(["update", "upsert", "insert"]);

/**
 * The file, parsed by TypeScript's own parser (admin-window/BUG-0030, third
 * round, on the architect's ruling of 2026-09-02).
 *
 * The three rounds before this one hand-rolled a lexer here, and each fix
 * closed the case in front of it and opened the next: "is this `/` a division
 * or a pattern, is this backtick a template or text" is not a corner of the
 * grammar, it is the grammar. `typescript` is already a devDependency of this
 * repo, so strings, comments, template literals, interpolations and patterns
 * are now decided by construction instead of by heuristic, and the question
 * the scan actually asks — does a write verb RECEIVE this column — is asked of
 * the syntax tree rather than of text.
 *
 * `setParentNodes` is on because `node.getText(source)` needs it. A `.tsx`
 * file is parsed as TSX: `sourceFiles()` walks `.tsx`, and one parsed as TS
 * reports parse errors that rule below would turn into a report of the whole
 * file.
 */
function parse(file: string, base: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    sourceText(file, base),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * What the parser could not read. `parseDiagnostics` exists at runtime and is
 * `@internal` in typescript's own `.d.ts`, so it is reached through a cast —
 * `unknown`-based, never `any`.
 */
function parseErrors(source: ts.SourceFile): readonly ts.Diagnostic[] {
  return (source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics ?? [];
}

/**
 * Parsed, and read a SECOND time if the first read did not parse.
 *
 * A file the parser cannot see into is REPORTED rather than skipped (below),
 * and a half-written file would therefore be a red that has nothing to do with
 * the rule: another suite plants and removes a probe under `src/` while this
 * one runs in a parallel worker (admin-window/BUG-0020, BUG-0029). So a parse
 * error is re-read once and the second result is used. Neither read fails
 * open: a genuinely unparseable file fails both, while a torn one either comes
 * back whole (correct silence) or torn again (correct over-report).
 */
function parsed(file: string, base: string): ts.SourceFile {
  const first = parse(file, base);
  return parseErrors(first).length === 0 ? first : parse(file, base);
}

/**
 * Every write CALL in the file: a `CallExpression` whose callee is a property
 * access named by `WRITE_VERBS`. This is what makes
 * `.update(values).select("… admin_locked …")` safe by construction — the
 * `.select(` is a different call, not an argument of the write, so a READ can
 * no longer be reported by accident (admin-window/BUG-0028).
 */
function forEachWriteCall(source: ts.SourceFile, see: (call: ts.CallExpression) => void): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_VERBS.has(node.expression.name.text)
    ) {
      see(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/**
 * Does this ARGUMENT of a write call name the column?
 *
 * A payload object is read by its property NAMES and recursed into, so a
 * nested payload and a computed key spelling the column are both seen. A
 * string or template literal is deliberately NOT matched: a column named in
 * prose inside a payload is not a write of it, which is what the case "does
 * not report the column when only a payload string names it" pins.
 *
 * Everything else — an identifier, a call, a conditional, an `as` — falls back
 * to its source text, which is the over-report direction on purpose:
 * `update(buildPayload({ admin_locked: true }))` is reported, while
 * `update(values)` is not, because nothing there spells the column.
 */
function namesColumn(node: ts.Node, column: string, source: ts.SourceFile): boolean {
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      const name = property.name;
      if (name !== undefined) {
        const spelled = ts.isComputedPropertyName(name)
          ? name.expression.getText(source)
          : ts.isIdentifier(name) || ts.isPrivateIdentifier(name)
            ? name.text
            : name.getText(source);
        if (spelled.includes(column)) return true;
      }
      if (ts.isPropertyAssignment(property)) {
        return namesColumn(property.initializer, column, source);
      }
      if (ts.isSpreadAssignment(property)) {
        return namesColumn(property.expression, column, source);
      }
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => namesColumn(element, column, source));
  }
  if (ts.isParenthesizedExpression(node)) {
    return namesColumn(node.expression, column, source);
  }
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) return false;
  return node.getText(source).includes(column);
}

/**
 * The source text of every argument of every write call in a file. Only what
 * is passed TO the verb is returned, so `.update(values).select("… admin_locked
 * …")` yields `values` — a read chained onto a write is not a write of that
 * column.
 *
 * It keeps its name and its shape because "extracts the argument of the one
 * real write in this repo" asserts on it: an empty result there would mean the
 * ARGUMENT pin was vacuously green everywhere. The pin itself no longer
 * decides from this text — it decides from `namesColumn` over the argument
 * NODES.
 */
function writeArguments(file: string, base: string = repoRoot): string[] {
  const source = parsed(file, base);
  const args: string[] = [];
  forEachWriteCall(source, (call) => {
    for (const argument of call.arguments) args.push(argument.getText(source));
  });
  return args;
}

/**
 * Files that pass the column to a write verb, however the payload is laid out.
 *
 * Every source file is asked, not only those `filesWhereCodeMatches` reports:
 * that pre-filter reads the file line by line and drops a whole line whose
 * trimmed form starts with `/*`, and a payload key can share its line with a
 * leading comment (admin-window/BUG-0030, second round). A cheaper scan that
 * cannot see part of the tree is not cheaper.
 *
 * A file with ANY parse diagnostic is reported without further inspection: a
 * file the scan cannot see into is a file it may not stay silent about. Over-
 * reporting is a red a reader can see; a miss is the fail-open this ticket
 * exists to forbid.
 */
function filesWritingColumn(column: string, base: string = repoRoot): string[] {
  return sourceFiles(base).filter((file) => {
    const source = parsed(file, base);
    if (parseErrors(source).length > 0) return true;
    let writes = false;
    forEachWriteCall(source, (call) => {
      if (call.arguments.some((argument) => namesColumn(argument, column, source))) writes = true;
    });
    return writes;
  });
}

/**
 * The tables a write call NAMES in its own chain: `db.from("events").update(…)`
 * yields `events`.
 *
 * Walks down the callee chain of the write call, collecting the literal
 * argument of every `.from(` on it. A `.from(config.table)` names no literal
 * and is reported as none — that dynamic case is proved where it can be
 * proved, at the data layer, by `tests/offline/edit/records.test.ts`
 * ("refuses the map's own config for a resolver-owned table"): the one
 * `.update(` in this repo issues no query at all unless the write path is
 * `direct`. This pin is the other half — a write aimed at a resolver-owned
 * table by NAME, which is the shape a second write path would take.
 */
function tablesWrittenIn(file: string, base: string = repoRoot): string[] {
  const source = parsed(file, base);
  const named: string[] = [];
  forEachWriteCall(source, (call) => {
    let node: ts.Node = call.expression;
    while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "from"
      ) {
        const argument = node.arguments[0];
        if (argument !== undefined && ts.isStringLiteralLike(argument)) {
          named.push(argument.text);
        }
      }
      node = node.expression;
    }
  });
  return named;
}

/** Files with a write call whose chain names one of `tables`. */
function filesWritingTable(
  tables: readonly string[],
  base: string = repoRoot,
): string[] {
  return sourceFiles(base).filter((file) =>
    tablesWrittenIn(file, base).some((table) => tables.includes(table)),
  );
}

describe("the write surface of the whole repo", () => {
  const DATA_LAYER = (file: string) =>
    file.startsWith("src/lib/db/") || file.startsWith("src/app/api/");

  it("inserts, upserts and deletes nothing anywhere under src", () => {
    // No catalog row is created or destroyed from Admin (spec §8, AGENTS.md).
    // `.delete(` is scanned in the data and route layers only: on a Set or a
    // Map it is an ordinary call and would be a false red elsewhere.
    expect(filesWhereCodeMatches(/\.insert\(|\.upsert\(/)).toEqual([]);
    expect(filesWhereCodeMatches(/\.delete\(/).filter(DATA_LAYER)).toEqual([]);
  });

  it("calls a database procedure from exactly one module", () => {
    // INVERTED for M2 (campaign admin-window/TASK-0048). Through M1 this read
    // `toEqual([])`: nothing settled anything, so nothing called a procedure.
    // M2 settles a review item through ONE call to `settle_review_item`
    // (ARCHITECTURE.md §9.2), so the rule is no longer "none" but "one, and
    // this one" — a second `.rpc(` anywhere under `src/` is the defect, and it
    // is a defect whether it is a second settlement path or a probe.
    //
    // Exact equality, not a filter: the list is the whole answer, so the day
    // the seam stops calling the procedure this reddens too rather than
    // passing on an empty tree.
    expect(filesWhereCodeMatches(/\.rpc\(/)).toEqual([VERDICT_MODULE]);
  });

  it("writes the database from exactly one module", () => {
    // Every write in this app goes through `updateRecordField`, which consults
    // the map before it builds a query. One module is what makes that true of
    // the repo and not merely of the route.
    expect(filesWhereCodeMatches(/\.update\(/)).toEqual([RECORDS_MODULE]);
  });

  it("builds no write of any kind aimed at events or venues, and says so on a probe that does", () => {
    // FEAT-0011 criterion 4. Fixture 1 — the shipped tree — must not be
    // flagged: no `.update(`, `.insert(`, `.upsert(` or `.delete(` anywhere
    // under `src/` names a resolver-owned table.
    expect(filesWritingTable(RESOLVER_OWNED)).toEqual([]);

    // Fixture 2 — a mirror tree carrying exactly that write, plus a READ of
    // the same table, which must NOT be flagged. Without both halves the
    // assertion above has never seen an input it should reject, and a guard
    // that flagged the read would forbid the record page (LESSONS 3).
    const probeBase = path.join(
      repoRoot,
      "tests",
      ".probes",
      `resolver-write-${process.pid}`,
    );
    const WRITE_PROBE = "src/lib/db/override-shortcut.ts";
    const READ_PROBE = "src/lib/db/read-the-event.ts";
    let flagged: string[] = [];
    let walked: string[] = [];
    try {
      for (const [file, source] of [
        [
          WRITE_PROBE,
          "export function shortcut(db: Db, id: string, title: string) {\n" +
            '  return db.from("events").update({ title }).eq("event_id", id);\n' +
            "}\n",
        ],
        [
          READ_PROBE,
          "export function readEvent(db: Db, id: string) {\n" +
            '  return db.from("events").select("event_id, title").eq("event_id", id);\n' +
            "}\n",
        ],
      ] as const) {
        const full = path.join(probeBase, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, source, "utf8");
      }
      walked = sourceFiles(probeBase);
      flagged = filesWritingTable(RESOLVER_OWNED, probeBase);
    } finally {
      fs.rmSync(probeBase, { force: true, recursive: true });
    }
    expect(walked).toEqual([WRITE_PROBE, READ_PROBE].sort());
    expect(flagged).toEqual([WRITE_PROBE]);
    expect(fs.existsSync(probeBase)).toBe(false);
  });

  it("carries no pre_cutover anywhere under src — the identifier is gone", () => {
    // FEAT-0011 criterion 7: `pre_cutover` is gone as a concept AND as an
    // identifier (Ben's strike, 2026-09-08). Not vacuous — the scanner finds
    // the identifiers that ARE there (the case above and the map's own regime
    // names), and this asks it for one that must not be.
    expect(filesWhereCodeMatches(/pre_cutover/)).toEqual([]);
    expect(filesWhereCodeMatches(/regime: "sandbox"|"sandbox"/)).toContain(CONFIG_MODULE);
  });

  it("mentions no raw-archive or legacy table under src", () => {
    expect(filesWhereCodeMatches(/scraped_events|_legacy\b/)).toEqual([]);
  });

  it("builds no write path to a resolver-owned table or a link table", () => {
    // `event_performers` appears in `tables.ts` for reads; nothing else may
    // name it, and no module may special-case events or venues for writing.
    expect(filesWhereCodeMatches(/event_performers/)).toEqual(["src/lib/db/tables.ts"]);

    // `apply_resolution` stays banned by NAME, permanently: it EXISTS on
    // staging today and it WRITES the catalog. Its name on a code line under
    // `src/` can only be a call, and Admin never makes that call — the
    // resolver does. This is why `tables.ts` declines to spell it: an
    // unspellable name cannot be called through the seam either.
    expect(filesWhereCodeMatches(/apply_resolution/)).toEqual([]);

    // `settle_review_item` is INVERTED for M2 (admin-window/TASK-0048): it is
    // Admin's one entry point now, so the rule is where it may be spelled, not
    // whether. `tables.ts` holds the name (§4 rule 4 — the not-provisioned card
    // must name the same string the call used) and the seam may spell it too;
    // no third file may, and a page building its own call is what that catches.
    const SETTLE_NAME_MAY_APPEAR_IN = [TABLES_MODULE, VERDICT_MODULE];
    const settleSpellers = filesWhereCodeMatches(/settle_review_item/);
    // Not vacuous: the name IS spelled, in the registry, on a code line.
    expect(settleSpellers).toContain(TABLES_MODULE);
    expect(
      settleSpellers.filter((file) => !SETTLE_NAME_MAY_APPEAR_IN.includes(file)),
    ).toEqual([]);

    // `admin_locked` is a COLUMN, not an action, and this case is about WRITES.
    // Narrowed 2026-09-02 (architect ruling, admin-window/BUG-0028): the old
    // predicate banned the NAME, which banned READING it too — and spec §8
    // requires that read. Two pins replace it, neither of which touches a read.

    // 1. The column is in no `editable` list, so the one write path cannot
    //    carry it: the route and `updateRecordField` both decide from this map,
    //    and `.update(` lives in `records.ts` alone (the case above). A value
    //    assertion over the imported map, not a scan of text.
    for (const [table, config] of Object.entries(EDIT_CONFIG)) {
      expect(config.editable, table).not.toContain(ADMIN_LOCKED);
    }

    // 2. The only other shape — a hand-built payload naming the column beside a
    //    write verb. Pinned on the code LINE as ruled, and again on the verb's
    //    whole balanced ARGUMENT, because a payload split over lines
    //    (`.update({\n  admin_locked: true,\n})` — what Prettier produces)
    //    carries the name and the verb on different lines and would slip a
    //    line-wise scan. Both are blind to `.select("… admin_locked …")`;
    //    "the admin_locked write guard itself" below proves that against a
    //    mirror tree carrying all three shapes.
    expect(filesWithWriteLineNaming(ADMIN_LOCKED)).toEqual([]);
    expect(filesWritingColumn(ADMIN_LOCKED)).toEqual([]);
  });
});

/**
 * The guard guarding itself (the technique `tests/offline/db/layering.test.ts`
 * uses for its credential scanner, and `tests/offline/review/one-place.test.ts`
 * for the M2-close guard). The narrowed rule above is only worth its green if
 * its two pins actually report the write they forbid AND actually let the read
 * spec §8 requires through — a rule that is green because it can see nothing
 * is not a rule.
 *
 * The probe tree is a MIRROR of `src/` under `tests/.probes/`, never files
 * written into the real `src/`: three other offline suites walk that tree in
 * parallel and a probe deleted between their readdir and their read reddens a
 * stranger's suite (measured on admin-window/BUG-0020). The walker, both pins
 * and the planted map below are the same functions the rule uses — only the
 * base directory differs.
 */
describe("the admin_locked write guard itself", () => {
  const probeBase = path.join(repoRoot, "tests", ".probes", `admin-locked-${process.pid}`);

  /** The provenance display spec §8 asks for: a read, and nothing else. */
  const READ_PROBE = "src/lib/records/provenance.ts";
  /** A write of the column on one line. */
  const WRITE_LINE_PROBE = "src/lib/db/stamp-inline.ts";
  /** The same write with the payload split over lines, as Prettier lays it out. */
  const WRITE_SPREAD_PROBE = "src/lib/db/stamp-spread.ts";
  /** A write of something else that READS the column back — still not a write of it. */
  const CHAINED_READ_PROBE = "src/lib/db/update-then-read.ts";

  const SOURCES: ReadonlyArray<readonly [string, string]> = [
    [
      READ_PROBE,
      "export function readProvenance(db: Db, id: string) {\n" +
        "  return db\n" +
        '    .from("field_provenance")\n' +
        '    .select("field, value, admin_locked, decided_at")\n' +
        '    .eq("entity_id", id);\n' +
        "}\n",
    ],
    [
      WRITE_LINE_PROBE,
      "export function stamp(db: Db, id: string) {\n" +
        '  return db.from("field_provenance").update({ admin_locked: true }).eq("id", id);\n' +
        "}\n",
    ],
    [
      WRITE_SPREAD_PROBE,
      "export function stamp(db: Db, id: string) {\n" +
        '  return db.from("field_provenance").update({\n' +
        "    admin_locked: true,\n" +
        "  })\n" +
        '    .eq("id", id);\n' +
        "}\n",
    ],
    [
      CHAINED_READ_PROBE,
      "export function editThenShow(db: Db, id: string) {\n" +
        "  return db\n" +
        '    .from("groups")\n' +
        '    .update({ company: "x" })\n' +
        '    .eq("id", id)\n' +
        '    .select("company, admin_locked");\n' +
        "}\n",
    ],
  ];

  it("reports each write of the column and neither read of it", () => {
    let walked: string[] = [];
    let named: string[] = [];
    let byLine: string[] = [];
    let byArgument: string[] = [];
    try {
      for (const [file, source] of SOURCES) {
        const full = path.join(probeBase, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, source, "utf8");
      }
      walked = sourceFiles(probeBase);
      named = filesWhereCodeMatches(new RegExp(ADMIN_LOCKED), probeBase);
      byLine = filesWithWriteLineNaming(ADMIN_LOCKED, probeBase);
      byArgument = filesWritingColumn(ADMIN_LOCKED, probeBase);
    } finally {
      fs.rmSync(probeBase, { force: true, recursive: true });
    }

    // The mirror is the whole world the scan saw, so nothing below is an
    // accident of the real tree.
    expect(walked).toEqual(SOURCES.map(([file]) => file).sort());

    // The scanner does see all four files name the column on a code line: the
    // pins' green is a decision about writes, not blindness to the word.
    expect(named).toEqual(walked);

    // The ruled LINE pin catches the write written on one line...
    expect(byLine).toEqual([WRITE_LINE_PROBE]);
    // ...and the ARGUMENT pin catches that one and the one split over lines,
    // which is why the rule asserts both.
    expect(byArgument).toEqual([WRITE_LINE_PROBE, WRITE_SPREAD_PROBE].sort());

    // Neither pin touches a READ — the whole point of admin-window/BUG-0028.
    // A bare `.select("… admin_locked …")` and a select chained onto an update
    // of another column both pass, so the spec §8 provenance display can be
    // built without renaming the column it displays.
    for (const reported of [byLine, byArgument]) {
      expect(reported).not.toContain(READ_PROBE);
      expect(reported).not.toContain(CHAINED_READ_PROBE);
    }
  });

  it("reports an editable list that carries the column", () => {
    // The rule's strong pin is a value assertion over EDIT_CONFIG. Here it is,
    // the same expression, over a map where the column HAS been planted: it
    // must throw, naming the table and the column.
    const planted = {
      field_provenance: {
        table: "field_provenance",
        pk: "field_provenance_id",
        regime: "pre_cutover",
        editable: ["value", ADMIN_LOCKED],
      },
    };
    expect(() => {
      for (const [table, config] of Object.entries(planted)) {
        expect(config.editable, table).not.toContain(ADMIN_LOCKED);
      }
    }).toThrow(/admin_locked/);
    // And the real map, unplanted, carries it nowhere — the rule's own green.
    expect(
      Object.values(EDIT_CONFIG).flatMap((config) => [...config.editable]),
    ).not.toContain(ADMIN_LOCKED);
  });

  it("extracts the argument of the one real write in this repo", () => {
    // If `writeArguments` returned nothing on a file that does write, the
    // ARGUMENT pin would be vacuously green everywhere.
    expect(writeArguments(RECORDS_MODULE).length).toBeGreaterThan(0);
  });

  it("leaves no probe behind for another suite to walk into", () => {
    // The `finally` above must hold even when its assertions fail.
    expect(fs.existsSync(probeBase)).toBe(false);
  });
});

/**
 * The argument scan and STRING LITERALS (admin-window/BUG-0030, found by
 * admin-window/BUG-0028's QA). The scan used to find where a payload ends by
 * counting parentheses in the raw text: a parenthesis inside a payload string
 * moved that boundary, and the rule broke in BOTH directions — an unclosed `(`
 * ran the argument past the real `)` and swallowed a later pure READ, and a
 * `)` truncated a real WRITE out of sight. Three rounds of hand-written lexing
 * later, an argument now ends where the PARSER says it ends, and every case
 * below is a shape that a text scan got wrong and a syntax tree cannot.
 * Every case drives the same `filesWritingColumn` the rule above calls,
 * against a mirror tree of its own that is planted and removed here — never a
 * file written into the real `src/` (three offline suites walk that tree in
 * parallel; admin-window/BUG-0020).
 */
describe("the argument scan and string literals", () => {
  let planted = 0;

  /** Plants a mirror tree, reads it through the real pins, removes it. */
  function withProbes<T>(
    sources: ReadonlyArray<readonly [string, string]>,
    read: (base: string) => T,
  ): T {
    planted += 1;
    const base = path.join(repoRoot, "tests", ".probes", `strings-${process.pid}-${planted}`);
    try {
      for (const [file, source] of sources) {
        const full = path.join(base, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, source, "utf8");
      }
      return read(base);
    } finally {
      fs.rmSync(base, { force: true, recursive: true });
    }
  }

  it("does not report a READ that follows a payload string opening a paren", () => {
    const reported = withProbes(
      [
        [
          "src/read-after-write.ts",
          "export const a = (db: Db) =>\n" +
            '  db.from("groups").update({ note: "opens ( here" }).eq("id", 1);\n' +
            "export const b = (db: Db) =>\n" +
            '  db.from("field_provenance").select("field, admin_locked");\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    // The "(" is inside a string, so the payload ends at its own ")" and the
    // READ underneath it is nobody's argument. Reporting it would be
    // admin-window/BUG-0028's defect again, narrowed to files that also write.
    expect(reported).toEqual([]);
  });

  it("reports a WRITE whose payload string closes a paren", () => {
    const reported = withProbes(
      [
        [
          "src/stamp.ts",
          "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            '    note: "set by admin :)",\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    // The ")" is inside a string, so the payload runs on to its own
    // `admin_locked` — a forbidden write of a resolver-owned column, and the
    // payload is wrapped, so this pin is the only one that can see it.
    expect(reported).toEqual(["src/stamp.ts"]);
  });

  it("reports a WRITE whose payload string escapes its own quote", () => {
    const reported = withProbes(
      [
        [
          "src/stamp-escaped.ts",
          "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            '    note: "he said \\"stop )\\" (twice",\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    // The escaped quotes do not end the string, so neither parenthesis inside
    // it is counted and the payload still reaches the column.
    expect(reported).toEqual(["src/stamp-escaped.ts"]);
  });

  it("reads a template literal as a literal, its ${} interpolations as code", () => {
    const reported = withProbes(
      [
        [
          "src/stamp-template.ts",
          "export const stamp = (db: Db, id: string, who: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            "    note: `set by ${who.replace(\"(\", \")\")} — ${`nested ) ${who}`} :)`,\n" +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
        [
          "src/read-after-template.ts",
          "export const a = (db: Db, who: string) =>\n" +
            '  db.from("groups").update({ note: `opens ( for ${who}` }).eq("id", 1);\n' +
            "export const b = (db: Db) =>\n" +
            '  db.from("field_provenance").select("field, admin_locked");\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    // Both halves of the nesting matter: the literal chunks (`:)`, `nested )`,
    // `opens (`) are text and move nothing, while the interpolation is code
    // again, so `.replace("(", ")")`'s own parentheses balance as they should.
    expect(reported).toEqual(["src/stamp-template.ts"]);
  });

  it("reads a regex literal in a payload as a literal", () => {
    const reported = withProbes(
      [
        [
          "src/stamp-regex.ts",
          "export const stamp = (db: Db, id: string, raw: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            '    note: raw.replace(/\\)/g, ""),\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    // The ")" in `/\)/` is a pattern, not a bracket; counted, it would end the
    // argument at the `.replace(` call and hide the column two lines below.
    expect(reported).toEqual(["src/stamp-regex.ts"]);
  });

  it("does not report the column when only a payload string names it", () => {
    const [reported, args] = withProbes(
      [
        [
          "src/note-about-locking.ts",
          "export const note = (db: Db, id: string) =>\n" +
            '  db.from("groups").update({\n' +
            '    note: "admin_locked is set by the resolver, never here",\n' +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) =>
        [
          filesWritingColumn(ADMIN_LOCKED, base),
          writeArguments("src/note-about-locking.ts", base),
        ] as const,
    );
    // A column NAMED in prose inside a payload is not a write of it: a string
    // literal is the one argument shape `namesColumn` deliberately does not
    // match, for the same reason a parenthesis inside one is not a bracket.
    // The write call itself IS found, which is what keeps this case a decision
    // about the payload rather than blindness to the whole call
    // (admin-window/BUG-0030, third round: the old
    // `expect(argument).not.toContain(ADMIN_LOCKED)` asserted that the string's
    // text had been blanked out of the extracted argument, and nothing is
    // blanked any more — the argument is now the source text of the node).
    expect(reported).toEqual([]);
    expect(args).toHaveLength(1);
    expect(args[0]).toContain("note:");
  });

  it(
    "reports a WRITE below a template literal whose closing backtick lands on a comment-stripped line",
    () => {
      // Valid, compiling TypeScript. `codeLines` drops any line whose trimmed
      // form starts with "*" as commentary, and here that line carries the
      // template's CLOSING backtick — so a scan that read the file through
      // that filter lost the closer and the write three lines below vanished
      // with it (admin-window/BUG-0030, second round: the silent fail-open
      // direction the contract excludes). The parser reads the whole file and
      // no line filter stands between it and this template, which spans two
      // lines like any other multi-line literal.
      const reported = withProbes(
        [
          [
            "src/bullets.ts",
            "export const BULLETS = `first line\n" +
              "  *`;\n" +
              "\n" +
              "export const stamp = (db: Db, id: string) =>\n" +
              '  db.from("field_provenance").update({\n' +
              "    admin_locked: true,\n" +
              '  }).eq("id", id);\n',
          ],
        ],
        (base) => filesWritingColumn(ADMIN_LOCKED, base),
      );
      expect(reported).toEqual(["src/bullets.ts"]);
    },
  );

  it("over-reports rather than blinding itself when a QUOTED string cannot be closed", () => {
    // The same predicament for a double-quoted literal: a line-continued string
    // whose closing quote sits on a line `codeLines` strips. The title is kept
    // from the rounds when a lexer had to choose whether to blind itself here;
    // there is nothing to over-report any more, because this parses cleanly —
    // `\` before a newline continues a string — so the write below it is
    // found structurally and reporting the file is simply TRUE
    // (admin-window/BUG-0030, third round).
    const reported = withProbes(
      [
        [
          "src/bullets-quoted.ts",
          'export const BULLETS = "first line \\\n' +
            '  *";\n' +
            "\n" +
            "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    expect(reported).toEqual(["src/bullets-quoted.ts"]);
  });

  it("over-reports rather than blinding itself when a TEMPLATE cannot be closed", () => {
    // A backtick with no partner anywhere: this file does not parse. It is
    // reported for exactly that reason — a file the scan cannot see into is a
    // file it may not stay silent about — rather than through a lexer's
    // give-up path (admin-window/BUG-0030, third round). The bar the title
    // names is unchanged and is the point: over-report, never a silent miss.
    const reported = withProbes(
      [
        [
          "src/unterminated.ts",
          "export const ODD = ` no partner for this one;\n" +
            "\n" +
            "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    expect(reported).toEqual(["src/unterminated.ts"]);
  });

  it("reports a WRITE on a payload line that opens with a block comment", () => {
    // Valid TypeScript, and the other half of the same root: `codeLines` drops
    // a whole line whose trimmed form starts with "/*" — comment and code
    // alike — so a payload key sharing its line with a leading comment is lost
    // to any scan that reads the file through that filter. The wrapped payload
    // hides it from the line pin too, so this is the fail-open direction again.
    // Parsing the RAW file, and asking every file rather than only the ones a
    // filtered scan can see the name in, is what reports it.
    const reported = withProbes(
      [
        [
          "src/commented-payload.ts",
          "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            "    /* legacy */ admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    expect(reported).toEqual(["src/commented-payload.ts"]);
  });

  it("reports a WRITE under a backtick that is only ever mentioned in a comment", () => {
    // A backtick inside commentary opens nothing: the parser knows a comment
    // from a literal, whole, wherever the comment starts. Both shapes the line
    // filter used to handle for it are here — a trailing "//" and a block
    // comment opened mid-line — and neither may swallow the write beneath.
    const reported = withProbes(
      [
        [
          "src/commented-backtick.ts",
          "export const NOTE = 1; // a stray ` and a ) in a trailing comment\n" +
            "const other = 2; /* another ` and ( in a block comment */\n" +
            "\n" +
            "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n',
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    expect(reported).toEqual(["src/commented-backtick.ts"]);
  });

  it("reports a WRITE between a regex literal holding a backtick and a later template", () => {
    // Valid, strict-compiling TypeScript: `tsc --noEmit --strict` exits 0 on
    // this exact source. Deciding a `/` from the ONE character before it — the
    // third round's bounce — read this regex as a division, because neither
    // `=>` nor `return` ends in a character a pattern may follow; the backtick
    // inside it then opened a "template" that found a partner in the ordinary
    // template literal at the foot of the file, and the wrapped write between
    // them was erased. Silent, and the line pin misses a wrapped payload too:
    // the fail-open direction this describe exists to forbid
    // (admin-window/BUG-0030). Where a pattern may legally start is a fact
    // about the grammar, and the parser holds all of it.
    const reported = withProbes(
      [
        [
          "src/tick-regex.ts",
          "export const hasTick = (s: string) => /`/.test(s);\n" +
            "\n" +
            "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n' +
            "\n" +
            "export const label = (n: number) => `${n} rows`;\n",
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    expect(reported).toEqual(["src/tick-regex.ts"]);
  });

  it("reports a WRITE between a regex literal in RETURN position and a later template", () => {
    // The same shape in the other position a predicate is written in: a
    // `return` of a regex from a function body rather than an arrow's
    // expression body (admin-window/BUG-0030, acceptance criterion 3). A regex
    // is a regex wherever one may legally stand, so the backtick inside it
    // opens nothing, and the wrapped write between it and the ordinary
    // template literal below is reported.
    const reported = withProbes(
      [
        [
          "src/tick-return.ts",
          "export function hasTick(s: string) {\n" +
            "  return /`/.test(s);\n" +
            "}\n" +
            "\n" +
            "export const stamp = (db: Db, id: string) =>\n" +
            '  db.from("field_provenance").update({\n' +
            "    admin_locked: true,\n" +
            '  }).eq("id", id);\n' +
            "\n" +
            "export const label = (n: number) => `${n} rows`;\n",
        ],
      ],
      (base) => filesWritingColumn(ADMIN_LOCKED, base),
    );
    expect(reported).toEqual(["src/tick-return.ts"]);
  });

  it("leaves no probe behind for another suite to walk into", () => {
    // Every case above plants under `tests/.probes/` and removes it in a
    // `finally`, so a failing assertion cannot leave a tree for a parallel
    // suite's walker to trip over.
    const probes = path.join(repoRoot, "tests", ".probes");
    const mine = fs.existsSync(probes)
      ? fs.readdirSync(probes).filter((name) => name.startsWith(`strings-${process.pid}-`))
      : [];
    expect(mine).toEqual([]);
  });
});

/**
 * The one-call-site guard, guarding itself (campaign admin-window/TASK-0048,
 * the technique this file already uses for `admin_locked`).
 *
 * The M2 inversion above turned an assertion that was green because nothing
 * called a procedure into one that is green because exactly one module does —
 * and a rule whose scanner cannot SEE a second call would be green for the
 * wrong reason forever. So it is driven over a mirror tree carrying all three
 * shapes: the sanctioned call, a second call in a page, and a file that only
 * talks about calls in a comment.
 *
 * The mirror lives under `tests/.probes/`, never in the real `src/`: three
 * offline suites walk that tree in parallel and a probe deleted between their
 * readdir and their read reddens a stranger's suite (admin-window/BUG-0020).
 */
describe("the one-call-site guard itself", () => {
  const probeBase = path.join(repoRoot, "tests", ".probes", `one-call-${process.pid}`);

  /** The sanctioned call, in the file the rule names. */
  const SEAM_PROBE = "src/lib/db/verdict.ts";
  /** A second call, in a page — the shape the rule exists to catch. */
  const PAGE_PROBE = "src/app/queues/[reviewItemId]/page.tsx";
  /** A file that names both the call and the procedure in a COMMENT only. */
  const COMMENT_PROBE = "src/lib/review/close-note.ts";

  const SOURCES: ReadonlyArray<readonly [string, string]> = [
    [
      SEAM_PROBE,
      "export function settle(db: Db, decision: unknown) {\n" +
        '  return db.rpc("settle_review_item", { p_decision: decision });\n' +
        "}\n",
    ],
    [
      PAGE_PROBE,
      "export default async function Page({ db }: { db: Db }) {\n" +
        '  const { data } = await db.rpc("settle_review_item", { p_decision: {} });\n' +
        "  return data;\n" +
        "}\n",
    ],
    [
      COMMENT_PROBE,
      "/**\n" +
        " * The close slot's note. It never calls the database: the settlement\n" +
        ' * goes through `db.rpc("settle_review_item", …)` in the seam.\n' +
        " */\n" +
        "export function closeNote(text: string): string {\n" +
        "  return text.trim();\n" +
        "}\n",
    ],
  ];

  it("reports the second call and the sanctioned one, and neither comment", () => {
    let walked: string[] = [];
    let callers: string[] = [];
    let spellers: string[] = [];
    try {
      for (const [file, source] of SOURCES) {
        const full = path.join(probeBase, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, source, "utf8");
      }
      walked = sourceFiles(probeBase);
      callers = filesWhereCodeMatches(/\.rpc\(/, probeBase);
      spellers = filesWhereCodeMatches(/settle_review_item/, probeBase);
    } finally {
      fs.rmSync(probeBase, { force: true, recursive: true });
    }

    // The mirror is the whole world the scan saw, so nothing below is an
    // accident of the real tree.
    expect(walked).toEqual(SOURCES.map(([file]) => file).sort());

    // The input the rule MUST flag: on this tree the call-site list is two
    // files, so the real assertion (`toEqual([VERDICT_MODULE])`) fails — and
    // it fails naming the page, which is the message a builder needs.
    expect(callers).toEqual([PAGE_PROBE, SEAM_PROBE].sort());
    expect(callers.filter((file) => file !== SEAM_PROBE)).toEqual([PAGE_PROBE]);

    // The input it must NOT flag: a comment describing the call is not a call.
    // Without this the rule would forbid explaining where settlement happens —
    // common violation 4, four times over in M1.
    expect(callers).not.toContain(COMMENT_PROBE);
    expect(spellers).not.toContain(COMMENT_PROBE);

    // And the NAME rule's own two fixtures: the page spells the procedure
    // where it may not, the seam spells it where it may.
    expect(spellers).toEqual([PAGE_PROBE, SEAM_PROBE].sort());
    expect(
      spellers.filter((file) => ![TABLES_MODULE, VERDICT_MODULE].includes(file)),
    ).toEqual([PAGE_PROBE]);
  });

  it("leaves no probe behind for another suite to walk into", () => {
    expect(fs.existsSync(probeBase)).toBe(false);
  });
});
