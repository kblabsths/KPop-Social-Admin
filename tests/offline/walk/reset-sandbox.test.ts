import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  stubClient,
  tableNotInSchemaCache,
  undefinedTable,
} from "../../fixtures/stub-client";
import {
  RESET_CALLER_NAME,
  SandboxAbsentError,
  SandboxResetError,
  resetSandbox,
} from "../../walk/reset-sandbox.mjs";
import {
  SANDBOX_COLUMNS,
  SANDBOX_FIXTURE,
  SANDBOX_PK,
  SANDBOX_TABLE,
} from "../../walk/sandbox-fixture";
import { repoRoot } from "../source-tree";

/**
 * The walk sandbox's reset tool, proved OFFLINE (campaign
 * admin-window/TASK-0036).
 *
 * Two halves, neither of which touches a network:
 *
 *  - **The DML**, driven through `tests/fixtures/stub-client.ts` — the same
 *    scripted client every `lib/db` read is exercised with. What is graded is
 *    the SHAPE of what the tool asks the database for (probe, delete every
 *    row, insert the fixture, read it back) and what it does with each answer,
 *    including the two answers that must stop it.
 *  - **The program**, spawned as a walker runs it. Every case here is decided
 *    by the staging guard BEFORE a client exists, which is why a test that
 *    never dials can exercise the real binary end to end.
 *
 * What is NOT proved here, and is stated rather than implied: the present-case
 * round trip against a real PostgREST. `public.walk_sandbox` is created by
 * hand and had not been pasted onto staging when this was written, so the wire
 * behaviour was measured against a stub PostgREST and recorded in the ticket's
 * history instead.
 *
 * No credential value appears in this file. The sentinel below exists to be
 * searched for in the program's output and not found.
 */

const CLI = path.join(repoRoot, "tests", "walk", "reset-sandbox.mts");

/** Obviously not a key, and impossible to confuse with one. */
const SENTINEL_KEY = "offline-suite-sentinel-service-role-not-a-credential";

/** A host no `SERVICES.md` declares, so the guard refuses before dialling. */
const UNDECLARED_URL = "https://not-the-declared-target.supabase.co";

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the program with exactly the environment a case is about.
 *
 * Every name that could decide the answer is deleted first — the machine this
 * runs on must not be able to change the verdict.
 */
function runCli(
  env: Record<string, string | undefined>,
  args: string[] = [],
): CliRun {
  const child: NodeJS.ProcessEnv = { ...process.env };
  delete child.SUPABASE_URL;
  delete child.SUPABASE_SERVICE_ROLE_KEY;
  delete child.STAGING_SUPABASE_URL;
  delete child.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete child[name];
    else child[name] = value;
  }
  const run = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: child,
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** One scripted answer, in the settled shape the stub returns. */
const ok = (data: unknown) => ({ data, error: null });

/** The rows PostgREST would give back for the fixture's own columns. */
const fixtureRows = () => SANDBOX_FIXTURE.map((row) => ({ ...row }));

