import type { ReactNode } from "react";
import {
  Distribution,
  GaugeCard,
  TrendTable,
  spreadRows,
  type EmptyWords,
} from "@/components/gauges";
import {
  Badge,
  DataTable,
  Empty,
  ErrorLine,
  NotProvisioned,
  Page,
  Section,
  type Column,
} from "@/components/ui";
import {
  CYCLE_COUNTERS,
  CYCLE_WINDOW,
  cycleState,
  readCycles,
  type CycleState,
  type ResolutionRunRow,
} from "@/lib/db/cycles";
import type { DbUnavailable } from "@/lib/db/result";
import { absoluteUtc, count, duration, relativeAge } from "@/lib/format";
import { readCycleHealth, type CycleHealth } from "@/lib/gauges/cycle-health";
import {
  RESOLVER_CADENCE_SECONDS,
  secondsBetween,
  type WindowInfo,
} from "@/lib/gauges/gauge";
import {
  readResolutionLatency,
  type DomainLatency,
  type ResolutionLatency,
} from "@/lib/gauges/resolution-latency";

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
 *    crash stays visible". `cycleState` in `lib/db/cycles.ts` is the one place
 *    that is decided; nothing here re-derives it.
 *  - **Every latency figure is the AGGREGATE's.** `readResolutionLatency`
 *    returns counts (`applies`, `verdictUnsets`, `unmatchedApplies`) already
 *    separated from the raw window it read, and this page renders those. A
 *    figure re-derived from a row array over-counts by exactly the unsets
 *    (admin-window/BUG-0012), which is why the page never takes the rows at
 *    all — `readResolutionLatency` hands it no rows to take.
 *  - **The adapter framework's `runs` are not rendered here.** Which of that
 *    table's columns this page shows is the blocked `OPEN-RUNS` question
 *    (ARCHITECTURE.md §12) and belongs to its own ticket: the seam below
 *    renders nothing and names no column of it, rather than guessing one.
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, and every child is a pure sync
 * component with plain props — which is what lets the offline suite render
 * `renderToStaticMarkup(await CyclesPage(props))` with no jsdom and no
 * database, and the live suite compare its rows against rows the test reads
 * itself.
 *
 * **Nothing settles anything in M1**: every control in this markup is a link.
 */

/**
 * Three reads happen per request against the live database, so the route
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
 * Two more parameters reach this route today and narrow NOTHING here, because
 * both belong to the adapter half: `run=<run_id>` (the Dashboard's run lines)
 * and `source=<name>` (the Sources page's "runs" link). Neither is guessed at
 * — an unrecognised parameter narrows nothing rather than erroring, so both
 * links land on this page rather than dead-ending.
 */
const CYCLE_FACET = "cycle";

/**
 * The Sources page links each source to `/cycles?source=<name>` (`runs.source`
 * is text with no foreign key), and that facet narrows the ADAPTER half —
 * which this page does not render yet. `resolution_runs` has no source column,
 * so there is no honest narrowing of the cycles below to do here: the page
 * says which half the facet belongs to, in one sentence, rather than either
 * ignoring the parameter silently or inventing a filter over the resolver's
 * cycles (relayed on admin-window/TASK-0016).
 *
 * `run=<run_id>` (the Dashboard's run lines) reaches this route too and stays
 * unconsumed and unremarked: it names a row in a table this page never reads,
 * and the ticket that answers `OPEN-RUNS` is what makes it do anything.
 */
const SOURCE_FACET = "source";

/** What creates the ecosystem objects this page reads. */
const ARRIVES_WITH = "the scraper repo's migrations";

/** One retry sentence, in the app's voice, for every failed read on this page. */
const RETRY = "Reload to try the read again.";

/** The eyebrow each gauge's state card carries, so an absent gauge names its knob. */
const HEALTH_LABEL = "Cycle health";
const LATENCY_LABEL = "Resolution latency";

/** What an empty cycle table holds, and the one thing that fills it. */
const NOTHING_RECORDED: EmptyWords = {
  holds: "cycles recorded",
  filledBy:
    "The resolver files a row every time it wakes, including the cycles that found nothing to do.",
};

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

/** The anchor a linked cycle's row carries, so `#` reaches the row itself. */
function anchorFor(runId: string): string {
  return `cycle-${runId}`;
}

/* ── the states every surface here can be in ─────────────────────────────── */

