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
          // Budgets, not speed limits (admin-window/BUG-0029). Vitest's 5000ms
          // default was the whole defect: the slowest offline test measured
          // 3391ms cold-idle here and 4712ms warm on the box that filed the
          // bug — a margin small enough that a receipt worktree, which always
          // runs colder and under whatever else the machine is doing, flipped
          // the same tree between RED and GREEN. Under 2x CPU
          // oversubscription that same test measured 7647ms and failed.
          // With that test split per bucket, the slowest offline test measured
          // cold here is 2261ms (live-guard.test.ts, which spawns a child
          // vitest) and the heaviest cross-product slice is 1249ms, so 20s is
          // ~9x the worst cold measurement — and still >2x the 7647ms that a
          // 2x-oversubscribed machine produced before the split. It bounds a
          // hang; it does not police speed.
          testTimeout: 20_000,
          // Hooks here shell out to real compilers — `tsc --listFilesOnly`
          // (~1.2s idle) and two `vitest list` startups — which the 10s
          // default does not comfortably cover on a loaded machine.
          hookTimeout: 60_000,
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
