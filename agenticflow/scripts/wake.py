#!/usr/bin/env python3
"""wake.py — deliver a remote human reply into the run and resume it.

    python3 agenticflow/scripts/wake.py "<the human's answer>" [--source phone]

The remote-answer path (companion app phase 2). The reply always lands as a
`tracker/inbox/` note — the established steering channel, drained at Phase 0
and every tick. What happens next depends on the session owning SESSION_LOCK
(the 2026-07-28/30 lessons: killing a working seat is gratuitous, and
headless `-p` relaunches lose the seat and murder in-flight background
agents at print mode's 600s ceiling):

- lives in our tmux session   -> nudge it (send-keys `/ship auto-resume`);
                                 an idle prompt executes it, a mid-turn
                                 session just queues it
- alive, agents in flight     -> note only; the tick will read it
- alive but turn-idle         -> kill it and relaunch INTO TMUX, so the seat
                                 stays attachable (tracker/ATTACH, the UI's
                                 Now view, and the push all carry the
                                 copy-pasteable attach command)
- dead / missing / reused PID -> relaunch into tmux

No tmux on the machine (or AF_NO_TMUX=1, used by tests)? Fallback is the
old headless relaunch, with CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 so
background agents are never killed at the ceiling.

No run in flight (no RUNNING)? The note still lands and drains at the next
run — the reply is never lost, only the wake is skipped.

Emits a notify.py event either way, so the phone hears back what happened.
CLAUDE_BIN overrides the claude binary (tests use /usr/bin/true).
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

TRACKER = os.path.join(lib.ROOT, "tracker")
SCRIPTS = os.path.dirname(os.path.abspath(__file__))


def notify(kind, body):
    subprocess.run([sys.executable, os.path.join(SCRIPTS, "notify.py"),
                    kind, "--body", body], capture_output=True, timeout=15)


def write_note(text, source):
    now = datetime.now(timezone.utc)
    path = os.path.join(TRACKER, "inbox",
                        "%s-%s-reply.md" % (now.strftime("%Y-%m-%d-%H%M%S"), source))
    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "# Reply from the human (via %s)\n\nfiled: %s\n\n%s\n\n"
            "(This answers whatever the factory asked when it last paused — "
            "treat it as the human's word on that question.)\n"
            % (source, now.strftime("%Y-%m-%d %H:%M UTC"), text.strip()))
    return path


def tmux_bin():
    if os.environ.get("AF_NO_TMUX"):
        return None
    return shutil.which("tmux")


def session_name():
    name = os.path.basename(os.path.dirname(lib.ROOT))
    return "af-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def attach_command():
    return "tmux attach -t %s" % session_name()


def _pane_pid(tmux, session):
    r = subprocess.run([tmux, "list-panes", "-t", session, "-F", "#{pane_pid}"],
                       capture_output=True, text=True)
    out = r.stdout.strip().splitlines()
    try:
        return int(out[0]) if r.returncode == 0 and out else None
    except ValueError:
        return None


def in_our_tmux(pid):
    tmux = tmux_bin()
    return bool(tmux) and _pane_pid(tmux, session_name()) == pid


def agents_in_flight(max_age_min=90):
    """Unmatched 'spawned' ledger lines younger than the stale cap — the
    same reading as the notify_stop hook (keep the two in sync)."""
    n = 0
    try:
        spawned, returned = [], {}
        with open(os.path.join(TRACKER, "spawn_log.tsv"), encoding="utf-8") as f:
            for ln in f:
                if ln.startswith("#"):
                    continue
                p = ln.rstrip("\n").split("\t")
                if len(p) < 4:
                    continue
                if p[3] == "spawned":
                    spawned.append(p)
                else:
                    returned[(p[1], p[2])] = returned.get((p[1], p[2]), 0) + 1
        now = datetime.now(timezone.utc)
        for p in spawned:
            key = (p[1], p[2])
            if returned.get(key, 0) > 0:
                returned[key] -= 1
                continue
            try:
                t0 = datetime.strptime(p[0], "%Y-%m-%dT%H:%M:%SZ") \
                    .replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if (now - t0).total_seconds() <= max_age_min * 60:
                n += 1
    except OSError:
        pass
    return n


def owning_claude_pid():
    """SESSION_LOCK's PID if that process is alive AND is a claude session;
    None otherwise (dead, missing, or a reused PID that is not ours to kill)."""
    try:
        with open(os.path.join(TRACKER, "SESSION_LOCK")) as f:
            pid = int("".join(ch for ch in f.read() if ch.isdigit()) or 0)
    except OSError:
        return None
    if pid <= 1:
        return None
    r = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                       capture_output=True, text=True)
    if r.returncode != 0 or "claude" not in r.stdout:
        return None
    return pid


def kill_session(pid):
    os.kill(pid, 15)
    for _ in range(20):
        time.sleep(0.5)
        if subprocess.run(["ps", "-p", str(pid)], capture_output=True).returncode:
            return
    os.kill(pid, 9)


def _claude_bin():
    claude = os.environ.get("CLAUDE_BIN")
    if not claude:
        claude = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
    return claude


def relaunch():
    claude = _claude_bin()
    log = open(os.path.join(TRACKER, "watchdog.log"), "a")
    log.write("%s wake.py: remote reply delivered — relaunching /ship\n"
              % datetime.now().strftime("%F %T"))
    log.flush()
    tmux = tmux_bin()
    if tmux:
        session = session_name()
        subprocess.run([tmux, "kill-session", "-t", session],
                       capture_output=True)
        r = subprocess.run(
            [tmux, "new-session", "-d", "-s", session,
             "-c", os.path.dirname(lib.ROOT),
             "%s '/ship auto-resume' --dangerously-skip-permissions" % claude],
            capture_output=True, text=True)
        pid = _pane_pid(tmux, session) if r.returncode == 0 else None
        if pid:
            with open(os.path.join(TRACKER, "SESSION_LOCK"), "w") as f:
                f.write("%d\n" % pid)
            with open(os.path.join(TRACKER, "ATTACH"), "w") as f:
                f.write(attach_command() + "\n")
            return pid, attach_command()
        log.write("%s wake.py: tmux launch failed (%s) — headless fallback\n"
                  % (datetime.now().strftime("%F %T"),
                     (r.stderr or "session died at launch").strip()))
        log.flush()
    env = dict(os.environ, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="0")
    p = subprocess.Popen([claude, "-p", "/ship auto-resume",
                          "--dangerously-skip-permissions"],
                         cwd=os.path.dirname(lib.ROOT), stdout=log, stderr=log,
                         start_new_session=True, env=env)
    with open(os.path.join(TRACKER, "SESSION_LOCK"), "w") as f:
        f.write("%d\n" % p.pid)
    return p.pid, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--source", default="phone")
    a = ap.parse_args()
    if not a.text.strip():
        print("empty reply — nothing filed")
        return 1
    note = write_note(a.text, a.source)
    print("reply filed: %s" % note)
    if not os.path.exists(os.path.join(TRACKER, "RUNNING")):
        notify("reply_filed",
               "No run in flight — your reply is saved and will steer the next run.")
        return 0
    pid = owning_claude_pid()
    if pid and in_our_tmux(pid):
        subprocess.run([tmux_bin(), "send-keys", "-t", session_name(),
                        "/ship auto-resume", "Enter"], capture_output=True)
        print("nudged tmux session %s (pid %d)" % (session_name(), pid))
        notify("resumed", "Reply delivered into the live session. "
               "Seat: %s" % attach_command())
        return 0
    if pid and agents_in_flight():
        print("session %d is mid-work (agents in flight) — note only" % pid)
        notify("reply_filed",
               "Run is mid-work; your reply lands at the next tick.")
        return 0
    if pid:
        print("killing turn-idle session %d (tracker state is the memory)" % pid)
        kill_session(pid)
    new_pid, attach = relaunch()
    print("relaunched as %d%s" % (new_pid,
          " (%s)" % attach if attach else " (headless fallback)"))
    notify("resumed", "Your reply was delivered; the run is resuming."
           + (" Seat: %s" % attach if attach else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
