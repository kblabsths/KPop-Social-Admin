# Admin Observability Build — acceptance

- Status: **APPROVED 2026-09-01**.
- Spec: [designs/admin-observability.md](../designs/admin-observability.md)
  (approved in full 2026-09-01). Campaign: factory `/ship` in `kspace Admin`.
- Kickoff gates: kit 0.6.3 (cross-directory work policy) installed in the
  Admin repo; this doc approved. The verdict slice's two migrations
  additionally wait for the resolver campaign to close.

## Ground rules (bind every ticket)

- **The build owns `src/` wholesale.** Every existing surface is deprecated
  reference — precedent for nothing, no backward-compatibility obligation, no
  deprecated page left standing. An old component survives only by re-earning
  its place.
- **The scraper repo (`../kspace Scraper/`) is governed by the kit's
  cross-directory policy**, declared at intake: read freely; a minor +
  necessary + reversible edit is its own commit there, noted on the ticket;
  major — every migration, every registry-semantics change, anything touching
  gate or resolver behavior, anything irreversible, and *everything* while a
  campaign runs there — is a handoff ticket carrying the complete artifact
  (exact content, target path, apply command) for Ben to install. Unsure
  means major. Workaround code in this repo to dodge a scraper-side edit is
  forbidden. The two §9 migrations are the expected handoffs.
- **Staging only.** Live work targets the staging project through
  `STAGING_SUPABASE_*` names; the production project is never a build
  target. Secrets are names — no key or connection string ever appears in a
  file, transcript, or commit; an unset name is a refusal, never a fallback.
- **Schema footprint is exactly two items**, authored as handoff migrations:
  the `verdicts` table and `settle_review_item`. Zero new canonical columns;
  zero json columns; no DDL from Admin code and no SQL-executing route may
  be built.
- **The parked sections are not built**: no operator, no free-form tickets,
  no recommendations / incidents / agent_runs / commands tables, no registry
  mirror, no severity formula, no AI calls.
- **The deployed Railway service is never repointed by this campaign**, and
  every push to `main` must leave the app deployable against whatever
  project the service targets: an ecosystem page whose backing tables are
  absent renders an honest not-provisioned state, never a crash.
- **Every page sits behind the existing gate** (NextAuth +
  `admin_allowed_emails`); the service key lives server-side only and never
  reaches a client bundle.
- **One hand-written config** drives the edit surface: the
  `{table → editable columns}` map. Write path and widget derive; a
  resolver-owned domain is written only through `settle_review_item` —
  never a direct table write.
- **A gap in the contracts is a blocked ticket, never a judgment call**
  silently made.

## Tests that must pass

1. **The repo's bars, green**: `npm run lint` and `npm run build` with zero
   errors, plus the campaign's test suite — offline by default, staging
   tests behind an explicit live marker.
2. **Every page renders real staging data**, and a parity check per page
   asserts the rendered numbers against direct SQL on staging (dashboard
   counts, queue counts, cycle rows, source rows).
3. **Claims page parity**: rendered bucket counts equal the classification
   view's, per bucket, per source filter; `in_window` appears nowhere in
   the UI.
4. **Queues split by kind**: the three shapes classify decision / decision /
   signal; shape and queue filters return exactly the matching items.
5. **A review item's detail resolves its evidence**: every `evidence` id
   renders as its observation row (value, source, tier, observed_at) with
   canonical's current value and provenance beside them; each of the three
   shapes renders its typed view.
6. **Every §7 action, end to end on staging**: choose / supply / keep-current
   / link / settle-only on decision items; `fixed` and `wont_fix` on a
   signal (a `wont_fix` without a note is refused). Each settlement is one
   transaction — its apply and rejection stamps share a timestamp, and a
   killed call leaves no partial write. Grant introspection (recorded as
   evidence) proves `verdicts` is written and `review_items.status` set by
   `settle_review_item` alone.
7. **The edit surface obeys its config map**: a column present in the map
   edits; a column absent refuses even a forged request; an events/venues
   edit lands as an admin-tier observation applied with `admin_locked`
   provenance and a `verdicts` `override` row — grant introspection proves
   no direct write path to those tables exists from Admin; a groups/idols
   edit updates directly within its allowlist.
8. **A reference-field override links rows**: the picker's choice writes the
   observation plus its confirmed match, and the apply produces `venue_id` /
   `event_performers` rows, never text.
9. **Graceful absence**: against a database lacking the resolver tables,
   every ecosystem page renders its not-provisioned state; nothing throws.
10. **Browse — recent events**: newest first, the spot-verification columns
    including the sources behind the row from the provenance join; the
    column selector shows and hides exactly the configured set.
11. **The six gauges render** from staging rows, each answering its knob's
    question ([§5](../designs/admin-observability.md)).
12. **Auth holds**: an unauthenticated request to every new page and route
    redirects to login; a build-artifact scan finds no service key in any
    client bundle.
13. **Zero residue**: the live suite sweeps what it wrote; staging carries
    no campaign leftovers after the final run.

## Reviewed after the build

- `docs/build_judgments.md` — at most fifteen, rewritten whole at each
  milestone close, each entry naming the contract location that was silent.
- **Screenshots of every page and both edit flows**, captured at each
  milestone close — the human eye on rendered UI the factory cannot judge.
- The grant-introspection reports (tests 6 and 7) as stored evidence.
- The two handoff artifacts as installed, and the milestone-close
  cross-directory report: every scraper-side commit is a declared handoff
  or a noted minor edit; no ticket's touch scope named a scraper path.
