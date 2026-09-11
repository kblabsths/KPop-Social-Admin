# Walking the admin window as someone who assumes it is lying

Tomas Berg — 2026-09-11, production build on a scratch port, signed in as
`walker@admin-window.local`. I read nothing about this tool beforehand.

I was told this dashboard is "the window on the data pipeline" and that its
numbers match the database. I have been burned by that sentence before, so I
came to break it. I spent most of the walk on Claims, Browse and Sources,
counting things by hand and typing rubbish into the address bar.

Short version: I did not catch it lying. I caught it being inconsistent about
*how* honest it is from one page to the next, and that inconsistency is the
thing that would eventually cost it my trust — not any single wrong number.

---

## Claims: I counted every row, and the count was right

The claims page opens with a bucket table (standing_disagreement 0,
awaiting_link 108, awaiting_row 769, escalated 0, agreeing 0) and a sentence
above the long list: *"877 claims in all; the 50 longest-waiting are below —
the rest are not shown."*

So I clicked "Show the next 50 claims" seventeen times and counted what
actually landed on screen. 877 rows. Not 876, not "about 900". I then tallied
the bucket column myself across all 877: 108 awaiting_link, 769 awaiting_row.
Both exactly what the table above had told me before I started. The gauge at
the bottom independently said 877 as well. Three numbers, three different
panels, one answer. That is the first time in a long while a dashboard has
survived me doing this.

Two more claims on that page I decided to check because they were cheap to
disprove. The gauge says *"1 source, 2 domains."* I collected the distinct
values myself while I was down there: one source (ticketmaster), and the fact
names split into exactly two families, `events.*` and `venues.*`. True on both
counts. The `venues.*` claims are a handful buried deep in the list — I would
never have seen them without paging to the end, so that "2 domains" was doing
real work for me.

The moment I actually believed the page was when I hit the bottom. The
sentence above the table had **rewritten itself** to *"877 claims in all, and
every one of them is below — the read found no more,"* and a line appeared
under the last row saying *"All claims in this view are shown."* It stopped
claiming a window once the window stopped being one. I have never seen a table
header do that, and it is the single thing on this site that most changed my
posture toward it.

None of the seventeen clicks reloaded the page. My scroll position stayed put
every time, the URL never changed. It felt like one continuous document rather
than eighteen visits.

**What I did not like about it:** seventeen clicks. There is no "show all", no
page numbers, no way to jump to the oldest end. I did it because verifying was
the whole point of my visit; on any normal day I would have clicked twice,
shrugged, and taken the 877 on faith — which is exactly the habit this page
seems designed to break me of. Giving me a way to get to the bottom in one
action would let me spot-check far more often than I will now.

## The words above the table change when the filter changes — and they stay true

This is where I expected to catch it. The bucket table sits above the claims
list, so I assumed narrowing would desynchronise the two and the prose would
go stale.

It does not. With no filter the line reads *"…with every claim in it — nothing
above narrows these counts."* Pick a bucket and it becomes *"…these counts
answer for every bucket; the bucket filter above does not narrow them."* Pick a
source and it becomes *"…with the claims in it under the filters above"* — and
the numbers genuinely do drop to that source's. So the bucket chips and the
source chips have different reach into that table, and the sentence tells you
which you are looking at, every time.

I want to be clear that I still find that asymmetry surprising as *behaviour*.
I clicked a bucket chip and the table directly above it did not move; my first
reaction was "it's broken". The sentence rescued it. But the sentence only
rescues it if you read the sentence, and it is set in small grey type below a
table of large numbers, which is the wrong way round for the one line that
explains the table.

Empty results are stated as events, not as blanks. `escalated` gives me *"The
window did not fill: the read happened and found no claims matching these
filters at all"* and then *"No claims matching these filters."* That is the
distinction I care about more than any other — a read that happened and found
nothing, versus a panel that never got an answer — and it is written out in
words rather than left for me to infer from an empty box. Same on the
standing-disagreements tab: *"found no claims in the standing_disagreement
bucket at all."*

