# contracts/ — frozen snapshots for the Admin observability campaign

Copied 2026-09-01 for the Admin observability build. **NO AGENT EDITS THESE
FILES.** They are snapshots of the living designs in `../../designs/` (and
`../../builds/`, `../../ECOSYSTEM.md`); a flaw, gap, or contradiction found
here is a blocked ticket for Ben, who amends the living design — a revised
snapshot is copied in if the change matters to this build.

- `admin-observability.md` — **the spec**: what this campaign builds,
  approved in full 2026-09-01. Its two parked bottom sections are explicitly
  not built.
- `admin-build.md` — **the acceptance doc** (approved 2026-09-01): ground
  rules that bind every ticket, the tests that must pass, the artifacts
  reviewed after.
- `resolver.md` — reference: the tables and views this app renders
  (`resolution_runs`, `review_items`, the classification view), the weighing
  outcomes, `apply_resolution`, rejection stamps. The resolver campaign is
  building it; schema truth is `../../kspace Scraper/supabase/migrations/`.
- `data-model.md` — reference: observations, the gate, `field_provenance`,
  the registry formats, sources state.
- `entity-linking.md` — reference: the matcher cascade and the
  confirmed-match store a link verdict writes into.
- `ECOSYSTEM.md` — the parent design; §8 is this campaign's contract
  ancestry.
