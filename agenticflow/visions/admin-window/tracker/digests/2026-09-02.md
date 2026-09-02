# Digest 2026-09-02

## Key items
- **Where the app stands vs the vision:** nothing user-visible is shipped yet. Campaign `admin-window` (branch `run/admin-window`) is in M1, the zero-schema read slice: the toolchain (Vitest, offline/live/http suites, lint green), the data layer (`DbResult`, the credential seam, table constants, fixtures) and the design tokens + UI primitives have landed and passed QA; the deprecated app is still standing until TASK-0005 removes it and stands up the six-route shell. INTENTIONALLY ABSENT from this build: every page (Dashboard, Queues, Claims, Sources, Cycles & runs, Browse) and the edit surface — all M1, queued behind the shell; the verdict slice (settle button, overrides for events/venues, the two handoff migrations) is M2; the live end-to-end proof of the §7 actions (acceptance tests 6–8) is a deferred patch run after you install the migrations, per your intake answer.
- **Decisions you made at intake:** staging is provisioned and you add the `STAGING_SUPABASE_*` names; the campaign is satisfied when the verdict UI is built and both handoffs are authored (live proof later). Vision frozen 2026-09-01.
- **Blocked on you (five ASK BEN tickets, on the Waiting-on-you panel):** TASK-0021 (P0) which env names the app reads at runtime vs the live tests, plus a `## supabase` entry in SERVICES.md and how parity SQL reaches staging; TASK-0022 (P0) what is installed on staging and whether live tests may write/sweep fixture rows in resolver-owned tables; TASK-0023 which of the adapter `runs` table's columns Cycles shows; TASK-0024 where Admin reads the per-source stuck-pattern dial that lives only in scraper YAML; TASK-0025 what the edit surface shows for provenance on groups/idols, which have none. None blocks the foundation; TASK-0021/0022 gate the live harness (TASK-0003) and every parity test.
- **Still needed from you for any live read:** `.env` carries `SUPABASE_URL` + `SUPABASE_ANON_KEY` only. The anon role sees none of the ecosystem tables. Add `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` (the service_role key from Supabase → Project Settings → API).
- **Palette ruling in progress:** QA measured that LOOK_AND_FEEL's light palette fails its own 4.5:1 contrast bar on four jobs (`attention` amber is 3.20:1 on white). The designer is amending the doc now; a token-change BUG follows if the palette moves.
- **Scraper repo:** a campaign is running there, so every scraper-side change is a handoff for the whole of M1. Expected scraper-side commits: zero. None made.
- **Dark mode** stays unless you say "light-only" (panel note).
- Toolsmith flags, no action taken: `cheerio` and `dotenv` are unused dependencies (removal candidates); `next-auth` is a pre-release on the sign-in path.

## Verify it yourself
- [ ] `cd "kspace Admin" && git checkout run/admin-window && npm ci && npm run lint && npm test` — lint exits 0, offline suite green with no STAGING names set (TASK-0001)
- [ ] `npm run test:http` — builds the app, serves it on 8772, asserts `/api/health` 200 and `/` → `/login`, refuses if another process holds the port (TASK-0001, BUG-0002)
- [ ] `./node_modules/.bin/vitest run tests/offline/db` — the not-provisioned classification and the never-throws reads (TASK-0002)
- [ ] `grep -c "@theme" src/app/globals.css` — 1; the token layer and primitives under `src/components/ui` (TASK-0004)

## Everything else
- attention UI: http://127.0.0.1:8770/
- rail telemetry: watchdog releases 0; blocked ages: five ASK tickets since 2026-09-02 05:40Z; compactions 0; budget: M1 of max 6 milestones, 0 shipped
- spawn economy (output tokens by role, run to date): architect 54.7k (1 spawn), builder 52.5k (7), qa-adversary 23.5k (6), visionary 8.0k (1), toolsmith 6.9k (2), designer 4.5k (1)
- counts: opened — 8 FEAT, 25 TASK, 1 DEP, 5 BUG; closed done — TASK-0001, TASK-0002 (rebuild in flight), TASK-0004, DEP-0001, BUG-0001 (no change: stale primary node_modules), BUG-0002, BUG-0003; open BUGs — BUG-0004 (absence renders three ways, P2, pinned), BUG-0005 (credential guard misses destructured/optional-chained reads, P2, pinned); bounces: TASK-0001 ×1, TASK-0002 ×1
- CI: green at the last three checks; the first red (BUG-0001) was the primary checkout's stale install, not code
- evidence: receipts under `agenticflow/tracker/receipts/` for every closed ticket; contrast ratios quoted in TASK-0004's History
- kit note: `vision.py new` refused the fresh-install `.gitkeep` files as "non-empty" tracker dirs; migrated by hand (moved into the campaign folder) and activation re-run — a curator candidate