## Typing rubbish into the address bar: three pages, three different manners

This is the part of the walk that moved me backwards.

On **Claims**, I put `?bucket=banana` in the URL. The page came back with:

> The URL carries `bucket`, which this page did not apply: nothing below is
> narrowed by it.

and the bucket chip row showed "all" selected. `?source_id=not-a-uuid` got the
same treatment. So did `?limit=-1`, a parameter I invented on the spot — it
noticed a name it did not recognise and said so. `?bucket=ESCALATED` was
refused too, so it is case-sensitive, and it told me rather than guessing. I
could act on every one of those: I know my filter did not apply, so I know not
to trust my reading of the page as narrowed.

On **Browse**, the same games get nothing. `?cols=banana` renders all seven
columns and says nothing. `?cols=` renders all seven columns and says nothing.
`?table=venues` and `?q=BTS` are swallowed without a word. If I hand-edit a
Browse URL and fat-finger a column name, I get the default view and no
indication that what I asked for was discarded.

On **Sources** it is worse, and this is the one that actually cost the tool
trust. I asked for a single source with `?source_id=deadbeef` — a value that is
obviously not an id — and the page returned **the full registry, all three
sources**, with no notice of any kind. The gauges below it dropped the
"from source_id …" phrasing and quietly went back to reporting all sources. If
I had glanced at that screen believing I had narrowed to one source, I would
have read three sources' rows as one source's story and had no way to know.
That is precisely the failure mode I came here looking for, and the only reason
it is not a wrong number is that it happens to be a wrong *scope*.

What stings is that Claims already knows how to say the right sentence. The
tool has the words. Two of its six pages do not use them. After an hour of the
prose being scrupulous about windows and reads and zeros, finding a page that
silently substitutes "everything" for "the one thing you asked for" made me
re-open tabs I had already accepted.

A narrower version of the same gap: a **well-formed id for a source that does
not exist** (`01a01808-…-999999999999`) is applied as a filter. Sources at
least prints *"No sources matching this narrowing"* over the registry, which is
a hint. Claims prints nothing of the sort — I get a clean, calm, entirely empty
claims view that looks identical to a real source that genuinely has no claims.
"You are filtering on something that doesn't exist" and "this source has
nothing waiting" are very different facts about my pipeline, and I could not
tell them apart. I wanted the page to tell me it had never heard of that id.

## Sources, narrowed to one: the arithmetic holds, the reading is punishing

Narrowing to ticketmaster gave me a headline of **769 awaiting-row claims**,
matching the 769 on the Claims page exactly. Underneath, a day-by-day table.
Two days carry anything: 2026-08-31 has 747 and 2026-09-03 has 22. 747 + 22 =
769. I added it up by hand and it came out. Combined with the 769 I had already
counted row by row on Claims, that number is now as well-attested as anything
I have seen on an internal tool.

I also worried at the dates for a while, because Claims labels these same
claims "10d ago" and "8d ago" while the trend puts them on 08-31 and 09-03 —
11 and 8 days back from today. That reconciled once I discovered (late, by
hovering) that **every relative time on this site carries the exact UTC
instant as a tooltip**. The "10d ago" claims are stamped 2026-08-31 17:46 UTC.
The relative label is floored, the underlying instant is exact, and both are
available. That is the right design and I am glad it is there — but I found it
by accident twenty minutes after I needed it, and nothing on the page suggests
those greyed times are hoverable.

The trend itself is hard to use. It is 91 table rows, one per day, 89 of them
containing "0", with the two real numbers buried near the bottom. I scrolled a
full screen height of zeros to find them. Worse: the *unnarrowed* Sources page
summarises the same thing usefully — "ticketmaster | 769 claims | 2 days with
a claim" — and narrowing to that source **throws the summary away** and
replaces it with the raw 91-row dump. Narrowing gave me more noise, not less.
I wanted the opposite: the summary to stay, and the days to be something I
could see the shape of at a glance.

