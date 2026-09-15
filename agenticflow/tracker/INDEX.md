# Tracker index (regenerated 2026-09-15T07:44:20Z — do not edit)

## open
- BUG-0234 [P2][bug][patch] A host answer is admitted leg by leg, so three legs still admit an answer that is not a PostgREST answer  (scope:src/lib/db/result.ts,src/lib/db/schema.ts,tests/offline/db/result.test.ts,tests/offline/db/schema.test.ts from:BUG-0229)
- BUG-0235 [P2][bug][patch] Comments in 16 files state a settlement world that is false since 2026-09-11, and three more describe a count read the code does not have  (scope:src/app/api/admin/review-items/[reviewItemId]/settle/route.ts,src/components/records/fields.ts,src/components/review/close/slot.tsx,src/lib/db/tables.ts,src/lib/db/verdict.ts,tests/fixtures/rows.ts,tests/live/harness.live.test.ts,tests/live/queues.live.test.ts,tests/live/review-item.live.test.ts,tests/live/claims.live.test.ts,tests/offline/absence/pages.test.ts,tests/offline/review-item/close-slot.test.ts,tests/offline/review-item/link-actions.test.ts,tests/offline/review-item/page.test.ts,tests/offline/review-item/signal-actions.test.ts,tests/offline/review-item/conflict-actions.test.ts,tests/offline/verdict/seam.test.ts,tests/offline/review/one-place.test.ts,tests/offline/db/result.test.ts from:TASK-0081)
- TASK-0082 [P2][task][patch] A render that throws reaches the operator as Next's own 500: the app has no route-level error boundary  (scope:src/app/error.tsx,tests/offline/shell/error-boundary.test.ts from:BUG-0228)
- BUG-0236 [P3][bug][patch] Two gauges on /claims count 'unnamed sources' by two different readings — settled-values still spells its own  (scope:src/lib/gauges/settled-values.ts,tests/offline/gauges/settled-values.test.ts from:DEBT-0022)
- TASK-0083 [P3][task][patch] The README's tier table stops at four tiers, so the opt-in handoff suite is named nowhere a builder reads  (scope:README.md from:TASK-0080)

## blocked
- BUG-0221 [P2][bug][patch] A paged press asks for a POSITION, so a claim settled ahead of the bound between the screen and the press is silently skipped  (scope:src/lib/paging/machine.ts,src/lib/paging/bounds.ts,src/lib/db/claims.ts,src/lib/db/paging.ts,src/app/api/admin/claims/rows/route.ts,src/app/api/admin/browse/rows/route.ts,src/components/ui/paging.tsx,src/app/claims/page.tsx,src/app/browse/page.tsx,tests/offline/paging/machine.test.ts,tests/live/claims.live.test.ts from:BUG-0216)

Totals — blocked:1, done:25, open:5. Archived: 328.
