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
    // The same hazard one directory over, and the one that was measured:
    // `tests/offline/db/layering.test.ts` proves its leaf-import guard with a
    // `require()` fixture written under `src/.probes/`, and a run KILLED in
    // that loop leaves the file behind. The area is gitignored, so nothing in
    // `git status` or in the suite pointed at the file that made `npm run
    // lint` exit 1 in that checkout — forever, since no run sweeps the shared
    // parent. Probes are not product source: nothing under this area is
    // compiled by `tsc` (a dot segment is outside the include glob) or shipped
    // by `next build` either. admin-window/BUG-0188
    "src/.probes/**",
  ]),
]);

export default eslintConfig;
