# Tracker index (regenerated 2026-09-03T22:03:28Z — do not edit)

## open
- BUG-0040 [P2][bug][M1] Cycles & runs: the newest adapter run sits 4,419px below the fold (Feel bar 1)  (scope:src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts from:M1-endgame-designer-walk)
- BUG-0041 [P2][bug][M1] Claims: the all-claims table is unwindowed (877 rows, 30,079px), so the pending-claims gauge moves with the data  (scope:src/app/claims/page.tsx,src/components/claims/claim-list.tsx,tests/offline/claims/page.test.ts from:M1-endgame-designer-walk)
- BUG-0042 [P2][bug][M1] Review item detail: the evidence table overflows the page instead of scrolling inside its own border  (scope:src/components/review/shape-views.tsx,src/components/ui/data-table.tsx,tests/offline/review-item/page.test.ts from:M1-endgame-designer-walk)
- BUG-0043 [P2][bug][M1] A source is labelled by raw uuid on the review item and on Claims, while the rest of the app names it  (scope:src/components/review/item-header.tsx,src/components/claims/claim-list.tsx,src/components/claims/filter-bar.tsx,src/app/claims/page.tsx,tests/offline/review-item/page.test.ts,tests/offline/claims/page.test.ts from:M1-endgame-designer-walk)
- TASK-0035 [P2][task][patch] The walk sandbox in the one map: an EDIT_CONFIG entry that renders not-provisioned wherever the table is absent  (deps:TASK-0034 scope:src/lib/edit/config.ts,src/lib/db/tables.ts,tests/offline/edit/config.test.ts,tests/offline/records/page.test.ts,tests/offline/absence,tests/live/residue.live.test.ts,tests/http/auth.http.test.ts from:inbox:2026-09-03-walker-sandbox-table.md)
- TASK-0036 [P2][task][patch] Reset the walk sandbox between walks: the seed fixture, the reset tool, and the walk recipe  (deps:TASK-0034 scope:tests/walk,tests/offline/walk,tsconfig.json,agenticflow/docs/vision/STACK.md from:inbox:2026-09-03-walker-sandbox-table.md)

## built
- BUG-0039 [P2][bug][-] STACK.md 5's walk launch line is not runnable from a fresh shell: the staging names it maps are unset there, so the walk instance has no database  (scope:agenticflow/docs/vision/STACK.md @builder-70 from:BUG-0038)

Totals — built:1, done:83, open:6. Archived: 0.
