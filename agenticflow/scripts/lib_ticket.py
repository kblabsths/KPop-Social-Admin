"""Shared helpers for the AgenticFlow tracker.

Tickets are markdown files with a constrained YAML frontmatter: flat keys,
scalar values, and inline lists only ([a, b]). This is deliberate — it keeps
every ticket parseable by plain code with no dependencies, which is what lets
the dispatcher's deterministic layer run at zero token cost.
"""
import hashlib
import os
import re
import shlex
import subprocess
from datetime import datetime, timezone

# ROOT is the factory home (the agenticflow/ dir holding tracker/, docs/,
# run.yaml). PRODUCT is the repo checkout the invoking script physically sits
# in — where product_dir, touch scopes, git commands, and ci_command resolve.
# Canonical layout puts the factory home one level inside the product repo; a
# factory sitting at the repo root itself (pre-0.2 installs) still resolves
# correctly because git names the repo root directly.
#
# Branch-per-ticket (v0.3-A) splits the two: builders work in linked
# worktrees (agenticflow/.worktrees/<ID>), so a script run from a worktree
# copy sees PRODUCT = that worktree, but ROOT — tracker, docs, run.yaml —
# always resolves to the PRIMARY checkout. Coordination state is shared,
# never branch-local; a ticket write from a worktree lands in the one true
# tracker, and worktree tracker snapshots stay untouched so merges never
# conflict on bookkeeping.
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _product_root():
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                             cwd=_HERE, capture_output=True, text=True,
                             timeout=10).stdout.strip()
        if top:
            return top
    except Exception:
        pass
    return os.path.dirname(_HERE)


PRODUCT = _product_root()


def _shared_home():
    """Factory home for shared state. ONLY a ticket worktree (which lives at
    <home>/.worktrees/<ID>) redirects to the home it belongs to — any other
    checkout, including a whole-run worktree (one concurrent /ship per
    worktree, v0.3-G), is its own factory with its own tracker. Anchoring on
    the path, not git's common dir, is what keeps two runs from silently
    sharing a tracker."""
    parent = os.path.dirname(PRODUCT)
    if os.path.basename(parent) == ".worktrees":
        return os.path.dirname(parent)
    return _HERE


ROOT = _shared_home()


def _primary_root():
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                             cwd=ROOT, capture_output=True, text=True,
                             timeout=10).stdout.strip()
        if top:
            return top
    except Exception:
        pass
    return os.path.dirname(ROOT)


PRIMARY = _primary_root()
TICKETS = os.path.join(ROOT, "tracker", "tickets")
ARCHIVE = os.path.join(ROOT, "tracker", "archive")
NOTES = os.path.join(ROOT, "tracker", "notes")
RECEIPTS = os.path.join(ROOT, "tracker", "receipts")
INDEX = os.path.join(ROOT, "tracker", "INDEX.md")
RUN_CFG = os.path.join(ROOT, "run.yaml")
SPAWN_LOG = os.path.join(ROOT, "tracker", "spawn_log.tsv")

TYPES = ["FEAT", "TASK", "BUG", "DEBT", "DEP"]
STATUSES = [
    "open", "claimed", "built", "qa", "done",
    "blocked", "wont_fix", "reopened", "disputed",
]
PRIORITIES = ["P0", "P1", "P2", "P3"]
ROLES = [
    "visionary", "architect", "designer", "builder", "qa", "verifier",
    "strategist", "toolsmith", "compactor", "dispatcher", "human",
]

LIST_KEYS = {"children", "depends_on", "touch_scope", "recheck",
             "seen_failure_sigs", "siblings"}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_value(key, raw):
    raw = raw.strip()
    if key in LIST_KEYS:
        if raw in ("", "[]", "null"):
            return []
        if raw.startswith("[") and raw.endswith("]"):
            inner = raw[1:-1].strip()
            if not inner:
                return []
            return [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]
        return [raw.strip("'\"")]  # tolerate a bare scalar
    if raw in ("null", "~", ""):
        return None
    if raw in ("true", "True"):
        return True
    if raw in ("false", "False"):
        return False
    if raw.isdigit():  # counters (attempts, empty_diffs, …); IDs/priorities
        return int(raw)  # always carry letters, so pure digits are safe
    return raw.strip("'\"")


