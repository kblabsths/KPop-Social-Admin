# Walking the admin window as Devin — Tuesday afternoon

Marisa is out. I was told something needs attending to. I have the same access she
does, I know roughly what this pipeline is for, and I know nothing about this week.
I gave myself an hour and a rule: I don't press anything I can't explain to her
afterwards.

Here is what happened, in order.

## 1. The dashboard told me exactly one thing needed me, and it was honest about it

Landing page, no scrolling required, two cards under **ATTENTION**:

> OPEN DECISIONS **0** — "nothing open — no question is waiting on a verdict"
> OPEN SIGNALS **1** — high, oldest 6d ago

That is a genuinely good front door. In ten seconds I knew the shape of my afternoon:
one item, high, six days old, and nobody is waiting on a verdict from me. I liked that
the zero came with a sentence instead of just a zero — "nothing open" reads as *the
system looked and found none*, not *the page failed to load*.

Below it, two tables (CYCLES, RUNS) and a line I only appreciated later:

> "The resolver last applied something 6d ago — read over every cycle on record, not
> only the newest."

That sentence turned out to be the most important thing on the page, and it's set as
grey body text under a heading. More on that at the end.

Both red run errors were quotable and self-explaining — `refusing to run:
KSPACE_BOT_USER_AGENT is not set` and `refusing to run: source ticketmaster has no row
in sources`. Nine days old, and the three runs after them succeeded, so I read those as
already dealt with. I would have liked something on the row telling me that rather than
me inferring it from ordering.

## 2. The one open signal — where I stopped

Clicked the OPEN SIGNALS card, landed on the signal queue, one row:

> high | **ticketmaster: records keep missing the creation bar at the stuck-record
> threshold** | entity_link_source_pattern | open | 6d ago | ×700

Opened it. The detail page is titled REVIEW ITEM, and under a heading called **THE
CLOSE** it says:

> "`verdicts` isn't in this database yet — it arrives with the scraper repo's
> migrations."

So: the only open item in the system is one I cannot close, and the page says so
plainly at the top instead of giving me a disabled button to hunt for. I was half
annoyed and half relieved. Annoyed, because whatever Marisa left me, this isn't a thing
I can finish today. Relieved, because I did not have to discover that by clicking
something and getting an error. Being told "you can't act here yet, and here's why" up
front is the single most respectful thing this app did to me all afternoon.

**But then I tried to understand the signal anyway, and this is where I actually
stopped.** The item's whole claim is that records "keep missing the creation bar at the
stuck-record threshold." Three separate places tell me the threshold is not knowable
from here:

> "No pattern threshold is readable from here — the dial is a source-registry setting
> in the scraper repo, so the trend is drawn without its line."

> "No threshold line is drawn. The per-source `stuck_pattern` dial lives only in the
> scraper repo's source registry, and where Admin may read it is an open question — so
> no default is substituted here."

I read that three times. It is honest and I respect it, but it leaves the signal
unassessable: I am shown a count and told the bar it allegedly crossed is invisible. I
cannot tell whether 769 stuck records is a catastrophe or a Tuesday. If Marisa asked me
"is that signal real or is the dial set too tight?" I would have no way to answer, and
that's the exact question I'd need answered before doing anything about it. **I would
have messaged her here** — and did, mentally, about twenty minutes in.

The other thing that stalled me on that page was arithmetic. Three counts, three
different numbers, no relationship stated:

- header: `asked again ×700`
- the card beside the evidence: `ticketmaster STUCK RECORDS **769**`
- foot of the evidence table: `91 of 91 evidence ids resolved to a claim, in the order
  they folded in`

I *think* 700 is folds, 769 is claims in a 14-day window (747 on 2026-08-31 + 22 on
2026-09-03 = 769, which checks out), and 91 is the evidence rows actually listed. But I
had to reconstruct that, and "91 of 91 resolved" reads like completeness right next to
a headline of 700. If I'd been asked to summarise this signal in one line for someone,
I'd have got the number wrong.

Smaller thing, same page: the evidence table has six columns — RECORD, VALUE, SOURCE,
TIER NOW, OBSERVED, PAYLOAD — but at 1440px only the first four fit; the container is
798px wide holding a 1373px table. I read the whole table, wrote "no timestamps
anywhere" in my notes, and only found OBSERVED and PAYLOAD later because I went looking
in the markup. There is no visible edge or scrollbar hinting that two columns are
parked off to the right. Meanwhile the VALUE column is full of raw JSON blobs that eat
the width, and the SOURCE column repeats the word `ticketmaster` as its own link on all
91 rows — 91 identical links to the same page, for a signal whose entire subject is
one source.

