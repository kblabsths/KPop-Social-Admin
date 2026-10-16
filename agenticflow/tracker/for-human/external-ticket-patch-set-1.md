# External ticket — patch set 1 (four small M3 leftovers)

*For an agent working outside the factory. Self-contained apart from the four
ticket files it points at. Written by the admin-window dispatcher on
2026-09-15.*

## The four items

Each is a filed ticket with a description, acceptance criteria and checks. Read
each one in full before starting it:

```sh
cd "/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin"
python3 agenticflow/scripts/ticket.py packet BUG-0235   # prose sweep, 16 files + 3 mechanism sites
python3 agenticflow/scripts/ticket.py packet BUG-0236   # /claims: two readings of "unnamed source"
python3 agenticflow/scripts/ticket.py packet TASK-0082  # route-level error boundary (src/app/error.tsx)
python3 agenticflow/scripts/ticket.py packet TASK-0083  # README tier table names the handoff suite
```

The packet prints the ticket plus the project's LESSONS and STACK excerpts —
read those too; they are the rules the code was written under.

Summary and order (smallest first):

1. **TASK-0083** — README's script table gains a `npm run test:handoff` row
   (runs `tests/handoff/**`, NOT part of `npm test`, subject is the sibling
   repo `../kspace Scraper`), and the tier paragraph counts five tiers.
   Nothing else in README moves. Checks: the two greps, the front-door guard
   (`tests/offline/shell/shell.test.ts`), `npm run test:handoff` green.
2. **BUG-0236** — `src/lib/gauges/settled-values.ts` counts an unnamed source
   with `source === undefined`; its twin gauge uses `isSourceNamed` over
   `sourceNamesOf(input.sources)`. Use the same reading; add ONE test case on
   both fixtures (a present row with a blank name counts as unnamed; a real
   name does not); no other behaviour changes; the comment names the fact it
   asks and points at the owner.
3. **BUG-0235** — comment-only sweep, one class: a comment about a MECHANISM
   names the symbol the code calls; a comment about a WORLD names no install
   state. Half A: 14 files still say `verdicts`/`settle_review_item` "do not
   exist on staging or in production / until Ben installs" — false since
   2026-09-11; reword to name the world the fixture USES, not an install
   state. Half B: three sites still call the app's count reads "head: true"
   — the app's count read is `countRead` (`{ count: "exact" }` over
   `limit 0`, GET-shaped); `head: true` survives only where the subject is
   the shape the app does NOT issue and why. One call changes too:
   `tests/live/harness.live.test.ts`'s "agrees with the app's own read path"
   case must issue `countRead`. Everything else is comment text — prove it
   (minified output identical, or `git diff -U0` with no non-comment line).
4. **TASK-0082** — `src/app/error.tsx` (client component; read the Next
   guide in `node_modules/next/dist/docs/` first). It is a NET, not a voice:
   it names the route that could not be drawn, shows Next's `digest` verbatim
   in mono when present, and gives the app's fix sentence; it uses the shared
   refusal primitives and design tokens under `src/components/ui/**` (never a
   raw colour). It never replaces a refusal: `lib/db` still never throws, no
   module gains a `throw` to reach it — pin that a `not_provisioned` answer
   still renders its own card. `global-error.tsx` only if you can name a path
   where the root layout itself throws. `npm run build` green; the six pages'
   offline suites unchanged.

## Repo facts you must know

- Repo `/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin`; work on a branch off
  `run/admin-window` (e.g. `external/patch-set-1`), never `main`; merge back
  into `run/admin-window` when the checks pass. Commit by explicit pathspec,
  never `git add -A` (`.env.example` is modified and is Ben's).
- Commands: `agenticflow/docs/STACK.md` §5. `./node_modules/.bin/tsc --noEmit`,
  `npm run lint`, `npm test`, `npm run test:http`, `npm run test:live --
  tests/live/<file>`, `npm run test:handoff`.
- Ports 8770/8771/8772/8790 are taken; 8771 is Ben's dev instance and
  `npm run dev -- --port <other>` attaches to it — use `npm run start` on your
  own bind-probed port if you need a server.
- Never open, print or grep `.env`; source it into a subshell as STACK §5
  step 1 shows when a live check needs staging. Staging writes only
  `walk_sandbox`; never call `apply_resolution` or `settle_review_item`.
- Known state: `npm run test:live -- tests/live/residue.live.test.ts` is RED
  on one staging catalog row (event `01a03c9b-…` carries a probe title from a
  2026-09-11 test); that is not yours and not a failure of your work.
- Memory is tight on this machine: one vitest project at a time, kill every
  server you start.

## Proof bar

Every check listed in each ticket's `## Checks` block passes on your branch
after rebasing onto `run/admin-window`, plus `tsc --noEmit`, `npm run lint`
and `npm run build` once at the end. For BUG-0235 add the comment-only proof.
For TASK-0082 drive the boundary once for real: a production build on your
own port, a route made to throw (a scratch page or a forced render error),
the boundary rendered with the route name, then the scratch removed.

## Hand-back

Do not edit the ticket files. Write one note to
`agenticflow/tracker/inbox/<date>-external-patch-set-1-done.md` naming each
ticket, the commits, and the check results; the factory routes closure from
it. Leave `agenticflow/run.yaml` and `.env.example` untouched.
