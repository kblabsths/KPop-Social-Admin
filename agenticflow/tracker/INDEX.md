# Tracker index (regenerated 2026-09-02T19:55:21Z — do not edit)

## open
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:1))
- FEAT-0008 [P1][feat][M1] The edit surface — the config map and pre-cutover direct edits  (deps:FEAT-0001,FEAT-0002(unmet:1))
- TASK-0032 [P1][task][M1] Live oracles must name the page's state kind: an ERROR page may not pass and an EMPTY page may not fail  (deps:BUG-0027(unmet:1) scope:tests/live,tests/offline/live-guard.test.ts,src/components/ui from:TASK-0012)

## claimed
- BUG-0034 [P2][bug][M1] events record page shows venue as a bare uuid with no way through: less than the Browse row the operator clicked  (scope:src/components/records,src/app/records,tests/offline/records @builder-62 from:TASK-0029)

## qa
- BUG-0027 [P3][bug][M1] An empty queue renders no open count: /queues drops the figure the Dashboard renders as a real 0  (scope:src/app/queues/page.tsx,src/components/queues,tests/offline/queues @builder-61 from:TASK-0010)

## blocked
- TASK-0031 [P1][task][M1] ASK BEN: pending_claims view times out on staging (handoff: index or view rewrite in the scraper repo)  (scope:agenticflow/docs/vision/ARCHITECTURE.md)

Totals — blocked:1, claimed:1, done:69, open:4, qa:1. Archived: 0.
