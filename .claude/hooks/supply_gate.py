#!/usr/bin/env python3
"""Supply-chain gate (PreToolUse on Bash).

Blocks package installs, repo clones, and pipe-to-shell unless every package
named in the command appears in docs/ALLOWED_DEPS.md. Exit 2 = block, with the
reason on stderr fed back to the agent. Fail closed: if we can't parse the
install confidently, we block and say why — filing a DEP ticket is the escape
hatch, not clever quoting.

Two tiers (B1 hardening, 2026-07-08):
- docs/BLOCKED_DEPS.md is checked FIRST and wins over the allowlist. It is a
  human-only file (the ticket gate blocks tool edits to it), so an entry
  there survives even a compromised or mistaken vetting.
- pip entries carrying a vetted version range are PIN-ENFORCED: an unpinned
  `pip install <name>` is blocked (allowlisting a name is not trusting every
  future version's postinstall script), and a pinned one must fall inside
  the vetted range. Lockfile installs stay on the pip:<file> hash-vetted
  path.

Near-name check (typosquat defense, 2026-07-08): a requested name within typo
distance of a DIFFERENT vetted name is blocked as a suspected typosquat and
explicitly told NOT to file a DEP — typosquats are built to survive vetting,
so the funnel into the toolsmith is the attack path. This also fires when
BOTH names are allowlisted (a squat that already slipped through vetting
jams loudly instead of installing). Legitimate near-name pairs are cleared
by the human adding `[near-ok]` to the allowlist line — and only the human:
the marker is worthless as a defense if the agent being blocked can add it.
"""
import json
import os
import re
import sys

PROJECT = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
ALLOWLIST = os.path.join(PROJECT, "agenticflow", "docs", "ALLOWED_DEPS.md")
BLOCKLIST = os.path.join(PROJECT, "agenticflow", "docs", "BLOCKED_DEPS.md")

INSTALL_PATTERNS = [
    (r"\bnpm\s+(?:i|install|add)\b(?!\s*$)", "npm"),
    (r"\bpnpm\s+(?:add|install)\b(?!\s*$)", "pnpm"),
    (r"\byarn\s+add\b", "yarn"),
    (r"\bpip3?\s+install\b", "pip"),
    (r"\buv\s+(?:pip\s+install|add)\b", "uv"),
    (r"\bcargo\s+add\b", "cargo"),
    (r"\bgem\s+install\b", "gem"),
    (r"\bgo\s+get\b", "go"),
    (r"\bbrew\s+install\b", "brew"),
    (r"\bnpx\s+(?!\s)", "npx"),
    # mobile ecosystems: CocoaPods, Gradle/SPM dependency-adding invocations
    (r"\bpod\s+(?:install|update)\b", "cocoapods"),
    (r"(?:\bgradle|\./gradlew)\s+[^|;&]*--refresh-dependencies\b", "gradle"),
    (r"\bswift\s+package\s+(?:update|resolve)\b", "swift-pm"),
    (r"\bgit\s+clone\b", "git-clone"),
    (r"\bcurl\b[^|;&]*\|\s*(?:ba|z)?sh\b", "curl-pipe-sh"),
    (r"\bwget\b[^|;&]*\|\s*(?:ba|z)?sh\b", "wget-pipe-sh"),
    # fetch-then-extract (2026-07-18 hole: a 5.4GB toolchain via
    # `curl -O … && unzip` never fired the gate — a full install with no
    # approval compelled). A SAVED download of an archive/installer, or a
    # fetch piped straight into tar, is an install event; the handler skips
    # non-archive downloads, auto-passes vetted-provenance hosts WITH a
    # recorded line (a receipt, not a wall), and blocks the rest into the
    # normal DEP funnel.
    (r"\bcurl\b[^|;&\n]*\s-\S*[Oo]\b", "fetch-archive"),
    (r"\bcurl\b[^|;&\n]*\|\s*(?:bsd)?tar\b", "fetch-archive"),
    (r"\bwget\b", "fetch-archive"),
    # extractors are RECORDED (audit trail), never blocked — the network
    # entry point above is where blocking lives; tar/unzip have too many
    # legitimate non-install uses to gate
    (r"\bunzip\b\s", "extract-archive"),
    (r"\btar\b\s+(?:-\S*x\S*|x\w*|--extract)\b", "extract-archive"),
]

