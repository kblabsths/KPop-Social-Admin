import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocatedCodesIn,
  codeClaims,
  declaredByThisCampaign,
  raisedCodes,
  readHandoffNote,
  readOrRefuse,
  readPythonDeclarations,
  SIBLING_REGISTRY,
  type CodeDeclarations,
  type Reading,
} from "../offline/handoff/extract";
import { repoRoot } from "../offline/source-tree";

/**
 * The `handoff` project's one file: the guards whose INPUT is the sibling
 * checkout `kspace Scraper` — campaign admin-window/TASK-0080, installing
 * ARCHITECTURE.md §10's rule of 2026-09-12.
 *
 * **Why this file is not in `npm test`.** Everything here reads a repo this one
 * does not own, so its RED can be produced by a perfectly legitimate event next
 * door. That happened four times inside one campaign on the file this case came
 * from (admin-window/BUG-0207, BUG-0212, BUG-0213 and the sibling's own next
 * code allocation), and twice the trigger was this campaign SUCCEEDING — our
 * handoff landing next door. A guard like that is not a bar a builder in this
 * repo should have to clear before pushing; it is a cross-repo FINDING to
 * route. So: `npm run test:handoff`, run by the verifier at a milestone close
 * and by whoever prepares or re-checks a handoff (LESSONS 9), and never by
 * `npm test` or `ci_command`.
 *
 * **What did NOT move, and must not.** Every guard over OUR OWN artifact — the
 * block balance, the dollar quoting, the `ALTER TABLE` targets, the forbidden
 * constructs, the ACL math, and the code→meaning declarations this campaign
 * allocates — stays in `tests/offline/handoff/*`, where every builder runs it,
 * because an authoring slip there has to redden BEFORE Ben pastes. The cut is
 * by input ownership, not by subject: both files ask about KS codes, and only
 * one of them opens a path outside this repo.
 *
 * The reader both sides use (`readPythonDeclarations`, `codeClaims`,
 * `raisedCodes`, `allocatedCodesIn`) is imported from
 * `../offline/handoff/extract`, never re-typed here: drifting copies of that
 * reader is exactly how the same guard failed three times in one day
 * (LESSONS 4, LESSONS 5). Its BAR is stated once, at the head of that module's
 * declaration reader (admin-window/BUG-0225), and the last describe of this
 * file is where that bar is graded.
 */

/**
 * The sibling checkout on this machine, spelled ONCE and read ONLY.
 *
 * It is not a package and it is never imported: a relative import from a test
 * resolves inside whichever git worktree the suite is running from, so it would
 * reach the wrong tree or nothing at all. An absolute path reaches the one
 * checkout that exists, wherever this suite runs — and reaching it is a read of
 * three constants' worth of text, never a write, never an import, never a
 * network call, so the offline suite stays offline.
 *
 * Since admin-window/TASK-0080 it is spelled in the `handoff` project and
 * NOWHERE else in this repo's tests (`tests/offline/toolchain.test.ts` asserts
 * that): it names the one input of this repo's suites that this repo does not
 * own, which is the whole reason the project holding it is opt-in.
 */
const SIBLING_ROOT = "/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper";

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
 *
 * These are DELIBERATE exclusions and not failures to read: they are decided by
 * name, before anything is opened, so none of them can hide a `.sql` file that
 * raises a code. A path this walk MEANT to read and could not is a different
 * thing entirely and is reported — see below.
 */
const UNSCANNED_NEXT_DOOR = new Set(["node_modules", "agenticflow", "__pycache__"]);

/**
 * Every `KSnnn` RAISED under `root`, with the files (relative to it) raising it
 * — the second of the reader's two questions, held to the same bar as the first
 * (admin-window/BUG-0225): it answers with the sibling's raises, or it names
 * what it could not read.
 *
 * Only `.sql` is read, because a SQLSTATE is raised in SQL: a number quoted in
 * a receipt, listed in a python test's pinned tuple or mentioned in a docstring
 * is not a code in service, and reading those was the whole of
 * admin-window/BUG-0213 — the line the sibling's next allocation lands on is a
 * pinned LIST, and a list of numbers says nothing about what any of them mean.
 *
 * A path that vanishes or refuses to read is REPORTED, never skipped. Skipping
 * it used to make an empty result a silent pass — a walk of a root that is not
 * there answered "no code is raised next door", which is the same shape as an
 * empty declaration map agreeing with everything. The caller still asserts the
 * raises it MUST find, because a tree that reads cleanly and holds nothing is
 * also an answer worth doubting.
 */
