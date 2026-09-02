import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DB_KEY_SENTINEL,
  DB_URL_SENTINEL,
  serverEnv,
} from "../http/server-harness";

/**
 * The http suite's "no database" claim, enforced (campaign
 * admin-window/TASK-0027).
 *
 * `serverEnv()` used to only DELETE every `*SUPABASE*` name from the child
 * env. `next start` then calls `@next/env`'s `loadEnvConfig` on the repo root
 * and refills the deleted names out of `.env` — so the claim was asserted in a
 * docstring, not enforced, and stood only because one developer's untracked
 * `.env` happens to carry no service-role key. The next http test that PATCHes
 * a write route would, on a machine whose `.env` does carry one, write the
 * real catalog with RLS bypassed.
 *
 * `@next/env` fills names that are ABSENT and never overrides one that is
 * present, so the harness sets sentinels instead of deleting the two names
 * `src/lib/db/client.ts` reads. This file proves the sentinels survive that
 * reload, and it is what fails the day the harness reverts to a bare delete.
 *
 * Two rules this file keeps absolutely:
 *  - `loadEnvConfig` runs only in a CHILD process. Calling it here would
 *    mutate the vitest runner's own environment for every other test.
 *  - no real value is read, printed or asserted. The child reports env NAMES
 *    and, for the two names that matter, a LABEL naming which of this file's
 *    own fabricated literals the value equals — never the value itself. The
 *    only literals that can reach the output are the four defined below.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * A fabricated `.env` the child is pointed at, never the repo's own.
 *
 * These are decoys with no meaning to any system: `.invalid` is reserved by
 * RFC 2606 and resolves nowhere, and the key value says what it is. Their job
 * is to be what the reload WOULD install if the sentinels were absent — which
 * is exactly what the control test below observes.
 */
const DECOY_URL = "http://decoy.invalid/task-0027-fabricated";
const DECOY_ANON = "fabricated-decoy-anon-not-a-credential";
const DECOY_KEY = "fabricated-decoy-service-role-not-a-credential";

const FABRICATED_ENV_FILE = [
  "SUPABASE_URL=" + DECOY_URL,
  "SUPABASE_ANON_KEY=" + DECOY_ANON,
  "SUPABASE_SERVICE_ROLE_KEY=" + DECOY_KEY,
  "",
].join("\n");

/** value -> label. The child may emit these labels and nothing else. */
const KNOWN: Readonly<Record<string, string>> = {
  "the harness URL sentinel": DB_URL_SENTINEL,
  "the harness key sentinel": DB_KEY_SENTINEL,
  "the fabricated .env URL": DECOY_URL,
  "the fabricated .env service-role value": DECOY_KEY,
};

const UNRECOGNISED = "an unrecognised value";
const UNSET = "unset";

/**
 * Runs in a child. Loads env the way `next start` does, then reports.
 *
 * It classifies rather than prints: an unrecognised value is reported as the
 * string "an unrecognised value", so a real credential cannot reach stdout,
 * this test's output, or a run log even when the assertion below fails.
 */
const PROBE = `
const { loadEnvConfig } = require("@next/env");
const dir = process.argv[1];
const known = JSON.parse(process.argv[2]);
const names = () =>
  Object.keys(process.env).filter((k) => k.includes("SUPABASE")).sort();
const before = names();
loadEnvConfig(dir, false, { info: () => {}, error: () => {} });
const label = (name) => {
  const value = process.env[name];
  if (value === undefined) return ${JSON.stringify(UNSET)};
  const hit = Object.keys(known).find((k) => known[k] === value);
  return hit === undefined ? ${JSON.stringify(UNRECOGNISED)} : hit;
};
process.stdout.write("PROBE " + JSON.stringify({
  before,
  after: names(),
  url: label("SUPABASE_URL"),
  key: label("SUPABASE_SERVICE_ROLE_KEY"),
}) + "\\n");
`;

type ProbeResult = {
  before: string[];
  after: string[];
  url: string;
  key: string;
};

