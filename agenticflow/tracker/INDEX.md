# Tracker index (regenerated 2026-09-09T03:44:35Z — do not edit)

## open
- FEAT-0009 [P1][feat][M2] The two schema handoff artifacts, authored complete for Ben to install  (scope:agenticflow/tracker/for-human,agenticflow/docs/vision/SPEC.md)
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009(unmet:1) scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)
- TASK-0056 [P1][task][M2] The entity_link fact item's two actions: link to an existing entity, or settle  (deps:TASK-0049,TASK-0055(unmet:1) scope:src/components/review/close/link-actions.tsx,tests/offline/review-item/link-actions.test.ts)
- FEAT-0012 [P2][feat][M2] The reference field: a picker that links rows, and a reference that renders as a link  (deps:FEAT-0011(unmet:1) scope:src/lib/edit,src/app/records,src/components,src/lib/db,src/lib/records,tests/offline,tests/live)
- FEAT-0013 [P2][feat][M2] The verdict log made visible: a tab on Queues, and each settled item's verdict inline  (deps:FEAT-0010(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- TASK-0055 [P2][task][M2] The reference field edits as an entity picker whose choice carries its confirmed match  (deps:TASK-0042,TASK-0048,TASK-0054(unmet:1) scope:src/components/records/entity-picker.tsx,src/lib/db/records.ts,tests/offline/records/entity-picker.test.ts,tests/offline/records/records-read.test.ts)
- TASK-0059 [P2][task][M2] A settled review item's detail carries its own verdict inline  (deps:TASK-0058,TASK-0049 scope:src/app/queues/[reviewItemId]/page.tsx,src/lib/db/verdict.ts,src/lib/db/review-item.ts,src/components/review/close/slot.tsx,tests/offline/review-item/verdict-inline.test.ts,tests/live/review-item.live.test.ts)

## claimed
- TASK-0046 [P1][task][M2] settle_review_item, authored complete against the installed apply_resolution and gate  (deps:TASK-0042,TASK-0045 scope:agenticflow/tracker/for-human/M2-handoff-settle-review-item.md,tests/offline/handoff/settle-review-item.test.ts,src/lib/verdict/decision.ts @builder-142)
- TASK-0054 [P1][task][M2] The override write path: events and venues edit only as recorded admin-tier observations  (deps:TASK-0048,TASK-0052,TASK-0040 scope:src/lib/edit/config.ts,src/app/api/admin/records/[table]/[id]/route.ts,src/app/records/[table]/[id]/page.tsx,src/components/records/record-fields.tsx,src/components/records/field-editor.tsx,tests/offline/edit/config.test.ts,tests/offline/edit/route.test.ts,tests/offline/records/page.test.ts,tests/http/edit.http.test.ts @builder-143)
- BUG-0086 [P2][bug][M2] Edit cell: opening one cell reflows the record table, so the next single click on another editable value is swallowed and the operator must click twice  (scope:src/components/EditableCell.tsx,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts @builder-144 from:TASK-0053)

## qa
- TASK-0050 [P1][task][M2] The data_conflict item's three verdict actions, one typed decision each  (deps:TASK-0049 scope:src/components/review/close/conflict-actions.tsx,tests/offline/review-item/conflict-actions.test.ts @builder-139)
- BUG-0085 [P2][bug][M2] the verdict log renders a present-but-blank note as an empty cell, not the mandated dash  (@builder-141 from:TASK-0058)

## reopened
- TASK-0051 [P1][task][M2] The signal item's two dispositions: fixed, and wont_fix with its required note  (deps:TASK-0049 scope:src/components/review/close/signal-actions.tsx,tests/offline/review-item/signal-actions.test.ts)

Totals — claimed:3, done:27, open:8, qa:2, reopened:1, wont_fix:1. Archived: 124.
