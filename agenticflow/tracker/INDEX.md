# Tracker index (regenerated 2026-09-10T17:32:27Z — do not edit)

## built
- DEBT-0015 [P3][debt][-] readPendingClaims is exported twice with unrelated meanings — the same module pair DEBT-0014 just separated, one function over  (scope:src/lib/db/claims.ts,src/lib/gauges/pending-claims.ts,src/lib/db/gauges.ts,src/app/claims/page.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline/url/narrowing.test.ts,tests/offline/claims/read.test.ts,tests/offline/gauges/pending-claims.test.ts,tests/offline/review-item/page.test.ts,tests/offline/review-item/verdict-inline.test.ts,tests/offline/claims/page.test.ts @builder-237 from:DEBT-0014)

## qa
- BUG-0158 [P3][bug][patch] Three surfaces still label a source with a hand-rolled `?? id`, so a registry row that exists with a blank name reaches the screen as nothing  (scope:src/lib/browse/rows.ts,src/components/sources/trends.tsx,src/app/claims/page.tsx,tests/offline/browse/views.test.ts @builder-235 from:BUG-0156)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, built:1, done:119, qa:1, wont_fix:1. Archived: 124.
