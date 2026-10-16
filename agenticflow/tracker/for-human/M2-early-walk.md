# M2 early walk — the verdict slice, 2026-09-08

Designer, M2's one early walk (fired when FEAT-0009's two handoff artifacts
landed). Walk instance on 127.0.0.1:8771 against **staging**, started by the
dispatcher; bundled Chromium via playwright; 1280 and 1440 x 900, light and
dark. `walk_sandbox` reset before and after — the three rows read back to
`tests/walk/sandbox-fixture.ts`, nothing else on staging was written, no RPC
called. Judged only against `agenticflow/docs/vision/LOOK_AND_FEEL.md`.

Staging has `verdicts` and `settle_review_item` absent by design, so the
not-provisioned states ARE the surface today and were graded as such.

## Walked

Queues list and its verdict-log tab (`?tab=verdict_log`); the one real review
item and its close slot (`entity_link_source_pattern` signal, folded x700); an
`events` record and the `venues` record it links to; the `walk_sandbox` record,
including a real save, an Escape, a type refusal and a not-null refusal; plus
the robustness addresses (bad id, retired table, unknown item id).

## Filed — four BUGs, all `milestone: M2`, `discovered-from designer:early-walk`

- **BUG-0096 (P2)** — the close sits 3,500px below the evidence it closes.
  Measured on the one real item at 1440x900: `evidence` y=256 h=**3,483**,
  `close` y=**3,781**, document 3,869. Four screenfuls of scrolling to reach
  the thing that settles the item. Key screens: "the evidence pair, **and the
  close beside it**". Filed now because FEAT-0010 builds three controls into
  that slot and FEAT-0013 renders the verdict there.
- **BUG-0098 (P2)** — a refused inline save shows the database's words and
  nothing else. `tally` = "seven" gives `invalid input syntax for type integer:
  "seven" (22P02)` and no sentence saying what to type; clearing the not-null
  `label` prints Postgres's whole failing-row DETAIL. The app's own
  `ui/error-line.tsx` already ships the two-part form (refusal in mono + the
  fix in the app's voice) and every read path uses it. Interaction principles /
  Error, copy bar 3. This is the cell FEAT-0011's override editor inherits, and
  the gate's registry-pattern refusals will land in it.
- **BUG-0099 (P2)** — links inside data tables announce themselves only under
  the pointer: the `venue_id` reference on a record, the "what happened" link
  on a queue row, the 91 `source` links in the evidence table are all
  `rgb(30,41,57)` with no underline at rest, while the header links and
  `/cycles` are accent + underline. Exactly what BUG-0054 fixed on `/cycles` in
  M1. Amended with a second leg from the screenshot: the venue name renders in
  sans while the id beside it is mono, and it falls back to mono when no name
  resolves — one line, two faces.
- **BUG-0100 (P3)** — the override surface calls a claim "an observation" in
  prose, the noun the glossary pins hardest ("`observation_id` stays a machine
  id; the operator reads claims"). One sentence, on both the `events` and
  `venues` record pages, and it is the app's only explanation of what an
  override does.

Provenance was checked before filing all four: `git log` on every diverging
file returns ticket-bearing commits only. No human-lane divergence, so nothing
here is a reconciliation.

Not filed, because an in-flight ticket already names it: the close slot naming
`verdicts` rather than `settle_review_item` (FEAT-0010 criterion 1), the events
and venues pages being read-only (FEAT-0011 criterion 1), the reflow of the
open edit cell (BUG-0086), invisible-only values stored as content (BUG-0095),
the inline verdict block's dashes (BUG-0092).

## What held

- **Contrast, both themes, all six surfaces (bar 12).** Every text node
  measured against its real backdrop: the only ink under 4.5:1 is the
  disabled `—` (2.60:1 light, 2.35:1 dark), which the palette exempts by job.
  Zero console errors or warnings on load, at 1280 and 1440, light and dark.
- **Containment.** No page scrolls horizontally at 1280 or 1440. The evidence
  table overflows to 1,582px inside its own bordered `overflow-x-auto` box, as
  the data-table rule allows.
- **Keyboard (bar 9).** Tab reaches the six nav links, sign-out and all five
  editable values in order; every stop shows `2px solid rgb(152,16,250)` at
  1px offset — the accent ring, everywhere, no exceptions. (Read it after the
  120ms transition settles: measured immediately, it reports currentColor and
  looks like a violation that is not there.)
- **Tokens.** Rendered class attributes across all six surfaces contain only
  the five type steps (`type-figure|title|body|data|micro`), spacing on the
  2/4/6/8/12/16 scale, `rounded-control` and no shadow anywhere.
- **Two queues of equal standing (bar 2).** Decision and signal sections at
  x=208, w=1216, both H2 at 14px, same DOM depth, neither nested in the other.
  Both open counts above the fold at 1440x900.
- **Severity is the registry's word in the palette's colour.** `high` renders
  amber on chrome; the open-signals figure is amber, the zero-decisions figure
  is ink; `low`/`high` verbatim; the sort stated on screen.
- **The absences are honest (bar 4).** The verdict-log tab and the record
  pages name `verdicts` and what installs it, in copy bar 4's exact form;
  `in_window` occurs zero times; the queue-health window line states its read,
  its bounds and its cap.
- **The edit cell's save path.** Opens with its value selected (0..28), 1px
  accent border, 4px radius, mono; Escape reverts; Enter gives `saving…` in
  secondary then `saved` in healthy green for ~1.5s then nothing; the disabled
  resting button keeps its label at 50% opacity.
- **Robustness copy.** `/records/groups/<uuid>` 404s with an explanation, an
  unknown item id says "No row with that id in `review_items`" *and* what to
  do, a malformed record id explains what a `walk_sandbox` id looks like. All
  three are the two-part error form BUG-0098 says the write path is missing.

## One nit, not worth a builder session

Hovering an editable value fills it `#f9fafb` — the same fill the row already
took on hover, so the control's own hover is invisible. The resting hairline
underline is doing that work, and no rule requires a second signal.

Screenshots (gitignored, local): `agenticflow/tracker/evidence/M2/designer/`.
