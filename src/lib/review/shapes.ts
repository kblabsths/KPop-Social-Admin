/**
 * The review-item domain — campaign admin-window/TASK-0006.
 *
 * Authority: admin-observability.md §6 ("Every review item is one of two
 * kinds … The kind belongs to the shape and is derived in code — no column
 * carries it") and §4 (Queues: "open first, severity then age, filterable by
 * shape; settled items browsable"); resolver.md §11 for the columns.
 *
 * This module is PURE: it imports nothing, so it cannot reach a database and
 * `src/lib/db/review-items.ts` can depend on it without a cycle. Everything
 * that decides *what a review item is* lives here and only here — the Queues
 * page, the Dashboard and item detail derive, never re-derive.
 */

/* ── the row ─────────────────────────────────────────────────────────────── */

/** `review_items.queue` — exactly two; extending the list is a migration. */
export type ReviewQueue = "data_conflict" | "entity_link";

/**
 * `review_items.severity` — the registry's setting, read as-is.
 *
 * There are two values and no third thing. There is no score, no rank and no
 * computed priority anywhere in this campaign: the visibility × impact ranking
 * formula is parked (resolver.md §11, VISION non-goal), so ordering compares
 * these two literals directly.
 */
export type ReviewSeverity = "low" | "high";

/** `review_items.status` — settled arrives with M2's verdict; both browsable. */
export type ReviewStatus = "open" | "settled";

/**
 * One `review_items` row, exactly the columns migration
 * `20260901000002_the_review_item_opens_once_per_subject.sql` declares
 * (ARCHITECTURE.md §6). `domain` — not `entity_type` — is this table's
 * spelling of the canonical table (§6 trap 1); `evidence` is `uuid[]` in fold
 * order (trap 10).
 */
export interface ReviewItemRow {
  review_item_id: string;
  queue: ReviewQueue;
  /** Set on a per-source item; null on a per-fact one. The discriminator. */
  source_id: string | null;
  domain: string | null;
  entity_id: string | null;
  field: string | null;
  severity: ReviewSeverity;
  status: ReviewStatus;
  summary: string;
  evidence: string[];
  folded_count: number;
  opened_at: string;
  last_evidence_at: string;
}

/* ── kind and shape ──────────────────────────────────────────────────────── */

/**
 * A **decision** asks a question only a verdict can close; a **signal**
 * reports a breakage, fixed on another surface (§6). The two queues are of
 * equal standing — a signal is not a lesser decision.
 */
export type Kind = "decision" | "signal";

/**
 * The three shapes today. §6 calls this "an open set that moves with the
 * queues": a new queue or escalation type brings its shape, a retired one
 * takes it away. Adding one means adding it here, to `KIND_BY_SHAPE`, and to
 * `shapeOf` — the compiler requires all three.
 */
export type Shape =
  | "data_conflict_fact"
  | "entity_link_fact"
  | "entity_link_source_pattern";

/** Every shape, in the order §6 lists them. */
export const SHAPES: readonly Shape[] = [
  "data_conflict_fact",
  "entity_link_fact",
  "entity_link_source_pattern",
];

/** Both kinds, decisions first (the Dashboard reads them in this order). */
export const KINDS: readonly Kind[] = ["decision", "signal"];

/**
 * **The kind mapping. This object is the only place it exists** — §6's "no
 * column carries it" means nothing may re-derive it from a queue, a summary or
 * a null check. Everything that needs a kind calls `kindOf`/`kindOfItem`.
 */
const KIND_BY_SHAPE: Readonly<Record<Shape, Kind>> = {
  data_conflict_fact: "decision",
  entity_link_fact: "decision",
  entity_link_source_pattern: "signal",
};

/** The kind of a shape. */
export function kindOf(shape: Shape): Kind {
  return KIND_BY_SHAPE[shape];
}

/**
 * The shape of a row, from the two things the schema actually gives us: the
 * `queue` and whether `source_id` is set.
 *
 * Migration `20260901000002` is explicit that a subject is either a FACT
 * (`domain`/`entity_id`/`field` set, `source_id` null) or a SOURCE
 * (`source_id` set, the other three null) — so `source_id` is the whole
 * discriminator and no column named "shape" or "kind" is invented.
 *
 * `entity_id` is deliberately NOT part of the test: an `entity_link` fact item
 * is usually about a record that has no canonical row yet, so its `entity_id`
 * is null (the column's own comment says so) — reading nullness of the fact
 * columns instead of `source_id` would misfile exactly the commonest item.
 *
 * Total by construction: a `data_conflict` row is a fact item whatever else it
 * carries, because that queue has no per-source subject (resolver.md §11). A
 * `Shape` always comes back, so no caller has an exception path.
 */
export function shapeOf(item: ReviewItemRow): Shape {
  if (item.queue === "entity_link") {
    return item.source_id === null || item.source_id === undefined
      ? "entity_link_fact"
      : "entity_link_source_pattern";
  }
  return "data_conflict_fact";
}

/** The kind of a row — `kindOf(shapeOf(item))`, the spelling pages use. */
export function kindOfItem(item: ReviewItemRow): Kind {
  return kindOf(shapeOf(item));
}

/** The shapes belonging to one kind (the decision queue's, the signal queue's). */
export function shapesOfKind(kind: Kind): Shape[] {
  return SHAPES.filter((shape) => kindOf(shape) === kind);
}

