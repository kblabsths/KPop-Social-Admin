# Tracker index (regenerated 2026-09-02T15:49:49Z — do not edit)

## open
- FEAT-0001 [P1][feat][M1] Remove the deprecated app and stand up the window shell
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0006 [P1][feat][M1] The six threshold gauges  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0008 [P1][feat][M1] The edit surface — the config map and pre-cutover direct edits  (deps:FEAT-0001,FEAT-0002(unmet:2))
- TASK-0019 [P1][task][M1] Cross-page proofs: graceful absence on all six pages, in_window nowhere, auth on every route, zero residue  (deps:TASK-0009,TASK-0010,TASK-0011,TASK-0012,TASK-0013,TASK-0014,TASK-0015,TASK-0018,TASK-0027 scope:tests/offline/absence,tests/http,tests/live/residue.live.test.ts)
- TASK-0016 [P2][task][M1] Cycles & runs — the adapter framework's runs half  (deps:TASK-0014,TASK-0023(unmet:1) scope:src/app/cycles/page.tsx,src/lib/db/runs.ts,tests/offline/runs,tests/live/runs.live.test.ts)
- TASK-0020 [P2][task][M1] Compile docs/build_judgments.md for the milestone-close review  (deps:TASK-0019(unmet:1) scope:docs/build_judgments.md)

## claimed
- BUG-0022 [P2][bug][-] Sources narrowed to one source reports the FLEET's unattributed-rejection count as that source's  (scope:src/app/sources/page.tsx,tests/offline/sources @builder-48 from:TASK-0013)

## blocked
- TASK-0021 [P0][task][M1] ASK BEN: which Supabase env names does the APP read at runtime, and what do the campaign's live tests read?  (scope:src/lib/db/client.ts,tests/live,agenticflow/docs/SERVICES.md)
- TASK-0022 [P0][task][M1] ASK BEN: what is installed on staging, and may a live test write fixture rows into resolver-owned tables?  (scope:tests/live)
- FEAT-0003 [P1][feat][M1] Dashboard — the breakfast view  (deps:FEAT-0001,FEAT-0002(unmet:2))
- TASK-0023 [P1][task][M1] ASK BEN: which of the adapter runs table's 22 columns does Cycles & runs show?  (scope:src/lib/db/runs.ts,src/app/cycles/page.tsx)
- TASK-0024 [P1][task][M1] ASK BEN: where does Admin read the per-source stuck_pattern dial, which lives only in scraper YAML?  (scope:src/lib/gauges/pending-claims.ts,src/app/sources/page.tsx)
- TASK-0025 [P2][task][M1] ASK BEN: what does the edit surface show for provenance on groups and idols, which have none?  (scope:src/app/records/[table]/[id]/page.tsx)
- TASK-0029 [P2][task][M1] ASK: what does a resolver-owned record page DISPLAY in M1? events/venues currently render their id and nothing else  (scope:src/lib/edit/config.ts,src/lib/db/records.ts from:TASK-0018)

Totals — blocked:7, claimed:1, done:46, open:8. Archived: 0.