function ksRaisesUnder(root: string): Reading<Map<string, string[]>> {
  const raised = new Map<string, string[]>();
  const unreadable: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      unreadable.push(`${dir}: this walk could not list it — ${(error as Error).message}`);
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
      } catch (error) {
        unreadable.push(`${full}: this walk could not read it — ${(error as Error).message}`);
        continue;
      }
      for (const code of raisedCodes(text)) {
        const files = raised.get(code) ?? [];
        files.push(path.relative(root, full));
        raised.set(code, files);
      }
    }
  }
  return { answer: raised, unreadable };
}

/** The note whose allocation this file asks the sibling about. */
const NOTE = "M2-handoff-settle-review-item.md";
const noteText = readHandoffNote(NOTE);

/** The codes THIS note declares it allocates — the shared reader, this note. */
function allocatedCodes(): string[] {
  return allocatedCodesIn(noteText);
}

/**
 * What THIS CAMPAIGN declares its codes to mean, read off its own notes — the
 * half of the comparison that lives in this repo. Shared derivation, so the two
 * projects cannot drift into two answers about our own meanings.
 */
const OUR_DECLARATIONS: CodeDeclarations = declaredByThisCampaign();

/** The registry as it stands next door, read as the python source it is. */
function siblingRegistry(): { path: string; text: string } {
  const registryPath = path.join(SIBLING_ROOT, SIBLING_REGISTRY);
  return { path: registryPath, text: fs.readFileSync(registryPath, "utf8") };
}

describe("the codes this campaign allocates, against the sibling as it stands", () => {
  /**
   * The same question asked of the sibling AS IT STANDS — admin-window/BUG-0093,
   * answered from declarations since admin-window/BUG-0213.
   *
   * `TAKEN_NEXT_DOOR` — the dated `KS001`–`KS028` snapshot that stayed behind in
   * `tests/offline/handoff/settle-review-item.test.ts`, where every input is
   * ours — is a snapshot, and a snapshot is exactly what failed the
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
   * **And neither half may answer PARTIALLY** (admin-window/BUG-0225): both
   * readings are taken through `readOrRefuse`, and the comparison is handed
   * whatever they could not read, so an input this reader only half-read fails
   * the case by name instead of being compared as though it were complete.
   *
   * It runs only where the sibling is present. On a machine without that
   * checkout there is nothing to read and nothing this check could honestly
   * say, so the dated snapshot in the offline suite — which always runs, and
   * which `npm test` therefore always grades — is the floor.
   */
  it.runIf(SIBLING_PRESENT)("allocates no code the sibling's tree holds today", () => {
    const registry = siblingRegistry();
    // Read, not scanned for: a registry this reader could not read throws here
    // rather than becoming an empty map that agrees with everything.
    const reading = readPythonDeclarations(registry.path, registry.text);
    const theirs = readOrRefuse(reading, `what ${SIBLING_REGISTRY} declares`);
    expect(theirs.get("KS027"), registry.path).toEqual(["LEASE_HELD_BY_ANOTHER"]);
    expect(theirs.get("KS028"), registry.path).toEqual(["LEASE_NOT_LIVE"]);

    const walk = ksRaisesUnder(SIBLING_ROOT);
    const raised = readOrRefuse(walk, "which codes the sibling's tree raises");
    for (const code of ["KS027", "KS028"]) {
      expect(
        (raised.get(code) ?? []).some((file) => file.startsWith("tools/staging/")),
        `${code} raised outside supabase/migrations/`,
      ).toBe(true);
    }

    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);

    expect(
      codeClaims({
        allocated,
        ours: OUR_DECLARATIONS,
        theirs,
        raisedIn: raised,
        registry: SIBLING_REGISTRY,
        unreadable: [...reading.unreadable, ...walk.unreadable],
      }),
    ).toEqual([]);
  });
});

