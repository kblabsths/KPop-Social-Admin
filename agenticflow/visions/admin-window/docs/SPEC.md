# SPEC — v1 behavioral spec, campaign `admin-window`

**This document does not restate the spec.** The behavioral authority is the
human's contract snapshots, read 2026-09-01:

- `contracts/admin-observability.md` — **the spec** (approved in full
  2026-09-01). Cited below as *spec §N*.
- `contracts/admin-build.md` — **the acceptance doc** (approved 2026-09-01).
  Its numbered tests are cited as *test N*; its ground rules bind every ticket.
- `contracts/resolver.md`, `contracts/data-model.md`,
  `contracts/entity-linking.md`, `contracts/ECOSYSTEM.md` — reference for what
  the pages render (tables, views, columns, outcomes), read 2026-09-01.

North star: `agenticflow/docs/vision/VISION.md` (frozen 2026-09-01).

Rules of engagement for everyone reading this file:

1. **The contracts win.** Where this SPEC and a contract differ, the contract
   is right and this file is wrong — say so and fix this file.
2. **A gap in the contracts is a blocked ticket, never a judgment call**
   (acceptance doc, ground rules). The named gaps at the bottom are the ones
   already visible; finding another is normal, deciding it silently is not.
3. **No agent edits `contracts/`** (`contracts/README.md`).
4. Contract vocabulary (`review_items`, `apply_resolution`, `field_provenance`,
   `admin_locked`, …) is used here deliberately — those are the contracts' own
   words, not implementation choices made by this file.

---

## Scope of v1

v1 is the spec's two slices (spec §2), on two clocks (spec §2, §10):

| slice | what it is | milestone |
| --- | --- | --- |
| read slice | spec §4 (the window), §5 (the gauges), §6 (a review item rendered) — **zero schema** | **M1** |
| edit surface, pre-cutover half | spec §8 for `groups` / `idols` — direct edits, no schema | **M1** |
| verdict slice | spec §7 (the verdict), §8's override half, §9's two handoff artifacts | M2 |
| live proof of the §7 actions | tests 6–8 on staging, after Ben installs the §9 migrations | deferred patch run |

**F1–F8 below are M1 behavior**, shipped 2026-09-04 (tag `m1`) — those sections
are closed and are not rewritten. **F9–F13 are M2 behavior**, added at the M1
close 2026-09-04. The deferred run is described in `ROADMAP.md`. No M1 behavior
may depend on the §9 handoffs existing, and **no M2 behavior may depend on them
being installed** — M2 is satisfiable with zero installed schema.

---

## Cross-cutting behavior (binds every feature below)

- **The gate holds everywhere.** Every page and every route sits behind the
  existing NextAuth + `admin_allowed_emails` sign-in (spec §3); an
  unauthenticated request to any of them redirects to login. The service-role
  key is server-side only and appears in no client bundle. → **test 12**
- **Staging only, by name.** Live reads target the staging project through the
  `STAGING_SUPABASE_*` names; the production project is never a build target;
  the deployed Railway service is never repointed. An unset name is a refusal,
  never a fallback. No secret value ever appears in a file, transcript, commit,
  ticket, or evidence note. (acceptance doc, ground rules)
- **Honest absence beats a crash.** Against a database lacking the resolver's
  tables, every ecosystem page renders its not-provisioned state and nothing
  throws — this is what keeps every push to `main` deployable against whatever
  project the deployed service targets. → **test 9**
- **Zero schema in M1.** No migration in this repo, no DDL from app code, no
  SQL-executing route built, no new canonical column, no json column.
- **The scraper repo is reference, written by size** (spec §10; `run.yaml`
  `sibling_dirs` = `write_by_size`): minor + necessary + reversible edits land
  as their own commit there, noted on the ticket; every migration, every
  registry-semantics change, anything touching gate or resolver behavior,
  anything irreversible, and *everything* while a campaign runs there, is a
  handoff. Unsure means major. Admin-side workaround code written to dodge a
  scraper-side edit is forbidden.
- **The test suite is offline by default**, with staging tests behind an
  explicit live marker; `npm run lint` and `npm run build` are clean.
  → **test 1**
- **Every live test sweeps what it wrote**; staging carries no campaign
  leftovers after the final run. → **test 13**
