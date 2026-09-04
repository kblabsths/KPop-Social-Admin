/**
 * The ONE walker over the source tree, shared by every offline test that
 * asserts a structural rule about it (admin-window/BUG-0032).
 *
 * Four test files carried four hand-copied copies of this walk
 * (`claims/read.test.ts`, `browse/views.test.ts`, `edit/config.test.ts`,
 * `review/one-place.test.ts`) and a fifth lived in `db/layering.test.ts`.
 * Two of them had been hardened against the hazard below and two had not, so
 * the suite reddened on the interleaving of two workers rather than on the
 * code. Copies drift; there is one copy now.
 *
 * ## The hazard
 *
 * `tests/offline/db/layering.test.ts` proves its own credential scanner by
 * WRITING a probe into the source tree and deleting it again, around each of
 * its ~20 `scanWithProbe()` calls — and vitest runs test files in parallel
 * workers against that one shared tree. So any walk of it may:
 *
 *   - LIST a path that is gone by the time it is read (`readFileSync` ENOENT);
 *   - descend into a directory that is gone by the time it is listed
 *     (`readdirSync` ENOENT — the probe now lives in a whole directory that
 *     comes and goes, which is what admin-window/BUG-0029 turned a transient
 *     file into);
 *   - SEE the probe and report it as a violation of whatever rule it asserts.
 *
 * ## The two answers, and why both are needed
 *
 * `sourceFiles()` skips what no compiler compiles — a path segment beginning
 * with `.` (TypeScript's include globbing skips dot-directories, which is what
 * hides the probe from `tsc`, `next build` and ESLint) and a name beginning
 * with a double underscore (the probe-naming convention). Nothing real is
 * hidden: no file or directory in the tree is named either way, and
 * `toolchain.test.ts` pins that. A rule asserted over `sourceFiles()`
 * therefore reads exactly the tree the compilers read.
 *
 * `allSourceFiles()` hides nothing, because `layering.test.ts`'s whole point
 * is that its probe IS reached by the scanner it is proving.
 *
 * Both are tolerant of a path vanishing mid-walk, and so is `sourceText()`.
 * A skip only ever happens for a path that no longer exists, which is by
 * definition not part of the tree under test.
 */
import fs from "node:fs";
import path from "node:path";

/** The repo root, resolved from this file (two levels up from tests/offline). */
export const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** The directory every rule below is asserted over, relative to a base. */
export const SOURCE_DIR = "src";

/** Source extensions the structural rules are asserted over. */
const SOURCE = /\.(ts|tsx|mts)$/;

/**
 * True for a name a compiler never compiles and a probe always uses.
 *
 * Both prefixes matter for directories as well as files: the probe now lives
 * two levels down, in a dot-directory, under a double-underscore file name.
 */
function isHidden(name: string): boolean {
  return name.startsWith(".") || name.startsWith("__");
}

/**
 * Errors that mean "this path changed underneath the walk", and nothing else.
 * ENOENT is the observed shape; ENOTDIR and EISDIR are the same event seen
 * when a path is replaced by one of the other type rather than removed. Any
 * other error still throws — a permission problem is a real failure.
 */
function isTransient(thrown: unknown, codes: string[]): boolean {
  const code = (thrown as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && codes.includes(code);
}

function listing(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (thrown) {
    if (isTransient(thrown, ["ENOENT", "ENOTDIR"])) return [];
    throw thrown;
  }
}

function walk(dir: string, base: string, keep: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of listing(dir)) {
    if (!keep(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, base, keep));
    // Deliberately NOT `entry.isFile()`: a dirent for a symlink reports
    // neither file nor directory, and a symlink whose target is gone is one
    // of the shapes this walk has to survive rather than silently drop. It is
    // listed like any other candidate and reads as empty.
    else if (SOURCE.test(entry.name)) {
      found.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return found;
}

/**
 * Every TypeScript source file under `<base>/src`, as base-relative posix
 * paths, sorted — skipping dot- and double-underscore-prefixed names, and
 * surviving a path that vanishes mid-walk. This is what a structural rule
 * asserts over.
 */
export function sourceFiles(base: string = repoRoot): string[] {
  return walk(path.join(base, SOURCE_DIR), base, (name) => !isHidden(name)).sort();
}

/**
 * The same walk with NO name filter — for `db/layering.test.ts`, whose probe
 * must be reached. Still tolerant of a vanished path.
 */
export function allSourceFiles(base: string = repoRoot): string[] {
  return walk(path.join(base, SOURCE_DIR), base, () => true).sort();
}

/**
 * A source file's RAW text — comments included, because some rules
 * (`browse/views.test.ts`) must see what a comment could otherwise hide.
 * A file that vanished between the listing and the read reads as empty.
 */
export function sourceText(file: string, base: string = repoRoot): string {
  try {
    return fs.readFileSync(path.join(base, file), "utf8");
  } catch (thrown) {
    if (isTransient(thrown, ["ENOENT", "EISDIR"])) return "";
    throw thrown;
  }
}

/**
 * The lines of a file that are code, not commentary, so a doc comment naming a
 * table or a function stays documentation and only a real occurrence is a
 * defect.
 */
export function codeLines(file: string, base: string = repoRoot): string[] {
  return sourceText(file, base)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    });
}

/**
 * A file's code lines rejoined, newlines kept, so a pattern may span lines —
 * multi-line spellings are ordinary formatted code and a one-line-at-a-time
 * scan is blind to them (admin-window/BUG-0005).
 */
export function codeText(file: string, base: string = repoRoot): string {
  return codeLines(file, base).join("\n");
}

/**
 * Every place a source file leans on JSX to keep a space between a closing tag
 * and the next word — `</span> dial lives only` — instead of writing the space
 * as `{" "}` (campaign admin-window/BUG-0045).
 *
 * **Why this is a source rule and not only a markup one.** Whether that space
 * survives depends on the JSX transform, and the two transforms this repo runs
 * disagree. Measured 2026-09-03 on the delivered HTML of a `next build` served
 * on :8781: `<span …>source</span> is the run’s` arrived as `source</span>is`,
 * and the same file rendered through vitest's transform by
 * `renderToStaticMarkup` kept the space. So the offline suite CANNOT see this
 * defect in markup, and the walker who read `sourceis` off the screen was
 * right while the file looked innocent. `{" "}` is an expression container; no
 * transform may drop it.
 *
 * Only a LETTER or DIGIT counts as the next word: `</span>,` and `</span>.`
 * are correct typography, and a space before punctuation would be a defect of
 * its own.
 *
 * Each hit is returned as `line: text` so a failure names the site.
 */
export function implicitInterElementSpaces(
  file: string,
  base: string = repoRoot,
): string[] {
  return implicitInterElementSpacesIn(sourceText(file, base));
}

/**
 * The rule itself, over TEXT — so a test can prove the scanner flags the
 * spelling it exists for without writing a probe file into the tree that other
 * tree-walking tests are reading (admin-window/BUG-0029's hazard, above).
 */
export function implicitInterElementSpacesIn(text: string): string[] {
  return text
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      // A doc comment may quote the defect while documenting it; only code is
      // a site. Real line numbers are kept, which `codeText` cannot do.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        return false;
      }
      return /<\/(?:span|a|b|em|strong|code)> +[A-Za-z0-9]/.test(line);
    })
    .map(({ line, number }) => `${number}: ${line.trim()}`);
}
