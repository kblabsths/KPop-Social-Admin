import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allSourceFiles,
  repoRoot,
  sourceFiles,
  sourceText,
} from "../offline/source-tree";

/**
 * The end-to-end pin for admin-window/BUG-0032, and the reason this project
 * exists at all.
 *
 * `tests/offline/db/layering.test.ts` proves its own credential scanner by
 * WRITING a probe into the source tree and deleting it again, ~20 times a run.
 * Four other offline files walk that same tree in parallel workers. Two of
 * them crashed on it (`ENOENT` from `readFileSync`, and — since the probe
 * became a whole DIRECTORY — from `readdirSync` too), and one of them also
 * REPORTED the probe as a violation of the rule it asserts. Under an amplified
 * churn loop, 26 of 40 runs died.
 *
 * ## Why this file is not in the offline project
 *
 * It plants the probe in the SHARED tree — that is the whole point, since a
 * walker resolves the tree from its own location and cannot be pointed
 * elsewhere. A first attempt at this pin lived in `tests/offline/` and fired
 * the very race it pinned: the parent run's own copies of the four walkers
 * executed in parallel workers against the tree it was mutating, taking a
 * sub-1-in-37 flake to 1-in-5. So it lives in its own vitest project, one fork,
 * and `npm test` runs that project as a separate invocation AFTER the offline
 * one. `tests/offline/toolchain.test.ts` asserts both halves of that isolation.
 *
 * ## What is pinned
 *
 * Three shapes, all against the real probe path:
 *
 *   1. a READABLE probe — the deterministic half (repro A on the case): the
 *      walkers must not see it at all;
 *   2. a DANGLING SYMLINK — the race with the timing removed: `readdir` lists
 *      it, `open` fails ENOENT;
 *   3. the real CHURN — the probe directory appearing and vanishing as fast as
 *      the filesystem allows, which is the only way to reach the `readdir`
 *      ENOENT on a directory that went away mid-walk.
 */

/** The path `tests/offline/db/layering.test.ts` writes its probe to. */
const PROBE = "src/.probes/__credential_guard_probe__.ts";
const probePath = path.join(repoRoot, PROBE);
const probeDir = path.dirname(probePath);

/** The four offline files that walk the source tree. */
const WALKERS = [
  "tests/offline/claims/read.test.ts",
  "tests/offline/browse/views.test.ts",
  "tests/offline/edit/config.test.ts",
  "tests/offline/review/one-place.test.ts",
];

/**
 * Source that would trip EVERY structural rule the four walkers assert, so a
 * walker that can see this file fails rather than merely reads it. This is
 * what makes case 1 non-vacuous.
 */
const LOUD_PROBE = [
  'import { T } from "@/lib/db/tables";',
  "export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;",
  "export const staging = process.env.STAGING_SUPABASE_URL;",
  "export const claims = db.from(T.pendingClaims).select();",
  "export const BROWSE_VIEWS = [];",
  'export const wrote = db.from("field_provenance").insert({ a: 1 });',
  'export const called = db.rpc("settle_review_item");',
  'export const shape = "data_conflict";',
  "",
].join("\n");

function removeProbe(): void {
  fs.rmSync(probeDir, { force: true, recursive: true });
}

afterEach(removeProbe);

