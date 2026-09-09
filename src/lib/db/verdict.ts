import {
  ROW_CAP,
  callFunction,
  readRows,
  readRowsByIds,
  type DbResponse,
  type DbResult,
  type DbUnavailable,
} from "./result";
import { FN, T, objectKindOf, type ObjectKind } from "./tables";
import type { DbClient } from "./gauges";
import { decisionRefusals, type VerdictDecision } from "../verdict/decision";

/**
 * The settlement seam — the ONE place in `src/` that calls a database
 * procedure (campaign admin-window/TASK-0048, ARCHITECTURE.md §9.2).
 *
 * Two exports, and between them they answer the whole of M2's write question:
 *
 *  - `readSettlementReadiness` — may a surface offer a settlement or an
 *    override at all?
 *  - `settleReviewItem` — the one call to `settle_review_item`.
 *
 * Both return a `DbResult` and neither throws, on every path (§4.1), so a
 * database without M2's handoff migration draws a card instead of a stack
 * trace. Seeded before the surfaces that need it because builders in isolated
 * worktrees cannot see each other's code (§13.7): four pages hand-copying a
 * readiness probe is common violation 9 happening again.
 *
 * **What must never be built here** (spec §10's one forbidden move, this
 * campaign's brightest line): no Admin-side workaround for the absent
 * function. No queued write, no "pending overrides" table, no retry buffer, no
 * flag-guarded direct write, no second path "until Ben installs it". When the
 * function is absent the surface degrades to what M1 already ships, with the
 * reason named. `apply_resolution` — which exists, and writes the catalog — is
 * not called from Admin at all, which is why `tables.ts` declines to spell it.
 *
 * **The client is OPTIONAL on both, as it is on every other read in this
 * layer** (`readRows`, `callFunction`, `readOne`: `db?: SupabaseClient`) —
 * widened by the close slot's ticket (campaign admin-window/TASK-0049), which
 * is the first caller that is not a test. A required client would oblige the
 * page and the route to call `getDbClient()` themselves, and that call THROWS
 * when a credential name is unset (`lib/db/client.ts`) — outside the `try`
 * that every classification happens inside, so the review-item page would 500
 * where M1 renders a named refusal at 200. Passing none resolves the app's own
 * client INSIDE that try, which is what keeps "neither throws, on every path"
 * true of the callers as well as of these two functions. Every call that
 * hands a client over — the offline seam suite, a live test — is unchanged.
 */

/**
 * The row `settle_review_item` returns, as this app reads it.
 *
 * Five of the seven columns of `verdicts` (`contracts/admin-observability.md`
 * §7): the receipt a surface can show or link. `actor` and `note` are the
 * caller's own decision echoed back and are deliberately not read here — the
 * surface already has them.
 */
export interface VerdictReceipt {
  readonly verdict_id: string;
  readonly review_item_id: string | null;
  readonly action: string;
  readonly observation_id: string | null;
  readonly created_at: string;
}

/**
 * The one argument name `settle_review_item` takes, and it is part of the
 * contract rather than a detail.
 *
 * PostgREST resolves an RPC by name AND by argument names, and answers
 * `PGRST202` for an installed function called with the wrong ones — the same
 * code it answers for a function that is not there at all, and the app cannot
 * tell the two apart (measured 2026-09-08, admin-window/TASK-0047; the shape
 * is `functionNotInSchemaCache` in `tests/fixtures/stub-client.ts`). Spell it
 * wrong and a provisioned function renders as an absent one, permanently and
 * silently. So it is spelled ONCE, here, exported, so the handoff artifact's
 * own offline test can assert the SQL's parameter name against it in the way
 * that test already asserts the `action` CHECK against `VERDICT_ACTIONS`.
 *
 * `p_decision`, a jsonb argument, following the two shipped idioms in the
 * sibling repo (`apply_resolution(p_decisions jsonb)`,
 * `ingest_observations(p_batch jsonb)`) — ARCHITECTURE.md §9.2.
 */
export const SETTLE_ARGUMENT = "p_decision";

/**
 * How many rows a readiness read asks the database for. Zero: the question is
 * whether the object is THERE, and no verdict data is needed to answer it.
 */
const READINESS_ROWS = 0;

/**
 * What an `error` result says when the decision never left the app. The
 * refusal identifiers follow it, comma-separated, in `decisionRefusals`'
 * own order.
 *
 * It is an identifier for a caller to branch on, not operator copy: the words
 * a person reads are the surface's (LESSONS 5).
 */
export const REFUSED_BEFORE_SEND = "the decision was refused before it was sent:";

/** What an `error` result says when the call succeeded but returned no row. */
export const NO_RECEIPT =
  `the call succeeded but returned no ${FN.settleReviewItem} row, so whether ` +
  `the verdict landed is unknown`;

