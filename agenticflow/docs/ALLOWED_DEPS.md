# Allowed dependencies

Sole writer: the **toolsmith** (via DEP tickets). The supply-chain hook blocks
every install not listed here. Entry format, one per line:

`- <exact-name> (<version-range>) — <one-line purpose> [vetted <date>, DEP-XXXX]`

On an existing codebase the toolsmith's first invocation seeds this file from
the shipping dependency manifest(s), each entry marked `(grandfathered)`.
Manifest-driven managers are allowlisted by manager name: `cocoapods`,
`gradle`, `swift-pm`.

## Seeding note — brownfield intake, 2026-09-01

Seeded from `package.json` (the only dependency manifest in this repo), with
`package-lock.json` (lockfileVersion 3) consulted for the exact versions that
ship today. Every entry below is **`(grandfathered)`: recorded because it
already ships in production, not because it was vetted.** No web vetting,
identity check, or advisory review was performed on these — intake is
inventory, not endorsement.

Rules that follow from that:

* **NEW dependencies still go through a normal DEP ticket** — necessity,
  identity, health, behavior — before they appear here. Grandfathering is a
  one-time amnesty for what already shipped, not a standing policy.
* **A grandfathered entry never lowers the bar for its own upgrade.** Moving
  any package below to a new version (especially across a major) is a normal
  DEP ticket against the new version, because a future release's install
  script is unvetted code wearing a trusted name.
* Nothing here was replaced or removed at intake; the versions in parentheses
  are what the manifest declares, and the trailing `lock <x>` is what
  `package-lock.json` resolves today.

### Product shape, for the record

Next.js 16 / React 19 / Tailwind 4 app (App Router, TypeScript). The only two
runtime integrations are **`next-auth` v5 beta** (admin sign-in) and
**`@supabase/supabase-js`** (service-role reads/PATCH writes against the
shared Supabase project). Nothing else: no UI kit, no state library, no data
layer, no ORM, no test framework. Everything else in this file is build or
type tooling. That narrowness is a feature — treat any DEP proposing to widen
it as needing an argument, not just a use case.

Transitive-tree facts observed at intake (472 packages in the lockfile): only
two carry install scripts — `sharp` 0.34.5 (Next.js image optimization) and
`unrs-resolver` 1.11.1 (pulled in via eslint tooling). Both are transitives,
not direct deps; noted so a future appearance of a *third* install-script
package is visible as a change.

## npm

### runtime (`dependencies`)

- @supabase/supabase-js (^2.101.1) — (grandfathered) Supabase client; the app's only database access path, service-role server-side [lock 2.101.1, recorded 2026-09-01, brownfield intake]
- next (16.2.2) — (grandfathered) Next.js 16 application framework, App Router; exact-pinned in the manifest [lock 16.2.2, recorded 2026-09-01, brownfield intake]
- next-auth (^5.0.0-beta.30) — (grandfathered) admin sign-in / session handling, gated by `admin_allowed_emails` [lock 5.0.0-beta.30, recorded 2026-09-01, brownfield intake]
- react (19.2.4) — (grandfathered) React 19 runtime; exact-pinned in the manifest [lock 19.2.4, recorded 2026-09-01, brownfield intake]
- react-dom (19.2.4) — (grandfathered) React 19 DOM renderer; exact-pinned in the manifest [lock 19.2.4, recorded 2026-09-01, brownfield intake]

### build / type tooling (`devDependencies`)

