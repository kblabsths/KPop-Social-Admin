import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import {
  HTTP_INCLUDE,
  LIVE_INCLUDE,
  OFFLINE_INCLUDE,
} from "./tests/suite-globs";

/**
 * Three projects, one per suite (admin-window/TASK-0001).
 *
 * Each project's include glob is rooted at its own directory, so the offline
 * project is structurally unable to collect a live or http test — see
 * `tests/offline/toolchain.test.ts`, which asserts that against the runner's
 * own file discovery.
 *
 * `tsconfigPaths()` gives every project the repo's `@/*` alias.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "offline",
          include: OFFLINE_INCLUDE,
          environment: "node",
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "live",
          include: LIVE_INCLUDE,
          environment: "node",
          testTimeout: 60_000,
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "http",
          include: HTTP_INCLUDE,
          environment: "node",
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