def frontmatter_lines(block):
    """THE definition of where a frontmatter line ends. One function, two users.

    parse_ticket splits the frontmatter block with this, and serialize_value
    refuses any value this does not hand back whole — so the parser's alphabet
    and the guard's alphabet are the SAME alphabet by construction, not by two
    lists that have to agree.

    That is the whole lesson of BUG-0058. BUG-0053's first fix typed its
    alphabet ("\\n" and "\\r") while parse_ticket was already splitting with
    str.splitlines(), which ends a line on TEN characters
    (\\n \\r \\x0b \\x0c \\x1c \\x1d \\x1e \\x85 \\u2028 \\u2029). The eight the
    guard did not name went through untouched and were split back into KEYS by
    the parser: BUG-0053's damage, verbatim, under a green suite that claimed
    it was closed. Any future change to how a frontmatter line is split belongs
    HERE, where both sides move together — never in a second list.
    """
    return block.splitlines()


def is_single_frontmatter_line(text):
    """True when `text` survives the parser's own splitting as exactly one line.

    Empty is one legal (empty) line's worth of value; anything the splitter
    breaks, drops or shortens is not one value.
    """
    return frontmatter_lines(text) == ([text] if text else [])


def _line_breaks_in(text):
    """The offending characters, named the same way — for the error message."""
    bad = sorted({c for c in text if not is_single_frontmatter_line(c)})
    return ", ".join("\\x%02x" % ord(c) if ord(c) < 0x100
                     else "\\u%04x" % ord(c) for c in bad)


class FrontmatterValueError(ValueError):
    """A frontmatter value that cannot be written as ONE value.

    The frontmatter is line-oriented (see this module's docstring), so a value
    carrying a line break is not a value at all — it is more KEYS, silently
    overriding whatever the parser reads last. Measured: a milestone of
    'M3\\nstatus: done' wrote a second `status:` line, parse_ticket resolved
    status='done', and the ticket left dispatch.py's builder queue with
    set-milestone, show and dispatch all exiting 0 (BUG-0053). The guard lives
    here rather than at the verbs so every present and future frontmatter key
    is covered by construction; the BODY (description, criteria, History
    notes) is not serialized through here and stays freely multi-line.
    """


def serialize_value(key, val):
    if key in LIST_KEYS:
        out = "[" + ", ".join(val or []) + "]"
    elif val is None:
        out = "null"
    elif val is True:
        out = "true"
    elif val is False:
        out = "false"
    else:
        out = str(val)
    if not is_single_frontmatter_line(out):
        # REFUSE, never sanitize: a value silently rewritten to 'M3status:
        # done' is still a wrong value written under a success exit. write_ticket
        # calls this before it opens the file, so a refusal writes nothing.
        # The test is the PARSER's own splitting (frontmatter_lines), never a
        # list of characters — a typed alphabet drifts (BUG-0058).
        raise FrontmatterValueError(
            "frontmatter value for %r contains a line break (%s), so it would "
            "be written as extra frontmatter KEYS instead of one value: %r. "
            "The frontmatter is what the scheduler reads — one field may not "
            "write another. Pass a single-line value (multi-line text belongs "
            "in the ticket body: description, criteria, a --note)."
            % (key,
               _line_breaks_in(out) or "it does not survive the line split",
               val))
    return out


def parse_ticket(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.DOTALL)
    if not m:
        raise ValueError("%s: missing frontmatter" % path)
    front, body = {}, m.group(2)
    order = []
    for line in frontmatter_lines(m.group(1)):  # the guard reads the same fn
        if not line.strip() or line.strip().startswith("#"):
            continue
        if ":" not in line:
            raise ValueError("%s: bad frontmatter line: %r" % (path, line))
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = raw.split("  #")[0]  # strip trailing comments
        front[key] = parse_value(key, raw)
        order.append(key)
    return {"path": path, "front": front, "order": order, "body": body}


