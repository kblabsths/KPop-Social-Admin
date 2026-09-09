# M2 endgame walk — the designer's pass, 2026-09-09

Designer, first pass of the M2 endgame, before the user-sims and the Verifier.
Walk instance on `127.0.0.1:8771` against **staging**, started by the dispatcher
on `run/admin-window`; bundled Chromium from `agenticflow/.venv-tools`; 1440x900
and 1280x900, light and dark. `walk_sandbox` reset before and after — three rows
read back byte-identical to `tests/walk/sandbox-fixture.ts` both times. Nothing
else on staging was written; no RPC called; no catalog row touched. Judged only
against `agenticflow/docs/vision/LOOK_AND_FEEL.md`.

Staging has `verdicts` and `settle_review_item` absent by design, so the verdict
slice's not-provisioned states ARE the surface today and were graded as such.

## Walked

All six pages (Dashboard, Queues both tabs, Claims both tabs, Sources, Cycles &
runs, Browse); the one real review item and its close slot (`entity_link`
source-pattern signal, folded ×700) with the close now sitting **above** the
evidence; an `events` record, the `venues` record it links to, and the
`walk_sandbox` record including a real save, an Escape, a type refusal, a
not-null refusal and a last-row refusal; the robustness addresses (not-a-uuid
and unknown-id on both the record and the review-item routes, six retired
routes, `/records/groups/<uuid>`, `/claims?bucket=in_window`). Twelve surfaces
× two themes × two widths for contrast, containment and console.

## Filed — seven BUGs, all `milestone: M2`, `discovered-from designer:endgame-walk`

- **BUG-0106 (P2)** — `succeeded` in **healthy green on seventeen cycles that
  report errors**, fifteen of them at 108 errors each with
  `column "venue" of relation "events" does not exist` two cells to the right.
  This is the palette bullet TASK-0038 wrote on 2026-09-09 with its own walk
  location ("no row that shows errors carries its outcome word in healthy
  green") and changed no `src/` file to build. `src/app/page.tsx` carries a
  second copy of `OUTCOME_TONE`, which the module that owns the first one
  explicitly forbids in its docstring.
- **BUG-0107 (P2)** — **a refused inline save outlives its edit**: the red panel
  survives Escape, survives clicking away, survives four seconds, and survives a
  successful save of another field. Only reopening that same cell clears it, so
  the screen shows `tally = 7` at rest with a red line claiming a failure that no
  longer pends — and a second refusal draws over the first. Second leg: the
  refusal popover carries no hairline (the hint popover from the same component
  does), so on `bg-surface` over a `bg-surface` table it has no edge and eats the
  values it floats over — `false` renders as `fal` in the screenshot.
- **BUG-0108 (P2)** — **the rest of BUG-0099's sweep**, which that ticket named
  and left: 132 anchors on Dashboard (11+2), Claims (61), Browse (50) and
  Sources (10) still render `rgb(30,41,57)` with no underline at rest, plus the
  verdict log's row links (not walkable while `verdicts` is absent). Eight files
  still carry `hover:text-accent` while `cycles/links.ts` publishes the one
  spelling.
- **BUG-0109 (P2)** — **bar 13's second half is unbuilt.** `WindowLine` has a
  `truncated === true` clause and no `false` clause anywhere, so a list whose
  bottom is the data's own floor never says so: `/cycles`'s five adapter runs
  (cap 200) are every run recorded and read like the top of a long list — the
  doc's own example. `/browse` (held 50 of 50, truncated **true**) says nothing
  either way, because the `catalog` arm has no clause at all. The Dashboard's two
  panels publish no `data-window-*` hooks and promise "the rest" when there is
  none.
- **BUG-0110 (P3)** — **"0 ran longer than the 15m cadence" stands bare beside
  four cycles that never finished**, the exact card and the exact numbers the
  Zeroes principle quotes ("0 of 65 finished cycles ran longer than the cadence;
  4 never finished"). The qualification exists 500px lower under another table.
  Swept every other zero on the six pages: this is the only one.
- **BUG-0111 (P3)** — **the entity picker's `saved` confirmation never
  retires.** The 1.5s clock is armed in `EditableCell.tsx` alone; the picker
  renders the same `EditStatus` from its own reducer with zero `useEffect`, zero
  `setTimeout` and zero `elapsed`. Built, **not walkable on this data** (the
  picker needs the function present) — measured from source and filed now
  because it lands on the app's only catalog write path the morning after the
  migrations go in.
- **BUG-0112 (P3)** — **the regime note sets its table name in sans.** Three
  table names on one record screen: `events` in the h1 is mono, `verdicts` in the
  card below is mono, `events` in the prose between them is 12px sans.
  `walk_sandbox` is the loudest — an underscored identifier set in a
  proportional face, mid-sentence.

Provenance was checked before filing all seven: `git log` on every diverging file
returns ticket-bearing commits only. No human-lane divergence, so nothing here is
a reconciliation.

## What held

- **The four M2 early-walk bugs are fixed, re-measured.** BUG-0096: the close
  now sits at y=228 h=72, **above** the evidence at y=316 — 3,500px of scrolling
  gone. BUG-0098: a refused write shows both halves, the database's refusal in
  mono and the fix in the app's voice (`Type a whole number, like 7.`,
  `label cannot be cleared — type a value into it.`). BUG-0099: the `venue_id`
  reference, the queue row's link and all 91 evidence `source` links render
  `rgb(152,16,250)` + `underline` at rest, and the reference label is mono in
  both the resolved and unresolved case. BUG-0100: the override prose says "a
  claim at the admin tier" — the pinned noun.
- **Contrast, bar 12, twelve surfaces × two themes × two widths.** Every text
  node measured against its real backdrop: the only ink under 4.5:1 is the
  disabled `—` (2.60:1 light, 2.35:1 dark), which the palette exempts by job.
- **Zero console errors or warnings on load**, on all twelve surfaces, both
  themes, at 1280 and 1440. (The one console line seen all day was a `500` for a
  deliberately refused PATCH — the browser reporting a server response, not a
  page error.)
- **Containment.** No page scrolls horizontally at 1280 or 1440. The evidence
  table and the wide cycles table overflow inside their own bordered boxes.
- **Tokens.** Leaf-text sweep over ten surfaces returns exactly the five type
  steps and nothing else: 11/16 mono, 12/18 sans, 10/14 sans uppercase, 14/20
  sans 600 uppercase, 20/24 mono 600. Weights 400 and 600 only. Radii: `4px`
  and nothing else. **Zero box-shadows anywhere.**
- **Keyboard, bar 9.** Tab reaches every focusable on all nine surfaces (9 to
  100 stops) and every one shows the 2px accent ring at 1px offset. The only
  ringless stop is Next's dev-overlay portal, which is not the app.
- **Bar 1, above the fold at 1440x900**: Dashboard's two attention counts
  (bottom y=107), Queues' two open counts (283, 485), Claims' full bucket table
  (114), Sources' registry (74), Cycles' newest adapter run (72), Browse's newest
  event (199). The Dashboard fits in 900px with no scroll at all.
- **The absences are honest, bar 4.** Close slot, verdict-log tab and both
  resolver-owned record pages render `data-state="not_provisioned"` in copy bar
  4's exact form; every page answers 200; nothing throws; no control is offered
  that cannot be performed. `in_window` occurs zero times in the rendered text of
  every page, including when it is forced into the URL as a filter value.
- **Bar 2, two queues of equal standing**, and severity is the registry's word
  in the palette's colour (`high` amber on chrome, `low`/`high` verbatim, the
  sort stated on screen, no score).
