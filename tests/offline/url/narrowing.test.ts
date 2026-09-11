import { describe, expect, it } from "vitest";
import { isFamilyNarrowing, isSurfaceNarrowed } from "@/lib/url/narrowing";
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
 * The map has since taken every name the same class was found on — the claim
 * predicates (admin-window/DEBT-0014), the pending-claims reads
 * (admin-window/DEBT-0015) and the app's one "newest first"
 * (admin-window/DEBT-0016) — so it is the vocabulary's guard rather than the
 * narrowing words' alone. The rule it asserts is unchanged: one name, one
 * question, one declaring module.
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
  /** Is a facet the claims page draws a CHIP for SET on this filter? The
   * PRESENCE question, and its name now says so (architect ruling 2026-09-11,
   * ARCHITECTURE.md §4.3). It is in this map beside `hasNarrowingFacet` for
   * the reason the map exists: it sat under a name built from the word the
   * EFFECT questions own (`isSurfaceNarrowed`, `claimsNarrowed`), which is how
   * one chip came to earn two opposite sentences on two staging URLs
   * (admin-window/BUG-0191's residual). Presence and effect are two questions
   * and neither may be read as the other. */
  hasChipFacet: "src/lib/claims/filters.ts",
  /** A filter + a surface's own table of control-less facets → the narrowings
   * that read carried (admin-window/TASK-0072). It was `/claims`' alone, in
   * `src/lib/claims/filters.ts`, so a second surface saying the same sentence
   * had to retype the shape — the class that has taken five bugs on this
   * family (LESSONS 5). The facet TABLE stays each surface's own
   * (`CLAIMS_UNCHIPPED_FACETS`); this and the two names around it are the
   * URL leaf's. */
  unchippedNarrowings: "src/lib/url/narrowing.ts",
  /** One such narrowing → the phrase a window line's `scope` takes. The other
   * face of the same words is markup (`NarrowedBy`, `/claims`), which is why
   * the narrowing is carried in PIECES and joined by whoever renders it. */
  unchippedPhrase: "src/lib/url/narrowing.ts",
  /** The SHAPE those two are expressed in — the narrowing a read carried, in
   * pieces. A type is in this map for the same reason a function is: two
   * modules declaring `UnchippedNarrowing` is two meanings of one word, and
   * the type checker would not object (common violations row 18). */
  UnchippedNarrowing: "src/lib/url/narrowing.ts",
  /** …and the shape of a surface's declaration of one such facet: what to call
   * it, and how to read it off that surface's own filter. */
  UnchippedFacet: "src/lib/url/narrowing.ts",
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
  /** Did ONE FAMILY of facets remove rows from this surface — the ATTRIBUTION
   * question, one level below the rule above (admin-window/BUG-0192). It is in
   * this map for the reason `hasChipFacet` is: presence, effect and
   * attribution are three questions about one chip, and a page that spelled
   * any two of them with one word gave one chip two opposite verdicts on two
   * staging URLs. */
  isFamilyNarrowing: "src/lib/url/narrowing.ts",
  /** A claims read MINUS the chip facets the URL CONTRIBUTED to it — this
   * page's vocabulary applied to the rule above, and the one place the
   * subtraction is spelled (admin-window/BUG-0192). A second copy would be the
   * one that forgot the standing tab's own bucket is not a control above —
   * which is what the FIRST copy forgot (admin-window/BUG-0193). */
  withoutChipFacets: "src/lib/claims/filters.ts",
  /** What a claims TAB merges into its own read of its own accord — the
   * standing tab's bucket, and nothing else today (admin-window/BUG-0193). It
   * is in this map because two readings of that one fact is precisely the bug:
   * the read merged it and the subtraction took it away again, so the widened
   * count landed in the other tab's population. The read and the subtraction
   * now spell it once, here. */
  tabFacetsOf: "src/lib/claims/filters.ts",
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
  /** The app's ONE "newest first": descending by an instant column, an
   * unreadable stamp last, the key column descending on a tie
   * (admin-window/DEBT-0016). It was declared twice under this one name, over
   * DIFFERENT key columns — `created_at`/`verdict_id` in `src/lib/db/verdict.ts`
   * and `started_at`/`run_id` in `src/lib/db/cycles.ts` — with the same body
   * written out twice. It was never two rules, so the columns are handed in
   * (`NEWEST_VERDICT_FIRST`, `NEWEST_RUN_FIRST`) and the rule is one exported
   * thing: two windows cannot come to disagree about what "newest first"
   * means. A second declaration of this name, wherever it is, is that
   * disagreement starting again. */
  newestFirst: "src/lib/order/newest-first.ts",
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
    // `interface` and `type` joined them when the vocabulary gained a SHAPE
    // (admin-window/TASK-0072): `UnchippedNarrowing` is a name two modules can
    // declare with two meanings just as thoroughly as a function is, and a
    // detector that knew only value declarations would grade that rule
    // vacuously. `export type { X } from …` is not matched — the name does not
    // follow the keyword there — so a barrel is still a barrel.
    `^export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type)\\s+${name}\\b`,
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
    // The two the vocabulary's own SHAPE is spelled with
    // (admin-window/TASK-0072). Both were measured against the real tree
    // before they were pinned: with the detector's value-only alternation, a
    // second `export interface UnchippedNarrowing` anywhere in `src/` left the
    // guard green.
    "export interface": `export interface narrowedTo {\n  facet: string;\n}`,
    "export type": `export type narrowedTo = string;`,
    "export interface, generic": `export interface narrowedTo<Filter> {\n  value: (filter: Filter) => string;\n}`,
  };

  for (const [spelling, fixture] of Object.entries(ALSO_A_DECLARATION)) {
    it(`flags a declaration written as \`${spelling}\``, () => {
      expect(declares("narrowedTo", codeLinesIn(fixture)), spelling).toBe(true);
    });
  }

  /**
   * The same two fixtures on the name admin-window/DEBT-0016 added, spelled the
   * way its module and its CALLERS really spell it: the declaration is generic
   * (`export function newestFirst<`) and every caller both imports it and calls
   * it with a column pair. A detector that flagged the caller would name two
   * owners for a name that has one, and one that missed the generic
   * declaration would grade the rule vacuously.
   */
  const NEWEST_FIRST_DECLARATION = `
export function newestFirst<
  Instant extends string,
  Key extends string,
  Row extends Readonly<Record<Instant, string | null>>,
>(rows: readonly Row[], columns: { instant: Instant; key: Key }): Row[] {
  return [...rows];
}
`;

  const NEWEST_FIRST_CALLER = `
import { newestFirst } from "../order/newest-first";

const NEWEST_VERDICT_FIRST = { instant: "created_at", key: "verdict_id" } as const;

export const ordered = (rows: readonly VerdictLogRow[]) =>
  newestFirst(rows, NEWEST_VERDICT_FIRST);
`;

  it("flags the generic declaration of `newestFirst`", () => {
    expect(declares("newestFirst", codeLinesIn(NEWEST_FIRST_DECLARATION))).toBe(true);
  });

  it("leaves a module that imports and CALLS `newestFirst` alone", () => {
    expect(declares("newestFirst", codeLinesIn(NEWEST_FIRST_CALLER))).toBe(false);
  });

  it("does not flag a TYPE-ONLY re-export of the name", () => {
    // The other direction of the two spellings above (LESSONS 8): a barrel
    // carrying the shape onward is not a second owner of it, and `export type
    // { … }` puts the keyword and the name on one line without declaring
    // anything. `src/lib/claims/filters.ts` imports the shape this way.
    const barrel = `export type { narrowedTo } from "./window-line";`;
    expect(declares("narrowedTo", codeLinesIn(barrel))).toBe(false);
    const typeImport = `import { type narrowedTo } from "@/lib/url/narrowing";`;
    expect(declares("narrowedTo", codeLinesIn(typeImport))).toBe(false);
  });

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

