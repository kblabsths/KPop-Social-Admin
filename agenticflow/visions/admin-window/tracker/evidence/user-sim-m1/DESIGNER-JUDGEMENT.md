# Designer's judgement of the M1 user-sim walks

Written 2026-09-03 by the designer, on the two document-blind reports in this
directory (`priya.md`, `tomas.md`), judged **only** against
`agenticflow/docs/vision/LOOK_AND_FEEL.md` (Look, Feel, Voice), with scope
decided by `agenticflow/docs/vision/VISION.md` (frozen) and
`agenticflow/docs/vision/SPEC.md`.

Both reports were read whole. Nothing in them was discarded. Every distinct
moment of friction is routed below to exactly one of three places: a BUG
(a bar was violated), a retro note (the vision/spec deliberately excludes it),
or a proposed bar (the file is silent and I think it should not be — proposed
here, **not** written into LOOK_AND_FEEL.md, which does not change during a
judge pass).

**Headline:** the strangers largely confirm the design. Tomas set out to
falsify three numbers and could not falsify any of them; Priya called the
inline editor "the part of the tool I'd come back for" and learned it in zero
seconds. The failures are concentrated in two places — **the record pages**
(both sims, independently) and **reachability of the pre-cutover catalog**
(Priya, and it is out of M1 scope).

---

## 1. Filed as BUGs — a bar was violated

| BUG | Bar violated | Reported by |
| --- | --- | --- |
| **BUG-0052** P2 — the unknown-id empty state sends the operator to Browse, which does not list groups or idols | Voice copy bar 4 (an empty state names *what fills it*) | Priya, Leg 2 |
| **BUG-0053** P2 — event record page: a whole PROVENANCE column of dashes with no line saying what a dash means, while the pre-cutover page explains its own | Feel bar 5 (provenance shows at the fact); the Look's "the anatomy never changes between screens" | **Both sims, independently** |
| **BUG-0054** P2 — "Cycle `<id>` is marked in the table below" and the row carries only `aria-current`, visually identical to all 68 others | Feel bar 10 (the investigation reaches its object in one click) | Tomas |
| **BUG-0055** P3 — Cycles & runs names one state two ways on one screen: rows say `died`, the health panel says `unfinished` | Voice glossary ("one name per concept, everywhere") | Tomas |

Corroborations added to tickets the designer walk already filed, rather than
duplicates:

- **BUG-0043** (a source labelled by raw uuid) — Tomas hit it on the signal
  detail: "Its claims" and "Its source" print the same UUID, "made me stop and
  check whether one was wrong."
- **BUG-0045** (missing space, `stuck_patterndial`) — Tomas found a **third
  site** of the identical defect on Cycles & runs: the screen reads
  `sourceis`. Scope widened to `src/app/cycles/page.tsx`, criteria extended,
  with the trap recorded: `page.tsx:1003` **has** the space in source; JSX
  eats it, so only rendered markup proves the fix.

---

## 2. What the existing four-state contract already answers

The task asked specifically: **is a dash with no note a violation of the
`empty:{holds,filledBy}` rule?**

**No — and it matters that the builder of BUG-0053 knows it.**

- The four-state contract governs *a surface that can render rows*: loading,
  empty, not-provisioned, error. The record page's field table is in its **OK**
  state — it has six rows with values. It is not empty.
