# Tracker index (regenerated 2026-09-04T05:58:09Z — do not edit)

## open
- BUG-0070 [P3][bug][M1] /claims drops its window line on a read that happened and found nothing, where every other windowed surface keeps it  (scope:src/app/claims/page.tsx,tests/offline/claims/page.test.ts,tests/offline/absence/pages.test.ts,tests/live/claims.live.test.ts from:BUG-0067)
- BUG-0073 [P3][bug][M1] The record page h1 uppercases the table identifier: WALK_SANDBOX RECORD, GROUPS RECORD  (scope:src/app/records/[table]/[id]/page.tsx,src/components/ui/page.tsx,tests/offline/records/page.test.ts from:BUG-0049)
- DEBT-0003 [P3][debt][M1] Four byte-identical StateOf copies (and three WindowLines, one already drifted) stand in the pages instead of one ui primitive  (deps:BUG-0043,BUG-0044,BUG-0045,BUG-0046,BUG-0049,BUG-0054,BUG-0055,BUG-0057 scope:src/components/ui/state-of.tsx,src/components/ui/window-line.tsx,src/components/ui/index.ts,src/app/cycles/page.tsx,src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline/ui/primitives.test.ts,tests/offline/cycles/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/claims/page.test.ts,tests/offline/review-item/page.test.ts from:M1-endgame-structure-walk)
- DEBT-0004 [P3][debt][M1] /cycles and /sources carry their own presentation: 1,291- and 793-line pages, no components module, while every other page has one  (deps:DEBT-0003(unmet:1) scope:src/components/cycles,src/components/sources,src/app/cycles/page.tsx,src/app/sources/page.tsx,tests/offline/cycles/page.test.ts,tests/offline/sources/page.test.ts from:M1-endgame-structure-walk)
- DEBT-0005 [P3][debt][M1] The /cycles lead renders error_summary unclamped, so a long producer string can push the newest cycle back below the fold  (deps:BUG-0044,BUG-0045,BUG-0054,BUG-0055 scope:src/lib/format.ts,src/app/cycles/page.tsx,tests/offline/format.test.ts,tests/offline/cycles/page.test.ts from:BUG-0040)

## claimed
- BUG-0076 [P2][bug][M1] Queues item page: an address that is not a review-item id is reported as a failed database read, not as no such item  (scope:src/app/queues/[reviewItemId]/page.tsx,tests/offline/review-item/page.test.ts @builder-109 from:BUG-0068)

## built
- BUG-0069 [P3][bug][M1] Edit cell: an edit that ends drops keyboard focus to <body> and never gets it back, so the operator's next Tab restarts at the top of the document  (deps:BUG-0066 scope:src/components/EditableCell.tsx,tests/offline/ui/editable-cell.test.ts @builder-108 from:BUG-0060)

Totals — built:1, claimed:1, done:120, open:5. Archived: 0.
