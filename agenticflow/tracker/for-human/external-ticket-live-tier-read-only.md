# External ticket — the live tier becomes a small read-only contract smoke

*For an agent working outside the factory. Written by the admin-window
dispatcher on 2026-09-16 from Ben's testing rules of the same day (see
`agenticflow/tracker/proposals/2026-09-16-testing-rules.md` for the rules and
the reasoning; this ticket is their application to `tests/live/`).*

## The rules this ticket enforces

1. No test asserts a value it did not write.
2. No test writes anywhere shared — staging included, `walk_sandbox` included.
3. Live tests are expensive: few, read-only, each with a one-line reason it must
   be live. Their only job is to prove the offline stubs are honest about how
   PostgREST answers.
4. A test earns its place by naming a bug it would catch that no other test
   catches.

"Proven end to end" in the acceptance list means a person or an agent walks it
once and leaves a dated note — never a re-runnable test. The §7 acceptance walk
was done by Ben on 2026-09-16 (`for-human/external-ticket-acceptance-walk.md`
and the inbox report); do not recreate it as a suite.

## What exists today (measured 2026-09-16)

`tests/live/` — 11 files, 117 cases, run by `npm run test:live` against staging
`ubfjjqlvnpnoborczbdb`, a project another campaign writes concurrently:

| file | cases | notes |
| --- | --- | --- |
| browse.live | 7 | asserts counts/ids from staging (rule 1) |
| claims.live | 19 | three-walk order proof over staging's 817-row tie (rule 1) |
| cycles.live | 7 | grades gauge states from staging data (rule 1) |
| dashboard.live | 10 | same |
| edit.live | 18 | one write-shaped call (the override probe path; reads the world since BUG-0215) — rule 2 |
| harness.live | 7 | two write-shaped calls (harness doors) — rule 2 |
| queues.live | 13 | staging values (rule 1) |
| residue.live | 6 | a marker sweep over catalog tables — exists only because tests once wrote; rule 2 makes it moot |
| review-item.live | 12 | staging values (rule 1) |
| runs.live | 10 | same |
| sources.live | 8 | same |

Also `tests/walk/` (reset-sandbox, scrub, session-cookie, sandbox-fixture):
human-walk preparation that writes `walk_sandbox`. Not a test; keep it, but it
must not be reachable from any `npm run test:*` script.

Offline today: 81 files / 3282 cases; http: 6 / 37; isolated: 1 / 8;
handoff (opt-in): 1 / 9. The offline and http tiers stay; a separate ticket
prunes them.

## What to build

1. **Move every value assertion offline.** For each live case that asserts a
   count, an id, a title, a gauge state or an order read from staging: either
   an equivalent offline case already exists (delete the live one, say which
   offline case covers it in the commit message), or write the offline case
   with a fixture the test owns (`tests/fixtures/stub-client.ts` is the seam
   every page already renders through). The page/gauge logic is what these
   were really pinning; fixtures pin it deterministically.
2. **Delete every writer.** `edit.live`'s override probe, `harness.live`'s door
   cases, and `residue.live` entirely (with rule 2 in force there is nothing to
   sweep). The override envelope and the rendering of every settle answer are
   pinned offline (`tests/offline/edit/route.test.ts`, `tests/offline/verdict/**`)
   — extend those if a live case covered a shape they do not.
3. **Keep one file: `tests/live/contract.live.test.ts`**, at most ~10 read-only
   cases, each starting with a comment `// LIVE BECAUSE: <one line>`. They
   prove the stubs' assumptions about PostgREST on the real service, asserting
   SHAPES never values, e.g.:
   - a `{ count: "exact" }` read over `limit 0` answers 200/206 with the total in
     `Content-Range` and an empty array body;
   - an absent relation answers 404 carrying a `PGRST205` document;
   - a HEAD for an absent relation carries no body (why the app never HEADs);
   - a `.maybeSingle()` over no rows answers 200 with `data: null`;
   - the OpenAPI description at the REST root lists `/rpc/settle_review_item`
     and `verdicts` (existence, not content);
   - `requireAdmin()`'s allowlist read answers a row set (shape only);
   - an empty settle decision is refused with `KS029` (a refusal is not a write —
     the function raises before touching a row; keep it only if you can show
     that from the function body in the scraper repo, read-only).
   Every case uses the same read-only client the app uses; the file must contain
   no `insert`, `upsert`, `update`, `delete`, or `rpc` call other than the
   refused-decision one above.
4. **A guard, in the offline project** (`tests/offline/live-guard.test.ts`
   already scans `tests/live`; extend it): a file under `tests/live/` may not
   contain a write-shaped call (`.insert(`, `.upsert(`, `.update(`, `.delete(`,
   `.rpc(` except the allowlisted refusal case, `method: "POST|PATCH|PUT|DELETE"`),
   may not import from `tests/walk/`, and every `it(` must be preceded by a
   `LIVE BECAUSE:` line. Watch it red once by planting a violation, then remove
   the plant.
5. **Docs:** README's tier table row for `npm run test:live` says what it is
   now ("read-only contract smoke, ~10 cases, needs the staging names");
   `agenticflow/docs/STACK.md` §5's live rows likewise (architect-owned file —
   edit the two rows only and say so in the hand-back). Delete the "residue
   sweep" row.
6. **Tickets that referenced live checks:** nothing to edit in the tracker; the
   hand-back note tells the factory which stored checks named deleted files
   (grep `test:live` under `agenticflow/visions/admin-window/tracker/tickets`
   and `archive`; list them).

## Proof bar

- `npm test` green; `npm run test:http` green; `npm run test:live` green in
  under 30 s wall, ≤ 10 cases, and green a second time immediately after (no
  state dependence).
- `grep -rlE "\.(insert|upsert|update|delete)\(" tests/live` → nothing.
- The guard reddens on a planted write and on a missing `LIVE BECAUSE:`.
- `tsc --noEmit`, `npm run lint` clean. Repo rules as in the other external
  tickets: branch off `run/admin-window`, commit by pathspec, never open
  `.env`, own port if a server is needed, kill it after.

## Hand-back

Inbox note `agenticflow/tracker/inbox/<date>-external-live-tier-done.md`: the
before/after table (files, cases, wall time), which offline cases absorbed which
live assertions, the list of tracker checks that name deleted files.