- **Parity is the standard of "it renders real data":** for each page, a live
  check asserts the rendered numbers against direct SQL on staging.
  → **test 2**

---

## F1 — The old app is gone; the window's shell stands

*VISION: "The old app is gone. No deprecated surface survives…"*
*Spec §3, §10; acceptance doc ground rule "the build owns `src/` wholesale".*

Observable behavior:

- Overview, Analytics, Data Management (including the completeness gap list)
  and the Database table browser are **removed** — page, route, and the code
  only they used. No deprecated surface is reachable, linked, or left standing
  as dead code. An old component survives only where the new surfaces actually
  use it.
- The app presents the window's navigation: Dashboard, Queues, Claims, Sources,
  Cycles & runs, Browse (spec §4), plus the edit surface reached from the
  records it edits (spec §8).
- The events editor is gone rather than converted — events are not
  hand-editable until the verdict slice lands (spec §3).
- Sign-in, the server-side service-role privilege, and the Railway deploy from
  `main` carry over untouched. Changing any of them is a design change, not a
  build choice (spec §3).

→ tests 1, 12.

## F2 — Staging reads, honest absence, and the live/offline test harness

*VISION: "Against a database that lacks the ecosystem tables, every page says
so honestly and nothing crashes"; "Production is never a target."*
*Spec §3 (server-side reads reach the internal tables), §4; acceptance doc
ground rules and tests 9, 13.*

Observable behavior:

- Reads of `resolution_runs`, `review_items`, the pending-claims classification
  view, the standing-disagreements view, `observations`, `field_provenance`,
  `sources`, and the canonical tables happen server-side through the service
  role, against the staging project named by `STAGING_SUPABASE_*`.
- When a backing table or view is absent, the page renders a **not-provisioned
  state** naming what is missing. Nothing throws; the rest of the app still
  works. → **test 9**
- The suite runs **offline by default**. Staging tests carry an explicit live
  marker, and each live test sweeps every row it wrote. → **tests 1, 13**
- The parity mechanism each page's test uses — rendered numbers vs. direct SQL
  on staging — exists and is reusable per page. → **test 2**

## F3 — Dashboard: the breakfast view

*VISION: "did anything happen last night, what needs me, who keeps being
wrong"; "Six pages … each showing real staging rows whose numbers match what
the database says."*
*Spec §4 (Dashboard), §1.*

Observable behavior:

- An attention summary with **decision and signal counts kept separate**
  (spec §6 derives the kind in code from the item's shape — no column carries
  it), each with open count, max severity, and oldest age. Severity ranks by
  the registry's `low` / `high` alone — no formula (spec, parked sections).
- **Last night's cycles and runs**: recent `resolution_runs` and the adapter
  framework's `runs`, with error lines (`error_summary`) surfaced.
- **Everything on it links** into the pages below — the dashboard is the entry
  to the investigation path, never a dead end (spec §4, navigation is
  entity-crossing).
- Rendered counts equal direct SQL on staging. → **test 2**

## F4 — Queues and the review item rendered

*VISION: "An investigation never leaves the app: item → its claims → its
source and provenance → the event → its edit surface."*
*Spec §4 (Queues), §6 (the whole section); `contracts/resolver.md` §11.*

Observable behavior:

- `review_items` renders as **two queues of equal standing** — the decision
  queue and the signal queue — open items first, ordered severity then age,
  with settled items browsable. Filters exist for **queue and shape**, and a
  filter returns exactly the matching items. → **test 4**
- The three shapes today classify as **decision / decision / signal**: the
  `data_conflict` fact item (decision), the `entity_link` fact item (decision),
  the `entity_link` source-pattern item (signal). → **test 4**
- A review item's detail renders the shared anatomy of spec §6 — what happened
  (summary, severity, age, `folded_count` as "asked again ×N"); evidence side
  by side; the close slot — and **each shape gets its own detail view** over
  that anatomy. → **test 5**
- **Evidence resolves**: every id in `evidence` renders as its observation row
  (value, source, tier, `observed_at`, payload link) with the fact's current
  canonical value and its provenance beside them. The source-pattern item's
  evidence renders as its list of folded records with the per-source dial
  beside it. → **test 5**
- The recommendation slot exists in the layout and **renders nothing** — its
  producer is parked (spec §6, parked sections).
