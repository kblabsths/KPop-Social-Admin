# Teach the check birth gate the four defects a detached-worktree receipt cannot grade

**Supersedes `2026-09-10-receipt-cannot-grade-evidence-paths.md`** (same wall,
one of four incidents, no diff). That file can be deleted when this installs.

- **Type**: amend (extend an existing gate — `lib_ticket.check_defects()`)
- **Incidents** (4, all `admin-window`, all inside 6 days, receipts):
  1. **TASK-0062** (archived, M3, architect-authored via `amend-checks`).
     Receipt at `c5ca42f`, `tracker/receipts/TASK-0062.json`, `green=false`,
     `isolation=worktree`, 8 of 10 checks exit 0:
     `[exit 1] test -s agenticflow/tracker/evidence/TASK-0062/warm-times.md`,
     `[exit 2] grep -q "PostgREST round trips" agenticflow/tracker/evidence/TASK-0062/warm-times.md`.
     Both exit 0 in the primary checkout. Evidence is gitignored
     (`.gitignore:64`) and is not in `receipt_link_paths`
     (`run.yaml:50`), so **no product change can ever green it**. Cost: one
     bounce, one architect amendment (digest 2026-09-11 counts it as one of
     that day's two "check-defect bounces").
  2. **TASK-0078** (archived, M3, **verifier**-authored). A multi-line heredoc
     check: the `## Checks` fence is split one command per line
     (`lib_ticket.checks_commands()`, line 398-416), so it stored as N broken
     fragments and the receipt was RED whatever was delivered.
  3. **BUG-0209** (archived, M3, P1, **verifier**-authored, opened against its
     own defective gates). Check 3 was
     `test "$(git -C "../kspace Scraper" log … | wc -l)" -eq 0` — in the
     receipt's detached worktree at `.worktrees/_receipt-<pid>/` the relative
     sibling path does not exist, the pipeline is empty, and the check
     **passes whatever the sibling holds**. False-GREEN on a cross-repo
     invariant, which is the one thing that bar existed to prove.
  4. **BUG-0218** (M3 patch, QA-authored, `tracker/tickets/BUG-0218.md`).
     Stored check `test -z "$(git status --porcelain -- src tests)"` — the
     receipt worktree is a fresh checkout at HEAD and is *always* clean, so
     the "no product source changed" proxy is vacuous.

  The strategist's M3 retro puts the price on it: "three of the gates this
  role authored were defective … a verifier writes the bars the whole
  milestone is graded against, so a defective bar is the most expensive kind
  of defect this role can produce." **And the advice route has already been
  tried and failed**: LESSONS 12 carried "a check you author, you have RUN on
  the tree it will run on" before incidents 2, 3 and 4 happened, and was
  extended after each. That is the case for machinery over prose.

- **Diff**: one function, `agenticflow/scripts/lib_ticket.py`, `check_defects()`
  (line 567). It already refuses this exact class of defect — `| wc -l`
  false-GREEN, `grep -c` false-RED, pytest outside the venv, a `.tsx`-only
  scope signed off by an untouched leaf test — and it is called by **both**
  `ticket.py cmd_new` (birth gate, line 163) and
  `ticket.py cmd_amend_checks` (line 830) — and by `recheck` (line 787), so one insert closes both authoring
  paths. Add inside the `for c in cmds:` loop, after the `grep -c` arm:

  ```python
        if "\n" in c:
            probs.append((c, "this check spans lines. The '## Checks' fence is "
                          "split ONE COMMAND PER LINE (lib_ticket.checks_commands), "
                          "so a heredoc or a wrapped pipeline is stored as N "
                          "broken fragments and the receipt is RED whatever you "
                          "delivered (TASK-0078, BUG-0209). Collapse it to one "
                          "line, or put the script in the repo and call it"))
        if re.search(r"(^|[\s\"'=])(\.\./|\$\{?PWD)", c) and "git -C" in c:
            probs.append((c, "a RELATIVE path out of the repo (../) in a receipt "
                          "check: receipt.py grades in a detached worktree at "
                          "`.worktrees/_receipt-<pid>/`, where that path does not "
                          "exist — the command produces nothing and a count/-z "
                          "assertion passes VACUOUSLY (false-GREEN; BUG-0209 "
                          "check 3 certified a cross-repo invariant this way). "
                          "Name the sibling by ABSOLUTE path"))
        if re.search(r"git\s+status\s+--porcelain", c):
            probs.append((c, "`git status --porcelain` is always clean in the "
                          "receipt's detached worktree at HEAD, so this proxy "
                          "passes vacuously whatever the tree holds (BUG-0218). "
                          "Assert the diff instead: "
                          "git diff --name-only <merge-base>..HEAD -- <paths>"))
        if re.search(r"(^|[\s\"'])(agenticflow/)?(visions/[^/\s]+/)?tracker/evidence/", c):
            probs.append((c, "this check reads a path under tracker/evidence/, "
                          "which is gitignored (.gitignore:64) and absent from "
                          "the detached worktree the receipt grades — it is RED "
                          "on every ticket forever and NO product change can "
                          "green it (TASK-0062). A receipt grades the TREE; "
                          "evidence is not in the tree. Grade the artifact the "
                          "fix puts in the repo, and cite the evidence in prose"))
  ```

  If you would rather make the fourth class **work** than refuse it, the one-line
  alternative is `run.yaml:50`
  `receipt_link_paths: … ,agenticflow/visions/*/tracker/evidence` — that is your
  file, and its price is that a receipt then grades a mutable gitignored
  artifact, i.e. it stops being a statement about the tree. I recommend the
  refusal: it fails at authoring time, where LESSONS 12 says the cost belongs.

- **Removal condition**: delete any of the four arms that logs **zero**
  refusals across 3 consecutive runs **while** a scan of that run's
  `tracker/receipts/*.json` stored-check text finds no instance of its pattern.
  (Zero refusals with instances still present means agents are routing around
  the gate, not that the defect is gone.) The whole block goes if `receipt.py`
  ever stops grading in an isolated worktree — every one of the four is a
  consequence of `isolated_tree()`.

- **Model stamp**: `claude-opus-5[1m]` (incidents 1-4 were authored by architect,
  verifier and QA lanes in the 2026-09-02…15 run on this install).

- **Cost**: four new refusal paths at ticket-authoring time, each costing a
  reword rather than a cycle. Two known false-positive shapes, both acceptable:
  a legitimate `git status --porcelain` check on a ticket whose receipt falls
  back to the primary checkout (only when `git worktree add` fails, and the
  fallback grade was never trustworthy anyway), and a check that merely
  *mentions* `tracker/evidence/` inside a longer string. ~35 lines of hook
  text; no run-time cost on any lane.
