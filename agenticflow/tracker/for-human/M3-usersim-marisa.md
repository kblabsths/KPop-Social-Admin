# Morning session — Marisa

2026-09-11, one coffee, about forty minutes instead of the ten I'd budgeted.
I came in wanting one thing: did last night go through, and is there anything
I have to deal with before I start my actual day.

---

## The first screen

The dashboard loads in about a second and it's laid out the way I'd lay it
out: two attention numbers up top, then the resolver's cycles, then the
adapters' runs. Nothing spins, nothing shifts under me after it paints. I
liked that immediately.

Then I read it and my stomach dropped a bit. Every cycle says `8d ago`. Every
run says `10d ago` or `11d ago`. The last two runs on the list are both
`failed` — `refusing to run: KSPACE_BOT_USER_AGENT is not set` and
`refusing to run: source ticketmaster has no row in sources`.

Here's the thing though: **nothing on that page treats "nothing has run in ten
days" as a problem.** The two big numbers are `0` open decisions and `72` open
signals. The staleness is only legible if I read the relative timestamps in a
table and do the subtraction myself. I'd come here every morning precisely to
be told "last night was fine" or "last night didn't happen," and the page will
happily show me eleven-day-old rows in exactly the same typography it would
show me rows from an hour ago. The one sentence that comes closest is *"The
resolver last applied something 8d ago"* — which is a real sentence about a
real fact, and it's buried in a paragraph between two tables.

What I wanted was for the top of the page to say, in the same size as the `72`,
how long it's been since anything ran. Right now the freshest thing on my
morning screen is the clock in my menu bar.

Also — and this is nitpicking, but I look at this every day — the links in
those tables are unstyled browser blue/purple with underlines, while the rest
of the page is a carefully chosen grey-and-mono thing. The `8d ago` cells look
like they came from a different decade than the panel they're sitting in.

## Cycles & runs

Clicked through in under a third of a second. Client-side, no flash, scroll
starts at the top. Good.

The cycles table is 69 rows and I like it a lot — full cycle ids, duration,
facts examined, applied, held, escalated, errors. This is the table I'd have
written for myself. Two things stopped me:

1. **Every single cycle held everything.** `877 facts examined, 0 applied, 877
   held`, over and over, for 69 cycles. One cycle in the middle
   (`01a06526-09fb-7534-85dd-5dfd65b293c2`) applied 3 and created 1 entity, and
   that's the entire output of the window. A column called HELD with a five-
   figure total across the page and no hint anywhere of *why* things are held
   is the thing I actually need explained. I found out later (on Claims) that
   it's "waiting for at least one linked performer" — but that's two pages away
   from where I saw the number.

2. **Five cycles say `died` with a blank error and a blank duration.** `—` in
   both. There's a note under the table explaining that a cycle with no end and
   no outcome is one that died, which is honest and I appreciate it, but the
   row itself tells me nothing about what killed it. Those are the five rows I
   would have opened, and there's nothing to open — the rows aren't clickable.
   (Coming from the dashboard, a cycle link does deep-link here and the page
   says *"Cycle … is marked in the table below."* It is marked — a thin accent
   bar on the left edge — but it was 1,510 pixels down the page and the page
   didn't scroll to it. I ctrl-F'd. Saying "below" and then not taking me there
   is a small broken promise.)

Then I hit the part that genuinely made me re-read the screen three times.

**CYCLE HEALTH says: cycles in this window `0`, facts examined `0`, writes `0`,
errors `0`, "0 cycles reported one," "No cycles in this window."**

That block sits maybe two inches under a table listing 69 cycles, five of which
died and one of which carries the error `canonical write refused: public.venues
holds no row a78dc1c7-…`. The caption does say *"Cycles started since 2026-09-04
17:01 UTC"* and my cycles are all from 09-02/09-03, so the zeros are arithmetically
correct. That doesn't help. A wall of `0`s under a heading that says HEALTH
reads as *good news* at a glance, and it's the opposite of good news — the
window is empty because the pipeline has been dead for longer than the window
is wide. I want a health panel that gets *louder* when it finds nothing, not
one that renders four calm zeros.

## The claims queue

This is where I spent most of the session.

Getting there took 3.2 seconds, noticeably longer than anything else in the app
(Cycles was 0.3s, Sources 0.4s). Long enough that I looked at the tab, not long
enough to leave.

