#!/usr/bin/env python3
"""Evidence receipt: compute the facts of a done claim (A4).

Runs the machine-checkable commands found in the ticket's Acceptance
criteria ITSELF, records the exit codes it observed plus a content hash of
the ticket's touch scope, and writes `tracker/receipts/<ID>.json`.
`ticket.py transition <ID> done` (from qa) refuses without a green, current
receipt — so VERIFIED is computed from facts, never claimed by an agent.

Scope of the guarantee, deliberately narrow: a green receipt proves the
claimed checks actually ran and passed on this exact code. It does NOT prove
the work meets the ticket's goal — criteria are the floor, not the ceiling,
and goal-match remains QA/verifier/designer judgment.

Fail-closed: criteria with no runnable command yield no receipt and the
ticket cannot close mechanically. That pressure is deliberate — it pushes
criteria toward the executable form ("`cd app && pytest tests/x.py` exits 0").

Usage: receipt.py <ID>          (exit 0 = green, 1 = red/no receipt)
"""
import glob
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

CMD_TIMEOUT_S = 900


def isolated_tree(head, link_globs):
    """A private checkout at `head` for the receipt's checks, or None.

    Lanes share the primary checkout, so a whole-tree check (`ruff check`,
    `mypy --strict`, `npm test`) sees every other lane's untracked scratch:
    TASK-0027's receipt went RED then GREEN on nothing of its own, and
    TASK-0035's counted 12 errors, all in another lane's `_qaprobe/`
    (kspace, 2026-08-28; ~6 receipt re-runs that run). Heavy gitignored
    dirs are symlinked in, not copied, so verbatim check strings
    (`.venv/bin/ruff check`) still resolve. A check that WRITES the tree
    (a formatter, a snapshot updater) now writes into a tree that is
    deleted — a receipt asserts, it does not repair."""
    path = os.path.join(lib.ROOT, ".worktrees", "_receipt-%d" % os.getpid())
    r = subprocess.run(["git", "worktree", "add", "--detach", "-q", path, head],
                       cwd=lib.PRODUCT, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.isdir(path):
        return None
    for pat in link_globs:
        for src in glob.glob(os.path.join(lib.PRODUCT, pat)):
            dst = os.path.join(path, os.path.relpath(src, lib.PRODUCT))
            if not os.path.lexists(dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                os.symlink(src, dst)
    return path


def foreign_files(scope):
    """Uncommitted paths in the primary checkout outside this ticket's
    scope and the tracker — the receipt's record of what it was shielded
    from (the instrument for retiring the isolation if lanes ever stop
    sharing a tree)."""
    out = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"],
                         cwd=lib.PRODUCT, capture_output=True, text=True).stdout
    n = 0
    for ln in out.splitlines():
        rel = ln[3:].strip().strip('"')
        if rel.startswith("agenticflow/tracker/"):
            continue
        if not any(rel == sc or rel.startswith(sc.rstrip("/") + "/") for sc in scope):
            n += 1
    return n


def run_checks(cmds, cwd, env):
    results, green = [], True
    for c in cmds:
        # The private worktree can be deleted under a running check (three
        # lanes in one day, 2026-08-30 — one live suite PASSED and was then
        # graded exit 1 because pytest died restoring its start dir). A
        # vanished tree is NO VERDICT, never a failure the checks earned.
        if not os.path.isdir(cwd):
            green = False
            results.append({"cmd": c, "exit": "tree-vanished",
                            "output_tail": "(the private worktree disappeared "
                            "before this check ran — no verdict; re-run "
                            "receipt.py)"})
            print("[exit tree-vanished] %s" % c)
            continue
        try:
            p = subprocess.run(c, shell=True, cwd=cwd, capture_output=True,
                               text=True, timeout=CMD_TIMEOUT_S, env=env)
            code = p.returncode
            out = p.stdout + p.stderr
            tail = out[-2000:]
            # zero tests executed is an empty bar, not a pass — a renamed or
            # moved test file otherwise greens forever (criteria rot)
            if code == 0 and lib.vacuous_test_run(c, out):
                code = "zero-tests"
                tail = ("(RED: the runner reported zero tests executed — the "
                        "named file/selection matches nothing on this tree)\n"
                        + tail)
        except subprocess.TimeoutExpired:
            code, tail = "timeout", "(killed after %ds)" % CMD_TIMEOUT_S
        except FileNotFoundError:  # cwd vanished between the isdir and spawn
            code, tail = "tree-vanished", ("(the private worktree disappeared "
                                           "as this check started — no "
                                           "verdict; re-run receipt.py)")
        green = green and code == 0
        results.append({"cmd": c, "exit": code, "output_tail": tail})
        print("[exit %s] %s" % (code, c))
    return results, green


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: receipt.py <TICKET-ID>")
    tid = sys.argv[1]
    tickets = lib.load_all()
    if tid not in tickets:
        sys.exit("ERROR: no open ticket %s" % tid)
    t = tickets[tid]
    cmds = lib.criteria_commands(t["body"])
    if not cmds:
        sys.exit("ERROR: no machine-checkable command found in %s — no receipt "
                 "can be computed (fail-closed). Add commands the structured "
                 "way ('ticket.py amend-checks %s --check \"<cmd>\"', stored "
                 "in a '## Checks' block and run verbatim); that fix belongs "
                 "to the architect." % (tid, tid))
    # a graded command OBSERVES the tree; it may not write the tracker it is
    # being graded against (BUG-0073 — the commands are replayed on every
    # receipt, so a writing check edits the tracker with no author and no end).
    # Scoped to THIS tracker home, not a global switch: the factory's own test
    # suite is a graded command and its scratch factories write legitimately.
    env = dict(os.environ)
    env[lib.GRADING_ENV] = lib.ROOT
    scope = t["front"].get("touch_scope") or lib.default_scope()
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=lib.PRODUCT,
                          capture_output=True, text=True).stdout.strip()
    cfg = lib.load_run_config()
    tree = isolated_tree(head, [g for g in cfg["receipt_link_paths"].split(",")
                                if g.strip()])
    if tree is None:
        print("WARNING: could not create a private worktree at %s — checks "
              "run in the shared checkout (receipt stamped isolation: none)"
              % head[:8], file=sys.stderr)
    try:
        results, green = run_checks(cmds, tree or lib.PRODUCT, env)
    finally:
        if tree:
            subprocess.run(["git", "worktree", "remove", "--force", tree],
                           cwd=lib.PRODUCT, capture_output=True)
            shutil.rmtree(tree, ignore_errors=True)
    receipt = {
        "id": tid, "created": lib.now_iso(), "green": green,
        "git_head": head, "scope": scope,
        "isolation": "worktree" if tree else "none",
        "foreign_files": foreign_files(scope),
        # hashed AFTER the commands ran: any later edit to the scope makes
        # the receipt stale and the done gate will refuse it
        "tree_hash": lib.scope_tree_hash(scope),
        "commands": results,
    }
    if not green:
        # circuit-breaker feed (A3): fingerprint HOW it failed, persisted on
        # the ticket so the counter survives sessions. Consecutive identical
        # signatures are the doom-loop signal the dispatcher trips on.
        sig = lib.failure_signature(
            "\n".join("%s => exit %s\n%s" % (r["cmd"], r["exit"], r["output_tail"])
                      for r in results if r["exit"] != 0))
        receipt["failure_sig"] = sig
        same = (t["front"].get("same_failure_count") or 0) + 1 \
            if t["front"].get("last_failure_sig") == sig else 1
        t["front"]["last_failure_sig"] = sig
        t["front"]["same_failure_count"] = same
        seen = t["front"].get("seen_failure_sigs") or []
        if sig not in seen:
            t["front"]["seen_failure_sigs"] = (seen + [sig])[-20:]
        lib.append_history(t, "receipt", "RED receipt: failure signature %s "
                           "(same failure %dx)" % (sig, same))
        lib.write_ticket(t)
    os.makedirs(lib.RECEIPTS, exist_ok=True)
    path = os.path.join(lib.RECEIPTS, tid + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(receipt, f, indent=1)
    print("receipt %s: %s" % ("GREEN" if green else "RED",
                              os.path.relpath(path, lib.ROOT)))
    sys.exit(0 if green else 1)


if __name__ == "__main__":
    main()
