# Tracker index (regenerated 2026-09-12T00:08:24Z — do not edit)

## open
- BUG-0213 [P2][bug][-] The attribution corpus carries a 2-line paste block, so the sibling allocating ITS next code reddens the offline suite  (scope:tests/offline/handoff/settle-review-item.test.ts from:BUG-0207)
- BUG-0219 [P2][bug][M3] edit.live's two venue-provenance cases grade a population read minutes earlier, so a row a concurrent writer removes mid-run turns the live tier red  (scope:tests/live/edit.live.test.ts from:BUG-0215)
- BUG-0211 [P3][bug][M3] The paging control stays drawn and enabled after a page answers not_provisioned — the one arm whose text offers no press  (scope:src/lib/paging/machine.ts,src/components/ui/paging.tsx,tests/offline/paging/machine.test.ts,tests/offline/ui/paging.test.ts)
- DEBT-0021 [P3][debt][M3] The error arm's `authored` field is optional, so the only guard on it is a regex inside a closed ticket's checks  (scope:src/lib/db/result.ts,src/lib/db,tests/offline/db/result.test.ts from:BUG-0200)
- DEBT-0022 [P3][debt][M3] Three truth residuals on one class: a comment naming a defect that is fixed, a second spelling of 'unnamed source', and a count of 1 that reads as a plural  (scope:src/components/ui/window-line.tsx,src/lib/gauges/standing-disagreements.ts,src/app/queues/page.tsx,tests/offline/gauges/standing-disagreements.test.ts,tests/offline/ui/primitives.test.ts,tests/offline/claims/page.test.ts,tests/offline/queues/page.test.ts from:BUG-0204)

## claimed
- BUG-0216 [P1][bug][patch] Paging /claims repeated a claim id at offset 50 on Ben's instance — a shipped surface can duplicate and silently omit rows  (scope:src/lib/db/claims.ts,src/lib/db/paging.ts,src/lib/paging/machine.ts,src/app/api/admin/claims/rows/route.ts,src/components/claims/paged-claim-list.tsx,tests/live/claims.live.test.ts,tests/offline/paging/machine.test.ts,tests/offline/claims/page.test.ts @builder-316 from:inbox:2026-09-11-ben-paging-rulings.md)

## built
- BUG-0218 [P2][bug][patch] Ben's open paging-shape decision names only /claims in its "no" branch, so the cheap branch under-states its scope by the surface BUG-0217 just un-hid  (scope:agenticflow/tracker/for-human/M3-paging-shape-for-ben.md,agenticflow/tracker/for-human/M3-endgame-walk.md @designer from:BUG-0217)

Totals — built:1, claimed:1, done:79, open:5. Archived: 252.
