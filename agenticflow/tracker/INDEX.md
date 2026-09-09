# Tracker index (regenerated 2026-09-09T21:18:55Z — do not edit)

## open
- DEBT-0011 [P2][debt][patch] The mono identifier face is hand-spelled 44 times across 24 files with no shared primitive — the structural root of BUG-0112/0120/0121  (deps:BUG-0141,DEBT-0008 scope:src/components/ui/identifier.tsx,src/components/ui/index.ts,src/app,src/components,tests/offline/ui/primitives.test.ts,tests/offline/records/page.test.ts,tests/offline/review-item/page.test.ts)
- DEBT-0013 [P2][debt][patch] The entity picker manages no focus at all, and its hint promises an Escape that only works while focus is inside the panel  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts)
- DEBT-0012 [P3][debt][patch] readPopulation issues all three shape counts on every narrowed /queues URL, including the two the URL's own kind cannot render  (deps:BUG-0141 scope:src/lib/db/review-items.ts,tests/offline/review/review-items.test.ts)
- DEBT-0014 [P3][debt][-] selectClaims is exported twice with unrelated shapes — the claims vocabulary's own narrowedTo, left untracked by two lanes  (scope:src/lib/db/claims.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,src/app/claims/page.tsx,tests/offline/url/narrowing.test.ts from:DEBT-0010)

## built
- BUG-0146 [P2][bug][M2] /cycles?cycle= still denies a row it is rendering when the paste's padding is ink-less rather than whitespace (ZWSP, SOFT HYPHEN, NUL, the bidi controls)  (scope:src/app/cycles/page.tsx,src/lib/db/records.ts,src/components/cycles/asked-cycle.tsx,tests/offline/cycles/page.test.ts @builder-216 from:BUG-0145)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

Totals — blocked:1, built:1, done:103, open:4, wont_fix:1. Archived: 124.
