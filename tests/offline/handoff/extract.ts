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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CODE→MEANING READER, and who reads it.
 *
 * Everything below was one test file's private machinery until
 * admin-window/TASK-0080 split the handoff guards by INPUT OWNERSHIP
 * (ARCHITECTURE.md §10, 2026-09-12). It lives here because BOTH sides of that
 * split ask the same questions of the same grammar and neither may re-type the
 * reader (LESSONS 5 — a shared spelling is imported, never retyped; drifting
 * copies of THIS reader is how the same guard failed three times in one day):
 *
 *  - `tests/offline/handoff/settle-review-item.test.ts`, in the every-builder
 *    suite, grades OUR OWN artifact with it — that this campaign declares one
 *    meaning per code it allocates, in the registry's own grammar, and that the
 *    comparison tells our installed entries from a stranger's claim. Every
 *    input of those cases is a file in this repo;
 *  - `tests/handoff/sibling-codes.test.ts`, the opt-in `handoff` project, asks
 *    it of the SIBLING CHECKOUT — the one input this repo does not own, and the
 *    reason that project exists at all.
 *
 * Nothing here opens a path outside this repo: the sibling's root is named in
 * the `handoff` project and nowhere else. `SIBLING_REGISTRY` below is a
 * RELATIVE path and a message fragment — the file to read inside whatever root
 * the caller supplies.
 */

/**
 * The codes a for-human note DECLARES it allocates, read off §3's citation row
 * rather than hardcoded anywhere, so a renumber of the artifact moves every
 * check that asks about allocation with the file itself.
 *
 * Takes the note's text, because both projects ask it of the same note:
 * the offline suite grades what the note allocates, and the `handoff` project
 * (admin-window/TASK-0080) asks the sibling whether those numbers are free.
 */
export function allocatedCodesIn(noteText: string): string[] {
  const row = /\|([^|]*)\|[^|]*SQLSTATEs this file allocates/.exec(noteText);
  if (row === null) return [];
  return [...row[1].matchAll(/KS\d{3}/g)].map((match) => match[0]);
}

/**
 * The `KSnnn` codes a piece of SQL RAISES, in the one grammar every KS code
 * next door is raised in: `using errcode = 'KSnnn'`.
 *
 * A raise is a USE of a code, not a declaration of what it means — which is why
 * it is read as a grammar and compared to nothing. What it answers is narrower
 * and it is the only thing it answers: which codes this tree puts in service.
 *
 * Line endings do not reach this one (admin-window/BUG-0225): the pattern is
 * anchored to nothing and its `\s` admits a `\r`, so a CRLF file answers as its
 * LF twin does. The half of THIS question that could answer partially is the
 * walk that feeds it — a `.sql` file it could not open — and that walk reports
 * what it could not read rather than skipping it
 * (`tests/handoff/sibling-codes.test.ts`).
 */
export const RAISED_CODE = /errcode\s*=\s*'(KS\d{3})'/g;

