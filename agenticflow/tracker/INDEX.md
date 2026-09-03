# Tracker index (regenerated 2026-09-03T23:04:59Z — do not edit)

## open
- BUG-0061 [P1][bug][M1] Claims: BUG-0041's 50-row window broke the page's live parity oracle (claims.live is red on the run branch)  (scope:tests/live/claims.live.test.ts,src/components/claims/claim-list.tsx from:BUG-0056)
- BUG-0042 [P2][bug][M1] Review item detail: the evidence table overflows the page instead of scrolling inside its own border  (scope:src/components/review/shape-views.tsx,src/components/ui/data-table.tsx,tests/offline/review-item/page.test.ts from:M1-endgame-designer-walk)
- BUG-0043 [P2][bug][M1] A source is labelled by raw uuid on the review item and on Claims, while the rest of the app names it  (scope:src/components/review/item-header.tsx,src/components/claims/claim-list.tsx,src/components/claims/filter-bar.tsx,src/app/claims/page.tsx,tests/offline/review-item/page.test.ts,tests/offline/claims/page.test.ts from:M1-endgame-designer-walk)
- BUG-0044 [P2][bug][M1] Cycles table: raw snake_case headers mixed with prose, and a cycle's id headed RUN_ID against the glossary  (scope:src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts from:M1-endgame-designer-walk)
- BUG-0045 [P2][bug][M1] Sources and Claims render an internal factory ticket id in product copy, and 'stuck_patterndial' has no space  (scope:src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/cycles/page.tsx,tests/offline/sources/page.test.ts,tests/offline/claims/page.test.ts,tests/offline/cycles/page.test.ts from:M1-endgame-designer-walk)
- BUG-0052 [P2][bug][M1] Record page: the unknown-id empty state sends the operator to Browse, which does not list groups or idols  (scope:src/app/records/[table]/[id]/page.tsx,tests/offline/records/page.test.ts from:M1-endgame-user-sim)
- BUG-0053 [P2][bug][M1] Event record page: a whole PROVENANCE column of dashes with no line saying what a dash means, while the pre-cutover page explains its own  (scope:src/app/records/[table]/[id]/page.tsx,src/components/records/record-fields.tsx,tests/offline/records/page.test.ts,tests/offline/records/provenance.test.ts from:M1-endgame-user-sim)
- BUG-0054 [P2][bug][M1] Cycles & runs: 'Cycle <id> is marked in the table below' — the row carries only aria-current and is visually identical to all 68 others  (scope:src/app/cycles/page.tsx,src/components/ui/data-table.tsx,tests/offline/cycles/page.test.ts from:M1-endgame-user-sim)
- BUG-0059 [P2][bug][M1] Not-provisioned card jams the missing object's name into the sentence: 'eventsisn't in this database yet'  (scope:src/components/ui/not-provisioned.tsx,tests/offline/absence/pages.test.ts from:M1-endgame-verifier)
- BUG-0060 [P2][bug][M1] Edit cell shows no way to save: no control, no hint, Enter is undocumented, and blur silently discards what was typed  (scope:src/components/records/field-editor.tsx,src/app/records/[table]/[id]/page.tsx,tests/offline/records/page.test.ts,tests/offline/records/submit.test.ts from:M1-endgame-verifier)
- DEBT-0002 [P2][debt][M1] Five live parity oracles still address their surfaces by POSITION (section:nth-of-type) — the class BUG-0056 fixed on one page only  (scope:tests/live/dashboard.live.test.ts,tests/live/sources.live.test.ts,tests/live/claims.live.test.ts,tests/live/browse.live.test.ts,tests/live/review-item.live.test.ts,src/app/page.tsx,src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/browse/page.tsx,src/app/queues/[reviewItemId]/page.tsx from:BUG-0056)
- TASK-0035 [P2][task][patch] The walk sandbox in the one map: an EDIT_CONFIG entry that renders not-provisioned wherever the table is absent  (deps:TASK-0034 scope:src/lib/edit/config.ts,src/lib/db/tables.ts,tests/offline/edit/config.test.ts,tests/offline/records/page.test.ts,tests/offline/absence,tests/live/residue.live.test.ts,tests/http/auth.http.test.ts from:inbox:2026-09-03-walker-sandbox-table.md)
- TASK-0036 [P2][task][patch] Reset the walk sandbox between walks: the seed fixture, the reset tool, and the walk recipe  (deps:TASK-0034 scope:tests/walk,tests/offline/walk,tsconfig.json,agenticflow/docs/vision/STACK.md from:inbox:2026-09-03-walker-sandbox-table.md)
- BUG-0046 [P3][bug][M1] Counts do not agree with their noun: '1 sources holding one', 'of 1 items read here', '1 sources, 2 domains'  (scope:src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/queues/page.tsx,src/lib/format.ts,tests/offline/format.test.ts from:M1-endgame-designer-walk)
- BUG-0047 [P3][bug][M1] Browse: 'Starts (UTC)' states the zone in the header and again in all 50 cells, wrapping every row  (scope:src/lib/format.ts,src/components/browse/browse-table.tsx,tests/offline/format.test.ts,tests/offline/browse/page.test.ts from:M1-endgame-designer-walk)
- BUG-0048 [P3][bug][M1] Browse: the poster cell is a 24x24 thumbnail that navigates out of the app to the CDN  (scope:src/components/browse/browse-table.tsx,tests/offline/browse/page.test.ts from:M1-endgame-designer-walk)
- BUG-0049 [P3][bug][M1] Micro labels uppercase machine identifiers: DATA_CONFLICT OPEN, ENTITY_LINK FOLDED, TICKETMASTER STUCK RECORDS  (scope:src/app/queues/page.tsx,src/app/sources/page.tsx,tests/offline/queues/page.test.ts,tests/offline/sources/page.test.ts from:M1-endgame-designer-walk)
- BUG-0050 [P3][bug][M1] Phone (390px): the fixed 192px sidebar takes half the viewport and the content column collapses  (scope:src/components/shell/shell.tsx,tests/offline/shell/shell.test.ts from:M1-endgame-designer-walk)
- BUG-0055 [P3][bug][M1] Cycles & runs names one state two ways on one screen: the rows say 'died', the health panel says 'unfinished'  (scope:src/app/cycles/page.tsx,src/lib/gauges/cycle-health.ts,tests/offline/cycles/page.test.ts,tests/offline/gauges/cycle-health.test.ts from:M1-endgame-user-sim)

## claimed
- BUG-0058 [P1][bug][M1] The staging residue sweep never runs: it ilikes a timestamp column and throws, so no walk's write was ever verified clean  (scope:tests/live/residue.live.test.ts @builder-76 from:qa:BUG-0041)

## qa
- BUG-0057 [P1][bug][M1] Claims: BUG-0041's 50-row window leaves the page's live parity oracle red — it still asserts every claim of the view is rendered  (scope:tests/live/claims.live.test.ts,src/app/claims/page.tsx @builder-75 from:BUG-0041)

## reopened
- BUG-0041 [P2][bug][M1] Claims: the all-claims table is unwindowed (877 rows, 30,079px), so the pending-claims gauge moves with the data  (scope:src/app/claims/page.tsx,src/components/claims/claim-list.tsx,tests/offline/claims/page.test.ts from:M1-endgame-designer-walk)

Totals — claimed:1, done:87, open:19, qa:1, reopened:1. Archived: 0.