/**
 * The two properties that make the guard above honest rather than decorative —
 * and neither is provable inside the guard, because a guard that did not run
 * proves nothing about itself.
 */
describe("the sibling scan's own two states", () => {
  it("names the checkout by an ABSOLUTE path that lies outside this repo", () => {
    // ARCHITECTURE.md §1.2: a receipt and every build lane run in a detached
    // worktree under `agenticflow/.worktrees/`, where a relative
    // `../kspace Scraper` resolves INSIDE this repo — so the scan would walk a
    // tree that holds no `.sql` at all and pass unconditionally. That vacuity
    // is what made admin-window/BUG-0209's stored check 3 green whatever the
    // sibling held. An absolute path reaches the one checkout that exists,
    // wherever this suite runs from.
    expect(path.isAbsolute(SIBLING_ROOT)).toBe(true);
    expect(SIBLING_ROOT.startsWith(`${repoRoot}${path.sep}`)).toBe(false);
    expect(SIBLING_ROOT).not.toBe(repoRoot);
    // The spelling this must never become, shown rather than described: from a
    // worktree the suite really runs in, `../kspace Scraper` is a path INSIDE
    // this repo, and it is not the checkout.
    const worktree = path.join(repoRoot, "agenticflow", ".worktrees", "some-ticket");
    const relative = path.resolve(worktree, "..", "kspace Scraper");
    expect(relative.startsWith(`${repoRoot}${path.sep}`)).toBe(true);
    expect(relative).not.toBe(SIBLING_ROOT);
    expect(fs.existsSync(relative)).toBe(false);
    // The registry is named RELATIVE to that root, so nothing outside this
    // project's one constant knows where the sibling is.
    expect(path.isAbsolute(SIBLING_REGISTRY)).toBe(false);
  });

  it("REPORTS an absent checkout instead of answering that nothing is raised", () => {
    // Why `runIf(SIBLING_PRESENT)` exists, and why it is no longer the only
    // thing standing between this walk and a green that graded nothing: a walk
    // of a tree that is not there used to answer with an EMPTY MAP, which reads
    // as "no code is raised next door" — the same shape as an empty declaration
    // map agreeing with everything. It now names the path it could not list,
    // and `readOrRefuse` turns that into a failure rather than an answer.
    // Two fixtures, as every reader of a tree needs (LESSONS 8): a root that is
    // not there, and the real one.
    const absent = path.join(SIBLING_ROOT, "__no_such_directory__");
    expect(fs.existsSync(absent)).toBe(false);
    const walk = ksRaisesUnder(absent);
    expect(walk.answer.size).toBe(0);
    expect(walk.unreadable.length).toBe(1);
    expect(walk.unreadable[0]).toContain(absent);
    expect(() => readOrRefuse(walk, "which codes the sibling's tree raises")).toThrowError(
      /which codes the sibling's tree raises/,
    );
    expect(SIBLING_PRESENT).toBe(fs.existsSync(SIBLING_ROOT));
  });

  it.runIf(SIBLING_PRESENT)("finds codes in service when the checkout IS there", () => {
    // The other fixture of the pair: on a machine with the checkout the same
    // walk is not empty and reports nothing unreadable, so the refusal above is
    // the absent tree's answer and not the walk's only answer.
    const walk = ksRaisesUnder(SIBLING_ROOT);
    expect(walk.unreadable).toEqual([]);
    expect(walk.answer.size).toBeGreaterThan(0);
  });

  it("reads a raise as a use of a code, from the sibling's own idiom", () => {
    // The grammar the walk above counts, proved on text rather than on whatever
    // the sibling holds today: an in-memory pair, one that raises and one that
    // only mentions the same number.
    expect(raisedCodes("raise exception 'x' using errcode = 'KS031';")).toEqual(["KS031"]);
    expect(raisedCodes("-- KS031 is pinned in a list next door\nselect 1;")).toEqual([]);
    // And the second question meets a CRLF file too: this pattern is anchored
    // to nothing, so the line ending never decides what is in service.
    const crlf = `raise exception 'x'${String.fromCharCode(13)}\n  using errcode = 'KS031';`;
    expect(raisedCodes(crlf)).toEqual(["KS031"]);
  });
});

