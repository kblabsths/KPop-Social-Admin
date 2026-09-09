/**
 * The handoff-artifact reader — campaign admin-window/TASK-0045.
 *
 * M2's two schema pieces are authored in this repo and installed by hand from
 * the scraper repo (DECISIONS 2026-09-08). They are NOT `.sql` files: each is a
 * single fenced `sql` block inside a note under `agenticflow/tracker/for-human/`,
 * so that no glob, no stray `supabase db push` and no agent looking for "the
 * migrations" can apply one from here.
 *
 * That leaves them ungraded by any compiler, so this module is the instrument:
 * it pulls the ONE fenced block out of a note and normalizes it just far enough
 * that a structural test can ask real questions of it. It is deliberately NOT a
 * SQL parser and never claims the artifact "parses" — a dependency for one file
 * is not proportionate, and the actual bar is Ben's review (SPEC F9).
 *
 * Shared by both artifacts' tests (`verdicts.test.ts`, and the
 * `settle_review_item` note's own), which is why everything here is about SQL
 * text in general and nothing here knows what a verdict is.
 *
 * ## The three normalizations, and why each exists
 *
 *  - `code` — comments removed. Every question below is about SQL, and the
 *    sibling's migrations carry more comment prose than statements; without
 *    this, "does it contain `create policy`" is answered by a sentence that
 *    says it does not.
 *  - `scan` — `code` with single-quoted literals emptied and lowercased, for
 *    keyword questions. A banned word inside a string is data, not a
 *    construct. Dollar-quoted bodies are KEPT, because a `plpgsql` function
 *    body is exactly where the next artifact's `begin`/`end` live.
 *  - `statements` — split on `;` outside literals, dollar quotes and
 *    parentheses, so a per-statement question ("which statements grant?") does
 *    not have to re-tokenize.
 */
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../source-tree";

/** Where a for-human note lives, relative to the repo root. */
export const HANDOFF_DIR = "agenticflow/tracker/for-human";

/** One fenced block of a markdown document. */
export interface FencedBlock {
  /** The info string as written: `sql`, `sh`, or `""` for a bare fence. */
  readonly info: string;
  /** The block's contents, without the fence lines. */
  readonly text: string;
}

/** A note's one `sql` block, in the three shapes a structural test needs. */
export interface SqlArtifact {
  /** Verbatim, exactly as it will be pasted into the migration file. */
  readonly text: string;
  /** `text` with `--` and `/* *\/` comments removed; literals intact. */
  readonly code: string;
  /** `code`, lowercased, with single-quoted literals emptied. */
  readonly scan: string;
  /** `code` split into statements. */
  readonly statements: readonly string[];
}

/** Reads a for-human note by file name (not a path — the directory is fixed). */
export function readHandoffNote(fileName: string): string {
  return fs.readFileSync(path.join(repoRoot, HANDOFF_DIR, fileName), "utf8");
}

/**
 * Every fenced block in a markdown document, in order.
 *
 * Both fence characters, both fence lengths, and up to three leading spaces —
 * the same grammar `tests/live/staging-target.ts` already reads markdown with.
 * A fence closes only on the character it opened with, so a ``` block quoting a
 * ~~~ fence is one block, not three.
 */
export function fencedBlocks(markdown: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let open: { mark: string; info: string; lines: string[] } | null = null;

  for (const line of markdown.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const mark = fence[1][0];
      if (open === null) {
        open = { mark, info: fence[2].trim(), lines: [] };
        continue;
      }
      if (open.mark === mark) {
        blocks.push({ info: open.info, text: open.lines.join("\n") });
        open = null;
        continue;
      }
    }
    if (open !== null) open.lines.push(line);
  }

  return blocks;
}

/** The `sql` blocks of a note — the ones whose info string names SQL. */
export function sqlBlocks(markdown: string): FencedBlock[] {
  return fencedBlocks(markdown).filter((block) => block.info.toLowerCase() === "sql");
}

/**
 * The note's ONE `sql` block, normalized.
 *
 * Throws when there is not exactly one: a note with two is a note whose reader
 * has to choose, and choosing is what a handoff must never ask of Ben.
 */
