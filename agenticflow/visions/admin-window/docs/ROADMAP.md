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
| **M3** | completeness of the read slice: paging past the window, and every windowed figure honest | **zero** (one handoff already installed by Ben) | (M1's and M2's, still green) + M3's own | **SHIPPED** 2026-09-15, tag `m3` at 672c6536 |
| **patch run** (deferred) | live proof of the §7 actions, after Ben installs the handoffs | the two §9 items, **installed by Ben 2026-09-11** | 6, 8, 7 (override half) | **DUE** — filed 2026-09-15 as TASK-0084/0085/0086, held for one answer from Ben |
| **M4** | — | — | — | **NOT PLANNED.** Conditional on Ben's paging-shape answer only; see below |

## Is the vision satisfied? YES in build — and what is left is not the team's

**Restated at the M3 close, 2026-09-15.** This section replaces the M2-close
reading below it, which is kept from "Through M2's close this roadmap said" down
as the record of how M3 came to exist.

VISION's satisfaction sentence is *"the campaign is satisfied when the verdict UI
is built and both handoffs are complete and reviewed."* Measured today:

- **The verdict UI is built.** Every spec §7 action is one typed decision landing
  as one call to `settle_review_item`, the override half of the edit surface
  writes only as an `admin_locked` observation, the reference field is a picker,
  and the verdict log renders as a tab rather than a seventh page (M2, verified).
- **Both handoffs are complete** — and more than complete. Authored against the
  sibling's actually-installed schema in M2, **installed by Ben on staging
  2026-09-11** (`verdicts` 23:22Z, `settle_review_item` 23:26Z), and **tracked in
  the repo that owns the schema since `d1c1b3ba`, 2026-09-13**, committed by him.
  The M2 close's one open finding — the installed migration untracked next door —
  is closed.
- **"Reviewed" is Ben's word, and he has not said it.** Installing is strong
  evidence of review and it is not the word. This is the only clause of the
  satisfaction sentence still open, and no ticket in this campaign can close it.

Everything else VISION asks for is shipped and walked: six pages against real
staging rows whose numbers match the database (877 claims, 120 events, 108+769,
747+22, all hand-verified by a stranger); six threshold gauges; an investigation
that never leaves the app; honest not-provisioned states on every surface against
a database answering `PGRST205`; the edit surface driven by one hand-written map,
with the direct-edit half struck by Ben's own 2026-09-09 amendment; the old app
gone, the gate and the deploy carried over, every push deployable.

**One acceptance item remains, and VISION itself named it.** "Acceptance is the
thirteen tests in `contracts/admin-build.md`, all green" — tests 6, 8 and test
7's override half are still ungraded, deferred by VISION to "a patch run after
Ben installs them." **He installed them on 2026-09-11, so that patch run is now
due**, and it is filed: TASK-0084, TASK-0085, TASK-0086, all `patch`, all held
for one answer. They are held rather than running because a live §7 proof is not
sweepable by this app — a settlement consumes a real `review_items` row and
appends a `verdicts` row the service role cannot delete, and 71 of staging's 72
review items are the sibling `entity-linking` campaign's live work. Ben says
which rows are spendable; then the run finishes.

**Recommendation: END THE RUN. Do not open M4.** The order is: drain the five
open patch tickets; take Ben's answers (the paging shape, the staging restore,
the spendable rows, the word "reviewed"); run the deferred acceptance patch run;
stop. Shipping done software is the win condition. `max_milestones` is 6 and we
are at 3 — the budget is not what stops this; the vision being satisfied is.

## M4 — NOT PLANNED, and conditional on exactly one answer from Ben

`tracker/for-human/M3-paging-shape-for-ben.md` is stopped for his yes/no on page
windows (20/50/100, both surfaces) replacing append-on-press. **Nothing here is
a plan and no FEAT is filed** — only the human converts a note into a milestone.
Both branches are costed so his one word is enough to start either.

