# Tracker index (regenerated 2026-09-11T15:58:31Z — do not edit)

## open
- BUG-0196 [P2][bug][M3] A failed read's account renders the app's own sentences in the mono face reserved for the machine's words  (deps:DEBT-0020,BUG-0199(unmet:2) scope:src/lib/db/result.ts,src/lib/db/paging.ts,src/lib/paging/bounds.ts,src/lib/paging/machine.ts,src/components/ui/error-line.tsx,src/components/ui/paging.tsx,src/components/ui/state-of.tsx,src/components/gauges/state.tsx,src/app/queues/[reviewItemId]/page.tsx,tests/offline/db/result.test.ts,tests/offline/ui/primitives.test.ts,tests/offline/ui/paging.test.ts,tests/offline/ui/tokens.test.ts,tests/offline/live-guard.test.ts,tests/offline/paging/machine.test.ts,tests/offline/paging/bounds.test.ts from:designer:endgame-walk)
- BUG-0198 [P3][bug][M3] The bound-ceiling sentence tells /browse's operator to narrow a view /browse offers no way to narrow  (scope:src/components/ui/paging.tsx,src/components/claims/paged-claim-list.tsx,src/components/browse/paged-browse-table.tsx,tests/offline/ui/paging.test.ts from:designer:endgame-walk)
- BUG-0199 [P3][bug][patch] saidOnce misses every REAL transport failure: postgrest-js puts the cause's code between the Caused-by line and the stack head it must absorb  (deps:DEBT-0020(unmet:1) scope:src/lib/db/result.ts,tests/offline/db/result.test.ts from:DEBT-0020)

## built
- BUG-0197 [P3][bug][M3] An empty claims window ranks the 0 rows it drew and apologises for withholding the rest  (scope:src/components/ui/window-line.tsx,tests/offline/ui/primitives.test.ts,tests/offline/claims/page.test.ts @builder-297 from:designer:endgame-walk)

## reopened
- DEBT-0020 [P3][debt][patch] The transport account states its cause sentence twice: postgrest-js appends cause.stack, whose head repeats the Caused-by line  (deps:BUG-0179,BUG-0182,BUG-0187 scope:src/lib/db/result.ts,tests/offline/db/result.test.ts from:BUG-0173)

Totals — built:1, done:57, open:3, reopened:1. Archived: 252.
