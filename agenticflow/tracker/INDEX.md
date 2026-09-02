# Tracker index (regenerated 2026-09-02T10:12:10Z — do not edit)

## open
- FEAT-0001 [P1][feat][M1] Remove the deprecated app and stand up the window shell
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0003 [P1][feat][M1] Dashboard — the breakfast view  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0004 [P1][feat][M1] Queues and the review item rendered, read-only  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0006 [P1][feat][M1] The six threshold gauges  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0008 [P1][feat][M1] The edit surface — the config map and pre-cutover direct edits  (deps:FEAT-0001,FEAT-0002(unmet:2))
- TASK-0009 [P1][task][M1] Dashboard — the breakfast view  (deps:TASK-0005,TASK-0006,TASK-0007,TASK-0008,TASK-0026(unmet:1) scope:src/app/page.tsx,src/lib/db/dashboard.ts,tests/offline/dashboard,tests/live/dashboard.live.test.ts)
- TASK-0010 [P1][task][M1] Queues — two queues of equal standing, with exact filters  (deps:TASK-0005,TASK-0006,TASK-0007,TASK-0008,TASK-0026(unmet:1) scope:src/app/queues/page.tsx,src/components/queues,tests/offline/queues,tests/live/queues.live.test.ts)
- TASK-0011 [P1][task][M1] Review-item detail — three typed views over one anatomy, evidence resolved  (deps:TASK-0010(unmet:1) scope:src/app/queues/[reviewItemId]/page.tsx,src/lib/db/review-item.ts,src/components/review,tests/offline/review-item,tests/live/review-item.live.test.ts)
- TASK-0012 [P1][task][M1] Claims — the classification buckets, the standing-disagreements tab, and no in_window  (deps:TASK-0005,TASK-0007,TASK-0008,TASK-0026(unmet:1) scope:src/app/claims/page.tsx,src/lib/db/claims.ts,src/components/claims,tests/offline/claims,tests/live/claims.live.test.ts)
- TASK-0013 [P1][task][M1] Sources — lifecycle, tier, checkpoint, last run, and the per-source trends  (deps:TASK-0005,TASK-0007,TASK-0008,TASK-0026(unmet:1) scope:src/app/sources/page.tsx,src/lib/db/sources.ts,tests/offline/sources,tests/live/sources.live.test.ts)
- TASK-0014 [P1][task][M1] Cycles & runs — the resolver's cycles, newest first, with their counts and errors  (deps:TASK-0005,TASK-0007,TASK-0008,TASK-0026(unmet:1) scope:src/app/cycles/page.tsx,src/lib/db/cycles.ts,tests/offline/cycles,tests/live/cycles.live.test.ts)
- TASK-0019 [P1][task][M1] Cross-page proofs: graceful absence on all six pages, in_window nowhere, auth on every route, zero residue  (deps:TASK-0009,TASK-0010,TASK-0011,TASK-0012,TASK-0013,TASK-0014,TASK-0015,TASK-0018,TASK-0027(unmet:7) scope:tests/offline/absence,tests/http,tests/live/residue.live.test.ts)
- BUG-0006 [P2][bug][M1] Light palette fails bar 12: darken healthy/attention/broken/ink-secondary to the amended hexes  (scope:src/app/globals.css,tests/offline/ui from:TASK-0004)
- BUG-0012 [P2][bug][-] Resolution latency counts a verdict unset as an apply the join lost  (scope:src/lib/db/gauges.ts,src/lib/gauges/resolution-latency.ts,tests/offline/gauges from:BUG-0010)
- BUG-0013 [P2][bug][-] PATCH with a non-finite number (1e999) NULLs a catalog column and answers 200  (scope:src/app/api/admin/records/[table]/[id]/route.ts,tests/offline/edit from:TASK-0017)
- BUG-0014 [P2][bug][M1] The 404 renders as Next's default inside the Frame: system-ui type off the scale, body fill off the palette  (scope:src/app/not-found.tsx,tests/offline/shell)
- BUG-0015 [P2][bug][M1] Frame: a hovered nav item is pixel-identical to the active one, so two items read as current  (scope:src/components/shell/shell.tsx,tests/offline/shell from:TASK-0005)
- BUG-0016 [P2][bug][M1] Browse's error line reads only 'TypeError: fetch failed': it names no read and drops the client's own cause  (scope:src/lib/db/result.ts,src/app/browse/page.tsx,tests/offline/db,tests/offline/browse from:TASK-0015)
- TASK-0008 [P2][task][M1] Gauge cards: the figure card, the trend table and the distribution view  (deps:TASK-0004,TASK-0007 scope:src/components/gauges,tests/offline/gauges-ui)
- TASK-0016 [P2][task][M1] Cycles & runs — the adapter framework's runs half  (deps:TASK-0014,TASK-0023(unmet:2) scope:src/app/cycles/page.tsx,src/lib/db/runs.ts,tests/offline/runs,tests/live/runs.live.test.ts)
- TASK-0020 [P2][task][M1] Compile docs/build_judgments.md for the milestone-close review  (deps:TASK-0019(unmet:1) scope:docs/build_judgments.md)
- TASK-0028 [P2][task][M1] tsconfig excludes agenticflow: a factory evidence file must not red tsc  (scope:tsconfig.json)

## claimed
- TASK-0018 [P1][task][M1] The edit surface — the record page, direct edits for groups and idols, read-only events and venues  (deps:TASK-0017,TASK-0004 scope:src/app/records/[table]/[id]/page.tsx,src/components/records,tests/offline/records,tests/live/edit.live.test.ts @builder-24)

## blocked
- TASK-0021 [P0][task][M1] ASK BEN: which Supabase env names does the APP read at runtime, and what do the campaign's live tests read?  (scope:src/lib/db/client.ts,tests/live,agenticflow/docs/SERVICES.md)
- TASK-0022 [P0][task][M1] ASK BEN: what is installed on staging, and may a live test write fixture rows into resolver-owned tables?  (scope:tests/live)
- TASK-0023 [P1][task][M1] ASK BEN: which of the adapter runs table's 22 columns does Cycles & runs show?  (scope:src/lib/db/runs.ts,src/app/cycles/page.tsx)
- TASK-0024 [P1][task][M1] ASK BEN: where does Admin read the per-source stuck_pattern dial, which lives only in scraper YAML?  (scope:src/lib/gauges/pending-claims.ts,src/app/sources/page.tsx)
- TASK-0025 [P2][task][M1] ASK BEN: what does the edit surface show for provenance on groups and idols, which have none?  (scope:src/app/records/[table]/[id]/page.tsx)

Totals — blocked:5, claimed:1, done:23, open:24. Archived: 0.
