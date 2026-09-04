import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHAPES } from "@/lib/review/shapes";
import type { ReviewItemRow } from "@/lib/review/shapes";
import { reviewItemShapes, type ReviewItemRow as FixtureRow } from "../../fixtures/rows";
import { codeLines, repoRoot, sourceFiles } from "../source-tree";

/**
 * The structural half of admin-window/TASK-0006's acceptance criteria, asserted
 * against the source tree rather than left to per-ticket discipline (the same
 * technique as `tests/offline/db/layering.test.ts`):
 *
 *   - the kind mapping exists in exactly one module (spec §6, "the kind belongs
 *     to the shape and is derived in code");
 *   - no severity score, rank or formula is computed anywhere (the ranking
 *     formula is parked — resolver.md §11, VISION non-goal);
 *   - no WRITE PATH toward the M2 close is built: no server action anywhere
 *     under `src/`, and no route or page whose path is named settle/verdict.
 *     Narrowed from "no settle or verdict code" on 2026-09-02
 *     (admin-window/BUG-0020) — see that case's own comment.
 *
 * The mutation surface itself is NOT owned here: `tests/offline/edit/config.test.ts`,
 * "the write surface of the whole repo", owns it — no `.insert`/`.upsert`/`.rpc`
 * anywhere under `src/`, `.update(` only in `src/lib/db/records.ts`, and
 * `settle_review_item` nowhere.
 * Nothing from that block is duplicated here (ARCHITECTURE.md §10, one owner
 * per structural guard).
 *
 * Two later tickets code against `shapes.ts` without reading it, so a second
 * copy of this derivation appearing anywhere is the defect these guard.
 */

const SHAPES_MODULE = "src/lib/review/shapes.ts";

/*
 * The walk and the comment-stripping read are `tests/offline/source-tree.ts`
 * (admin-window/BUG-0032). They used to be a private copy here, hardened
 * against the probe `db/layering.test.ts` writes and deletes under the source
 * tree in a parallel worker; two sibling files carried the same copy
 * UNhardened and reddened on it (admin-window/TASK-0006 saw it once in five
 * full-suite runs before this file's own guard). One copy now.
 */

