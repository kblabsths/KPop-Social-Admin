import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  EDITABLE_TABLES,
  EDIT_CONFIG,
  decideEdit,
  editConfigFor,
  isEditable,
  mappedColumns,
} from "@/lib/edit/config";
import { TABLE_NAMES } from "@/lib/db/tables";
import { codeLines, repoRoot, sourceFiles, sourceText } from "../source-tree";

/**
 * The edit config map — campaign admin-window/TASK-0017, acceptance test 7's
 * pre-cutover half and M1 EC10.
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

/* ── the map ──────────────────────────────────────────────────────────────── */

describe("the map", () => {
  it("carries exactly the four canonical tables, keyed by their own name", () => {
    expect(EDITABLE_TABLES).toEqual(["groups", "idols", "events", "venues"]);
    for (const [key, config] of Object.entries(EDIT_CONFIG)) {
      expect(config.table, key).toBe(key);
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

  it("gives the pre-cutover tables their vetted column sets", () => {
    // The set the retired per-table PATCH routes allowed, carried over
    // unchanged — that is what makes it vetted rather than newly invented.
    expect(EDIT_CONFIG.groups.regime).toBe("pre_cutover");
    expect(EDIT_CONFIG.groups.pk).toBe("id");
    expect([...EDIT_CONFIG.groups.editable]).toEqual([
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
    ]);

    expect(EDIT_CONFIG.idols.regime).toBe("pre_cutover");
    expect(EDIT_CONFIG.idols.pk).toBe("id");
    expect([...EDIT_CONFIG.idols.editable]).toEqual([
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
    ]);
  });

  it("gives the resolver-owned tables their real keys and no editable column", () => {
    for (const table of ["events", "venues"]) {
      const config = EDIT_CONFIG[table];
      expect(config.regime, table).toBe("resolver_owned");
      expect(config.editable, table).toEqual([]);
    }
    // The primary keys the canonical storage migration gave them.
    expect(EDIT_CONFIG.events.pk).toBe("event_id");
    expect(EDIT_CONFIG.venues.pk).toBe("venue_id");
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

  it("gives the resolver-owned tables the display list Ben ruled in", () => {
    // Ben's ruling, 2026-09-02: "a resolver-owned record page shows the
    // columns an operator came to see, read-only" — events: title,
    // description, poster, starts_at, venue; venues: name, city, country,
    // address. Two of those five are shorthand and resolve to the column the
    // database actually has (`poster_url`, `venue_id`); the next case is what
    // proves every name is real.
    expect([...EDIT_CONFIG.events.display]).toEqual([
      "title",
      "description",
      "poster_url",
      "starts_at",
      "venue_id",
    ]);
    expect([...EDIT_CONFIG.venues.display]).toEqual([
      "name",
      "city",
      "country",
      "address",
    ]);
  });

  it("names a real column of that table in every display list", () => {
    for (const table of ["events", "venues"]) {
      const columns = CANONICAL_COLUMNS[table];
      expect(columns, table).toContain(EDIT_CONFIG[table].pk);
      for (const column of EDIT_CONFIG[table].display) {
        expect(columns, `${table}.${column}`).toContain(column);
      }
    }
  });

  it("leaves the pre-cutover tables no display list — they edit their columns", () => {
    // Their columns are already on screen through `editable`; a name in both
    // would be one line drawn once either way, and the empty list is what
    // says "nothing extra to show" rather than "not decided yet".
    for (const table of ["groups", "idols"]) {
      expect([...EDIT_CONFIG[table].display], table).toEqual([]);
      expect(EDIT_CONFIG[table].editable.length, table).toBeGreaterThan(0);
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

  it("lists no id, key, timestamp, link or json column as editable", () => {
    // "user-facing fields only: never ids, keys or timestamps" (spec §8). The
    // patterns are the shapes those columns take in this schema.
    const forbidden = [
      /^id$/,
      /_id$/,
      /_at$/,
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
      table: "groups",
      pk: "id",
      regime: "pre_cutover",
      editable: ["name", "company"],
      display: ["company", "id", "bio"],
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
    const decision = decideEdit("groups", "company");
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.edit.field).toBe("company");
      expect(decision.edit.config).toBe(EDIT_CONFIG.groups);
    }
    expect(isEditable("idols", "mbti")).toBe(true);
  });

  it("refuses a column the map does not carry, naming the field", () => {
    // `fanclub_name` and `spotify_id` are real, writable columns of `groups`
    // that the vetted set leaves out — the route could technically reach them,
    // and the map is what stops it (spec §8).
    for (const field of ["fanclub_name", "spotify_id", "wikipedia_url"]) {
      const decision = decideEdit("groups", field);
      expect(decision.allowed, field).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.kind).toBe("field_not_editable");
        expect(decision.refusal.message).toContain(field);
        expect(decision.refusal.message).toContain("groups");
      }
    }
  });

  it("refuses an id, key or timestamp column spelled correctly", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["groups", "id"],
      ["groups", "created_at"],
      ["groups", "updated_at"],
      ["idols", "id"],
      ["idols", "group_id"],
      ["idols", "profile_image_id"],
      ["idols", "last_synced_at"],
    ];
    for (const [table, field] of cases) {
      const decision = decideEdit(table, field);
      expect(decision.allowed, `${table}.${field}`).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.kind).toBe("field_not_editable");
        expect(decision.refusal.message).toContain(field);
      }
    }
  });

  it("refuses a resolver-owned table, whatever the column", () => {
    // Including columns that really exist on them, and the link columns that
    // are rows elsewhere rather than fields here.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["events", "title"],
      ["events", "description"],
      ["events", "starts_at"],
      ["events", "venue_id"],
      ["events", "performers"],
      ["venues", "name"],
      ["venues", "city"],
    ];
    for (const [table, field] of cases) {
      const decision = decideEdit(table, field);
      expect(decision.allowed, `${table}.${field}`).toBe(false);
      if (!decision.allowed) {
        expect(decision.refusal.kind).toBe("resolver_owned");
        expect(decision.refusal.message).toContain(table);
      }
    }
  });

  it("refuses every displayed column of every table, as resolver-owned", () => {
    // Criterion: `display` is READ-ONLY and cannot become writable by being
    // listed. The refusal is the table's regime, not a special case for the
    // list — the same refusal `events.performers` gets.
    for (const table of ["events", "venues"]) {
      const display = EDIT_CONFIG[table].display;
      expect(display.length, table).toBeGreaterThan(0);
      for (const field of display) {
        const decision = decideEdit(table, field);
        expect(decision.allowed, `${table}.${field}`).toBe(false);
        if (!decision.allowed) {
          expect(decision.refusal.kind).toBe("resolver_owned");
        }
      }
    }
  });

  it("ignores a display list entirely, however it is spelled", () => {
    // A forged config claiming a column is displayed — or a pre-cutover table
    // whose display list names a column its allowlist does not — changes no
    // answer: `decideEdit` reads the MAP, and the map's answer comes from
    // `regime` and `editable` alone.
    expect(isEditable("groups", "spotify_id")).toBe(false);
    expect(isEditable("events", "title")).toBe(false);
    for (const config of Object.values(EDIT_CONFIG)) {
      for (const column of config.display) {
        expect(isEditable(config.table, column), column).toBe(false);
      }
    }
  });

  it("refuses a table the map does not carry, naming the table", () => {
    for (const table of [
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
      expect(isEditable("groups", field), field).toBe(false);
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

describe("the write surface of the whole repo", () => {
  const DATA_LAYER = (file: string) =>
    file.startsWith("src/lib/db/") || file.startsWith("src/app/api/");

  it("inserts, upserts and deletes nothing anywhere under src", () => {
    // No catalog row is created or destroyed from Admin (spec §8, AGENTS.md).
    // `.delete(` is scanned in the data and route layers only: on a Set or a
    // Map it is an ordinary call and would be a false red elsewhere.
    expect(filesWhereCodeMatches(/\.insert\(|\.upsert\(/)).toEqual([]);
    expect(filesWhereCodeMatches(/\.delete\(/).filter(DATA_LAYER)).toEqual([]);
    expect(filesWhereCodeMatches(/\.rpc\(/)).toEqual([]);
  });

  it("writes the database from exactly one module", () => {
    // Every write in this app goes through `updateRecordField`, which consults
    // the map before it builds a query. One module is what makes that true of
    // the repo and not merely of the route.
    expect(filesWhereCodeMatches(/\.update\(/)).toEqual([RECORDS_MODULE]);
  });

  it("mentions no raw-archive or legacy table under src", () => {
    expect(filesWhereCodeMatches(/scraped_events|_legacy\b/)).toEqual([]);
  });

  it("builds no write path to a resolver-owned table or a link table", () => {
    // `event_performers` appears in `tables.ts` for reads; nothing else may
    // name it, and no module may special-case events or venues for writing.
    expect(filesWhereCodeMatches(/event_performers/)).toEqual(["src/lib/db/tables.ts"]);

    // The two ACTIONS stay banned by NAME: `settle_review_item` and
    // `apply_resolution` are the resolver's own procedures, so their name on a
    // code line under `src/` can only be a call — there is nothing else to
    // spell it for.
    expect(filesWhereCodeMatches(/settle_review_item|apply_resolution/)).toEqual([]);

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
