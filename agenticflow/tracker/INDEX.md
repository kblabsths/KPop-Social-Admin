# Tracker index (regenerated 2026-09-09T14:19:28Z — do not edit)

## open
- BUG-0128 [P2][bug][M2] The entity_link fact lede still claims every claim the record holds is below  (scope:src/components/review/shape-views.tsx,tests/offline/review-item/page.test.ts from:BUG-0124)
- BUG-0126 [P3][bug][M2] The record page draws a subset of the row's columns and never says so — absent and not-drawn share one rendering  (scope:src/app/records/[table]/[id]/page.tsx,src/components/records/record-fields.tsx,tests/offline/records/page.test.ts from:usersim:priya)
- BUG-0127 [P3][bug][M2] Claims' dropped-parameter line spells a hole when the URL's key is blank: 'The URL carries , which this page did not apply'  (scope:src/lib/claims/filters.ts,src/app/claims/page.tsx,tests/offline/claims/page.test.ts from:BUG-0123)

## built
- BUG-0125 [P2][bug][M2] The Dashboard's attention zeros never say what fills the queue, and one of them speaks for the whole pipeline  (scope:src/app/page.tsx,tests/offline/dashboard/page.test.ts @builder-193 from:usersim:devin)

## qa
- BUG-0124 [P2][bug][M2] The review item's three counts state no relationship, and the lede claims a completeness the fold count contradicts  (scope:src/components/review/item-header.tsx,src/components/review/shape-views.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline/review-item/page.test.ts @builder-192 from:usersim:devin)

Totals — built:1, done:79, open:3, qa:1, wont_fix:1. Archived: 124.
