# Tracker index (regenerated 2026-09-09T05:52:26Z — do not edit)

## open
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009 scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009 scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)

## claimed
- BUG-0086 [P2][bug][M2] Edit cell: opening one cell reflows the record table, so the next single click on another editable value is swallowed and the operator must click twice  (scope:src/components/EditableCell.tsx,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts @builder-165 from:TASK-0053)
- BUG-0100 [P3][bug][M2] The override surface calls a claim an 'observation' — the one noun the glossary pins hardest  (scope:src/app/records/[table]/[id]/page.tsx,tests/offline/ui/copy.test.ts @builder-167 from:designer:early-walk)

## built
- TASK-0056 [P1][task][M2] The entity_link fact item's two actions: link to an existing entity, or settle  (deps:TASK-0049,TASK-0055 scope:src/components/review/close/link-actions.tsx,tests/offline/review-item/link-actions.test.ts @builder-164)
- BUG-0094 [P2][bug][M2] A server component importing a value from a "use client" module 500s the record page, and every automated tier stays green  (scope:tests/offline/shell/client-boundary.test.ts,tests/http/records.http.test.ts @builder-166 from:BUG-0086)

## qa
- BUG-0098 [P2][bug][M2] A failed inline save shows the database's refusal and nothing else — no fix in the app's voice, unlike every read error  (scope:src/components/EditableCell.tsx,tests/offline/ui/editable-cell.test.ts @builder-162 from:designer:early-walk)
- BUG-0099 [P2][bug][M2] Links inside data tables announce themselves only under the pointer — the defect BUG-0054 fixed on /cycles, still shipping on three M2 surfaces  (scope:src/components/records/record-fields.tsx,src/components/queues/queue-list.tsx,src/components/review/evidence-cells.tsx,tests/offline/records/page.test.ts @builder-163 from:designer:early-walk)

Totals — built:2, claimed:2, done:48, open:2, qa:2, wont_fix:1. Archived: 124.
