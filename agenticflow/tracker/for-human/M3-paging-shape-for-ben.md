# Stopped for Ben — page windows (your 2026-09-11 ruling 1) is milestone-sized

Strategist, 2026-09-11, routing `tracker/inbox/2026-09-11-ben-paging-rulings.md`.
Your note carried four things. Three are routed and moving; this one is stopped
on purpose, and only you can start it.

## Your words

> "I don't want to be scrolling down a long ass list like this. We should have
> pagination e.g. only show items 1-50 or 51-100 at a time (adjustable as 20,
> 50, and 100)."

Applies to `/claims` and `/browse`, and it supersedes the append-on-press shape
M3 just shipped.

## Why it is not a patch, and why I did not plan it myself

The rule I work under is that a note from you gets routed to small, builder-ready
tickets, and that only you turn a note into a milestone. This one strains that
by a wide margin — not because the idea is big, but because it replaces a
contract three layers deep that M3 finished four days ago:

1. **It rewrites SPEC F14**, which is the shipped behaviour's authority. F14 says
   "asking for more is a client request against a route handler" and that the
   window grows; page windows say the window MOVES and the rows on screen are
   replaced. That is not an extension of F14, it is a different answer to the
   same question — so SPEC gets amended, not appended, and the amendment has to
   say what happens to the M3 criteria that graded the old answer.
2. **It reopens three M3 exit criteria.** EC4 pins the first server-rendered
   screen as byte-identical in its window line, figures and row set; an
   adjustable size of 20 breaks that pin by design. EC5 and EC7 (what the
   affordance may claim, and which figures may sit beside each other) are both
   written around append semantics.
3. **It adds an operator-facing control** — the size selector — to two surfaces,
   which is the first new control this campaign has added since M1, plus page
   navigation, plus "which page am I on" state, plus the window line's sentence
   changing from "the first 50 of 877" to "51–100 of 877" on both surfaces and
   on every refusal arm.
4. **It probably moves state into the URL** (`?page=`, `?size=`), which is a real
   improvement — it would make LOOK_AND_FEEL bar 11 TRUE again instead of
   excepted — and it is also a change to how both pages are rendered and cached,
   and to what the back button does.
5. **The state machine is a different machine.** `src/lib/paging/machine.ts`
   merges pages and grows a `held` count that never shrinks; page windows
   replace a row set and have to handle a size change mid-walk (you are on rows
   51–100 at size 50 and switch to 20 — which rows do you get?). That question
   has no answer in any contract we hold.

My honest count is six to ten tickets across both surfaces plus a contract
amendment pass, with live proofs on both. That is a milestone, and inventing one
from a six-line note is the exact failure my instructions name. So: **your call.**

## What I did instead

- **Filed BUG-0216 (P1, patch lane)** — the duplicate React key from your dev log
  is a real defect in the shipped paging, and it stands whichever shape wins. See
  below; it is the one thing in your note I think is urgent.
- **Filed TASK-0079 (P2, patch lane, designer)** — your ruling 2 becomes a Feel
  bar ("no control the operator must find sits at the bottom of a long list"),
  and your ruling 3 becomes the one clause on bar 11. The bar is written now
  because it is true regardless of shape; the FIXES it implies — one for
  `/claims` and one for `/browse`, which render the same control in the same
  place after the same 50-row list — are deliberately not filed, because the
  right fix is whatever you decide here.
- **Planned no milestone and wrote no SPEC change.**

## What I need from you, in one word each

- **Adopt page windows?** If yes, it is an M4 and I will plan it at the M3 close
  (sizes 20/50/100, both surfaces, and I would put page + size in the URL).
- **If no**, say so and both paged surfaces keep append-on-press; TASK-0079's new
  bar (Feel bar 14) then produces **two** tickets, one per surface — `/claims` and
  `/browse` each render the same `PageMore` control as the last child after the
  last row, on a 50-row window that runs past the fold
  (`src/components/claims/paged-claim-list.tsx:107-115`,
  `src/components/browse/paged-browse-table.tsx:156-177`), so both fail the bar
  and each needs its control moved above its list. Two small moves, still cheap
  next to the "yes" branch — but it is two, not one.
- **Either way**, the campaign's stop condition is untouched by this: VISION is
  satisfied by the verdict UI plus the two reviewed handoffs, not by paging
  shape. Adopting page windows is new scope you are choosing, not scope the
  vision is owed.
