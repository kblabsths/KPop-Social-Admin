/**
 * The shared formatting helpers — campaign admin-window, TASK-0004.
 *
 * Seeded once because every page needs them and a helper nobody seeds becomes
 * eight hand-copies that drift. The primitives in `src/components/ui` use
 * these; pages never re-implement one.
 *
 * LOOK_AND_FEEL, Voice bar 6: ages are relative (with the absolute value in
 * the title attribute), scheduled times are absolute with the zone stated once
 * in the column header, counts carry their noun. A null is an em dash in
 * disabled-gray — never blank, never `null`, `N/A` or `none`.
 */
import { createElement, type ReactElement, type ReactNode } from "react";

/** The one character that stands for "no value", everywhere in the app. */
export const EM_DASH = "—";

/** Anything a timestamp can arrive as from the database layer or a prop. */
export type Timestamp = string | number | Date | null | undefined;

function toDate(ts: Timestamp): Date | null {
  if (ts === null || ts === undefined || ts === "") return null;
  const date = ts instanceof Date ? ts : new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The zone token, spelled once for the whole app. */
export const UTC_ZONE = "UTC";

/**
 * The instant itself — `2026-08-29 04:12`, no zone token — or `null` when
 * there is nothing to render. The two exported renderings below differ ONLY
 * in whether they append the zone, so an instant reads identically wherever
 * it appears.
 */
function utcStamp(ts: Timestamp): string | null {
  const date = toDate(ts);
  if (!date) return null;
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

/**
 * `2026-08-29 04:12 UTC` — the instant WEARING its zone. For prose that has
 * no header to carry it (the window sentences: "read to 2026-09-03 21:44
 * UTC") and for the title attribute of every relative age. Never a raw ISO
 * string in a scannable column.
 *
 * Voice bar 6 states the zone ONCE. In a column whose header already says
 * `(UTC)`, the value must not repeat it — use `absoluteUtcInZonedColumn`
 * below. That choice lives here, in the one place that knows both forms,
 * rather than at each call site (campaign admin-window/BUG-0047).
 */
export function absoluteUtc(ts: Timestamp): string {
  const stamp = utcStamp(ts);
  return stamp === null ? EM_DASH : `${stamp} ${UTC_ZONE}`;
}

/**
 * `2026-08-29 04:12` — the same instant, still absolute and still UTC, for a
 * column whose HEADER states the zone ("Starts (UTC)").
 *
 * Repeating the token in every cell is not merely redundant: on `/browse` the
 * suffix overflowed a 135px column and wrapped all 50 rows onto two lines,
 * doubling the table's height (admin-window/BUG-0047, measured 2026-09-03 at
 * 1440x900). A caller picks this form exactly when its header carries the
 * zone, and `absoluteUtc` otherwise — never both, never neither.
 */
export function absoluteUtcInZonedColumn(ts: Timestamp): string {
  return utcStamp(ts) ?? EM_DASH;
}

/**
 * `3d ago`, with the absolute value for the title attribute.
 *
 * Steps are minutes, hours, then days — no weeks, months or years, because an
 * operator comparing two ages needs one unit ladder, not a calendar. A
 * timestamp in the future reads `in 3d`.
 */
export function relativeAge(
  ts: Timestamp,
  now: Timestamp = new Date(),
): { text: string; title: string } {
  const date = toDate(ts);
  if (!date) return { text: EM_DASH, title: "" };

  const reference = toDate(now) ?? new Date();
  const seconds = Math.round((reference.getTime() - date.getTime()) / 1000);
  const future = seconds < 0;
  const magnitude = Math.abs(seconds);

  let span: string;
  if (magnitude < 60) span = "just now";
  else if (magnitude < 3600) span = `${Math.floor(magnitude / 60)}m`;
  else if (magnitude < 86_400) span = `${Math.floor(magnitude / 3600)}h`;
  else span = `${Math.floor(magnitude / 86_400)}d`;

  const text =
    span === "just now" ? "just now" : future ? `in ${span}` : `${span} ago`;
  return { text, title: absoluteUtc(date) };
}

/**
 * A LENGTH of time in seconds, on the same unit ladder `relativeAge` climbs:
 * `45s`, `12m`, `3h`, `2d`. `null` when there is nothing to measure.
 *
 * Ages and durations are relative everywhere in this app (LOOK_AND_FEEL, Voice
 * bar 6) — a gauge that answers "how long" with `86,400` answers it at the
 * wrong glance, and every gauge distribution is a span of seconds. It lives
 * here, beside `relativeAge`, because the six gauge surfaces plus the queue
 * and cycle pages all need it and a second copy would drift from this ladder
 * (campaign admin-window/TASK-0008).
 *
 * Under a minute the value keeps one decimal, so a sub-second latency is not
 * rounded to `0s`. A NEGATIVE duration is rendered negative rather than
 * clamped: it means two clocks disagreed, which is a finding, not a zero
 * (`secondsBetween` in `lib/gauges/gauge.ts` surfaces it the same way).
 */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return EM_DASH;
  }
  const sign = seconds < 0 ? "-" : "";
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) {
    const rounded = Math.round(magnitude * 10) / 10;
    return `${sign}${rounded}s`;
  }
  if (magnitude < 3600) return `${sign}${Math.floor(magnitude / 60)}m`;
  if (magnitude < 86_400) return `${sign}${Math.floor(magnitude / 3600)}h`;
  return `${sign}${Math.floor(magnitude / 86_400)}d`;
}

