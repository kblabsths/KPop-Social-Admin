# M3 user-sim reports — the designer's judgment, 2026-09-11

Both M3 walks read end to end and judged against `agenticflow/docs/vision/LOOK_AND_FEEL.md`,
the frozen `VISION.md` and `agenticflow/tracker/milestones/M3.md` (including my own endgame
walk and the two "For Ben" items already recorded there), and nothing else. Every
candidate below is one of four things: **filed** as a BUG naming the rule it
violates, **for the strategist** because a ruling already chose it, **for Ben**
because it is a product judgment no rule reaches, or **not a finding**, with the
reason. Nothing was discarded unread.

**Method.** No instance was started — a QA lane holds the primary checkout on
BUG-0200 (`src/lib/db/result.ts`) and every claim I needed was decidable from the
two reports plus the source. Five facts were re-measured **read-only against
staging through PostgREST** (no writes, no port bound, no `.env` value in any file
here): the newest `resolution_runs` row, the newest `runs` row, the newest
`observations` row, the `review_items` population and its `opened_at` /
`last_evidence_at` spread. Provenance was checked with `git log` on every file
behind a filed violation — **all ticket-bearing commits, no human-lane divergence,
so nothing here is a reconciliation.** BUG-0196 (closed), BUG-0197, BUG-0198 and
the two recorded "For Ben" endgame decisions are not re-filed or re-recorded.

## Filed — five BUGs, all `milestone: M3`

| id | pri | what | rule | from |
| --- | --- | --- | --- | --- |
| **BUG-0201** | P2 | `/sources?source_id=deadbeef` returns **the whole registry, all three sources**, with no notice of any kind, and the gauges quietly revert to reporting every source. A wrong scope read as a narrowed one. Three of six pages say the sentence (`/claims`, `/queues`, `/cycles`, through the shared `lib/url/dropped-params.ts`); this is one of the two that do not. | bar 13 (the line states the read); "no screen claims a mark it did not draw"; BUG-0141's own ruling — *"a `source_id` this page CANNOT use must be named rather than swallowed"* | tomas §"three pages, three different manners" |
| **BUG-0202** | P3 | `/browse?cols=banana` renders the seven default columns and says nothing; `?table=`, `?q=` are swallowed unread. The column view is shareable by URL, so a discarded `cols` hands the recipient a different view from the sender's in silence. | same rule, same module | tomas, same section |
| **BUG-0203** | P2 | **CYCLE HEALTH** renders `0 / 0 / 0 / 0` with four derived sub-lines, two inches under a table of 69 cycles, five of them dead and one carrying `canonical write refused: …`. The panel already composes the honest empty words and hands them **only to its two distributions**, so one panel answers one emptiness two ways. | the Feel → Zeroes (*"a zero … never stands bare beside the rows it silently drops"*); the four states (Empty) | **both sims, independently** — marisa §"Cycles & runs", tomas §"I went hunting for one specific lie" |
| **BUG-0204** | P2 | The **pending-claims gauge** ignores the bucket facet — correctly, it scans `observations`, which has no bucket — and is the only caption on `/claims` that does not say so: `bucket=awaiting_link` puts "108 claims match these filters" one screen above "CLAIMS IN THIS WINDOW 877". The bucket table has the identical property and was given a clause for it on 2026-09-11; the gauge was left with the page's own comment saying its sentence *"says so by saying nothing"*. | bar 13; the campaign's own 2026-09-11 ruling on the table's clause | marisa §"Counts above vs. what I'm looking at" ("the one I'd have quoted wrong in a message to somebody") |
| **BUG-0205** | P3 | The record page opens with *"An edit here is recorded as an admin override…"* and then, in the next paragraph, *"No field here can be edited"*. Both are true; the second is the one a reader needs first. | the Voice → Register (*"plain, specific"*); same jurisdiction and same shape as BUG-0197 | tomas §"The record page argues with itself" |

**BUG-0203 reverses my own endgame call.** I graded the Zeroes principle PASS on
that exact panel eight hours ago, on the reasoning that each figure names its own
window and neither pretends to be the other. That reasoning is right about truth
and wrong about the bar — the bar is about a zero standing beside the rows it
drops, and 69 of them are on the same screen. Two document-blind strangers read it
the way the bar predicts, in the same words, without conferring. This is the one
thing the blind walk buys that no document-driven walker can.

## For the strategist — rulings already made, restated with what they cost

