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
 * admin-window/BUG-0084, the same class one level down: replaying the grants is
 * only half of who may write. Two statement forms reach this table without
 * granting anything to the role that ends up holding it — `grant … to public`,
 * because every role is a member of PUBLIC, and `alter table … owner to <role>`,
 * because an owner holds everything on its own table and can re-grant it after
 * any revoke. Both are now modelled in the answer `privilegesHeld` gives, and a
 * role tail this reader cannot resolve to plain names is reported rather than
 * dropped.
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
 * The PUBLIC pseudo-role. Every role in the cluster is a member of it, so a
 * privilege granted here is held by `anon`, `authenticated` and `service_role`
 * alike. `privilegesHeld` folds this bucket into every role's answer — before
 * admin-window/BUG-0084 it sat in a bucket named `public` that no assertion
 * read, so `grant insert … to public` graded clean.
 *
 * It is a name this project's own migrations use (`revoke … from public` in
 * `kspace Scraper/supabase/migrations/20260901000003_an_adjudicated_claim_carries_its_stamp.sql`),
 * not a hypothetical.
 */
export const PUBLIC_ROLE = "public";

/**
 * Who owns a table these artifacts create. Ben applies them with `supabase db
 * push` from the sibling, which runs as `postgres`, and every one of the 105
 * `OWNER TO` lines in `20260818000000_the_schema_arrives_as_one_snapshot.sql`
 * names that same role.
 */
export const TABLE_OWNER_AT_BIRTH = "postgres";

/**
 * The roles a new `public` table in this project is born having granted
 * everything to, per the snapshot's `ALTER DEFAULT PRIVILEGES` block
 * (`20260818000000_the_schema_arrives_as_one_snapshot.sql:6848-6850`).
 *
 * `postgres` is absent — but NOT because the snapshot passes it over. It does
 * not: line 6847 of that same block is `ALTER DEFAULT PRIVILEGES FOR ROLE
 * "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres"`, right above
 * the three below. (The reason stated here until admin-window/BUG-0084 said the
 * snapshot grants it nothing, which is false; the exclusion it justified is
 * still right.) It is absent because this reader credits it by OWNERSHIP
 * instead — `TABLE_OWNER_AT_BIRTH`, folded in by `privilegesHeld` — and the two
 * are not interchangeable: a granted privilege is gone once revoked, while an
 * owner's rights over its own table survive any revoke, because the owner may
 * grant them straight back. Listing it here would let a `revoke … from
 * postgres` read as though it had narrowed something.
 */
export const ROLES_BORN_HOLDING_ALL: readonly string[] = ["anon", "authenticated", "service_role"];

