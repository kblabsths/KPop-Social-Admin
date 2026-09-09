# Tracker index (regenerated 2026-09-09T18:33:31Z — do not edit)

## open
- BUG-0141 [P1][bug][M2] /queues ignores the source_id the Sources page links it with: another source's item renders as that source's review items  (scope:src/app/queues/page.tsx,src/lib/review/queue-filters.ts,src/lib/sources/routes.ts,tests/offline/queues/page.test.ts,tests/offline/queues/filters.test.ts,tests/live/queues.live.test.ts from:verifier)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, done:95, open:1, wont_fix:1. Archived: 124.