- **The close is not built in M1.** A decision item's verdict actions and a
  signal item's fixed / won't-fix arrive with the verdict slice (M2); M1 shows
  the item and its evidence, and settles nothing.
- Detail links out to the item's claims, its source, and the affected record.
- Rendered queue counts equal direct SQL on staging. → **test 2**

## F5 — Claims, Sources, and Cycles & runs

*VISION: "Six pages … each showing real staging rows whose numbers match what
the database says"; "who keeps being wrong".*
*Spec §4 (Claims, Sources, Cycles & runs); `contracts/resolver.md` §6, §7, §11;
`contracts/data-model.md` (sources state).*

Observable behavior — **Claims**:

- The pending-claims classification view rendered as **buckets with counts and
  age**, filterable by source / domain / bucket. Rendered bucket counts equal
  the view's, per bucket and per source filter. → **test 3**
- **`in_window` appears nowhere in the UI** — not as a bucket, not as an empty
  bucket, not as a filter option — because corroboration windows are parked and
  it cannot hold a row (spec §4). → **test 3**
- The **standing-disagreements** subset is its own tab (the classification view
  filtered to contradictions, `contracts/resolver.md` §4, §7).
- A claim links to its source and to its fact's provenance (spec §4).

Observable behavior — **Sources**:

- The `sources` state rows: lifecycle (`candidate → trial → active ⇄ paused →
  retired`), current tier, `checkpoint`, last run, with the per-source gauge
  trends of F6 beside them.
- A source links to its review items and its runs (spec §4).

Observable behavior — **Cycles & runs**:

- `resolution_runs` and the adapter framework's `runs`, **newest first**, with
  the run counts as columns (`facts_examined`, `applied`, `held`, `escalated`,
  `entities_created`, `claims_linked`, `claims_rerejected`, `errors`) and
  `error_summary` inline. A cycle still running (`ended_at` null) and a
  `skipped` cycle are both legible as such.

Rendered counts and rows on all three pages equal direct SQL on staging.
→ **test 2**

## F6 — The six gauges

*VISION: "with the six threshold gauges each answering its knob's question."*
*Spec §5 (the table of six); `contracts/resolver.md` §12 (the knobs).*

Observable behavior:

- Six views render from staging rows, each answering its knob's question at a
  glance: **cycle health**, **resolution latency**, **pending claims**,
  **queue health**, **standing disagreements**, **settled values** — exactly
  the "one glance shows" column of spec §5. → **test 11**
- Every gauge is a **server-side read-only query in this app** — this build
  adds queries and charts, never tables or database views (spec §5). No gauge
  becomes a migration.
- The gauges live where their subject lives: the per-source trends appear on
  Sources (spec §4), the rest beside the page whose data they judge.

## F7 — Browse: recent events

*VISION: "Browse (v1 view: recent events)."*
*Spec §4 (Browse); `contracts/data-model.md` (per-field provenance).*

Observable behavior:

- **One curated view ships: recent events** — everything that came through the
  pipeline, **newest first**, with the spot-verification columns (title,
  description, poster image, date, venue) **and the source(s) behind the row**,
  read from the `field_provenance` join. → **test 10**
- The view is defined in code — its query, the columns it *may* show, its
  default sort — with a runtime **column selector** that shows and hides
  exactly the configured set, no more and no less. → **test 10**
- An event links to its edit surface (spec §4) — which, in M1, is read-only for
  events (F8).
- No whole-table browsing, no free-SQL runner, no second curated view (spec §1,
  §4 Rationale).

## F8 — The edit surface, pre-cutover half

*VISION: "The edit surface driven by one hand-written map of what is editable:
groups/idols edit directly within it."*
*Spec §8; AGENTS.md data-ownership rule; acceptance doc test 7.*

Observable behavior:

- **One hand-written config drives the surface**: a map from table name to its
  editable columns — user-facing fields only, never ids, keys, or timestamps.
  Everything absent from the map is read-only at the surface, whatever a route
  could technically reach.
- **The write path derives from the table's regime, never from configuration.**
  In M1 only the **pre-cutover** regime is built: `groups` and `idols` edit
  **directly**, within their allowlist — legal and unprovenanced, as the
  ownership rules allow (spec §8).
