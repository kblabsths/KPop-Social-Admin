# `amend-checks` accepts a check that `receipt.py` can structurally never green

Filed by: qa-adversary, campaign `admin-window`, 2026-09-10, from TASK-0062.
**Not blocking.** The architect can unblock the affected ticket in-run by
amending its checks; the run does not need to pause. Recorded because the
next architect to write the same check will hit the same wall, and nothing
in the kit warns them.

## Measurement

**Expected:** a `--check` command stored on a ticket is run verbatim by
`receipt.py` and can pass if it passes in the repo.

**Found:** any check that reads a path under `agenticflow/tracker/evidence/`
is RED in every receipt, on every ticket, forever — while the identical
command exits 0 in the primary checkout.

TASK-0062, receipt at HEAD `c5ca42f`, `agenticflow/tracker/receipts/TASK-0062.json`
(`green=false`, `isolation=worktree`, 8 of 10 checks exit 0):

```
[exit 1] test -s agenticflow/tracker/evidence/TASK-0062/warm-times.md
[exit 2] grep -q "PostgREST round trips" agenticflow/tracker/evidence/TASK-0062/warm-times.md
```

Same two commands run from `/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin`:
both exit 0. The file is present, 4459 bytes.

## Cause — three kit facts that are individually right and jointly fatal

1. `agenticflow/scripts/receipt.py:33-56` (`isolated_tree`) runs every check
   in a **detached worktree at HEAD**. Deliberate and correct: it is what
   stopped receipts going red on other lanes' scratch (kspace, 2026-08-28).
2. `agenticflow/tracker/evidence` is a tracked symlink to
   `agenticflow/visions/admin-window/tracker/evidence`, whose contents are
   **gitignored** — `.gitignore:64`, `agenticflow/visions/*/tracker/evidence/*`.
   Also deliberate: evidence is in-repo and gitignored by role instruction.
3. The sanctioned escape hatch for gitignored paths, `run.yaml`
   `receipt_link_paths`, is `.venv,node_modules,*/.venv,*/node_modules,.env`.
   The evidence dir is not in it.

So the artifact exists in the only checkout that has it and is absent from the
only checkout that grades it. **No product change can green such a check** —
a builder cannot put a gitignored file into HEAD — so the ticket is
uncloseable until the check text itself changes.

TASK-0062 is the first receipt in this campaign to grade an evidence path (I
read every `agenticflow/tracker/receipts/*.json`; no other has one), which is
why this has not surfaced before.

## Why it is worth a kit note rather than only a ticket fix

The architect added those two checks for a good reason and stated it in the
amendment: with the page-level bar re-homed to TASK-0074, the round-trip
census became "the load-bearing artifact this ticket hands forward, so its
presence is graded and not merely narrated". That intent — *grade that the
evidence was actually produced* — is legitimate and currently unserviceable.
`amend-checks` accepted the command without complaint, and the cost landed
two lanes later, on QA, at close time.

## Candidate remedies (the human's call; none applied here)

- Add `visions/*/tracker/evidence` (or `tracker/evidence`) to
  `receipt_link_paths`, so the receipt worktree sees the evidence dir the
  same way it sees `node_modules`. Smallest change; makes the whole
  evidence-presence check class work as authors already expect.
- Or have `amend-checks` refuse (or warn on) a check naming a path that is
  gitignored and not in `receipt_link_paths` — fail at authoring time,
  where LESSONS 12 says the cost belongs, instead of at close time.
- Or rule the class out explicitly and say so where architects will read it:
  a receipt grades the TREE, and evidence is not in the tree.

I applied none of these: `agenticflow/scripts/` and `run.yaml` are kit, and
amending a ticket's checks to green my own receipt would be grading my own
work.
