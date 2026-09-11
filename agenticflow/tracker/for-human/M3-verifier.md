# M3 verification — campaign `admin-window`

Verifier walk, 2026-09-11, tree `run/admin-window` at `bed26500`, production build served
on my own bind-probed port 8775 against staging `ubfjjqlvnpnoborczbdb`, Chromium 1440x900,
plus a second instance on 8776 pointed at a local PGRST205 stub. Run log with every command
and number: `agenticflow/tracker/notes/verify-M3-2026-09-11.md`.

## Verdict in one line

**M3 does not close green.** The product works — paging reaches all 877 claims and all 120
events, one request per press, no duplicates, the refusals hold, the first screen is
untouched, `/claims` is now under the 1.4 s bar — but **EC1 fails on two independent
clauses and EC12 fails on one**, so two of the thirteen criteria are red. Six tickets
filed: **BUG-0207 (P0)**, BUG-0208 (P1), BUG-0209 (P1), BUG-0210 (P2), BUG-0211 (P3),
TASK-0078 (P1).

| | criterion | verdict |
| --- | --- | --- |
| EC1 | repo bars green, live tier in the gate | **FAIL** (2 clauses) |
| EC2 | M1 and M2 still green | PASS (one named exception) |
| EC3 | contract amended before the first page diff | PASS |
| EC4 | every claim and every event reachable past the window | PASS |
| EC5 | no affordance where it cannot be honoured | PASS (all three clauses) |
| EC6 | route handler gated exactly as the pages | PASS |
| EC7 | no two figures silently disagree | PASS |
| EC8 | every window line names its narrowing | PASS |
| EC9 | read layer concurrent and still refusing | PASS |
| EC10 | no schema, no new surface, no sibling write | PASS in substance; one clause is unfalsifiable as written |
| EC11 | zero residue | PASS |
| EC12 | the campaign's own bars | **FAIL** (build_judgments) |
| EC13 | the stop condition restated | done below |

---

## EC1 — the repo's bars are green, and the live tier is in the gate

> "`npm run lint` and `npm run build` each exit 0 with zero errors, and the campaign's test
> suite passes. The suite stays **offline by default**: with no `STAGING_SUPABASE_*` names
> set it still passes, with staging tests skipped behind the explicit live marker rather
> than failing or falling back."

- *"`npm run lint` … exit 0"* — ran from the repo root. **Exit 0**, no output. PASS.
- *"`npm run build` … exit 0"* — ran with all four Supabase names unset. **Exit 0**; the
  route table it printed lists nine page routes and four API routes. PASS.
- *"the campaign's test suite passes"* — **FAIL.**
  `vitest run --project=offline` with the staging names unset: **exit 1**,
  `Test Files 1 failed | 79 passed (80); Tests 1 failed | 3968 passed (3969)`.
  The red is `tests/offline/handoff/settle-review-item.test.ts > allocates no code the
  sibling's tree holds today`: `expected [ 'KS029', 'KS030', 'KS031', 'KS032' ] to deeply
  equal []`. `--project=isolated` is red for the same root cause.
  **Why, established next door read-only:** Ben copied this campaign's own two handoff
  migrations into `../kspace Scraper/supabase/migrations/` at **11:59:31 today** and added
  the four KS codes to `tests/helpers/ks_codes.py` at **11:59:48** — minutes before this
  walk and after QA declared dry. The guard reads every `KSnnn` under the sibling root as
  text and cannot tell our own installed artifact from a stranger's claim, so the campaign's
  suite goes red exactly because the campaign's handoff is landing. → **BUG-0207, P0**.
- *"offline by default … with no `STAGING_SUPABASE_*` names set it still passes"* — the
  quantity that matters: **the same 3968 passed / 1 failed with the names set and with them
  unset**. No test changed behaviour on the names, nothing fell back, nothing tried to
  reach staging. The offline-by-default property itself is intact. PASS.
- *"for every ticket closed in M3, if its `touch_scope` matches `src/app/**` or
  `src/components/ui/**` then its `## Checks` block contains an `npm run test:live`
  invocation. **Zero exceptions**."* — **FAIL. Observed: 14 exceptions** out of 62 M3
  tickets: BUG-0168, 0171, 0172, 0174, 0175, 0176, 0177, 0178, 0180, 0183, 0186, 0191,
  0193 and TASK-0076. None of the 14 has `test:live` anywhere in the file, not only in its
  Checks block. I ran the live tier myself instead: no live regression had in fact slipped
  through (see EC2), so this is an unguarded lane rather than a missed defect.
  → **BUG-0209, P1**.

