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
 * Files exempt from the rules below, by ruling rather than by oversight — a
 * NEW violator still reddens.
 *
 * The deprecated surfaces this list also carried (`src/app/page.tsx`,
 * `src/app/analytics/page.tsx`, `src/app/data-management/events/page.tsx`)
 * left with admin-window/TASK-0005, which deleted or rewrote them; their
 * entries went with them.
 *
 * What remains is `src/lib/supabase.ts`: the pre-campaign service-role client,
 * one of the handful of files ARCHITECTURE §2 carries over untouched, so it
 * reads the credential and builds a client outside `lib/db/client.ts` on
 * purpose. The list stays a ratchet — every entry must still exist, so an
 * exemption cannot outlive the file it names.
 */
const CARRIED_OVER = ["src/lib/supabase.ts"];

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

/**
 * A file's code lines rejoined, newlines kept, so a pattern may span lines.
 * Multi-line spellings are ordinary formatted code — a formatter breaks a
 * multi-key destructure across lines — and a scanner that tested one line at a
 * time would be blind to them (admin-window/BUG-0005).
 */
function codeText(text: string): string {
  return codeLines(text).join("\n");
}

function filesWhereCodeMatches(pattern: RegExp): string[] {
  return sourceFiles().filter((file) => pattern.test(codeText(read(file))));
}

function withoutDeprecated(files: string[]): string[] {
  return files.filter((file) => !CARRIED_OVER.includes(file));
}

/**
 * The object an env read starts from, in every spelling that reaches it:
 * `process.env`, `process?.env`, `globalThis.process.env`,
 * `globalThis?.process?.env` (and `global.` for the Node idiom).
 */
const PROCESS_ENV = String.raw`(?:(?:globalThis|global)\s*\??\.\s*)?process\s*\??\.\s*env`;

/**
 * A bracket key a text scan CAN resolve: exactly one plain quoted string that
 * closes the bracket. A concatenation (`"SUPABASE_" + "SERVICE_ROLE_KEY"`), an
 * interpolated template, an escape or a bare identifier is NOT resolvable.
 */
const RESOLVABLE_KEY = String.raw`\s*['"\x60][^'"\x60\\$]*['"\x60]\s*\]`;

/**
 * A scanner for reads of an env name, in every spelling a reader can use
 * (widened by admin-window/BUG-0003, which found the dot-only pattern blind to
 * bracket access, then by admin-window/BUG-0005, which found four more):
 *
 *   - `process.env.NAME`                — direct member access;
 *   - `process.env?.NAME`               — optional-chained member access;
 *   - `process.env["NAME"]`             — bracket access, string literal;
 *   - `process.env?.["NAME"]`           — optional-chained bracket access;
 *   - `process.env[SOME_NAME_CONSTANT]` — bracket access through a constant,
 *     the form `client.ts` exports `DB_KEY_ENV_NAME` for;
 *   - `process.env["SUPABASE_" + "…"]`  — a computed bracket key;
 *   - `const { NAME } = process.env`    — destructuring, at any position in the
 *     pattern, renamed (`{ NAME: alias }`), defaulted, or broken over lines;
 *   - any of the above reached through `globalThis.process` / `global.process`.
 *
 * A bracket key that names no string this scan can resolve counts as a read of
 * the credential, whether it is an identifier, a concatenation or a template: a
 * dynamic env read outside the one seam is unverifiable by construction, and an
 * unverifiable credential read is what this rule exists to forbid. A bracket
 * read of some OTHER literal name (`process.env["NODE_ENV"]`), and a
 * destructure that names only such keys (`const { NODE_ENV } = process.env`),
 * are resolvable and are not reported.
 */
function envReadOf(namePattern: string): RegExp {
  const quotedName = String.raw`['"\x60]${namePattern}['"\x60]`;
  const unresolvableKey = String.raw`\[(?!${RESOLVABLE_KEY})`;
  return new RegExp(
    [
      // process.env.NAME / process.env?.NAME
      String.raw`${PROCESS_ENV}\s*\??\.\s*${namePattern}\b`,
      // process.env["NAME"] / process.env?.["NAME"]
      String.raw`${PROCESS_ENV}\s*(?:\?\.)?\s*\[\s*${quotedName}\s*\]`,
      // process.env[ anything this scan cannot resolve to a literal name ]
      String.raw`${PROCESS_ENV}\s*(?:\?\.)?\s*${unresolvableKey}`,
      // const { …, NAME: alias = …, … } = process.env
      String.raw`\{[^{}]*\b${namePattern}\b[^{}]*\}\s*=\s*${PROCESS_ENV}`,
      // const { [ unresolvable ]: alias } = process.env
      String.raw`\{(?:[^{}]*,)?\s*${unresolvableKey}[^{}]*\}\s*=\s*${PROCESS_ENV}`,
    ].join("|"),
  );
}