/** The error a reset raised — and a failure if it did not raise one. */
async function refusalFrom(reset: Promise<unknown>): Promise<Error> {
  try {
    await reset;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the reset to refuse, but it resolved");
}

describe("the reset, against a scripted database", () => {
  it("probes, clears every row, seeds the fixture, and reads it back", async () => {
    const stub = stubClient({
      [SANDBOX_TABLE]: [
        ok([{ [SANDBOX_PK]: SANDBOX_FIXTURE[0].sandbox_id }]),
        ok(fixtureRows().map((row) => ({ [SANDBOX_PK]: row.sandbox_id }))),
        ok(fixtureRows()),
        ok(fixtureRows()),
      ],
    });

    const outcome = await resetSandbox(stub.asSupabaseClient());

    expect(outcome).toEqual({ deleted: 3, seeded: 3 });
    expect(stub.tablesRead()).toEqual([
      SANDBOX_TABLE,
      SANDBOX_TABLE,
      SANDBOX_TABLE,
      SANDBOX_TABLE,
    ]);

    const [probe, cleared, seeded, readBack] = stub.calls;
    expect(probe.steps.map((step) => step.method)).toEqual(["select", "limit"]);

    // "Every row", in the only grammar PostgREST offers: a primary key is
    // never null, so `pk is not null` matches all of them and excludes none.
    // PostgREST has no TRUNCATE and refuses an unfiltered DELETE.
    expect(cleared.steps.map((step) => step.method)).toEqual([
      "delete",
      "not",
      "select",
    ]);
    expect(cleared.steps[1].args).toEqual([SANDBOX_PK, "is", null]);

    // The insert carries the fixture, whole and unmodified.
    expect(seeded.steps[0].method).toBe("insert");
    expect(seeded.steps[0].args[0]).toEqual(fixtureRows());

    // The read-back asks for the fixture's columns, in key order.
    expect(readBack.steps.map((step) => step.method)).toEqual([
      "select",
      "order",
    ]);
    expect(readBack.steps[0].args[0]).toBe([...SANDBOX_COLUMNS].join(","));
    expect(readBack.steps[1].args).toEqual([SANDBOX_PK]);
  });

  it("refuses an absent table having written nothing, whichever code says so", async () => {
    // Both codes the database can answer with — the schema-cache miss and
    // Postgres's own undefined_table. One fixture per branch, and the
    // happy-path case above is the input this predicate must NOT flag.
    for (const error of [
      tableNotInSchemaCache(SANDBOX_TABLE),
      undefinedTable(SANDBOX_TABLE),
    ]) {
      const stub = stubClient({ [SANDBOX_TABLE]: { data: null, error } });

      await expect(resetSandbox(stub.asSupabaseClient())).rejects.toBeInstanceOf(
        SandboxAbsentError,
      );

      // The load-bearing half: it stopped at the probe. No delete was issued,
      // so a reset against a project without the table cannot empty anything.
      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0].steps.map((step) => step.method)).toEqual([
        "select",
        "limit",
      ]);
    }
  });

  it("names the table and the paste when it refuses an absent one", async () => {
    const stub = stubClient({
      [SANDBOX_TABLE]: { data: null, error: tableNotInSchemaCache(SANDBOX_TABLE) },
    });
    const raised = await refusalFrom(resetSandbox(stub.asSupabaseClient()));
    expect(raised.message).toContain(SANDBOX_TABLE);
    expect(raised.message).toContain("BY HAND");
    expect(raised.message).toContain("for-human/TASK-0034.md");
    expect(raised.message.startsWith(`${RESET_CALLER_NAME} refuses: `)).toBe(true);
  });

  it("treats a read failure that is NOT absence as a failure, not a reset", async () => {
    const stub = stubClient({
      [SANDBOX_TABLE]: {
        data: null,
        error: {
          code: "57014",
          message: "canceling statement due to statement timeout",
        },
      },
    });
    const raised = await refusalFrom(resetSandbox(stub.asSupabaseClient()));
    expect(raised).toBeInstanceOf(SandboxResetError);
    expect(raised.message).toContain("57014");
    expect(stub.calls).toHaveLength(1);
  });

  it("says the table is empty when the seed fails after the delete", async () => {
    // The one window §9.1 accepts: two requests, no transaction across them.
    // The refusal has to say so, or a walker walks an empty sandbox.
    const stub = stubClient({
      [SANDBOX_TABLE]: [
        ok([{ [SANDBOX_PK]: SANDBOX_FIXTURE[0].sandbox_id }]),
        ok([]),
        { data: null, error: { code: "23502", message: "null value in column" } },
      ],
    });
    const raised = await refusalFrom(resetSandbox(stub.asSupabaseClient()));
    expect(raised).toBeInstanceOf(SandboxResetError);
    expect(raised.message).toContain("EMPTY");
    expect(raised.message).toContain("Run this again");
  });

  it("refuses when the read-back is not the fixture, however green the writes were", async () => {
    // Every request answered 2xx and the rows are still wrong. "The requests
    // succeeded" is not "the sandbox is at the fixture".
    const drifted = fixtureRows();
    drifted[0].tally = 8;
    const stub = stubClient({
      [SANDBOX_TABLE]: [
        ok([{ [SANDBOX_PK]: SANDBOX_FIXTURE[0].sandbox_id }]),
        ok([]),
        ok(fixtureRows()),
        ok(drifted),
      ],
    });
    const raised = await refusalFrom(resetSandbox(stub.asSupabaseClient()));
    expect(raised).toBeInstanceOf(SandboxResetError);
    expect(raised.message).toContain("does not match the fixture");
  });

  it("accepts a read-back that came in a different row order", async () => {
    // The negative control for the case above: the comparison is by key, not
    // by the order PostgREST happened to answer in.
    const shuffled = [...fixtureRows()].reverse();
    const stub = stubClient({
      [SANDBOX_TABLE]: [
        ok([{ [SANDBOX_PK]: SANDBOX_FIXTURE[0].sandbox_id }]),
        ok([]),
        ok(fixtureRows()),
        ok(shuffled),
      ],
    });
    await expect(resetSandbox(stub.asSupabaseClient())).resolves.toEqual({
      deleted: 0,
      seeded: 3,
    });
  });
});

