/**
 * Record-and-restore for anything a live test writes (campaign admin-window,
 * admin-window/TASK-0003).
 *
 * Acceptance test 13 — "zero residue: the live suite sweeps what it wrote;
 * staging carries no campaign leftovers after the final run". The sweep runs
 * in a `finally`, so a failing assertion — the case that actually leaves
 * residue — still restores every row.
 *
 * In M1 the only writer is the edit-surface test
 * (admin-window/TASK-0017 / TASK-0018). This helper exists now so nobody
 * hand-rolls a second one: a sweep hand-copied per test is exactly how a
 * half-restored row survives a run.
 *
 * Shape of use:
 *
 *   await withSweep(independentClient(), async (sweep) => {
 *     await sweep.restore("events", { id }, ["title"]);   // BEFORE the write
 *     await patchTheEventThroughTheApp(id, { title: "probe" });
 *     expect(...);                                        // may fail; still swept
 *   });
 *
 * It writes through whatever client it is handed, which is why the offline
 * suite can drive it against the stub client and prove the `finally`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Equality filters identifying exactly one row (`{ id: 42 }`). */
export type RowMatch = Record<string, string | number | boolean>;

/** A restore failed; staging may carry residue and that must be loud. */
export class SweepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SweepError";
  }
}

type Undo =
  | { kind: "update"; table: string; match: RowMatch; values: Record<string, unknown> }
  | { kind: "delete"; table: string; match: RowMatch };

export interface Sweep {
  /**
   * Remember a row's CURRENT values for `columns`, to be put back on sweep.
   * Call it before the write it undoes.
   *
   * A row that does not exist yet degrades to a delete: the test is about to
   * create it, and the honest undo for a creation is removal, not an update
   * with nothing to restore.
   */
  restore(
    table: string,
    match: RowMatch,
    columns: readonly string[],
  ): Promise<void>;
  /** Remember that a row is new: the sweep deletes it. */
  remove(table: string, match: RowMatch): void;
  /** How many undos are recorded — a test can assert it did record one. */
  readonly pending: number;
  /**
   * Undo everything recorded, newest first, then forget it. Every undo is
   * attempted even if an earlier one failed; the failures are collected and
   * thrown together.
   */
  run(): Promise<void>;
}

function describe(table: string, match: RowMatch): string {
  const where = Object.entries(match)
    .map(([column, value]) => `${column}=${String(value)}`)
    .join(", ");
  return `${table} (${where})`;
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function createSweep(db: SupabaseClient): Sweep {
  const undos: Undo[] = [];

  return {
    get pending() {
      return undos.length;
    },

    async restore(table, match, columns) {
      if (columns.length === 0) {
        throw new SweepError(
          `sweep: nothing to record for ${describe(table, match)} — ` +
            `name the columns the test is about to change.`,
        );
      }
      const { data, error } = await db
        .from(table)
        .select(columns.join(","))
        .match(match)
        .maybeSingle();
      if (error !== null && error !== undefined) {
        throw new SweepError(
          `sweep: could not record ${describe(table, match)} before ` +
            `writing it: ${messageOf(error)}`,
        );
      }
      if (data === null || data === undefined) {
        undos.push({ kind: "delete", table, match });
        return;
      }
      const row = data as unknown as Record<string, unknown>;
      const values: Record<string, unknown> = {};
      for (const column of columns) values[column] = row[column] ?? null;
      undos.push({ kind: "update", table, match, values });
    },

    remove(table, match) {
      undos.push({ kind: "delete", table, match });
    },

    async run() {
      const failures: string[] = [];
      // Newest first: a later write may depend on an earlier one.
      while (undos.length > 0) {
        const undo = undos.pop() as Undo;
        try {
          const { error } =
            undo.kind === "update"
              ? await db.from(undo.table).update(undo.values).match(undo.match)
              : await db.from(undo.table).delete().match(undo.match);
          if (error !== null && error !== undefined) {
            failures.push(
              `${undo.kind} ${describe(undo.table, undo.match)}: ${messageOf(error)}`,
            );
          }
        } catch (thrown) {
          failures.push(
            `${undo.kind} ${describe(undo.table, undo.match)}: ${messageOf(thrown)}`,
          );
        }
      }
      if (failures.length > 0) {
        throw new SweepError(
          `sweep failed — staging may carry residue: ${failures.join("; ")}`,
        );
      }
    },
  };
}

const NOTHING_THREW = Symbol("nothing threw");

/**
 * Run `body` with a sweep, and sweep in a `finally`.
 *
 * The `finally` is the point: an assertion that fails mid-test is exactly the
 * case that leaves rows behind, and `body` never gets to choose.
 *
 * When both the body and the sweep fail, both are thrown together as an
 * `AggregateError` — a sweep failure means residue on staging and must never
 * be swallowed by the test failure that preceded it.
 */
export async function withSweep<T>(
  db: SupabaseClient,
  body: (sweep: Sweep) => Promise<T>,
): Promise<T> {
  const sweep = createSweep(db);
  let bodyFailure: unknown = NOTHING_THREW;
  try {
    return await body(sweep);
  } catch (thrown) {
    bodyFailure = thrown;
    throw thrown;
  } finally {
    const sweepFailure = await sweep.run().then(
      () => NOTHING_THREW,
      (error: unknown) => error,
    );
    if (sweepFailure !== NOTHING_THREW) {
      if (bodyFailure === NOTHING_THREW) throw sweepFailure;
      throw new AggregateError(
        [bodyFailure, sweepFailure],
        "the live test failed AND its sweep failed — staging may carry residue.",
      );
    }
  }
}
