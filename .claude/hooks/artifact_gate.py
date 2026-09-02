#!/usr/bin/env python3
"""Artifact containment gate (PreToolUse on Bash + Edit/Write/MultiEdit/NotebookEdit).

While a run is in flight (agenticflow/tracker/RUNNING present), no agent
creates files outside the repo — not a sibling folder, not the OS temp dir.
2026-07-29 incident: a QA verifying BUG-0024/25 wrote 349MB of raw
framebuffer captures and an APK copy into ~/Desktop/Coding/qa-bug*-verify,
outside the repo, never cleaned up; the human found it days later. The
uninstall contract ("delete agenticflow/ and nothing of yours is touched")
only holds if every artifact stays inside. The sanctioned space is
agenticflow/tracker/evidence/<TICKET>/ (gitignored — big binaries never
dirty the tree, which is why the QA fled the repo in the first place).

Second protected class (2026-08-10): factory machinery. The workout run
landed ~3000 lines of self-modification on ticket.py/lib_ticket.py/
receipt.py via tickets scoped at factory files — the factory never repairs
itself; machinery is kit code, fixed by the human and delivered by upgrade.
While a run is in flight, writes under agenticflow/scripts/ and .claude/
(and to run.yaml / the kit manifest) are blocked for every agent. State
stays open: tracker/, docs/, evidence are the run's to write.

Third protected class (2026-08-11): the adb bus. It routinely carries the
human's own phone and other projects' emulators; an unpinned adb call
targets whatever the bus feels like — a QA's taps advanced a stranger's
app before it noticed (TASK-0045). Device-targeting adb commands must pin
-s; agents drive only AVDs they created, so ~/.android/avd is exempt from
the outside-repo block (an agent cannot build its own device if the gate
blocks its config file).

File tools are checked exactly; Bash is a best-effort scan of the obvious
write forms (redirects, cp/mv/rsync/tee/mkdir/touch, -o/--output, adb pull).
The def-level rule is the contract; this catches the honest mistake, not a
determined evasion. Outside a run, interactive sessions are not gated.
"""
import json
import os
import re
import shlex
import sys
import time

PROJECT = os.path.abspath(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))

SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", ";;", "|&"}
REDIRECT_RE = re.compile(r"^\d?>{1,2}(.*)$")


def sh_tokens(command):
    """Tokenize like a shell, not like shlex.split.

    shlex.split only yields `;` `&&` `||` `|` `&` as tokens when they are
    whitespace-delimited, so `foo > /tmp/x; bar` produced the single token
    '/tmp/x;' and NEVER ended the segment — the cp/mv arm then swept past
    the operator and blocked `agenticflow/scripts/dispatch.py` as an mv
    destination twice on 2026-08-29, and 17 fires that run recorded a
    target with a trailing ';'. punctuation_chars splits operators while
    still honouring quotes (`2>&1` lexes as `2` `>&` `1`: the stray `2` is
    an inert word, `>&` yields the fd target `&`, which outside() skips).
    Returns None when the command cannot be lexed (unbalanced quotes) —
    callers fail open exactly as they did on shlex's ValueError."""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        return list(lex)
    except ValueError:
        return None


def sibling_policies():
    """{abs sibling path: policy} from run.yaml `sibling_dirs`
    (comma-separated `path=read_only|write_by_size`). Parsed standalone —
    hooks never import the factory libs."""
    out = {}
    try:
        for line in open(os.path.join(PROJECT, "agenticflow", "run.yaml"),
                         encoding="utf-8"):
            line = line.split("#")[0].strip()
            if not line.startswith("sibling_dirs:"):
                continue
            for entry in line.split(":", 1)[1].split(","):
                path, _, policy = entry.strip().rpartition("=")
                if path and policy in ("read_only", "write_by_size"):
                    out[os.path.abspath(os.path.expanduser(path))] = policy
    except OSError:
        pass
    return out


