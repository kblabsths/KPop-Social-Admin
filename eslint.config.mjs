import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The factory kit ships a Python venv with bundled JS (Playwright's
    // driver); it is tooling, not product source. admin-window/TASK-0001
    "agenticflow/**",
    // Guard fixtures: the offline suites plant mirror source trees here and
    // remove them in a `finally`, so nothing should normally exist to lint —
    // but a run killed mid-test leaks one, and some fixtures are deliberately
    // unparseable (a template literal with no closer), which would fail lint
    // for a file that is not product source. admin-window/BUG-0030
    "tests/.probes/**",
  ]),
]);

export default eslintConfig;
