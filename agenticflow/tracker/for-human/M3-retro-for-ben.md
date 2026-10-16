# M3 close — the verdict, what I cut, and the five things that are yours

Strategist, 2026-09-15. M3 is shipped (tag `m3` at 672c6536). This is the whole
of what I need from you and everything I decided on your behalf, in one page.
The reasoning is in `tracker/milestones/M3.md` (Retro) and
`docs/vision/ROADMAP.md`; the cuts are dated in `docs/DECISIONS.md`.

## The verdict: the vision is satisfied in build. I recommend ending the run.

VISION's own satisfaction sentence is *"the verdict UI is built and both handoffs
are complete and reviewed."* The UI is built and walked. Both handoffs are
complete, **installed by you on staging 2026-09-11**, and **tracked in the
scraper repo since `d1c1b3ba` on 2026-09-13** — the M2 finding about an untracked
migration is closed. Everything else VISION asks for is shipped: six pages whose
numbers a stranger hand-verified row by row, the edit surface, the old app gone,
every push deployable, zero schema written by this campaign, zero commits by this
campaign in your scraper repo across three milestones and 362 tickets.

**I am not planning an M4.** `max_milestones` is 6 and we are at 3, so the budget
is not what stops this — the vision being satisfied is. The remaining work is a
patch lane and five answers from you. Shipping done software is the win.

## The five things that are yours

**1. One staging row to put back** — unchanged since 2026-09-11.
`tracker/for-human/BUG-0215-staging-residue.md`. Event `01a03c9b-…` still wears
the title `admin-window/TASK-0018 probe override`; the sweep scans every writable
text column for the marker `admin-window`, so `npm run test:live` is red on
`residue.live.test.ts` and on nothing else. The write that made it is fixed and
swept. Only you can restore it — `verdicts` is not service-role writable, and
Admin may not write a resolver-owned catalog table. **This is the last red in the
campaign.**

**2. The paging shape — yes or no.** `tracker/for-human/M3-paging-shape-for-ben.md`,
open since 2026-09-11. It blocks BUG-0221 and nothing else. Both branches are now
costed in ROADMAP so one word starts either:
- **Yes** (page windows 20/50/100, both surfaces) → that is M4: six to ten
  tickets, SPEC F14 amended rather than extended, three M3 exit criteria
  restated, the first new operator control since M1, a different state machine,
  `?page=`/`?size=` in the URL — which incidentally makes bar 11 true again and
  delivers your own bar 14 by construction. BUG-0221 folds in and closes
  obsolete. `public.walk_sandbox` comes back as a precondition.
- **No** → two small patch tickets (move the `PageMore` control above its list on
  `/claims` and `/browse`, which is bar 14), plus BUG-0221 unblocks as one
  ARCHITECTURE §4.3 amendment and one builder session per surface.

**3. A LAUNCH.md security line, yours to word.** `requireAdmin()`
(`src/lib/admin.ts:7-24`) grants on the *shape* of an answer, not on the row
belonging to the session's email: against a non-database host at `SUPABASE_URL`,
a body of `[{"message":"no upstream"}]` makes every gated route answer 200. Two
conditions are both required — a non-database host **and** a valid session
cookie. Fix shape: read the email back and compare it to the session's, and make
the gate a `lib/db` read so §4.1's admission rule covers it. Two related items
already stand: the local `AUTH_SECRET` is the `.env.example` placeholder (locally
minted session cookies are forgeable), and the service-role key is what this app
reads staging with. Per root `CLAUDE.md` these are recorded, not fixed, and they
block launch rather than development.

**4. "Reviewed" on the two §9 artifacts.** Installed is not reviewed, and the
word is still yours. This is the one clause of VISION's satisfaction sentence
that is open, and no ticket in this campaign can close it.

**5. NEW — which staging rows are spendable, so the last acceptance test can
run.** VISION deferred acceptance tests 6, 8 and test 7's override half to *"a
patch run after Ben installs them — it is the one acceptance item deliberately
deferred."* **You installed them, so that run is now due.** I filed it:
TASK-0084, TASK-0085, TASK-0086, `patch`, chained into one lane. I did **not**
start it, because a live §7 proof is not sweepable by this app: a settlement
consumes a real `review_items` row and appends a `verdicts` row the service role
cannot delete — and **71 of staging's 72 review items are your `entity-linking`
campaign's live work** (its commit `43505768`). Running it without your word
would repeat BUG-0215 deliberately. What I need: *which* review items and *which*
event/venue rows are expendable, and who restores the after-state. One sentence
unblocks the thirteenth acceptance test and finishes the campaign.

