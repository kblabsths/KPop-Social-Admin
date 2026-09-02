import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The structural rules of ARCHITECTURE.md §4, asserted against the source tree
 * rather than left to per-ticket discipline (campaign admin-window):
 *
 *   3. only `lib/db/client.ts` reads database credentials from `process.env`;
 *   4. only `lib/db/tables.ts` spells a table or view name;
 *   2. only `lib/db/**` imports `@supabase/supabase-js`;
 *      and nothing under `src/` mentions a `STAGING_` name — staging belongs
 *      to the live-test setup, never to the app.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const srcRoot = path.join(repoRoot, "src");

const CLIENT = "src/lib/db/client.ts";
const TABLES = "src/lib/db/tables.ts";

/**
 * Surfaces the campaign deprecates, removed by admin-window/TASK-0005. They
 * predate these rules and are outside this ticket's touch scope, so each rule
 * below exempts exactly these paths and no others — a NEW violator still
 * reddens. The list is a ratchet: every entry must still exist, so when
 * TASK-0005 deletes a file this test fails until its entry is deleted too.
 */
const DEPRECATED_UNTIL_TASK_0005 = [
  "src/lib/supabase.ts",
  "src/app/page.tsx",
  "src/app/analytics/page.tsx",
  "src/app/data-management/events/page.tsx",
];

/** Every TypeScript source file under `src/`, as repo-relative posix paths. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
        found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  walk(srcRoot);
  return found.sort();
}

function read(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

/**
 * Lines that are code, not commentary. A doc comment naming a table (this
 * file, `result.ts`) is documentation; only a real occurrence is a defect.
 */
function codeLines(text: string): string[] {
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
    codeLines(read(file)).some((line) => pattern.test(line)),
  );
}

function withoutDeprecated(files: string[]): string[] {
  return files.filter((file) => !DEPRECATED_UNTIL_TASK_0005.includes(file));
}

describe("the source tree", () => {
  it("is non-empty and contains the seam files these rules are about", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain(CLIENT);
    expect(files).toContain(TABLES);
  });

  it("still contains every deprecated file the exemptions name", () => {
    // The ratchet: an exemption for a file that no longer exists is dead
    // weight that would silently keep a rule loose.
    for (const file of DEPRECATED_UNTIL_TASK_0005) {
      expect(fs.existsSync(path.join(repoRoot, file)), `${file} is gone — drop its exemption`).toBe(true);
    }
  });
});

describe("credentials", () => {
  it("mentions no staging name anywhere under src", () => {
    // Not code-lines-only: a STAGING_ name has no business in a comment here
    // either. Staging is tests/live's, and this rule takes no exemption.
    const offenders = sourceFiles().filter((file) => read(file).includes("STAGING_"));
    expect(offenders).toEqual([]);
  });

  it("reads the service-role key in the db client alone", () => {
    const readers = filesWhereCodeMatches(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(readers).toContain(CLIENT);
    expect(withoutDeprecated(readers)).toEqual([CLIENT]);
  });

  it("reads no other SUPABASE_ credential outside the db client", () => {
    const readers = filesWhereCodeMatches(/process\.env\.SUPABASE_[A-Z0-9_]+/);
    expect(withoutDeprecated(readers)).toEqual([CLIENT]);
  });
});

describe("table names and the client library", () => {
  /**
   * The distinctive ecosystem names. `sources`, `runs`, `events`, `venues`,
   * `groups` and `idols` are ordinary English words that appear in prose,
   * props and route segments, so scanning for them would report noise rather
   * than defects; the rule is enforced here on the names that can only mean a
   * database object.
   */
  const DISTINCTIVE_NAMES = [
    "review_items",
    "field_provenance",
    "pending_claims",
    "resolution_runs",
    "event_listings",
    "event_performers",
    "observations",
    "verdicts",
  ];

  it("spells a table name in tables.ts alone", () => {
    const quoted = new RegExp(`["'\`](${DISTINCTIVE_NAMES.join("|")})["'\`]`);
    const spellers = filesWhereCodeMatches(quoted);
    expect(spellers).toContain(TABLES);
    expect(withoutDeprecated(spellers)).toEqual([TABLES]);
  });

  it("imports the supabase client library inside lib/db alone", () => {
    const importers = filesWhereCodeMatches(/@supabase\/supabase-js/);
    expect(importers.length).toBeGreaterThan(0);
    for (const file of withoutDeprecated(importers)) {
      expect(file.startsWith("src/lib/db/")).toBe(true);
    }
  });
});

/**
 * PIN — admin-window/BUG-0003. The credential rule above is enforced by a
 * pattern that only matches DOT access (`process.env.SUPABASE_SERVICE_ROLE_KEY`).
 * A second reader written with BRACKET access — the very form `client.ts`'s own
 * comment names as the alternative — is invisible to it, so the criterion's
 * proof ("client.ts is the only file under src/ reading
 * SUPABASE_SERVICE_ROLE_KEY") does not hold against a file written that way.
 *
 * `it.fails` is the strict-xfail: it passes only while the divergence is real.
 * When the guard is widened this test XPASSes and turns RED — at which point
 * drop the `.fails` and keep the assertion.
 */
describe("the credential guard itself", () => {
  const PROBE = "src/__credential_guard_probe__.ts";

  it.fails("detects a reader that uses bracket access, not just dot access", () => {
    const probePath = path.join(repoRoot, PROBE);
    fs.writeFileSync(
      probePath,
      'export const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];\n',
      "utf8",
    );
    try {
      const readers = filesWhereCodeMatches(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
      expect(withoutDeprecated(readers)).toContain(PROBE);
    } finally {
      fs.rmSync(probePath, { force: true });
    }
  });
});
