#!/usr/bin/env python3
"""CI-repair loop (A6): the full suite is never silently red.

Run once per dispatch tick (self-skips when the app tree hasn't changed
since the last check, so the suite only runs after real edits). Behavior:

  red, no repair BUG open  -> auto-file exactly one P0 BUG carrying the
                              failing tests, the log tail, and the diff
                              since the last green commit — that IS the
                              work packet.
  red, repair BUG open     -> measure PROGRESS, not attempts: progress =
                              the failure signature moved. Same signature
                              as last attempt = a strike; any previously
                              seen signature revisited = oscillation =
                              instant trip. Strikes/oscillation (or the
                              runaway total cap) -> BUG blocked + digest.
                              A healthy multi-cause chain (10 different
                              failures fixed one by one) never trips it:
                              the cap is on futility, never on fixes.
  green                    -> record the baseline; an open repair BUG
                              closes through the normal built->qa->done
                              path, not here.

Failures that pre-existed the baseline are attributed honestly: the filed
BUG only blames a diff when a last-green commit exists to diff against.

Safe to launch in the background (the dispatcher's async net, v0.3-B): a
lockfile refuses overlapping runs, and a run whose tree changed mid-suite
(a ticket landed while it ran) is discarded as `torn` — its results
describe a tree that no longer exists, and filing on them is how spurious
P0s happen. The stale hash means the next tick simply re-checks.

State: tracker/ci_state.json. Usage: ci_check.py [--force]
"""
import atexit
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

STATE = os.path.join(lib.ROOT, "tracker", "ci_state.json")
LOCK = os.path.join(lib.ROOT, "tracker", "ci_check.lock")
SUITE_TIMEOUT_S = 1800


def load_state():
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    return {"tree_hash": None, "last_green_commit": None, "status": None,
            "open_bug": None, "last_sig": None, "seen_sigs": [],
            "strikes": 0, "attempts": 0}


def save_state(s):
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=1)


def finish(state, **result):
    save_state(state)
    print(json.dumps(result, indent=1))
    sys.exit(0)


def git(*args):
    return subprocess.run(["git"] + list(args), cwd=lib.PRODUCT,
                          capture_output=True, text=True).stdout.strip()


def open_ci_bug():
    """The live open repair BUG, if any (state's open_bug is only a cache —
    the tracker is the source of truth)."""
    for tid, t in lib.load_all().items():
        first = t["body"].splitlines()[0] if t["body"].strip() else ""
        if tid.startswith("BUG-") and first.startswith("# CI red:") \
                and t["front"]["status"] not in ("done", "wont_fix"):
            return tid, t
    return None, None


