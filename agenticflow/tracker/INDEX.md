# Tracker index (regenerated 2026-09-09T23:10:00Z — do not edit)

## open
- BUG-0152 [P3][bug][patch] The canonical card's provenance line draws a blank source as an empty identifier box, announcing no absence — the claim line beside it draws the dash  (scope:src/components/evidence/evidence-pair.tsx,tests/offline/ui/evidence-pair.test.ts from:DEBT-0011)
- DEBT-0012 [P3][debt][patch] readPopulation issues all three shape counts on every narrowed /queues URL, including the two the URL's own kind cannot render  (deps:BUG-0141 scope:src/lib/db/review-items.ts,tests/offline/review/review-items.test.ts)
- DEBT-0014 [P3][debt][-] selectClaims is exported twice with unrelated shapes — the claims vocabulary's own narrowedTo, left untracked by two lanes  (scope:src/lib/db/claims.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,src/app/claims/page.tsx,tests/offline/url/narrowing.test.ts from:DEBT-0010)

## built
- BUG-0150 [P3][bug][-] The verdict log's own observation id and action are the same missed call site BUG-0148 fixed one tab over — outside the identifier primitive  (scope:src/components/queues/verdict-log.tsx,tests/offline/queues/verdict-log.test.ts @builder-226 from:BUG-0148)

## qa
- BUG-0147 [P3][bug][M2] /cycles spells a raw ?cycle= into the app's own sentence, so a bidi control in the URL reverses the page's paragraph  (scope:src/components/cycles/asked-cycle.tsx,src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts @builder-225 from:BUG-0146)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, built:1, done:109, open:3, qa:1, wont_fix:1. Archived: 124.
