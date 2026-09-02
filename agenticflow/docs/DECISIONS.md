# DECISIONS — architectural choices that close a door

Append-only. One dated paragraph per decision, newest at the bottom.

## 2026-09-01 — Vitest is the test runner, and there is no browser dependency

The repo had no test framework. Vitest, with `vite-tsconfig-paths`, is one of
the four runners Next.js documents itself and needs one config file for a
TS/ESM App Router app; Jest would need `next/jest` plus transform and ESM
mediation for the same result. The door this closes: we do **not** adopt jsdom,
Testing Library, Cypress or Playwright as product dependencies. Page behavior
is proven by rendering the page function to markup with `react-dom/server`
(already a dependency) and, where only a real server can prove it, by starting
the built app and issuing HTTP requests. Browser screenshots stay the walk
agent's kit-owned Playwright. Cost accepted: no component-level DOM testing,
and no user-event simulation — interaction quality is judged at the walk.

## 2026-09-01 — Every data-layer read returns `DbResult`, and absence is a code, not an exception

`lib/db/**` functions return `{kind:"ok"|"not_provisioned"|"error"}` and never
throw. Acceptance test 9 ("against a database lacking the resolver tables,
every page renders its not-provisioned state; nothing throws") is then
structural rather than a per-page discipline, and the ground rule "every push
to main must leave the app deployable against whatever project the service
targets" holds by construction. Not-provisioned is decided by PostgREST /
Postgres error code (`PGRST205`, `PGRST204`, `42P01`, `42703`) in one helper.
The door this closes: no try/catch-per-page, no exception-based control flow
across the data boundary, and no page that renders a zero where a table is
missing.

## 2026-09-01 — One async boundary per route: the page function

A route's page function is the only `async` component; every component below it
is synchronous and takes plain props. This is what lets a test render a real
page with `renderToStaticMarkup(await Page(props))` — Next's own docs say
Vitest cannot render async server components, so a nested async component would
have forced a browser dependency on the campaign. The door this closes: no
async child components, no per-component data fetching, no streaming/Suspense
data waterfalls inside a page. Cost accepted: a page that needs six reads does
them in its own function.

## 2026-09-01 — Gauges aggregate in TypeScript, never in SQL

Spec §5 requires six gauges as "server-side read-only queries in this app,
never tables and never database views", and the acceptance doc forbids building
a SQL-executing route. PostgREST cannot aggregate beyond `count`, so each gauge
fetches a bounded, time-windowed row set and aggregates in a pure TypeScript
function. The door this closes: no RPC, no database view, no direct Postgres
connection, and therefore no percentile computed by the database. Cost
accepted: an explicit `limit` on every gauge query, and a re-think (one
function each) if the catalog outgrows the fetch.

## 2026-09-01 — The scraper repo is treated as read-only for this campaign

`run.yaml` declares `sibling_dirs` `write_by_size`, but the scraper repo's
`agenticflow/tracker/RUNNING` exists — a campaign is running there — and both
the kit's policy and spec §10 say everything is a handoff while that is true.
For M1 the scraper repo is read-only: no ticket's touch scope may name a
scraper path, and any change needed there is a blocked handoff ticket carrying
the complete artifact. The door this closes: no "small" grant or registry edit
lands there autonomously during this campaign, and no Admin-side workaround
code is written to dodge one.

## 2026-09-02 — Offline tests stay `.ts` with `createElement`; the glob does not change

TASK-0004's builder asked whether `tests/suite-globs.ts` should admit `.tsx` so
UI tests can use JSX. Ruling: **no** — the glob stays
`tests/offline/**/*.test.ts` and component tests build elements with
`createElement`. Three reasons. (1) The pattern is already landed and proven by
two test files, with a shared helper — `tests/offline/ui/markup.ts` exports
`h` (aliased `createElement`), `render` (`renderToStaticMarkup`), plus
`classesOf`, `tagsOf`, `textOf`. Every later UI ticket imports that helper
rather than rolling its own; a render helper copied per test directory is the
scope sprawl the shared-helper rule exists to prevent. (2) These tests assert
*emitted markup* — token classes, tag order — not a JSX tree, so JSX buys
readability on the setup lines only. (3) `tests/suite-globs.ts` is a
consolidation-shaped destination: it is imported by `vitest.config.mts` and
asserted by `tests/offline/toolchain.test.ts`, and it is pinned by TASK-0001's
checks. Changing it mid-M1 would leave two competing idioms in one suite for
the rest of the milestone. The door this closes: no JSX in the offline suite,
no jsdom, no testing-library dependency. Cost accepted: nested component setup
is wordier; `h` keeps it to one character of noise per node. Revisit at M2 only
if a ticket needs a genuinely deep tree.

## 2026-09-02 — A ticket that deletes a route must clear `.next` before `tsc`

`tsconfig.json` includes `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`
(Next 16 generates one route-type module per page). Those files are build
output, not source: when a ticket deletes or renames a route, a `.next` left
over from an earlier build in the same worktree still contains a type module
importing the deleted page, and `tsc --noEmit` fails on code that no longer
exists. That is the whole of BUG-0008 (CI red today) — environmental, not a
defect in the landed tree. Rule for every ticket whose diff removes or renames
a file under `src/app/`: run `rm -rf .next` (or a full `npm run build`, which
regenerates the types) **before** `tsc --noEmit` in its landing path; a check
block that lists `tsc` above `npm run build` is ordered wrong for such a
ticket. **Recommendation to the dispatcher (run.yaml is not mine to edit):**
`ci_command` should become
`bash -c 'rm -rf .next && npm run lint && ./node_modules/.bin/tsc --noEmit && npm test'`.
`rm -rf .next` is preferred over inserting `npm run build` — it costs
milliseconds instead of a full compile, it is deterministic (the glob then
matches nothing), and `.next` is gitignored build output that `npm run build`
and `npm run test:http` regenerate on demand. The door this closes: CI never
again reds on stale generated route types, and no one "fixes" it by dropping
`.next/types` from `tsconfig.json`, which is what gives pages their typed
route params.
