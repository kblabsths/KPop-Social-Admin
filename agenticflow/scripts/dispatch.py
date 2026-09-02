#!/usr/bin/env python3
"""Dispatcher deterministic core. Run once per tick, before the scheduler thinks.

Zero-token bookkeeping:
  1. Maintain parent<->children links.
  2. Watchdog sweep: release stale claims, flag long-blocked and rotting tickets.
  3. Land built ticket branches onto the run branch (branch-per-ticket, v0.3-A);
     bounce landing conflicts back to builders.
  4. Regenerate tracker/INDEX.md (the only global view anyone reads).
  5. Compute the eligible set (deps done, leaves only, priority order), assign
     up to the free builder slots, and create each assignment's worktree.
  6. Flag compaction candidates and forced tickets.

Prints a JSON plan for the scheduler tick. Exits 3 if the kill switch
(tracker/RUNNING deleted) is engaged.
"""
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

RUNNING = os.path.join(lib.ROOT, "tracker", "RUNNING")
WORKTREES = os.path.join(lib.ROOT, ".worktrees")
CLOSING = os.path.join(lib.ROOT, "tracker", "CLOSING")
HEARTBEAT = os.path.join(lib.ROOT, "tracker", "HEARTBEAT")
BLOCKED_STATE = os.path.join(lib.ROOT, "tracker", "blocked_state.json")
OVERSIZED_SEEN = os.path.join(lib.ROOT, "tracker", "oversized_seen.json")
FOR_HUMAN = os.path.join(lib.ROOT, "tracker", "for-human")
FOR_HUMAN_SEEN = os.path.join(lib.ROOT, "tracker", "for_human_seen.json")


def minutes_since(iso):
    if not iso:
        return 0
    then = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - then).total_seconds() / 60.0


def iso_epoch(iso):
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ") \
        .replace(tzinfo=timezone.utc).timestamp()


def newest_mtime(rel_paths):
    """Newest file mtime under the given repo-relative paths (0.0 if nothing
    exists). Vendored/derived dirs skipped — an agent touching only those is
    not making progress on its ticket anyway."""
    skip = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache"}
    newest = 0.0
    for rel in rel_paths:
        top = os.path.join(lib.PRODUCT, rel)
        if os.path.isfile(top):
            newest = max(newest, os.path.getmtime(top))
            continue
        for dirpath, dirnames, filenames in os.walk(top):
            dirnames[:] = [d for d in dirnames if d not in skip]
            for n in filenames:
                try:
                    newest = max(newest, os.path.getmtime(os.path.join(dirpath, n)))
                except OSError:
                    pass
    return newest


def norm_pkg(name):
    """PEP 503 name normalization: importlib_metadata == importlib-metadata."""
    return re.sub(r"[-_.]+", "-", name).lower()


def allowed_pip_names():
    """Package entries under '## pip' in the allowlist (pip:<file> entries skipped)."""
    path = os.path.join(lib.ROOT, "docs", "ALLOWED_DEPS.md")
    names, section = set(), None
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if line.startswith("## "):
                section = line[3:].strip().lower()
            elif section == "pip":
                m = re.match(r"^\s*-\s*([^\s#(]+)", line)
                if m and ":" not in m.group(1):
                    names.add(norm_pkg(m.group(1)))
    return names


def unvetted_installs():
    """{venv: [packages]} present in a .venv but absent from the pip allowlist.
    The supply gate vets install *commands*; pip's transitives arrive unnamed —
    this audits what actually landed (dist-info dirs == pip freeze, no subprocess)."""
    allowed = allowed_pip_names()
    seeded = {"pip", "setuptools", "wheel"}  # created with the venv, not installed
    bad = {}
    pat = os.path.join(lib.PRODUCT, "*", ".venv", "lib", "python*", "site-packages", "*.dist-info")
    for info in glob.glob(pat):
        name = norm_pkg(os.path.basename(info)[:-len(".dist-info")].rsplit("-", 1)[0])
        if name in allowed or name in seeded:
            continue
        venv = os.path.relpath(info, lib.PRODUCT).split(os.sep + ".venv" + os.sep)[0] + "/.venv"
        bad.setdefault(venv, set()).add(name)
    return bad


def git_at(path, *args):
    """Run git in the given checkout; returns CompletedProcess."""
    return subprocess.run(["git", "-C", path] + list(args),
                          capture_output=True, text=True, timeout=120)


USAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usage.py")
RESUME_CAP_FALLBACK = 100000  # until three fresh returns exist (kspace M1
                              # builder average completion, 2026-08-28)


def usage_reading(ceiling):
    """usage.py's JSON, or {"unknown": True} when it cannot answer."""
    try:
        r = subprocess.run([sys.executable, USAGE, "--ceiling", str(ceiling)],
                           capture_output=True, text=True, timeout=40)
        return json.loads(r.stdout)
    except Exception as e:  # never let a cost optimisation halt a tick
        return {"unknown": True,
                "reason": "usage.py failed: %s" % type(e).__name__}