/** What an artifact leaves each role holding on one table. */
export interface InstalledAcl {
  /**
   * Grantee name → the privileges granted to THAT NAME, replayed literally.
   * `PUBLIC_ROLE` is an ordinary entry here and ownership is not in here at
   * all. Read this through `privilegesHeld`, which folds both in: a role's
   * effective privileges are never just its own bucket (admin-window/BUG-0084).
   */
  readonly held: ReadonlyMap<string, ReadonlySet<TablePrivilege>>;
  /**
   * The role that OWNS the table once the artifact has applied: the last
   * `alter table <this table> owner to <role>` it carries, or
   * `TABLE_OWNER_AT_BIRTH` when it carries none. An owner holds every privilege
   * on its own table and may re-grant them at will, so `privilegesHeld` credits
   * it with all eight and no revoke below the line narrows that — which is
   * exactly what made `owner to service_role` grade clean before
   * admin-window/BUG-0084.
   */
  readonly owner: string;
  /**
   * Statements this reader refused to interpret while they may still change the
   * table's ACL — a column-level grant, an unknown privilege word, `grant option
   * for`, `on all tables in schema`, an `alter default privileges`, a role tail
   * it cannot resolve to plain role names (`granted by …`, `with grant option`,
   * `current_user`), or an owner it cannot name. NEVER ignore these: silently
   * skipping the statement you cannot parse is how a grader certifies an ACL it
   * never read (BUG-0082 again, one level down).
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

/** A bare role name, optionally quoted and optionally preceded by `group`. */
const ROLE_NAME = /^(?:group\s+)?"?([a-z_][a-z0-9_$]*)"?$/;

/**
 * Role specifications that name a role by context rather than by name. Whose
 * privileges they change depends on who runs the file, which this reader cannot
 * know — so it says so instead of inventing a role called `current_user`.
 */
const CONTEXTUAL_ROLES: readonly string[] = ["current_user", "session_user", "current_role"];

/** One role specification resolved to a plain role name, or null. */
function parseRoleName(text: string): string | null {
  const match = ROLE_NAME.exec(text.trim().toLowerCase());
  if (match === null) return null;
  return CONTEXTUAL_ROLES.includes(match[1]) ? null : match[1];
}

/**
 * The role names one GRANT/REVOKE tail names — `public` included as itself,
 * because `privilegesHeld` is where PUBLIC's reach is applied — or null when
 * the tail is more than a comma-separated list of plain names.
 *
 * The two null cases are ACL changes this reader will not pretend to model
 * (admin-window/BUG-0084): `granted by <role>` puts a role specification where a
 * name is expected and the old split produced the non-role `x granted by y`,
 * which then matched nothing and vanished; `with grant option` hands the grantee
 * the power to re-grant to anyone, which is a write path this model has no way
 * to follow. Both are reported, not stripped.
 */
function parseRoles(text: string): string[] | null {
  const tail = text
    .toLowerCase()
    .replace(/\s+(?:cascade|restrict)\s*$/, "")
    .trim();
  if (/\bgranted\s+by\b/.test(tail) || /\bwith\s+grant\s+option\b/.test(tail)) return null;
  const names = tail.split(",").map((entry) => parseRoleName(entry));
  if (names.length === 0 || names.some((name) => name === null)) return null;
  return names as string[];
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

const OWNER_STATEMENT =
  /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)\s+owner\s+to\s+(.+)$/;

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
  ownerAtBirth: string = TABLE_OWNER_AT_BIRTH,
): InstalledAcl {
  const table = qualifiedTable.toLowerCase();
  const held = new Map<string, Set<TablePrivilege>>();
  for (const role of bornHoldingAll) held.set(role, new Set(TABLE_PRIVILEGES));
  const unreadable: string[] = [];
  let owner = ownerAtBirth.toLowerCase();

  for (const raw of artifact.statements) {
    const statement = raw.replace(/\s+/g, " ").trim();
    const flat = statement.toLowerCase();

    if (flat.startsWith("alter default privileges")) {
      unreadable.push(statement);
      continue;
    }

    // An ownership change is an ACL change: the new owner holds everything on
    // the table and every revoke below it is decorative, because it can grant
    // itself back. Last one wins, as Postgres applies them.
    const owned = OWNER_STATEMENT.exec(flat);
    if (owned !== null) {
      if (parseObjects(owned[1])[0] !== table) continue;
      const named = parseRoleName(owned[2]);
      if (named === null) unreadable.push(statement);
      else owner = named;
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
    const roles = parseRoles(roleText);
    if (roles === null) {
      unreadable.push(statement);
      continue;
    }
    for (const role of roles) {
      const current = held.get(role) ?? new Set<TablePrivilege>();
      for (const privilege of privileges) {
        if (verb === "grant") current.add(privilege);
        else current.delete(privilege);
      }
      held.set(role, current);
    }
  }

  return { held, owner, unreadable };
}

/**
 * What one role is left holding, in `TABLE_PRIVILEGES` order — its own grants
 * PLUS the two reaches that are not grants to its name (admin-window/BUG-0084):
 * everything, if it owns the table; and whatever PUBLIC holds, since every role
 * is a member of PUBLIC. Asking `held` directly answers a narrower question
 * than "may this role write the table", which is the only question worth asking.
 */
export function privilegesHeld(acl: InstalledAcl, role: string): TablePrivilege[] {
  const name = role.toLowerCase();
  if (name === acl.owner) return [...TABLE_PRIVILEGES];
  const own = acl.held.get(name) ?? new Set<TablePrivilege>();
  const viaPublic = acl.held.get(PUBLIC_ROLE) ?? new Set<TablePrivilege>();
  return TABLE_PRIVILEGES.filter((privilege) => own.has(privilege) || viaPublic.has(privilege));
}
