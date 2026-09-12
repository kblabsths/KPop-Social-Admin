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
 * The `KSnnn` codes a piece of SQL RAISES, in the one grammar every KS code
 * next door is raised in: `using errcode = 'KSnnn'`.
 *
 * A raise is a USE of a code, not a declaration of what it means — which is why
 * it is read as a grammar and compared to nothing. What it answers is narrower
 * and it is the only thing it answers: which codes this tree puts in service.
 */
const RAISED_CODE = /errcode\s*=\s*'(KS\d{3})'/g;

function raisedCodes(sql: string): string[] {
  return [...new Set([...sql.matchAll(RAISED_CODE)].map((match) => match[1]))].sort();
}

/**
 * Every `KSnnn` RAISED under `root`, with the files (relative to it) raising it.
 *
 * Only `.sql` is read, because a SQLSTATE is raised in SQL: a number quoted in
 * a receipt, listed in a python test's pinned tuple or mentioned in a docstring
 * is not a code in service, and reading those was the whole of
 * admin-window/BUG-0213 — the line the sibling's next allocation lands on is a
 * pinned LIST, and a list of numbers says nothing about what any of them mean.
 *
 * A path that vanishes or refuses to read is skipped rather than thrown on —
 * which would make an empty result a silent pass, so the caller asserts the
 * raises it MUST find before it trusts an absence.
 */
function ksRaisesUnder(root: string): Map<string, string[]> {
  const raised = new Map<string, string[]>();
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
      if (!entry.name.endsWith(".sql")) continue;
      let text: string;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      for (const code of raisedCodes(text)) {
        const files = raised.get(code) ?? [];
        files.push(path.relative(root, full));
        raised.set(code, files);
      }
    }
  }
  return raised;
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
const SIBLING_REGISTRY = "tests/helpers/ks_codes.py";

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

