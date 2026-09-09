import { describe, expect, it } from "vitest";
import { codeLines, codeLinesIn, sourceFiles } from "../source-tree";

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
  /** A `?source=` → the value the query narrows by, or `null`. */
  sourceNarrowing: "src/lib/db/runs.ts",
  /** Does this URL carry a claim facet at all? Fact 1, claims domain. */
  hasNarrowingFacet: "src/lib/claims/filters.ts",
  /** Narrowed BEYOND what a block already applies to itself? Fact 1, queues. */
  isNarrowedBeyond: "src/lib/review/queue-filters.ts",
  /** The queues-domain adapter of the two-fact rule. */
  isBlockNarrowed: "src/lib/review/queue-filters.ts",
  /** The two-fact rule itself, for every surface (admin-window/DEBT-0008). */
  isSurfaceNarrowed: "src/lib/url/narrowing.ts",
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
    `^export\\s+(?:async\\s+)?(?:function|const|let)\\s+${name}\\b`,
  );
  return lines.some((line) => declaration.test(line.trim()));
}

/** Every file of the tree whose CODE declares `name`. */
function declaringFiles(name: string): string[] {
  return sourceFiles().filter((file) => declares(name, codeLines(file)));
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
});

describe("the narrowing vocabulary has one name per question", () => {
  it("declares each name in exactly one module", () => {
    for (const [name, owner] of Object.entries(OWNER)) {
      expect(declaringFiles(name), name).toEqual([owner]);
    }
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