def main():
    cfg = lib.load_run_config()
    cmd = cfg["ci_command"]
    # Change detection watches ci_scope, not product_dir: a product whose
    # tests or data live beside the app dir went red invisibly — the
    # reddening commit, the reddened tests, and the watched scope were three
    # disjoint directories (2026-08-10). default_scope() stays untouched;
    # it also feeds ticket scopes, stall probes and self-scan.
    ci_scope = [p.strip() for p in str(cfg["ci_scope"]).split(",")
                if p.strip()] or lib.default_scope()
    s = load_state()
    if not cmd:
        finish(s, status="disabled", note="set ci_command in run.yaml")
    # overlap guard: two concurrent runs would race ci_state.json and could
    # double-file the repair BUG. A lock older than the suite timeout is a
    # dead run's leftover — take it over.
    if os.path.exists(LOCK) and \
            time.time() - os.path.getmtime(LOCK) < SUITE_TIMEOUT_S + 120:
        print(json.dumps({"status": "locked",
                          "note": "another ci_check is running — skipped"}, indent=1))
        sys.exit(0)
    with open(LOCK, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    atexit.register(lambda: os.path.exists(LOCK) and os.remove(LOCK))
    tree = lib.scope_tree_hash(ci_scope)
    if tree == s.get("tree_hash") and "--force" not in sys.argv:
        finish(s, status="skipped", note="app tree unchanged since last check")

    # A dirty product tree means concurrent builders are mid-edit; the suite
    # would run against a half-applied state and red on tests owned by
    # in-flight tickets (BUG-0050: a spurious P0 whose own diff-since-green
    # was "(no committed delta)"). A6 protects the COMMITTED baseline from
    # silent red, not transient in-flight state — defer until the tree
    # settles. Scoped to product_dir so tracker churn never blocks the check.
    # Volatile artifacts (databases, logs — scope_tree_hash's skip_suffix)
    # are ignored here too: a tracked quiz.db mutates on every app/test run
    # and would otherwise keep this guard deferring forever.
    if "--force" not in sys.argv:
        volatile = (".log", ".coverage", ".db", ".sqlite", ".sqlite3", ".pyc")
        dirty = [ln for ln in
                 git("status", "--porcelain", "--", *ci_scope).splitlines()
                 if ln.strip() and not ln[3:].split(" -> ")[-1].endswith(volatile)]
        if dirty:
            finish(s, status="skipped",
                   note="product tree dirty (%d uncommitted path(s)) — "
                        "deferring CI check until in-flight edits settle" % len(dirty))

    try:
        p = subprocess.run(cmd, shell=True, cwd=lib.PRODUCT, capture_output=True,
                           text=True, timeout=SUITE_TIMEOUT_S)
        code, output = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        code, output = -1, "(suite killed after %ds — treat as red)" % SUITE_TIMEOUT_S
    # torn-run guard: a ticket landing mid-suite means these results describe
    # a tree that no longer exists. Discard without touching tree_hash — the
    # stale hash makes the next tick re-check the settled tree.
    if lib.scope_tree_hash(ci_scope) != tree:
        finish(s, status="torn",
               note="tree changed mid-suite (a ticket landed?) — results "
                    "discarded; re-checks next tick")
    s["tree_hash"] = tree
    head = git("rev-parse", "HEAD")

    if code == 0:
        note = None
        if s.get("open_bug"):
            note = ("suite green again — %s closes through the normal "
                    "built→qa→done path (receipt-gated), not here" % s["open_bug"])
        s.update({"status": "green", "last_green_commit": head,
                  "open_bug": None, "last_sig": None, "seen_sigs": [],
                  "strikes": 0, "attempts": 0})
        finish(s, status="green", note=note)

    # --- red ---
    sig = lib.failure_signature(output)
    failing = sorted(set(re.findall(r"^(?:FAILED|ERROR)\s+(\S+)", output, re.M)))
    s["status"] = "red"
    bug_id, bug = open_ci_bug()

    if not bug_id:
        # newly red: file exactly one P0 repair BUG; the packet is the failure
        base = s.get("last_green_commit")
        diff = (git("diff", "--stat", base + "..HEAD") or "(no committed delta)") \
            if base else "(no green baseline recorded — failure may pre-date this run)"
        desc = ("Full suite red. Failing (%d): %s. Failure signature %s. "
                "Diff since last green %s: %s. Log tail: %s"
                % (len(failing), ", ".join(failing[:15]) or "(unparsed)", sig,
                   base[:8] if base else "(none)", diff[:600],
                   output[-1200:].replace("\n", " / ")))
        r = subprocess.run(
            [sys.executable, os.path.join(lib.ROOT, "scripts", "ticket.py"),
             "new", "--type", "BUG", "--as", "dispatcher", "--priority", "P0",
             "--scope", cfg["product_dir"],
             "--title", "CI red: %d failing test(s)" % max(len(failing), 1),
             "--description", desc,
             "--criteria", "`%s` exits 0" % cmd],
            capture_output=True, text=True)
        tid = r.stdout.strip().splitlines()[-1] if r.returncode == 0 else None
        if not tid:
            finish(s, status="red", error="failed to file repair BUG",
                   detail=r.stderr[-500:])
        s.update({"open_bug": tid, "last_sig": sig, "seen_sigs": [sig],
                  "strikes": 0, "attempts": 1})
        finish(s, status="red", action="filed %s (P0, packet = failure log + diff)" % tid,
               failing=len(failing), signature=sig)

    # repair BUG already open: this run is one repair attempt — judge progress
    s["open_bug"] = bug_id
    s["attempts"] = (s.get("attempts") or 0) + 1
    if sig == s.get("last_sig"):
        s["strikes"] = (s.get("strikes") or 0) + 1
        progress = "none — signature unmoved (strike %d)" % s["strikes"]
    elif sig in (s.get("seen_sigs") or []):
        s["strikes"] = cfg["ci_no_progress_strikes"]  # oscillation = instant trip
        progress = "oscillation — signature seen before (instant trip)"
    else:
        s["strikes"] = 0
        progress = "yes — new failure signature (fixing one failure surfaced the next)"
    s["last_sig"] = sig
    if sig not in (s.get("seen_sigs") or []):
        s["seen_sigs"] = ((s.get("seen_sigs") or []) + [sig])[-20:]

    tripped = s["strikes"] >= cfg["ci_no_progress_strikes"] \
        or s["attempts"] >= cfg["ci_max_attempts"]
    action = None
    if tripped and bug["front"]["status"] in ("open", "reopened"):
        why = ("no progress: failure signature stuck after %d attempt(s)"
               % s["attempts"]) if s["strikes"] >= cfg["ci_no_progress_strikes"] \
            else "runaway cap: %d repair attempts" % s["attempts"]
        subprocess.run(
            [sys.executable, os.path.join(lib.ROOT, "scripts", "ticket.py"),
             "transition", bug_id, "blocked", "--as", "dispatcher",
             "--note", "CI breaker: %s — needs architect or human; "
             "surface in digest" % why],
            capture_output=True, text=True)
        action = "breaker tripped — %s blocked (%s); put it in the digest" % (bug_id, why)
    finish(s, status="red", bug=bug_id, progress=progress,
           attempts=s["attempts"], action=action)


if __name__ == "__main__":
    main()
