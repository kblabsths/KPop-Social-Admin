# Tracker index (regenerated 2026-09-09T23:54:02Z — do not edit)

## open
- BUG-0155 [P3][bug][M2] /cycles shows a ?source= name the browser collapsed, not the name it queried: ?source=%20ticketmaster says "No runs from ticketmaster" while ?source=ticketmaster draws five  (scope:src/lib/db/runs.ts,src/lib/url/spellable.ts,tests/offline/cycles/page.test.ts,tests/offline/runs/read.test.ts from:BUG-0153)
- DEBT-0012 [P3][debt][patch] readPopulation issues all three shape counts on every narrowed /queues URL, including the two the URL's own kind cannot render  (deps:BUG-0141 scope:src/lib/db/review-items.ts,tests/offline/review/review-items.test.ts)
- DEBT-0014 [P3][debt][-] selectClaims is exported twice with unrelated shapes — the claims vocabulary's own narrowedTo, left untracked by two lanes  (scope:src/lib/db/claims.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,src/app/claims/page.tsx,tests/offline/url/narrowing.test.ts from:DEBT-0010)

## claimed
- BUG-0154 [P3][bug][patch] A source whose registry NAME is blank reaches the screen as a blank evidence cell and a link with nothing to read — the third rendering of one row's absence  (scope:src/lib/sources/names.ts,src/lib/db/review-item.ts,src/components/review/evidence-cells.tsx,src/components/claims/claim-list.tsx,tests/offline/review-item/page.test.ts,tests/offline/sources/names.test.ts @builder-229 from:BUG-0152)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, claimed:1, done:113, open:3, wont_fix:1. Archived: 124.