/** Load env the way `next start` does, over `dir`, starting from `env`. */
function probe(dir: string, env: NodeJS.ProcessEnv): ProbeResult {
  const stdout = execFileSync(
    process.execPath,
    ["-e", PROBE, dir, JSON.stringify(KNOWN)],
    // cwd is the repo root so the child resolves `@next/env` — the same copy
    // `next start` loads — while `dir` is what it reads `.env` files from.
    { cwd: repoRoot, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = stdout
    .split("\n")
    .filter((l) => l.startsWith("PROBE "))
    .pop();
  if (line === undefined) throw new Error("the env probe reported nothing");
  return JSON.parse(line.slice("PROBE ".length)) as ProbeResult;
}

/**
 * A scratch directory holding the fabricated `.env`.
 *
 * Under `node_modules/`, which is gitignored, present wherever this suite can
 * run at all, and inside the repo — never the OS temp dir.
 */
const scratch = fs.mkdtempSync(
  path.join(repoRoot, "node_modules", ".cache-http-harness-"),
);
fs.writeFileSync(path.join(scratch, ".env"), FABRICATED_ENV_FILE);

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** The Supabase names an environment carries, sorted. */
function supabaseNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((k) => k.includes("SUPABASE")).sort();
}

describe("the http harness's environment", () => {
  it("strips every Supabase name this machine carries and leaves exactly the two the app reads", () => {
    // Non-vacuous: the machine running this may carry no Supabase name at all,
    // so put two in — a plain one and a staging one — and watch them go.
    const injected = ["SUPABASE_PROBE_ONLY_NAME", "STAGING_SUPABASE_PROBE_ONLY_NAME"];
    for (const name of injected) process.env[name] = "fabricated-probe-value";
    try {
      expect(supabaseNames(process.env)).toEqual(
        expect.arrayContaining(injected),
      );
      expect(supabaseNames(serverEnv())).toEqual([
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_URL",
      ]);
    } finally {
      for (const name of injected) delete process.env[name];
    }
  });

  it("gives those two names values that cannot reach a database or be read as credentials", () => {
    const url = new URL(DB_URL_SENTINEL);
    expect(url.hostname).toBe("127.0.0.1");
    // Port 1 is reserved and unserved: a connect is refused, never routed.
    expect(url.port).toBe("1");

    // Self-describing, and none of the shapes a Supabase key comes in.
    expect(DB_KEY_SENTINEL).toMatch(/not-a-credential/);
    expect(DB_KEY_SENTINEL).not.toMatch(/^eyJ/);
    expect(DB_KEY_SENTINEL).not.toMatch(/^sb_secret_|^sbp_/);
    expect(DB_KEY_SENTINEL.includes(".")).toBe(false);
  });
});

describe("Next's env reload against the http harness", () => {
  it("refills both names when the harness only deletes them — the defect this guards", () => {
    // The harness as it used to be: sentinels removed, deletion alone.
    const bareDelete = serverEnv();
    delete bareDelete.SUPABASE_URL;
    delete bareDelete.SUPABASE_SERVICE_ROLE_KEY;
    expect(supabaseNames(bareDelete)).toEqual([]);

    const result = probe(scratch, bareDelete);

    expect(result.before).toEqual([]);
    expect(result.url).toBe("the fabricated .env URL");
    expect(result.key).toBe("the fabricated .env service-role value");
  });

  it("cannot displace the sentinels with a .env that sets both names", () => {
    const result = probe(scratch, serverEnv());

    expect(result.before).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
    ]);
    expect(result.url).toBe("the harness URL sentinel");
    expect(result.key).toBe("the harness key sentinel");
    // The same file DID load — it filled the one name the harness leaves
    // absent — so the two above held against a live override, not a no-op.
    expect(result.after).toContain("SUPABASE_ANON_KEY");
  });

  it("cannot displace the sentinels over the repo root, which is what `next start` loads", () => {
    const result = probe(repoRoot, serverEnv());

    expect(result.url).toBe("the harness URL sentinel");
    expect(result.key).toBe("the harness key sentinel");
  });
});
