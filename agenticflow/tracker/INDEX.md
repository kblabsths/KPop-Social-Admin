# Tracker index (regenerated 2026-09-09T06:10:56Z — do not edit)

## open
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009 scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009 scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)

## claimed
- BUG-0101 [P2][bug][M2] A refusal on a record's LAST field draws its app-voice half outside the table's clipping container - the half BUG-0098 shipped is the half that disappears  (scope:src/components/EditableCell.tsx,src/components/edit-cell-layout.ts,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts,tests/offline/records/page.test.ts @builder-168 from:BUG-0098)

## built
- BUG-0102 [P2][bug][M2] the close's picker stays live while a settlement is in flight, and drops the row it is clicked with  (scope:src/components/review/close/form.tsx,tests/offline/review-item/link-actions.test.ts @builder-169 from:TASK-0056)

## qa
- BUG-0086 [P2][bug][M2] Edit cell: opening one cell reflows the record table, so the next single click on another editable value is swallowed and the operator must click twice  (scope:src/components/EditableCell.tsx,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts @builder-165 from:TASK-0053)

## reopened
- BUG-0098 [P2][bug][M2] A failed inline save shows the database's refusal and nothing else — no fix in the app's voice, unlike every read error  (scope:src/components/EditableCell.tsx,tests/offline/ui/editable-cell.test.ts from:designer:early-walk)

Totals — built:1, claimed:1, done:52, open:2, qa:1, reopened:1, wont_fix:1. Archived: 124.
