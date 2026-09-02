# Build judgments — campaign `admin-window`

The calls the build made on Ben's behalf, most consequential first, at most
fifteen. Rewritten **whole** at each milestone close; this is the **M1
edition**, written 2026-09-02. Each entry names the **contract location that
was silent or self-contradictory**, what was decided, who decided it, and
where it is recorded.

Entries 1–7 are **Ben's own rulings** — recorded here because the build had to
be told, not because anyone here decided them. Every one arrived through a
blocked ASK ticket, which is the ground rule this file exists beside: *"a gap
in the contracts is a blocked ticket, never a judgment call silently made"*
(`admin-build.md`, Ground rules). Nothing still open appears below as settled;
the open questions have their own section at the end.

`agenticflow/docs/DECISIONS.md` is the complete record — twenty-three dated
paragraphs at this close. This file is the fifteen a reviewer should read
first. The two trailing sections use `###` deliberately, so that a count of
`^## ` lines is exactly the entry count.

---

## 1. The app reads `SUPABASE_*`; only the live suite reads `STAGING_SUPABASE_*`

`src/lib/db/client.ts` is unchanged and no `STAGING_` name appears anywhere
under `src/`. `tests/live/setup.ts` is the one file that reads the four
staging names and refuses, loudly and without fallback, when either credential
name is unset. Parity therefore stays two independently-written PostgREST
paths: `STAGING_SUPABASE_DB_URL` exists as a name and is read by nothing.

*Contradictory at*: `admin-build.md` Ground rules — *"live work targets the
staging project through `STAGING_SUPABASE_*` names … an unset name is a
refusal, never a fallback"* against *"the deployed Railway service is never
repointed … every push to `main` must leave the app deployable"*. The deployed
service reads `SUPABASE_*`.
*Decided by*: **Ben**, 2026-09-02 (the pg-driver half by the architect, same
day). *Recorded*: DECISIONS.md 2026-09-02; ARCHITECTURE §12; SERVICES.md;
`admin-window/TASK-0021`.

## 2. A live test may write `groups` and `idols`, and nothing else

One field of an existing row, prior value restored in a `finally`, residue
scanned after. Resolver-owned tables — `events`, `venues`, `review_items`,
`observations`, `field_provenance` — are never written by an Admin test; a
fixture population that would need one is reported as a gap, never inserted.
Consequence recorded with it: staging holds exactly **one** `review_item`, so
every decision-side live assertion in M1 compares 0 to 0 and is described as
vacuous rather than counted as coverage.

*Silent at*: `admin-build.md` Ground rules (staging only) and tests 2, 3, 5,
10, 11 — they require rendered numbers matched against real staging rows and
say nothing about whether a test may create the rows it needs.
*Decided by*: **Ben**, 2026-09-02, with QA's staging census beside it.
*Recorded*: DECISIONS.md 2026-09-02; ARCHITECTURE §10;
`admin-window/TASK-0022`.

## 3. No dial-shaped work anywhere in this campaign

The per-source stuck-pattern threshold line stays **absent**, with its reason
on screen, through M1 *and* M2 — no threshold overlay, no dial display, no
dial edit. Ben's principle behind it, an ecosystem design-queue item and not
campaign work: a dial-able value does not live in a YAML file, dials belong in
rows. So Admin never reads the scraper registry YAML; when the dial becomes a
row, the gauge reads the row.

*Silent at*: `admin-observability.md` §5 — the pending-claims gauge is
specified as *"per-source `awaiting_row` trend against its pattern
threshold"*, while §10 forbids re-encoding scraper YAML; neither says what to
render when the threshold is unreachable.
*Decided by*: **Ben**, 2026-09-02, extended past M2 the same day.
*Recorded*: DECISIONS.md 2026-09-02; `admin-window/TASK-0024`.

## 4. A resolver-owned record page shows a read-only display list, from the same one map

`events` → title, description, poster, starts_at, venue; `venues` → name,
city, country, address — read-only, with per-field provenance beside each.
The list is a field of the **existing** `{table → editable columns}` config;
there is no second allowlist in this repo.

*Silent at*: `admin-observability.md` §8 — it describes the resolver-owned
edit surface only in its M2 form (override through the gate, provenance
stamped `admin_locked`) and says nothing about what such a record *displays*
in M1, when no override path exists. Found because Browse links every event
row to a page rendering one line.
*Decided by*: **Ben**, 2026-09-02, on a QA-filed ASK.
*Recorded*: `admin-window/TASK-0029`, which carries the ruling and the
criteria written from it. **The build has not landed at this close** — the
ticket is open; the ruling is what is settled.