- **No domain chip row, while `?domain=` is a real narrowing and the gauge
  advertises "2 domains".** Ben's own A2 ruling on BUG-0138 (2026-09-10) dropped
  the chip row and kept the parameter. Marisa found the parameter by editing the
  URL (*"it works … the feature is fully built and wired into the prose; it just
  has no control on the page"*), then spent **four minutes and seventeen clicks**
  paging all 877 rows to learn that the second domain is `venues` (28 claims:
  `address` ×4, `city` ×4, `country` ×5, `latitude` ×5, `longitude` ×5,
  `timezone` ×5) — a word the page already knew. Not filed. Only Ben can revisit
  his own ruling, and the measured cost is now on the record.
- **No search anywhere.** Ben's ruling of 2026-09-10: a vision addition, out of
  M3 unless he runs `/ship revise`. Tomas: *"120 events and the only way to find
  one is to read … I wanted to find 'the BTS Melbourne one' and had no way to
  ask."* That is the **fourth** independent stranger across M1–M3 to name it.
  Evidence belongs in ROADMAP, not in a ticket.
- **`verdicts` is not in this database, so the close of every review item is a
  sentence and not a form.** Ben's uninstalled handoff; deliberately absent.
  Marisa: *"I'd rather be told than click a dead button, and the sentence is clear
  about whose problem it is. But this is the moment where my morning session stops
  being a session and becomes reading."* Not a defect; the cost of the deferral,
  in the words of the person it was deferred on.

## For Ben — eight product judgments, none of them a ticket

1. **Must a well-formed id that no source owns be named?** `/claims?source_id=<a
   uuid nothing holds>` narrows honestly and renders a calm, empty, correct view —
   *"'You are filtering on something that doesn't exist' and 'this source has
   nothing waiting' are very different facts about my pipeline, and I could not
   tell them apart."* The page already reads the registry (it labels the source
   chips from it), so the comparison costs no new read — but the sentence would be
   a **new class**: a facet value graded against a second read's vocabulary, which
   is the kind of cross-read claim M3 EC7 was written to be careful about. Your
   call, and it decides whether `/queues` and `/sources` get the same sentence.
2. **May the app judge staleness?** Three places asked for it in one morning:
   Marisa wants the top of the Dashboard to say *"how long it's been since
   anything ran, in the same size as the 72"*; she wants CYCLE HEALTH to *"get
   louder when it finds nothing"*; Tomas wants the 7-day window to stop reading as
   good news. DECISIONS 2026-09-02 forbids inventing a threshold, and M2's BUG-0125
   deliberately stopped at the same line. **BUG-0203 fixes the reading without a
   threshold** — it removes four figures that measure nothing. Widening the window,
   or colouring an 8-day-old last-apply amber, still needs a number from you.
3. **Reaching the end of a list in one action.** Your M3 sentence was *"not being
   able to load all claims if I want to is a huge oversight"*. Paging answered it;
   both strangers then paged to the end and said the same thing about the price.
   Tomas: *"seventeen clicks … on any normal day I would have clicked twice,
   shrugged, and taken the 877 on faith — which is exactly the habit this page
   seems designed to break me of."* Marisa: *"I'd have given up at click four."*
   This is **distinct from** the recorded For Ben item 1 (the control leaving the
   viewport) and the two compound: on `/claims` every press is a press **and** a
   scroll. A "show all", a bigger bite, or a jump to the oldest end are three
   different answers and all three are yours.
4. **`/browse` never states its total before you page; `/claims` does.** Tomas
   learned there were 120 events only by exhausting the list. Cost: one count read
   of exactly the shape `/claims` already issues. No bar requires it — bar 13 asks
   what the window is, not how big the object is — so it is a choice, not a defect.
5. **Nothing counts the canonical values with nothing behind them.** Tomas tallied
   `108 ticketmaster / 12 "—"` by hand across 120 rows and opened several: real
   title, real venue, real start time, provenance `—` on **every field**. *"If this
   window's job is to tell me whether the catalog is trustworthy, the count of
   unprovenanced canonical values is the number I most wanted on the front page,
   and it is the one number I had to compute myself."* DECISIONS 2026-09-04 (1) cut
   that count for want of a vision trace; this is the second campaign-wide sim to
   ask for it.
