# External ticket — page windows on /claims and /browse

*For an agent working outside the factory. Self-contained: everything you need is
named here or in a file this brief points at. Written by the admin-window
dispatcher on 2026-09-15 from Ben's ruling of the same day.*

## The ask, in Ben's words

> "I don't want to be scrolling down a long ass list like this. We should have
> pagination e.g. only show items 1-50 or 51-100 at a time (adjustable as 20,
> 50, and 100)."

Replace the current "show the next 50" control (which appends rows to a growing
list) with **page windows**: the list shows one window of rows at a time
(1–50, 51–100, …), the operator moves between windows, and the window size is
selectable as **20, 50 or 100**. Both paged surfaces: `/claims` and `/browse`.
**Page and size live in the URL** (`?page=`, `?size=` or equivalent), so reload,
Back and a shared link land on the same window.

## Repo facts you must know first

- Repo: `/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin` (Next.js app-router;
  the Next version has breaking changes vs training data — read the guide in
  `node_modules/next/dist/docs/` before writing framework code; `AGENTS.md`).
- Work on a branch off **`run/admin-window`** (e.g. `external/page-windows`).
  Never touch `main` (Railway deploys it). Merge back into `run/admin-window`
  when the proof bar below is met. Commit by explicit pathspec, never
  `git add -A` — `.env.example` is modified in the tree and is Ben's.
- Commands: `agenticflow/docs/STACK.md` §5 is the single source. In short:
  `./node_modules/.bin/tsc --noEmit`, `npm run lint`, `npm test` (offline +
  isolated, no network), `npm run test:http` (builds and drives the app over
  HTTP against a loopback stub, no database), `npm run test:live --
  tests/live/<file>` (staging), `npm run build && npm run start -- --port <P>`.
- Ports: 8770 (factory UI), 8771 (Ben's own dev instance — never bind, and
  note `npm run dev -- --port <other>` ATTACHES to that running dev server
  instead of starting yours; use `npm run start` on your own port), 8772
  (http tier), 8790 taken. Bind-probe any port before using it.
- Secrets: never open, print, cat or grep `.env`. To run anything against
  staging, source it into a subshell and map the names, exactly as STACK §5
  step 1 shows. An unset name is a refusal, never a fallback.
- Staging (`ubfjjqlvnpnoborczbdb`) is shared with another campaign that writes
  it concurrently; **the only table anything here may write is
  `walk_sandbox`**. Never call `apply_resolution` or `settle_review_item`.
  Production is never a target.
- Machine: memory is tight. Run one vitest project at a time; kill every
  server you start.

## What exists today (read before changing)

Paging machinery, all offset-based and append-on-press:

- `src/lib/paging/bounds.ts` — `PAGE_ROUTES` (the two surfaces), `OFFSET_PARAM`,
  `MAX_PAGE_OFFSET` (bound refused, never clamped), `pageBound`, `PageAnswer`,
  `PAGE_ANSWER_CACHE_CONTROL` (no-store on every arm), `isPageAnswer`.
- `src/lib/paging/machine.ts` — `PageState` (`held`, `after` bound, `drawnIds`,
  `overlapped`, `refusal`), `initialPage`, `pressing`, `requestPage`
  (never throws), `pageUrl`, `continuing` (discards state when the first
  screen re-rendered under it), `RowIdKey`/`readId`/`idAt` (the id crosses
  the client boundary as a KEY NAME, never a function — the P1 of
  2026-09-14, BUG-0226; keep it that way).
- `src/components/ui/paging.tsx` — `PagingProvider` (client), `usePageRows`,
  `PageMore` (the control; withdrawn on a not-provisioned answer).
- `src/lib/db/paging.ts` — the server-side page read; route handlers
  `src/app/api/admin/claims/rows/route.ts` and
  `src/app/api/admin/browse/rows/route.ts`, both gated by `requireAdmin()`.
- Surfaces: `src/app/claims/page.tsx` + `src/components/claims/paged-claim-list.tsx`;
  `src/app/browse/page.tsx` + `src/components/browse/paged-browse-table.tsx`.
- Window line (`src/components/ui/window-line.tsx`): states what is drawn,
  what continues and the held count — its sentences must say "rows 51–100 of
  877" truthfully under the new shape.

Contracts that describe the old shape and MUST be amended with the code (the
factory's next run grades against them; if they still say "the window grows",
your change reads as drift):

