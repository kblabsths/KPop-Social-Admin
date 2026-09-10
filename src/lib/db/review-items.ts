import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readComplete,
  readCount,
  type DbCountedResponse,
  type DbResult,
  type DbUnavailable,
} from "./result";
import { T } from "./tables";
import { kindsNarrowedBy } from "../review/queue-filters";
import {
  KINDS,
  columnsOfShape,
  queueOrder,
  selectItems,
  shapesOfKind,
  summarizeByKind,
  type Kind,
  type ReviewAttention,
  type ReviewItemFilter,
  type ReviewItemRow,
  type Shape,
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
 * `queue`, `status` and `source_id` are real columns, so PostgREST can do that
 * work. `shape` and `kind` are derived in code and have no column to filter on
 * (§6: "no column carries it") — they are applied by the predicate below.
 * The predicate re-applies the three column facets too: the narrowing is an
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
  // `source_id` is a real column too (admin-window/BUG-0141), so a
  // `review_items` table past ROW_CAP still answers a source URL COMPLETELY
  // instead of refusing it. The value arrives canonicalised at the page's edge,
  // so Postgres's by-value comparison here and the predicate's by-string
  // comparison below cannot disagree (admin-window/BUG-0140).
  if (filter.source_id !== undefined) {
    builder = builder.eq("source_id", filter.source_id);
  }
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
 * (campaign admin-window/BUG-0133, reshaped by admin-window/BUG-0135).
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
   * Per kind, the rows the TABLE holds with no URL facet at all — a count,
   * never rows. `ok` is the number the database gave; a refusal is THIS kind's
   * population refusing, and it is the CALLER's to report beside the rows, not
   * the read's to propagate as its own refusal (admin-window/BUG-0135: a leg
   * that renders no row of its own may not delete the rows the URL's own
   * complete read returned).
   *
   * Both kinds are always present, so an unreadable population is a named
   * refusal and never a gap — and a population nobody asked for is the third
   * state, `not_asked`, never a zero.
   */
  population: Record<Kind, KindPopulation>;
}

/**
 * One kind's population: a number, a refusal, or **the question never asked**
 * (campaign admin-window/DEBT-0012).
 *
 * Three states, because there are three facts and a reader that conflated any
 * two of them would render a lie:
 *
 * - `{ kind: "ok", data: n }` — `n` rows, counted by the database.
 * - a `DbUnavailable` arm — the count was asked and refused. The caller reports
 *   it beside the rows (admin-window/BUG-0135) and falls back to fact 1 alone.
 * - `{ kind: "not_asked" }` — no count was issued for this kind, because this
 *   URL does not structurally narrow it (`kindsNarrowedBy`): fact 1 is false,
 *   `isSurfaceNarrowed` ANDs the two facts, so no count could change a word
 *   this block renders. **Not a refusal:** nothing failed, nothing is missing
 *   from the page, and there is nothing for the caller to report. **Not a
 *   zero:** a zero is a claim about the table, and this state makes none.
 */
export type KindPopulation = DbResult<number> | { kind: "not_asked" };

/**
 * One shape's whole-table row count: `{ head: true, count: "exact" }`, no rows.
 *
 * Built from `SHAPE_COLUMNS` in `src/lib/review/shapes.ts` — the one owner of
 * what a shape IS (§6: "the kind is derived in code, no column carries it").
 * This module spells no queue value and no null-check of its own; it spells
 * only the column NAMES the declaration names, which is what turns that
 * declaration into a query.
 *
 * No `.range` and no `.order`: a head count returns no rows, so there is
 * nothing to bound or to order, and `readComplete`'s ROW_CAP cannot apply to
 * it. That is the whole point — a `review_items` table of any size answers a
 * faceted `/queues` URL with its rows AND its populations
 * (admin-window/BUG-0135).
 */
function countQuery(db: SupabaseClient, shape: Shape) {
  const columns = columnsOfShape(shape);
  let builder = db
    .from(T.reviewItems)
    .select("*", { head: true, count: "exact" })
    .eq("queue", columns.queue);
  if (columns.sourceIdIsNull === true) {
    builder = builder.is("source_id", null);
  } else if (columns.sourceIdIsNull === false) {
    builder = builder.not("source_id", "is", null);
  }
  return builder as unknown as PromiseLike<{ count: number | null; error: unknown }>;
}

/**
 * Each kind's whole-table population, one COUNT read per shape — **for the
 * kinds whose population this URL's rendering actually consults.**
 *
 * The shapes are disjoint and exhaustive, so a kind's figure is the SUM of the
 * counts the database gave — never a subtraction from a table total and never
 * arithmetic between two reads. A shape whose count refused makes that kind's
 * population that refusal, so the number is one the database stated or it is
 * not a number at all (ARCHITECTURE.md §4.3; a null count is a refusal, never
 * a zero).
 *
 * The reads are issued in shape order within kind order — which is `SHAPES`
 * order — and answered together; one refusing says nothing about the others,
 * and the kind that did not need it is unaffected.
 *
 * **Which kinds, and why not all of them** (campaign admin-window/DEBT-0012).
 * The population exists to answer fact 2 of the four-state rule, and
 * `isSurfaceNarrowed` ANDs it with fact 1 — so for a kind this URL does not
 * structurally narrow, fact 1 is false and no count could change a word the
 * block renders. `kindsNarrowedBy` in `src/lib/review/queue-filters.ts` is that
 * question, imported rather than retyped, so the set counted here and the set
 * the page consults cannot come apart. On `/queues?kind=decision` that is the
 * signal kind alone (one count instead of three); on `?kind=signal`,
 * `?queue=entity_link` and `?shape=entity_link_source_pattern` it is the
 * decision kind alone (two instead of three); on a `?status=`/`?source_id=` URL
 * both kinds are narrowed and all three counts are issued, because both blocks
 * really do have a zero to explain.
 *
 * **The counts it does issue are never narrowed by the filter** — the source
 * facet included (admin-window/BUG-0141). The population is what a kind holds
 * with NO url facet at all, which is what lets a source carrying no items
 * render "nothing matched" rather than "this queue is empty"
 * (admin-window/BUG-0133). Narrowing these counts by the URL would make every
 * block's population equal its rendered set, and no block would ever name its
 * scope again. The filter reaches this function to decide WHICH kinds are
 * asked, and for nothing else — no `.eq` below comes from it.
 */
