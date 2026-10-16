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
import {
  PROBE_PARENT,
  isProcessAlive,
  probeDirFor,
  sweepDeadProbeDirs,
} from "../probe-area";

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

/**
 * THIS run's probe, planted in the same dot-hidden area beneath `src/` that
 * `tests/offline/db/layering.test.ts` writes its own probes to, under a
 * directory named by the one naming rule (`tests/probe-area.ts`): this
 * process's pid AND this run's entropy.
 *
 * It used to be that suite's exact probe path. Since admin-window/DEBT-0018
 * there is no such single path — each run of that suite writes beneath its own
 * directory, so two vitest runs in one checkout stop colliding — and this
 * pin's subject never needed one: what it measures is a WALKER's resilience to
 * a file that appears and vanishes in that area, and its blindness to it,
 * neither of which turns on who wrote the file.
 */
const PROBE = `${probeDirFor("probe-race")}/__credential_guard_probe__.ts`;
const probePath = path.join(repoRoot, PROBE);
const probeDir = path.dirname(probePath);

/**
 * Clear out any probe directory left by a run that DIED before its cleanup ran
 * (admin-window/BUG-0188) — the same module-load sweep
 * `tests/offline/db/layering.test.ts` does, for the same reason, and the one
 * this file's own directory name used to need: it too was derived from
 * `process.pid` alone, so a reused pid made a corpse this run's own.
 */
sweepDeadProbeDirs();

/**
 * The offline file this pin exists for: the one that plants probes in that
 * area during an ordinary run, and the one file whose own scanner is meant to
 * reach a probe at all.
 */
const LAYERING_SUITE = "tests/offline/db/layering.test.ts";

/**
 * The offline files that walk the source tree and are NAMED here.
 *
 * `tests/offline/url/narrowing.test.ts` is the fifth (admin-window/DEBT-0010):
 * it asserts that each name of the narrowing vocabulary is declared in exactly
 * one module, which is precisely a rule the probe can be reported as breaking.
 * The whole-project case below would have covered it either way; naming it
 * here makes the two DETERMINISTIC cases cover it as well, which is worth more
 * than a race that has to be reached.
 */
const WALKERS = [
  "tests/offline/claims/read.test.ts",
  "tests/offline/browse/views.test.ts",
  "tests/offline/edit/config.test.ts",
  "tests/offline/review/one-place.test.ts",
  "tests/offline/url/narrowing.test.ts",
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
  // The fifth walker's rule, admin-window/DEBT-0010: a SECOND declaration of a
  // narrowing-vocabulary name, and the retired two-meaning name itself. Both
  // redden `tests/offline/url/narrowing.test.ts` when the file holding them is
  // visible to the filtered walk — measured under QA by planting the same two
  // lines at `src/lib/*.ts` (red) and at this probe path (green). Without
  // them the whole-project case passes for that walker whatever it does,
  // because the probe would name nothing it grades.
  "export function narrowedTo(a: readonly string[]) { return a.join(''); }",
  "export function isNarrowed(x: boolean) { return x; }",
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

  it("reddens no OTHER offline file that walks the tree either", () => {
    // Naming four walkers was not enough. `tests/offline/toolchain.test.ts` >
    // "the source-tree walk" also asserted `sourceFiles()` deep-equals
    // `allSourceFiles()` over the REAL tree, and that equality is FALSE for
    // exactly as long as the probe is on disk, because hiding it from the
    // filtered walk is the fix's whole design. toolchain runs in a parallel
    // worker of the same offline project as the layering suite, which holds
    // the probe on disk ~343ms per run (measured: 338071 of 11806630 existence
    // samples over a 12s window containing one 826ms layering run — ~69% of
    // its 499ms test phase): the same hazard, the same probe path, one file
    // over, 6 of 12 runs red under a faithful reproduction of that cycle
    // (admin-window/BUG-0033).
    //
    // So this runs the WHOLE offline project rather than a named list. The
    // sweep for "some other file also asserts over the real tree" is worth
    // nothing done once by hand: the next file added to the suite has to be
    // covered too. The layering suite is the one exclusion, and it has to be —
    // it OWNS this probe path, deletes it in its own `finally`, and its
    // scanner is supposed to report a probe it planted itself. Every other
    // offline file must be blind to it.
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(probePath, LOUD_PROBE, "utf8");

    const { status, output } = runWalkers(
      [],
      // Pinned to the offline project: a bare `vitest run` now collects all
      // four projects, and this file must never re-enter itself.
      ["--project=offline", "--exclude", LAYERING_SUITE],
    );
    expect(tail(output)).not.toMatch(/ENOENT/);
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
    for (const file of [...WALKERS, LAYERING_SUITE]) {
      expect(fs.existsSync(path.join(repoRoot, file)), file).toBe(true);
      expect(sourceText(file), file).toContain("../source-tree");
    }
  });
});

