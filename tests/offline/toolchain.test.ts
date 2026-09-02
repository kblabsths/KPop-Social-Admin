import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The runner config itself, so its budgets can be asserted rather than
// trusted. The specifier says `.mjs` because that is how TypeScript names
// an ESM import of a `.mts` source under this tsconfig; the file on disk is
// `vitest.config.mts` (admin-window/BUG-0029).
import config from "../../vitest.config.mjs";
import {
  HTTP_INCLUDE,
  HTTP_ROOT,
  LIVE_INCLUDE,
  LIVE_ROOT,
  OFFLINE_INCLUDE,
  OFFLINE_ROOT,
} from "../suite-globs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const vitestBin = path.join(repoRoot, "node_modules", ".bin", "vitest");

/**
 * Run a real toolchain binary and hand back its stdout.
 *
 * Every child here is a compiler-sized process, so on a loaded machine it can
 * take seconds and it can die for reasons that have nothing to do with the
 * assertion above it. Node's own failure message for a non-zero child is bare
 * ("Command failed: <argv>") and tsc reports its diagnostics on *stdout*,
 * which that message drops — a receipt that reddened here used to say nothing
 * about why. So: an explicit wall-clock cap and buffer, and a failure that
 * carries the exit status, the signal and both streams
 * (admin-window/BUG-0029).
 */
function runTool(bin: string, args: string[], label: string): string {
  try {
    return execFileSync(bin, args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      // Generous: the point is to bound a hang, not to police speed. The
      // slowest of these measured ~2s idle and ~4s under 2x CPU oversubscription.
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      status?: number | null;
      signal?: NodeJS.Signals | null;
      stdout?: string;
      stderr?: string;
    };
    const stdout = failure.stdout ?? "";
    // A compiler's own diagnostics are the only useful part of a multi-megabyte
    // stdout, and they are not necessarily at either end of it.
    const diagnostics = stdout
      .split("\n")
      .filter((line) => /error TS\d+|error:/i.test(line));
    throw new Error(
      [
        `${label} failed: ${bin} ${args.join(" ")}`,
        `status=${failure.status ?? "null"} signal=${failure.signal ?? "null"} code=${failure.code ?? "null"}`,
        `diagnostics:\n${diagnostics.join("\n") || "(none found in stdout)"}`,
        `stdout tail:\n${stdout.slice(-2000)}`,
        `stderr:\n${(failure.stderr ?? "").slice(-2000)}`,
      ].join("\n"),
    );
  }
}

/**
 * Ask the runner itself which files a project collects.
 *
 * `--filesOnly` makes `vitest list` glob for files without importing them,
 * so this stays a cheap, non-reentrant question about discovery.
 */
function collectedFiles(project: string): string[] {
  const stdout = runTool(
    vitestBin,
    ["list", `--project=${project}`, "--filesOnly"],
    `vitest list --project=${project}`,
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    // `vitest list` prefixes each path with the project it belongs to.
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, ""))
    .filter((line) => line.length > 0)
    .map((line) => path.relative(repoRoot, path.resolve(repoRoot, line)));
}

describe("test project layout", () => {
  // `vitest list` is a full runner startup per call, so ask each project once
  // and let all three cases read the same answer, instead of spawning the same
  // child three times inside test bodies (admin-window/BUG-0029).
  let offlineFiles: string[] = [];
  let httpFiles: string[] = [];

  beforeAll(() => {
    offlineFiles = collectedFiles("offline");
    httpFiles = collectedFiles("http");
  });

  it("roots every project's include glob at its own directory", () => {
    for (const glob of OFFLINE_INCLUDE) {
      expect(glob.startsWith(`${OFFLINE_ROOT}/`)).toBe(true);
    }
    for (const glob of LIVE_INCLUDE) {
      expect(glob.startsWith(`${LIVE_ROOT}/`)).toBe(true);
    }
    for (const glob of HTTP_INCLUDE) {
      expect(glob.startsWith(`${HTTP_ROOT}/`)).toBe(true);
    }
    // Sibling roots: no root is a prefix of another, so the globs partition.
    const roots = [OFFLINE_ROOT, LIVE_ROOT, HTTP_ROOT];
    for (const a of roots) {
      for (const b of roots) {
        if (a === b) continue;
        expect(a.startsWith(`${b}/`)).toBe(false);
      }
    }
  });

  it("collects no live or http file into the offline project", () => {
    const offline = offlineFiles;

    // Non-vacuous: this very file has to be in there.
    expect(offline.length).toBeGreaterThan(0);
    expect(offline).toContain(
      path.join(OFFLINE_ROOT, "toolchain.test.ts"),
    );

    for (const file of offline) {
      expect(file.startsWith(`${OFFLINE_ROOT}${path.sep}`)).toBe(true);
      expect(file.startsWith(`${LIVE_ROOT}${path.sep}`)).toBe(false);
      expect(file.startsWith(`${HTTP_ROOT}${path.sep}`)).toBe(false);
    }
  });

  it("collects the http suite into the http project only", () => {
    const http = httpFiles;
    const offline = offlineFiles;

    // Non-vacuous the other way: http files exist and the offline run misses
    // every one of them.
    expect(http.length).toBeGreaterThan(0);
    for (const file of http) {
      expect(file.startsWith(`${HTTP_ROOT}${path.sep}`)).toBe(true);
      expect(offline).not.toContain(file);
    }
  });
});