6. **Narrowing `/sources` to one source throws the summary away.** Unnarrowed it
   says "ticketmaster | 769 claims | 2 days with a claim"; narrowed it replaces that
   with a **91-row day table of which 89 are `0`**, page height 900 → 3,400px, with
   `2026-08-31: 747` and `2026-09-03: 22` at the bottom. Both sims, independently,
   said they would have taken the summary. No bar reaches "narrowing should reduce
   noise" — I am not inventing one mid-run.
7. **Something wrote 71 review items into staging today with no cycle behind
   them** — this is Marisa's "contradiction I can't reconcile", and the app is not
   the liar. Measured read-only at judgment time: `review_items` holds **72** rows,
   **71** of them opened `2026-09-11T06:13Z` with `last_evidence_at` `09:53Z`, while
   the newest `resolution_runs` row is `2026-09-03T11:22Z`, the newest adapter `runs`
   row is `2026-08-31T20:17Z`, and the newest `observations` row is
   `2026-09-03T05:41Z`. Both screens render their own table's own columns
   faithfully; the inconsistency is in the data. Whether that is the sibling
   resolver campaign, a seed, or residue matters to EC11 and to you — the verifier
   should see this before it judges "staging carries no M3 leftovers".
8. **Two data facts, unchanged from M2 and still yours.** The `NOTE` column carries
   engineering notes-to-self into the operations dashboard (`test_harness_control`'s
   four-line paragraph about acceptance 9 and Postgres index behaviour is the widest
   thing on `/sources`), and the two resolver-acceptance fixtures still sit at the
   top of `/browse` dated 2027-05-01 — *"they are the first impression the page
   makes and they read as debris."* Admin renders what the catalog holds; filtering
   or relabelling catalog rows by title is a provenance judgment Admin may not make.

## Not a finding — and why

- **"The links in those tables are unstyled browser blue/purple with underlines …
  from a different decade" (marisa).** Measured: they are `text-accent underline`
  — `#9810fa`, the palette's accent, plus the app's single link mark
  (`IN_PAGE_LINK`, `src/components/cycles/links.ts`). Not a browser default; it is
  the doc's mandated link spelling, won by BUG-0054 and applied app-wide by
  BUG-0099 after an M1 sim scanned 36-character uuids by eye because links
  announced themselves only under the pointer. Her reading is recorded as
  calibration: a dense mono table full of underlined purple reads to at least one
  operator as unstyled. It is not a violation and I will not file against the rule
  that fixed a worse one.
- **`/sources`' checkpoint as a full ISO string three columns from "10d ago".**
  `sources.checkpoint` is *"one opaque resume token, readable and writable only by
  its adapter"* — the database's word, rendered verbatim in mono (copy bar 5).
  Copy bar 6's "never a raw ISO string in a scannable column" governs instants the
  app renders; formatting this one would assert it is a timestamp. The cost of a
  correct rule.