## 5. The provenance slot on a pre-cutover table reads its absence, with the reason

`groups` and `idols` edit directly and have no `field_provenance` rows, so
their slot says so — "no provenance recorded (pre-cutover table)" — rather
than rendering blank. Absence with its reason beats a blank, and every table's
provenance slot is then filled with something true.

*Silent at*: `admin-observability.md` §8 (*"per-field provenance shows at the
edit surface"*) and LOOK_AND_FEEL quality bar 5, neither of which covers a
table for which no provenance row exists or ever will before cutover.
*Decided by*: **Ben**, 2026-09-02, confirming the landed rendering.
*Recorded*: DECISIONS.md 2026-09-02; `admin-window/TASK-0025`; built by
`admin-window/TASK-0018`.

## 6. Cycles & runs shows nine of the `runs` table's 22 columns, and honours `?source=`

`source`, `started_at`, `ended_at` (a null one reads as still running),
`outcome`, `error_summary` inline and verbatim, `records_parsed`,
`claims_emitted`, `records_unlinked`, `failure_class`. Nothing else of the 22
in M1; a ticket wanting a tenth re-opens this decision rather than adding a
column. The facet narrows the runs half only and matches **by name**, because
`runs.source` is text with no foreign key.

*Silent at*: `admin-observability.md` §4 puts *"the adapter framework's `runs`,
newest first, with the counts as columns"* on the page, but `adapters.md` is
not among the contract snapshots, so "the counts" names nothing of a
22-column table.
*Decided by*: **Ben**, 2026-09-02. *Recorded*: DECISIONS.md 2026-09-02;
ARCHITECTURE §12; `admin-window/TASK-0023`; built by `admin-window/TASK-0016`.

## 7. The window is desktop-only and keeps both themes

No phone bar, no mobile breakpoint work, and neither theme may be dropped to
make a screen easier.

*Silent at*: `admin-observability.md` §4 — it fixes the six pages and what
each shows, and never names a viewport or a breakpoint. LOOK_AND_FEEL bar 1
checks at 1440×900 and bar 12 requires both themes, but neither says whether a
phone layout is in scope or whether a theme may be dropped to simplify a
screen; this ruling closes both.
*Decided by*: **Ben**, 2026-09-02. *Recorded*: DECISIONS.md 2026-09-02
(third of three taste rulings).

## 8. Absence is a result code, never an exception, and an error line names the read it failed

Every `lib/db` read returns `{kind: "ok" | "not_provisioned" | "error"}` and
never throws; "not provisioned" is decided from the PostgREST/Postgres code
(`PGRST205`, `PGRST204`, `42P01`, `42703`) in one helper. The error arm
carries `reading` — the object the query asked for — because a page makes
several reads, and its message is the client's whole account (`message`,
`details`, `hint`, `cause`, `code`, in that order), scrubbed of credential
shapes including a DSN password.

*Silent at*: `admin-build.md` Ground rules and test 9 require that an absent
ecosystem table *"renders an honest not-provisioned state, never a crash"*,
and say nothing about how absence is detected or what the operator is told
when a read fails for some other reason.
*Decided by*: the **architect**, 2026-09-01, extended 2026-09-02 after a QA
finding that Browse's error line read only "TypeError: fetch failed".
*Recorded*: DECISIONS.md 2026-09-01 and 2026-09-02; ARCHITECTURE §4.1;
`admin-window/BUG-0016`.

## 9. A complete read returns the whole matching set or refuses; it never truncates

Reads split in two. A **complete read** asks for an exact count with a total
order and an explicit range, and errors — naming the object, the count and the
cap — whenever the count exceeds the rows returned. A **window read** is a
named, bounded, ordered window whose card says which window it shows. A null
count is a refusal, never a zero. The doors this closes: no paging is built in
this app, and no figure is derived from a possibly-truncated set.

*Silent at*: `admin-observability.md` §5 — gauges are specified as read-only
queries the Admin server runs, with no mention of PostgREST's `db-max-rows`
cap (Supabase default 1000), which silently returns an arbitrary subset in
unspecified order.
*Decided by*: the **architect**, 2026-09-02, from a QA finding on
`admin-window/TASK-0006` where an open count would have been wrong rather than
refused. *Recorded*: DECISIONS.md 2026-09-02; ARCHITECTURE §4.3; `ROW_CAP` in
`src/lib/db/result.ts`.

## 10. Gauges aggregate in TypeScript — no RPC, no view, no Postgres driver