**EC1: FAIL.**

## EC2 — M1 and M2 are still green

> "Every M1 and M2 exit criterion that was PASS at its close is PASS at the M3 close. … the
> six live parity suites green (`npm run test:live`), one per page; the retired-route 404
> set still 404; the sidebar still exactly six links; `in_window` still zero occurrences in
> rendered text across all surfaces. … the whole absence proof still passes — every surface
> 200 with `data-state="not_provisioned"` against a database answering `PGRST205` to every
> read, including the new route handler's own surface behavior."

- *"the six live parity suites green … one per page"* — all ten live files that make up the
  parity set pass: dashboard (10), cycles (7), browse (6), harness (6), residue (6), runs
  (10), queues (14), sources (8), review-item (12), claims (17) — **120 tests passed**.
  PASS on the clause. **Exception, named:** `npm run test:live` as a whole **exits 1** on
  two of two full-suite runs, because one case in `tests/live/edit.live.test.ts` times out
  at 60 s under the suite's own eleven-file parallelism; that same file run alone is green
  (25 passed) with the case taking **45,627 ms of its 60,000 ms budget**. It is a timeout,
  not a wrong assertion, and it is not a parity suite — but the gate the criterion names is
  red as invoked. → **BUG-0208, P1**.
- *"the retired-route 404 set still 404"* — walked `/scrapers`, `/review`, `/analytics`,
  `/database`, `/data-management`, `/overview`, `/artists`, `/dashboard`,
  `/records/groups/1`: **404 on every one**, authenticated. `/api/admin/records/groups/1`
  answers 405 (no GET on that route), not a page. PASS.
- *"the sidebar still exactly six links"* — standing on `/` at 1440x900, read every `nav a`:
  exactly six — `/ Dashboard`, `/queues Queues`, `/claims Claims`, `/sources Sources`,
  `/cycles Cycles & runs`, `/browse Browse`. **Six, not seven.** PASS.
- *"`in_window` still zero occurrences in rendered text across all surfaces"* — zero in the
  served HTML of all six pages. Forced into the URL four ways
  (`/claims?bucket=in_window`, `/claims?source_id=in_window`, `/sources?source_id=in_window`,
  `/queues?queue=in_window`) the only occurrence anywhere is inside Next's RSC flight
  script payload echoing the URL; **stripped of tags and scripts, `in_window` is not in the
  rendered text of any of them**. PASS.
- *"every surface 200 with `data-state="not_provisioned"` against a database answering
  `PGRST205` to every read, including the new route handler's own surface behavior"* — a
  stub answering 404 + PGRST205 to every PostgREST request, a second app instance pointed
  at it. `/`, `/claims`, `/browse`, `/queues`, `/sources`, `/cycles`, the review item and a
  record page: **200 and `not_provisioned` on all eight**. The route handler's surface
  behaviour: `/claims` and `/browse` draw **zero** `data-paging` nodes, so the UI never
  calls it; called directly it answers **403** because `requireAdmin()` fails closed on the
  absent allowlist table. PASS.
  **One thing this walk found that the stub-based offline proof structurally cannot:**
  `/claims` also renders a `data-state="error"` line reading "pending_claims — the query
  returned no count, so the number of rows is unknown; a count read requires
  { head: true, count: "exact" }." A count read is a HEAD, and a real PostgREST 404 for a
  missing table carries no body on a HEAD (verified against staging: `content-length: 162`,
  nothing on the wire), so the count leg never sees `PGRST205`. → **BUG-0210, P2**. It does
  not fail this criterion's clause — the surface is 200 and carries the not-provisioned
  state — so EC2 stands.

**EC2: PASS**, with BUG-0208 and BUG-0210 named against it.

## EC3 — the paging contract is amended before the first page diff

> "`ARCHITECTURE.md` §4.3's sentence 'Paging is not the answer to a cap and none is built'
> is **gone or superseded in place**, and §4.3, §4 rule 1 and §5 each carry a dated
> amendment naming what paging may and may not do."

