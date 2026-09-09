# M2 — verifier's verdict, campaign `admin-window`

**Walked 2026-09-09** against the walk instance `http://localhost:8771`
(`next dev`, branch `run/admin-window`) pointed at **staging**
`ubfjjqlvnpnoborczbdb.supabase.co`, driven with playwright (bundled chromium
151.0.7922.34), authenticated with a minted session cookie. Sandbox reset
before and after; the only table this walk wrote is `walk_sandbox`, and it is
back to its three seed rows byte-identical to `tests/walk/sandbox-fixture.ts`.

Full run log, with every command, quote and measurement:
**`agenticflow/tracker/notes/verify-M2-2026-09-09.md`**.
Frames: `agenticflow/tracker/evidence/M2/verifier/` (gitignored — the numbers
that matter are transcribed into the run log and into this file).

## Verdict in one line

**M2 is shippable with two defects filed — BUG-0141 (P1) and BUG-0142 (P2).**
Both are navigation-honesty defects on links the app itself emits; neither
touches the verdict slice, the schema footprint, the gate, or the absence
contract. Everything M2 is actually *about* — every surface offering no action
it cannot perform, and offering it honestly — held under a real walk.

---

## Criterion by criterion

### EC1 — "the repo's bars are green, and the live tier is in the gate"

> "`npm run lint` and `npm run build` each exit 0 with zero errors, and the
> campaign's test suite passes… offline by default…"