- @tailwindcss/postcss (^4) — (grandfathered) Tailwind 4 PostCSS plugin, wired in `postcss.config.mjs` [lock 4.2.2, recorded 2026-09-01, brownfield intake]
- @types/node (^20) — (grandfathered) Node type definitions (engines require node >=20) [lock 20.19.37, recorded 2026-09-01, brownfield intake]
- @types/react (^19) — (grandfathered) React 19 type definitions [lock 19.2.14, recorded 2026-09-01, brownfield intake]
- @types/react-dom (^19) — (grandfathered) React DOM 19 type definitions [lock 19.2.3, recorded 2026-09-01, brownfield intake]
- cheerio (^1.2.0) — (grandfathered) HTML parsing; no import found anywhere in the repo — see re-vet candidates [lock 1.2.0, recorded 2026-09-01, brownfield intake]
- dotenv (^17.4.0) — (grandfathered) .env loading for scripts; no import found anywhere in the repo — see re-vet candidates [lock 17.4.0, recorded 2026-09-01, brownfield intake]
- eslint (^9) — (grandfathered) linter behind `npm run lint`, flat config in `eslint.config.mjs` [lock 9.39.4, recorded 2026-09-01, brownfield intake]
- eslint-config-next (16.2.2) — (grandfathered) Next.js ESLint ruleset, version-matched to `next` [lock 16.2.2, recorded 2026-09-01, brownfield intake]
- tailwindcss (^4) — (grandfathered) Tailwind 4 CSS engine [lock 4.2.2, recorded 2026-09-01, brownfield intake]
- typescript (^5) — (grandfathered) TypeScript compiler; `tsc --noEmit` is this repo's CI check [lock 5.9.3, recorded 2026-09-01, brownfield intake]
- vite-tsconfig-paths (^6.1.1) — vetted; resolves this repo's `@/*` tsconfig aliases inside Vitest runs; dev-only, 6.x line only [vetted 2026-09-01, DEP-0001]
- vitest (^3.2.7) — vetted; offline-first test runner, TypeScript/ESM native; dev-only, 3.x line only [vetted 2026-09-01, DEP-0001]

### DEP-0001 vetting notes — vitest + vite-tsconfig-paths, 2026-09-01

The first two **vetted** (not grandfathered) entries in this file. Both are
`devDependencies`, both were checked for necessity, identity, health and
behavior; the findings that constrain future work are recorded here.

* **Necessity.** `node:test` is stdlib but does not run TypeScript on the
  `node>=20` this repo declares, so it would need a loader plus alias
  wiring — more dependencies for the same result, not fewer. Vitest is one
  of the four runners Next.js documents itself. Accepted.
