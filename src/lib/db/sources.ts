import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readComplete,
  readRows,
  type DbCountedResponse,
  type DbResponse,
  type DbResult,
} from "./result";
import { T } from "./tables";

/**
 * The source-registry STATE reads — campaign admin-window/TASK-0013.
 *
 * Authority: `contracts/admin-observability.md` §4 ("the sources state rows:
 * lifecycle, current tier, checkpoint, last run") and
 * `contracts/data-model.md` (Source registry — config + state).
 *
 * **Config is not state, and this module reads only state.** Everything the
 * registry holds — description, domains fed, usage, dials, legal status —
 * lives in the scraper repo's `registry/sources/<source>.yaml`, and spec §10
 * keeps scraper files out of Admin's runtime. So the columns below are the
 * `sources` TABLE's columns and nothing else; there is no config column here
 * and none may be invented.
 *
 * **The schema trap this module exists to contain** (ARCHITECTURE.md §6 trap
 * 6): `sources` has NO last-run column, and `runs.source` is TEXT WITH NO
 * FOREIGN KEY — deliberately, so a run against an unregistered source can
 * still write its row (migration `20260829000001`'s own column comment). A
 * source's last run is therefore matched BY NAME, in TypeScript, in this one
 * place; no other module joins these two tables.
 *
 * Every export returns a `DbResult` and never throws (§4.1) and the tables are
 * named through `T` alone (§4 rule 4), so a database lacking either object
 * renders the not-provisioned state naming the object the query asked for.
 */

/* ── rows, exactly as the scraper repo's migrations declare them ─────────── */

/**
 * The `sources` state row — migration `20260818000000`, whole.
 *
 * `lifecycle` and `tier` are Postgres enums (`source_lifecycle`,
 * `source_tier`) and `kind` is `source_kind`; they are typed `string` here
 * because a value the database holds and this app has never heard of must
 * still render verbatim rather than being narrowed away. `checkpoint` and
 * `note` are nullable, and a null is an absence the page renders as the dash —
 * never as a blank and never as a zero.
 */
