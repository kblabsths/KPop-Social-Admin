# Tracker index (regenerated 2026-09-09T04:57:25Z — do not edit)

## open
- FEAT-0009 [P1][feat][M2] The two schema handoff artifacts, authored complete for Ben to install  (scope:agenticflow/tracker/for-human,agenticflow/docs/vision/SPEC.md)
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009(unmet:1) scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)
- TASK-0056 [P1][task][M2] The entity_link fact item's two actions: link to an existing entity, or settle  (deps:TASK-0049,TASK-0055(unmet:1) scope:src/components/review/close/link-actions.tsx,tests/offline/review-item/link-actions.test.ts)
- FEAT-0012 [P2][feat][M2] The reference field: a picker that links rows, and a reference that renders as a link  (deps:FEAT-0011(unmet:1) scope:src/lib/edit,src/app/records,src/components,src/lib/db,src/lib/records,tests/offline,tests/live)
- FEAT-0013 [P2][feat][M2] The verdict log made visible: a tab on Queues, and each settled item's verdict inline  (deps:FEAT-0010(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- BUG-0092 [P3][bug][M2] The inline verdict block draws dashes it neither owns nor explains  (scope:src/components/review/close/slot.tsx,tests/offline/review-item/verdict-inline.test.ts from:TASK-0059)

## claimed
- BUG-0086 [P2][bug][M2] Edit cell: opening one cell reflows the record table, so the next single click on another editable value is swallowed and the operator must click twice  (scope:src/components/EditableCell.tsx,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts @builder-156 from:TASK-0053)
- BUG-0094 [P2][bug][M2] A server component importing a value from a "use client" module 500s the record page, and every automated tier stays green  (scope:tests/offline/shell/client-boundary.test.ts,tests/http/records.http.test.ts @builder-157 from:BUG-0086)
- BUG-0095 [P2][bug][M2] An invisible-only cell value is stored as content while every surface draws it as an absence  (scope:src/app/api/admin/records/[table]/[id]/route.ts,src/components/EditableCell.tsx,tests/offline/edit/route.test.ts @builder-158 from:qa:BUG-0089)
- TASK-0055 [P2][task][M2] The reference field edits as an entity picker whose choice carries its confirmed match  (deps:TASK-0042,TASK-0048,TASK-0054 scope:src/components/records/entity-picker.tsx,src/lib/db/records.ts,tests/offline/records/entity-picker.test.ts,tests/offline/records/records-read.test.ts @builder-152)

## qa
- BUG-0093 [P2][bug][M2] the artifact allocates KS027/KS028, which the sibling's staging harness doors already raise  (scope:agenticflow/tracker/for-human/M2-handoff-settle-review-item.md,tests/offline/handoff/settle-review-item.test.ts @builder-154 from:BUG-0088)
- TASK-0059 [P2][task][M2] A settled review item's detail carries its own verdict inline  (deps:TASK-0058,TASK-0049 scope:src/app/queues/[reviewItemId]/page.tsx,src/lib/db/verdict.ts,src/lib/db/review-item.ts,src/components/review/close/slot.tsx,tests/offline/review-item/verdict-inline.test.ts,tests/live/review-item.live.test.ts @builder-155)

Totals — claimed:4, done:38, open:7, qa:2, wont_fix:1. Archived: 124.