/**
 * THE ATTRIBUTION RULE'S OWN THREE STATES (admin-window/BUG-0192).
 *
 * `isFamilyNarrowing` is the leaf a sentence asks before it points at a
 * control: "did THIS family of facets remove rows from this surface". The rule
 * it enforces is the architect's of 2026-09-11 (ARCHITECTURE.md §4.3) —
 * presence is never evidence of effect — and it is graded here, on numbers
 * alone, because that is the whole of what the leaf sees: it takes booleans
 * and counts, imports nothing, and reaches no database.
 *
 * Each state is asserted in BOTH directions (LESSONS 8): a state that could
 * only ever answer one way would pass vacuously.
 */
describe("did this family of facets narrow this surface", () => {
  it("says nothing about a family that is not in force", () => {
    // Whatever the rows did, this family did none of it — including over a
    // surface some OTHER facet really narrowed, which is the state a presence
    // answer would have got wrong by never being asked.
    expect(
      isFamilyNarrowing({
        inForce: false,
        othersInForce: true,
        surface: { rendered: 2, population: 10 },
        withoutFamily: 2,
      }),
    ).toBe(false);
    expect(
      isFamilyNarrowing({
        inForce: false,
        othersInForce: false,
        surface: { rendered: 10, population: 10 },
      }),
    ).toBe(false);
  });

  it("is the surface's own two-fact answer where no other family is in force", () => {
    // Every row this surface lost, it lost to this family, so the answer is
    // `isSurfaceNarrowed` and no read is bought — asserted against that
    // function rather than against a number typed here, so the two rules
    // cannot come apart.
    for (const surface of [
      { rendered: 4, population: 10 },
      { rendered: 10, population: 10 },
      { rendered: 0, population: 0 },
    ]) {
      expect(
        isFamilyNarrowing({ inForce: true, othersInForce: false, surface }),
        JSON.stringify(surface),
      ).toBe(isSurfaceNarrowed(true, surface));
    }
    // …and that really is both answers, so neither direction is vacuous.
    expect(
      isFamilyNarrowing({
        inForce: true,
        othersInForce: false,
        surface: { rendered: 4, population: 10 },
      }),
    ).toBe(true);
    expect(
      isFamilyNarrowing({
        inForce: true,
        othersInForce: false,
        surface: { rendered: 10, population: 10 },
      }),
    ).toBe(false);
  });

  it("asks the count with this family dropped where both families are in force", () => {
    // The surface is narrowed in BOTH of these — same two facts — and the
    // widened count is the whole difference between them: where the same read
    // draws the same rows without this family's facets, the others did all of
    // it and this family removed nothing.
    const surface = { rendered: 3, population: 10 };
    expect(
      isFamilyNarrowing({
        inForce: true,
        othersInForce: true,
        surface,
        withoutFamily: 3,
      }),
    ).toBe(false);
    expect(
      isFamilyNarrowing({
        inForce: true,
        othersInForce: true,
        surface,
        withoutFamily: 6,
      }),
    ).toBe(true);
  });

  it("says NOTHING where the count that would establish it is absent", () => {
    // Silence is true in every state and an attribution is not, so an
    // unsupplied count — the leg that was never issued, or the one that
    // refused — answers false rather than falling back to the two facts, which
    // in this state cannot tell the two families apart.
    const surface = { rendered: 3, population: 10 };
    expect(
      isFamilyNarrowing({ inForce: true, othersInForce: true, surface }),
    ).toBe(false);
    expect(
      isFamilyNarrowing({
        inForce: true,
        othersInForce: true,
        surface,
        withoutFamily: undefined,
      }),
    ).toBe(false);
    // Non-vacuous: the same surface with the count supplied answers true, so
    // this is the absence being graded and not the numbers.
    expect(
      isFamilyNarrowing({
        inForce: true,
        othersInForce: true,
        surface,
        withoutFamily: 10,
      }),
    ).toBe(true);
  });
});