def sibling_ok(target, cwd, policies):
    """True = a sanctioned write into a `write_by_size` sibling (recorded,
    not blocked). False = not inside any declared sibling — the caller
    blocks it as an ordinary outside-repo write. A write a declared
    sibling's policy refuses exits HERE with the handoff message: the
    distinction matters, because "keep files inside the repo" is the wrong
    instruction when the right move is a HANDOFF ticket (Ben, 2026-09-01:
    minor essential sibling changes land autonomously; major ones are
    blocked to the human; no workaround code in the home repo)."""
    if not policies:
        return False
    p = os.path.expanduser(target)
    if not os.path.isabs(p):
        p = os.path.join(cwd or PROJECT, p)
    p = os.path.abspath(p)
    for root, policy in policies.items():
        if p != root and not p.startswith(root + os.sep):
            continue
        rel = os.path.relpath(p, root)
        top = rel.split(os.sep)[0]
        if policy != "write_by_size":
            block_sibling(p, "its policy is read_only")
        if top in ("agenticflow", ".claude"):
            block_sibling(p, "that is another factory's machinery — never "
                             "edited from outside, whatever the policy")
        if os.path.exists(os.path.join(root, "agenticflow", "tracker",
                                       "RUNNING")):
            block_sibling(p, "the sibling is running its own campaign — "
                             "everything is major while it does")
        try:  # sanctioned: leave a receipt, never refuse over logging
            from datetime import datetime, timezone
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            with open(os.path.join(PROJECT, "agenticflow", "tracker",
                                   "gate_fires.tsv"), "a",
                      encoding="utf-8") as f:
                f.write("%s\tartifact_gate\trecorded: sibling write %s\n"
                        % (ts, p))
        except Exception:
            pass
        return True
    return False


def block_sibling(offender, reason):
    try:
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(PROJECT, "agenticflow", "tracker",
                               "gate_fires.tsv"), "a", encoding="utf-8") as f:
            f.write("%s\tartifact_gate\tblocked sibling write: %s (%s)\n"
                    % (ts, offender, reason))
    except Exception:
        pass
    sys.stderr.write(
        "ARTIFACT GATE: %s is in a declared sibling directory and this "
        "write is refused — %s.\n"
        "This is a MAJOR change by rule: file a HANDOFF — block your ticket "
        "carrying the complete artifact (exact content, target path, apply "
        "command) so the human applies it in one move. Never write "
        "workaround code in the home repo to dodge a sibling edit.\n"
        % (offender, reason))
    sys.exit(2)


def run_in_flight():
    return os.path.exists(os.path.join(PROJECT, "agenticflow", "tracker",
                                       "RUNNING"))


def outside(target, cwd):
    """True if `target` names a path outside the repo we can actually resolve.
    Unresolvable targets ($VAR, &1, bare fds) are skipped — fail open."""
    if not target or target.startswith("&") or "$" in target:
        return False
    p = os.path.expanduser(target)
    if not os.path.isabs(p):
        p = os.path.join(cwd or PROJECT, p)
    p = os.path.abspath(p)
    if p == PROJECT or p.startswith(PROJECT + os.sep):
        return False
    if p == "/dev/null" or p.startswith("/dev/"):
        return False
    # The harness's own session scratchpad (the path its prompt tells every
    # agent to use): session-scoped, harness-managed, cleared on reboot.
    # Blocking it made the gate fight the prompt — 132 refusals in one run,
    # 56 the next after a def-line counter-instruction only halved it
    # (2026-08-31). Bare /tmp stays blocked: unbounded and invisible (the
    # 349MB-lost-artifacts class, 2026-07-29).
    if re.match(r"^(/private)?/tmp/claude-[^/]+/.+/scratchpad(/|$)", p):
        return False
    avd = os.path.abspath(os.path.expanduser(
        os.environ.get("ANDROID_AVD_HOME", "~/.android/avd")))
    if p == avd or p.startswith(avd + os.sep):
        return False  # an agent's own throwaway AVD lives here by definition
    return True


def effective_cwd(command, cwd):
    """The directory a relative write target actually resolves against.

    The payload's cwd is the SESSION cwd; a `cd` inside the command is
    invisible to us, so `cd app && … > ../agenticflow/tracker/evidence/X`
    resolved one level ABOVE the project and was refused as 'outside repo'
    five times on 2026-08-11 — every one a write into the evidence
    directory the briefs mandate. The same blindness ran the unsafe way
    for machinery (`cd agenticflow && … > scripts/x.py` mis-located AWAY
    from the protected paths). Cannot open a hole: outside()/machinery()
    still judge the final absolute path."""
    tokens = sh_tokens(command)
    if tokens is None:
        return cwd
    here = cwd or PROJECT
    at_segment_start = True
    for i, tok in enumerate(tokens):
        if tok in SEPARATORS:
            at_segment_start = True
            continue
        if at_segment_start and tok == "cd" and i + 1 < len(tokens):
            nxt = tokens[i + 1]
            if "$" not in nxt and not nxt.startswith("-"):
                d = os.path.expanduser(nxt)
                here = d if os.path.isabs(d) else os.path.join(here, d)
                here = os.path.abspath(here)
        at_segment_start = False
    return here


FACTORY_PATHS = ("agenticflow/scripts/", ".claude/")
FACTORY_FILES = ("agenticflow/run.yaml", "agenticflow/.kit-manifest.tsv")


