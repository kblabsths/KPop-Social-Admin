# Tracker index (regenerated 2026-09-09T19:56:39Z — do not edit)

## open
- DEBT-0009 [P2][debt][M2] The app's one uuid grammar (isRecordId/canonicalRecordId) is pure but lives in lib/db/records.ts, so no leaf may import it and /claims never got it  (deps:DEBT-0008(unmet:1) scope:src/lib/db/records.ts,src/lib/records/id.ts,src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/records/[table]/[id]/page.tsx,src/app/queues/[reviewItemId]/page.tsx,src/app/api/admin/review-items/[reviewItemId]/settle/route.ts,tests/offline/db/records.test.ts,tests/offline/claims/page.test.ts)
- DEBT-0010 [P2][debt][M2] Two exported narrowedTo with different meanings, and one isNarrowed whose two arities answer two different questions — the narrowing vocabulary has no owner  (deps:BUG-0141 scope:src/components/ui/window-line.tsx,src/components/ui/index.ts,src/lib/db/runs.ts,src/lib/review/queue-filters.ts,src/lib/claims/filters.ts,src/app/cycles/page.tsx,src/app/claims/page.tsx,tests/offline/ui/primitives.test.ts,tests/offline/runs/page.test.ts,tests/offline/queues/filters.test.ts)
- DEBT-0011 [P2][debt][patch] The mono identifier face is hand-spelled 44 times across 24 files with no shared primitive — the structural root of BUG-0112/0120/0121  (deps:BUG-0141,DEBT-0008(unmet:1) scope:src/components/ui/identifier.tsx,src/components/ui/index.ts,src/app,src/components,tests/offline/ui/primitives.test.ts,tests/offline/records/page.test.ts,tests/offline/review-item/page.test.ts)
- DEBT-0013 [P2][debt][patch] The entity picker manages no focus at all, and its hint promises an Escape that only works while focus is inside the panel  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts)
- DEBT-0012 [P3][debt][patch] readPopulation issues all three shape counts on every narrowed /queues URL, including the two the URL's own kind cannot render  (deps:BUG-0141 scope:src/lib/db/review-items.ts,tests/offline/review/review-items.test.ts)

## built
- BUG-0143 [P2][bug][M2] /cycles?cycle=<a real cycle id in any spelling but the database's> tells the operator the cycle is not in a window it is rendering  (scope:src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts @builder-211 from:BUG-0142)

## qa
- DEBT-0008 [P1][debt][M2] /sources and /claims decide the four states from the URL alone: BUG-0133's two-fact rule has one owner and two surfaces never got it  (deps:BUG-0141 scope:src/app/claims/page.tsx,src/app/sources/page.tsx,src/lib/claims/filters.ts,tests/offline/claims/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/absence/pages.test.ts @builder-210)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, built:1, done:97, open:5, qa:1, wont_fix:1. Archived: 124.
