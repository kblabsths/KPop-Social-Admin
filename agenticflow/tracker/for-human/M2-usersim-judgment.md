# M2 user-sim reports — the designer's judgment, 2026-09-09

Both M2 user-sim walks read end to end and judged against
`agenticflow/docs/vision/LOOK_AND_FEEL.md` and the frozen `VISION.md`, nothing else.
Every candidate below is one of three things: **filed** as a BUG naming the rule it
violates, **recorded as a design limit** with the ruling that chose it, or **not a
finding**, with the reason. Nothing was discarded unread.

Confirmations were taken read-only on the walk instance (127.0.0.1:8771, staging,
minted cookie, no writes; ports 8770/8771 untouched otherwise) and, for two facts,
read-only against staging's `observations` through PostgREST. Provenance was checked
with `git log` on every file behind a filed violation: **all ticket-bearing commits,
no human-lane divergence, so nothing here is a reconciliation.** BUG-0121 was in
flight and is not duplicated.

## Filed — five BUGs, all `milestone: M2`

| id | pri | what | rule | from |
| --- | --- | --- | --- | --- |
| **BUG-0122** | P1 | The signal's evidence table labels a column `record` and puts a **fact** in it; the record identity is dropped, and two rows about two different stuck events render byte-identical. `/claims` gets the same two facts right in two columns (`fact`, `record`). `observations.external_ref` — distinct per source record — is already read by this page and thrown away. | bar 10 ("the investigation never leaves the app"); the Look's "the anatomy does not change between screens"; glossary discipline | priya §2 (her first quit point), devin §2/§7 |
| **BUG-0123** | P2 | `/claims` says "877 claims **match these filters**" and "with the claims in it **under the filters above**" over a read nothing narrowed, and drops a hand-typed `?record_id=` in silence — `/claims` and `/claims?record_id=<uuid>` render byte-identically. | bar 13 (the line states the read); the doc's "no screen claims a mark it did not draw" | priya §6 |
| **BUG-0124** | P2 | The review item's three counts — `×700` folds, `769` stuck records, `91 of 91` evidence ids — state no relationship, and the lede asserts "Every record folded into this signal is listed here" over 91 rows while the header says 700. The dial is the one that gets it right ("stuck records this source has in the window below"). | Voice bar 6 (counts carry their noun); bar 13's principle | devin §2 ("I'd have got the number wrong"), priya §2 |
| **BUG-0125** | P2 | The Dashboard's two attention zeros name no filler — "nothing open — no question is waiting on a verdict" restates the emptiness as a claim about the whole pipeline, read from one table, on a morning with 877 claims held six days. Copy bar 4's worked example is literally this card. | Voice copy bar 4 | devin §1/§3/§7 (his second of three blockers) |
| **BUG-0126** | P3 | The record page draws a ruled subset of the row's columns and never says it is a subset, so "column this page does not draw", "column that is null" and "column that is not in the database" share one rendering: nothing. Two sims, two different tables, the same doubt. | the Feel's Emptiness principle (three states, three renderings); VISION "every page says so honestly" | priya §7, devin §4 |

Two notes on the filings. **BUG-0123 partly reverses my own endgame call**: I recorded
`/claims?bucket=in_window` rendering 877 unfiltered claims as "a stranger's problem only
if a stranger types it" and did not file it. A stranger typed it. The sentence, not the
URL, is the defect, and criterion 3 covers both spellings. **BUG-0125 deliberately does
not** ask the Dashboard to relate decisions to held claims or to colour a six-day-old
last-apply amber: the first is a cross-object claim the app's reads cannot substantiate,
the second needs the staleness threshold DECISIONS 2026-09-02 forbids inventing here.

## Recorded as design limits — the ruling chose this, and the sims confirm the cost