function declaredCodeNames(text: string): Map<string, string[]> {
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
type CodeDeclarations = ReadonlyMap<string, readonly string[]>;

/**
 * What THIS CAMPAIGN declares its codes to mean — read off the notes that
 * install a file next door, so the answer moves with the notes and no list here
 * can go stale.
 */
function declaredByThisCampaign(): Map<string, string[]> {
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

const OUR_DECLARATIONS: CodeDeclarations = declaredByThisCampaign();

/**
 * Every claim on one of `allocated` that the OTHER side's declarations carry —
 * EMPTY when nothing next door holds one of our numbers for anything but the
 * meaning our own notes declare for it.
 *
 * Findings are sentences rather than a bare `false`, and each one names the
 * declaration it was read from, because "KS029 is taken" without both meanings
 * beside it is not something a reader can act on.
 */
function codeClaims(args: {
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
   * The same question asked of the sibling AS IT STANDS — admin-window/BUG-0093,
   * answered from declarations since admin-window/BUG-0213.
   *
   * `TAKEN_NEXT_DOOR` is a snapshot, and a snapshot is exactly what failed the
   * first time: it was assembled from one of the sibling's two SQL worlds and
   * cleared two codes that were already taken in the other. A snapshot cannot go
   * stale loudly, so this check reads the sibling's own tree.
   *
   * **The two checks are still two checks** (admin-window/BUG-0207). The
   * snapshot stays a literal `KS001`–`KS028` and is never re-derived from what
   * is read here; what is read here is never narrowed to the snapshot. They
   * disagree today — the tree holds four codes the snapshot does not name — and
   * the disagreement is answered out loud, by asking what the sibling DECLARES
   * each of those four to mean, rather than by editing either side into
   * agreement.
   *
   * What it reads, and nothing else (admin-window/BUG-0213): the sibling's
   * registry, `tests/helpers/ks_codes.py`, which names every code that tree
   * holds; and, from its `.sql` files, which codes are raised. Since Ben pasted
   * this campaign's handoff next door the registry names our four with our own
   * meanings — that is the campaign's satisfaction condition, and it is GREEN
   * here. A stranger holding one of them for a meaning of its own is RED, and
   * so is one raised next door that the registry names nowhere.
   *
   * **Two fixtures, as every reader of a tree needs** (LESSONS 8). The registry
   * must be found to declare `KS027`/`KS028` — the harness-door lease codes —
   * and the raise reader must find them raised in `tools/staging/`, which is
   * outside `supabase/migrations/` and is precisely what the first grep missed
   * (admin-window/BUG-0093); a read that found nothing would otherwise pass by
   * returning empty.
   *
   * It runs only where the sibling is present. On a machine without that
   * checkout there is nothing to read and nothing this check could honestly
   * say, so the dated snapshot above — which always runs — is the floor.
   */
  it.runIf(SIBLING_PRESENT)("allocates no code the sibling's tree holds today", () => {
    const registryPath = path.join(SIBLING_ROOT, SIBLING_REGISTRY);
    // Read, not scanned for: an unreadable registry throws here rather than
    // becoming an empty map that agrees with everything.
    const theirs = declaredCodeNames(fs.readFileSync(registryPath, "utf8"));
    expect(theirs.get("KS027"), registryPath).toEqual(["LEASE_HELD_BY_ANOTHER"]);
    expect(theirs.get("KS028"), registryPath).toEqual(["LEASE_NOT_LIVE"]);

    const raised = ksRaisesUnder(SIBLING_ROOT);
    for (const code of ["KS027", "KS028"]) {
      expect(
        (raised.get(code) ?? []).some((file) => file.startsWith("tools/staging/")),
        `${code} raised outside supabase/migrations/`,
      ).toBe(true);
    }

    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);

    expect(
      codeClaims({ allocated, ours: OUR_DECLARATIONS, theirs, raisedIn: raised }),
    ).toEqual([]);
  });

  /**
   * Our half of the pair — the non-vacuity check on this campaign's own
   * declarations (LESSONS 8).
   *
   * A comparison against declarations we never read answers "no claim" for
   * everything, which is the corpus-shaped failure arriving as a silent pass.
   * So: the notes that install a file next door really do declare a meaning for
   * each allocated code; that declaration is the text §1a asks Ben to paste into
   * the sibling's registry, in the registry's own grammar; and the OTHER thing
   * §1a asks him to paste — the pinned list of numbers — declares nothing, which
   * is the whole of admin-window/BUG-0213.
   */
  it("declares a meaning for every code it allocates, in the sibling's registry grammar", () => {
    const notes = installedHandoffNotes();
    expect(notes.map((handoff) => handoff.note)).toContain(NOTE);
    expect(notes.find((handoff) => handoff.note === NOTE)?.target).toBe(TARGET_PATH);
    // This note is not the only one: the verdicts artifact installs a file too,
    // so the derivation is a rule and not a one-file special case.
    expect(notes.length).toBeGreaterThan(1);

    const pythonBlocks = fencedBlocks(noteText)
      .filter((block) => block.info.toLowerCase() === "python")
      .map((block) => block.text);
    const entries = pythonBlocks.filter((text) => declaredCodeNames(text).size > 0);
    expect(entries).toHaveLength(1);

    for (const code of allocatedCodes()) {
      const names = OUR_DECLARATIONS.get(code) ?? [];
      // One code, one meaning, and it is the entry Ben pastes into the registry.
      expect(names, code).toHaveLength(1);
      expect(entries[0], code).toContain(`${names[0]} = "${code}"`);
    }

    // The other python block of §1a: the registry's pinned list, which spells
    // all four codes and declares a meaning for none of them.
    const pinned = pythonBlocks.filter((text) => declaredCodeNames(text).size === 0);
    expect(pinned).toHaveLength(1);
    for (const code of allocatedCodes()) expect(pinned[0], code).toContain(code);
  });

  /**
   * The collision arm, proved on fixtures rather than on whatever the sibling
   * happens to hold today (LESSONS 8; and admin-window/BUG-0207 asks for this
   * arm to be pinned, so that making the suite green did not quietly delete the
   * protection). All in memory: they answer the same on a machine where the
   * sibling is not checked out at all, and nothing here reads or writes next
   * door.
   */
  it("tells this handoff's own registry entries from a stranger's claim on the same codes", () => {
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);
    const claim = allocated[0];
    const ourName = (OUR_DECLARATIONS.get(claim) ?? [])[0];
    expect(ourName, claim).toBeDefined();

    // What Ben pastes IS our declaration: the registry after the paste holds
    // each of the four for exactly the meaning §1a declares, and claims nothing.
    const pasted = allocated
      .map((code) => `# ${code}: what this campaign holds it for.\n${(OUR_DECLARATIONS.get(code) ?? [])[0]} = "${code}"`)
      .join("\n\n");
    expect(
      codeClaims({ allocated, ours: OUR_DECLARATIONS, theirs: declaredCodeNames(pasted) }),
    ).toEqual([]);

    // A registry that has not been pasted into — before the install, or on a
    // machine where that half was never applied.
    expect(codeClaims({ allocated, ours: OUR_DECLARATIONS, theirs: new Map() })).toEqual([]);

    // A stranger holding one of the four for a meaning of its own.
    const stranger = `# ${claim}: a staging lease the repair door could not renew.\nLEASE_NOT_RENEWED = "${claim}"`;
    const found = codeClaims({
      allocated,
      ours: OUR_DECLARATIONS,
      theirs: declaredCodeNames(stranger),
    });
    expect(found).toHaveLength(1);
    // The failure names the code, our meaning, theirs, and which declaration it
    // read them from.
    expect(found[0]).toContain(claim);
    expect(found[0]).toContain(ourName as string);
    expect(found[0]).toContain("LEASE_NOT_RENEWED");
    expect(found[0]).toContain(SIBLING_REGISTRY);

    // A second meaning ALONGSIDE ours is still a second meaning.
    const both = `${ourName} = "${claim}"\nLEASE_NOT_RENEWED = "${claim}"`;
    expect(
      codeClaims({ allocated, ours: OUR_DECLARATIONS, theirs: declaredCodeNames(both) }),
    ).toHaveLength(1);

    // A code this artifact does not allocate stays the sibling's own business:
    // the guard speaks about these four and nothing else.
    expect(
      codeClaims({
        allocated,
        ours: OUR_DECLARATIONS,
        theirs: declaredCodeNames('LEASE_HELD_BY_ANOTHER = "KS027"'),
      }),
    ).toEqual([]);

    // And a code this campaign allocates but declares no meaning for is a
    // finding, never a silent pass.
    const undeclared = codeClaims({
      allocated: ["KS900"],
      ours: OUR_DECLARATIONS,
      theirs: new Map(),
    });
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]).toContain("KS900");
  });

  /**
   * The collision arm in the grammar the sibling actually raises codes in
   * (admin-window/BUG-0212; QA on admin-window/BUG-0207).
   *
   * Attribution WAS per LINE against this campaign's handoff notes, and next
   * door a SQLSTATE is raised on a line of its own: `using errcode = 'KSnnn',`,
   * the grammar of every KS raise in that repo (measured 2026-09-11; `KS024`
   * alone has 22 such lines, our own installed `KS029` has 20). Our note carries
   * that same line for each code it allocates, so a LATER sibling migration
   * raising one of them for a meaning of its own wrote a line that corpus
   * already held, was attributed to us, and passed.
   *
   * Nothing is attributed by text now, so the stranger is caught by what it
   * DECLARES, and this pins both states its file can be in — the sibling's own
   * admission rule ("every `KSnnn` the migrations raise is named once in
   * `tests/helpers/ks_codes.py`", §1a) says it must write the first:
   *
   *  - it names the code in the registry for its own meaning — the claim, with
   *    both meanings in the finding;
   *  - it raises the code and names it nowhere — the admission rule broken, no
   *    declaration to read, and silence there would be this bug again.
   *
   * Landed by QA as `it.fails` (strict xfail) reporting `expected [] to deeply
   * equal [ "using errcode = 'KS029'," ]`; a plain `it` since the block corpus,
   * and re-proved here against the declaration reader.
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

    // A stranger's migration next door, raising that code for its own reason.
    const strangerFile = "supabase/migrations/20260915000001_the_door_renews_a_lease.sql";
    const strangerSql = [
      "raise exception 'staging lease % could not be renewed', p_lease_id",
      idiom as string,
      "detail  = format('lease_id=%s', p_lease_id),",
      "hint    = 'take a fresh lease';",
    ].join("\n");
    expect(raisedCodes(strangerSql)).toEqual([claim]);
    const raisedIn = new Map([[claim, [strangerFile]]]);

    // Its registry entry, which its own witness forces it to write.
    const named = codeClaims({
      allocated,
      ours: OUR_DECLARATIONS,
      theirs: declaredCodeNames(`LEASE_NOT_RENEWED = "${claim}"`),
      raisedIn,
    });
    expect(named).toHaveLength(1);
    expect(named[0]).toContain(claim);
    expect(named[0]).toContain((OUR_DECLARATIONS.get(claim) ?? [])[0] as string);
    expect(named[0]).toContain("LEASE_NOT_RENEWED");

    // The same raise with the registry silent about the code.
    const unnamed = codeClaims({
      allocated,
      ours: OUR_DECLARATIONS,
      theirs: new Map(),
      raisedIn,
    });
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0]).toContain(strangerFile);
    expect(unnamed[0]).toContain(SIBLING_REGISTRY);
  });

  /**
   * The sibling allocating ITS OWN next code is not a claim on ours
   * (admin-window/BUG-0213; QA on admin-window/BUG-0207).
   *
   * Attribution used to be positional over whole paste blocks, and one of this
   * note's code-bearing blocks is TWO lines long: §1a's registry paste, the
   * wrapped tail of the sibling's `tests/live_safety/test_codes_named_once.py`
   * list of every code `ks_codes.py` names. That list is written six, six, six,
   * five, five, four entries to a line, so the sibling's next allocation lands
   * on the line that has room — our block's last line — and the block stopped
   * matching. The four codes that line spells were then reported as FOREIGN
   * spellings of codes this artifact allocates, and `npm test` was red for every
   * builder over a next-door edit that claims none of our meanings.
   *
   * A pinned list of numbers declares no meaning, so nothing about that line
   * reaches the guard at all now; what it reads is the registry entry the
   * sibling writes beside it, for a code that is not one of ours.
   *
   * Landed by QA as `it.fails` (strict xfail), watched red first as a plain
   * `it()`: `expected [ "\"KS029\", \"KS030\", \"KS031\", \"KS032\",
   * \"KS033\"," ] to deeply equal []`. Re-watched red as a plain `it()` on
   * this branch before the fix, with that same message.
   */
  it("does not call the sibling's own next code a claim on ours", () => {
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);

    // The next free number, which is the sibling's to allocate and not ours.
    const next = `KS${String(TAKEN_NEXT_DOOR.length + allocated.length + 1).padStart(3, "0")}`;
    expect(allocated).not.toContain(next);
    expect(TAKEN_NEXT_DOOR).not.toContain(next);

    // Its registry after our paste and after it takes that number for a meaning
    // of its own: our four entries untouched, one more below them.
    const registry = [
      ...allocated.map((code) => `${(OUR_DECLARATIONS.get(code) ?? [])[0]} = "${code}"`),
      `LEASE_NOT_RENEWED = "${next}"`,
    ].join("\n\n");
    const theirs = declaredCodeNames(registry);
    expect(theirs.get(next)).toEqual(["LEASE_NOT_RENEWED"]);
    for (const code of allocated) {
      expect(theirs.get(code), code).toEqual(OUR_DECLARATIONS.get(code));
    }

    // And the line that allocation lands on: §1a's pinned list — read off the
    // note rather than typed here, so it cannot drift from what Ben pasted —
    // grown the way that file is written, one more entry on the line with room.
    const pinnedBlocks = fencedBlocks(noteText)
      .filter((block) => block.info.toLowerCase() === "python")
      .map((block) => block.text)
      .filter((text) => declaredCodeNames(text).size === 0);
    expect(pinnedBlocks).toHaveLength(1);
    const pinned = pinnedBlocks[0].split("\n");
    expect(pinned.length).toBeLessThan(5);
    const grown = pinned
      .map((line, index) => (index === pinned.length - 1 ? `${line} "${next}",` : line))
      .join("\n");
    for (const code of allocated) expect(grown, code).toContain(code);
    expect(grown).toContain(next);
    // Nothing about OUR four codes changed, and a list declares no meaning.
    expect([...declaredCodeNames(grown).keys()]).toEqual([]);

    expect(
      codeClaims({
        allocated,
        ours: OUR_DECLARATIONS,
        theirs: declaredCodeNames(`${registry}\n${grown}`),
      }),
    ).toEqual([]);
  });
  /**
   * A declaration is read in the grammar the sibling's OWN parser declares one
   * in — QA on admin-window/BUG-0213.
   *
   * The registry is the sibling's file, so what counts as a declaration in it
   * is the sibling's definition, and that definition is written down next door
   * as code: `_declared_by` in `tests/live_safety/test_codes_named_once.py`
   * parses the file with `ast` and takes an `Assign` OR an `AnnAssign` whose
   * single target is a name and whose value is a string constant, comments
   * stripped first ("a declaration parked inside a comment is invisible, one
   * WEARING a comment is not", `code_declarations`' docstring). Quote style
   * reaches the tree not at all.
   *
   * This reader takes a narrower grammar — one line, bare `=`, double quotes,
   * nothing after the closing quote — and the gap runs in both directions,
   * measured on a scratch replica of the sibling (never a write next door):
   *
   *  - annotate our own pasted entry the way `tests/helpers/` types its other
   *    constants (`SYNTHETIC_NAME_PREFIX: Final[str] = "ENTITY_LINK_TEST_"`,
   *    `catalog_rows.py:58`), or hang a comment off its end, and the meaning
   *    next door is unchanged but this reader sees none — and because our own
   *    installed migration RAISES the four, the finding fires: `KS029: raised
   *    next door in supabase/migrations/20260908000002_…sql, and
   *    tests/helpers/ks_codes.py declares no meaning for it`. Red for every
   *    builder here over a typing pass next door, which is BUG-0213's failure
   *    mode with a new trigger;
   *  - and a stranger's claim written `LEASE_NOT_RENEWED = 'KS029'` is a
   *    declaration by the sibling's parser and invisible to this one, so the
   *    collision this guard exists for passes silently — BUG-0212's direction.
   *
   * In memory, both arms, on the declarations alone: no corpus, no similarity,
   * nothing of the sibling's text recognised — the grammar of the declaration
   * is simply the one its owner defines.
   */
  /*
   * Landed by QA as `it.fails` (strict xfail) — watched RED first as a plain
   * `it()` on this branch: `expected [ …(4) ] to deeply equal []`, the four
   * findings above. The fixer flips it back to `it()`.
   */
  it("reads a registry declaration in every form the sibling's own parser declares one", () => {
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);
    const claim = allocated[0];
    const ourName = (OUR_DECLARATIONS.get(claim) ?? [])[0] as string;
    expect(ourName, claim).toBeDefined();

    // Our own installed migration raises all four next door, so a declaration
    // this reader cannot see is never a quiet absence: it is a finding.
    const raisedIn = new Map(allocated.map((code) => [code, [TARGET_PATH]]));
    const entries = (spell: (name: string, code: string) => string): string =>
      allocated.map((code) => spell((OUR_DECLARATIONS.get(code) ?? [])[0], code)).join("\n");

    // Ben's paste, typed the way tests/helpers types its constants.
    const annotated = entries((name, code) => `${name}: Final[str] = "${code}"`);
    expect(
      codeClaims({
        allocated,
        ours: OUR_DECLARATIONS,
        theirs: declaredCodeNames(annotated),
        raisedIn,
      }),
    ).toEqual([]);

    // The same entries wearing a comment, which the sibling's parser reads
    // straight through.
    const commented = entries((name, code) => `${name} = "${code}"  # the admin handoff`);
    expect(
      codeClaims({
        allocated,
        ours: OUR_DECLARATIONS,
        theirs: declaredCodeNames(commented),
        raisedIn,
      }),
    ).toEqual([]);

    // And the collision arm: a stranger's claim on one of the four, spelled in
    // the other quote, is still a claim.
    const single = `${ourName} = "${claim}"\nLEASE_NOT_RENEWED = '${claim}'`;
    const found = codeClaims({ allocated, ours: OUR_DECLARATIONS, theirs: declaredCodeNames(single) });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("LEASE_NOT_RENEWED");
  });

  /**
   * The grammar itself, stated as the property rather than as the three
   * spellings that were missing — admin-window/BUG-0220 (LESSONS 13).
   *
   * The property: a registry entry declares here exactly when it declares next
   * door, where "declares" is `_declared_by`'s definition and nothing else —
   * an `Assign` or an `AnnAssign`, one Name target, a `str` Constant value,
   * comments off first. Every row below is a form of that definition or a form
   * outside it, so the next spelling someone types next door is already
   * answered instead of being the next bug.
   *
   * Both fixtures, as every reader needs (LESSONS 8): the forms that MUST
   * declare, and the forms that must NOT — including the two the sibling's
   * docstring calls out itself, a declaration parked inside a comment and a
   * code standing in a list, and the one this reader would otherwise invent
   * out of a file's own prose, a declaration written inside a string.
   *
   * In memory: nothing here reads or writes next door, and it answers the same
   * on a machine where the sibling is not checked out at all. Every row was
   * put through the sibling's OWN `code_declarations` before it was written
   * down (2026-09-11, admin-window/BUG-0220: 45 fixtures, 0 disagreements), so
   * the table below is that parser's answers and not this repo's opinion of
   * them — a snippet has to be a module it can parse, which is why the
   * indented row carries the body it is indented in.
   */
  it("reads a declaration in every form its owner's parser calls one, and in no other", () => {
    const code = "KS029";
    const declares = (source: string): string[] => declaredCodeNames(source).get(code) ?? [];

    // An `Assign` or an `AnnAssign`, one Name target, a `str` Constant — the
    // quote style, the annotation, the indentation and any trailing comment
    // never reach the sibling's tree, so none of them may decide this.
    const declaring: ReadonlyArray<readonly [string, string, string[]]> = [
      ["bare, double quotes", `UNREADABLE_VERDICT = "${code}"`, ["UNREADABLE_VERDICT"]],
      ["bare, single quotes", `UNREADABLE_VERDICT = '${code}'`, ["UNREADABLE_VERDICT"]],
      ["annotated", `UNREADABLE_VERDICT: Final[str] = "${code}"`, ["UNREADABLE_VERDICT"]],
      ["annotated, single quotes", `UNREADABLE_VERDICT: str = '${code}'`, ["UNREADABLE_VERDICT"]],
      ["wearing a comment", `UNREADABLE_VERDICT = "${code}"  # the admin handoff`, ["UNREADABLE_VERDICT"]],
      ["annotated, wearing a comment", `UNREADABLE_VERDICT: Final[str] = '${code}'  # ours`, ["UNREADABLE_VERDICT"]],
      ["indented, inside a body", `class Codes:\n    UNREADABLE_VERDICT = "${code}"`, ["UNREADABLE_VERDICT"]],
      ["a lower-case name, which an ast.Name also is", `unreadable_verdict = "${code}"`, ["unreadable_verdict"]],
      ["parenthesised", `UNREADABLE_VERDICT = ("${code}")`, ["UNREADABLE_VERDICT"]],
      ["triple-quoted", `UNREADABLE_VERDICT = """${code}"""`, ["UNREADABLE_VERDICT"]],
      ["a raw literal, still a str Constant", `UNREADABLE_VERDICT = r"${code}"`, ["UNREADABLE_VERDICT"]],
      ["triple-quoted, single", `UNREADABLE_VERDICT = \'\'\'${code}\'\'\'`, ["UNREADABLE_VERDICT"]],
      ["an upper-case raw prefix", `UNREADABLE_VERDICT = R"${code}"`, ["UNREADABLE_VERDICT"]],
      ["a u prefix, a str either way", `UNREADABLE_VERDICT = U'${code}'`, ["UNREADABLE_VERDICT"]],
      ["annotated without a subscript", `UNREADABLE_VERDICT: Final = "${code}"`, ["UNREADABLE_VERDICT"]],
      ["a trailing semicolon", `UNREADABLE_VERDICT = "${code}";`, ["UNREADABLE_VERDICT"]],
      ["a second statement after it", `OTHER = "KS030"; UNREADABLE_VERDICT = "${code}"`, ["UNREADABLE_VERDICT"]],
      ["a value wrapped across lines", `UNREADABLE_VERDICT = (\n    "${code}"\n)`, ["UNREADABLE_VERDICT"]],
      ["a backslash continuation", `UNREADABLE_VERDICT = \\\n    "${code}"`, ["UNREADABLE_VERDICT"]],
      ["adjacent literals, one Constant next door", `UNREADABLE_VERDICT = "KS" "029"`, ["UNREADABLE_VERDICT"]],
      [
        "two names for it, both read",
        `UNREADABLE_VERDICT = "${code}"\nLEASE_NOT_RENEWED: Final[str] = '${code}'  # a stranger`,
        ["UNREADABLE_VERDICT", "LEASE_NOT_RENEWED"],
      ],
    ];
    for (const [form, source, names] of declaring) expect(declares(source), form).toEqual(names);

    // And what declares nothing there declares nothing here.
    const declaringNothing: ReadonlyArray<readonly [string, string]> = [
      ["parked inside a comment", `# UNREADABLE_VERDICT = "${code}"`],
      ["parked inside a comment after code", `TIMEOUT = 30  # UNREADABLE_VERDICT = "${code}"`],
      ["inside a docstring", `"""\nUNREADABLE_VERDICT = "${code}"\n"""`],
      ["inside a string constant", `EXAMPLE = """\nUNREADABLE_VERDICT = "${code}"\n"""`],
      ["a comparison", `if UNREADABLE_VERDICT == "${code}":`],
      ["a chained assignment, which is two targets", `UNREADABLE_VERDICT = ALSO = "${code}"`],
      ["a tuple target", `UNREADABLE_VERDICT, OTHER = "${code}", "KS030"`],
      ["an attribute target", `codes.UNREADABLE_VERDICT = "${code}"`],
      ["a subscript target", `CODES["verdict"] = "${code}"`],
      ["an augmented assignment", `TAIL += "${code}"`],
      ["an annotation carrying no value", `UNREADABLE_VERDICT: Final[str]`],
      ["a bytes literal, which is not a str", `UNREADABLE_VERDICT = b"${code}"`],
      ["an f-string, which is not a Constant", `UNREADABLE_VERDICT = f"${code}"`],
      ["standing in a list", `PINNED = ["${code}", "KS030"]`],
      ["standing in a dict", `CODES = {"verdict": "${code}"}`],
      ["standing in a call", `raise Refusal("${code}")`],
      ["a rebuilt string", `UNREADABLE_VERDICT = "KS" + "029"`],
      ["a bytes literal with a raw prefix", `UNREADABLE_VERDICT = rb"${code}"`],
      ["a walrus, which is no assignment statement", `if (UNREADABLE_VERDICT := "${code}"):\n    pass`],
      ["a bare walrus, which no module parses", `UNREADABLE_VERDICT := "${code}"`],
      ["a second name for a constant", `UNREADABLE_VERDICT = ${code}`],
      ["a conditional value", `UNREADABLE_VERDICT = "${code}" if flag else "KS030"`],
      ["raised in SQL", `      using errcode = '${code}',`],
      ["quoted in prose", `the registry names ${code} for the verdict it cannot read`],
    ];
    for (const [form, source] of declaringNothing) expect(declares(source), form).toEqual([]);

    // The registry is read as a whole file, not a line at a time: a docstring
    // above the entries does not swallow them, and the comment over each entry
    // is not the entry.
    const registry = [
      '"""The campaign\'s own refusal codes, each named once.',
      "",
      'A shape like UNKNOWN_DOMAIN = "KS001" written here is prose about code.',
      '"""',
      "",
      "# KS029: a verdict this function cannot read as a decision.",
      `UNREADABLE_VERDICT: Final[str] = '${code}'  # the admin handoff`,
    ].join("\n");
    expect([...declaredCodeNames(registry).keys()]).toEqual([code]);
    expect(declares(registry)).toEqual(["UNREADABLE_VERDICT"]);
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