# --- grading isolation (BUG-0073) -------------------------------------------
# receipt.py REPLAYS every command a ticket's criteria/Checks name, with
# shell=True, on every receipt. A command that WRITES the tracker is therefore
# not a measurement — it is an action with no author and no end. Measured on
# the live tracker: BUG-0053's criterion 3 was
#   ticket.py set-milestone DEBT-0002 M2 --as architect --note '<criterion>'
# It was a no-op when written; after the strategist restamped DEBT-0002 to
# 'patch', the next receipt put it back and credited an architect who never
# ran it, once per receipt run, forever.
#
# So: receipt.py exports the tracker home it is grading into the environment
# of the commands it runs, and every ticket write under that home refuses
# while it is set. It carries the PATH rather than a bare on/off flag on
# purpose — the factory's own test suite is itself a graded command, and the
# scratch factories it builds in tempdirs write tickets legitimately. Only the
# tracker being graded is frozen. receipt.py does not set the variable in its
# OWN environment, so its writes to the ticket it is grading (last_failure_sig
# and the RED history line, both by design) are unaffected.
GRADING_ENV = "AGENTICFLOW_GRADING_ROOT"


class TrackerWriteRefused(RuntimeError):
    """A tracker write attempted from inside a command being graded."""


def _within(path, root):
    root = os.path.realpath(root)
    target = os.path.realpath(path)
    return target == root or target.startswith(root.rstrip(os.sep) + os.sep)


def refuse_if_grading(path):
    """Raise when `path` belongs to the tracker currently being graded."""
    guard = os.environ.get(GRADING_ENV)
    if not guard or not _within(path, guard):
        return
    raise TrackerWriteRefused(
        "refused to write %s: this command is being REPLAYED by the evidence "
        "receipt, and grading may not mutate the state it grades. A check is "
        "re-run on every receipt, so a check that writes the tracker is an "
        "edit with no author, no ruling and no end (BUG-0073: a set-milestone "
        "check silently reverted a strategist's ruling on DEBT-0002 once per "
        "receipt). Make the check OBSERVE instead — read the value back, e.g. "
        "ticket.py show <ID> | grep -q '^milestone: patch'. Rewriting a "
        "ticket's checks is the architect's call, not this command's."
        % os.path.relpath(path, os.path.realpath(guard)))


def write_ticket(t):
    refuse_if_grading(t["path"])
    lines = ["---"]
    keys = list(t["order"])
    for k in t["front"]:
        if k not in keys:
            keys.append(k)
    for k in keys:
        lines.append("%s: %s" % (k, serialize_value(k, t["front"].get(k))))
    lines.append("---")
    text = "\n".join(lines) + "\n" + t["body"]
    with open(t["path"], "w", encoding="utf-8") as f:
        f.write(text)


def load_all(include_archive=False):
    tickets = {}
    dirs = [TICKETS] + ([ARCHIVE] if include_archive else [])
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".md"):
                continue
            t = parse_ticket(os.path.join(d, name))
            tickets[t["front"]["id"]] = t
    return tickets


def next_id(ticket_type):
    highest = 0
    for d in (TICKETS, ARCHIVE):
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            m = re.match(r"^%s-(\d+)\.md$" % ticket_type, name)
            if m:
                highest = max(highest, int(m.group(1)))
    return "%s-%04d" % (ticket_type, highest + 1)


def append_history(t, actor, note):
    entry = "- %s [%s] %s\n" % (now_iso(), actor, note)
    if "## History" not in t["body"]:
        t["body"] = t["body"].rstrip() + "\n\n## History\n"
    t["body"] = t["body"].rstrip() + "\n" + entry.rstrip() + "\n"


# --- evidence receipts (A4) -------------------------------------------------
# The receipt gate computes "done" from facts a script observed — commands
# actually run, exit codes actually seen, on code that hasn't changed since.
# It proves the claimed checks passed on this exact tree, nothing more: goal-
# match stays QA judgment (criteria are the floor, not the ceiling).

CMD_STARTERS = {"cd", "python", "python3", "pytest", "npm", "npx", "node",
                "yarn", "pnpm", "bash", "sh", "make", "cargo", "go", "curl",
                "sqlite3", "grep", "test", "[", "!"}
_PROSE_CMD_RE = re.compile(
    r"((?<!\w)(?:(?:cd|python3?|pytest|npm|npx|node|yarn|pnpm|bash|sh|make|grep)\b|\./|\.venv/)"
    r"[^\n;`]*?)\s+exits 0")
