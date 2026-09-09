import type { SupabaseClient } from "@supabase/supabase-js";
import { readComplete, type DbCountedResponse, type DbResult } from "./result";
import { T } from "./tables";
import {
  KINDS,
  queueOrder,
  selectItems,
  summarizeByKind,
  type Kind,
  type ReviewAttention,
  type ReviewItemFilter,
  type ReviewItemRow,
} from "../review/shapes";

/**
 * The `review_items` reads — campaign admin-window/TASK-0006.
 *
 * Every export returns a `DbResult` and never throws (ARCHITECTURE.md §4.1),
 * so a database without the resolver tables renders a not-provisioned card
 * instead of a stack trace. The table is named through `T` alone (§4 rule 4).
 *
 * The domain lives in `src/lib/review/shapes.ts`: this module reads rows and
 * hands them to that module's predicate and ordering. It is the one importer
 * of them for `review_items`, which is what makes "a filter returns exactly
 * the matching items" (acceptance test 4) a property of one function rather
 * than of every page that filters.
 */

/**
 * The columns, explicit (§4.2 "Reads are explicit"). Spelled once: a page
 * asking for a different set would defeat the not-provisioned classification,
 * which names the column the database complained about.
 *
 * Exported because the item DETAIL reads one row of the same table
 * (`src/lib/db/review-item.ts`, campaign admin-window/TASK-0011) and two
 * hand-kept copies of a select list drift: the day a column is added here the
 * detail must ask for it too, or the same row arrives with a different shape
 * on two surfaces.
 */
export const REVIEW_ITEM_COLUMNS = [
  "review_item_id",
  "queue",
  "source_id",
  "domain",
  "entity_id",
  "field",
  "severity",
  "status",
  "summary",
  "evidence",
  "folded_count",
  "opened_at",
  "last_evidence_at",
].join(", ");

/**
 * Build the query, narrowed by the filter's plain COLUMN constraints only.
 *
 * `queue` and `status` are real columns, so PostgREST can do that work.
 * `shape` and `kind` are derived in code and have no column to filter on
 * (§6: "no column carries it") — they are applied by the predicate below.
 * The predicate re-applies `queue`/`status` too: the narrowing is an
 * optimisation, and the returned set is decided by exactly one function
 * whether the server narrowed or not.
 *
 * It is a COMPLETE read (ARCHITECTURE.md §4.3): `{ count: "exact" }`, a total
 * server-side order ending in the primary key, and `.range(0, cap - 1)`. That
 * is what lets `readComplete` tell a whole matching set from a truncated one —
 * without the count there is no way to know, and without the order the subset
 * a cap returns is arbitrary and a refusal is not reproducible.
 *
 * **Ascending on all four is measured, not assumed:** `open` < `settled` and
 * `high` < `low` lexicographically, so ascending text order already puts open
 * before settled and high before low, and the server order happens to agree
 * with `queueOrder`. **That agreement is a convenience, not the contract** —
 * `queueOrder` in `src/lib/review/shapes.ts` is the only authority on display
 * order and is applied after the read. Should a third status or severity value
 * ever land, this order is merely arbitrary-but-stable and `queueOrder` is
 * still right.
 */
function query(db: SupabaseClient, filter: ReviewItemFilter, cap: number) {
  let builder = db
    .from(T.reviewItems)
    .select(REVIEW_ITEM_COLUMNS, { count: "exact" });
  if (filter.queue !== undefined) builder = builder.eq("queue", filter.queue);
  if (filter.status !== undefined) builder = builder.eq("status", filter.status);
  return builder
    .order("status", { ascending: true })
    .order("severity", { ascending: true })
    .order("opened_at", { ascending: true })
    .order("review_item_id", { ascending: true })
    .range(0, cap - 1) as unknown as PromiseLike<
    DbCountedResponse<ReviewItemRow[]>
  >;
}

/**
 * The queue list: the items matching `filter`, in queue order (open first,
 * severity then age — `queueOrder`).
 *
 * An empty filter is the whole table, settled items included; §4 keeps them
 * browsable, and `queueOrder` puts them below the open ones.
 *
 * A COMPLETE read: an `ok` array is every matching row, or the read refuses
 * with the real count (ARCHITECTURE.md §4.3). "A filter returns exactly the
 * matching items" (acceptance test 4) is only true because of that — a
 * silently truncated row set would make it false with nothing to show for it.
 */
