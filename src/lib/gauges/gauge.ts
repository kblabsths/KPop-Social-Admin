import { ROW_CAP, type DbResult } from "../db/result";
import { objectKindOf, type ObjectKind, type TableName } from "../db/tables";

/**
 * What every gauge shares — campaign admin-window/TASK-0007.
 *
 * Authority: admin-observability.md §5 ("the gauges are server-side queries in
 * the Admin app, not database views … this build adds queries and charts,
 * never tables"), ARCHITECTURE.md §8 ("a gauge fetches a bounded row set and
 * aggregates in TypeScript — one pure exported function per gauge … every
 * gauge query carries an explicit `limit` and an explicit time window; an
 * unbounded fetch is a defect") and §4.2 (joins are two-step, in TypeScript).
 *
 * The reason this file exists rather than six copies of it: PostgREST cannot
 * aggregate beyond `count`, so every gauge computes the same three things —
 * a bounded window, a percentile spread, and a per-period bucketing — and
 * three hand-written percentile functions would disagree within a milestone.
 *
 * **This module is pure.** From the data layer it imports one TYPE, one
 * NUMBER (`ROW_CAP`, the platform row cap — see `GAUGE_ROW_CAP` below) and the
 * table registry's `objectKindOf` (a lookup in a frozen map, which is why
 * `windowOf` can say what its scan ran over without asking a renderer —
 * admin-window/BUG-0077); it imports no client, no query builder and no chain,
 * so nothing under `lib/gauges/` can reach a database — which is what makes "the aggregate is
 * pure" a structural fact rather than a promise (ARCHITECTURE.md §4 rule 2:
 * only `lib/db/**` imports `@supabase/supabase-js`; every PostgREST chain is
 * in `lib/db/gauges.ts`).
 */

/* ── bounds: every fetch is windowed and capped ──────────────────────────── */

/**
 * The most rows any gauge scan may ask for.
 *
 * PostgREST refuses to return more than its `db-max-rows` (Supabase's default
 * is 1000) **and says nothing about having done so** (ARCHITECTURE.md §4.3).
 * A window read decides truncation by comparing the rows it got against the
 * cap it asked for, so the moment a gauge asks for MORE than the server will
 * give, the server truncates first, `rowCount >= limit` can never be true, and
 * `WindowInfo.truncated` reports `false` over counts that are floors — the one
 * failure mode this data layer exists to make impossible
 * (admin-window/BUG-0009: five of six gauges declared 2000 or 5000).
 *
 * So every gauge window is clamped to this figure, and truncation stays
 * DECIDABLE: at the cap the window says `truncated: true` — a floor, honestly
 * labelled — rather than presenting a cut-off count as a total. A window
 * holding exactly the cap and no more is reported as a floor too; that is the
 * safe direction of the error, and the only one the server lets us tell apart.
 *
 * It is `ROW_CAP` itself and not a second literal: one number stands for
 * PostgREST's `db-max-rows` in this app (`lib/db/result.ts`), so the two read
 * kinds cannot drift apart. Raising it is only sound if the server's own
 * `db-max-rows` is raised with it.
 */
export const GAUGE_ROW_CAP = ROW_CAP;

/**
 * How a caller narrows a gauge. Every field is optional; every gauge names its
 * own defaults, so a page calls `readCycleHealth()` and still gets a bounded
 * query.
 *
 * `now` exists so the offline tests fix the clock: an age is measured against
 * it, and a gauge whose figures moved with wall-clock time could not be
 * asserted.
 */
export interface GaugeOptions {
  /** Inclusive lower bound of the window, as an ISO instant. Overrides `days`. */
  since?: string;
  /** Window length in days, counted back from `now`. */
  days?: number;
  /** Hard row cap on the scanning query. */
  limit?: number;
  /** The instant "now" means. Defaults to the real clock. */
  now?: string | Date;
}

