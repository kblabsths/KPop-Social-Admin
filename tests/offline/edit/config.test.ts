import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EDITABLE_TABLES,
  EDIT_CONFIG,
  decideEdit,
  editConfigFor,
  isEditable,
} from "@/lib/edit/config";
import { TABLE_NAMES } from "@/lib/db/tables";

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

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
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

/** Every TypeScript source file under `src/`, as repo-relative posix paths. */
function sourceFiles(base: string = repoRoot): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.startsWith("__")) {
        found.push(path.relative(base, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(base, "src"));
  return found.sort();
}

/**
 * Lines that are code, not commentary — the same reading
 * `tests/offline/db/layering.test.ts` uses, so a doc comment naming a thing
 * stays documentation and only a real occurrence is a defect. A file that
 * vanishes mid-walk is skipped: the layering suite writes and deletes a probe
 * under `src/` while vitest runs these files in parallel.
 */
function codeLines(file: string, base: string = repoRoot): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(base, file), "utf8");
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw thrown;
  }
  return text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("/*")
    );
  });
}

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
 * The argument text of every write-verb call in a file, balanced across
 * parentheses and newlines so a payload Prettier split over several lines
 * reads as one string. Only what is passed TO the verb is returned, so
 * `.update(values).select("… admin_locked …")` yields `values` — a read
 * chained onto a write is not a write of that column.
 */
function writeArguments(file: string, base: string = repoRoot): string[] {
  const code = codeLines(file, base).join("\n");
  const verb = new RegExp(WRITE_VERB.source, "g");
  const args: string[] = [];
  for (let hit = verb.exec(code); hit !== null; hit = verb.exec(code)) {
    const start = hit.index + hit[0].length;
    let depth = 1;
    let index = start;
    while (index < code.length && depth > 0) {
      if (code[index] === "(") depth += 1;
      else if (code[index] === ")") depth -= 1;
      index += 1;
    }
    args.push(code.slice(start, depth === 0 ? index - 1 : code.length));
  }
  return args;
}

/** Files that pass the column to a write verb, however the payload is laid out. */
function filesWritingColumn(column: string, base: string = repoRoot): string[] {
  const named = new RegExp(column);
  return filesWhereCodeMatches(named, base).filter((file) =>
    writeArguments(file, base).some((argument) => named.test(argument)),
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
 * The balanced-argument scan is not string-aware (admin-window/BUG-0028 QA).
 * `writeArguments` counts parentheses in the raw code text, so a parenthesis
 * inside a STRING LITERAL in a write payload moves the argument boundary. Both
 * directions are wrong, and both are pinned here as expected failures until
 * admin-window/BUG-0030 makes the scan skip string literals. When it does,
 * these two turn red as XPASS and send the reader to that ticket.
 */
describe("the argument scan and string literals", () => {
  const stringBase = path.join(repoRoot, "tests", ".probes", `qa-strings-${process.pid}`);
  const plant = (file: string, source: string) => {
    const full = path.join(stringBase, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source, "utf8");
  };

  it.fails("BUG-0030: does not report a pure READ as a write (open paren in a payload string)", () => {
    try {
      plant(
        "src/read-after-write.ts",
        "export const a = (db: Db) =>\n" +
          '  db.from("groups").update({ note: "opens ( here" }).eq("id", 1);\n' +
          "export const b = (db: Db) =>\n" +
          '  db.from("field_provenance").select("field, admin_locked");\n',
      );
      // The unclosed "(" inside the string runs the scan past the real ")", so
      // the argument swallows the later READ of the column — the exact defect
      // class admin-window/BUG-0028 exists to remove.
      expect(filesWritingColumn(ADMIN_LOCKED, stringBase)).toEqual([]);
    } finally {
      fs.rmSync(stringBase, { force: true, recursive: true });
    }
  });

  it.fails("BUG-0030: still reports a real WRITE (close paren in a payload string)", () => {
    try {
      plant(
        "src/stamp.ts",
        "export const stamp = (db: Db, id: string) =>\n" +
          '  db.from("field_provenance").update({\n' +
          '    note: "set by admin :)",\n' +
          "    admin_locked: true,\n" +
          '  }).eq("id", id);\n',
      );
      // The ")" inside the string ends the argument early, so the payload's own
      // `admin_locked` is never seen; the line pin misses it too because the
      // payload is wrapped. A forbidden write slips BOTH pins.
      expect(filesWritingColumn(ADMIN_LOCKED, stringBase)).toEqual(["src/stamp.ts"]);
    } finally {
      fs.rmSync(stringBase, { force: true, recursive: true });
    }
  });
});
