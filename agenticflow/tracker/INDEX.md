# Tracker index (regenerated 2026-09-10T17:38:31Z — do not edit)

## claimed
- BUG-0159 [P3][bug][patch] The /sources narrowing chips label a source id with the registry string raw, so a blank-named row renders a chip with nothing to read or click beside a trend row that names it by its id  (scope:src/components/sources/source-chips.tsx,src/app/sources/page.tsx,tests/offline/sources/page.test.ts @builder-238 from:BUG-0158)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, claimed:1, done:121, wont_fix:1. Archived: 124.