- *"gone or superseded in place"* — §4.3 now opens read kind 3 with "**Paged window read —
  the same window, at an explicit offset. AMENDED 2026-09-10**" and, directly beneath, a
  blockquote headed "**Superseded, in place.**" quoting the old sentence in full and saying
  which half still holds. The old sentence survives **only** inside that quote. PASS.
- *"§4.3, §4 rule 1 and §5 each carry a dated amendment naming what paging may and may not
  do"* — the dated entry of 2026-09-10 ("M3 opening amendment — paging is legal, inside a
  frame") names all three and states the boundary in one sentence: "the server decides the
  size, validates the bound and refuses out loud; the client decides only WHEN to ask", plus
  an explicit not-licensed list (component fetching generally, a second Browse view,
  whole-table browsing, search, a raised `ROW_CAP`, a page presented as a total). PASS.
- *"the amendment's commit is an ancestor of every commit that touches
  `src/app/claims/page.tsx`, `src/app/browse/page.tsx`, or any file under the new route
  handler's directory, in M3"* — amendment commit `5e8742de`. Checked with
  `git merge-base --is-ancestor` over every commit touching those paths plus
  `src/lib/paging/`: **every M3-era commit is a descendant** (15 on claims/page.tsx, 6 on
  browse/page.tsx, 3 on the claims route dir, 2 on the browse route dir, 11 on lib/paging).
  The commits that are *not* descendants are all dated 2026-09-09 or earlier, or are the
  pre-amendment 2026-09-10 window-line fixes (BUG-0138, 0160, 0161, 0162, 0163) — none of
  them is a paging diff. PASS.

**EC3: PASS.**

## EC4 — the operator can reach every claim, and every event, past the window

> "against staging (877 claims), a paged walk of `/claims` starting from the first screen
> reaches a claim whose position is beyond the first window's last row, and the total number
> of distinct claim ids reachable by paging equals the exact count the page's own head
> figure states. No id appears twice; no id is skipped."

Route walked: **sidebar → Claims → `/claims`** (first screen) → press "Show the next 50
claims" 17 times, standing on `/claims` throughout, never leaving it.
- *"reaches a claim … beyond the first window's last row"* — yes: rows went 50 → 100 → … →
  877, so rows 51 through 877 are all past the first window.
- *"the total number of distinct claim ids … equals the exact count the page's own head
  figure states"* — **877 distinct `data-claim` ids**; the page's head figure reads
  "**877 claims in all**"; the database's own count over REST is **877**. Three numbers,
  one value.
- *"No id appears twice; no id is skipped"* — **zero duplicates** (877 rows, 877 distinct);
  and since the count of distinct ids equals the total the count read established, nothing
  was skipped either. PASS.

> "the same walk on `/browse` reaches an event beyond the first window's last row."

Route: **sidebar → Browse → `/browse`**, two presses of "Show the next 50 events": 50 → 100
→ **120 rows, 120 distinct**, equal to `event_listings`' own 120. PASS.

> "each 'more' request is **one** request to the route handler carrying an explicit bound …
> the count of requests issued equals the number of times the affordance was pressed, and
> pressing nothing issues none."

Counted in the browser's network log: **17 presses, 17 requests** on `/claims` (offsets 50,
100, 150 … 850 — an explicit `?offset=` every time), **2 presses, 2 requests** on
`/browse`, and **0 requests before the first press** on both. PASS.

> "the first server-rendered screen of `/claims` and `/browse` is byte-identical in its
> window line, its figures and its row set to what it renders today, on the same fixture.
> Paging changes what happens after the first screen, never the first screen."

The paging machinery does not touch the first screen: the server HTML and the hydrated
pre-press DOM carry the same window line, the same `data-window-held="877"`,
`limit="50"`, `truncated="true"`, and the same 50 ids; zero requests are issued until a
press; the appended rows arrive **below** the server's rows, which keep their order. PASS
on the clause's intent. **Stated plainly, because "byte-identical to what it renders today"
is read against the M2 tree:** the first screen's *words* did change during M3, on purpose
and by dated ruling — BUG-0172 (the server sentence a press falsified), BUG-0174, BUG-0183,
BUG-0186, BUG-0191, BUG-0204 all moved window-line text. That is the truth work of F15, not
a paging side effect; this clause as written cannot be read literally against the M2 tree,
and I grade it on what it was protecting: paging adds, and never rewrites, the first screen.

