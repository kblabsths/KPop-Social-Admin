# Tracker index (regenerated 2026-09-10T21:26:54Z — do not edit)

## open
- FEAT-0014 [P1][feat][M3] F16 — the second leg of a two-step join runs its chunks concurrently  (scope:src/lib/db/result.ts,src/lib/db/gauges.ts,src/lib/db/claims.ts,src/lib/db/sources.ts,src/lib/db/verdict.ts,tests/offline/db/result.test.ts,tests/live/claims.live.test.ts,tests/live/queues.live.test.ts,tests/live/review-item.live.test.ts)
- FEAT-0015 [P1][feat][M3] F14 — paging past the window, on Claims and on Browse  (deps:FEAT-0014(unmet:1) scope:src/app/claims/page.tsx,src/app/browse/page.tsx,src/app/api,src/components/claims,src/components/browse,src/lib/db/claims.ts,src/lib/db/browse.ts,src/lib/db/result.ts,tests/offline/claims/page.test.ts,tests/offline/browse/page.test.ts,tests/offline/absence/pages.test.ts,tests/live/claims.live.test.ts,tests/live/browse.live.test.ts)
- FEAT-0016 [P2][feat][M3] F15 — every windowed figure is true about the read that produced it  (scope:src/app/claims/page.tsx,src/app/sources/page.tsx,src/lib/db/claims.ts,src/lib/db/sources.ts,src/lib/gauges,src/components/claims,src/components/sources,src/components/ui/window-line.tsx,tests/offline/claims/read.test.ts,tests/offline/claims/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/sources/read.test.ts,tests/offline/gauges,tests/live/claims.live.test.ts,tests/live/sources.live.test.ts)
- BUG-0164 [P3][bug][patch] /queues still carries the exit copy BUG-0161 replaced on /claims  (scope:src/app/queues/page.tsx,tests/offline/queues/page.test.ts,tests/offline/ui/copy.test.ts from:designer:endgame-walk)
- DEBT-0016 [P3][debt][patch] newestFirst is exported twice over different key columns  (scope:src/lib/db/verdict.ts,src/lib/db/cycles.ts,tests/offline/db/layering.test.ts from:DEBT-0015)
- TASK-0060 [P3][task][patch] Route the last two source-name renderers through lib/sources/names.ts — and close that class  (scope:src/components/sources/registry-table.tsx,src/components/sources/trends.tsx,src/lib/sources/names.ts,tests/offline/sources/names.test.ts,tests/offline/sources/page.test.ts from:qa:BUG-0159)
- TASK-0061 [P3][task][patch] README.md still describes the retired dashboard  (scope:README.md,agenticflow/docs/STACK.md from:verifier)

Totals — open:7. Archived: 252.
