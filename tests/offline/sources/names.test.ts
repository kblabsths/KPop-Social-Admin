import { describe, expect, it } from "vitest";
import { isSourceNamed, sourceLabel, sourceNamesOf } from "@/lib/sources/names";
import { hasVisibleContent } from "@/lib/verdict/decision";
import { codeLines, codeLinesIn, codeText, sourceFiles } from "../source-tree";
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

  /**
   * **The count and the label are the same question** (admin-window/TASK-0060).
   *
   * `/sources`' settled-values sentence says how many of the rows above it are
   * wearing an id instead of a name. It answered that itself, as `split.source
   * === null`, which is one of the TWO ways the registry names no source — so
   * a row that existed with an ink-less name was labelled by its id above and
   * left out of the count below, and one page gave two answers about one row
   * (LESSONS 11). Both fixtures are asserted against `sourceLabel` in the same
   * map, so the two can never part company again.
   */
  it("answers 'is this named' exactly as the label answers 'what is it called'", () => {
    const named = sourceNamesOf(ROWS);
    for (const id of [...Object.keys(SOURCE_NAME), "01920000-0000-7000-8000-0000000009ff"]) {
      expect(isSourceNamed(named, id), id).toBe(sourceLabel(named, id) !== id);
    }
    // The two ways the registry names no source — a row with no ink in it, and
    // no row at all — and the one way it does. Every case is graded against
    // the label in the same breath.
    for (const blank of INK_LESS) {
      const spelling = JSON.stringify(blank);
      const names = sourceNamesOf([
        { source_id: SOURCE.ticketmaster, source: blank },
        { source_id: SOURCE.bandsintown, source: "bandsintown" },
      ]);
      // The input it MUST flag: present, and naming nothing readable.
      expect(isSourceNamed(names, SOURCE.ticketmaster), spelling).toBe(false);
      expect(sourceLabel(names, SOURCE.ticketmaster), spelling).toBe(SOURCE.ticketmaster);
      // The input it must NOT (LESSONS 8): a sibling with a name, in the same
      // map, so the predicate answers per ROW.
      expect(isSourceNamed(names, SOURCE.bandsintown), spelling).toBe(true);
      expect(sourceLabel(names, SOURCE.bandsintown), spelling).toBe("bandsintown");
      // And the id the map has no entry for at all.
      expect(isSourceNamed(names, SOURCE.fandom), spelling).toBe(false);
      expect(isSourceNamed(new Map(), SOURCE.ticketmaster), spelling).toBe(false);
    }
  });

  it("calls a name with any ink in it a name, however odd the app finds it", () => {
    // The other direction, on the values `isAbsent` and a tidier-upper would
    // disagree about: a padded name, an em dash, a name that reads like an id.
    // Each is a name the registry wrote, so the count of id-worn rows must not
    // claim it.
    for (const name of ["ticketmaster", "  ticketmaster  ", "\u2014", "band\u200bsintown"]) {
      const names = sourceNamesOf([{ source_id: SOURCE.ticketmaster, source: name }]);
      expect(isSourceNamed(names, SOURCE.ticketmaster), JSON.stringify(name)).toBe(true);
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

/**
 * **The rule has ONE owner, and this is the guard that keeps it that way**
 * (admin-window/BUG-0158; LESSONS 5, "a shared spelling gets imported, never
 * retyped").
 *
 * Every fix of this class so far has been the same edit: a surface spelled
 * `<lookup> ?? <the id>` beside `sourceLabel` instead of calling it, `??` saw
 * only `null`, and a registry row that EXISTED with an ink-less name reached
 * the screen as nothing. BUG-0043 found three such sites, BUG-0154 two more in
 * `lib/db/review-item.ts`, and BUG-0158 four more — `lib/browse/rows.ts`,
 * `components/sources/trends.tsx`, `app/claims/page.tsx` and
 * `lib/records/provenance.ts`. Prose in a docstring is what let them drift, so
 * the rule is asserted over the tree instead.
 *
 * The rule is narrow ON PURPOSE: it flags a `??` whose RIGHT operand is a
 * source-id expression — the "fall back to the id" spelling and nothing else.
 * `source?.source ?? null` (a gauge recording that the registry answered
 * nothing, which the dash rule then owns) and `series?.threshold ??
 * stuckPatternThreshold(sourceId)` (a different fact entirely) are both
 * legitimate and both stay green; each is a fixture below.
 *
 * **What that narrowness cannot see, and what covers it instead**
 * (admin-window/BUG-0159). The regex reads a RETYPED fallback, so a
 * labelling site with NO fallback of any spelling is invisible to it:
 * `/sources`' narrowing chips said `label={source.source}` — the registry
 * string raw — and passed this describe untouched while a blank-named row
 * rendered a control with nothing to read beside a trend row naming that same
 * source by its id. A scan for "a source label that is not `sourceLabel`"
 * would have to read intent out of every `.source` in the tree (the registry
 * TABLE renders its own row's name column, which is a different question), so
 * the answer is the ratchet below rather than a wider regex: the caller list
 * names each site the class has been found on, and each is asserted to call
 * the rule. A site that leaves the list, or stops calling `sourceLabel`,
 * reddens here.
 */
describe("what a source is called has one owner", () => {
  /**
   * A `??` falling back to a source id: `?? sourceId`, `?? row.source_id`,
   * `?? split.sourceId`. Read over CODE lines (`codeText` drops commentary),
   * so a docstring quoting the defect — this file's, and the four fixed
   * files' — stays documentation.
   */
  const ID_FALLBACK = /\?\?\s*(?:[A-Za-z_$][\w$]*\.)*(?:sourceId|source_id)\b/;

  it("flags the retyped fallback and clears the spellings that are not it", () => {
    // LESSONS 8 — the guard proves itself on inputs it MUST flag ...
    for (const flagged of [
      "{name ?? sourceId}",
      "source: nameOf.get(row.source_id) ?? row.source_id,",
      "rowLabel={(split) => link(split.source ?? split.sourceId)}",
      "const label = names.get(id)\n  ?? sourceId;",
    ]) {
      expect(ID_FALLBACK.test(codeLinesIn(flagged).join("\n")), flagged).toBe(true);
    }
    // ... and on inputs it must NOT, which is what keeps it from being a ban
    // on the two characters.
    for (const clear of [
      "source: source?.source ?? null,",
      "threshold: series?.threshold ?? stuckPatternThreshold(sourceId),",
      "const set = sourceIdsOf.get(row.entity_id) ?? new Set<string>();",
      "{sourceLabel(names, sourceId)}",
      "// a comment about `name ?? sourceId` is documentation",
    ]) {
      expect(ID_FALLBACK.test(codeLinesIn(clear).join("\n")), clear).toBe(false);
    }
  });

  it("has no surface falling back to a source id outside the rule", () => {
    const offenders = sourceFiles().filter((file) => ID_FALLBACK.test(codeText(file)));
    expect(offenders).toEqual([]);
  });

  it("is asserted over a tree that really holds the callers", () => {
    // The ratchet the rule above needs to stay non-vacuous: an empty or
    // renamed tree would clear it silently. Every surface that labels a
    // source id imports the rule, and these are the ones the class was found
    // on.
    const files = sourceFiles();
    for (const caller of [
      "src/lib/browse/rows.ts",
      "src/components/sources/trends.tsx",
      "src/app/claims/page.tsx",
      "src/lib/records/provenance.ts",
      "src/lib/db/review-item.ts",
      // The narrowing chips: a source labelled by its id, and the one site of
      // the class that carried NO fallback at all (admin-window/BUG-0159).
      "src/components/sources/source-chips.tsx",
      // The registry's OWN name column — the last site of the class
      // (admin-window/TASK-0060). It rendered `{row.source}` raw, which is
      // invisible to the `??` scanner above for the same reason the chips
      // were, and it is the one cell on the page whose row already holds the
      // string: having it in hand is not permission to decide what to say
      // about it.
      "src/components/sources/registry-table.tsx",
    ]) {
      expect(files, caller).toContain(caller);
      expect(codeText(caller), caller).toContain("sourceLabel");
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

  /**
   * The ratchet on the leaf's SIZE: a fourth export is a fourth thing a caller
   * may ask about a source's name, and the class this leaf ends is surfaces
   * asking the question their own way. `isSourceNamed` was the third
   * (admin-window/TASK-0060) — the answer `sourceLabel` already computes,
   * exported because `/sources` counts the rows it labelled by id and was
   * deciding that a second time.
   */
  it("exports the three parts of the rule and nothing else", () => {
    const declarations = /export\s+(?:function|const|type|interface)\s+(\w+)/g;
    const exported = [...codeLines(LEAF).join("\n").matchAll(declarations)].map(
      (match) => match[1],
    );
    expect(exported).toEqual(["sourceNamesOf", "sourceLabel", "isSourceNamed"]);
  });
});