**EC4: PASS.**

## EC5 — a paging affordance is never drawn where it cannot be honoured

> "on a fixture where the set is exhausted by the first window, the affordance is absent and
> the surface says the set is complete; on a fixture with more rows, it is present."

Reached live by narrowing rather than by fixture. Standing on `/claims`, `?domain=venues`
draws **28 rows, no control**, and the line reads "The window did not fill — 28 of at most
50 — so it holds all the claims in the venues domain the read found." `?bucket=agreeing`
and `?bucket=standing_disagreement` draw **0 rows, no control**, and say "the read happened
and found no claims matching these filters at all." Unnarrowed `/claims` (877) and
`/browse` (120) both draw it. PASS.

> "pointed at a database answering `PGRST205`, `/claims` and `/browse` render
> `data-state="not_provisioned"` and the affordance is absent — zero occurrences of its
> control in the rendered HTML."

Standing on `/claims` and `/browse` of the instance pointed at the PGRST205 stub:
`not_provisioned` present, **`data-paging` occurrences: 0**, **"Show the next" occurrences:
0**, and no window line at all. The only `<button>` in each document is the shell's theme
control. PASS.

> "a refused page request never yields a partially extended list — the rendered row count
> after a refusal equals the row count before it, and the refusal names the object, on two
> fixtures (one that must refuse, one that must not)."

Five arms driven on the live surface (real 400, forged 400, `not_provisioned`, `error`,
dead transport): **50 rows before, 50 rows after, on every one**, window line
byte-unchanged on every one, and each names its object — `pending_claims` on the two
database arms, the route on the transport arm, the bound's own reason on the two 400s. The
"must not refuse" side is the 17 presses that all succeeded. PASS.

**EC5: PASS on all three clauses.** Outside them, and filed low: after a page answers
`not_provisioned` the control stays drawn **and enabled** beneath a sentence that
deliberately offers no press → **BUG-0211, P3**.

## EC6 — the route handler is gated exactly as the pages are

> "an unauthenticated request to the paging route handler redirects or is refused before the
> handler body runs, on every method it accepts; the assertion is the same one the pages
> already carry."

Both handlers, no cookie, seven methods each (GET, POST, PUT, DELETE, PATCH, HEAD,
OPTIONS): **307 to `/login?callbackUrl=…` on all fourteen**, the same answer the six pages
give. Nothing reached a handler body. PASS.

> "a scan of the built client bundles finds no service-role key, no staging URL, and none of
> the literals `SERVICE_ROLE`, `service_role`, `STAGING_SUPABASE`. A forged request naming a
> bound outside the handler's allowed range is refused with the reason named, never clamped
> in silence."

19 JS chunks under `.next/static`: **0 files** for each of `SERVICE_ROLE`, `service_role`,
`STAGING_SUPABASE`, `supabase.co`, `eyJ`. Forged bounds, authenticated: `100050` and
`150000` → 400 "the `offset` must be at most 100000"; `49` → 400 "must be at least 50: the
first 50 rows are the screen the server already rendered"; `-1`, `abc`, `1e9` → 400 "must
be a plain decimal number — no sign, no spaces, no leading zero, no decimal point and no
exponent"; `100001` → 400 "must be a multiple of 50"; absent → 400 "the request named no
`offset`, and a page must say how many rows it already holds". Every refusal echoes the
bound **as sent**; **none was clamped**. PASS.

**EC6: PASS.**

## EC7 — no two figures on one page silently disagree

> "on a fixture holding more than 1,000 claims, the Claims tab gauge's bucket figures and
> the head counts above them are either equal, or each is labelled as the kind of fact it is
> (window vs. total) in rendered text — asserted on rendered HTML, not on the read."

