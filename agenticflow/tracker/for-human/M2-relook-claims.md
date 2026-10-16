# M2 re-look — `/claims` after BUG-0138, 2026-09-10

Designer, scoped re-look (not a fresh milestone walk). Production build of
`run/admin-window` at `e0a3c97`, **my own instance on port 8783** against
staging, launched by STACK.md's production-like recipe with the `STAGING_*`
mapping; bundled Chromium from `agenticflow/.venv-tools`; 1440x900 and
1280x900, light and dark. `walk_sandbox` reset before and after (deleted 3,
seeded 3, read back verified both times); nothing else on staging written.
Judged only against `agenticflow/docs/vision/LOOK_AND_FEEL.md`.

**Scope walked:** `/claims` both tabs, unnarrowed and under `?bucket=`,
`?source_id=`, `?domain=` and their combinations, including a `?domain=` that
matches nothing; the source chip row against the one `/sources` renders; `/`
for mirrored claim figures (it renders none).

## Filed — three BUGs, all `milestone: M2`, `discovered_from designer:relook-claims`

- **BUG-0160 (P2)** — **`?domain=` narrows every figure on the page and no
  rendered word says so.** At `/claims?domain=events` the bucket table shows
  `awaiting_row` **741** (769 unnarrowed) and the gauge **849** / "1 domain"
  (877 / "2 domains"), while both chip rows render `all` as active and the h2
  says ALL CLAIMS. The words "domain" and "events" occur nowhere on the page.
  Two clauses are false in that state: the caption's "under the filters above"
  (A2 removed the domain chip row, so it is not above) and "849 claims **match
  these filters**" pointing at two rows that both read `all`. This is
  BUG-0138's own criterion 7 unbuilt for the domain half. Bars 13 and 11.

- **BUG-0161 (P2)** — **a `?domain=` that matches nothing is a dead end.** At
  `/claims?domain=zzz` all five buckets read `0` and the empty card says
  "Widen a filter above; the 'all' chip on any row shows everything again" —
  but every anchor on the page carries `domain=zzz` forward, **both `all`
  chips included** (`all -> /claims?domain=zzz`). The named exit returns to
  the same zeroed page; the only real exits are the sidebar link or editing
  the URL, and the screen never says the word `domain`. Copy bar 4 and the
  Emptiness principle. New since BUG-0138 — `?domain=` used to be reported as
  a dropped parameter and the page rendered unnarrowed.

- **BUG-0162 (P2)** — **the window line's remedy is unreachable.** Every
  filled window ends "the 50 longest-waiting are below — narrow with the
  filters above to reach the rest". Measured: nothing → 877 held / 50 shown;
  `bucket=awaiting_row` → 769 / 50; `+ source_id=ticketmaster` → 769 / 50;
  `bucket=awaiting_link` (+ ticketmaster) → 108 / 50. Two of the three source
  chips hold zero claims, so maximal on-screen narrowing still leaves 58
  claims the operator is told they can reach and cannot, and there is no
  paging. The clause was true when the list carried the population up to
  `ROW_CAP`; the hard `limit 50` plus A2's removal of the domain chips made it
  false. Register + copy bar 3; bar 13.

Provenance was checked before filing all three: `git log` on
`src/app/claims/page.tsx`, `src/components/ui/window-line.tsx`,
`src/components/claims/filter-bar.tsx`, `src/components/claims/bucket-table.tsx`
and `src/lib/claims/filters.ts` returns ticket-bearing commits only. No
human-lane divergence, so nothing here is a reconciliation.

The three are stamped siblings and each carries a line saying what it adds:
0160 is that the narrowing is never named, 0161 is that it cannot be cleared,
0162 is false in every state whether or not a domain is set. 0160 and 0162 both
edit the `matched` arm of `window-line.tsx` — worth one builder.

## What held — the four named changes, checked