/**
 * The window a gauge actually read, carried in its output.
 *
 * It is part of the answer, not bookkeeping: a count over the last 7 days and
 * a count over the last 90 are different facts, and a card that renders one
 * without saying which is a lie of omission (LOOK_AND_FEEL: the app shows what
 * the database said).
 */
export interface WindowInfo {
  /** Inclusive lower bound the query used. */
  since: string;
  /** The instant the window was measured back from — also the age reference. */
  until: string;
  /** The row cap the query carried. */
  limit: number;
  /**
   * How many rows the scanning query came back with.
   *
   * Carried because it is a fact of the read the surface may be asked for:
   * every window line publishes `data-window-held`, whatever kind of read
   * produced it, so an oracle can ask one question of all of them
   * (`components/ui/window-line.tsx`, admin-window/DEBT-0006). It is also the
   * number `truncated` below is decided from, which was otherwise
   * unobservable.
   */
  held: number;
  /**
   * The scanning query came back with exactly `limit` rows, so the window may
   * hold more than was read. Every count in the aggregate is then a FLOOR, not
   * a total — the card must say so rather than present a cut-off number as
   * complete.
   */
  truncated: boolean;
  /**
   * The kind of database object the scan ran over — the word a window line
   * ends its bound clause on.
   *
   * It rides on the window because it is a fact of the READ, established by
   * `windowOf` from the `tables.ts` name the query itself used, not a prop a
   * page picks. Two surfaces rendering one `WindowInfo` therefore cannot
   * describe it with two different objects, which is exactly what `/claims`
   * ("view") and `/sources` ("table") did to the one pending-claims window
   * while the word was a call-site choice (admin-window/BUG-0077).
   */
  over: ObjectKind;
}

/** The bounds a fetch resolved to before it ran. */
export interface Bounds {
  since: string;
  until: string;
  limit: number;
}

const MS_PER_DAY = 86_400_000;