- **The edit cell's happy path.** Opens on press with its value selected (0..28),
  1px accent border, 4px radius, mono, hint line naming Enter/Escape; Escape
  reverts the value; Enter gives `saving…` at t=0.01s, `saved` in healthy green
  at t=0.20s, gone at t=1.72s. Refusals stay inside the table's bordered
  container at every row including the last (BUG-0101/0104/0105 unregressed).
- **Robustness copy**, all six paths: the two-part error form every time, each
  naming what is wrong and what to do. `/records/groups/<uuid>` 404s, as the
  2026-09-08 strike requires.
- **Voice.** Swept every rendered page for the glossary's banned synonyms:
  zero hits in the app's own words. The one "observations" on `/sources` is
  inside the registry's `note` column — the database's text, verbatim, which is
  the rule.

## Deliberately not filed

- **The close slot names `verdicts`, not `settle_review_item`.** FEAT-0010's
  criterion 1 asks for the function's name, and the card says `verdicts`. It is
  not a violation: DECISIONS 2026-09-08 rules that a surface reads the **table**
  to know whether it may offer an action, because PostgREST cannot introspect a
  function without calling it, and the card names "the object the read named".
  The doc is right and the ticket's wording is the stale half.
- **The editable value's hover fill is inert** (`hover:bg-chrome` on a value
  whose row already takes `bg-chrome` on hover, so nothing changes under the
  pointer). Carried over from the early walk's one nit; the resting hairline
  underline is doing that work and no rule asks for a second signal.
- **The record page states its absence twice**, once vaguely: the
  `override-unavailable` note ("…and what records it is not present in this
  database") says in a circumlocution what the card directly below it says by
  name. Redundant and slightly awkward, but no bar forbids a second sentence and
  the card itself is correct. Worth a copy pass if anyone is in that file.
- **The not-found record page still prints its regime note** above "No
  walk_sandbox record at this address" — an explanation of how to edit a record
  that does not exist. Odd, harmless, no bar.
- **`/claims?bucket=in_window` renders 877 unfiltered claims** rather than
  refusing the unknown facet. `in_window` never reaches the visible text (the
  three occurrences are Next's RSC payload echoing the URL), so bar 3 holds; the
  URL-vs-screen mismatch is a stranger's problem only if a stranger types it.
- **A refused PATCH answers HTTP 500.** A validation refusal is arguably not a
  server error, but that is an API-shape question and no design bar reaches it.
- **The two fact-shaped review items** are not on staging, so the
  `data_conflict` and `entity_link` close slots and the evidence pair's
  contender-cards-then-canonical anatomy were not walked. "Built, not walkable on
  this data" — the same honest grade M1 gave the same gap. Somebody should walk
  them the day Ben installs the migrations.

Screenshots (gitignored, local): `agenticflow/tracker/evidence/M2/designer/`.