- **No search anywhere, and Browse is the newest 50 by arrival.** Both sims; Priya's
  second quit point ("if my event hadn't been in the newest 50 I would have gone straight
  to `psql` and never come back"), Devin's §5. SPEC F7 ships exactly one curated view and
  DECISIONS 2026-09-04 (3) restates it as a campaign-lifetime cut; every cheap door is a
  second view. **Two independent strangers now name a search box as their first return
  condition** — that belongs to Ben's fork question in `M2-roadmap.md`, not to a ticket.
- **Groups and idols have no door.** Ben's ruling of 2026-09-08 and DECISIONS
  2026-09-04 (4). Neither sim went looking this time.
- **`verdicts` and `settle_review_item` are absent on staging**, so nothing is
  actionable. Both sims read the not-provisioned cards as the best thing the app did to
  them ("being told 'you can't act here yet, and here's why' up front is the single most
  respectful thing this app did to me all afternoon" — Devin §2). By design until Ben
  installs the migrations.
- **The `stuck_pattern` dial is not readable and no threshold line is drawn.** Devin's
  first blocker: the one open signal is unassessable without it. Ben's ruling of
  2026-09-02 (1) — the dial lives in scraper registry YAML, hand-copying is forbidden,
  and "a dial-able value must not live in a YAML file" is an ecosystem design-queue item.
  Recorded, not filed. Devin's sharper form of it is worth Ben's eye: *a signal whose
  threshold cannot be shown cannot be judged proportionate by anyone the app is for.*
- **`—` under SOURCES on real Browse rows, with no count of unprovenanced rows.**
  DECISIONS 2026-09-04 (1) cut that count with no honest vision trace. The dash is
  honest; the record page explains it (both sims quoted that sentence approvingly).
- **Ages are relative everywhere, so all 69 cycle rows read "6d ago".** Devin: "For a
  table where the whole story is *when did the behaviour change*, '6d ago' on every row
  is the wrong default." Voice copy bar 6 mandates exactly what shipped (relative age,
  absolute in the title attribute) and the tooltip is there. This is an argument with the
  bar, not a breach of it — logged for the next vision pass, changed by no ticket today.
- **No jargon glossary and no hover text on `held`, `folded`, the creation bar,
  `entity_link_source_pattern`.** VISION: "the app assumes a fluent operator, not a
  newcomer", and the Voice's register forbids explaining words this operator knows.
  Devin inferred all four correctly. Calibration, not a defect.

## Not a finding — and why

- **The queue filter set to `kind: signal` still renders the decision block** ("nothing
  open in this filtered view"). Bar 2 requires the two queues at equal standing; the
  empty words name the filter and are true. Devin double-checked his chip — the cost of
  the bar, and the bar is right.
- **A run row that failed nine days ago carries no "already dealt with" marker.** The
  runs half is a window read of nine named columns (DECISIONS 2026-09-02); every number
  is a column of its own row and no state is computed over the set. Adding one reopens
  that decision rather than fixing a bug.
- **The evidence table parks OBSERVED and PAYLOAD off-screen** (798px container, 1373px
  table) with no visible hint, and Devin wrote "no timestamps anywhere" before finding
  them in the markup. The Look explicitly sanctions this: a table wider than its column
  scrolls **inside its own border** and the page does not — measured clean at the endgame
  walk, and the container is `overflow-x-auto`, not a clip. No bar reaches an overflow
  hint or column priority. **This is the one line I would add to LOOK_AND_FEEL at the
  next vision pass** (a wide table's scannable columns come before its raw payloads, or
  an overflowing table shows its edge) — a doc change, not a mid-run ticket.
- **Toggling a Browse column resets scroll to 0 while Back preserves it.** Bar 11 asks
  that state be bookmarkable and survive Back; it does. Nothing in the doc asks a URL
  change to preserve scroll, and the remedy — a client-routed link on every chip in the
  app — trades away the deliberate server-only chip model (every control is a plain
  anchor, no client bundle, keyboard-reachable by construction). Cost exceeds the nit.
- **Provenance "ticketmaster, applied 6d ago" is not a link, and `sha256/…` payload refs
  are not links.** Bar 5 asks that provenance show at the fact — it does, on every field.
  Bar 10's chain is item → claims → source and provenance → event → edit surface, all of
  which resolve. The payload's non-link is a documented deliberate gap: this app holds no
  object-storage base URL and will not invent one. Priya's judgment stands on its own
  though — "being shown the address of the thing I want and no way to open it is worse
  than not being shown it" — and it is a Ben question below, not a ticket.
- **From a venue there is no way back to its events; from a claim there is no
  record filter.** Both are second curated views by SPEC F7's definition (DECISIONS
  2026-09-04 (3)). BUG-0122's record column answers the half of Priya's need that a rule
  actually reaches.
- **Nowhere to leave a note on a record.** The note field exists where the doc puts it —
  the review item's close. A record-level note has no vision trace and no verdict row to
  live in (spec §7's `action` CHECK admits none); it is SPEC named gap 8 territory.
- **The resolver-acceptance fixtures at the top of Browse** (`the cancelled creation
  [resolver acceptance run_f43f7bf3…]`, `the mid-cycle creation […]`, both dated
  2027-05-01, taking two of fifty rows). Both sims flinched. This is **data, not app**:
  Browse renders the newest catalog rows the database holds, which is exactly what VISION
  asks for ("real staging rows whose numbers match what the database says"). An app that
  filtered or labelled catalog rows by title would be making a provenance judgment Admin
  may not make. Ben's, below.

## The instrument, not the app — one correction to Devin's §5

**Both sims walked a `next dev` server.** The walk instance on 8771 was launched with
`npm run dev -- --port 8771` (STACK.md's default walk line; process confirmed live at
judgment time). So:

- the dark **"Rendering .." pill in the bottom-left corner is Next's dev indicator**,
  not a control this app renders — the string appears nowhere in `src/` — and it does
  not exist in a production build;
- the navigation times (Claims 3.35s, Sources 2.14s, Cycles 1.57s) are **first-hit dev
  compilation**, not the app's server work. `/claims`' own read measures 281–312 ms
  against staging (DECISIONS 2026-09-03).

No latency ticket is filed. STACK.md documents a **production-like walk**
(`npm run build && npm run start -- --port 8771`, the env prefix on both commands), and
the honest recommendation is that the next user-sim pass and any release walk use it —
a stranger judging responsiveness on a dev server measures the compiler.

## For Ben — three things the app is right about and someone else must fix

1. **The catalog holds one building three times.** `Ziggo Dome`, `Ziggo Dome Club` and
   `Vinyl Room - Ziggo Dome`, all Amsterdam NL, all `De Passage 100`, with ENHYPEN events
   landing on whichever name Ticketmaster used — including two at the same minute in
   different rooms and one with no source at all (Priya §3, §7). The window showed this
   correctly; venue dedupe is the ecosystem's.
2. **Nothing files a decision for 108 unlinkable performers.** 877 claims held, 0 applied
   for six days, 69 cycles, and an empty decision queue. BUG-0125 fixes what the app says;
   it cannot fix that the resolver escalates an entity-link famine into a signal and never
   into a question for a human. Devin could not tell "the system isn't asking" from "the
   system can't ask yet" — and after the migrations land, only the first will be left.
3. **Two small unblocks that are yours, not a ticket's**: the `stuck_pattern` dial as a
   row rather than registry YAML (your own principle, design-queue), and an
   object-storage base URL in Admin's environment, which would turn every `sha256/…`
   payload ref into the link Priya went looking for.

Working captures for this judgment (rendered page text, both `/claims` variants, the
review item, an events record, `/sources`, `/queues`) were taken read-only, transcribed
into the five tickets and this page, and deleted. Every number and every quoted string
that carried an argument appears above or in a ticket; the endgame walk's screenshots
remain at `agenticflow/tracker/evidence/M2/designer/` (gitignored, local).
