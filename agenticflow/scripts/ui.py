#!/usr/bin/env python3
"""Attention UI — a localhost window onto the tracker for the human.

Read-only over factory state with exactly two write paths: filing a note into
tracker/inbox/ (identical artifact to the human writing the file by hand; the
strategist routes it into tickets like any other inbox item), and resolving a
design reconciliation (confirm flips its status; reject also files an inbox
note so the next run restores the design). No approve/force buttons beyond
that — anything else that changes factory state stays in the terminal, on
the record.

Tabs: Now (running agents, elapsed, live tokens), Tickets, My tickets +
file-a-ticket, Design intent (designer doc-follows awaiting the human),
Docs (rendered markdown).

Live token counts are best-effort telemetry tailed from the Claude Code
session transcripts on this machine (an internal format that may change);
nothing in the factory ever reads them back. The factory-owned truth about
running agents is tracker/spawn_log.tsv's spawned/returned line pairs.

Run: python3 agenticflow/scripts/ui.py [--port N]      (foreground)
     python3 agenticflow/scripts/ui.py --ensure        (start detached if not up, open browser)
Markdown rendering uses the vetted renderer from .venv-tools when importable
and degrades to <pre> when not.
"""
import argparse
import glob
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

# per-project port (run.yaml ui_port) so two factories on one machine never
# fight over a socket; CLI --port still overrides
DEFAULT_PORT = lib.load_run_config()["ui_port"]
INBOX = os.path.join(lib.ROOT, "tracker", "inbox")
SPAWN_LOG = os.path.join(lib.ROOT, "tracker", "spawn_log.tsv")
FILINGS = os.path.join(lib.ROOT, "tracker", "ui_filings.tsv")
# permanent copies of filed notes — the inbox original is deleted on routing,
# so this dir is the only place the human can re-read what they wrote
FILINGS_DIR = os.path.join(lib.ROOT, "tracker", "ui_filings")
RECONCILIATIONS = os.path.join(lib.ROOT, "tracker", "reconciliations")
FOR_HUMAN = os.path.join(lib.ROOT, "tracker", "for-human")
SHIP_INVOCATIONS = os.path.join(lib.ROOT, "tracker", "ship_invocations.tsv")
UI_LOG = os.path.join(lib.ROOT, "tracker", "ui.log")
UI_URL = os.path.join(lib.ROOT, "tracker", "ui.url")
STARTED = lib.now_iso()
RUNNING = os.path.join(lib.ROOT, "tracker", "RUNNING")
PARKED = os.path.join(lib.ROOT, "tracker", "PARKED")
HEARTBEAT = os.path.join(lib.ROOT, "tracker", "HEARTBEAT")
CLOSING = os.path.join(lib.ROOT, "tracker", "CLOSING")
ORCH_SESSION = os.path.join(lib.ROOT, "tracker", "ORCHESTRATOR_SESSION")
ACTIVE_WINDOW_S = 180  # transcript untouched this long => agent not active
# the code generation this process booted with — whoami reports it and
# ensure() compares it, so a kit upgrade retires a live UI instead of the
# adopt path reusing pre-upgrade code forever (kspace 2026-08-18: the
# Waiting-on-you panel shipped on the 13th; the server started on the
# 12th kept serving the old page through five days and three upgrades)
SCRIPT_SHA = hashlib.sha256(open(__file__, "rb").read()).hexdigest()[:16]

try:  # vetted renderer (DEP-0008); plain <pre> without it
    import mistune
    # escape=True with exactly plugins=['table'] is the DEP-0008 trust
    # condition: ticket bodies can quote web-sourced text, and escape-by-
    # default renders raw HTML as literal text instead of executing it in
    # the human's browser (table cells go through the same inline escaping).
    _render = mistune.create_markdown(escape=True, plugins=["table"])
except ImportError:
    _render = None


def render_markdown(text):
    if _render is not None:
        return _render(text)
    return "<pre class='fallback'>%s</pre>" % html.escape(text)


# --- docs -------------------------------------------------------------------

DOC_SECTIONS = [  # (section label, factory-home-relative glob); first = open
    # Explicit filenames, never a bare *.md sweep: every entry is a doc the
    # factory produced FOR the human — nothing of the project's own may leak
    # in here (Ben, 2026-07-13).
    ("Digest (latest)", "DIGEST.md"),  # dispatch mirrors the newest here
    ("Proposals (awaiting you)", "tracker/proposals/*.md"),
    ("Digests", "tracker/digests/*.md"),
    ("Docs", ("docs/*.md", "docs/vision/*.md")),  # global + active campaign
    # evidence is mostly screenshots from designer/verifier walks — images
    # are first-class docs here, rendered inline via /api/raw
    ("Evidence", ("tracker/evidence/**/*.md", "tracker/evidence/**/*.png",
                  "tracker/evidence/**/*.jpg", "tracker/evidence/**/*.jpeg",
                  "tracker/evidence/**/*.gif", "tracker/evidence/**/*.webp")),
    ("Milestones", "tracker/milestones/*.md"),
    ("Notes (compacted ticket histories)", "tracker/notes/*.md"),
    ("Research", "research/**/*.md"),
    ("Factory doctrine", "DESIGN.md"),
]


IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg",
               ".jpeg": "image/jpeg", ".gif": "image/gif",
               ".webp": "image/webp"}


def _patterns(section_patterns):
    return (section_patterns,) if isinstance(section_patterns, str) \
        else section_patterns


def list_docs():
    sections = []
    for label, pats in DOC_SECTIONS:
        rels = []
        for pattern in _patterns(pats):
            paths = sorted(glob.glob(os.path.join(lib.ROOT, pattern),
                                     recursive=True))
            rels += [os.path.relpath(p, lib.ROOT) for p in paths
                     if os.path.isfile(p)]
        if label == "Digests":
            rels = rels[::-1]  # newest first
        if rels:
            sections.append({"label": label, "docs": rels})
    return sections


def doc_allowed(rel):
    """Only files the section globs actually list — no path escapes."""
    for _, pats in DOC_SECTIONS:
        for pattern in _patterns(pats):
            for p in glob.glob(os.path.join(lib.ROOT, pattern), recursive=True):
                if os.path.relpath(p, lib.ROOT) == rel:
                    return True
    return False


# --- tickets ------------------------------------------------------------------

def ticket_title(body):
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return "(untitled)"


def history_entries(body):
    m = re.search(r"## History\n(.*)\Z", body, re.DOTALL)
    if not m:
        return []
    return [ln[2:].strip() for ln in m.group(1).splitlines() if ln.startswith("- ")]


def tickets_summary():
    out = []
    for tid, t in lib.load_all(include_archive=True).items():
        f = t["front"]
        out.append({
            "id": tid, "type": f.get("type"), "status": f.get("status"),
            "priority": f.get("priority"), "milestone": f.get("milestone"),
            "assignee": f.get("assignee"),
            "discovered_from": f.get("discovered_from"),
            "title": ticket_title(t["body"]),
            "archived": os.path.dirname(t["path"]) == lib.ARCHIVE,
        })
    return out


def ticket_detail(tid):
    all_t = lib.load_all(include_archive=True)
    if tid not in all_t:
        return None
    t = all_t[tid]
    return {"id": tid, "front": t["front"], "title": ticket_title(t["body"]),
            "html": render_markdown(t["body"]),
            "archived": os.path.dirname(t["path"]) == lib.ARCHIVE}


# --- my filings ---------------------------------------------------------------

