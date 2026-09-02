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
function sourceText(file: string, base: string = repoRoot): string {
  try {
    return fs.readFileSync(path.join(base, file), "utf8");
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw thrown;
  }
}

function codeLines(file: string, base: string = repoRoot): string[] {
  return sourceText(file, base).split("\n").filter((line) => {
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
 * The same text with the CONTENT of every string literal, template literal,
 * comment and regex literal blanked to spaces — delimiters kept, length kept,
 * so an index into the result is an index into the source. A small tokenizer
 * rather than a regex, because what it has to get right is nesting: `${…}`
 * inside a template is code again, and `\"` does not end its string.
 *
 * Why the scan needs it (admin-window/BUG-0030): `writeArguments` balances
 * parentheses, and a parenthesis inside a payload STRING moved the argument
 * boundary in both directions — `.update({ note: "opens ( here" })` ran past
 * the real `)` and swallowed a later READ of the column, and
 * `.update({ note: "set by admin :)", admin_locked: true })` ended early and
 * hid a real WRITE.
 *
 * Where a literal cannot be closed — a quote or a `/` with no partner on its
 * line, a backtick or an interpolation with no partner at all, a `/*` with no
 * closer — NOTHING is blanked and the character is read as ordinary code.
 * That direction over-reports (a red the reader can see) instead of blinding
 * the scan (a silent fail-open), which is the failure this ticket exists for,
 * and it holds for every literal kind alike: the asymmetry where `quoted` gave
 * up and `template` blanked to end of file was this ticket's second round.
 */
function codeOnly(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at += 1) if (out[at] !== "\n") out[at] = " ";
  };

  /** The last character that is code, so `/` can be told from `/…/`. */
  function previousSignificant(before: number): string {
    for (let at = before - 1; at >= 0; at -= 1) {
      if (!/\s/.test(out[at])) return out[at];
    }
    return "";
  }
  /** Positions a regex literal may legally begin at — never after a value. */
  const REGEX_MAY_FOLLOW = /[(,=:[!&|?+\-*%^~;{]/;

  /** `'…'` or `"…"`: ends at its own unescaped quote; `\` + newline continues it. */
  function quoted(open: number): number | null {
    const quote = text[open];
    let at = open + 1;
    while (at < text.length && text[at] !== "\n") {
      if (text[at] === "\\") {
        at += 2;
        continue;
      }
      if (text[at] === quote) {
        blank(open + 1, at);
        return at + 1;
      }
      at += 1;
    }
    return null;
  }

  /**
   * `` `…` ``: literal chunks are blanked, every `${…}` is scanned as code —
   * and, like `quoted`, it gives up rather than guess. A backtick that never
   * meets its partner (or an interpolation that never closes) returns null,
   * the caller undoes every blank this made, and the backtick is read as
   * ordinary code. Blanking to end of file instead would hide every write
   * below it (admin-window/BUG-0030, second round).
   */
  function template(open: number): number | null {
    let at = open + 1;
    let chunk = at;
    while (at < text.length) {
      if (text[at] === "\\") {
        at += 2;
        continue;
      }
      if (text[at] === "`") {
        blank(chunk, at);
        return at + 1;
      }
      if (text[at] === "$" && text[at + 1] === "{") {
        blank(chunk, at);
        const close = scan(at + 2, true);
        if (close >= text.length) return null;
        at = close + 1;
        chunk = at;
        continue;
      }
      at += 1;
    }
    return null;
  }

  /** `/…/flags` on one line, `[…]` classes and `\/` escapes respected. */
  function regexLiteral(open: number): number | null {
    let at = open + 1;
    let inClass = false;
    while (at < text.length && text[at] !== "\n") {
      const ch = text[at];
      if (ch === "\\") {
        at += 2;
        continue;
      }
      if (inClass) {
        if (ch === "]") inClass = false;
      } else if (ch === "[") {
        inClass = true;
      } else if (ch === "/") {
        blank(open + 1, at);
        return at + 1;
      }
      at += 1;
    }
    return null;
  }

  /**
   * Code from `from`; with `untilBrace`, stops at the `}` that closes an
   * interpolation (its own `{…}` pairs counted so an object literal inside
   * `${…}` does not end it early).
   */
  function scan(from: number, untilBrace: boolean): number {
    let at = from;
    let braces = 0;
    while (at < text.length) {
      const ch = text[at];
      const next = text[at + 1] ?? "";
      if (untilBrace && ch === "}" && braces === 0) return at;
      if (ch === "{") braces += 1;
      else if (ch === "}") braces -= 1;
      else if (ch === "/" && next === "/") {
        let end = at;
        while (end < text.length && text[end] !== "\n") end += 1;
        blank(at, end);
        at = end;
        continue;
      } else if (ch === "/" && next === "*") {
        const close = text.indexOf("*/", at + 2);
        if (close !== -1) {
          blank(at, close + 2);
          at = close + 2;
          continue;
        }
      } else if (ch === '"' || ch === "'") {
        const after = quoted(at);
        if (after !== null) {
          at = after;
          continue;
        }
      } else if (ch === "`") {
        const undo = out.slice();
        const after = template(at);
        if (after !== null) {
          at = after;
          continue;
        }
        for (let index = 0; index < out.length; index += 1) out[index] = undo[index];
      } else if (ch === "/" && REGEX_MAY_FOLLOW.test(previousSignificant(at))) {
        const after = regexLiteral(at);
        if (after !== null) {
          at = after;
          continue;
        }
      }
      at += 1;
    }
    return at;
  }

  scan(0, false);
  return out.join("");
}

/**
 * The argument text of every write-verb call in a file, balanced across
 * parentheses and newlines so a payload Prettier split over several lines
 * reads as one string. Only what is passed TO the verb is returned, so
 * `.update(values).select("… admin_locked …")` yields `values` — a read
 * chained onto a write is not a write of that column.
 *
 * The text is read through `codeOnly`, so every parenthesis that moves the
 * boundary is a real one, and the argument that comes back carries only the
 * payload's CODE: a column named inside a payload string is not a write of it
 * any more than a parenthesis there is a bracket.
 *
 * It reads the RAW file, not `codeLines` (admin-window/BUG-0030, second
 * round): that filter drops any line whose trimmed form starts with `*`, and
 * such a line can carry a template literal's closing backtick — hiding the
 * closer from a scanner whose whole job is finding closers. Commentary is
 * excluded by the tokenizer instead, which is where it belongs, and every
 * comment is excluded whole rather than line by line.
 */
function writeArguments(file: string, base: string = repoRoot): string[] {
  const code = codeOnly(sourceText(file, base));
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
 * The argument scan and STRING LITERALS (admin-window/BUG-0030, found by
 * admin-window/BUG-0028's QA). `writeArguments` balances parentheses to find
 * where a payload ends, and it used to count them in the raw text: a
 * parenthesis inside a payload string moved that boundary, and the rule broke
 * in BOTH directions — an unclosed `(` ran the argument past the real `)` and
 * swallowed a later pure READ, and a `)` truncated a real WRITE out of sight.
 * Every case below drives the same `filesWritingColumn` the rule above calls,
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
    const [reported, argument] = withProbes(
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
          writeArguments("src/note-about-locking.ts", base).join(""),
        ] as const,
    );
    // A column NAMED in prose inside a payload is not a write of it, for the
    // same reason a parenthesis there is not a bracket: the argument the pin
    // matches against carries the payload's code and none of its text.
    expect(reported).toEqual([]);
    expect(argument).toContain("note:");
    expect(argument).not.toContain(ADMIN_LOCKED);
  });

  it(
    "reports a WRITE below a template literal whose closing backtick lands on a comment-stripped line",
    () => {
      // Valid, compiling TypeScript. `codeLines` drops any line whose trimmed
      // form starts with "*" as commentary, and here that line carries the
      // template's CLOSING backtick — so reading the file through that filter
      // hid the closer from the one scanner whose job is finding closers, and
      // the write three lines below vanished (admin-window/BUG-0030, second
      // round: the silent fail-open direction the contract excludes). Two
      // things now stop it: `writeArguments` tokenizes the RAW file, and
      // `template` gives up rather than blank to end of file.
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
    // whose closing quote sits on a line `codeLines` strips. `quoted` gives up
    // and blanks nothing, so the write below stays visible. This is the
    // direction the tokenizer is supposed to fail in, and it is what makes the
    // case above a defect rather than a limit.
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
    // The give-up path on its own, with no help from reading the raw file: a
    // backtick with no partner anywhere. `template` blanks nothing and the
    // backtick is read as ordinary code, so the write below it stays visible.
    // Blanking to end of file here is what made the case above fail open.
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

  it("reports a WRITE under a backtick that is only ever mentioned in a comment", () => {
    // A backtick inside commentary opens nothing: comments are excluded by the
    // tokenizer, whole, before any literal is read. Both shapes the line filter
    // used to handle for it are here — a trailing "//" and a block comment
    // opened mid-line — and neither may swallow the write beneath.
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
