import { describe, expect, it } from "vitest";
import { codeLines, codeLinesIn, codeText, sourceFiles } from "../source-tree";

/**
 * **One name, one question** — the narrowing vocabulary's own guard
 * (campaign admin-window/DEBT-0010, ARCHITECTURE.md §6 and §11).
 *
 * Narrowing is the most-touched idea of M2 and the root of nine bugs
 * (BUG-0109, BUG-0114, BUG-0118, BUG-0123, BUG-0124, BUG-0128, BUG-0129,
 * BUG-0131, BUG-0133). At the M2 structure walk two of its words were doing
 * two jobs each: `narrowedTo` was exported from `src/components/ui` (joining
 * narrowing PHRASES into a scope sentence) AND from `src/lib/db/runs.ts`
 * (canonicalising the `?source=` FACET for a query), and `isNarrowed` was
 * exported from `src/lib/claims/filters.ts` ("is any facet set") AND from
 * `src/lib/review/queue-filters.ts` ("narrowed BEYOND this block's own
 * scope"). Adjacent pages imported one word for two meanings and nothing but
 * the type checker stood between them — and only because the shapes happened
 * to differ.
 *
 * The names are apart now. This is what keeps them apart: a rule in prose is
 * retyped, a rule with a guard is not (LESSONS 5; ARCHITECTURE.md Common
 * violations row 9). It is asserted over the source tree, through the one
 * shared walk (`tests/offline/source-tree.ts`), and the detector below is
 * proved on a fixture it MUST flag and one it must NOT before it is trusted
 * with the tree (LESSONS 8).
 */

/** Each name of the vocabulary, and the ONE module that may declare it. */
const OWNER: Readonly<Record<string, string>> = {
  /** Narrowing PHRASES → one scope sentence fragment. Inverse: `besides`. */
  narrowedTo: "src/components/ui/window-line.tsx",
  /** A free-text URL facet value → the ONE string that is both SENT to the
   * query and SPELLED in every sentence naming it, or `null` for no narrowing
   * (admin-window/BUG-0155). It replaces `sourceNarrowing`
   * (`src/lib/db/runs.ts`), which took a `?source=` to a query value and
   * nothing else, and which the ruling of 2026-09-09 retired: once its body
   * was one call to this, it was a second name for one question. */
  canonicalUrlText: "src/lib/url/text.ts",
  /** The app's ONE ends-only ink-padding strip, called by BOTH derivations —
   * `canonicalUrlText` and `canonicalRecordId` (`src/lib/records/id.ts`),
   * where it was a private `trimPad` until admin-window/BUG-0155. It is in
   * this map for the reason the map exists: a hand-copied second strip is how
   * two value classes come to disagree about what padding IS (LESSONS 5;
   * ARCHITECTURE.md common violations row 9). */
  trimInkPadding: "src/lib/url/text.ts",
  /** Does this URL carry a claim facet at all? Fact 1, claims domain. */
  hasNarrowingFacet: "src/lib/claims/filters.ts",
  /** Where "no narrowing at all, on this tab" IS — the one control that undoes
   * every facet a claims URL applied, the ones with no chip row included
   * (admin-window/BUG-0161). It is in this map because it is the inverse of
   * the two questions above it: a second copy that subtracted the facets
   * someone remembered, rather than building the href from the empty filter,
   * is exactly how a page comes to offer an exit that does not exit. */
  clearNarrowing: "src/lib/claims/filters.ts",
  /** Narrowed BEYOND what a block already applies to itself? Fact 1, queues. */
  isNarrowedBeyond: "src/lib/review/queue-filters.ts",
  /** The queues-domain adapter of the two-fact rule. */
  isBlockNarrowed: "src/lib/review/queue-filters.ts",
  /** The two-fact rule itself, for every surface (admin-window/DEBT-0008). */
  isSurfaceNarrowed: "src/lib/url/narrowing.ts",
  /** The app's ONE claim predicate: claim rows + a `ClaimsFilter`, bucket arm
   * included (admin-window/DEBT-0014). */
  selectClaims: "src/lib/db/claims.ts",
  /** The pending-claims GAUGE's own selection over its bundled read — no
   * bucket arm, filter read off the bundle (admin-window/DEBT-0014). */
  selectPendingClaims: "src/lib/gauges/pending-claims.ts",
  /** The ROWS of the classification view, by `observation_id` — the db read
   * both gauges take their second leg from (admin-window/DEBT-0015). The
   * gauge module already read it under this word through an import alias;
   * the alias is gone and the declaration carries the name. */
  readPendingClaimRows: "src/lib/db/claims.ts",
  /** Fetch AND aggregate those rows into the buckets `/claims` renders —
   * the gauge façade, beside its `fetchPendingClaims` /
   * `aggregatePendingClaims` siblings (admin-window/DEBT-0015). */
  readPendingClaims: "src/lib/gauges/pending-claims.ts",
};

