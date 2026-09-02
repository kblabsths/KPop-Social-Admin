import type { SupabaseClient } from "@supabase/supabase-js";
import { readRows, type DbResponse, type DbResult } from "./result";
import { T } from "./tables";
import {
  queueOrder,
  selectItems,
  summarizeByKind,
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
 */
const COLUMNS = [
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
 */
function query(db: SupabaseClient, filter: ReviewItemFilter) {
  let builder = db.from(T.reviewItems).select(COLUMNS);
  if (filter.queue !== undefined) builder = builder.eq("queue", filter.queue);
  if (filter.status !== undefined) builder = builder.eq("status", filter.status);
  return builder as unknown as PromiseLike<DbResponse<ReviewItemRow[]>>;
}

/**
 * The queue list: the items matching `filter`, in queue order (open first,
 * severity then age — `queueOrder`).
 *
 * An empty filter is the whole table, settled items included; §4 keeps them
 * browsable, and `queueOrder` puts them below the open ones.
 */
export async function listReviewItems(
  filter: ReviewItemFilter = {},
  db?: SupabaseClient,
): Promise<DbResult<ReviewItemRow[]>> {
  const result = await readRows<ReviewItemRow>(
    T.reviewItems,
    (client) => query(client, filter),
    db,
  );
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: queueOrder(selectItems(result.data, filter)) };
}

/**
 * The Dashboard's attention summary and the queue-health gauge's input: per
 * kind, the open count, the max severity and the oldest `opened_at`.
 *
 * One read, aggregated in TypeScript, because `kind` is derived and no
 * `count(*) group by kind` is expressible against a column that does not
 * exist. Both kinds always come back, so an empty queue renders a zero rather
 * than a gap.
 */
export async function readReviewAttention(
  db?: SupabaseClient,
): Promise<DbResult<ReviewAttention>> {
  const result = await listReviewItems({ status: "open" }, db);
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: summarizeByKind(result.data) };
}