ARCHIVE_EXT_RE = re.compile(
    r"\.(zip|tar(\.(gz|xz|bz2))?|tgz|txz|tbz2|dmg|pkg|sh)(\?\S*)?$", re.I)


def _archive_fetch_target(segment):
    """(host, artifact) when this fetch SAVES an archive/installer (or pipes
    into tar); None when it isn't archive-shaped — plain file/page downloads
    stay ungated."""
    stop = re.split(r"[;&]|\|\|", segment)[0]  # keep `|`: pipe-to-tar counts
    cands = []
    url = re.search(r"https?://[^\s'\"]+", stop)
    if url:
        cands.append(url.group(0).split("?")[0])
    out = re.search(r"\s-(?:o|-output)\s+(\S+)", stop)
    if out:
        cands.append(out.group(1).strip("'\""))
    piped_extract = bool(re.search(r"\|\s*(?:bsd)?tar\b", stop))
    if not piped_extract and not any(ARCHIVE_EXT_RE.search(c) for c in cands):
        return None
    host = re.search(r"https?://([^/\s'\"]+)", stop)
    return (host.group(1).lower() if host else "<unknown-host>",
            cands[0] if cands else "<archive>")

FLAG_RE = re.compile(r"^-")
SPEC_OPS_RE = re.compile(r"^([A-Za-z0-9@._/\-]+?)\s*(==|>=|<=|~=|!=|>|<)(.+)$")


def log_fire(detail):
    """Fire-counter (curator trim-data): every block appends one TSV line to
    tracker/gate_fires.tsv. Best-effort — the gate must never fail because
    its logging did."""
    try:
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(PROJECT, "agenticflow", "tracker", "gate_fires.tsv"),
                  "a", encoding="utf-8") as f:
            f.write("%s\tsupply_gate\t%s\n" % (ts, detail))
    except Exception:
        pass


def norm(name):
    """PEP 503-ish: importlib_metadata == importlib-metadata; lowercase."""
    return re.sub(r"[-_.]+", "-", name).lower()


def allowed_entries():
    """{name: version-spec-or-None} from docs/ALLOWED_DEPS.md. Each entry is
    keyed BOTH raw-lowercase and PEP503-normalized — path-ish entries like
    pip:app/requirements.txt must match verbatim, package names loosely."""
    entries = {}
    if os.path.exists(ALLOWLIST):
        for line in open(ALLOWLIST, encoding="utf-8"):
            m = re.match(r"^\s*-\s*([^\s#(]+)\s*(?:\(([^)]*)\))?", line)
            if m:
                spec = (m.group(2) or "").strip() or None
                entries[m.group(1).lower()] = spec
                entries[norm(m.group(1))] = spec
    return entries


def near_ok_names():
    """Names on allowlist lines carrying the human's [near-ok] marker —
    a documented, deliberate near-name pair (rare; suspicious by default)."""
    names = set()
    if os.path.exists(ALLOWLIST):
        for line in open(ALLOWLIST, encoding="utf-8"):
            if "[near-ok" in line:
                m = re.match(r"^\s*-\s*([^\s#(]+)", line)
                if m:
                    names.add(norm(m.group(1)))
    return names


def edit_distance(a, b, cap=3):
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1,
                           prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def near_matches(name, allowed):
    """Vetted package names within typo distance of `name`, excluding an
    exact match. Path-ish entries (pip:app/requirements.txt) and URLs are
    locations, not names — skipped on both sides. Threshold scales with the
    vetted name: 1 edit under 6 chars, 2 from 6 up (mistun, mystune,
    mistune2, playwrite all land inside; unrelated names do not)."""
    n = norm(name)
    if ":" in n or "/" in n or not re.match(r"^[a-z0-9]", n):
        return []
    out = set()
    for cand in allowed:
        # normalized forms only — every entry is also keyed raw (foo_bar),
        # and comparing raw vs normalized would pair an entry with itself
        if cand != norm(cand) or ":" in cand or "/" in cand or cand == n:
            continue
        if edit_distance(n, cand) <= (1 if len(cand) < 6 else 2):
            out.add(cand)
    return sorted(out)


def blocked_names():
    names = set()
    if os.path.exists(BLOCKLIST):
        for line in open(BLOCKLIST, encoding="utf-8"):
            m = re.match(r"^\s*-\s*([^\s#]+)", line)
            if m:
                names.add(norm(m.group(1)))
    return names


