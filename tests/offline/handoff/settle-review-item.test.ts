import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_SOURCE,
  DECISION_KEYS,
  DECISION_VALUE_KEYS,
  VERDICT_ACTIONS,
} from "@/lib/verdict/decision";
import { SETTLE_ARGUMENT } from "@/lib/db/verdict";
import {
  alterTableTargets,
  blockBalance,
  dollarQuoteMarks,
  fencedBlocks,
  forbiddenConstructs,
  HANDOFF_DIR,
  privilegesHeld,
  readHandoffNote,
  ROLES_BORN_HOLDING_ALL,
  sqlArtifactOf,
  sqlBlocks,
  tableAclAfter,
  TABLE_PRIVILEGES,
  type SqlArtifact,
} from "./extract";
import { repoRoot } from "../source-tree";

/**
 * The `settle_review_item` handoff artifact — campaign admin-window/TASK-0046.
 *
 * `agenticflow/tracker/for-human/M2-handoff-settle-review-item.md` carries the
 * second of M2's two migrations, and like the first NOBODY HERE INSTALLS IT:
 * Ben pastes it into `kspace Scraper/supabase/migrations/` and applies it with
 * `supabase db push` from that repo (DECISIONS 2026-09-08). No compiler, no
 * database and no `db push` sees it before he does, so this file is the whole of
 * what stands between an authoring slip and a debugging session in a repo this
 * campaign may not enter.
 *
 * It is the higher-risk of the two, because four separate spellings have to
 * agree with code that lives here and cannot see it:
 *
 *  - the **argument name**, which PostgREST resolves an RPC by. Spell it wrong
 *    and an installed function answers `PGRST202` — the same code an absent one
 *    answers — so it renders as permanently and silently absent. Asserted
 *    against `SETTLE_ARGUMENT` (`src/lib/db/verdict.ts`), the app's one
 *    spelling (QA on admin-window/TASK-0048, measured: with that constant
 *    sabotaged the whole offline suite stayed green).
 *  - the **eight action names**, against `VERDICT_ACTIONS`;
 *  - the **decision key sets**, against `DECISION_KEYS` and
 *    `DECISION_VALUE_KEYS`, which are `Object.keys` of a
 *    `Record<keyof VerdictDecision, true>` and so are the interface itself
 *    rather than a list someone copied;
 *  - the **admin source name**, against `ADMIN_SOURCE` — spelled twice in the
 *    SQL (the registration insert of §1 and the function's own constant) and
 *    pinned in both places.
 *
 * Everything else it grades is a property of the artifact alone: exactly one
 * writer of `verdicts` and one setter of `review_items.status`; the `wont_fix`
 * raise keyed on a note that is null OR blank; the idempotent `sources` insert;
 * one transaction (no `commit`, no `dblink`, no autonomous-transaction
 * construct, balanced `$$` and `begin`/`end`); no table's ACL touched; and the
 * EXECUTE the revoke pair leaves each role holding.
 *
 * **Two fixtures for every rule** (LESSONS 3). One grader, `gradeSettle`, is run
 * on the shipped block — which must report nothing — and on doctored copies it
 * must flag, plus the other half of the lesson: copies that only TALK about the
 * banned constructs, in a comment and in a string literal, which must grade
 * clean.
 *
 * **One thing to know before editing the artifact's prose.** The shared reader
 * keeps a dollar-quoted body VERBATIM — comments and literals included — because
 * that body is exactly where a `commit` would be a real commit and where the
 * `begin`/`end` balance lives. So the two fixtures that must grade clean put
 * their banned words in a comment and a literal OUTSIDE `$$ … $$`, and a word
 * like `commit`, `case` or `end` written into a comment INSIDE the body is read
 * as the construct it spells. That is the reader working as designed, and it is
 * why the body's own comments are worded around those words.
 *
 * **The ACL is graded as what gets INSTALLED, not as the lines written**
 * (admin-window/BUG-0082, admin-window/BUG-0084). Two questions, because this
 * artifact is a function and not a table:
 *
 *  - it must leave every TABLE's ACL exactly as it found it — asked through the
 *    shared replay (`tableAclAfter`), so a `grant insert on public.verdicts`
 *    smuggled in here, undoing the other artifact's narrowing, is caught;
 *  - and the FUNCTION's own EXECUTE, replayed by `functionExecuteAfter` below
 *    from what a new function on this project is BORN holding — `public`,
 *    `anon`, `authenticated` and `service_role` all hold EXECUTE, granted by an
 *    `ALTER DEFAULT PRIVILEGES` nobody wrote (measured on staging 2026-09-01,
 *    recorded in the sibling's
 *    `20260901000006_the_stamp_the_bill_and_the_link_get_their_arms.sql`). So
 *    the `grant execute … to service_role` narrows NOTHING and the revoke
 *    beside it is the whole of the posture, exactly as on the table side.
 */

const NOTE = "M2-handoff-settle-review-item.md";
const noteText = readHandoffNote(NOTE);
const shipped = sqlArtifactOf(noteText);

/** The target file Ben creates in the sibling, and the command he runs there. */
const TARGET_PATH = "supabase/migrations/20260908000002_the_verdict_settles_the_item.sql";
const APPLY_COMMAND = "supabase db push";

/** The function this artifact installs, and the tables it may not re-grant. */
const FUNCTION = "public.settle_review_item";
const TABLES = [
  "public.verdicts",
  "public.review_items",
  "public.observations",
  "public.confirmed_matches",
  "public.sources",
];

/**
 * Roles a newly created function on this project is BORN holding EXECUTE for.
 *
 * Not the same set as a table's (`ROLES_BORN_HOLDING_ALL`): `public` is in it,
 * which is why a revoke naming only the three named roles would still leave the
 * door open to every role in the cluster. The sibling's own migration header
 * states this, having measured it.
 */
const ROLES_BORN_HOLDING_EXECUTE = ["public", "anon", "authenticated", "service_role"];

/**
 * The sibling checkout on this machine, spelled ONCE and read ONLY.
 *
 * It is not a package and it is never imported: a relative import from a test
 * resolves inside whichever git worktree the suite is running from, so it would
 * reach the wrong tree or nothing at all. An absolute path reaches the one
 * checkout that exists, wherever this suite runs — and reaching it is a read of
 * three constants' worth of text, never a write, never an import, never a
 * network call, so the offline suite stays offline.
 */
const SIBLING_ROOT = "/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper";

/**
 * Every KS code in use next door on 2026-09-08, across BOTH of the sibling's
 * SQL worlds: `supabase/migrations/` (KS001–KS026) and the staging harness
 * doors of `tools/staging/` (KS027, KS028) — the set `tests/helpers/ks_codes.py`
 * names one meaning each and `test_codes_named_once.py` pins.
 *
 * A dated snapshot, deliberately: it is the floor this suite holds on a machine
 * where the sibling is not checked out at all. The live scan below is what
 * keeps it honest.
 */
const TAKEN_NEXT_DOOR = Array.from(
  { length: 28 },
  (_, index) => `KS${String(index + 1).padStart(3, "0")}`,
);

/**
 * The codes the note DECLARES it allocates, read off §3's citation row rather
 * than hardcoded anywhere, so a renumber of the artifact moves every check that
 * asks about allocation with the file itself.
 */
function allocatedCodes(): string[] {
  const row = /\|([^|]*)\|[^|]*SQLSTATEs this file allocates/.exec(noteText);
  if (row === null) return [];
  return [...row[1].matchAll(/KS\d{3}/g)].map((match) => match[0]);
}


/** Whether that checkout is on this machine at all; the scan runs only if so. */
const SIBLING_PRESENT = fs.existsSync(SIBLING_ROOT);

/**
 * Names the sibling scan neither descends into nor opens.
 *
 * Dot-prefixed names are skipped WHOLE, and the load-bearing reason is a single
 * file: the sibling's repo-root `.env`. Nothing in this campaign opens one, not
 * even to count `KS` codes in it, because a transcript that touches a secrets
 * file is the wrong habit whatever it extracted. The dot skip also drops the
 * derived caches (`.venv`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`),
 * whose contents are copies of the `.py` files this walk reads anyway; the two
 * named directories are vendored code and another factory's tracker.
 */
const UNSCANNED_NEXT_DOOR = new Set(["node_modules", "agenticflow", "__pycache__"]);