/**
 * THE READER'S BAR, GRADED — admin-window/BUG-0225, the fifth ticket on one
 * reader and the one that states the property instead of the instance
 * (LESSONS 13).
 *
 * The property, from the head of `../offline/handoff/extract.ts`: for each of
 * the two questions this reader answers about the sibling, it produces that
 * tree's OWN declarations (or raises), or it reports — by name, failing the
 * case — that it could not read its input. A silent partial answer that a
 * comparison then treats as complete is the defect; a reported failure to read
 * is a correct answer.
 *
 * The three shapes below are the ones QA measured on admin-window/BUG-0220 and
 * did not file. Each gets BOTH polarities (LESSONS 8): one input the reader
 * MUST read, and one it must refuse to guess at. Every expectation was put
 * through the sibling's OWN parser first — `code_declarations` from
 * `tests/live_safety/test_codes_named_once.py` over `blank_comments`, run on
 * 2026-09-14 in a scratch replica outside both repos, reading the sibling and
 * writing nothing to it — so the rows below are that parser's answers and not
 * this repo's opinion of them.
 *
 * These cases are in memory: they read no tree, they answer the same on a
 * machine with no sibling checkout, and they live here rather than in the
 * offline suite because what they grade is the reader that answers ABOUT the
 * sibling (BUG-0225 criterion 4).
 */