**If YES — that is M4, and it is a real milestone.** It rewrites SPEC F14 rather
than extending it (the window MOVES and the rows are replaced, instead of
growing), so SPEC is amended, not appended, and the amendment must say what
becomes of the M3 criteria that graded the old answer — EC4's byte-identical
first screen breaks by design at a size of 20, and EC5 and EC7 are both written
around append semantics. It adds the first new operator-facing control since M1
(the size selector) on two surfaces, plus page navigation and "which page am I
on" state. It probably puts `?page=` and `?size=` in the URL, which is a real
improvement — LOOK_AND_FEEL bar 11 becomes TRUE again instead of excepted, and
the dated paging clause TASK-0079 installed retires itself as it was written to.
It needs a different state machine: `src/lib/paging/machine.ts` merges pages and
grows a `held` that never shrinks; page windows replace a row set and must answer
a size change mid-walk, a question no contract we hold answers. It also folds in
**BUG-0221** — the paged seam — which closes obsolete, because a page window is
positional by construction and cannot take the keyset bound that is the seam's
honest fix. And it delivers Ben's own Feel bar 14 by construction. **Six to ten
tickets, both surfaces, live proofs on both — and this time the live proof is
repeated and compared across runs, not certified from one walk (M3 retro).**
`public.walk_sandbox` returns to the precondition list the moment this opens.