/**
 * The state a failed or absent read renders as. `reading` and `missing` come
 * from the result itself, so the line names the object the query named
 * (admin-window/BUG-0016, TASK-0030).
 */
function StateOf({
  result,
  eyebrow,
}: {
  result: DbUnavailable;
  /** Passed only where no `Section` heading already names the surface. */
  eyebrow?: string;
}): ReactNode {
  // The wrapper carries which read refused, in the object's own spelling — the
  // one thing that distinguishes state 3 from state 4 and from an empty
  // surface without reading the card's words back (the three never share a
  // rendering, LOOK_AND_FEEL, Emptiness).
  return result.kind === "not_provisioned" ? (
    <div data-not-provisioned={result.missing}>
      <NotProvisioned
        missing={result.missing}
        arrivesWith={ARRIVES_WITH}
        eyebrow={eyebrow}
      />
    </div>
  ) : (
    <div data-read-failed={result.reading}>
      <ErrorLine reading={result.reading} failed={result.message} retry={RETRY} />
    </div>
  );
}

/** The window line a gauge section carries — which window, and whether it filled. */
function WindowLine({
  gauge,
  window: info,
  measured,
}: {
  /** Which gauge's window this is, for the live suite to read it back. */
  gauge: string;
  window: WindowInfo;
  /** What the window is over, in the app's voice: "Cycles started", … */
  measured: string;
}) {
  return (
    <p
      data-window={gauge}
      data-window-since={info.since}
      data-window-until={info.until}
      data-window-truncated={info.truncated ? "true" : "false"}
      className="type-body text-ink-secondary"
    >
      {measured} since {absoluteUtc(info.since)}, read to {absoluteUtc(info.until)}{" "}
      — a window of at most {count(info.limit)} rows, not the whole table.
      {info.truncated
        ? " The window filled its cap, so every count here is a floor."
        : ""}
    </p>
  );
}

/* ── the cycle table ─────────────────────────────────────────────────────── */

/** How a completed cycle's own word is coloured. Health carries colour; nothing else does. */
const OUTCOME_TONE: Record<string, "healthy" | "broken" | "neutral"> = {
  succeeded: "healthy",
  failed: "broken",
};

/**
 * A cycle's state, as the operator reads it.
 *
 * The producer's own word wins where there is one, verbatim and in mono. Where
 * there is none the row says which of the two null-outcome states it is —
 * `died` is a crash that nothing will ever repair, and rendering it as
 * "running" would leave a months-old failure reading as work in progress.
 */
function stateCell(state: CycleState): ReactNode {
  if (state.kind === "outcome") {
    return <Badge tone={OUTCOME_TONE[state.outcome] ?? "neutral"}>{state.outcome}</Badge>;
  }
  if (state.kind === "running") {
    return <span className="type-body text-ink-secondary">still running</span>;
  }
  if (state.kind === "died") {
    return (
      <span title={`no end recorded ${duration(state.ageSeconds)} after it started`}>
        <Badge tone="broken">died</Badge>
      </span>
    );
  }
  // It ended and recorded no outcome. The producer wrote no word, so neither
  // does this page: the table's own dash stands for the absent value.
  //
  // A plain function and not a component, deliberately: a `<StateCell />`
  // ELEMENT is never absent, whatever it renders, so `DataTable`'s `orDash`
  // would see a body and leave the cell BLANK — the one rendering
  // LOOK_AND_FEEL forbids ("never blank, never `null`, `N/A` or `none`").
  // Returning the `null` itself is what puts the dash in the cell.
  return null;
}

/**
 * The row's own columns: identity, when, how it ended, how long it took, the
 * eight counters, and the failure line the producer wrote.
 *
 * The counter columns are generated from `CYCLE_COUNTERS`, so the eight
 * columns are the eight the read asked for, in `contracts/resolver.md` §6's
 * order, and neither list can lose one without the other noticing.
 */