async function readPopulation(
  filter: ReviewItemFilter,
  db?: SupabaseClient,
): Promise<Record<Kind, KindPopulation>> {
  const asked = kindsNarrowedBy(filter);
  // One leg per shape of an asked kind, in `SHAPES` order (`KINDS` order
  // outside, `shapesOfKind` inside), all issued together.
  const legs = asked.flatMap((kind) =>
    shapesOfKind(kind).map((shape) => ({ kind, shape })),
  );
  const answered = await Promise.all(
    legs.map((leg) =>
      readCount(T.reviewItems, (client) => countQuery(client, leg.shape), db),
    ),
  );

  const population = {} as Record<Kind, KindPopulation>;
  for (const kind of KINDS) {
    if (!asked.includes(kind)) {
      population[kind] = { kind: "not_asked" };
      continue;
    }
    let total = 0;
    let refused: DbUnavailable | null = null;
    for (let index = 0; index < legs.length; index += 1) {
      if (legs[index].kind !== kind) continue;
      const counted = answered[index];
      if (counted.kind !== "ok") {
        refused = counted;
        break;
      }
      total += counted.data;
    }
    population[kind] = refused ?? { kind: "ok", data: total };
  }
  return population;
}

/**
 * Each kind's population read off rows the caller ALREADY holds — the whole
 * table, because the URL narrowed nothing.
 *
 * Not `summarizeByKind`: that counts OPEN items (attention), and a block's
 * unfiltered set is every row of its kind, settled ones included.
 */
function populationOfRows(items: ReviewItemRow[]): Record<Kind, KindPopulation> {
  const population = {} as Record<Kind, KindPopulation>;
  for (const kind of KINDS) {
    population[kind] = { kind: "ok", data: selectItems(items, { kind }).length };
  }
  return population;
}

/**
 * Does this filter ask the database for anything less than the whole table?
 *
 * Read off `ReviewItemFilter`'s own values rather than off `FACETS` in
 * `lib/review/queue-filters.ts`, because this question needs no vocabulary: any
 * defined field is a narrowing, whatever it is called. An explicitly-`undefined`
 * facet is no narrowing, which is exactly how `matchesFilter` reads it.
 *
 * **It is not an inversion to import that module, and this docstring used to say
 * it was** (corrected on campaign admin-window/DEBT-0012, which imports
 * `kindsNarrowedBy` from it above). `lib/review/**` is a PURE DOMAIN LEAF and
 * `lib/db/** -> lib/<leaf>/**` is the arrow as ARCHITECTURE.md §4 draws it —
 * this module has imported `../review/shapes` since TASK-0006. What rule 7
 * forbids is the back-edge, a leaf importing `lib/db/**`, and `queue-filters.ts`
 * has none: it imports `./shapes` and `lib/url/narrowing.ts` and nothing else.
 */
function narrows(filter: ReviewItemFilter): boolean {
  return Object.values(filter).some((value) => value !== undefined);
}

/**
 * The Queues page's read: the URL's own rows, and each kind's population
 * beside them.
 *
 * **The URL's own read decides the whole read** (admin-window/BUG-0135). This
 * is non-`ok` if and only if `listReviewItems(filter)` is: that leg is the one
 * the URL narrows and the one every rendered row comes from, so its refusal is
 * the page's. The population legs decide four words of a sub-line and which of
 * two empty cards shows, and render no row of their own — a refusal there is
 * carried per kind and REPORTED beside the rows, the way `/claims` reports a
 * source registry that would not read while every claim still renders. It used
 * to be returned as the whole read's refusal, which deleted the rows a
 * complete, database-narrowed read had already returned, on every faceted URL,
 * as soon as the table passed ROW_CAP.
 *
 * The population leg is now a per-shape COUNT (`readCount`, `head: true`), so
 * ROW_CAP cannot reach it at all; the FILTERED leg stays a COMPLETE read
 * (§4.3) and still refuses whole when it is truncated, because those rows
 * really are unknown.
 *
 * The bare `/queues` still costs exactly ONE query: an unnarrowed read IS the
 * whole table, so its own rows are the population.
 *
 * A narrowed URL costs that read plus one count per shape of each kind the URL
 * NARROWS, and no others (admin-window/DEBT-0012) — measured on the stub call
 * log in `tests/offline/review/review-items.test.ts`: 1 read bare, 2 on
 * `?kind=decision`, 3 on `?kind=signal`, 4 on `?status=open`.
 */
export async function readReviewQueues(
  filter: ReviewItemFilter = {},
  db?: SupabaseClient,
): Promise<DbResult<ReviewQueues>> {
  const filtered = await listReviewItems(filter, db);
  if (filtered.kind !== "ok") return filtered;
  const population = narrows(filter)
    ? await readPopulation(filter, db)
    : populationOfRows(filtered.data);
  return { kind: "ok", data: { items: filtered.data, population } };
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
