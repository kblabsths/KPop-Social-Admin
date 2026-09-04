import {
  AdapterRuns,
  AskedCycle,
  CYCLES_SURFACE,
  CYCLES_WINDOW,
  CycleHealthSection,
  HEALTH_SURFACE,
  LATENCY_SURFACE,
  LatencySection,
  LatestRun,
  NOTHING_RECORDED,
  RUNS_ANCHOR,
  cycleColumns,
  type AskedCycleState,
} from "@/components/cycles";
import { DataTable, Empty, Page, Section, StateOf, WindowLine } from "@/components/ui";
import {
  CYCLES_OBJECT,
  CYCLE_COUNTERS,
  CYCLE_WINDOW,
  readCycles,
  type ResolutionRunRow,
} from "@/lib/db/cycles";
import type { DbUnavailable } from "@/lib/db/result";
import {
  RUNS_OBJECT,
  RUN_COLUMNS,
  RUN_COUNTS,
  RUN_WINDOW,
  narrowedTo,
  readRuns,
} from "@/lib/db/runs";
import { duration } from "@/lib/format";
import { CYCLE_OUTCOME_KEYS, readCycleHealth } from "@/lib/gauges/cycle-health";
import { RESOLVER_CADENCE_SECONDS, secondsBetween } from "@/lib/gauges/gauge";
import { readResolutionLatency } from "@/lib/gauges/resolution-latency";

/**
 * Cycles & runs — **the resolver's cycles, diagnosed from their rows**
 * (campaign admin-window/TASK-0014).
 *
 * Authority: spec §4 ("`resolution_runs` … newest first, with the counts as
 * columns and `error_summary` inline"), §5 (the cycle-health and
 * resolution-latency gauges live here), `contracts/resolver.md` §6 (the row
 * and every column's meaning), LOOK_AND_FEEL ("Cycles & runs … is the
 * data-table rule applied; it carries no bespoke layout"; taste reference
 * "GitHub Actions run list — a run diagnosed from its row").
 *
 * Three rules this page is built on:
 *
 *  - **A cycle's state is read from two columns, not one.** `outcome` is null
 *    until completion by design, so a row with neither an `ended_at` nor an
 *    outcome is either a cycle still going or one that died — and migration
 *    `20260901000001` says which: "a null older than one cadence is how a
 *    crash stays visible". `cycleState` in `lib/cycles/state.ts` is the one
 *    place that is decided; nothing here re-derives it.
 *  - **Every latency figure is the AGGREGATE's.** `readResolutionLatency`
 *    returns counts (`applies`, `verdictUnsets`, `unmatchedApplies`) already
 *    separated from the raw window it read, and this page renders those. A
 *    figure re-derived from a row array over-counts by exactly the unsets
 *    (admin-window/BUG-0012), which is why the page never takes the rows at
 *    all — `readResolutionLatency` hands it no rows to take.
 *  - **The adapter framework's `runs` are the page's other half, and they show
 *    exactly nine of that table's 22 columns** — Ben's ruling of 2026-09-02,
 *    a dated paragraph in `agenticflow/docs/DECISIONS.md`
 *    (admin-window/TASK-0016). The set is `RUN_COLUMNS` in
 *    `src/lib/db/runs.ts` and the table is generated from it, so a tenth
 *    column cannot arrive here without re-opening that decision. The two
 *    halves read two tables and fail independently: with `runs` absent the
 *    runs section renders its not-provisioned state and the cycles above it
 *    are untouched.
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, and every child is a pure sync
 * component with plain props — which is what lets the offline suite render
 * `renderToStaticMarkup(await CyclesPage(props))` with no jsdom and no
 * database, and the live suite compare its rows against rows the test reads
 * itself.
 *
 * **Those children live in `src/components/cycles/`** (campaign
 * admin-window/DEBT-0004, ARCHITECTURE.md §13.6), beside every other page's,
 * rather than where this page function is. What crosses the seam is plain
 * props: the reads themselves, the clock, and the two ordered vocabularies the
 * reads asked for (`CYCLE_COUNTERS`, `RUN_COLUMNS`/`RUN_COUNTS`) — a component
 * imports no `lib/db` module, which is what keeps every surface below
 * renderable with no client at all.
 *
 * **Nothing settles anything in M1**: every control in this markup is a link.
 */

/**
 * Four reads happen per request against the live database, so the route
 * renders per request rather than being prerendered at build time
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
 * "Route segment config"). Reading `searchParams` already opts this page in,
 * but the prop is optional — the shell's route test renders every page with no
 * props at all — and a page prerendered at build, where the app has no
 * credential, would ship a FROZEN error state that never re-reads.
 */
