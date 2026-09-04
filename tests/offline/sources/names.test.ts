import { describe, expect, it } from "vitest";
import { sourceLabel, sourceNamesOf } from "@/lib/sources/names";
import { codeLines } from "../source-tree";
import { SOURCE, SOURCE_NAME, SOURCES } from "./population";

/**
 * How a source is LABELLED — the pure leaf `src/lib/sources/names.ts`
 * (campaign admin-window/BUG-0043).
 *
 * The leaf arrived with no test of its own: every assertion on it was made
 * through a rendered page, where a change of fallback would show up as a
 * changed cell rather than as a changed rule. The rule is the thing four
 * surfaces now share, so it is pinned here directly — what a name is, and
 * what is said when there is no name.
 *
 * The registry's own shape is what makes the fallback unambiguous
 * (`kspace Scraper/supabase/migrations/20260818000000…sql`: `sources.source`
 * is NOT NULL, UNIQUE, and `CHECK (source ~ '^[a-z0-9_]+$')`) — so a name can
 * never be empty, never be shared by two sources, and never contain the `-`
 * that every uuid carries. A label that reads as a uuid IS the fallback, and
 * a blank label cannot come from the data.
 */

const ROWS = SOURCES.map((row) => ({ source_id: row.source_id, source: row.source }));

describe("the id → name lookup", () => {
  it("names every row it is handed, keyed by the id the surfaces hold", () => {
    const names = sourceNamesOf(ROWS);
    expect(names.size).toBe(SOURCES.length);
    for (const row of SOURCES) expect(names.get(row.source_id)).toBe(row.source);
  });

  it("names nothing from no rows — the registry leg that read nothing", () => {
    expect(sourceNamesOf([]).size).toBe(0);
  });

  it("lets the later row win a repeated id, so the lookup is total", () => {
    const [first] = ROWS;
    const names = sourceNamesOf([first, { source_id: first.source_id, source: "later" }]);
    expect(names.get(first.source_id)).toBe("later");
    expect(names.size).toBe(1);
  });
});

describe("what a source is called on screen", () => {
  it("says the registry's name when the registry holds one", () => {
    const names = sourceNamesOf(ROWS);
    for (const [id, name] of Object.entries(SOURCE_NAME)) {
      expect(sourceLabel(names, id)).toBe(name);
    }
  });

  it("says the id VERBATIM — never blank, never a guess — when it holds none", () => {
    const names = sourceNamesOf(ROWS);
    const unknown = "01920000-0000-7000-8000-0000000009ff";
    expect(sourceLabel(names, unknown)).toBe(unknown);
    // Verbatim means character for character: not trimmed, not shortened, not
    // upper-cased (LESSONS 5 — "render verbatim in mono" means verbatim).
    expect(sourceLabel(names, unknown)).toHaveLength(unknown.length);
    expect(sourceLabel(new Map(), SOURCE.ticketmaster)).toBe(SOURCE.ticketmaster);
  });

  it("never answers with an empty label", () => {
    const names = sourceNamesOf(ROWS);
    for (const id of [...Object.keys(SOURCE_NAME), "unregistered", SOURCE.fandom]) {
      expect(sourceLabel(names, id).length, id).toBeGreaterThan(0);
    }
  });

  it("gives back an id that is not exactly a registry key, never a neighbour's name", () => {
    // The lookup is by exact id, as the database keys it. An id that differs
    // by a character, a space or a case gets ITSELF back rather than the name
    // of the source it nearly is — a label must never lie about which source
    // it names.
    const names = sourceNamesOf(ROWS);
    const named = SOURCE_NAME[SOURCE.ticketmaster];
    for (const near of [
      `${SOURCE.ticketmaster} `,
      ` ${SOURCE.ticketmaster}`,
      SOURCE.ticketmaster.replace(/1$/, "f"),
      SOURCE.ticketmaster.replace(/-/g, ""),
    ]) {
      expect(sourceLabel(names, near), near).toBe(near);
      expect(sourceLabel(names, near), near).not.toBe(named);
    }
  });
});

describe("the leaf stays a leaf", () => {
  const LEAF = "src/lib/sources/names.ts";

  it("imports nothing at all — ARCHITECTURE §4 rule 7", () => {
    // It is imported BY `lib/db/sources.ts` and `lib/db/review-item.ts`; the
    // day it imports anything back, the arrow the module map draws is a cycle
    // and the leaf can reach a database.
    const imports = codeLines(LEAF).filter((line) =>
      /^\s*import\b|\brequire\s*\(|\bfrom\s+["']/.test(line),
    );
    expect(imports).toEqual([]);
  });

  it("exports the two halves of the rule and nothing else", () => {
    const declarations = /export\s+(?:function|const|type|interface)\s+(\w+)/g;
    const exported = [...codeLines(LEAF).join("\n").matchAll(declarations)].map(
      (match) => match[1],
    );
    expect(exported).toEqual(["sourceNamesOf", "sourceLabel"]);
  });
});