> Note for the dispatcher/architect: the role table does not let a strategist set
> `blocked`, so those three tickets carry the hold in their titles. **Transition
> all three to `blocked` before the next dispatch tick.**

## What I cut, so you do not have to read them again

Each is reversible by one word from you; the price is written down in
`docs/DECISIONS.md` (2026-09-15) so the word is informed.

- **Naming a well-formed facet value that no row owns** — `?source_id=<a uuid
  nothing holds>` renders a calm empty view, and Tomas could not tell "you are
  filtering on something that does not exist" from "this source has nothing
  waiting". Cut not on cost (the page already reads the registry) but on class:
  it is a facet graded against a second read's vocabulary, the exact cross-read
  claim M3's EC7 forbids, and it would owe the same sentence to two more pages.
- **A total on `/browse` before you page.** One count read of a shape `/claims`
  already issues; no bar requires it. Cut as a discretionary nicety at a close
  where the recommendation is to stop.
- **A count of unprovenanced canonical values on Browse** — re-cut, not
  re-litigated. Still no vision trace. **But it is the second-best `/ship revise`
  candidate on the board** and two strangers have now computed it by hand.
- **`public.walk_sandbox` is withdrawn as a standing ask.** Open since M2, never
  pasted, and with no milestone planned there is no walk left for it to serve. It
  comes off your list and returns the day you open M4.
- **`runs` retention and the row-cap horizon leave this campaign's ledger** — they
  are scraper-side and belong in the root `backlog/`.

## Two things I closed rather than carry

- **"71 review items with no cycle behind them"** (Marisa's contradiction) — not
  a bug and not our writes. The verifier established it against both trees: all
  71 carry `queue="entity_link"` and a non-null `external_ref`, the column your
  `entity-linking` campaign added the same day. Explained, closed.
- **"Reaching the end of a list in one action"** — that is the paging-shape
  question above, not tracked twice.

## Still on your list from the sims, consolidated

- **A number for staleness** (Dashboard "how long since anything ran", CYCLE
  HEALTH getting louder when it finds nothing, the 7-day window reading as good
  news). DECISIONS 2026-09-02 forbids the team inventing a threshold, and
  BUG-0203 already fixed the worst reading without one. What is left genuinely
  needs a number from you, and it is optional.
- **Narrowing `/sources` to one source throws the summary away** — unnarrowed it
  says "ticketmaster | 769 claims | 2 days with a claim"; narrowed it replaces
  that with a 91-row day table of which 89 are `0`, page height 900 → 3,400px.
  Both strangers independently said they would have taken the summary. No bar
  reaches "narrowing should reduce noise" and the designer would not invent one
  mid-run. It is a LOOK_AND_FEEL proposal for you, alongside column priority,
  control symmetry, and "a hoverable value says it is hoverable".
- **Two staging-data facts, not app changes, ever.** The `NOTE` column carries
  engineering notes-to-self into the operations view, and the two
  resolver-acceptance fixtures dated 2027-05-01 sit at the top of `/browse` and
  *"read as debris"*. Admin renders what the catalog holds; filtering or
  relabelling catalog rows by title is a provenance judgment Admin may not make.
  If you want them gone it is a staging-data cleanup, not a ticket here.
- **Search**, and the domain chip row. Both are your own standing rulings. Search
  has now been named unprompted by **four** independent strangers across three
  milestones, and M3 tested the M2-close prediction that paging would blunt it:
  it did not — both M3 strangers had all 877 rows reachable and still named
  finding a *known* row as the thing the app cannot do. It needs `/ship revise`;
  I am not arguing you into it, only making sure the count is in front of you.
  The domain chip row's price is now measured: four minutes and seventeen clicks
  for a stranger to learn the second domain is `venues`, a word the page already
  knew. Only you revisit your own ruling.

## One structural finding, for you and not for a ticket

Two campaigns shared one staging project with no declaration protocol, and it
cost this one three separate incidents: the 71 rows appearing mid-walk, your
handoff install turning a live test into an unswept writer (BUG-0215), and a
concurrent writer reddening our venue-provenance cases (BUG-0219). Nobody broke a
rule — no rule existed. Related and one line of work only you can do: the
reciprocal KS-code guard belongs in the scraper's own
`tests/live_safety/test_codes_named_once.py`
(`tracker/for-human/M3-sibling-code-admission-for-ben.md`).

And one honest note on how M3 graded itself, which is the retro's main lesson:
EC4 certified "no id appears twice; no id is skipped" from **one** paged walk
over a population that moves — and your own dev log then found the duplicate, and
QA later found the silent skip. A live proof against a population someone else
writes has to be repeated and compared across runs, or named as a single-run
observation. If you open M4, that is the one thing its criteria must do
differently.