def machinery(target, cwd):
    """True if `target` resolves inside the repo onto factory machinery —
    in the primary checkout or a ticket worktree's copy of it (worktrees
    check out the whole repo, machinery included)."""
    if not target or target.startswith("&") or "$" in target:
        return False
    p = os.path.expanduser(target)
    if not os.path.isabs(p):
        p = os.path.join(cwd or PROJECT, p)
    rel = os.path.relpath(os.path.abspath(p), PROJECT)
    rel = re.sub(r"^agenticflow/\.worktrees/[^/]+/", "", rel)
    return rel in FACTORY_FILES or any(
        rel == d.rstrip("/") or rel.startswith(d) for d in FACTORY_PATHS)


def bash_write_targets(command):
    """Best-effort extraction of file-creation targets from a shell command."""
    tokens = sh_tokens(command)
    if tokens is None:
        return []
    targets = []
    seg_start = 0  # first token of the current pipeline segment
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        if tok in SEPARATORS:
            seg_start = i + 1
            i += 1
            continue
        m = REDIRECT_RE.match(tok)
        if m:
            rest = m.group(1)
            if rest:
                targets.append(rest)
            elif i + 1 < n:
                targets.append(tokens[i + 1])
                i += 1
        elif tok in ("-o", "--output") and i + 1 < n:
            targets.append(tokens[i + 1])
            i += 1
        elif tok.startswith("--output="):
            targets.append(tok.split("=", 1)[1])
        elif tok in ("mkdir", "touch", "tee"):
            j = i + 1
            while (j < n and tokens[j] not in SEPARATORS
                   and not REDIRECT_RE.match(tokens[j])):
                if not tokens[j].startswith("-"):
                    targets.append(tokens[j])
                j += 1
            i = j - 1
        elif tok in ("cp", "mv", "rsync"):
            args = []
            j = i + 1
            while (j < n and tokens[j] not in SEPARATORS
                   and not REDIRECT_RE.match(tokens[j])):
                if not tokens[j].startswith("-"):
                    args.append(tokens[j])
                j += 1
            if len(args) >= 2:
                targets.append(args[-1])
            i = j - 1
        elif tok == "pull" and "adb" in tokens[seg_start:i]:
            args = [t for t in tokens[i + 1:i + 4]
                    if t not in SEPARATORS and not t.startswith("-")
                    and not REDIRECT_RE.match(t)]
            if len(args) >= 2:
                targets.append(args[1])
        i += 1
    return targets


DEVICE_FREE = {"devices", "version", "start-server", "kill-server", "help",
               "--version", "connect", "disconnect", "mdns", "pair"}


def unpinned_adb(command):
    """True if any pipeline segment invokes adb against a device without -s.
    Server/discovery subcommands stay free so agents can still see what is
    attached."""
    tokens = sh_tokens(command)
    if tokens is None:
        return False
    seg = []
    for tok in tokens + [";"]:
        if tok in SEPARATORS:
            if seg and os.path.basename(seg[0]) == "adb":
                sub = next((t for t in seg[1:] if not t.startswith("-")), "")
                if sub not in DEVICE_FREE and "-s" not in seg:
                    return True
            seg = []
        else:
            seg.append(tok)
    return False


def block_adb(command):
    try:  # fire-counter (curator trim-data); never fail the gate over logging
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(PROJECT, "agenticflow", "tracker",
                               "gate_fires.tsv"), "a", encoding="utf-8") as f:
            f.write("%s\tartifact_gate\tblocked unpinned adb: %s\n"
                    % (ts, command[:200]))
    except Exception:
        pass
    sys.stderr.write(
        "ARTIFACT GATE: this adb command names no device. The bus carries "
        "the human's own phone and other projects' emulators — an unpinned "
        "adb call has driven a stranger's app before (TASK-0045, "
        "2026-08-11). Create your own AVD and pass -s <your-serial> on "
        "every invocation.\n")
    sys.exit(2)


def _cmd_word(seg):
    """First real command token of a segment — skips env assignments and
    the common wrappers (nohup/time) the documented launch lines use."""
    for t in seg:
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t) \
                or os.path.basename(t) in ("nohup", "time"):
            continue
        return t
    return ""


def emulator_launch(command):
    """True if a pipeline segment boots the SDK emulator (an `emulator`
    binary with an @avd or -avd argument)."""
    tokens = sh_tokens(command)
    if tokens is None:
        return False
    seg = []
    for tok in tokens + [";"]:
        if tok in SEPARATORS:
            head = _cmd_word(seg)
            if head and os.path.basename(head) == "emulator" and any(
                    t == "-avd" or t.startswith("@") for t in seg[1:]):
                return True
            seg = []
        else:
            seg.append(tok)
    return False


