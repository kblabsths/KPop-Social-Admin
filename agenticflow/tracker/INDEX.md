# Tracker index (regenerated 2026-09-09T16:41:24Z — do not edit)

## claimed
- BUG-0136 [P3][bug][M2] Claims' dropped-parameter line spells a hole again when the URL's key is invisible but not whitespace (?%E2%80%8B=1, ?%00=1)  (scope:src/lib/claims/filters.ts,src/app/claims/page.tsx,tests/offline/claims/page.test.ts,tests/offline/claims/filters.test.ts @builder-204 from:BUG-0127)

## qa
- BUG-0135 [P2][bug][M2] A population read no row depends on deletes the rows the URL's own complete read returned  (scope:src/lib/db/review-items.ts,src/app/queues/page.tsx,tests/offline/review/review-items.test.ts,tests/offline/queues/page.test.ts @builder-202 from:BUG-0133)
- BUG-0134 [P3][bug][-] The evidence pair writes its own em dash for an unreadable tier, so the table's labelled absence and the pair's bare character say the same thing two ways  (scope:src/components/review/shape-views.tsx,src/components/evidence/evidence-pair.tsx,tests/offline/review-item/page.test.ts @builder-203 from:BUG-0132)

Totals — claimed:1, done:89, qa:2, wont_fix:1. Archived: 124.