def quoted_spans(command):
    return [m.span() for m in re.finditer(r"'[^']*'|\"[^\"]*\"", command)]


HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def heredoc_spans(command):
    """Body ranges of heredocs. A verb inside `cat > f <<'EOF' … EOF` is text
    being WRITTEN to a file, not a command being run: on 2026-08-29 an
    agent's markdown about pip installs was refused as an install of the
    packages 'name, against, the, default, PyPI'. Only substitutions execute
    inside a heredoc, and those are matched by their own patterns."""
    spans = []
    for m in HEREDOC_RE.finditer(command):
        body = command.find("\n", m.end())
        if body == -1:
            continue
        end = re.search(r"^\s*%s\s*$" % re.escape(m.group(2)),
                        command[body:], re.MULTILINE)
        spans.append((body, body + (end.start() if end else len(command))))
    return spans


def in_quotes(spans, idx):
    return any(a <= idx < b for a, b in spans)


def _vt(s):
    return tuple(int(x) for x in re.findall(r"\d+", s)[:4]) or (0,)


def version_in_spec(version, spec):
    """True/False, or None when the spec is too clever to judge (then the
    gate falls back to name-level allowance rather than jamming installs)."""
    for part in spec.split(";")[0].split(","):
        part = part.strip()
        m = re.match(r"^(==|>=|<=|!=|>|<|~=)?\s*([\w.\-*]+)$", part)
        if not m or "*" in m.group(2) or (m.group(1) or "==") == "~=":
            return None
        op, val = m.group(1) or "==", m.group(2)
        v, w = _vt(version), _vt(val)
        ok = {"==": v == w, "!=": v != w, ">=": v >= w,
              "<=": v <= w, ">": v > w, "<": v < w}[op]
        if not ok:
            return False
    return True


def extract_packages(segment, tool):
    """(name, version-or-None) tokens after the install verb, from the
    command segment starting at the (unquoted) verb match. Tokens are
    de-quoted; version pins are split off, not discarded (pin enforcement
    needs them); redirections end the argument list."""
    if tool == "git-clone":
        return [(u, None) for u in re.findall(r"git\s+clone\s+(?:-\S+\s+)*(\S+)", segment)]
    if tool in ("curl-pipe-sh", "wget-pipe-sh"):
        return [("<pipe-to-shell>", None)]
    if tool in ("cocoapods", "gradle", "swift-pm"):
        # manifest-driven: the deps live in Podfile/build.gradle/Package.swift,
        # not on the command line — the allowlist entry is the manager itself
        # (toolsmith vets the manifest diff, then allows e.g. "- cocoapods")
        return [(tool, None)]
    if tool == "npx":
        m = re.search(r"\bnpx\s+(?:-\S+\s+)*(\S+)", segment)
        return [(m.group(1).strip("'\""), None)] if m else [("<unparsed>", None)]
    verb = {
        "npm": r"npm\s+(?:i|install|add)", "pnpm": r"pnpm\s+(?:add|install)",
        "yarn": r"yarn\s+add", "pip": r"pip3?\s+install",
        "uv": r"uv\s+(?:pip\s+install|add)", "cargo": r"cargo\s+add",
        "gem": r"gem\s+install", "go": r"go\s+get", "brew": r"brew\s+install",
    }[tool]
    m = re.search(verb + r"\s+(.*)$", segment, re.MULTILINE)
    if not m:
        return [("<unparsed>", None)]
    pkgs = []
    req_next = False
    for tok in m.group(1).split():
        if tok in ("&&", "||", ";", "|"):
            break
        if re.match(r"^\d*[<>]|^&", tok):  # 2>&1, >out, <in, &> — args end here
            break
        tok = tok.strip("'\"")
        # pip extras anywhere, not only token-final: `psycopg[binary]==3.3.4`
        # left the bracket mid-token, SPEC_OPS_RE missed, and the whole
        # string became an unknown, unpinned name (blocked 2026-08-28)
        tok = re.sub(r"\[[^\]]*\]", "", tok)
        if not tok:
            continue
        if req_next:  # the file after -r/--requirement: matched as pip:<path>
            pkgs.append(("%s:%s" % (tool, tok), None))
            req_next = False
            continue
        if FLAG_RE.match(tok):
            if tok in ("-r", "--requirement"):
                req_next = True
            continue
        sm = SPEC_OPS_RE.match(tok)  # pip-style name==1.2.3 / "name>=1,<2"
        if sm:
            name, ver = sm.group(1), (sm.group(3).split(",")[0]
                                      if sm.group(2) == "==" else None)
        else:
            nm = re.match(r"^(.+?)@[\^~]?([\d.x*].*)$", tok)  # npm-style name@1.2.3
            name, ver = (nm.group(1), nm.group(2)) if nm else (tok, None)
        pkgs.append((name, ver))
    return pkgs or [("<unparsed>", None)]


