# Tracker index (regenerated 2026-09-03T22:26:35Z — do not edit)

## open
- BUG-0041 [P2][bug][M1] Claims: the all-claims table is unwindowed (877 rows, 30,079px), so the pending-claims gauge moves with the data  (scope:src/app/claims/page.tsx,src/components/claims/claim-list.tsx,tests/offline/claims/page.test.ts from:M1-endgame-designer-walk)
- BUG-0042 [P2][bug][M1] Review item detail: the evidence table overflows the page instead of scrolling inside its own border  (scope:src/components/review/shape-views.tsx,src/components/ui/data-table.tsx,tests/offline/review-item/page.test.ts from:M1-endgame-designer-walk)
- BUG-0043 [P2][bug][M1] A source is labelled by raw uuid on the review item and on Claims, while the rest of the app names it  (scope:src/components/review/item-header.tsx,src/components/claims/claim-list.tsx,src/components/claims/filter-bar.tsx,src/app/claims/page.tsx,tests/offline/review-item/page.test.ts,tests/offline/claims/page.test.ts from:M1-endgame-designer-walk)
- BUG-0044 [P2][bug][M1] Cycles table: raw snake_case headers mixed with prose, and a cycle's id headed RUN_ID against the glossary  (scope:src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts from:M1-endgame-designer-walk)
- BUG-0045 [P2][bug][M1] Sources and Claims render an internal factory ticket id in product copy, and 'stuck_patterndial' has no space  (scope:src/app/sources/page.tsx,src/app/claims/page.tsx,tests/offline/sources/page.test.ts,tests/offline/claims/page.test.ts from:M1-endgame-designer-walk)
- BUG-0051 [P2][bug][-] STACK.md 5's production-like walk row is not runnable as documented: the step-1 prefix binds to 'npm run build' only, so 'npm run start' launches with no database and the wrong origin  (scope:agenticflow/docs/vision/STACK.md from:BUG-0039)
- BUG-0052 [P2][bug][M1] Record page: the unknown-id empty state sends the operator to Browse, which does not list groups or idols  (scope:src/app/records/[table]/[id]/page.tsx,tests/offline/records/page.test.ts from:M1-endgame-user-sim)
- BUG-0053 [P2][bug][M1] Event record page: a whole PROVENANCE column of dashes with no line saying what a dash means, while the pre-cutover page explains its own  (scope:src/app/records/[table]/[id]/page.tsx,src/components/records/record-fields.tsx,tests/offline/records/page.test.ts,tests/offline/records/provenance.test.ts from:M1-endgame-user-sim)
- TASK-0035 [P2][task][patch] The walk sandbox in the one map: an EDIT_CONFIG entry that renders not-provisioned wherever the table is absent  (deps:TASK-0034 scope:src/lib/edit/config.ts,src/lib/db/tables.ts,tests/offline/edit/config.test.ts,tests/offline/records/page.test.ts,tests/offline/absence,tests/live/residue.live.test.ts,tests/http/auth.http.test.ts from:inbox:2026-09-03-walker-sandbox-table.md)
- TASK-0036 [P2][task][patch] Reset the walk sandbox between walks: the seed fixture, the reset tool, and the walk recipe  (deps:TASK-0034 scope:tests/walk,tests/offline/walk,tsconfig.json,agenticflow/docs/vision/STACK.md from:inbox:2026-09-03-walker-sandbox-table.md)
- BUG-0046 [P3][bug][M1] Counts do not agree with their noun: '1 sources holding one', 'of 1 items read here', '1 sources, 2 domains'  (scope:src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/queues/page.tsx,src/lib/format.ts,tests/offline/format.test.ts from:M1-endgame-designer-walk)
- BUG-0047 [P3][bug][M1] Browse: 'Starts (UTC)' states the zone in the header and again in all 50 cells, wrapping every row  (scope:src/lib/format.ts,src/components/browse/browse-table.tsx,tests/offline/format.test.ts,tests/offline/browse/page.test.ts from:M1-endgame-designer-walk)
- BUG-0048 [P3][bug][M1] Browse: the poster cell is a 24x24 thumbnail that navigates out of the app to the CDN  (scope:src/components/browse/browse-table.tsx,tests/offline/browse/page.test.ts from:M1-endgame-designer-walk)
- BUG-0049 [P3][bug][M1] Micro labels uppercase machine identifiers: DATA_CONFLICT OPEN, ENTITY_LINK FOLDED, TICKETMASTER STUCK RECORDS  (scope:src/app/queues/page.tsx,src/app/sources/page.tsx,tests/offline/queues/page.test.ts,tests/offline/sources/page.test.ts from:M1-endgame-designer-walk)
- BUG-0050 [P3][bug][M1] Phone (390px): the fixed 192px sidebar takes half the viewport and the content column collapses  (scope:src/components/shell/shell.tsx,tests/offline/shell/shell.test.ts from:M1-endgame-designer-walk)

## built
- BUG-0039 [P2][bug][-] STACK.md 5's walk launch line is not runnable from a fresh shell: the staging names it maps are unset there, so the walk instance has no database  (scope:agenticflow/docs/vision/STACK.md @builder-70 from:BUG-0038)

## qa
- BUG-0040 [P2][bug][M1] Cycles & runs: the newest adapter run sits 4,419px below the fold (Feel bar 1)  (scope:src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts @builder-71 from:M1-endgame-designer-walk)

Totals — built:1, done:83, open:15, qa:1. Archived: 0.
