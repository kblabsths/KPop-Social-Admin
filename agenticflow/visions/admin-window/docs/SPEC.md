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

Everything below is **M1 behavior**. M2 and the deferred run are sketched in
`ROADMAP.md`, and no M1 behavior may depend on the §9 handoffs existing.

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