Staging holds 877, so the >1,000 divergence is not reachable live; what is reachable is the
labelling, and it is explicit in rendered text on one screen: the page's bucket table is
headed "**Total counts**" and captioned "Every bucket the classification view can hold, with
every claim in it — nothing above narrows these counts", while the gauge's table 400 px
below is headed "**Window counts**" under a line naming its bounds ("Claims observed since
2026-06-13 19:22 UTC, read to 2026-09-11 19:22 UTC — a window of at most 1,000 rows, not the
whole table") with its figure card labelled "**Claims in this window** 877". Both kinds
named, in words, on the rendered page. The equal case also holds arithmetically:
108 + 769 = 877 = the head figure. PASS.

> "the same fixture produces no rendered sentence asserting a relationship between two
> figures that no single read established."

Read every sentence on `/claims` and `/browse` at 1440x900, first screen and after paging:
each count clause names its own read, and the one clause that relates two numbers ("nothing
above narrows these counts") is a statement about the read that produced them. PASS.

**EC7: PASS.**

## EC8 — every window line names the narrowing its read carried

> "`/sources`' two scan-window lines name the narrowing their read carried, for a narrowed
> URL and for an unnarrowed one; `/sources` and `/sources?<facet>=<value>` do not render
> byte-identical window lines when the facet narrows the read."

Standing on `/sources`: "Claims **observed** since 2026-06-13 19:09 UTC, read to 2026-09-11
19:09 UTC — a window of at most 1,000 rows, not the whole table." and the same for
"adjudicated". Standing on `/sources?source_id=01a01808-…`: "Claims observed **from
source_id 01a01808-8c6f-78aa-b7a7-b07ddb3b057a** since … ". Not byte-identical; the
difference is exactly the narrowing. PASS.

> "`readClaimCountSince` and the scan it is printed beside carry the same bounds — asserted
> at the read, and on the rendered page for a fixture where an unbounded upper edge would
> change the number."

On the rendered page the count sits under the scan line's own bounds and is labelled
"**Awaiting-row claims in this window** 769 / from 1 source" — the count declares the same
window the scan declares, `since` and `until` both. PASS.

**EC8: PASS.**

## EC9 — the read layer is concurrent and still refuses correctly

> "`readRowsByIds` issues its chunks concurrently, bounded … the three properties it holds
> today survive … `/claims` warm server time, measured over HTTP against a production build
> on the walk instance, is **at or under 1.4 s** … `/queues` and the review item are
> measured in the same pass and neither regresses."

- Concurrency and the three properties are stub-level assertions and they are green in the
  offline run (the one red there is the unrelated handoff guard). Live, the third property
  is observable and I saw it: a missing table reaches the page as `not_provisioned` **naming
  that table** — "pending_claims isn't in this database yet", "sources isn't…",
  "observations isn't…", and on the review item "verdicts isn't…".
- *"at or under 1.4 s"* — **n=10 warm samples over HTTP against the production build:
  min 1.117 s, median 1.235 s, max 1.392 s, zero samples over 1.4 s.** The bar is met. For
  the record, TASK-0062 recorded 2.280 → 1.714 s and handed the page bar to TASK-0074; this
  is the endgame number and it is under.
- *"`/queues` and the review item … neither regresses"* — `/queues` 0.104–0.130 s against
  TASK-0062's post-change 0.107 s (overlapping ranges, no regression); review item
  0.674–0.885 s against 1.301 s (improved). PASS.

**EC9: PASS.**

## EC10 — no schema, no new surface, no sibling write

> "this repo's `supabase/migrations/` holds exactly the two app-owned files it held at the
> M2 close."

`20260406_admin_allowed_emails.sql` and `20260407_add_kblabs_admin_email.sql` — **two
files**, last touched by commit `b5666901`, which predates the campaign. PASS.

> "`git -C "../kspace Scraper" log --all --grep=admin-window` returns zero commits, and no
> ticket closed in M3 has a `touch_scope` naming a path outside this repo."

- The grep returns **one** commit: `43505768` "review_items: a review item can name a
  reference (migration 2 of 6)", authored by **Ben** on 2026-09-10 in the sibling's own
  `entity-linking` campaign, whose message merely *mentions* "the admin-window Admin
  campaign renders live" as context. Its diff touches only sibling files. **No commit in
  the sibling was made by this campaign.** The clause as written is unfalsifiable — a
  substring grep over commit messages matches anyone who names us — and I flag it as an
  authoring defect rather than certify a number I know to be a false positive. On the thing
  it protects: PASS.
- **62 M3 tickets, zero** with a `touch_scope` naming a path outside this repo. PASS.

> "the sidebar holds exactly six links; `src/app` gains no page route; the strings `search`,
> `dial`, `threshold` introduce no new operator-facing control."

Sidebar: six (listed under EC2). Page routes: nine `page.tsx` files — the six pages plus
`/login`, the review item and the record page — the same set M2 closed with; the two new
files under `src/app/api/admin/*/rows/` are route handlers, not pages. Strings: `search`
**0 occurrences** on all six surfaces; `dial` and `threshold` occur only inside explanatory
prose ("it is drawn without its threshold line: the stuck_pattern dial is a source-registry
value only the scraper repo holds") and inside a review item's own database text; **zero
`<input>` elements on any of the six surfaces**, so no new operator-facing control. PASS.

**EC10: PASS in substance; the sibling-grep clause is reported back as mis-authored.**

## EC11 — zero residue

> "the live sweep runs green and staging carries no M3 leftovers after the final run. Walks
> write only to `walk_sandbox` once it exists…"

Sandbox reset before the walk ("deleted 3, seeded 3, read back and verified"), one real
save made through the record page cell, sandbox reset again after, then the sweep:
`residue.live.test.ts` **6 passed**, "16 column(s) scanned across 3 of 3 mapped table(s) …
walk_sandbox: [label=0, note=0]". No catalog table was written, read-only REST aside. PASS.

**The 71 review_items rows, graded explicitly, because the question was put to me.**
`review_items` holds 72 rows; 71 were opened 2026-09-11T06:13Z with `last_evidence_at`
09:53Z, while the newest `resolution_runs` and `observations` rows are both 2026-09-03. I
did not attribute them by assumption; I read them. **All 71 carry `queue = "entity_link"`
and a non-null `external_ref`** (`K8vZ917qpo7` and siblings), and `external_ref` is the
column the scraper repo added **today**, in its own commit `43505768`
(`20260911000002_a_review_item_can_name_a_reference.sql`). The 72nd row, from 2026-09-02,
has `external_ref` null. This campaign has no insert path to `review_items` — it reads
them, it has no route that writes one, and `settle_review_item` is not even installed —
and its only write surface is `walk_sandbox`. **Those rows are the `entity-linking`
campaign's live work against staging, not M3 residue**, and nothing in M3 could have
produced them. Recorded so no later reader charges them to this account.

> "no `.env` value appears in any commit, ticket, receipt or evidence file."

Checked by value, never by printing one: loaded `.env` into a subshell and searched every
tracked file, the whole tracker tree and the evidence directory for each of the six values,
plus `git log -S` on the service-role key across all refs. **The service-role key, the
staging URL, the Google secret and the DB URL appear in no commit and in no tracked file;
`git log -S` on the key returns no commit.** One match, and it needs naming: `AUTH_SECRET`'s
local value is the literal placeholder string that `.env.example` has carried since the
repo's first commit `dcc168eb` — nothing leaked out of `.env`, the developer `.env` copied
the example in. PASS. **Separately, for Ben, not a campaign defect:** that means the local
`AUTH_SECRET` is a published string, so locally minted session cookies are forgeable by
anyone with the repo. Production's value lives on Railway and is unaffected. Worth a line in
`LAUNCH.md`; I filed no ticket because `.env` is human-owned.

**EC11: PASS.**

## EC12 — the campaign's own bars

> "`docs/build_judgments.md` rewritten whole for M3, at most eight entries, each naming the
> contract location that was silent."

**FAIL.** The file opens "this is the **M1 edition**, written 2026-09-02" and carries
**15** `## ` entries; `git log` returns exactly one commit for it, the M1 one
(`50dad3c7`). No M2 or M3 edition exists anywhere in the tree. → **TASK-0078, P1**.

> "Screenshots of both paged surfaces, at the first screen and after paging."

PASS. The designer's are under `agenticflow/tracker/evidence/M3/designer/`; mine are under
`agenticflow/tracker/evidence/M3/verifier/` — `claims-first.png`, `claims-after-press1.png`,
`claims-exhausted.png`, `browse-first.png`, `browse-after-press1.png`,
`browse-exhausted.png`, plus the five refusal arms. Both directories are gitignored, which
is why every number they show is written out in the run log.

> "The cross-directory report: the three handoffs' state (filed / reviewed / installed)
> restated, including whether the installed migration is still untracked in the sibling."

PASS — it is this, established today against both trees and the live database:

| handoff | file in `../kspace Scraper` | tracked there? | on staging? |
| --- | --- | --- | --- |
| `pending_claims.observed_at` (M2) | `supabase/migrations/20260910000001_a_pending_claim_carries_its_instant.sql` | **yes, now tracked** (it was untracked at the M2 close) | **installed** — `pending_claims?select=observed_at` answers 200 |
| `verdicts` table | `supabase/migrations/20260908000001_the_verdict_becomes_a_row.sql`, written 11:59 today | **untracked** | **not installed** — the table answers 404 `PGRST205` |
| `settle_review_item` | `supabase/migrations/20260908000002_the_verdict_settles_the_item.sql`, written 11:59 today, with `tests/helpers/ks_codes.py` modified to add KS029–KS032 | **untracked** | **not installed** — absent from the PostgREST RPC list |

So: all three **filed and complete**; one **installed and now tracked**; two **placed in the
sibling working tree today, unapplied and uncommitted**. That placement is what turned this
campaign's offline suite red (BUG-0207) — the first time the handoffs have had a visible
cost here.

> "Every contract gap hit in M3 is a blocked ticket, not a silent call."

PASS on the evidence available: BUG-0179, BUG-0187 and TASK-0062 each record a blocked
question and an architect ruling in their History, and the ARCHITECTURE amendment log
carries seven dated M3 rulings. I cannot prove the absence of a silent call; I found none.

**EC12: FAIL**, on the first bullet only.

## EC13 — the campaign's stop condition, in one paragraph

**VISION's satisfaction sentence — "the verdict UI is built and both handoffs are complete
and reviewed" — is met on two of its three clauses, and the third is Ben's to declare.**
The verdict UI is built: standing on a real review item at
`/queues/01a06287-5b67-7d1f-b4a5-d90aa93cb01a` the close slot renders, and what it renders
is the honest absence — "*verdicts isn't in this database yet — it arrives with the scraper
repo's migrations*" — because staging holds no `verdicts` table and no `settle_review_item`
function, which is exactly the behaviour M2 promised for this data and not a gap in the
build. Both handoffs are complete: three artifacts, all three now physically present in the
sibling repo, one of them (`pending_claims.observed_at`) applied to staging on 2026-09-10
and since committed there, the two verdict-slice files copied into the sibling's migrations
directory at 11:59 today and still uncommitted and unapplied. "Reviewed" is the one word
only Ben can say, and the evidence that he is mid-review is the copy itself. What remains,
then, is what M3.md already predicted: Ben's review and install of the two §9 artifacts,
and the deferred patch run that proves tests 6–8 on staging afterwards — plus, now, the six
tickets this walk filed, of which **BUG-0207 (P0) must land before anything else**, because
until it does every builder's `npm test` is red for a reason that has nothing to do with
their diff. My recommendation, and it is a recommendation to Ben rather than a plan: **do
not open an M4.** Five of the six findings are small and belong to a patch run alongside the
deferred one; M3's own work — paging that reaches all 877 claims and all 120 events, a
windowed figure that no longer lies, and a `/claims` that now answers in 1.2 s instead of
2.3 — is done and walkable.

---

## The six tickets this walk filed

| id | pri | what |
| --- | --- | --- |
| **BUG-0207** | **P0** | The offline suite is red at HEAD: the KS-code guard counts our own installed handoff against us. Blocks every builder's `npm test`. |
| BUG-0208 | P1 | `npm run test:live` exits 1 as invoked — one `edit.live` case times out at 60 s under the suite's parallelism (45.6 s solo). |
| BUG-0209 | P1 | 14 M3 tickets in `src/app`/`src/components/ui` carry no `npm run test:live` check; EC1 says zero exceptions. |
| BUG-0210 | P2 | Against a real PGRST205 database `/claims` leaks "a count read requires { head: true, count: \"exact\" }" to the operator. |
| BUG-0211 | P3 | The paging control stays drawn and enabled after a page answers `not_provisioned`. |
| TASK-0078 | P1 | `docs/build_judgments.md` is still the M1 edition; EC12 asks for the M3 one. |