def _npx_runs_local_bin(command, npx_idx, project):
    """True when this npx invocation runs an ALREADY-INSTALLED local binary
    (no registry fetch) — equivalent to running node_modules/.bin/<x>
    directly, which the gate never guards, so allowing it adds no new
    capability. Deliberately narrow (fail-closed): only a bare name with no
    flags (or just --no-install) that resolves in the invocation dir's
    node_modules/.bin. Version pins (@), scoped/path names, -p/--package,
    -y/-c/--ignore-existing and every other flag, or an unresolved name all
    fall through to the normal allowlist + typosquat checks — a fetch can
    never slip through here."""
    m = re.match(r"npx\s+((?:--?\S+\s+)*)(\S+)", command[npx_idx:])
    if not m:
        return False
    flags = m.group(1).split()
    target = m.group(2).strip("'\"")
    if any(f != "--no-install" for f in flags):
        return False                      # unknown flag semantics -> fail closed
    if "@" in target or "/" in target \
            or not re.match(r"^[A-Za-z0-9._-]+$", target):
        return False                      # versioned / scoped / path -> fetch
    cwd = project
    # honor `cd <dir> && ... npx` — the LAST cd before the npx decides
    cds = re.findall(r"\bcd\s+([^\s&;|]+)\s*(?:&&|;)", command[:npx_idx])
    if cds:
        d = cds[-1].strip("'\"")
        cwd = d if os.path.isabs(d) else os.path.join(project, d)
    return os.path.exists(os.path.join(cwd, "node_modules", ".bin", target))


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if payload.get("tool_name") != "Bash":
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command", "")
    allowed = allowed_entries()
    blocked_tier = blocked_names()
    spans = quoted_spans(command) + heredoc_spans(command)
    for pattern, tool in INSTALL_PATTERNS:
        for match in re.finditer(pattern, command):
            if in_quotes(spans, match.start()):
                continue  # verb inside a quoted string = mentioned, not run
            if tool == "extract-archive":
                # audit receipt only — blocking lives at the fetch
                log_fire("recorded: extract — %s"
                         % command[match.start():match.start() + 120]
                         .split("\n")[0].replace("\t", " "))
                continue
            if tool == "fetch-archive":
                tgt = _archive_fetch_target(command[match.start():])
                if tgt is None:
                    continue  # not archive-shaped — an ordinary download
                host, artifact = tgt
                if ("archive:" + host) in allowed \
                        or norm("archive:" + host) in allowed:
                    log_fire("recorded: archive fetch %s from vetted host %s"
                             % (artifact, host))
                    continue  # vetted provenance — receipt, not a wall
                log_fire("blocked archive fetch from %s (%s)" % (host, artifact))
                sys.stderr.write(
                    "SUPPLY-CHAIN GATE: downloading an archive/installer "
                    "(%s from %s) is an INSTALL — executable code lands on "
                    "this machine, and this class used to slip past the gate "
                    "entirely (the 5.4GB Android-toolchain incident). Do NOT "
                    "retry or re-shape the command. File a DEP ticket for the "
                    "toolsmith:\n"
                    "  python3 agenticflow/scripts/ticket.py new --type DEP "
                    "--title 'need: %s' --as <your-role> --priority P1 "
                    "--description 'what it is, why, and the source host'\n"
                    "If the source is trustworthy infrastructure, the vetting "
                    "outcome is an allowlist line '- archive:%s' — future "
                    "fetches from it then auto-pass with a recorded receipt.\n"
                    % (artifact, host, artifact, host))
                sys.exit(2)
            pkgs = extract_packages(command[match.start():], tool)

            if tool == "npx" and _npx_runs_local_bin(command, match.start(),
                                                     PROJECT):
                continue  # runs an installed local bin — not an install

            hard = [n for n, _ in pkgs if norm(n) in blocked_tier]
            if hard:
                log_fire("BLOCKLIST hit: %s (%s)" % (", ".join(hard), tool))
                sys.stderr.write(
                    "SUPPLY-CHAIN GATE: %s is on agenticflow/docs/BLOCKED_DEPS.md — the "
                    "human-only block tier. This is not a vetting question; do "
                    "not file a DEP, do not rephrase. If you believe this is "
                    "wrong, say so to the human in the digest.\n"
                    % ", ".join(hard))
                sys.exit(2)

            near_ok = near_ok_names()
            for n, _ in pkgs:  # typosquat check BEFORE the file-a-DEP funnel
                if norm(n) in near_ok:
                    continue
                hits = [c for c in near_matches(n, allowed) if c not in near_ok]
                if not hits:
                    continue
                if n.lower() in allowed or norm(n) in allowed:
                    log_fire("near-name PAIR in allowlist: %s ~ %s"
                             % (n, ", ".join(hits)))
                    sys.stderr.write(
                        "SUPPLY-CHAIN GATE: the allowlist contains a near-name "
                        "pair — %s and %s are within typo distance of each "
                        "other, and one of them may be a typosquat that "
                        "slipped through vetting. Installing NEITHER until a "
                        "human resolves it (remove the bad entry, or mark the "
                        "deliberate pair with [near-ok] on its allowlist "
                        "line). Put this in the digest.\n"
                        % (n, ", ".join(hits)))
                else:
                    log_fire("suspected typosquat: %s ~ %s (%s)"
                             % (n, ", ".join(hits), tool))
                    sys.stderr.write(
                        "SUPPLY-CHAIN GATE: %s is within one typo of the "
                        "vetted package %s — suspected TYPOSQUAT. Do NOT file "
                        "a DEP for it (squat packages are built to survive "
                        "vetting) and do NOT retry. If you meant %s, use that "
                        "exact name with a pinned version. If %s is genuinely "
                        "a different package you need, put it in the digest — "
                        "only the human can clear a near-name.\n"
                        % (n, ", ".join(hits), ", ".join(hits), n))
                sys.exit(2)

            unlisted = [n for n, _ in pkgs
                        if n.lower() not in allowed
                        and norm(n) not in allowed
                        and norm(tool + ":" + n) not in allowed
                        and (tool + ":" + n.lower()) not in allowed]
            if unlisted:
                log_fire("blocked %s of %s" % (tool, ", ".join(unlisted)))
                sys.stderr.write(
                    "SUPPLY-CHAIN GATE: blocked %s of %s — not in agenticflow/docs/ALLOWED_DEPS.md.\n"
                    "Do NOT retry with different phrasing. File a DEP ticket instead:\n"
                    "  python3 agenticflow/scripts/ticket.py new --type DEP --title 'need: %s' --as <your-role> "
                    "--priority P1 --description 'why it is needed'\n"
                    "The Toolsmith will vet it and update the allowlist if it is safe.\n"
                    % (tool, ", ".join(unlisted), ", ".join(unlisted)))
                sys.exit(2)

            if tool in ("pip", "uv"):  # pin enforcement on vetted ranges
                for name, ver in pkgs:
                    spec = allowed.get(norm(name))
                    if not spec:
                        continue
                    if ver is None:
                        if version_in_spec("0", spec) is None:
                            continue  # prose in parens, not a version spec
                        log_fire("pin required: %s (vetted %s)" % (name, spec))
                        sys.stderr.write(
                            "SUPPLY-CHAIN GATE: %s is vetted for %s but the "
                            "install is UNPINNED. Allowlisting a name is not "
                            "trusting every future version's postinstall "
                            "script — install an explicit version inside the "
                            "vetted range: pip install '%s==<version>'\n"
                            % (name, spec, name))
                        sys.exit(2)
                    if version_in_spec(ver, spec) is False:
                        log_fire("out-of-range: %s==%s (vetted %s)" % (name, ver, spec))
                        sys.stderr.write(
                            "SUPPLY-CHAIN GATE: %s==%s is OUTSIDE the vetted "
                            "range %s. If the newer version is needed, file a "
                            "DEP ticket for a re-vet — ranges exist because "
                            "future versions are unvetted code.\n"
                            % (name, ver, spec))
                        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