export const dynamic = "force-dynamic";

/**
 * The facet this page consumes: the Dashboard links a cycle line to
 * `/cycles?cycle=<run_id>` (`lineHref` in `src/app/page.tsx`), so the URL
 * names the row the operator came to read and this page marks it.
 *
 * One more parameter reaches this route today and narrows NOTHING here:
 * `run=<run_id>` (the Dashboard's run lines). It is not guessed at — an
 * unrecognised parameter narrows nothing rather than erroring, so the link
 * lands on this page rather than dead-ending.
 */
const CYCLE_FACET = "cycle";

/**
 * The Sources page links each source to `/cycles?source=<name>`, and that
 * facet narrows the ADAPTER half — matched by NAME, because `runs.source` is
 * text with no foreign key (ARCHITECTURE.md §6 trap 6, Ben's ruling
 * 2026-09-02).
 *
 * It narrows THAT HALF ONLY: `resolution_runs` carries no source column at
 * all, so filtering the cycles by it would be an invention. The page says so
 * in one sentence beside the runs table rather than either ignoring the
 * parameter silently — which is what it did until admin-window/TASK-0016 —
 * or pretending the cycles above were narrowed too.
 */
const SOURCE_FACET = "source";

/** The eyebrow each gauge's state card carries, so an absent gauge names its knob. */
const HEALTH_LABEL = "Cycle health";
const LATENCY_LABEL = "Resolution latency";

/* ── the URL, which is the whole of this page's state ────────────────────── */

/** A `searchParams` value, in every shape Next can hand one over. */
type ParamValue = string | string[] | undefined;

/** The `searchParams` object a page awaits. */
type SearchParams = Record<string, ParamValue>;

/**
 * The FIRST value the URL carries for a key. `?cycle=a&cycle=b` is ambiguous
 * state and the web platform already answers it — `URLSearchParams.get()`
 * returns the first — so a hand-edited URL lands on a real, bookmarkable state
 * rather than an error page.
 */
function firstValue(value: ParamValue): string | undefined {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value;
}

/** Which object a failed read names, in the spelling its own query used. */
function readingOf(result: DbUnavailable): string {
  return result.kind === "not_provisioned" ? result.missing : result.reading;
}

