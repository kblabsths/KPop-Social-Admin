# Tracker index (regenerated 2026-09-02T21:53:39Z — do not edit)

## open
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:1))

## built
- BUG-0036 [P2][bug][M1] stateOf's excluding filter drops a surface's OWN error card, grading an ERROR surface as ok  (scope:tests/live/parity.ts,tests/offline/live-guard.test.ts @builder-67 from:BUG-0035)

## qa
- DEBT-0001 [P3][debt][M1] Two spellings of /records/<domain>/<id>: fold provenanceHref and eventRecordHref into one leaf helper  (scope:src/lib/records/routes.ts,src/lib/claims/filters.ts,src/lib/browse/rows.ts,src/components/records/fields.ts,src/components/browse/browse-table.tsx,src/app/claims/page.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline,tests/live/browse.live.test.ts @builder-66 from:BUG-0034)

## blocked
- TASK-0031 [P1][task][M1] ASK BEN: pending_claims view times out on staging (handoff: index or view rewrite in the scraper repo)  (scope:agenticflow/docs/vision/ARCHITECTURE.md)

Totals — blocked:1, built:1, done:74, open:2, qa:1. Archived: 0.
