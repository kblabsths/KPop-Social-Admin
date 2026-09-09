# Two lanes running `npm test` in the SHARED checkout redden the suite for both

Measured 2026-09-08 by qa-BUG-0079 on `run/admin-window` (a4eb474 + 9923c2f).
Not blocking: I got a clean measurement in a private worktree and closed my
ticket on a green receipt. Filing it because the same collision can make the
run's own `ci_check` go red on a tree that is green.

**Expected:** `./node_modules/.bin/vitest run --project=offline` on the landed
tree passes (59 files, 2122 tests — measured green in a private detached
worktree of 9923c2f at 18:56).

**Found:** the same command in the shared checkout at 18:51 and 18:52 failed
`tests/offline/db/layering.test.ts` — 2 failures in the first run, 4 in the
second, different sets each time:

    × credentials > mentions no staging name anywhere under src
      AssertionError: expected [ Array(1) ] to deeply equal []
    × credentials > reads the service-role key in the db client alone
      AssertionError: expected [ …(2) ] to deeply equal [ 'src/lib/db/client.ts' ]
    × table names and the client library > spells a table name in tables.ts alone

**Cause (measured, not inferred):** `ps` showed two other lanes' runs live in
this same directory —

    35463  02:17  sh -c vitest run --project=offline && vitest run --project=isolated
    35805  01:55  sh -c vitest run --project=offline && vitest run --project=isolated

— and `src/.probes/__credential_guard_probe__.ts` was present on disk mid-run
(gone afterwards). That file is planted and removed by
`tests/offline/db/layering.test.ts:217` and by `tests/isolated/`, and the
scanner it is planted for walks the whole tree on purpose:
`allSourceFiles()` "skips nothing" (`layering.test.ts:213-214`). The
single-run version of this race is already handled — one fork for the
`isolated` project, and `npm test` runs offline and isolated as separate
sequential invocations (`vitest.config.mts`, BUG-0032). Nothing bounds it
ACROSS processes, so any two lanes testing in the shared checkout at the same
time can see each other's probe.

**What the kit could do** (architect/human's call, not mine): serialise
suite runs in the shared checkout behind a lock the way `emu_lease.py`
serialises the emulator, or have lanes that need a whole-suite number run it
in a private worktree the way `receipt.py` already does.