/**
 * Every `KSnnn` spelled anywhere under `root`, read as text, WITH the files
 * that spell it.
 *
 * Deliberately broader than "raised": a code the sibling merely NAMES in
 * `tests/helpers/ks_codes.py`, pins in a witness or writes into a receipt is
 * still a code with a meaning, and allocating it here would give it a second
 * one. A path that vanishes or refuses to read is skipped rather than thrown
 * on — which would make an empty result a silent pass, so the caller asserts a
 * code it MUST find before it trusts an absence.
 *
 * The files come back too (admin-window/BUG-0207): "is this code spelled next
 * door" stopped being the whole question on the day Ben installed THIS
 * campaign's own handoff next door, because our artifact spells the four codes
 * it allocates. WHICH file spells a code is what tells our own installed
 * artifact from a stranger's claim on the same number.
 */
function ksCodeSpellingsUnder(root: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || UNSCANNED_NEXT_DOOR.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      let text: string;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      for (const code of new Set([...text.matchAll(/KS\d{3}/g)].map((match) => match[0]))) {
        const spellers = found.get(code) ?? [];
        spellers.push(full);
        found.set(code, spellers);
      }
    }
  }
  return found;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Telling our own installed handoff from a stranger's claim — admin-window/BUG-0207.
 *
 * The scan above asks the sibling what codes its tree holds. Until 2026-09-11
 * that answer was entirely about the sibling: anything it spelled, it meant.
 * Then Ben installed this campaign's two handoff artifacts into that tree —
 * `20260908000002_the_verdict_settles_the_item.sql` and §1a's four entries in
 * `tests/helpers/ks_codes.py` / `tests/live_safety/test_codes_named_once.py` —
 * and the guard reported `KS029`–`KS032` "already taken next door" against the
 * file that allocates them. The campaign's satisfaction condition being met is
 * what turned the suite red; that is the bug.
 *
 * What the guard must still stop is unchanged: allocating a number the sibling
 * already means something else by. So a spelling next door is ours when it sits
 * INSIDE a verbatim copy of one of this campaign's paste BLOCKS — a fenced
 * block of a qualifying note, matched as a contiguous run of lines. Both
 * installed halves pass that test for the honest reason: the migration IS the
 * note's one fenced sql block (its file on disk is that block plus a trailing
 * newline, measured 2026-09-11), and the registry entries ARE §1a's two python
 * blocks, pasted.
 *
 * **Why the block and not the line** (admin-window/BUG-0212, QA on this
 * ticket). The first fix attributed any line the notes carried verbatim, and
 * next door a SQLSTATE is raised on a line of its own — `using errcode =
 * 'KSnnn',`, the grammar of every KS raise in that repo (QA counted 22 for
 * `KS024`, 20 for our own `KS029`, over `supabase/migrations` and
 * `tools/staging`). Our note carries that line for each code it allocates, so a
 * LATER sibling migration raising one of the four for a meaning of its own
 * wrote a line the corpus already held and passed SILENTLY. A one-line idiom is
 * not an identity; 776 lines of it in order are. The same narrowing makes the
 * re-point case honest: a rewrite of our own installed file that re-points a
 * code no longer matches the block it came from, and is flagged.
 *
 * Path-based attribution was the other obvious alternative and is weaker
 * still: it would clear whatever came to sit at the target path.
 */

