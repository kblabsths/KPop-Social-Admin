/**
 * What a cycle row IS, and the ONE word each state is called by.
 *
 * A PURE LEAF (ARCHITECTURE.md §4 rule 7): it holds the vocabulary, the row
 * interface it reasons about and pure functions over rows, and it imports
 * nothing that can reach a database — not `lib/db/**`, not the client, not
 * `process.env`. `lib/db/cycles.ts` and `lib/gauges/cycle-health.ts` import
 * THIS; it imports neither of them back, not a value and not a type.
 *
 * **Two surfaces render `resolution_runs` rows** — the Cycles & runs page
 * (its table and its cycle-health panel) and the Dashboard's "last night's
 * cycles" — and they take the state from `cycleState` here and the word from
 * `STATE_WORD` here. Neither decides for itself what a row is, so neither can
 * come to call one row two things:
 *
 *  - admin-window/BUG-0055 is why the WORD is shared: /cycles' rows said
 *    `died` where its own health panel said `unfinished`, over the same four
 *    cycles on the same screen.
 *  - admin-window/BUG-0074 is why the STATE is: the Dashboard classified a
 *    cycle by `ended_at` alone, so a cycle that died in March read there as
 *    "still running" while /cycles called the identical row `died`.
 *
 * The requirement itself is the producer's. Scraper migration
 * `20260901000001` states it in its own header — "three states a reader must
 * tell apart at a glance … a cycle still running, a cycle that finished with
 * its verdict, and a cycle that died - the last keeps a null `ended_at`
 * forever and nothing rewrites it, so a null older than one cadence is how a
 * crash stays visible".
 */

/**
 * The three columns a cycle's state is decided from.
 *
 * Declared HERE and structurally, rather than imported from `lib/db/**`: a
 * leaf never imports the data layer back, and a type-only import would still
 * write the cycle into the contract. Every caller's row satisfies it
 * structurally — `ResolutionRunRow` (`lib/db/gauges.ts`), the Dashboard's
 * narrower `DashboardCycleRow` (`lib/db/dashboard.ts`) — so the compiler
 * checks the call without either side importing the other.
 */
export interface CycleRow {
  /** When the row was inserted. `not null` in the table. */
  started_at: string;
  /** When it finished. Null while it runs, and null forever if it died. */
  ended_at: string | null;
  /** The producer's own word for how it ended, where it wrote one. */
  outcome: string | null;
}

/** Epoch ms for a timestamp string, or `null` when it will not parse. */
export function instantOf(ts: string | null): number | null {
  if (ts === null || ts === "") return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * What a cycle row IS, decided from `ended_at` and `outcome` together.
 *
 *  - `outcome` — the producer said how it ended, and the word is carried
 *    verbatim rather than narrowed to the check constraint's three spellings:
 *    an outcome the constraint gains later renders under its own name instead
 *    of being dropped. `skipped` is one of these, so a skipped cycle is
 *    legible as itself and never as a failure.
 *  - `running` — no `ended_at`, and the cycle started less than one cadence
 *    ago: it may well still be going.
 *  - `died` — no `ended_at`, and the cycle started longer ago than that.
 *    Nothing repairs the row, so rendering it as "running" would show a crash
 *    from last March as work in progress forever.
 *  - `unrecorded` — it ended and recorded no outcome. The producer wrote no
 *    word and this app invents none.
 */
export type CycleState =
  | { kind: "outcome"; outcome: string }
  | { kind: "running" }
  | { kind: "died"; ageSeconds: number }
  | { kind: "unrecorded" };

/** What `cycleState` needs from the caller: the clock, and the cadence. */
export interface CycleStateOptions {
  /** The instant "now" means, so a render and its test agree on one clock. */
  now: string | Date;
  /**
   * The resolver's cadence in seconds — the age past which an unfinished
   * cycle is a dead one. Handed in rather than imported: the cadence is
   * `lib/gauges`' constant (`RESOLVER_CADENCE_SECONDS`, from
   * `contracts/resolver.md` §12), and `lib/gauges` reads the layers above
   * this leaf, never the other way about (ARCHITECTURE.md §4).
   */
  cadenceSeconds: number;
}

/** The state of one cycle row. Pure; the clock and the cadence come in. */
export function cycleState(row: CycleRow, options: CycleStateOptions): CycleState {
  if (row.outcome !== null && row.outcome.trim() !== "") {
    return { kind: "outcome", outcome: row.outcome };
  }
  if (row.ended_at !== null) return { kind: "unrecorded" };

  const started = instantOf(row.started_at);
  const now =
    options.now instanceof Date ? options.now.getTime() : Date.parse(options.now);
  // An age nobody can measure cannot carry the "older than one cadence" claim
  // a death is, so the row stays what the schema says it is: a cycle inserted
  // at start that has not recorded an end. `started_at` is not-null in the
  // table, so this is the unparseable case alone.
  if (started === null || Number.isNaN(now)) return { kind: "running" };

  const ageSeconds = (now - started) / 1000;
  return ageSeconds > options.cadenceSeconds
    ? { kind: "died", ageSeconds }
    : { kind: "running" };
}

/**
 * The ONE word the app gives each no-outcome cycle state — read by the
 * Cycles & runs table, by its cycle-health panel's outcome list, and by the
 * Dashboard's cycle table, so no two of them can name one state two ways
 * (LOOK_AND_FEEL, The Voice: "one name per concept, everywhere … two builders
 * who never meet must write the same labels").
 *
 * `unrecorded` has no word on purpose. It ended and the producer wrote no
 * outcome, so no surface invents one: each renders the shared absence dash
 * (`orDash` / `DataTable`'s own), which is the same string in every place too.
 *
 * A `Record` over the state kinds and not a lookup with a fallback: a state
 * added to `CycleState` stops COMPILING here instead of rendering under its
 * machine name on one page and a guessed word on another.
 */
export const STATE_WORD: Record<
  Exclude<CycleState["kind"], "outcome">,
  string | null
> = {
  running: "still running",
  died: "died",
  unrecorded: null,
};
