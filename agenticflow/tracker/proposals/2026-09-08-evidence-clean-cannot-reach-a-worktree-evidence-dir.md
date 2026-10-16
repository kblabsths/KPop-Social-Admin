# evidence_clean.py cannot reach evidence a builder wrote inside its worktree

Reported by builder-143 on admin-window/TASK-0054, 2026-09-08. Non-blocking:
the ticket landed; the cleanup took one extra `mv`.

## What happened, measured

The builder defs say working files live in `agenticflow/tracker/evidence/<ID>`,
and a builder works in `agenticflow/.worktrees/<ID>`. Files written to the
worktree's own copy of that directory could not be deleted by the sanctioned
deleter, from either checkout. Run from the worktree with the pattern `*.html`,
`evidence_clean.py TASK-0054` printed:

    nothing to clean: ...agenticflow/visions/admin-window/tracker/evidence/TASK-0054 does not exist

while the nine files sat, unmentioned, in the worktree's
`agenticflow/tracker/evidence/TASK-0054`.

## Why

Two facts meet:

- `lib_ticket._shared_home()` anchors `ROOT` on the PRIMARY checkout for any
  script run from a ticket worktree - correct and deliberate, so ticket writes
  land in the one true tracker.
- In this install the primary's `agenticflow/tracker/evidence` is a SYMLINK to
  `../visions/admin-window/tracker/evidence`, and `evidence_clean.py` calls
  `os.path.realpath()` on the joined path - so the refusal names the
  vision-scoped path, which reads like a different bug than the one it is.

A worktree's own `agenticflow/tracker/evidence` is a plain gitignored directory
with no symlink, so files written there are outside everything the tool looks
at, and the tool reports only that some third path does not exist.

## What would fix it

Either would do, and neither is mine to write mid-run:

1. `evidence_clean.py` also cleans the PRODUCT checkout's own
   `agenticflow/tracker/evidence/<ID>` when PRODUCT is a worktree - the
   directory an agent's `cd` actually lands in.
2. Or the defs tell builders to write evidence at the primary's absolute
   evidence path, and the refusal message names both paths it considered.

The workaround used here: move the files into the primary's evidence dir, then
run the tool, which deleted all nine and printed `remaining: (empty)`.