/**
 * The receipt in whatever envelope the function returns it, or `null` when
 * what came back is not one.
 *
 * A PostgREST function returning a row hands back an object; one declared
 * `returns setof` hands back an array. Both are read here rather than one
 * being assumed, because the artifact that installs the function is authored
 * separately (SPEC F9) and a seam that only understands one envelope would
 * turn the other into a silent failure. Anything else — `null`, a scalar, an
 * empty set, an object without the three not-null columns — is not a receipt,
 * and the caller is told so rather than handed a half-built one.
 */
function receiptOf(data: unknown): VerdictReceipt | null {
  const row = Array.isArray(data) ? (data.length > 0 ? data[0] : null) : data;
  if (typeof row !== "object" || row === null) return null;

  const fields = row as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof fields[key] === "string" ? (fields[key] as string) : null;

  const verdictId = text("verdict_id");
  const action = text("action");
  const createdAt = text("created_at");
  if (verdictId === null || action === null || createdAt === null) return null;

  return {
    verdict_id: verdictId,
    review_item_id: text("review_item_id"),
    action,
    observation_id: text("observation_id"),
    created_at: createdAt,
  };
}

/**
 * THE one call: settle a review item, or land an item-less override, through
 * `settle_review_item` (spec §7, ARCHITECTURE.md §9.2).
 *
 * `decisionRefusals` runs FIRST, and a refused decision never reaches the
 * database: the result is an `error` naming every refusal that applies, so a
 * malformed payload is a named refusal rather than a Postgres exception. The
 * form is a courtesy guard and the function's own `raise` is the contract;
 * this is the third, and it is the one that cannot be skipped by a client that
 * does not use the form.
 *
 * On the wire it is one call in one transaction — there is no client-side
 * multi-step settlement and no second write path. Absence is the normal case
 * for the whole of M2: `settle_review_item` is not installed on staging or in
 * production, so `PGRST202` / `42883` come back and `callFunction` classifies
 * them `not_provisioned` naming the function (admin-window/BUG-0080: an
 * absence claim follows what was ASKED, and this seam is what asks for a
 * function).
 */
export async function settleReviewItem(
  client: DbClient | undefined,
  decision: VerdictDecision,
): Promise<DbResult<VerdictReceipt>> {
  const refusals = decisionRefusals(decision);
  if (refusals.length > 0) {
    return {
      kind: "error",
      reading: FN.settleReviewItem,
      message: `${REFUSED_BEFORE_SEND} ${refusals.join(", ")}`,
    };
  }

  const result = await callFunction<unknown>(
    FN.settleReviewItem,
    (db) => db.rpc(FN.settleReviewItem, { [SETTLE_ARGUMENT]: decision }),
    client,
  );
  if (result.kind !== "ok") return result;

  const receipt = receiptOf(result.data);
  if (receipt === null) {
    return { kind: "error", reading: FN.settleReviewItem, message: NO_RECEIPT };
  }
  return { kind: "ok", data: receipt };
}

/**
 * May a surface offer a settlement or an override at all?
 *
 * `ok` — yes. `not_provisioned` naming `verdicts` — no: the surface renders
 * the card and offers no control. `error` — the database refused the question
 * and the surface says so rather than guessing an answer.
 *
 * **It reads the `verdicts` TABLE, and never calls the function** (ruled
 * 2026-09-08, DECISIONS; ARCHITECTURE.md §9.2). PostgREST cannot introspect a
 * function without calling it, and calling `settle_review_item` to find out
 * whether it exists is a write attempt dressed as a probe. Reading the table
 * instead is honest because the two migrations install together and the
 * function's own artifact writes the table it depends on, so "table present,
 * function absent" is a state the handoff cannot produce — and if it arrives
 * anyway, `settleReviewItem` answers `not_provisioned` naming the function and
 * the same card is drawn after the click.
 *
 * **Why a GET-shaped read and not the `head: true` count the ruling sketched.**
 * Measured read-only on the declared staging target
 * (`ubfjjqlvnpnoborczbdb.supabase.co`) 2026-09-08, against `verdicts`, which is
 * genuinely absent there:
 *
 *   - `.select("*", { head: true, count: "exact" })` answers **`error === null`,
 *     `count === null`, status 204** — supabase-js parses its error out of the
 *     response BODY and a HEAD response has none (the raw request is a 404 with
 *     zero bytes). Through `readCount` that is `kind: "error"` ("the query
 *     returned no count"), so the graded-first normal case would render the
 *     WRONG card, and no offline stub could show it (LESSONS 4; the same
 *     body-less-HEAD fact is admin-window/TASK-0032 and ARCHITECTURE.md §10).
 *   - `.select("*").limit(0)` answers **`PGRST205`** with the full body — which
 *     `classify` turns into `not_provisioned` naming `verdicts` — and, against
 *     a table that IS there, **200 with zero rows** (`groups`, same probe).
 *
 * So the read is GET-shaped and bounded to zero rows: exactly one round trip,
 * no verdict data crosses the wire, and the absence classifies. It asks for no
 * count and publishes no figure, so it is not a §4.3 complete read and nothing
 * may present its result as one.
 */
