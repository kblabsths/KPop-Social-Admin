# Tracker index (regenerated 2026-09-11T14:48:09Z — do not edit)

## open
- BUG-0195 [P1][bug][-] The run branch fails tsc: BUG-0194's pin annotates a cheerio node as Cheerio<never>  (scope:tests/offline/sources/page.test.ts from:BUG-0192)
- FEAT-0016 [P2][feat][M3] F15 — every windowed figure is true about the read that produced it  (scope:src/app/claims/page.tsx,src/app/sources/page.tsx,src/lib/db/claims.ts,src/lib/db/sources.ts,src/lib/gauges,src/components/claims,src/components/sources,src/components/ui/window-line.tsx,tests/offline/claims/read.test.ts,tests/offline/claims/page.test.ts,tests/offline/sources/page.test.ts,tests/offline/sources/read.test.ts,tests/offline/gauges,tests/live/claims.live.test.ts,tests/live/sources.live.test.ts)
- BUG-0164 [P3][bug][patch] /queues still carries the exit copy BUG-0161 replaced on /claims  (deps:TASK-0072 scope:src/app/queues/page.tsx,tests/offline/queues/page.test.ts,tests/offline/ui/copy.test.ts from:designer:endgame-walk)
- DEBT-0020 [P3][debt][patch] The transport account states its cause sentence twice: postgrest-js appends cause.stack, whose head repeats the Caused-by line  (deps:BUG-0179,BUG-0182,BUG-0187 scope:src/lib/db/result.ts,tests/offline/db/result.test.ts from:BUG-0173)
- TASK-0060 [P3][task][patch] Route the last two source-name renderers through lib/sources/names.ts — and close that class  (deps:BUG-0194(unmet:1) scope:src/components/sources/registry-table.tsx,src/components/sources/trends.tsx,src/lib/sources/names.ts,tests/offline/sources/names.test.ts,tests/offline/sources/page.test.ts from:qa:BUG-0159)

## claimed
- BUG-0194 [P2][bug][M3] /sources' settled-values figures are narrowed to one source and no word on the page says so  (scope:src/lib/db/gauges.ts,src/lib/gauges/settled-values.ts,src/app/sources/page.tsx,src/components/sources/trends.tsx,tests/offline/gauges/settled-values.test.ts,tests/offline/gauges/bounded.test.ts,tests/offline/sources/page.test.ts,tests/offline/absence/pages.test.ts,tests/live/sources.live.test.ts @builder-293 from:TASK-0073)

Totals — claimed:1, done:52, open:5. Archived: 252.
