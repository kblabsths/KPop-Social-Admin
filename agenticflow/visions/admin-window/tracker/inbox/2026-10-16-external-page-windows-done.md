# External ticket done — page windows on `/claims` and `/browse` (2026-10-16)

*From an agent working outside the factory, against
`agenticflow/tracker/for-human/external-ticket-page-windows.md` and the state
corrections in the dispatch (testing rules binding; no live cases; offline
invariant over owned fixtures; one browser walk of staging as a READ). Branch
`external/page-windows` off `run/admin-window`, merged back with `--no-ff`;
the checkout is left on `run/admin-window`. Nothing pushed, `main` untouched,
no ticket file edited, `.env.example` and `run.yaml` untouched, no `.env`
value printed.*

**Merge commit on `run/admin-window`:** `e0b2723e` (the change itself is
`a3e80ddf`; this note is the commit after the merge, on `run/admin-window`).

## What moved

- **ARCHITECTURE §4.3 kind 3** — rewritten in place as "Page-windowed read —
  ONE window of the same order, named by the address", with a dated
  "superseded, in place" block for the 2026-09-10 offset/append text. Kept:
  two surfaces only; a window is never partial; full-or-exhausted on both
  sides of the wire; the count that grades exhaustion is the read's own;
  legs travel with the window; a window is still not a total; the window
  line states what the operator now holds; rule 4 (a fact is stated by whoever
  knows it). New: the window is `?page=` + `?size=` on both sides through one
  guard (`windowBound`); refusal BY NAME, never clamped, value never echoed; a
  move replaces the window; `endsHere` is the one end-of-set derivation; a
  size change keeps the first row on screen; controls above the list.
- **SPEC F14** — rewritten (not appended): one window at a time, sizes
  20/50/100, window in the URL, first screen = the window the address names,
  moves are bounded client requests against the route handler, controls above
  the list, the four design answers, refusal by name, no total claimed, absent
  tables draw no affordance, Claims and Browse only, not whole-table browsing.
- **LOOK_AND_FEEL** — bar 11's self-retiring clause deleted and replaced by a
  one-paragraph dated retirement note; bar 11 is graded by its own sentence.
  Bar 14 names where the page controls sit (above the list, under the window
  line). The revision header records the 2026-10-16 pass.
- **DECISIONS** — dated entry "Page windows replace append-on-press…" with
  Ben's ruling, what moved, the four answers, the test shape, what is NOT
  closed, and the door it closes.
- **Code** — `src/lib/paging/bounds.ts` (`PAGE_PARAM`, `SIZE_PARAM`,
  `WINDOW_SIZES`, `windowBound`, `containingWindow`, `windowQuery`,
  `endsWithin`, `rawWindowOf`; `OFFSET_PARAM`/`pageBound` retired),
  `src/lib/paging/machine.ts` (one-window state, `requestPage(state, deps,
  to)` never throws, `windowToDraw`, `screenOf`/`continuing`; `RowIdKey`
  kept — the id crosses as a key name), `src/lib/db/paging.ts`,
  `src/lib/db/browse.ts` (`readRecentEvents(view, db, offset, size)`;
  `BrowseView.window` retired), `src/components/claims/claim-list.tsx`
  (`CLAIM_WINDOW` retired), both route handlers, `src/components/ui/paging.tsx`
  (`PagingProvider`, `usePageWindows`, `WindowControls`, `PagedWindowLine`;
  `PageMore`/`usePageRows` retired), `src/components/ui/window-line.tsx`
  (`DrawnWindow.from`, `data-window-from`/`data-window-drawn` hooks, paged
  arms reworded), new `src/components/ui/window-refused.tsx`, `Chip` gains an
  optional click interception and hooks, both wrappers, both pages.
- **Tests** — rewritten to the contract, one table-driven case per class:
  `tests/offline/paging/{bounds,answer,machine,claims-route,browse-route}.test.ts`,
  `tests/offline/ui/paging.test.ts`, the paging blocks of
  `tests/offline/{claims,browse}/page.test.ts`, the WindowLine cases of
  `tests/offline/ui/primitives.test.ts`, and small edits to
  `absence/pages`, `browse/views`, `browse/browse-read`,
  `shell/client-boundary` and `tests/http/paging.http.test.ts`. No live case
  added; the live tier is still `contract.live.test.ts` alone. The
  "every id drawn exactly once across all windows at each size" invariant is
  pinned offline in both route suites over fixtures they own (149 claims,
  137 events — multiples of none of the sizes).

## The four design questions

1. **Size change mid-walk** — the window at the new size that holds the
   current window's FIRST row (`containingWindow`): rows 51–100 at 50 → rows
   41–60 at 20, rows 1–100 at 100. Walked on staging: `/claims?page=2&size=50`
   → chip 20 → URL `page=3&size=20`, line `from=41`; chip 100 → `page=1`,
   `from=1`.
2. **Out-of-range page in the URL** — refused BY NAME (parameter + rule; the
   value is never echoed, which `absence/in-window.test.ts` enforces) for a
   non-canonical spelling, page < 1, a size not in {20,50,100}, or a window
   starting past `MAX_PAGE_OFFSET`; the page reads nothing, draws no rows and
   no control, and links to the first window. A page past the END of the data
   under the ceiling is an empty window, not a refusal: "the read at rows a–b
   found none", with "previous" offered. Never clamped.
