import { instantOf } from "../cycles/state";

/**
 * **The app's ONE "newest first" ordering** — campaign admin-window/DEBT-0016,
 * ARCHITECTURE.md §11 ("contract vocabulary is the app's vocabulary, in code")
 * and §4 rule 17 (a pure function over rows belongs in the leaf layer,
 * wherever its first caller happened to live).
 *
 * The rule, stated once: **descending by an instant column**, a timestamp that
 * will not parse (or is absent) **last** rather than poisoning the comparison,
 * and the row's **key column descending** where two rows share an instant. The
 * order is therefore TOTAL, which is what makes a window the same window twice
 * running: two rows stamped on one instant cannot swap places between reloads.
 *
 * A row that cannot be read still RENDERS, at the end, where the unreadable
 * timestamp is visible instead of silently reordering the rows above it. The
 * input is never mutated.
 *
 * **Why callers re-apply an order the query already asked for.** Every caller's
 * query names this same order in its `.order()` clauses, so this sort normally
 * changes nothing — it is here because "newest first" is a stated property of
 * the surface and must not depend on a transport keeping its promise.
 *
 * **Why the columns are a parameter.** It was declared twice, over two column
 * pairs — `created_at`/`verdict_id` in `src/lib/db/verdict.ts` and
 * `started_at`/`run_id` in `src/lib/db/cycles.ts` — with the same body written
 * out twice and the same paragraph of prose above each (admin-window/DEBT-0010's
 * class; admin-window/DEBT-0016 closed it). The rule was never two rules: only
 * the two column names differed, and a rule that exists twice drifts, so the
 * columns are handed in and the rule is one exported thing.
 *
 * The instant is read through `instantOf` (`src/lib/cycles/state.ts`), the
 * app's one "epoch ms, or null when it will not parse" derivation — a leaf
 * importing a leaf (§4 rule 7 ¶2), so "unreadable" means one thing here and
 * everywhere else.
 */

/** The two columns an ordering reads: the instant, and the key that breaks a tie. */
export interface NewestFirstColumns<Instant extends string, Key extends string> {
  /** The timestamp column the order is BY. May be null or unparseable. */
  readonly instant: Instant;
  /** The total-order tie-break — a key column, descending. */
  readonly key: Key;
}

/**
 * `rows`, newest first by `columns.instant`, `columns.key` descending on a tie.
 *
 * Generic over the row: the constraint is the two columns it reads, never which
 * table they came from, so one comparator serves every window in the app and no
 * two of them can come to disagree about what "newest first" means.
 */
export function newestFirst<
  Instant extends string,
  Key extends string,
  Row extends Readonly<Record<Instant, string | null>> & Readonly<Record<Key, string>>,
>(rows: readonly Row[], columns: NewestFirstColumns<Instant, Key>): Row[] {
  const { instant, key } = columns;
  return [...rows].sort((a, b) => {
    const left = instantOf(a[instant]);
    const right = instantOf(b[instant]);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left;
    }
    return a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0;
  });
}