/** The `target file` row of a for-human note, when it names a sibling migration. */
const INSTALLED_TARGET_ROW = /\|\s*target file\s*\|\s*`[^`]*?(supabase\/migrations\/[^`]+)`/;

/**
 * This campaign's installed handoff artifacts: every note under
 * `agenticflow/tracker/for-human/` that declares a `target file` inside the
 * sibling's `supabase/migrations/`. Derived from the notes themselves rather
 * than listed here, so a fourth handoff is covered the day it is written and
 * no list can go stale in silence.
 */
function installedHandoffNotes(): { note: string; target: string; text: string }[] {
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
 * The blocks this campaign asks Ben to paste next door, as trimmed lines: every
 * fenced block of a qualifying note that spells one of `codes`. A block that
 * spells none of them attributes nothing and is left out.
 */
function handoffBlocks(codes: readonly string[]): string[][] {
  if (codes.length === 0) return [];
  const spelled = new RegExp(codes.join("|"));
  return installedHandoffNotes()
    .flatMap((handoff) => fencedBlocks(handoff.text))
    .map((block) => block.text.split("\n").map((line) => line.trim()))
    .filter((lines) => lines.some((line) => spelled.test(line)));
}

/** The paste blocks that spell one of this artifact's own four codes. */
const HANDOFF_BLOCKS: readonly string[][] = handoffBlocks(allocatedCodes());

/** The indices of `lines` covered by a verbatim, contiguous occurrence of `block`. */
function coveredBy(lines: readonly string[], block: readonly string[]): Set<number> {
  const covered = new Set<number>();
  if (block.length === 0 || block.length > lines.length) return covered;
  for (let start = 0; start + block.length <= lines.length; start += 1) {
    let hit = true;
    for (let offset = 0; offset < block.length && hit; offset += 1) {
      hit = lines[start + offset] === block[offset];
    }
    if (!hit) continue;
    for (let offset = 0; offset < block.length; offset += 1) covered.add(start + offset);
  }
  return covered;
}

/**
 * The lines of `text` that spell one of `codes` from OUTSIDE every paste block
 * of this campaign — the spellings next door that are not ours.
 *
 * Empty means every spelling in that file arrived inside a verbatim copy of
 * something one of our notes tells Ben to paste. A non-empty answer is the
 * collision the guard exists to catch, and it comes back as the offending lines
 * rather than as a bare `false`, so the failure names what to look at.
 */
function unattributedSpellings(
  text: string,
  codes: readonly string[],
  blocks: readonly string[][] = HANDOFF_BLOCKS,
): string[] {
  if (codes.length === 0) return [];
  const spelled = new RegExp(codes.join("|"));
  const lines = text.split("\n").map((line) => line.trim());
  const covered = new Set<number>();
  for (const block of blocks) for (const index of coveredBy(lines, block)) covered.add(index);
  return lines.filter((line, index) => spelled.test(line) && !covered.has(index));
}

/* ── reading the artifact ─────────────────────────────────────────────────── */

/** Statements of the artifact whose first word is `verb`, whitespace-flattened. */
function statementsStartingWith(artifact: SqlArtifact, verb: string): string[] {
  return artifact.statements
    .map((statement) => statement.replace(/\s+/g, " ").toLowerCase())
    .filter((statement) => statement.startsWith(verb));
}

/**
 * The parameter name the artifact DECLARES — the one PostgREST resolves by.
 *
 * Read off the `create function` header rather than off any of the four other
 * places the signature is spelled (`alter function`, `comment on`, the revoke,
 * the grant): those name the argument for Postgres' benefit and a divergence
 * there is a syntax error at install, while a divergence in the header is the
 * silent one.
 */
function declaredArgument(artifact: SqlArtifact): string | null {
  const header = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${FUNCTION.replace(".", "\\.")}\\s*\\(\\s*([a-z_][a-z0-9_]*)\\s+jsonb\\s*\\)`,
  );
  const match = header.exec(artifact.scan);
  return match === null ? null : match[1];
}

/**
 * The string literals of an `array[…]` assigned to a declared constant — how
 * the function's own key and action lists are read back out.
 */
function constantArray(artifact: SqlArtifact, name: string): string[] | null {
  const declaration = new RegExp(`\\b${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`);
  const match = declaration.exec(artifact.code);
  if (match === null) return null;
  return [...match[1].matchAll(/'([^']*)'/g)].map((literal) => literal[1]);
}

/** Every `errcode = '…'` the artifact raises with. */
function errcodes(artifact: SqlArtifact): string[] {
  return [...artifact.code.matchAll(/errcode\s*=\s*'([^']*)'/g)].map((match) => match[1]);
}

/**
 * The text of the `wont_fix` guard: from where the action is named to the
 * errcode its raise carries. Read as CODE (literals intact), because the
 * blankness test is itself a literal.
 */
function wontFixGuard(artifact: SqlArtifact): string | null {
  const guard = /'wont_fix'([\s\S]{0,600}?)errcode\s*=\s*'KS\d+'/.exec(artifact.code);
  return guard === null ? null : guard[1];
}

/**
 * The WHERE clause of the read that ADOPTS a claimed value — the
 * `choose_claimed_value` arm's `select claim.value into v_claim`. Read as CODE
 * (literals intact), because the binding this asks about is a predicate.
 */
function adoptedClaimGuard(artifact: SqlArtifact): string | null {
  const read =
    /select\s+claim\.value\s+into\s+v_claim\s+from\s+public\.observations\s+as\s+claim\s+where([\s\S]*?);/.exec(
      artifact.code,
    );
  return read === null ? null : read[1];
}

/**
 * The refusal that guards the adoption read: the text between `v_claim is null`
 * and the errcode its raise carries, plus that code (admin-window/BUG-0088).
 * Read as CODE, because the message and its detail are literals.
 */
function adoptedClaimRefusal(
  artifact: SqlArtifact,
): { body: string; errcode: string | null } | null {
  // The WHOLE refusal, from the test to its `end if` — the message, the detail
  // and the hint alike, because what a reader needs in order to act is spread
  // across all three.
  const refusal = /if\s+v_claim\s+is\s+null\s+then([\s\S]*?)end\s+if\s*;/.exec(artifact.code);
  if (refusal === null) return null;
  const raised = /errcode\s*=\s*'(KS\d+)'/.exec(refusal[1]);
  return { body: refusal[1], errcode: raised === null ? null : raised[1] };
}

/** How many times the artifact's code matches `pattern`. */
function occurrences(artifact: SqlArtifact, pattern: RegExp): number {
  return (artifact.scan.match(pattern) ?? []).length;
}

/* ── the function's own EXECUTE, replayed ─────────────────────────────────── */

interface ExecuteAcl {
  /** Role name → does it hold EXECUTE by a grant to that name. */
  readonly held: ReadonlyMap<string, boolean>;
  /** The role that owns the function once the artifact has applied. */
  readonly owner: string;
  /** Privilege statements naming this function that this reader would not model. */
  readonly unreadable: readonly string[];
}

const FUNCTION_PRIVILEGE =
  /^(grant|revoke)\s+(.+?)\s+on\s+function\s+([a-z0-9_.]+)\s*\(([^)]*)\)\s+(?:to|from)\s+(.+)$/;
const FUNCTION_OWNER = /^alter\s+function\s+([a-z0-9_.]+)\s*\([^)]*\)\s+owner\s+to\s+(.+)$/;
const ROLE_NAME = /^"?([a-z_][a-z0-9_$]*)"?$/;

/**
 * Replay the artifact's function-privilege statements onto what a new function
 * on this project is born with, and report who is left holding EXECUTE.
 *
 * A near-twin of `tableAclAfter` in `extract.ts`, which models TABLE privileges
 * and reports `execute` as an unknown privilege word. Kept local because this
 * is the only artifact of the two that installs a function; if a third one
 * does, this belongs beside its sibling in `extract.ts` rather than copied.
 */
function functionExecuteAfter(artifact: SqlArtifact, qualified: string): ExecuteAcl {
  const held = new Map<string, boolean>();
  for (const role of ROLES_BORN_HOLDING_EXECUTE) held.set(role, true);
  const unreadable: string[] = [];
  let owner = "postgres";

  for (const raw of artifact.statements) {
    const statement = raw.replace(/\s+/g, " ").trim();
    const flat = statement.toLowerCase();

    const owned = FUNCTION_OWNER.exec(flat);
    if (owned !== null) {
      if (owned[1] !== qualified) continue;
      const named = ROLE_NAME.exec(owned[2].trim());
      if (named === null) unreadable.push(statement);
      else owner = named[1];
      continue;
    }

    const parsed = FUNCTION_PRIVILEGE.exec(flat);
    if (parsed === null) continue;
    const [, verb, privilegeText, object, , roleText] = parsed;
    if (object !== qualified) continue;

    // `all`, `all privileges` and `execute` are the whole vocabulary a function
    // grant has here; anything else — a `grant option for`, a word this reader
    // does not know — is reported rather than skipped, because silently
    // skipping the statement you cannot read is how a grader certifies an ACL
    // it never read (admin-window/BUG-0082).
    if (!/^(all(\s+privileges)?|execute)$/.test(privilegeText.trim())) {
      unreadable.push(statement);
      continue;
    }
    const tail = roleText.replace(/\s+(cascade|restrict)\s*$/, "").trim();
    if (/\bgranted\s+by\b/.test(tail) || /\bwith\s+grant\s+option\b/.test(tail)) {
      unreadable.push(statement);
      continue;
    }
    const roles = tail.split(",").map((entry) => ROLE_NAME.exec(entry.trim()));
    if (roles.some((role) => role === null)) {
      unreadable.push(statement);
      continue;
    }
    for (const role of roles) held.set(role![1], verb === "grant");
  }

  return { held, owner, unreadable };
}

/**
 * Does one role end up able to CALL the function — its own grant, plus the two
 * reaches that are not grants to its name: everything if it owns the function,
 * and whatever PUBLIC holds, since every role is a member of PUBLIC
 * (admin-window/BUG-0084's fold, for the function side).
 */
function mayExecute(acl: ExecuteAcl, role: string): boolean {
  if (role === acl.owner) return true;
  return (acl.held.get(role) ?? false) || (acl.held.get("public") ?? false);
}

/* ── the grader ───────────────────────────────────────────────────────────── */

/**
 * Every reason this artifact must not be handed to Ben, as named findings —
 * EMPTY for the shipped block. One grader, so the doctored fixtures are graded
 * by exactly the instrument the shipped block is.
 */
function gradeSettle(artifact: SqlArtifact): string[] {
  const findings: string[] = [...forbiddenConstructs(artifact.scan)];

  if (dollarQuoteMarks(artifact.code) % 2 !== 0) findings.push("unbalanced_dollar_quotes");
  const balance = blockBalance(artifact.scan);
  if (balance.openers !== balance.closers) findings.push("unbalanced_blocks");

  // Nothing vetted is altered and nothing is created but the function: the two
  // schema objects this campaign adds are the companion artifact's table and
  // this file's function, and a `create table` here would be a third.
  for (const target of alterTableTargets(artifact.scan)) findings.push(`alter_table:${target}`);
  for (const verb of ["create table", "create index", "create view", "drop", "truncate"]) {
    for (const statement of statementsStartingWith(artifact, verb)) {
      findings.push(`foreign_ddl:${statement.slice(0, 40)}`);
    }
  }

  // ── the function ──────────────────────────────────────────────────────────
  const created = statementsStartingWith(artifact, "create").filter((statement) =>
    /\bfunction\b/.test(statement),
  );
  if (created.length !== 1) findings.push(`function_count:${created.length}`);

  const argument = declaredArgument(artifact);
  if (argument === null) findings.push("no_function_header");
  else if (argument !== SETTLE_ARGUMENT) findings.push(`argument_name:${argument}`);

  if (!/\blanguage\s+plpgsql\b/.test(artifact.scan)) findings.push("not_plpgsql");
  if (!/\bsecurity\s+definer\b/.test(artifact.scan)) findings.push("not_security_definer");
  if (!/\bset\s+search_path\s+to\s+''/.test(artifact.scan)) findings.push("search_path_open");

  // ── the four spellings that must agree with this repo ─────────────────────
  const actions = constantArray(artifact, "c_actions");
  if (actions === null) findings.push("no_action_list");
  else if ([...actions].sort().join(",") !== [...VERDICT_ACTIONS].sort().join(",")) {
    findings.push(`action_set:${actions.join(",")}`);
  }

  const decisionKeys = constantArray(artifact, "c_decision_keys");
  if (decisionKeys === null) findings.push("no_decision_keys");
  else if ([...decisionKeys].sort().join(",") !== [...DECISION_KEYS].sort().join(",")) {
    findings.push(`decision_keys:${decisionKeys.join(",")}`);
  }

  const valueKeys = constantArray(artifact, "c_value_keys");
  if (valueKeys === null) findings.push("no_value_keys");
  else if ([...valueKeys].sort().join(",") !== [...DECISION_VALUE_KEYS].sort().join(",")) {
    findings.push(`value_keys:${valueKeys.join(",")}`);
  }

  // Neither the schema version nor a source name arrives from Admin: the SQL
  // resolves both itself, so neither may be a key the function accepts.
  for (const key of [...(decisionKeys ?? []), ...(valueKeys ?? [])]) {
    if (/schema_version|^source$|^tier$|rejected_by/.test(key)) findings.push(`envelope_key:${key}`);
  }

  // ── the admin voice, in both places it is spelled ─────────────────────────
  const registration = statementsStartingWith(artifact, "insert");
  if (registration.length !== 1) findings.push(`top_level_inserts:${registration.length}`);
  const sourcesInsert = registration.find((statement) =>
    statement.startsWith("insert into public.sources"),
  );
  if (sourcesInsert === undefined) findings.push("sources_insert_missing");
  else {
    if (!/on conflict \(source\) do nothing/.test(sourcesInsert)) {
      findings.push("sources_insert_not_idempotent");
    }
    const named = [...sourcesInsert.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    if (named[0] !== ADMIN_SOURCE) findings.push(`source_literal:${named[0]}`);
  }

  const constant = /c_admin_source\s+constant\s+text\s*:=\s*'([^']*)'/.exec(artifact.code);
  if (constant === null) findings.push("no_source_constant");
  else if (constant[1] !== ADMIN_SOURCE) findings.push(`source_literal:${constant[1]}`);

  // ── one writer, one setter, one entry point ───────────────────────────────
  const verdictWrites = occurrences(artifact, /\binsert\s+into\s+public\.verdicts\b/g);
  if (verdictWrites !== 1) findings.push(`verdicts_inserts:${verdictWrites}`);
  const verdictOther = occurrences(artifact, /\b(?:update|delete\s+from)\s+public\.verdicts\b/g);
  if (verdictOther !== 0) findings.push(`verdicts_rewritten:${verdictOther}`);

  const statusSets = occurrences(
    artifact,
    /\bupdate\s+public\.review_items\b[^;]*?\bset\s+status\b/g,
  );
  if (statusSets !== 1) findings.push(`status_setters:${statusSets}`);

  if (occurrences(artifact, /\bpublic\.apply_resolution\s*\(/g) !== 1) {
    findings.push("apply_resolution_missing");
  }
  if (occurrences(artifact, /\bpublic\.ingest_observation\s*\(/g) !== 1) {
    findings.push("gate_missing");
  }

  // ── the adopted claim is one of the item's own (admin-window/BUG-0088) ────
  // Read by primary key alone this arm adopts ANY observation in the ledger and
  // re-asserts it admin-locked, which no later claim can displace. The read is
  // bound to the item's evidence AND to the fact the decision writes, and a
  // miss is refused in the file's own KS grammar rather than falling through.
  const adopted = adoptedClaimGuard(artifact);
  if (adopted === null) findings.push("no_adoption_read");
  else {
    if (!/claim\.observation_id\s*=\s*any\s*\(\s*v_item\.evidence\s*\)/.test(adopted)) {
      findings.push("adopted_claim_unbound:evidence");
    }
    for (const [part, pattern] of [
      ["domain", /claim\.domain\s*=\s*v_domain/],
      ["entity_id", /claim\.entity_id\s*=\s*v_entity_id/],
      ["field", /claim\.field\s*=\s*v_field/],
    ] as ReadonlyArray<readonly [string, RegExp]>) {
      if (!pattern.test(adopted)) findings.push(`adopted_claim_unbound:${part}`);
    }
  }

  const adoptionRefusal = adoptedClaimRefusal(artifact);
  if (adoptionRefusal === null) findings.push("adoption_miss_unrefused");
  else {
    if (adoptionRefusal.errcode === null) findings.push("adoption_refusal_uncoded");
    if (!/evidence/.test(adoptionRefusal.body)) findings.push("adoption_refusal_unnamed");
  }

  // ── the one refusal the contract names ────────────────────────────────────
  const guard = wontFixGuard(artifact);
  if (guard === null) findings.push("wont_fix_raise_missing");
  else {
    if (!/\bis\s+null\b/.test(guard)) findings.push("wont_fix_null_untested");
    // A present-but-blank note is the shape a form alone lets through, so the
    // guard has to test blankness and not merely absence.
    if (!/\[\[:space:\]\]|btrim|\btrim\s*\(|length\s*\(/.test(guard)) {
      findings.push("wont_fix_blank_untested");
    }
  }

  for (const code of errcodes(artifact)) {
    if (!/^KS\d{3}$/.test(code)) findings.push(`errcode:${code}`);
  }

  // ── the ACLs, as installed ────────────────────────────────────────────────
  for (const table of TABLES) {
    const acl = tableAclAfter(artifact, table);
    for (const statement of acl.unreadable) findings.push(`unreadable_privilege:${statement}`);
    if (acl.owner !== "postgres") findings.push(`table_owner:${table}:${acl.owner}`);
    // This artifact grants and revokes nothing on any table: the tables it
    // writes belong to migrations that already decided who may touch them, and
    // re-granting one here would silently widen a posture this file cannot see.
    for (const role of ROLES_BORN_HOLDING_ALL) {
      if (privilegesHeld(acl, role).length !== TABLE_PRIVILEGES.length) {
        findings.push(`table_privilege_touched:${table}:${role}`);
      }
    }
  }

  // Every privilege statement in this file names THIS FUNCTION. The replay
  // above answers "what is each role left holding", which on a table born
  // holding everything can only ever be narrowed — so a GRANT that widens a
  // table is invisible to it and has to be caught as a statement. Both
  // directions matter: a grant here would hand the service key a second write
  // path into `verdicts`, and a revoke would take away the SELECT
  // `readSettlementReadiness` reads.
  for (const verb of ["grant", "revoke"]) {
    for (const statement of statementsStartingWith(artifact, verb)) {
      if (!statement.includes(`on function ${FUNCTION}(`)) {
        findings.push(`foreign_privilege:${statement.slice(0, 60)}`);
      }
    }
  }

  const execute = functionExecuteAfter(artifact, FUNCTION);
  for (const statement of execute.unreadable) findings.push(`unreadable_execute:${statement}`);
  if (execute.owner !== "postgres") findings.push(`function_owner:${execute.owner}`);
  for (const role of ["public", "anon", "authenticated"]) {
    if (mayExecute(execute, role)) findings.push(`client_execute:${role}`);
  }
  if (!mayExecute(execute, "service_role")) findings.push("service_role_execute_missing");

  if (!/\bnotify\s+pgrst\b/.test(artifact.scan)) findings.push("pgrst_reload_missing");

  return findings;
}

/**
 * A doctored copy of the shipped NOTE — the fixture the grader must flag.
 *
 * The edit is anchored INSIDE the one fenced `sql` block and must be unique
 * there: the note's prose quotes its own SQL, so a plain `noteText.replace`
 * would doctor a table cell and leave the migration untouched, and every
 * fixture built on that anchor would grade clean while asserting it would not
 * (admin-window/TASK-0045 measured exactly that).
 */
function doctoredNote(find: string, replace: string): SqlArtifact {
  const block = sqlBlocks(noteText)[0].text;
  expect(block.split(find)).toHaveLength(2);
  // Both substitutions go through a REPLACER FUNCTION rather than a
  // replacement string. This block is a plpgsql body, so it carries `$$`, and
  // in a replacement string `$$` means one literal `$` — which silently
  // unbalanced the dollar quoting of every fixture below and made them all
  // grade as the same broken artifact instead of as the defect each was built
  // to show. The `verdicts` artifact could use a plain string because it has no
  // function body; this one cannot.
  const doctored = block.replace(find, () => replace);
  return sqlArtifactOf(noteText.replace(block, () => doctored));
}

describe("the settle_review_item handoff note", () => {
  it("carries exactly one fenced sql block", () => {
    expect(sqlBlocks(noteText)).toHaveLength(1);
    // Other fences are welcome (the apply command is one); only `sql` is unique.
    expect(fencedBlocks(noteText).length).toBeGreaterThan(1);
  });

  it("names the target path in the sibling, the apply command, and the rollback", () => {
    expect(noteText).toContain(TARGET_PATH);
    expect(noteText).toContain(APPLY_COMMAND);
    expect(noteText).toContain("drop function public.settle_review_item(jsonb);");
    // The order the two artifacts install in is the one thing a wrong paste
    // cannot recover from cheaply, so the note has to say it.
    expect(noteText).toContain("20260908000001_the_verdict_becomes_a_row.sql");
  });

  it("cites, per identifier, the sibling migration that defines it", () => {
    const cited = [...noteText.matchAll(/(\d{14}_[a-z0-9_]+\.sql)/g)].map((match) => match[1]);
    for (const file of [
      "20260818000000_the_schema_arrives_as_one_snapshot.sql",
      "20260821000003_the_gate_refuses_empty_values_and_future_observations.sql",
      "20260829000003_a_confirmed_match_is_stored_once.sql",
      "20260829000004_events_take_up_the_third_schema.sql",
      "20260901000002_the_review_item_opens_once_per_subject.sql",
      "20260901000006_the_stamp_the_bill_and_the_link_get_their_arms.sql",
    ]) {
      expect(cited).toContain(file);
    }
    // A citation TABLE, not a paragraph: every citation sits in a table row.
    const rows = noteText.split("\n").filter((line) => line.startsWith("|") && line.includes(".sql"));
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the settle_review_item migration", () => {
  it("grades clean", () => {
    expect(gradeSettle(shipped)).toEqual([]);
  });

  it("declares the argument name the app calls it by", () => {
    // The one divergence that renders an installed function permanently absent.
    expect(declaredArgument(shipped)).toBe(SETTLE_ARGUMENT);
  });

  it("reads exactly VerdictDecision's keys, and its value envelope's", () => {
    expect(constantArray(shipped, "c_decision_keys")?.sort()).toEqual([...DECISION_KEYS].sort());
    expect(constantArray(shipped, "c_value_keys")?.sort()).toEqual(
      [...DECISION_VALUE_KEYS].sort(),
    );
  });

  it("accepts no key naming a schema version, a source or a tier", () => {
    const accepted = [
      ...(constantArray(shipped, "c_decision_keys") ?? []),
      ...(constantArray(shipped, "c_value_keys") ?? []),
    ];
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.some((key) => key.includes("schema_version"))).toBe(false);
    expect(accepted).not.toContain("source");
    expect(accepted).not.toContain("tier");
  });

  it("branches on exactly VERDICT_ACTIONS, imported from the app's own leaf", () => {
    expect(constantArray(shipped, "c_actions")?.sort()).toEqual([...VERDICT_ACTIONS].sort());
  });

  it("names the admin source once in the registration and once in the function", () => {
    const insert = statementsStartingWith(shipped, "insert")[0];
    expect(insert.startsWith("insert into public.sources")).toBe(true);
    expect([...insert.matchAll(/'([^']*)'/g)].map((match) => match[1])[0]).toBe(ADMIN_SOURCE);
    expect(/c_admin_source\s+constant\s+text\s*:=\s*'([^']*)'/.exec(shipped.code)?.[1]).toBe(
      ADMIN_SOURCE,
    );
    // `do nothing`, never `do update`: a second paste, or a row Ben inserted
    // himself, is never rewritten from Admin's copy of it.
    expect(insert).toContain("on conflict (source) do nothing");
    expect(insert).not.toContain("do update");
  });

  it("is the only writer of verdicts and the only setter of review_items.status", () => {
    expect(occurrences(shipped, /\binsert\s+into\s+public\.verdicts\b/g)).toBe(1);
    expect(occurrences(shipped, /\b(?:update|delete\s+from)\s+public\.verdicts\b/g)).toBe(0);
    expect(occurrences(shipped, /\bupdate\s+public\.review_items\b[^;]*?\bset\s+status\b/g)).toBe(1);
  });

  it("writes its value through the gate and applies it through apply_resolution", () => {
    expect(occurrences(shipped, /\bpublic\.ingest_observation\s*\(/g)).toBe(1);
    expect(occurrences(shipped, /\bpublic\.apply_resolution\s*\(/g)).toBe(1);
    // apply_one_resolution is not a second door: no role holds EXECUTE on it
    // (the sibling's 20260901000006), so a call to it would fail at runtime.
    expect(shipped.scan).not.toMatch(/\bpublic\.apply_one_resolution\s*\(/);
  });

  it("refuses wont_fix on a note that is null OR blank", () => {
    const guard = wontFixGuard(shipped);
    expect(guard).not.toBeNull();
    expect(guard).toMatch(/\bis\s+null\b/);
    expect(guard).toMatch(/\[\[:space:\]\]/);
  });

  /**
   * QA attack on TASK-0046 — admin-window/BUG-0088, now bound and live.
   *
   * `contracts/admin-observability.md` §7 states the `data_conflict` answer as
   * "**choose a claimed value** (one tap per evidence card)", and the artifact's
   * own comment on this arm says the value "is read off the claim rather than
   * re-sent by the dashboard, so the two cannot differ". Both sentences describe
   * a claim BOUND to the item and to the fact being settled.
   *
   * Read by primary key alone, the arm adopted ANY `observation_id` in the
   * ledger: its value re-ingested under the admin source for the DECISION's
   * `domain`/`entity_id`/`field` and applied with `tier_at_apply = 'admin'` and
   * `admin_locked = true`, which the resolver can never correct.
   *
   * The arm now binds the read TWICE, and this asks for both, because neither
   * alone closes it:
   *
   *  - membership in `v_item.evidence` — the contract's own "evidence card" —
   *    which is what stops a stranger's claim being adopted;
   *  - the claim's own fact identity against the decision's, because a
   *    per-source item's subject is a SOURCE and its evidence spans fields
   *    (`review_items`, the sibling's 20260901000002), so membership alone
   *    would still let one field's value be adopted into another.
   *
   * Landed by QA as `it.fails`; flipped back to `it` here. Watched red as a
   * plain `it` against the unbound arm first — the WHERE clause it reported was
   * `claim.observation_id = (v_value ->> 'observation_id')::uuid`, entire.
   */
  it("adopts a claimed value only from a claim bound to the fact being settled", () => {
    const guard = adoptedClaimGuard(shipped);
    expect(guard).not.toBeNull();
    expect(guard).toMatch(/claim\.observation_id\s*=\s*any\s*\(\s*v_item\.evidence\s*\)/);
    expect(guard).toMatch(/claim\.domain\s*=\s*v_domain/);
    expect(guard).toMatch(/claim\.entity_id\s*=\s*v_entity_id/);
    expect(guard).toMatch(/claim\.field\s*=\s*v_field/);
  });

  /**
   * The other half of the same defect (admin-window/BUG-0088): a bound read
   * whose miss is not refused would fall through with `v_claim` null, and the
   * gate would answer about a null value instead of the function naming what it
   * refused. The refusal is the arm's own, in the grammar its neighbours use,
   * and it says what binding was missed rather than "no observation".
   */
  it("refuses an observation that is not this item's evidence for this fact", () => {
    const refusal = adoptedClaimRefusal(shipped);
    expect(refusal).not.toBeNull();
    expect(refusal?.errcode).toMatch(/^KS\d{3}$/);
    expect(refusal?.body).toMatch(/evidence/);
    // The refusal names the two things a reader needs to act: which claim was
    // named, and which item it was named for.
    expect(refusal?.body).toContain("observation_id");
    expect(refusal?.body).toContain("review_item_id");
  });

  it("is one transaction: no commit, no dblink, no autonomous transaction", () => {
    expect(forbiddenConstructs(shipped.scan)).toEqual([]);
    expect(dollarQuoteMarks(shipped.code) % 2).toBe(0);
    const balance = blockBalance(shipped.scan);
    expect(balance.openers).toBe(balance.closers);
  });

  it("creates one function, alters no table, and carries one data statement", () => {
    expect(alterTableTargets(shipped.scan)).toEqual([]);
    expect(statementsStartingWith(shipped, "create")).toHaveLength(1);
    expect(statementsStartingWith(shipped, "drop")).toEqual([]);
    expect(statementsStartingWith(shipped, "update")).toEqual([]);
    expect(statementsStartingWith(shipped, "delete")).toEqual([]);
    expect(statementsStartingWith(shipped, "insert")).toHaveLength(1);
  });

  it("raises only in the sibling's KS grammar, and allocates the next free codes", () => {
    const raised = [...new Set(errcodes(shipped))].sort();
    expect(raised.every((code) => /^KS\d{3}$/.test(code))).toBe(true);
    // KS001–KS028 are in use next door across BOTH SQL worlds — the migrations
    // (KS001–KS026) and the staging harness doors (KS027, KS028), measured
    // 2026-09-08 (admin-window/BUG-0093). Everything this file allocates sits
    // above them, and the note says so.
    for (const code of raised) {
      if (Number(code.slice(2)) > TAKEN_NEXT_DOOR.length) expect(noteText).toContain(code);
    }
  });

  /**
   * QA attack on admin-window/BUG-0088 — the code allocation itself, answered
   * by admin-window/BUG-0093.
   *
   * The test above, and the note's own citation table, once took "free next
   * door" from a grep of `kspace Scraper/supabase/migrations/` alone. That is
   * not where the sibling's codes all live: `tools/staging/harness_objects.sql`
   * is SQL applied to the staging project by `tools/staging/bootstrap_staging.sh`,
   * it is never a migration, and it raises two codes of its own. The sibling
   * keeps a witness for exactly this mistake —
   * `tests/live_safety/test_codes_named_once.py`, whose `HARNESS_DOORS`
   * docstring says a comparison reading the migrations alone "would call a live
   * code an unraised one (resolver/BUG-0044's two lease codes were the first)".
   *
   * Measured in the sibling on 2026-09-08 (read-only): `KS027` is raised at
   * `tools/staging/harness_objects.sql:2026` and named `LEASE_HELD_BY_ANOTHER`
   * at `tests/helpers/ks_codes.py:122`; `KS028` is raised at `:2121` and named
   * `LEASE_NOT_LIVE` at `:128`; and `tests/live_safety/test_codes_named_once.py`
   * pins that registry at `KS001`–`KS028`.
   *
   * So the codes this artifact allocates are asserted against what the sibling
   * ALREADY holds, captured here as a dated constant so that this check answers
   * the same on a machine where the sibling is not checked out at all. The scan
   * below asks the sibling itself, and is what stops the snapshot going stale
   * in silence.
   *
   * Landed by QA as `it.fails` (strict xfail) reporting
   * `expected [ 'KS027', 'KS028' ] to deeply equal []`; the artifact renumbered
   * onto KS029–KS032 (admin-window/BUG-0093) and it is a plain `it` again,
   * watched RED as one against the pre-renumber note first.
   */
  it("allocates codes the sibling has not already taken", () => {
    // A code raised but not allocated is a code reused with the sibling's own
    // meaning (KS001, the gate's unregistered domain), which is fine.
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);
    expect(allocated.filter((code) => TAKEN_NEXT_DOOR.includes(code))).toEqual([]);
    // And nothing is raised that is neither allocated here nor already the
    // sibling's own.
    for (const code of new Set(errcodes(shipped))) {
      expect(allocated.includes(code) || TAKEN_NEXT_DOOR.includes(code), code).toBe(true);
    }
  });

  /**
   * The same question asked of the sibling AS IT STANDS — admin-window/BUG-0093.
   *
   * `TAKEN_NEXT_DOOR` is a snapshot, and a snapshot is exactly what failed the
   * first time: it was assembled from one of the sibling's two SQL worlds and
   * cleared two codes that were already taken in the other. A snapshot cannot
   * go stale loudly, so this check reads the sibling's actual tree — every
   * `KSnnn` it raises, names, pins or writes into a receipt — and asserts that
   * no code this artifact ALLOCATES appears in it.
   *
   * **Two fixtures, as every scanning guard needs** (LESSONS 3). The scan must
   * FIND `KS027` and `KS028` — the harness-door lease codes, which live outside
   * `supabase/migrations/` and are precisely what the first grep missed — before
   * its silence about anything else is worth trusting; a walk that read nothing
   * would otherwise pass this by returning an empty set. Then it must NOT find
   * any code the note allocates.
   *
   * It runs only where the sibling is present. On a machine without that
   * checkout there is nothing to read and nothing this check could honestly
   * say, so the dated snapshot above — which always runs — is the floor.
   *
   * **The two checks are still two checks** (admin-window/BUG-0207). The
   * snapshot stays a literal `KS001`–`KS028` and is never re-derived from the
   * scan; the scan stays a read of the real tree and is never narrowed to the
   * snapshot. They disagree today — the tree holds four codes the snapshot does
   * not name — and the disagreement is answered here, out loud, by saying WHO
   * spelled each one rather than by editing either side into agreement.
   *
   * What changed on 2026-09-11: this campaign's own handoff now lives next
   * door, so "the sibling's tree holds `KS029`" became true BECAUSE the
   * artifact this file grades was installed there. Attribution (see
   * `unattributedSpellings`) asks whether the spelling sits inside a verbatim
   * copy of one of our paste blocks, so the collision arm is intact — a
   * stranger's raise of one of these four fails exactly as before, in the
   * python spelling and in the sibling's own `using errcode` idiom alike
   * (both pinned on fixtures below) — while our own pasted artifact no longer
   * counts against us.
   */
  it.runIf(SIBLING_PRESENT)("allocates no code the sibling's tree holds today", () => {
    const spellings = ksCodeSpellingsUnder(SIBLING_ROOT);
    expect(spellings.has("KS027"), `${SIBLING_ROOT} read`).toBe(true);
    expect(spellings.has("KS028"), `${SIBLING_ROOT} read`).toBe(true);
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);

    // Every file next door that spells one of the four, and every line of it
    // that this campaign's handoff notes do not carry. Empty is the only
    // acceptable answer: an allocated code is either absent next door (before
    // the paste) or present only through our own artifact (after it).
    const spellers = new Set(allocated.flatMap((code) => spellings.get(code) ?? []));
    const foreign = [...spellers].sort().flatMap((file) =>
      unattributedSpellings(fs.readFileSync(file, "utf8"), allocated).map(
        (line) => `${path.relative(SIBLING_ROOT, file)}: ${line}`,
      ),
    );
    // Distinct lines: one offending spelling repeated twenty times is one
    // thing to go and look at, and the failure should read like it.
    expect([...new Set(foreign)]).toEqual([]);
  });

  /**
   * Where the attribution corpus comes from — the non-vacuity half of the pair
   * below. A corpus assembled from nothing would attribute nothing, and the
   * collision arm would then fail on our own artifact again; a corpus
   * assembled from every note in the directory would attribute a line any
   * walk report happened to quote. It is exactly the notes that INSTALL a file
   * in the sibling, read off their own `target file` row.
   */
  it("attributes a spelling against the paste blocks of the notes that install a file next door", () => {
    const notes = installedHandoffNotes();
    expect(notes.map((handoff) => handoff.note)).toContain(NOTE);
    expect(notes.find((handoff) => handoff.note === NOTE)?.target).toBe(TARGET_PATH);
    // This note is not the only one: the verdicts artifact installs a file too,
    // so the derivation is a rule and not a one-file special case.
    expect(notes.length).toBeGreaterThan(1);

    // The corpus is the notes' paste BLOCKS and not their lines
    // (admin-window/BUG-0212). The migration block — what Ben pastes into
    // TARGET_PATH — is one of them, whole.
    const shippedLines = shipped.text.split("\n").map((line) => line.trim());
    expect(
      HANDOFF_BLOCKS.some(
        (block) =>
          block.length === shippedLines.length &&
          block.every((line, index) => line === shippedLines[index]),
      ),
    ).toBe(true);
    // Every code this artifact allocates is spelled inside one of them, so no
    // code is attributed by an empty or mis-read corpus.
    for (const code of allocatedCodes()) {
      expect(
        HANDOFF_BLOCKS.some((block) => block.some((line) => line.includes(code))),
        code,
      ).toBe(true);
    }
    // And a block is a contiguous run, not a bag of lines: the artifact's own
    // idiom line, standing alone, is NOT attributed — that is BUG-0212's leak,
    // closed here rather than only at the fixture below.
    const idiom = shippedLines.find(
      (line) => line.includes(allocatedCodes()[0]) && /errcode/i.test(line),
    );
    expect(idiom).toBeDefined();
    expect(unattributedSpellings(idiom as string, allocatedCodes())).toEqual([idiom]);
  });

  /**
   * The collision arm, proved on fixtures rather than on whatever the sibling
   * happens to hold today (LESSONS 8; and admin-window/BUG-0207 asks for this
   * arm to be pinned, so that making the suite green did not quietly delete the
   * protection). Three fixtures:
   *
   *  - what the handoff itself puts next door — the pasted migration (this
   *    block, verbatim) and §1a's registry entries — must NOT be flagged; that
   *    is the text that turned the suite red on 2026-09-11;
   *  - a stranger claiming one of the same four codes, in the sibling's own
   *    grammar, MUST be flagged, line by line;
   *  - a stranger claiming a code this artifact does NOT allocate is none of
   *    this guard's business and is not flagged.
   *
   * All in memory: they answer the same on a machine where the sibling is not
   * checked out at all, and nothing here writes or reads next door.
   */
  it("tells this handoff's own spellings from a stranger's claim on the same codes", () => {
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);

    // Half one of what Ben installs: the migration file's whole content.
    expect(unattributedSpellings(shipped.text, allocated)).toEqual([]);

    // Half two: §1a's companion edit to the sibling's code registry.
    const companionEdit = fencedBlocks(noteText)
      .filter((block) => block.info.toLowerCase() === "python")
      .map((block) => block.text)
      .join("\n");
    for (const code of allocated) expect(companionEdit, code).toContain(code);
    expect(unattributedSpellings(companionEdit, allocated)).toEqual([]);

    // A stranger's claim on the first allocated code: same file, same grammar,
    // a meaning of its own, and lines no note of ours carries.
    const claim = allocated[0];
    const stranger = [
      `# ${claim}: a staging lease the repair door could not renew.`,
      `LEASE_NOT_RENEWED = "${claim}"`,
    ];
    expect(unattributedSpellings(stranger.join("\n"), allocated)).toEqual(stranger);

    // And a code this artifact does not allocate stays the sibling's own
    // business: the guard speaks about these four and nothing else.
    expect(unattributedSpellings('LEASE_HELD_BY_ANOTHER = "KS027"', allocated)).toEqual([]);

    // Carrying our block does not buy a file amnesty for what sits OUTSIDE it:
    // coverage is positional, so an extra raise appended to a verbatim copy of
    // the artifact is still flagged, and only that line is.
    const extra = `raise exception 'lease lost' using errcode = '${claim}';`;
    expect(unattributedSpellings(`${shipped.text}\n${extra}`, allocated)).toEqual([extra]);
  });

  /**
   * The collision arm in the grammar the sibling actually raises codes in
   * (admin-window/BUG-0212; QA on admin-window/BUG-0207).
   *
   * Attribution WAS per LINE against this campaign's handoff notes, and next
   * door a SQLSTATE is raised on a line of its own:
   * `using errcode = 'KSnnn',` — 100+ such lines across the sibling's
   * migrations and `tools/staging` (measured 2026-09-11; `KS024` alone has
   * 22, our own installed `KS029` has 20). Our note carries that same line
   * verbatim for each of the four codes it allocates, so a LATER sibling
   * migration that raises one of them for a meaning of its own writes a line
   * that corpus already held, was attributed to us, and passed.
   *
   * The fixture above proves the arm in PYTHON (`X = "KSnnn"`), a spelling
   * the note happens not to carry per code; this one uses the sibling's own
   * SQL idiom, taken from the shipped block so it cannot drift from it.
   * Landed by QA as `it.fails` (strict xfail) reporting `expected [] to deeply
   * equal [ "using errcode = 'KS029'," ]`; flipped back to a plain `it` by the
   * fix, which stopped attributing a LINE the notes carry and started
   * attributing a verbatim copy of a whole paste BLOCK. Watched red once more
   * against the line-corpus version before the flip.
   */
  it("flags a stranger's raise of an allocated code in the sibling's own SQL idiom", () => {
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);

    // The idiom line for the first allocated code, read off the artifact we
    // ship rather than typed here.
    const claim = allocated[0];
    const idiom = shipped.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.includes(claim) && /errcode/i.test(line));
    expect(idiom, `${claim} raised in the shipped block`).toBeDefined();

    // A stranger's function next door, raising that code for its own reason.
    // Nothing else in it spells a KS code at all — which is how a real
    // migration reads: the code is named once, on the raise.
    const stranger = [
      "raise exception 'staging lease % could not be renewed', p_lease_id",
      idiom as string,
      "detail  = format('lease_id=%s', p_lease_id),",
      "hint    = 'take a fresh lease';",
    ].join("\n");

    expect(unattributedSpellings(stranger, allocated)).toEqual([idiom]);
  });

  /**
   * The sibling allocating ITS OWN next code is not a claim on ours
   * (QA on admin-window/BUG-0207).
   *
   * Attribution is positional over whole paste blocks, and one of this note's
   * code-bearing blocks is TWO lines long: §1a's registry paste, the wrapped
   * tail of the sibling's `tests/live_safety/test_codes_named_once.py` list of
   * every code `ks_codes.py` names. That list is written six, six, six, five,
   * five, four entries to a line, so the sibling's next allocation lands on the
   * line that has room — our block's last line — and the block stops matching.
   * The four codes that line spells are then reported as FOREIGN spellings of
   * codes this artifact allocates, and `npm test` is red for every builder
   * over a next-door edit that claims none of our meanings. That is the
   * failure BUG-0207 exists to stop, one trigger later.
   *
   * Landed by QA as `it.fails` (strict xfail) for admin-window/BUG-0213,
   * watched red first as a plain `it()`: `expected [ "\"KS029\", \"KS030\",
   * \"KS031\", \"KS032\", \"KS033\"," ] to deeply equal []`. The fix flips
   * it back to a plain `it`.
   */
  it.fails("does not call the sibling's own next code a claim on ours", () => {
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);
    expect(HANDOFF_BLOCKS.length).toBeGreaterThan(0);

    // The smallest block of the corpus — the registry paste, read off the note
    // rather than typed here, so it cannot drift from what Ben pasted.
    const registry = HANDOFF_BLOCKS.reduce((smallest, block) =>
      block.length < smallest.length ? block : smallest,
    );
    expect(registry.length).toBeLessThan(5);

    // The next free number, which is the sibling's to allocate and not ours.
    const next = `KS${String(TAKEN_NEXT_DOOR.length + allocated.length + 1).padStart(3, "0")}`;
    expect(allocated).not.toContain(next);
    expect(TAKEN_NEXT_DOOR).not.toContain(next);

    // It allocates it the way that list is already written: one more entry on
    // the line that has room. Nothing about OUR four codes changed.
    const grown = registry
      .map((line, index) => (index === registry.length - 1 ? `${line} "${next}",` : line))
      .join("\n");
    for (const code of allocated) expect(grown, code).toContain(code);

    expect(unattributedSpellings(grown, allocated)).toEqual([]);
  });

  /**
   * admin-window/BUG-0082, on the function side. On this project a newly
   * created function is BORN with EXECUTE granted to `public`, `anon`,
   * `authenticated` and `service_role` by an `ALTER DEFAULT PRIVILEGES` nobody
   * wrote, so `grant execute … to service_role` narrows nothing at all: the
   * revoke beside it is the entire posture, and a grader reading the grant
   * would certify the opposite of what installs.
   */
  it("leaves service_role able to call it and the client roles unable", () => {
    const execute = functionExecuteAfter(shipped, FUNCTION);
    expect(execute.unreadable).toEqual([]);
    expect(execute.owner).toBe("postgres");
    expect(mayExecute(execute, "service_role")).toBe(true);
    for (const role of ["public", "anon", "authenticated"]) {
      expect(mayExecute(execute, role), role).toBe(false);
    }
  });

  it("leaves every table's ACL exactly as it found it", () => {
    for (const table of TABLES) {
      const acl = tableAclAfter(shipped, table);
      expect(acl.unreadable, table).toEqual([]);
      expect(acl.owner, table).toBe("postgres");
      for (const role of ROLES_BORN_HOLDING_ALL) {
        expect(privilegesHeld(acl, role), `${table}/${role}`).toEqual([...TABLE_PRIVILEGES]);
      }
    }
  });
});

