# M3 endgame walk — the designer's pass, 2026-09-11

First pass of the M3 endgame, before the user-sims and the Verifier. Judged only
against `agenticflow/docs/vision/LOOK_AND_FEEL.md` — the Look, the Feel and the
Voice, all three, on every page.

**How it was walked.** A production build of head `f9165d18`, launched by
STACK.md §5's verbatim two-command block with the `STAGING_*` pair mapped
in-process, on my own bind-probed port **8796** (not 8770 / 8771 / 8772 / 8790);
minted walk cookie for `walker@admin-window.local`; bundled Chromium from
`agenticflow/.venv-tools` at 1440x900 and 1280x900, light and dark.
`walk_sandbox` reset before the walk and again after; the residue sweep is green
(`walk_sandbox: scanned 2 text column(s) … [label=0, note=0]`, 6 tests passed).
Nothing else on staging was written. My server was killed when I finished; 8796
is free.

**Walked:** `/` · `/claims` both tabs, bare, narrowed by chip, narrowed by a
chipless facet, and paged to the end (17 presses, 877 claims) · `/browse` paged
to the end (2 presses, 120 events) · `/queues` both tabs and four narrowings · a
real review item and its close slot · `/cycles` · `/sources` bare, narrowed to
each of its three sources, narrowed to a registered-but-absent id, and narrowed
by an unusable one · an `events` record, the `walk_sandbox` record (a real save,
an Escape, a not-null refusal, a type refusal), a not-found record and a
not-an-id record. Thirteen refusal arms of the paging control were forced at
both widths.

---

## Verdict

**Three findings, none of them P1 or P2-on-a-central-flow, and the milestone's
own work is sound.** Everything M3 set out to change — paging, the window
lines' truth, the figure labels, the effect-not-presence narrowing, the sources
scan windows, the cycles zero state — is right, and I tried hard to break it.
The three tickets are one Look rule the error path has been quietly breaking on
every page since long before M3, and two sentences.

| | |
| --- | --- |
| **BUG-0196** (P2) | A failed read's account renders the app's own sentences in the mono face reserved for the machine's words |
| **BUG-0197** (P3) | An empty claims window ranks the 0 rows it drew and apologises for withholding the rest |
| **BUG-0198** (P3) | The bound-ceiling sentence tells `/browse`'s operator to narrow a view `/browse` offers no way to narrow |

Provenance checked before filing all three: `git log` on every file named in
them returns ticket-bearing commits only. No human-lane divergence, so nothing
here is a reconciliation.