function filesWhereCodeMatches(pattern: RegExp, base: string = repoRoot): string[] {
  return sourceFiles(base).filter((file) =>
    codeLines(file, base).some((line) => pattern.test(line)),
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

/** A React server action: the file-level directive that makes a module one. */
const USE_SERVER = /["']use server["']/;

/** A route or page whose PATH is named for the close — how one would arrive. */
const SETTLE_PATH = /^src\/app\/.*(settle|verdict)/i;

describe("nothing is scaffolded toward the M2 close", () => {
  it("builds no write path toward the M2 close", () => {
    // Narrowed 2026-09-02 (architect ruling, admin-window/BUG-0020). The old
    // predicate banned any declaration NAMED settle*/verdict*, which is the
    // domain's own vocabulary — `settled` is a review_items.status value,
    // "settled values" is a spec §5 gauge, `verdict` is an
    // observations.rejected_by reason. It cost admin-window/TASK-0007 a rename
    // of correct code and admin-window/BUG-0012 a second one. What must not
    // exist is a WRITE toward the close, not a word.
    //
    // The mutation surface itself is pinned once, in
    // tests/offline/edit/config.test.ts ("the write surface of the whole repo"):
    // no .insert/.upsert/.rpc anywhere, .update only in src/lib/db/records.ts,
    // and settle_review_item nowhere. These are the two shapes it does not
    // cover — a server action, and a route or page named for the close.
    expect(filesWhereCodeMatches(USE_SERVER)).toEqual([]);
    expect(sourceFiles().filter((file) => SETTLE_PATH.test(file))).toEqual([]);
  });

  it("mentions verdicts under src only as registry entries in tables.ts", () => {
    // admin-window/TASK-0002 named `verdicts` in `T` on purpose: it does not
    // exist until M2's handoff migration, so reading it classifies as
    // not_provisioned against today's database (ARCHITECTURE.md §4.1). Those
    // entries are the whole footprint; this pins them so a verdict code path
    // cannot arrive unnoticed before M2 designs it.
    //
    // The list is exactly as tight as it was when it held one line: still an
    // exact match, still `tables.ts` alone. The second line arrived with
    // admin-window/BUG-0077, which made the registry say table-or-view for
    // every name it spells — so `verdicts` must be classified there or the map
    // does not compile. It is the same kind of entry as the first, a NAME and
    // its metadata; neither is a read, a write, a route or a component, which
    // is what this guard is about.
    expect(filesWhereCodeMatches(/verdicts/)).toEqual(["src/lib/db/tables.ts"]);
    const entries = codeLines("src/lib/db/tables.ts").filter((line) =>
      /verdicts/.test(line),
    );
    expect(entries).toEqual(['  verdicts: "verdicts",', '  [T.verdicts]: "table",']);
  });
});

/**
 * The guard guarding itself (the technique `tests/offline/db/layering.test.ts`
 * uses for its credential scanner). The rule above is only worth its green if
 * the two patterns actually report the shapes they forbid — a rule that is
 * green because it can see nothing is not a rule.
 *
 * The probe tree is a MIRROR of `src/` under `tests/.probes/`, not files
 * written into the real `src/`, and that is deliberate. Writing them into
 * `src/` works, but three other offline suites walk that tree in parallel and
 * two of them (`db/layering.test.ts`, `browse/views.test.ts`) read each file
 * without an ENOENT guard: a probe that is deleted between their readdir and
 * their read reddens a stranger's suite. Measured on this branch
 * (admin-window/BUG-0020): 2 such failures in 9 full offline runs, always in
 * another file. The walker and both patterns below are the same functions and
 * the same regexes the rule uses — only the base directory differs — so the
 * proof is unchanged and the race is gone.
 */
describe("the M2-close guard itself", () => {
  const probeBase = path.join(repoRoot, "tests", ".probes", `m2-close-${process.pid}`);
  const ACTION_PROBE = "src/lib/review/close-action.ts";
  const ROUTE_PROBE = "src/app/api/settle/route.ts";

  /** A server action: the file-level directive is what makes a module one. */
  const ACTION_SOURCE = '"use server";\n\nexport async function stamp() {}\n';

  /** A route named for the close, with no directive and no write call. */
  const ROUTE_SOURCE =
    'export const runtime = "nodejs";\n' +
    "export function POST() {\n  return new Response(null, { status: 204 });\n}\n";

  function write(file: string, source: string): void {
    const full = path.join(probeBase, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source, "utf8");
  }

  it("reports a server action and a close-named route while they exist", () => {
    let walked: string[] = [];
    let served: string[] = [];
    let named: string[] = [];
    try {
      write(ACTION_PROBE, ACTION_SOURCE);
      write(ROUTE_PROBE, ROUTE_SOURCE);
      walked = sourceFiles(probeBase);
      served = filesWhereCodeMatches(USE_SERVER, probeBase);
      named = walked.filter((file) => SETTLE_PATH.test(file));
    } finally {
      fs.rmSync(probeBase, { force: true, recursive: true });
    }

    // The mirror is the whole world the scan saw, so nothing below is an
    // accident of the real tree.
    expect([...walked].sort()).toEqual([ACTION_PROBE, ROUTE_PROBE].sort());
    // Each pattern catches its own shape...
    expect(served).toEqual([ACTION_PROBE]);
    expect(named).toEqual([ROUTE_PROBE]);
    // ...and neither is redundant: the path rule is blind to a server action
    // outside `src/app/`, and the directive rule is blind to a route that only
    // carries the name. Together they are the two shapes the write-surface
    // guard in tests/offline/edit/config.test.ts cannot see at all — that file
    // scans for `.insert`/`.upsert`/`.rpc`/`.update`, and neither probe has one.
    expect(named).not.toContain(ACTION_PROBE);
    expect(served).not.toContain(ROUTE_PROBE);
  });

  it("reports an INLINE directive inside a page, not only a file-level one", () => {
    // admin-window/BUG-0020 QA. `"use server"` at the top of a function body is
    // the other half of the directive's contract (Next 16 docs,
    // 01-getting-started/07-mutating-data.md: "at the top of an asynchronous
    // function ... or at the top of a separate file"), and it is the shape a
    // settle control most plausibly arrives as — inline in `queues/page.tsx`,
    // which TASK-0010 renders next. Measured caught on the real tree; pinned
    // here so a later narrowing of USE_SERVER cannot lose it silently.
    const inlineBase = path.join(repoRoot, "tests", ".probes", `inline-${process.pid}`);
    const PAGE_PROBE = "src/app/queues/page.tsx";
    let served: string[] = [];
    let named: string[] = [];
    try {
      const full = path.join(inlineBase, PAGE_PROBE);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(
        full,
        "export default function Page() {\n" +
          "  async function stamp() {\n" +
          '    "use server";\n' +
          "    return null;\n" +
          "  }\n  return stamp;\n}\n",
        "utf8",
      );
      served = filesWhereCodeMatches(USE_SERVER, inlineBase);
      named = sourceFiles(inlineBase).filter((file) => SETTLE_PATH.test(file));
    } finally {
      fs.rmSync(inlineBase, { force: true, recursive: true });
    }
    expect(served).toEqual([PAGE_PROBE]);
    // ...and the path rule is blind to it: the page is not named for the close.
    expect(named).toEqual([]);
    expect(fs.existsSync(inlineBase)).toBe(false);
  });

  it("leaves no probe behind for another suite to walk into", () => {
    // The `finally` above must hold even when its assertions fail.
    expect(fs.existsSync(probeBase)).toBe(false);
  });

  it("scans a real tree that does carry directives", () => {
    // The rule's green must not be the green of a scanner that reads no
    // directive at all: `"use client"` is all over this app, on code lines, and
    // the same `filesWhereCodeMatches` reports it. Deliberately NOT re-asserting
    // `USE_SERVER` is empty — that is the rule's own assertion above.
    expect(filesWhereCodeMatches(/["']use client["']/).length).toBeGreaterThan(0);
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