The buckets table is excellent: five buckets, claim counts, oldest. `108`
awaiting_link, `769` awaiting_row, three real zeros. And then a sentence
telling me a bucket with no claims is a real zero, not a read that failed.
Somebody has been bitten by that before and I respect it.

**Narrowing.** There are chips for `bucket` and `source_id`. I picked
`awaiting_row`, then `ticketmaster`, two clicks, ~2.5s each, and the table
under it narrowed correctly to 769. A `clear filters` link appeared. Fine.

Then I went looking for the domain filter and there isn't one.

The gauge at the bottom of the page told me `877 claims in this window — 1
source, 2 domains`. Two domains. I can filter by source, I can filter by
bucket, and the app is telling me to my face that my claims live in two domains
and giving me no way to pick one. So I did what I always end up doing and
edited the URL. `&domain=events` — and it *works*: **"741 claims in the events
domain match these filters."** The bucket counts above it re-computed too
(108 / 741). The feature is fully built and wired into the prose; it just has
no control on the page.

I still wanted to know what the second domain was. `&domain=groups` came back
all zeros with a perfectly pleasant "a bucket with no claims is a real zero."
So I brute-forced it: I clicked "Show the next 50 claims" seventeen times to
pull all 877 rows and read the fact names. The second domain is **`venues` —
28 claims** (`venues.address` ×4, `venues.city` ×4, `venues.country` ×5,
`venues.latitude` ×5, `venues.longitude` ×5, `venues.timezone` ×5), against 849
in `events`. It took me four minutes and seventeen clicks to learn a word the
page already knew. That's the single most annoying minute of my morning, and
the fix is a row of chips identical to the two that are already there.

**Paging.** I came in ready to hate this and I don't. Each "Show the next 50
claims" took ~0.4 seconds, **my scroll position did not move a pixel**, and the
sentence above the table re-counted every time: "the 100 longest-waiting are
below", "the 150 longest-waiting", and so on. When I reached the end it said:

> 769 claims match these filters, and every one of them is below — the read
> found no more.

…and the button removed itself. That's exactly right, and it's the thing I
didn't notice until I sat down to write this: at no point did I have to wonder
whether I was looking at everything. Every table on this app tells me what it
is and isn't showing me. I have never used an internal tool that does that.

That said — fifteen clicks to walk 769 rows, seventeen to walk 877. I'd have
given up at click four if I hadn't specifically been trying to reach the end. I
wanted a "show everything" or at least a bigger bite.

And then the thing that punished me for paging: I clicked one `ticketmaster`
link in a row to see the source, then hit Back. **All 150 rows I'd loaded were
gone — back to 50, scrolled near the top.** If I'd done that after my
seventeenth click I would have said something unprintable and gone to psql.

**Counts above vs. what I'm looking at.** I did the cross-check deliberately
and mostly the app is straight with me. The buckets table changes its own
caption depending on what I've filtered — unfiltered it says "nothing above
narrows these counts," with a bucket picked it says "the bucket filter above
does not narrow them," with a source picked it says "the claims in it under the
filters above." I checked that against reality (filtering to `test_harness`
does zero out the bucket counts; filtering to a bucket doesn't) and it was
telling the truth each time. That's a level of care I don't see often.

The exception is the **PENDING CLAIMS GAUGE** at the bottom. Its caption only
mentions its time window; it says nothing about the filters. And it ignores the
bucket filter. So with `bucket=awaiting_link` I get:

- table: **"108 claims match these filters"**
- gauge, one screen lower: **"CLAIMS IN THIS WINDOW — 877 — 1 source, 2 domains"**

and with `bucket=escalated` the table says **"the read happened and found no
claims matching these filters at all"** while the gauge underneath still says
**877**. Two numbers about the same thing on the same screen, and the one page
element that's been scrupulously captioning its own scope everywhere else goes
quiet exactly where I need it to speak up. It also still says "2 domains" when
I've filtered to one source, which reads as if the filter applied. I trusted
every other number on this page; this is the one I'd have quoted wrong in a
message to somebody.

One more small trap: the bucket names in the BUCKETS table are links, and
clicking the one that's already active **un-filters**. I did that without
meaning to — I was reading the counts table, clicked `awaiting_row` because
that's the row I cared about, and landed back at all 877. The chip of the same
name above does not toggle off. Same word, two places, opposite behaviour.

## Sources

Fast, clean, and the registry table is genuinely useful — kind, lifecycle,
tier, checkpoint, last run, outcome, and per-row links straight to that
source's review items and runs. I used the `runs` link and it landed exactly
where I expected.