def read_filings():
    rows = []
    if os.path.exists(FILINGS):
        with open(FILINGS, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 3:
                    rows.append({"ts": parts[0], "filename": parts[1],
                                 "title": parts[2]})
    return rows


def my_view():
    """Each filing: pending (inbox file still there) or routed to tickets the
    strategist stamped discovered_from: inbox:<filename>."""
    filings = read_filings()
    all_t = lib.load_all(include_archive=True)
    by_origin = {}
    for tid, t in all_t.items():
        origin = t["front"].get("discovered_from")
        if origin and str(origin).startswith("inbox:"):
            by_origin.setdefault(str(origin)[len("inbox:"):], []).append(t)
    out = []
    for f in reversed(filings):  # newest first
        tickets = []
        for t in sorted(by_origin.get(f["filename"], []),
                        key=lambda t: t["front"]["id"]):
            hist = history_entries(t["body"])
            tickets.append({
                "id": t["front"]["id"], "status": t["front"].get("status"),
                "resolution": t["front"].get("resolution"),
                "human_note": t["front"].get("human_note"),
                "title": ticket_title(t["body"]),
                "last_events": hist[-3:],
            })
        pending = os.path.exists(os.path.join(INBOX, f["filename"]))
        has_note = os.path.exists(os.path.join(FILINGS_DIR, f["filename"]))
        out.append({**f, "pending": pending, "has_note": has_note,
                    "tickets": tickets})
    return out


def filing_detail(name):
    """Rendered copy of a filed note. Name must be a known filing —
    membership check, not path arithmetic (traversal defense)."""
    if name not in {f["filename"] for f in read_filings()}:
        return None
    path = os.path.join(FILINGS_DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return render_markdown(f.read())


def file_note(title, body):
    title = " ".join(title.split())
    if not title:
        raise ValueError("title required")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "note"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = "ui-%s-%s.md" % (stamp, slug)
    os.makedirs(INBOX, exist_ok=True)
    text = "# %s\n\nfiled: %s by the human via the attention UI\n\n%s\n\n" \
           "(Routing note for the strategist: stamp every ticket created from " \
           "this item with --discovered-from inbox:%s so the human's UI can " \
           "track it.)\n" % (title, lib.now_iso(), body.strip(), name)
    with open(os.path.join(INBOX, name), "w", encoding="utf-8") as f:
        f.write(text)
    os.makedirs(FILINGS_DIR, exist_ok=True)
    with open(os.path.join(FILINGS_DIR, name), "w", encoding="utf-8") as f:
        f.write(text)
    with open(FILINGS, "a", encoding="utf-8") as f:
        f.write("%s\t%s\t%s\n" % (lib.now_iso(), name, title))
    return name


# --- waiting on you -----------------------------------------------------------
#
# One file per open item addressed to the human under tracker/for-human/:
# first line the ask, optional "Recommend:" / "Unblocks:" lines. Agents (SKILL
# doctrine) and dispatch (blocked "ASK BEN…" tickets) drop them; the human
# deletes a file — here via the ack button — to acknowledge, and droppers
# never re-create a deleted one. Proposal ui-surface-human-queue: a stream
# scrolls away, this panel holds.

def waiting_view():
    if not os.path.isdir(FOR_HUMAN):
        return []
    rows = []
    for name in sorted(os.listdir(FOR_HUMAN)):
        if name.startswith("."):
            continue
        path = os.path.join(FOR_HUMAN, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = [ln.strip() for ln in f.read().splitlines() if ln.strip()]
        except OSError:
            continue
        question, recommend, unblocks = "", "", ""
        for ln in lines:
            low = ln.lower()
            if low.startswith("recommend:"):
                recommend = ln.split(":", 1)[1].strip()
            elif low.startswith("unblocks:"):
                unblocks = ln.split(":", 1)[1].strip()
            elif not question:
                question = ln.lstrip("# ").strip()
        rows.append({"name": name, "question": question or name,
                     "recommend": recommend, "unblocks": unblocks,
                     "age_s": _age_s(path)})
    rows.sort(key=lambda r: -(r["age_s"] or 0))  # oldest first
    return rows


def ack_waiting(name):
    """Deletion is the acknowledgment. Membership check, not path
    arithmetic (traversal defense, same as filing_detail)."""
    if not os.path.isdir(FOR_HUMAN) or name not in set(os.listdir(FOR_HUMAN)):
        raise ValueError("unknown waiting item")
    os.remove(os.path.join(FOR_HUMAN, name))


# --- design reconciliations ---------------------------------------------------
#
# Written by the designer's walk when a LOOK_AND_FEEL divergence traces to
# human-lane commits (no ticket ID): the doc was updated to match the app,
# and the entry awaits the human's word that the change was intentional.

def _recon_files():
    if not os.path.isdir(RECONCILIATIONS):
        return []
    return sorted(n for n in os.listdir(RECONCILIATIONS)
                  if n.endswith(".md") and not n.startswith("."))


def _recon_status(text):
    m = re.search(r"^status:\s*(\w+)", text, re.MULTILINE)
    return m.group(1) if m else "pending"


def _recon_read(name):
    with open(os.path.join(RECONCILIATIONS, name), "r", encoding="utf-8") as f:
        return f.read()


def reconciliations_view():
    out = []
    for name in reversed(_recon_files()):  # newest first
        text = _recon_read(name)
        body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.DOTALL)
        out.append({"name": name, "status": _recon_status(text),
                    "html": render_markdown(body)})
    return out


def recon_pending_count():
    return sum(1 for n in _recon_files()
               if _recon_status(_recon_read(n)) == "pending")


def reconcile(name, action):
    """confirm: the human blesses the doc-follow. reject: mark it AND file an
    inbox note (the same artifact as any human filing — the strategist routes
    it) so the next run restores the previous design."""
    if name not in set(_recon_files()):
        raise ValueError("unknown reconciliation")
    if action not in ("confirm", "reject"):
        raise ValueError("action must be confirm|reject")
    text = _recon_read(name)
    if _recon_status(text) != "pending":
        raise ValueError("already resolved")
    new_status = "confirmed" if action == "confirm" else "rejected"
    text = re.sub(r"^status:\s*\w+", "status: " + new_status, text,
                  count=1, flags=re.MULTILINE)
    text += "\n- %s [human] %s via the attention UI\n" % (lib.now_iso(),
                                                          new_status)
    with open(os.path.join(RECONCILIATIONS, name), "w", encoding="utf-8") as f:
        f.write(text)
    if action == "reject":
        file_note(
            "Rejected design reconciliation: restore the previous design",
            "The human rejected agenticflow/tracker/reconciliations/%s — the "
            "walked change was ACCIDENTAL. Restore the previous design and "
            "revert the LOOK_AND_FEEL.md edit described there.\n\n%s"
            % (name, text))
    return new_status


# --- now: run state, spawn ledger, live transcript telemetry -------------------

def _age_s(path):
    try:
        return max(0, int(time.time() - os.path.getmtime(path)))
    except OSError:
        return None


# one implementation of "who is running" — the dispatcher's stale-claim
# sweep consults the same ledger (a 90-minute timer once released two live
# builders' claims, 2026-08-11)
spawn_ledger_running = lib.spawn_ledger_running


class TranscriptTail(object):
    """Incremental token sums per Claude Code transcript file. Best-effort:
    unknown lines are skipped, vanished files dropped, format drift shows
    as 'n/a' in the UI, never an error."""

    def __init__(self):
        self.state = {}  # path -> {offset, out, inp, last_ts, buf}
        self.lock = threading.Lock()

    def _consume(self, st, chunk):
        data = st.pop("buf", "") + chunk
        lines = data.split("\n")
        st["buf"] = lines.pop()  # possibly-partial trailing line
        for line in lines:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("timestamp"):
                st["last_ts"] = e["timestamp"]
                if not st.get("first_ts"):
                    st["first_ts"] = e["timestamp"]
                ep = _parse_iso(e["timestamp"])
                if ep is not None:
                    prev = st.get("prev_epoch")
                    if prev is not None and ep > prev:
                        # gap-capped: a machine asleep (or an agent parked)
                        # between events must not bill as agent time — the
                        # 2026-07-18 retro found one 533-min sleep counted
                        st["active_s"] += min(ep - prev, 600)
                    st["prev_epoch"] = ep
            msg = e.get("message")
            u = msg.get("usage") if isinstance(msg, dict) else None
            if not isinstance(u, dict):
                continue
            st["out"] += u.get("output_tokens", 0) or 0
            st["inp"] += (u.get("input_tokens", 0) or 0) + \
                         (u.get("cache_creation_input_tokens", 0) or 0)

    def totals(self, path):
        with self.lock:
            st = self.state.setdefault(
                path, {"offset": 0, "out": 0, "inp": 0, "last_ts": None,
                       "active_s": 0.0})
            try:
                size = os.path.getsize(path)
                if size > st["offset"]:
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        f.seek(st["offset"])
                        self._consume(st, f.read())
                        st["offset"] = size
            except OSError:
                return None
            return {"out": st["out"], "inp": st["inp"],
                    "last_ts": st["last_ts"], "first_ts": st.get("first_ts"),
                    "active_s": st.get("active_s", 0.0)}


TAIL = TranscriptTail()


def transcript_dir():
    # Claude Code munges EVERY non-alphanumeric char to "-" (spaces included —
    # ".../Korean Vocab" lives under "...-Korean-Vocab"), not just "/" and "."
    return os.path.expanduser(
        "~/.claude/projects/" + re.sub(r"[^A-Za-z0-9]", "-", lib.PRODUCT))


def orchestrator_session_id():
    """Session ID the ship_marker hook recorded at /ship invocation. This is
    what separates THE run's session from any other Claude session the human
    has open in the same repo — they all share one transcript directory."""
    try:
        with open(ORCH_SESSION, "r") as f:
            sid = f.read().strip()
        return sid if re.fullmatch(r"[0-9a-f-]{8,}", sid) else None
    except OSError:
        return None


def _entry_age_s(path):
    """Age of the last timestamped ENTRY in a transcript, not of the file.
    A sync/backup/indexer touch refreshes mtime without appending anything
    (2026-08-02: a post-login client sweep touched three dead July
    orchestrator transcripts and the UI showed a finished run as active
    "seconds ago") — the timestamp inside the file is the only honest
    liveness signal. Callers keep _age_s as a cheap pre-filter: a file whose
    mtime is old cannot contain new entries, but a fresh mtime proves
    nothing."""
    tot = TAIL.totals(path) or {}
    ep = _parse_iso(tot.get("last_ts"))
    if ep is None:
        return None
    return max(0, int(time.time() - ep))


def active_transcripts():
    """Live agents + orchestrator, from the orchestrator session's transcripts
    ONLY. No session marker -> no telemetry (fail closed: showing another
    session's activity as the factory's is worse than showing nothing)."""
    sid = orchestrator_session_id()
    if not sid:
        return [], None
    tdir = transcript_dir()
    agents, orchestrator = [], None
    for path in glob.glob(os.path.join(tdir, sid, "subagents", "agent-*.jsonl")):
        age = _age_s(path)
        if age is None or age > ACTIVE_WINDOW_S:
            continue
        age = _entry_age_s(path)
        if age is None or age > ACTIVE_WINDOW_S:
            continue
        meta = {}
        try:
            with open(path.replace(".jsonl", ".meta.json"), "r") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            pass
        tot = TAIL.totals(path) or {}
        started = _parse_iso(tot.get("first_ts"))
        tk = TICKET_RE.search(meta.get("description", "") or "")
        agents.append({
            "agent_type": meta.get("agentType", "?"),
            "description": meta.get("description", ""),
            "ticket": tk.group(0) if tk else "",
            "idle_s": age,
            "elapsed_s": max(0, int(time.time() - started)) if started else None,
            "tokens_out": tot.get("out"), "tokens_in": tot.get("inp"),
        })
    main_jsonl = os.path.join(tdir, sid + ".jsonl")
    age = _age_s(main_jsonl)
    if age is not None and age <= ACTIVE_WINDOW_S:
        age = _entry_age_s(main_jsonl)
        if age is not None and age <= ACTIVE_WINDOW_S:
            tot = TAIL.totals(main_jsonl) or {}
            orchestrator = {"idle_s": age, "tokens_out": tot.get("out"),
                            "tokens_in": tot.get("inp")}
    return agents, orchestrator


def _parse_iso(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


TICKET_RE = re.compile(r"\b(?:FEAT|TASK|BUG|DEBT|DEP|DOC)-\d{3,}\b")

_FINAL_TEXT_CACHE = {}


def _final_text(path, limit=160):
    """The agent's HANDOFF line (role defs: final message ends with
    'HANDOFF: <one sentence>'), shown as 'doing' in history. Agents that
    predate the protocol yield "" and the UI falls back to the spawn
    description — free-text tails proved to be bookkeeping boilerplate.
    Cached by (mtime, size); a finished agent's file never changes."""
    try:
        st = os.stat(path)
        key = (st.st_mtime, st.st_size)
    except OSError:
        return ""
    cached = _FINAL_TEXT_CACHE.get(path)
    if cached and cached[0] == key:
        return cached[1]
    text, scanned = "", 0
    try:
        with open(path, "rb") as f:
            if st.st_size > 65536:
                f.seek(-65536, 2)
            lines = f.read().decode("utf-8", "replace").split("\n")
        for line in reversed(lines):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") != "assistant":
                continue
            c = (e.get("message") or {}).get("content")
            if isinstance(c, str):
                t = c.strip()
            elif isinstance(c, list):
                t = " ".join(b.get("text", "") for b in c
                             if isinstance(b, dict)).strip()
            else:
                continue
            if not t:
                continue
            m = re.search(r"HANDOFF:\s*(.+)", t)
            if m:
                text = " ".join(m.group(1).split()) \
                    .replace("**", "").replace("`", "")
                text = re.sub(r"(?<![\w])/(?:[\w.\-]+/)+([\w.\-]+)",
                              r"…/\1", text)
                break
            scanned += 1
            if scanned >= 5:  # HANDOFF sits in the last message or nowhere
                break
    except OSError:
        pass
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "…"
    _FINAL_TEXT_CACHE[path] = (key, text)
    return text


def invocation_starts(sid):
    """Epoch timestamps of each /ship invocation of this session, ascending
    (ship_marker appends one line per /ship prompt)."""
    out = []
    try:
        with open(SHIP_INVOCATIONS, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 2 and parts[1] == sid:
                    epoch = _parse_iso(parts[0])
                    if epoch:
                        out.append({"ts": parts[0], "epoch": epoch})
    except OSError:
        pass
    return out


def agent_history():
    """Every subagent of the orchestrator session, chronological, grouped by
    /ship invocation. Transcript-derived (display-only, best-effort); the
    spawn ledger stays the factory-owned record."""
    sid = orchestrator_session_id()
    if not sid:
        return {"attributed": False, "groups": []}
    running = os.path.exists(RUNNING)
    rows = []
    for path in glob.glob(os.path.join(
            transcript_dir(), sid, "subagents", "agent-*.jsonl")):
        tot = TAIL.totals(path)
        if not tot or not tot.get("first_ts"):
            continue
        meta = {}
        try:
            with open(path.replace(".jsonl", ".meta.json"), "r") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            pass
        start = _parse_iso(tot["first_ts"])
        end = _parse_iso(tot.get("last_ts")) or start
        if not start:
            continue
        age = _age_s(path)
        tk = TICKET_RE.search(meta.get("description", "") or "")
        rows.append({
            "agent_type": meta.get("agentType", "?"),
            "description": meta.get("description", ""),
            "ticket": tk.group(0) if tk else "",
            "summary": _final_text(path),
            "start": tot["first_ts"], "epoch": start,
            "dur_s": int(tot.get("active_s") or max(0, end - start)),
            "tokens_out": tot.get("out"),
            "active": running and age is not None and age <= ACTIVE_WINDOW_S,
        })
    rows.sort(key=lambda r: r["epoch"])
    pre = {"label": "before invocation tracking",
           "epoch": float("-inf"), "agents": []}
    inv_groups = [{"label": inv["ts"], "epoch": inv["epoch"], "agents": []}
                  for inv in invocation_starts(sid)]
    for r in rows:  # each agent belongs to the latest invocation before it
        target = pre
        for g in inv_groups:
            if r["epoch"] >= g["epoch"]:
                target = g
        target["agents"].append(r)
    groups = ([pre] if pre["agents"] else []) + inv_groups
    for g in groups:
        g.pop("epoch", None)
        g["n"] = len(g["agents"])
        g["tokens_out"] = sum(a["tokens_out"] or 0 for a in g["agents"])
        g["wall_s"] = sum(a["dur_s"] for a in g["agents"])
    return {"attributed": True, "groups": groups}


def spend_view():
    """Where tokens went, from the factory-owned spawn ledger: whole-run
    per-role totals, most expensive tickets, per-invocation trend. Works
    even when transcripts can't be attributed."""
    roles, tickets, returns = {}, {}, []
    try:
        with open(SPAWN_LOG, "r", encoding="utf-8") as f:
            for ln in f:
                p = ln.rstrip("\n").split("\t")
                if ln.startswith("#") or len(p) < 4 or p[3] == "spawned":
                    continue
                try:
                    tok = int(p[3])
                    sec = int(p[4]) if len(p) > 4 else 0
                except ValueError:
                    continue
                returns.append((_parse_iso(p[0]) or 0, tok))
                r = roles.setdefault(p[1], [0, 0, 0])
                r[0] += 1
                r[1] += tok
                r[2] += sec
                if p[2] and p[2] != "-":
                    tickets[p[2]] = tickets.get(p[2], 0) + tok
    except OSError:
        pass
    total = sum(r[1] for r in roles.values())
    invs = []
    try:
        with open(SHIP_INVOCATIONS, "r", encoding="utf-8") as f:
            for line in f:
                p = line.rstrip("\n").split("\t")
                ep = _parse_iso(p[0]) if p and p[0] else None
                if ep:
                    invs.append({"ts": p[0], "epoch": ep,
                                 "tokens_out": 0, "agents": 0})
    except OSError:
        pass
    invs.sort(key=lambda i: i["epoch"])
    pre = {"ts": "", "epoch": float("-inf"), "tokens_out": 0, "agents": 0}
    for epoch, tok in returns:  # each return belongs to the latest invocation before it
        target = pre
        for g in invs:
            if epoch >= g["epoch"]:
                target = g
        target["tokens_out"] += tok
        target["agents"] += 1
    groups = ([pre] if pre["agents"] else []) + invs
    for g in groups:
        g.pop("epoch", None)
    return {
        "total_out": total,
        "roles": sorted(
            ({"role": k, "agents": v[0], "tokens_out": v[1],
              "pct": round(100.0 * v[1] / total, 1) if total else 0.0,
              "active_s": v[2]} for k, v in roles.items()),
            key=lambda r: -r["tokens_out"]),
        "top_tickets": sorted(
            ({"ticket": k, "tokens_out": v} for k, v in tickets.items()),
            key=lambda t: -t["tokens_out"])[:12],
        "invocations": groups,
    }


def now_view():
    # Live transcript telemetry ONLY while a run is active: outside a run,
    # any Claude session the human has open in this repo would show up here
    # and read as factory activity that isn't happening.
    running = os.path.exists(RUNNING)
    agents, orchestrator = active_transcripts() if running else ([], None)
    inbox_files = [n for n in os.listdir(INBOX) if not n.startswith(".")] \
        if os.path.isdir(INBOX) else []
    try:
        stale_s = 60 * int(lib.load_run_config().get("stale_claim_minutes", 90))
    except (ValueError, TypeError):
        stale_s = 5400
    ledger = spawn_ledger_running()
    for r in ledger:  # past the stale-claim window = probably a dead orphan
        ep = _parse_iso(r["ts"])
        r["stale"] = bool(ep and time.time() - ep > stale_s)
    # tmux seat (wake.py/watchdog relaunches write tracker/ATTACH); only
    # advertised if the session actually exists right now — a stale file
    # pointing at nothing is worse than no hint
    attach = None
    if running:
        try:
            with open(os.path.join(lib.ROOT, "tracker", "ATTACH")) as f:
                attach = f.read().strip() or None
        except OSError:
            pass
        if attach:
            tmux = shutil.which("tmux")
            if not (tmux and subprocess.run(
                    [tmux, "has-session", "-t", attach.split()[-1]],
                    capture_output=True).returncode == 0):
                attach = None
    return {
        "attach": attach,
        "project": os.path.basename(os.path.realpath(lib.PRODUCT)),
        "waiting": waiting_view(),
        "run": {
            "running": running,
            "parked": (not running) and os.path.exists(PARKED),
            "closing": os.path.exists(CLOSING),
            "heartbeat_age_s": _age_s(HEARTBEAT),
        },
        "ledger": ledger,
        "inbox_age_s": _age_s(INBOX),
        "attributed": bool(orchestrator_session_id()) if running else False,
        "agents": agents,
        "orchestrator": orchestrator,
        "inbox_pending": sorted(inbox_files),
        "recon_pending": recon_pending_count(),
        "now": lib.now_iso(),
    }


# --- HTTP ---------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "AgenticFlowUI/1"

    def log_message(self, fmt, *args):  # quiet; errors still raise
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj))

    def do_GET(self):
        path, _, query = self.path.partition("?")
        params = {}
        for pair in query.split("&"):
            if "=" in pair:
                k, _, v = pair.partition("=")
                params[k] = urllib.parse.unquote(v)
        try:
            if path == "/":
                self._send(200, PAGE, "text/html; charset=utf-8")
            elif path == "/api/ping":
                self._json({"ok": True, "root": lib.ROOT})
            elif path == "/whoami":
                # identity for --ensure's three cases (v0.3-F): reuse ours,
                # kill our stale ghost, never touch anyone else's server
                self._json({"app": "agenticflow-ui",
                            "repo": os.path.realpath(lib.PRODUCT),
                            "factory_home": os.path.realpath(lib.ROOT),
                            "script": SCRIPT_SHA,
                            "pid": os.getpid(), "started": STARTED})
            elif path == "/api/spend":
                self._json(spend_view())
            elif path == "/api/now":
                self._json(now_view())
            elif path == "/api/tickets":
                self._json({"tickets": tickets_summary()})
            elif path == "/api/ticket":
                d = ticket_detail(params.get("id", ""))
                self._json(d if d else {"error": "unknown id"}, 200 if d else 404)
            elif path == "/api/docs":
                self._json({"sections": list_docs()})
            elif path == "/api/doc":
                rel = params.get("path", "")
                if not doc_allowed(rel):
                    self._json({"error": "not a listed doc"}, 403)
                    return
                ext = os.path.splitext(rel)[1].lower()
                if ext in IMAGE_TYPES:
                    self._json({"path": rel, "html":
                                '<img src="/api/raw?path=%s" alt="%s" '
                                'style="max-width:100%%">' %
                                (urllib.parse.quote(rel), rel)})
                    return
                with open(os.path.join(lib.ROOT, rel), "r", encoding="utf-8") as f:
                    self._json({"path": rel, "html": render_markdown(f.read())})
            elif path == "/api/raw":
                rel = params.get("path", "")
                ext = os.path.splitext(rel)[1].lower()
                if not doc_allowed(rel) or ext not in IMAGE_TYPES:
                    self._json({"error": "not a listed image"}, 403)
                    return
                with open(os.path.join(lib.ROOT, rel), "rb") as f:
                    self._send(200, f.read(), IMAGE_TYPES[ext])
            elif path == "/api/mine":
                self._json({"filings": my_view()})
            elif path == "/api/reconciliations":
                self._json({"entries": reconciliations_view()})
            elif path == "/api/history":
                self._json(agent_history())
            elif path == "/api/filing":
                html_body = filing_detail(params.get("name", ""))
                if html_body is None:
                    self._json({"error": "no stored copy of that filing"}, 404)
                else:
                    self._json({"html": html_body})
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:  # display-only server: never die on a request
            self._json({"error": "%s: %s" % (type(e).__name__, e)}, 500)

    def do_POST(self):
        try:
            path = self.path.partition("?")[0]
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if path == "/api/file":
                name = file_note(payload.get("title", ""),
                                 payload.get("body", ""))
                self._json({"ok": True, "filename": name})
            elif path == "/api/reconcile":
                status = reconcile(payload.get("name", ""),
                                   payload.get("action", ""))
                self._json({"ok": True, "status": status})
            elif path == "/api/ack-waiting":
                ack_waiting(payload.get("name", ""))
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:
            self._json({"error": "%s: %s" % (type(e).__name__, e)}, 400)


# --- page ----------------------------------------------------------------------

PAGE = r"""<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgenticFlow</title>
<style>
:root { --bg:#101418; --panel:#1a2027; --line:#2a333d; --fg:#d7dee6;
        --dim:#8b98a5; --accent:#5cc8ff; --ok:#57c98a; --warn:#e8b24b;
        --bad:#e06c75; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); display:flex;
       min-height:100vh;
       font:14px/1.5 -apple-system, "SF Pro Text", Helvetica, sans-serif; }
code, pre, .mono { font-family:"SF Mono", Menlo, monospace; font-size:12.5px; }
aside#nav { width:180px; flex:none; border-right:1px solid var(--line);
            padding:16px 10px; position:sticky; top:0; height:100vh;
            display:flex; flex-direction:column; gap:3px; }
aside#nav h1 { font-size:15px; margin:0 8px 14px; }
aside#nav .tab { text-align:left; background:none; border:none;
                 color:var(--dim); font-size:14px; padding:8px 10px;
                 cursor:pointer; border-radius:7px; }
aside#nav .tab.active { color:var(--fg); background:var(--panel); }
#runbadge { margin-top:auto; font-size:12px; color:var(--dim); padding:0 8px; }
#runbadge .dot { display:inline-block; width:8px; height:8px; border-radius:4px;
                 margin-right:6px; background:var(--dim); }
#runbadge.on .dot { background:var(--ok); }
#runbadge.closing .dot { background:var(--warn); }
main { flex:1; min-width:0; padding:18px 22px; max-width:1100px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px;
        padding:14px 16px; margin-bottom:14px; }
.card h2 { margin:0 0 10px; font-size:13px; text-transform:uppercase;
           letter-spacing:.06em; color:var(--dim); }
table { border-collapse:collapse; width:100%; }
tr.live td { font-weight:600; }
details > summary { cursor:pointer; padding:6px 0; }
th, td { text-align:left; padding:5px 10px 5px 0; vertical-align:top; }
th { color:var(--dim); font-weight:500; font-size:12px; }
tr + tr td { border-top:1px solid var(--line); }
.pill { display:inline-block; padding:1px 8px; border-radius:9px; font-size:11.5px;
        border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
.pill.done { color:var(--ok); border-color:var(--ok); }
.pill.open, .pill.reopened { color:var(--accent); border-color:var(--accent); }
.pill.claimed, .pill.built, .pill.qa { color:var(--warn); border-color:var(--warn); }
.pill.blocked, .pill.disputed { color:var(--bad); border-color:var(--bad); }
.pill.wont_fix, .pill.archived { opacity:.75; }
.dim { color:var(--dim); } .num { text-align:right; }
a.tlink { color:var(--accent); cursor:pointer; text-decoration:none; }
input, textarea, select, button.act {
  background:var(--bg); color:var(--fg); border:1px solid var(--line);
  border-radius:7px; padding:8px 10px; font:inherit; width:100%; }
textarea { min-height:110px; resize:vertical; }
button.act { width:auto; background:var(--accent); color:#082330; border:none;
             font-weight:600; cursor:pointer; padding:8px 18px; }
button.act:disabled { opacity:.5; }
.split { display:flex; gap:16px; align-items:flex-start; }
.split .side { width:290px; flex:none; max-height:75vh; overflow-y:auto; }
.split .body { flex:1; min-width:0; }
.side .doc { display:block; padding:3px 6px 3px 14px; border-radius:5px;
             color:var(--fg); cursor:pointer; overflow-wrap:anywhere; }
.side .doc:hover, .side .doc.sel { background:var(--bg); color:var(--accent); }
.side details { margin:2px 0; }
.side summary { font-size:11.5px; color:var(--dim); text-transform:uppercase;
                letter-spacing:.06em; padding:5px 4px; cursor:pointer;
                border-radius:5px; user-select:none; }
.side summary:hover { color:var(--fg); }
.rendered { overflow-x:auto; }
.rendered h1 { font-size:20px; } .rendered h2 { font-size:16px; }
.rendered pre { background:var(--bg); border:1px solid var(--line);
                border-radius:8px; padding:10px; overflow-x:auto; }
.rendered code { background:var(--bg); padding:1px 4px; border-radius:4px; }
.rendered pre code { padding:0; background:none; }
.rendered table td, .rendered table th { border:1px solid var(--line);
                                         padding:4px 8px; }
.rendered blockquote { border-left:3px solid var(--line); margin-left:0;
                       padding-left:12px; color:var(--dim); }
.event { font-size:12px; color:var(--dim); overflow-wrap:anywhere; }
#now-summary table { width:auto; }
#now-summary th { padding-right:14px; }
.filter { width:auto; margin-right:8px; }
#msg { color:var(--ok); font-size:13px; margin-left:12px; }
.empty { color:var(--dim); font-style:italic; }
.badge { background:var(--warn); color:#082330; border-radius:8px;
         padding:0 6px; margin-left:6px; font-size:11px; font-weight:700; }
button.act.danger { background:var(--bad); color:#fff; margin-left:8px; }
</style></head><body>
<aside id="nav">
  <h1>AgenticFlow</h1>
  <button class="tab active" data-tab="now">Now</button>
  <button class="tab" data-tab="spend">Spend</button>
  <button class="tab" data-tab="mine">My tickets</button>
  <button class="tab" data-tab="tickets">Tickets</button>
  <button class="tab" data-tab="design">Design intent<span id="recon-badge"
    class="badge" hidden></span></button>
  <button class="tab" data-tab="docs">Docs</button>
  <span id="runbadge"><span class="dot"></span><span id="runtext">…</span></span>
</aside>
<main>
  <section id="tab-now">
    <div class="card"><h2>Waiting on you</h2><div id="now-waiting"></div></div>
    <div class="card"><h2>Agents in flight</h2><div id="now-agents"></div></div>
    <div class="card"><h2>Summary</h2><div id="now-summary"></div></div>
    <div class="card"><h2>Inbox — notes awaiting the orchestrator</h2><div id="now-inbox"></div></div>
    <div class="card"><h2>Agent history
      <a class="tlink dim" style="font-size:13px" onclick="loadHistory()">refresh</a></h2>
      <div id="now-history"><span class="empty">Loading…</span></div></div>
  </section>
  <section id="tab-spend" hidden>
    <div class="card"><h2>By role — whole run</h2><div id="sp-roles"></div></div>
    <div class="card"><h2>Most expensive tickets</h2><div id="sp-tickets"></div></div>
    <div class="card"><h2>By /ship invocation</h2><div id="sp-invs"></div></div>
  </section>
  <section id="tab-tickets" hidden>
    <div class="card">
      <select id="tk-status" class="filter">
        <option value="">all statuses</option>
        <option>open</option><option>claimed</option><option>built</option>
        <option>qa</option><option>done</option><option>blocked</option>
        <option>wont_fix</option><option>reopened</option><option>disputed</option>
      </select>
      <input id="tk-search" class="filter" style="width:220px"
             placeholder="search title / id">
      <label class="dim"><input type="checkbox" id="tk-arch" style="width:auto">
        include archive</label>
      <div id="tk-list" style="margin-top:12px"></div>
    </div>
    <div class="card" id="tk-detail" hidden></div>
  </section>
  <section id="tab-mine" hidden>
    <div class="card"><h2>File a ticket</h2>
      <p class="dim">Goes to <code>agenticflow/tracker/inbox/</code>; the strategist routes it
      into real tickets on the next tick and they appear below.</p>
      <input id="f-title" placeholder="Title" style="margin-bottom:8px">
      <textarea id="f-body" placeholder="Body"></textarea>
      <div style="margin-top:8px"><button class="act" id="f-send">File</button>
      <span id="msg"></span></div>
    </div>
    <div class="card"><h2>My tickets</h2><div id="mine-list"></div></div>
  </section>
  <section id="tab-design" hidden>
    <div class="card"><h2>Awaiting your eye</h2>
      <p class="dim">The designer's walk found the app diverging from
      LOOK_AND_FEEL.md along changes made <b>outside the factory</b> (no
      ticket on the commits), treated the app as the intent, and updated the
      doc to match. Confirm each, or mark it accidental to have the previous
      design restored.</p>
      <div id="recon-pending"></div></div>
    <div class="card"><h2>Resolved</h2><div id="recon-resolved"></div></div>
  </section>
  <section id="tab-docs" hidden>
    <div class="split">
      <div class="card side" id="docs-side"></div>
      <div class="card body"><div id="doc-view" class="rendered">
        <span class="empty">Pick a document.</span></div></div>
    </div>
  </section>
</main>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => (s == null ? "" : String(s))
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;");
const fmtTok = (n) => n == null ? "n/a" :
  n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : ""+n;
const fmtAge = (s) => s == null ? "?" :
  s < 90 ? s+"s" : s < 5400 ? Math.round(s/60)+"m" : (s/3600).toFixed(1)+"h";
const elapsedSince = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return isNaN(s) ? "?" : fmtAge(Math.round(s));
};
const pill = (s) => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
const fmtLocal = (iso) => {          // computer-local YYYY-MM-DD hh:mm:ss
  const d = new Date(iso);
  if (!iso || isNaN(d)) return iso || "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const tkLink = (id) => id
  ? `<a class="tlink mono" onclick="jumpTicket('${esc(id)}')">${esc(id)}</a>` : "";
/* spawn descriptions read "builder-1 implements BUG-0005": the leading token
   is the instance label (kept in the agent column), the rest is the doing
   text (ticket id stripped — it has its own column) */
const who = (a) => {
  const m = (a.description || "").match(/^(\S+)\s+(.*)$/);
  const named = m && m[1].startsWith(a.agent_type);
  let rest = named ? m[2] : (a.description || "");
  if (a.ticket) rest = rest.replace(a.ticket, "").replace(/\s+/g, " ").trim();
  return {name: named ? m[1] : a.agent_type, rest};
};

/* tabs — current tab lives in the URL hash so refresh stays put */
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === b));
  ["now","spend","tickets","mine","design","docs"].forEach(t =>
    $("#tab-"+t).hidden = (t !== b.dataset.tab));
  history.replaceState(null, "", "#" + b.dataset.tab);
  if (b.dataset.tab === "spend") loadSpend();
  if (b.dataset.tab === "tickets") loadTickets();
  if (b.dataset.tab === "mine") loadMine();
  if (b.dataset.tab === "design") loadRecon();
  if (b.dataset.tab === "docs") loadDocs();
});
{
  const t = location.hash.slice(1);
  const b = document.querySelector(`.tab[data-tab="${t}"]`);
  if (b && t !== "now") b.click();
}

/* Now (polls) */
async function pollNow() {
  try {
    const d = await (await fetch("/api/now")).json();
    const badge = $("#runbadge");
    badge.className = d.run.closing ? "closing" : d.run.running ? "on" : "";
    $("#runtext").textContent = d.run.closing ? "closing" :
      d.run.running ? "run active — heartbeat " + fmtAge(d.run.heartbeat_age_s) + " ago"
      : d.run.parked ? "campaign parked — resume with /ship"
                    : "no run";
    const seat = d.attach ? `<div class="dim" style="margin-bottom:6px">seat:
      <code>${esc(d.attach)}</code>
      <a class="tlink" onclick="navigator.clipboard.writeText('${esc(d.attach)}')
        .then(()=>{this.textContent='copied';setTimeout(()=>this.textContent='copy',1500)})">copy</a>
      </div>` : "";
    $("#now-agents").innerHTML = seat + (!d.run.running
      ? `<span class="empty">${d.run.parked
          ? "Campaign parked — no process alive, work preserved. Resume with /ship."
          : "No run active."}</span>`
      : !d.attributed
      ? (d.ledger.length ? `
        <div class="dim" style="margin-bottom:6px">From the factory ledger —
        transcripts unattributed (no orchestrator session marker). Greyed
        rows outlived the stale-claim window and are probably dead.</div>
        <table><tr><th>role</th><th>ticket</th><th class="num">elapsed</th></tr>
        ${d.ledger.map(r => `<tr${r.stale ? ' style="opacity:.45"' : ""}>
          <td>${esc(r.role)}</td><td class="mono">${tkLink(r.ticket)}</td>
          <td class="num">${elapsedSince(r.ts)}${r.stale ? ' · likely dead' : ''}</td>
          </tr>`).join("")}
        </table>`
        : `<span class="empty">Run active — no session marker, and no
           unreturned spawns in the factory ledger.</span>`)
      : (d.agents.length || d.orchestrator) ? `
      <table><tr><th>agent</th><th>ticket</th><th>doing</th><th class="num">running</th>
      <th class="num">tokens out</th><th class="num">tokens in</th>
      <th class="num">last activity</th></tr>
      ${d.orchestrator ? `<tr><td>orchestrator</td><td></td><td class="dim">/ship session</td>
        <td class="num"></td>
        <td class="num mono">${fmtTok(d.orchestrator.tokens_out)}</td>
        <td class="num mono">${fmtTok(d.orchestrator.tokens_in)}</td>
        <td class="num dim">${fmtAge(d.orchestrator.idle_s)} ago</td></tr>` : ""}
      ${d.agents.map(a => { const w = who(a); return `<tr><td>${esc(w.name)}</td>
        <td class="mono">${tkLink(a.ticket)}</td>
        <td>${esc(w.rest) || '<span class="dim">—</span>'}</td>
        <td class="num">${fmtAge(a.elapsed_s)}</td>
        <td class="num mono">${fmtTok(a.tokens_out)}</td>
        <td class="num mono">${fmtTok(a.tokens_in)}</td>
        <td class="num dim">${fmtAge(a.idle_s)} ago</td></tr>`}).join("")}
      </table>`
      : `<span class="empty">Run active, nothing in flight this instant.</span>`);
    $("#now-inbox").innerHTML = (d.inbox_pending.length
      ? d.inbox_pending.map(n => `<div class="mono">${esc(n)}</div>`).join("")
      : `<span class="empty">Empty.</span>`)
      + (d.inbox_age_s != null ? `<span class="dim" style="margin-left:8px">
         last activity ${fmtAge(d.inbox_age_s)} ago</span>` : "");
    const rb = $("#recon-badge");
    rb.hidden = !d.recon_pending;
    rb.textContent = d.recon_pending || "";
    /* Waiting on you — the held queue of open items addressed to the human
       (proposal ui-surface-human-queue). Count rides the tab title so an
       open question is visible from the browser tab. */
    const wt = d.waiting || [];
    document.title = wt.length
      ? `${d.project} factory (${wt.length})` : `${d.project} factory`;
    const linkIds = (s) => esc(s).replace(/\b((?:FEAT|TASK|BUG|DEBT|DEP)-\d{4})\b/g,
      (_, id) => tkLink(id));
    $("#now-waiting").innerHTML = wt.length ? `<table>
      ${wt.map(w => `<tr><td>${linkIds(w.question)}
        ${w.recommend ? `<div class="dim">Recommend: ${linkIds(w.recommend)}</div>` : ""}
        ${w.unblocks ? `<div class="dim">Unblocks: ${linkIds(w.unblocks)}</div>` : ""}</td>
        <td class="num dim">${fmtAge(w.age_s)}</td>
        <td class="num"><button class="act" style="padding:3px 12px"
          onclick="ackWaiting('${esc(w.name)}')">ack ✓</button></td></tr>`).join("")}
      </table>`
      : `<span class="empty">Nothing waiting on you.</span>`;
  } catch (e) { $("#runtext").textContent = "UI server unreachable"; }
}
async function ackWaiting(name) {
  await fetch("/api/ack-waiting",
              {method: "POST", body: JSON.stringify({name})});
  pollNow();
}
pollNow(); setInterval(pollNow, 3000);

/* invocation summary + agent history (transcript-derived, display-only) */
function fmtMin(s) { return s == null ? "n/a" : (s/60).toFixed(1) + " min"; }
async function tkTitles() {
  try {
    const map = {};
    (await (await fetch("/api/tickets")).json()).tickets
      .forEach(t => map[t.id] = t.title);
    return map;
  } catch (e) { return {}; }
}
async function loadHistory() {
  try {
    const [d, titles] = await Promise.all([
      (await fetch("/api/history")).json(), tkTitles()]);
    if (!d.attributed || !d.groups.length) {
      $("#now-summary").innerHTML =
        `<span class="empty">No /ship invocation recorded yet.</span>`;
      $("#now-history").innerHTML =
        `<span class="empty">History appears after the next /ship run.</span>`;
      return;
    }
    const cur = d.groups[d.groups.length - 1];
    $("#now-summary").innerHTML = `<table>
      <tr><th>started</th><td>${fmtLocal(cur.label)}</td></tr>
      <tr><th>agents</th><td>${cur.n}</td></tr>
      <tr><th>tokens out</th><td>${fmtTok(cur.tokens_out)}</td></tr>
      <tr><th>agent time</th><td>${fmtMin(cur.wall_s)}</td></tr></table>`;
    /* newest first, groups and rows both; doing = the agent's own handoff
       sentence once finished, its spawn description while live */
    $("#now-history").innerHTML = [...d.groups].reverse().map((g, i) => `
      <details${i === 0 ? " open" : ""}>
        <summary><b>${fmtLocal(g.label) || esc(g.label)}</b>
          <span class="dim">${g.n} agents · ${fmtTok(g.tokens_out)} tokens out
          · ${fmtMin(g.wall_s)}</span></summary>
        ${g.agents.length ? `<table>
          <tr><th>start</th><th>agent</th><th>ticket</th><th class="num">min</th>
          <th class="num">tokens out</th><th>doing</th></tr>
          ${[...g.agents].reverse().map(a => { const w = who(a); return `
          <tr${a.active ? ' class="live"' : ""}>
            <td class="mono dim">${fmtLocal(a.start)}</td>
            <td>${esc(w.name)}${a.active ? " ●" : ""}</td>
            <td class="mono">${tkLink(a.ticket)}</td>
            <td class="num">${(a.dur_s/60).toFixed(1)}</td>
            <td class="num mono">${fmtTok(a.tokens_out)}</td>
            <td>${a.active
              ? `<span class="dim">${esc(w.rest) || "—"}</span>`
              : esc(a.summary || w.rest) || '<span class="dim">—</span>'}
              ${titles[a.ticket] ? `<div class="dim" style="font-size:12px">
                ${esc(titles[a.ticket])}</div>` : ""}</td></tr>`}).join("")}
        </table>` : `<span class="empty">No agents in this window.</span>`}
      </details>`).join("");
  } catch (e) { $("#now-history").innerHTML =
      `<span class="empty">History unavailable: ${esc(String(e))}</span>`; }
}
loadHistory(); setInterval(loadHistory, 30000);

/* Spend (factory-ledger-derived; works even when transcripts are unattributed) */
async function loadSpend() {
  try {
    const [d, titles] = await Promise.all([
      (await fetch("/api/spend")).json(), tkTitles()]);
    $("#sp-roles").innerHTML = d.roles.length ? `
      <div style="margin-bottom:8px">total <b>${fmtTok(d.total_out)}</b>
        output tokens across the run's returned agents</div>
      <table><tr><th>role</th><th class="num">agents</th>
        <th class="num">tokens out</th><th class="num">share</th>
        <th class="num">agent time</th></tr>
      ${d.roles.map(r => `<tr><td>${esc(r.role)}</td>
        <td class="num">${r.agents}</td>
        <td class="num mono">${fmtTok(r.tokens_out)}</td>
        <td class="num">${r.pct}%</td>
        <td class="num">${(r.active_s/3600).toFixed(1)}h</td></tr>`).join("")}
      </table>` :
      `<span class="empty">No returned spawns in the ledger yet.</span>`;
    $("#sp-tickets").innerHTML = d.top_tickets.length ? `
      <table><tr><th>ticket</th><th>title</th><th class="num">tokens out</th></tr>
      ${d.top_tickets.map(t => `<tr>
        <td class="mono">${tkLink(t.ticket)}</td>
        <td class="dim">${esc(titles[t.ticket] || "")}</td>
        <td class="num mono">${fmtTok(t.tokens_out)}</td></tr>`).join("")}
      </table>` : `<span class="empty">No per-ticket spend recorded.</span>`;
    $("#sp-invs").innerHTML = d.invocations.length ? `
      <table><tr><th>invocation</th><th class="num">agents</th>
        <th class="num">tokens out</th></tr>
      ${[...d.invocations].reverse().map(g => `<tr>
        <td class="mono">${g.ts ? fmtLocal(g.ts)
          : '<span class="dim">before invocation tracking</span>'}</td>
        <td class="num">${g.agents}</td>
        <td class="num mono">${fmtTok(g.tokens_out)}</td></tr>`).join("")}
      </table>` : `<span class="empty">No invocations recorded.</span>`;
  } catch (e) { $("#sp-roles").innerHTML =
      `<span class="empty">Spend unavailable: ${esc(String(e))}</span>`; }
}

/* Tickets */
let allTickets = [];
async function loadTickets() {
  allTickets = (await (await fetch("/api/tickets")).json()).tickets;
  renderTickets();
}
function renderTickets() {
  const st = $("#tk-status").value, q = $("#tk-search").value.toLowerCase(),
        arch = $("#tk-arch").checked;
  const order = {open:0, reopened:1, claimed:2, built:3, qa:4, blocked:5,
                 disputed:6, done:7, wont_fix:8};
  const rows = allTickets
    .filter(t => (arch || !t.archived) && (!st || t.status === st) &&
      (!q || (t.id + " " + t.title).toLowerCase().includes(q)))
    .sort((a,b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
                   a.id.localeCompare(b.id));
  $("#tk-list").innerHTML = rows.length ? `
    <table><tr><th>id</th><th>title</th><th>status</th><th>pri</th><th>ms</th></tr>
    ${rows.map(t => `<tr>
      <td class="mono"><a class="tlink" onclick="showTicket('${esc(t.id)}')">
        ${esc(t.id)}</a></td>
      <td>${esc(t.title)}${t.archived ? ' <span class="pill archived">archived</span>':''}</td>
      <td>${pill(t.status)}</td><td class="dim">${esc(t.priority)}</td>
      <td class="dim">${esc(t.milestone ?? "")}</td></tr>`).join("")}
    </table>` : `<span class="empty">No tickets match.</span>`;
}
["tk-status","tk-search","tk-arch"].forEach(id =>
  $("#"+id).addEventListener("input", renderTickets));
async function showTicket(id) {
  const d = await (await fetch("/api/ticket?id=" + encodeURIComponent(id))).json();
  const el = $("#tk-detail");
  el.hidden = false;
  el.innerHTML = d.error ? esc(d.error) :
    `<h2>${esc(d.id)} ${pill(d.front.status)}</h2>
     <div class="rendered">${d.html}</div>`;
  el.scrollIntoView({behavior:"smooth"});
}

/* Mine */
async function loadMine() {
  const d = await (await fetch("/api/mine")).json();
  $("#mine-list").innerHTML = d.filings.length ? d.filings.map(f => `
    <div style="padding:10px 0; border-top:1px solid var(--line)">
      <div>${f.has_note
          ? `<a class="tlink" onclick="showFiling('${esc(f.filename)}')"><b>${esc(f.title)}</b></a>`
          : `<b>${esc(f.title)}</b>`}
        <span class="dim">filed ${esc(f.ts)}</span>
        ${f.pending ? '<span class="pill claimed">awaiting routing</span>' : ""}</div>
      <div class="rendered" id="filing-${esc(f.filename)}" hidden
           style="margin:6px 0 0 14px; padding:8px 12px; border-left:2px solid var(--line)"></div>
      ${f.tickets.map(t => `
        <div style="margin:6px 0 0 14px">
          <a class="tlink mono" onclick="jumpTicket('${esc(t.id)}')">${esc(t.id)}</a>
          ${pill(t.status)} ${t.resolution ? `<span class="dim">(${esc(t.resolution)})</span>` : ""}
          ${esc(t.title)}
          ${t.human_note ? `<div style="margin:3px 0; padding:4px 8px; border-left:3px solid var(--ok, #3a3); font-weight:600">${esc(t.human_note)}</div>` : ""}
          ${t.last_events.map(e => `<div class="event">${esc(e)}</div>`).join("")}
        </div>`).join("")}
      ${(!f.pending && !f.tickets.length)
        ? '<div class="event">routed — no ticket carries this filing\'s stamp (check the digest)</div>' : ""}
    </div>`).join("") : `<span class="empty">Nothing filed from here yet.</span>`;
}
function jumpTicket(id) {
  document.querySelector('[data-tab="tickets"]').click();
  showTicket(id);
}
async function showFiling(name) {
  const el = document.getElementById("filing-" + name);
  if (!el) return;
  if (!el.hidden) { el.hidden = true; return; }
  const d = await (await fetch("/api/filing?name=" + encodeURIComponent(name))).json();
  el.innerHTML = d.error ? esc(d.error) : d.html;
  el.hidden = false;
}
$("#f-send").onclick = async () => {
  const btn = $("#f-send");
  btn.disabled = true; $("#msg").textContent = "";
  try {
    const r = await (await fetch("/api/file", {method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({title: $("#f-title").value, body: $("#f-body").value})
    })).json();
    if (r.error) throw new Error(r.error);
    $("#msg").textContent = "Filed as " + r.filename;
    $("#f-title").value = ""; $("#f-body").value = "";
    loadMine();
  } catch (e) { $("#msg").textContent = "Failed: " + e.message; }
  btn.disabled = false;
};

/* Design reconciliations */
async function loadRecon() {
  const d = await (await fetch("/api/reconciliations")).json();
  const pending = d.entries.filter(e => e.status === "pending");
  const resolved = d.entries.filter(e => e.status !== "pending");
  $("#recon-pending").innerHTML = pending.length ? pending.map(e => `
    <div style="padding:10px 0; border-top:1px solid var(--line)">
      <div class="mono dim">${esc(e.name)}</div>
      <div class="rendered">${e.html}</div>
      <div style="margin-top:8px">
        <button class="act" onclick="resolveRecon('${esc(e.name)}','confirm')">
          Looks right</button>
        <button class="act danger"
          onclick="resolveRecon('${esc(e.name)}','reject')">
          Accidental — restore it</button>
      </div></div>`).join("")
    : `<span class="empty">Nothing awaiting confirmation.</span>`;
  $("#recon-resolved").innerHTML = resolved.length ? resolved.map(e => `
    <details><summary>${pill(e.status)}
      <span class="mono">${esc(e.name)}</span></summary>
      <div class="rendered">${e.html}</div></details>`).join("")
    : `<span class="empty">None yet.</span>`;
}
async function resolveRecon(name, action) {
  const r = await (await fetch("/api/reconcile", {method:"POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({name, action})})).json();
  if (r.error) alert(r.error);
  loadRecon(); pollNow();
}

/* Docs */
async function loadDocs() {
  const d = await (await fetch("/api/docs")).json();
  $("#docs-side").innerHTML = d.sections.map((s, i) =>
    `<details${i === 0 ? " open" : ""}>
       <summary>${esc(s.label)} <span class="dim">(${s.docs.length})</span></summary>` +
    s.docs.map(p =>
      `<a class="doc" data-p="${esc(p)}">${esc(p.split("/").slice(-2).join("/"))}</a>`).join("") +
    `</details>`
  ).join("");
  document.querySelectorAll("#docs-side .doc").forEach(a => a.onclick = async () => {
    document.querySelectorAll("#docs-side .doc").forEach(x =>
      x.classList.toggle("sel", x === a));
    const d = await (await fetch("/api/doc?path=" +
      encodeURIComponent(a.dataset.p))).json();
    $("#doc-view").innerHTML = d.error ? esc(d.error)
      : `<p class="dim mono">${esc(d.path)}</p>` + d.html;
  });
}
</script></body></html>
"""


# --- entrypoints -----------------------------------------------------------------

def _probe(port):
    """What lives on a port: a dict (a live factory UI's identity),
    'ours-stale' (a pre-/whoami UI of THIS repo — the 2026-07-16 ghost
    class), 'foreign' (someone else's server — never touch it), or 'free'."""
    base = "http://127.0.0.1:%d" % port
    try:
        with urllib.request.urlopen(base + "/whoami", timeout=2) as r:
            info = json.load(r)
        return info if info.get("app") == "agenticflow-ui" else "foreign"
    except Exception as e:
        if isinstance(getattr(e, "reason", e), ConnectionRefusedError):
            return "free"
    # answered, but not the protocol: an old factory UI still exposes
    # /api/ping with its root — a root inside THIS repo proves the server
    # is our stale ghost and may be killed
    try:
        with urllib.request.urlopen(base + "/api/ping", timeout=2) as r:
            root = os.path.realpath(json.load(r).get("root") or "/nonexistent")
        me = os.path.realpath(lib.PRODUCT)
        if root == me or root.startswith(me + os.sep):
            return "ours-stale"
    except Exception:
        pass
    return "foreign"


def _mine(info):
    return isinstance(info, dict) \
        and info.get("repo") == os.path.realpath(lib.PRODUCT) \
        and info.get("factory_home") == os.path.realpath(lib.ROOT)


def _current(info):
    """Ours AND running the code now on disk — only such a server is
    adopted. An identity match on older code (or a pre-generation server
    that reports no script hash) is a stale ghost with a heartbeat."""
    return _mine(info) and info.get("script") == SCRIPT_SHA


def _adopt(port, open_browser):
    url = "http://127.0.0.1:%d/" % port
    with open(UI_URL, "w", encoding="utf-8") as f:
        f.write(url + "\n")
    if open_browser and sys.platform == "darwin":
        subprocess.run(["open", url], check=False)
    print(url)
    return 0


def ensure(preferred, open_browser=True):
    """Start or adopt this repo's UI. run.yaml `ui_port` is a PREFERENCE,
    not a claim (v0.3-F): our live UI on a port → reuse it; our stale ghost
    → kill it and take the port; anything else alive → step to the next
    free port. The actually-bound URL lands in tracker/ui.url."""
    chosen = None
    for port in range(preferred, preferred + 20):
        info = _probe(port)
        if _current(info):
            return _adopt(port, open_browser)          # already up: reuse
        if _mine(info):
            info = "ours-stale"  # right repo, pre-upgrade code: retire it
        if isinstance(info, dict):
            continue           # another repo's live factory UI — never kill
        if info == "ours-stale":
            pids = subprocess.run(["lsof", "-ti", ":%d" % port],
                                  capture_output=True, text=True).stdout.split()
            for pid in pids:
                subprocess.run(["kill", pid], capture_output=True)
            for _ in range(12):
                if _probe(port) == "free":
                    break
                time.sleep(0.25)
            if _probe(port) != "free":
                continue       # would not die — leave it, keep walking
            print("killed stale factory UI of this repo on port %d (pid %s)"
                  % (port, ",".join(pids)), file=sys.stderr)
        elif info != "free":
            continue                                    # foreign server
        chosen = port
        break
    if chosen is None:
        print("ui.py --ensure: no usable port in %d-%d"
              % (preferred, preferred + 19), file=sys.stderr)
        return 1
    with open(UI_LOG, "a") as log:
        subprocess.Popen([sys.executable, os.path.abspath(__file__),
                          "--port", str(chosen)],
                         stdout=log, stderr=log, start_new_session=True)
    for _ in range(20):
        if _mine(_probe(chosen)):
            return _adopt(chosen, open_browser)
        time.sleep(0.25)
    print("ui.py --ensure: server did not come up; see agenticflow/tracker/ui.log",
          file=sys.stderr)
    return 1


def _bgmon_register(url):
    """Best-effort row in the machine-level bgmon registry so live factory
    UIs show in the menu bar. No registry → silently skip (optional
    integration; BGMON_REGISTRY env overrides the path for tests)."""
    reg = os.environ.get("BGMON_REGISTRY") \
        or os.path.expanduser("~/.config/bgmon/registry.tsv")
    if not os.path.isfile(reg):
        return
    try:
        name = "factory-ui-" + os.path.basename(os.path.realpath(lib.PRODUCT))
        row = "\t".join([name, "process", os.path.abspath(__file__), UI_LOG,
                         "manual", "Attention UI - " + url])
        lines = [ln for ln in open(reg, encoding="utf-8").read().splitlines()
                 if ln.strip() and not ln.startswith(name + "\t")]
        with open(reg, "w", encoding="utf-8") as f:
            f.write("\n".join(lines + [row]) + "\n")
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT,
                    help="server: bind this port; --ensure: preferred port")
    ap.add_argument("--ensure", action="store_true",
                    help="start detached if not running, then open the browser")
    ap.add_argument("--no-browser", action="store_true",
                    help="with --ensure: do not open a browser tab")
    ap.add_argument("--bind", default="127.0.0.1",
                    help="server: bind address. The UI has NO auth — only ever "
                         "bind a Tailscale IP (100.x) for remote access, never "
                         "0.0.0.0. --ensure ignores this and stays localhost.")
    a = ap.parse_args()
    if a.ensure:
        sys.exit(ensure(a.port, open_browser=not a.no_browser))
    srv = ThreadingHTTPServer((a.bind, a.port), Handler)
    url = "http://%s:%d/" % (a.bind, a.port)
    with open(UI_URL, "w", encoding="utf-8") as f:
        f.write(url + "\n")
    _bgmon_register(url)
    renderer = "mistune" if _render else "pre-fallback"
    print("attention UI on %s (renderer: %s)" % (url, renderer))
    srv.serve_forever()


if __name__ == "__main__":
    main()
