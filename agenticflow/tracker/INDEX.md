# Tracker index (regenerated 2026-09-09T11:38:02Z — do not edit)

## open
- BUG-0112 [P3][bug][M2] The record page's regime note sets its table name in sans — three table names on one screen, two in mono and the one in the prose not  (scope:src/components/records/record-fields.tsx,tests/offline/records/page.test.ts from:designer:endgame-walk)
- BUG-0117 [P3][bug][M2] The review header's out-links draw half their own words in secondary ink, and three files retype the app's one link spelling instead of importing it  (deps:BUG-0115 scope:src/components/review/item-header.tsx,src/components/review/close/slot.tsx,src/app/not-found.tsx,tests/offline/ui/link-spelling.test.ts,tests/offline/review-item/page.test.ts from:BUG-0113)

## claimed
- BUG-0111 [P3][bug][M2] The entity picker's saved confirmation never retires — the 1.5s clock lives in EditableCell alone, and the picker renders the same status without one  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts @builder-184 from:designer:endgame-walk)

## qa
- BUG-0110 [P3][bug][M2] '0 ran longer than the 15m cadence' stands bare beside four cycles that never finished — the Zeroes bar, on the card the doc quotes  (scope:src/components/cycles/cycle-health.tsx,tests/offline/cycles/page.test.ts @builder-180 from:designer:endgame-walk)

## blocked
- BUG-0116 [P3][bug][M2] The over-cadence line says 'never finished' of a cycle the same page renders as still running  (scope:src/components/cycles/cycle-health.tsx,src/lib/gauges/cycle-health.ts,tests/offline/cycles/page.test.ts from:BUG-0110)

Totals — blocked:1, claimed:1, done:69, open:2, qa:1, wont_fix:1. Archived: 124.
