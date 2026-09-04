import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  implicitInterElementSpaces,
  implicitInterElementSpacesIn,
  repoRoot,
  sourceFiles,
} from "../source-tree";
import { disagreeingCounts } from "./markup";

/**
 * The inter-element-space rule, asserted over the WHOLE source tree rather
 * than over three pages (campaign admin-window/BUG-0045, QA).
 *
 * The defect that reached the screen — `sourceis`, `stuck_patterndial` — is a
 * space a JSX transform is free to drop, and the transform the offline suite
 * runs disagrees with the one `next build` runs: `renderToStaticMarkup` keeps
 * a space the delivered HTML loses. So a rendered-markup assertion in this
 * suite cannot see the defect at all, and the source rule is the only guard
 * that can. It was applied by `sources/page.test.ts`, `claims/page.test.ts`
 * and `cycles/page.test.ts` — each to its own file — which leaves the shared
 * component that renders on EVERY page's not-provisioned state
 * (`src/components/ui/not-provisioned.tsx`, fixed by the same commit but
 * asserted nowhere) and every page written after this one unguarded. One
 * defect class deserves one assertion over the tree, not a new copy per page.
 *
 * The rule is deliberately conservative: whether the space survives depends on
 * where the text node sits among its parent's children (measured on delivered
 * HTML, 2026-09-03: `</span> is the run's`, last child, arrived glued;
 * `</span> says whose`, mid-paragraph, survived), and no line-oriented scanner
 * can know that. It therefore flags both positions, and the fix — writing the
 * space as `{" "}`, an expression container no transform may drop — is correct
 * in both.
 */
describe("inter-element spaces in every file the app ships", () => {
  const base = path.join(
    repoRoot,
    "tests",
    ".probes",
    `copy-spaces-${process.pid}-${randomUUID()}`,
  );
  const GLUED = "src/app/glued/page.tsx";
  const EXPLICIT = "src/app/explicit/page.tsx";

  beforeAll(() => {
    mkdirSync(path.join(base, "src", "app", "glued"), { recursive: true });
    mkdirSync(path.join(base, "src", "app", "explicit"), { recursive: true });
    writeFileSync(
      path.join(base, GLUED),
      [
        "export function Glued() {",
        "  return (",
        "    <p>",
        '      The read of <span className="type-data">source</span> is the run&rsquo;s own',
        "      text.",
        "    </p>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(base, EXPLICIT),
      [
        "export function Explicit() {",
        "  return (",
        "    <p>",
        '      The read of <span className="type-data">source</span>{" "}',
        "      is the run&rsquo;s own text.",
        "    </p>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("flags the spelling that reached the screen and clears the ones that did not", () => {
    // Must flag: the pre-fix spelling a user-sim read off /cycles as `sourceis`.
    expect(
      implicitInterElementSpacesIn('  <span className="type-data">source</span> is the run'),
    ).toEqual(['1: <span className="type-data">source</span> is the run']);
    // Must NOT flag — or the assertion over the tree below is a formality:
    // an explicit expression, correct typography, and a comment that quotes
    // the defect while documenting it.
    for (const clean of [
      '<span className="type-data">source</span>{" "}',
      "<span>source</span>, and the run",
      "<span>source</span>.",
      "<span>source</span> — the run",
      "  // <span>source</span> is the run",
      "   * <span>source</span> is the run",
      "  /* <span>source</span> is the run */",
    ]) {
      expect(implicitInterElementSpacesIn(clean), clean).toEqual([]);
    }
  });

  it("reads every file of a tree, not the three the bug happened to name", () => {
    // A fixture tree carrying one glued file and one fixed file: the walk sees
    // both, the rule separates them. This is the RED state of the assertion
    // that follows, kept as a fixture so it can never go vacuous.
    expect(sourceFiles(base)).toEqual([EXPLICIT, GLUED]);
    expect(offenders(base)).toEqual([
      `${GLUED} 4: The read of <span className="type-data">source</span> is the run&rsquo;s own`,
    ]);
  });

  it("leaves no file under src/ leaning on a space a transform may drop", () => {
    const files = sourceFiles();
    // Non-vacuous: the shared component the three page tests do not cover, and
    // a tree that is plainly the real one rather than an empty walk.
    expect(files).toContain("src/components/ui/not-provisioned.tsx");
    expect(files.length).toBeGreaterThan(50);
    expect(offenders()).toEqual([]);
  });
});

/** Every site in a tree, as `file line: text`, so a failure names it. */
function offenders(base?: string): string[] {
  return sourceFiles(base).flatMap((file) =>
    implicitInterElementSpaces(file, base).map((hit) => `${file} ${hit}`),
  );
}

/**
 * The count-agreement guard, proved on both sides before three page tests lean
 * on it (campaign admin-window/BUG-0046).
 *
 * `disagreeingCounts` is a scanner, and a scanner that has never seen a
 * spelling it must flag passes vacuously. Every string below is either one the
 * walk actually read off the running app, or one the app renders correctly and
 * a blunter pattern would call a defect.
 */
describe("the count-with-its-noun guard", () => {
  it("flags the three strings the walk read off the running app", () => {
    expect(disagreeingCounts("<p>1 sources holding one</p>")).toEqual(["1 sources"]);
    expect(disagreeingCounts("<p>of 1 items read here, 700 folds in all</p>")).toEqual([
      "1 items",
    ]);
    expect(disagreeingCounts("<p>1 sources, 2 domains</p>")).toEqual(["1 sources"]);
  });

  it("flags a count and its noun that a gauge card splits across two elements", () => {
    // The shape that matters: a card's figure and its sub-line are siblings,
    // so the text either side of the boundary must not be read as one number.
    expect(
      disagreeingCounts('<div><span>1</span><span>1 sources holding one</span></div>'),
    ).toEqual(["1 sources"]);
    expect(disagreeingCounts("<span>1</span> rows in this window")).toEqual(["1 rows"]);
  });

  it("leaves alone the counts that are already correct", () => {
    for (const correct of [
      "<p>1 source, 2 domains</p>",
      "<p>0 sources holding a claim</p>",
      "<p>21,001 sources</p>",
      "<p>a window of at most 1,000 rows</p>",
      "<p>0.1 rows per cycle</p>",
      // A figure and a heading in two cells are not a phrase, and the app
      // renders whole tables of them.
      "<tr><td>1</td><td>sources</td></tr>",
      // Words ending in -s that no plural rule applies to.
      "<p>1 status, unchanged</p>",
      "<p>1 is the floor</p>",
    ]) {
      expect(disagreeingCounts(correct), correct).toEqual([]);
    }
  });
});
