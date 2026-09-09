# Chasing a wrong venue through the admin window — Priya, 2026-09-09

I came in holding one complaint: "one of the events is at the wrong venue." No event
id, no title. I wanted the tool to (a) help me find a candidate, (b) show me where that
venue value came from, (c) let me correct it in a way that sticks. Desktop, 1440x900,
keyboard where I could.

## What I did, in order

**1. Dashboard.** Two cards — `OPEN DECISIONS 0` / `OPEN SIGNALS 1` — then CYCLES and
RUNS. I liked this immediately. Every table told me its own limits in plain words:
"a window of at most 6, not a count of the cycles that exist. The window filled its cap,
so cycles older than the ones below are not shown." I have never been told that by an
admin tool before, and it saved me from my usual first mistake of reading a truncated
list as a total. Tab order from the top is exactly the sidebar, then Sign out, then the
content — no hidden traps.

**2. The one open signal**, because "1 high, oldest 6d ago" looked like the tool
offering me something worth checking. It read:

> ticketmaster: records keep missing the creation bar at the stuck-record threshold

The evidence table below it is where I first got excited and then stuck. It lists 91
claims — `events.performers`, `events.venue`, `venues.timezone` — with values like
`events.venue {"ref":"KovZpZAEAn6A"}`. The footer says "91 of 91 evidence ids resolved
to a claim, in the order they folded in."

Here is the problem: the RECORD column says `events.venue`, which is a *field name*, not
a record. Nothing in that row tells me **which event**. There is no id, no title, no
link. I have twenty-odd venue claims in front of me and I cannot get from any one of
them to the event it belongs to. The only links in the whole table are ~90 copies of the
word "ticketmaster", all pointing at the same source page. That was the first place I
would have closed the tab — a table of evidence where every row is a dead end except the
one column that is identical on all 91 rows.

(Small thing that made me squint: the header says "asked again ×700" and "700 folds in
all", the table shows 91 rows and claims to be complete — "Every record folded into this
signal is listed here". Two numbers that look like they should agree, don't, and nothing
explains the difference.)

**3. Browse**, to find a candidate myself. `RECENT EVENTS`, 50 rows, honestly labelled
"a window of at most 50, not the whole catalog."

The first thing I reached for was a search box. There isn't one. Not on Browse, not
globally — I tried `/`, `Cmd-K` and `Ctrl-K` on the dashboard out of habit and nothing
happened. There is also no pagination, no "older", no date filter. **So the only events
I can reach in this tool are the 50 newest by arrival.** If my colleague's wrong-venue
event isn't in those 50, my session is over — that's not a slow path, it's no path. I
kept going only because I got lucky.

I also noticed the top two rows of the live catalog are
`the cancelled creation [resolver acceptance run_f43f7bf3-02cb-4c3e-bfc6-542690303623]`
and `the mid-cycle creation [resolver acceptance run_e51eff0d-...]`. Test fixtures
sitting at the top of the catalog browse, taking two of my fifty rows.

I got lucky on row 12-14. Three ENHYPEN events, all in Amsterdam:

| title | starts (UTC) | venue | sources |
|---|---|---|---|
| ENHYPEN | 2027-03-02 19:01 | Vinyl Room - Ziggo Dome | — |
| ENHYPEN | 2027-03-02 19:01 | Ziggo Dome Club | ticketmaster |
| ENHYPEN - BLOOD SAGA | 2027-03-02 18:30 | Ziggo Dome | ticketmaster |

Two of those are at the same minute in different rooms, and one has **no source at all**.
That is my wrong-venue candidate and I found it by eye, not by the tool helping me.

**4. The record page** for the unsourced one
(`/records/events/01a03f78-a122-7baf-acf7-6f997a030048`). Clean layout, six fields, a
PROVENANCE column — exactly the column I came for. Every cell in it is `—`, and the page
explains what that means before I can misread it:

> A — in Provenance means no field provenance is recorded for that field: the value has
> no source behind it, rather than a source this page failed to read.

That sentence is genuinely excellent. It's the difference between "the tool is broken"
and "the data is like that", and it took me zero seconds to know which. **But it is also
the end of the trail.** An event is sitting in the catalog at a venue nobody claimed,
and the tool can tell me that and nothing more: not when the row appeared, not which
cycle or run wrote it, not what it was before. "Arrived 13d ago" from Browse is the only
timestamp I have.

**5. A record that *does* have provenance**, to see what the good case looks like.
The sibling event shows `venue_id → Ziggo Dome Club` with provenance
`ticketmaster, applied 6d ago`. Better — and then it stops there too. "ticketmaster,
applied 6d ago" is **not a link**. I cannot click through to:

- the claim that won, or its raw payload;
- the competing claims for that field, if any;
- the cycle that applied it (I know cycles ran 6d ago — there are 69 of them);
- any before/after for the field.

The signal page taught me these payloads have addresses — it printed
`sha256/7b/7b507988fce6d556d45703717c3def5a72c5ec709baa6531a58e3f3ffb6bca84` in a PAYLOAD
column — but that string isn't a link either, and nothing in the six pages accepts it.
Being shown the address of the thing I want and no way to open it is worse than not
being shown it.

**6. Claims**, my last idea for "show me this record's history." The buckets are lovely
and the sentence "A bucket with no claims is a real zero" is the kind of thing I'd put
on a poster. The filters are `bucket`, `source_id`, `domain` — and nothing else. There
is **no way to filter claims by record**. Since the filters are plain links, I did what
any data engineer does and typed `?record_id=<my event id>` into the address bar. The
page returned 200 and cheerfully told me "877 claims match these filters" — the same 877
as before. An unknown filter silently ignored, with a sentence actively asserting it was
applied. If I hadn't known the count by heart I'd have believed it.

