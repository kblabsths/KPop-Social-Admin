# Tracker index (regenerated 2026-09-02T21:38:02Z — do not edit)

## open
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:1))
- DEBT-0001 [P3][debt][M1] Two spellings of /records/<domain>/<id>: fold provenanceHref and eventRecordHref into one leaf helper  (scope:src/lib/records/routes.ts,src/lib/claims/filters.ts,src/lib/browse/rows.ts,src/components/records/fields.ts,src/components/browse/browse-table.tsx,src/app/claims/page.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline,tests/live/browse.live.test.ts from:BUG-0034)

## built
- TASK-0032 [P1][task][M1] Live oracles must name the page's state kind: an ERROR page may not pass and an EMPTY page may not fail  (deps:BUG-0027 scope:tests/live,tests/offline/live-guard.test.ts,src/components/ui @builder-65 from:TASK-0012)

## qa
- BUG-0035 [P2][bug][M1] The state classifier grades a surface green while it carries an ERROR card the classifier did not account for  (scope:tests/live/parity.ts,tests/offline/live-guard.test.ts @builder-64 from:TASK-0032)

## blocked
- TASK-0031 [P1][task][M1] ASK BEN: pending_claims view times out on staging (handoff: index or view rewrite in the scraper repo)  (scope:agenticflow/docs/vision/ARCHITECTURE.md)

Totals — blocked:1, built:1, done:72, open:3, qa:1. Archived: 0.