## 3. Following it down — the part that actually explained things

Claims is where the fog cleared. Buckets:

| bucket | claims |
| --- | --- |
| standing_disagreement | 0 |
| awaiting_link | **108** |
| awaiting_row | **769** |
| escalated | 0 |
| agreeing | 0 |

and 877 total. Every awaiting_row row says, in a column headed WAITING FOR:

> "at least one linked performer"

*That* is the sentence I needed at the top of the signal. The whole ticketmaster ingest
is dammed behind 108 unlinked performers; 769 event facts are queued behind them. The
"WAITING FOR" column is the best piece of writing in the app — it names the blocker in
plain words on every single row, and it's the only thing that let me build a mental
model without asking anyone.

But it also produced my sharpest moment of doubt. **The dashboard said zero decisions
are waiting on a verdict, and there are 108 links nobody can make.** From where I sit
those are in tension: something is stuck pending a human judgement, and the queue that
exists to ask humans for judgements is empty. Either the system isn't asking, or the
asking mechanism is the same missing `verdicts` table. I could not tell which from any
page, and that distinction is exactly what determines whether this is "wait for
Marisa" or "wake someone up."

Cycles & runs settled it for me, and it's the page I'd send a backend person to first:

- 69 cycles in the window, and the same line over and over: **877 facts examined, 0
  applied, 877 held**, roughly every 20–28 seconds, for six days.
- CYCLE HEALTH: `FACTS EXAMINED 55,105` — "51,776 held, and a held fact writes
  nothing"; `ERRORS 1,621` across 16 cycles.
- Four cycles marked **died**, with the explanation right under the table: "A cycle
  with no end and no outcome is still running — until it is older than the resolver's
  15m cadence, at which point it is a cycle that died: nothing rewrites its row and no
  completion is guessed."
- Older cycles carrying `column "venue" of relation "events" does not exist` — 108
  errors a cycle, repeated across about fourteen consecutive cycles — then one cycle
  with 1,597 applied and 48 entities created, then back to 0-applied forever.
- One-offs: `canonical write refused: public.venues holds no row
  a78dc1c7-8d80-4e3e-a080-390abaef5160` and `invalid input syntax for type double
  precision: "not a number"`.
- The newest adapter run: 325 records parsed, 2,122 claims emitted, **134 records
  unlinked**.

That column-does-not-exist error looks like it was fixed (the errors stop, one big
apply lands, then the pipeline goes quiet at 0/877). I'm fairly confident of that
reading, and completely unwilling to bet on it, because nothing on the page dates the
transition in a way I can point at — every one of those 69 cycles just says "6d ago".
Hovering gives me the exact UTC in a tooltip, which is a lovely touch, but I can't scan
a column of tooltips. For a table where the whole story is *when did the behaviour
change*, "6d ago" on every row is the wrong default.

I never found a page that explains what **held** means, or **folded**, or **the
creation bar**, or what an **entity_link_source_pattern** is. I inferred all of them.
There's no glossary and no hover text on any of the jargon — the only tooltips in the
app are on timestamps.

## 4. What I could and couldn't touch

The record page for a stuck event (`BTS WORLD TOUR 'ARIRANG' IN LOS ANGELES`) says:

> "`events` is resolver-owned: its values change through the resolution pipeline, never
> by a direct edit. An edit here is recorded as an admin override — a claim at the
> admin tier, applied through the pipeline and logged — and the pipeline then leaves
> that field alone."
>
> "No field here can be edited: an edit is recorded through the resolution pipeline,
> and what records it is not present in this database. Every value below is read-only
> until it is."

Clear, and the two paragraphs together tell me both the eventual design and today's
state, which is more than most half-built things bother to do. **I changed nothing.**
There was nothing to change: across all eleven pages I opened there is not a single
input, textarea, select or form in the entire app — one button, "Sign out."

