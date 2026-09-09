# Tracker index (regenerated 2026-09-09T04:40:53Z — do not edit)

## open
- FEAT-0009 [P1][feat][M2] The two schema handoff artifacts, authored complete for Ben to install  (scope:agenticflow/tracker/for-human,agenticflow/docs/vision/SPEC.md)
- FEAT-0010 [P1][feat][M2] The verdict UI: every spec 7 action as one typed decision, one call, one transaction  (deps:FEAT-0009(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- FEAT-0011 [P1][feat][M2] The edit surface's override half: events and venues write only as recorded overrides  (deps:FEAT-0009(unmet:1) scope:src/lib/edit,src/app/records,src/app/api/admin,src/components,src/lib/db,tests/offline,tests/live,tests/http)
- TASK-0056 [P1][task][M2] The entity_link fact item's two actions: link to an existing entity, or settle  (deps:TASK-0049,TASK-0055(unmet:1) scope:src/components/review/close/link-actions.tsx,tests/offline/review-item/link-actions.test.ts)
- FEAT-0012 [P2][feat][M2] The reference field: a picker that links rows, and a reference that renders as a link  (deps:FEAT-0011(unmet:1) scope:src/lib/edit,src/app/records,src/components,src/lib/db,src/lib/records,tests/offline,tests/live)
- FEAT-0013 [P2][feat][M2] The verdict log made visible: a tab on Queues, and each settled item's verdict inline  (deps:FEAT-0010(unmet:1) scope:src/app/queues,src/components,src/lib/db,src/lib/review,tests/offline,tests/live)
- BUG-0092 [P3][bug][M2] The inline verdict block draws dashes it neither owns nor explains  (scope:src/components/review/close/slot.tsx,tests/offline/review-item/verdict-inline.test.ts from:TASK-0059)

## claimed
- BUG-0091 [P2][bug][M2] the settle route accepts a text-carrying supply_value for a reference fact — the reference rule is guarded only by the courtesy layer  (scope:src/lib/verdict/decision.ts,tests/offline/review-item/conflict-actions.test.ts @builder-151 from:qa:BUG-0087)
- BUG-0093 [P2][bug][M2] the artifact allocates KS027/KS028, which the sibling's staging harness doors already raise  (scope:agenticflow/tracker/for-human/M2-handoff-settle-review-item.md,tests/offline/handoff/settle-review-item.test.ts @builder-154 from:BUG-0088)
- TASK-0055 [P2][task][M2] The reference field edits as an entity picker whose choice carries its confirmed match  (deps:TASK-0042,TASK-0048,TASK-0054 scope:src/components/records/entity-picker.tsx,src/lib/db/records.ts,tests/offline/records/entity-picker.test.ts,tests/offline/records/records-read.test.ts @builder-152)

## built
- DEBT-0007 [P3][debt][M2] a fact identifier is hand-spelled ${domain}.${field} in four places, one of them now load-bearing for the reference rule  (scope:src/lib/verdict/decision.ts,src/components/review/close/conflict-actions.tsx,src/components/claims/claim-list.tsx,src/app/queues/[reviewItemId]/page.tsx @builder-153 from:qa:BUG-0087)

## qa
- BUG-0086 [P2][bug][M2] Edit cell: opening one cell reflows the record table, so the next single click on another editable value is swallowed and the operator must click twice  (scope:src/components/EditableCell.tsx,src/components/records/record-fields.tsx,tests/offline/ui/editable-cell.test.ts @builder-144 from:TASK-0053)
- BUG-0089 [P2][bug][M2] A wont_fix note of invisible characters passes all three note guards and settles the item  (scope:src/components/review/close/actions.ts,src/lib/verdict/decision.ts,tests/offline/review-item/signal-actions.test.ts,tests/offline/verdict/decision.test.ts @builder-149 from:TASK-0051)
- BUG-0090 [P2][bug][M2] the venue reference column shows no provenance: the log is queried by column name, and that fact is registered as 'venue'  (scope:src/lib/db/records.ts,src/lib/edit/config.ts,tests/offline/edit/records.test.ts @builder-150 from:TASK-0054)

## reopened
- TASK-0059 [P2][task][M2] A settled review item's detail carries its own verdict inline  (deps:TASK-0058,TASK-0049 scope:src/app/queues/[reviewItemId]/page.tsx,src/lib/db/verdict.ts,src/lib/db/review-item.ts,src/components/review/close/slot.tsx,tests/offline/review-item/verdict-inline.test.ts,tests/live/review-item.live.test.ts)

Totals — built:1, claimed:3, done:34, open:7, qa:3, reopened:1, wont_fix:1. Archived: 124.
