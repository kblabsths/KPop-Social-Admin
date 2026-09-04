# Tracker index (regenerated 2026-09-04T07:39:05Z — do not edit)

## open
- DEBT-0004 [P3][debt][M1] /cycles and /sources carry their own presentation: 1,291- and 793-line pages, no components module, while every other page has one  (deps:DEBT-0003(unmet:1) scope:src/components/cycles,src/components/sources,src/app/cycles/page.tsx,src/app/sources/page.tsx,tests/offline/cycles/page.test.ts,tests/offline/sources/page.test.ts from:M1-endgame-structure-walk)
- DEBT-0006 [P3][debt][M1] The other half of the fold: six window sentences and four refusal renderings still stand hand-rolled outside the two ui primitives  (scope:src/app/page.tsx,src/app/queues/page.tsx,src/app/browse/page.tsx,src/app/records/[table]/[id]/page.tsx,src/app/claims/page.tsx,src/app/cycles/page.tsx,src/components/review/shape-views.tsx,src/components/ui/window-line.tsx,src/components/ui/state-of.tsx,tests/offline/absence/pages.test.ts from:qa:DEBT-0003)

## built
- BUG-0077 [P2][bug][M1] /claims and /sources describe the SAME pending-claims window with two different objects — 'not the whole view' vs 'not the whole table'  (scope:src/app/claims/page.tsx,src/components/ui/window-line.tsx,tests/offline/absence/pages.test.ts @builder-114 from:DEBT-0003)

## reopened
- DEBT-0003 [P3][debt][M1] Four byte-identical StateOf copies (and three WindowLines, one already drifted) stand in the pages instead of one ui primitive  (deps:BUG-0043,BUG-0044,BUG-0045,BUG-0046,BUG-0049,BUG-0054,BUG-0055,BUG-0057 scope:src/components/ui/state-of.tsx,src/components/ui/window-line.tsx,src/components/ui/index.ts,src/app/cycles/page.tsx,src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline/ui/primitives.test.ts,tests/offline/cycles/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/claims/page.test.ts,tests/offline/review-item/page.test.ts from:M1-endgame-structure-walk)

Totals — built:1, done:125, open:2, reopened:1. Archived: 0.
