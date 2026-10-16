# URGENT: the ticket-integrity gate runs on Edit/Write only, so every ticket file is writable from Bash

- **Type**: amend (gate hole — the rule exists, its matcher does not cover the path writes arrive on)
- **Incidents** (receipts):
  1. **architect, 2026-09-11** (dispatcher incident log, `scratchpad/incidents.md`):
     "the ticket gate did not fire on a direct script edit of a ticket file".
     The architect attributed it to the `agenticflow/tracker/` → `agenticflow/visions/admin-window/tracker/`
     symlink; that diagnosis is wrong and the truth is worse. `ticket_gate.py`
     already matches the campaign path (`re.match(r"agenticflow/visions/[^/]+/tracker/(tickets|archive)/", rel)`,
     line 40). It did not fire because the edit was made from **Bash**, and
     `.claude/settings.json` registers `ticket_gate.py` under the
     `"matcher": "Edit|Write|MultiEdit|NotebookEdit"` block only.
  2. **2026-09-09T01:02:02Z and 01:08:29Z, `gate_fires.tsv:92,94`** — two write
     attempts on `agenticflow/run.yaml`, a path `ticket_gate.py` protects
     while `tracker/RUNNING` exists (line 54-57). Both arrived as **Bash**
     writes and both were stopped by `artifact_gate` instead, because
     `run.yaml` happens to also be in that gate's `FACTORY_FILES`. Ticket
     files, `tracker/archive/`, `INDEX.md`, a frozen `VISION.md` and
     `BLOCKED_DEPS.md` have **no** such overlap: for those, Bash is an open door.
  3. **Census, whole run**: `awk -F'\t' '{print $2}' agenticflow/tracker/gate_fires.tsv | sort | uniq -c`
     over 292 rows (2026-09-02 … 2026-09-15) → `artifact_gate 185`,
     `evidence_budget 95`, `supply_gate 10`, **`ticket_gate 0`**. Zero fires
     across 362 tickets and 374 recorded transitions. This is the trim audit
     answering the opposite of "trim it": the gate is not unused, it is blind.

  Standing condition that makes this load-bearing rather than theoretical:
  the agent harness prompt in this install tells every role "make file changes
  with `sed`, heredocs, or short scripts, rather than using the dedicated
  Read, Edit, or Write tools." The kit gates the tool class the harness tells
  agents not to use.

- **Diff**: two files.

  **(1) `.claude/settings.json`** — register the gate on the Bash matcher too.
  Before, `PreToolUse[0]` (`"matcher": "Bash"`) hook list ends:
  ```json
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/remote_gate.py\""
          }
  ```
  After — append one entry to that same list:
  ```json
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/remote_gate.py\""
          },
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/ticket_gate.py\""
          }
  ```

  **(2) `.claude/hooks/ticket_gate.py`, in `main()`** — take write targets from
  a Bash command, and strip a worktree prefix the way `artifact_gate.machinery()`
  already does (line 230: `rel = re.sub(r"^agenticflow/\.worktrees/[^/]+/", "", rel)`;
  without it an Edit inside `agenticflow/.worktrees/<ID>/` is ungated today as well).

  Before:
  ```python
      tool_input = payload.get("tool_input") or {}
      path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
      if not path:
          sys.exit(0)
      rel = os.path.relpath(os.path.abspath(path), os.path.abspath(PROJECT))
      protected = (
  ```
  After (the rest of `main()` — the `protected` tuple, the `ALLOWED_DEPS.md`
  branch and the `if any(protected):` block — is indented one level into the
  new `for path in paths:` loop; `sys.exit(2)` on the first offender is
  unchanged, and the trailing `sys.exit(0)` stays at function level):
  ```python
      tool_input = payload.get("tool_input") or {}
      cwd = payload.get("cwd") or PROJECT
      if (payload.get("tool_name") or "") == "Bash":
          # Ticket files are reached by `sed -i`, `cat >`, `tee` and `mv` far
          # more often than by Edit/Write — this arm was absent from install
          # until 2026-09-15 (ticket_gate: 0 fires in 292; the architect's
          # 2026-09-11 script edit went through unchallenged).
          sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
          from artifact_gate import bash_write_targets, effective_cwd
          cmd = tool_input.get("command") or ""
          base = effective_cwd(cmd, cwd)
          paths = [p if os.path.isabs(p) else os.path.join(base, p)
                   for p in bash_write_targets(cmd)]
      else:
          p = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
          paths = [p] if p else []
      if not paths:
          sys.exit(0)
      for path in paths:
          rel = os.path.relpath(os.path.abspath(path), os.path.abspath(PROJECT))
          rel = re.sub(r"^agenticflow/\.worktrees/[^/]+/", "", rel)
          protected = (
  ```

  **(3) optional, same install — `artifact_gate.bash_write_targets()`** (line 235):
  the extractor covers redirects, `-o/--output`, `mkdir/touch/tee` and
  `cp/mv/rsync`, but **not `sed -i`**, which is the exact idiom the harness
  prompt recommends. Add one arm beside the `cp/mv/rsync` arm:
  ```python
          elif tok in ("sed", "perl") and any(
                  t.startswith("-") and "i" in t
                  for t in tokens[i + 1:i + 4]):
              j = i + 1
              while (j < n and tokens[j] not in SEPARATORS
                     and not REDIRECT_RE.match(tokens[j])):
                  if not tokens[j].startswith("-") and os.path.sep in tokens[j]:
                      targets.append(tokens[j])
                  j += 1
              i = j - 1
  ```
  (Requiring a path separator keeps the sed *script* argument out of the
  target list; a bare `sed -i x file.md` in the cwd is missed, which is the
  honest limit of a static extractor.)

- **Removal condition**: delete the Bash arm if, across 3 consecutive runs,
  it logs **zero** `ticket_gate` fires **and** an audit of
  `git log -p -- 'agenticflow/visions/*/tracker/tickets/'` shows no commit
  changing a ticket file without a matching `ticket.py`-written `## History`
  line. Those two together say agents have stopped reaching tickets by script
  and the arm is dead weight. Zero fires alone proves nothing — that is
  exactly the state the gate is in today.

- **Model stamp**: `claude-opus-5[1m]` (this session's model; all lanes in the
  2026-09-02…15 `admin-window` run were spawned from this install).

- **Cost**: one more hook process per Bash call (four → five), each ~30 ms;
  one cross-hook import (`ticket_gate` → `artifact_gate`), so a syntax error in
  `artifact_gate.py` would now also break the ticket gate — wrap the import in
  `try/except ImportError: sys.exit(0)` if that coupling is unacceptable. A new
  refusal path: `sed -i`/`cat >` onto a ticket file now exits 2 with the
  existing "use `ticket.py`" message, which will bounce agents that are
  currently succeeding silently. Residual hole, stated plainly: no static
  extractor sees `python3 - <<'EOF'` opening a file for write. This gate is
  anti-drift, not anti-adversary — the same property `artifact_gate` has, and
  it is still the most-fired rule in the run at 185.
