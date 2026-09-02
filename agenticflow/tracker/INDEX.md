# Tracker index (regenerated 2026-09-02T17:15:42Z — do not edit)

## open
- FEAT-0001 [P1][feat][M1] Remove the deprecated app and stand up the window shell
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0008 [P1][feat][M1] The edit surface — the config map and pre-cutover direct edits  (deps:FEAT-0001,FEAT-0002(unmet:2))
- TASK-0032 [P1][task][M1] Live oracles must name the page's state kind: an ERROR page may not pass and an EMPTY page may not fail  (deps:BUG-0027(unmet:1) scope:tests/live,tests/offline/live-guard.test.ts,src/components/ui from:TASK-0012)
- BUG-0030 [P2][bug][-] The admin_locked write guard's balanced-argument scan is not string-aware: it reports a READ as a write, and misses a real WRITE  (scope:tests/offline/edit from:BUG-0028)
- TASK-0016 [P2][task][M1] Cycles & runs — the adapter framework's runs half  (deps:TASK-0014 scope:src/app/cycles/page.tsx,src/lib/db/runs.ts,tests/offline/runs,tests/live/runs.live.test.ts)
- TASK-0020 [P2][task][M1] Compile docs/build_judgments.md for the milestone-close review  (deps:TASK-0019 scope:docs/build_judgments.md)
- TASK-0029 [P2][task][M1] ASK: what does a resolver-owned record page DISPLAY in M1? events/venues currently render their id and nothing else  (deps:BUG-0028 scope:src/lib/edit/config.ts,src/lib/db/records.ts,src/app/records,src/components/records,tests/offline/records,tests/offline/edit from:TASK-0018)
- BUG-0027 [P3][bug][M1] An empty queue renders no open count: /queues drops the figure the Dashboard renders as a real 0  (scope:src/app/queues/page.tsx,src/components/queues,tests/offline/queues from:TASK-0010)

## claimed
- BUG-0029 [P2][bug][M1] The offline suite is flaky in a fresh worktree: its slowest test sits 6% under vitest's 5s default, so receipts go red at random  (scope:vitest.config.mts,tests/offline/claims/page.test.ts,tests/offline/toolchain.test.ts @builder-53 from:BUG-0024)

## blocked
- TASK-0031 [P1][task][M1] ASK BEN: pending_claims view times out on staging (handoff: index or view rewrite in the scraper repo)  (scope:agenticflow/docs/vision/ARCHITECTURE.md)

Totals — blocked:1, claimed:1, done:60, open:10. Archived: 0.