function cycleColumns(
  now: string,
  askedFor: string | undefined,
): Column<ResolutionRunRow>[] {
  return [
    {
      key: "run_id",
      label: "run_id",
      cell: (row) => {
        const state = cycleState(row, {
          now,
          cadenceSeconds: RESOLVER_CADENCE_SECONDS,
        });
        return (
          <span
            id={anchorFor(row.run_id)}
            data-cycle={row.run_id}
            // What this row IS, in one attribute: the four states of a cycle
            // row, decided once in `lib/db/cycles.ts`.
            data-cycle-state={state.kind}
            // The producer's own word, where it wrote one — never narrowed to
            // the check constraint's three spellings.
            data-cycle-outcome={state.kind === "outcome" ? state.outcome : undefined}
            aria-current={row.run_id === askedFor ? "true" : undefined}
          >
            {row.run_id}
          </span>
        );
      },
    },
    {
      key: "started_at",
      label: "started",
      cell: (row) => {
        const age = relativeAge(row.started_at, now);
        return (
          <span data-cycle-started={row.started_at} title={age.title}>
            {age.text}
          </span>
        );
      },
    },
    {
      key: "outcome",
      label: "outcome",
      cell: (row) =>
        stateCell(cycleState(row, { now, cadenceSeconds: RESOLVER_CADENCE_SECONDS })),
    },
    {
      key: "duration",
      label: "duration",
      align: "right",
      // `ended_at - started_at`, and nothing when there is no end: a cycle
      // with no end has no duration, which is the dash and never a zero.
      cell: (row) => {
        const seconds = secondsBetween(row.started_at, row.ended_at);
        return seconds === null ? null : (
          <span data-cycle-duration={String(seconds)}>{duration(seconds)}</span>
        );
      },
    },
    ...CYCLE_COUNTERS.map((counter) => ({
      key: counter,
      // The column's own name, verbatim — a machine identifier, and the word
      // `contracts/resolver.md` §6 defines. Nothing is prettified into prose.
      label: counter,
      align: "right" as const,
      cell: (row: ResolutionRunRow) => (
        <span data-cycle-count={counter}>{count(row[counter])}</span>
      ),
    })),
    {
      key: "error_summary",
      label: "error_summary",
      // The producer's first failure, inline and VERBATIM — not trimmed, not
      // summarised, not replaced with a friendlier sentence (LOOK_AND_FEEL:
      // the app shows what the database said). Red, because a cycle that
      // reported one is broken.
      cell: (row) =>
        row.error_summary === null || row.error_summary.trim() === "" ? null : (
          <span data-cycle-error="" className="type-data text-broken">
            {row.error_summary}
          </span>
        ),
    },
  ];
}

/**
 * What this page actually knows about the cycle a `?cycle=<run_id>` link asked
 * for. Three states, because the page has three to be honest about — and the
 * third is not a shade of "absent" (admin-window/BUG-0023).
 */
type AskedCycleState =
  | { kind: "found" }
  | { kind: "absent" }
  /** No window was read at all; `reading` is the object whose read said so. */
  | { kind: "unchecked"; reading: string };

/** Which object a failed read names, in the spelling its own query used. */
function readingOf(result: DbUnavailable): string {
  return result.kind === "not_provisioned" ? result.missing : result.reading;
}

/**
 * The line a visitor who arrived from a `?cycle=<run_id>` link reads.
 *
 * Three answers, one per state: the row is in this window and is marked; it is
 * not in this window — a real possibility, because the table holds the newest
 * cycles and the linked one may be older; or the window was never read, in
 * which case the line says only that, and names the read that returned none.
 *
 * The third answer is the whole of admin-window/BUG-0023. A refused or absent
 * read hands the page NO window, so "this cycle is not in the window" is a
 * verdict it has no evidence for — and on the not-provisioned path it sat
 * directly above the card naming `resolution_runs` as missing, contradicting
 * itself on one screen. The Dashboard's `lineHref` sends an operator here
 * exactly during an outage, so that sentence sent them after a phantom data
 * problem instead of the table the same screen already named. Saying nothing
 * would leave the link looking broken; saying which read failed does not.
 */
function AskedCycle({
  askedFor,
  state,
}: {
  askedFor: string;
  state: AskedCycleState;
}) {
  if (state.kind === "unchecked") {
    return (
      <p
        data-cycle-asked={askedFor}
        data-cycle-unchecked={state.reading}
        className="type-body text-ink-secondary"
      >
        Whether cycle <span className="type-data text-ink">{askedFor}</span> is
        in this window is not something this page can say: the read of{" "}
        <span className="type-data text-ink">{state.reading}</span> returned no
        window to look in. What is below says why.
      </p>
    );
  }
  return state.kind === "found" ? (
    <p data-cycle-asked={askedFor} data-cycle-found="true" className="type-body text-ink-secondary">
      Cycle{" "}
      <a href={`#${anchorFor(askedFor)}`} className="type-data text-ink hover:text-accent">
        {askedFor}
      </a>{" "}
      is marked in the table below.
    </p>
  ) : (
    <p data-cycle-asked={askedFor} data-cycle-found="false" className="type-body text-ink-secondary">
      Cycle <span className="type-data text-ink">{askedFor}</span> is not among the{" "}
      {count(CYCLE_WINDOW)} newest cycles, so it is not in this window — it ran
      earlier, or no cycle carries that id.
    </p>
  );
}

