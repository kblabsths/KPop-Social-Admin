#!/usr/bin/env python3
"""Diff-time self-scan (B1): run at every claimed→built handoff.

Two checks over the builder's actual changes — in a ticket worktree
(branch-per-ticket, v0.3-A) that is the branch's commits since it forked
from the run branch plus the working tree, ALL of it, scope ignored (the
worktree diff is exactly this ticket's work, and a secret outside the
declared scope is still a secret); in a shared tree, the working tree vs
HEAD under the ticket's scope, as before:

- SECRETS (blocking): gitleaks when installed (vetted DEP-0007, detection-
  only, fully local), else a built-in stdlib regex set — the scan never
  silently disappears because a machine lacks the tool. Findings are
  reported as rule + file:line; SECRET VALUES ARE NEVER PRINTED.
- ADVISORIES (informational): every package installed in app/.venv queried
  against OSV.dev (stdlib urllib, one batch call). Offline → skipped with a
  warning, never a block: what may be installed is the supply gate's job;
  this is the extra pair of eyes on what already landed.

Plus one whole-tree check that is NOT diff-shaped (TASK-0032):

- JS BOUND (blocking): the supply gate hooks package-manager INSTALLS, so the
  one dependency class M5 actually introduces never trips it — a
  `<script src="https://cdn...">` in a template, an `import x from
  "https://cdn..."` in a .js file (with no build step, THE way to pull a lib),
  or a hand-vendored minified blob dropped in static/, all execute in users'
  browsers without any install happening. These greps are the only thing that
  sees it. Grep-grade on purpose (literal scheme match, not an HTML parser or a
  JS parser): the check is subject to the same bound it enforces.

Exit codes: 0 = clean (advisory warnings allowed), 1 = secrets or a JS-bound
violation found — callers (ticket.py claimed→built) block the handoff on 1.

Usage: self_scan.py [--ticket ID | --paths a,b] [--secrets-only]
       (bare: the JS-bound checks alone, over the product tree)
"""
import glob
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

OSV_URL = "https://api.osv.dev/v1/querybatch"