I also opened **Standing disagreements**, since a wrong venue that beat a right one is
exactly a disagreement. Empty, and it told me why: "One appears when a live claim
contradicts the applied value and does not displace it — the loser stays visible here."
Fine — with one source there is nothing to disagree with. Honest, useful, not what I
needed.

**7. Where the venue trail actually ended.** I opened the three venue records by hand:

- `Ziggo Dome` — Amsterdam, NL, De Passage 100
- `Ziggo Dome Club` — Amsterdam, NL, De Passage 100
- `Vinyl Room - Ziggo Dome` — Amsterdam, NL, De Passage 100

Three venue rows, one address. That is almost certainly my colleague's bug — the same
building split three ways, and events landing on whichever name Ticketmaster used that
day. And from a venue record there is **no way back**: no "events at this venue", no
count, no link. I found these three only because I happened to click through from three
events I'd already spotted. To answer "how many events are on the wrong one of these
three?" I would have to open all 50 browse rows one at a time.

The venue record also shows only five fields — `venue_id, name, city, country, address`.
The signal page had shown me `venues.timezone Europe/Amsterdam` claimed by ticketmaster,
and the claims page lists `venues.latitude`, `venues.longitude`, `venues.timezone`
waiting. None of those appear on the venue record at all. So a fact I was shown on one
page has no home on the page that's supposed to be about that record, and I can't tell
whether it's absent, unapplied, or just not displayed.

**8. Correcting it.** Not possible, and the page says so twice — once as intent:

> `events` is resolver-owned: its values change through the resolution pipeline, never by
> a direct edit. An edit here is recorded as an admin override — a claim at the admin
> tier, applied through the pipeline and logged — and the pipeline then leaves that field
> alone.

and once as fact:

> No field here can be edited: an edit is recorded through the resolution pipeline, and
> what records it is not present in this database. Every value below is read-only until
> it is.

with the reason boxed on every page: "`verdicts` isn't in this database yet — it arrives
with the scraper repo's migrations." The Verdict log tab is that one sentence and nothing
else. I have no complaint about being blocked — I'd rather a tool refuse than let me
write something the pipeline will silently overwrite. I do note that there is nowhere at
all to *leave a note* — no way to say "this event is on a duplicate venue row, here are
the three ids" so the next person doesn't redo the twenty minutes I just spent. My
finding leaves the building in Slack.

## Where I'd have given up

Twice, honestly.

1. **The signal's evidence table**, at ~2 minutes: twenty venue claims, none traceable
   to an event.
2. **Browse with no search**, at ~5 minutes: if my event hadn't been in the newest 50 I
   would have gone straight to `psql` and never come back. Everything I learned after
   that point I learned because I got lucky, not because the tool got me there.

I pushed through both to see the rest. The rest was better than the start.

## What I'd have needed to finish

- A way to find an event by title, venue, or id.
- Provenance that clicks: from `ticketmaster, applied 6d ago` to the claim, its raw
  payload, the losers, and the cycle that applied it.
- From a claim or a piece of evidence, a link to the record it's about.
- From a venue, the events pointing at it.
- Somewhere to record what I found, even if I can't fix it.

## What worked so well I didn't notice until writing this

- **Every table states its own window.** "The window did not fill — 5 of at most 6 — so
  it holds all the runs the read found." I never once had to wonder whether I was
  looking at everything.
- **Zeros are labelled as real or not.** "A bucket with no claims is a real zero" and
  "Settles per week are not measurable yet: no column records when an item was closed,
  so those cells are dashes and never zeros." Dash and zero mean different things here
  and the tool knows it. That is rare and I trust the numbers more because of it.
- **Missing dials are declared, not faked.** "No threshold line is drawn. The per-source
  `stuck_pattern` dial lives only in the scraper repo's source registry... so no default
  is substituted here." A tool that refuses to invent a threshold has bought a lot of
  credit with me.
- **The numbers reconcile.** I disbelieved the Cycle health card — it says 1,708 applied
  while every cycle row on my screen said APPLIED 0. So I summed the column across all 69
  rows myself: 1,710 applied, 1,622 errors, 49 created, 51,776 held. The card says 1,708
  / 1,621 / 49 / 51,776 over a 65-cycle window versus the table's 69 rows. It reconciles,
  and both windows were stated. I went looking for a lie and found arithmetic.
- **404s that tell you what happened**: "Analytics, Database and Data management were
  retired with the old dashboard, and nothing replaced their URLs. The window is the six
  pages in the sidebar." And a nonexistent record id gives "No events record with that
  id — Browse lists recent events, and an event's record links to its venue. Check the id
  in the address bar." Both told me exactly whether the problem was me.
- **Back preserves my scroll** on the 50-row browse list, so clicking into a record and
  returning doesn't lose my place. That one I only noticed because the *other* case
  doesn't: toggling a column (I hid Poster from 1,800px down the page) reloads and dumps
  me at scrollY 0. Same table, two different behaviours.

## Would I come back?

For reading the pipeline's health — yes, tomorrow, and I'd trust what it told me, which
is not something I say often. For the job I actually came with — tracing one wrong fact
to its source and correcting it — no, not yet. I can see *that* a value has a source and
*that* it doesn't; I cannot see *which* source record, *what else* was claimed, or *why*
this one won, and I can't write anything back.

What would bring me back for the real job: a search box on Browse, and the words
"ticketmaster, applied 6d ago" turned into a link.
