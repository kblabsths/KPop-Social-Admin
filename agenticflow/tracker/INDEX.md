# Tracker index (regenerated 2026-09-15T03:13:07Z — do not edit)

## open
- BUG-0226 [P1][bug][-] Both paged pages answer HTTP 500: a function prop cannot cross the client boundary  (scope:src/app/claims/page.tsx,src/app/browse/page.tsx,src/lib/paging/machine.ts,src/components/ui/paging.tsx,src/components/claims/paged-claim-list.tsx,src/components/browse/paged-browse-table.tsx,tests/offline/claims/page.test.ts,tests/offline/browse/page.test.ts,tests/offline/paging/machine.test.ts,tests/offline/ui/paging.test.ts,tests/live/claims.live.test.ts,tests/live/browse.live.test.ts,tests/fixtures/client-props.ts from:BUG-0222)
- TASK-0080 [P2][task][patch] Take the SIBLING-READING handoff guards out of the every-builder suite: a new opt-in vitest project  (scope:tests/suite-globs.ts,vitest.config.mts,package.json,tests/handoff,tests/offline/handoff/settle-review-item.test.ts,tests/offline/handoff/verdicts.test.ts,tests/offline/handoff/extract.ts,tests/offline/toolchain.test.ts from:BUG-0213)
- BUG-0211 [P3][bug][M3] The paging control stays drawn and enabled after a page answers not_provisioned — the one arm whose text offers no press  (scope:src/lib/paging/machine.ts,src/components/ui/paging.tsx,tests/offline/paging/machine.test.ts,tests/offline/ui/paging.test.ts)
- BUG-0223 [P3][bug][patch] Settlement readiness asks about the TABLE only, so a half-installed world offers an override whose save 503s  (scope:src/lib/db/verdict.ts,src/app/records/[table]/[id]/page.tsx,tests/offline/edit/records.test.ts,tests/offline/edit/route.test.ts,tests/live/edit.live.test.ts from:BUG-0215)
- BUG-0225 [P3][bug][patch] The sibling-code reader answers from three grammars it cannot actually read — state its bar once instead of a fifth instance  (deps:TASK-0080(unmet:1) scope:tests/handoff,tests/offline/handoff/extract.ts from:BUG-0220)
- DEBT-0021 [P3][debt][M3] The error arm's `authored` field is optional, so the only guard on it is a regex inside a closed ticket's checks  (scope:src/lib/db/result.ts,src/lib/db,tests/offline/db/result.test.ts from:BUG-0200)
- DEBT-0022 [P3][debt][M3] Three truth residuals on one class: a comment naming a defect that is fixed, a second spelling of 'unnamed source', and a count of 1 that reads as a plural  (scope:src/components/ui/window-line.tsx,src/lib/gauges/standing-disagreements.ts,src/app/queues/page.tsx,src/app/claims/page.tsx,tests/offline/gauges/standing-disagreements.test.ts,tests/offline/ui/primitives.test.ts,tests/offline/claims/page.test.ts,tests/offline/queues/page.test.ts from:BUG-0204)
- TASK-0081 [P3][task][M3] docs/build_judgments.md states two things that stopped being true during the M3 endgame  (scope:docs/build_judgments.md from:BUG-0215)

## built
- BUG-0224 [P2][bug][patch] A host that 404s with zero bytes makes /claims say 'No claims waiting' over a read that failed, beside a sentence about this app's own call site  (scope:src/lib/db/result.ts,tests/http/absence.http.test.ts,tests/http/postgrest-stub.ts,tests/offline/db/result.test.ts @builder-324 from:BUG-0210)

## blocked
- BUG-0221 [P2][bug][patch] A paged press asks for a POSITION, so a claim settled ahead of the bound between the screen and the press is silently skipped  (scope:src/lib/paging/machine.ts,src/lib/paging/bounds.ts,src/lib/db/claims.ts,src/lib/db/paging.ts,src/app/api/admin/claims/rows/route.ts,src/app/api/admin/browse/rows/route.ts,src/components/ui/paging.tsx,src/app/claims/page.tsx,src/app/browse/page.tsx,tests/offline/paging/machine.test.ts,tests/live/claims.live.test.ts from:BUG-0216)

## reopened
- BUG-0222 [P2][bug][patch] A paged press draws a row the screen above it already holds: the same claim twice, and React's duplicate key  (scope:src/lib/paging/machine.ts,src/components/ui/paging.tsx,src/components/claims/paged-claim-list.tsx,src/components/browse/paged-browse-table.tsx,tests/offline/paging/machine.test.ts,tests/offline/ui/paging.test.ts,tests/offline/claims/page.test.ts,tests/offline/browse/page.test.ts from:BUG-0221)

Totals — blocked:1, built:1, done:84, open:8, reopened:1. Archived: 252.