export async function readSettlementReadiness(
  client?: DbClient,
): Promise<DbResult<"ready">> {
  const result = await readRows<unknown>(
    T.verdicts,
    (db) => db.from(T.verdicts).select("*").limit(READINESS_ROWS),
    client,
  );
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: "ready" };
}

/* ── the verdict log ──────────────────────────────────────────────────────── */

/**
 * What the log's window read runs OVER — the word its window line ends its
 * bound clause on.
 *
 * Derived from the same `T.*` constant the query passes to `.from()`, in the
 * module that issues the query, so no page and no component gets a say: the
 * object a window was read over is a fact of the READ
 * (admin-window/BUG-0077, admin-window/DEBT-0006).
 */
export const VERDICTS_OBJECT: ObjectKind = objectKindOf(T.verdicts);

/**
 * The columns the log renders, spelled explicitly (ARCHITECTURE.md §4.2).
 *
 * All seven of `contracts/admin-observability.md` §7's table, because the log
 * shows all seven. Explicit rather than `*` for the reason
 * admin-window/BUG-0024 records: a name this table does not have must come
 * back as a `42703` naming the column, not as a silently wider row.
 */
const VERDICT_LOG_COLUMNS =
  "verdict_id, review_item_id, actor, action, observation_id, note, created_at";

/** The columns the observation leg needs, and nothing else. */
const OBSERVATION_FACT_COLUMNS = "observation_id, domain, entity_id";

/**
 * How many verdicts the log's tab shows.
 *
 * The log grows for as long as admins settle things, so "every verdict there
 * has ever been" is not a set a page can hold or a reader can want
 * (ARCHITECTURE.md §4.3, read kind 2). A hundred newest is a session's worth
 * of history at a glance; the tab states the window in words beside the table,
 * so the last row on screen is never mistaken for the last verdict that
 * exists.
 */
export const VERDICT_WINDOW = 100;

/** One row of `verdicts`, as the log reads it — §7's seven columns. */
export interface VerdictLogRow {
  readonly verdict_id: string;
  /** Null on an `override` from the record surface, and only there. */
  readonly review_item_id: string | null;
  readonly actor: string;
  readonly action: string;
  /** Null on a settle-only verdict — nothing was observed. */
  readonly observation_id: string | null;
  readonly note: string | null;
  readonly created_at: string;
}

/**
 * Where one observation's fact lives: the canonical row it is about.
 *
 * `verdicts` carries the observation's id and nothing else about it, and this
 * app has no observation-addressable URL — the one place a rendered
 * observation already leads is the RECORD surface of its fact
 * (`src/components/claims/claim-list.tsx`, the `record` column, whose href is
 * `recordHref(domain, entity_id)`). So the log resolves the id the same way,
 * through the second leg of a two-step join (ARCHITECTURE.md §4.2).
 */
export interface ObservationFact {
  readonly observation_id: string;
  readonly domain: string;
  readonly entity_id: string | null;
}

/** The window of verdicts a read returned, and what it could resolve of them. */
export interface VerdictLogWindow {
  /** The verdicts, newest first. */
  readonly rows: VerdictLogRow[];
  /** The cap the query carried. */
  readonly limit: number;
  /**
   * The read came back with exactly its cap, so older verdicts exist and were
   * not returned. The tab says so rather than letting the last row read as the
   * oldest verdict there is.
   */
  readonly truncated: boolean;
  /**
   * The fact each rendered `observation_id` is about, for the rows whose
   * observation still has a row. An id missing from this map is rendered
   * verbatim, unlinked — never dropped and never dashed, because the verdict
   * really does carry it.
   */
  readonly facts: ReadonlyMap<string, ObservationFact>;
  /**
   * The observation leg's refusal, when that ONE leg refused — `null`
   * otherwise.
   *
   * Carried BESIDE the rows rather than returned instead of them, exactly as
   * `readItemEvidence` carries `sourcesUnavailable` (`lib/db/review-item.ts`):
   * a missing `observations` costs this surface a LINK, never a verdict. The
   * verdicts themselves were read, and dropping them would tell an operator
   * that no admin action was ever taken when every one of them is in hand
   * (admin-window/BUG-0021).
   */
  readonly factsUnavailable: DbUnavailable | null;
}

