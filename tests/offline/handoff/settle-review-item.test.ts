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
  privilegesHeld,
  readHandoffNote,
  ROLES_BORN_HOLDING_ALL,
  sqlArtifactOf,
  sqlBlocks,
  tableAclAfter,
  TABLE_PRIVILEGES,
  type SqlArtifact,
} from "./extract";

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
    // KS001–KS026 are in use next door (grep of that directory, 2026-09-08);
    // everything this file allocates sits above them, and the note says so.
    for (const code of raised) {
      if (Number(code.slice(2)) > 26) expect(noteText).toContain(code);
    }
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