Two things:

- The NOTE column is carrying engineering notes-to-self. `test_harness_control`
  has a four-line paragraph about acceptance 9 and Postgres index behaviour
  sitting in my operations dashboard, and it's the widest thing on the page. It
  pushed the columns I actually read into a narrow strip on the left — the
  `ticketmaster` checkpoint got wrapped mid-token as `2026-08-` / `31T20:28:47+00:00`.
- Dates on one row are in two formats: checkpoint as a full ISO timestamp with
  offset, last run as `10d ago`. I like both; I don't like them three columns apart.

**Looking at one source in detail.** I clicked `ticketmaster` and the page
narrowed correctly — the captions even rewrote themselves to *"Claims observed
from source_id 01a05782-… since …"*. Then the AWAITING-ROW TREND turned from a
one-line rollup into a **91-row day-by-day table, oldest first, of which 89 rows
are `0`**. The two rows that matter — `2026-08-31: 747` and `2026-09-03: 22` —
are at the very bottom, past a full screen and a half of zeros. The page went
from 900 pixels to 3,400. I scrolled past three months of nothing to find two
numbers that were already summarised as "769 claims, 2 days with a claim" on
the previous screen. I'd have taken the summary.

I do appreciate that the numbers reconcile: 747 + 22 = 769 = the awaiting_row
bucket count = what the claims table paged out. I checked, and it held.

## The thing I actually came for

The only actionable number on the dashboard was `72` open signals, so I clicked
it. The queue is good — severity, a plain-English "what happened", shape,
status, opened, "asked again ×N". The top item reads *"ticketmaster: records
keep missing the creation bar at the stuck-record threshold"*, asked again
**×700**. Below it, dozens of *"ticketmaster "BIGBANG" (K8vZ917GQmV): 1 catalog
name matches closely, none exactly — which one is this, or none of them"*, each
asked again ×76. These are phrased as questions to me, personally, and they're
good questions. I knew what to do about half of them on sight.

I opened one. Lovely detail page: the fold count explained ("700 folds over the
91 evidence ids it carries"), the evidence table with the raw payload and a
sha256 pointer, the per-day record trend, and an honest closing line — *"91 of
91 evidence ids resolved to a claim."*

And then, where the answer goes, under the heading **THE CLOSE**:

> verdicts isn't in this database yet — it arrives with the scraper repo's
> migrations.

No form, no buttons, nothing. The app asked me 72 direct questions and then
told me there's nowhere to put the answers.

I'd rather be told than click a dead button, and the sentence is clear about
whose problem it is. But this is the moment where my morning session stops
being a session and becomes reading. I came to *deal with* whatever wouldn't
wait. I can see what won't wait, in beautiful detail, and I can't touch it.

## The contradiction I can't reconcile

Here's what I'd have messaged someone about.

- Cycles & runs: newest cycle **8d ago**, newest adapter run **10d ago**, and
  "cycles started in the last 7 days: **0**".
- The same app, two clicks away: 70-odd signals **opened 10h ago**, with
  **"last evidence 7h ago"** and "asked again ×76".

Something has been folding evidence into these items within the last seven
hours. The pages that exist to tell me what's been running say nothing has run
in eight days. One of those two screens is lying to me and I can't tell which
from inside the app. That's the one finding that would make me open a terminal
rather than the tab tomorrow — not because the app is ugly, but because I no
longer know which of its numbers to believe.

## Would I come back

Yes, and I want to be clear about why, because most of this report is
complaints. This app is honest in a way I've never had from an internal
dashboard: every single table tells me its window, whether the window filled,
what it's holding and what it isn't, and whether a zero is a real zero or a
failed read. "The window did not fill — 5 of at most 6 — so it holds all the
runs the read found." I didn't have to trust anybody's caching story. That is
worth more to me than any chart.

What would bring me back daily rather than weekly:

- Telling me at the top, loudly, how long it's been since anything ran — so I
  can answer "was last night fine" without reading a table.
- A domain filter on the claims page, since the app already has one and just
  won't show it to me.
- Somewhere to actually answer the 72 questions it's asking me.
- Remembering how far I'd paged when I come back from a detour.
- The health panels getting louder, not quieter, when their window is empty.

What I'd have skipped entirely: the 89 rows of zeros, and the seventeen clicks
it cost me to learn the word "venues".