def leased_here():
    """A live (unexpired) machine-wide emulator lease held by THIS project.
    Fail closed: no lease file, no boot — RAM is machine state and two
    unleased emulators took the machine down (2026-08-11)."""
    lease_home = os.path.expanduser(
        os.environ.get("AGENTICFLOW_HOME", "~/.agenticflow"))
    try:
        names = os.listdir(lease_home)
    except OSError:
        return False
    for name in names:
        if not name.startswith("emulator.lease"):
            continue
        try:
            with open(os.path.join(lease_home, name), encoding="utf-8") as f:
                lease = json.load(f)
        except Exception:
            continue
        if os.path.abspath(lease.get("project") or "") != PROJECT:
            continue
        ttl = float(lease.get("ttl_minutes") or 30)
        if time.time() - float(lease.get("acquired_epoch") or 0) < ttl * 60:
            return True
    return False


def block_emulator(command):
    try:  # fire-counter (curator trim-data); never fail the gate over logging
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(PROJECT, "agenticflow", "tracker",
                               "gate_fires.tsv"), "a", encoding="utf-8") as f:
            f.write("%s\tartifact_gate\tblocked unleased emulator boot: %s\n"
                    % (ts, command[:200]))
    except Exception:
        pass
    sys.stderr.write(
        "ARTIFACT GATE: no live emulator lease for this project. This "
        "machine runs a bounded number of emulators across ALL factories "
        "(it ran out of RAM with two, 2026-08-11). Take the lease first:\n"
        "  python3 agenticflow/scripts/emu_lease.py acquire --role <you> "
        "--ticket <ID>\nthen boot, `register --serial <s> --pid <pid>`, "
        "and `release` when done. Denied? `acquire --wait` blocks until "
        "your turn (bounded by the holder's TTL) — wait it out, and do "
        "your device-free prep BEFORE the lease so held minutes are walk "
        "minutes.\n")
    sys.exit(2)


def block(offender):
    try:  # fire-counter (curator trim-data); never fail the gate over logging
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(PROJECT, "agenticflow", "tracker",
                               "gate_fires.tsv"), "a", encoding="utf-8") as f:
            f.write("%s\tartifact_gate\tblocked write outside repo: %s\n"
                    % (ts, offender))
    except Exception:
        pass
    sys.stderr.write(
        "ARTIFACT GATE: %s is outside the repo — while a run is in flight, "
        "every file you create lives inside it.\n"
        "- Verification artifacts (screenshots, dumps, recordings) go under "
        "agenticflow/tracker/evidence/<TICKET>/ — gitignored, so big "
        "binaries never dirty the tree.\n"
        "- Bulk captures are working files: delete them before handoff; "
        "keep only the small crops/dumps your ticket cites.\n"
        "- Throwaway scratch: the session scratchpad your harness prompt "
        "names (/private/tmp/claude-*/.../scratchpad) IS allowed — bare "
        "/tmp is not. Anything a ticket, handoff or receipt will cite "
        "goes under evidence/<TICKET>/.\n" % offender)
    sys.exit(2)


def block_machinery(offender):
    try:  # fire-counter (curator trim-data); never fail the gate over logging
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(PROJECT, "agenticflow", "tracker",
                               "gate_fires.tsv"), "a", encoding="utf-8") as f:
            f.write("%s\tartifact_gate\tblocked machinery write: %s\n"
                    % (ts, offender))
    except Exception:
        pass
    sys.stderr.write(
        "ARTIFACT GATE: %s is factory machinery — the factory never repairs "
        "itself. While a run is in flight no agent modifies "
        "agenticflow/scripts/, .claude/, run.yaml, or the kit manifest; "
        "fixes are made by the human in the kit and delivered by upgrade.\n"
        "Write the defect up (with your measurement) as "
        "agenticflow/tracker/proposals/<YYYY-MM-DD>-<slug>.md; if it BLOCKS "
        "your current work from landing or closing, start the file with "
        "'---\\nseverity: blocking\\n---' — the run pauses and pages the "
        "human.\n" % offender)
    sys.exit(2)


def main():
    if not run_in_flight():
        sys.exit(0)
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    tool = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    cwd = payload.get("cwd") or PROJECT
    if tool == "Bash":
        cmd = tool_input.get("command") or ""
        if unpinned_adb(cmd):
            block_adb(cmd)
        if emulator_launch(cmd) and not leased_here():
            block_emulator(cmd)
        base = effective_cwd(cmd, cwd)
        policies = sibling_policies()
        for t in bash_write_targets(cmd):
            if outside(t, base) and not sibling_ok(t, base, policies):
                block(t)
            if machinery(t, base):
                block_machinery(t)
    else:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        policies = sibling_policies()
        if path and outside(path, cwd) and not sibling_ok(path, cwd, policies):
            block(path)
        if path and machinery(path, cwd):
            block_machinery(path)
    sys.exit(0)


if __name__ == "__main__":
    main()
