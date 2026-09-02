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
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.startsWith("__")) {
        found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(repoRoot, "src"));
  return found.sort();
}

/**
 * Lines that are code, not commentary — the same reading
 * `tests/offline/db/layering.test.ts` uses, so a doc comment naming a thing
 * stays documentation and only a real occurrence is a defect. A file that
 * vanishes mid-walk is skipped: the layering suite writes and deletes a probe
 * under `src/` while vitest runs these files in parallel.
 */
function codeLines(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, file), "utf8");
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

function filesWhereCodeMatches(pattern: RegExp): string[] {
  return sourceFiles().filter((file) =>
    codeLines(file).some((line) => pattern.test(line)),
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
    expect(filesWhereCodeMatches(/settle_review_item|admin_locked|apply_resolution/)).toEqual([]);
  });
});
