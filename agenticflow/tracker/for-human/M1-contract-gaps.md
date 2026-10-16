# Two things for Ben from the M1 close — neither is a ticket

*Architect, 2026-09-03. Both came out of the verifier's walk; both are yours to
decide, not the campaign's to fix.*

## 1. A human edit does not move `groups.updated_at`

The verifier edited a `groups` field through the admin write path and watched
`updated_at` stay where it was. It graded that **PASS**, correctly: no line of
the spec or the acceptance doc asks for it, and the only honest fix is a
database trigger — schema, which lives in `kspace Scraper/supabase/migrations/`
and which this repo may never carry.

So the catalog currently records *that* a value changed (the row is different)
but not *when a human changed it*. If you want that, it is a migration in the
scraper repo (a `set_updated_at` trigger on `groups` and `idols`), and it wants
deciding before the M2 cutover work makes provenance the answer to the same
question. Nothing here is broken; a fact you may assume exists does not.

## 2. The local `.env` AUTH_SECRET is the published placeholder

The verifier's commit scan found `AUTH_SECRET`'s value matching four patch
lines — all of them in `.env.example`, because the `.env` on this machine
reuses that file's placeholder verbatim. Nothing secret leaked into git, and no
ticket, receipt or evidence file carries a value.

The consequence is local and real: the secret that mints session cookies for
this app on this machine is published in the repo, so anyone with the repo can
mint one. Rotate the local `.env` value when convenient (and check the Railway
environment carries its own, unrelated value). Nobody on the campaign has
printed it or will; `.env.example` is untouched.
