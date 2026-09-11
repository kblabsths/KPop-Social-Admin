# `evidence_clean.py` cannot clean evidence written from a worktree

Severity: minor (worked around by hand; no ticket blocked).
Found by builder-255 while closing admin-window/TASK-0067, 2026-09-10.

## The measurement

`agenticflow/tracker/evidence` is a symlink to
`../visions/<campaign>/tracker/evidence`, and it exists in BOTH checkouts —
the primary and every linked worktree — so a builder working in
`agenticflow/.worktrees/<ID>/` writes its evidence into the WORKTREE's
`agenticflow/visions/<campaign>/tracker/evidence/<ID>/`. That is the path the
kit's own instruction ("evidence lives under
`agenticflow/tracker/evidence/<TICKET>/`") resolves to from there.

`evidence_clean.py` resolves the evidence root from the PRIMARY checkout
instead, whichever copy of the script is invoked:

    # run from agenticflow/.worktrees/TASK-0067, files present in that tree
    $ python3 agenticflow/scripts/evidence_clean.py TASK-0067 'before/*.html'
    nothing to clean: /Users/…/kspace Admin/agenticflow/visions/admin-window/tracker/evidence/TASK-0067 does not exist
    $ ls agenticflow/visions/admin-window/tracker/evidence/TASK-0067
    absent.diff  after  before  …

Exit code 1, and the twenty-odd working files it was asked to delete are still
there.

## Why it matters

The handoff rule is "delete working artifacts before handoff" and the same
breath says "never raw `rm` for cleanup: an arbitrary rm with globs prompts the
human every single time, for a deletion the factory already sanctions." With
the tool refusing, the only route left is exactly the raw `rm` the rule exists
to avoid — I ended up deleting 24 paths by name. Every builder that writes
evidence from its worktree meets this.

## Suggested fix

Resolve the evidence root relative to the CURRENT working tree (`git
rev-parse --show-toplevel`, which answers the worktree's own root) rather than
to the primary checkout, and keep the bound check against that root. A cheaper
alternative: accept an explicit `--root`, so a worktree lane can name its own.
