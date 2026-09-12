# Tracker index (regenerated 2026-09-12T01:02:35Z — do not edit)

## open
- BUG-0221 [P2][bug][patch] A paged press asks for a POSITION, so a claim settled ahead of the bound between the screen and the press is silently skipped  (scope:src/lib/paging/machine.ts,src/lib/paging/bounds.ts,src/lib/db/claims.ts,src/lib/db/paging.ts,src/app/api/admin/claims/rows/route.ts,src/app/api/admin/browse/rows/route.ts,src/components/ui/paging.tsx,src/app/claims/page.tsx,src/app/browse/page.tsx,tests/offline/paging/machine.test.ts,tests/live/claims.live.test.ts from:BUG-0216)
- BUG-0211 [P3][bug][M3] The paging control stays drawn and enabled after a page answers not_provisioned — the one arm whose text offers no press  (scope:src/lib/paging/machine.ts,src/components/ui/paging.tsx,tests/offline/paging/machine.test.ts,tests/offline/ui/paging.test.ts)
- DEBT-0021 [P3][debt][M3] The error arm's `authored` field is optional, so the only guard on it is a regex inside a closed ticket's checks  (scope:src/lib/db/result.ts,src/lib/db,tests/offline/db/result.test.ts from:BUG-0200)
- DEBT-0022 [P3][debt][M3] Three truth residuals on one class: a comment naming a defect that is fixed, a second spelling of 'unnamed source', and a count of 1 that reads as a plural  (scope:src/components/ui/window-line.tsx,src/lib/gauges/standing-disagreements.ts,src/app/queues/page.tsx,tests/offline/gauges/standing-disagreements.test.ts,tests/offline/ui/primitives.test.ts,tests/offline/claims/page.test.ts,tests/offline/queues/page.test.ts from:BUG-0204)

## claimed
- BUG-0220 [P2][bug][-] The registry reader takes a narrower declaration grammar than the sibling's own parser, so a typing pass next door reddens npm test and a single-quoted claim passes  (scope:tests/offline/handoff/settle-review-item.test.ts @builder-320 from:BUG-0213)

## qa
- BUG-0219 [P2][bug][M3] edit.live's two venue-provenance cases grade a population read minutes earlier, so a row a concurrent writer removes mid-run turns the live tier red  (scope:tests/live/edit.live.test.ts @builder-319 from:BUG-0215)

Totals — claimed:1, done:82, open:4, qa:1. Archived: 252.
