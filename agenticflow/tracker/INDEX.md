# Tracker index (regenerated 2026-09-09T05:36:14Z — do not edit)

## open
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009 scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009 scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)
- FEAT-0012 [P2][feat][M2] The reference field: a picker that links rows, and a reference that renders as a link  (deps:FEAT-0011(unmet:1) scope:src/lib/edit,src/app/records,src/components,src/lib/db,src/lib/records,tests/offline,tests/live)
- BUG-0100 [P3][bug][M2] The override surface calls a claim an 'observation' — the one noun the glossary pins hardest  (scope:src/app/records/[table]/[id]/page.tsx,tests/offline/ui/copy.test.ts from:designer:early-walk)

## claimed
- TASK-0056 [P1][task][M2] The entity_link fact item's two actions: link to an existing entity, or settle  (deps:TASK-0049,TASK-0055 scope:src/components/review/close/link-actions.tsx,tests/offline/review-item/link-actions.test.ts @builder-164)
- BUG-0086 [P2][bug][M2] Edit cell: opening one cell reflows the record table, so the next single click on another editable value is swallowed and the operator must click twice  (scope:src/components/EditableCell.tsx,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts @builder-165 from:TASK-0053)
- BUG-0098 [P2][bug][M2] A failed inline save shows the database's refusal and nothing else — no fix in the app's voice, unlike every read error  (scope:src/components/EditableCell.tsx,tests/offline/ui/editable-cell.test.ts @builder-162 from:designer:early-walk)

## built
- BUG-0099 [P2][bug][M2] Links inside data tables announce themselves only under the pointer — the defect BUG-0054 fixed on /cycles, still shipping on three M2 surfaces  (scope:src/components/records/record-fields.tsx,src/components/queues/queue-list.tsx,src/components/review/evidence-cells.tsx,tests/offline/records/page.test.ts @builder-163 from:designer:early-walk)

## qa
- BUG-0095 [P2][bug][M2] An invisible-only cell value is stored as content while every surface draws it as an absence  (scope:src/app/api/admin/records/[table]/[id]/route.ts,src/components/EditableCell.tsx,tests/offline/edit/route.test.ts @builder-159 from:qa:BUG-0089)
- BUG-0096 [P2][bug][M2] The close sits 3,500px below the evidence it closes, so the operator scrolls four screenfuls to act  (scope:src/app/queues/[reviewItemId]/page.tsx,tests/offline/review-item/page.test.ts @builder-160 from:designer:early-walk)
- BUG-0097 [P2][bug][-] The entity picker keeps every option clickable while a choice is saving: a second click sends a second override for the same field  (scope:src/components/records/entity-picker.tsx,tests/offline/records/entity-picker.test.ts @builder-161 from:TASK-0055)

## reopened
- BUG-0094 [P2][bug][M2] A server component importing a value from a "use client" module 500s the record page, and every automated tier stays green  (scope:tests/offline/shell/client-boundary.test.ts,tests/http/records.http.test.ts from:BUG-0086)

Totals — built:1, claimed:3, done:44, open:4, qa:3, reopened:1, wont_fix:1. Archived: 124.