/**
 * The one sentence `?source=<name>` earns on this page today.
 *
 * The Sources page links here by source name, and the facet narrows the
 * adapter framework's runs — the half this page does not render yet
 * (`OPEN-RUNS`). `resolution_runs` carries no source at all, so filtering the
 * cycles by it would be an invention. The arriving link is told which half it
 * addresses rather than being ignored byte-for-byte.
 */
function AskedSource({ source }: { source: string }) {
  return (
    <p data-source-facet={source} className="type-body text-ink-secondary">
      The source facet <span className="type-data text-ink">{source}</span>{" "}
      narrows the adapter framework&rsquo;s runs, which this page does not
      render yet. The resolver&rsquo;s cycles below carry no source, so they are
      the same cycles with or without it.
    </p>
  );
}

/* ── the cycle-health gauge (spec §5, gauge 1 of 6) ──────────────────────── */

/** The outcome counts, the three the constraint allows first, then the rest. */
function outcomeRows(outcomes: CycleHealth["outcomes"]) {
  const known = ["succeeded", "failed", "skipped", "unfinished"];
  const extra = Object.keys(outcomes)
    .filter((outcome) => !known.includes(outcome))
    .sort();
  return [...known, ...extra].map((outcome) => ({
    key: outcome,
    label: <span data-outcome-count={outcome}>{outcome}</span>,
    value: outcomes[outcome] ?? 0,
  }));
}

/**
 * Cycle health: duration against cadence, facts examined against writes,
 * outcome counts, errors (spec §5, gauge 1 of 6).
 *
 * Every count here is the AGGREGATE's, carried with the window it was measured
 * over, and a truncated window makes each one a floor — `GaugeCard`'s `floor`
 * says so beside the figure rather than presenting a cut-off count as a total.
 */
function CycleHealthSection({ health }: { health: CycleHealth }) {
  const { window: info, writes, duration: spread } = health;
  const cadence = duration(health.cadenceSeconds);
  // A window with no cycles at all is the state a reviewer sees first against
  // a database whose resolver has not run. It is an emptiness with a reason,
  // so it is said in the page's own words rather than left to a table of zeros.
  const empty: EmptyWords | undefined =
    health.cycles === 0
      ? {
          holds: "cycles in this window",
          filledBy: "The resolver wakes on its cron and files a row, and the window fills.",
        }
      : undefined;

  return (
    <>
      <WindowLine gauge="cycle_health" window={info} measured="Cycles started" />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Cycles in this window"
          value={health.cycles}
          floor={info.truncated}
          sub={`${count(health.overCadence)} ran longer than the ${cadence} cadence`}
        />
        <GaugeCard
          label="Facts examined"
          value={health.factsExamined}
          floor={info.truncated}
          sub={`${count(health.held)} held, and a held fact writes nothing`}
        />
        <GaugeCard
          label="Writes"
          value={writes.total}
          floor={info.truncated}
          sub={`${count(writes.applied)} applied, ${count(writes.escalated)} escalated, ${count(writes.entitiesCreated)} created`}
        />
        <GaugeCard
          label="Errors"
          value={health.errors}
          floor={info.truncated}
          tone={health.errors > 0 ? "broken" : "default"}
          sub={`${count(health.cyclesWithErrors)} cycles reported one`}
        />
      </div>
      <Distribution
        label="Cycle outcomes"
        dimension="outcome"
        measure="cycles"
        rows={outcomeRows(health.outcomes)}
        empty={{
          holds: "outcomes in this window",
          filledBy: "A cycle completes and its outcome is counted here.",
        }}
        state={empty === undefined ? undefined : { kind: "empty", ...empty }}
      />
      <Distribution
        label="Cycle duration"
        dimension="percentile"
        measure="duration"
        rows={spreadRows(spread)}
        format={duration}
        empty={{
          holds: "measured durations in this window",
          filledBy: "A cycle records its end, and the time it took is measurable.",
        }}
        state={empty === undefined ? undefined : { kind: "empty", ...empty }}
      />
      <p className="type-body text-ink-secondary">
        Duration is judged against the resolver&rsquo;s {cadence} cadence: a
        cycle that runs longer than the gap between cycles is falling behind.
        {spread.unmeasurable > 0
          ? ` ${count(spread.unmeasurable)} of these cycles recorded no end, so they are counted as unmeasurable rather than as a duration of zero.`
          : ""}
      </p>
      {health.latestError === null ? null : (
        <p
          data-latest-error={health.latestError.runId}
          className="type-body text-ink-secondary"
        >
          Newest cycle carrying errors:{" "}
          <a
            href={`#${anchorFor(health.latestError.runId)}`}
            className="type-data text-ink hover:text-accent"
          >
            {health.latestError.runId}
          </a>
          , {count(health.latestError.errors)} of them,{" "}
          <span title={absoluteUtc(health.latestError.startedAt)}>
            {relativeAge(health.latestError.startedAt).text}
          </span>
          {health.latestError.errorSummary === null ? (
            ""
          ) : (
            <>
              {" — "}
              <span className="type-data text-broken">
                {health.latestError.errorSummary}
              </span>
            </>
          )}
        </p>
      )}
    </>
  );
}

