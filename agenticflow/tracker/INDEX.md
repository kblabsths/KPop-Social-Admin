# Tracker index (regenerated 2026-09-03T21:39:24Z — do not edit)

## open
- BUG-0038 [P2][bug][M1] STACK.md 5's walk caveat is false: the walker identity is allowlisted on staging and its saves land  (scope:agenticflow/docs/vision/STACK.md from:TASK-0033)
- TASK-0034 [P2][task][patch] Rule the walk sandbox: a staging-only table walkers may edit, created and reset by kit-side tooling  (scope:agenticflow/docs/vision/ARCHITECTURE.md,agenticflow/docs/vision/STACK.md,agenticflow/docs/DECISIONS.md from:inbox:2026-09-03-walker-sandbox-table.md)
- TASK-0035 [P2][task][patch] The walk sandbox in the one map: an EDIT_CONFIG entry that renders not-provisioned wherever the table is absent  (deps:TASK-0034(unmet:1) scope:src/lib/edit/config.ts,src/lib/db/tables.ts,tests/offline/edit/config.test.ts,tests/offline/records/page.test.ts,tests/live/residue.live.test.ts,tests/http/auth.http.test.ts from:inbox:2026-09-03-walker-sandbox-table.md)
- TASK-0036 [P2][task][patch] Reset the walk sandbox between walks: the seed fixture, the reset tool, and the walk recipe  (deps:TASK-0034(unmet:1) scope:tests/walk,agenticflow/docs/vision/STACK.md from:inbox:2026-09-03-walker-sandbox-table.md)

Totals — done:81, open:4. Archived: 0.