export default async function CyclesPage({
  searchParams,
}: {
  /**
   * Next 16 hands `searchParams` over as a promise
   * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
   * Optional, so the page also renders standing alone with no props, the way
   * the shell's route test calls every page.
   */
  searchParams?: Promise<SearchParams>;
} = {}) {
  const params = (await searchParams) ?? {};
  const askedFor = firstValue(params[CYCLE_FACET]);
  // A `?source=` carrying nothing narrows nothing and earns no sentence: it is
  // half a typed URL, not a request for the runs of the empty name.
  const askedSource = narrowedTo(firstValue(params[SOURCE_FACET])) ?? undefined;

  // One clock for the whole render: every age on the page, and the
  // running-or-died reading of every row, is measured against the same
  // instant. Reading the clock per row would let two rows disagree.
  const now = new Date().toISOString();

  // Four reads, concurrent and reported separately: each table and each gauge
  // fails on its own, so an absent `field_provenance` never takes the cycle
  // table down with it and an absent `runs` never takes the cycles half down
  // with it (ARCHITECTURE.md §4.1).
  const [cycles, runs, health, latency] = await Promise.all([
    readCycles(),
    readRuns({ source: askedSource }),
    // The same instant the table ages its rows against: the gauge tells the
    // same three no-outcome states apart, with the same `cycleState`, and two
    // clocks read milliseconds apart could put one row on either side of the
    // cadence boundary (admin-window/BUG-0055).
    readCycleHealth({ now }),
    readResolutionLatency(),
  ]);

  const rows = cycles.kind === "ok" ? cycles.data.rows : [];
  const cyclesTruncated = cycles.kind === "ok" && cycles.data.truncated;
  // A verdict about the asked-for cycle comes off an `ok` read and nothing
  // else: a refused or absent read leaves the page with no window to have
  // looked in, which is a third state and not a negative one
  // (admin-window/BUG-0023).
  const asked: AskedCycleState =
    cycles.kind !== "ok"
      ? { kind: "unchecked", reading: readingOf(cycles) }
      : rows.some((row) => row.run_id === askedFor)
        ? { kind: "found" }
        : { kind: "absent" };

  return (
    <Page title="Cycles & runs">
      {/* The newest run leads the page, because bar 1 asks for it above the
          fold and the cycles window below is up to 200 rows tall
          (admin-window/BUG-0040). It is the first row of that same window,
          repeated — never a second read. */}
      <LatestRun
        runs={runs}
        now={now}
        source={askedSource}
        columns={RUN_COLUMNS}
        counts={RUN_COUNTS}
      />

      <Section title="Cycles" surface={CYCLES_SURFACE}>
        {/* The window line describes a window this page actually read. A
            refused, absent or transport-failed read returned none, so the
            sentence would describe a table that is not there and
            `data-window-truncated="false"` would be a confident boolean about
            a read that returned nothing (LOOK_AND_FEEL states 3 and 4,
            ARCHITECTURE.md "a null count is a refusal, never a zero"). An
            EMPTY window is still a window — the page looked, and nothing was
            there — so it keeps its line. Same rule and same shape as
            `AdapterRuns` below and `/claims` (admin-window/BUG-0067). */}
        {cycles.kind === "ok" ? (
          <WindowLine
            gauge={CYCLES_WINDOW}
            window={{
              limit: CYCLE_WINDOW,
              held: rows.length,
              truncated: cyclesTruncated,
              over: CYCLES_OBJECT,
            }}
            shows={{
              of: "newest",
              lede: "The resolver’s newest cycles, newest first",
              rows: "cycles",
            }}
          />
        ) : null}
        {askedFor === undefined ? null : (
          <AskedCycle askedFor={askedFor} state={asked} limit={CYCLE_WINDOW} />
        )}
        {cycles.kind === "not_provisioned" ? (
          // A card replaces the surface; nothing above it describes a table
          // that is not there (LOOK_AND_FEEL state 3).
          <StateOf result={cycles} />
        ) : cycles.kind === "ok" && rows.length === 0 ? (
          <div data-empty="cycles">
            <Empty holds={NOTHING_RECORDED.holds} filledBy={NOTHING_RECORDED.filledBy} />
          </div>
        ) : (
          <DataTable<ResolutionRunRow>
            label="Cycles"
            columns={cycleColumns({
              now,
              askedFor,
              counters: CYCLE_COUNTERS,
              cadenceSeconds: RESOLVER_CADENCE_SECONDS,
              durationOf: (row) => secondsBetween(row.started_at, row.ended_at),
            })}
            rows={rows}
            rowKey={(row) => row.run_id}
            // What "is marked in the table below" means on screen: the asked-for
            // row is drawn as the marked row (admin-window/BUG-0054). The same
            // predicate decides the row's `aria-current` in `cycleColumns`, so
            // the drawn mark and the accessible one can never name different
            // rows.
            marked={
              askedFor === undefined ? undefined : (row) => row.run_id === askedFor
            }
            placeholder={
              cycles.kind === "error" ? <StateOf result={cycles} /> : undefined
            }
          />
        )}
        <p className="type-body text-ink-secondary">
          A cycle with no end and no outcome is still running — until it is
          older than the resolver&rsquo;s{" "}
          {duration(RESOLVER_CADENCE_SECONDS)} cadence, at which point it is a
          cycle that died: nothing rewrites its row and no completion is
          guessed. <span className="type-data text-ink">skipped</span>{" "}
          means the cycle found the advisory lock held and did nothing, which is
          a healthy
          outcome, not a failure.
        </p>
      </Section>

      {/* The page's two halves, adjacent — spec §4 names them in one breath,
          and §5's two gauges follow both tables. The id is what the lead at
          the top links to, so "below" is one click and not a scroll hunt. */}
      <div id={RUNS_ANCHOR}>
        <AdapterRuns
          runs={runs}
          now={now}
          source={askedSource}
          limit={RUN_WINDOW}
          over={RUNS_OBJECT}
          columns={RUN_COLUMNS}
          counts={RUN_COUNTS}
        />
      </div>

      <Section title={HEALTH_LABEL} surface={HEALTH_SURFACE}>
        {health.kind === "ok" ? (
          <CycleHealthSection health={health.data} outcomeKeys={CYCLE_OUTCOME_KEYS} />
        ) : (
          <StateOf result={health} eyebrow={HEALTH_LABEL} />
        )}
      </Section>

      <Section title={LATENCY_LABEL} surface={LATENCY_SURFACE}>
        {latency.kind === "ok" ? (
          <LatencySection latency={latency.data} />
        ) : (
          <StateOf result={latency} eyebrow={LATENCY_LABEL} />
        )}
      </Section>
    </Page>
  );
}