The registry table itself is careful in a way I appreciated. *"Last run is the
newest run whose source name matches this row"* — it volunteers that the join
is on a name rather than an id, which is a weak join and it says so. And
*"Tier is the source's current tier, which drifts — not the tier the applied
value won under"* is the kind of caveat most tools leave you to discover after
you have made a bad call on it.

## I went hunting for one specific lie and it wasn't there

The dashboard says, under six cycles that all show "APPLIED 0":

> The resolver last applied something 8d ago — read over every cycle on record,
> not only the newest.

That is a headline number sourced from outside the table it sits on, which is
usually where dashboards cheat. So I went to Cycles & runs and paged the whole
list — 69 cycles — and pulled out every row with a non-zero APPLIED. There are
four. The most recent is `01a06526-09fb-…` at 8d ago with 3 applied, and it is
not in the dashboard's window of six. The sentence was true, and it was true in
a way that required someone to deliberately read past their own window to make
it true. I had assumed the opposite and I was wrong.

While I was there I did hit something jarring, though it is stated rather than
hidden. The **CYCLE HEALTH** panel on that same page reads "CYCLES IN THIS
WINDOW 0 / FACTS EXAMINED 0 / WRITES 0 / ERRORS 0 — No cycles in this window",
and it sits directly below a table of 69 cycles, roughly 1,700 applies, and
several loud errors including `column "venue" of relation "events" does not
exist`. The explanation is in the small print: the panel's window is "Cycles
started since 2026-09-04", and every cycle on record is 8–9 days old, so they
all fall just outside. It is arithmetically correct and its window is named
precisely. It still reads, at a glance, as "everything is fine, nothing is
happening" stacked on top of "here are 69 cycles and some database errors". If
I were checking this page in a hurry I would take away the wrong impression and
the page would not have lied to me to do it.

## Browse: honest about its window, silent about everything else

Browse opens with *"a window of at most 50, not the whole catalog. The window
filled its cap, so events that arrived before the ones below are not shown."*
Two clicks later it says *"120 events are on screen, and the read found no
more"* and *"All events in this view are shown."* I counted: 120. Same
self-correcting header as Claims, and it works.

But unlike Claims, Browse **never tells me the total up front**. Claims told me
"877 in all" before I paged; Browse made me page to find out there were 120. I
wanted to know the size of the catalog before deciding whether to bother.

There is also no search and no filter of any kind — 120 events and the only way
to find one is to read. The column chips let me drop columns, which is nice and
survives in the URL so I can share the view, but I wanted to find "the BTS
Melbourne one" and had no way to ask.

While counting I tallied the Sources column across all 120: **108 say
ticketmaster, 12 say "—"**. Two of those twelve are obvious test rows sitting
at the very top of the catalog, titled *"the cancelled creation [resolver
acceptance run_f43f7bf3-…]"* and *"the mid-cycle creation [resolver acceptance
run_e51eff0d-…]"*, dated 2027-05-01. They are the first two things anyone
opening Browse sees. I do not know whether they belong in a real catalog, but
they are the first impression the page makes and they read as debris. A row
labelled "cancelled" that is nonetheless present is its own small puzzle.

The other ten are more interesting. I opened several — MAMAMOO 2026 US TOUR,
BTS ARIRANG IN BULACAN — and their record pages show a real title, a real
venue, a real start time and a Ticketmaster-hosted poster URL, with the
Provenance column reading "—" on **every single field**. The record page is
blunt about what that means:

> A — in Provenance means no field provenance is recorded for that field: the
> value has no source behind it, rather than a source this page failed to read.

I want to give credit for that sentence, because it is the difference between
"we couldn't look it up" and "there is nothing behind this value", and the tool
chose to say the alarming one. But nothing anywhere counts these. There is no
panel that says "12 of 120 events carry no provenance at all." I found it by
tallying a column by hand. If this window's job is to tell me whether the
catalog is trustworthy, the count of unprovenanced canonical values is the
number I most wanted on the front page, and it is the one number I had to
compute myself.

## The record page argues with itself

Every record page opens with two paragraphs in a row:

