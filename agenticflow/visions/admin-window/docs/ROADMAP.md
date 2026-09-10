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

| milestone | the slice | schema footprint | acceptance tests | status |
| --- | --- | --- | --- | --- |
| **M1** | read surfaces + the pre-cutover edit surface | **zero** | 1, 2, 3, 4, 5, 7 (pre-cutover half), 9, 10, 11, 12, 13 | **SHIPPED** 2026-09-04, tag `m1` at 26cec8d |
| **M2** | the verdict slice: UI built, both migrations authored as handoffs | **zero installed** | (M1's, still green) + both handoffs complete and reviewed | **SHIPPED** 2026-09-10, tag `m2` at f194991 |
| **M3** | completeness of the read slice: paging past the window, and every windowed figure honest | **zero** (one handoff already installed by Ben) | (M1's and M2's, still green) + M3's own | **PLANNED 2026-09-10** — Ben's ruling, below |
| **patch run** (deferred) | live proof of the §7 actions, after Ben installs the handoffs | the two §9 items, installed by Ben | 6, 8, 7 (override half) | after Ben installs |

## Is the vision satisfied? Not yet — and M3 exists because Ben said so

**Stated plainly, at the M2 close (2026-09-10).** VISION's satisfaction sentence
is *"the verdict UI is built and both handoffs are complete and reviewed."* The
verifier walked the first half green and the second half is **half met**: both
artifacts are authored complete, with target paths, apply commands, seven
columns, RLS on with zero policies and the `wont_fix` refusal inside the
function — but "reviewed" is Ben's word and he has not said it. Two acceptance
tests (6, 8) and half of a third (7) remain deliberately deferred to the patch
run after he installs them. **So the campaign is not satisfied, and the reason
is not a hole in the build.**

Through M2's close this roadmap said "There is no M3," and the verifier's EC14
paragraph repeats it. **Ben overruled that on 2026-09-10**, and his word is the
authority a roadmap does not argue with:

> *"Not being able to load all claims if I want to is a huge oversight."*
> Paging past the window, on Claims and on Browse, through on-demand
> client-side fetching against a route handler, **is a next-milestone item.**

and, on the shape of the rest:

> *"As long as everything is complete is good."*

That is M3, and it is genuinely this vision's work rather than new scope: VISION
already requires six pages "showing real staging rows **whose numbers match what
the database says**" and an investigation that "never leaves the app." A surface
that caps at 1,000 rows with no way past it, and a gauge whose bucket figures
silently diverge from the head counts printed above them on the same page, both
fail that sentence today. M3 pays exactly those and nothing else.

**Its size is deliberately three features.** M3 opens no new front, adds no
page, adds no schema, and returns the app to a verified shippable state quickly.
When it closes, the campaign's satisfaction still rests where it rests now — on
Ben's review of the two handoffs and the deferred patch run — and the run stops
there unless he says otherwise.

---

## M1 — the read slice, plus editing what is safe to edit today — SHIPPED

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

Exit criteria and the retro: `agenticflow/tracker/milestones/M1.md`.
**Closed 2026-09-04**: all eight features landed, fourteen exit criteria walked
(twelve PASS, one PASS with a clause staging's data could not reach, one FAIL
since closed), 129 tickets, zero schema, zero sibling-repo commits.

---

## M2 — the verdict slice, and the campaign's last milestone

**Precisely: the close slot F4 left empty gets filled, `events` and `venues`
become editable only as recorded overrides, and the two pieces of schema that
makes possible are authored complete for Ben — installed by nobody here.**

M2 is still **zero installed schema**. Every surface it builds must render its
honest not-provisioned state against a database that lacks `verdicts` and
`settle_review_item`, because that is exactly the database `main` deploys
against until Ben installs them. That constraint is not a compromise; it is
what keeps every push deployable, and it is how M2 is gradeable at all.

In:

1. **F9 — the two handoff artifacts, authored complete.** The `verdicts` table
   and `settle_review_item`, as exact migration file content with target path
   and apply command, authored against the sibling repo's *actually installed*
   `apply_resolution`, gate, `observations` and `review_items` — never against
   an invented signature. Filed as blocked handoff tickets for Ben. Nothing in
   this repo applies them, and no Admin-side workaround exists for their
   absence. (spec §7, §9)
2. **F10 — the verdict UI.** On a `data_conflict` decision item: choose a
   claimed value, supply a different value, or keep current & settle. On an
   `entity_link` fact item: link to an existing entity, or settle. On a signal
   item: `fixed`, or `wont_fix` with its required note. One typed decision per
   action, the note field beside it, one call to `settle_review_item`.
   (spec §7; toward tests 6 and 8)
3. **F11 — the edit surface's override half.** `events` and `venues` edit only
   as admin-tier observations through the gate, applied through
   `apply_resolution`, provenance stamped `admin_locked`, logged in `verdicts`
   as `override` with a null `review_item_id`. The regime decides the write
   path; configuration never does. Per-field provenance shows at the field.
   Carries the two edit-cell affordances the sims earned. (spec §8; toward
   test 7's override half)
4. **F12 — the reference field.** A `kind: reference` field edits through an
   entity picker whose choice carries the confirmed match, so the apply
   produces `venue_id` / `event_performers` rows instead of text. Its display
   half ends the idol↔group islands: a reference renders as a link to the
   record it names. (spec §8; toward test 8)
5. **F13 — the verdict log made visible.** `verdicts` rows rendered newest
   first as a tab on Queues — not a seventh nav item, because VISION names six
   pages — and each settled item's detail carrying its own verdict inline.
   (spec §7: "the verdict log is the one record of every admin data action")

Out (M2 must not depend on any of it, and must not build it): installing either
migration; any third schema item; any Admin-side workaround for absent schema;
a groups/idols listing or search (SPEC F7 — Ben's question, below); a second
Browse view; whole-table browsing; a SQL runner; any dial, threshold line, or
dial-shaped control (Ben builds dials himself after the campaign closes); phone
or responsive work; every parked section, in full.

**Preconditions, human-owned:**

- M1's two, still: the `STAGING_SUPABASE_*` names in `.env`, and the staging
  project declared in `agenticflow/docs/SERVICES.md`.
- **`public.walk_sandbox` pasted into staging** from
  `agenticflow/tracker/for-human/TASK-0034.md`. Until it exists, the interim
  walk-write exception stands (one field of one existing `groups`/`idols` row,
  noted, restored, swept) and M2's walks are narrower than they should be.
- **Ben's two fork answers** in `agenticflow/tracker/for-human/M2-roadmap.md`,
  before M2 builds.

Exit criteria: `agenticflow/tracker/milestones/M2.md`.

---

## M3 — completeness of the read slice — PLANNED 2026-09-10

**Precisely: the operator can reach every row the window shows him a slice of,
and every figure on every page is true about the read that produced it.** Zero
schema. No new page. No new front.

Ordered by dependency, because F16 is what makes F14 feel like anything:

1. **F14 — Paging past the window, on Claims and on Browse.** On-demand
   **client-side** fetching against a route handler: the first screen is still
   the server-rendered window it is today, and asking for more is a request the
   client makes, not a server round trip per page and not an unbounded read.
   This is the first thing in the campaign that crosses ARCHITECTURE §4's
   "components never fetch" line and §5's one-async-boundary rule, and §4.3
   currently reads *"Paging is not the answer to a cap and none is built:
   nothing in the spec asks for it."* **The architect amends that contract when
   M3 starts — a builder never does**, and the amendment is the first ticket of
   the milestone, before any page changes. Ben asked for Claims and Browse by
   name; no third surface is added on the team's initiative.
2. **F15 — Every windowed figure names its window, and no two figures on one
   page silently disagree.** The Claims tab gauge transports a 1,000-row window
   whose bucket figures diverge from the head counts above them past 1,000 rows
   (staging is at 877, so this is live within months, not theoretical);
   `/sources`' two scan-window lines name no narrowing while their read carries
   one — the same defect BUG-0163 fixed one page over; and `readClaimCountSince`
   has no upper bound while the scan it is printed beside is `[since, until]`
   and capped. Three instances of `LESSONS.md` 2, on the one page and its
   neighbour.
3. **F16 — The second leg of a two-step join runs its chunks concurrently.**
   `readRowsByIds` (`src/lib/db/result.ts`) walks chunks of 100 sequentially and
   is shared by `/claims`, `/queues` and the review item. This is the unbuilt
   half of BUG-0138's **Answer B**, a decision already taken; the built half
   plus Ben's own `pending_claims.observed_at` install took `/claims` from
   2.9–3.8 s to ~2.4 s warm, and this is estimated to take it to ~1 s. Ben's
   original complaint on that page was wall-clock, and F14's paged fetches
   inherit whatever this leg costs.

**Out — M3 must not build any of it:** search, on any surface (below); a second
Browse view; whole-table browsing; any door onto `groups`/`idols`; any schema,
in this repo or the sibling; installing either §9 migration; any dial or
threshold control; phone and responsive work; every parked section. Paging is
added to **Claims and Browse only**.

**Preconditions:** M2's, unchanged, plus nothing new. `public.walk_sandbox`
remains the standing ask that narrows every walk until it exists.

Exit criteria: `agenticflow/tracker/milestones/M3.md`. Behavior:
`agenticflow/docs/vision/SPEC.md` F14–F16.

## Search — a vision ADDITION, held for Ben, with the evidence

Ben ruled on 2026-09-10 that **search is an addition to the vision, not in scope
unless he runs `/ship revise`.** It is therefore not planned, not ticketed and
not designed, and M3 does not build it. The evidence is recorded here so the
decision stays his and stays informed:

- **Two independent user-sim strangers, unprompted, named a search box as their
  first condition for returning.** Priya: *"if my event hadn't been in the newest
  50 I would have gone straight to `psql` and never come back."* Devin's §5 is
  the same finding from a different table. Both are in
  `tracker/for-human/M2-usersim-judgment.md`.
- M1's stranger walk ended in a SQL client after fifteen minutes for the same
  reason.
- F14's paging removes one of the two routes out of the app (the cap); search
  would remove the other (finding a known row). They are complements, not
  substitutes — paging does not make search unnecessary, and the strategist is
  not arguing that it does.

## Two findings carried to Ben from the M2 close

1. **The installed migration is untracked in the repo that owns the schema.**
   `kspace Scraper` carries
   `?? supabase/migrations/20260910000001_a_pending_claim_carries_its_instant.sql`
   — live on staging, not in git. Nothing in this campaign may commit it
   (write-by-size: a migration is major in every case). It is a one-command fix
   in the sibling and it is Ben's.
2. **`README.md` in this repo still describes the retired dashboard** (scraper
   operations, reconciliation review, `.env.local`, port 3000). Nothing it names
   is reachable; the accurate instructions are in `agenticflow/docs/STACK.md` §5.
   Filed as a patch-lane task at this close.

## The deferred patch run — live proof of the §7 actions

Named here so nobody mistakes it for a hole. **After** Ben installs the two §9
migrations, a patch run proves on staging: every §7 action end to end, one
transaction per settlement with its apply and rejection stamps sharing a
timestamp, a killed call leaving no partial write, `wont_fix` without a note
refused, grant introspection showing `verdicts` written and
`review_items.status` set by `settle_review_item` alone, an events/venues edit
landing as an `admin_locked` observation with its `override` row, and a
reference-field override producing `venue_id` / `event_performers` rows instead
of text. → **tests 6, 8, and test 7's override half.** This is the one
acceptance item deliberately deferred (VISION).

The resolver campaign in the sibling repo **closed 2026-09-03**
(`fe58bfda`), so the schema M2 authors against is settled. That retires the
"everything is major while a campaign runs there" blanket; it changes nothing
else, because a migration is major by size in every case.

## Two questions for Ben — BOTH ANSWERED 2026-09-08

He answered both when he amended the vision (`VISION.md` Amendments; the note
routed as `tracker/inbox/2026-09-09-vision-amendment.md`):

1. **The door: nothing.** `groups` and `idols` get **no listing and no search**,
   and no link from anywhere — they "stay as test tables until they are
   removed". Price 1 of the three costed below, and it is now stronger than
   "nothing was built": the record surfaces themselves come out with the direct
   write path (TASK-0040), so there is nothing to open a door onto. SPEC's M2
   out-of-scope list carries it as a ban, not an open question.
2. **The group row's own provenance: stays hidden.** The 2026-09-02 wording of
   that slot stands unchanged; no `source_*` column is surfaced. No patch ticket
   is filed, and FEAT-0011's provenance criterion says so explicitly.

He also struck the direct-edit scope itself — *"admin edits catalog tables only
through the observation pipeline; do not re-implement direct edits"* — which is
reconciled in SPEC F8's amendment note, in `tracker/milestones/M1.md`, and in
TASK-0040 / TASK-0041. **The text below is kept as the record of what was asked
and what it cost.**

1. **Groups and idols have no door.** `/records/groups/<uuid>` is complete and
   was the most-praised surface of either user-sim walk, and nothing in the app
   lists it, links it, or searches for it — a stranger spent fifteen minutes
   and ended in a SQL client. SPEC F7 and spec §1/§4 explicitly ship one
   curated view and forbid a second, so a listing or a search cannot be traced
   to VISION honestly and is **not built without Ben's word**. Three prices are
   costed for him there.
2. **The group row's own provenance is on the row and not on the screen.**
   `groups` carries `source`, `source_url`, `source_page_id`, `source_rev_id`,
   `source_license` and `last_synced_at`; the record page shows none of them
   while saying "no provenance recorded (pre-cutover table)". Ben ruled that
   slot's wording on 2026-09-02, so it is not overturned from here. Cheapest
   change in either walk report if he wants it; a patch ticket if he says yes.

## Not on this roadmap, ever, under this campaign

Production as a target; repointing the deployed service; any schema beyond the
**three** handoff items (the two §9 pieces, plus `pending_claims.observed_at`,
which arose in M2 from BUG-0138 and which Ben installed on staging 2026-09-10 —
authored here, applied by him, never by this campaign); the parked operator, free-form tickets, recommendations,
incidents, agent runs, commands, registry mirror, severity formula, AI calls;
the mobile app, the scrapers, the pipeline's rules, app-user social data; a
count of unprovenanced catalog rows on Browse (no vision trace); phone and
responsive layout; any dial or threshold control.