- **The bucket table is three columns** (`bucket`, `claims`, `oldest`), one row
  per renderable bucket in the view's precedence order, `—` in disabled gray
  for the two empty ones, `10d ago` carrying `title="2026-08-31 17:46 UTC"`.
  No distinct-sources column. `in_window` appears nowhere.
- **The source chip row matches `/sources` exactly** — `test_harness`,
  `test_harness_control`, `ticketmaster`, same order, same spelling, same
  hrefs modulo the page. The two zero-claim sources are real chips that narrow
  to a real zero.
- **`?domain=` is a real server-side narrowing** — it moves the bucket counts
  (769 → 741), the total (877 → 849) and the gauge's domain count (2 → 1), and
  is never reported as a dropped parameter. (That it is invisible while doing
  so is BUG-0160.)
- **The list is the database's order, longest-waiting first**, 50 rows,
  buckets interleaved by age rather than grouped — the expected change, and
  the ages agree with the bucket table's `oldest`.
- **Numbers agree across the page**: the bucket counts sum to the window
  line's held (108 + 769 = 877; 108 + 741 = 849 under `domain=events`), and
  the gauge's own bucket table agrees row for row under every narrowing I
  tried.
- **Tokens.** Leaf-text sweep of `/claims`, both themes, 1440 and 1280:
  exactly the five type steps (11/16 mono ×365, 12/18 sans ×21, 10/14 sans
  uppercase ×17, 14/20 sans 600 uppercase ×4, 20/24 mono 600 ×2), weights 400
  and 600 only, radius `4px` and nothing else, **zero box-shadows**.
- **Chips** are `data` mono at 4px radius and 2/8 padding; active is accent
  fill `rgb(152,16,250)` + white, inactive chrome `rgb(249,250,251)` +
  secondary `rgb(74,85,101)`. The bucket table's bucket renders as a link at
  rest (accent ink + underline), not a badge — BUG-0113 unregressed.
- **Contrast, bar 12.** Every text node measured against its real backdrop in
  both themes: the only ink under 4.5:1 is the disabled `—` (2.60:1 light,
  2.35:1 dark), exempt by job. 56 instances, all of them the dash.
- **Keyboard, bar 9.** 40 tab stops from the top of the page, every one
  showing the 2px accent ring at 1px offset; the new chips are in the order
  they read.
- **Containment and console.** No horizontal scroll at 1280 or 1440;
  `scrollWidth` equals the viewport in both. **Zero console errors or
  warnings** on every URL I loaded, in both themes.
- **Bar 1.** The bucket table sits at y=164–391 at 1440x900 — every bucket
  with its count above the fold.
- **The four states.** `NOTHING_MATCHED` (a narrowing that matched nothing)
  and the population-empty card (`?tab=standing`, "nothing here yet") stay
  distinct, and the standing tab's did-not-fill line names its bucket.

## Noted, not filed

- **The gauge still renders a second bucket table with a `SOURCES` column**,
  ~900px below the one A2 just cut to three columns — same five buckets, same
  `CLAIMS` header, computed from the gauge's 1,000-row transported window
  rather than the head counts. They agree today under every narrowing I tried,
  and QA already recorded the >1,000-claim divergence as a residual for the
  dispatcher. No bar in LOOK_AND_FEEL forbids the duplication, so I am not
  inventing one — but the figure the ruling deleted is still on the page, and
  if anyone re-opens that gauge it is the obvious thing to reconcile.
- **`ALL CLAIMS` remains the h2 over a narrowed list** in every narrowed state.
  It predates this change and reads as a section title rather than a claim
  about the rows; I folded it into BUG-0160 as evidence rather than filing it.

Screenshots (gitignored, local): `agenticflow/tracker/evidence/M2/designer/`
— `claims-domain-events-unnamed.png`, `claims-domain-zzz-deadend.png`,
`claims-window-line-reach-the-rest.png`, `claims-bucket-table-3col.png`,
`claims-pending-{light,dark}-1440.png`.