export function raisedCodes(sql: string): string[] {
  return [...new Set([...sql.matchAll(RAISED_CODE)].map((match) => match[1]))].sort();
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Whose meaning is `KS029` next door — asked of a DECLARATION on each side
 * (admin-window/BUG-0213, the architect's ruling of 2026-09-11; ARCHITECTURE.md
 * §10, DECISIONS.md).
 *
 * The question this guard exists to answer is narrow: does a number this
 * campaign allocates already MEAN something else in the tree Ben installs it
 * into. Three earlier answers compared the sibling's text against a corpus of
 * our own — first per line (admin-window/BUG-0207), then per whole paste block
 * (admin-window/BUG-0212) — and both failed, in opposite directions, because a
 * similarity oracle answers "does this look like something we wrote" instead:
 *
 *  - the LINE corpus carried our artifact's own raise idiom, `using errcode =
 *    'KS029',` — the grammar all 32 of the sibling's codes use — so a stranger
 *    raising one of the four for a meaning of its own wrote a line we already
 *    held, and passed SILENTLY;
 *  - the BLOCK corpus contained a TWO-LINE block, §1a's pinned-list paste, and
 *    the sibling's next allocation lands on its second line (that list is
 *    written six, six, six, five, five, four entries to a line), so the block
 *    stopped matching and a next-door edit claiming none of our meanings turned
 *    `npm test` RED for every builder in this repo.
 *
 * So no text of the sibling's is recognised here. Both sides spell the same
 * declaration in the same grammar — `NAME = "KSnnn"`, a code beside the meaning
 * it is held for. Next door that is `tests/helpers/ks_codes.py`, the registry
 * the sibling's own admission rule keeps complete ("Every `KSnnn` the
 * migrations raise is named here", its docstring;
 * `tests/live_safety/test_codes_named_once.py` enforces it). On our side it is
 * §1a of the handoff note: the entries Ben pastes INTO that registry. Per
 * allocated code the answer is one of three, and nothing else is consulted:
 *
 *  - the registry declares no meaning for it — not installed yet, no claim;
 *  - it declares the meaning our note declares — our own artifact, which is the
 *    campaign's satisfaction condition and must be GREEN;
 *  - it declares a different meaning — a real collision: RED, naming the code,
 *    our meaning, theirs, and the file the answer was read from.
 *
 * One thing the registry cannot answer is answered too: a code RAISED next door
 * (`ksRaisesUnder`) that the registry declares nothing for. There the sibling's
 * own admission rule is broken and this guard has no declaration to read, so
 * silence would be BUG-0212's miss again — it is a finding of its own.
 *
 * The boundary of the design, stated rather than hidden: once the registry
 * declares one of the four with OUR meaning, a later file next door that raises
 * that code for something else WITHOUT touching the registry reads as ours.
 * Telling those two apart needs text similarity, which is the instrument that
 * failed three times in one day; next door the admission rule is what catches
 * it, in the repo where the fix would have to land anyway.
 */

/** The sibling's own code registry, relative to its root — the declaration read. */
export const SIBLING_REGISTRY = "tests/helpers/ks_codes.py";

/** The `target file` row of a for-human note, when it names a sibling migration. */
const INSTALLED_TARGET_ROW = /\|\s*target file\s*\|\s*`[^`]*?(supabase\/migrations\/[^`]+)`/;

/**
 * This campaign's installed handoff artifacts: every note under
 * `agenticflow/tracker/for-human/` that declares a `target file` inside the
 * sibling's `supabase/migrations/`. Derived from the notes themselves rather
 * than listed here, so a fourth handoff is covered the day it is written and
 * no list can go stale in silence.
 */
export function installedHandoffNotes(): { note: string; target: string; text: string }[] {
  const dir = path.join(repoRoot, HANDOFF_DIR);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({ note: name, text: fs.readFileSync(path.join(dir, name), "utf8") }))
    .map(({ note, text }) => ({ note, text, row: INSTALLED_TARGET_ROW.exec(text) }))
    .filter((entry) => entry.row !== null)
    .map(({ note, text, row }) => ({ note, text, target: (row as RegExpExecArray)[1] }));
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BAR THIS READER IS HELD TO — admin-window/BUG-0225, stated once, here,
 * and graded by `tests/handoff/sibling-codes.test.ts`.
 *
 * The reader answers TWO questions about a tree this repo does not own: which
 * codes the sibling DECLARES, and where it RAISES them. For each question
 * exactly two answers are allowed:
 *
 *  - the sibling's own declarations (or raises), read in the grammar its own
 *    parser defines; or
 *  - a REFUSAL that names the input and the shape of it that was not read.
 *
 * **A partial answer is not an answer.** An input the reader only half-read is
 * reported as unreadable rather than returned, because no comparison
 * downstream can tell a declaration that was missed from one that is absent —
 * and an empty map agrees with everything. That is the single shape behind four
 * rounds on this one reader (admin-window/BUG-0207, BUG-0212, BUG-0213,
 * BUG-0220), and the three residuals BUG-0225 closes are the same shape once
 * more: a CRLF input read as declaring nothing at all, a compound statement's
 * inline body read as a declaration named `try`, and a bracketed list with a
 * blank line in it INVENTING a declaration the sibling never wrote.
 *
 * `Reading` is the shape of that promise, `readOrRefuse` the only way to take
 * an answer out of one, and `unreadable` is spelled the way this module already
 * spells it for an ACL it could not replay (`InstalledAcl.unreadable`).
 *
 * **What this reader is not.** It is not a python parser, and it never claims
 * an input "parses". It reads the grammar the sibling's own registry is written
 * in and reports the shapes it KNOWS it cannot read: a NUL byte, a bracket left
 * open at the end of the text, a triple quote left open, a string literal a
 * line break ends, and a compound statement carrying its body on its own header
 * line. A python file that is broken in some other way declares nothing here
 * and nothing next door either (`code_declarations` answers a `SyntaxError`
 * with an empty list), so that case is a shared silence rather than a claim.
 */

/** One answer read out of an input, beside every shape of it that was refused. */
export interface Reading<Answer> {
  /** What the reader read. Trust it only when `unreadable` is empty. */
  readonly answer: Answer;
  /**
   * One sentence per shape of the input the reader could not read, each naming
   * the input and where in it the shape stands. EMPTY means the whole input was
   * read. NEVER ignore these: a half-read input compared as if complete is the
   * defect this reader is held to (see the bar above).
   */
  readonly unreadable: readonly string[];
}

/**
 * The answer, or a throw naming the question and every shape that was refused.
 *
 * A refusal to read is a correct answer to give a caller; it is never a correct
 * answer to swallow. Callers that want to report rather than throw read
 * `reading.unreadable` themselves — `codeClaims` takes it as a finding.
 */
export function readOrRefuse<Answer>(reading: Reading<Answer>, question: string): Answer {
  if (reading.unreadable.length === 0) return reading.answer;
  throw new Error(
    `${question}: the input was not read, so this answers nothing — ${reading.unreadable.join("; ")}`,
  );
}

/** One logical statement of a python text, and the 1-based line it starts on. */
interface Statement {
  /** The statement with its comments blanked and its line joins already made. */
  readonly text: string;
  readonly line: number;
}

/**
 * The logical statements of a python text, with every shape that stopped the
 * scan — the sibling's `blank_comments` + tokenizer, done as a scan.
 *
 * What it does, and why each piece is there:
 *
 *  - **line endings are normalized first**, `\r\n` and a lone `\r` alike, which
 *    is what python's universal newlines do before the tokenizer ever runs. A
 *    CRLF file therefore reads exactly as its LF twin does. Before BUG-0225 it
 *    read as declaring NOTHING: `\r` is a line terminator to a JavaScript
 *    regular expression, so `.+$` never reached the end of a CRLF line and the
 *    declaration pattern — which carries no `m` flag — matched nothing at all.
 *    The sibling pins LF in `.gitattributes` today, which is exactly why a CRLF
 *    input is one from somewhere this guard did not expect;
 *  - **comments come off** (the sibling's `blank_comments`), so a declaration
 *    parked inside one is invisible and one WEARING one is not;
 *  - **a triple-quoted body is data**, blanked, so a declaration written inside
 *    a docstring declares nothing here as it declares nothing there;
 *  - **a line break inside brackets, or one a backslash continues, joins**, so
 *    a value written across lines is read as the one logical line it is next
 *    door. A blank line does NOT end that join: a blank line inside brackets is
 *    ordinary python that the tokenizer passes straight over. Resetting the
 *    bracket depth there is what let a list like `PINNED = [\n "KS027",\n\n
 *    code="KS029"\n]` be read as a top-level assignment and INVENT a
 *    declaration about another repo's file (BUG-0225's third residual);
 *  - **a statement ends at a line break or a `;` outside brackets and strings**,
 *    as it does next door.
 */
function pythonStatements(source: string, text: string): Reading<Statement[]> {
  const unreadable: string[] = [];
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized.includes("\0")) {
    return {
      answer: [],
      unreadable: [
        `${source}: carries a NUL byte, which no python module parses — this is not python source text`,
      ],
    };
  }

  const statements: Statement[] = [];
  let current = "";
  let startsAt = 1;
  let lineNumber = 1;
  /** The delimiter of the triple-quoted body being skipped, and where it opened. */
  let triple: string | null = null;
  let tripleAt = 0;
  /** The quote of the one-line string literal being kept verbatim, if any. */
  let quote: string | null = null;
  let quoteAt = 0;
  /** Open brackets, and the line the outermost one stands on. */
  let depth = 0;
  let openedAt = 0;
  let continued = false;
  let index = 0;

  const endStatement = (): void => {
    if (current.trim().length > 0) statements.push({ text: current, line: startsAt });
    current = "";
    startsAt = lineNumber;
  };

  while (index < normalized.length) {
    const character = normalized[index];

    if (triple !== null) {
      if (normalized.startsWith(triple, index)) {
        current += "   ";
        triple = null;
        index += 3;
        continue;
      }
      // Blank, never delete: a triple-quoted body is one token, so it neither
      // ends the statement it stands in nor declares anything of its own.
      if (character === "\n") lineNumber += 1;
      current += " ";
      index += 1;
      continue;
    }

    if (quote !== null) {
      if (character === "\\" && index + 1 < normalized.length && normalized[index + 1] !== "\n") {
        current += normalized.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (character === "\n") {
        // A python string literal cannot cross a line break: next door this is
        // a SyntaxError and the whole file declares nothing, so reading on
        // would be this reader seeing what its owner's parser cannot.
        unreadable.push(
          `${source}:${quoteAt}: a string literal that no quote on that line closes`,
        );
        quote = null;
        lineNumber += 1;
        endStatement();
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      current += character;
      index += 1;
      continue;
    }

    if (character === "\n") {
      lineNumber += 1;
      if (continued) {
        current = current.slice(0, -1) + " ";
        continued = false;
        index += 1;
        continue;
      }
      if (depth > 0) {
        current += " ";
        index += 1;
        continue;
      }
      endStatement();
      index += 1;
      continue;
    }

    if (normalized.startsWith('"""', index) || normalized.startsWith("'''", index)) {
      const delimiter = normalized.slice(index, index + 3);
      const closes = normalized.indexOf(delimiter, index + 3);
      const ends = normalized.indexOf("\n", index);
      // A triple-quoted literal opened and closed on one line is a value a
      // declaration can carry, so it is kept; one that runs on is a body.
      if (closes !== -1 && (ends === -1 || closes < ends)) {
        current += normalized.slice(index, closes + 3);
        index = closes + 3;
        continued = false;
        continue;
      }
      triple = delimiter;
      tripleAt = lineNumber;
      current += "   ";
      index += 3;
      continued = false;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      quoteAt = lineNumber;
      current += character;
      index += 1;
      continued = false;
      continue;
    }

    if (character === "#") {
      const ends = normalized.indexOf("\n", index);
      index = ends === -1 ? normalized.length : ends;
      continued = false;
      continue;
    }

    if ("([{".includes(character)) {
      if (depth === 0) openedAt = lineNumber;
      depth += 1;
    }
    if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    if (character === ";" && depth === 0) {
      endStatement();
      index += 1;
      continue;
    }

    continued = character === "\\";
    current += character;
    index += 1;
  }

  endStatement();
  if (triple !== null) {
    unreadable.push(`${source}:${tripleAt}: a triple-quoted string this text never closes`);
  }
  if (quote !== null) {
    unreadable.push(`${source}:${quoteAt}: a string literal this text never closes`);
  }
  if (depth > 0) {
    unreadable.push(
      `${source}:${openedAt}: a bracket this text never closes, so everything after it ` +
        `is read as one unfinished statement`,
    );
  }
  return { answer: statements, unreadable };
}

/** One python string literal at the head of `value`: the prefix, and its text. */
const STRING_LITERAL =
  /^[rRuU]?(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"]*)"|'([^']*)')/;

/**
 * The `str` Constant a value expression is, or null when it is not one.
 *
 * Parentheses come off and adjacent literals join, because both are a single
 * `ast.Constant` next door; a `b"…"` prefix, an f-string, a name, a call and an
 * operator all leave something this cannot read, which is the same answer the
 * `isinstance(value, ast.Constant)` test gives them.
 */
function stringConstant(value: string): string | null {
  let rest = value.trim();
  while (rest.startsWith("(") && rest.endsWith(")")) {
    const inner = rest.slice(1, -1).trim();
    if (inner.length === 0) return null;
    rest = inner;
  }
  if (rest.length === 0) return null;
  let joined = "";
  while (rest.length > 0) {
    const literal = STRING_LITERAL.exec(rest);
    if (literal === null) return null;
    joined += literal[1] ?? literal[2] ?? literal[3] ?? literal[4] ?? "";
    rest = rest.slice(literal[0].length).trim();
  }
  return joined;
}

/**
 * One assignment statement: a single Name target, an optional annotation that
 * carries something (so a bare `NAME := …` walrus, which is no assignment
 * statement at all, is not read as one), and a value.
 *
 * The name is matched as python spells an identifier — `ast.Name` has no case
 * rule and no ASCII rule — rather than as `[A-Za-z_]\w*`, so a constant named
 * in another script declares here exactly as it declares next door.
 */
const CODE_DECLARATION =
  /^[ \t]*([\p{ID_Start}_][\p{ID_Continue}]*)[ \t]*(?::[ \t]*[^\s=][^=]*)?=(?!=)(.+)$/u;

/** A refusal code of this campaign's own shape, the only value read here. */
const CODE_VALUE = /^KS\d{3}$/;

/** A code's spelling anywhere in a statement's text, however it stands there. */
const CODE_SOMEWHERE = /KS\d{3}/;

/**
 * The heads of python's compound statements.
 *
 * A compound statement may carry its body on its own header line
 * (`if TYPE_CHECKING: NAME = "KS029"`), which the sibling's `ast` reads as an
 * ordinary declaration and this line reader cannot decompose — one of them,
 * `try: NAME = "KS029"`, was read as declaring the code under the name `try`,
 * which is a claim about another repo's file that nobody next door wrote.
 * A statement whose head is one of these and whose body stands on the same line
 * is therefore REFUSED rather than guessed at.
 *
 * `match` and `case` are python's soft keywords: they are legal constant names
 * too, so `match: Final = "KS029"` is refused here where `ast` reads it. That
 * over-reach is in the loud direction and it is the only one — refusing a shape
 * that could have been read costs a question to Ben; guessing at one costs a
 * false claim about a tree we do not own.
 */
const COMPOUND_HEADS = new Set([
  "if",
  "elif",
  "else",
  "for",
  "while",
  "with",
  "try",
  "except",
  "finally",
  "def",
  "class",
  "match",
  "case",
  "async",
]);

/**
 * Names no assignment statement can target next door, so a "declaration" this
 * reader believes it found under one of them is a misparse of something else
 * and never a declaration. The backstop under the rule above: it catches a
 * compound one-liner whose head this reader spelled some other way.
 */
const NEVER_A_TARGET = new Set([
  ...COMPOUND_HEADS,
  "and",
  "as",
  "assert",
  "await",
  "break",
  "continue",
  "del",
  "from",
  "global",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "yield",
  "None",
  "True",
  "False",
]);

/** The head word of a statement: the first identifier it stands on. */
function headWord(statement: string): string {
  return /^[ \t]*([\p{ID_Start}_][\p{ID_Continue}]*)/u.exec(statement)?.[1] ?? "";
}

/**
 * Whether a statement carries a compound statement's body on its header line —
 * the first `:` outside every bracket and string, with something after it.
 *
 * An annotation's colon is not a header colon, so `NAME: Final[str] = "KS029"`
 * is not this: the head word decides, and a name is not a compound head.
 */
function carriesInlineBody(statement: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    else if (character === ":" && depth === 0) return statement.slice(index + 1).trim().length > 0;
  }
  return false;
}

/**
 * The declarations of a PYTHON text, as code → the names it is held for, read
 * in the grammar the SIBLING'S OWN PARSER defines — admin-window/BUG-0220 —
 * beside every shape of the text this reader could not read (BUG-0225).
 *
 * One reader for both sides, deliberately: the sibling's registry and the
 * python block §1a asks Ben to paste into it are the same grammar, so "the same
 * meaning" is an equality of what each side SAYS rather than a resemblance
 * between two pieces of text. A code mentioned any other way — raised, pinned
 * in a list, quoted in prose — is not a declaration and does not appear here.
 *
 * The registry is the sibling's FILE, so what counts as a declaration in it is
 * the sibling's definition, and that definition is code next door rather than
 * prose: `_declared_by` / `code_declarations` in
 * `tests/live_safety/test_codes_named_once.py` blank the comments and take, off
 * the `ast`, an `Assign` OR an `AnnAssign` whose single target is a Name and
 * whose value is a string Constant. Every spelling of THAT declares here,
 * because every one of them declares there — this reader asking for a narrower
 * spelling (one line, bare `=`, double quotes, nothing after the closing quote)
 * is what turned `npm test` red for every builder over a typing pass next door
 * that changed no meaning, and what let a claim in the other quote through
 * silently. So: either quote and either triple quote, an `r`/`u` prefix, an
 * annotation, any indentation, a parenthesised or line-wrapped or
 * implicitly-concatenated value, a name in any script or case (an `ast.Name`
 * has neither rule), a trailing comment, a trailing semicolon or a second
 * statement after one, and any line ending — LF or CRLF.
 *
 * And what declares NOTHING there declares nothing here: a declaration parked
 * inside a comment or inside a string ("a declaration parked inside a comment
 * is invisible, one WEARING a comment is not", `code_declarations`' docstring),
 * a `==` comparison, a chained, tuple, attribute or subscript target, an
 * augmented assignment, an annotation with no value, a `b"…"` bytes literal or
 * an f-string — neither is a `str` Constant — and a code standing in a list, a
 * dict, a call, an expression or a name.
 *
 * Every form above, and every form below it in the grammar test, was put
 * through the sibling's own `code_declarations` before it was written down
 * (2026-09-11: 45 fixtures, 0 disagreements), and so was the registry as it
 * stands — 33 codes, same names, same reader.
 *
 * Two narrowings this reader keeps, both stated rather than hidden, because
 * neither can hide a claim on any code the comparison asks about:
 *
 *  - only a `KSnnn` value is collected, where the sibling's `names_a_code` also
 *    admits any five-character SQLSTATE. Every code `codeClaims` looks up is a
 *    `KSnnn`, so a wider value set would add no answer;
 *  - an escape sequence is not decoded, so `"KS\x30\x32\x39"` declares nothing
 *    here and `KS029` there. The registry's entries are plain literals, and a
 *    five-character code has nothing to escape. It is also what makes the
 *    refusals below SOUND: a declaration whose value is a `KSnnn` literal
 *    always spells that code in the statement's own text, so a statement
 *    carrying no `KSnnn` at all can hide no declaration worth refusing over.
 *
 * **This reader reads python, not prose.** A markdown note is not a module —
 * `readNoteDeclarations` reads a note's `python` blocks and leaves its prose
 * alone, which is where an unbalanced bracket in an English sentence belongs.
 */
export function readPythonDeclarations(
  source: string,
  text: string,
): Reading<Map<string, string[]>> {
  const scan = pythonStatements(source, text);
  const declared = new Map<string, string[]>();
  const unreadable = [...scan.unreadable];

  for (const statement of scan.answer) {
    const head = headWord(statement.text);
    if (
      COMPOUND_HEADS.has(head) &&
      carriesInlineBody(statement.text) &&
      CODE_SOMEWHERE.test(statement.text)
    ) {
      unreadable.push(
        `${source}:${statement.line}: a compound statement carrying its body on its own ` +
          `header line, beside a code — this reader reads one statement to a line ` +
          `(\`${statement.text.trim().slice(0, 80)}\`)`,
      );
      continue;
    }
    const assignment = CODE_DECLARATION.exec(statement.text);
    if (assignment === null) continue;
    const code = stringConstant(assignment[2]);
    if (code === null || !CODE_VALUE.test(code)) continue;
    if (NEVER_A_TARGET.has(assignment[1])) {
      // Nothing next door can assign to a keyword, so this is a misparse of
      // some other statement and never a declaration to report as one.
      unreadable.push(
        `${source}:${statement.line}: read \`${assignment[1]}\` as the name of ${code}, which ` +
          `python never assigns to — the statement is something this reader cannot decompose`,
      );
      continue;
    }
    const names = declared.get(code) ?? [];
    if (!names.includes(assignment[1])) names.push(assignment[1]);
    declared.set(code, names);
  }

  return { answer: declared, unreadable };
}

