import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHAPES } from "@/lib/review/shapes";
import type { ReviewItemRow } from "@/lib/review/shapes";
import { reviewItemShapes, type ReviewItemRow as FixtureRow } from "../../fixtures/rows";

/**
 * The structural half of admin-window/TASK-0006's acceptance criteria, asserted
 * against the source tree rather than left to per-ticket discipline (the same
 * technique as `tests/offline/db/layering.test.ts`):
 *
 *   - the kind mapping exists in exactly one module (spec §6, "the kind belongs
 *     to the shape and is derived in code");
 *   - no severity score, rank or formula is computed anywhere (the ranking
 *     formula is parked — resolver.md §11, VISION non-goal);
 *   - no settle or verdict code exists (the close is M2's, and nothing may be
 *     scaffolded toward it).
 *
 * Two later tickets code against `shapes.ts` without reading it, so a second
 * copy of this derivation appearing anywhere is the defect these guard.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const srcRoot = path.join(repoRoot, "src");
const SHAPES_MODULE = "src/lib/review/shapes.ts";

/**
 * Every TypeScript source file under `src/`, as repo-relative posix paths.
 *
 * `__`-prefixed files are excluded and a file that vanishes mid-walk is
 * skipped, because `tests/offline/db/layering.test.ts` WRITES AND DELETES
 * `src/__credential_guard_probe__.ts` while asserting its own scanner, and
 * vitest runs test files in parallel. A tree scanner that reads whatever it
 * listed a moment ago is a flake against any suite that touches `src/`
 * (admin-window/TASK-0006 — it failed exactly once in five full-suite runs
 * before this guard). Nothing real is hidden: a skip only happens for a file
 * that no longer exists, which is by definition not part of the tree under
 * test.
 */
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
  walk(srcRoot);
  return found.sort();
}

/** Lines that are code, not commentary — a doc comment naming a thing is documentation. */
function codeLines(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, file), "utf8");
  } catch (thrown) {
    // Only the transient case above; anything else is a real failure.
    if ((thrown as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw thrown;
  }
  return text
    .split("\n")
    .filter((line) => {
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

describe("the source tree", () => {
  it("contains the module these rules are about", () => {
    expect(sourceFiles()).toContain(SHAPES_MODULE);
  });
});

describe("the kind mapping lives in exactly one module", () => {
  it("spells a shape name in shapes.ts alone", () => {
    // Shape is what kind is derived from, so a second file naming a shape is a
    // second place the derivation could live. A page filtering by shape takes
    // the values from `SHAPES` / the `Shape` type instead of retyping them.
    const shapeLiteral = new RegExp(`["'\`](${SHAPES.join("|")})["'\`]`);
    expect(filesWhereCodeMatches(shapeLiteral)).toEqual([SHAPES_MODULE]);
  });

  it("maps a shape to a kind on a code line in shapes.ts alone", () => {
    const mapping = new RegExp(`(${SHAPES.join("|")})[^\\n]*(decision|signal)`);
    expect(filesWhereCodeMatches(mapping)).toEqual([SHAPES_MODULE]);
  });
});

describe("no severity score, rank or formula", () => {
  it("computes no ranking from severity anywhere under src", () => {
    const scored = /severity[^\n]*(score|rank|weight|priorit|points)|(?:score|rank|weight|priorit|points)[^\n]*severity/i;
    expect(filesWhereCodeMatches(scored)).toEqual([]);
  });

  it("assigns no number to a severity value anywhere under src", () => {
    // `{ high: 0, low: 1 }` and friends — the shape a rank map takes.
    const numbered = /\b(high|low)\b\s*:\s*-?\d/;
    expect(filesWhereCodeMatches(numbered)).toEqual([]);
  });
});

describe("nothing is scaffolded toward the M2 close", () => {
  it("declares no settle or verdict function under src", () => {
    const settleOrVerdict =
      /(?:function|const|let|class)\s+\w*(?:settle|verdict)\w*|settle_review_item|\.rpc\(/i;
    expect(filesWhereCodeMatches(settleOrVerdict)).toEqual([]);
  });

  it("mentions verdicts under src only as the table name in tables.ts", () => {
    // admin-window/TASK-0002 named `verdicts` in `T` on purpose: it does not
    // exist until M2's handoff migration, so reading it classifies as
    // not_provisioned against today's database (ARCHITECTURE.md §4.1). That
    // one entry is the whole footprint; this pins it so a verdict code path
    // cannot arrive unnoticed before M2 designs it.
    expect(filesWhereCodeMatches(/verdicts/)).toEqual(["src/lib/db/tables.ts"]);
    const entries = codeLines("src/lib/db/tables.ts").filter((line) =>
      /verdicts/.test(line),
    );
    expect(entries).toEqual(['  verdicts: "verdicts",']);
  });
});

describe("the fixture rows and the product's row type agree", () => {
  it("accepts every fixture shape as a ReviewItemRow", () => {
    // Structural, at compile time and at run time: `tests/fixtures/rows.ts`
    // declares its own `ReviewItemRow` against the migration, and this module
    // declares the product's. If either drifts, this assignment stops
    // type-checking — which is the point.
    const fixtures: FixtureRow[] = reviewItemShapes();
    const rows: ReviewItemRow[] = fixtures;
    const asFixtures: FixtureRow[] = rows;
    expect(asFixtures).toHaveLength(3);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "review_item_id",
          "queue",
          "source_id",
          "domain",
          "entity_id",
          "field",
          "severity",
          "status",
          "summary",
          "evidence",
          "folded_count",
          "opened_at",
          "last_evidence_at",
        ].sort(),
      );
    }
  });
});
