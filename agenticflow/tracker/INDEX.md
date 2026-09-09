# Tracker index (regenerated 2026-09-09T05:11:59Z — do not edit)

## open
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009 scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009 scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)
- TASK-0056 [P1][task][M2] The entity_link fact item's two actions: link to an existing entity, or settle  (deps:TASK-0049,TASK-0055(unmet:1) scope:src/components/review/close/link-actions.tsx,tests/offline/review-item/link-actions.test.ts)
- FEAT-0012 [P2][feat][M2] The reference field: a picker that links rows, and a reference that renders as a link  (deps:FEAT-0011(unmet:1) scope:src/lib/edit,src/app/records,src/components,src/lib/db,src/lib/records,tests/offline,tests/live)

## qa
- BUG-0086 [P2][bug][M2] Edit cell: opening one cell reflows the record table, so the next single click on another editable value is swallowed and the operator must click twice  (scope:src/components/EditableCell.tsx,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts @builder-156 from:TASK-0053)
- BUG-0094 [P2][bug][M2] A server component importing a value from a "use client" module 500s the record page, and every automated tier stays green  (scope:tests/offline/shell/client-boundary.test.ts,tests/http/records.http.test.ts @builder-157 from:BUG-0086)
- TASK-0055 [P2][task][M2] The reference field edits as an entity picker whose choice carries its confirmed match  (deps:TASK-0042,TASK-0048,TASK-0054 scope:src/components/records/entity-picker.tsx,src/lib/db/records.ts,tests/offline/records/entity-picker.test.ts,tests/offline/records/records-read.test.ts @builder-152)

## reopened
- BUG-0095 [P2][bug][M2] An invisible-only cell value is stored as content while every surface draws it as an absence  (scope:src/app/api/admin/records/[table]/[id]/route.ts,src/components/EditableCell.tsx,tests/offline/edit/route.test.ts from:qa:BUG-0089)

Totals — done:43, open:4, qa:3, reopened:1, wont_fix:1. Archived: 124.
