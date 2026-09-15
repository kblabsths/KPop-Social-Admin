/**
 * The single source of truth for which files belong to which test project.
 *
 * Imported by `vitest.config.mts` (so the runner's discovery is defined by
 * these constants and nothing else) and by `tests/offline/toolchain.test.ts`
 * (so the offline/live/http partition is asserted rather than assumed).
 *
 * Contract for every later ticket in campaign admin-window:
 *   offline  tests/offline/**\/*.test.ts        npm test          (default, no network)
 *   live     tests/live/**\/*.live.test.ts      npm run test:live (staging)
 *   http     tests/http/**\/*.http.test.ts      npm run test:http (builds first)
 *   isolated tests/isolated/**\/*.isolated.test.ts        (see below)
 *   handoff  tests/handoff/**\/*.test.ts        npm run test:handoff (see below)
 *
 * The `handoff` project (admin-window/TASK-0080, ARCHITECTURE.md §10's rule of
 * 2026-09-12) is the other odd one, and the cut that puts a file in it is INPUT
 * OWNERSHIP rather than subject: its cases READ the sibling checkout
 * `kspace Scraper`, a repo this one does not own, so a legitimate edit next
 * door can turn them red while nothing here is wrong — which happened four
 * times in one campaign, twice at the moment this campaign's own handoff
 * LANDED next door. It is therefore NOT in `npm test`, and so not in
 * `ci_command` either: a red there is a cross-repo finding to route, never a
 * bar a builder in this repo must clear before pushing. The verifier runs it at
 * a milestone close, and so does whoever prepares or re-checks a handoff.
 * Every guard over OUR OWN handoff artifact — block balance, dollar quoting,
 * `ALTER TABLE` targets, forbidden constructs, ACL math, the code→meaning
 * declarations this campaign allocates — stays in the offline project, where
 * every builder runs it.
 *
 * The `isolated` project (admin-window/BUG-0032) is the odd one: its tests
 * MUTATE the shared source tree on purpose, to pin that a walk of it survives
 * a path appearing and vanishing mid-walk. A test that does that cannot run
 * beside the offline project, whose files walk the same tree in parallel
 * workers — an earlier in-tree attempt at this pin turned a sub-1-in-37 flake
 * into a 1-in-5 one. So `npm test` runs it as a SEPARATE, SEQUENTIAL vitest
 * invocation after the offline one, and `tests/offline/toolchain.test.ts`
 * asserts that no single invocation carries both.
 */

/** Directory root of each project, relative to the repo root. */
export const OFFLINE_ROOT = "tests/offline";
export const LIVE_ROOT = "tests/live";
export const HTTP_ROOT = "tests/http";
export const ISOLATED_ROOT = "tests/isolated";
export const HANDOFF_ROOT = "tests/handoff";

/** Include globs, relative to the repo root. Rooted at their own directory. */
export const OFFLINE_INCLUDE = [`${OFFLINE_ROOT}/**/*.test.ts`];
export const LIVE_INCLUDE = [`${LIVE_ROOT}/**/*.live.test.ts`];
export const HTTP_INCLUDE = [`${HTTP_ROOT}/**/*.http.test.ts`];
export const ISOLATED_INCLUDE = [`${ISOLATED_ROOT}/**/*.isolated.test.ts`];
export const HANDOFF_INCLUDE = [`${HANDOFF_ROOT}/**/*.test.ts`];

/** The port the built app is served on by the http project. */
export const HTTP_TEST_PORT = 8772;