export async function listReviewItems(
  filter: ReviewItemFilter = {},
  db?: SupabaseClient,
): Promise<DbResult<ReviewItemRow[]>> {
  const result = await readComplete<ReviewItemRow>(
    T.reviewItems,
    (client, cap) => query(client, filter, cap),
    db,
  );
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: queueOrder(selectItems(result.data, filter)) };
}

/**
 * What ONE queue block needs to tell its four states apart: the rows the URL
 * left it, and how many rows its kind holds when NOTHING is filtered
 * (campaign admin-window/BUG-0133).
 *
 * `listReviewItems` narrows at the database, so its `ok` array never contains
 * the rows a facet removed — from it alone a block cannot tell "my queue is
 * empty" from "the filter matched nothing", and staging (0 decision items)
 * renders the second for the first. The population is the missing fact and it
 * is a COUNT, never rows to render: nothing below is displayed.
 */
export interface ReviewQueues {
  /** The items matching the URL filter, in queue order — what the page renders. */
  items: ReviewItemRow[];
  /**
   * Per kind, the rows the table holds with NO url facet at all: the size of
   * the set that block would render on the bare `/queues`. Both kinds are
   * always present, so an empty queue is a real `0` and never a gap.
   */
  population: Record<Kind, number>;
}

/** Every kind's whole-table row count, by the app's one predicate. */
function populationByKind(items: ReviewItemRow[]): Record<Kind, number> {
  const population = {} as Record<Kind, number>;
  // Not `summarizeByKind`: that counts OPEN items (attention), and a block's
  // unfiltered set is every row of its kind, settled ones included.
  for (const kind of KINDS) population[kind] = selectItems(items, { kind }).length;
  return population;
}

/**
 * Does this filter ask the database for anything less than the whole table?
 *
 * Read off `ReviewItemFilter`'s own values rather than off `FACETS` in
 * `lib/review/queue-filters.ts`: the arrow runs `app/** -> lib/db/**` and
 * `app/** -> lib/review/**`, and a `lib/db` module importing the URL layer
 * would invert it. An explicitly-`undefined` facet is no narrowing, which is
 * exactly how `matchesFilter` reads it.
 */
function narrows(filter: ReviewItemFilter): boolean {
  return Object.values(filter).some((value) => value !== undefined);
}

/**
 * The Queues page's read: both facts, or one refusal.
 *
 * TWO COMPLETE READS (ARCHITECTURE.md §4.3 kind 1), and only when the URL
 * carries a facet — the bare `/queues` reads once and IS its own population,
 * so the common case costs exactly what it costs today. Neither read is
 * partial and neither is a window: an `ok` here means both answered in full,
 * and if either refused the caller gets that refusal and renders no figure at
 * all rather than a population the app never counted (LESSONS 2: a null count
 * is a refusal, never a zero).
 *
 * The population read is deliberately the SAME query with an empty filter, so
 * the two legs cannot come to disagree about columns, order or completeness.
 */
export async function readReviewQueues(
  filter: ReviewItemFilter = {},
  db?: SupabaseClient,
): Promise<DbResult<ReviewQueues>> {
  const [filtered, whole] = await Promise.all([
    listReviewItems(filter, db),
    narrows(filter) ? listReviewItems({}, db) : null,
  ]);
  if (filtered.kind !== "ok") return filtered;
  const population = whole ?? filtered;
  if (population.kind !== "ok") return population;
  return {
    kind: "ok",
    data: { items: filtered.data, population: populationByKind(population.data) },
  };
}

/**
 * The Dashboard's attention summary and the queue-health gauge's input: per
 * kind, the open count, the max severity and the oldest `opened_at`.
 *
 * One read, aggregated in TypeScript, because `kind` is derived and no
 * `count(*) group by kind` is expressible against a column that does not
 * exist. Both kinds always come back, so an empty queue renders a zero rather
 * than a gap.
 *
 * Correct by construction: its input is `listReviewItems`, a complete read, so
 * every count and oldest age here is over the whole open set or the read
 * refused and no number is rendered at all.
 */
export async function readReviewAttention(
  db?: SupabaseClient,
): Promise<DbResult<ReviewAttention>> {
  const result = await listReviewItems({ status: "open" }, db);
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: summarizeByKind(result.data) };
}
