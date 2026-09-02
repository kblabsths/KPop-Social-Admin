# Tracker index (regenerated 2026-09-02T19:32:37Z — do not edit)

## open
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:1))
- FEAT-0008 [P1][feat][M1] The edit surface — the config map and pre-cutover direct edits  (deps:FEAT-0001,FEAT-0002(unmet:1))
- TASK-0032 [P1][task][M1] Live oracles must name the page's state kind: an ERROR page may not pass and an EMPTY page may not fail  (deps:BUG-0027(unmet:1) scope:tests/live,tests/offline/live-guard.test.ts,src/components/ui from:TASK-0012)
- BUG-0027 [P3][bug][M1] An empty queue renders no open count: /queues drops the figure the Dashboard renders as a real 0  (scope:src/app/queues/page.tsx,src/components/queues,tests/offline/queues from:TASK-0010)

## claimed
- TASK-0029 [P2][task][M1] ASK: what does a resolver-owned record page DISPLAY in M1? events/venues currently render their id and nothing else  (deps:BUG-0028 scope:src/lib/edit/config.ts,src/lib/db/records.ts,src/app/records,src/components/records,tests/offline/records,tests/offline/edit @builder-60 from:TASK-0018)

## blocked
- TASK-0031 [P1][task][M1] ASK BEN: pending_claims view times out on staging (handoff: index or view rewrite in the scraper repo)  (scope:agenticflow/docs/vision/ARCHITECTURE.md)

Totals — blocked:1, claimed:1, done:68, open:5. Archived: 0.
