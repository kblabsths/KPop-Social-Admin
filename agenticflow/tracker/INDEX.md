# Tracker index (regenerated 2026-09-11T13:33:16Z — do not edit)

## open
- BUG-0192 [P2][bug][M3] A narrowing clause names what a facet DID, not that it is set — /claims' chip clause  (deps:TASK-0072(unmet:1) scope:src/lib/url/narrowing.ts,src/lib/claims/filters.ts,src/app/claims/page.tsx,tests/offline/url/narrowing.test.ts,tests/offline/claims,tests/live/claims.live.test.ts from:BUG-0191)
- FEAT-0016 [P2][feat][M3] F15 — every windowed figure is true about the read that produced it  (scope:src/app/claims/page.tsx,src/app/sources/page.tsx,src/lib/db/claims.ts,src/lib/db/sources.ts,src/lib/gauges,src/components/claims,src/components/sources,src/components/ui/window-line.tsx,tests/offline/claims/read.test.ts,tests/offline/claims/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/sources/read.test.ts,tests/offline/gauges,tests/live/claims.live.test.ts,tests/live/sources.live.test.ts)
- TASK-0073 [P2][task][M3] /sources' two scan-window lines name the narrowing their read carried  (deps:TASK-0072(unmet:1) scope:src/components/sources/trends.tsx,src/app/sources/page.tsx,src/lib/sources/routes.ts,tests/offline/sources/page.test.ts,tests/offline/sources/read.test.ts,tests/live/sources.live.test.ts)
- BUG-0164 [P3][bug][patch] /queues still carries the exit copy BUG-0161 replaced on /claims  (deps:TASK-0072(unmet:1) scope:src/app/queues/page.tsx,tests/offline/queues/page.test.ts,tests/offline/ui/copy.test.ts from:designer:endgame-walk)
- DEBT-0019 [P3][debt][M3] The http tier's storable assertion passes on the gate's 403, so it grades nothing the handler answered — make the vacuity visible  (scope:tests/http/paging.http.test.ts from:BUG-0171)
- DEBT-0020 [P3][debt][patch] The transport account states its cause sentence twice: postgrest-js appends cause.stack, whose head repeats the Caused-by line  (deps:BUG-0179,BUG-0182,BUG-0187 scope:src/lib/db/result.ts,tests/offline/db/result.test.ts from:BUG-0173)
- TASK-0060 [P3][task][patch] Route the last two source-name renderers through lib/sources/names.ts — and close that class  (deps:TASK-0073(unmet:1) scope:src/components/sources/registry-table.tsx,src/components/sources/trends.tsx,src/lib/sources/names.ts,tests/offline/sources/names.test.ts,tests/offline/sources/page.test.ts from:qa:BUG-0159)

## built
- BUG-0178 [P3][bug][M3] The bound-ceiling sentence reads as exhaustion — "This view shows no further rows" beside a window line that says rows are not shown  (deps:BUG-0177 scope:src/components/ui/paging.tsx,tests/offline/ui/paging.test.ts @builder-288)

## qa
- TASK-0072 [P2][task][M3] One home for the narrowing vocabulary, and a window's scope stops being a string somebody splits  (deps:TASK-0071,BUG-0169,BUG-0174,BUG-0183,BUG-0186,BUG-0191 scope:src/components/ui/window-line.tsx,src/lib/url/narrowing.ts,src/lib/claims/filters.ts,src/app/claims/page.tsx,src/app/cycles/page.tsx,src/app/queues/page.tsx,src/app/browse/page.tsx,src/app/page.tsx,src/components/cycles,src/components/review/shape-views.tsx,src/components/records/entity-picker.tsx,src/components/sources/trends.tsx,tests/offline/url/narrowing.test.ts,tests/offline/ui,tests/offline/claims,tests/offline/cycles,tests/offline/queues,tests/offline/browse,tests/offline/sources @builder-287)

Totals — built:1, done:46, open:7, qa:1. Archived: 252.