3. **The first screen** — it is the window the address names, so byte-identity
   across addresses is gone by design; the replacing pin is that the page's
   server render and the route's answer for the same address draw the same
   rows (`*-route.test.ts`, "the server screen and the route's window are one
   set").
4. **The window line on every arm / the control on the last window** — drawn:
   "N claims in all; rows a–b are below — the rest are not shown" (count stated
   as its own read; where the reads disagree each is stated and neither is
   credited with the end); refused: red line naming the object and "Window N
   was not drawn. Ask for it again", window on screen untouched; not
   provisioned: the gray clause and NO control; exhausted: no "next", the line
   says the set ends with these rows; empty window: "the read at rows a–b
   found none" and "previous". The end of the set is ONE derivation
   (`endsHere`): the read's short window, or on `/claims` the count reached by
   the last row on screen — the count can end a set, never extend it past a
   short read.

## Proof numbers (all on the merged tree)

- `./node_modules/.bin/tsc --noEmit` → exit 0, no output.
- `npm run lint` → exit 0, no findings.
- `npm run build` → green (and rebuilt again for the walk under the STACK §5
  mapping).
- `npm test` → offline `Test Files 81 passed (81)`, `Tests 3208 passed (3208)`,
  11.19 s; isolated `1 passed`, `8 passed`, 33.82 s.
- `npm run test:http` → `Test Files 6 passed (6)`, `Tests 37 passed (37)`,
  14.38 s; port 8772 released afterwards.
- `npm run test:live` → not run (no live case added or changed; the brief's
  step 2 is void per the dispatch).
- **Production build over real HTTP on port 8773** (built and started inside
  the sourced subshell exactly as STACK §5 step 1 shows; cookie minted with
  `node tests/walk/session-cookie.mts`): uncookied `/claims` → 307 to
  `http://localhost:8773/login?…` (own origin); cookied `/`, `/claims`,
  `/browse`, `/sources`, `/records/events/01a13c31-6605-7bcb-bd19-3d9749aaf446`
  → all **200**. Server log: **0** occurrences of "Functions cannot be
  passed", **0** error lines (52 lines total). Server killed; `lsof` confirms
  8773 released.
- **Real browser walk** (Playwright/Chromium under `agenticflow/.venv-tools`,
  1440×900, a read of staging — nothing written; the script and its JSON
  summary are in the session scratchpad, not the repo):
  - `/claims` — staging holds **786** claims today (the brief's 877 was the
    2026-09-11 figure; the count is the page's own `data-window-held`). Size
    20: 40 windows, 786 drawn, **786 distinct, 0 duplicates**; size 50: 16
    windows, 786/786/0; size 100: 8 windows, 786/786/0. Every walk ended on
    `data-paging="exhausted"`; `data-window-from` was `(n−1)·size+1` and
    `data-window-drawn` equalled the rows on screen on every window; the URL
    carried `page=n&size=s` on every window.
  - `/browse` — **186** events today (the brief's 120 has grown). Size 20: 10
    windows, 186/186/0; size 50: 4 windows, 186/186/0; size 100: 2 windows,
    186/186/0.
  - Reload on a middle window: `/claims?page=3&size=20` reload → `from=41`;
    `/browse?page=2&size=50` reload → `from=51`.
  - Back: `/claims` next, next (page 3, `from=101`) → Back → URL `page=2`,
    `from=51` → Back → `page=1`, `from=1` → Forward → `page=2`, `from=51`;
    `/browse?page=1&size=20` next → Back → `page=1`, `from=1`. All client-side
    (no reload).
  - Refused addresses: `/claims?page=abc` → 200, `[data-window-refused="page"]`,
    0 rows, 0 paging elements, value not echoed; `/browse?size=30` → 200,
    refused `size`, 0 rows, 0 paging elements. Past the end:
    `/browse?page=9&size=100` → 200, line `from=801 drawn=0 truncated=false`,
    only "previous" offered.
  - Controls above the list on both surfaces; nothing of the affordance after
    the last `</table>`.
  - **Console errors: 0. Page errors: 0.**

## BUG-0221

**BUG-0221 is NOT resolved by this change, and the honest closure is
"obsolete", not "fixed".** Its skip — a claim settled between two reads is
drawn on neither — is inherent to positional paging over a moving population,
and page windows are positional by construction (the architect's 2026-09-12
entry said exactly this). What page windows remove is the CONCATENATION: the
list on screen is one bounded read at one instant, never two orders glued at
a seam, so there is no seam to duplicate or skip AT (BUG-0222's class is
closed by construction). The `it.fails` pin is retired and replaced by the
rule that stands in its place (`machine.test.ts`, "a window is one read of one
order"). ARCHITECTURE still promises no snapshot across moves. The
2026-09-12 ruling said that if Ben adopts page windows the ticket "is folded
into that milestone's own bound design and closed obsolete here" — that is
the state this change leaves it in.

## Residuals worth a look (not blockers)

- Column-selector links on `/browse` and facet chips on `/claims` carry no
  `page`/`size`, so changing a column or a facet lands on window 1 at the
  default size. Deliberate (a narrowing changes the population) but the SIZE
  could be carried through; filed here rather than built.
- The simpler shape — `<Link>` navigation with every window server-rendered
  and no route handler or client driver at all — was considered and not
  taken because the brief and SPEC F14 keep "bounded client requests against
  the route handler" and the http tier that pins it. It would delete
  ~2,500 lines; a future ruling could still choose it.