> events is resolver-owned: its values change through the resolution pipeline,
> never by a direct edit. An edit here is recorded as an admin override — a
> claim at the admin tier, applied through the pipeline and logged — and the
> pipeline then leaves that field alone.

> No field here can be edited: an edit is recorded through the resolution
> pipeline, and what records it is not present in this database. Every value
> below is read-only until it is.

I read the first one, went looking for the edit control, found none, then read
the second one and understood. Thirty seconds wasted on a page that describes a
capability in the present tense immediately before saying it does not exist.
The second paragraph is the true one and it is the one I needed first.

## What I clicked through for and did not get

The Claims list links each `awaiting_link` claim to its record, so I followed
one: the claim was `events.performers` on `01a03f78-69bb-…`. The record page
shows six fields — event_id, title, description, poster_url, starts_at,
venue_id — and **performers is not among them**. The thing the claim was about
is not visible on the page the claim links to. Same for `events.ticket_url`,
`events.event_type`, `events.status`, `events.time_precision`, `events.ends_at`
— all named on Claims, none shown on a record.

The page does disclaim it: *"These 6 columns are the ones Admin works with for
events: a column with no line here is one this page does not draw, and its
absence says nothing about what the database holds."* That is honest and I am
glad it is there. It also means the link from a claim to its record is, for
most claim types, a link to a page that cannot answer the question I clicked it
with. I wanted to see the field the claim was arguing about.

## The broken-address pages are the best error messages here

I typed nonsense record URLs on purpose and every one of them told me something
I could act on:

- A valid uuid with no row: *"No events record with that id. Browse lists
  recent events, and an event's record links to its venue. Check the id in the
  address bar."*
- A malformed id: *"The address bar does not hold an id: events ids are uuids,
  32 hexadecimal digits usually written in five hyphenated groups."* It told me
  the *shape* of the thing I got wrong. I have filed bugs against tools that
  return a blank page for this.
- A table that doesn't exist (`/records/banana/…`): a proper 404 that also
  explains *"Analytics, Database and Data management were retired with the old
  dashboard, and nothing replaced their URLs. The window is the six pages in the
  sidebar"* — which answered a question I had not asked yet, about what
  happened to pages I might have bookmarked.

Three distinct wrong things, three distinct answers. Compare that to Sources
silently handing me all three sources when I asked for one, and the gap between
the best and worst error behaviour on this site is very wide.

## Things I only noticed because I sat down to write this

- Nothing ever reloaded. Seventeen clicks on Claims, two on Browse, all filter
  changes — one page load for the whole session, scroll position intact
  throughout. I never once lost my place.
- Every filter is a real link with a real URL. I could tab to them, press
  Enter, use the back button, and paste a narrowed view somewhere. That is why
  I was able to test any of this from the address bar at all.
- Zeros are never blanks. "A bucket with no claims is a real zero" appears
  under the bucket table, and empty panels say which read found nothing rather
  than showing an empty box. I did not have to guess once whether a panel was
  empty or broken — except on the two pages that ignore bad parameters, which
  is the same complaint again.
- Missing values are consistently "—" and the tool defines what "—" means where
  it matters.

## Would I come back

Yes, and I did not expect to write that.

I came to catch this thing lying, I checked five separate numbers by hand
(877 total, 108/769 by bucket, 120 events, 747+22=769 by day, "last applied 8d
ago"), and all five held. The self-rewriting table headers and the explicit
"the read happened and found nothing" phrasing are doing something I actively
want from a tool like this.

What would keep me coming back: giving me the total before I page rather than
after; a way to reach the end of a list without seventeen clicks; and a count
somewhere of how many canonical values have nothing behind them, since that is
the number I had to work out myself and it is the one that tells me whether any
of this is worth reading.

What would lose me: the silent parameter handling on Sources and Browse. Not
because it is dangerous on its own, but because a tool that is this careful
about its windows and its zeros has taught me to read its prose as load-bearing
— and on those two pages the prose goes quiet at exactly the moment it should
speak. The next time a number surprises me on Sources, my first thought will be
"is this actually narrowed?", and I will have no way to tell from the screen.
