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
 *   - the M2 close settles in exactly ONE place: one call site, reached from
 *     routes that delegate to it, and no server action anywhere under `src/`.
 *     INVERTED on 2026-09-08 (admin-window/TASK-0048) from "nothing is
 *     scaffolded toward the M2 close" — M2 builds the close, so the question
 *     stopped being whether a settlement path exists and became whether there
 *     is more than one. Narrowed once before, from "no settle or verdict code"
 *     on 2026-09-02 (admin-window/BUG-0020) — see that case's own comment.
 *
 * The mutation surface itself is NOT owned here: `tests/offline/edit/config.test.ts`,
 * "the write surface of the whole repo", owns WHICH file may call a procedure
 * and spell its name, `.update(` only in `src/lib/db/records.ts`, and no
 * `.insert`/`.upsert` anywhere. This file owns the M2 close's own shape — how
 * many call sites there are, and that a route named for the close reaches the
 * database through the seam rather than around it (ARCHITECTURE.md §10, one
 * owner per structural guard).
 *
 * Two later tickets code against `shapes.ts` without reading it, so a second
 * copy of this derivation appearing anywhere is the defect these guard.
 */

const SHAPES_MODULE = "src/lib/review/shapes.ts";
/** The one call site of `settle_review_item` (admin-window/TASK-0048). */
const VERDICT_MODULE = "src/lib/db/verdict.ts";
/** Where every database object name is spelled — table, view or function. */
const TABLES_MODULE = "src/lib/db/tables.ts";

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

/** The registry name, and any code line that mentions it. */
const MENTIONS_VERDICTS = /verdicts/;

