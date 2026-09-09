import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readComplete,
  readRowsByIds,
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

/**
 * A source's id and the name an operator reads — the label leg's row.
 *
 * Structurally the same pair `lib/browse/rows.ts` and `lib/records/provenance.ts`
 * each declare for their own joins; those two are pure leaves and may not
 * import this module (ARCHITECTURE.md §4 rule 7), so the shape is stated here
 * for the readers that live above it rather than imported across that edge.
 */
export interface SourceNameRow {
  source_id: string;
  source: string;
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

/**
 * The two columns a LABEL needs. `readSourceNames` answers "what is this
 * source called", so it selects the name and the key it is asked by, and
 * nothing else (§4.2).
 */
const SOURCE_NAME_COLUMNS = ["source_id", "source"].join(", ");

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
 * The NAME each of a set of source ids is known by — campaign
 * admin-window/BUG-0043.
 *
 * A second leg (§4.2's two-step) for the surfaces whose own read keys a source
 * by `source_id` and has no name to show for it: `/claims` renders one per row
 * and one per filter chip, and the rest of the app has always shown the name
 * (`/sources`, `/browse`, a record's provenance, the Dashboard's runs table).
 *
 * Two columns, not nine: reads are explicit (§4.2) and this leg's whole job is
 * the label. It is `readRowsByIds`, so no ids means no round trip and an id
 * the registry holds no row for simply comes back missing — `sourceLabel` in
 * `lib/sources/names.ts` renders that id verbatim rather than guessing.
 *
 * A REFUSAL here costs a label and nothing else, which is why the caller is
 * free to render the ids it already has beside the reported failure; it is not
 * `readComplete`, because the caller asked for a named id set rather than "the
 * registry", and there is nothing to be partial about.
 */
export function readSourceNames(
  ids: readonly string[],
  db?: SupabaseClient,
): Promise<DbResult<SourceNameRow[]>> {
  return readRowsByIds<SourceNameRow>(
    T.sources,
    ids,
    (client, chunkIds) =>
      client
        .from(T.sources)
        .select(SOURCE_NAME_COLUMNS)
        .in("source_id", chunkIds)
        // At most one row per id — `source_id` is the table's key — so the leg
        // can never ask for more rows than the ids it filtered on.
        .limit(chunkIds.length) as unknown as PromiseLike<
        DbResponse<SourceNameRow[]>
      >,
    db,
  );
}

/**
 * Every run the table holds, newest first within each source NAME — **ONE
 * request**, whatever the registry holds (campaign admin-window/BUG-0139).
 *
 * A COMPLETE read (ARCHITECTURE.md §4.3 kind 1): `{ count: "exact" }`, a total
 * server order, and `.range(0, cap - 1)` through `readComplete`, so the `ok`
 * array is the WHOLE `runs` table or the read refuses naming `runs` with the
 * real number. That is what keeps "this source has never run" an absence in a
 * COMPLETE SET rather than a row that fell off the end of a window — the one
 * thing the dash on this page may not mean, and the objection the per-source
 * `limit 1` seek this replaces was written to answer.
 *
 * The order is the fold's contract: `source` groups the names, `started_at`
 * descending puts each name's newest run first, and `run_id` — a uuid v7 —
 * breaks a tie in the same direction time runs, so the order is total and the
 * first row carrying a name is that name's newest run.
 *
 * **Unnarrowed on purpose.** `.in("source", names)` would need the registry's
 * names first, which is the sequential round trip this replaces, and above
 * `ID_CHUNK` names it would have to chunk — at which point "exactly one
 * request" stops being true. Needing no name, it runs CONCURRENTLY with the
 * registry read. A run whose `source` matches no registered source is simply
 * matched by nobody (there is no foreign key to prevent one — §6 trap 6).
 *
 * The cost of the ruling, recorded where the next reader meets it: `runs` is
 * one row per adapter invocation and has no retention policy, so on the day it
 * outgrows `ROW_CAP` this read refuses and the page says so with the real
 * number instead of rendering a registry whose last-run column is quietly
 * wrong. The fix for that day is a retention policy or a per-source seek, and
 * both live in the scraper repo.
 */
export function readLastRuns(db?: SupabaseClient): Promise<DbResult<LastRunRow[]>> {
  return readComplete<LastRunRow>(
    T.runs,
    (client, cap) =>
      client
        .from(T.runs)
        .select(LAST_RUN_COLUMNS, { count: "exact" })
        .order("source", { ascending: true })
        .order("started_at", { ascending: false })
        // `run_id` is a uuid v7, so it breaks a tie on `started_at` in the
        // same direction time runs; the order is total either way.
        .order("run_id", { ascending: false })
        .range(0, cap - 1) as unknown as PromiseLike<DbCountedResponse<LastRunRow[]>>,
    db,
  );
}

/**
 * The newest run per source NAME, out of that complete set — a pure fold, no
 * read and no clock (campaign admin-window/BUG-0139).
 *
 * **The rows' ORDER is the input, not a hint.** `readLastRuns` asks the server
 * for `source asc, started_at desc, run_id desc`, so the newest run for a name
 * is the FIRST row carrying it and every later row with that name is an older
 * run of the same source. Nothing is re-sorted here: the comparison that
 * decides "newest" is the database's, over its own column types, and the chain
 * that asks for it is pinned in `tests/offline/sources/read.test.ts`. A name
 * the set holds no row for is simply absent from the map, which is how the
 * caller tells "has never run" from a run it could not read.
 */
export function lastRunBySource(
  runs: readonly LastRunRow[],
): ReadonlyMap<string, LastRunRow> {
  const newest = new Map<string, LastRunRow>();
  for (const run of runs) {
    if (!newest.has(run.source)) newest.set(run.source, run);
  }
  return newest;
}

/**
 * Every source, with its last run — the Sources page's read.
 *
 * **Two requests, not one per source** (campaign admin-window/BUG-0139): the
 * registry and the whole run log, issued TOGETHER because neither needs
 * anything from the other, then matched by NAME in this one place (§6 trap 6:
 * there is no key to join on, by design). It was `readSources()` followed by a
 * `readLastRun` per registered source, awaited in a loop — four sequential
 * round trips for three sources and thirty-one for thirty, which is most of
 * the 2.0-2.3 s Ben measured on the walk instance.
 *
 * Both legs report separately, exactly as before: a `not_provisioned` from
 * either names THAT object (`sources` or `runs`), so the page's card says
 * which one is absent rather than blaming the other, and the registry's
 * refusal is the one returned when both fail — the first refusal wins, as it
 * did when the legs ran in sequence. A half-filled list where some rows
 * silently carry no run would present a read failure as "this source has never
 * run".
 *
 * The read is deliberately NOT narrowed by the page's filter: `selectSources`
 * below does every narrowing, so the source column offers every source the
 * registry holds and not just the survivors of the current narrowing — the
 * same rule the Claims page's whole-set read follows.
 */
export async function listSources(
  db?: SupabaseClient,
): Promise<DbResult<SourceState[]>> {
  const [sources, runs] = await Promise.all([readSources(db), readLastRuns(db)]);
  if (sources.kind !== "ok") return sources;
  if (runs.kind !== "ok") return runs;

  const newest = lastRunBySource(runs.data);
  return {
    kind: "ok",
    data: sources.data.map((row) => ({
      ...row,
      lastRun: newest.get(row.source) ?? null,
    })),
  };
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