/**
 * The other end of the same hazard, end to end on the real probe area
 * (admin-window/BUG-0188): not two runs alive at once, but ONE run that DIED.
 *
 * Both consequences were measured on the landed tree before this fix and both
 * are asserted here as consequences, not as implementation: a corpse must not
 * outlive the next run of the suite that plants probes, and it must not be
 * able to redden `npm run lint` while it sits there. The in-suite half — a
 * corpse wearing a LIVE pid, which the sweep must not touch and the scan must
 * not grade — is `tests/offline/db/layering.test.ts`; this file owns the half
 * that needs a child process and the real tree.
 */
describe("a probe left behind by a run that died", () => {
  /**
   * A pid that named a real process and names none now — a child spawned,
   * waited for, and exited — asserted dead rather than assumed, so a recycled
   * number cannot decide a case below.
   */
  function deadPid(): number {
    const child = spawnSync(process.execPath, ["-e", ""], { timeout: 30_000 });
    const pid = child.pid as number;
    expect(isProcessAlive(pid), `pid ${pid} was recycled between exit and this read`).toBe(false);
    return pid;
  }

  /** The `require()` fixture the leaf guard writes, which is what reddened lint. */
  const LEAF_FIXTURE = 'const { T } = require("@/lib/db/tables");\n';

  /** Plant `name` under the real probe area, holding `source`; return its path. */
  function plantCorpse(name: string, file: string, source: string): string {
    const dir = path.join(repoRoot, PROBE_PARENT, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), source, "utf8");
    return dir;
  }

  it("is gone after the next run of the suite that plants probes, parent kept", () => {
    // Exactly what a run killed mid-loop leaves: a directory named from its
    // pid ALONE (the pre-fix naming), holding the service-role-key probe, and
    // one holding the `require()` fixture.
    const pid = deadPid();
    const credential = plantCorpse(
      `credential-guard-${pid}`,
      "__credential_guard_probe__.ts",
      "export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;\n",
    );
    const leaf = plantCorpse(`leaf-import-guard-${pid}-dead-run`, "__leaf_import_probe__.ts", LEAF_FIXTURE);
    try {
      // Non-vacuous: both are really on disk when the child run starts.
      expect(fs.existsSync(credential)).toBe(true);
      expect(fs.existsSync(leaf)).toBe(true);

      const { status, output } = runWalkers([LAYERING_SUITE], ["--project=offline"]);
      expect(status, tail(output)).toBe(0);

      expect(fs.existsSync(credential), "the corpse outlived the next run").toBe(false);
      expect(fs.existsSync(leaf), "the corpse outlived the next run").toBe(false);
      // admin-window/DEBT-0018's rule, unbroken: the parent every run shares
      // is still there for the next `mkdirSync` to find.
      expect(fs.existsSync(path.join(repoRoot, PROBE_PARENT))).toBe(true);
    } finally {
      fs.rmSync(credential, { force: true, recursive: true });
      fs.rmSync(leaf, { force: true, recursive: true });
    }
  });

  it("cannot redden `npm run lint` while it sits there", () => {
    // Consequence 2, as the ticket measured it: `npm run lint` is `eslint`
    // with no arguments, ESLint 9's flat config has no dot-directory skip, and
    // the leaf guard's must-flag fixture is a `require()` — so one killed run
    // put that checkout's lint permanently at exit 1, with nothing in `git
    // status` naming the cause. The area is now ignored the way
    // `tests/.probes/**` already was (admin-window/BUG-0030).
    // Named from THIS process's (live) pid on purpose: what makes lint red is
    // the file sitting in the area, not whose it is, and a live pid means no
    // concurrent run's sweep can carry the fixture off mid-case and leave this
    // green for the wrong reason.
    const corpse = plantCorpse(
      `leaf-import-guard-${process.pid}-lint-fixture`,
      "__leaf_import_probe__.ts",
      LEAF_FIXTURE,
    );
    const corpseFile = path.join(corpse, "__leaf_import_probe__.ts");
    try {
      const eslint = path.join(repoRoot, "node_modules", ".bin", "eslint");
      // The bar: the command every ticket's check block runs, over the whole
      // tree, with the corpse on disk.
      const whole = spawnSync(eslint, [], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(whole.status, tail(`${whole.stdout ?? ""}\n${whole.stderr ?? ""}`)).toBe(0);

      // And the fix named rather than the defect merely absent (LESSONS 12):
      // ESLint itself says this exact path is ignored, so the green above is
      // the ignore doing its job and not the fixture failing to be a fixture.
      const named = spawnSync(eslint, [path.relative(repoRoot, corpseFile)], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(named.status).toBe(0);
      expect(named.stdout).toMatch(/ignored because of a matching ignore pattern/);
      // The fixture really is one ESLint would refuse: it still holds the
      // `require()` the rule forbids.
      expect(fs.readFileSync(corpseFile, "utf8")).toContain("require(");
    } finally {
      fs.rmSync(corpse, { force: true, recursive: true });
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