/**
 * Thousand-separated, in a fixed locale so the same row reads the same on
 * every machine. A count that is rendered NEXT TO its noun goes through
 * `counted` below rather than being concatenated here.
 */
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  return n.toLocaleString("en-US");
}

const PLURAL_RULES = new Intl.PluralRules("en-US");

/**
 * Which of two word forms a quantity takes — the whole pluralisation rule of
 * this app, in one place (campaign admin-window/BUG-0046).
 *
 * `Intl.PluralRules` rather than `n === 1` because the selection of a form by
 * a quantity is a locale question the platform already answers, and `count`
 * above is already pinned to `en-US`: the two agree by construction, and a
 * fractional or negative quantity gets the form the language actually gives it
 * (`1.5` is `other` — "1.5 sources" — while `1` alone is `one`).
 *
 * Both forms are the CALLER'S words, so this handles the verb as readily as
 * the noun: `pluralise(n, "it is", "they are")`, `pluralise(n, "names",
 * "name")`. There is no inflection table here and there will not be one —
 * guessing "entitys" from "entity" is the bug this helper exists to stop.
 *
 * A quantity that is not a finite number takes the MANY form: a dash means the
 * count is unknown, and the unmarked English form for an unknown quantity is
 * the plural ("— sources").
 */
export function pluralise<T>(
  n: number | null | undefined,
  one: T,
  many: T,
): T {
  if (n === null || n === undefined || !Number.isFinite(n)) return many;
  return PLURAL_RULES.select(n) === "one" ? one : many;
}

/**
 * A count wearing its noun, agreeing with it: `0 sources`, `1 source`,
 * `2,481 sources` (LOOK_AND_FEEL Voice bar 6, "counts carry their noun").
 *
 * Every call site that renders a figure immediately followed by the thing it
 * counts uses this instead of `count(n) + " sources"`, which is how the app
 * came to say "1 sources holding one" and "of 1 items read here" on two of its
 * six pages (admin-window/BUG-0046). The rule lives here once so that a new
 * gauge card gets it for free rather than re-deciding it.
 *
 * `plural` defaults to the regular `-s` form because every noun this app
 * counts is regular; an irregular one passes its own second form, and so does
 * any phrase whose verb has to agree too:
 *
 * ```ts
 * counted(1, "source")                                 // "1 source"
 * counted(0, "source")                                 // "0 sources"
 * counted(1, "entity", "entities")                     // "1 entity"
 * counted(2, "rejection carries", "rejections carry")  // "2 rejections carry"
 * ```
 *
 * An unknown count renders the dash beside the plural: `— sources`.
 */
export function counted(
  n: number | null | undefined,
  singular: string,
  plural: string = `${singular}s`,
): string {
  return `${count(n)} ${pluralise(n, singular, plural)}`;
}

/**
 * The rendering of a null: an em dash in disabled-gray. Every primitive that
 * can be handed a null uses this, so absence looks identical everywhere.
 */
export function nullDash(): ReactElement {
  return createElement(
    "span",
    { className: "text-ink-disabled", "aria-label": "no value" },
    EM_DASH,
  );
}

/**
 * Is this renderable body an absence? The single definition, campaign
 * admin-window/BUG-0004 — a primitive asks here instead of writing its own
 * `x === null || x === ""` guard, because three hand-written guards disagreed.
 *
 * Absent is anything React would draw as nothing (`null`, `undefined`, either
 * boolean — the `flag && "yes"` idiom yields `false` — an empty or
 * whitespace-only string, an empty array), anything that would draw as
 * nonsense (a non-finite number renders the literal `NaN`), and the bare em
 * dash a formatting helper returns: `count(null)`, `absoluteUtc(null)` and
 * `relativeAge(null).text` are strings, so they must be recognised here to be
 * coloured like a raw null.
 */
export function isAbsent(value: ReactNode): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" || trimmed === EM_DASH;
  }
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * The body to render: itself, or `nullDash()` when it is an absence. Every
 * primitive that renders a caller-supplied value passes it through here, so a
 * page written against `count(row.n)` needs no absence handling of its own and
 * every dash in a row reads the same.
 */
export function orDash(value: ReactNode): ReactNode {
  return isAbsent(value) ? nullDash() : value;
}
