# M3 early walk — the paging experience

Designer, 2026-09-11. Scope as dispatched: `/claims` (both tabs, narrowed and
unnarrowed) and `/browse` — the "load more" control in its five states, the
paged window line after each press, the refusal words, the paged leg notes, the
`/claims` bucket table and chip rows, and how the pages read to an operator who
pages to the end. **FEAT-0016's territory was not graded** (tab gauge vs head
counts, `/sources` scan narrowings, scan upper edges) — it is not built.

**How it was walked.** A production build of head `f410ea6`, launched by
STACK.md §5's verbatim block with the `STAGING_*` pair mapped in-process, on my
own bind-probed port 8795 (not 8770/8771/8772/8790); minted walk cookie;
bundled Chromium at 1440x900 and 1280x900, light and dark. **Reads only** — no
write, no sandbox reset needed, nothing touched in `tests/live/**`. My server
was killed when I finished.

---

## Verdict

**Not clean.** The paging MACHINERY is right — every hook BUG-0172 fixed holds
under a real 17-press walk, and the four invariants I tried hardest to break
did not break. The WORDS and one SHAPE are not right. Five tickets, one of them
P1.

| | |
| --- | --- |
| **BUG-0174** (P1) | A continued window still calls itself a 50-row window and denies being the whole set, under 877 rows and "All claims in this view are shown" |
| **BUG-0175** (P2) | A paging refusal renders the app's own 22-word sentence in mono, the face reserved for the machine's words |
| **BUG-0176** (P2) | A paged not-provisioned answer renders red, stutters its object, and says to press again for a table that does not exist |
| **BUG-0177** (P3) | The paging control is the only full-width button in the app — 1216px with a centred label |
| **BUG-0178** (P3) | The bound-ceiling sentence reads as exhaustion |

BUG-0175 and BUG-0176 were stamped siblings by the tracker (same file, different
rules); I added a note to BUG-0176 saying what each covers and that the criteria
do not overlap.

---

## BUG-0172 criterion 8 — the copy this walk was asked to grade

The ticket left it in writing: *"The exhausted window line and the exhausted
paging sentence read as one voice: they agree, and the line neither contradicts
nor parrots 'All N in this view are shown'. The designer's walk grades the
words."* **It fails, on both surfaces, and the failure is in the clause BUG-0172
did not touch.** Verbatim, measured:

- `/claims`, 17 presses, 877 rows on screen:
  *"… **A window of at most 50 rows, not the whole view.** 877 claims in all;
  the **877** longest-waiting are below — the read found no more."*
  with **"All claims in this view are shown."** under the table.
- `/browse`, 2 presses, 120 rows:
  *"… a window of at most 50, **not the whole catalog**. 120 events are on
  screen, and the read found no more."* with **"All events in this view are
  shown."** under the table.
- `/claims?bucket=awaiting_link`, 2 presses, 108 rows: *"… the **108**
  longest-waiting are below — the read found no more."*

Three things wrong in one sentence: the cap clause never followed the press (50
describes one press, not a screen holding 877); "not the whole view/catalog"
contradicts the control below it; and "the 877 longest-waiting are below" is a
superlative over a set with nothing outside it. That is BUG-0174, and it is the
same class BUG-0172 fixed one clause to the left.

---

## What held, measured

**The hooks, under a real walk.** `/claims` 17 presses: rows 50 → 877,
`data-window-held` stays **877** (the count read — paging reads no claim into
it) at every step, `truncated` true → false only at exhaustion, one
`[data-window="claims"]` throughout. `/browse` 2 presses: held 50 → 100 → 120,
truncated true → true → false, rows 50/100/120. Narrowed `/claims?bucket=awaiting_link`
2 presses: held stays 108, rows 50/100/108. (`/claims` carries a second
`[data-window="pending"]` element — that is its gauge's own line, a different
read, not a breach of the one-element rule.)

**A refused press settles nothing.** Forced four ways on both pages — HTML at
200, truncated JSON, a `{kind:"error"}` body at 500, a foreign body. In every
case: **zero rows appended**, the bound unmoved, the control retained, and the
window line's `outerHTML` **byte-identical** before and after.

