# External services — the human-owned contract

The factory never provisions a service: no accounts, no projects, no tier
changes, no billing. Needing one = a DEP ticket; the toolsmith vets it;
the HUMAN creates it and declares it here as a `## <cli-name>` section.
The remote gate (hook) reads this file:

- a DECLARED service's CLI passes freely — this phase is ALL STAGING
  (deploys and migrations against declared targets are normal agent work,
  no human in the loop);
- an UNDECLARED service's CLI is refused;
- anything matching prod/production is refused for everyone until a
  human-owned promotion flow exists (deliberately none yet).

**Secrets:** all secrets live in `.env` at the product root — gitignored
from day one — with a committed `.env.example` carrying variable NAMES
only. Reference secrets by NAME everywhere: never print a value into a
ticket, a log, evidence, or a handoff (transcripts persist; a value that
reaches one is burned and must be rotated by the human).

**Migrations** are forward-only files committed in the repo; agents apply
them to declared staging targets as ordinary work. Nothing applies them
anywhere else.

Entry template (copy per service; the section name must be the CLI name
the gate sees, e.g. `## railway`, `## supabase`):

    ## <cli-name>
    - what it is for: ...
    - console: <URL>
    - tier / cost ceiling: <free | $N/mo — the toolsmith refuses DEPs above it>
    - staging target agents may touch: <project/env name or id>
    - provisioned by: <human>, <date>

## supabase
- what it is for: the shared KPop Social database this scraper WRITES into
  (artist profiles + events; see CLAUDE.md "data producer")
- console: https://supabase.com/dashboard/project/nexuvegwukhyhrktxhha
- tier / cost ceiling: Free tier, $0 (Pro planned, not yet purchased — update
  this line on upgrade),
- staging target agents may touch: ubfjjqlvnpnoborczbdb
  (project name kspace-staging;
  (console: https://supabase.com/dashboard/project/ubfjjqlvnpnoborczbdb) —
  the ONLY test target per Ben's 2026-08-17 ruling
  (contracts/infrastructure.md § Tech stack); secrets in staging.env at the
  repo root, names in .env.example
- live project (nexuvegwukhyhrktxhha): NO LONGER a test target. Agents may
  touch it only for M2's pre-approved cleanup — the harness-drop migration
  push and reserved-source row deletion plus read-only introspection
  (FEAT-0007/FEAT-0010, pre-approval recorded in
  agenticflow/tracker/milestones/M2.md). That sanction ends when M2 closes.
- provisioned by: Ben, pre-factory (live project); Ben, 2026-08-17
  (kspace-staging declared via dispatcher, staging.env filled by Ben)

### railway (recorded, deliberately NOT declared - the CLI stays refused)
- what it is for: the deploy target of this app. Railway builds from `railway.toml`
  (nixpacks; build `npm run build`; start `npm run start`; healthcheck `/api/health`)
  and deploys from `main` through the GitHub integration. Pushing to `main` IS the
  deploy; no CLI is involved.
- console: https://railway.com/dashboard  <-- Ben: replace with the project URL
- tier / cost ceiling: <Ben: plan and $/mo>. Ceiling for DEP purposes: the existing
  plan, $0 incremental. Anything that adds a billable Railway resource (new service,
  Postgres/Redis plugin, extra environment) is a new DEP and is refused by default.
- staging target agents may touch: NONE. There is no Railway staging environment.
  The deployed service is a PRODUCTION surface: it reads SUPABASE_URL /
  SUPABASE_SERVICE_ROLE_KEY (service-side names, never the STAGING_* ones) and
  therefore holds a service-role key on the live catalog. Campaign work targets
  kspace-staging only.
- CLI status: NOT declared, on purpose (DEP-0002, 2026-09-02). `railway` is on this
  machine via Homebrew (5.9.1), so the remote gate's refusal is the only control.
  Agents run no railway command; deploys happen by `git push` to `main`.
- provisioned by: Ben, pre-factory