def resume_caps():
    """Per-role context ceiling for resuming a warm agent by SendMessage.

    A resume re-sends the agent's whole context every turn, so past some
    size a fresh spawn is cheaper: the ceiling is the median context of this
    run's FRESH returns (the first return row of each role+ticket pair in
    the ledger; resumes add later rows to the same pair). kspace M1 resumed
    one architect ~40 times on a 100-300k context under a fixed "prefer the
    warm agent" rule and billed 10.1M — a third of the milestone. Measured
    per run, not a constant: the fallback holds only until three fresh
    returns of a role exist."""
    samples, seen = {}, set()
    try:
        with open(lib.SPAWN_LOG, encoding="utf-8") as f:
            rows = f.read().splitlines()
    except OSError:
        rows = []
    start = max((i for i, ln in enumerate(rows) if ln.startswith("# run")),
                default=-1)
    for ln in rows[start + 1:]:
        p = ln.split("\t")
        if ln.startswith("#") or len(p) < 6 or p[3] == "spawned":
            continue
        if (p[1], p[2]) in seen:
            continue
        seen.add((p[1], p[2]))
        if p[5].isdigit():
            samples.setdefault(p[1], []).append(int(p[5]))
    caps = {role: sorted(xs)[len(xs) // 2]
            for role, xs in samples.items() if len(xs) >= 3}
    for role in ("builder", "architect"):
        caps.setdefault(role, RESUME_CAP_FALLBACK)
    return caps


def git_primary(*args):
    return git_at(lib.PRODUCT, *args)


def push_run_branch(run_branch, cfg, flags):
    """Back up the ACTIVE run branch to origin — refs-only, non-fatal.

    2026-08-31: run/data-model was 227 commits ahead of origin and
    run/adapters 132 — whole campaigns on one disk; the intake checklist
    gates the FIRST push only. Ben approved an automatic, tunable cadence.
    Push at natural checkpoints (a landing/close this tick, or an idle
    tick) and at the ahead-count backstop. Never main, never ticket
    branches; a failed push is a flag, never a halt."""
    if not run_branch.startswith("run/"):
        return
    try:
        if git_primary("remote", "get-url", "origin").returncode != 0:
            return  # no remote configured — nothing to back up to
        ahead_out = git_primary("rev-list", "--count",
                                "@{u}..HEAD").stdout.strip()
        have_upstream = ahead_out.isdigit()
        ahead = int(ahead_out) if have_upstream else 0
        checkpoint = any(f.get("kind") in ("landed", "land_empty")
                         for f in flags)
        due = (not have_upstream) or (ahead and (
            checkpoint or not flags
            or ahead >= cfg["push_cadence_max_ahead"]))
        if not due:
            return
        r = git_primary("push", "origin", "HEAD") if have_upstream             else git_primary("push", "-u", "origin", run_branch)
        if r.returncode != 0:
            flags.append({"kind": "push_failed", "branch": run_branch,
                          "note": "run-branch backup push failed (non-fatal): "
                                  + ((r.stderr or "").strip()[:200] or "unknown")})
    except Exception as e:  # a backup must never halt a tick
        flags.append({"kind": "push_failed", "branch": run_branch,
                      "note": "run-branch backup push errored (non-fatal): "
                              + type(e).__name__})


def ticket_branches():
    out = git_primary("for-each-ref", "--format=%(refname:short)",
                      "refs/heads/ticket/").stdout
    return {ln.strip() for ln in out.splitlines() if ln.strip()}


def suffixed_branches(branches):
    """{ticket id: [ticket/<ID>-<n> ...]} — branches git suffixed because
    `ticket/<ID>` was still checked out in a stale worktree when the next
    attempt started. The landing loop matched the exact name only, so such
    a branch was never merged AND the ticket was still batched to QA as
    built — QA attacked a tree the fix never reached, and the reverse case
    (a bar the previous attempt already satisfied) computes a green receipt
    over code the fix never touched (BUG-0033 attempts 2 and 3, 2026-08-13)."""
    found = {}
    for b in branches:
        m = re.match(r"ticket/([A-Z]+-\d{4})-\d+$", b)
        if m:
            found.setdefault(m.group(1), []).append(b)
    return found


def drop_worktree(tid, branch=None):
    """Remove a ticket's worktree (and optionally its branch). --force
    because the tree may hold volatile artifacts; the work itself is either
    merged or deliberately abandoned by the caller."""
    path = os.path.join(WORKTREES, tid)
    if os.path.isdir(path):
        git_primary("worktree", "remove", "--force", path)
    if branch:
        git_primary("branch", "-D", branch)


def blocking_incidents():
    """Proposals whose frontmatter says `severity: blocking` — a machinery
    defect that stops work from landing or closing. The factory never
    repairs itself, so the only correct move is: pause the run, page the
    human (the Stop hook does the paging when the orchestrator halts with
    RUNNING present). The human fixes the kit, then downgrades or removes
    the severity line to resume. Dev-cadence behavior; what a production
    release should do instead is an open question (Ben, 2026-08-10)."""
    pdir = os.path.join(lib.ROOT, "tracker", "proposals")
    hits = []
    for name in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
        if not name.endswith(".md"):
            continue
        try:
            with open(os.path.join(pdir, name), encoding="utf-8") as f:
                head = [next(f, "").strip() for _ in range(10)]
        except OSError:
            continue
        if head[0] == "---" and any(
                re.match(r"severity:\s*blocking\b", ln) for ln in head[1:]):
            hits.append(name)
    return hits


def main():
    check_kill = "--ignore-kill" not in sys.argv
    if check_kill and not os.path.exists(RUNNING):
        msg = "kill switch engaged (tracker/RUNNING absent)"
        if os.path.exists(os.path.join(lib.ROOT, "tracker", "PARKED")):
            msg = ("campaign is PARKED (the watchdog gave up relaunching a "
                   "dead session) — a /ship resume promotes it back to "
                   "RUNNING; until then nothing runs and the gates are "
                   "disarmed")
        print(json.dumps({"halt": msg}))
        sys.exit(3)
    incidents = blocking_incidents()
    if incidents:
        print(json.dumps({"halt": "blocking machinery incident: %s — the "
                          "factory never repairs itself. Tell the human what "
                          "broke and stop; they fix the kit and downgrade "
                          "the proposal's severity line to resume."
                          % ", ".join(incidents)}))
        sys.exit(3)

    cfg = lib.load_run_config()
    tickets = lib.load_all()
    flags = []

    # 0. heartbeat: proof the dispatcher is ticking, for outside observers
    #    (bgmon). Observed activity, not a self-report — this line only runs
    #    when a tick actually ran.
    with open(HEARTBEAT, "w", encoding="utf-8") as f:
        f.write(lib.now_iso() + "\n")

    # 0b. done-intent marker: a stop decision touches tracker/CLOSING before
    #     the close sequence and removes it after. Finding one here means a
    #     session died mid-close — finish the close, do not start new work.
    if os.path.exists(CLOSING):
        flags.append({"kind": "closing_marker",
                      "age_minutes": round((datetime.now(timezone.utc).timestamp()
                                            - os.path.getmtime(CLOSING)) / 60),
                      "note": "a stop was decided but never completed — finish the "
                              "close sequence (digest, commit, delete CLOSING then "
                              "RUNNING); do not assign new work"})

    # 1. parent<->children maintenance (archive included — an archived child
    #    still belongs to its parent; forgetting it breaks parent auto-close)
    child_map = {}
    for tid, t in lib.load_all(include_archive=True).items():
        parent = t["front"].get("parent")
        if parent:
            child_map.setdefault(parent, []).append(tid)
    for tid, t in tickets.items():
        want = sorted(child_map.get(tid, []))
        have = sorted(t["front"].get("children", []))
        if want != have:
            t["front"]["children"] = want
            lib.write_ticket(t)

    # 1b. parent auto-close: a parent whose children are all done/wont_fix is done
    #     (design: "parents aggregate status and are never worked directly")
    all_known = lib.load_all(include_archive=True)
    closed = {tid for tid, t in all_known.items()
              if t["front"]["status"] in ("done", "wont_fix")}
    for tid, t in tickets.items():
        kids = t["front"].get("children", [])
        if not kids or t["front"]["status"] in ("done", "wont_fix") \
                or not all(k in closed for k in kids):
            continue
        if len(kids) < 2:
            # A lone closed child is what a fan-out-in-progress looks like:
            # FEAT-0007 auto-closed on its single planning child with none of
            # the real work existing (2026-08-11) — between the planning
            # ticket closing and the fan-out being filed, "all children
            # closed" is true and means the opposite of done.
            flags.append({"kind": "parent_awaiting_fanout", "id": tid,
                          "note": "its only child closed — if a fan-out is "
                                  "still coming, file it; if that child truly "
                                  "was the whole deliverable, close the "
                                  "parent by ruling (architect/strategist), "
                                  "never auto"})
            continue
        t["front"]["status"] = "done"
        lib.append_history(t, "dispatcher", "auto-closed: all children done/wont_fix")
        lib.write_ticket(t)
        flags.append({"kind": "parent_autoclosed", "id": tid})

    # 2. watchdog sweep. --session-start releases ALL claims: agents cannot
    #    survive a session boundary, so any claim found at preflight is dead —
    #    without this, a crash orphans its ticket for stale_claim_minutes.
    #    The timer remains only as an in-session backstop.
    session_start = "--session-start" in sys.argv
    # A factory artifact that git ignores does not survive a worktree prune
    # or a landing merge (2026-08-11: two device walks lost; the verifier's
    # own "durable record" path was untracked). The kit cannot know a
    # product's ignore rules; git can, in one call each. Report, never
    # override — the ignore is usually the product's deliberate
    # personal-data policy.
    if session_start:
        durable = ["agenticflow/tracker/notes", "agenticflow/tracker/digests",
                   "agenticflow/tracker/proposals",
                   "agenticflow/tracker/milestones"]
        ignored = [p for p in durable if subprocess.run(
            ["git", "check-ignore", "-q", p], cwd=lib.PRODUCT,
            capture_output=True).returncode == 0]
        if ignored:
            flags.append({"kind": "untracked_factory_paths", "paths": ignored,
                          "note": "these outputs will not survive a worktree "
                                  "or a merge — findings written here must "
                                  "also be written into ticket History"})
    # who is actually in flight, per the spawn ledger — the stale-claim
    # release below must never sentence a live agent by clock alone
    # (2026-08-11: two builders released mid-work at 90m; one delivered
    # finished work ten minutes after being declared dead), and QA batching
    # must not re-offer a ticket a reviewer is already attacking
    ledger_rows = lib.spawn_ledger_running()
    live = {r["ticket"] for r in ledger_rows}
    # blocked-ticket dedup (P1): remember each blocked ticket's blocker
    # fingerprint; only flag when it CHANGED or the recheck backstop is due —
    # re-concluding "still blocked" about an undisturbed ticket every tick
    # is pure spend.
    try:
        with open(BLOCKED_STATE, encoding="utf-8") as fh:
            blocked_state = json.load(fh)
    except Exception:
        blocked_state = {}
    blocked_seen = set()
    # oversized-body dedup: the flag is informational and nothing an agent
    # does can shrink an immutable body, so saying it every tick is a nag
    # with a price (kspace 2026-08-13: 14 compactor spawns bought 12
    # "irreducible: fresh History" rubber-stamp raises — the only legal
    # silencer was a compactor/human raise, so an "informational" flag
    # taxed one spawn per contract-dense ticket). Fire once per ticket.
    try:
        with open(OVERSIZED_SEEN, encoding="utf-8") as fh:
            oversized_seen = json.load(fh)
    except Exception:
        oversized_seen = {}
    try:
        with open(FOR_HUMAN_SEEN, encoding="utf-8") as fh:
            for_human_seen = json.load(fh)
    except Exception:
        for_human_seen = {}
    for tid, t in tickets.items():
        f = t["front"]
        if f["status"] == "claimed":
            age = minutes_since(f.get("claimed_at"))
            if not session_start and age > cfg["stale_claim_minutes"] \
                    and tid in live:
                # past the timer but the ledger says in flight: a crash and a
                # long think look identical here, so the crash case keeps its
                # route to a human via the 30-minute stalled_claim flag —
                # the busy case stops being sentenced by a clock
                flags.append({
                    "kind": "claim_aged_but_live", "id": tid,
                    "claimed_minutes": round(age),
                    "note": "past stale_claim_minutes but the spawn ledger "
                            "shows this agent in flight — NOT released. "
                            "Message the running agent; do not spawn a "
                            "second builder into its worktree"})
            elif session_start or age > cfg["stale_claim_minutes"]:
                why = ("session start: no agent survives a session boundary"
                       if session_start else "watchdog: stale claim released")
                f["status"], f["assignee"], f["claimed_at"] = "open", None, None
                # infra release: drop the claim snapshot without empty-diff
                # bookkeeping — a dead session is not an approach failure
                lib.drop_keys(t, ["claim_tree_hash"])
                lib.append_history(t, "dispatcher", why)
                lib.write_ticket(t)
                flags.append({"kind": "stale_released", "id": tid})
            elif age > cfg["stall_no_delta_minutes"] and f.get("claimed_at"):
                # Stall detection on OBSERVED artifact delta, not self-report:
                # a claim this old with zero file changes is a dead or wedged
                # agent long before the blunt stale timer fires. A claimed
                # ticket's worktree is exclusively its own, so ANY change
                # there counts; pre-worktree claims fall back to the scope.
                wt = os.path.join(WORKTREES, tid)
                probe = [wt] if os.path.isdir(wt) \
                    else (f.get("touch_scope") or lib.default_scope())
                if newest_mtime(probe) < iso_epoch(f["claimed_at"]):
                    flags.append({
                        "kind": "stalled_claim", "id": tid,
                        "claimed_minutes": round(age), "scope_checked": probe,
                        "note": "no file modified under scope since claim — if no "
                                "live agent holds this ticket, release it NOW "
                                "(transition open --as dispatcher); never wait "
                                "for the stale timer"})
        if f["status"] == "blocked":
            blocked_seen.add(tid)
            # a blocked ticket addressed to the human ("ASK BEN …") lands in
            # the UI's Waiting-on-you panel the minute it is filed:
            # tracker/for-human/<ID>.md. Deleting the file is the human's
            # ack — never re-drop one (the seen ledger is the memory).
            # Proposal ui-surface-human-queue (kspace 2026-08-12): TASK-0022's
            # ruling sat for hours in streams that scroll away.
            m = re.search(r"^# (.+)$", t["body"], re.MULTILINE)
            title = m.group(1).strip() if m else tid
            if title.upper().startswith("ASK BEN") \
                    and tid not in for_human_seen:
                os.makedirs(FOR_HUMAN, exist_ok=True)
                with open(os.path.join(FOR_HUMAN, tid + ".md"), "w",
                          encoding="utf-8") as fh:
                    fh.write("%s\n\nUnblocks: %s\n" % (title, tid))
                for_human_seen[tid] = lib.now_iso()
            history = [l for l in t["body"].splitlines() if l.startswith("- 20")]
            last_iso = history[-1].split()[1] if history else None
            # fingerprint = this ticket's own text (any comment/reply changes
            # it) + the current status of everything it depends on
            dep_states = ";".join(
                "%s:%s" % (d, all_known.get(d, {}).get("front", {}).get("status", "?"))
                for d in f.get("depends_on", []))
            fp = hashlib.sha256((t["body"] + "|" + dep_states)
                                .encode("utf-8")).hexdigest()[:16]
            prev = blocked_state.get(tid) or {}
            changed = fp != prev.get("fp")
            backstop_due = bool(prev.get("flagged_at")) and minutes_since(
                prev["flagged_at"]) > cfg["blocked_recheck_hours"] * 60
            if changed or backstop_due:
                flags.append({
                    "kind": "blocked", "id": tid,
                    "idle_minutes": round(minutes_since(last_iso)) if last_iso else None,
                    "why_flagged": ("blocker state changed since last check"
                                    if changed and prev else "first check"
                                    if not prev else "%dh recheck backstop"
                                    % cfg["blocked_recheck_hours"]),
                    "note": "re-check blocker; unblock or surface in digest"})
                blocked_state[tid] = {"fp": fp, "flagged_at": lib.now_iso()}
        if f.get("recheck") and f["status"] in ("built", "qa", "done"):
            flags.append({"kind": "contract_recheck", "id": tid,
                          "amended": f["recheck"],
                          "note": "a dependency contract changed after this work — "
                                  "re-verify; clear via ticket.py recheck, or reopen"})
        if f.get("force") and f["status"] in ("open", "reopened"):
            flags.append({"kind": "forced", "id": tid,
                          "note": "human-forced: genuine attempt + evidence required"})
        # Compaction flag is status-aware (M1: 3 correct flags fired mid-bounce
        # and post-done, got ignored, and the retro mislabeled them false
        # positives). Not `claimed` (compactor would race the active builder),
        # not done/wont_fix (pointless), and measured on HISTORY, not the
        # whole file: History is the only section the compactor may rewrite,
        # so a big contract/criteria body with a modest History cannot be
        # compacted at any level of aggressiveness (2026-08-11: 11 flags,
        # 8 compactor spawns, 293 bytes shed — 10 of 11 were body-heavy).
        size = os.path.getsize(t["path"])
        hist_at = t["body"].find("## History")
        hist_bytes = len(t["body"]) - hist_at if hist_at >= 0 else 0
        # history_bytes is the WHOLE section — the quantity a compactor must
        # fit under the threshold. It used to be the post-summary delta on
        # already-compacted tickets (an anti-treadmill hack from 2026-07-16
        # that predates raise-compact-threshold), which under-reported 3.5x
        # and silently never re-dispatched compactions that were genuinely
        # needed (KV TASK-0071, 2026-08-11: reported 3,937 of an actual
        # 13,685). The treadmill's sanctioned brake is now the raise: a
        # compacted-but-still-large ticket re-flags until a compactor either
        # sheds or raises. The delta rides along as new_since_compaction.
        mark = t["body"].rfind("[compacted →")
        new_bytes = None
        if mark >= 0:
            nxt = t["body"].find("\n- 20", mark)
            new_bytes = len(t["body"]) - nxt if nxt >= 0 else 0
        # per-ticket override (compactor raise-compact-threshold): an
        # irreducible ticket carries its own bar so it stops re-flagging
        thr = f.get("compact_threshold") or cfg["compact_threshold_bytes"]
        # never built/qa either: a ticket about to close is the one whose
        # History its reviewer is reading right now (dispatcher habit
        # adopted 2026-08-28, "never compact a ticket about to close")
        if hist_bytes > thr \
                and f["status"] not in ("claimed", "built", "qa", "done",
                                        "wont_fix"):
            flag = {"kind": "compact_candidate", "id": tid, "bytes": size,
                    "history_bytes": hist_bytes,
                    "note": "spawn compactor (quiet window — act this "
                            "tick); if an honest attempt concludes the "
                            "ticket is irreducible, raise-compact-"
                            "threshold instead of mangling it"}
            if new_bytes is not None:
                flag["new_since_compaction"] = new_bytes
            flags.append(flag)
        elif size - hist_bytes > thr \
                and f["status"] not in ("done", "wont_fix") \
                and tid not in oversized_seen:
            # informational, spawns nobody, and said ONCE per ticket: the
            # immutable sections alone exceed the bar, which no compactor
            # may touch — a split is an architect's ruling, not a
            # compactor's. No raise is needed to silence it; the dedup
            # ledger is the silencer.
            oversized_seen[tid] = size - hist_bytes
            flags.append({"kind": "oversized_body", "id": tid,
                          "body_bytes": size - hist_bytes,
                          "note": "description/contract/criteria alone exceed "
                                  "the compaction threshold — nothing to "
                                  "compact and nobody to spawn; if it reads "
                                  "bloated, queue an architect split; if it "
                                  "is legitimately dense, no action (this "
                                  "flag will not repeat)"})

    # forget dedup state for tickets that left blocked (unblocked or closed)
    for tid in [k for k in blocked_state if k not in blocked_seen]:
        del blocked_state[tid]
    with open(BLOCKED_STATE, "w", encoding="utf-8") as fh:
        json.dump(blocked_state, fh, indent=1)
    with open(OVERSIZED_SEEN, "w", encoding="utf-8") as fh:
        json.dump(oversized_seen, fh, indent=1)
    with open(FOR_HUMAN_SEEN, "w", encoding="utf-8") as fh:
        json.dump(for_human_seen, fh, indent=1)

    # 2b. branch-per-ticket landing (v0.3-A): a `built` ticket whose
    #     ticket/<ID> branch still exists was handed off but not yet merged.
    #     The builder already rebased onto the run branch and re-verified, so
    #     landing is mechanical; a conflict means another ticket landed first
    #     — bounce it back to a builder (conflict resolution is agent work,
    #     never done blind here). QA and the receipt run only AFTER the land,
    #     on the run branch, so a bad resolution cannot close a ticket.
    run_branch = git_primary("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    branches = ticket_branches()
    suffixed = suffixed_branches(branches)
    for tid, t in sorted(tickets.items()):
        f = t["front"]
        br = "ticket/" + tid
        if f["status"] != "built":
            continue
        if br not in branches:
            if tid in suffixed:
                flags.append({"kind": "land_branch_suffixed", "id": tid,
                              "branches": sorted(suffixed[tid]),
                              "note": "built, but its branch carries a suffix "
                                      "(a stale worktree held ticket/%s) — "
                                      "not landed and not batched to QA; "
                                      "remove the stale worktree, rename the "
                                      "branch to ticket/%s, it lands next "
                                      "tick" % (tid, tid)})
            continue
        # Landing dep-gate (2026-07-19): depends_on gated ASSIGNMENT but not
        # landing, so a ticket whose dependency regressed or was retro-added
        # while it sat `built` could land ahead of its foundation and redden
        # the run branch. Same contract, second station: unmet deps hold the
        # merge; the ticket stays built and lands once the foundation is
        # done (done ONLY — cancelled ≠ resolved).
        unmet = [d for d in f.get("depends_on", [])
                 if all_known.get(d, {}).get("front", {}).get("status") != "done"]
        if unmet:
            flags.append({"kind": "land_deps_unmet", "id": tid,
                          "deps": unmet,
                          "note": "built, but its foundation is not done — "
                                  "holding the merge; lands automatically once "
                                  "the deps close (a wont_fix dep needs "
                                  "re-evaluation via set-depends instead)"})
            continue
        wt = os.path.join(WORKTREES, tid)
        ahead = git_primary("rev-list", "--count",
                            "%s..%s" % (run_branch, br)).stdout.strip()
        if ahead == "0":
            # nothing committed on the branch: either the builder forgot to
            # commit (work sits uncommitted in the worktree — bounce, never
            # silently drop it) or a genuine no-change handoff (pass to QA)
            dirty = os.path.isdir(wt) and \
                git_at(wt, "status", "--porcelain").stdout.strip()
            if dirty:
                f["status"], f["assignee"], f["claimed_at"] = "reopened", None, None
                lib.append_history(t, "dispatcher",
                                   "handoff without commits: the worktree holds "
                                   "uncommitted work — commit it on %s, rebase onto "
                                   "%s, re-verify, hand off again" % (br, run_branch))
                lib.write_ticket(t)
                flags.append({"kind": "land_uncommitted", "id": tid,
                              "note": "bounced to reopened; flows back through the "
                                      "builder lane — no action needed"})
            else:
                lib.append_history(t, "dispatcher",
                                   "nothing to land: %s has no commits and a clean "
                                   "worktree — on to QA as-is" % br)
                lib.write_ticket(t)
                drop_worktree(tid, br)
                flags.append({"kind": "land_empty", "id": tid})
            continue
        r = git_primary("merge", "--no-ff", "--no-edit",
                        "-m", "land %s (ticket branch merge)" % tid, br)
        if r.returncode == 0:
            sha = git_primary("rev-parse", "--short", "HEAD").stdout.strip()
            lib.append_history(t, "dispatcher",
                               "landed %s onto %s as %s" % (br, run_branch, sha))
            lib.write_ticket(t)
            drop_worktree(tid, br)
            flags.append({"kind": "landed", "id": tid, "merge": sha})
        elif git_primary("rev-parse", "-q", "--verify",
                         "MERGE_HEAD").returncode == 0:
            git_primary("merge", "--abort")
            f["status"], f["assignee"], f["claimed_at"] = "reopened", None, None
            lib.append_history(t, "dispatcher",
                               "landing conflict: %s no longer merges cleanly into "
                               "%s (another ticket landed first) — rebase the branch "
                               "onto current %s in the worktree, resolve, re-verify, "
                               "hand off again" % (br, run_branch, run_branch))
            lib.write_ticket(t)
            flags.append({"kind": "land_conflict", "id": tid,
                          "note": "bounced to reopened; flows back through the "
                                  "builder lane — no action needed"})
        else:
            flags.append({"kind": "land_blocked", "id": tid,
                          "git_says": (r.stderr or r.stdout).strip()[-300:],
                          "note": "merge refused without a conflict (dirty "
                                  "overlapping file in the primary checkout?) — "
                                  "clear the obstacle; the ticket stays built and "
                                  "lands next tick"})
    # worktree hygiene: a worktree whose ticket left the board (done/wont_fix/
    # archived) is finished business. open/reopened/blocked keep theirs — a
    # bounced ticket's branch holds the work the next attempt continues from.
    if os.path.isdir(WORKTREES):
        for name in sorted(os.listdir(WORKTREES)):
            if name.startswith("."):
                continue
            if name.startswith("_receipt-"):
                # a live receipt's private checkout — receipt.py owns its
                # lifecycle. This sweep deleted them mid-check three times on
                # 2026-08-30 (its ticket lookup answers None for the name),
                # once grading a PASSED live suite as exit 1.
                continue
            st = tickets.get(name, {}).get("front", {}).get("status")
            if st in (None, "done", "wont_fix"):
                drop_worktree(name, "ticket/" + name)
        git_primary("worktree", "prune")
    branches = ticket_branches()  # refresh after landings/cleanup
    suffixed = suffixed_branches(branches)

    # 2c. supply-chain audit: unvetted packages that actually landed in a venv
    for venv, pkgs in sorted(unvetted_installs().items()):
        flags.append({"kind": "unvetted_deps", "venv": venv, "packages": sorted(pkgs),
                      "note": "spawn toolsmith: vet (file/close a DEP + allowlist) or uninstall"})

    # 3. INDEX.md — one line per open ticket, grouped by status
    # Dependency satisfaction is DONE ONLY (P2): a wont_fix dependency does
    # not satisfy depends_on — the work it promised never happened. Building
    # on it anyway is building on a missing foundation; cancelled ≠ resolved.
    all_current = lib.load_all(include_archive=True)
    done_set = {tid for tid, t in all_current.items()
                if t["front"]["status"] == "done"}
    wontfix_set = {tid for tid, t in all_current.items()
                   if t["front"]["status"] == "wont_fix"}
    groups = {}
    for tid, t in tickets.items():
        groups.setdefault(t["front"]["status"], []).append(t)
    lines = ["# Tracker index (regenerated %s — do not edit)" % lib.now_iso(), ""]
    for status in lib.STATUSES:
        if status in ("done", "wont_fix") or status not in groups:
            continue
        lines.append("## %s" % status)
        for t in sorted(groups[status], key=lambda t: (t["front"].get("priority") or "P2", t["front"]["id"])):
            f = t["front"]
            title = t["body"].splitlines()[0].lstrip("# ").strip() if t["body"].strip() else ""
            extras = []
            if f.get("depends_on"):
                unmet = [d for d in f["depends_on"] if d not in done_set]
                extras.append("deps:" + ",".join(f["depends_on"]) + ("(unmet:%d)" % len(unmet) if unmet else ""))
            if f.get("touch_scope"):
                extras.append("scope:" + ",".join(f["touch_scope"]))
            if f.get("assignee"):
                extras.append("@" + f["assignee"])
            if f.get("discovered_from"):
                extras.append("from:" + f["discovered_from"])
            if f.get("force"):
                extras.append("FORCED")
            if f.get("needs_device"):
                extras.append("DEVICE")
            if f.get("recheck"):
                extras.append("RECHECK:" + ",".join(f["recheck"]))
            lines.append("- %s [%s][%s][%s] %s%s" % (
                f["id"], f.get("priority") or "P?", f.get("type", "?"),
                f.get("milestone") or "-", title,
                ("  (" + " ".join(extras) + ")") if extras else ""))
        lines.append("")
    counts = ", ".join("%s:%d" % (s, len(g)) for s, g in sorted(groups.items()))
    lines.append("Totals — %s. Archived: %d." % (
        counts or "empty", len([n for n in os.listdir(lib.ARCHIVE) if n.endswith(".md")])
        if os.path.isdir(lib.ARCHIVE) else 0))
    with open(lib.INDEX, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    # 3b. mirror the newest digest to root DIGEST.md — the human reads the
    #     repo root, not tracker/digests/ (Ben couldn't find the last one).
    digest_dir = os.path.join(lib.ROOT, "tracker", "digests")
    names = sorted(n for n in os.listdir(digest_dir) if n.endswith(".md")) \
        if os.path.isdir(digest_dir) else []
    if names:  # YYYY-MM-DD names: lexicographic == chronological
        with open(os.path.join(digest_dir, names[-1]), encoding="utf-8") as f:
            latest = f.read()
        dst = os.path.join(lib.ROOT, "DIGEST.md")
        if not os.path.exists(dst) or open(dst, encoding="utf-8").read() != latest:
            with open(dst, "w", encoding="utf-8") as f:
                f.write(latest)

    # 4. eligible set: open/reopened leaves with all deps done, priority order;
    #    assignment fills the free builder slots and gives each ticket its own
    #    worktree + branch (v0.3-A). touch_scope no longer schedules — it is a
    #    declaration (stall probes, self-scan, QA blast radius); git is the
    #    isolation, and landing conflicts bounce to builders to resolve.
    #    DEP tickets are excluded — they belong to the toolsmith (dep_queue),
    #    never to builders (eligibility used to be type-blind).
    eligible, dep_queue = [], []
    for tid, t in tickets.items():
        f = t["front"]
        if f["status"] not in ("open", "reopened"):
            continue
        if (f.get("type") or "").lower() == "dep":
            dep_queue.append(tid)
            continue
        if f.get("children"):
            continue
        dead_deps = [d for d in f.get("depends_on", []) if d in wontfix_set]
        if dead_deps:
            # not merely unmet — unmeetable as written. Route re-evaluation
            # with the new information instead of letting it sit forever.
            flags.append({
                "kind": "dep_wont_fixed", "id": tid, "deps": dead_deps,
                "note": "depends on wont_fix'd work (reason in the dep's "
                        "History) — cannot proceed as written; spawn the "
                        "strategist to re-evaluate: cut this too, redesign "
                        "it (architect), or replace the dependency edge "
                        "(ticket.py set-depends)"})
            continue
        if any(d not in done_set for d in f.get("depends_on", [])):
            continue
        # circuit breaker (A3): a tripped ticket leaves the builder queue —
        # more same-shaped retries are pure spend. Routing, not retrying:
        # the architect changes the inputs (rewrite/split), then
        # `ticket.py breaker-reset`. Human force overrides (and resets).
        if not f.get("force") and (
                (f.get("empty_diffs") or 0) >= cfg["breaker_empty_diffs"]
                or (f.get("same_failure_count") or 0) >= cfg["breaker_same_failure"]):
            flags.append({
                "kind": "breaker_tripped", "id": tid,
                "attempts": f.get("attempts") or 0,
                "empty_diffs": f.get("empty_diffs") or 0,
                "same_failure_count": f.get("same_failure_count") or 0,
                "note": "held out of the builder queue — spawn the architect "
                        "(split-or-escalate: change the inputs, then "
                        "breaker-reset), or block it into the digest"})
            continue
        eligible.append(t)
    eligible.sort(key=lambda t: ((0 if t["front"].get("force") else 1),
                                 t["front"].get("priority") or "P2", t["front"]["id"]))
    in_flight = sum(1 for t in tickets.values()
                    if t["front"]["status"] == "claimed")
    # usage throttle: two HTTP 429 outages killed 13 lanes mid-work (kspace
    # 2026-08-28, ~1M dead tokens plus rebuilds). A 429 is account-wide and
    # simultaneous, so only pacing BEFORE it helps: at/above the ceiling
    # running lanes finish and nothing new is offered.
    throttled = False
    if cfg["usage_ceiling_5h"]:
        u = usage_reading(cfg["usage_ceiling_5h"])
        if u.get("throttle"):
            throttled = True
            flags.append({"kind": "throttled", "reason": u.get("reason"),
                          "resets_at": (u.get("five_hour") or {}).get("resets_at"),
                          "note": "5-hour usage window at/above usage_ceiling_5h "
                                  "— no assignments or QA batches this tick; "
                                  "spawn nothing new, let running lanes "
                                  "finish, tick again after resets_at"})
        elif u.get("unknown"):
            flags.append({"kind": "usage_unknown", "reason": u.get("reason"),
                          "note": "the usage reading failed; not throttling "
                                  "(a cost optimisation never idles a run) — "
                                  "note it in the digest if it persists"})
    slots = 0 if throttled else max(0, cfg["builders"] - in_flight)
    assign = [t["front"]["id"] for t in eligible[:slots]]

    # each assignment gets a worktree on branch ticket/<ID>, created here so
    # the lifecycle is deterministic. An existing worktree (bounced ticket) is
    # reused — its branch holds the previous attempt's work.
    worktrees = {}
    for tid in list(assign):
        path = os.path.join(WORKTREES, tid)
        br = "ticket/" + tid
        if not os.path.isdir(path):
            os.makedirs(WORKTREES, exist_ok=True)
            r = git_primary(*(["worktree", "add", path, br] if br in branches
                              else ["worktree", "add", "-b", br, path, "HEAD"]))
            if r.returncode != 0:
                assign.remove(tid)
                flags.append({"kind": "worktree_failed", "id": tid,
                              "git_says": (r.stderr or r.stdout).strip()[-300:],
                              "note": "assignment dropped this tick; fix the "
                                      "cause and the next tick retries"})
                continue
            # gitignored dependency trees do not exist in a fresh worktree,
            # so it cannot run tests: share the primary's by symlink — a
            # venv binary resolves its own site-packages and vitest's bin
            # shim its own package tree, so tools run fine from here.
            # (node_modules: four builders per run hand-rolled and deleted
            # this link, 2026-08-04/-11; one duplicated a 1.2 GB install.)
            # NOT "*/android": a gradle project is not a dependency tree, it
            # is a build system rooted at its PARENT, so a symlinked
            # android/ bundles the primary checkout's sources no matter
            # which worktree invoked it — createBundleReleaseJsAndAssets
            # reported UP-TO-DATE against a builder's own edits (KV
            # BUG-0071, 2026-08-11). A worktree with no android/ fails
            # loudly and says to prebuild; a linked one silently measures
            # another tree. A tracked dir is already present in the
            # worktree, so the exists() guard skips it.
            for pat in ("*/.venv", "*/node_modules"):
                for dep in glob.glob(os.path.join(lib.PRODUCT, pat)):
                    dst = os.path.join(path, os.path.relpath(dep, lib.PRODUCT))
                    if not os.path.exists(dst):
                        os.symlink(dep, dst)
        worktrees[tid] = os.path.relpath(path, lib.PRODUCT)

    # Worktrees isolate builds, not landings: two tickets landing in the same
    # destination file force a full re-derive (2026-07-24: ~150k tokens).
    # Scheduling stays scope-blind — a declared scope is an upper bound and
    # often coarse — but a same-path overlap among this tick's assignments
    # and in-flight claims is surfaced so the architect can chain them
    # deliberately (2026-08-11: eight tickets hand-serialised into two
    # chains after the third manual catch).
    # Overlap, not equality: a scope naming a FILE and another naming its
    # DIRECTORY are one lane (BUG-0123 `supabase/migrations/2026…sql` vs
    # BUG-0125 `supabase/migrations` — two migration writers on one staging
    # DB, missed silently and caught by hand, 2026-08-22). Keyed by the
    # broader path.
    entries = []
    for t in tickets.values():
        f = t["front"]
        if f["id"] in assign or f["status"] == "claimed":
            for p in f.get("touch_scope") or []:
                entries.append((p.rstrip("/"), f["id"]))
    contested = {}
    for p, a in entries:
        for q, b in entries:
            if a != b and (p == q or q.startswith(p + "/")):
                contested.setdefault(p, set()).update({a, b})
    if contested:
        flags.append({"kind": "scope_collision",
                      "ids": sorted(set.union(*contested.values())),
                      "paths": sorted(contested),
                      "note": "co-dispatched tickets declare the same "
                              "destination file(s) — worktrees isolate "
                              "builds, not landings (2026-07-24: ~150k "
                              "tokens of re-derive). Chain them with "
                              "ticket.py set-depends, or accept the "
                              "collision deliberately"})

    # QA attacks landed code only: a built ticket whose branch still exists
    # has not merged yet (its land was blocked) and is not attackable.
    # Batched by parent: siblings under one FEAT share one QA spawn (one
    # integrated attack, per-ticket closes); parentless tickets pool per tick.
    batch_groups = {}
    for t in tickets.values():
        f = t["front"]
        if f["status"] == "built" and ("ticket/" + f["id"]) not in branches \
                and f["id"] not in suffixed:
            batch_groups.setdefault(f.get("parent") or "-", []).append(f["id"])
    # A ticket leaves qa_batches only when its reviewer runs built→qa — so
    # until then every tick re-offers it, even with a QA lane in flight
    # (KV BUG-0050, 2026-08-11: three hours of re-offers, then a duplicate
    # attack — 61,879 tokens and 7h52m to learn nothing new). The ledger
    # already knows. Below the knob the factory decides (a young lane is not
    # a corpse); above it the offer stands, PRICED — the duplicate lane was
    # right on the numbers once, and silent suppression would have argued
    # the dispatcher into waiting on a pathological lane forever.
    live_qa = {}
    for r in ledger_rows:
        if r["role"] == "qa-adversary" and r["ticket"] != "-":
            live_qa.setdefault(r["ticket"], []).append(r["ts"])
    for group in batch_groups.values():
        for tid in list(group):
            spawns = live_qa.get(tid) or []
            if not spawns:
                continue
            age = minutes_since(min(spawns))
            if age <= cfg["qa_relaunch_minutes"]:
                group.remove(tid)
                flags.append({
                    "kind": "qa_in_flight", "id": tid,
                    "lanes": len(spawns), "oldest_minutes": round(age),
                    "note": "a qa-adversary is in flight on this ticket "
                            "(unmatched spawn row). NOT re-offered. It "
                            "cannot be asked and cannot be cancelled; its "
                            "findings arrive only in its handoff"})
            else:
                flags.append({
                    "kind": "qa_overrun", "id": tid,
                    "lanes": len(spawns), "oldest_minutes": round(age),
                    "note": "qa lane past qa_relaunch_minutes. STILL "
                            "OFFERED, deliberately: spawning is a second "
                            "full attack (fresh APK, fresh AVD, no shared "
                            "context), and the first lane will still return "
                            "and still bill. Spawn if the ticket blocks the "
                            "milestone; otherwise wait"})
    # qa_batch_patience: a lone built P2/P3 ticket whose batch-mates are
    # still flowing waits up to N ticks for company — one QA attack over a
    # real batch instead of a lane per ticket (KV: 124 QA spawns for 142
    # builds, ~45% of role-hours, batches of one). P0/P1 never wait; no
    # batch-mates in flight = no wait; the counter persists across ticks.
    patience = cfg["qa_batch_patience"]
    pat_path = os.path.join(lib.ROOT, "tracker", "qa_patience.json")
    if patience:
        try:
            with open(pat_path, encoding="utf-8") as fh:
                waited = json.load(fh)
        except Exception:
            waited = {}
        held_now = set()
        for key, group in batch_groups.items():
            if len(group) != 1:
                continue
            tid = group[0]
            f = tickets[tid]["front"]
            if (f.get("priority") or "P2") in ("P0", "P1"):
                continue
            pval = None if key == "-" else key
            # batch-mates are LEAVES of the same group: a parent ticket is
            # never worked or QA'd, so it is not company worth waiting for
            flowing = any(o["front"].get("parent") == pval
                          and o["front"]["id"] != tid
                          and not o["front"].get("children")
                          and o["front"]["status"] in ("open", "reopened",
                                                       "claimed")
                          for o in tickets.values())
            n = waited.get(tid, 0)
            if flowing and n < patience:
                waited[tid] = n + 1
                held_now.add(tid)
                group.remove(tid)
                flags.append({
                    "kind": "qa_batch_waiting", "id": tid,
                    "ticks_waited": n + 1,
                    "note": "built, holding for batch-mates still in "
                            "flight (%d/%d ticks) — one QA attack over a "
                            "real batch beats a lane per ticket; offers "
                            "next tick at the latest once patience runs "
                            "out" % (n + 1, patience)})
        for tid in [k for k in waited if k not in held_now]:
            del waited[tid]
        with open(pat_path, "w", encoding="utf-8") as fh:
            json.dump(waited, fh, indent=1)
    qa_batches = [] if throttled else \
        [sorted(ids) for _, ids in sorted(batch_groups.items()) if ids]

    # Device work is a machine-wide, one-at-a-time resource (the emulator
    # lease). More than one device-stamped lane in flight at once means a
    # queue at the lease — guidance, not a gate: merge same-project device
    # passes into one walk, or sequence the spawns (Ben, 2026-08-11).
    device_ids = sorted(
        f["id"] for f in (t["front"] for t in tickets.values())
        if f.get("needs_device")
        and (f["id"] in assign or f["status"] == "claimed"
             or any(f["id"] in b for b in qa_batches)))
    if len(device_ids) > 1:
        flags.append({
            "kind": "device_contention", "ids": device_ids,
            "note": "multiple device-stamped lanes would be in flight, but "
                    "the machine runs ONE emulator across all factories — "
                    "they will queue at the lease. Prefer ONE walk covering "
                    "them (a QA batch's device pass is one lease turn), or "
                    "sequence the spawns; never spawn them all and let the "
                    "lease sort it out"})
    inbox = [n for n in os.listdir(os.path.join(lib.ROOT, "tracker", "inbox"))
             if not n.startswith(".")]

    # early walk (dev cadence): the first FEAT of a milestone closing while
    # the milestone still has open work fires ONE walk — problems with the
    # design bars surface while they are cheap. The orchestrator appends an
    # "early_walk:" line to the milestone file after running it (the dedupe).
    ms_dir = os.path.join(lib.ROOT, "tracker", "milestones")
    active_ms = {t["front"].get("milestone") or "" for t in tickets.values()
                 if t["front"]["status"] in
                 ("open", "reopened", "claimed", "built", "qa")}
    for ms in sorted(m for m in active_ms if m and m.lower() != "patch"):
        mpath = os.path.join(ms_dir, ms + ".md")
        if not os.path.exists(mpath) \
                or "early_walk" in open(mpath, encoding="utf-8").read():
            continue
        if any(t["front"].get("milestone") == ms
               and (t["front"].get("type") or "").lower() == "feat"
               and t["front"]["status"] == "done"
               for t in all_current.values()):
            flags.append({
                "kind": "early_walk_due", "milestone": ms,
                "note": "first FEAT of the milestone is done — spawn ONE "
                        "designer or user-sim walk scoped to what exists, "
                        "then append 'early_walk: <date> fired' to the "
                        "milestone file so this fires once"})

    push_run_branch(run_branch, cfg, flags)
    print(json.dumps({
        "assign_to_builders": assign,
        "worktrees": worktrees,
        "run_branch": run_branch,
        "dep_queue": sorted(dep_queue),
        "qa_batches": qa_batches,
        "resume_cap": resume_caps(),
        "eligible_backlog": [t["front"]["id"] for t in eligible],
        "inbox": sorted(inbox),
        "flags": flags,
        "config": cfg,
    }, indent=2))


if __name__ == "__main__":
    main()