**If NO — it is a cheap two-ticket path, plus one unblocking.** Both paged
surfaces keep append-on-press, and Feel bar 14 ("nothing the operator must find
sits below a long list") then produces exactly two patch tickets, one per
surface: `/claims` and `/browse` each render the same `PageMore` control as the
last child after the last row (`src/components/claims/paged-claim-list.tsx:107-115`,
`src/components/browse/paged-browse-table.tsx:156-177`), both fail the bar, and
each needs its control moved above its list. Measured: `/claims`' control lands
1,166px below a 900px fold after a press; `/browse`'s stays at 852 only because
scroll anchoring happens to hold it. **Separately, BUG-0221 unblocks** into an
ARCHITECTURE §4.3 amendment (the wire bound stops being the offset and becomes a
row id) plus one builder session per surface — the architect writes the amendment
first, as it did for paging itself.

**Either way the stop condition is untouched.** VISION is satisfied by the
verdict UI plus the two reviewed handoffs, not by paging shape. Adopting page
windows is new scope Ben is choosing, not scope the vision is owed.

---

## The M2-close reading, kept as the record of how M3 came to exist

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
failed that sentence. M3 paid exactly those and nothing else, in three features.

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

## M3 — completeness of the read slice — SHIPPED 2026-09-15, tag `m3` at 672c6536

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

**Preconditions:** M2's, unchanged, plus nothing new. ~~`public.walk_sandbox`
remains the standing ask that narrows every walk until it exists.~~ — **WITHDRAWN
at the M3 close, 2026-09-15**: never pasted, and with no milestone planned there
is no walk left for it to serve. It returns the day M4 opens.

Exit criteria and the retro: `agenticflow/tracker/milestones/M3.md`. Behavior:
`agenticflow/docs/vision/SPEC.md` F14–F16.

**Closed 2026-09-15**: all three features landed, thirteen exit criteria walked —
eleven PASS at the verifier's walk, EC1 and EC12 FAIL then and both closed by
tickets and fix-scoped re-checks. 100 tickets opened in five days (72 bugs, every
one filed by a team role — QA 41, architect 38, designer 13, verifier 6,
strategist 2 — save the two the strategist routed from Ben's own walk note), 87
of 91 graded tickets
closing on the first attempt, zero schema in either repo, zero `admin-window/`
commits in the sibling, six nav links, no new page route, no search control.
`/claims` warm came down from 2.9–3.8 s to a median 1.235 s. **One red stands and
no ticket here can clear it**: EC1's live arm fails on `residue.live.test.ts`
alone, because staging event `01a03c9b-…` still wears a probe title only Ben can
restore (`tracker/for-human/BUG-0215-staging-residue.md`).

## Search — a vision ADDITION, held for Ben, with the evidence

Ben ruled on 2026-09-10 that **search is an addition to the vision, not in scope
unless he runs `/ship revise`.** It is therefore not planned, not ticketed and
not designed, and M3 does not build it. The evidence is recorded here so the
decision stays his and stays informed:

- **FOUR independent user-sim strangers across three milestones, unprompted,
  have now named a search box as their first condition for returning.** Priya:
  *"if my event hadn't been in the newest 50 I would have gone straight to `psql`
  and never come back."* Devin's §5 is the same finding from a different table
  (`tracker/for-human/M2-usersim-judgment.md`). Tomas, at the M3 endgame with
  paging already shipped: *"120 events and the only way to find one is to read …
  I wanted to find 'the BTS Melbourne one' and had no way to ask."*
  (`tracker/for-human/M3-usersim-judgment.md`). Marisa, on the same tree, spent
  **four minutes and seventeen clicks** paging 877 rows to learn a word the page
  already knew.
- **Paging shipping did NOT make it go away, which is the new evidence.** The
  M2-close argument was a prediction; M3 tested it. Both M3 strangers had the
  full 877 rows reachable and both still named finding a known row as the thing
  the app cannot do.
- **If Ben runs `/ship revise`, the second candidate to go with it** is the count
  of unprovenanced canonical values on Browse (DECISIONS 2026-09-04 and
  2026-09-15) — two campaign-wide strangers have now computed it by hand.
- M1's stranger walk ended in a SQL client after fifteen minutes for the same
  reason.
- F14's paging removes one of the two routes out of the app (the cap); search
  would remove the other (finding a known row). They are complements, not
  substitutes — paging does not make search unnecessary, and the strategist is
  not arguing that it does.

## Two findings carried to Ben from the M2 close — BOTH CLOSED 2026-09-15

**1 is closed:** all three handoff artifacts are now tracked in the sibling, each
committed by Ben himself (`125a9bfe` 2026-09-10, `d1c1b3ba` 2026-09-13).
**2 is closed:** `README.md` was rewritten by TASK-0061 in the M3 patch lane.
The original text follows.

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

## The deferred patch run — live proof of the §7 actions — **DUE, FILED, HELD**

**Its precondition cleared on 2026-09-11**: Ben installed both §9 objects on
staging. Filed at the M3 close as **TASK-0084** (test 6), **TASK-0085** (test 7's
override half) and **TASK-0086** (test 8), all `patch`, chained into one lane so
at most one can ever be offered, and all **held for one answer from Ben** — a
live §7 proof consumes a real `review_items` row and appends a `verdicts` row the
service role cannot delete, and 71 of staging's 72 review items are the sibling
`entity-linking` campaign's live work. He says which rows are spendable and who
restores the after-state; then this runs and the thirteenth acceptance test goes
green. `tracker/for-human/M3-retro-for-ben.md` carries the question.

What it proves on staging: every §7 action end to end, one
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

## Withdrawn at the M3 close, so the human's list gets shorter (strategist, 2026-09-15)

- **`public.walk_sandbox` is no longer a precondition.** Open since the M2 plan,
  it narrowed every walk in M2 and M3 to the interim note-restore-sweep exception
  and was never pasted. With no milestone planned there is no walk left for it to
  serve. `tracker/for-human/TASK-0034.md` stays put; the ask returns the day M4
  opens.
- **`runs` retention and the `runs` row-cap horizon leave this ledger.**
  Scraper-side in origin and in fix; they belong in the root `backlog/`, not on a
  closing campaign's for-human list. Nothing decided, only the owner changed.
- **Three user-sim asks are CUT** — naming a well-formed facet value that no row
  owns; a total on `/browse` before you page; a count of unprovenanced canonical
  values on Browse. Reasons and prices: `agenticflow/docs/DECISIONS.md`,
  2026-09-15. Each is one word from Ben away from being reversed.

## One finding for the human about how two campaigns shared one database

Not a rule violation by anyone. The sibling repo ran its own `entity-linking`
campaign through 2026-09-13 **against the same staging project this campaign
grades itself on**, and its work changed our graded data mid-walk three times:
`43505768` added `review_items.external_ref` and 71 rows that appeared between
the designer's judgment and the verifier's EC11 pass; the `d1c1b3ba` install
turned one of our live tests into an unswept writer (BUG-0215); and a concurrent
writer reddened our venue-provenance live cases (BUG-0219). No protocol said
either campaign had to declare any of it. Whether the next pair of concurrent
campaigns gets separate staging projects or a declaration step is the human's
call, and it is the structural finding of M3's cross-directory ledger.

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
