# Vision — the Admin window (campaign `admin-window`)

Derived from the human's contract snapshots in `contracts/` (read 2026-09-01):
`admin-observability.md` (the spec, approved in full 2026-09-01) and
`admin-build.md` (the acceptance doc, approved 2026-09-01). Those two documents
are the authority; this page is the campaign's north star, not a rival spec.
A gap or contradiction in the contracts is a blocked question for Ben, never
a judgment call made here or downstream.

## What it is

The Admin app rebuilt wholesale as the data ecosystem's window: the one place
its operator sees what the pipeline did, what needs a human, and who keeps
being wrong — and settles the questions only a human can settle. Rendered
surfaces, never a SQL prompt; every action enters through a recorded pathway,
so every change is attributed and later learnable.

## Who it's for

Ben, the ecosystem's operator, at breakfast: did anything happen last night,
what needs me, who keeps being wrong. Anyone else on the admin allowlist is the
same person with the same vocabulary — the app assumes a fluent operator, not
a newcomer.

## What success looks like (from the operator's chair)

- **The read slice.** Six pages — Dashboard, Queues, Claims, Sources, Cycles &
  runs, Browse (v1 view: recent events) — each showing real staging rows whose
  numbers match what the database says, with the six threshold gauges each
  answering its knob's question. An investigation never leaves the app: item
  → its claims → its source and provenance → the event → its edit surface.
  Against a database that lacks the ecosystem tables, every page says so
  honestly and nothing crashes.
- **The edit surface** driven by one hand-written map of what is editable:
  groups/idols edit directly within it; events/venues edit only as recorded
  overrides that the pipeline can see and protect; a reference field links
  rows, never text; provenance is visible at the field.
- **The verdict slice.** Every spec §7 action settles a review item in one
  transaction, and every settlement and override lands as one row in the
  verdict log. The two schema pieces are authored complete as handoff
  artifacts for Ben to install from the scraper repo after the resolver
  campaign closes. The campaign is satisfied when the verdict UI is built
  and both handoffs are complete and reviewed; the live end-to-end proof of
  the §7 actions on staging (acceptance tests 6–8) runs as a patch run after
  Ben installs them — it is the one acceptance item deliberately deferred.
- **The old app is gone.** No deprecated surface survives; the sign-in gate,
  the server-side privilege, and the deploy carry over untouched, and every
  push stays deployable.
- Acceptance is the thirteen tests in `contracts/admin-build.md`, all green.

## Non-goals (what this campaign must not touch)

- **Production is never a target.** Only the staging project, by name; the
  deployed service is never repointed; no secret value ever appears anywhere.
- **No schema beyond the two handoff pieces.** No new canonical columns, no
  json columns, no schema change from Admin code, no migration in this repo.
- **The scraper repo is reference, written only by size**: minor + necessary
  + reversible edits are noted commits; everything else — every migration,
  anything touching gate or resolver behavior, anything while a campaign runs
  there — is a handoff for Ben. Unsure means major. Workaround code here to
  dodge an edit there is forbidden.
- **The parked sections stay parked**: no operator, no free-form tickets, no
  recommendations / incidents / agent runs / commands, no registry mirror, no
  severity formula, no AI calls. The empty corroboration bucket is not
  rendered.
- **Nothing outside the app**: the mobile app, the scrapers, the pipeline's
  cadence and rules, and the app-user social data are untouched. The old
  Analytics view of app users is not carried over.