/**
 * A name RETIRED by admin-window/DEBT-0010 because it answered two different
 * questions. Written with a word boundary on both sides, so the name that
 * replaced it (`isNarrowedBeyond`) is not what this finds.
 */
const RETIRED = /\bisNarrowed\b/;

/**
 * Does this code declare `name` itself — as opposed to importing it, calling
 * it, or re-exporting it from a barrel?
 *
 * A barrel line (`  narrowedTo,` inside `export { … }`) is deliberately NOT a
 * declaration: `src/components/ui/index.ts` re-exports the phrase composer and
 * that is the point of a barrel.
 */
function declares(name: string, lines: readonly string[]): boolean {
  const declaration = new RegExp(
    // `function|const|let` were the three spellings the vocabulary happens to
    // use today. `var` and `class` are declarations too, and `export default
    // function ${name}` puts the identifier in the tree a second time even
    // though importers rename it — measured under QA, each of them walked
    // straight past this detector while `export function` was caught
    // (campaign admin-window/DEBT-0010, QA round 1).
    `^export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b`,
  );
  return lines.some((line) => declaration.test(line.trim()));
}

/**
 * Every `export { … }` block of a file's CODE, joined — where a name can be
 * exported under a spelling the declaration above never used.
 *
 * Written over `codeText` rather than line by line because an export block is
 * ordinarily formatted across several lines, which a one-line scan cannot see
 * (the reason `tests/offline/source-tree.ts` offers `codeText` at all).
 */
const EXPORT_BLOCK = /export\s+(?:type\s+)?\{[^}]*\}/g;

/**
 * Does this code export something ELSE under the vocabulary's name —
 * `export { joinScope as narrowedTo }`?
 *
 * This is the hole the detector above cannot see and criterion 1 of
 * admin-window/DEBT-0010 cares about most: an alias is a second EXPORT of the
 * word with an unrelated meaning, which is exactly the state the ticket
 * exists to end, and it carries no declaration line to be caught by.
 * Measured under QA on the real tree: a `src/lib/*.ts` holding
 * `export { joinScope as narrowedTo }` left the whole guard green.
 *
 * A plain re-export (`export { narrowedTo } from "./window-line"`, the
 * `@/components/ui` barrel) is still not a violation — it carries the word to
 * the same function, which is the point of a barrel. Only `as ${name}` is.
 */
function aliasesTo(name: string, code: string): boolean {
  const alias = new RegExp(`\\bas\\s+${name}\\s*(?:,|\\}|$)`);
  return (code.match(EXPORT_BLOCK) ?? []).some((block) => alias.test(block));
}

/** Every file of the tree whose CODE declares `name`. */
function declaringFiles(name: string): string[] {
  return sourceFiles().filter((file) => declares(name, codeLines(file)));
}

/** Every file of the tree that exports something else AS `name`. */
function aliasingFiles(name: string): string[] {
  return sourceFiles().filter((file) => aliasesTo(name, codeText(file)));
}