* **Identity.** `vitest` — registry package points at `vitest-dev/vitest`
  (17,037 stars, pushed 2026-09-01), maintainers include the Vite/Vue core
  set; ~99.9M downloads/week. `vite-tsconfig-paths` — points at
  `aleclarson/vite-tsconfig-paths` (1,632 stars, pushed 2026-08-28, MIT);
  ~30.5M downloads/week. Neither name is within typo distance of any entry
  above (checked with the supply gate's own parser), so no near-name marker
  is needed or proposed.
* **Advisories.** Both known critical Vitest advisories are patched inside
  the approved range: GHSA-9crc-q9x8-hgqq (patched 3.0.5) and
  GHSA-5xrq-8626-4rwp (patched 3.2.6). Both concern the Vitest UI/API
  server being reachable from a browser; `@vitest/ui` is not requested and
  must not be added without a new DEP. `vite-tsconfig-paths` and its deps
  (`tsconfck`, `globrex`) carry no advisories.
* **Version floors are the vetting.** `^3.2.7` sits above the 3.2.6
  security floor and excludes vitest 4.x/5.x. vitest 4 pulls a different
  transitive set (vite 8 / rolldown / `obug`) that was NOT vetted here —
  moving majors is a new DEP ticket, as is `vite-tsconfig-paths` 7.x
  (currently alpha, an oxc-resolver rewrite).
* **Install-script posture — a THIRD install-script package arrives.**
  Neither requested package has an install script, and neither does vite.
  But vitest 3.x depends on `vite ^5||^6||^7`, and vite 7.x depends on
  `esbuild`, whose npm package runs `postinstall: node install.js` to place
  a platform binary. So a clean install grows the intake count of
  install-script packages from two (`sharp`, `unrs-resolver`) to three.
  This is esbuild's long-standing, widely-audited binary-fetch step, not a
  finding against these two packages — but it is a real change to this
  repo's install-time execution surface and is stated here because the
  intake note made the count a tripwire. A fourth arrival is a new finding.
* **`debug` range spans a known-malicious version.** Both packages depend
  on `debug` with caret ranges that include `debug@4.4.2` — the version
  published from a hijacked maintainer account (GHSA-4x49-vf9v-38px,
  2025-09-15, patched 4.4.3). This repo's committed lockfile already
  resolves `debug` to 4.4.3, so a lockfile-faithful install dedupes to the
  patched version. Install these with the lockfile, verify `debug` did not
  move to 4.4.2 afterwards, and never resolve this tree with the lockfile
  deleted.
* **Residual risks, accepted and recorded.** `vite-tsconfig-paths` has a
  single npm maintainer (`aleclarson`) and version 6.1.1 ships without npm
  provenance (the project adds provenance only in its 7.0 alphas);
  `vitest@3.2.7` does carry an SLSA provenance attestation. The lockfile's
  `integrity` hash is the practical defense for the former. Also: vite 7.x
  declares `node ^20.19.0 || >=22.12.0` while this repo's `engines` says
  `node >=20.0.0` — a dev on node 20.0-20.18 will see an engine warning.
* **Not inspected.** The published tarballs were not unpacked: the supply
  gate correctly blocks archive downloads, and the toolsmith installs
  nothing. Evidence here is registry metadata, the GitHub repos and the
  advisory databases, not a read of the shipped bytes.
* **Scope.** Only these two names are approved. jsdom, @testing-library/*,
  @vitejs/plugin-react, @vitest/ui, Playwright and Cypress are explicitly
  out of scope for DEP-0001 and each needs its own ticket.

## Re-vet candidates (flagged at intake, not acted on)

Flagged on their face only — nothing here was removed, replaced, or
downgraded, and none of it blocks work. Each is a future DEP ticket.

1. **`cheerio` and `dotenv` are unused.** Neither name appears in any import
   or require outside `package.json` itself. Unused dependencies are pure
   attack surface: they ship no value and still execute during install and
   audit. Candidate for removal rather than vetting.
2. **Major-open ranges on tooling.** `@tailwindcss/postcss (^4)`,
   `@types/node (^20)`, `@types/react (^19)`, `@types/react-dom (^19)`,
   `eslint (^9)`, `tailwindcss (^4)`, `typescript (^5)` pin only a major. A
   clean-tree resolve can pull code no one has looked at under a trusted
   name. The lockfile is the real defense today; keep it committed and
   prefer lockfile-faithful installs.
3. **`next-auth` is a beta (`5.0.0-beta.30`).** Pre-release auth on the
   admin's sign-in path. Not a supply-chain finding, a stability one: worth a
   deliberate decision to track v5 betas or hold, rather than drift.
4. **`next` / `next-auth` and `eslint` / `eslint-config-next` are near-name
   pairs.** All four are legitimate and all four are recorded here, so no
   human-only near-ok marker is proposed or needed; noted so a future look
   does not mistake the resemblance for a finding.

No typosquat-shaped names were found at intake: every direct dependency is a
first-party or well-known package name matching its stated role, and no
one-character neighbor of a famous package appears in the manifest.

## Proposed for BLOCKED_DEPS.md (human-only file — toolsmith cannot add)

Recommendation only. These are the classic typosquat neighbors of what this
repo actually depends on; blocking them costs nothing and closes a fat-finger
path. The human adds them, or not:

* `nextauth` (no hyphen) — squat neighbor of `next-auth`
* `next-auth.js` — squat neighbor of `next-auth`
* `supabase-js` (unscoped) — squat neighbor of `@supabase/supabase-js`
* `tailwind` (unscoped, not `tailwindcss`) — squat neighbor of `tailwindcss`
* `react-dom.js` / `reactdom` — squat neighbors of `react-dom`

Added by DEP-0001 (2026-09-01), squat neighbors of the two new entries —
the first two exist on npm today as unrelated/stale packages, which is
exactly the fat-finger hazard:

* `vitest-tsconfig-paths` — exists on npm (unrelated, last published 2022);
  one keystroke from `vite-tsconfig-paths`
* `vite-test` — exists on npm (unrelated, last published 2021); a plausible
  mistyping of `vitest`
* `vite-tsconfig-path` (singular) — unregistered today; a prime future squat
* `vite-tsconfig` — name exists with no published version; squattable