- **"Cycle … is marked in the table below" and the page does not scroll there.**
  The id in that sentence **is** an in-page link — accent ink, underlined, at rest,
  `href="#cycle-<id>"` (`src/components/cycles/asked-cycle.tsx:101-104`) — which is
  exactly the clause the Look added for deep links (*"the mark is never the only way
  to reach it … lands on its row in one click rather than a scan of 36-character
  ids"*). She ctrl-F'd past it. No bar reaches "scroll me there", and the one-click
  affordance the doc asks for is present.
- **Died cycles show a blank error and a blank duration, and the rows are not
  clickable.** The blank is the database's null under the mandated `—`; the note
  under the table already explains what a cycle with no end and no outcome is. A
  cycle detail page is a new surface and **M3 opens none**.
- **No hint anywhere of *why* 877 facts are held.** VISION: *"the app assumes a
  fluent operator, not a newcomer"*, and the register forbids explaining words this
  operator knows. Marisa inferred it correctly two pages later. Same call M2 made
  on `held`, `folded` and the creation bar.
- **A claim links to a record page that does not draw the claimed field**
  (`events.performers`, `ticket_url`, `event_type`, `status`, `time_precision`,
  `ends_at`). That is BUG-0126's disclaimer doing its job — Tomas quoted it
  approvingly (*"honest and I am glad it is there"*). The six-column map is the
  vision's *"one hand-written map of what is editable"*; widening it is an
  ecosystem request, not an app defect.
- **The bucket name in the BUCKETS table un-filters when clicked, while the chip
  of the same name above does not toggle off.** The Look sanctions the two
  renderings (badge classifies, link navigates) and says nothing about control
  symmetry. Real cost — she lost her filter without meaning to — so it is a
  proposed line below, not a bar invented at the endgame.
- **Claims took 3.2s and each chip click ~2.5s (marisa), against 0.3–0.4s
  elsewhere.** Her report does not name the instance; Tomas names a production
  build, she names none, and M2's precedent is that a sim on `next dev` measures
  the compiler. **M3 EC9 is the bar** (`/claims` warm ≤ 1.4s server time on a
  production build) and it is the verifier's measurement, not a ticket of mine —
  flagged here so that pass reads her numbers.
- **Back loses the 150 rows you paged.** That is bar 11's staleness, already
  recorded as "For Ben" item 2 in `M3.md` and not re-recorded here. Her sentence is
  the evidence for it: *"If I'd done that after my seventeenth click I would have
  said something unprintable and gone to psql."*

## Proposed for the next LOOK_AND_FEEL revision — not invented mid-run

1. **Column priority, or an overflow edge.** Carried from M2 (the review item's
   evidence table parking OBSERVED and PAYLOAD off-screen) and now confirmed on a
   second table: a four-line free-text `NOTE` took the width of `/sources` and wrapped
   ticketmaster's checkpoint mid-token as `2026-08-` / `31T20:28:47+00:00`. Candidate
   line: *a wide table's scannable columns come before its free-text ones, or an
   overflowing table shows its edge.*
2. **Control symmetry.** Where one facet has two controls on one page, they behave
   the same way. (The bucket link un-filters; the bucket chip does not.)
3. **A hoverable value says it is hoverable.** Every relative time carries the exact
   UTC instant in `title` — copy bar 6 mandates it and it is right — and both strangers
   found it late or by accident: *"I found it by accident twenty minutes after I needed
   it, and nothing on the page suggests those greyed times are hoverable."*
4. Bar 11's paging clause is already Ben's (M3.md, For Ben item 2); named here only
   so the proposals sit in one place. And one of mine that no sim raised: QA's residual
   on BUG-0197 — "1 claims in all" does not singularise — rides with the next copy pass.

## What delighted them

Worth reading in their own words, because it is what the next change must not cost:

- **The self-rewriting window line.** Both sims named it the moment they changed
  posture. Tomas: *"The sentence above the table had rewritten itself to '877 claims
  in all, and every one of them is below — the read found no more' … I have never seen
  a table header do that, and it is the single thing on this site that most changed my
  posture toward it."* Marisa: *"at no point did I have to wonder whether I was looking
  at everything. Every table on this app tells me what it is and isn't showing me. I
  have never used an internal tool that does that."*
- **Five numbers hand-verified, all held.** 877 counted row by row over seventeen
  presses; 108/769 tallied by bucket; 120 events; 747 + 22 = 769 by day; and *"the
  resolver last applied something 8d ago"* — a headline sourced from outside its own
  table, which Tomas went hunting for as a lie and found true: *"it was true in a way
  that required someone to deliberately read past their own window to make it true. I
  had assumed the opposite and I was wrong."*
- **Zeros that are real zeros, and reads that say they happened.** *"The window did
  not fill: the read happened and found no claims matching these filters at all"* —
  Tomas: *"that is the distinction I care about more than any other."*
- **Paging that keeps your place.** Seventeen presses, scroll position unmoved, no
  reload, the button removing itself at the end: *"It felt like one continuous
  document rather than eighteen visits."*
- **The broken-address pages.** A valid uuid with no row, a malformed id that is told
  its *shape*, and a retired route that explains what happened to a bookmark: *"Three
  distinct wrong things, three distinct answers. I have filed bugs against tools that
  return a blank page for this."*
- **The provenance sentence.** *"A — in Provenance means no field provenance is
  recorded for that field: the value has no source behind it, rather than a source this
  page failed to read."* — *"the tool chose to say the alarming one."*
- **The registry's two caveats**, volunteered rather than discovered later: that "last
  run" joins on a name rather than an id, and that tier drifts and is not the tier the
  applied value won under.
- **The review-item detail page.** Marisa: *"the fold count explained, the evidence
  table with the raw payload and a sha256 pointer, the per-day record trend, and an
  honest closing line — '91 of 91 evidence ids resolved to a claim.'"* And the queue
  itself: *"These are phrased as questions to me, personally, and they're good
  questions. I knew what to do about half of them on sight."*
- Both would come back. Tomas: *"Yes, and I did not expect to write that."*
