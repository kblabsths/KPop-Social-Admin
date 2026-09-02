#!/usr/bin/env python3
"""Remote-mutation gate (PreToolUse on Bash).

External services are money-and-state outside the repo — the one class of
action git cannot revert. Phase doctrine (Ben, 2026-08-11): while a
project has no users, EVERYTHING IS STAGING — agents deploy and migrate
freely against any service the human has DECLARED in
agenticflow/docs/SERVICES.md. The gate is two fences, not a toll booth:

- an UNDECLARED service's CLI is refused (the provisioning seam: agents
  never create accounts/projects/tiers — file the DEP, the toolsmith
  vets, the human provisions and declares);
- anything matching prod/production is refused outright until a
  human-owned promotion flow exists (deliberately none yet).

Declared + non-prod passes silently: zero velocity cost on the road the
run actually drives. Only gated while a run is in flight (RUNNING), like
every other gate; the human's own sessions are not gated.
"""
import json
import os
import re
import shlex
import sys

PROJECT = os.path.abspath(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
SEPARATORS = {";", "&&", "||", "|", "&"}
# CLIs whose business is remote service state. aws/gcloud/az are absent on
# purpose: they are grab-bags used read-only constantly, and blocking reads
# is velocity tax — add them here the day a project declares them.
REMOTE_CLIS = {"railway": "railway", "supabase": "supabase",
               "vercel": "vercel", "fly": "fly", "flyctl": "fly",
               "wrangler": "wrangler", "netlify": "netlify",
               "heroku": "heroku"}
PROD_RE = re.compile(r"(^|[^A-Za-z])(prod|production)([^A-Za-z]|$)", re.I)


def run_in_flight():
    return os.path.exists(os.path.join(PROJECT, "agenticflow", "tracker",
                                       "RUNNING"))


def declared_services():
    """Section names (## <name>) of agenticflow/docs/SERVICES.md."""
    path = os.path.join(PROJECT, "agenticflow", "docs", "SERVICES.md")
    names = set()
    try:
        for line in open(path, encoding="utf-8"):
            if line.startswith("## "):
                names.add(line[3:].strip().split()[0].lower())
    except OSError:
        pass
    return names


def _cmd_word(seg):
    for t in seg:
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t) \
                or os.path.basename(t) in ("nohup", "time", "npx"):
            continue
        return t
    return ""


def remote_segments(command):
    """(service, segment) per pipeline segment invoking a remote CLI."""
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        return []
    out, seg = [], []
    for tok in tokens + [";"]:
        if tok in SEPARATORS:
            head = _cmd_word(seg)
            svc = REMOTE_CLIS.get(os.path.basename(head)) if head else None
            if svc:
                out.append((svc, seg))
            seg = []
        else:
            seg.append(tok)
    return out


def block(msg, detail):
    try:  # fire-counter (curator trim-data); never fail the gate over logging
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(PROJECT, "agenticflow", "tracker",
                               "gate_fires.tsv"), "a", encoding="utf-8") as f:
            f.write("%s\tremote_gate\t%s: %s\n" % (ts, msg, detail[:200]))
    except Exception:
        pass
    sys.stderr.write("REMOTE GATE: %s\n" % msg)
    sys.exit(2)


def main():
    if not run_in_flight():
        sys.exit(0)
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if (payload.get("tool_name") or "") != "Bash":
        sys.exit(0)
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    hits = remote_segments(cmd)
    if not hits:
        sys.exit(0)
    declared = declared_services()
    for svc, seg in hits:
        if any(PROD_RE.search(t) for t in seg):
            block("production is human-gated — this phase is ALL STAGING, "
                  "and no promotion flow exists yet. If this genuinely is "
                  "not production, rename the target; the word is the fence",
                  " ".join(seg))
        if svc not in declared:
            block("service '%s' is not declared in agenticflow/docs/"
                  "SERVICES.md. The factory never provisions: file a DEP "
                  "ticket; the toolsmith vets it; the human creates the "
                  "account/project and declares it (## %s section). "
                  "Declared staging targets pass freely" % (svc, svc),
                  " ".join(seg))
    sys.exit(0)


if __name__ == "__main__":
    main()
