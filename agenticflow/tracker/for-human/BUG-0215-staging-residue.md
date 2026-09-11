# Ben: one staging row to put back (admin-window/BUG-0215)

**What happened.** The §9 settlement path (`verdicts` + `settle_review_item`)
was installed on staging on 2026-09-11, mid-campaign. Two live tests had its
ABSENCE written into them as a premise instead of reading it from the database.
One of them — `tests/live/edit.live.test.ts`, "answers a mapped column's
override with the absence" — then sent a real value-carrying override on every
run: the function applied it. That is fixed in this ticket (both cases now read
the world and neither applies an override, in either world), so **nothing adds
to what is below any more**. Two QA runs produced it; my runs since the fix
added nothing (re-read after each run).

**What is left on `ubfjjqlvnpnoborczbdb`, and only a write can clear it.** Admin
may not write a resolver-owned catalog table, and the live suite writes only
`walk_sandbox`, so this is yours:

- `events.event_id = 01a03c9b-1d28-707d-9873-f73ab3add10c`
  `title` = `admin-window/TASK-0018 probe override`.
  **Its real value is `XG`** — confirmed two ways: QA read it off the record
  page before the override, and the pipeline's own observation of that fact
  still holds it (`observations.observation_id = 01a058f1-00d1-7978-8f6e-7399255d1884`,
  `value = "XG"`, source `01a05782-…`, observed 2026-08-31).
- `field_provenance`: two rows for that event's `title`, both
  `admin_locked = true` (`01a092cb-d019-…`, `01a092cb-0afc-…`). While the lock
  stands the resolver will leave that field alone, so restoring the value
  without clearing the lock leaves the field frozen at whatever it is set to.
- `verdicts`: two `action = override` rows, actor `live-suite@example.invalid`
  (2026-09-11T23:26:15Z and 23:27:05Z), plus the applied admin observation
  `01a092cb-0ad1-7257-aa39-30187a5ecdf2`. The service role cannot delete a
  verdict; whether the log should keep these two (it IS a log) or you prune
  them is your call, not this ticket's.

**Until the `events.title` value goes back, `npm run test:live` exits 1** — and
it should: `tests/live/residue.live.test.ts` is doing exactly its job, naming
`events.title: 1 row(s)` after three re-checks. Every other live file is green
(measured on this branch: `Test Files 1 failed | 10 passed (11)`, `Tests 1
failed | 121 passed (122)`), and the one failure is this row, not a test.

**Paste-ready, for the staging SQL editor** (staging only — this row is
staging's; nothing here is a migration and nothing in this repo runs it):

```sql
-- 1. the value the pipeline observed, back where it was
update public.events
   set title = 'XG'
 where event_id = '01a03c9b-1d28-707d-9873-f73ab3add10c'
   and title = 'admin-window/TASK-0018 probe override';

-- 2. the lock those overrides left, so the resolver owns the field again
update public.field_provenance
   set admin_locked = false
 where entity_type = 'events'
   and entity_id = '01a03c9b-1d28-707d-9873-f73ab3add10c'
   and field = 'title'
   and admin_locked;
```

Then `npm run test:live` should exit 0. If `residue.live.test.ts` still names a
row after that, it is telling you the update did not land — read what it names
rather than re-running it.
