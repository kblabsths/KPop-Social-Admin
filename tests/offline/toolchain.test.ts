import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * Ask the runner itself which files a project collects.
 *
 * `--filesOnly` makes `vitest list` glob for files without importing them,
 * so this stays a cheap, non-reentrant question about discovery.
 */
function collectedFiles(project: string): string[] {
  const stdout = execFileSync(
    vitestBin,
    ["list", `--project=${project}`, "--filesOnly"],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, CI: "true" } },
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
    const offline = collectedFiles("offline");

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
    const http = collectedFiles("http");
    const offline = collectedFiles("offline");

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
    const stdout = execFileSync(
      tscBin,
      [
        "--noEmit",
        "--listFilesOnly",
        // Keep the shared incremental cache out of this.
        "--tsBuildInfoFile",
        path.join(probeDir, "probe.tsbuildinfo"),
      ],
      { cwd: repoRoot, encoding: "utf8" },
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
