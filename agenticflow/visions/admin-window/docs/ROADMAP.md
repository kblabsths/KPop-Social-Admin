# ROADMAP — campaign `admin-window`

Authority: `contracts/admin-observability.md` (the spec) and
`contracts/admin-build.md` (the acceptance doc), both read 2026-09-01.
North star: `agenticflow/docs/vision/VISION.md` (frozen 2026-09-01).
Behavior: `agenticflow/docs/vision/SPEC.md`.

The spec's own shape decides the milestones: **"v1 is two slices: the read
surfaces, then the verdict path"** and **"the two slices land on different
clocks"** (spec §2). The read slice touches only this repo and needs zero
schema. The verdict slice's schema lives in the scraper repo and lands after
the resolver campaign closes there.

| milestone | the slice | schema footprint | acceptance tests |
| --- | --- | --- | --- |
| **M1** | read surfaces + the pre-cutover edit surface | **zero** | 1, 2, 3, 4, 5, 7 (pre-cutover half), 9, 10, 11, 12, 13 |
| **M2** | the verdict slice: UI built, both migrations authored as handoffs | **zero installed** | (M1's, still green) + both handoffs complete and reviewed |
| **patch run** (deferred) | live proof of the §7 actions, after Ben installs the handoffs | the two §9 items, installed by Ben | 6, 8, 7 (override half) |

---

## M1 — the read slice, plus editing what is safe to edit today

**Precisely: the app becomes the window, and nothing it does needs a migration.**

In:

1. **F1 — the old app is gone; the window's shell stands.** Overview,
   Analytics, Data Management and Database removed outright; the six-page
   navigation behind the existing gate; sign-in, server-side service role and
   the Railway deploy carried over untouched. (spec §3, §10)
2. **F2 — staging reads, honest absence, and the live/offline test harness.**
   Server-side reads against the staging project by name; a not-provisioned
   state on every ecosystem page when its tables are absent; an offline-by-
   default suite with staging tests behind a live marker that sweep what they
   write; the per-page parity mechanism. (tests 1, 2, 9, 13)
3. **F3 — Dashboard**, the breakfast view. (spec §4)
4. **F4 — Queues and the review item rendered**, read-only: two queues, shape
   filters, three typed detail views, evidence resolved beside canonical and
   its provenance. The close is M2's. (spec §4, §6; tests 4, 5)
5. **F5 — Claims, Sources, Cycles & runs.** (spec §4; test 3)
6. **F6 — the six gauges**, as server-side queries in this app. (spec §5;
   test 11)
7. **F7 — Browse: recent events**, one curated view with its column selector.
   (spec §4; test 10)
8. **F8 — the edit surface, pre-cutover half**: the one hand-written
   `{table → editable columns}` map, `groups` / `idols` editing directly
   within it, a column absent from the map refusing even a forged request.
   (spec §8; test 7's pre-cutover half)

Out (M1 must not depend on any of it): the verdict actions, the `verdicts`
log, `settle_review_item`, the events/venues override path, the reference
picker, both §9 migrations, and every parked section.

**Preconditions, human-owned** (M1 cannot reach its live tests without them):

- `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` present in
  `.env` (names only in `.env.example`). As of 2026-09-01 the file carries
  neither name; an unset name is a refusal, never a fallback.
- The staging Supabase project declared in `agenticflow/docs/SERVICES.md` —
  the remote gate refuses an undeclared service's CLI, and nothing matching
  prod is ever a target.

Exit criteria: `agenticflow/tracker/milestones/M1.md`.

---

## M2 — the verdict slice (sketch)

Loose by design; it gets its precision when M1 closes and real M2 review items
exist to render (spec §6 calls its own anatomy the weakest-held section).

Roughly:

- **The two handoff artifacts, authored complete**: the `verdicts` table and
  `settle_review_item` (spec §7, §9) — exact file content, target path, apply
  command, filed as blocked handoff tickets for Ben to install from the scraper
  repo. Nothing in this repo applies them.
- **The §7 verdict UI**: on a decision item, choose a claimed value / supply a
  different value / keep current & settle (`data_conflict`), link to an
  existing entity / settle (`entity_link`); on a signal item, `fixed` or
  `wont_fix` with its required note. One typed decision per action, the note
  field beside it.
- **The override half of the edit surface**: `events` and `venues` edit only as
  admin-tier observations through the gate, applied through `apply_resolution`,
  provenance stamped `admin_locked`, logged in `verdicts` as `override`; the
  reference field edits through an entity picker whose choice carries the
  confirmed match. Per-field provenance shows at the field.
- **The bar M2 closes on**: the verdict UI is built and both handoffs are
  complete and reviewed. **M2 is satisfiable with zero installed schema** — the
  campaign never blocks on the resolver campaign's close.

## The deferred patch run — live proof of the §7 actions

Named here so nobody mistakes it for a hole. **After** the resolver campaign
closes and **Ben installs** the two §9 migrations, a patch run proves on
staging: every §7 action end to end, one transaction per settlement with its
apply and rejection stamps sharing a timestamp, a killed call leaving no
partial write, `wont_fix` without a note refused, grant introspection showing
`verdicts` written and `review_items.status` set by `settle_review_item`
alone, an events/venues edit landing as an `admin_locked` observation with its
`override` row, and a reference-field override producing `venue_id` /
`event_performers` rows instead of text. → **tests 6, 8, and test 7's override
half.** This is the one acceptance item deliberately deferred (VISION).

## Not on this roadmap, ever, under this campaign

Production as a target; repointing the deployed service; any schema beyond the
two handoff items; the parked operator, free-form tickets, recommendations,
incidents, agent runs, commands, registry mirror, severity formula, AI calls;
the mobile app, the scrapers, the pipeline's rules, app-user social data.