Two gaps I felt on that record page. First, the record that has the `awaiting_link`
claim on `events.performers` shows no performers at all — its fields are event_id,
title, description, poster_url, starts_at, venue_id. To make a linking judgement I'd
need to see the performer string the source sent and the candidate catalogue entity
side by side; here I can see neither. Second, Claims talks about
`events.event_type`, `events.status`, `events.time_precision` and `events.ticket_url`,
and the record page has no rows for any of them. I couldn't tell whether those columns
don't exist yet or the page just doesn't show them — and after the `column "venue"
does not exist` errors in Cycles, that ambiguity made me twitchy.

## 5. Odds and ends I noticed

- **Browse** has no search. The newest 50 events by arrival, no filter, no way to type
  a name. When I wanted to check whether a specific tour had landed, I couldn't.
- The two newest rows in Browse are `the cancelled creation [resolver acceptance
  run_f43f7bf3-02cb-4c3e-bfc6-542690303623]` and `the mid-cycle creation [resolver
  acceptance run_e51eff0d-ebc3-45c4-9d55-a2a6aafbeea8]`, both dated 2027-05-01. Test
  fixtures sitting at the top of the catalogue browser. I understand this is staging;
  I still wouldn't want to demo this page to anyone.
- Several real events in Browse show `—` under SOURCES (MAMAMOO, VIVA LA LISA, one BTS
  Bulacan date) while their neighbours show `ticketmaster`. Unprovenanced rows in the
  catalogue is precisely the kind of thing I'd want flagged, and here it's just a dash
  in a column.
- The queue filter chips read `kind: signal` as selected, but the page still renders a
  DECISION QUEUE block saying "nothing open in this filtered view." I filtered to
  signals; showing me the decisions section anyway made me double-check I'd clicked the
  right chip.
- Queue health and the source trend print every week/day in the window as its own row —
  26 weeks of `0`, then 90 days of `0` with two non-zero days buried in them. On the
  source page I scrolled past eighty-odd zero rows to reach the sentence about the
  missing threshold, which is the most important sentence on the page.
- Navigation is slower than it looks like it should be. Clicking **Claims** from the
  dashboard took 3.35s; Sources 2.14s; Cycles 1.57s; Queues and Browse under a second.
  The old page stays fully on screen the whole time, with a small dark "Rendering .."
  pill in the bottom-left corner. The pill saves it — I knew the click had registered —
  but it's tucked under the sidebar and I clicked Claims a second time before I spotted
  it.

## 6. Two things that delighted me

The 404. I typed a couple of URLs on spec, and got:

> "No page at this address. Analytics, Database and Data management were retired with
> the old dashboard, and nothing replaced their URLs. The window is the six pages in
> the sidebar."

An error page that tells me what used to be there, that it's gone deliberately, and
what the app is now. I have never had a 404 answer a question I hadn't asked yet.

And the whole voice of the app, honestly. Every table says what window it read, whether
the window filled, and what it therefore does not contain — "a window of at most 200,
not a count of the cycles that exist"; "settles per week are not measurable yet: no
column records when an item was closed, so those cells are dashes and never zeros."
Someone decided that a number without its scope is a lie, and then held that line on
every single page. As the person who gets paged when a dashboard's numbers are subtly
wrong, that's worth more to me than any feature on the list.

## 7. Did I get what I came for?

Partly. I worked out **what** needs a person: 877 claims dammed behind 108 unlinked
ticketmaster performers, a resolver that has applied nothing for six days while
examining 877 facts every twenty seconds, and one high signal that has been shouting
about it since 2026-08-31.

I did **not** get to the point of confidence, and I handled nothing. Three things
stopped me, in order of how much they mattered:

1. The threshold that the one open signal is measured against isn't readable anywhere,
   so I can't judge whether the signal is proportionate.
2. "OPEN DECISIONS 0" next to 108 things visibly waiting on a human judgement. I can't
   tell whether the system isn't asking me, or can't ask me yet.
3. Nothing is actionable at all — the `verdicts` table isn't here — so even if I were
   confident, the only move available is to tell someone.

What would have let me act: the signal's threshold shown next to its count, even as
"dial not readable, so this is unassessed"; a line on the dashboard connecting "0
decisions" to "877 claims held" so I'm not left inferring the relationship; real dates
on the cycles table so I can see when the behaviour changed; and, on a stuck record,
the unlinked performer string next to the catalogue candidates.

So: I've written Marisa a note. I know more than enough to brief her in two minutes,
which is better than I expected from an app I'd never opened, and I broke nothing,
which is what I came in caring about most.
