#!/usr/bin/env python3
"""PreToolUse(Agent) + SubagentStop hook: write the spawn ledger mechanically.

The spawn ledger (tracker/spawn_log.tsv, two lines per agent — spawned at
launch, returned-with-tokens at exit) was originally the orchestrator's
DISCIPLINE: SKILL.md told it to write the lines, and in the first real run it
wrote none. This hook replaces discipline with mechanism — every Agent tool
call gets its lines written by the harness, and the orchestrator has nothing
to remember.

Why SubagentStop and not PostToolUse: subagents launch in the BACKGROUND by
default, so PostToolUse fires at launch with an ack (`status:
"async_launched"`) that carries no usage — four straight runs of zero-token
return lines stamped at spawn time. SubagentStop fires when the agent
actually finishes (foreground or background) and names the agent's own
transcript, which is where the truth lives: output tokens summed over its
assistant turns, elapsed from its first/last timestamps.

Format (ui.py and the strategist's spawn-economy retro parse it):
    <ISO8601>\t<role>\t<ticket|->\t<spawned | tokens-out | ->[\t<seconds>\t<context>]
Return lines carry a 5th column: seconds of transcript span (fallback: wall
time since the oldest unmatched 'spawned' line of the same role+ticket), and
a 6th: the agent's context size at its last turn (input + cache tokens of
the final assistant message) — dispatch.py's resume_cap reads it to decide
whether a SendMessage resume is still cheaper than a cold start.
Consumers index columns 0-3, tolerate the extra column, and skip lines
starting with '#' — ship_marker.py appends `# run` boundary lines at each
/ship invocation so sums can be scoped to one run.
An unpaired 'spawned' line IS the failure record of an agent that died.

Scope guards:
- only fires while tracker/RUNNING exists (a factory run) — the human's other
  Claude sessions in this repo spawn agents too, and those are none of the
  ledger's business;
- never blocks: exits 0 no matter what. A ledger miss is a display gap, not a
  reason to stop a spawn.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

PROJECT = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
# DEBT was missing from this alternation for the ledger's whole history —
# every DEBT agent got stamped with whatever other ID appeared first in its
# prompt, or '-', silently mis-costing DEBT work in the spawn-economy retro
# (KV, 2026-08-11)
TICKET_RE = re.compile(r"\b((?:FEAT|TASK|BUG|DEBT|DEP)-\d{4})\b")


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    if not os.path.exists(os.path.join(PROJECT, "agenticflow", "tracker", "RUNNING")):
        return
    log_path = os.path.join(PROJECT, "agenticflow", "tracker", "spawn_log.tsv")
    now = datetime.now(timezone.utc)
    event = payload.get("hook_event_name")
    if event == "SubagentStop":
        line = _stop_line(payload, log_path, now)
        _note_stranded(payload, log_path, now)
    elif event == "PreToolUse":
        tool_input = payload.get("tool_input") or {}
        role = str(tool_input.get("subagent_type") or "agent")[:40]
        blob = "%s %s" % (tool_input.get("description", ""),
                          str(tool_input.get("prompt", ""))[:2000])
        m = TICKET_RE.search(blob)
        line = "%s\t%s\tspawned" % (role, m.group(1) if m else "-")
    else:
        return  # PostToolUse et al. carry nothing the ledger trusts
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write("%s\t%s\n" % (now.strftime("%Y-%m-%dT%H:%M:%SZ"), line))
    except OSError:
        pass


def _note_stranded(payload, log_path, now):
    """A returning agent must leave the shared primary checkout clean.

    Builders work in worktrees; QA works in the primary checkout. A red pin
    written there and not committed is invisible to the builder dispatched to
    turn it green — twice in one run the dispatcher had to author the commit
    by hand (KV 1661a32, 6f62664), and once a builder was briefed on a test
    that existed on one disk only. Tracker paths are excluded: the dispatcher
    edits those constantly and legitimately. Never blocks; writes one '#'
    line, which every ledger consumer already skips by contract."""
    import subprocess
    try:
        out = subprocess.run(
            ["git", "-C", PROJECT, "status", "--porcelain",
             "--untracked-files=all"],
            capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return
    dirty = []
    for ln in out.splitlines():
        path = ln[3:].strip().strip('"')
        if not path or path.startswith("agenticflow/tracker/"):
            continue
        dirty.append(path)
    if not dirty:
        return
    role = str(payload.get("agent_type") or "agent")[:40]
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write("# STRANDED\t%s\t%s\t%d uncommitted in primary "
                    "checkout: %s\n"
                    % (now.strftime("%Y-%m-%dT%H:%M:%SZ"), role, len(dirty),
                       ", ".join(sorted(dirty)[:6])))
    except OSError:
        pass


def _stop_line(payload, log_path, now):
    """Return-line fields from the finished agent's own transcript."""
    role = str(payload.get("agent_type") or "agent")[:40]
    ticket, total, first_ts, last_ts, ctx = "-", None, None, None, None
    path = os.path.expanduser(str(payload.get("agent_transcript_path") or ""))
    try:
        with open(path, encoding="utf-8") as f:
            for ln in f:
                try:
                    e = json.loads(ln)
                except Exception:
                    continue
                ts = e.get("timestamp")
                if ts:
                    first_ts = first_ts or ts
                    last_ts = ts
                msg = e.get("message") or {}
                if ticket == "-" and e.get("type") == "user":
                    m = TICKET_RE.search(_text_of(msg)[:4000])
                    if m:
                        ticket = m.group(1)
                if e.get("type") == "assistant":
                    u = msg.get("usage") or {}
                    v = u.get("output_tokens")
                    if isinstance(v, int):
                        total = (total or 0) + v
                    c = sum(u.get(k) or 0 for k in
                            ("input_tokens", "cache_read_input_tokens",
                             "cache_creation_input_tokens"))
                    if c:
                        ctx = c
    except OSError:
        pass
    if ticket == "-":
        # ticket often rides the Agent call's description, which never reaches
        # the transcript — adopt it from the oldest unmatched spawned line
        ticket = _adopt_ticket(log_path, role)
    elapsed = _span(first_ts, last_ts)
    if elapsed is None:
        elapsed = _elapsed(log_path, role, ticket, now)
    return "%s\t%s\t%s\t%s\t%s" % (role, ticket,
                                   str(total) if total is not None else "-",
                                   elapsed, str(ctx) if ctx else "-")


