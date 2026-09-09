# Tracker index (regenerated 2026-09-09T22:15:54Z — do not edit)

## open
- BUG-0147 [P3][bug][M2] /cycles spells a raw ?cycle= into the app's own sentence, so a bidi control in the URL reverses the page's paragraph  (scope:src/components/cycles/asked-cycle.tsx,src/app/cycles/page.tsx,tests/offline/cycles/page.test.ts from:BUG-0146)
- BUG-0150 [P3][bug][-] The verdict log's own observation id and action are the same missed call site BUG-0148 fixed one tab over — outside the identifier primitive  (scope:src/components/queues/verdict-log.tsx,tests/offline/queues/verdict-log.test.ts from:BUG-0148)
- DEBT-0012 [P3][debt][patch] readPopulation issues all three shape counts on every narrowed /queues URL, including the two the URL's own kind cannot render  (deps:BUG-0141 scope:src/lib/db/review-items.ts,tests/offline/review/review-items.test.ts)
- DEBT-0014 [P3][debt][-] selectClaims is exported twice with unrelated shapes — the claims vocabulary's own narrowedTo, left untracked by two lanes  (scope:src/lib/db/claims.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,src/app/claims/page.tsx,tests/offline/url/narrowing.test.ts from:DEBT-0010)

## claimed
- BUG-0151 [P2][bug][-] The evidence card's source is hand-faced with DATA_MUTED, so a source name reverses the app's own words beside it  (scope:src/components/evidence/evidence-pair.tsx,tests/offline/ui/evidence-pair.test.ts @builder-222 from:DEBT-0011)

## qa
- BUG-0149 [P2][bug][-] A refusal that lands on a panel focus has slipped out of leaves focus on the document  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts @builder-221 from:DEBT-0013)

## blocked
- BUG-0138 [P2][bug][M2] /claims reads the whole claim population on every request: ~14 sequential round trips, 2.9-3.8 s warm  (deps:BUG-0139 scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims/bucket-table.tsx,src/components/claims/filter-bar.tsx,src/lib/claims/filters.ts,src/lib/gauges/pending-claims.ts,src/lib/gauges/standing-disagreements.ts,tests/offline/claims/page.test.ts,tests/offline/claims/read.test.ts,tests/offline/claims/filters.test.ts,tests/offline/claims/population.ts,tests/offline/absence/pages.test.ts,tests/offline/absence/in-window.test.ts,tests/offline/absence/blank-cells.test.ts,tests/offline/absence/surfaces.ts,tests/offline/gauges/bounded.test.ts,tests/offline/ui/copy.test.ts,tests/offline/ui/link-spelling.test.ts,tests/offline/ui/primitives.test.ts,tests/live/claims.live.test.ts,tests/live/parity.ts from:human:ben-walk)

## reopened
- DEBT-0011 [P2][debt][patch] The mono identifier face is hand-spelled 44 times across 24 files with no shared primitive — the structural root of BUG-0112/0120/0121  (deps:BUG-0141,DEBT-0008 scope:src/components/ui/identifier.tsx,src/components/ui/index.ts,src/app,src/components,tests/offline/ui/primitives.test.ts,tests/offline/records/page.test.ts,tests/offline/review-item/page.test.ts)
- DEBT-0013 [P2][debt][patch] The entity picker manages no focus at all, and its hint promises an Escape that only works while focus is inside the panel  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts)

Totals — blocked:1, claimed:1, done:105, open:4, qa:1, reopened:2, wont_fix:1. Archived: 124.
