#!/usr/bin/env python3
"""notify.py — the factory's single notification seam.

    python3 agenticflow/scripts/notify.py <kind> [--title "..."] [--body "..."]

Appends one JSON event line to tracker/events.jsonl and, when run.yaml sets
`notify_command`, pipes the event JSON to that command's stdin. That is the
factory's ENTIRE knowledge of notifications: delivery (phone push, ntfy,
anything) belongs to whatever tails the events file or receives the command —
a companion add-on, never a factory requirement.

Kinds in use: `attention` (the orchestrator session stopped mid-run — gate
question, blocked question, crash-pause; emitted mechanically by the Stop
hook), `run_complete` (emitted by the close sequence). New kinds need no
code change here.

Never blocks and never fails the caller: a notification miss is a display
gap, not a reason to stop a run.
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind")
    ap.add_argument("--title", default="")
    ap.add_argument("--body", default="")
    a = ap.parse_args()
    repo_root = os.path.dirname(lib.ROOT)
    event = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "kind": a.kind,
        "title": a.title or a.kind.replace("_", " "),
        "body": a.body,
        "project": os.path.basename(repo_root),
    }
    try:
        with open(os.path.join(lib.ROOT, "tracker", "events.jsonl"), "a",
                  encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
    except OSError:
        pass
    cmd = str(lib.load_run_config().get("notify_command", "")).strip()
    if cmd:
        try:
            subprocess.run(cmd, shell=True, input=json.dumps(event),
                           text=True, timeout=10, cwd=repo_root,
                           capture_output=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
    sys.exit(0)