/**
 * A sane row count: at least one row, never more than the platform will
 * return. `limit(0)` and `limit(NaN)` are the defects a bound exists to
 * prevent, and asking for more rows than PostgREST hands back makes the server
 * truncate silently (ARCHITECTURE.md §4.3, admin-window/BUG-0009).
 */
function windowSize(limit: number): number {
  if (!Number.isFinite(limit)) return VERDICT_WINDOW;
  return Math.max(1, Math.min(Math.floor(limit), ROW_CAP));
}

/**
 * The display order: **newest first by `created_at`**, `verdict_id` descending
 * where two verdicts share an instant.
 *
 * The query already asks for exactly this order, so this sort normally changes
 * nothing — it is here because "newest first" is a stated property of the
 * surface (spec F13) and must not depend on a transport keeping its promise.
 * A timestamp that will not parse sorts last rather than poisoning the
 * comparison, so the row still renders, at the end, where the unreadable
 * `created_at` is visible instead of silently reordering the verdicts above
 * it. The input is not mutated.
 */
export function newestFirst(rows: readonly VerdictLogRow[]): VerdictLogRow[] {
  return [...rows].sort((a, b) => {
    const left = Date.parse(a.created_at);
    const right = Date.parse(b.created_at);
    const leftBad = Number.isNaN(left);
    const rightBad = Number.isNaN(right);
    if (leftBad !== rightBad) return leftBad ? 1 : -1;
    if (!leftBad && !rightBad && left !== right) return right - left;
    return a.verdict_id < b.verdict_id ? 1 : a.verdict_id > b.verdict_id ? -1 : 0;
  });
}

/** The facts behind a set of observation ids — the join's second leg (§4.2). */
function readObservationFacts(
  ids: readonly string[],
  db?: DbClient,
): Promise<DbResult<ObservationFact[]>> {
  return readRowsByIds<ObservationFact>(
    T.observations,
    ids,
    (client, chunkIds) =>
      client
        .from(T.observations)
        .select(OBSERVATION_FACT_COLUMNS)
        .in("observation_id", chunkIds)
        // At most one row per id — `observation_id` is the table's key — so
        // the leg can never ask for more rows than the ids it filtered on.
        .limit(chunkIds.length) as unknown as PromiseLike<
        DbResponse<ObservationFact[]>
      >,
    db,
  );
}

/**
 * The newest verdicts, newest first — the log's one read (spec F13).
 *
 * **Which read kind, and why** (ARCHITECTURE.md §4.3): a **WINDOW**, kind 2.
 * The log is append-only and grows with every admin action, so no surface may
 * claim to hold all of it; the window is stated in the query — a total
 * `.order()` newest first, then an explicit `.limit()` — and the tab says
 * which window it is showing, beside the table. No figure on that table is
 * computed from these rows: every value in it is a column of the row it sits
 * in, which is the same licence `lib/db/cycles.ts` reads under.
 *
 * The order is total — `created_at` descending then the primary key — so two
 * verdicts landing on the same instant cannot swap places between reloads and
 * the window is the same window twice running.
 *
 * **Absence is the graded normal case.** `verdicts` is not on staging and not
 * in production, so this returns `not_provisioned` naming `verdicts`, the tab
 * draws that card, and no window line is published for a read that never
 * returned (ARCHITECTURE.md §4.3, DECISIONS 2026-09-04).
 *
 * The observation leg runs only when the first read RETURNED rows carrying an
 * `observation_id`: an absent `verdicts` asks `observations` nothing at all.
 */
export async function readVerdictLog(
  limit: number = VERDICT_WINDOW,
  db?: DbClient,
): Promise<DbResult<VerdictLogWindow>> {
  const size = windowSize(limit);
  const result = await readRows<VerdictLogRow>(
    T.verdicts,
    (client) =>
      client
        .from(T.verdicts)
        .select(VERDICT_LOG_COLUMNS)
        .order("created_at", { ascending: false })
        .order("verdict_id", { ascending: false })
        .limit(size) as unknown as PromiseLike<DbResponse<VerdictLogRow[]>>,
    db,
  );
  if (result.kind !== "ok") return result;

  const rows = newestFirst(result.data);
  const ids = [
    ...new Set(
      rows
        .map((row) => row.observation_id)
        .filter((id): id is string => id !== null && id.length > 0),
    ),
  ];
  const observed = await readObservationFacts(ids, db);

  return {
    kind: "ok",
    data: {
      rows,
      limit: size,
      truncated: result.data.length >= size,
      facts:
        observed.kind === "ok"
          ? new Map(observed.data.map((fact) => [fact.observation_id, fact]))
          : new Map(),
      factsUnavailable: observed.kind === "ok" ? null : observed,
    },
  };
}
