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