export function sqlArtifactOf(markdown: string): SqlArtifact {
  const blocks = sqlBlocks(markdown);
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one fenced sql block, found ${blocks.length}`);
  }
  const text = blocks[0].text;
  const code = stripSqlComments(text);
  return {
    text,
    code,
    scan: emptyLiterals(code).toLowerCase(),
    statements: splitTopLevel(code, ";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  };
}

/** Read a note and take its one `sql` block in one step. */
export function readSqlArtifact(fileName: string): SqlArtifact {
  return sqlArtifactOf(readHandoffNote(fileName));
}

/** A dollar-quote tag (`$$` or `$tag$`) starting at `index`, or null. */
function dollarTagAt(sql: string, index: number): string | null {
  if (sql[index] !== "$") return null;
  const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
  return tag === null ? null : tag[0];
}

/**
 * The one tokenizer walk: calls `visit` for every region of the SQL, told what
 * kind of region it is. Everything else in this module is a use of it.
 *
 * Regions: `code`, `line-comment`, `block-comment`, `quoted` (single),
 * `identifier` (double), `dollar` (dollar-quoted body, tag included).
 */
type Region = "code" | "line-comment" | "block-comment" | "quoted" | "identifier" | "dollar";

function walkSql(sql: string, visit: (region: Region, chunk: string) => void): void {
  let index = 0;
  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index);
      const stop = end === -1 ? sql.length : end;
      visit("line-comment", sql.slice(index, stop));
      index = stop;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      // Postgres block comments nest, so this counts depth rather than
      // stopping at the first `*/`.
      let depth = 0;
      let cursor = index;
      while (cursor < sql.length) {
        if (sql.startsWith("/*", cursor)) {
          depth += 1;
          cursor += 2;
        } else if (sql.startsWith("*/", cursor)) {
          depth -= 1;
          cursor += 2;
          if (depth === 0) break;
        } else {
          cursor += 1;
        }
      }
      visit("block-comment", sql.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index];
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === quote) {
          // A doubled quote is an escaped one: step over both and stay inside.
          if (sql[cursor + 1] === quote) cursor += 2;
          else {
            cursor += 1;
            break;
          }
        } else cursor += 1;
      }
      visit(quote === "'" ? "quoted" : "identifier", sql.slice(index, cursor));
      index = cursor;
      continue;
    }
    const tag = dollarTagAt(sql, index);
    if (tag !== null) {
      const close = sql.indexOf(tag, index + tag.length);
      const stop = close === -1 ? sql.length : close + tag.length;
      visit("dollar", sql.slice(index, stop));
      index = stop;
      continue;
    }
    visit("code", sql[index]);
    index += 1;
  }
}

/** `sql` with every comment removed; literals and dollar bodies untouched. */
export function stripSqlComments(sql: string): string {
  let out = "";
  walkSql(sql, (region, chunk) => {
    if (region === "line-comment") return;
    if (region === "block-comment") {
      out += " ";
      return;
    }
    out += chunk;
  });
  return out;
}

/**
 * `sql` with the CONTENTS of every single-quoted literal removed, the quotes
 * left in place. Dollar-quoted bodies survive on purpose (see the header).
 */
export function emptyLiterals(sql: string): string {
  let out = "";
  walkSql(sql, (region, chunk) => {
    out += region === "quoted" ? "''" : chunk;
  });
  return out;
}

/**
 * Split at top level on a one-character separator: outside every literal,
 * comment and dollar body, and at parenthesis depth zero.
 *
 * Used with `";"` for statements and with `","` for a `create table` body,
 * whose entries hold commas inside `array[...]` and `references x(y)`.
 */
export function splitTopLevel(sql: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  walkSql(sql, (region, chunk) => {
    if (region !== "code") {
      current += chunk;
      return;
    }
    if (chunk === "(") depth += 1;
    else if (chunk === ")") depth = Math.max(0, depth - 1);
    else if (chunk === separator && depth === 0) {
      parts.push(current);
      current = "";
      return;
    }
    current += chunk;
  });
  parts.push(current);
  return parts;
}

/** How many `$$` marks the code carries. Must be even, or a body is unclosed. */
export function dollarQuoteMarks(code: string): number {
  return (code.match(/\$\$/g) ?? []).length;
}

/**
 * `begin`/`end` balance, counted the way plpgsql actually spells it.
 *
 * Openers are `begin` and `case`; closers are `end` EXCEPT `end if` and
 * `end loop`, which terminate constructs whose openers are not counted here.
 * `end case` is counted, because `case` is. The verdicts artifact has none of
 * these (0 and 0); the function artifact is why the rule is written down.
 */
export function blockBalance(scan: string): { openers: number; closers: number } {
  const openers = (scan.match(/\b(?:begin|case)\b/g) ?? []).length;
  const closers = (scan.match(/\bend\b(?!\s+(?:if|loop)\b)/g) ?? []).length;
  return { openers, closers };
}

/** The constructs no handoff artifact may carry, and the name each is reported under. */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["create_policy", /\bcreate\s+policy\b/],
  ["commit", /\bcommit\b/],
  ["rollback", /\brollback\b/],
  ["dblink", /\bdblink\b/],
  ["autonomous_transaction", /\bautonomous[_\s]transaction\b/],
  ["pg_background", /\bpg_background/],
];

/**
 * Named findings for every forbidden construct present — empty for a clean
 * artifact. A verdict settles in ONE transaction that `supabase db push` and
 * the calling function own; a `commit` inside either file, or an autonomous
 * transaction smuggled in through `dblink`, would break exactly the guarantee
 * the design rests on (contracts/resolver.md §7 step 0b).
 */
export function forbiddenConstructs(scan: string): string[] {
  return FORBIDDEN.filter(([, pattern]) => pattern.test(scan)).map(([name]) => name);
}

/** Every object an `alter table` in this artifact targets, lowercased. */
export function alterTableTargets(scan: string): string[] {
  const targets: string[] = [];
  const pattern = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)/g;
  let match = pattern.exec(scan);
  while (match !== null) {
    targets.push(match[1].replace(/"/g, ""));
    match = pattern.exec(scan);
  }
  return targets;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The ACL an artifact INSTALLS — not the grant lines it happens to carry.
 *
 * admin-window/BUG-0082. The `verdicts` artifact said "service_role holds
 * SELECT and nothing else" and wrote `grant select … to service_role;` — and
 * that GRANT installs a fully writable table, because on this project a new
 * `public` table is BORN holding everything:
 *
 *   `kspace Scraper/supabase/migrations/20260818000000_the_schema_arrives_as_one_snapshot.sql`
 *     ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
 *       GRANT ALL ON TABLES TO "anon" / "authenticated" / "service_role"
 *
 * measured by the sibling as `service_role=arwdDxtm/postgres`
 * (`20260821000001_the_gate_becomes_the_only_write_path.sql`, which fixed the
 * identical design with an explicit revoke). A grant can only widen; only a
 * revoke narrows. So a grader that reads GRANT statements grades the opposite
 * of what gets installed, and the only honest question is the ACL: replay the
 * artifact's grants and revokes, in order, onto what the table is born with,
 * and ask what each role is left holding.
 *
 * Lives here rather than in one test so the `settle_review_item` artifact —
 * whose own note is graded by a sibling of `verdicts.test.ts` — asks the same
 * question of its own object instead of re-deriving it.
 */

/** The eight table privileges Postgres tracks, in `psql`'s own order. */
export const TABLE_PRIVILEGES = [
  "select",
  "insert",
  "update",
  "delete",
  "truncate",
  "references",
  "trigger",
  "maintain",
] as const;

export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

/**
 * The roles a new `public` table in this project is born having granted
 * everything to, per the snapshot's `ALTER DEFAULT PRIVILEGES` block. `postgres`
 * is deliberately absent: it OWNS the tables, and an owner's rights over its own
 * table do not come from a grant (20260821000001's header says exactly this,
 * which is why revoking service_role's DML leaves the definer functions writing).
 */
export const ROLES_BORN_HOLDING_ALL: readonly string[] = ["anon", "authenticated", "service_role"];

/** What an artifact leaves each role holding on one table. */
export interface InstalledAcl {
  /** Role → the privileges it still holds after the artifact applies. */
  readonly held: ReadonlyMap<string, ReadonlySet<TablePrivilege>>;
  /**
   * Statements this reader refused to interpret while they may still change the
   * table's ACL — a column-level grant, an unknown privilege word, `grant option
   * for`, `on all tables in schema`, or an `alter default privileges`. NEVER
   * ignore these: silently skipping the statement you cannot parse is how a
   * grader certifies an ACL it never read (BUG-0082 again, one level down).
   */
  readonly unreadable: readonly string[];
}

/** The privileges one GRANT/REVOKE names, or null when they are not all known. */
function parsePrivileges(text: string): TablePrivilege[] | null {
  const flat = text.trim().toLowerCase();
  if (flat.includes("(")) return null; // a column-level grant narrows differently
  if (/^all(\s+privileges)?$/.test(flat)) return [...TABLE_PRIVILEGES];
  const named = flat.split(",").map((word) => word.trim());
  const known = TABLE_PRIVILEGES as readonly string[];
  if (named.some((word) => !known.includes(word))) return null;
  return named as TablePrivilege[];
}

/** The role names one GRANT/REVOKE tail names, `public` included as itself. */
function parseRoles(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\s+(?:with\s+grant\s+option|cascade|restrict)\s*$/, "")
    .split(",")
    .map((role) => role.replace(/"/g, "").trim())
    .filter((role) => role.length > 0);
}

/** The objects one GRANT/REVOKE names, unquoted and lowercased. */
function parseObjects(text: string): string[] {
  return text
    .toLowerCase()
    .split(",")
    .map((object) => object.replace(/"/g, "").trim())
    .filter((object) => object.length > 0);
}

const PRIVILEGE_STATEMENT =
  /^(grant|revoke)\s+(.+?)\s+on\s+(?:table\s+)?(.+?)\s+(?:to|from)\s+(.+)$/;

/**
 * Replay every privilege statement of `artifact` onto the birth ACL of
 * `qualifiedTable` and report what each role is left holding.
 *
 * Statements naming other objects are ignored; statements naming this one that
 * cannot be modelled are reported in `unreadable` rather than skipped.
 */
export function tableAclAfter(
  artifact: SqlArtifact,
  qualifiedTable: string,
  bornHoldingAll: readonly string[] = ROLES_BORN_HOLDING_ALL,
): InstalledAcl {
  const table = qualifiedTable.toLowerCase();
  const held = new Map<string, Set<TablePrivilege>>();
  for (const role of bornHoldingAll) held.set(role, new Set(TABLE_PRIVILEGES));
  const unreadable: string[] = [];

  for (const raw of artifact.statements) {
    const statement = raw.replace(/\s+/g, " ").trim();
    const flat = statement.toLowerCase();

    if (flat.startsWith("alter default privileges")) {
      unreadable.push(statement);
      continue;
    }
    const parsed = PRIVILEGE_STATEMENT.exec(flat);
    if (parsed === null) continue;
    const [, verb, privilegeText, objectText, roleText] = parsed;

    if (/\ball\s+tables\s+in\s+schema\b/.test(objectText)) {
      unreadable.push(statement);
      continue;
    }
    if (!parseObjects(objectText).includes(table)) continue;
    if (/^grant\s+option\s+for\b/.test(privilegeText)) {
      unreadable.push(statement);
      continue;
    }

    const privileges = parsePrivileges(privilegeText);
    if (privileges === null) {
      unreadable.push(statement);
      continue;
    }
    for (const role of parseRoles(roleText)) {
      const current = held.get(role) ?? new Set<TablePrivilege>();
      for (const privilege of privileges) {
        if (verb === "grant") current.add(privilege);
        else current.delete(privilege);
      }
      held.set(role, current);
    }
  }

  return { held, unreadable };
}

/** What one role is left holding, in `TABLE_PRIVILEGES` order. */
export function privilegesHeld(acl: InstalledAcl, role: string): TablePrivilege[] {
  const held = acl.held.get(role) ?? new Set<TablePrivilege>();
  return TABLE_PRIVILEGES.filter((privilege) => held.has(privilege));
}