- `agenticflow/docs/vision/ARCHITECTURE.md` §4.3 "kind 3" (offset paging,
  full-or-exhausted, no snapshot promise, bound is the OFFSET, and the dated
  2026-09-10 paging amendment). Rewrite the kind to page windows; keep the
  refusal rules (bound refused not clamped; a page that refuses names the
  object; no total the read did not establish).
- `agenticflow/docs/vision/SPEC.md` F14 — rewrite (not append) the bullets that
  say the window grows; keep: first screen server-rendered, requests are
  bounded client requests against the route handler, no third surface, no
  "load everything", gated route handler, not whole-table browsing.
- `agenticflow/docs/vision/LOOK_AND_FEEL.md` bar 11 carries a clause that
  **retires itself the day page position enters the URL** — delete that clause
  and grade bar 11 by its own sentence. Bar 14 (nothing the operator must find
  sits below a long list): the page control and size selector go ABOVE the
  list (or on the window line), never after the last row.
- `agenticflow/docs/DECISIONS.md` — add a dated entry: Ben's ruling, what moved.

## Tests that pin the old shape (rewrite to the new contract; never delete)

- `tests/offline/paging/machine.test.ts` (incl. BUG-0221's `it.fails` pin — a
  press asks a position, so a claim settled between screen read and press is
  skipped; under page windows state the rule that replaces it and flip or
  retire the pin honestly), `tests/offline/paging/answer.test.ts`,
  `tests/offline/ui/paging.test.ts`, `tests/offline/claims/page.test.ts`,
  `tests/offline/browse/page.test.ts`, `tests/offline/shell/client-boundary.test.ts`
  (pins that the client provider gets DATA only — keep green).
- `tests/http/**` paging cases (`GATE_STATUS`, cache headers, refusal arms).
- `tests/live/claims.live.test.ts` and `tests/live/browse.live.test.ts` —
  the three-walk order proof over staging's 817-row tie on one instant (every
  window boundary crosses it): rewrite as a page-window walk asserting every
  id drawn exactly once across all windows, at each of the three sizes.

Rules the factory holds and you should too: a test pins behaviour, never copy
(no asserting sentences verbatim); a stated fact comes from whoever knows it
(the window line says what the state knows, never infers it from a list's
length); `requestPage` never throws; no function crosses to a client component.

## Design questions you must answer in the code and in the SPEC text

1. Size change mid-walk: on rows 51–100 at size 50, switching to 20 — which
   window is shown? (Reasonable: the window containing the first drawn row.)
2. Out-of-range page in the URL (`?page=999`): refuse naming the bound, as
   `MAX_PAGE_OFFSET` does today, never clamp silently.
3. The first server-rendered screen: it now honours `?page=`/`?size=` on a
   cold load (that is the point), so the "byte-identical first screen" pin
   becomes "the server screen for a given URL is what the client would draw".
4. What the window line says on every arm (drawn, refused, not-provisioned,
   exhausted), and what the control offers on the last window.

## Proof bar (non-negotiable — this is what the factory's QA would demand)

1. `tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`, `npm run test:http`
   all green.
2. Live: `npm run test:live -- tests/live/claims.live.test.ts` and
   `... tests/live/browse.live.test.ts` green against staging.
3. **Production build over real HTTP on your own port** with a minted walk
   cookie (STACK §5 "get past the gate"): `/`, `/claims`, `/browse`, `/sources`,
   a record page — all 200; zero "Functions cannot be passed" in the server
   log. M3's worst bug (both pages 500) was invisible to every test tier and
   caught only this way.
4. **Real browser walk** (playwright is available under
   `agenticflow/.venv-tools`): on `/claims` walk every window at size 20, 50
   and 100 — 877 distinct claim ids in total each time, no duplicate, no skip,
   no console error; change size mid-walk; reload on a middle window and land
   on it; Back returns to the previous window. Same on `/browse` (120 events).
5. Not-provisioned and refusal arms still render their cards with no control
   that cannot be honoured.

## Hand-back

- Do not edit tracker ticket files. Write one note to
  `agenticflow/tracker/inbox/<date>-external-page-windows-done.md` listing:
  the merge commit on `run/admin-window`, what moved in ARCHITECTURE/SPEC/
  LOOK_AND_FEEL/DECISIONS, the proof numbers (ids per size, walk results),
  and that BUG-0221 is resolved by this change. The factory routes closure
  from that note.
- Leave Ben's `.env.example` and `agenticflow/run.yaml` untouched.