/* ── the resolution-latency gauge (spec §5, gauge 2 of 6) ────────────────── */

/**
 * Resolution latency: `observed_at` → `applied_at`, per domain (spec §5,
 * gauge 2 of 6).
 *
 * **Every figure below is the aggregate's own count** — `applies`,
 * `verdictUnsets`, `unmatchedApplies`, `overall`, `byDomain` — and none is
 * re-derived from a row array. The read's raw window holds applies AND
 * unsets, and its length over-counts the applies by exactly the unsets
 * (admin-window/BUG-0012); `readResolutionLatency` returns the aggregate
 * alone, so there is no row array here to make that mistake with.
 *
 * A domain whose window held only unsets is listed with `applies: 0` and a
 * latency of nulls. That zero is a measured count and the unset column beside
 * it is what explains it — showing one without the other would read as a
 * defect in the resolver.
 */
function LatencySection({ latency }: { latency: ResolutionLatency }) {
  const { window: info, overall } = latency;
  const cadence = duration(latency.cadenceSeconds);
  const nothing = latency.applies === 0 && latency.verdictUnsets === 0;
  const empty: EmptyWords | undefined = nothing
    ? {
        holds: "decisions in this window",
        filledBy:
          "The resolver applies a claim to canonical, and the wait from claim to apply is measurable here.",
      }
    : undefined;

  return (
    <>
      <WindowLine
        gauge="resolution_latency"
        window={info}
        measured="Canonical decisions applied"
      />
      <div className="grid grid-cols-2 gap-4">
        <GaugeCard
          label="Applies in this window"
          value={latency.applies}
          floor={info.truncated}
          sub="Claims that became the canonical value"
        />
        <GaugeCard
          label="Median wait, claim to apply"
          value={overall.p50 === null ? null : duration(overall.p50)}
          absent={`no apply in this window had a claim to measure from${
            latency.verdictUnsets > 0
              ? `; ${count(latency.verdictUnsets)} decisions in it name no claim`
              : ""
          }`}
          sub={`p90 ${duration(overall.p90)}, against a ${cadence} cadence`}
        />
        <GaugeCard
          label="Unset by a human decision"
          value={latency.verdictUnsets}
          floor={info.truncated}
          sub="Decisions that name no claim, so they carry no wait to measure"
        />
        <GaugeCard
          label="Applies with no claim found"
          value={latency.unmatchedApplies}
          tone={latency.unmatchedApplies > 0 ? "attention" : "default"}
          sub="The claim behind the apply was not in this read — a join gap, not a wait"
        />
      </div>
      <Distribution
        label="Wait from claim to apply"
        dimension="percentile"
        measure="wait"
        rows={spreadRows(overall)}
        format={duration}
        empty={{
          holds: "measured waits in this window",
          filledBy: "An apply names the claim it wrote, and the wait between them is measurable.",
        }}
        state={empty === undefined ? undefined : { kind: "empty", ...empty }}
      />
      <TrendTable<DomainLatency>
        label="Wait by domain"
        period="domain"
        rows={latency.byDomain}
        rowKey={(row) => row.domain}
        rowLabel={(row) => <span data-latency-domain={row.domain}>{row.domain}</span>}
        measures={[
          { key: "applies", label: "applies", value: (row) => row.applies },
          { key: "unsets", label: "unset by a human", value: (row) => row.verdictUnsets },
          {
            key: "p50",
            label: "p50 wait",
            value: (row) => row.latency.p50,
            format: duration,
          },
          {
            key: "p90",
            label: "p90 wait",
            value: (row) => row.latency.p90,
            format: duration,
          },
        ]}
        empty={{
          holds: "domains with a decision in this window",
          filledBy: "The resolver writes to a canonical table, and that domain appears here.",
        }}
        state={empty === undefined ? undefined : { kind: "empty", ...empty }}
      />
      <p className="type-body text-ink-secondary">
        The wait is from the claim&rsquo;s{" "}
        <span className="type-data text-ink">observed_at</span> to the instant it
        became canonical. A decision a human made rather than a claim names no
        claim, so it carries no wait: those are counted on their own and are in
        neither the applies nor the waits — a domain showing no applies beside a
        count of them is that, and not a broken resolver.
      </p>
    </>
  );
}