# quoted prose form: 'grep -q "x" app.css' exits 0 — the quotes delimit the
# command exactly, so starters too English-word-shaped for the bare prose
# alternation (test, [) are safe here; either quote kind may wrap, the other
# kind may appear inside
_QUOTED_PROSE_RE = re.compile(r"'([^'\n]+)'\s+exits 0|\"([^\"\n]+)\"\s+exits 0")


def _first_token(cmd):
    parts = (cmd or "").split()
    # quotes around the program are shell noise, not part of its path
    return parts[0].strip("\"'") if parts else ""


# an absolute path: a slash followed by a path character. `//` is excluded on
# purpose — a backticked C-style comment ("// --- QA/BUG-0019 ...") is the one
# leading-slash shape that occurs in criteria prose and is not a command.
_ABS_PROGRAM_RE = re.compile(r"/[A-Za-z0-9_.+-]")


def _runner_span(span):
    # An absolute path in command position IS a command — decided by shape,
    # not by the interpreter's name, and NOT by whether it exists here.
    # Existence is deliberately not consulted: a span that vanishes from the
    # harvest on the machine that lacks the binary is the DEBT-0004 defect
    # itself (a bar that reads like a bar and grades nothing). Unrunnable
    # absolute paths are refused at BIRTH instead — see check_defects.
    first = _first_token(span)
    return (first in CMD_STARTERS or first.startswith("./")
            or first.startswith(".venv/") or "/.venv/bin/" in first
            or bool(_ABS_PROGRAM_RE.match(first)))


def _quotes_close(span):
    """True when every quote in span is matched, i.e. the string is one the
    receipt gate can actually run (it runs commands with shell=True, so an
    orphan quote is exit 2 on any tree). shlex is the stdlib's POSIX quote
    lexer and agrees with `bash -n` on this property; hand-counting quote
    characters does not (a ' inside "..." is literal, so a count is even
    exactly when the string is unbalanced)."""
    try:
        shlex.split(span)
    except ValueError:          # "No closing quotation" / "No escaped character"
        return False
    return True


def _shed_prose_delimiter(span):
    """The bare-prose regex starts its match at the RUNNER token, so when the
    criterion used the quoted prose form ('grep -q "x" f' exits 0) the match
    carries the closing delimiter and not the opening one; that orphan has to
    come off (DEBT-0004, a45e455). Shed it on BALANCE, never on the last
    character: a command that legitimately ends in a quote of its own —
    bash -c '<pinned python> -m pytest x -q' — is already balanced, and the
    unconditional strip("'\\"") took that quote too, handing the gate
    unparseable shell on correct work (BUG-0067, live on TASK-0016/0019).
    A span that no single-delimiter removal can balance is left alone: it is
    an authoring defect to report, not one to guess at."""
    if _quotes_close(span):
        return span
    if span[-1:] in ("'", '"') and _quotes_close(span[:-1]):
        return span[:-1]
    return span


