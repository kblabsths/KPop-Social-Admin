# Tracker index (regenerated 2026-09-04T06:38:01Z — do not edit)

## open
- DEBT-0004 [P3][debt][M1] /cycles and /sources carry their own presentation: 1,291- and 793-line pages, no components module, while every other page has one  (deps:DEBT-0003(unmet:1) scope:src/components/cycles,src/components/sources,src/app/cycles/page.tsx,src/app/sources/page.tsx,tests/offline/cycles/page.test.ts,tests/offline/sources/page.test.ts from:M1-endgame-structure-walk)
- DEBT-0005 [P3][debt][M1] The /cycles lead renders error_summary unclamped, so a long producer string can push the newest cycle back below the fold  (deps:BUG-0044,BUG-0045,BUG-0054,BUG-0055 scope:src/lib/format.ts,src/app/cycles/page.tsx,tests/offline/format.test.ts,tests/offline/cycles/page.test.ts from:BUG-0040)

## claimed
- DEBT-0003 [P3][debt][M1] Four byte-identical StateOf copies (and three WindowLines, one already drifted) stand in the pages instead of one ui primitive  (deps:BUG-0043,BUG-0044,BUG-0045,BUG-0046,BUG-0049,BUG-0054,BUG-0055,BUG-0057 scope:src/components/ui/state-of.tsx,src/components/ui/window-line.tsx,src/components/ui/index.ts,src/app/cycles/page.tsx,src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline/ui/primitives.test.ts,tests/offline/cycles/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/claims/page.test.ts,tests/offline/review-item/page.test.ts @builder-112 from:M1-endgame-structure-walk)

## qa
- BUG-0073 [P3][bug][M1] The record page h1 uppercases the table identifier: WALK_SANDBOX RECORD, GROUPS RECORD  (scope:src/app/records/[table]/[id]/page.tsx,src/components/ui/page.tsx,tests/offline/records/page.test.ts @builder-111 from:BUG-0049)

Totals — claimed:1, done:123, open:2, qa:1. Archived: 0.