BUILTIN_RULES = [
    ("aws-access-key", r"\bAKIA[0-9A-Z]{16}\b"),
    ("github-token", r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    ("slack-token", r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    ("stripe-live-key", r"\bsk_live_[A-Za-z0-9]{20,}\b"),
    ("google-api-key", r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    ("private-key-block", r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY"),
    ("generic-assignment",
     r"(?i)\b(?:api[_-]?key|secret[_-]?key|auth[_-]?token|passw(?:or)?d)\s*[:=]\s*['\"][^'\"\s]{12,}['\"]"),
]


def changed_files(scope, base, since=None):
    """Files changed or added in `base`, under scope: the working tree vs
    HEAD, plus — when `since` names the run branch — the commits this ticket
    branch made since forking from it (builders commit on their own branch
    since v0.3-A)."""
    names = []
    out = subprocess.run(["git", "status", "--porcelain", "--"] + scope,
                         cwd=base, capture_output=True, text=True).stdout
    for line in out.splitlines():
        names.append(line[3:].split(" -> ")[-1].strip().strip('"'))
    if since:
        out = subprocess.run(["git", "diff", "--name-only",
                              since + "...HEAD", "--"] + scope,
                             cwd=base, capture_output=True, text=True).stdout
        names += [ln.strip() for ln in out.splitlines() if ln.strip()]
    files, seen = [], set()
    for path in names:
        if path not in seen and os.path.isfile(os.path.join(base, path)):
            seen.add(path)
            files.append(path)
    return files


def scan_gitleaks(files, base):
    """Returns (findings, tool_used). Findings: list of 'rule at file:line'."""
    with tempfile.TemporaryDirectory() as td:
        report = os.path.join(td, "report.json")
        findings = []
        for path in files:
            r = subprocess.run(
                ["gitleaks", "dir", os.path.join(base, path), "--no-banner",
                 "--report-format", "json", "--report-path", report],
                capture_output=True, text=True)
            if r.returncode == 0:
                continue
            try:
                with open(report, encoding="utf-8") as f:
                    for hit in json.load(f):
                        findings.append("%s at %s:%s" % (
                            hit.get("RuleID", "?"), path, hit.get("StartLine", "?")))
            except Exception:
                findings.append("gitleaks flagged %s (report unreadable — "
                                "run gitleaks dir on it yourself)" % path)
        return findings


def scan_builtin(files, base):
    findings = []
    for path in files:
        try:
            text = open(os.path.join(base, path), encoding="utf-8",
                        errors="ignore").read()
        except OSError:
            continue
        for rule, pattern in BUILTIN_RULES:
            for m in re.finditer(pattern, text):
                line = text.count("\n", 0, m.start()) + 1
                findings.append("%s at %s:%d" % (rule, path, line))
    return findings


# --- JS/CSS bound (TASK-0032, restructured TASK-0034): DECISIONS 2026-07-16
# (M5) — client JS/CSS is first-party, unminified, same-origin; third-party
# only vendored at a pinned sha256/SRI via a DEP ticket, never a live CDN tag.
#
# THE CORPUS IS DERIVED, NOT ENUMERATED (DECISIONS 2026-07-16, "THE GATE'S TWO
# ENUMERATIONS"). "Which bytes does a browser EXECUTE or APPLY?" is answered by
# mimetypes.guess_type — the SAME oracle werkzeug/utils.py:438 consults to
# decide what to tell the browser a static file IS. Any file it labels
# text/javascript the browser runs; any it labels text/css the browser applies.
# So the corpus is exactly {text/javascript, text/css}, and the old hand-kept
# ASSET/JS extension lists (four refreshes: BUG-0067/0075/0077/0080) are gone:
#   .js / .mjs        -> text/javascript   (BUG-0080's .mjs falls out for free)
#   enhance.MJS/.JS   -> text/javascript   (BUG-0085's case hole dies for free:
#                                           guess_type is case-insensitive, so
#                                           there is no .lower() to forget)
#   .css              -> text/css          (TASK-0033's goal, no list to keep)
#   .cjs/.jsx -> None, .ts -> video/mp2t  : Flask serves these as non-JS, the
#                                           browser does NOT execute them, so
#                                           they are correctly OUT of the corpus.
# The derivation is EXACT, not approximate: gate and server read one table, so
# .cjs/.mjs/whatever-comes-next is answered before it is asked.
#
# TEMPLATES stay a list: they are RENDERED, not served, so mimetypes says
# nothing about them — but the list is legitimate under the same rule, it is
# the PRODUCT naming its own files, which an author CAN verify by looking at the
# template dir. Their spans are the <script> bodies SCRIPT_BLOCK_RE finds.
CODE_MEDIA_TYPES = {"text/javascript", "text/css"}
TEMPLATE_EXTS = (".html", ".htm", ".j2", ".jinja", ".jinja2")
# A blob is unreadable by NAME as well as by line length, and both spellings of
# the name travel with both extensions. "Is this minified?" is not "what type
# is it?", so this stays a NAME test (not a mimetypes query) and the blob clause
# stays JS-only — minified CSS is not code a reviewer must read to trust.
MIN_JS_EXTS = (".min.js", ".min.mjs")
SKIP_DIRS = {".venv", ".git", "node_modules", "__pycache__", ".worktrees"}
# Literal scheme match, deliberately not an HTML parser: src="http…, src='//…
# and the unquoted form. `href` is NOT matched — an <a href="https://…"> is a
# legitimate outbound link, and cheap-and-wrong is worse than cheap.
# Matched against the whole file text, never line-by-line: `\s` then spans the
# newline of a src= whose value wraps (BUG-0067), which is valid HTML.
REMOTE_SRC_RE = re.compile(r"""src\s*=\s*["']?\s*(?:https?:)?//""", re.I)
# The dependency is off-origin CODE; `src=` is only one spelling of it. STACK
# says no bundler/transpiler/npm, so with no build step `import x from
# "https://cdn…"` is THE way to pull a third-party lib — the likeliest form of
# exactly what this gate exists to block, and it carries no src= (BUG-0067).
# Rather than enumerate loaders (import / import() / importScripts / Worker —
# the same mistake as matching only src=, one list refresh behind), match the
# invariant: an off-origin URL LITERAL in code. STRING-anchored, so a doc URL in
# a `// see https://…` comment stays silent, and a host is required, so
# `split("//")` does too. In templates it applies INSIDE <script> blocks only —
# an <a href> is a link, not a dependency.
# The anchor class spans all THREE JS string delimiters — " ' and ` (BUG-0075).
# A template literal is an ordinary URL literal: `import(`https://cdn…`)` is the
# form a copy-pasted snippet routinely takes, and anchoring on quote-or-paren
# alone was still a spelling, one delimiter short of the invariant. (A STATIC
# `import x from `url`` is illegal JS — specifiers must be plain strings — so
# the backtick reaches this rule via the dynamic loaders: import(),
# importScripts(), Worker(), fetch(). Off-origin code either way.)
# re.I because URL schemes are case-insensitive and the browser fetches HTTPS://
# just the same — REMOTE_SRC_RE has carried re.I all along, and the two rules
# must not disagree about the same question (BUG-0075).
# `(` is NOT in the class (BUG-0076): a parenthesis before a URL is how PROSE
# CITES A SOURCE — `// Fisher-Yates shuffle (https://en.wikipedia.org/…)` — and
# in a .js file _code_spans returns the whole text, comments included, so the
# paren anchor blocked the handoff on an ordinary attribution comment. Advising
# a builder to vendor a Wikipedia link at a pinned sha256 reads as "the gate is
# broken", and that is when a gate gets deleted — taking the real CDN import
# with it. Dropping it costs no true positive: a BARE URL cannot be a JS
# operand (`https:` is a label, `//…` opens a comment), so the only thing the
# paren could match that a delimiter does not is prose or a syntax error —
# never a fetch. Every real loader takes a STRING specifier, so import(),
# importScripts(), Worker() and fetch(("https://…")) are still caught, by the
# quote or backtick that must be there.
CODE_URL_RE = re.compile(r"""["'`]\s*(?:https?:)?//([A-Za-z0-9._-]+)""", re.I)
# XML/SVG namespace URIs are identifiers, never fetched: createElementNS(
# "http://www.w3.org/2000/svg", …) is first-party code, not a CDN load.
NS_HOSTS = {"www.w3.org", "w3.org"}
# CSS pulls off-origin resources through url()/@import, and a url() token takes a
# BARE URL with no string delimiter — the one form CODE_URL_RE (anchored on a JS
# string delimiter) structurally cannot see. `@import url(https://fonts…)` pulls
# a whole third-party stylesheet into a signed-in session; a bare
# url(https://cdn/font) does the same for a font/asset — the corpus's off-origin
# class, just in CSS grammar. QUOTED CSS urls (`@import "https://…"`,
# `url("https://…")`) already ride CODE_URL_RE via the text/css code span, so
# this matches ONLY the unquoted url() form: no overlap, no double finding. It
# runs against CSS text alone and never touches JS, so it does not widen the JS
# predicate (scope item 5 / BUG-0076).
CSS_URL_RE = re.compile(r"""url\(\s*(?:https?:)?//([A-Za-z0-9._-]+)""", re.I)
# The terminator is `</script(?=[\t\n\f\r />])[^>]*>`, not `</script\s*>` and not
# the literal `</script>`. Per the HTML5 tokenizer's script-data-end-tag-name
# state, EXACTLY these end the tag name: tab (U+0009), LF (U+000A), FF (U+000C),
# CR (U+000D), space (U+0020), `/` and `>`. A `/` or an attribute list there is a
# PARSE ERROR, but the tag is still emitted and the element still closes — a parse
# error is not a refusal to execute.
# Missing a terminator is not a near-miss but a TOTAL SILENCE: the non-greedy
# `(.*?)` finds no terminator, so _code_spans yields nothing for the whole file
# and every URL in the inline module goes untested while the gate reports clean
# (BUG-0081 for the spaced form, BUG-0086 for solidus/attributed).
#
# THE LOOKAHEAD IS LOAD-BEARING, AND IT IS GUARDED FROM BOTH SIDES. Too NARROW
# and it under-closes: a bare `</script[^>]*>` would close on `</scriptfoo>`,
# which a browser does NOT close (it stays script data). Too WIDE and it
# over-closes, which is strictly worse — an over-close does not lose one finding,
# it BLINDS the gate for the REST OF THE FILE (the span ends early, finditer
# finds no further opener, and every byte after it goes unscanned while the gate
# reports clean). The lookahead pins the terminator to the tag NAME's end;
# `[^>]*>` then consumes the solidus/attributes the tokenizer treats as parse
# errors but emits anyway.
#
# THE CLASS IS SPELLED OUT, NOT `\s` (BUG-0093): python's `\s` is a strict
# SUPERSET of the HTML5 whitespace set — it also matches U+000B (VT) and
# U+001C-001F (FS/GS/RS/US), on which the tokenizer does NOT close. `\s` here
# made the gate close where chromium does not, and a stray VT in a JS comment
# (which keeps the browser's larger body valid JS) took the gate SILENT on a live
# off-origin CDN import after it. Both directions are pinned:
# test_js_bound_end_tag_does_not_close_on_a_longer_tag_name (under-wide) and
# test_js_bound_end_tag_does_not_close_on_a_non_html5_whitespace_char_qa
# (over-wide). Do not re-spell this class as `\s`.
#
# ORACLE, and this is the point of BUG-0086: chrome-headless-shell (playwright
# chromium-1223, DEP-0006), page `<script>document.title="EXECUTED"%s<p id=after>`
# read back with --dump-dom (chrome exit 0 on every case; control `</script>`
# EXECUTES and `</scriptfoo>` does not, so the instrument discriminates):
#     </script>  </script >  </script\t>  </script\n>  </script\f>  -> EXECUTED
#     </script\r>  </script\r\n>                                    -> EXECUTED
#     </script/>  </script />  </script foo="bar">  </script bar>   -> EXECUTED
#     </script/foo>                                                 -> EXECUTED
#     </scriptfoo>  </scriptx>  </script1>                  -> NOT executed
#     </script\x0b>  </script\x1c-\x1f>                     -> NOT executed
# CR was the one limb that was ARGUED (from the spec's input-stream CR->LF
# preprocessing) rather than measured. It was then MEASURED and the argument held
# — but a spec citation is not a measurement even when it turns out right, and
# had CR not closed, citing it would have re-committed BUG-0093 inside the fix
# for BUG-0093. Every row above is read off the instrument.
# python's `html.parser` is only a PROXY for this and it is WRONG here: it does
# not close the solidus/attributed forms and a browser does. It is DEMOTED and is
# no longer citable for what counts as a script body — the browser wins
# (DECISIONS 2026-07-17). The browser is the instrument we READ to derive this
# regex; it is NOT in the artifact — no suite needs a browser to run.
#
# ACCEPTED EDGE, recorded so it is not re-filed (DECISIONS 2026-07-17):
# `</script foo="a>b">` — a `>` inside a quoted attribute value of an END TAG.
# `[^>]*>` stops at the inner `>`; a browser does not. Separating it needs
# attribute-grammar parsing, the tool class the door is closed on. (The captured
# BODY is unaffected — the span still ends before the code's end.)
#
# Independent of TASK-0034: mimetypes can say which FILES are code, never where
# the code is inside a rendered template — so this terminator stays.
SCRIPT_BLOCK_RE = re.compile(r"<script\b[^>]*>(.*?)</script(?=[\t\n\f\r />])[^>]*>",
                             re.I | re.S)
MAX_JS_LINE = 500

BOUND_CITE = "DECISIONS 2026-07-16 (M5 bound)"


def _media_type(name):
    """What a browser is told this file IS — mimetypes.guess_type, the oracle
    werkzeug/utils.py:438 itself consults. Case-insensitive on its own, so a
    served enhance.MJS reads text/javascript exactly as enhance.mjs does."""
    return mimetypes.guess_type(name)[0]


def _in_corpus(name):
    """A served file is in the scan corpus iff the browser would EXECUTE or
    APPLY it (mimetypes says text/javascript or text/css); a template is in it
    because its rendered output can carry <script> blocks (RENDERED, not served,
    so mimetypes cannot speak for it — its extension set is the product's own,
    author-verifiable naming)."""
    return (_media_type(name) in CODE_MEDIA_TYPES
            or name.lower().endswith(TEMPLATE_EXTS))


def _git_ignored(base, rels):
    """The subset of `rels` the product's own .gitignore declares ignored —
    untracked build output is not code anyone ships. (2026-08-10: a gradle
    problems-report under app/android/build/ carried a true remote-code-load
    match, 32 findings, and reddened every primary-checkout scan; the
    generator list — android/, ios/, Pods/ — is a treadmill, and a name-at-
    depth skip is exactly the hole BUG-0068 closed. git already knows.) A
    product that ignores something it does serve has a packaging bug, which
    is a different finding. Fails OPEN on any tooling error (no repo, git
    missing) — the gate never goes silent because git could not answer."""
    if not rels:
        return set()
    try:
        p = subprocess.run(["git", "check-ignore", "--stdin", "-z"],
                           input="\0".join(rels) + "\0", cwd=base,
                           capture_output=True, text=True, timeout=60)
    except Exception:
        return set()
    if p.returncode not in (0, 1):  # 0 some ignored, 1 none; else error
        return set()
    return {r for r in p.stdout.split("\0") if r}


def product_assets(base):
    """(relpath, fullpath) for every template/static asset in the product
    tree(s) under `base` — vendored and VCS dirs excluded (app/.venv ships
    other people's minified JS; it is the supply gate's business, not ours).

    The exemption applies at the TOP of a scope entry only (app/.venv,
    app/node_modules, app/.git) — never by name at depth (BUG-0068): Flask
    serves everything under quizapp/static/, so a blob at
    static/node_modules/pkg/x.min.js is a 200 in a user's browser. Nothing we
    ship is exempt from the bound because of what its directory is called.

    `followlinks=True` for the same reason (BUG-0077). os.walk's default skips
    a symlinked DIRECTORY while Flask serves straight through it, so
    `ln -s ../../node_modules quizapp/static/vendor` published a minified blob
    at a 200 with the gate reporting clean — the SKIP_DIRS-exempt vendored root
    reached by a path that is not exempt. A symlink is a spelling of a path,
    and this gate does not care how a path is spelled; it cares what a browser
    can GET. (A symlinked FILE was always caught — os.walk lists it among
    filenames — which is exactly why only fixing the file case would be
    fixing the spelling, not the hole.)

    Following links reopens what `followlinks=False` was protecting against:
    a symlink cycle (`ln -s . loop`, or a -> b -> a) walks forever. So each
    directory is admitted at most once BY RESOLVED IDENTITY (realpath, which
    collapses every alias of the same directory to one key) rather than by
    path. A cycle's second lap resolves to a realpath already seen and is
    pruned, which terminates; content reached by two aliases is scanned under
    the first one, and a finding there fires under that path just the same."""
    seen = set()
    found = []
    for entry in lib.default_scope():
        root = os.path.join(base, entry)
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            real = os.path.realpath(dirpath)
            if real in seen:
                dirnames[:] = []          # cycle or alias: already walked
                continue
            seen.add(real)
            if dirpath == root:
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in sorted(filenames):
                if _in_corpus(name):
                    full = os.path.join(dirpath, name)
                    found.append((os.path.relpath(full, base), full))
    ignored = _git_ignored(base, [rel for rel, _ in found])
    for rel, full in found:
        if rel not in ignored:
            yield rel, full


def _lineno(text, pos):
    return text.count("\n", 0, pos) + 1


def _code_spans(rel, text):
    """(offset, code) regions of a file that are CODE: a whole-file code asset
    (mimetypes says text/javascript or text/css) entire — .css is a span now,
    not the dead config it was when it returned [] — or each <script>…</script>
    body in a template. Everything outside a script block in a template is
    markup, where an off-origin URL is a link."""
    if _media_type(rel) in CODE_MEDIA_TYPES:
        return [(0, text)]
    return [(m.start(1), m.group(1)) for m in SCRIPT_BLOCK_RE.finditer(text)]


def scan_js_bound(base):
    """Findings for the runtime JS/CSS dependencies the supply gate cannot see:
    an off-origin script src, off-origin code loaded without one (ESM import,
    import(), importScripts, Worker), an off-origin CSS url()/@import, and a JS
    blob no reviewer can read."""
    findings = []
    for rel, full in product_assets(base):
        try:
            text = open(full, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        lines = text.splitlines()
        for m in REMOTE_SRC_RE.finditer(text):
            findings.append(
                "remote-script-src at %s:%d — an off-origin src is a runtime "
                "dependency no install ever declares: unpinned, mutable at an "
                "origin we do not control, running in a signed-in session. "
                "M5 JS is same-origin/first-party (%s). Serve it from the "
                "product's static dir, or vendor it at a pinned sha256/SRI "
                "via a DEP ticket — never a live CDN tag."
                % (rel, _lineno(text, m.start()), BOUND_CITE))
        for offset, code in _code_spans(rel, text):
            for m in CODE_URL_RE.finditer(code):
                if m.group(1).lower() in NS_HOSTS:
                    continue
                findings.append(
                    "remote-code-load at %s:%d — an off-origin URL in client "
                    "code (%s) is the same runtime dependency as a CDN script "
                    "tag, just spelled without src=: import/import()/"
                    "importScripts/Worker all fetch and RUN it, unpinned, from "
                    "an origin we do not control, in a signed-in session. M5 JS "
                    "is same-origin/first-party (%s): serve it from the "
                    "product's static dir, or vendor it at a pinned sha256/SRI "
                    "via a DEP ticket. (An ordinary outbound LINK belongs in "
                    "markup — <a href> is not matched.)"
                    % (rel, _lineno(text, offset + m.start()), m.group(1),
                       BOUND_CITE))
        # A stylesheet's off-origin url()/@import in the UNQUOTED form — the one
        # CODE_URL_RE cannot see (it anchors on a JS string delimiter, and a
        # CSS url() token carries a bare URL). CSS-only, so the JS predicate is
        # untouched. (TASK-0033's goal, preserved: an off-origin @import fires.)
        if _media_type(rel) == "text/css":
            for m in CSS_URL_RE.finditer(text):
                if m.group(1).lower() in NS_HOSTS:
                    continue
                findings.append(
                    "remote-code-load at %s:%d — an off-origin url() in a "
                    "stylesheet (%s) is a runtime dependency no install "
                    "declares: an @import pulls a whole third-party stylesheet, "
                    "a url() a font/asset, unpinned and mutable at an origin we "
                    "do not control, applied in a signed-in session. M5 assets "
                    "are same-origin/first-party (%s): serve it from the "
                    "product's static dir, or vendor it at a pinned sha256 via "
                    "a DEP ticket." % (rel, _lineno(text, m.start()),
                                       m.group(1), BOUND_CITE))
        # The blob clause is JS-only: minified CSS is not code a reviewer must
        # read to trust. text/javascript is the oracle's own answer to "is this
        # a JS file?" — no extension list to keep.
        if _media_type(rel) != "text/javascript":
            continue
        why, at = None, 1
        # Name the extension actually matched, so a .min.mjs finding does not
        # report itself as ".min.js" (BUG-0080).
        minext = next((e for e in MIN_JS_EXTS if rel.lower().endswith(e)), None)
        if minext:
            why = "a %s name" % minext
        else:
            for i, line in enumerate(lines, 1):
                if len(line) > MAX_JS_LINE:
                    why, at = "a %d-char line (>%d)" % (len(line), MAX_JS_LINE), i
                    break
        if why:
            findings.append(
                "minified-js-blob at %s:%d — %s means no reviewer can read this. "
                "M5 JS is first-party and unminified (%s); a blob is the "
                "vendoring case, which arrives via a DEP ticket with a recorded "
                "sha256, not a silent commit." % (rel, at, why, BOUND_CITE))
    return findings


def report_js_bound(base):
    """Prints the JS-bound findings the way the secrets check prints its own.
    Returns 1 if the bound is violated (blocking), else 0."""
    findings = scan_js_bound(base)
    if not findings:
        print("self-scan: JS bound clean (no off-origin code load, no minified blob)")
        return 0
    print("RUNTIME JS DEPENDENCY THE SUPPLY GATE CANNOT SEE:")
    for f in findings:
        print("  BLOCKED: %s" % f)
    print("The handoff is blocked until this scan is clean.")
    return 1


def installed_packages():
    """(name, version) from the product venv's dist-infos — what actually
    landed. Python-only by design; other ecosystems produce no advisories."""
    pkgs = []
    for d in lib.default_scope():
        pat = os.path.join(lib.PRODUCT, d, ".venv", "lib", "python*",
                           "site-packages", "*.dist-info")
        for info in glob.glob(pat):
            base = os.path.basename(info)[:-len(".dist-info")]
            if "-" in base:
                name, ver = base.rsplit("-", 1)
                pkgs.append((name, ver))
    return sorted(set(pkgs))


def osv_advisories(pkgs):
    """{(name, ver): [vuln ids]} via one OSV batch query. None = offline."""
    if not pkgs:
        return {}
    body = json.dumps({"queries": [
        {"package": {"name": n, "ecosystem": "PyPI"}, "version": v}
        for n, v in pkgs]}).encode()
    try:
        req = urllib.request.Request(OSV_URL, data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            results = json.load(resp)["results"]
    except Exception:
        return None
    hits = {}
    for pkg, res in zip(pkgs, results):
        vulns = [v["id"] for v in (res or {}).get("vulns", [])]
        if vulns:
            hits[pkg] = vulns
    return hits


def main():
    args = sys.argv[1:]
    scope, base, since = None, lib.PRODUCT, None
    if "--ticket" in args:
        tid = args[args.index("--ticket") + 1]
        tickets = lib.load_all()
        if tid not in tickets:
            sys.exit("ERROR: unknown ticket %s" % tid)
        wt = os.path.join(lib.ROOT, ".worktrees", tid)
        if os.path.isdir(wt):
            # ticket worktree: scan its whole diff vs the run branch — the
            # worktree contains exactly this ticket's work, declared scope or not
            base, scope = wt, ["."]
            since = subprocess.run(["git", "-C", lib.PRIMARY, "rev-parse",
                                    "--abbrev-ref", "HEAD"],
                                   capture_output=True, text=True).stdout.strip()
        else:
            scope = tickets[tid]["front"].get("touch_scope") or lib.default_scope()
    elif "--paths" in args:
        scope = [s for s in args[args.index("--paths") + 1].split(",") if s]
    if not scope:
        if args:
            sys.exit("usage: self_scan.py [--ticket ID | --paths a,b] "
                     "[--secrets-only]")
        # Bare invocation: the JS bound is a property of the product TREE, not
        # of anyone's diff, so it is answerable without a scope.
        sys.exit(report_js_bound(lib.PRODUCT))

    files = changed_files(scope, base, since)
    if not files:
        print("self-scan: no changed files under scope %s" % ",".join(scope))

    tool = "gitleaks" if shutil.which("gitleaks") else "builtin"
    findings = scan_gitleaks(files, base) if tool == "gitleaks" \
        else scan_builtin(files, base)
    if findings:
        print("SECRETS FOUND (%s — values withheld on purpose):" % tool)
        for f in findings:
            print("  BLOCKED: %s" % f)
        print("Remove the secret (use env vars / config outside the repo). "
              "The handoff is blocked until this scan is clean.")
        sys.exit(1)
    print("self-scan: secrets clean (%d file(s), %s)" % (len(files), tool))

    # Whole product tree, not the diff, and not skipped by --secrets-only (that
    # flag spares the network advisory call, never a blocking local check): in
    # --ticket mode `base` is the builder's worktree, so a CDN tag is caught at
    # the handoff that would have landed it.
    if report_js_bound(base):
        sys.exit(1)

    if "--secrets-only" not in args:
        hits = osv_advisories(installed_packages())
        if hits is None:
            print("ADVISORY check skipped (OSV.dev unreachable — offline?)")
        else:
            for (name, ver), vulns in sorted(hits.items()):
                print("ADVISORY %s==%s: %s — tell the toolsmith (comment the "
                      "relevant DEP or file one)" % (name, ver, ", ".join(vulns)))
            if not hits:
                print("self-scan: no known advisories for installed app packages")
    sys.exit(0)


if __name__ == "__main__":
    main()