- A `—` is the Look's **mandated** null rendering inside a populated table
  ("A null renders as `—` in disabled-gray — never blank, never `null`, `N/A`
  or `none`"). The dashes are correct. Turning that table into an `Empty` card
  would be a *new* violation.
- The page's provenance **leg** already has its own correct four-state
  rendering: `LegNote` renders `NotProvisioned` or `ErrorLine` above the table
  when the `field_provenance` read fails or the table is absent
  (`src/app/records/[table]/[id]/page.tsx:104-116`). That is the contract
  working. The gap BUG-0053 names is a *fifth* condition the contract does not
  cover — "the read succeeded and returned nothing for this row" — which is
  neither absence-of-table nor absence-of-rows.

Same answer for Tomas's Browse observation ("10 of the 50 rows have a blank
SOURCES cell"): checked at source, `browse-table.tsx:95` returns `null` and
`DataTable` renders the disabled-gray em dash. **Not a violation.** What he
actually wants — a count of unprovenanced rows — is §4 below.

Also answered by existing contract, no ticket needed: both sims praised the
window labelling ("a window of 6, not a count", "at most 1,000 rows"), the
filtered-vs-unfiltered zero split, and the refusal to print a zero the app
cannot compute ("Settles per week are not measurable yet"). Those are Feel bar
4 and copy bar 4 working as written, and Tomas named them as the reason he
trusts the tool at all. **Do not let a fix erode them.**

---

## 3. Out of M1 scope by design — strategist's call, not a BUG

### 3.1 There is no way to reach a group or an idol. This is the biggest thing a stranger hit.

Priya's report is dominated by it: ~21 page loads and 15 minutes to establish
that the entity she was asked about cannot be reached through the UI, ending
in a SQL client.

> "**There is no search box anywhere in this application.** Not on Browse, not
> in the header, nowhere. I checked twice because I did not believe it."

> "`/records/groups/00000000-...` returned **200**. So group record pages
> exist. They are fully built. They are simply unreachable — nothing in this
> application links to one, lists one, or searches for one."

> "**This is where I would have closed the tab.** ... Once I've opened a SQL
> client to find the row, I have very little reason to come back to the browser
> to edit it."

> "**What would bring me back:** being able to type 'Seven O'Clock' somewhere
> and land on the record. That single thing turns this from a tool I can't use
> for half my questions into my default."

**This is explicitly excluded, not overlooked.** SPEC F7: "**One** curated view
ships: recent events"; "No whole-table browsing, no free-SQL runner, **no
second curated view** (spec §1, §4 Rationale)". VISION: "Browse (v1 view:
recent events)". The edit surface is specified as "reached from the records it
edits" (SPEC F1) — and in M1 the only records that link to it are events.

So **no BUG.** But the shape of the gap is worth the strategist's attention,
because it is not a missing feature so much as a **built feature with no
door**: `/records/groups/<id>` is complete, keyboard-navigable, and was the
single most-praised surface of either walk — and M1 ships it unreachable. The
cheapest doors, in ascending cost, for the M1 retro to price:

1. Nothing (accept it; the operator pastes a uuid). Then BUG-0052's copy must
   at least stop lying about how to get one — filed.
2. A groups/idols row-count or link on Browse. Still one curated *view*.
3. A name lookup. This is a second view and needs Ben.

Priya's own verdict on the asymmetry is the sentence to carry into the retro:
"'Why did it win' has an honest answer for events — the resolver, cycles,
claims, buckets, all beautifully exposed — and no answer at all for groups.
That asymmetry is invisible until you're standing in front of it."

### 3.2 Idols and groups do not link to each other

> "the idol page lists stage_name, real_name, korean_name, position,
> nationality and so on, but **not which group the idol belongs to**, and it
> links nowhere. Groups and idols are two islands."

Feel bar 10 enumerates the investigation path it protects: "item → its claims
→ its source and provenance → the event → its edit surface". Idol → group is
not on that path, and SPEC F8 scopes the edit surface to field editing over the
map. **Not a bar violation.** Same door problem as 3.1; same retro.

### 3.3 The group record does not show the row's own `source` / `source_url` / `last_synced_at`

> "the `groups` row carries `source`, `source_url`, `source_page_id`,
> `source_rev_id`, `source_license` and `last_synced_at`. That row said
> `source: fandom` with a live wiki URL and a revision id. **That is exactly
> the provenance I came here for, and the record page doesn't show any of those
> six columns.**"

**SPEC named gap 3** anticipated exactly half of this: "groups/idols edits are
unprovenanced by construction, so no `field_provenance` row exists for them.
Rendering nothing is the honest read; **confirm before shipping it**."

A stranger has now confirmed the *field-level* half: the page's sentence ("No
field provenance is recorded for it") is true and she accepted it. But she
found a **row-level** provenance the gap never considered — six real columns on
the row that answer "where did this come from" in one page load. That is a
question for Ben (it is a display-column decision on a vetted table, which is
`EDIT_CONFIG`'s `display` list, not schema), and it is the single cheapest
thing in either report that would have changed a walk's outcome.

Routing: **a proposal for the M1 retro, not a BUG** — Feel bar 5 says
provenance shows at the fact, and the page's field-level claim is honest, so
nothing written is violated today.

### 3.4 A human edit leaves no fingerprint

> "I also looked for any trace that a human had touched the row ... There is
> none on the page. (In SQL afterwards: `updated_at` still read
> `2026-04-06T14:10:47Z`, unchanged by my edit.) For a catalog where the entire
> selling point is that every fact is vetted, a human override that leaves no
> fingerprint at all is the thing I'd escalate first."

This is a **VISION-vs-SPEC tension a stranger surfaced**, and it should be
named at the retro rather than decided by me:

- VISION: "every action enters through a recorded pathway, so **every change is
  attributed** and later learnable."
- SPEC F8: `groups`/`idols` edit "**directly**, within their allowlist —
  **legal and unprovenanced**, as the ownership rules allow (spec §8)."

Both are true as written; M1 ships the unprovenanced half, and the attributed
half arrives with the verdict slice (M2's `verdicts` log). **No BUG** — nothing
in LOOK_AND_FEEL.md is violated, and Feel bar 8 governs controls that *write
canonical*, which the pre-cutover cell is not styled as.

The separate observation that `updated_at` did not move is **not a design
finding** — it is a data-correctness question about the PATCH route, and I am
routing it to the Verifier/strategist rather than filing it as a bar violation.
It is worth someone's five minutes: if `groups.updated_at` is meant to track
writes, Admin's write is invisible to anything downstream that reads it.

### 3.5 "Will my correction survive the next sync?"

> "The page says 'written to the catalog as it stands' — which describes the
> write, not its lifespan. ... I would have paid real money for one line: 'this
> value is not defended against the next sync from `fandom`'. Without it I
> genuinely cannot tell my colleague the problem is fixed."

The pre-cutover regime is *defined* as the undefended one — VISION: "events/
venues edit only as recorded overrides **that the pipeline can see and
protect**", by contrast. So the lifespan question is answered by the design and
simply not said on screen. **No BUG** (no bar requires it), but it is one
clause on a sentence that already exists, and see the proposed bar in §4.5.

### 3.6 Test-harness residue at the top of the catalog

> "The two newest events on Browse are `the cancelled creation [resolver
> acceptance run_f43f…]` and `the mid-cycle creation [resolver acceptance
> run_e51e…]`, dated 2027-05-01, presented exactly like real events."

Confirmed — the first row of `/browse` on the walk instance today is
`/records/events/01a06573-e943-7f4e-8db9-db7a5742560e`, "the cancelled
creation [resolver acceptance run_f43f7bf3-...]".

**Not a design finding.** This is staging hygiene against SPEC's "Every live
test sweeps what it wrote" (test 13), and it is already the subject of
**TASK-0035 / TASK-0036** (the walk sandbox and its reset). Flagged here only
so the M1 retro knows a stranger saw it and read it as the tool's data, not the
harness's — which is the argument for those two tasks landing before any
further walk.

### 3.7 A run row appeared and then vanished

> "`test_harness_ticketmaster · 1m ago · still running` ... Ten minutes later
> it was gone from both the dashboard and the Cycles & runs page — not
> finished, not failed, gone. ... 'rows can silently disappear from the
> history' is a sentence I don't like being able to write about an audit
> surface."

Not reproducible, and almost certainly the same shared-staging problem as 3.6
(another writer, or a harness sweep). **No BUG** — I will not file a
non-reproducible finding against a bar. Same retro line as 3.6: a walk against
a shared, concurrently-written database cannot distinguish "the app lost a row"
from "someone deleted the row", and that is itself the argument for
TASK-0035/0036.

---

## 4. Bars the file is silent on — proposed text, for the vision-revision pass

Proposed here only. `LOOK_AND_FEEL.md` is not edited during a judge pass. Each
is written to be walkable, and each names the report line that earned it.

### 4.1 An editable value looks editable at rest *(Look — component rules, inline edit)*

> Priya: "The values give no visual hint that they're editable. Same colour,
> same weight as the read-only `id` row; only the text cursor and a faint hover
> tint distinguish them. **I found the edit affordance by tabbing, not by
> looking.** A mouse-first colleague would read this page as read-only."

The Look describes what the cell does when clicked, and Feel bar 9 protects
keyboard reach (which passes — Priya walked the whole page by Tab and praised
the focus rings). Nothing requires a **resting** affordance. Proposed:

> **An editable value is distinguishable from a read-only one before it is
> touched** — a 1px hairline underline on the value, not colour and not weight
> — so a page of fields shows which of them the operator can change without
> hovering, tabbing, or clicking.

This is the highest-value proposal of the pass after 4.2: the surface Priya
called "the part of the tool I'd come back for" is one a mouse-first operator
reads as read-only.

### 4.2 An inline editor opens with its value selected *(Look — component rules, inline edit)*

> Priya: "the caret sits at the **end** of the existing text and the text is
> **not** selected. I typed my replacement expecting it to overwrite, and
> instead saved `7OCSOC`. Entirely recoverable, but 'correct this short value'
> is the whole job of this control, and every inline editor I've used
> pre-selects so a straight retype replaces."

A stranger wrote a wrong value into the shared catalog because of this. It is
still **not a bar violation** — the file is silent, and the app does exactly
what the file describes. Proposed:

> **A click-to-edit cell opens with its existing value selected**, so a
> straight retype replaces and an arrow key still appends. Correcting a value
> is the control's whole job; requiring a select-all first is a trap the
> operator falls into once per field.

### 4.3 A zero is qualified when the set it excludes is not empty *(Feel — interaction principles, emptiness)*

> Tomas: "The panel says '0 ran longer than the 15m cadence' directly beside
> four cycles that started 16–22h ago and never ended. I understand what it
> means (nothing that *finished* took too long), but read cold, '0 ran long'
> sitting next to four corpses is the sort of reassuring sentence I've been
> burned by before."

The Feel already says "an empty queue is good news and reads that way". The
inverse case — a zero that reads as good news while the thing it excludes is
bad news — has no rule. Proposed:

> **A zero states what it excludes when the excluded set is non-empty.** "0 of
> 65 finished cycles ran longer than the 15m cadence; 4 never finished" — never
> a bare zero standing beside the rows it silently drops.

### 4.4 A green outcome carrying errors is not green *(Look — palette, state colours)*

> Tomas: "fifteen cycles report 108 errors each ('column "venue" of relation
> "events" does not exist') and are still labelled **succeeded** in green. The
> error is right there in the same row, so the tool isn't hiding it — but
> 'succeeded' is doing work it hasn't earned."

The current rendering **follows the palette as written**: `succeeded` →
healthy → green; the word is the database's own and Voice bar 5 protects it.
So this is a defect in *my* palette, not in the build. Proposed:

> **Healthy is green only when nothing needs a human.** A run whose own row
> carries a non-zero error count renders its outcome in **attention amber**,
> whatever word the database wrote — the word stays verbatim, the colour tells
> the truth about it.

### 4.5 A window states its extent — including the history's floor *(Feel — quality bars)*

The app already does this almost everywhere, and it is the single most-praised
behaviour in either report:

> Tomas: "Every window is labelled as a window ... I never once had to guess
> whether a number was a total or a sample."

The one place it does not, he caught:

> "the catalog's events say 'arrived 8d ago' while the run history begins 3
> days ago, and **nothing says the history only goes back that far**."

This is a bar the app earned and the file never wrote down — which means
nothing protects it and nothing flags the gap. Proposed:

> **Every windowed list states its window on screen**, including where the
> window is bounded by the data's own floor rather than by a row cap: "runs
> recorded since 2026-08-31; nothing earlier is retained".

### 4.6 A marked row has a rendering *(Look — component rules, data table)*

Surfaced by BUG-0054, which had to invent one. The data-table rule defines
hover and sort arrows but no selection. Proposed:

> **A row the URL asked for is marked with a chrome-inverse fill** — the same
> device as the active nav item, no new colour — and the page moves to it.
> A `?<facet>=<id>` deep link lands on its row, not on the table that contains
> it.

### 4.7 Bar 6 vs. the record page's raw stored value *(Voice — a clarification, not a new bar)*

Found while confirming a repro, and I am recording it rather than filing it
because I think the file is genuinely ambiguous and I will not legislate mid-
judge-pass. `/records/events/<id>` renders `starts_at` as
`2027-05-01T19:00:00+00:00` — a raw ISO string in a value column — while
`/browse` renders the same instant as `2027-05-01 19:00 UTC`. Copy bar 6 says
"never a raw ISO string **in a scannable column**". Is the edit surface's value
column scannable, or is it deliberately the stored value verbatim (which the
Look's mono/sans split would support: "Mono carries every value the database
produced")? Both readings are defensible from the file as written, which is
exactly the fork test failing. Neither sim complained. Proposed for the
revision pass: **say which**, in one clause on bar 6.

---

## 5. Calibration — friction that is neither a bug nor a gap

- **Priya could not verify her fix "shows up everywhere".** There is nowhere
  else to look: the group appears on none of the six pages. That is 3.1's
  consequence, not a second finding.
- **Tomas: "Claims exist that no run can account for."** Claims waiting 16h
  against a source whose last run was 3d ago. Real, and interesting — but it is
  a finding *about the pipeline*, which is what the app is for. The app
  displayed both numbers honestly and he reached the conclusion inside it. The
  half that *is* the app's problem (the unstated history floor) is 4.5.
- **The resolver has applied nothing for eleven hours and the dashboard reads
  calm.** Tomas's condition for returning: "a line on the dashboard telling me
  when the resolver last actually wrote something." Feel bar 1 enumerates what
  the Dashboard must answer and "last applied" is not on the list, so **no
  BUG** — but this is the one feature request in either report that comes from
  the vision's own sentence ("did anything happen last night") rather than from
  taste, and it is a one-line addition to a card that already exists. Retro.
- **"A way to see how many catalog rows carry no provenance at all."** Tomas's
  other return condition. A new count on Browse; scope, not a bar. Retro.
- **Both sims praised the same three things** and the retro should protect
  them explicitly, because every fix above touches a page that carries one:
  the hedged window labels, the verbatim error text inline in a run row, and
  the app declaring what it *cannot* know (the missing threshold dial, the
  unmeasurable settle dates). Tomas: "That is the behaviour I grade on, and
  it's better here than in most tools I've been handed."

---

## 6. What I did not do

I did not walk the app afresh. Every live read above was a read-only fetch
against the running :8771 instance with a minted cookie, made solely to confirm
a repro a sim had already reported (and one — 4.7 — that I stumbled on while
confirming another). No server was started or stopped, no record was written,
no screenshot was taken that a sim had not already taken.