/**
 * The declarations of a python text, or a THROW naming what could not be read.
 *
 * The convenience over `readPythonDeclarations` for the many callers that have
 * nothing to do but fail: there is deliberately no way to get a partial map out
 * of this reader by accident.
 */
export function declaredCodeNames(text: string, source = "a python text"): Map<string, string[]> {
  return readOrRefuse(readPythonDeclarations(source, text), `the declarations of ${source}`);
}

/** One side's declarations: code → the meanings that side holds it for. */
export type CodeDeclarations = ReadonlyMap<string, readonly string[]>;

/**
 * The declarations a markdown NOTE makes: the `python` blocks it carries, each
 * read as the python source it is, and its prose left alone.
 *
 * A note is not a module. Reading one as though it were is how an English
 * sentence's unbalanced bracket reached a python scan at all — and the fix for
 * that, a bracket depth reset on every blank line, is what INVENTED a
 * declaration out of a bracketed list (admin-window/BUG-0225). What §1a asks
 * Ben to paste is a fenced `python` block, which is also how
 * `tests/offline/handoff/settle-review-item.test.ts` has always found it, so
 * this narrows the reader to the only part of a note that is ever pasted next
 * door.
 */
export function readNoteDeclarations(
  source: string,
  markdown: string,
): Reading<Map<string, string[]>> {
  const declared = new Map<string, string[]>();
  const unreadable: string[] = [];
  const blocks = fencedBlocks(markdown).filter((block) => block.info.toLowerCase() === "python");
  blocks.forEach((block, index) => {
    const reading = readPythonDeclarations(`${source} python block ${index + 1}`, block.text);
    unreadable.push(...reading.unreadable);
    for (const [code, names] of reading.answer) {
      const held = declared.get(code) ?? [];
      for (const name of names) if (!held.includes(name)) held.push(name);
      declared.set(code, held);
    }
  });
  return { answer: declared, unreadable };
}

