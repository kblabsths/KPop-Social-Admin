# Tracker index (regenerated 2026-09-09T23:20:23Z — do not edit)

## open
- BUG-0153 [P3][bug][M2] /cycles spells a raw ?source= into the runs window line as bare text, so a bidi control in the URL reverses 87 characters of the app's own prose  (scope:src/components/cycles/adapter-runs.tsx,src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts from:BUG-0147)
- DEBT-0012 [P3][debt][patch] readPopulation issues all three shape counts on every narrowed /queues URL, including the two the URL's own kind cannot render  (deps:BUG-0141 scope:src/lib/db/review-items.ts,tests/offline/review/review-items.test.ts)
- DEBT-0014 [P3][debt][-] selectClaims is exported twice with unrelated shapes — the claims vocabulary's own narrowedTo, left untracked by two lanes  (scope:src/lib/db/claims.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,src/app/claims/page.tsx,tests/offline/url/narrowing.test.ts from:DEBT-0010)

## built
- BUG-0152 [P3][bug][patch] The canonical card's provenance line draws a blank source as an empty identifier box, announcing no absence — the claim line beside it draws the dash  (scope:src/components/evidence/evidence-pair.tsx,tests/offline/ui/evidence-pair.test.ts @builder-227 from:DEBT-0011)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, built:1, done:111, open:3, wont_fix:1. Archived: 124.
