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
 * The declarations of `text`, as code → the names it is held for, read in the
 * grammar the SIBLING'S OWN PARSER defines — admin-window/BUG-0220.
 *
 * One reader for both sides, deliberately: the sibling's registry and §1a's
 * paste are the same grammar, so "the same meaning" is an equality of what each
 * side SAYS rather than a resemblance between two pieces of text. A code
 * mentioned any other way — raised, pinned in a list, quoted in prose — is not
 * a declaration and does not appear here at all.
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
 * implicitly-concatenated value, a name in any case (an `ast.Name` has no case
 * rule), a trailing comment, a trailing semicolon or a second statement after
 * one.
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
 * stands — 32 codes, same names, same reader.
 *
 * Two narrowings this reader keeps, both stated rather than hidden, because
 * neither can hide a claim on any code the comparison asks about:
 *
 *  - only a `KSnnn` value is collected, where the sibling's `names_a_code` also
 *    admits any five-character SQLSTATE. Every code `codeClaims` looks up is a
 *    `KSnnn`, so a wider value set would add no answer — and asking it of a
 *    markdown note would invent declarations out of prose;
 *  - an escape sequence is not decoded, so `"KS\x30\x32\x39"` declares nothing
 *    here and `KS029` there. The registry's 32 entries are plain literals, and
 *    a five-character code has nothing to escape.
 *
 * It reads markdown as readily as python, because §1a's paste is markdown until
 * Ben pastes it: the blanking below is the sibling's `blank_comments` done as a
 * scan rather than as a tokenizer, so it is the text's own quotes — not a
 * python tokenizer — that decide where a `#` stops being a comment. A markdown
 * note is not a module, so a bracket left open in prose joins the lines after it
 * rather than failing the whole text the way `ast.parse` would; the join is
 * dropped at a blank line, which keeps that local to its own paragraph. A join
 * can only take a declaration away, never invent one, because a declaration is
 * read from the START of what it stands on.
 */
function pythonCode(text: string): string {
  const blanked: string[] = [];
  let index = 0;
  // The delimiter of the triple-quoted string being skipped, if any: its body
  // is data, so a declaration written inside it declares nothing.
  let triple: string | null = null;
  // The quote of the one-line string literal being kept verbatim, if any. A
  // python string literal cannot cross a line break, so the line ends it.
  let quote: string | null = null;
  // Open brackets, so a value wrapped across lines is read as the one logical
  // line it is next door.
  let depth = 0;
  let blankLine = true;
  while (index < text.length) {
    const character = text[index];
    if (triple !== null) {
      if (text.startsWith(triple, index)) {
        blanked.push("   ");
        triple = null;
        index += 3;
        continue;
      }
      // Blank, never delete: the body's own line breaks stay (blank_comments'
      // reason), so what follows a docstring still stands at a line's start.
      blanked.push(character === "\n" ? "\n" : " ");
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === "\\" && index + 1 < text.length) {
        blanked.push(text.slice(index, index + 2));
        index += 2;
        continue;
      }
      if (character === quote || character === "\n") quote = null;
      blanked.push(character);
      index += 1;
      continue;
    }
    if (character === "\n") {
      // A line break inside brackets, or one a backslash continues, is not a
      // statement boundary; a blank line ends any bracket a prose paragraph
      // left open, since this text may be a markdown note and not a module.
      const joins = depth > 0 || blanked[blanked.length - 1] === "\\";
      if (blanked[blanked.length - 1] === "\\") blanked.pop();
      if (blankLine) depth = 0;
      blanked.push(joins && !blankLine ? " " : "\n");
      blankLine = true;
      index += 1;
      continue;
    }
    if (character !== " " && character !== "\t" && character !== "\r") blankLine = false;
    if (text.startsWith('"""', index) || text.startsWith("'''", index)) {
      const delimiter = text.slice(index, index + 3);
      const closes = text.indexOf(delimiter, index + 3);
      const ends = text.indexOf("\n", index);
      // A triple-quoted literal opened and closed on one line is a value a
      // declaration can carry, so it is kept; one that runs on is a body.
      if (closes !== -1 && (ends === -1 || closes < ends)) {
        blanked.push(text.slice(index, closes + 3));
        index = closes + 3;
        continue;
      }
      triple = delimiter;
      blanked.push("   ");
      index += 3;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      blanked.push(character);
      index += 1;
      continue;
    }
    if (character === "#") {
      const ends = text.indexOf("\n", index);
      const stops = ends === -1 ? text.length : ends;
      blanked.push(" ".repeat(stops - index));
      index = stops;
      continue;
    }
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    blanked.push(character);
    index += 1;
  }
  return blanked.join("");
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
 */
const CODE_DECLARATION = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?::[ \t]*[^\s=][^=]*)?=(?!=)(.+)$/;

/** A refusal code of this campaign's own shape, the only value read here. */
const CODE_VALUE = /^KS\d{3}$/;

export function declaredCodeNames(text: string): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  // A statement ends at a line break or a semicolon, as it does next door.
  for (const statement of pythonCode(text).split(/[\n;]/)) {
    const assignment = CODE_DECLARATION.exec(statement);
    if (assignment === null) continue;
    const code = stringConstant(assignment[2]);
    if (code === null || !CODE_VALUE.test(code)) continue;
    const names = declared.get(code) ?? [];
    if (!names.includes(assignment[1])) names.push(assignment[1]);
    declared.set(code, names);
  }
  return declared;
}

/** One side's declarations: code → the meanings that side holds it for. */
export type CodeDeclarations = ReadonlyMap<string, readonly string[]>;

/**
 * What THIS CAMPAIGN declares its codes to mean — read off the notes that
 * install a file next door, so the answer moves with the notes and no list here
 * can go stale.
 */
export function declaredByThisCampaign(): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  for (const handoff of installedHandoffNotes()) {
    for (const [code, names] of declaredCodeNames(handoff.text)) {
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
}): string[] {
  const registry = args.registry ?? SIBLING_REGISTRY;
  const findings: string[] = [];
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