def _text_of(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict))
    return ""


def _span(first_ts, last_ts):
    """Whole seconds between two transcript timestamps, or None."""
    try:
        a, b = (_parse_ts(first_ts), _parse_ts(last_ts))
        return str(int((b - a).total_seconds()))
    except Exception:
        return None


def _parse_ts(ts):
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(ts, fmt).replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
    raise ValueError(ts)


def _pairs(log_path, role):
    """[(ticket, ts), ...] of spawned lines and per-ticket return counts."""
    spawned, returned = [], {}
    with open(log_path, encoding="utf-8") as f:
        for ln in f:
            if ln.startswith("#"):
                continue
            parts = ln.rstrip("\n").split("\t")
            if len(parts) < 4 or parts[1] != role:
                continue
            if parts[3] == "spawned":
                spawned.append((parts[2], parts[0]))
            else:
                returned[parts[2]] = returned.get(parts[2], 0) + 1
    return spawned, returned


def _adopt_ticket(log_path, role):
    """Oldest unmatched spawned line's ticket for this role, else '-'."""
    try:
        spawned, returned = _pairs(log_path, role)
        seen = {}
        for ticket, _ts in spawned:
            seen[ticket] = seen.get(ticket, 0) + 1
            if seen[ticket] > returned.get(ticket, 0):
                return ticket
    except Exception:
        pass
    return "-"


def _elapsed(log_path, role, ticket, now):
    """Seconds since the oldest unmatched 'spawned' line of role+ticket
    (ui.py pairs them the same way), or '-' if none is found."""
    try:
        spawned, returned = _pairs(log_path, role)
        mine = [ts for t, ts in spawned if t == ticket]
        idx = returned.get(ticket, 0)
        if idx < len(mine):
            t0 = datetime.strptime(mine[idx], "%Y-%m-%dT%H:%M:%SZ") \
                .replace(tzinfo=timezone.utc)
            return str(int((now - t0).total_seconds()))
    except Exception:
        pass
    return "-"


if __name__ == "__main__":
    main()
    sys.exit(0)
