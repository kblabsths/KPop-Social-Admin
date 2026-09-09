# Tracker index (regenerated 2026-09-09T01:16:11Z — do not edit)

## open
- FEAT-0009 [P1][feat][M2] The two schema handoff artifacts, authored complete for Ben to install  (scope:agenticflow/tracker/for-human,agenticflow/docs/vision/SPEC.md)
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009(unmet:1) scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)
- TASK-0045 [P1][task][M2] The verdicts table, authored complete as a handoff artifact Ben installs by hand  (deps:TASK-0042(unmet:1) scope:agenticflow/tracker/for-human/M2-handoff-verdicts.md,tests/offline/handoff/extract.ts,tests/offline/handoff/verdicts.test.ts)
- TASK-0046 [P1][task][M2] settle_review_item, authored complete against the installed apply_resolution and gate  (deps:TASK-0042,TASK-0043,TASK-0045(unmet:3) scope:agenticflow/tracker/for-human/M2-handoff-settle-review-item.md,tests/offline/handoff/settle-review-item.test.ts)
- FEAT-0012 [P2][feat][M2] The reference field: a picker that links rows, and a reference that renders as a link  (deps:FEAT-0011(unmet:1) scope:src/lib/edit,src/app/records,src/components,src/lib/db,src/lib/records,tests/offline,tests/live)
- FEAT-0013 [P2][feat][M2] The verdict log made visible: a tab on Queues, and each settled item's verdict inline  (deps:FEAT-0010(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- TASK-0037 [P2][task][patch] Prove the walk sandbox on staging once Ben pastes it, and retire the interim walk-write exception  (scope:tests/walk,tests/live,agenticflow/docs/vision/STACK.md,agenticflow/docs/DECISIONS.md from:inbox:2026-09-03-walker-sandbox-table.md)
- TASK-0039 [P3][task][patch] Dashboard: one line saying when the resolver last actually applied something  (scope:src/app/page.tsx,src/components,src/lib/db,src/lib/gauges,tests/offline,tests/live/dashboard.live.test.ts from:M1-endgame-user-sim)

## claimed
- TASK-0040 [P1][task][patch] Strike the direct-edit path: groups/idols leave EDIT_CONFIG, and every surface that assumed it is reconciled  (scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http @builder-118 from:inbox:2026-09-09-vision-amendment.md)
- TASK-0041 [P1][task][patch] Retire the interim groups/idols walk-write exception from the walk docs  (scope:agenticflow/docs/vision/STACK.md,agenticflow/tracker/for-human,agenticflow/docs/DECISIONS.md @builder-119 from:inbox:2026-09-09-vision-amendment.md)
- TASK-0042 [P1][task][M2] The verdict decision envelope: one typed decision, a pure leaf, the shape the SQL reads  (scope:src/lib/verdict/decision.ts,tests/offline/verdict/decision.test.ts,tests/offline/db/layering.test.ts @builder-120)

## built
- TASK-0038 [P3][task][patch] Adopt the five residual designer bars into LOOK_AND_FEEL and clarify copy bar 6  (scope:agenticflow/docs/vision/LOOK_AND_FEEL.md @designer from:M1-endgame-user-sim)

## blocked
- TASK-0043 [P1][task][M2] ASK Ben: which registered sources row is the admin voice, and does it exist on staging  (scope:agenticflow/tracker/for-human)
- TASK-0044 [P1][task][M2] ASK Ben: which columns of events and venues are editable at all  (scope:agenticflow/tracker/for-human)

Totals — blocked:2, built:1, claimed:3, done:5, open:9. Archived: 124.
