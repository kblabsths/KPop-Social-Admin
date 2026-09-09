# Tracker index (regenerated 2026-09-09T09:34:19Z — do not edit)

## open
- BUG-0109 [P2][bug][M2] Bar 13's other half is unbuilt: no windowed list says whether it filled, so five adapter runs that are the whole history read like the top of a long one  (scope:src/components/ui/window-line.tsx,src/app/page.tsx,src/components/cycles/adapter-runs.tsx,src/components/browse/browse-table.tsx,tests/offline/ui/primitives.test.ts,tests/offline/cycles/page.test.ts,tests/offline/browse/page.test.ts,tests/offline/dashboard/page.test.ts from:designer:endgame-walk)
- BUG-0113 [P2][bug][M2] The five bucket links on /claims are drawn as links only in the DOM: the Badge inside re-inks the words and hides the underline, so the rendered pixels are unchanged  (scope:src/components/claims/bucket-table.tsx,tests/offline/claims/page.test.ts,tests/fixtures/link-spelling.ts from:BUG-0108)
- BUG-0110 [P3][bug][M2] '0 ran longer than the 15m cadence' stands bare beside four cycles that never finished — the Zeroes bar, on the card the doc quotes  (scope:src/components/cycles/cycle-health.tsx,tests/offline/cycles/page.test.ts from:designer:endgame-walk)
- BUG-0111 [P3][bug][M2] The entity picker's saved confirmation never retires — the 1.5s clock lives in EditableCell alone, and the picker renders the same status without one  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts from:designer:endgame-walk)
- BUG-0112 [P3][bug][M2] The record page's regime note sets its table name in sans — three table names on one screen, two in mono and the one in the prose not  (scope:src/components/records/record-fields.tsx,tests/offline/records/page.test.ts from:designer:endgame-walk)

## claimed
- BUG-0107 [P2][bug][M2] A refused inline save outlives its edit — Escape, blur and a later successful save all leave the red line standing, and two of them stack over the values beneath  (scope:src/components/EditableCell.tsx,src/components/edit-cell-layout.ts,tests/offline/ui/editable-cell.test.ts,tests/offline/records/page.test.ts @builder-177 from:designer:endgame-walk)

Totals — claimed:1, done:63, open:5, wont_fix:1. Archived: 124.
