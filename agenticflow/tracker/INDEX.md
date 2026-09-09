# Tracker index (regenerated 2026-09-09T10:24:29Z — do not edit)

## open
- BUG-0114 [P2][bug][M2] A ?source=-narrowed runs window states the facet's oldest run as the whole table's floor: '/cycles?source=X' says 'nothing earlier is retained' about runs it never read  (scope:src/components/ui/window-line.tsx,src/components/cycles/adapter-runs.tsx,src/app/cycles/page.tsx,tests/offline/runs/page.test.ts,tests/offline/ui/primitives.test.ts from:BUG-0109)
- BUG-0111 [P3][bug][M2] The entity picker's saved confirmation never retires — the 1.5s clock lives in EditableCell alone, and the picker renders the same status without one  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts from:designer:endgame-walk)
- BUG-0112 [P3][bug][M2] The record page's regime note sets its table name in sans — three table names on one screen, two in mono and the one in the prose not  (scope:src/components/records/record-fields.tsx,tests/offline/records/page.test.ts from:designer:endgame-walk)

## built
- BUG-0110 [P3][bug][M2] '0 ran longer than the 15m cadence' stands bare beside four cycles that never finished — the Zeroes bar, on the card the doc quotes  (scope:src/components/cycles/cycle-health.tsx,tests/offline/cycles/page.test.ts @builder-180 from:designer:endgame-walk)

## qa
- BUG-0113 [P2][bug][M2] The five bucket links on /claims are drawn as links only in the DOM: the Badge inside re-inks the words and hides the underline, so the rendered pixels are unchanged  (scope:src/components/claims/bucket-table.tsx,tests/offline/claims/page.test.ts,tests/fixtures/link-spelling.ts @builder-179 from:BUG-0108)

## reopened
- BUG-0109 [P2][bug][M2] Bar 13's other half is unbuilt: no windowed list says whether it filled, so five adapter runs that are the whole history read like the top of a long one  (scope:src/components/ui/window-line.tsx,src/app/page.tsx,src/components/cycles/adapter-runs.tsx,src/components/browse/browse-table.tsx,tests/offline/ui/primitives.test.ts,tests/offline/cycles/page.test.ts,tests/offline/browse/page.test.ts,tests/offline/dashboard/page.test.ts from:designer:endgame-walk)

Totals — built:1, done:64, open:3, qa:1, reopened:1, wont_fix:1. Archived: 124.
