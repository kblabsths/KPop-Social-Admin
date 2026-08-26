<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# kspace Admin — agent guide

Next.js catalog-editing dashboard for the KPop Social platform. It reads the shared
Supabase project with the **service role** (server-side only) and lets admins
**field-edit** catalog records. Deploys from `main` on Railway. Claude Code loads this
file through `CLAUDE.md`'s `@AGENTS.md` import.

## Data ownership (BINDING) — edit values, never the schema

The catalog (`groups`, `idols`, `events`, `venues`, `event_performers`, `event_stats`)
is produced and **owned by the `kspace Scraper` repo's data ecosystem**; its schema
lives in `kspace Scraper/supabase/migrations/` and nowhere else
(`../ECOSYSTEM.md`, `../designs/`, `../ROADMAP.md`). Admin's job is corrections, not
structure:

- **Allowed:** editing the value of an **existing, vetted column** on an existing row,
  through the PATCH routes under `src/app/api/admin/*/[id]/route.ts` — each keeps an
  explicit `ALLOWED_FIELDS` allowlist, and the allowlist is the contract. Read
  events through the `event_listings` view (`event_id` keys).
- **Never:** adding, renaming or deleting **columns or tables** on vetted tables;
  adding a migration to this repo; running DDL from a route, an RPC, or a raw-SQL
  call; widening an `ALLOWED_FIELDS` set to a column that is not a vetted scalar of
  that table (performers and venues are *links* — `event_performers` / `venues` —
  not fields of `events`); inserting or deleting catalog rows from Admin; writing to
  `scraped_events` (a read-only raw-payload archive) or any `*_legacy` table (gone).
- **A new field or entity the dashboard wants is a request, not an edit.** File it in
  `../MIGRATE_LATER.md` (catalog gaps) or the ecosystem's design queue
  (`../ROADMAP.md`); the ecosystem designs it, the scraper repo migrates it, and only
  then does Admin get a column to show or edit. Values that bypass that path are
  unprovenanced and corrupt the ecosystem — the whole point of the pipeline is that
  every catalog fact is vetted before it is canonical.
- No json/jsonb columns anywhere without Ben's explicit OK (root `CLAUDE.md`).

Why this holds at runtime: the Supabase client here talks PostgREST, which cannot
execute DDL, and there is no SQL-executing RPC in this project — so column/table
changes are physically impossible from Admin code. The rule above is about not
*building* such a path, and not editing around the allowlists.

## Working conventions

- `npm run lint` must be clean and `npm run build` green before pushing. Push to
  `main` (Railway deploys it) after each task.
- `admin_allowed_emails` gates sign-in; `user_roles` backs RLS `is_moderator()` —
  both app-owned, not catalog.
- The old scraper dashboards (`/scrapers`, `/review`) were retired 2026-08-26 with the
  legacy pipeline; do not rebuild them against `scraped_events`.