describe("the grader proves itself on doctored blocks", () => {
  it("flags the argument name PostgREST resolves the RPC by", () => {
    const doctored = doctoredNote(
      "create or replace function public.settle_review_item(p_decision jsonb)",
      "create or replace function public.settle_review_item(p_decisions jsonb)",
    );
    expect(gradeSettle(doctored)).toContain("argument_name:p_decisions");
    expect(gradeSettle(shipped)).not.toContain("argument_name:p_decisions");
  });

  it("flags another source name, in the registration and in the function alike", () => {
    const inInsert = doctoredNote(
      "values ('admin', 'registered', 'active', 'admin')",
      "values ('admin_dashboard', 'registered', 'active', 'admin')",
    );
    expect(gradeSettle(inInsert)).toContain("source_literal:admin_dashboard");

    const inConstant = doctoredNote(
      "c_admin_source   constant text := 'admin';",
      "c_admin_source   constant text := 'kspace_admin';",
    );
    expect(gradeSettle(inConstant)).toContain("source_literal:kspace_admin");
    expect(gradeSettle(shipped)).toEqual([]);
  });

  it("flags a registration that would rewrite a row Ben already has", () => {
    const doctored = doctoredNote(
      "on conflict (source) do nothing;",
      "on conflict (source) do update set tier = 'admin', lifecycle = 'active';",
    );
    expect(gradeSettle(doctored)).toContain("sources_insert_not_idempotent");
  });

  it("flags a second writer of verdicts", () => {
    const doctored = doctoredNote(
      "  return query\n",
      "  insert into public.verdicts as shadow (actor, action)\n" +
        "  values (v_actor, v_action);\n\n  return query\n",
    );
    expect(gradeSettle(doctored)).toContain("verdicts_inserts:2");
  });

  it("flags a second setter of review_items.status", () => {
    const doctored = doctoredNote(
      "  -- And the verdict lands:",
      "  update public.review_items as reopened\n" +
        "     set status = 'open'\n" +
        "   where reopened.review_item_id = v_item_id;\n\n  -- And the verdict lands:",
    );
    expect(gradeSettle(doctored)).toContain("status_setters:2");
  });

  it("flags a wont_fix guard that tests only for a null note", () => {
    const doctored = doctoredNote(
      "     and (v_note is null or v_note ~ '^[[:space:]]*$') then",
      "     and v_note is null then",
    );
    // The exact defect a form-only guard leaves behind: a note of three spaces
    // settles the item and the verdict log records no reason at all.
    expect(gradeSettle(doctored)).toContain("wont_fix_blank_untested");
    expect(gradeSettle(doctored)).not.toContain("wont_fix_null_untested");
    expect(gradeSettle(shipped)).not.toContain("wont_fix_blank_untested");
  });

  it("flags a commit, which would break the one-transaction guarantee", () => {
    const doctored = doctoredNote("notify pgrst, 'reload schema';", "commit;\n\nnotify pgrst, 'reload schema';");
    expect(gradeSettle(doctored)).toContain("commit");
  });

  it("flags DDL this artifact has no business carrying", () => {
    const doctored = doctoredNote(
      "notify pgrst, 'reload schema';",
      "create table public.pending_overrides (verdict_id uuid);\n\nnotify pgrst, 'reload schema';",
    );
    expect(gradeSettle(doctored).some((finding) => finding.startsWith("foreign_ddl:"))).toBe(true);
    expect(gradeSettle(shipped).some((finding) => finding.startsWith("foreign_ddl:"))).toBe(false);
  });

  it("flags a ninth action, a sixth decision key, and a renamed value key", () => {
    const ninth = doctoredNote(
      "'settle', 'fixed', 'wont_fix', 'override'\n  ];",
      "'settle', 'fixed', 'wont_fix', 'override', 'escalate'\n  ];",
    );
    const ninthFindings = gradeSettle(ninth);
    expect(ninthFindings.some((finding) => finding.startsWith("action_set:"))).toBe(true);
    expect(ninthFindings.find((finding) => finding.startsWith("action_set:"))).toContain("escalate");

    const sixth = doctoredNote(
      "'action', 'review_item_id', 'actor', 'note', 'value'",
      "'action', 'review_item_id', 'actor', 'note', 'value', 'schema_version'",
    );
    const sixthFindings = gradeSettle(sixth);
    expect(sixthFindings.some((finding) => finding.startsWith("decision_keys:"))).toBe(true);
    expect(sixthFindings).toContain("envelope_key:schema_version");

    const renamed = doctoredNote(
      "'domain', 'entity_id', 'field', 'observation_id', 'value', 'ref'",
      "'domain', 'entity_id', 'field', 'observation_id', 'value', 'reference'",
    );
    expect(gradeSettle(renamed).some((finding) => finding.startsWith("value_keys:"))).toBe(true);
  });

  /**
   * admin-window/BUG-0088, both fixtures. The defect this replaces read the
   * observation by PRIMARY KEY ALONE, so any claim in the ledger could be
   * adopted and re-asserted admin-locked; the grader has to flag exactly that
   * block, and must not flag a binding spelled another legal way.
   */
  it("flags an adoption read bound to nothing but the observation's own id", () => {
    const doctored = doctoredNote(
      "::uuid\n         and claim.observation_id = any (v_item.evidence)\n" +
        "         and claim.domain = v_domain\n" +
        "         and claim.entity_id = v_entity_id\n" +
        "         and claim.field = v_field;",
      "::uuid;",
    );
    const findings = gradeSettle(doctored);
    for (const part of ["evidence", "domain", "entity_id", "field"]) {
      expect(findings, part).toContain(`adopted_claim_unbound:${part}`);
    }
    expect(gradeSettle(shipped)).toEqual([]);
  });

  it("flags an adoption read whose miss is not refused", () => {
    // The guard's test removed: the read misses, `v_claim` stays null, and the
    // gate answers about a null value instead of the function naming what it
    // refused and why.
    const doctored = doctoredNote("      if v_claim is null then", "      if false then");
    expect(gradeSettle(doctored)).toContain("adoption_miss_unrefused");
  });

  it("grades clean when the adoption binding is spelled in another order", () => {
    // LESSONS 3's other half for this rule: the four predicates are a set, not
    // a sequence, and `any(...)` without the space is the same call.
    const doctored = doctoredNote(
      "         and claim.observation_id = any (v_item.evidence)\n" +
        "         and claim.domain = v_domain\n" +
        "         and claim.entity_id = v_entity_id\n" +
        "         and claim.field = v_field;",
      "         and claim.field = v_field\n" +
        "         and claim.domain = v_domain\n" +
        "         and claim.entity_id = v_entity_id\n" +
        "         and claim.observation_id = any(v_item.evidence);",
    );
    expect(gradeSettle(doctored)).toEqual([]);
  });

  it("flags an artifact that stopped calling apply_resolution", () => {
    const doctored = doctoredNote(
      "      from public.apply_resolution(jsonb_build_array(v_decision)) as settled;",
      "      from public.apply_one_resolution(v_decision) as settled;",
    );
    expect(gradeSettle(doctored)).toContain("apply_resolution_missing");
  });

  /**
   * admin-window/BUG-0082 and admin-window/BUG-0084, both sides. A grant cannot
   * narrow anything here: the function is born callable by every role in the
   * cluster and the table is born fully writable by all three Supabase roles,
   * so each fixture below installs a door while reading as if it did not.
   */
  it("does not certify a block that drops the client revoke", () => {
    const doctored = doctoredNote(
      "revoke all on function public.settle_review_item(p_decision jsonb) from public, anon, authenticated;\n",
      "",
    );
    const findings = gradeSettle(doctored);
    expect(findings).toContain("client_execute:public");
    expect(findings).toContain("client_execute:anon");
    expect(findings).toContain("client_execute:authenticated");
  });

  it("does not certify a revoke that names the three roles but not PUBLIC", () => {
    // Every role is a member of PUBLIC, so this revoke takes nothing back at
    // all — the one spelling that reads right and installs wrong.
    const doctored = doctoredNote(
      "from public, anon, authenticated;",
      "from anon, authenticated;",
    );
    const findings = gradeSettle(doctored);
    expect(findings).toContain("client_execute:public");
    expect(findings).toContain("client_execute:anon");
  });

  it("does not certify a block that touches the verdicts table's grants", () => {
    // The GRANT direction. The other artifact revoked exactly this so that
    // settle_review_item would be the only writer; a grant here hands the
    // service key a second path, and the ACL replay cannot see it — a table
    // born holding everything is not widened by a grant — so it is caught as a
    // statement that names something other than this function.
    const widened = doctoredNote(
      "notify pgrst, 'reload schema';",
      "grant insert on table public.verdicts to service_role;\n\nnotify pgrst, 'reload schema';",
    );
    const widenedFindings = gradeSettle(widened);
    expect(widenedFindings.some((finding) => finding.startsWith("foreign_privilege:"))).toBe(true);
    expect(widenedFindings.find((finding) => finding.startsWith("foreign_privilege:"))).toContain(
      "public.verdicts",
    );

    // The REVOKE direction, which the replay is what catches: taking SELECT
    // away here would leave every M2 surface drawing the not-provisioned card
    // against a table that is installed.
    const narrowed = doctoredNote(
      "notify pgrst, 'reload schema';",
      "revoke select on table public.verdicts from service_role;\n\nnotify pgrst, 'reload schema';",
    );
    expect(gradeSettle(narrowed)).toContain("table_privilege_touched:public.verdicts:service_role");
    expect(gradeSettle(shipped)).toEqual([]);
  });

  it("refuses an execute statement it cannot model, rather than skipping it", () => {
    for (const tail of [
      "to service_role granted by postgres",
      "to service_role with grant option",
    ]) {
      const doctored = doctoredNote(
        "grant execute on function public.settle_review_item(p_decision jsonb) to service_role;",
        `grant execute on function public.settle_review_item(p_decision jsonb) ${tail};`,
      );
      expect(
        gradeSettle(doctored).filter((finding) => finding.startsWith("unreadable_execute:")),
      ).toHaveLength(1);
    }
    expect(gradeSettle(shipped)).toEqual([]);
  });

  it("does not certify a block that hands the function to a client role", () => {
    const doctored = doctoredNote(
      "alter function public.settle_review_item(p_decision jsonb) owner to postgres;",
      "alter function public.settle_review_item(p_decision jsonb) owner to authenticated;",
    );
    const findings = gradeSettle(doctored);
    expect(findings).toContain("function_owner:authenticated");
    // An owner may grant itself back anything the revoke below took away.
    expect(findings).toContain("client_execute:authenticated");
  });

  it("reads a banned word in a comment or a string as prose, not as a construct", () => {
    // The other half of LESSONS 3: the grader must not fire on text that only
    // TALKS about the thing. Both of these are legal SQL and must grade clean.
    const inComment = doctoredNote(
      "-- ── 3. Who may call it ",
      "-- A create policy here would be a defect, and we commit nothing.\n-- ── 3. Who may call it ",
    );
    expect(gradeSettle(inComment)).toEqual([]);
    const inLiteral = doctoredNote(
      "'The one entry point for a verdict",
      "'create policy, commit, dblink. The one entry point for a verdict",
    );
    expect(gradeSettle(inLiteral)).toEqual([]);
  });

  it("grades clean when the revoke pair is spelled the other legal way", () => {
    // LESSONS 3 for the EXECUTE replay: `revoke all` and `revoke execute`
    // install the same ACL on a function, and a grader that fired on the second
    // spelling would refuse a correct artifact.
    const doctored = doctoredNote(
      "revoke all on function public.settle_review_item(p_decision jsonb) from public, anon, authenticated;",
      "revoke execute on function public.settle_review_item(p_decision jsonb) from public, anon, authenticated;",
    );
    expect(gradeSettle(doctored)).toEqual([]);
  });
});