**Not mine to certify, and I did not re-run it** — QA owns the suite, and a
verifier re-running unit tests learns nothing the suite did not already say.
What I can report from outside the harness: across ~40 page loads on ten
distinct routes I recorded **zero page errors and zero console errors**, except
one `console.error` that is a page's own honest 404 fetch and one that is the
500 described under EC6. **NOT GRADED HERE** (QA's).

### EC2 — "M1 is still green"

> "…the retired-route 404 set still 404; the six-link nav still six links;
> `in_window` still zero occurrences in rendered HTML across all surfaces."

- Route walked: typed each retired address into the address bar.
  `/overview`, `/analytics`, `/database`, `/data-management`, `/scrapers`,
  `/review`, `/dashboard`, `/events`, `/groups`, `/idols` → **404**, all with
  "Analytics, Database and Data management were retired with the old dashboard,
  and nothing replaced their URLs." **PASS.**
- Route walked: sidebar on `/`. **Exactly six** links — Dashboard, Queues,
  Claims, Sources, Cycles & runs, Browse. **PASS.**
- `in_window`: **zero** occurrences in rendered text on `/claims` and on every
  other surface; not a bucket, not an empty bucket, not a filter option.
  **PASS**, with one measured caveat for whoever maintains the machine check:
  under the hand-typed URL `/claims?bucket=in_window` the literal appears
  **3 times in raw HTML**, all three inside Next's RSC flight payload echoing
  the request URL (`"q":"?bucket=in_window"` and friends), zero times in
  rendered text. The spec clause ("appears nowhere in the UI — not as a bucket,
  not as an empty bucket, not as a filter option") is satisfied; a literal
  "zero occurrences in HTML" assertion is not, if it is ever pointed at that
  URL.
- The six live parity suites: QA's. **NOT GRADED HERE.**

### EC3 — "the `verdicts` migration is authored complete and installable by hand"

Read the artifact at `agenticflow/tracker/for-human/M2-handoff-verdicts.md`.
Target file named: `kspace Scraper/supabase/migrations/20260908000001_the_verdict_becomes_a_row.sql`.
Apply command named: `supabase db push`, from the `kspace Scraper` repo root.
Single fenced SQL block. Columns, in order: `verdict_id uuid default
public.uuid_generate_v7() not null` (PK), `review_item_id uuid` (FK →
`review_items`), `actor text not null`, `action text not null` with a CHECK over
`choose_claimed_value, supply_value, keep_current, link_entity, settle, fixed,
wont_fix, override`, `observation_id uuid` (FK → `observations`), `note text`,
`created_at timestamptz default now() not null` — **seven, no eighth**.
`alter table public.verdicts enable row level security;` present;
`create policy` count **0**; `jsonb` count **0**; no `alter table` on a
canonical table. **PASS** on the structural half. Ben's read is the real bar.

### EC4 — "`settle_review_item` is authored complete, against the installed schema"

Read `agenticflow/tracker/for-human/M2-handoff-settle-review-item.md`. Target
file `…/20260908000002_the_verdict_settles_the_item.sql`, same apply command.
`wont_fix` without a note raises inside the function ("verdict refused: wont_fix
carries the note that says why…"), one of a dozen guard raises. No `commit`, no
`dblink`, no autonomous-transaction construct; the file says so and the grep
agrees. **PASS** on the structural half; "complete and reviewed" is Ben's
sentence to say, not mine.

### EC5 — "every §7 action exists in the UI as one typed decision"

> "Standing on a review-item detail with the function present (stub or
> installed)…"

**Not walkable on this data, and the criterion says so itself.** Staging holds
**exactly one** `review_items` row (`entity_link`, `open`, ticketmaster) and
neither `verdicts` nor `settle_review_item` exists. The fixture-graded half is
QA's. What I *could* stand on and grade:

- Route walked: `/` → OPEN SIGNALS card → `/queues?kind=signal` → the item row
  → `/queues/01a06287-5b67-7d1f-b4a5-d90aa93cb01a`. On that detail, section
  order measured by bounding box: WHAT HAPPENED (y=84) → **THE CLOSE (y=254)**
  → EVIDENCE (y=342). The close slot is above the evidence, as asked.
- The close slot offers **zero controls**: 0 buttons besides the shell's Sign
  out, 0 inputs, 0 textareas, 0 selects. No disabled button, no note field
  standing in for one. **PASS** on "offers no action it cannot perform".

### EC6 — "the override half writes only as an observation"

> "a forged PATCH naming a column absent from the map is refused server-side
> with 403 for `events` and `venues` as it already is for `groups` and `idols`;
> a forged PATCH naming a mapped `events` column while the function is absent is
> refused with the reason named, never a direct write."

Route: forged PATCHes from the authenticated page context, with the UI's own
envelope. Observed statuses and bodies:
`events.bogus_col` → **403** `bogus_col is not an editable field of events`;
`events.event_id` → **403**; `venues.latitude` → **403**;
`walk_sandbox.created_at` / `.sandbox_id` → **403**;
`groups.name`, `idols.stage_name`, `review_items.status`, `observations.value`
→ **404** `… is not an editable table`;
`events.title` and `venues.name` (both sent carrying the row's **current**
value, so a leak could not corrupt anything) → **503**
`{"error":"settle_review_item is not present in this database","missing":"settle_review_item"}`.
Verified afterwards: `events.title` still `XG`, `venues.name` still
`OVO Arena Wembley`, no new `observations` row. **PASS.**

> "per-field provenance renders at the field for a resolver-owned record, read
> from `field_provenance`"

Route: Browse → an event → `/records/events/01a03c9b-1d28-707d-9873-f73ab3add10c`.
Observed, verbatim: `title XG → ticketmaster, applied 7d ago`;
`poster_url → ticketmaster, applied 7d ago`; `starts_at → ticketmaster, applied
7d ago`; `venue_id → ticketmaster, applied 7d ago`. Then the venue's own
record: `name / city / country / address` each `ticketmaster, applied 7d ago`.
I checked the negative too — the first records I opened showed `—` everywhere,
and direct SQL confirms they carry zero `field_provenance` rows, exactly as the
page's own line claims. Staging holds **1712** provenance rows;
`admin_locked` is true on **0**. **PASS.**

Observation, not filed: the record PATCH answers **HTTP 500** for a foreseeable
user typo (`tally` = `not-a-number`). The screen is honest and nothing is
written; the status code is not the one that shape of failure deserves.

### EC7 — "a reference field is a picker, and a reference renders as a link"

> "on an `idols` record the group renders as a link… and on a `groups` record
> its idols are reachable in one click"

**Mis-authored against the human's own amendment** — Ben ruled `groups`/`idols`
get **no door**, so neither has a record surface, and SPEC F12 cuts that half
explicitly. Confirmed by walk: `/records/groups`, `/records/idols`, `/groups`,
`/idols` all 404, and the PATCH route answers `404 … is not an editable table`.
Reported as an authoring defect in the criterion, not certified green.

The surviving clause — a reference renders as a link — **PASS**:
`/records/events/01a03c9b-…add10c` renders `venue_id` as
`accesso ShoWare Center` / `OVO Arena Wembley` linking to
`/records/venues/<id>`; I clicked it and landed on that venue's record, 200.
No id or key is editable on either page (both refuse `*_id` server-side, 403).
The picker half needs the function and is not walkable.

### EC8 — "the verdict log is visible, and it is not a seventh page"

> "the sidebar holds **exactly six** links, unchanged from M1; the verdict log
> is reachable as a tab, and its URL is a facet of an existing page"

Route walked: stood on `/queues`, pressed the **Verdict log** tab in the tab
row above the queues. URL became **`/queues?tab=verdict_log`** — a facet of an
existing page, not a new route. Sidebar still **six** links, unchanged.
**PASS.** The second bullet (rows newest first with `verdicts` present as a
stub, and a settled item's inline verdict) needs the table and a settled item;
neither exists on staging. **Built, not walkable on this data.**

### EC9 — "every M2 surface is honest when the schema is absent"

> "the review-item close slot, the verdict-log tab, and the `events`/`venues`
> edit surface each render a `data-state=\"not_provisioned\"` card naming the
> missing object (`verdicts`, `settle_review_item`); every page answers 200;
> zero page errors; no control is offered that would call a missing function."

All three walked, each carrying `data-state="not_provisioned"` and the text
`verdicts isn’t in this database yet — it arrives with the scraper repo's
migrations.`:
close slot at `/queues/01a06287-…`; tab at `/queues?tab=verdict_log`; edit
surface at `/records/events/<id>` and `/records/venues/<id>` (with the
read-only reason beside it). Every page answered **200**; zero page errors;
**zero controls** offered anywhere that would call the absent function.
**PASS.**

One thing graded rather than waved through: SPEC F10 says the close slot names
**`settle_review_item`**; it names **`verdicts`**. That is a **recorded design
decision, not a slip** — `agenticflow/docs/DECISIONS.md` 2026-09-08 rules that
PostgREST cannot introspect a function without calling it, that calling
`settle_review_item` to probe it is a write attempt dressed as a probe, and
that every M2 surface therefore asks whether the `verdicts` table is there and
names what it asked about. The API layer, which *can* fail on the call, names
`settle_review_item` correctly (EC6 above). EC9's own parenthesis admits either
name. **Recorded as a design limit + a SPEC-wording drift for Ben**, not filed
as a bug: if the wording stands, SPEC F10's sentence is the thing to correct.

### EC10 — "no schema, no workaround, no sibling write"

`supabase/migrations/` in this repo holds exactly the two app-owned files it
held at the M1 close (`20260406_admin_allowed_emails.sql`,
`20260407_add_kblabs_admin_email.sql`). `git -C "../kspace Scraper" status
--porcelain` is **empty**; `git -C "../kspace Scraper" log --all
--grep=admin-window` returns **0** commits. Zero `json`/`jsonb` columns in
either artifact. No SQL-executing route exists to reach: the record PATCH
refuses by allowlist, and every other table answers "is not an editable table".
**PASS** on what a walk can see; the grep-level half is QA's.

### EC11 — "auth holds and no key leaks"

> "an unauthenticated request to every **new** M2 page, tab, and route
> redirects to login; a scan of the built client bundles finds no service-role
> key, no staging URL…"

Route walked with no cookie: `/`, `/queues`, `/queues?tab=verdict_log`,
`/queues/<id>`, `/claims`, `/claims?tab=standing`, `/sources`, `/cycles`,
`/browse`, `/records/events/<id>`, `/records/venues/<id>`,
`/records/walk_sandbox/<id>` — **all twelve** redirect to
`/login?…callbackUrl=…`. An unauthenticated `PATCH` to
`/api/admin/records/walk_sandbox/<id>` is an opaque redirect and never reaches
the handler; the row was unchanged. Sign-out walked by pressing **Sign out** in
the shell: landed on `/login`, session cookie gone (only `authjs.csrf-token`
and `authjs.callback-url` remained), and revisiting `/queues` redirected to
login again. I collected **31** html/js/json assets across ten pages and
searched every one for `SERVICE_ROLE`, `service_role`, `STAGING_SUPABASE`,
`ubfjjqlvnpnoborczbdb`, `supabase.co`, `eyJhbGciOi`, `AUTH_SECRET` — **zero
hits**. (This is the dev server; the built-bundle scan remains QA's.)
**PASS.**

### EC12 — "zero residue"

Reset run before the walk (`deleted 3, seeded 3, read back and verified`) and
again after it (same line). Post-walk reads: all three `walk_sandbox` rows
match the fixture column for column; `events.title` of the record I probed is
still `XG`; `venues.name` still `OVO Arena Wembley`; the newest `observations`
row is still ticketmaster's from 2026-09-03; `verdicts` still answers
`PGRST205`. No `.env` value appears in this file, the run log, either ticket,
or any evidence note; nothing was echoed, catted or grepped out of `.env`.
**PASS.**

### EC13 — "the campaign's own bars"

Screenshots of every surface I walked (32 frames) are in
`agenticflow/tracker/evidence/M2/verifier/`, referenced from the run log.
`docs/build_judgments.md`, the cross-directory report and the gap-ticket
discipline are the campaign's own close, not a walk's. **NOT GRADED HERE**,
except the sibling-clean half, which I checked under EC10 and which passes.

### EC14 — "the campaign's stop condition is stated"

Stated below.

---

## The two defects

**BUG-0141 (P1) — `/queues` ignores the `source_id` the Sources page links it
with.** Standing on `/sources` and pressing **test_harness**'s own
`review items` link lands on `/queues?source_id=01a01808-…b3057a`, which renders
ticketmaster's item (`review_items.source_id = 01a05782-…`) as though it were
test_harness's, with `OPEN SIGNALS 1` beside it. `/queues?source_id=not-a-uuid`
renders the same page. Nothing says the parameter was not applied — the string
"did not apply" occurs zero times — while `/claims` draws exactly that line for
exactly this case. The code documents the facet as unimplemented; the operator
gets a wrong answer with no marker on it. Spec F5: "A source links to its
review items and its runs."

**BUG-0142 (P2) — the Dashboard's run links land nowhere in particular.** Every
run row on `/` links to `/cycles?run=<run_id>`; that page marks **0** rows
(`data-row-marked="true"` count 0), names the run **0** times, and says nothing
about a parameter it did not apply — while the sibling facet
`/cycles?cycle=<id>` marks exactly **1** row and names it in a sentence, and
`/cycles?source=<name>` explains precisely what it narrowed and what it did
not. With five runs in the window an operator can guess; the window caps at
200. Spec F3: "Everything on it links into the pages below — the dashboard is
the entry to the investigation path, never a dead end."

Not refiled, as instructed: **BUG-0138**, **BUG-0139**, **BUG-0140**.

## Recorded as design limits, not defects

1. The not-provisioned card on the close slot and the edit surface names
   **`verdicts`**, where SPEC F10 says `settle_review_item`. Ruled in DECISIONS
   2026-09-08 (a function cannot be probed without calling it). The SPEC
   sentence is what should move, if anything does.
2. The two fact-shaped review items, every §7 settlement, the reference
   picker, and the verdict log's rows are **built, not walkable on this data** —
   staging holds one review item and neither schema object. That is M2's own
   stated grade, not a gap I am waving through.
3. EC7's second bullet (idols → group link, groups → idols in one click) is
   **mis-authored** against Ben's 2026-09-08 no-door ruling; SPEC F12 already
   cuts it. It cannot be graded green or red as written.
4. `README.md` still describes the retired dashboard (scraper operations,
   reconciliation review, `.env.local`, port 3000). Nothing it names is
   reachable; the accurate instructions live in STACK.md §5. Doc drift for the
   campaign close.

## EC14 — the stop condition, in one paragraph

VISION's satisfaction sentence is *"the verdict UI is built and both handoffs
are complete and reviewed."* **The first half is met and the second half is
half met.** The verdict UI is built and behaves correctly against the absence
that is the normal case: every §7 surface renders its not-provisioned state
naming a missing object, offers no control it cannot honour, and refuses a
forged write server-side with the missing function named — I watched all of
that, not a test of it. Both handoff artifacts exist, complete, with their
target paths and apply commands, seven columns, RLS on with zero policies, the
`wont_fix` refusal inside the function, and no sibling commit anywhere —
**authored**, but "reviewed" is Ben's word to say and he has not said it. So
the campaign stops here for Ben's verification, with the two navigation bugs
above filed against M2 and the live §7 proof (acceptance tests 6-8) deferred to
the patch run after he installs the two migrations. **There is no M3.**
