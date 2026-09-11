# Build judgments — campaign `admin-window`

The calls the build made on Ben's behalf, most consequential first. Rewritten
**whole** at each milestone close; this is the **M3 edition**, written
2026-09-11, and it replaces the M1 edition rather than extending it. Each entry
names the **contract location that was silent or self-contradictory**, what was
decided, who decided it, and where it is recorded.

M3 EC12 caps this edition at **eight** entries where M1's was capped at fifteen,
so this is a harder cut than a summary: where two rulings of the same family
close one door, they are one entry here and two dated paragraphs there.
`agenticflow/docs/DECISIONS.md` is the complete record — **63** dated paragraphs
at this close, eleven of them from 2026-09-11 alone. This file is the eight a
reviewer should read first, and nothing below is a call a role made silently:
every one arrived through a blocked ticket or a human ruling, which is the
ground rule this file exists beside — *"a gap in the contracts is a blocked
ticket, never a judgment call silently made"* (`admin-build.md`, Ground rules).

Nothing still open appears below as settled; the open questions, including the
two the M3 endgame leaves to Ben, have their own section at the end. The two
trailing sections use `###` deliberately, so that a count of `^## ` lines is
exactly the entry count.

---

## 1. Admin changes a catalog value only through the override path — direct catalog editing is struck

`groups` and `idols` left `EDIT_CONFIG` outright: no record page, no PATCH
branch, no regime of their own, and no flag or scaffold left behind. Two regimes
remain — `resolver_owned` (`events`, `venues`, overridden through the gate) and
`sandbox` (`walk_sandbox` alone, a staging-only fixture table in nobody's
domain). The teeth are structural rather than typed, because a `Regime` member
would not stop the struck path returning under a new name: the pin is
`tests/offline/edit/config.test.ts` — **the only table whose write path is
`direct` is `walk_sandbox`** — proved on two fixtures. The same strike retired
the interim walk-write exception (one field of a real catalog row, restored in a
`finally`), so no walk and no test writes a `groups` or `idols` row again.

*Contradictory at*: the frozen `VISION.md`'s own sentence *"groups/idols edit
directly within it"* against `admin-observability.md` §8, which describes the
edit surface only as an override stamped through the observation pipeline. The
contradiction had been load-bearing since M1 — the M1 edition's entry 2 built a
whole live-test practice on the direct half.
*Decided by*: **Ben**, 2026-09-08, by striking that sentence from the frozen
vision (`vision.py amend --strike`, human-only): *"admin edits catalog tables
only through the observation pipeline; do not re-implement direct edits."* The
same-day question of whether the two tables could keep read-only record pages
was re-ruled by the **architect** on a builder's blocked question: cut, not
deferred.
*Recorded*: DECISIONS.md 2026-09-08 (two paragraphs); ARCHITECTURE §9.2, §13.8
and Common violations row 12; STACK.md §5's retired walk branch;
`admin-window/TASK-0040`.

## 2. Paging exists, and its boundary was decided at the contract rather than in a page