/** `now` as a Date, defaulting to the real clock. Never throws on junk. */
function nowOf(options: GaugeOptions): Date {
  const raw = options.now;
  if (raw === undefined) return new Date();
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Resolve a caller's options against a gauge's defaults.
 *
 * `since` wins over `days` when both are given; a non-finite or non-positive
 * `limit` falls back to the default rather than becoming an unbounded query,
 * because `limit(0)` and `limit(NaN)` are exactly the defects the rule is
 * about.
 *
 * Whatever the caller or the gauge asked for, the resolved cap is clamped to
 * `GAUGE_ROW_CAP`: a query asking for more rows than the server will hand back
 * cannot tell a truncated read from a complete one (admin-window/BUG-0009), so the ceiling
 * is enforced here, once, rather than trusted to six default objects and every
 * future caller.
 */
export function resolveBounds(
  options: GaugeOptions,
  defaults: { days: number; limit: number },
): Bounds {
  const until = nowOf(options);
  const days =
    typeof options.days === "number" && Number.isFinite(options.days) && options.days > 0
      ? options.days
      : defaults.days;
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : defaults.limit;
  const cappedLimit = Math.min(limit, GAUGE_ROW_CAP);
  const since =
    options.since !== undefined && !Number.isNaN(Date.parse(options.since))
      ? new Date(Date.parse(options.since)).toISOString()
      : new Date(until.getTime() - days * MS_PER_DAY).toISOString();
  return { since, until: until.toISOString(), limit: cappedLimit };
}

/**
 * The window a fetch of `rows.length` rows under `bounds` actually covered,
 * over the object `scanned` names.
 *
 * Truncation is decided against the SMALLER of the cap asked for and
 * `GAUGE_ROW_CAP`, because the server stops at its own cap whatever the query
 * said. `resolveBounds` already clamps, so for every gauge the two are the
 * same number; the `min` here is what keeps the answer honest for bounds built
 * any other way, instead of leaving the guard in one place a caller can walk
 * around (admin-window/BUG-0009).
 *
 * `scanned` is the `T.*` constant the scanning query passed to `.from()` —
 * the same value, not a second spelling of it — and its table/view kind is
 * looked up rather than asserted. That is what makes `WindowInfo.over` a
 * property of the read: a caller cannot hand it a word, only the object
 * (admin-window/BUG-0077).
 */
export function windowOf(bounds: Bounds, rowCount: number, scanned: TableName): WindowInfo {
  const effectiveLimit = Math.min(bounds.limit, GAUGE_ROW_CAP);
  return {
    since: bounds.since,
    until: bounds.until,
    limit: effectiveLimit,
    held: rowCount,
    truncated: rowCount >= effectiveLimit,
    over: objectKindOf(scanned),
  };
}

/* ── time ────────────────────────────────────────────────────────────────── */

/**
 * Epoch ms for a timestamptz string, or `null` when it does not parse.
 *
 * Parsed rather than string-compared for the reason `review/shapes.ts` gives:
 * PostgREST spells the offset (`…+00:00`) where a fixture spells `Z`, and the
 * two orderings disagree lexicographically for the same instant.
 */
export function instant(ts: string | Date | null | undefined): number | null {
  if (ts === null || ts === undefined || ts === "") return null;
  const ms = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Seconds from `from` to `to`, or `null` when either end will not parse.
 *
 * `null` and not `0`: a duration nobody can measure is not a duration of zero,
 * and the whole point of the gauges is that a figure they cannot compute says
 * so (spec §5 — the card judges a knob, and a fabricated 0 tunes it wrongly).
 * The result may be negative if the two clocks disagreed; that is surfaced as
 * it is rather than clamped, because a clamp would hide the disagreement.
 */
export function secondsBetween(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): number | null {
  const start = instant(from);
  const end = instant(to);
  if (start === null || end === null) return null;
  return (end - start) / 1000;
}

/** The UTC calendar day of a timestamp (`2026-09-01`), or null. */
export function utcDay(ts: string | Date | null | undefined): string | null {
  const ms = instant(ts);
  if (ms === null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The UTC date of the Monday that starts this timestamp's ISO week.
 *
 * Weeks are Monday-based because "opens vs settles per week" is an operational
 * rhythm, and an operator's week starts on Monday. One definition, used by
 * every per-week series in the gauges.
 */
export function utcWeekStart(ts: string | Date | null | undefined): string | null {
  const ms = instant(ts);
  if (ms === null) return null;
  const date = new Date(ms);
  // getUTCDay: 0 = Sunday. Monday-based offset puts Sunday six days after its
  // week's Monday rather than at the start of the next one.
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(ms - offset * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Every UTC day from `since` to `until` inclusive, ascending. Bounded by the window. */
export function utcDaysBetween(since: string, until: string): string[] {
  const start = instant(since);
  const end = instant(until);
  if (start === null || end === null || end < start) return [];
  const days: string[] = [];
  // Walk from midnight of the first day so a partial day still yields its key.
  let cursor = Date.parse(`${new Date(start).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const last = Date.parse(`${new Date(end).toISOString().slice(0, 10)}T00:00:00.000Z`);
  while (cursor <= last) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += MS_PER_DAY;
  }
  return days;
}

/** Every Monday-based week start from `since` to `until` inclusive, ascending. */
export function utcWeeksBetween(since: string, until: string): string[] {
  const first = utcWeekStart(since);
  const last = utcWeekStart(until);
  if (first === null || last === null) return [];
  const weeks: string[] = [];
  let cursor = Date.parse(`${first}T00:00:00.000Z`);
  const end = Date.parse(`${last}T00:00:00.000Z`);
  while (cursor <= end) {
    weeks.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 7 * MS_PER_DAY;
  }
  return weeks;
}

/* ── spreads: the one percentile definition in the app ───────────────────── */

/**
 * A distribution, as the gauges report one. Every figure is `null` — never
 * `0` — when there is nothing to compute it from.
 */
export interface Spread {
  /** How many values went in. */
  count: number;
  /**
   * How many candidates could NOT be measured (a missing half of a pair, an
   * unparseable timestamp). Reported beside the figures so a card can say "of
   * 40 cycles, 3 have not finished" instead of averaging them in as zeros.
   */
  unmeasurable: number;
  min: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

/**
 * The p-th percentile of an ASCENDING-sorted array, by **nearest rank** —
 * `sorted[ceil(p/100 · n) - 1]`.
 *
 * Nearest rank and not linear interpolation, deliberately: every figure the
 * gauges print is then a value that actually occurred in the data. An
 * interpolated p95 is a number no cycle ever took, and this build's whole
 * discipline is that a gauge never invents a figure. It also matches what an
 * operator gets from `percentile_disc` if these ever move into SQL.
 *
 * Returns `null` for an empty set.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * Summarise measured values, with the count of things that could not be
 * measured carried alongside.
 *
 * The input is not mutated; NaN and Infinity are treated as unmeasurable
 * rather than sorted among real values, because one NaN poisons a sort.
 */
export function spread(values: readonly number[], unmeasurable = 0): Spread {
  const finite: number[] = [];
  let unusable = unmeasurable;
  for (const value of values) {
    if (Number.isFinite(value)) finite.push(value);
    else unusable += 1;
  }
  finite.sort((a, b) => a - b);
  return {
    count: finite.length,
    unmeasurable: unusable,
    min: finite.length === 0 ? null : finite[0],
    p50: percentile(finite, 50),
    p90: percentile(finite, 90),
    p95: percentile(finite, 95),
    p99: percentile(finite, 99),
    max: finite.length === 0 ? null : finite[finite.length - 1],
  };
}

/**
 * The spread of a set of durations, of which some ends were unmeasurable.
 * `null` entries are counted as unmeasurable rather than dropped silently.
 */
export function spreadOfDurations(durations: readonly (number | null)[]): Spread {
  const measured: number[] = [];
  let unmeasurable = 0;
  for (const duration of durations) {
    if (duration === null) unmeasurable += 1;
    else measured.push(duration);
  }
  return spread(measured, unmeasurable);
}

/**
 * A ratio, or `null` when the denominator is zero — never `0`.
 *
 * "No items, so the fold rate is 0%" and "items, none of which folded, so the
 * fold rate is 0%" are different answers to the knob queue health tunes, and
 * only one of them is a measurement.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/* ── grouping ────────────────────────────────────────────────────────────── */

/** Group rows by a key, preserving first-seen order of the keys. */
export function groupBy<Row, Key extends string>(
  rows: readonly Row[],
  keyOf: (row: Row) => Key,
): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  return groups;
}

/** Unique, non-null values of `field` across rows, in first-seen order. */
export function idsOf<Row>(
  rows: readonly Row[],
  field: (row: Row) => string | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = field(row);
    if (typeof id === "string" && id.length > 0) seen.add(id);
  }
  return [...seen];
}

/** Index rows by a key, last write winning. */
export function indexBy<Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
): Map<string, Row> {
  const index = new Map<string, Row>();
  for (const row of rows) index.set(keyOf(row), row);
  return index;
}

/** Map the `ok` payload of a `DbResult`, passing every other state through. */
export function mapOk<A, B>(result: DbResult<A>, map: (data: A) => B): DbResult<B> {
  return result.kind === "ok" ? { kind: "ok", data: map(result.data) } : result;
}

/* ── the one threshold the contracts hand us ─────────────────────────────── */

/**
 * The resolver's cadence: 15 minutes (resolver.md §12, "resolver cadence — 15
 * min"). Cycle health judges duration against it, which is the knob §5 names.
 *
 * This is a value the contract states in this repo, not a registry dial — the
 * per-source `stuck_pattern` override is the one that lives only in scraper
 * YAML, and it is NOT here. See `pending-claims.ts`, `stuckPatternThreshold`.
 */
export const RESOLVER_CADENCE_MINUTES = 15;

/** The cadence in seconds — the unit every duration in the gauges uses. */
export const RESOLVER_CADENCE_SECONDS = RESOLVER_CADENCE_MINUTES * 60;
