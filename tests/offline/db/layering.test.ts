import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allSourceFiles, codeText, repoRoot, sourceText } from "../source-tree";

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

/*
 * The walk and the two readers are `tests/offline/source-tree.ts`
 * (admin-window/BUG-0032) — one copy for every structural rule in this suite,
 * instead of the five hand-copied ones that had drifted apart.
 *
 * This file takes `allSourceFiles`, the UNFILTERED walk: the probe below is
 * the point of "the credential guard itself", so the scanner these rules use
 * must reach it. Every other caller takes the filtered `sourceFiles`, which
 * skips exactly what no compiler compiles. Both survive a path vanishing
 * mid-walk, which is what this file's own probe does ~20 times per run while
 * other files walk the same tree in parallel workers.
 */

function filesWhereCodeMatches(pattern: RegExp): string[] {
  return allSourceFiles().filter((file) => pattern.test(codeText(file)));
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
    const files = allSourceFiles();
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
    const offenders = allSourceFiles().filter((file) => sourceText(file).includes("STAGING_"));
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
  /**
   * Under `src/`, so the scanner walks it — and inside a dot-directory, so no
   * compiler does (admin-window/BUG-0029).
   *
   * This probe used to be written straight to `src/__credential_guard_probe__.ts`,
   * which the tsconfig `include` glob (`**\/*.ts`) covers. `tests/offline/toolchain.test.ts`
   * runs a real `tsc --listFilesOnly` over that same program in a parallel
   * worker; when it enumerated the probe and the `finally` below deleted it a
   * moment later, tsc died with `TS6053: File ... not found` and the offline
   * suite reddened for reasons no assertion cared about. TypeScript's include
   * globbing skips directories whose name starts with `.`, while the walker in
   * `allSourceFiles()` skips nothing — so a dot-hidden probe is asserted on
   * exactly as before and is invisible to any concurrent compile.
   */
  const PROBE = "src/.probes/__credential_guard_probe__.ts";
  const probePath = path.join(repoRoot, PROBE);
  const probeDir = path.dirname(probePath);

  /** Files the scanner reports while `source` sits under `src/` as PROBE. */
  function scanWithProbe(source: string, pattern: RegExp): string[] {
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(probePath, source, "utf8");
    try {
      return withoutDeprecated(filesWhereCodeMatches(pattern));
    } finally {
      fs.rmSync(probeDir, { force: true, recursive: true });
    }
  }

  it("hides its probe from every compiler that reads this tree", () => {
    // The invariant the comment above depends on: a path segment starting with
    // `.` is what keeps this file out of the tsconfig program, and out of any
    // `tsc`/`next build` running beside this suite.
    expect(PROBE.startsWith("src/")).toBe(true);
    expect(PROBE.split("/").some((segment) => segment.startsWith("."))).toBe(true);
  });

  it("still reaches the scanner from there, and leaves nothing behind", () => {
    // Non-vacuous both ways: dot-hidden did not mean invisible to the walker,
    // and the probe directory does not survive the scan.
    const readers = scanWithProbe(
      "export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;\n",
      SERVICE_ROLE_KEY_READ,
    );
    expect(readers).toContain(PROBE);
    expect(fs.existsSync(probeDir)).toBe(false);
  });

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

/**
 * The import scanner, over CODE lines only (`codeText` drops commentary), so a
 * docstring explaining what the leaf may not import stays documentation.
 *
 * Four spellings reach a module: a top-level `import`, a `require(` call, a
 * dynamic `import(…)`, and any clause naming a module specifier after `from` —
 * which is what catches a re-export (`export { x } from "./y"`).
 */
const IMPORT_LINE = /^\s*import\b|\brequire\s*\(|\bimport\s*\(|\bfrom\s+["']/;

/** The import lines of one file, as the leaf rule reads them. */
function importLines(file: string): string[] {
  return codeText(file)
    .split("\n")
    .filter((line) => IMPORT_LINE.test(line));
}

/**
 * The paging leaf's directory (admin-window/TASK-0063). §4.3 read kind 3 puts
 * every decision paging makes — the bound value class, the answer shape, the
 * one-press driver — in a directiveless module the offline suite drives
 * directly, and rule 7 is what keeps `fetchJson` a dependency handed IN rather
 * than a database this layer could reach.
 *
 * The whole directory joins the leaf set, enumerated rather than listed
 * file-by-file, so a module added beside `bounds.ts` and `machine.ts` is
 * graded by this rule instead of quietly sitting outside it. The test below
 * pins that the enumeration really found both, so it can never empty into a
 * vacuous pass.
 */
const PAGING_LEAF_DIR = "src/lib/paging";

function pagingLeaves(): string[] {
  const dir = path.join(repoRoot, PAGING_LEAF_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => `${PAGING_LEAF_DIR}/${name}`)
    .sort();
}

const LEAF_MODULES = [
  "src/lib/edit/config.ts",
  // The verdict decision envelope: the one shape `settle_review_item` reads,
  // built by every M2 surface (ARCHITECTURE §9.2, admin-window/TASK-0042).
  "src/lib/verdict/decision.ts",
  // The app's ONE uuid grammar (admin-window/DEBT-0009). `isRecordId` and
  // `canonicalRecordId` were declared in `src/lib/db/records.ts` — pure
  // functions over a string, in a module no leaf may import — so no leaf
  // could ask the app's own id question and `/claims` compared a URL's raw
  // `source_id` to the ids its view holds. Moving them buys nothing unless
  // the new home STAYS a leaf: an import of `lib/db/**` here would put the
  // grammar back out of reach of `lib/claims/filters.ts`, which now imports
  // it, and would write the directory cycle rule 7 forbids.
  "src/lib/records/id.ts",
  // The app's ONE allowlist for a URL value inside a sentence it wrote itself
  // (admin-window/BUG-0153; ARCHITECTURE §7, common violations row 15). It was
  // `canSpellAskedCycle` in `src/components/cycles/asked-cycle.tsx` until a
  // second facet needed the same answer; both callers now import it, and one
  // of them is `canonicalUrlText` in `src/lib/url/text.ts`, which
  // `src/lib/db/runs.ts` calls, so it must STAY a leaf or that edge becomes
  // the directory cycle rule 7 forbids.
  "src/lib/url/spellable.ts",
  // The app's ONE derivation of a free-text URL facet value, and its ONE
  // ends-only ink strip (admin-window/BUG-0155; ARCHITECTURE §7, "What is
  // SHOWN is what was USED", common violations row 20). Its home is a leaf
  // BECAUSE of who asks it: `readRuns` (`src/lib/db/runs.ts`) derives the
  // value it sends, `/cycles` derives the value it spells, the runs half's
  // seam re-asks it, and `src/lib/records/id.ts` — itself a leaf — calls the
  // strip. Its predecessor was four lines inside `lib/db/**`, which is
  // precisely a pure function no leaf could reach (common violations row 17),
  // and an import of `lib/db/**` from here would put it back there.
  "src/lib/url/text.ts",
  ...pagingLeaves(),
];

/**
 * The module specifier an import line names, or null when the line carries
 * none — the first quoted string on it, which is where every one of the four
 * spellings `IMPORT_LINE` recognises puts it.
 */
function specifierOf(line: string): string | null {
  return line.match(/["']([^"']*)["']/)?.[1] ?? null;
}

/**
 * The repo-relative `src/**` file an import line resolves to, or null when it
 * names something outside the tree — a package (`@supabase/supabase-js`,
 * `react`), a node builtin, or a line with no specifier at all.
 *
 * Only the two spellings this repo's `src/` actually uses are resolved: the
 * `@/` alias (`tsconfig.json` maps it to `src/`) and a relative path. Anything
 * else is deliberately NOT a leaf, which is what the rule below needs.
 */
function importTarget(file: string, line: string): string | null {
  const specifier = specifierOf(line);
  if (specifier === null) return null;
  const relative = specifier.startsWith("@/")
    ? path.join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.join(path.dirname(file), specifier)
      : null;
  if (relative === null) return null;
  return `${relative.replace(/\.tsx?$/, "")}.ts`;
}

/**
 * Everything a file imports that is NOT one of the leaves — reported as the
 * resolved path where there is one and as the raw line where there is not, so
 * a failure names what to look at.
 *
 * This is the whole of rule 7 for the leaf set, and it is a CLOSED allowlist:
 * `lib/db/**`, `@supabase/supabase-js`, `process.env` by way of any module,
 * React and every package are all outside `LEAF_MODULES` and so all reported,
 * without this scanner holding a list of forbidden things to keep in step.
 */
function foreignImports(file: string): string[] {
  return importLines(file)
    .map((line) => importTarget(file, line) ?? line.trim())
    .filter((target) => !LEAF_MODULES.includes(target));
}

/**
 * ARCHITECTURE §4 rule 7 — **the pure domain leaves reach nothing that can
 * reach a database**, asserted over the LEAF SET rather than one file at a
 * time (campaign admin-window/TASK-0042).
 *
 * A leaf holds the vocabulary and pure functions over it, and `lib/db/**`
 * imports the leaf. The leaf importing back — even a type-only import, which
 * erases at runtime — writes a directory-level cycle into this contract, and
 * the day someone widens it to a value import the cycle is real with nothing
 * to catch it.
 *
 * **A leaf may import a LEAF**, and the leaf layer is a DAG (rule 7 ¶2, ruled
 * at the M2 structure walk 2026-09-09). This block asserted `toEqual([])` on
 * every import line until admin-window/BUG-0146, which read `trim()` out of
 * `canonicalRecordId` and replaced it with the app's ONE definition of blank
 * (`hasVisibleContent`, `lib/verdict/decision.ts`) — the edge ¶2 exists to
 * permit, and the alternative to it was a fourth copy of a character class
 * four M2 bugs are already made of. So the rule is now the one ¶2 states: an
 * import of another LEAF is fine, an import of anything else is not, and the
 * leaf edges may not form a cycle.
 *
 * `tests/offline/edit/config.test.ts` keeps its own copy of this assertion for
 * `lib/edit/config.ts` alone, and it stays: §4 rule 8 names that test by name
 * as what pins the BUILD HOST's one arrow (`next.config.ts` imports the leaf,
 * outside the app's module graph and outside the `@/` alias, so it only holds
 * while that file imports nothing). This block is the rule for the leaf SET,
 * which is what a new leaf joins.
 */
describe("the pure domain leaves", () => {
  it("still contains every file the leaf set names", () => {
    // The same ratchet the exemptions take, for the opposite reason: a leaf
    // that has been renamed or deleted has no import lines either, so without
    // this the rule below would pass vacuously on a file that is gone.
    for (const leaf of LEAF_MODULES) {
      expect(fs.existsSync(path.join(repoRoot, leaf)), `${leaf} is gone — fix the leaf set`).toBe(
        true,
      );
    }
  });

  it("counts the whole paging leaf directory in the leaf set", () => {
    // The enumeration's own non-vacuity pin: `pagingLeaves()` returns [] for a
    // directory that is absent or renamed, which would drop the paging leaf
    // out of every rule below without failing one of them. §4.3 read kind 3
    // names these two modules, so the set must hold them by name.
    expect(LEAF_MODULES).toContain(`${PAGING_LEAF_DIR}/bounds.ts`);
    expect(LEAF_MODULES).toContain(`${PAGING_LEAF_DIR}/machine.ts`);
  });

  it("imports nothing but another leaf, in any leaf", () => {
    for (const leaf of LEAF_MODULES) {
      expect(foreignImports(leaf), leaf).toEqual([]);
    }
  });

  it("keeps the leaf edges a DAG, so no cycle is written between leaves", () => {
    // Rule 7 ¶2's other half. The reason ¶1 bans the `lib/db/**` back-edge
    // applies unchanged between leaves, and the set is small enough to walk
    // whole: for each leaf, follow its leaf imports and assert it never
    // reaches itself.
    const edges = new Map(
      LEAF_MODULES.map((leaf) => [
        leaf,
        importLines(leaf)
          .map((line) => importTarget(leaf, line))
          .filter((target): target is string => target !== null && LEAF_MODULES.includes(target)),
      ]),
    );
    for (const start of LEAF_MODULES) {
      const seen = new Set<string>();
      const queue = [...(edges.get(start) ?? [])];
      while (queue.length > 0) {
        const next = queue.shift() as string;
        expect(next, `${start} reaches itself through the leaf edges`).not.toBe(start);
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(...(edges.get(next) ?? []));
      }
    }
  });
});

/**
 * The guard guarding itself, in the manner of the credential guard above: the
 * leaf rule is only as good as the spelling it recognises, so each case writes
 * a probe under `src/` and asserts what the SAME reader the rule uses reports
 * about it. Two fixtures, always — one the guard must flag, one it must not
 * (LESSONS 3).
 */
describe("the leaf-import guard itself", () => {
  /** Dot-hidden, for the reasons the credential probe above states. */
  const PROBE = "src/.probes/__leaf_import_probe__.ts";
  const probePath = path.join(repoRoot, PROBE);
  const probeDir = path.dirname(probePath);

  /** What the leaf rule reports while `source` sits under `src/` as PROBE. */
  function scanLeafProbe(source: string): string[] {
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(probePath, source, "utf8");
    try {
      return foreignImports(PROBE);
    } finally {
      fs.rmSync(probeDir, { force: true, recursive: true });
    }
  }

  it("reddens the leaf assertion when a NON-leaf import is added, in every spelling", () => {
    for (const source of [
      'import { T } from "@/lib/db/tables";\nexport const x = T;\n',
      'import type { DbResult } from "@/lib/db/result";\nexport type R = DbResult<number>;\n',
      'import "@/lib/db/client";\n',
      '\timport { createClient } from "@supabase/supabase-js";\n',
      'const { T } = require("@/lib/db/tables");\n',
      'export { T } from "@/lib/db/tables";\n',
      'export const late = async () => await import("@/lib/db/client");\n',
      // React and a node builtin are outside the leaf set too, so the closed
      // allowlist reports them without naming them anywhere.
      'import { useState } from "react";\n',
      'import fs from "node:fs";\n',
      // A relative reach OUT of the leaf layer resolves the same way an
      // aliased one does, so neither spelling is a way around the rule.
      'import { T } from "../lib/db/tables";\n',
    ]) {
      expect(scanLeafProbe(source), source).not.toEqual([]);
    }
  });

  it("says nothing about a leaf that imports another LEAF, in every spelling", () => {
    // The fixture the widened rule MUST NOT flag (LESSONS 8's second one, and
    // the whole of rule 7 ¶2): `src/lib/records/id.ts` really imports
    // `src/lib/verdict/decision.ts` on this tree — the app's one definition of
    // blank, asked rather than copied (admin-window/BUG-0146).
    for (const source of [
      'import { hasVisibleContent } from "@/lib/verdict/decision";\n',
      'import { visibleContent } from "@/lib/verdict/decision.ts";\n',
      'import type { VerdictAction } from "@/lib/verdict/decision";\n',
      'export { factKey } from "@/lib/verdict/decision";\n',
      // Relative, from the probe's own directory (`src/.probes/`).
      'import { ADMIN_SOURCE } from "../lib/verdict/decision";\n',
    ]) {
      expect(scanLeafProbe(source), source).toEqual([]);
    }
    expect(fs.existsSync(probeDir)).toBe(false);
  });

  it("says nothing about a leaf that imports nothing, and leaves nothing behind", () => {
    // The fixture the guard must NOT flag: a real leaf's shape — a docstring
    // naming the imports it forbids, a word containing "import", and a string
    // holding the word — none of which is an import.
    const source =
      "/**\n" +
      " * A leaf: it must not import from `lib/db/**`, and a `require(` here is\n" +
      ' * documentation. Nor `export { x } from "./y"`.\n' +
      " */\n" +
      'export const IMPORTANT = "important";\n' +
      "export function importantly(n: number): number {\n" +
      "  return n + 1;\n" +
      "}\n";
    expect(scanLeafProbe(source)).toEqual([]);
    expect(fs.existsSync(probeDir)).toBe(false);
  });

  it("reads the leaf set through the same scanner, on the real files", () => {
    // Non-vacuous the other way: the scanner reaches the actual leaves rather
    // than only a probe, and a file it cannot read would report [] forever.
    // Read from the leaf SET, so a leaf added above is covered here too rather
    // than leaving the rule that names it resting on an unread file.
    for (const leaf of LEAF_MODULES) {
      expect(codeText(leaf).length, leaf).toBeGreaterThan(0);
    }
  });
});
