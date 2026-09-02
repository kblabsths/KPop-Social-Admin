# Tracker index (regenerated 2026-09-02T21:16:24Z — do not edit)

## open
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:1))
- BUG-0035 [P2][bug][-] The state classifier grades a surface green while it carries an ERROR card the classifier did not account for  (scope:tests/live/parity.ts,tests/offline/live-guard.test.ts from:TASK-0032)

## blocked
- TASK-0031 [P1][task][M1] ASK BEN: pending_claims view times out on staging (handoff: index or view rewrite in the scraper repo)  (scope:agenticflow/docs/vision/ARCHITECTURE.md)
- TASK-0032 [P1][task][M1] Live oracles must name the page's state kind: an ERROR page may not pass and an EMPTY page may not fail  (deps:BUG-0027 scope:tests/live,tests/offline/live-guard.test.ts,src/components/ui from:TASK-0012)

Totals — blocked:2, done:72, open:3. Archived: 0.
