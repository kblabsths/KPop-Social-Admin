# Tracker index (regenerated 2026-09-02T08:42:42Z — do not edit)

## open
- FEAT-0001 [P1][feat][M1] Remove the deprecated app and stand up the window shell
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0003 [P1][feat][M1] Dashboard — the breakfast view  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0004 [P1][feat][M1] Queues and the review item rendered, read-only  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0006 [P1][feat][M1] The six threshold gauges  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0007 [P1][feat][M1] Browse — the recent-events curated view  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0008 [P1][feat][M1] The edit surface — the config map and pre-cutover direct edits  (deps:FEAT-0001,FEAT-0002(unmet:2))
- TASK-0009 [P1][task][M1] Dashboard — the breakfast view  (deps:TASK-0005,TASK-0006,TASK-0007,TASK-0008,TASK-0026(unmet:3) scope:src/app/page.tsx,src/lib/db/dashboard.ts,tests/offline/dashboard,tests/live/dashboard.live.test.ts)
- TASK-0010 [P1][task][M1] Queues — two queues of equal standing, with exact filters  (deps:TASK-0005,TASK-0006,TASK-0007,TASK-0008,TASK-0026(unmet:3) scope:src/app/queues/page.tsx,src/components/queues,tests/offline/queues,tests/live/queues.live.test.ts)
- TASK-0011 [P1][task][M1] Review-item detail — three typed views over one anatomy, evidence resolved  (deps:TASK-0010(unmet:1) scope:src/app/queues/[reviewItemId]/page.tsx,src/lib/db/review-item.ts,src/components/review,tests/offline/review-item,tests/live/review-item.live.test.ts)
- TASK-0012 [P1][task][M1] Claims — the classification buckets, the standing-disagreements tab, and no in_window  (deps:TASK-0005,TASK-0007,TASK-0008,TASK-0026(unmet:3) scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims,tests/offline/claims,tests/live/claims.live.test.ts)
- TASK-0013 [P1][task][M1] Sources — lifecycle, tier, checkpoint, last run, and the per-source trends  (deps:TASK-0005,TASK-0007,TASK-0008,TASK-0026(unmet:3) scope:src/app/sources/page.tsx,src/lib/db/sources.ts,tests/offline/sources,tests/live/sources.live.test.ts)
- TASK-0014 [P1][task][M1] Cycles & runs — the resolver's cycles, newest first, with their counts and errors  (deps:TASK-0005,TASK-0007,TASK-0008,TASK-0026(unmet:3) scope:src/app/cycles/page.tsx,src/lib/db/cycles.ts,tests/offline/cycles,tests/live/cycles.live.test.ts)
- TASK-0015 [P1][task][M1] Browse — the recent-events curated view and its column selector  (deps:TASK-0005,TASK-0002,TASK-0004,TASK-0026(unmet:1) scope:src/app/browse/page.tsx,src/lib/browse,src/lib/db/browse.ts,src/components/browse,tests/offline/browse,tests/live/browse.live.test.ts)
- TASK-0017 [P1][task][M1] The edit config map and the one PATCH route that obeys it  (deps:TASK-0005,TASK-0002,TASK-0026,TASK-0027(unmet:2) scope:src/lib/edit,src/app/api/admin/records/[table]/[id]/route.ts,src/lib/db/records.ts,tests/offline/edit,tests/http/edit.http.test.ts)
- TASK-0018 [P1][task][M1] The edit surface — the record page, direct edits for groups and idols, read-only events and venues  (deps:TASK-0017,TASK-0004(unmet:1) scope:src/app/records/[table]/[id]/page.tsx,src/components/records,tests/offline/records,tests/live/edit.live.test.ts)
- TASK-0019 [P1][task][M1] Cross-page proofs: graceful absence on all six pages, in_window nowhere, auth on every route, zero residue  (deps:TASK-0009,TASK-0010,TASK-0011,TASK-0012,TASK-0013,TASK-0014,TASK-0015,TASK-0018,TASK-0027(unmet:9) scope:tests/offline/absence,tests/http,tests/live/residue.live.test.ts)
- TASK-0027 [P1][task][M1] The http harness must ENFORCE 'no database', not assert it: Next reloads .env over the strip  (deps:TASK-0005 scope:tests/http/server-harness.ts,tests/offline/http-harness.test.ts)
- BUG-0005 [P2][bug][-] Credential guard still misses destructured and optional-chained env reads, so the one-reader criterion holds for some spellings only  (scope:tests/offline/db from:BUG-0003)
- BUG-0006 [P2][bug][M1] Light palette fails bar 12: darken healthy/attention/broken/ink-secondary to the amended hexes  (scope:src/app/globals.css,tests/offline/ui from:TASK-0004)
- TASK-0008 [P2][task][M1] Gauge cards: the figure card, the trend table and the distribution view  (deps:TASK-0004,TASK-0007(unmet:1) scope:src/components/gauges,tests/offline/gauges-ui)
- TASK-0016 [P2][task][M1] Cycles & runs — the adapter framework's runs half  (deps:TASK-0014,TASK-0023(unmet:2) scope:src/app/cycles/page.tsx,src/lib/db/runs.ts,tests/offline/runs,tests/live/runs.live.test.ts)
- TASK-0020 [P2][task][M1] Compile docs/build_judgments.md for the milestone-close review  (deps:TASK-0019(unmet:1) scope:docs/build_judgments.md)
- TASK-0028 [P2][task][M1] tsconfig excludes agenticflow: a factory evidence file must not red tsc  (scope:tsconfig.json)

## built
- TASK-0026 [P1][task][M1] Complete reads: an ok row set is the whole matching set, or the read refuses  (deps:TASK-0002,TASK-0006 scope:src/lib/db/result.ts,src/lib/db/review-items.ts,tests/offline/db,tests/offline/review @builder-14)

## qa
- TASK-0007 [P1][task][M1] The six gauges as server-side queries with pure TypeScript aggregation  (deps:TASK-0002 scope:src/lib/gauges,tests/offline/gauges @builder-12)

## blocked
- TASK-0021 [P0][task][M1] ASK BEN: which Supabase env names does the APP read at runtime, and what do the campaign's live tests read?  (scope:src/lib/db/client.ts,tests/live,agenticflow/docs/SERVICES.md)
- TASK-0022 [P0][task][M1] ASK BEN: what is installed on staging, and may a live test write fixture rows into resolver-owned tables?  (scope:tests/live)
- TASK-0023 [P1][task][M1] ASK BEN: which of the adapter runs table's 22 columns does Cycles & runs show?  (scope:src/lib/db/runs.ts,src/app/cycles/page.tsx)
- TASK-0024 [P1][task][M1] ASK BEN: where does Admin read the per-source stuck_pattern dial, which lives only in scraper YAML?  (scope:src/lib/gauges/pending-claims.ts,src/app/sources/page.tsx)
- TASK-0025 [P2][task][M1] ASK BEN: what does the edit surface show for provenance on groups and idols, which have none?  (scope:src/app/records/[table]/[id]/page.tsx)

Totals — blocked:5, built:1, done:13, open:25, qa:1. Archived: 0.