/**
 * The repo's type gate must red on product code and on nothing else.
 *
 * Agents are told to put artefacts under `agenticflow/tracker/evidence/`, so a
 * stray `.ts` there used to be compiled as if it were product source and
 * reddened someone else's receipt (admin-window/TASK-0028).
 */
describe("type-check program", () => {
  const tscBin = path.join(repoRoot, "node_modules", ".bin", "tsc");
  const probeDir = path.join(
    repoRoot,
    "agenticflow",
    "tracker",
    "evidence",
    `tsconfig-program-probe-${randomUUID()}`,
  );
  const probeFile = path.join(probeDir, "probe.ts");
  let program: string[] = [];

  beforeAll(() => {
    mkdirSync(probeDir, { recursive: true });
    // Deliberately ill-typed: if tsc compiled this, it would exit non-zero.
    writeFileSync(probeFile, "const probe: number = true; export default probe;\n");
    const stdout = runTool(
      tscBin,
      [
        "--noEmit",
        "--listFilesOnly",
        // Keep the shared incremental cache out of this.
        "--tsBuildInfoFile",
        path.join(probeDir, "probe.tsbuildinfo"),
      ],
      "tsc --listFilesOnly",
    );
    program = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => path.relative(repoRoot, path.resolve(repoRoot, line)));
  });

  afterAll(() => {
    rmSync(probeDir, { recursive: true, force: true });
  });

  it("compiles the product and the tests", () => {
    // Non-vacuous: the program is real, and reaches both trees.
    expect(program).toContain(path.join("src", "lib", "db", "result.ts"));
    expect(program).toContain(path.join(OFFLINE_ROOT, "toolchain.test.ts"));
    expect(
      program.some((file) => file.startsWith(`src${path.sep}app${path.sep}`)),
    ).toBe(true);
  });

  it("compiles nothing a factory agent wrote under agenticflow/", () => {
    expect(program).not.toContain(path.relative(repoRoot, probeFile));
    for (const file of program) {
      expect(file.startsWith(`agenticflow${path.sep}`)).toBe(false);
    }
  });
});

/**
 * The runner's own budgets are part of the toolchain, so they are asserted
 * here rather than trusted (admin-window/BUG-0029).
 *
 * The offline project ran on vitest's 5000ms default while its slowest test
 * measured 4712ms — and the same tree then produced a RED receipt and a GREEN
 * one minutes apart. A timeout is a bound on a hang, not a speed limit: it has
 * to sit far enough above the slowest thing that actually runs under it that
 * a cold cache or a busy machine cannot reach it.
 */
describe("the offline project's time budgets", () => {
  /**
   * The slowest an offline test has ever been measured here: the pre-split
   * cross-product case, under 2x CPU oversubscription (admin-window/BUG-0029).
   * The floor below is twice that, which is the bar the bug set.
   */
  const WORST_MEASURED_MS = 7_647;

  function offlineProjectConfig(): Record<string, unknown> {
    const projects = (
      config as {
        test?: { projects?: { test?: { name?: string } }[] };
      }
    ).test?.projects;
    expect(Array.isArray(projects)).toBe(true);
    const offline = (projects ?? []).find(
      (project) => project?.test?.name === "offline",
    );
    expect(offline, "vitest.config.mts declares no project named offline").toBeDefined();
    return (offline as { test: Record<string, unknown> }).test;
  }

  it("gives every offline test at least twice the slowest run ever measured", () => {
    const testTimeout = offlineProjectConfig().testTimeout;
    // Explicit, not inherited: vitest's default is what caused the flake.
    expect(typeof testTimeout).toBe("number");
    expect(testTimeout as number).toBeGreaterThanOrEqual(2 * WORST_MEASURED_MS);
  });

  it("gives its compiler-spawning hooks a budget of their own", () => {
    // `beforeAll` in this very file shells out to tsc and to vitest; the 10s
    // default hook budget is not a budget for a compiler on a loaded machine.
    const hookTimeout = offlineProjectConfig().hookTimeout;
    expect(typeof hookTimeout).toBe("number");
    expect(hookTimeout as number).toBeGreaterThanOrEqual(2 * WORST_MEASURED_MS);
  });
});
