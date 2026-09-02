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

/**
 * `2026-08-29 04:12 UTC` — scheduled times, and the title attribute of every
 * relative age. Never a raw ISO string in a scannable column.
 */
export function absoluteUtc(ts: Timestamp): string {
  const date = toDate(ts);
  if (!date) return EM_DASH;
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
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
 * Thousand-separated, in a fixed locale so the same row reads the same on
 * every machine. Counts carry their noun at the call site ("12 open
 * decisions"), never here.
 */
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  return n.toLocaleString("en-US");
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