**Not re-filed, as instructed and as verified still open:** BUG-0164
(`/queues`' "Widen a filter above…" exit copy — I saw it, it is still there, a
builder is on it), TASK-0060 (`/sources`' last two source-name renderers),
DEBT-0020 (the twice-stated cause in a transport-failure account).

---

## The three findings

### BUG-0196 (P2) — the app's own words in the machine's face

The one rule this campaign has already fixed once, at P2, in this exact family
(BUG-0175). `src/lib/db/result.ts` authors four sentences about a failed read,
and all four cross to the operator in Geist Mono 11px red, inside the same run a
Postgres string uses. Measured on `/claims`, 1440x900, the paging route answered
with each arm's real shape:

- `pending_claims — a 4524-character markup document arrived here instead of the database's own words` — **mono**
- `pending_claims — the read was refused with no words to explain it` — **mono**
- `pending_claims — TypeError: fetch failed … (3 runtime stack frames dropped)` — **mono**, frames clause included

The document clause is the sharpest: its own content says *these are not the
database's words*, and it says it in the database's face.

**This is not a paging defect.** Both renderers of a failed read spell the
account as one mono span — `src/components/ui/error-line.tsx:46` (data-surface
state 4, on every page) and `src/components/ui/paging.tsx:713` — so the same
three clauses render in mono in every card on `/claims`, `/queues`, `/sources`,
`/browse` and `/cycles` whose read refuses. Paging is only where M3 made it easy
to see. ARCHITECTURE.md's own dated entry records QA measuring *"a 4,530-character
Cloudflare document rendered into three `/claims` error cards"* on this stack, so
the state is reachable, not hypothetical.

### BUG-0197 (P3) — "the 0 longest-waiting are below"

The sentence the architect parked for this walk, graded at 1440x900 as asked.
Over an empty card it reads *"900 claims in all; the 0 longest-waiting are
below — the rest are not shown."* It fails the Register — nobody reading you
their own logbook ranks a set with nothing in it and then apologises for
withholding the rest directly above a card whose job is to say the read came
back empty. The count clause is sound and stays; the ranking-and-withholding
clause goes when the window drew no rows. The three byte pins in
`tests/offline/ui/primitives.test.ts` (:1759, :1762, :1801) are in the ticket's
scope and its criteria convert them to structural assertions in the same lane,
per the architect's ruling.

### BUG-0198 (P3) — a next step `/browse` cannot take

*"Narrow the view and page the smaller set."* `/browse` has no facets at all —
its only parameter is `columns`, which the page's own comment says "chooses which
COLUMNS render and never which rows are read". On `/claims` the same sentence
passes. **Unreachable on this data** (the arm needs 100,050 rows; staging holds
120 events), so P3 — filed because it is wrong, not because anyone will meet it.
The ticket carries both wrappers in its touch scope so its builder can take
either road, and says which is cheaper.

---

## What held, measured

**The paging machinery, under a real walk to the end.** `/claims` 17 presses:
rows 50 → 877, `data-window-held` **877** at every step (the count read; paging
reads no claim into it), `truncated` true → false only at exhaustion, one
`[data-window="claims"]` throughout. `/browse` 2 presses: held 50 → 100 → 120.
Appended rows are structurally identical to server-rendered ones — same links
(`/records/events/<id>`, `/sources?source_id=<id>`), same 11px mono, same 6/8
cell padding, row 50 indistinguishable from row 0.

**The window lines, every state I could reach.** First screen: *"A window of at
most 50 rows, not the whole view. 877 claims in all; the 50 longest-waiting are
below — the rest are not shown."* Continued: the cap clause is gone and the
number is the rows now held. Exhausted: *"877 claims in all, and every one of
them is below — the read found no more."* — BUG-0174's fix, confirmed on both
surfaces. Did-not-fill: `/cycles` *"69 of at most 200 … cycles recorded since
2026-09-02 08:23 UTC; nothing earlier is retained"*, the Dashboard's runs panel
*"5 of at most 6"*, `/claims?tab=standing` *"the read happened and found no
claims in the standing_disagreement bucket at all"*. Every line follows the
read, not the rows.

**A refused press settles nothing — thirteen arms, both widths.** HTML at 200
and at 502, an empty 502 body, a truncated JSON body, a foreign `{"success":…}`
envelope, a real `kind:"error"` account, a stack-frame account, the
not-provisioned answer, and a forged bound refusal. In every case: zero rows
appended, the bound unmoved, the control retained, and the window line's
`outerHTML` **byte-identical** before and after. The not-provisioned arm is gray
(`rgb(74,85,101)`), names its object once inside the identifier box, and offers
no press — BUG-0176's fix, holding.

**The paged leg notes.** Forcing `/browse`'s two legs to fail on page 2: rows
still appended (100), the venues leg red with the database's words plus the fix,
the provenance leg in the app's one not-provisioned clause. The legs travel with
the answer.

**Effect, not presence.** `/claims?source_id=<test_harness>` says *"Claims
observed **matching these filters** since …"*; `/claims?source_id=<ticketmaster>`,
which removes nothing, says *"Claims observed since …"* and *"877 claims in
all"*. A facet the page did not apply says so in its own line (*"The URL carries
source_id, which this page did not apply: nothing below is narrowed by it."*).
`/sources` and `/sources?source_id=<uuid>` render **different** scan-window lines
(*"Claims observed from source_id 01a05782-… since …"*), on both gauges, for a
present id and an absent one; an unusable value narrows nothing and claims
nothing.

**The two claims bucket tables never read as one fact.** `TOTAL COUNTS` and
`WINDOW COUNTS`, both in the `micro` step, each with a prose caption in the
`body` step, and the caption changes arm when the URL narrows (*"nothing above
narrows these counts"* → *"these counts answer for every bucket; the bucket
filter above does not narrow them"*).

**The cycles zero state.** `CYCLES IN THIS WINDOW 0` sits under a window line
naming its interval, and each card's sub-line states what its zero excludes.
The four gauge panels render the empty arm (*"No cycles in this window — the
resolver wakes on its cron and files a row, and the window fills"*), not a zero
dressed as data — while the table above shows 69 cycles, 8 days old and outside
that window. Two figures, neither pretending to be the other.

**Tokens, across eight surfaces x two themes x two widths.** The leaf-text sweep
returns **exactly the five type steps and nothing else**: 11/16 mono, 12/18
sans, 10/14 sans uppercase, 14/20 sans 600 uppercase, 20/24 mono 600. Weights
400 and 600 only. Radii: `4px` and nothing else. **Zero box-shadows anywhere.**
No horizontal page scroll at 1280 or 1440, either theme.

**Contrast, bar 12.** Every text node measured against its real backdrop on all
eight surfaces, both themes, both widths: the only ink under 4.5:1 is the
disabled `—` (2.60:1 light, 2.35:1 dark), which the palette exempts by job.
Dark-theme paging: window line `#99a1af`, refusal `#ff6467`.

**Console.** Zero errors and zero warnings on load, on every surface, both
themes, both widths, presses included. (The only console lines all day were the
browser reporting the 500s and 502s I deliberately forged.)

**Keyboard, bar 9.** Tab reaches every focusable on all six pages (8 to 94
stops) and **every single stop shows a ring** — zero ringless. The paging
control takes `#9810fa`, 2px, 1px offset, and Enter pages. *(Read the ring after
~200ms: Tailwind v4's `transition-colors` includes `outline-color`, so an
immediate read returns the mid-transition value. The M3 walk note is right and I
hit it too.)*

**Latency, bar 1's neighbour.** The control disables **4ms** after the press
(opacity 0.5, `not-allowed`, **label unchanged** — no button becomes "…"),
measured frame by frame.

**Bar 1, above the fold at 1440x900.** Dashboard's attention counts bottom at
y=210; Queues' two open counts at 283 and 485; Claims' full bucket table at 396;
Sources' registry at 230; Cycles' newest adapter run at 140; Browse's newest
event at 206.

**The em dash at the supported floor — the M3 walk note's open question,
answered.** Measured at **1280**, the supported floor, on every refusal arm after
BUG-0176 landed: **no arm wraps.** The longest app-authored reason plus its fix
ends at x=1249 against a right edge of 1264, and `<p>` height is 18px — one line
box. The em dash never heads a wrapped line at or above 1280. **Nothing to
file; the architect's ruling stands and this measurement closes it.**

**The edit cell (unchanged by M3, re-walked).** Resting hairline underline;
opens with its value selected (0..28); 1px accent border, 4px radius, mono;
Escape reverts; a real save to `walk_sandbox` landed and survived a reload; both
refusals show both halves — the database's words in mono (`null value in column
"tally" … violates not-null constraint … (23502)`, `invalid input syntax for
type integer: "not a number" (22P02)`) and the fix in the app's sans (*"tally
cannot be cleared — type a value into it."*, *"Type a whole number, like 7."*).

**Voice, swept across eleven surfaces** for every banned synonym in the
glossary: zero hits in the app's own words. Every apparent hit is the database's
text — the `events.status` fact name, a review item's own `what_happened`, an
artist called "Next Level K-Pop". `in_window` occurs zero times in rendered text
anywhere, including when forced into the URL.

---

## ~~Two proposals for you, Ben — neither is a ticket, both need your word~~ — BOTH ANSWERED by your rulings of 2026-09-11; nothing here is waiting on you

> **Closed 2026-09-11 (designer, TASK-0079).** You answered both of these after
> walking `/claims`' paging yourself. Proposal 1 is **superseded** — your ruling
> is stronger and differently shaped, and it is now **LOOK_AND_FEEL Feel bar 14**
> ("nothing the operator must find sits below a long list"). Proposal 2 is
> **granted** — bar 11 now carries your dated paging clause. The text below is
> kept as the record of how each got to you, struck where it still asks for a
> word; no walker re-raises either.

### 1. ~~"A control that extends a list is still on screen after it acts."~~ — SUPERSEDED by Ben's 2026-09-11 ruling, now Feel bar 14

I proposed this bar at the early walk and deliberately did not file it, because
no bar in LOOK_AND_FEEL covered it and inventing taste mid-milestone is drift.
**What changed today is that I measured both surfaces, and they disagree:**

| | before the press | after the press |
| --- | --- | --- |
| `/claims` | control at viewport y=434 | **y=2,066** — 1,166px below a 900px fold, `scrollY` unchanged. Same on presses 2 and 3 (y=2,084) |
| `/browse` | control at viewport y=852 | **y=852** — the browser's scroll anchoring holds it exactly in place |

So this is no longer me proposing a bar against a universal pattern; it is one
app behaving two ways with one control. Paging `/claims` to the end is 17
presses and **17 scrolls**; paging `/browse` is 2 presses and none. ~~If you
accept the bar, it goes into LOOK_AND_FEEL first and a ticket follows only if a
surface then fails it (`/claims` would). If you'd rather not, say so and I will
record it as blessed so no future walker re-raises it.~~

**How it was answered (2026-09-11):** Ben did not accept this wording — he ruled
a stronger one: *"There should not be elements at the bottom of a list this long.
We should put them at the top or on a different page, depending on the
importance…"* That is **Feel bar 14** now: the control's position after the press
was never the point, its position at all is. The measurements in the table above
are recorded in bar 14's own trace. **Both paged surfaces fail bar 14** (corrected
2026-09-11, admin-window/BUG-0217: this pass graded `/browse` by the superseded
wording, under which its scroll-anchored control passed), so the fix waiting on
Ben is **two** moves, one for `/claims` and one for `/browse`. Neither is
deliberately filed — both depend on Ben's still-open paging-shape decision
(`M3-paging-shape-for-ben.md`).

### 2. ~~Bar 11's wording no longer matches what shipped, and it is my file to fix~~ — GRANTED by Ben's 2026-09-11 ruling; the clause is written

Bar 11 reads *"State lives in the URL. Every filter, sort, and **page position**
is bookmarkable and survives the back button."* Measured: pressing "Show the
next 50" changes no URL, a reload returns to the first 50 rows, and Back leaves
the app. That is **deliberate** — ARCHITECTURE.md carries a dated 2026-09-10
amendment saying paged-in rows are the one piece of state not in the URL, traced
to SPEC F14's byte-identical-first-screen requirement and to your own choice of
on-demand client fetching as the mechanism.

I did **not** file a BUG: the app is right and my bar's wording is stale, and a
walk that files against a ruling traced to the spec is a walk overruling you. I
also did not quietly edit the bar mid-walk, because that is the same drift in
the other direction. So: at the next revision I would add one clause to bar 11 —
*"rows the operator has paged in are not URL state; what is bookmarkable is the
first screen of every URL, complete and identical to what a cold load renders"* —
which is exactly what the app does today. ~~Tell me if you want it worded
differently, or want the behaviour changed instead.~~

**How it was answered (2026-09-11):** Ben ruled the clause in. Bar 11 now carries
it, dated, naming paging as the exception in the model that ships today and
naming what stands in for the URL — the **window line** and the paging state's
**held count** — and the clause retires itself the day page position enters the
URL. Bar 11's original sentence is unchanged, and no walk needs to narrate "bar
is stale, app is right" again.

---

## Deliberately not filed

- **Two apostrophe glyphs in the app's own prose, sometimes in one sentence.**
  `pending_claims **isn’t** in this database yet — it arrives with the scraper
  **repo's** migrations.` U+2019 then U+0027, six words apart. Eight places in
  `src/` use the curly form (`The resolver’s newest cycles`, `Close as won’t
  fix`, `the source’s CURRENT tier`); everything else is straight, including
  `A source's claim contradicts…` three lines from `Tier is the source’s CURRENT
  tier…` on the same screen. It reads sloppy at 11–12px and it is a one-sweep
  fix — but **no rule in LOOK_AND_FEEL covers glyphs**, and filing it would be
  me inventing a rule at the endgame. It belongs in the Voice as one line at the
  next revision, and I will propose it then rather than smuggle it in as a BUG.
- **No button in this app has a hover state.** `Button` carries
  `transition-colors` and nothing that transitions; rows, chips, sort headers
  and stat cards all fill on hover, buttons do not. Pre-existing since M1, blessed
  by two prior walks, and the Look does not require it. Noted, not filed.
- **The exhausted window line and the exhausted note now say the same thing
  twice** — *"…every one of them is below — the read found no more"* and *"All
  claims in this view are shown."* They are ~4,000px apart after 17 presses, so
  no operator reads both at once, and BUG-0172's alternative was rejected in
  writing. Fine as it stands.
- **A forged bound refusal says "Press it again to ask for the same rows."**
  Wishful, if it could happen — but the client refuses a ceiling bound itself and
  draws the no-control arm instead, so no press reaches this. Unreachable by
  pressing; the API-shape half is EC6's, not a design bar's.
- **The regime note still prints above a not-found record page.** Carried over
  from the M2 walk's same call: odd, harmless, no bar.
- **`/queues`' old exit copy, `/sources`' two remaining source-name renderers,
  and the twice-stated transport cause** — BUG-0164, TASK-0060 and DEBT-0020,
  all open and all deliberately left alone.

---

## Not walked

- **The bound-ceiling arm in a browser.** `MAX_PAGE_OFFSET` is 100,000 against a
  50-row window: 2,000 presses and 100,000 DOM rows on `/claims`, and `/browse`
  holds 120 events against a ceiling of 100,050. Graded from the component's own
  reading and from source, and BUG-0198 says so in its first paragraph.
- **The 0-drawn window line in a browser.** It needs the count read and the row
  read to disagree that far; I could not force it on staging. Graded through the
  component reading the architect reproduced, and against its byte pin.
- **Sign-in.** A minted cookie starts the walk past the gate; that blind spot is
  accepted, not overlooked.
- **The two fact-shaped review items and the verdict log's rows.** Still not on
  staging — "built, not walkable on this data", the same honest grade M1 and M2
  gave the same gap.

Screenshots (gitignored, local): `agenticflow/tracker/evidence/M3/designer/`.
Every number and string above is the durable record.