/**
 * What THIS CAMPAIGN declares its codes to mean — read off the notes that
 * install a file next door, so the answer moves with the notes and no list here
 * can go stale. Throws rather than answering from a note it could not read.
 */
export function declaredByThisCampaign(): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  for (const handoff of installedHandoffNotes()) {
    const reading = readNoteDeclarations(`${HANDOFF_DIR}/${handoff.note}`, handoff.text);
    for (const [code, names] of readOrRefuse(
      reading,
      `what this campaign declares in ${handoff.note}`,
    )) {
      const held = declared.get(code) ?? [];
      for (const name of names) if (!held.includes(name)) held.push(name);
      declared.set(code, held);
    }
  }
  return declared;
}

/**
 * Every claim on one of `allocated` that the OTHER side's declarations carry —
 * EMPTY when nothing next door holds one of our numbers for anything but the
 * meaning our own notes declare for it.
 *
 * Findings are sentences rather than a bare `false`, and each one names the
 * declaration it was read from, because "KS029 is taken" without both meanings
 * beside it is not something a reader can act on.
 */
export function codeClaims(args: {
  readonly allocated: readonly string[];
  readonly ours: CodeDeclarations;
  readonly theirs: CodeDeclarations;
  /** Code → the sibling files that RAISE it, when the tree was read. */
  readonly raisedIn?: ReadonlyMap<string, readonly string[]>;
  /** The registry the `theirs` declarations were read from, for the message. */
  readonly registry?: string;
  /**
   * Whatever the readings behind `theirs` and `raisedIn` could not read
   * (`Reading.unreadable`), when the caller chose to report rather than throw.
   *
   * A comparison against an input that was only half read is not a clean
   * comparison, so every one of these is a finding of its own and the codes
   * below are not answered at all: an absent declaration and a missed one look
   * identical from here, which is the whole of BUG-0225's bar.
   */
  readonly unreadable?: readonly string[];
}): string[] {
  const registry = args.registry ?? SIBLING_REGISTRY;
  const findings: string[] = [];
  if (args.unreadable !== undefined && args.unreadable.length > 0) {
    return args.unreadable.map(
      (shape) => `the sibling's declarations were not read, so no code was compared: ${shape}`,
    );
  }
  for (const code of [...args.allocated].sort()) {
    const ours = args.ours.get(code) ?? [];
    // Our own half is never assumed: a code this campaign allocates and names
    // nowhere would otherwise make every comparison vacuously clean.
    if (ours.length === 0) {
      findings.push(`${code}: no handoff note of this campaign declares a meaning for it`);
      continue;
    }
    const theirs = args.theirs.get(code) ?? [];
    if (theirs.length === 0) {
      const raised = [...(args.raisedIn?.get(code) ?? [])].sort();
      if (raised.length > 0) {
        findings.push(
          `${code}: raised next door in ${raised.join(", ")}, and ${registry} declares no meaning ` +
            `for it (we declare ${ours.join(", ")})`,
        );
      }
      continue;
    }
    if ([...theirs].sort().join(",") === [...ours].sort().join(",")) continue;
    findings.push(
      `${code}: we declare ${ours.join(", ")}, ${registry} declares ${theirs.join(", ")}`,
    );
  }
  return findings;
}
