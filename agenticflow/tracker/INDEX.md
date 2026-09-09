# Tracker index (regenerated 2026-09-09T08:39:19Z — do not edit)

## open
- BUG-0107 [P2][bug][M2] A refused inline save outlives its edit — Escape, blur and a later successful save all leave the red line standing, and two of them stack over the values beneath  (scope:src/components/EditableCell.tsx,src/components/edit-cell-layout.ts,tests/offline/ui/editable-cell.test.ts,tests/offline/records/page.test.ts from:designer:endgame-walk)
- BUG-0108 [P2][bug][M2] The rest of BUG-0099's sweep: 132 links on Dashboard, Claims, Sources, Browse and the verdict log still announce themselves only under the pointer  (scope:src/app/page.tsx,src/app/claims/page.tsx,src/components/browse/browse-table.tsx,src/components/claims/bucket-table.tsx,src/components/claims/claim-list.tsx,src/components/sources/registry-table.tsx,src/components/sources/trends.tsx,src/components/queues/verdict-log.tsx,tests/offline/browse/page.test.ts,tests/offline/claims/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/dashboard/page.test.ts from:designer:endgame-walk)
- BUG-0109 [P2][bug][M2] Bar 13's other half is unbuilt: no windowed list says whether it filled, so five adapter runs that are the whole history read like the top of a long one  (scope:src/components/ui/window-line.tsx,src/app/page.tsx,src/components/cycles/adapter-runs.tsx,src/components/browse/browse-table.tsx,tests/offline/ui/primitives.test.ts,tests/offline/cycles/page.test.ts,tests/offline/browse/page.test.ts,tests/offline/dashboard/page.test.ts from:designer:endgame-walk)
- BUG-0110 [P3][bug][M2] '0 ran longer than the 15m cadence' stands bare beside four cycles that never finished — the Zeroes bar, on the card the doc quotes  (scope:src/components/cycles/cycle-health.tsx,tests/offline/cycles/page.test.ts from:designer:endgame-walk)
- BUG-0111 [P3][bug][M2] The entity picker's saved confirmation never retires — the 1.5s clock lives in EditableCell alone, and the picker renders the same status without one  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts from:designer:endgame-walk)
- BUG-0112 [P3][bug][M2] The record page's regime note sets its table name in sans — three table names on one screen, two in mono and the one in the prose not  (scope:src/components/records/record-fields.tsx,tests/offline/records/page.test.ts from:designer:endgame-walk)

## built
- BUG-0106 [P2][bug][M2] Seventeen cycles report errors and still say succeeded in healthy green — the palette bar TASK-0038 wrote and nothing built  (scope:src/components/cycles/outcome.tsx,src/app/page.tsx,tests/offline/cycles/page.test.ts,tests/offline/dashboard/page.test.ts @builder-174 from:designer:endgame-walk)

Totals — built:1, done:61, open:6, wont_fix:1. Archived: 124.