Each gauge fetches a bounded, time-windowed row set and aggregates in a pure
function, with an explicit limit on every query. No percentile is computed by
the database, and no second transport is added: what direct SQL would buy —
`EXPLAIN ANALYZE`, aggregates PostgREST cannot express — lives on the far side
of the scraper handoff, where the schema and the SQL prompt already are.

*Silent at*: `admin-observability.md` §5 fixes *where* gauge SQL runs
(server-side, not a database view) but not *how* an aggregate is computed when
PostgREST offers nothing beyond `count`; `admin-build.md` Ground rules ban a
SQL-executing route without ruling on a direct connection.
*Decided by*: the **architect**, 2026-09-01; the no-driver half 2026-09-02
after Ben's env answer made a DSN available as a name.
*Recorded*: DECISIONS.md 2026-09-01 and 2026-09-02; ARCHITECTURE §8.

## 11. Vitest is the runner, there is no browser dependency, and a page function is a route's only async component

Every component below the page function is synchronous and takes plain props,
so a test renders a real page with `renderToStaticMarkup(await Page(props))` —
Next's own docs say Vitest cannot render async server components, and a nested
async component would have forced a browser dependency on the campaign. No
jsdom, no Testing Library, no Playwright as a product dependency; screenshots
stay the walk agent's kit-owned tooling.

*Silent at*: `admin-build.md` "Tests that must pass" enumerates the tests and
names no runner, and `admin-observability.md` §10 names no rendering shape.
The repo had no test framework at all.
*Decided by*: the **architect**, 2026-09-01, at intake.
*Recorded*: DECISIONS.md 2026-09-01 (two paragraphs); STACK.md §4;
ARCHITECTURE §5; the runner itself as `admin-window/DEP-0001`.

## 12. A 404 this app means is routed, not thrown; and the auth gate is never handed a handler

`/records/<unmapped-table>/<id>` answers through a `beforeFiles` rewrite in
`next.config.ts` to a path no route matches. Measured on Next 16.2.2: a 404
status and a server-rendered document are inseparable *in render* —
`notFound()`'s status is set in the same `catch` that emits the client-only
error shell — while a 404 the router decides renders the not-found tree
through the root layout. The rewrite is `/records`-specific and is not
inherited. From the same surface: the gate stays
`export { auth as middleware }`, because passing a handler to `auth()` takes a
branch that precedes the authorization branch, leaving every route open.

*Silent at*: `admin-observability.md` §4 and §6 say nothing about a URL whose
table segment names no table, and `admin-build.md`'s *"the build owns `src/`
wholesale"* gives no home to a routing-config edit outside `src/`.
*Decided by*: a **builder**, as a declared scope excursion; **QA** ruled it
accepted after verifying independently that nothing in `src/app` could satisfy
the criterion. *Recorded*: DECISIONS.md 2026-09-02; ARCHITECTURE §5;
`admin-window/BUG-0017`.

## 13. The four data-surface states are a typed contract, and a counted zero is always shown

What the operator must be told is carried by a required prop, not by a caller
remembering: `ErrorLine` and the gauge error arm require `reading`; the empty
and not-provisioned cards carry their own eyebrow; a trend or distribution
requires `empty: {holds, filledBy}` and renders it itself, so a headers-only
table is unreachable rather than discouraged. And a counted zero is data: an
empty queue still renders its open count. Only `not_provisioned` may render no
number, because there a zero would be a lie about a table that is not there.

*Silent at*: `admin-observability.md` §4 fixes what each page shows and not
what it shows when a read is empty, absent or failed. The counted-zero half is
a collision *inside* the vision docs: LOOK_AND_FEEL bar 1 and its
repeat-use principle ("counts sit in fixed positions") against the emptiness rule
that an empty bucket and an unprovisioned table never share a rendering.
*Decided by*: the **architect**, 2026-09-02, both from QA findings.
*Recorded*: DECISIONS.md 2026-09-02 (two paragraphs); built by
`admin-window/TASK-0030`. The counted-zero fix is `admin-window/BUG-0027`,
**open at this close**.

## 14. A live oracle names the page's state kind before it compares a number, and the http suite may never acquire a database

A live test derives the kind it expects from its own independent count,
asserts the rendered kind structurally, compares numbers only in `ok`, treats
`empty` as a pass with a stated 0, accepts `not_provisioned` only when its own
read returns the absence code, and treats `error` as a **failure** naming the
read. Two-way oracles are banned. Separately, the http suite sets sentinel
credentials rather than deleting names, because `next start` reloads `.env`
and restores them: measured, and material, since an http test that PATCHes a
write route would otherwise have exercised the live project with RLS bypassed
on any machine holding the service key.

