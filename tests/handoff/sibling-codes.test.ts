import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocatedCodesIn,
  codeClaims,
  declaredByThisCampaign,
  declaredCodeNames,
  raisedCodes,
  readHandoffNote,
  SIBLING_REGISTRY,
  type CodeDeclarations,
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
 * The reader both sides use (`declaredCodeNames`, `codeClaims`, `raisedCodes`,
 * `allocatedCodesIn`) is imported from `../offline/handoff/extract`, never
 * re-typed here: drifting copies of that reader is exactly how the same guard
 * failed three times in one day (LESSONS 4, LESSONS 5).
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
 */
const UNSCANNED_NEXT_DOOR = new Set(["node_modules", "agenticflow", "__pycache__"]);

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
   * It runs only where the sibling is present. On a machine without that
   * checkout there is nothing to read and nothing this check could honestly
   * say, so the dated snapshot in the offline suite — which always runs, and
   * which `npm test` therefore always grades — is the floor.
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

  it("reads an absent checkout as EMPTY, which is why the scan is guarded and never silent", () => {
    // The whole reason `runIf(SIBLING_PRESENT)` exists: this walk answers a
    // missing tree with an empty map rather than with an error, so a scan run
    // on a machine that has no sibling checkout would report "no claims on our
    // codes" — a green that graded nothing. Two fixtures, as every reader of a
    // tree needs (LESSONS 8): a root that is not there, and the real one.
    const absent = path.join(SIBLING_ROOT, "__no_such_directory__");
    expect(fs.existsSync(absent)).toBe(false);
    expect(ksRaisesUnder(absent).size).toBe(0);
    expect(SIBLING_PRESENT).toBe(fs.existsSync(SIBLING_ROOT));
  });

  it.runIf(SIBLING_PRESENT)("finds codes in service when the checkout IS there", () => {
    // The other fixture of the pair: on a machine with the checkout the same
    // walk is not empty, so the emptiness above is the absent tree's answer and
    // not the walk's only answer.
    expect(ksRaisesUnder(SIBLING_ROOT).size).toBeGreaterThan(0);
  });

  it("reads a raise as a use of a code, from the sibling's own idiom", () => {
    // The grammar the walk above counts, proved on text rather than on whatever
    // the sibling holds today: an in-memory pair, one that raises and one that
    // only mentions the same number.
    expect(raisedCodes("raise exception 'x' using errcode = 'KS031';")).toEqual(["KS031"]);
    expect(raisedCodes("-- KS031 is pinned in a list next door\nselect 1;")).toEqual([]);
  });
});
