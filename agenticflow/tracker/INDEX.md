# Tracker index (regenerated 2026-09-10T20:18:45Z — do not edit)

## open
- BUG-0162 [P2][bug][M2] /claims window line: 'narrow with the filters above to reach the rest' — no narrowing the page offers reaches past row 50  (scope:src/components/ui/window-line.tsx,src/app/claims/page.tsx,tests/offline/claims/page.test.ts,tests/offline/ui/copy.test.ts,tests/offline/url/narrowing.test.ts from:designer:relook-claims)
- BUG-0163 [P2][bug][M2] /claims: the gauge's own window line names no narrowing, so ?domain= moves every figure on that card under a sentence that says it read the whole table  (scope:src/app/claims/page.tsx,src/components/ui/window-line.tsx,src/lib/gauges/pending-claims.ts,tests/offline/claims/page.test.ts from:BUG-0160)

## claimed
- BUG-0161 [P2][bug][M2] /claims: a ?domain= that matches nothing is a dead end — every chip carries it forward and the empty card names an exit that does not exit  (scope:src/app/claims/page.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,tests/offline/claims/filters.test.ts,tests/offline/url/narrowing.test.ts @builder-241 from:designer:relook-claims)

Totals — claimed:1, done:124, open:2, wont_fix:1. Archived: 124.
