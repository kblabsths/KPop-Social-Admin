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
          // The staging guard (admin-window/TASK-0003). Registering it here is
          // what makes it unskippable: every live test file runs it first, and
          // a missing STAGING_ name fails the run before a test body executes.
          setupFiles: ["./tests/live/setup.ts"],
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
          // Every http test starts the built app on the ONE fixed
          // HTTP_TEST_PORT, so two files cannot run at once: the second
          // would find the port held and the harness would (correctly)
          // refuse to certify a server it did not start. One fork runs
          // this project's files one after another, which is what makes a
          // second http test file possible (admin-window/TASK-0017).
          // `fileParallelism` is a root-only option, so it cannot express
          // this for one project; `singleFork` can.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