/** Run the walker files as a child vitest and hand back status and output. */
function runWalkers(
  files: string[],
  extraArgs: string[] = [],
): { status: number | null; output: string } {
  const result = spawnSync(
    path.join(repoRoot, "node_modules", ".bin", "vitest"),
    ["run", "--reporter=dot", ...extraArgs, ...files],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

/** A tail of a child run's output, enough to name what failed. */
function tail(output: string): string {
  return output.slice(-4000);
}

describe("walking src/ while the layering probe comes and goes", () => {
  it("reddens no walker when the probe is readable", () => {
    // Deterministic, 100%: the probe simply sits there for the whole child run.
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(probePath, LOUD_PROBE, "utf8");

    const { status, output } = runWalkers(WALKERS);
    expect(tail(output)).not.toMatch(/ENOENT/);
    expect(status, tail(output)).toBe(0);
  });

  it("reddens no walker when the probe is listed but cannot be opened", () => {
    // A dangling symlink is the race with the timing taken out: `readdir`
    // lists the name, every `open` of it fails ENOENT, every run.
    fs.mkdirSync(probeDir, { recursive: true });
    fs.symlinkSync(path.join(probeDir, "__no_such_target__.ts"), probePath);
    expect(fs.readdirSync(probeDir)).toContain(path.basename(probePath));
    expect(() => fs.readFileSync(probePath, "utf8")).toThrow(/ENOENT/);

    const { status, output } = runWalkers(WALKERS);
    expect(tail(output)).not.toMatch(/ENOENT/);
    expect(status, tail(output)).toBe(0);
  });

  it("survives the probe directory appearing and vanishing under the walk", () => {
    // The shape a child vitest cannot reach often enough to be a pin: the
    // probe DIRECTORY going away between the listing of `src/` and the listing
    // of `src/.probes/`. Measured on the pre-fix walk under this same loop:
    // 79 read-ENOENTs and 2 readdir-ENOENTs in 400 walks, with the probe
    // listed 215 times. So this loop is not decoration.
    const churn = startChurn(20_000);
    try {
      let listedByAll = 0;
      for (let i = 0; i < 400; i += 1) {
        const hidden = sourceFiles();
        const all = allSourceFiles();
        // The rule half: a structural rule never sees the probe...
        expect(hidden).not.toContain(PROBE);
        // ...while the unfiltered walk `layering.test.ts` uses does reach it,
        // which is what keeps the filter honest rather than a blanket skip.
        if (all.includes(PROBE)) listedByAll += 1;
        // The read half: reading whatever was just listed never throws.
        for (const file of all) sourceText(file);
      }
      expect(listedByAll).toBeGreaterThan(0);
    } finally {
      churn.stop();
    }
  });

  it.fails("reddens no OTHER offline file that walks the tree either", () => {
    // The four walkers above are not the only offline files that walk `src/`.
    // `tests/offline/toolchain.test.ts` > "the source-tree walk" > "hides
    // nothing that exists in the real tree" asserts
    // `sourceFiles()` deep-equals `allSourceFiles()` over the REAL tree — and
    // that equality is FALSE for exactly as long as the probe is on disk,
    // because hiding it from the filtered walk is the fix's whole design.
    // toolchain runs in a parallel worker of the same offline project as
    // `db/layering.test.ts`, which holds that probe on disk ~343ms per run
    // (measured: 338071 of 11806630 existence samples over a 12s window
    // containing one 826ms layering run — ~69% of its 499ms test phase). So
    // this is the same hazard, the same probe path, one file over.
    // Pinned expected-fail for admin-window/BUG-0033; when the assertion stops
    // depending on another worker's timing this XPASSes and reddens.
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(probePath, LOUD_PROBE, "utf8");

    const { status, output } = runWalkers(
      ["tests/offline/toolchain.test.ts"],
      // Pinned to the offline project: a bare `vitest run` now collects all
      // four projects, and this file must never re-enter itself.
      ["--project=offline"],
    );
    expect(status, tail(output)).toBe(0);
  });

  it("leaves no probe behind for the offline suite to walk into", () => {
    // Every case above removes the probe in `afterEach`; if one of them died
    // mid-way this is what says so, instead of the next suite inheriting it.
    expect(fs.existsSync(probeDir)).toBe(false);
  });

  it("names the files that actually walk the tree", () => {
    // Non-vacuous in the other direction: this pin is worthless if it names
    // files that no longer exist or no longer take the shared walk. A fifth
    // hand-rolled copy of the walk would leave this list stale and silent.
    for (const file of [...WALKERS, "tests/offline/db/layering.test.ts"]) {
      expect(fs.existsSync(path.join(repoRoot, file)), file).toBe(true);
      expect(sourceText(file), file).toContain("../source-tree");
    }
  });
});

/**
 * `layering.test.ts`'s write/delete cycle, at the highest frequency the
 * filesystem allows, in a child process.
 *
 * It carries its OWN deadline, so an orphan cannot outlive this run and keep
 * writing into the tree, and it removes the directory on the way out.
 */
function startChurn(budgetMs: number): { stop: () => void } {
  const script = [
    'const fs = require("node:fs");',
    `const dir = ${JSON.stringify(probeDir)};`,
    `const file = ${JSON.stringify(probePath)};`,
    `const until = Date.now() + ${budgetMs};`,
    "while (Date.now() < until) {",
    "  fs.mkdirSync(dir, { recursive: true });",
    '  fs.writeFileSync(file, "export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;\\n", "utf8");',
    "  fs.rmSync(dir, { force: true, recursive: true });",
    "}",
    "fs.rmSync(dir, { force: true, recursive: true });",
  ].join("\n");
  const proc = spawn(process.execPath, ["-e", script], {
    cwd: repoRoot,
    stdio: "ignore",
    timeout: budgetMs + 5_000,
  });
  return {
    stop: () => {
      proc.kill("SIGKILL");
    },
  };
}