/** A call to a database procedure, wherever it is written. */
const PROCEDURE_CALL = /\.rpc\(/;

/** A call that talks to the database directly, of any kind the app can make. */
const DATABASE_CALL = /\.rpc\(|\.from\(|\.update\(|\.insert\(|\.upsert\(/;

describe("the M2 close settles in exactly one place", () => {
  it("settles through exactly one call site, and it is the seam", () => {
    // INVERTED 2026-09-08 (admin-window/TASK-0048). Through M1 the M2-close
    // pin asserted that NO settlement path existed; M2 builds one, so the
    // property worth pinning is that there is exactly one of it. Every action
    // of spec §7 becomes one typed decision and one call to
    // `settle_review_item` (ARCHITECTURE.md §9.2) — a surface that assembles
    // its own call is the second write path this campaign forbids, and the
    // list below is what makes "one entry point" a fact of the repo rather
    // than of the ticket that wrote the first one.
    expect(filesWhereCodeMatches(PROCEDURE_CALL)).toEqual([VERDICT_MODULE]);
  });

  it("keeps a route named for the close out of the database", () => {
    // The close's route may now EXIST — that is what M2 builds — so this is no
    // longer an emptiness assertion. What it must not do is talk to the
    // database itself: it takes the decision, hands it to the seam, and renders
    // what comes back. A settle route holding its own `.from(` or `.rpc(` is a
    // second path with the seam's name on the door.
    const closeNamed = sourceFiles().filter((file) => SETTLE_PATH.test(file));
    expect(filesWhereCodeMatches(DATABASE_CALL).filter((file) => SETTLE_PATH.test(file))).toEqual(
      [],
    );
    // Not a claim that the route exists yet: M2 adds it under its own ticket.
    expect(closeNamed.filter((file) => !file.startsWith("src/app/"))).toEqual([]);
  });

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
    // no .insert/.upsert anywhere, .update only in src/lib/db/records.ts, and a
    // procedure call only in the seam. This is the shape it does not cover: a
    // SERVER ACTION, which is a mutation entry point with no route and no
    // call-site spelling of its own.
    //
    // Still an emptiness assertion after the M2 inversion, and deliberately so:
    // the close arrives as a route that calls the seam (ARCHITECTURE.md §5, one
    // async boundary per route; the edit surface's PATCH route is the shipped
    // precedent). A ticket that genuinely needs a server action changes this
    // rule with its reason, rather than finding it already relaxed.
    expect(filesWhereCodeMatches(USE_SERVER)).toEqual([]);
  });

  it("reads verdicts from the registry and the seam, and nowhere else", () => {
    // admin-window/TASK-0002 named `verdicts` in `T` before it existed, so a
    // read of it classifies as not_provisioned against today's database
    // (ARCHITECTURE.md §4.1) — and it still does not exist on staging or in
    // production. INVERTED 2026-09-08 (admin-window/TASK-0048): M2 adds the
    // one READ of it, `readSettlementReadiness`, which is how every surface
    // learns whether it may offer a settlement at all (DECISIONS 2026-09-08 —
    // PostgREST cannot introspect a function without calling it, so the
    // table's presence is the question that is safe to ask). Two files now,
    // and the list is exactly as tight as when it held one: a page asking the
    // question for itself is the hand-copied probe this forbids (common
    // violation 9).
    expect(filesWhereCodeMatches(MENTIONS_VERDICTS)).toEqual([
      TABLES_MODULE,
      VERDICT_MODULE,
    ]);

    // The registry's entries are a NAME and its metadata — not a read, a
    // write, a route or a component — and they stay pinned line by line.
    const entries = codeLines(TABLES_MODULE).filter((line) =>
      MENTIONS_VERDICTS.test(line),
    );
    expect(entries).toEqual(['  verdicts: "verdicts",', '  [T.verdicts]: "table",']);

    // The seam's mentions are the read itself, through `T` — never the
    // literal, which `tests/offline/db/layering.test.ts` pins to `tables.ts`
    // alone.
    const seamLines = codeLines(VERDICT_MODULE).filter((line) =>
      MENTIONS_VERDICTS.test(line),
    );
    expect(seamLines.length).toBeGreaterThan(0);
    for (const line of seamLines) {
      expect(line, VERDICT_MODULE).toContain("T.verdicts");
    }
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

  // EXPECTED FAILURE while admin-window/BUG-0190 stands: this run cannot tell
  // its own mirror tree from one a dead run with the same pid left, so the
  // assertion below is red on purpose. THE FIX FLIPS THIS BACK TO A PLAIN
  // `it` — leave it as `it.fails` and the day the bug is fixed vitest reddens
  // here and sends the reader to the ticket.
  it.fails("is blind to a mirror tree left behind by a dead run that had this pid", () => {
    // admin-window/BUG-0190. This guard's mirror tree is named from
    // `process.pid` ALONE (`m2-close-${process.pid}`, above) and is removed
    // only in the `finally` of each case, so a run KILLED mid-case leaves the
    // whole tree on disk and nothing ever sweeps it: the area is gitignored
    // and ESLint-ignored, so no guard and no `git status` reports it. pids are
    // recycled, so a later worker drawing the dead run's number walks the
    // corpse's files as if it had planted them — and every case here compares
    // the walk with `toEqual`, so the corpse is reported as an extra source
    // file of the mirror. admin-window/BUG-0188 fixed exactly this for
    // `src/.probes/` (entropy in the name plus a dead-pid sweep,
    // `tests/probe-area.ts`); the mirror trees under `tests/.probes/` still
    // carry the pid-only naming it replaced.
    //
    // The corpse is planted at the path a DEAD run with this pid wrote to, not
    // at `probeBase`, so the fix — a base this run alone can name — is what
    // makes this pass, not a change to where the corpse goes.
    const corpseBase = path.join(repoRoot, "tests", ".probes", `m2-close-${process.pid}`);
    const corpse = path.join(corpseBase, "src/lib/review/corpse-of-a-killed-run.ts");
    let walked: string[] = [];
    let served: string[] = [];
    try {
      fs.mkdirSync(path.dirname(corpse), { recursive: true });
      fs.writeFileSync(corpse, '"use server";\nexport async function corpse() {}\n', "utf8");
      // Non-vacuous: the corpse really is on disk while the guard walks.
      expect(fs.existsSync(corpse)).toBe(true);
      write(ACTION_PROBE, ACTION_SOURCE);
      write(ROUTE_PROBE, ROUTE_SOURCE);
      walked = sourceFiles(probeBase);
      served = filesWhereCodeMatches(USE_SERVER, probeBase);
    } finally {
      fs.rmSync(probeBase, { force: true, recursive: true });
      fs.rmSync(corpseBase, { force: true, recursive: true });
    }
    expect([...walked].sort()).toEqual([ACTION_PROBE, ROUTE_PROBE].sort());
    expect(served).toEqual([ACTION_PROBE]);
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

/**
 * The INVERTED rules, guarding themselves (campaign admin-window/TASK-0048,
 * the same mirror-tree technique the M2-close guard above uses).
 *
 * An inversion is where a guard most easily becomes vacuous: "exactly one call
 * site" is satisfied by a scanner that can see the one file it was told about
 * and nothing else, and "the close route stays out of the database" is
 * satisfied by a scanner that sees no routes at all. So both are driven over a
 * mirror tree that carries the sanctioned shape and the forbidden one side by
 * side, and each rule is asserted to tell them apart.
 */
describe("the one-call-site and close-route rules, guarding themselves", () => {
  const probeBase = path.join(repoRoot, "tests", ".probes", `m2-one-call-${process.pid}`);

  /** The sanctioned call, in the seam — the input the rule must NOT report as an offender. */
  const SEAM_PROBE = "src/lib/db/verdict.ts";
  /** A second call, in a page — the input it MUST flag. */
  const PAGE_PROBE = "src/app/queues/[reviewItemId]/page.tsx";
  /** A close-named route that delegates to the seam: named for the close, and clean. */
  const DELEGATING_ROUTE_PROBE = "src/app/api/review-items/[id]/settle/route.ts";
  /** A close-named route that reads the database itself — the second path. */
  const DIRECT_ROUTE_PROBE = "src/app/api/verdict/route.ts";

  const SOURCES: ReadonlyArray<readonly [string, string]> = [
    [
      SEAM_PROBE,
      "export function settle(db: Db, decision: unknown) {\n" +
        '  return db.rpc("settle_review_item", { p_decision: decision });\n' +
        "}\n",
    ],
    [
      PAGE_PROBE,
      "export default async function Page({ db }: { db: Db }) {\n" +
        '  const { data } = await db.rpc("settle_review_item", { p_decision: {} });\n' +
        "  return data;\n" +
        "}\n",
    ],
    [
      DELEGATING_ROUTE_PROBE,
      'import { settleReviewItem } from "@/lib/db/verdict";\n\n' +
        "export async function POST(request: Request) {\n" +
        "  const result = await settleReviewItem(client(), await request.json());\n" +
        "  return Response.json(result);\n" +
        "}\n",
    ],
    [
      DIRECT_ROUTE_PROBE,
      "export async function POST(request: Request) {\n" +
        '  const { data } = await db.from("review_items").update({ status: "settled" });\n' +
        "  return Response.json(data);\n" +
        "}\n",
    ],
  ];

  it("tells the one sanctioned call from a second one, and a delegating route from a direct one", () => {
    let walked: string[] = [];
    let callers: string[] = [];
    let closeNamed: string[] = [];
    let closeNamedTouchingTheDatabase: string[] = [];
    try {
      for (const [file, source] of SOURCES) {
        const full = path.join(probeBase, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, source, "utf8");
      }
      walked = sourceFiles(probeBase);
      callers = filesWhereCodeMatches(PROCEDURE_CALL, probeBase);
      closeNamed = walked.filter((file) => SETTLE_PATH.test(file));
      closeNamedTouchingTheDatabase = filesWhereCodeMatches(DATABASE_CALL, probeBase).filter(
        (file) => SETTLE_PATH.test(file),
      );
    } finally {
      fs.rmSync(probeBase, { force: true, recursive: true });
    }

    // The mirror is the whole world the scan saw.
    expect(walked).toEqual(SOURCES.map(([file]) => file).sort());

    // Rule 1's two fixtures. It MUST flag the second call: on this tree the
    // list is two files, so the real assertion (`toEqual([VERDICT_MODULE])`)
    // fails, naming the page. It must NOT flag the seam's own call — that call
    // is the thing the rule exists to permit exactly once.
    expect(callers).toEqual([PAGE_PROBE, SEAM_PROBE].sort());
    expect(callers.filter((file) => file !== SEAM_PROBE)).toEqual([PAGE_PROBE]);

    // Rule 2's two fixtures. Both routes are named for the close, so the path
    // pattern alone cannot separate them — which is the whole reason the rule
    // asks what they CALL rather than what they are called.
    expect(closeNamed).toEqual([DIRECT_ROUTE_PROBE, DELEGATING_ROUTE_PROBE].sort());
    expect(closeNamedTouchingTheDatabase).toEqual([DIRECT_ROUTE_PROBE]);
    expect(closeNamedTouchingTheDatabase).not.toContain(DELEGATING_ROUTE_PROBE);

    // …and the seam, which DOES touch the database, is not a close-named route,
    // so rule 2 says nothing about it. The two rules are not the same rule.
    expect(closeNamedTouchingTheDatabase).not.toContain(SEAM_PROBE);
  });

  it("leaves no probe behind for another suite to walk into", () => {
    expect(fs.existsSync(probeBase)).toBe(false);
  });
});
