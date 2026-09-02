#!/usr/bin/env python3
"""stall_probe.py — how long since the run REALLY moved, and has it already
told the human it is waiting?  Prints:  <idle_seconds> <announced yes|no>

Used by factory_watchdog.sh. HEARTBEAT alone false-positives (2026-07-31:
an endgame walk froze the heartbeat 52 min while the session worked), so
activity = newest of HEARTBEAT, the spawn ledger, and the orchestrator
session's transcript file, which moves continuously while the model works.
`announced` is yes when the latest attention event postdates that activity —
the run already told the human it is waiting (gate question, blocked ask),
his silence is intentional, and the watchdog must neither push nor nudge
(one push per pause is the design)."""
import glob
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

FACTORY = sys.argv[1] if len(sys.argv) > 1 else \
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROJECT = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(FACTORY)
TRACKER = os.path.join(FACTORY, "tracker")


def mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0


def main():
    last = max(mtime(os.path.join(TRACKER, "HEARTBEAT")),
               mtime(os.path.join(TRACKER, "spawn_log.tsv")))
    try:
        with open(os.path.join(TRACKER, "ORCHESTRATOR_SESSION")) as f:
            sid = f.read().strip()
        tdir = os.path.join(os.path.expanduser("~/.claude/projects"),
                            re.sub(r"[^A-Za-z0-9]", "-", PROJECT))
        last = max(last, mtime(os.path.join(tdir, sid + ".jsonl")))
        for sub in glob.glob(os.path.join(tdir, sid, "subagents",
                                          "agent-*.jsonl")):
            last = max(last, mtime(sub))
    except OSError:
        pass
    announced = 0
    try:
        with open(os.path.join(TRACKER, "events.jsonl")) as f:
            for ln in f:
                try:
                    e = json.loads(ln)
                except ValueError:
                    continue
                if e.get("kind") != "attention":
                    continue
                try:
                    announced = max(announced, datetime.strptime(
                        e["ts"], "%Y-%m-%dT%H:%M:%SZ")
                        .replace(tzinfo=timezone.utc).timestamp())
                except (KeyError, ValueError):
                    pass
    except OSError:
        pass
    idle = max(0, int(time.time() - last)) if last else 0
    # 60s slack: the event and the final activity land in either order
    print(idle, "yes" if announced and announced >= last - 60 else "no")


if __name__ == "__main__":
    main()
