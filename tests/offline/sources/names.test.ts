import { describe, expect, it } from "vitest";
import { sourceLabel, sourceNamesOf } from "@/lib/sources/names";
import { hasVisibleContent } from "@/lib/verdict/decision";
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
 * that every uuid carries. A label that reads as a uuid IS the fallback.
 *
 * **That constraint is the SCRAPER's, not this app's** (admin-window/BUG-0154).
 * It is the one repo that may vet the registry, so this app cannot assert what
 * `sources.source` holds — and a row that EXISTS with an ink-less name took
 * neither branch of the rule until this ticket: the lookup found it, `??` saw
 * a string, and whitespace reached an anchor as its only content. The rule is
 * therefore stated on INK, not on `null`, and both directions are pinned
 * below.
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

  /**
   * The ink-less names — `hasVisibleContent`'s own class
   * (`lib/verdict/decision.ts`, admin-window/BUG-0089): the space bar, and the
   * characters `String.prototype.trim()` does not know about. Not a list this
   * file decides: it is a sample OF the app's one class, and the assertions
   * below ask that class rather than re-enumerating it.
   */
  const INK_LESS = ["", "   ", "\t\n", "\u200b\u2060", "\u00ad", "\u3164"];

  /**
   * A registry row that EXISTS and names nothing a person could read
   * (admin-window/BUG-0154).
   *
   * `??` caught `null` and `undefined` only, so this row took NEITHER branch of
   * the rule: the lookup found it and its blank travelled on to the screen as
   * an evidence cell with nothing in it and an anchor with nothing to click.
   * The id is as much the only true thing the app can say here as it is when
   * the registry holds no row at all, so it says the same thing.
   */
  it("says the id VERBATIM when the row exists and its name has no ink", () => {
    for (const blank of INK_LESS) {
      const spelling = JSON.stringify(blank);
      const names = sourceNamesOf([
        { source_id: SOURCE.ticketmaster, source: blank },
        { source_id: SOURCE.bandsintown, source: "bandsintown" },
      ]);
      expect(sourceLabel(names, SOURCE.ticketmaster), spelling).toBe(
        SOURCE.ticketmaster,
      );
      // Non-vacuity in the same map: the sibling row is still named, so the
      // guard answers per ROW and does not dash a whole registry read.
      expect(sourceLabel(names, SOURCE.bandsintown), spelling).toBe("bandsintown");
      // The LOOKUP is a faithful record of what the registry answered — the
      // fallback is the LABEL's rule, and it lives in one function
      // (admin-window/BUG-0154: `canonicalSideOf` retyped it and drifted).
      expect(names.get(SOURCE.ticketmaster), spelling).toBe(blank);
    }
  });

  /**
   * The other direction (LESSONS 8): a name the app CAN read travels
   * byte-identical — never trimmed, never rewritten, never swapped for the id.
   * A producer's string is the producer's (the rule `visibleContent`'s own
   * docstring states: it is a test, not a sanitiser).
   */
  it("leaves a name with any ink in it exactly as the registry wrote it", () => {
    for (const name of [
      "ticketmaster",
      // Padded, and still a name: the ink test asks whether anything is
      // readable, not whether the edges are tidy.
      "  ticketmaster  ",
      // Ink with an ink-less character inside it.
      "band\u200bsintown",
      "TICKETMASTER_2",
      // An em dash is a character with INK, so it is a name and not an
      // absence: `isAbsent`'s dash branch (`lib/format.ts`) recognises the
      // string the app's OWN formatters return, and this value is a
      // producer's. The app never invents a uuid for a label it can read.
      "\u2014",
    ]) {
      const names = sourceNamesOf([{ source_id: SOURCE.ticketmaster, source: name }]);
      const label = sourceLabel(names, SOURCE.ticketmaster);
      expect(label, JSON.stringify(name)).toBe(name);
      expect(label, JSON.stringify(name)).toHaveLength(name.length);
      expect(label, JSON.stringify(name)).not.toBe(SOURCE.ticketmaster);
    }
  });

  it("never answers with a label that has nothing readable in it", () => {
    // Graded on INK, not on `length`: the rule read `length > 0` until
    // admin-window/BUG-0154, and whitespace has length — so a blank name
    // passed it while rendering an anchor with nothing to read. The blank-named
    // row below is what makes the assertion non-vacuous.
    const blanks = INK_LESS.map((source, index) => ({
      source_id: `01920000-0000-7000-8000-00000000090${index}`,
      source,
    }));
    const names = sourceNamesOf([...ROWS, ...blanks]);
    for (const id of [
      ...Object.keys(SOURCE_NAME),
      "unregistered",
      SOURCE.fandom,
      ...blanks.map((row) => row.source_id),
    ]) {
      expect(hasVisibleContent(sourceLabel(names, id)), id).toBe(true);
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

  /**
   * **It imports nothing but another LEAF** — ARCHITECTURE §4 rule 7, second
   * paragraph (ruled at the M2 structure walk, 2026-09-09).
   *
   * It is imported BY `lib/db/sources.ts` and `lib/db/review-item.ts`; the day
   * it imports anything that can reach a database, the arrow the module map
   * draws is a cycle and the leaf can reach one. That is what this asserts, as
   * a CLOSED list: `lib/db/**`, `@supabase/supabase-js`, `process.env`, React
   * and every package are all absent from it, so any of them reddens here
   * without this test holding a list of forbidden things to keep in step.
   *
   * The one edge it allows is the one rule 7 ¶2 exists for and
   * admin-window/BUG-0154 needed: `hasVisibleContent` in
   * `lib/verdict/decision.ts` is the app's ONE definition of "is there anything
   * here a person could read", and `sourceLabel` asks it rather than answering
   * the question a fifth time (`lib/records/id.ts` is the same edge, and
   * `tests/offline/db/layering.test.ts` pins the DAG for the leaf SET).
   */
  it("imports nothing but the app's one definition of blank — ARCHITECTURE §4 rule 7", () => {
    const imports = codeLines(LEAF).filter((line) =>
      /^\s*import\b|\brequire\s*\(|\bfrom\s+["']/.test(line),
    );
    expect(imports.map((line) => line.match(/["']([^"']*)["']/)?.[1] ?? line.trim())).toEqual([
      "@/lib/verdict/decision",
    ]);
  });

  it("exports the two halves of the rule and nothing else", () => {
    const declarations = /export\s+(?:function|const|type|interface)\s+(\w+)/g;
    const exported = [...codeLines(LEAF).join("\n").matchAll(declarations)].map(
      (match) => match[1],
    );
    expect(exported).toEqual(["sourceNamesOf", "sourceLabel"]);
  });
});