*Silent at*: `admin-build.md` tests 2, 3, 5, 10, 11 require that a rendered
number match a direct read and say nothing about which rendered *state* counts
as a pass; test 13's sweep rule says nothing about what the non-live suites
may reach.
*Decided by*: the **architect**, 2026-09-02, from a QA measurement of the
first staging parity run — four of `/claims`' six assertions passed while the
page was in its error state. *Recorded*: DECISIONS.md 2026-09-02 (two
paragraphs); ARCHITECTURE §10; the http half landed, the oracle rewrite is
`admin-window/TASK-0032`, **open at this close**.

## 15. A structural guard over the source tree parses with TypeScript's own parser

A guard whose question needs a syntactic boundary — where an argument ends,
whether a backtick is a template or text — uses `ts.createSourceFile` and an
AST walk; a guard that only asks whether a *name* appears may keep the cheap
line-wise read. An absence assertion pins the call it forbids, never a word.
A parse error is a report, not a skip: the permitted failure direction is
over-reporting, never a miss.

*Silent at*: `admin-build.md` Ground rules forbid DDL from Admin code, a
SQL-executing route, and any direct write to a resolver-owned domain, but
nothing in the contracts says how an absence is *proven*. The campaign's
answer is a set of source-tree guards, and their trustworthiness is entirely
this build's invention.
*Decided by*: the **architect**, 2026-09-02, after three QA bounces on the
bespoke tokenizer — the third fix read a backtick inside a regex literal as
division and silently erased a real forbidden write, which is the failure
direction the guard exists to exclude.
*Recorded*: DECISIONS.md 2026-09-02; ARCHITECTURE §10 and its violation
ledger, classes 4–5; `admin-window/BUG-0030`, `admin-window/BUG-0020`.

---

### Questions routed rather than decided

Open at this close, and deliberately absent from the entries above.

- **`pending_claims` cannot be read on staging.** Eight read shapes measured;
  every one but an unordered `limit 1` hits the 8s statement timeout with
  `57014`. The fix is a scraper-repo artifact (an index on `field_provenance`,
  or a view rewrite) and therefore a **handoff**: `admin-window/TASK-0031`
  carries the measurements, the candidate SQL, the target path and the apply
  command, and is blocked on Ben. What *is* settled and recorded (DECISIONS.md
  2026-09-02) is only the consequence: `/claims` and the Sources awaiting-row
  gauge render their honest error state, and no Admin-side workaround —
  not a cache, not a swallowed timeout, not a re-computed classification —
  may be written. ARCHITECTURE §12 still carries the `OPEN-CLAIMS-COST`
  marker; it is the campaign's only remaining open contract question.
- **LOOK_AND_FEEL fails its own quality bar 12 in light theme.** Measured by
  QA on `admin-window/TASK-0004`: healthy green-600 on white 3.22:1;
  attention amber-600 on white 3.20:1 and on chrome 3.06:1 — attention being
  the colour that means "needs a human"; broken red-600 on the page background
  4.33:1; ink-secondary gray-500 4.39:1. Dark theme passes everywhere
  (minimum 5.25:1). A palette change is a vision-doc change, so it is Ben's,
  not a ticket. The one related value the build *did* decide is recorded on
  that ticket: `--color-on-accent` is gray-950 in dark theme (7.21:1) rather
  than the white the doc's prose names (2.79:1), because bar 12 is checkable
  against the running app and the prose is not.

### Cross-directory report — M1 close

- **Scraper-side commits made by this campaign during M1: zero.** Measured
  2026-09-02 in `../kspace Scraper`: `git log --all --grep=admin-window`
  returns 0 commits, and no commit message in that repo names this campaign or
  this repo. The 260 commits it has taken since 2026-09-01 are its own
  `resolver` campaign's, under its own ticket numbering. No declared handoff
  and no noted minor edit was installed there by this campaign.
- **No ticket's touch scope named a scraper path.** Measured across all 75
  ticket files in `agenticflow/visions/admin-window/tracker/tickets/`: no
  `touch_scope` entry contains `Scraper` or a `../` segment.
- **Expected, and met.** `admin-observability.md` §10 makes *everything*
  scraper-side a handoff while a campaign runs in that repo, and its tracker's
  `RUNNING` marker is present today. One handoff is outstanding and unapplied:
  `admin-window/TASK-0031`. The two §9 migrations (`verdicts`,
  `settle_review_item`) are M2's and are not yet authored.