**Loading.** The control disables in **43–70 ms** (opacity 0.5, `not-allowed`,
**label unchanged** — no button becomes "…"). Server leg then 0.3–1.5 s.

**Paged leg notes.** Forcing `/browse`'s provenance leg to answer
`not_provisioned` on page 2: rows still appended (100), and the note rendered
beside them in the app's canonical words — *"`event_field_provenance` isn't in
this database yet — it arrives with the scraper repo's migrations."* This is
the control case that makes BUG-0176 damning: the LEG gets it right and the
PAGE refusal, on the same press, does not.

**"Did not fill" is unreachable from a press**, as BUG-0172 criterion 3
required: it occurs in exactly one state I could reach — `/claims?tab=standing`,
0 rows, zero `[data-paging]` elements.

**Bucket table and chip rows.** `BUCKET / CLAIMS / OLDEST`; bucket names are
links (accent + underline) in the table and chrome-filled **badges** in the
list — the BUG-0113 rule holds, no badge inside an anchor. Filter chips: accent
fill + white when active, chrome + secondary when not, 4px radius. Nulls are
`—` in disabled gray. Bar 1 holds: the full bucket table sits at y=193–391 at
1440x900, above the list.

**Console, containment, themes.** Zero errors and zero warnings on load across
`/claims`, `/browse`, narrowed and standing, presses included, in light and
dark. No horizontal page scroll after paging at 1440 or 1280. Dark theme
exhausted line and sentence both `#99a1af` on `#030712`.

**Keyboard.** The control takes the accent ring (`#9810fa`, 2px, 1px offset)
and Enter pages. **Note for the next walker:** read the ring AFTER ~200 ms.
Tailwind v4's `transition-colors` includes `outline-color`, so a computed style
read immediately after Tab returns the mid-transition value — mine said
gray-800 and I nearly filed it. It is correct.

---

## Recorded, not filed — two things for the endgame, not for a ticket

**1. The control leaves the viewport on every press.** Measured on `/claims`:
button top **434 → 2,084** with the viewport 900 tall and `scrollY` unchanged;
the document grows 2,814 → 4,464. So pressing it puts it ~1,650px below the
fold, and paging `/claims` to the end is 17 presses and 17 scrolls. This is
normal "load more" behaviour and no bar in LOOK_AND_FEEL covers it — filing it
would be me inventing taste mid-milestone, which is drift. ~~**I propose a bar at
the M3 endgame instead**, for Ben's sanity check: *"a control that extends a
list is still on screen after it acts."* Flag it if you disagree.~~

> **Superseded 2026-09-11 (designer, TASK-0079).** Ben ruled on this himself
> after walking `/claims`, and his rule is stronger than the proposal: no element
> the operator must find sits below a long list at all — it goes above the list
> or on its own surface, by importance. That is **LOOK_AND_FEEL Feel bar 14**;
> the proposal above is closed and no walker re-raises it. The measurement in
> this paragraph is recorded in bar 14's trace.

**2. The corrected window line is ~4,000px above the operator who paged.** By
the time `/browse` exhausts, the sentence BUG-0174 fixes is off the top of the
screen and all the operator reads is "All events in this view are shown." The
architect rejected a continuation line below the rows IN WRITING in BUG-0172
(it leaves the false sentence where the operator reads it first, and breaks the
one-`[data-window]` rule), so I am not reopening it — recording that the fix's
readership is small, and that BUG-0174 matters most to whoever reloads or shares
the URL.

**Not walked:** the bound-ceiling (`limit`) arm in a browser. `MAX_PAGE_OFFSET`
is 100,000 against a 50-row window — 2,000 presses and 100,000 DOM rows. I
graded its two strings from source, exactly as QA graded it offline, and
BUG-0178 says so in its first paragraph.

**Evidence:** `agenticflow/tracker/evidence/M3/designer/` (gitignored; every
number and string above is the durable record).