describe("the reset, as a program", () => {
  it("refuses in its own name when neither credential is set", () => {
    const run = runCli({});
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(`${RESET_CALLER_NAME} refuses: `);
    expect(run.stderr).toContain("SUPABASE_URL");
    expect(run.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("does not read a staging name in place of the two it takes", () => {
    // The structural claim of §9.1: `tests/live/setup.ts` stays the ONE reader
    // of the staging names. A staging pair in the environment must not become
    // this tool's target — it refuses, naming the names it actually reads.
    const run = runCli({
      STAGING_SUPABASE_URL: UNDECLARED_URL,
      STAGING_SUPABASE_SERVICE_ROLE_KEY: SENTINEL_KEY,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("SUPABASE_URL");
    expect(run.stderr).not.toContain(SENTINEL_KEY);
  });

  it("refuses a host that is not the declared staging target, and leaks no key", () => {
    const run = runCli({
      SUPABASE_URL: UNDECLARED_URL,
      SUPABASE_SERVICE_ROLE_KEY: SENTINEL_KEY,
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("not-the-declared-target.supabase.co");
    expect(run.stderr).not.toContain(SENTINEL_KEY);
  });

  it("refuses an unparseable URL without echoing it", () => {
    const notAUrl = "still-somebodys-value-even-though-it-is-not-a-url";
    const run = runCli({
      SUPABASE_URL: notAUrl,
      SUPABASE_SERVICE_ROLE_KEY: SENTINEL_KEY,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).not.toContain(notAUrl);
    expect(run.stderr).not.toContain(SENTINEL_KEY);
  });

  it("refuses an argument it does not have", () => {
    const run = runCli({}, ["--dry-run"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--dry-run");
    expect(run.stderr).toContain("usage:");
  });

  it("does nothing at all when it is imported rather than run", () => {
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(CLI)}); process.stdout.write("imported-and-silent");`,
      ],
      { cwd: repoRoot, encoding: "utf8", env: { ...process.env } },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe("imported-and-silent");
  });
});

describe("the two rules the tool's own source has to keep", () => {
  const source = fs.readFileSync(CLI, "utf8");
  const cookieSource = fs.readFileSync(
    path.join(repoRoot, "tests", "walk", "session-cookie.mts"),
    "utf8",
  );

  it("loads no .env — and the predicate that says so can flag a file that does", () => {
    // A grep guard proves nothing on one input (LESSONS 3). `session-cookie.mts`
    // deliberately DOES fall back to the repo-root `.env` for its one name, so
    // it is the input this predicate must flag; the reset tool is the input it
    // must not.
    const loadsEnvFile = (text: string) =>
      text.includes('from "dotenv"') || text.includes("loadEnvFile");
    expect(loadsEnvFile(cookieSource)).toBe(true);
    expect(loadsEnvFile(source)).toBe(false);
  });

  it("reaches nothing under src/", () => {
    // Property 4: not reachable from the app, and no path into it either.
    const importsFromSrc = (text: string) =>
      /from\s+"(@\/|(\.\.\/)+src\/)/.test(text);
    expect(importsFromSrc('import { T } from "@/lib/db/tables";')).toBe(true);
    expect(importsFromSrc(source)).toBe(false);
  });
});
