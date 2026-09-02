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
 */

/** Directory root of each project, relative to the repo root. */
export const OFFLINE_ROOT = "tests/offline";
export const LIVE_ROOT = "tests/live";
export const HTTP_ROOT = "tests/http";

/** Include globs, relative to the repo root. Rooted at their own directory. */
export const OFFLINE_INCLUDE = [`${OFFLINE_ROOT}/**/*.test.ts`];
export const LIVE_INCLUDE = [`${LIVE_ROOT}/**/*.live.test.ts`];
export const HTTP_INCLUDE = [`${HTTP_ROOT}/**/*.http.test.ts`];

/** The port the built app is served on by the http project. */
export const HTTP_TEST_PORT = 8772;
