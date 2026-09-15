# Wire `ci_check.py` into the dispatch tick — nothing measures the tree every lane clones

**Supersedes `2026-09-11-qa-pins-land-on-the-run-branch-ungated.md`** (architect,
same hole, one of two incidents, three candidate fixes and no diff). Delete that
file when this installs; its first recommendation ("run `ci_check` on the
post-merge run-branch tip") is the diff below.

- **Type**: amend
- **Incidents** (2, receipts):
  1. **BUG-0195** (archived, M3, P1, QA-filed off BUG-0192's close;
     architect's incident report 2026-09-11). QA's pin commit `5d82adbc`
     (`admin-window/BUG-0194: pin /sources' unnamed settled-values narrowing`)
     went **straight onto `run/admin-window`** — parent `d1e148a6`, the run-branch
     tip, no ticket branch, no receipt, no `ci_check`. It carried three TS2345s
     in `tests/offline/sources/page.test.ts:1543-1544`.
     `./node_modules/.bin/tsc --noEmit` exited 1 on the run branch from
     `5d82adbc` through `c84f68a7` — four tracker commits and one land — and
     **every lane branched from the red tree in between**. Re-measured by the
     architect at `c84f68a7`. Nothing cheaper than the type checker could see
     it: `npm run lint` 0, `npm run build` 0 (Next never type-checks `tests/`),
     the whole offline suite green (vitest transpiles without checking).
     Second, structural half of the same incident: the very next commit
     `2c928a80` (`land BUG-0192 (ticket branch merge)`) has parents `5d82adbc`
     + `0f0a433c`; BUG-0192's builder correctly measured `tsc` exit 0 on
     `0f0a433c`, its own tip. **Nothing anywhere measured `2c928a80`.** A gate
     that runs on one parent of a merge cannot see an error contributed by the
     other, so two green branches merge to a red tree and both lanes report green.
  2. **BUG-0207** (archived, M3, **P0**, verifier-filed, 2026-09-11 ~19:57Z).
     The dispatcher wrote the two M2 handoff migrations into the sibling repo at
     ~12:00Z; `tests/offline/handoff/settle-review-item.test.ts` read every
     `KSnnn` under the sibling as a collision, so the offline suite was **RED at
     HEAD in the primary checkout for roughly seven hours** — through every
     builder lane in that window — and was found by the **verifier**, as
     **EC1 FAIL** at the M3 walk. The strategist's spawn audit: the verifier
     "caught a P0 that had reddened every builder's suite."

  Different causes, one blind spot: **the tip every lane clones is unmeasured
  between milestone walks.**

- **Root fact I measured this run, and it is the reason the existing proposal
  went nowhere**: `ci_check.py`'s own docstring says "Run once per dispatch tick
  (self-skips when the app tree hasn't changed since the last check)" — and
  `grep -n 'ci_check\|ci_command' agenticflow/scripts/dispatch.py` returns
  **nothing**. The CI-repair loop is a script no scheduler calls; it runs only
  when the dispatcher *agent* remembers to type it. `tracker/ci_state.json` at
  the close carries `last_green_commit f3b90943` (2026-09-15 00:26) against HEAD
  `c9b737f6` (01:01) — one land later, unchecked. The dispatcher's incident log
  also records **background commands killed under memory pressure on two
  dispatch ticks this run**, which is a second way a backgrounded `ci_check`
  silently never reports.

- **Diff**: `agenticflow/scripts/dispatch.py`, in `main()`, immediately before
  line 1040 `push_run_branch(run_branch, cfg, flags)`.

  Before:
  ```python
      push_run_branch(run_branch, cfg, flags)
  ```
  After:
  ```python
      # The tip is the tree every lane clones, and nothing measured it between
      # milestone walks: a QA pin put tsc-red on it for four commits (BUG-0195,
      # 2026-09-11) and a sibling-side install put the offline suite red on it
      # for ~7 h until the verifier's EC1 (BUG-0207, P0). ci_check.py is built
      # for exactly this — it self-skips on an unchanged tree hash and refuses
      # to overlap itself with a lockfile — it was simply never called.
      ci = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ci_check.py")
      st = {}
      try:
          with open(os.path.join(lib.ROOT, "tracker", "ci_state.json"),
                    encoding="utf-8") as fh:
              st = json.load(fh)
      except Exception:
          pass
      if st.get("status") == "red":
          flags.append({"kind": "ci_red", "bug": st.get("open_bug"),
                        "last_green": st.get("last_green_commit"),
                        "note": "the run branch tip is RED — every lane spawned "
                                "now branches from it; route the repair BUG "
                                "before assigning new work"})
      # fire-and-forget: the suite takes minutes and the tick must not block.
      # A run killed mid-suite (memory pressure took two background commands
      # this run) leaves ci_state stale, which the staleness flag below catches
      # rather than reporting a green that was never measured.
      try:
          subprocess.Popen([sys.executable, ci], cwd=lib.PRODUCT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           start_new_session=True)
      except Exception:
          flags.append({"kind": "ci_launch_failed"})

      push_run_branch(run_branch, cfg, flags)
  ```

  Staleness (the killed-background case) needs one more line where the tick
  already knows the landings — inside the land loop, after
  `flags.append({"kind": "landed", "id": tid, "merge": sha})` (line 642), record
  the merge sha so a later tick can compare it against `ci_state["last_green_commit"]`
  and flag `ci_unmeasured` when three consecutive ticks pass with the tip ahead
  of the last graded commit. I am naming that rather than writing it because the
  counter's home (a field in `ci_state.json` vs. a new tracker file) is a kit
  design choice, not a defect fix.

  **Not proposed**, deliberately: a per-pin receipt. QA filing a pin should stay
  cheap; the point is that the *tip* is graded within a tick, however the commit
  got there.

- **Removal condition**: delete the wiring if, across 3 consecutive runs, no
  `ci_red` or `ci_unmeasured` flag is ever raised — i.e. every red tip is caught
  by a lane's own gate before a tick sees it. Also delete it if `ci_command` ever
  becomes cheap enough to run inside the land itself (then the merge-result check
  belongs in the land block and this is redundant).

- **Model stamp**: `claude-opus-5[1m]` (both incidents produced by lanes in the
  2026-09-02…15 run on this install).

- **Cost**: one full `ci_command` (`lint && tsc --noEmit && npm test`, ~2-4 min
  here) per tick **whose tree changed** — `ci_check.py` self-skips on an
  unchanged tree hash, so an idle loop pays nothing; a busy loop pays one suite
  per land. Real risk to name: a suite process now runs concurrently with lanes
  in the shared checkout, which is exactly the race reported in
  `2026-09-08-shared-checkout-suite-races.md` (still open, still unfixed:
  `layering.test.ts`'s probe file is planted in the shared tree). `ci_check.py`
  discards a run whose tree changed mid-suite as `torn`, which covers the land
  case but not two concurrent vitest runs — **install the shared-checkout lock
  from that proposal first, or this one will manufacture spurious P0s.** Plus
  one new flag the dispatcher must read each tick.

---

## Below the bar this run (one line each, no proposal written)

- **A ticket left in `qa` by a dead session is never re-offered by dispatch**
  (BUG-0158, power outage 2026-09-10 ~05:22Z; respawned by hand). **One
  incident** — the `built`/claimed path self-healed correctly at `--session-start`
  the same night. Watching: a second occurrence makes it an add.
- **`ticket.py new --parent` never populates the parent's `children` list**
  (architect, 2026-09-10; FEAT-0014/15/16 all read `children: []`, so the
  children-done gate at close cannot see the twelve M3 TASKs). One incident,
  but a clean one-line fix — promote on any repeat, or install it as a bug
  report if you agree it is unambiguous.
- **`evidence_clean.py` cannot clean evidence written from a worktree** —
  already filed twice (`2026-09-08-…-cannot-reach-a-worktree-evidence-dir.md`,
  `2026-09-10-evidence-clean-unusable-from-a-worktree.md`, builders 143 and 255).
  Recurrent and installable; **left standing, not re-filed** — two files already
  say it and a third would be the pile this role exists to prevent.
- **The worktree hygiene sweep force-deletes any worktree whose name is not a
  ticket id** (`2026-09-08-worktree-sweep-deletes-live-lane-checkouts.md`; two
  QA lanes, three deletions). Verified still present this run at dispatch.py
  line 677: `if st in (None, "done", "wont_fix"): drop_worktree(...)`.
  **Left standing** — the filed proposal is correct and needs installing, not
  restating.
- **`qa_depth: lean` caps a lane at one BUG, so a class arrives one property at
  a time** — four chains = 42 of M3's 72 bugs (strategist's retro, with the
  `discovered_from` depth histogram). Not proposed **as machinery**: the fix the
  strategist priced (~8% of milestone spend) is the architect promoting to a
  class ruling at N=2, which is a judgment call, and every mechanical version I
  could draft (dispatch refusing the depth-3 ticket, forcing an architect spawn)
  gates on a heuristic that would have blocked true findings. It is a role-brief
  line for the architect, not a gate — raise it with that role, not with me.
- **`spawn_log.tsv` is 95% noise**: 34,959 lines, of which 16,812 `# STRANDED`
  and ~16,567 empty heartbeat rows, against **797** actual return rows. 3,604
  STRANDED rows name `.env.example` alone — a file you own, flagged in the
  "Still waiting" block of both digests since 2026-09-04 — and 882 name
  `agenticflow/DIGEST.md`, the dispatcher's own working file. Worth a dedupe
  (log on set-*change*, not per tick) plus an ignore list; it did not make the
  cap because nothing failed because of it. Flagging, per the counter rule.
- **`evidence_budget` fired 95 times run-wide (14 in M3) and blocks nothing** —
  a counter no one acts on. Not proposed for removal: the count is the only
  instrument on QA evidence size, and QA is the second-largest line on the
  board. Flagged for your decision.
- **`remote_gate`: zero fires, whole run — it stays**, for the supply-chain
  reason: it gates a class of action this campaign never needed (no remote) but
  that is unbounded when it does happen. Zero fires there is the gate working,
  not the gate idling. `supply_gate` (10) and `artifact_gate` (185) are plainly
  earning. **`browser_gate` cannot be audited at all**: alone among the hooks it
  carries no fire-counter — no `gate_fires.tsv` write anywhere in the file,
  while every other gate has the "fire-counter (curator trim-data)" block. Its
  refusals are invisible to this role forever. Three lines mirroring
  `remote_gate.py:85-91` would fix it; below the cap this run because the gate's
  *behaviour* is correct and nothing failed — but next curator will have the
  same blind spot.
- **Data-integrity oddity**: `gate_fires.tsv` holds two rows that are not gate
  fires — a blank line and the prose line
  `**The production-like walk repeats the mapping on both commands.**` — so
  something appended to the TSV with `>>` outside the hooks. Harmless to the
  gates, but it means the file is writable scratch to anything that guesses the
  path; worth knowing when you install proposal 1.