describe("the reader answers the sibling's declarations, or says it could not read them", () => {
  const CODE = "KS029";
  /** A carriage return, spelled without one standing in this file's text. */
  const CR = String.fromCharCode(13);
  const declarationsOf = (text: string) => readPythonDeclarations("fixture", text);

  it("reads a CRLF input exactly as its LF twin, and still refuses what it cannot parse", () => {
    // BUG-0220's first residual. A `\r` is a LINE TERMINATOR to a JavaScript
    // regular expression, so `.+$` in the declaration pattern — which carries
    // no `m` flag — never reached the end of a CRLF line, and a whole CRLF
    // registry declared NOTHING: the empty map that agrees with everything,
    // arriving as a silent pass. Python normalizes line endings before its
    // tokenizer runs, so the two texts are one text next door.
    const lf = `LEASE_HELD_BY_ANOTHER = "KS027"\nLEASE_NOT_LIVE = "KS028"\n`;
    const crlf = lf.split("\n").join(`${CR}\n`);
    expect(crlf).toContain(CR);
    const read = declarationsOf(crlf);
    expect(read.unreadable).toEqual([]);
    expect([...read.answer]).toEqual([...declarationsOf(lf).answer]);
    expect(read.answer.get("KS027")).toEqual(["LEASE_HELD_BY_ANOTHER"]);
    // A value carried across CRLF lines, both ways python carries one.
    expect(declarationsOf(`NAME = (${CR}\n    "${CODE}"${CR}\n)${CR}\n`).answer.get(CODE)).toEqual([
      "NAME",
    ]);
    expect(declarationsOf(`NAME = \\${CR}\n    "${CODE}"${CR}\n`).answer.get(CODE)).toEqual(["NAME"]);

    // The other polarity: normalizing line endings does not LAUNDER a shape
    // this reader cannot parse. The same refusal arrives with CRLF as with LF.
    const refused = declarationsOf(`if TYPE_CHECKING: SETTLE = "${CODE}"${CR}\n`);
    expect(refused.answer.size).toBe(0);
    expect(refused.unreadable).toHaveLength(1);
    expect(refused.unreadable[0]).toContain("fixture:1");
  });

  it.runIf(SIBLING_PRESENT)("reads the registry next door identically with CRLF endings", () => {
    // The must-read polarity on the real input, not a fixture of our own: the
    // sibling pins LF in `.gitattributes`, so a CRLF copy of its registry is
    // exactly the input from somewhere this guard did not expect — the moment a
    // guard is load-bearing. Same declarations, code for code and name for name.
    const registry = siblingRegistry();
    const lf = readPythonDeclarations(registry.path, registry.text);
    const crlf = readPythonDeclarations(registry.path, registry.text.split("\n").join(`${CR}\n`));
    expect(lf.unreadable).toEqual([]);
    expect(crlf.unreadable).toEqual([]);
    expect(lf.answer.size).toBeGreaterThan(10);
    expect([...crlf.answer]).toEqual([...lf.answer]);
  });

  it("reads a compound statement's indented body, and refuses its one-line body", () => {
    // BUG-0220's second residual, and the sharpest of the three: the sibling's
    // `ast` reads a one-line compound body as an ordinary declaration, and this
    // line reader cannot decompose one. It did not merely MISS them — `try:
    // SETTLE_STALE = "KS029"` was read as declaring the code under the name
    // `try`, a claim about another repo's file that nobody next door wrote.
    const indented = declarationsOf(`if TYPE_CHECKING:\n    SETTLE_STALE = "${CODE}"\n`);
    expect(indented.unreadable).toEqual([]);
    expect(indented.answer.get(CODE)).toEqual(["SETTLE_STALE"]);
    // `class Codes:` with the body on the NEXT line is the same shape and is
    // read, so what is refused below is the one-line body and nothing else.
    expect(
      declarationsOf(`class Codes:\n    SETTLE_STALE = "${CODE}"\n`).answer.get(CODE),
    ).toEqual(["SETTLE_STALE"]);

    for (const oneLiner of [
      `if TYPE_CHECKING: SETTLE_STALE = "${CODE}"`,
      `try: SETTLE_STALE = "${CODE}"\nexcept Exception: pass`,
      `class Codes: SETTLE_STALE = "${CODE}"`,
      `for code in codes: SETTLE_STALE = "${CODE}"`,
    ]) {
      const read = declarationsOf(oneLiner);
      expect(read.unreadable.length, oneLiner).toBeGreaterThan(0);
      expect(read.unreadable[0], oneLiner).toContain("fixture:1");
      // And nothing is invented out of it: no declaration at all, and in
      // particular none under a name python cannot assign to.
      expect([...read.answer.keys()], oneLiner).toEqual([]);
      expect(read.unreadable.join(" "), oneLiner).not.toContain("KS030");
    }

    // A compound one-liner that carries no code at all is ordinary code, not a
    // refusal: the reader stays silent about statements that cannot hide a
    // declaration of a `KSnnn`, and reads the file around them.
    const ordinary = declarationsOf(`if flag: x = 1\nSETTLE_STALE = "${CODE}"\n`);
    expect(ordinary.unreadable).toEqual([]);
    expect(ordinary.answer.get(CODE)).toEqual(["SETTLE_STALE"]);
  });

  it("INVENTS no declaration from a bracketed list with a blank line in it", () => {
    // BUG-0220's third residual and the class's signature: not a miss, a FALSE
    // POSITIVE about another repo's code. The reader joined lines inside
    // brackets so a wrapped value read as one statement, and reset that join on
    // every blank line so a note's prose could not swallow the rest of a file.
    // A blank line inside a bracket is ordinary python — the tokenizer passes
    // straight over it — so the reset made the lines after it look like
    // top-level statements, and `code="KS029"` inside a call was reported as a
    // declaration of KS029 under the name `code`. Next door, by its own parser,
    // that text declares ONE thing: `NAME = "KS030"`.
    const call = `register(\n    name="thing",\n\n    code="${CODE}"\n)\nNAME = "KS030"\n`;
    const read = declarationsOf(call);
    expect(read.unreadable).toEqual([]);
    expect([...read.answer]).toEqual([["KS030", ["NAME"]]]);
    expect(read.answer.has(CODE)).toBe(false);

    // The same shape as a pinned list — the very thing BUG-0213 was about —
    // with a blank line in it. A list declares nothing; the statement AFTER it
    // is still read, which is the must-read half of this pair.
    const list = `PINNED = [\n    "KS027",\n\n    "${CODE}",\n]\nNEXT = "KS030"\n`;
    expect([...declarationsOf(list).answer]).toEqual([["KS030", ["NEXT"]]]);
    // And a value that itself spans a blank line is read, as python reads it.
    expect(declarationsOf(`NAME = (\n    "${CODE}"\n\n)\n`).answer.get(CODE)).toEqual(["NAME"]);

    // The refusal polarity: a bracket the text never closes. Nothing after it
    // can be read as a statement, so the reader says which line opened it
    // instead of answering from the fragment.
    const truncated = declarationsOf(`register(\n    code="${CODE}"\n`);
    expect(truncated.answer.size).toBe(0);
    expect(truncated.unreadable).toHaveLength(1);
    expect(truncated.unreadable[0]).toContain("fixture:1");
  });

  it("refuses an input that is not python source text at all", () => {
    // The shape a guard meets when its input arrives from somewhere it did not
    // expect — a UTF-16 registry read as UTF-8 carries NUL bytes, and next door
    // `ast.parse` answers that with a ValueError and `code_declarations`
    // returns an empty list. An empty list is the answer that agrees with
    // everything, so here it is a refusal instead.
    const read = declarationsOf(`NAME = "${CODE}"\n${String.fromCharCode(0)}binary`);
    expect(read.answer.size).toBe(0);
    expect(read.unreadable).toHaveLength(1);
    expect(read.unreadable[0]).toContain("NUL");
  });

  it("hands a comparison no half-read input, and names the source when it refuses", () => {
    // The property itself, on both of the ways an answer leaves this reader.
    const allocated = allocatedCodes();
    expect(allocated.length).toBeGreaterThan(0);

    // 1. `readOrRefuse` throws, naming the question, the source and the shape.
    const refused = readPythonDeclarations(
      "ks_codes.py",
      `try: LEASE_NOT_RENEWED = "${allocated[0]}"`,
    );
    expect(() => readOrRefuse(refused, "what the registry declares")).toThrowError(
      /what the registry declares[\s\S]*ks_codes\.py:1/,
    );

    // 2. And the reporting path: a comparison handed what could not be read
    // answers with THAT and compares no code, so the empty map that used to
    // "agree with everything" cannot reach a verdict at all.
    const findings = codeClaims({
      allocated,
      ours: OUR_DECLARATIONS,
      theirs: refused.answer,
      unreadable: refused.unreadable,
    });
    expect(findings).toHaveLength(refused.unreadable.length);
    expect(findings[0]).toContain("ks_codes.py:1");
    // Without that report the same empty map is a clean bill of health, which
    // is exactly the silent pass this bar exists to make impossible.
    expect(codeClaims({ allocated, ours: OUR_DECLARATIONS, theirs: refused.answer })).toEqual([]);
  });

  it("decides a claim on a DECLARATION, never on how alike two texts are", () => {
    // BUG-0225 criterion 5, and Common violations row 25: no new attribution
    // heuristic. Two texts, arranged so that similarity would answer both
    // backwards — one that copies our own note's words and declares our own
    // meaning (no claim), one that shares none of them and declares a meaning
    // of its own for the same code (a claim). Only the declarations decide.
    const allocated = allocatedCodes();
    const code = allocated[0];
    const ourName = (OUR_DECLARATIONS.get(code) ?? [])[0] as string;
    expect(ourName, code).toBeDefined();

    const familiar = `# ${code}: what this campaign holds it for, in our own words.\n${ourName} = "${code}"`;
    expect(
      codeClaims({
        allocated,
        ours: OUR_DECLARATIONS,
        theirs: declarationsOf(familiar).answer,
      }),
    ).toEqual([]);

    const foreign = `LEASE_NOT_RENEWED = '${code}'`;
    const found = codeClaims({
      allocated,
      ours: OUR_DECLARATIONS,
      theirs: declarationsOf(foreign).answer,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("LEASE_NOT_RENEWED");
    expect(found[0]).toContain(ourName);
  });
});