- **A column present in the map edits; a column absent refuses even a forged
  request** — the refusal is enforced server-side, not by hiding a widget.
  → **test 7 (pre-cutover half)**
- **`events` and `venues` are not editable in M1.** They appear read-only; the
  override write path is M2's, and no direct write path to them exists from
  Admin (spec §3, §8). Nothing in M1 writes to a resolver-owned domain.
- The widget follows the field's kind — a scalar column edits as a cell
  (spec §8). Reference-field pickers arrive with the override path (M2).
- No row is inserted or deleted from Admin; `scraped_events` is never written.

---

# M2 behavior — the verdict slice

*Added 2026-09-04 at the M1 close. Everything above stands as shipped.*

**The M2 cross-cutting rule, which binds F9–F13 and beats every convenience:**
`verdicts` and `settle_review_item` do **not exist** in the shared database and
will not until Ben installs them. Every M2 surface is therefore built against
their absence as the normal case: the surface renders its not-provisioned state
naming the missing object, offers no action it cannot perform, and nothing
throws — the same four-state contract F2 already ships. That is what keeps every
push to `main` deployable, and it is how M2 is gradeable at all. **No
Admin-side workaround for the absent function may be written** (spec §10: the
one forbidden move), and nothing in this repo applies either migration.

## F9 — The two schema handoff artifacts, authored complete

*VISION: "The two schema pieces are authored complete as handoff artifacts for
Ben to install from the scraper repo after the resolver campaign closes."*
*Spec §7 (the `verdicts` table), §9 (the manifest), §10 (write by size).*

Observable behavior — these are documents, and their behavior is reviewability:

- Two migration files exist as **exact content**, each with its target path in
  `kspace Scraper/supabase/migrations/` and the apply command Ben runs there,
  carried on blocked handoff tickets. Nothing in this repo writes them into the
  sibling, and no ticket's touch scope names a sibling path.
- **`verdicts`** carries exactly spec §7's seven columns with their stated types,
  constraints and defaults; RLS on with zero policies; client roles hold nothing.
  Zero new canonical columns; zero json columns; no other schema change.
- **`settle_review_item`** is the only writer of `verdicts` and the only setter
  of `review_items.status`. It takes one typed decision and branches inside;
  every branch ends the same way — the item marked settled, the `verdicts` row
  inserted — in **one transaction**, so a settlement's apply and its rejections
  share a timestamp. A value-carrying verdict writes the admin-tier observation
  through the gate and applies it through `apply_resolution` with
  `rejected_by = 'verdict'`; a keep-current verdict carries rejections alone; a
  link verdict writes the confirmed match. `wont_fix` **without a note is
  refused by the function**, not only by the form. Overrides enter item-less.
  Standard revoke pair.
- Both are authored against the sibling repo's **actually installed** schema —
  `apply_resolution`'s real signature, the gate's real signature, the real
  columns of `observations` and `review_items`, read from
  `kspace Scraper/supabase/migrations/`. A signature this SPEC or the contracts
  imply but the migrations do not carry is a **blocked question for Ben**, never
  a signature invented to make the artifact compile.