describe("the declaration detector, before it is trusted with the tree", () => {
  const MUST_FLAG = `
export function narrowedTo(narrowings: readonly (string | null)[]): string | null {
  return narrowings.join(", ");
}
`;

  const MUST_NOT_FLAG = `
/**
 * Doc comments talk ABOUT the vocabulary: narrowedTo, and
 * export function narrowedTo(…) quoted inside prose, are documentation.
 */
import { narrowedTo } from "@/components/ui";

export const scope = narrowedTo([null]);
export { narrowedTo };
`;

  it("flags a real declaration", () => {
    expect(declares("narrowedTo", codeLinesIn(MUST_FLAG))).toBe(true);
  });

  it("does not flag a mention, an import, a call or a re-export", () => {
    expect(declares("narrowedTo", codeLinesIn(MUST_NOT_FLAG))).toBe(false);
  });

  /**
   * The spellings a detector written for `export function` walks past (QA
   * round 1, admin-window/DEBT-0010). Each was measured against the real tree
   * before it was pinned here: a file in `src/lib/` carrying it left the guard
   * green, so "one declaration per name" was true only of the one spelling the
   * vocabulary happened to use.
   */
  const ALSO_A_DECLARATION: Readonly<Record<string, string>> = {
    "export class": `export class narrowedTo {}`,
    "export var": `export var narrowedTo = 1;`,
    "export default function": `export default function narrowedTo(a: string) {\n  return a;\n}`,
    "export async function": `export async function narrowedTo(a: string) {\n  return a;\n}`,
    "export const arrow": `export const narrowedTo = (a: string) => a;`,
  };

  for (const [spelling, fixture] of Object.entries(ALSO_A_DECLARATION)) {
    it(`flags a declaration written as \`${spelling}\``, () => {
      expect(declares("narrowedTo", codeLinesIn(fixture)), spelling).toBe(true);
    });
  }

  it("does not flag a NAMED FUNCTION EXPRESSION bound to another name", () => {
    // `narrowedTo` here is only in scope inside its own body; the module
    // exports `scope`. Nothing reads the word from this file, so it is not a
    // second owner of it — the detector must stay quiet or the vocabulary
    // rule starts grading things no importer can see.
    const fixture = `export const scope = function narrowedTo(a: string) {\n  return a;\n};`;
    expect(declares("narrowedTo", codeLinesIn(fixture))).toBe(false);
  });
});

describe("the ALIAS detector, before it is trusted with the tree", () => {
  /** The fixture equivalent of `codeText(file)` — code lines, rejoined. */
  const asCode = (text: string): string => codeLinesIn(text).join("\n");

  const ALIASES: Readonly<Record<string, string>> = {
    "on one line": `export { joinScope as narrowedTo };`,
    "inside a multi-line block": `export {\n  besides,\n  joinScope as narrowedTo,\n  windowLine,\n};`,
    "re-exported straight from another module": `export { joinScope as narrowedTo } from "./scope";`,
  };

  for (const [shape, fixture] of Object.entries(ALIASES)) {
    it(`flags something else exported under the name, ${shape}`, () => {
      expect(aliasesTo("narrowedTo", asCode(fixture)), shape).toBe(true);
    });
  }

  const NOT_ALIASES: Readonly<Record<string, string>> = {
    "a plain barrel re-export": `export { narrowedTo } from "./window-line";`,
    "a barrel block": `export {\n  besides,\n  narrowedTo,\n  windowLine,\n} from "./window-line";`,
    "an import renamed the OTHER way": `import { narrowedTo as joinScope } from "@/components/ui";`,
    "the word inside a doc comment": `/**\n * export { joinScope as narrowedTo }\n */\nexport const a = 1;`,
    "an alias to a DIFFERENT name": `export { joinScope as narrowedToScope };`,
  };

  for (const [shape, fixture] of Object.entries(NOT_ALIASES)) {
    it(`leaves ${shape} alone`, () => {
      expect(aliasesTo("narrowedTo", asCode(fixture)), shape).toBe(false);
    });
  }
});

describe("the narrowing vocabulary has one name per question", () => {
  it("declares each name in exactly one module", () => {
    for (const [name, owner] of Object.entries(OWNER)) {
      expect(declaringFiles(name), name).toEqual([owner]);
    }
  });

  it("exports nothing ELSE under one of these names", () => {
    // The other half of criterion 1 (QA round 1): "no identifier is exported
    // twice from `src/` with two different meanings" is broken by an alias
    // just as thoroughly as by a declaration, and an alias carries no
    // declaration line. `export { joinScope as narrowedTo }` is the shape.
    for (const name of Object.keys(OWNER)) {
      expect(aliasingFiles(name), name).toEqual([]);
    }
  });

  it("does not read the retired name back in through an alias either", () => {
    expect(aliasingFiles("isNarrowed")).toEqual([]);
  });

  it("spells the two-meaning name `isNarrowed` nowhere in the app's code", () => {
    const spelled = sourceFiles().filter((file) =>
      codeLines(file).some((line) => RETIRED.test(line)),
    );
    expect(spelled).toEqual([]);
  });

  it("is asserted over a tree that really holds these modules", () => {
    // A rule whose paths have all moved would pass vacuously above: every name
    // would be declared in zero files and every list would be empty. It is not
    // — each owner is a file of the tree under test.
    const files = sourceFiles();
    for (const owner of new Set(Object.values(OWNER))) {
      expect(files, owner).toContain(owner);
    }
  });
});