export interface SourceRow {
  source_id: string;
  /** The stable identifier config, adapter and every observation agree on. */
  source: string;
  kind: string;
  /** `candidate -> trial -> active <-> paused -> retired`. */
  lifecycle: string;
  /** The source's CURRENT tier, which drifts — not `tier_at_apply` (§6 trap 5). */
  tier: string;
  /** One opaque resume token, readable and writable only by its adapter. */
  checkpoint: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A `runs` row, narrowed to what "last run" reads — migration
 * `20260829000001`.
 *
 * The twelve counts are NOT here: this is the source's last run, not the run
 * table (Cycles & runs renders those, and `OPEN-RUNS` in ARCHITECTURE.md §12
 * is what decides which of the 22 columns it shows). Reads are explicit
 * (§4.2), so the select list is the columns this surface actually renders.
 *
 * `ended_at` null is a run still in flight — or one that died without
 * completing its record; `outcome` is null for the same reason, and neither is
 * substituted with a word of ours.
 */
export interface LastRunRow {
  run_id: string;
  /** TEXT, no foreign key: this is what a source is matched to, by name. */
  source: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  failure_class: string | null;
  checkpoint_after: string | null;
  error_summary: string | null;
}

/**
 * A source state row with its last run resolved — what `/sources` renders.
 *
 * `lastRun` is `null` when the `runs` table holds no row for this source's
 * NAME. That null is the honest answer and is rendered as the dash: a source
 * that has never run is not a source that ran zero times.
 */
export interface SourceState extends SourceRow {
  lastRun: LastRunRow | null;
}

/** What a sources read may be narrowed by. The facet is spelled as the column is. */
export interface SourcesFilter {
  source_id?: string;
}

/* ── the reads ───────────────────────────────────────────────────────────── */

const SOURCE_COLUMNS = [
  "source_id",
  "source",
  "kind",
  "lifecycle",
  "tier",
  "checkpoint",
  "note",
  "created_at",
  "updated_at",
].join(", ");

const LAST_RUN_COLUMNS = [
  "run_id",
  "source",
  "started_at",
  "ended_at",
  "outcome",
  "failure_class",
  "checkpoint_after",
  "error_summary",
].join(", ");

/**
 * The registry's state rows, whole.
 *
 * A COMPLETE read (ARCHITECTURE.md §4.3): `{ count: "exact" }`, a total
 * server-side order ending in the primary key, and `.range(0, cap - 1)`. An
 * `ok` array is therefore every row the table holds — which is what makes the
 * live parity assertion ("the rendered source rows are the table's rows")
 * true rather than hopeful. Above the cap the read refuses with the real
 * number instead of rendering a partial registry as the registry.
 *
 * The order is the display order too: sources are read by NAME because that is
 * the identifier every other surface, log line and registry file spells, and
 * `source_id` breaks the tie the unique constraint on `source` already makes
 * impossible.
 */
export function readSources(db?: SupabaseClient): Promise<DbResult<SourceRow[]>> {
  return readComplete<SourceRow>(
    T.sources,
    (client, cap) =>
      client
        .from(T.sources)
        .select(SOURCE_COLUMNS, { count: "exact" })
        .order("source", { ascending: true })
        .order("source_id", { ascending: true })
        .range(0, cap - 1) as unknown as PromiseLike<DbCountedResponse<SourceRow[]>>,
    db,
  );
}

/**
 * The newest `runs` row for one source NAME — a WINDOW read (§4.3 kind 2)
 * whose window is exactly one row: the newest run this source has.
 *
 * `ok` carries `null` when the table holds no run for that name.
 *
 * **Why one read per source rather than one read over all of them.** A single
 * `.in("source", names)` scan ordered by `started_at desc` under a row cap
 * cannot tell "this source has never run" from "this source's runs fell off
 * the end of the window" — a busy source's runs would push a quiet source's
 * last run out, and the quiet source would then render the dash, which is the
 * one thing the dash may not mean here. PostgREST cannot express
 * `distinct on (source)`, and there is no aggregate beyond `count`
 * (`STACK.md` §2). So the bound is per source and exact: `limit(1)`, ordered
 * newest first, and the cost is one round trip per registered source — a
 * registry whose size `readSources` has already capped.
 */
export async function readLastRun(
  source: string,
  db?: SupabaseClient,
): Promise<DbResult<LastRunRow | null>> {
  const rows = await readRows<LastRunRow>(
    T.runs,
    (client) =>
      client
        .from(T.runs)
        .select(LAST_RUN_COLUMNS)
        // The name comparison migration `20260829000001` made the only
        // possible join: there is no key to join on, by design.
        .eq("source", source)
        .order("started_at", { ascending: false })
        // `run_id` is a uuid v7, so it breaks a tie on `started_at` in the
        // same direction time runs; the order is total either way.
        .order("run_id", { ascending: false })
        .limit(1) as unknown as PromiseLike<DbResponse<LastRunRow[]>>,
    db,
  );
  if (rows.kind !== "ok") return rows;
  return { kind: "ok", data: rows.data[0] ?? null };
}

/**
 * Every source, with its last run — the Sources page's read.
 *
 * Both legs report separately, exactly as `listClaims` does: a
 * `not_provisioned` from either names THAT object (`sources` or `runs`), so
 * the page's card says which one is absent rather than blaming the other.
 *
 * The read is deliberately NOT narrowed by the page's filter: `selectSources`
 * below does every narrowing, so the source column offers every source the
 * registry holds and not just the survivors of the current narrowing — the
 * same rule the Claims page's whole-set read follows.
 */
export async function listSources(
  db?: SupabaseClient,
): Promise<DbResult<SourceState[]>> {
  const sources = await readSources(db);
  if (sources.kind !== "ok") return sources;

  const states: SourceState[] = [];
  for (const row of sources.data) {
    const lastRun = await readLastRun(row.source, db);
    // The first refusal wins and is returned as it stands: a half-filled list
    // where some rows silently carry no run would present a read failure as
    // "this source has never run".
    if (lastRun.kind !== "ok") return lastRun;
    states.push({ ...row, lastRun: lastRun.data });
  }
  return { kind: "ok", data: states };
}

/* ── the one predicate ───────────────────────────────────────────────────── */

/**
 * The sources a filter keeps — the app's one predicate over source rows, so
 * "the rendered rows are the rows the narrowing selects" is a property of one
 * function rather than of every surface that narrows.
 *
 * A filter naming a `source_id` the registry does not hold keeps nothing: the
 * page offers only ids it read, so an unknown one is a URL nobody can reach by
 * clicking, and answering it with the whole registry would be a different page
 * than the one the URL asked for.
 */
export function selectSources(
  sources: readonly SourceState[],
  filter: SourcesFilter = {},
): SourceState[] {
  return sources.filter(
    (source) => filter.source_id === undefined || source.source_id === filter.source_id,
  );
}