- Their bar is a review bar, not an execution bar (DECISIONS 2026-09-02, "a
  ticket's bar is what its own repo can decide"): nothing here may run them.

## F10 — The verdict UI: the close slot filled

*VISION: "Every spec §7 action settles a review item in one transaction."*
*Spec §7 (the actions), §6 (the close slot F4 left empty).*

Observable behavior:

- On a **`data_conflict`** decision item: **choose a claimed value** (one action
  per evidence card), **supply a different value** (through the override form of
  F11), or **keep current & settle**.
- On an **`entity_link` fact** item: **link to an existing entity** (the picker
  of F12), or **settle** (leave it held; the claim keeps waiting in its bucket).
- On a **signal** item: **`fixed`** or **`wont_fix`**. `wont_fix` requires its
  note and the form refuses without one — and the refusal is not the only guard,
  because F9's function refuses it too.
- Each action produces **one typed decision** and **one call** to
  `settle_review_item`. There is no second write path, no client-side
  multi-step settlement, and no direct write to `review_items` or `verdicts`
  from Admin.
- The note field sits beside the action, optional everywhere except `wont_fix`.
- **Absent the function**, the close slot renders its not-provisioned state
  naming `settle_review_item`, offers no action, and the rest of the detail page
  works exactly as M1 shipped it.
- The recommendation slot still renders nothing — its producer stays parked.
- The two fact-shaped items do not exist on staging today. Their views are built
  and graded against fixtures; a criterion that requires a fact-shaped row on
  staging is mis-authored, and the honest grade is "built, not walkable on this
  data" — the same treatment M1 gave the same gap.

## F11 — The edit surface, override half

*VISION: "events/venues edit only as recorded overrides that the pipeline can
see and protect; provenance is visible at the field."*
*Spec §8; acceptance doc test 7's override half.*

Observable behavior:

- `events` and `venues` enter the one hand-written map. **The regime decides the
  write path, never configuration**: their edits land as **admin-tier
  observations through the gate**, applied synchronously through
  `apply_resolution`, provenance stamped `admin_locked`, and logged in
  `verdicts` as `action = 'override'` with a **null `review_item_id`**.
- **No direct table write to `events` or `venues` exists from Admin** — the
  entry point is `settle_review_item`, item-less. A forged request naming a
  column absent from the map is still refused server-side, exactly as F8 ships.
- **Per-field provenance shows at the field** for a resolver-owned table, read
  from `field_provenance` ("ticketmaster, applied 3d ago" / "admin-set Jun 12").
  A pre-cutover table keeps the rendering Ben confirmed on 2026-09-02.
- **Absent the function**, `events` and `venues` render **read-only** with the
  reason named, which is what M1 already ships — the surface degrades to M1's
  behavior rather than to a broken control.
- Two affordances the M1 walks earned, on the shared edit cell (both regimes):
  an editable value is **distinguishable from a read-only one before it is
  touched**, and a click-to-edit cell **opens with its existing value selected**
  so a straight retype replaces.
- Releasing an `admin_locked` fact is itself a verdict action on that fact, not
  a direct write.

## F12 — The reference field: a picker that links rows, never text

*VISION: "a reference field links rows, never text".*
*Spec §8; acceptance doc test 8.*

Observable behavior:

- A field whose kind is `reference` edits as an **entity picker**, never as a
  free-text cell. The picker's choice lands as the admin-tier observation **plus
  its confirmed match**, so the apply produces `venue_id` / `event_performers`
  rows and never a string.
- The picker searches within the referenced entity's own table and offers only
  rows that exist. It never creates an entity.
- **Display half:** a reference renders as a **link to the record it names**,
  wherever it is shown — which ends the idol↔group islands (`idols` shows its
  group and reaches it in one click, and a group reaches its idols), using the
  rendering `events.venue_id` already ships. This is display of an existing
  vetted column; **it adds no editable column** (SPEC F8: never ids or keys),
  and it is **not a door** — a first group is still reached only by uuid unless
  Ben answers ROADMAP's question 1.

## F13 — The verdict log, visible

*VISION: "every settlement and override lands as one row in the verdict log."*
*Spec §7 ("the verdict log is the one record of every admin data action").*

Observable behavior:

- `verdicts` renders newest first, carrying actor, action, the item settled (a
  link, or nothing on an override), the observation written (a link, or nothing
  on a settle-only verdict), the note, and when.
- It is **a tab, not a seventh page** — VISION names six pages and the campaign
  does not add one. The standing-disagreements tab on Claims is the shipped
  precedent for the rendering.
- A **settled review item's detail carries its own verdict inline**, so the
  investigation path ends where the decision was made.
- **Absent the table**, the tab renders its not-provisioned state naming
  `verdicts` and nothing throws.
- Rendered counts equal direct SQL on staging once the table exists; until then
  the parity check for this surface asserts the not-provisioned state, which is
  the honest oracle.

## M2's own out-of-scope, additional to M1's

- **Installing either migration**, from any code path, by any agent. A third
  schema item of any kind.
- **Any Admin-side workaround** for the absent function or table — worse than
  deciding either way (spec §10).
- **Any dial, threshold line, or dial-shaped control.** Ben builds dials after
  the campaign closes; nothing in M2 renders, reads, or hand-copies one.
- **A groups/idols listing or a search box** (SPEC F7 stands; ROADMAP question
  1 is Ben's alone), a second Browse view, whole-table browsing, a SQL runner.
- **Phone and responsive work** — desktop-only, 1280px+, both themes kept
  (DECISIONS 2026-09-02).
- A `verdicts` row for a **pre-cutover** edit. Spec §7's `action` CHECK does not
  admit one, and inventing an action name is schema design this campaign does
  not own. The gap between VISION's "every change is attributed" and F8's
  "legal and unprovenanced" therefore **survives M2**, and is named as an open
  question rather than closed by a build judgment.
- Every parked section, in full, unchanged.

## Named gaps carried into M2

M1's five named gaps stand where they were left. Three more are visible now:

6. **`settle_review_item`'s exact signature.** The contracts describe its
   behavior, not its parameter list, and the sibling's migrations do not
   contain it. F9 authors it — but every call site in this repo depends on a
   shape no contract fixes. The shape F9 authors is the shape F10 calls, and
   any disagreement Ben finds at install time is a patch, not a silent
   Admin-side adaptation.
7. **Which fields of `events` and `venues` are editable at all.** Spec §8 says
   the map decides and says the map is hand-written; it does not enumerate the
   columns for a resolver-owned table. "Performers and venues are *links*, not
   fields of `events`" (AGENTS.md) narrows it but does not fix it. The map's
   first `events`/`venues` entry is a blocked question for Ben, not a builder's
   pick.
8. **The human edit with no fingerprint.** VISION: "every change is attributed";
   SPEC F8: pre-cutover edits are "legal and unprovenanced"; `groups.updated_at`
   does not move on an Admin write. Already routed to Ben in
   `tracker/for-human/M1-contract-gaps.md` — the only honest fix is a trigger,
   which is schema, which this repo may never carry. Carried, not closed.

---

## Out of scope for M1 (do not build, do not scaffold)

- Every §7 verdict action, the settle button, the `verdicts` log, and
  `settle_review_item` — M2 and the deferred run.
- The events/venues override write path, `admin_locked` stamping from Admin,
  and the reference-entity picker — M2.
- Both §9 migrations — authored as handoff artifacts in M2, installed by Ben.
- The parked sections **in full**: no operator, no free-form tickets, no
  `recommendations` / `incidents` / `agent_runs` / `commands`, no registry
  mirror, no severity formula, no AI calls (spec, parked sections).
- The `in_window` bucket (spec §4). Corroboration windows generally.
- A second Browse view, whole-table browsing, a SQL runner (spec §4).
- Anything outside this app: the mobile app, the scrapers, the pipeline's
  cadence and rules, app-user social data, the retired Analytics view.

---

## Named gaps — blocked questions, not judgment calls

These are visible now. Each is a **blocked ticket for Ben** the moment a
builder needs the answer; none may be decided silently (acceptance doc).

1. **The adapter framework's `runs` table.** Spec §4 puts it on Cycles & runs,
   but `adapters.md` is not among the contract snapshots — its columns are
   unspecified here. What Cycles & runs shows for adapter runs is a gap.
2. **Whether staging holds rows to render.** Tests 2, 3, 5, 10 and 11 assert
   rendered numbers against real staging rows. If a table or view is present
   but empty, "renders real staging data" is satisfied only trivially. Whether
   a live test may write its own fixture rows into resolver-owned tables — test
   13 sanctions a live suite that writes and sweeps, while spec §8 forbids
   *app* write paths to those domains — is the question to ask before any
   fixture is written.
3. **Per-field provenance on a pre-cutover table.** Spec §8 shows provenance at
   the edit surface, but `groups` / `idols` edits are unprovenanced by
   construction, so no `field_provenance` row exists for them. Rendering
   nothing is the honest read; confirm before shipping it.
4. **The per-source stuck-record dial.** The pending-claims gauge judges each
   source's `awaiting_row` trend "against its pattern threshold"
   (`contracts/resolver.md` §12), whose per-source override lives in scraper
   registry YAML. Reuse that would need scraper files at runtime is "a flagged
   gap, not a silent copy" (spec §10) — so where Admin reads that dial is a
   question, and hand-copying the value is not an answer.
5. **The classification view's and `review_items`' installed shape on staging.**
   Schema truth is `kspace Scraper/supabase/migrations/`, and the resolver
   campaign is still building it (`contracts/README.md`). A column this SPEC
   names that staging does not have is a gap to report, not a column to invent.