def checks_commands(body):
    """Commands from the '## Checks' section — a fenced code block, one
    command per line. This is the structured storage that replaces prose
    scraping: everything inside the fence is a command, everything outside
    never runs. Blank lines and #-comments are skipped."""
    m = re.search(r"## Checks\n(.*?)(?=\n## |\Z)", body, re.DOTALL)
    if not m:
        return []
    # the closing fence counts only at column 0 of its own line, mirroring
    # how ticket.py writes it — a ``` mid-command (kspace TASK-0032: a sed
    # range over a fenced receipt) must never end the block early, or the
    # command runs truncated and every later check silently drops
    fence = re.search(r"```[^\n]*\n(.*?)\n```[ \t]*(?=\n|\Z)",
                      m.group(1), re.DOTALL)
    if not fence:
        return []
    return [ln.strip() for ln in fence.group(1).splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


def criteria_commands(body):
    """Runnable commands for the receipt gate. A '## Checks' fenced block is
    authoritative when present (structured storage — nothing is scraped).
    Legacy tickets fall back to the prose scraper: backticked spans starting
    with a known runner, and the '<command> exits 0' prose conventions."""
    checks = checks_commands(body)
    if checks:
        return checks
    m = re.search(r"## Acceptance criteria\n(.*?)(?=\n## |\Z)", body, re.DOTALL)
    if not m:
        return []
    sect = m.group(1)
    cmds = []
    for span in re.findall(r"`([^`\n]+)`", sect):
        span = span.strip()
        if _runner_span(span):
            cmds.append(span)
    for mm in _PROSE_CMD_RE.finditer(sect):
        cmds.append(_shed_prose_delimiter(mm.group(1).strip().rstrip(".,")))
    for mm in _QUOTED_PROSE_RE.finditer(sect):
        span = (mm.group(1) or mm.group(2)).strip()
        if _runner_span(span):
            cmds.append(span)
    out, seen = [], set()
    for c in cmds:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


# --- birth checks: statically decidable ways a check can lie ---------------
# Applied when a ticket (or amended criteria/checks) is written, so a gate
# that can only mis-fire is refused before any builder or QA is spawned.
# Birth-legal means runnable and well-formed, NOT passing — a fix-asserting
# check is correctly RED at birth.

_COUNT_WRAPPED_RE = re.compile(r'test\s+"?\$\(.*\)"?\s+-(eq|ne|gt|lt|ge|le)\s+\d')
_ABS_PATH_RE = re.compile(r"/(?:[\w.+-]+/)+[\w.+-]+")
_PINNED_RUNNERS = {}


def _executable(path):
    return os.path.isfile(path) and os.access(path, os.X_OK)


def _ci_script():
    """The ci_command's script, resolved against PRODUCT (run.yaml's command
    is relative to the checkout). None when ci_command is a shell pipeline
    rather than a script."""
    tok = _first_token(load_run_config()["ci_command"])
    if not tok:
        return None
    path = tok if os.path.isabs(tok) else os.path.join(PRODUCT, tok)
    return path if os.path.isfile(path) else None


def pinned_runners():
    """Absolute interpreter paths this repo's OWN ci_command script invokes,
    that exist and are executable here.

    A repo whose test dependency lives on one specific interpreter pins that
    path in its CI script (run_tests.sh's $PYTHON default here). That pin is
    a stronger guarantee than a .venv — it is the exact binary CI runs — so a
    check naming it is runnable, and refusing it (DEBT-0004) left this repo
    unable to file ANY machine-graded pytest bar. Learned from the script so
    there is no second copy of the path to drift: change the pin, the guard
    follows. Empty (no CI script, or the pin is absent from this machine)
    falls back to the original venv-only rule."""
    script = _ci_script()
    if script not in _PINNED_RUNNERS:
        found = set()
        try:
            with open(script, encoding="utf-8", errors="replace") as f:
                lines = [ln for ln in f if not ln.lstrip().startswith("#")]
        except (OSError, TypeError):
            lines = []
        for line in lines:
            for path in _ABS_PATH_RE.findall(line):
                if _executable(path):
                    found.add(path)
        _PINNED_RUNNERS[script] = found
    return _PINNED_RUNNERS[script]


_ENV_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*=")
_QUOTED_ARG_RE = re.compile(r"'([^']*)'|\"([^\"]*)\"")


def _shell_segments(cmd):
    """The pieces a shell would hand to separate programs — split on && || ; |
    & and newline, with quoted text left intact (so `sh -c "a && b"` stays one
    segment and is unwrapped by the caller instead)."""
    segs, buf, quote, i = [], [], None, 0
    while i < len(cmd):
        ch = cmd[i]
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            buf.append(ch)
        elif cmd.startswith("&&", i) or cmd.startswith("||", i):
            segs.append("".join(buf))
            buf = []
            i += 2
            continue
        elif ch in ";|&\n":
            segs.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    segs.append("".join(buf))
    return [s.strip() for s in segs if s.strip()]


def _pytest_runner_ok(seg, depth=0):
    """True when the program in COMMAND POSITION of this segment is one that
    has pytest here: the product venv's interpreter, or an absolute path this
    repo's ci_command script pins. Asking who runs the pytest — rather than
    whether a pinned path appears somewhere in the string (BUG-0057) — is what
    keeps `<pin> -m pytest a && pytest b` refused: its second segment exits
    127, and `pytest a ; <pin> --version` exits 0 having run nothing."""
    toks = [t.strip("\"'") for t in seg.split()]
    while toks and _ENV_ASSIGN_RE.match(toks[0]):
        toks.pop(0)
    if not toks:
        return False
    prog = toks[0]
    if ".venv" in prog or prog in pinned_runners():
        return True
    # `sh -c "<pin> -m pytest ..."` — the pin is the program one level down;
    # the quoted script is re-split and judged by the same rule.
    if os.path.basename(prog) in ("sh", "bash") and depth < 3:
        inner = [g for m in _QUOTED_ARG_RE.finditer(seg)
                 for g in m.groups() if g and "pytest" in g]
        return bool(inner) and all(_pytest_bars_ok(s, depth + 1) for s in inner)
    return False


def _pytest_bars_ok(cmd, depth=0):
    """True when EVERY segment of `cmd` that runs pytest runs it under an
    interpreter that has pytest. One bad segment is enough to lie."""
    return all(_pytest_runner_ok(seg, depth)
               for seg in _shell_segments(cmd) if "pytest" in seg)


def check_defects(cmds, scope=None):
    """(command, why-it-lies) pairs for statically detectable defects:
    count pipelines whose exit code doesn't encode the count, pytest outside
    the venv, pytest over browser-driver paths, and a .tsx-only scope signed
    off by a leaf test the scope never touches."""
    probs = []
    scope = scope or []
    tsx_only = bool(scope) and all(p.endswith((".tsx", ".jsx")) for p in scope)
    for c in cmds:
        wrapped = bool(_COUNT_WRAPPED_RE.search(c))
        if not wrapped and re.search(r"\|\s*wc\s+-l", c):
            probs.append((c, "a count via '| wc -l' always exits 0 — the gate "
                          "passes even when the count is wrong (silent "
                          "false-GREEN). Assert the number itself: "
                          "test \"$(<pipeline> | wc -l)\" -eq N"))
        elif not wrapped and re.search(r"\bgrep\b[^|]*\s-[A-Za-z]*c", c):
            probs.append((c, "'grep -c' exits 1 exactly when the count is 0 — "
                          "the gate goes RED on the completed state "
                          "(false-RED). Wrap it: test \"$(grep -c ...)\" -eq N"))
        first = _first_token(c)
        if _ABS_PROGRAM_RE.match(first) and not _executable(first):
            probs.append((c, "the command starts with an absolute path that is "
                          "not an executable file here (%s) — it exits 127 "
                          "wherever it is graded (false-RED). Name a binary "
                          "that exists on this machine, or run it through a "
                          "runner on PATH" % first))
        if "pytest" in c and not _pytest_bars_ok(c):
            probs.append((c, "pytest outside the product venv runs the host "
                          "interpreter, which has no pytest — a guaranteed "
                          "false-RED. Route it through the venv "
                          "(cd <product> && .venv/bin/python -m pytest ...) or "
                          "name the interpreter this repo's ci_command script "
                          "already pins pytest to (%s). Naming it is not "
                          "enough: it must be the program RUNNING the pytest "
                          "in the &&/||/;/| segment where pytest appears — a "
                          "segment that shells out to a bare pytest exits 127, "
                          "or worse exits 0 having run no test"
                          % (", ".join(sorted(pinned_runners())) or "none "
                             "found — the CI script pins no absolute "
                             "interpreter")))
        if re.search(r"pytest\b[^|;]*\btests_js/", c):
            probs.append((c, "pytest over a tests_js/ path is unrunnable by "
                          "construction (browser-driver scripts live outside "
                          "the app venv and pytest's testpaths) — false-RED; "
                          "pin a check the venv can actually run"))
        if tsx_only:
            m = re.search(r"(?:node\s+--test|pytest|vitest[^|;&]*?)\s+(\S+"
                          r"\.(?:test|spec)\.[a-z]+)", c)
            if m and not any(p.endswith(m.group(1)) or m.group(1).endswith(p)
                             for p in scope):
                probs.append((c, "the touch_scope is .tsx-only but this runs "
                              "%s, which the scope does not touch — that "
                              "receipt greens on the UNCHANGED module (vacuous "
                              "green). Assert on the source file in scope "
                              "(grep/babel structural pin) plus a "
                              "'Human-check:' line" % m.group(1)))
    return probs


def vacuous_test_run(cmd, output):
    """True when a test-runner command reports ZERO tests executed — an
    empty bar. Zero tests run is not a pass, whatever the exit code says: a
    renamed/moved test file otherwise greens forever (criteria rot)."""
    if "pytest" in cmd:
        low = output.lower()
        if "no tests ran" in low or "collected 0 items" in low:
            return True
    if re.search(r"\bnode\b.*--test\b", cmd) or "vitest" in cmd:
        if re.search(r"^\s*(?:#|ℹ)?\s*tests 0\s*$", output, re.M):
            return True
        if "no test files found" in output.lower():
            return True
    return False


def scope_tree_hash(rel_paths, base=None):
    """Content hash of every file under the given paths, relative to `base`
    (default PRODUCT; pass a ticket's worktree to hash the tree the build
    actually happened in). Volatile artifacts (venvs, caches, logs,
    databases) are excluded — they change as a side effect of running the
    criteria commands themselves."""
    base = base or PRODUCT
    skip_dirs = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache"}
    skip_suffix = (".log", ".coverage", ".db", ".sqlite", ".sqlite3", ".pyc")
    entries = []
    for rel in sorted(set(rel_paths)):
        top = os.path.join(base, rel)
        files = [top] if os.path.isfile(top) else []
        if not files:
            for dirpath, dirnames, filenames in os.walk(top):
                dirnames[:] = sorted(d for d in dirnames if d not in skip_dirs)
                files += [os.path.join(dirpath, n) for n in sorted(filenames)
                          if not n.endswith(skip_suffix)]
        for p in files:
            try:
                with open(p, "rb") as f:
                    digest = hashlib.sha256(f.read()).hexdigest()
            except OSError:
                continue
            entries.append(os.path.relpath(p, base) + ":" + digest)
    h = hashlib.sha256()
    for e in sorted(entries):
        h.update(e.encode("utf-8"))
    return h.hexdigest()


def failure_signature(output):
    """Deterministic fingerprint of HOW something failed. Two runs failing the
    same way produce the same signature — 'progress' is the signature moving.
    Basis: the sorted failing-test set when parseable, else the output tail
    with volatile tokens (numbers, addresses) normalized away."""
    tests = sorted(set(re.findall(r"^(?:FAILED|ERROR)\s+(\S+)", output, re.M)))
    basis = "\n".join(tests) if tests \
        else re.sub(r"0x[0-9a-f]+|\d+", "N", output[-800:])
    return hashlib.sha256(basis.encode("utf-8", "replace")).hexdigest()[:12]


def default_scope():
    """Fallback touch scope for tickets that omit one: the product tree(s)
    (run.yaml product_dir), so a transplanted factory scopes the right code.
    Comma-separated for products spanning several top-level paths; entries
    may be files (scope_tree_hash handles both)."""
    val = str(load_run_config()["product_dir"])
    return [p.strip() for p in val.split(",") if p.strip()]


# The factory never repairs itself: machinery is kit code, fixed by the human
# in the kit and delivered by upgrade — never by a run's own tickets (the
# 2026-08 workout run landed ~3000 lines of self-modification this way,
# forking the installed kit). tracker/ and docs/ stay open: state and product
# artifacts are the run's to write; code, defs, hooks, and config are not.
FACTORY_PATHS = ("agenticflow/scripts/", ".claude/")
FACTORY_FILES = ("agenticflow/run.yaml", "agenticflow/.kit-manifest.tsv")


def factory_scope_offenders(scope):
    """Scope entries that name factory machinery (normalized; a trailing
    slash or leading ./ must not slip past)."""
    out = []
    for entry in scope or []:
        p = os.path.normpath(entry).lstrip("/")
        if p in FACTORY_FILES or any(
                p == d.rstrip("/") or p.startswith(d) for d in FACTORY_PATHS):
            out.append(entry)
    return out


def drop_keys(t, keys):
    for k in keys:
        t["front"].pop(k, None)
        if k in t["order"]:
            t["order"].remove(k)


def spawn_ledger_running():
    """Unmatched 'spawned' lines = agents in flight (factory-owned truth).
    Format: ts \t role \t ticket-or-purpose \t tokens|'spawned'."""
    running, done_counts = [], {}
    if not os.path.exists(SPAWN_LOG):
        return running
    with open(SPAWN_LOG, "r", encoding="utf-8") as f:
        rows = [ln.rstrip("\n").split("\t") for ln in f
                if ln.strip() and not ln.startswith("#")]
    for parts in rows:
        if len(parts) < 4:
            continue
        ts, role, ticket, tok = parts[0], parts[1], parts[2], parts[3]
        key = (role, ticket)
        if tok == "spawned":
            running.append({"ts": ts, "role": role, "ticket": ticket})
        else:
            done_counts[key] = done_counts.get(key, 0) + 1
    out = []
    for r in running:  # returns consume the oldest spawn of that role+ticket
        key = (r["role"], r["ticket"])
        if done_counts.get(key, 0) > 0:
            done_counts[key] -= 1
        else:
            out.append(r)
    return out


def load_run_config():
    defaults = {
        "builders": 1, "qa_probes": 1, "max_milestones": 3,
        "qa_dry_rounds": 2, "stale_claim_minutes": 90,
        "stall_no_delta_minutes": 30,
        # a QA lane younger than this suppresses re-offer of its ticket;
        # older, the offer stands with a costed qa_overrun flag (device-walk
        # QA runs 28-45 min routinely)
        "qa_relaunch_minutes": 75,
        # dispatch ticks a lone built P2/P3 ticket waits for batch-mates
        # before QA spawns (0 = spawn immediately, the historical behavior;
        # KV measured 124 QA spawns against 142 builds — batches of one).
        # P0/P1 never wait; a ticket with no batch-mates in flight never
        # waits.
        "qa_batch_patience": 0,
        "blocked_recheck_hours": 12, "compact_threshold_bytes": 8000,
        "gated": False,
        # circuit breaker (A3): thresholds on persisted per-ticket counters
        "breaker_empty_diffs": 3, "breaker_same_failure": 4,
        # CI repair (A6): cap on futility, never on fixes
        "ci_command": "", "ci_no_progress_strikes": 3, "ci_max_attempts": 12,
        # CI change-detection scope: comma-separated paths whose change
        # triggers a CI check. Defaults to product_dir — but a product whose
        # tests or data live beside the app dir (2026-08-10: a transcription/
        # commit reddened tools/ tests while the gate watched app/ only) lists
        # them here WITHOUT widening product_dir, which also feeds ticket
        # scopes, stall probes and self-scan.
        "ci_scope": "",
        # portability: where the product lives and which port the UI binds —
        # a transplanted factory (different layout, parallel runs) overrides both
        "product_dir": "app", "ui_port": 8765,
        # notification seam: notify.py pipes event JSON to this command
        "notify_command": "",
        # QA regime (kspace 2026-08-29): lean = criteria + stored checks +
        # one bounded attack + at most one new BUG per batch; full = the
        # unbounded attack (release sweeps, first-of-a-kind surfaces)
        "qa_depth": "lean",
        # QA evidence-note budget; overruns are counted in gate_fires.tsv,
        # never refused (0 = don't count). 1500 fired on 13/13 QA notes in
        # one run (typical 3.5-5k) — miscalibrated; 4000 per Ben 2026-09-01
        "qa_evidence_max_chars": 4000,
        # gitignored paths (globs) symlinked into the receipt's private
        # worktree so verbatim checks (.venv/bin/ruff) resolve there
        "receipt_link_paths": ".venv,node_modules,*/.venv,*/node_modules,.env",
        # dispatch offers no new lanes while the account's 5-hour usage
        # window is at/above this percent. 0 = never read usage: the default
        # here, so a run.yaml without the key (pre-0.6 installs, test
        # fixtures) never touches the keychain; the template ships 80
        "usage_ceiling_5h": 0,
        # dispatch backs the run branch up to origin at landings/idle ticks,
        # and whenever it is this many commits ahead of upstream
        "push_cadence_max_ahead": 15,
        # related directories agents may reference (ABSOLUTE paths),
        # comma-separated `path=read_only|write_by_size`; empty = every
        # outside-repo write stays blocked
        "sibling_dirs": "",
    }
    if not os.path.exists(RUN_CFG):
        return defaults
    with open(RUN_CFG, "r", encoding="utf-8") as f:
        for line in f:
            line = line.split("#")[0].strip()
            if not line or ":" not in line:
                continue
            key, _, raw = line.partition(":")
            key = key.strip()
            raw = raw.strip()
            if key in defaults:
                if isinstance(defaults[key], bool):
                    defaults[key] = raw.lower() == "true"
                elif isinstance(defaults[key], int):
                    defaults[key] = int(raw)
                else:
                    defaults[key] = raw
    return defaults
