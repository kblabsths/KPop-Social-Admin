# Tracker index (regenerated 2026-09-09T17:21:38Z — do not edit)

## open
- BUG-0139 [P1][bug][M2] /sources reads runs once per registered source and then waits for both gauges: ~9 sequential round trips, 2.0-2.3 s warm  (scope:src/lib/db/sources.ts,src/app/sources/page.tsx,tests/offline/sources/page.test.ts,tests/offline/sources/read.test.ts,tests/offline/sources/names.test.ts,tests/offline/sources/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/primitives.test.ts,tests/live/sources.live.test.ts,tests/live/parity.ts from:human:ben-walk)
- BUG-0137 [P2][bug][M2] Claims' dropped-parameter line is holed again by nonspacing marks, and a bidi override in a key reverses the whole sentence  (scope:src/lib/claims/filters.ts,src/app/claims/page.tsx,tests/offline/claims/filters.test.ts,tests/offline/claims/page.test.ts from:BUG-0136)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139(unmet:1) scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, done:92, open:2, wont_fix:1. Archived: 124.
