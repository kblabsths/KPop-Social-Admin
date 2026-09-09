# Tracker index (regenerated 2026-09-09T20:36:01Z — do not edit)

## open
- DEBT-0011 [P2][debt][patch] The mono identifier face is hand-spelled 44 times across 24 files with no shared primitive — the structural root of BUG-0112/0120/0121  (deps:BUG-0141,DEBT-0008 scope:src/components/ui/identifier.tsx,src/components/ui/index.ts,src/app,src/components,tests/offline/ui/primitives.test.ts,tests/offline/records/page.test.ts,tests/offline/review-item/page.test.ts)
- DEBT-0013 [P2][debt][patch] The entity picker manages no focus at all, and its hint promises an Escape that only works while focus is inside the panel  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts)
- DEBT-0012 [P3][debt][patch] readPopulation issues all three shape counts on every narrowed /queues URL, including the two the URL's own kind cannot render  (deps:BUG-0141 scope:src/lib/db/review-items.ts,tests/offline/review/review-items.test.ts)
- DEBT-0014 [P3][debt][-] selectClaims is exported twice with unrelated shapes — the claims vocabulary's own narrowedTo, left untracked by two lanes  (scope:src/lib/db/claims.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,src/app/claims/page.tsx,tests/offline/url/narrowing.test.ts from:DEBT-0010)

## claimed
- DEBT-0009 [P2][debt][M2] The app's one uuid grammar (isRecordId/canonicalRecordId) is pure but lives in lib/db/records.ts, so no leaf may import it and /claims never got it  (deps:DEBT-0008 scope:src/lib/db/records.ts,src/lib/records/id.ts,src/app/sources/page.tsx,src/app/claims/page.tsx,src/app/records/[table]/[id]/page.tsx,src/app/queues/[reviewItemId]/page.tsx,src/app/api/admin/review-items/[reviewItemId]/settle/route.ts,tests/offline/db/records.test.ts,tests/offline/claims/page.test.ts @builder-215)

## qa
- BUG-0145 [P2][bug][M2] /cycles?cycle=<a real cycle id carrying the whitespace its paste brought> still denies a row the page is rendering, in an id that reads identically to it  (scope:src/app/cycles/page.tsx,src/lib/db/records.ts,tests/offline/cycles/page.test.ts @builder-214 from:BUG-0143)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, claimed:1, done:101, open:4, qa:1, wont_fix:1. Archived: 124.
