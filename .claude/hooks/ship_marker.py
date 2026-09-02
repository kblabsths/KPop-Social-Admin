#!/usr/bin/env python3
"""UserPromptSubmit hook: record which session is the /ship orchestrator.

When a prompt invoking /ship arrives, write the session's ID to
agenticflow/tracker/ORCHESTRATOR_SESSION. The attention UI (agenticflow/scripts/ui.py) uses this to
show live telemetry for THE run's session only — without it, any Claude
session the human has open in this repo would be indistinguishable from the
factory (they share a transcript directory). Never blocks anything; exits 0
no matter what.
"""
import json
import os
import sys


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    prompt = (payload.get("prompt") or "").lstrip()
    # typed form ("/ship ...") or the command-XML form the harness delivers
    # for skill invocations ("<command-name>/ship</command-name>")
    if not (prompt.startswith("/ship") or "<command-name>/ship" in prompt):
        return
    sid = payload.get("session_id")
    root = os.environ.get("CLAUDE_PROJECT_DIR")
    if not sid or not root:
        return
    try:
        with open(os.path.join(root, "agenticflow", "tracker", "ORCHESTRATOR_SESSION"), "w") as f:
            f.write(sid + "\n")
    except OSError:
        pass
    # invocation boundary: one session can span several /ship invocations
    # (days apart) — the UI needs these timestamps to scope "this invocation"
    try:
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(root, "agenticflow", "tracker", "ship_invocations.tsv"), "a") as f:
            f.write("%s\t%s\n" % (ts, sid))
        # same boundary into the spawn ledger, so per-run spawn sums need no
        # cross-file join (ledger consumers skip '#' lines)
        with open(os.path.join(root, "agenticflow", "tracker", "spawn_log.tsv"), "a") as f:
            f.write("# run\t%s\t%s\n" % (ts, sid))
    except OSError:
        pass


if __name__ == "__main__":
    main()
    sys.exit(0)