/** Reads of the service-role key itself. */
const SERVICE_ROLE_KEY_READ = envReadOf("SUPABASE_SERVICE_ROLE_KEY");

/** Reads of any `SUPABASE_`-prefixed credential name. */
const SUPABASE_CREDENTIAL_READ = envReadOf("SUPABASE_[A-Z0-9_]+");

describe("the source tree", () => {
  it("is non-empty and contains the seam files these rules are about", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain(CLIENT);
    expect(files).toContain(TABLES);
  });

  it("still contains every file the exemptions name", () => {
    // The ratchet: an exemption for a file that no longer exists is dead
    // weight that would silently keep a rule loose.
    for (const file of CARRIED_OVER) {
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
    const readers = filesWhereCodeMatches(SERVICE_ROLE_KEY_READ);
    expect(readers).toContain(CLIENT);
    expect(withoutDeprecated(readers)).toEqual([CLIENT]);
  });

  it("reads no other SUPABASE_ credential outside the db client", () => {
    const readers = filesWhereCodeMatches(SUPABASE_CREDENTIAL_READ);
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
 * The guard guarding itself (admin-window/BUG-0003). The credential rules above
 * are only as good as the spelling they recognise: a dot-only pattern reported
 * nothing for a second reader written `process.env["SUPABASE_SERVICE_ROLE_KEY"]`,
 * so the criterion "client.ts is the only file under src/ reading the key" held
 * for one spelling and not for the others. Each case below writes a probe file
 * under `src/` and asserts what the same scanner the rules use reports about it.
 */
describe("the credential guard itself", () => {
  const PROBE = "src/__credential_guard_probe__.ts";
  const probePath = path.join(repoRoot, PROBE);

  /** Files the scanner reports while `source` sits under `src/` as PROBE. */
  function scanWithProbe(source: string, pattern: RegExp): string[] {
    fs.writeFileSync(probePath, source, "utf8");
    try {
      return withoutDeprecated(filesWhereCodeMatches(pattern));
    } finally {
      fs.rmSync(probePath, { force: true });
    }
  }

  it("detects a reader that uses dot access", () => {
    const readers = scanWithProbe(
      "export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;\n",
      SERVICE_ROLE_KEY_READ,
    );
    expect(readers).toContain(PROBE);
  });

  it("detects a reader that uses bracket access with a string literal", () => {
    const readers = scanWithProbe(
      'export const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];\n',
      SERVICE_ROLE_KEY_READ,
    );
    expect(readers).toContain(PROBE);
  });

  it("detects a reader that brackets the exported name constant", () => {
    const readers = scanWithProbe(
      'import { DB_KEY_ENV_NAME } from "@/lib/db/client";\n' +
        "export const key = process.env[DB_KEY_ENV_NAME];\n",
      SERVICE_ROLE_KEY_READ,
    );
    expect(readers).toContain(PROBE);
  });

  it("detects a bracketed read of any other SUPABASE_ credential", () => {
    const readers = scanWithProbe(
      'export const url = process.env["SUPABASE_URL"];\n',
      SUPABASE_CREDENTIAL_READ,
    );
    expect(readers).toContain(PROBE);
  });

  it("reports nothing for a file that reads an unrelated env name", () => {
    // The scanner must stay a credential scanner: a resolvable non-credential
    // name, in either spelling, is not a violation of this rule.
    const source =
      "export const mode = process.env.NODE_ENV;\n" +
      'export const port = process.env["PORT"];\n';
    expect(scanWithProbe(source, SERVICE_ROLE_KEY_READ)).not.toContain(PROBE);
    expect(scanWithProbe(source, SUPABASE_CREDENTIAL_READ)).not.toContain(PROBE);
  });

  it("detects a reader that destructures or optionally chains process.env", () => {
    // Spellings a reader can use that name the credential just as plainly as
    // the three above (admin-window/BUG-0005). Destructuring an env name is
    // ordinary Node/Next code, `process.env?.` is habitual TypeScript, and a
    // concatenated bracket key is the dynamic-read family this scanner counts
    // by construction.
    for (const source of [
      "const { SUPABASE_SERVICE_ROLE_KEY } = process.env;\nexport const key = SUPABASE_SERVICE_ROLE_KEY;\n",
      "export const key = process.env?.SUPABASE_SERVICE_ROLE_KEY;\n",
      'export const key = process.env?.["SUPABASE_SERVICE_ROLE_KEY"];\n',
      'export const key = process.env["SUPABASE_" + "SERVICE_ROLE_KEY"];\n',
    ]) {
      expect(scanWithProbe(source, SERVICE_ROLE_KEY_READ), source).toContain(PROBE);
    }
  });

  it("detects the credential in every destructuring shape", () => {
    for (const source of [
      // second position, so the scan cannot key on "{ NAME"
      "const { NODE_ENV, SUPABASE_SERVICE_ROLE_KEY } = process.env;\n",
      // renamed away, so the binding never spells the credential
      "const { SUPABASE_SERVICE_ROLE_KEY: key } = process.env;\n",
      // renamed AND defaulted, broken over lines as a formatter would
      'const {\n  NODE_ENV,\n  SUPABASE_SERVICE_ROLE_KEY: key = "",\n} = process.env;\n',
      // let rather than const, reached through globalThis
      "let { SUPABASE_SERVICE_ROLE_KEY } = globalThis.process.env;\n",
      // a computed key this scan cannot resolve
      'const { ["SUPABASE_" + "SERVICE_ROLE_KEY"]: key } = process.env;\n',
    ]) {
      expect(scanWithProbe(source, SERVICE_ROLE_KEY_READ), source).toContain(PROBE);
    }
  });

  it("detects a credential read reached through globalThis or optional chaining", () => {
    for (const source of [
      "export const key = globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY;\n",
      "export const key = globalThis?.process?.env?.SUPABASE_SERVICE_ROLE_KEY;\n",
      'export const key = globalThis.process.env["SUPABASE_SERVICE_ROLE_KEY"];\n',
      "export const key = process?.env?.SUPABASE_SERVICE_ROLE_KEY;\n",
      "export const key = global.process.env.SUPABASE_SERVICE_ROLE_KEY;\n",
    ]) {
      expect(scanWithProbe(source, SERVICE_ROLE_KEY_READ), source).toContain(PROBE);
    }
  });

  it("detects a bracket key it cannot resolve, however that key is written", () => {
    for (const source of [
      'export const key = process.env["SUPABASE_" + "SERVICE_ROLE_KEY"];\n',
      "export const key = process.env[`${prefix}SERVICE_ROLE_KEY`];\n",
      "export const key = process.env[name];\n",
      "export const key = process.env?.[name];\n",
      'export const key = process.env["SUPABASE_SERVICE\\u005FROLE_KEY"];\n',
    ]) {
      expect(scanWithProbe(source, SERVICE_ROLE_KEY_READ), source).toContain(PROBE);
    }
  });

  it("tells the service-role key apart from another SUPABASE_ credential", () => {
    // Precision, not just recall: the widened shapes must still discriminate,
    // or the first rule's `toEqual([CLIENT])` would report url readers too.
    const source = "const { SUPABASE_URL } = process.env;\nexport const url = SUPABASE_URL;\n";
    expect(scanWithProbe(source, SUPABASE_CREDENTIAL_READ)).toContain(PROBE);
    expect(scanWithProbe(source, SERVICE_ROLE_KEY_READ)).not.toContain(PROBE);
  });

  it("reports nothing for those same shapes naming an unrelated env name", () => {
    // One negative control per widened form: the scanner must stay a
    // credential scanner, not an every-env-read scanner.
    for (const source of [
      "const { NODE_ENV } = process.env;\nexport const mode = NODE_ENV;\n",
      "const { NODE_ENV, PORT: port } = process.env;\n",
      "const {\n  NODE_ENV,\n  PORT,\n} = process.env;\n",
      "export const mode = process.env?.NODE_ENV;\n",
      'export const port = process.env?.["PORT"];\n',
      "export const mode = globalThis.process.env.NODE_ENV;\n",
      'export const mode = globalThis.process.env["NODE_ENV"];\n',
      'const { ["NODE_ENV"]: mode } = process.env;\n',
    ]) {
      expect(scanWithProbe(source, SERVICE_ROLE_KEY_READ), source).not.toContain(PROBE);
      expect(scanWithProbe(source, SUPABASE_CREDENTIAL_READ), source).not.toContain(PROBE);
    }
  });

  it("leaves the seam file itself reported by both scanners", () => {
    // The rules assert `toEqual([CLIENT])`; that is only meaningful while the
    // scanners still see the real reader.
    expect(filesWhereCodeMatches(SERVICE_ROLE_KEY_READ)).toContain(CLIENT);
    expect(filesWhereCodeMatches(SUPABASE_CREDENTIAL_READ)).toContain(CLIENT);
  });
});
