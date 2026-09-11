/**
 * The probe areas — who may write in them, how a run names its own directory
 * in one, and who cleans up after a run that never got to
 * (admin-window/BUG-0188, admin-window/BUG-0190).
 *
 * There are TWO of them and they hold the same two rules:
 *
 *   - `src/.probes` (`PROBE_PARENT`) — a probe written into the REAL source
 *     tree, because the credential and leaf-import scanners are proved by
 *     reaching it where they really walk;
 *   - `tests/.probes` (`MIRROR_PARENT`) — a whole MIRROR TREE a self-guard
 *     walks instead of the real `src/`, so a probe deleted between a parallel
 *     suite's readdir and its read cannot redden a stranger's lane
 *     (admin-window/BUG-0020).
 *
 * Shared by every suite that plants in either — `tests/offline/db/layering.test.ts`,
 * `tests/isolated/probe-race.isolated.test.ts`, `tests/offline/review/one-place.test.ts`,
 * `tests/offline/edit/config.test.ts`, `tests/offline/records/entity-picker.test.ts` —
 * because the naming rule and the sweep rule below are one rule each and a
 * second hand-typed copy of either would drift (LESSONS 5). Two files still
 * spell a mirror base by hand (`tests/offline/toolchain.test.ts`,
 * `tests/offline/ui/copy.test.ts`); both already carry per-run entropy, so
 * neither is exposed to the defect below, and the sweep is area-wide, so their
 * corpses go too — but a third copy of the idiom belongs here, not there.
 *
 * ## What went wrong before this module existed
 *
 * admin-window/DEBT-0018 gave each run its own directory under the shared
 * parent, named from `process.pid` ALONE, and made each run's `finally` remove
 * only THAT directory — the shared parent is deliberately never removed,
 * because removing it races a concurrent run's `mkdirSync`. That fixed two
 * live runs colliding and opened two things on a run that DIED:
 *
 *   1. pids are recycled, so a later run whose worker fork drew the dead run's
 *      number computed the same directory, did not see it as foreign, and
 *      GRADED it — and a probe holds `process.env.SUPABASE_SERVICE_ROLE_KEY`
 *      on purpose, so the credential rule reported a violation in a lane that
 *      planted nothing;
 *   2. nothing ever removed the corpse — each `finally` removes one directory
 *      and the parent that a run used to sweep is now untouchable — so a
 *      `require()` fixture left by a run killed mid-loop reddened `npm run
 *      lint` in that checkout forever, invisibly (the area is gitignored).
 *
 * ## The two answers here
 *
 * `probeDirFor()` puts ENTROPY in the name as well as the pid, the idiom
 * `tests/offline/toolchain.test.ts` already uses — so no dead run's directory
 * can ever be a live run's own, whatever pid the live run draws.
 *
 * `sweepDeadProbeDirs()` removes a directory whose pid segment names no live
 * process. That is the narrowest rule that ends (2) while keeping every
 * DEBT-0018 guarantee: a LIVE run's directory is never touched (its pid
 * answers `process.kill(pid, 0)`), the shared PARENT is never removed, and a
 * name this module did not write is left alone.
 *
 * ## The same defect, one directory over (admin-window/BUG-0190)
 *
 * The mirror trees under `tests/.probes/` were named from `process.pid` ALONE
 * and removed only in each case's `finally`, exactly as `src/.probes` was
 * before BUG-0188, and the consequence was measured: a run that drew a killed
 * run's pid walked the corpse's files as its own mirror, and every self-guard
 * there compares the walk with `toEqual`, so three unrelated suites
 * (review/one-place, edit/config, records/entity-picker) went red in a lane
 * that planted nothing. Both areas now take both answers from this module,
 * parameterised by the parent rather than copied.
 *
 * The residue it deliberately does not chase: a corpse whose pid has since
 * been reused by some unrelated live process survives until that process
 * exits. It is harmless — it is foreign to every run's scan by the entropy
 * rule, and `eslint.config.mjs` ignores the whole area — and the alternative
 * (sweeping on age) is a rule that can delete a live run's probe.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./offline/source-tree";

export { repoRoot };

/**
 * The dot-hidden area beneath `src/` that every probe is planted in —
 * gitignored (`.gitignore`), ignored by ESLint (`eslint.config.mjs`), and
 * skipped by TypeScript's include globbing because a path segment starts with
 * `.`. It holds probes and nothing else, and no run ever removes it.
 */
export const PROBE_PARENT = "src/.probes";

/**
 * The dot-hidden area beneath `tests/` that every MIRROR TREE is planted in —
 * gitignored (`.gitignore`) and ignored by ESLint (`eslint.config.mjs`) for
 * the same reasons, and outside `src/` entirely, so no rule's walk over the
 * real source tree can ever reach into it.
 *
 * A guard proving itself plants a whole fake `src/` beneath its directory here
 * and walks THAT, so its scan sees the mirror and nothing else.
 */
export const MIRROR_PARENT = "tests/.probes";

