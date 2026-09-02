# Tracker index (regenerated 2026-09-02T16:44:18Z — do not edit)

## open
- TASK-0021 [P0][task][M1] ASK BEN: which Supabase env names does the APP read at runtime, and what do the campaign's live tests read?  (scope:src/lib/db/client.ts,tests/live,agenticflow/docs/SERVICES.md)
- TASK-0022 [P0][task][M1] ASK BEN: what is installed on staging, and may a live test write fixture rows into resolver-owned tables?  (scope:tests/live)
- FEAT-0001 [P1][feat][M1] Remove the deprecated app and stand up the window shell
- FEAT-0002 [P1][feat][M1] Staging reads, the not-provisioned state, and the live/offline test harness
- FEAT-0005 [P1][feat][M1] Claims, Sources, and Cycles and runs  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0006 [P1][feat][M1] The six threshold gauges  (deps:FEAT-0001,FEAT-0002(unmet:2))
- FEAT-0008 [P1][feat][M1] The edit surface — the config map and pre-cutover direct edits  (deps:FEAT-0001,FEAT-0002(unmet:2))
- TASK-0023 [P1][task][M1] ASK BEN: which of the adapter runs table's 22 columns does Cycles & runs show?  (scope:src/lib/db/runs.ts,src/app/cycles/page.tsx)
- TASK-0024 [P1][task][M1] ASK BEN: where does Admin read the per-source stuck_pattern dial, which lives only in scraper YAML?  (scope:src/lib/gauges/pending-claims.ts,src/app/sources/page.tsx)
- TASK-0032 [P1][task][M1] Live oracles must name the page's state kind: an ERROR page may not pass and an EMPTY page may not fail  (deps:BUG-0027(unmet:1) scope:tests/live,tests/offline/live-guard.test.ts,src/components/ui from:TASK-0012)
- BUG-0026 [P2][bug][-] Dashboard renders 10 blank table cells when error_summary is null (component body defeats orDash)  (scope:src/app/page.tsx,tests/offline/dashboard,tests/offline/absence from:TASK-0019)
- BUG-0028 [P2][bug][M1] The write-path guard bans the admin_locked column NAME, so the provenance display spec §8 requires cannot be built  (scope:tests/offline/edit from:TASK-0011)
- TASK-0016 [P2][task][M1] Cycles & runs — the adapter framework's runs half  (deps:TASK-0014,TASK-0023(unmet:1) scope:src/app/cycles/page.tsx,src/lib/db/runs.ts,tests/offline/runs,tests/live/runs.live.test.ts)
- TASK-0020 [P2][task][M1] Compile docs/build_judgments.md for the milestone-close review  (deps:TASK-0019 scope:docs/build_judgments.md)
- TASK-0025 [P2][task][M1] ASK BEN: what does the edit surface show for provenance on groups and idols, which have none?  (scope:src/app/records/[table]/[id]/page.tsx)
- TASK-0029 [P2][task][M1] ASK: what does a resolver-owned record page DISPLAY in M1? events/venues currently render their id and nothing else  (deps:BUG-0028(unmet:1) scope:src/lib/edit/config.ts,src/lib/db/records.ts,src/app/records,src/components/records,tests/offline/records,tests/offline/edit from:TASK-0018)
- BUG-0027 [P3][bug][M1] An empty queue renders no open count: /queues drops the figure the Dashboard renders as a real 0  (scope:src/app/queues/page.tsx,src/components/queues,tests/offline/queues from:TASK-0010)

## qa
- BUG-0024 [P1][bug][M1] Review-item evidence is always empty on staging: the app selects observations.entity_type, a column the schema owner dropped  (scope:src/lib/db/review-item.ts,tests/live/review-item.live.test.ts,tests/offline/review-item @builder-50 from:TASK-0011)

## blocked
- TASK-0031 [P1][task][M1] ASK BEN: pending_claims view times out on staging (handoff: index or view rewrite in the scraper repo)  (scope:agenticflow/docs/vision/ARCHITECTURE.md)

Totals — blocked:1, done:51, open:17, qa:1. Archived: 0.
