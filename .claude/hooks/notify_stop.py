#!/usr/bin/env python3
"""The factory's phone-notifier hook — pushes ONLY hard-blocking waits.

Ben's ruling (2026-08-13, kspace: 27 pushes in 19h, ~16 of them narration
or non-blocking): a push means "the run cannot proceed without you."
Nothing else reaches the phone. Only two triggers qualify, because both
are blocking BY CONSTRUCTION:

- **PreToolUse on AskUserQuestion**: the interactive option-picker. The
  Notification event does NOT fire for it (claude-code #59908), but
  PreToolUse fires at the moment of asking and its tool_input carries the
  full question + options — so the push says exactly what is being asked.
- **Notification, permission prompts only**: a permission prompt blocks
  the whole run no matter what agents are doing (2026-07-28: a sips
  prompt sat silent 67 minutes). Refire behavior is undocumented, so
  identical bodies within 10 minutes are dropped.

Turn-ends (Stop) deliberately push NOTHING: "my turn ended" is narration
timing, not need — every one of kspace's 16 turn-end pushes fired while
the run was progressing fine, and the one real overnight stall produced
no turn-end at all (that class belongs to the watchdog). Idle waits
("waiting for your input") were pure +60s echoes of the same turn-ends.
A mid-run pause that genuinely needs the human must announce itself:
AskUserQuestion pushes by itself; anything else runs
`notify.py attention` with the ask (SKILL doctrine), and run ends emit
their own run_complete.

Guards (all events): this session is the orchestrator (session_id matches
tracker/ORCHESTRATOR_SESSION, written by ship_marker.py at /ship) AND
tracker/RUNNING exists (the close sequence deletes RUNNING and emits its own
run_complete, so run ends do not double-fire here).

Never blocks: exits 0 no matter what.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

PROJECT = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    tracker = os.path.join(PROJECT, "agenticflow", "tracker")
    if not os.path.exists(os.path.join(tracker, "RUNNING")):
        return
    try:
        with open(os.path.join(tracker, "ORCHESTRATOR_SESSION")) as f:
            orch = f.read().strip()
    except OSError:
        return
    if not orch or payload.get("session_id") != orch:
        return
    event = payload.get("hook_event_name")
    if event == "PreToolUse":
        if payload.get("tool_name") != "AskUserQuestion":
            return
        title = "Factory question"
        body = _question_summary(payload.get("tool_input") or {})
    elif event == "Notification":
        # permission prompts only — idle waits and turn-ends never push
        if "permission" not in str(payload.get("message") or "").lower():
            return
        title = "Factory needs you"
        body = str(payload.get("message") or "")
        if _recent_duplicate(tracker, body):
            return
        # the prompt gating an AskUserQuestion arrives seconds after the
        # question push that already carried the full ask (kspace
        # 2026-08-12: both pairs 6s apart) — same block, one push
        if _recent_question(tracker):
            return
    else:
        return
    subprocess.run(
        [sys.executable,
         os.path.join(PROJECT, "agenticflow", "scripts", "notify.py"),
         "attention", "--title", title, "--body", body],
        capture_output=True, timeout=15)


def _question_summary(tool_input, limit=380):
    """'<question> — options: a / b / c' from an AskUserQuestion tool_input."""
    qs = tool_input.get("questions")
    if not isinstance(qs, list) or not qs:
        return ""
    q = qs[0] if isinstance(qs[0], dict) else {}
    text = str(q.get("question", "")).strip()
    labels = [str(o.get("label", "")).strip() for o in q.get("options", [])
              if isinstance(o, dict)]
    if labels:
        text += " — options: " + " / ".join(l for l in labels if l)
    if len(qs) > 1:
        text += " (+%d more questions)" % (len(qs) - 1)
    return text[:limit]


def _recent_question(tracker, window_s=90):
    """True if a Factory question push was emitted in the last window."""
    try:
        with open(os.path.join(tracker, "events.jsonl"), encoding="utf-8") as f:
            tail = f.readlines()[-10:]
        now = datetime.now(timezone.utc)
        for ln in tail:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            if e.get("title") != "Factory question":
                continue
            ts = datetime.strptime(e.get("ts", ""), "%Y-%m-%dT%H:%M:%SZ") \
                .replace(tzinfo=timezone.utc)
            if (now - ts).total_seconds() < window_s:
                return True
    except (OSError, ValueError):
        pass
    return False


def _recent_duplicate(tracker, body, window_s=600):
    """True if an identical attention body was emitted in the last window."""
    try:
        with open(os.path.join(tracker, "events.jsonl"), encoding="utf-8") as f:
            tail = f.readlines()[-20:]
        now = datetime.now(timezone.utc)
        for ln in tail:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            if e.get("kind") != "attention" or e.get("body") != body:
                continue
            ts = datetime.strptime(e.get("ts", ""), "%Y-%m-%dT%H:%M:%SZ") \
                .replace(tzinfo=timezone.utc)
            if (now - ts).total_seconds() < window_s:
                return True
    except (OSError, ValueError):
        pass
    return False


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