/**
 * This PROCESS's run id: the entropy that makes a directory name unforgeable
 * by a run that is no longer alive.
 *
 * One per module instantiation, which is one per vitest worker process — the
 * same granularity as `process.pid`, which is what it is paired with.
 */
export const RUN_ID = randomUUID();

/**
 * A label may not contain a digit: `pidOfProbeDir()` reads the pid as the
 * first all-digit segment of the name, so a label like `probe2` would hand the
 * sweep the wrong number and could make it delete a live run's directory.
 */
const LABELLED = /^[a-z][a-z-]*[a-z]$/;

/**
 * THIS run's probe directory for one guard, as a repo-relative posix path:
 * `<parent>/<label>-<pid>-<run id>`.
 *
 * The pid is kept in the name because it is what makes the sweep possible; the
 * run id is what makes the name this run's own. `parent` is either probe area
 * — the naming rule is the same rule in both, which is why there is one
 * function rather than a second copy of it (admin-window/BUG-0190).
 */
export function probeDirFor(label: string, parent: string = PROBE_PARENT): string {
  if (!LABELLED.test(label)) {
    throw new Error(`probe label must be lowercase letters and hyphens, with no digit: ${label}`);
  }
  return `${parent}/${label}-${process.pid}-${RUN_ID}`;
}

/**
 * THIS run's MIRROR TREE base for one guard, as an ABSOLUTE path under
 * `tests/.probes/` — the base a self-guard hands to `sourceFiles(base)` and
 * friends, which is why this one is absolute where `probeDirFor` is
 * repo-relative (a rule's own scan reports paths relative to the base).
 *
 * The whole point of the entropy is that no dead run can have written here:
 * before admin-window/BUG-0190 these bases were `<label>-<pid>` and a run
 * drawing a killed run's pid adopted its corpse as its own mirror.
 */
export function mirrorDirFor(label: string): string {
  return path.join(repoRoot, probeDirFor(label, MIRROR_PARENT));
}

/**
 * The pid a probe directory's name carries — its first all-digit segment — or
 * null for a name that carries none, which means this module did not write it
 * and the sweep must leave it alone.
 */
export function pidOfProbeDir(name: string): number | null {
  for (const segment of name.split("-")) {
    if (!/^\d+$/.test(segment)) continue;
    const pid = Number(segment);
    // pid 0 is the caller's whole process GROUP to `process.kill`, never a
    // process this suite forked; anything unparseable as a real pid is not a
    // name this module wrote.
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }
  return null;
}

/**
 * Whether a process with this pid exists. Signal 0 checks for the process
 * without delivering anything.
 *
 * Only `ESRCH` — no such process — counts as dead. `EPERM` means the process
 * is there and owned by someone else, and any other failure is a question this
 * janitor cannot answer, so both are reported as ALIVE: the sweep must never
 * remove a directory it is unsure about.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (thrown) {
    return (thrown as NodeJS.ErrnoException | null)?.code !== "ESRCH";
  }
}

/**
 * Remove every probe directory under the shared parent whose pid names no live
 * process, and hand back the names removed (sorted).
 *
 * Never removes the parent itself, never removes a directory whose pid is
 * alive, and never removes a name it cannot read a pid out of. Best effort by
 * design: a removal that loses a race with another run's sweep, or that the
 * filesystem refuses, is skipped rather than thrown — a janitor that reddens a
 * lane would be worse than the litter it is clearing.
 *
 * `base` is the checkout to sweep, for the same reason the source-tree walkers
 * take one: so this rule can be proved on a fixture tree rather than on the
 * shared one every concurrent run is writing to. `area` is which probe area of
 * that checkout to sweep — the rule is identical in both, so there is one
 * implementation (admin-window/BUG-0190).
 */
export function sweepDeadProbeDirs(
  base: string = repoRoot,
  area: string = PROBE_PARENT,
): string[] {
  const parent = path.join(base, area);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch (thrown) {
    const code = (thrown as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw thrown;
  }
  const swept: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pid = pidOfProbeDir(entry.name);
    if (pid === null || isProcessAlive(pid)) continue;
    try {
      fs.rmSync(path.join(parent, entry.name), { force: true, recursive: true });
      swept.push(entry.name);
    } catch {
      // Another run's sweep got there first, or the filesystem refused. The
      // next run tries again.
    }
  }
  return swept.sort();
}

/**
 * The same sweep over the MIRROR area (`tests/.probes/`): remove every mirror
 * tree whose pid names no live process (admin-window/BUG-0190).
 *
 * Called once at module scope by each suite that plants a mirror there, the
 * same way `sweepDeadProbeDirs()` is called by each suite that plants under
 * `src/.probes/` — explicitly, so nothing depends on an import's side effect.
 * Every guarantee is the one above's: a live run's mirror is never touched,
 * the shared parent is never removed, and a name this module did not write is
 * left alone.
 */
export function sweepDeadMirrorDirs(base: string = repoRoot): string[] {
  return sweepDeadProbeDirs(base, MIRROR_PARENT);
}
