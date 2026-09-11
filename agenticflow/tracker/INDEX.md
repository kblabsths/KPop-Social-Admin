# Tracker index (regenerated 2026-09-11T23:55:11Z — do not edit)

## open
- BUG-0213 [P2][bug][-] The attribution corpus carries a 2-line paste block, so the sibling allocating ITS next code reddens the offline suite  (scope:tests/offline/handoff/settle-review-item.test.ts from:BUG-0207)
- BUG-0217 [P2][bug][patch] LOOK_AND_FEEL bar 14's own record grades /browse by the superseded proposal's metric, so a surface that fails Ben's rule reads as passing  (scope:agenticflow/docs/vision/LOOK_AND_FEEL.md from:TASK-0079)
- BUG-0211 [P3][bug][M3] The paging control stays drawn and enabled after a page answers not_provisioned — the one arm whose text offers no press  (scope:src/lib/paging/machine.ts,src/components/ui/paging.tsx,tests/offline/paging/machine.test.ts,tests/offline/ui/paging.test.ts)
- DEBT-0021 [P3][debt][M3] The error arm's `authored` field is optional, so the only guard on it is a regex inside a closed ticket's checks  (scope:src/lib/db/result.ts,src/lib/db,tests/offline/db/result.test.ts from:BUG-0200)
- DEBT-0022 [P3][debt][M3] Three truth residuals on one class: a comment naming a defect that is fixed, a second spelling of 'unnamed source', and a count of 1 that reads as a plural  (scope:src/components/ui/window-line.tsx,src/lib/gauges/standing-disagreements.ts,src/app/queues/page.tsx,tests/offline/gauges/standing-disagreements.test.ts,tests/offline/ui/primitives.test.ts,tests/offline/claims/page.test.ts,tests/offline/queues/page.test.ts from:BUG-0204)

## claimed
- BUG-0216 [P1][bug][patch] Paging /claims repeated a claim id at offset 50 on Ben's instance — a shipped surface can duplicate and silently omit rows  (scope:src/lib/db/claims.ts,src/lib/db/paging.ts,src/lib/paging/machine.ts,src/app/api/admin/claims/rows/route.ts,src/components/claims/paged-claim-list.tsx,tests/live/claims.live.test.ts,tests/offline/paging/machine.test.ts,tests/offline/claims/page.test.ts @builder-316 from:inbox:2026-09-11-ben-paging-rulings.md)

## qa
- BUG-0215 [P1][bug][M3] Live tier red on the settled tree: two edit.live tests assume the §9 settlement path is absent from staging, and one now writes an unswept override into the catalog  (scope:tests/live @builder-315 from:BUG-0209)

Totals — claimed:1, done:77, open:5, qa:1. Archived: 252.
