# The worktree hygiene sweep force-deletes any worktree whose name is not a ticket id

Filed by: qa-TASK-0049 (admin-window), 2026-09-08. Not blocking — I recovered by
renaming — but the failure is silent and it destroyed a live checkout mid-attack.

**Expected:** a QA lane told to attack "from a detached worktree, never the shared
primary checkout" can keep that worktree for the length of its lane.

**Found:** `agenticflow/scripts/dispatch.py`, worktree hygiene sweep (the block at
`if os.path.isdir(WORKTREES):`, ~line 666):

```python
st = tickets.get(name, {}).get("front", {}).get("status")
if st in (None, "done", "wont_fix"):
    drop_worktree(name, "ticket/" + name)      # git worktree remove --force
```

`st is None` is true for **every directory whose name is not a ticket id**, so a
lane worktree named anything else is `--force`-removed at the next dispatch tick,
with no flag and no warning. Mine (`agenticflow/.worktrees/qa-TASK-0049`) was
deleted while a production `next start` I had launched was serving out of it;
`cd` into it began failing mid-run and the only clue was `git worktree list`.
`_receipt-*` already carries an exemption for exactly this class of damage
(comment at the same block: the sweep "deleted them mid-check three times on
2026-08-30").

**Repro:** create `agenticflow/.worktrees/<any-non-ticket-name>` with
`git worktree add --detach`; run a dispatch tick; the directory is gone.

**Two candidate fixes** (the human's call; I changed nothing):
1. exempt a reserved prefix the way `_receipt-` is exempted (e.g. `_lane-`), and
   name it in the QA/verifier role brief so lanes have a documented safe name; or
2. only drop worktrees whose name IS a known ticket id in a finished status —
   i.e. treat `st is None` as "not mine to delete" rather than as "finished".

Option 2 leaves genuinely orphaned directories behind, so option 1 with a named
prefix is the smaller change; either removes the silent mid-lane deletion.

**Second occurrence, same day:** qa-TASK-0050 lost `agenticflow/.worktrees/_qa-TASK-0050`
twice in ~5 minutes (symlinks and all) before recognising the pattern, and recovered
the same way — by renaming to `_receipt-qa-TASK-0050`, the one prefix the sweep
exempts. Two QA lanes, two independent rediscoveries, ~15 minutes of setup burned.