A page is an **offset into the first screen's own total order** — the same
`.order()` chain ending in the primary key, plus `.range()` — served by the
app's own route handler. The window size is the surface's and is decided on the
**server**; the client sends only how many rows it already holds. A bound that
is not a non-negative multiple of that window, or that exceeds
`MAX_PAGE_OFFSET` (`src/lib/paging/bounds.ts`), is refused with the reason
named, never clamped in silence; past the end is `ok` with zero rows and
"exhausted", which is an answer and not a refusal. A keyset cursor was weighed
and rejected: it survives concurrent inserts, but it hands a composable ordering
key to the client, needs a second null-ordering arm for `/claims`' `observed_at
nulls last`, and has no natural out-of-range to refuse. The honest position went
into the contract instead — a page is a bounded read at the instant it was
issued, and no concatenation is ever presented as a total. Three doors closed
with it: the fetch exception is one named control on two named surfaces and
never "components may fetch"; the first server-rendered screen stays
byte-identical to M2, so a shared link never depends on how far somebody else
paged; and paging buys no width — no third surface, no "load everything", no
raised `ROW_CAP`, and no argument that it substitutes for search.

*Contradictory at*: `ARCHITECTURE.md` §4.3, which read *"Paging is not the
answer to a cap and none is built: nothing in the spec asks for it"* — while the
spec now asks for it (SPEC F14) — against §4 rule 1 (no component fetches) and
§5 (the page function is a route's only `async` component).
*Decided by*: **Ben**, 2026-09-10, overruling the roadmap's "there is no M3"
(*"not being able to load all claims if I want to is a huge oversight"*); the
mechanism by the **architect**, in the amendment that was deliberately made the
milestone's first ticket, before any page diff.
*Recorded*: DECISIONS.md 2026-09-10 (*M3 exists* and *Paging's boundary*);
ARCHITECTURE §4.3 read kind 3, §4 rule 1, §5; `tracker/milestones/M3.md`.

## 3. A paged answer is full-or-exhausted, and the client refuses anything else rather than reinterpreting it

`/api/admin/*/rows` answers exactly the window's rows with the set continuing,
or at most the window's rows with `exhausted` true — `exhausted === rows.length
< size`, derived from the read it just made. `requestPage` treats any other
combination (short-and-continuing, or longer than the window) as what it is,
foreign data on a wire: a refusal that appends no rows, leaves `held` unmoved
and keeps the control for a retry. The cheaper fix — let the driver call a short
page the end of the set — was rejected because it converts a truncated, proxied
or stale-deploy answer into "you have seen everything", a false totality claim
on the one surface whose entire reason to exist is Ben's complaint above. What
the contract buys instead is an invariant every future consumer inherits:
**after any press, either the next bound is one this app may serve, or the state
is `exhausted`**.

*Silent at*: the 2026-09-10 paging amendment itself, one entry above — it fixed
what a page REQUEST may be and said nothing about what an answer that honours
neither arm means, which left `PageMore` drawing its "no further rows" line one
line under an answer that said the set continues.
*Decided by*: the **architect**, 2026-09-10, on QA's measurement
(`admin-window/BUG-0168`, from `admin-window/TASK-0064`), which had accepted
either ending.
*Recorded*: DECISIONS.md 2026-09-10; ARCHITECTURE §4.3; `src/lib/paging/machine.ts`.

## 4. A complete read returns the whole matching set or refuses — and where neither arm is available, the figure is dropped rather than approximated

Reads split in two. A **complete read** asks for an exact count with a total
order and an explicit range, and errors — naming the object, the count and the
cap (`ROW_CAP`, `src/lib/db/result.ts`) — whenever the count exceeds the rows
returned; a **window read** is a named, bounded, ordered window whose card says
which window it shows. A null count is a refusal, never a zero. M3 extended the
rule rather than weakening it: where only an unbounded read could produce a
figure, **the figure goes and the page says less** — `/claims`' distinct-sources
column and its domain chip row were dropped for exactly this reason, while
`?domain=` stayed a real server-side narrowing. Admin will not compute in
TypeScript what the database can answer, and will not render a number from a
population it could not bound.

*Silent at*: `admin-observability.md` §5, which specifies gauges as read-only
queries the Admin server runs and never mentions PostgREST's `db-max-rows` cap
(Supabase default 1000), which silently returns an arbitrary subset in
unspecified order; and §4's *"buckets with counts, age"*, which names figures no
bounded Admin read on this deployment can produce at all.
*Decided by*: the **architect**, 2026-09-02, from a QA finding where an open
count would have been wrong rather than refused; generalised by **Ben**,
2026-09-10 (Answer A + A2 on `admin-window/BUG-0138`).
*Recorded*: DECISIONS.md 2026-09-02 and 2026-09-10; ARCHITECTURE §4.3.

## 5. A cost problem inside the database is the scraper's to fix; Admin opens no second transport and writes no workaround

Gauges fetch a bounded, time-windowed row set and aggregate in a pure function:
no RPC, no database view, no Postgres driver — not even after Ben's env answer
made a DSN available as a name. What direct SQL would buy lives on the far side
of the scraper handoff, where the schema already is. The corollary was tested
twice by real cost. `pending_claims` timed out on staging (`57014` on seven of
eight measured read shapes); five Admin-side mitigations were measured, all five
failed, and one scraper-side artifact took the page from 8.1 s to ~300 ms with
no Admin code change. `/claims`' ordering then hit the same wall — PostgREST
exposes no relationship between `pending_claims` and `observations` (PGRST200)
and refuses aggregates on this deployment (PGRST123) — and the answer was again
an artifact for Ben, not a cache, not a swallowed timeout, not a re-computed
classification. Both are handoffs authored here as paste-ready SQL and installed
by Ben, never edited into the sibling from this repo.

*Silent at*: `admin-observability.md` §5 fixes *where* gauge SQL runs
(server-side, not a database view) but not *how* an aggregate is computed when
PostgREST offers nothing beyond `count`; `admin-build.md`'s Ground rules ban a
SQL-executing route without ruling on a direct connection; and §10 makes
everything scraper-side a handoff while that repo runs its own campaign, without
saying what a surface does meanwhile.
*Decided by*: the **architect**, 2026-09-01 (aggregate in TypeScript),
2026-09-02 (no driver) and 2026-09-03 (making "no Admin-side mitigation"
permanent once the index had landed and the cost that motivated it was gone —
the rule is deliberately decoupled from the cost); **Ben**, 2026-09-03
licensing the first scraper migration in session, and 2026-09-10 ruling the
`observed_at` handoff.
*Recorded*: DECISIONS.md 2026-09-01, 2026-09-02, 2026-09-03, 2026-09-10;
ARCHITECTURE §8 and §12; the three artifacts in
`agenticflow/tracker/for-human/` (state reported below).

## 6. The app reads `SUPABASE_*`; only the live suite reads `STAGING_SUPABASE_*`

`src/lib/db/client.ts` reads the two names the deployed service already has, and
no `STAGING_` name appears anywhere under `src/`. `tests/live/setup.ts` is the
one file that reads the staging names, and it refuses loudly and without
fallback when either credential name is unset — an unset name is never a
fallback to the production-shaped name. Parity therefore stays two
independently-written PostgREST paths. The walk recipe in STACK.md §5 is the
same ruling made runnable: the staging values are mapped onto the app's names on
the launching shell's command line, inside a subshell, so they exist for that
process and nowhere else, and no value is ever printed to check.

*Contradictory at*: `admin-build.md` Ground rules — *"live work targets the
staging project through `STAGING_SUPABASE_*` names … an unset name is a refusal,
never a fallback"* against *"the deployed Railway service is never repointed …
every push to `main` must leave the app deployable"*. The deployed service reads
`SUPABASE_*`.
*Decided by*: **Ben**, 2026-09-02 (and 2026-09-03, moving the production values
out of `.env` entirely, into Railway's own environment).
*Recorded*: DECISIONS.md 2026-09-02 and 2026-09-03; ARCHITECTURE §12;
STACK.md §5; `agenticflow/docs/SERVICES.md`.

## 7. A live proof is graded against a population that cannot move under it: bound the window or hold it still, never a tolerance

Staging is written continuously by the scraper's own campaign, so two legs of
one proof address two different populations — measured as 877 ids from the first
read and 879 from the second, minutes apart. The ruling, for every live test in
this repo: where the test writes every query, capture one instant at the top and
give every leg the same explicit **upper** edge, ending strictly before now with
a settle margin; where one leg is the app's own read and can take no upper edge,
use `whileStill` (`tests/live/parity.ts`), which reads before and after and
throws rather than passing when the database will not hold still; and **never a
numeric tolerance** — "±2 claims" cannot tell an insert from a drop, and it is
exactly the slack that would have hidden a gauge whose two legs diverged by one
claim out of 877. The door this closes: flakiness in this tier is never bought
with a retry loop, a `--retry` flag, a skip or a widened comparison. The
corollary, ruled the same day when the first statement was found incomplete:
what `whileStill` holds still is **one** read, and a snapshot never bounds a
page render.

*Silent at*: `admin-build.md` tests 2, 3, 5, 10 and 11 require a rendered figure
to match a direct read of staging, and say nothing about a table a sibling
campaign writes between the two reads — nor about which rendered *state* counts
as a pass, the 2026-09-02 half of this ruling (a live oracle names the page's
state kind before it compares a number, and `error` is always a failure).
*Decided by*: the **architect**, 2026-09-02 (the oracle) and 2026-09-10 (the
population, plus its corollary), each from a QA measurement of a red that was
not the product's fault.
*Recorded*: DECISIONS.md 2026-09-02, 2026-09-10 (two paragraphs) and 2026-09-11
(`admin-window/TASK-0077`: an oracle is sized by its assertion); ARCHITECTURE
§10; `tests/live/parity.ts`.

## 8. An account carries the DATABASE's words, and the app spells absence in exactly one place

What a failed read tells the operator is decided in ONE derivation
(`errorMessage`, `src/lib/db/result.ts`) by three anchored questions and no
fourth: did we serialise this part (provenance, no text inspected), does it
begin `<`, does it carry V8 frame lines. The first two replace the part with a
counted clause that quotes nothing; the third drops the frame lines only, never
truncating the part, so the cause postgrest-js puts in `details` still crosses
whole. Explicitly closed: no scanning of prose for a document fragment, no
entity decoding, no tag stripping, no length cap, no matching on a runtime's
vocabulary — that is the blocklist-chased-one-family-at-a-time class, and seven
QA lanes on this one function is what it cost to learn it here. This reverses
`admin-window/BUG-0016`'s pin that a transport failure's *"stack frame
included"* must survive untrimmed. Beside it, from the same week: the app has
one definition of **blank** (`hasVisibleContent`) and one of **absent**
(`isAbsentText`), they are not the same question — a lone em dash is ink to the
first and nothing to the second — and both now live in the pure leaf
`src/lib/verdict/decision.ts`, with `lib/format.ts` re-exporting rather than
re-spelling, so the character exists once in `src/` and a second hand-typed
dash cannot arrive.

*Silent at*: `admin-build.md` test 9 and the Ground rules require an absent
ecosystem table to render *"an honest not-provisioned state, never a crash"*,
and say nothing about what a read that failed some other way may put on an
operator's card; `LOOK_AND_FEEL`'s data-table rule fixes the CHARACTER — *"a
null renders as `—` in disabled-gray — never blank, never `null`, `N/A` or
`none`"* — and says nothing about which question decides that a value is null,
which is why a wire answering `{kind:"refused", reason:"—"}` reached the
operator as a red alert reading `—`.
*Decided by*: the **architect**, 2026-09-11 — `admin-window/BUG-0173` (widened
from QA's BUG-0170 residuals), `admin-window/BUG-0187` (the rule takes a bar
instead of anchors) and `admin-window/BUG-0184` (the em dash).
*Recorded*: DECISIONS.md 2026-09-11 (three paragraphs); ARCHITECTURE §4.1.
**Not closed at this close**: the last lane on this derivation —
`DEBT-0020` → `BUG-0199` → `BUG-0196` (authorship is a fact the account carries,
not a question a renderer asks) — is serial by the architect's ruling of
2026-09-11, truth before cosmetics, and an M3 P2 therefore waits on a
`patch`-milestone ticket deliberately.

---

### Questions routed rather than decided

Open at the M3 close, deliberately absent from the entries above, and all three
Ben's rather than a role's.

- **A proposed Feel bar: "a control that extends a list is still on screen after
  it acts."** No such bar exists, so nothing in M3 failed against it — but the
  two paged surfaces now disagree, measured on the landed tree at 1440x900:
  `/claims`' control travels viewport y=434 → **2,066** with `scrollY`
  unchanged (**1,166px below a 900px fold**; 2,084 on presses 2 and 3), which is
  17 presses and 17 scrolls, while `/browse`'s stays at **852**
  because the browser's scroll anchoring happens to hold it. One interaction,
  two outcomes, no rule saying which is right. Adopting the bar is a
  `LOOK_AND_FEEL` amendment plus one ticket against `/claims`; declining it
  leaves `/claims` not a defect. **The campaign will not invent the bar to
  justify the fix.** (M3.md, architect, 2026-09-11.)
- **`LOOK_AND_FEEL` bar 11 ("state lives in the URL") is stale against
  ARCHITECTURE's dated 2026-09-10 paging amendment.** Paging changes no URL, a
  reload returns to the first screen, and Back leaves the app — which is the
  amendment as written, traced to SPEC F14 and to Ben's own choice of on-demand
  client fetching. The app is right and the bar's text is not; the walk graded
  it *"bar is stale, app is right — no ticket"*, which is a verdict and not a
  licence to edit a human-owned vision doc. Until Ben rules, bar 11 is graded
  against the amendment and every walk that touches it says so. (M3.md,
  architect, 2026-09-11.)
- **The two §9 handoff artifacts are filed and placed, and "reviewed" is Ben's
  word to say.** `verdicts` and `settle_review_item` are physically in the
  sibling repo and not installed; nothing here treats them as done, and no
  Admin surface pretends they exist — the review item's close slot renders the
  honest absence instead. This is what VISION's satisfaction sentence still
  waits on, together with the deferred patch run for acceptance tests 6–8.

### Cross-directory report — M3 close

The three handoffs' state, measured 2026-09-11. Install state is the verifier's
measurement of that day against staging `ubfjjqlvnpnoborczbdb`
(`agenticflow/tracker/for-human/M3-verifier.md`); the tracked/untracked and
placement facts below were re-established here the same day, read-only, in
`../kspace Scraper`.

| artifact | filed | placed in the sibling | tracked there | installed |
| --- | --- | --- | --- | --- |
| `pending_claims.observed_at` (`M2-handoff-pending-claims-observed-at.md`) | yes | `20260910000001_a_pending_claim_carries_its_instant.sql` | **yes** (it was untracked at the M2 close) | **yes** — `select=observed_at` answers 200 |
| `verdicts` (`M2-handoff-verdicts.md`) | yes | `20260908000001_the_verdict_becomes_a_row.sql`, written 2026-09-11 11:59 | **no** | **no** — 404 `PGRST205` |
| `settle_review_item` (`M2-handoff-settle-review-item.md`) | yes | `20260908000002_the_verdict_settles_the_item.sql`, same timestamp | **no** | **no** — absent from the RPC list |

- **Commits made by this campaign in the sibling: still zero.** `git log --all
  --grep="admin-window/"` there returns 0 — a commit authored from here would
  carry a campaign-qualified ticket id by rule. The one commit whose message
  contains the campaign's name (`43505768`, 2026-09-10) is the sibling's own,
  authored by Ben in its `resolver` campaign, naming Admin as a consumer of
  `review_items`. That repo has taken 570 commits since 2026-09-01; none is
  ours.
- **No ticket's touch scope named a scraper path.** Measured across all **329**
  ticket files in `agenticflow/tracker/tickets/` and `agenticflow/tracker/archive/`:
  no `touch_scope` entry contains `Scraper` or a `../` segment.
- **Expected, and met.** `admin-observability.md` §10 makes everything
  scraper-side a handoff while a campaign runs in that repo, and its tracker's
  `RUNNING` marker is still present. Every change that repo needed from this one
  travelled as a paste-ready artifact for Ben and as nothing else.