/* ── the ordering ────────────────────────────────────────────────────────── */

/** Epoch ms for a timestamptz string, or `null` when it does not parse. */
function instant(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Compare two `opened_at` values oldest-first.
 *
 * Parsed rather than string-compared, because PostgREST spells the offset
 * (`…+00:00`) where a fixture spells `Z`, and those two orderings disagree
 * lexicographically for the same instant. An unparseable timestamp sorts last
 * rather than throwing or landing arbitrarily among the real ones.
 */
function olderFirst(a: string, b: string): number {
  const left = instant(a);
  const right = instant(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

/**
 * The queue order (§4): **open items first, then severity, then age.**
 *
 * - status: `open` before `settled` — settled items stay browsable, at the bottom.
 * - severity: `high` before `low`, by comparing the two registry values
 *   themselves. No score, no rank, no formula — the ranking formula is parked.
 * - age: oldest `opened_at` first; the item that has waited longest is the one
 *   that has been ignored longest.
 * - `review_item_id` last, so the order is total and a reload cannot reshuffle
 *   two items that tie on all three. The ids are uuid v7 (time-ordered), so
 *   this tiebreak agrees with age rather than fighting it.
 *
 * Returns a new array; the input is never mutated.
 */
export function queueOrder(items: ReviewItemRow[]): ReviewItemRow[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    const byAge = olderFirst(a.opened_at, b.opened_at);
    if (byAge !== 0) return byAge;
    return a.review_item_id < b.review_item_id ? -1 : a.review_item_id > b.review_item_id ? 1 : 0;
  });
}

/* ── the filters ─────────────────────────────────────────────────────────── */

/**
 * What a queue list may be narrowed by. Every field is optional and they
 * combine with AND; an omitted field constrains nothing.
 *
 * `kind` is here because the window has two queues of equal standing (§4) and
 * "the decision queue" is exactly `kind: "decision"` — a page must not spell
 * that as a list of shapes of its own.
 */
export interface ReviewItemFilter {
  queue?: ReviewQueue;
  shape?: Shape;
  kind?: Kind;
  status?: ReviewStatus;
}

/**
 * Does one row match one filter? **The only predicate in the app.**
 *
 * Acceptance test 4 is "a filter returns exactly the matching items — no
 * extras, none missing", which only holds if there is one predicate to be
 * right about. A page that writes its own `.filter(i => i.queue === q)` is a
 * defect even when it agrees today.
 */
export function matchesFilter(
  item: ReviewItemRow,
  filter: ReviewItemFilter = {},
): boolean {
  if (filter.queue !== undefined && item.queue !== filter.queue) return false;
  if (filter.status !== undefined && item.status !== filter.status) return false;
  if (filter.shape !== undefined && shapeOf(item) !== filter.shape) return false;
  if (filter.kind !== undefined && kindOfItem(item) !== filter.kind) return false;
  return true;
}

/** The matching rows, in input order. `selectItems(items, {})` is everything. */
export function selectItems(
  items: ReviewItemRow[],
  filter: ReviewItemFilter = {},
): ReviewItemRow[] {
  return items.filter((item) => matchesFilter(item, filter));
}

/* ── the attention summary ───────────────────────────────────────────────── */

/**
 * What the Dashboard's attention summary and the queue-health gauge both need
 * for one kind (§4: "decision and signal counts separate — open counts, max
 * severity, oldest age"; §5).
 *
 * `oldestOpenedAt` is the raw timestamp, not an age: rendering an age is
 * `relativeAge()` in `src/lib/format.ts`, and a domain module that pre-renders
 * one would give the app two age formats.
 */
export interface KindSummary {
  kind: Kind;
  /** Open items of this kind. Settled ones are browsable, never "attention". */
  open: number;
  /** `high` if any open item is high, else `low`, else null when there are none. */
  maxSeverity: ReviewSeverity | null;
  /** The `opened_at` of the longest-waiting open item; null when there are none. */
  oldestOpenedAt: string | null;
}

/** One summary per kind, both kinds always present so a zero renders as a zero. */
export type ReviewAttention = Record<Kind, KindSummary>;

/**
 * The oldest `opened_at` among these rows, or null for an empty set. Uses the
 * same instant comparison the ordering does, so "oldest" means one thing.
 */
export function oldestOpenedAt(items: ReviewItemRow[]): string | null {
  let oldest: string | null = null;
  for (const item of items) {
    if (oldest === null || olderFirst(item.opened_at, oldest) < 0) {
      oldest = item.opened_at;
    }
  }
  return oldest;
}

/**
 * The attention summary, over whatever rows are handed in — only their OPEN
 * ones count, so a caller may pass the whole population without pre-filtering.
 *
 * `maxSeverity` is the presence of a `high`, not a maximum of numbers: there
 * is no severity score in this app.
 */
export function summarizeByKind(items: ReviewItemRow[]): ReviewAttention {
  const summary = {} as ReviewAttention;
  for (const kind of KINDS) {
    const open = selectItems(items, { kind, status: "open" });
    summary[kind] = {
      kind,
      open: open.length,
      maxSeverity:
        open.length === 0
          ? null
          : open.some((item) => item.severity === "high")
            ? "high"
            : "low",
      oldestOpenedAt: oldestOpenedAt(open),
    };
  }
  return summary;
}