/* ── the seam the adapter framework's runs will fill ─────────────────────── */

/**
 * The adapter framework's `runs` — **deliberately unrendered here**.
 *
 * `adapters.md` is not a contract snapshot and the table carries 22 columns,
 * so which of them this page shows is an open question (ARCHITECTURE.md §12,
 * `OPEN-RUNS`) held by its own ticket. Guessing a column set is the one thing
 * this seam exists to prevent, and a heading over an empty surface would be a
 * guess about the shape of the answer too — so this renders nothing at all
 * until that question is answered. The Dashboard already shows the newest runs
 * (source, when, outcome, error line), which is the only settled part.
 */
function AdapterRuns(): ReactNode {
  return null;
}

/* ── the page ────────────────────────────────────────────────────────────── */

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
  const askedSource = firstValue(params[SOURCE_FACET]);

  // One clock for the whole render: every age on the page, and the
  // running-or-died reading of every row, is measured against the same
  // instant. Reading the clock per row would let two rows disagree.
  const now = new Date().toISOString();

  // Three reads, concurrent and reported separately: the table and each gauge
  // fail on their own, so an absent `field_provenance` never takes the cycle
  // table down with it (ARCHITECTURE.md §4.1).
  const [cycles, health, latency] = await Promise.all([
    readCycles(),
    readCycleHealth(),
    readResolutionLatency(),
  ]);

  const rows = cycles.kind === "ok" ? cycles.data.rows : [];
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
      <Section title="Cycles">
        <p
          data-window="cycles"
          data-window-limit={String(CYCLE_WINDOW)}
          data-window-truncated={
            cycles.kind === "ok" && cycles.data.truncated ? "true" : "false"
          }
          className="type-body text-ink-secondary"
        >
          The resolver&rsquo;s newest cycles, newest first — a window of at most{" "}
          {count(CYCLE_WINDOW)}, not a count of the cycles that exist.
          {cycles.kind === "ok" && cycles.data.truncated
            ? " The window filled its cap, so older cycles ran than the ones below."
            : ""}
        </p>
        {askedFor === undefined ? null : (
          <AskedCycle askedFor={askedFor} state={asked} />
        )}
        {askedSource === undefined ? null : <AskedSource source={askedSource} />}
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
            columns={cycleColumns(now, askedFor)}
            rows={rows}
            rowKey={(row) => row.run_id}
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
          guessed. <span className="type-data text-ink">skipped</span> means the
          cycle found the advisory lock held and did nothing, which is a healthy
          outcome, not a failure.
        </p>
      </Section>

      <Section title={HEALTH_LABEL}>
        {health.kind === "ok" ? (
          <CycleHealthSection health={health.data} />
        ) : (
          <StateOf result={health} eyebrow={HEALTH_LABEL} />
        )}
      </Section>

      <Section title={LATENCY_LABEL}>
        {latency.kind === "ok" ? (
          <LatencySection latency={latency.data} />
        ) : (
          <StateOf result={latency} eyebrow={LATENCY_LABEL} />
        )}
      </Section>

      <AdapterRuns />
    </Page>
  );
}
