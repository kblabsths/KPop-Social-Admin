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
  Page,
  Section,
  StatCard,
  StateOf,
  WindowLine,
  type Column,
} from "@/components/ui";
import { STATE_WORD, cycleState, type CycleState } from "@/lib/cycles/state";
import {
  CYCLE_COUNTERS,
  CYCLE_WINDOW,
  readCycles,
  type CycleCounter,
  type ResolutionRunRow,
} from "@/lib/db/cycles";
import type { DbResult, DbUnavailable } from "@/lib/db/result";
import {
  RUN_COLUMNS,
  RUN_COUNTS,
  RUN_WINDOW,
  narrowedTo,
  readRuns,
  type RunColumn,
  type RunRow,
  type RunWindow,
} from "@/lib/db/runs";
import {
  CLAMP_LIMIT,
  absoluteUtc,
  clamped,
  count,
  counted,
  duration,
  isAbsent,
  orDash,
  relativeAge,
} from "@/lib/format";
import {
  CYCLE_OUTCOME_KEYS,
  readCycleHealth,
  type CycleHealth,
} from "@/lib/gauges/cycle-health";
import { RESOLVER_CADENCE_SECONDS, secondsBetween } from "@/lib/gauges/gauge";
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

/**
 * The name each of this page's surfaces answers to — `data-surface`, rendered
 * by `Section` and read by the live parity oracle
 * (`tests/live/cycles.live.test.ts`).
 *
 * A NAME, never a position. The oracle used to address these surfaces as
 * `section:nth-of-type(n)`, which made it hostage to this file's element
 * order: admin-window/BUG-0040 added the lead section and wrapped the runs
 * window in a `<div>`, so `section:nth-of-type(1)` matched two surfaces and
 * four live tests threw, while the two gauge selectors kept grading the right
 * surfaces only because +1 section and -1 section happened to cancel
 * (admin-window/BUG-0056). Rearranging this page must not be able to repoint
 * an oracle at the wrong surface, so every surface a test grades carries its
 * own name and none of them is addressed by where it sits.
 *
 * Each has to match exactly one element (`stateOf` refuses otherwise), which
 * is why the runs window keeps its own hand-written `data-surface="runs"`
 * wrapper (`AdapterRuns`) and the `<Section>` around it takes no name: two
 * elements answering to `runs` would break `runs.live.test.ts` the same way.
 */
const LATEST_RUN_SURFACE = "latest_run";
const CYCLES_SURFACE = "cycles";
const HEALTH_SURFACE = "cycle_health";
const LATENCY_SURFACE = "resolution_latency";

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

/**
 * How every anchor on this page renders **at rest** (campaign
 * admin-window/BUG-0054).
 *
 * These links were `text-ink hover:text-accent`, which made a linked cycle id
 * identical to the dozens of mono ids this page prints as plain text: the one
 * thing on screen that would have carried the reader to the row they asked for
 * announced itself only under the pointer, and the M1 user-sim walk scanned
 * 36-character uuids by eye instead of finding it. Accent is the palette's
 * selection-and-interaction job (5.54:1 on surface, 6.36:1 in dark) and the
 * underline is what `/` and the review header already spell a prose link with,
 * so this is the app's existing link, not a new one — and the page now spells
 * link one way, for the cycle id, the newest-error id and the prose links into
 * the runs window alike.
 */
const IN_PAGE_LINK = "text-accent underline";

/* ── the cycle table ─────────────────────────────────────────────────────── */

/** How a completed cycle's own word is coloured. Health carries colour; nothing else does. */
const OUTCOME_TONE: Record<string, "healthy" | "broken" | "neutral"> = {
  succeeded: "healthy",
  failed: "broken",
};

/*
 * The word for each no-outcome state is `STATE_WORD`, imported from the leaf
 * `lib/cycles/state.ts` — read by the table row below, by the cycle-health
 * panel's outcome list, AND by the Dashboard's cycle table, so no two of them
 * can name one state two ways (Voice glossary: "one name per concept,
 * everywhere").
 *
 * admin-window/BUG-0055 is what it is for: the rows said `died` where the
 * panel said `unfinished`, over the same four cycles on the same screen, and a
 * reader had to satisfy himself the two sets were one before trusting either
 * count. admin-window/BUG-0074 is why it left this file: the Dashboard, which
 * cannot import a page, had grown its own copy of the words and its own idea
 * of what a no-outcome row is.
 */

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
    return <span className="type-body text-ink-secondary">{STATE_WORD.running}</span>;
  }
  if (state.kind === "died") {
    return (
      <span title={`no end recorded ${duration(state.ageSeconds)} after it started`}>
        <Badge tone="broken">{STATE_WORD.died}</Badge>
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
 * What this table calls each counter — the app's own words, one naming system
 * for the whole header row (campaign admin-window/BUG-0044).
 *
 * The header of a table is a LABEL, and a label is the app speaking: `micro`
 * is a SANS eyebrow (LOOK_AND_FEEL, Type), while §11's "verbatim in mono"
 * governs machine identifiers rendered as VALUES. `facts_examined` uppercased
 * into a sans eyebrow was neither, and it made this one row speak two
 * vocabularies — seven of the app's words beside six database column names.
 * The words below are the ones the app already uses for these same numbers:
 * the Dashboard's cycle table (`src/app/page.tsx`), this page's own
 * cycle-health gauge ("Facts examined"), and the rejection gauge's
 * "re-rejected".
 *
 * The machine names have not gone anywhere — every counter cell still carries
 * its own column name on `data-cycle-count`, which is what the offline and
 * live tests read. The row's identity is the operator's; the hooks are the
 * machine's.
 *
 * A `Record` over `CycleCounter` rather than a lookup with a fallback: a
 * counter renamed in the scraper's migration stops COMPILING here, instead of
 * quietly falling back to its raw name in the header — the exact regression
 * this ticket exists to prevent.
 */
const CYCLE_COUNTER_LABELS: Record<CycleCounter, string> = {
  facts_examined: "facts examined",
  applied: "applied",
  held: "held",
  escalated: "escalated",
  entities_created: "entities created",
  claims_linked: "claims linked",
  claims_rerejected: "claims re-rejected",
  errors: "errors",
};

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
      // A cycle's id, and the glossary keeps `cycle` (resolver) and `run`
      // (adapter) apart as two nouns of two producers — on the one page that
      // shows both tables, heading this column `run_id` called a cycle a run
      // (admin-window/BUG-0044). The KEY stays the row's own column name; the
      // header is what the operator reads.
      label: "cycle id",
      cell: (row) => {
        const state = cycleState(row, {
          now,
          cadenceSeconds: RESOLVER_CADENCE_SECONDS,
        });
        const asked = row.run_id === askedFor;
        return (
          <span
            id={anchorFor(row.run_id)}
            // The asked-for id in the palette's selection colour, so the value
            // the sentence above names is the value that catches the eye in a
            // window of up to 200 mono ids (admin-window/BUG-0054). Accent on
            // this row's fill measures 5.04:1 light and 7.21:1 dark; it is not
            // underlined, which is what this page spells a link with.
            className={asked ? "text-accent" : undefined}
            data-cycle={row.run_id}
            // What this row IS, in one attribute: the four states of a cycle
            // row, decided once in `lib/cycles/state.ts`.
            data-cycle-state={state.kind}
            // The producer's own word, where it wrote one — never narrowed to
            // the check constraint's three spellings.
            data-cycle-outcome={state.kind === "outcome" ? state.outcome : undefined}
            aria-current={asked ? "true" : undefined}
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
      label: CYCLE_COUNTER_LABELS[counter],
      align: "right" as const,
      cell: (row: ResolutionRunRow) => (
        <span data-cycle-count={counter}>{count(row[counter])}</span>
      ),
    })),
    {
      key: "error_summary",
      // What the Dashboard already heads the same column (`src/app/page.tsx`).
      // The VALUE below is still the producer's line, verbatim.
      label: "error",
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
        Whether cycle <span className="type-data text-ink">{askedFor}</span>{" "}
        is in this window is not something this page can say: the read of{" "}
        <span className="type-data text-ink">{state.reading}</span>{" "}
        returned no window to look in. What is below says why.
      </p>
    );
  }
  return state.kind === "found" ? (
    <p data-cycle-asked={askedFor} data-cycle-found="true" className="type-body text-ink-secondary">
      Cycle{" "}
      <a href={`#${anchorFor(askedFor)}`} className={`type-data ${IN_PAGE_LINK}`}>
        {askedFor}
      </a>{" "}
      is marked in the table below.
    </p>
  ) : (
    <p data-cycle-asked={askedFor} data-cycle-found="false" className="type-body text-ink-secondary">
      Cycle <span className="type-data text-ink">{askedFor}</span>{" "}
      is not among the {count(CYCLE_WINDOW)} newest cycles, so it is not in this
      window — it ran
      earlier, or no cycle carries that id.
    </p>
  );
}

/**
 * The one sentence `?source=<name>` earns, beside the half it narrows.
 *
 * The Sources page links here by source name and the facet is REAL now: the
 * runs read below carries it, matched by name (admin-window/TASK-0016). The
 * sentence exists because the narrowing is half a page wide — the resolver's
 * cycles above carry no source column at all, so they are the same cycles with
 * the facet or without it, and an operator who cannot see why must not be left
 * to guess that the page ignored their URL.
 *
 * The name is rendered VERBATIM, as text: what was asked for is what is shown,
 * and nothing the URL carries reaches the document as markup.
 */
function AskedSource({ source }: { source: string }) {
  return (
    <p
      data-source-facet={source}
      data-source-facet-half="runs"
      className="type-body text-ink-secondary"
    >
      Narrowed to the runs whose source is{" "}
      <span className="type-data text-ink">{source}</span>, matched by name.
      This facet narrows the runs below and nothing else: the resolver&rsquo;s
      cycles carry no source, so they are the same cycles with it or without it.
    </p>
  );
}

/* ── the cycle-health gauge (spec §5, gauge 1 of 6) ──────────────────────── */

/**
 * What the panel calls one bucket — the row's own word, never a second one.
 *
 * A state key takes its word from `STATE_WORD`, which is where the table's
 * outcome cell above takes it too; anything else is a producer outcome and is
 * rendered verbatim. `unrecorded`'s `null` goes through the same `orDash` the
 * table cell does, so that bucket reads as the same dash the rows read.
 */
function outcomeLabel(key: string): ReactNode {
  const word = key in STATE_WORD ? STATE_WORD[key as keyof typeof STATE_WORD] : key;
  return orDash(word);
}

/**
 * The outcome counts: the buckets the gauge always reports, in its order, then
 * any outcome word the check constraint gained later, sorted.
 *
 * The known set is `CYCLE_OUTCOME_KEYS` and not a second literal list — the
 * page listing its own four words was half of how the panel came to disagree
 * with the rows (admin-window/BUG-0055).
 */
function outcomeRows(outcomes: CycleHealth["outcomes"]) {
  const known: string[] = [...CYCLE_OUTCOME_KEYS];
  const extra = Object.keys(outcomes)
    .filter((outcome) => !known.includes(outcome))
    .sort();
  return [...known, ...extra].map((outcome) => ({
    key: outcome,
    label: <span data-outcome-count={outcome}>{outcomeLabel(outcome)}</span>,
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
      <WindowLine
        gauge="cycle_health"
        window={info}
        measured="Cycles started"
      />
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
          sub={`${counted(health.cyclesWithErrors, "cycle")} reported one`}
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
            className={`type-data ${IN_PAGE_LINK}`}
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
              ? `; ${counted(latency.verdictUnsets, "decision")} in it named no claim`
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
        <span className="type-data text-ink">observed_at</span>{" "}
        to the instant it became canonical. A decision a human made rather than
        a claim names no
        claim, so it carries no wait: those are counted on their own and are in
        neither the applies nor the waits — a domain showing no applies beside a
        count of them is that, and not a broken resolver.
      </p>
    </>
  );
}

/* ── the adapter framework's runs (spec §4, Ben's ruling 2026-09-02) ─────── */

/** The heading of the page's other half, and the eyebrow its state cards carry. */
const RUNS_LABEL = "Adapter runs";

/**
 * The id the runs window carries, so the lead at the top of the page links to
 * the window itself instead of leaving the operator to hunt for it four
 * screenfuls down (campaign admin-window/BUG-0040).
 */
const RUNS_ANCHOR = "adapter-runs";

/** The heading of that lead, and the label its one-row table carries. */
const LATEST_RUN_LABEL = "Newest adapter run";

/**
 * Which copy of a run row is being rendered: the window's own rows, or the
 * single LEAD row repeated above the cycles table.
 *
 * Only the identity hooks differ — every cell body is the same cell body, from
 * the same `RUN_COLUMNS`, so the lead cannot render a run differently from the
 * row it is a copy of.
 */
type RunRole = "window" | "lead";

/** The figure the empty state puts on screen, and the label a parity test reads it under. */
const RUNS_IN_WINDOW = "Runs in this window";

/**
 * The zero an empty window renders, as a LITERAL.
 *
 * A window read returns at most its cap, so a window that came back with no
 * rows had no matching rows at all — the zero is exact, and it is the one
 * number this half may state (DECISIONS 2026-09-02, "a counted zero is a real
 * figure"; LOOK_AND_FEEL bar 1, the count is on screen whether or not the
 * table has rows). It is written here rather than taken from `rows.length`
 * because a window's length is not a total and no figure on this page is
 * allowed to come from one (ARCHITECTURE.md §4.3).
 */
const NO_RUNS = 0;

/** What an empty runs table holds, and the one thing that fills it. */
const NO_RUNS_RECORDED: EmptyWords = {
  holds: "runs recorded",
  filledBy:
    "An adapter files a row the moment it wakes, before it has fetched anything.",
};

/** The same, for a window narrowed to a source name that matched nothing. */
function noRunsFrom(source: string): EmptyWords {
  return {
    holds: `runs from ${source}`,
    filledBy:
      "The name is matched against the run's own source text, which is not a registered source's key — a source that has never run has no run here, and a name nothing was ever filed under matches nothing.",
  };
}

/**
 * One run row's nine cells, keyed by column.
 *
 * A `Record` over `RunColumn` rather than an array of columns: the compiler
 * requires a body for every one of the ruled nine and refuses a tenth, and the
 * ORDER comes from `RUN_COLUMNS` alone (below), so the rendered table cannot
 * drift from the read's select list or from the ruling.
 *
 * Every cell that can be absent returns the `null` ITSELF rather than a
 * component that renders null — `DataTable` passes each body through `orDash`,
 * and a React element is never absent to it, so a `<Cell />` would leave the
 * cell BLANK instead of drawing the shared em dash (admin-window/TASK-0019).
 */
function runCells(
  now: string,
  role: RunRole,
): Record<RunColumn, (row: RunRow) => ReactNode> {
  const lead = role === "lead";
  return {
    source: (row) => (
      // The run's own source TEXT, verbatim: there is no foreign key here and
      // no `sources` row is resolved to (§6 trap 6). A run against a source the
      // registry has never heard of still renders, under the name it filed.
      // `data-run` is the row's identity for a test to read it back by; the
      // primary key is not a rendered column (Ben's ruling: nine, and this is
      // not one of them).
      //
      // The LEAD copy carries `data-latest-run` instead, and never `data-run`:
      // the window's rows are what `[data-run]` means everywhere that reads
      // this page (`tests/offline/runs/`, `tests/live/runs.live.test.ts`), and
      // a repeated row answering to the same hook would double the window
      // those readers see (campaign admin-window/BUG-0040).
      <span
        data-run={lead ? undefined : row.run_id}
        data-run-source={lead ? undefined : row.source}
        data-latest-run={lead ? row.run_id : undefined}
        data-latest-run-source={lead ? row.source : undefined}
        className="type-data text-ink"
      >
        {row.source}
      </span>
    ),
    started_at: (row) => {
      const age = relativeAge(row.started_at, now);
      return (
        <span data-run-started={row.started_at} title={age.title}>
          {age.text}
        </span>
      );
    },
    ended_at: (row) => {
      // A row with no end is a run still going, and says so — the dash would
      // read as a missing value rather than as the state the null IS
      // (Ben's ruling: "a row with none is still running and reads as such").
      if (row.ended_at === null) {
        return (
          <span data-run-inflight="true" className="type-body text-ink-secondary">
            still running
          </span>
        );
      }
      const age = relativeAge(row.ended_at, now);
      return (
        <span data-run-ended={row.ended_at} title={age.title}>
          {age.text}
        </span>
      );
    },
    outcome: (row) =>
      // The producer's own word, verbatim and never narrowed to the check
      // constraint's spellings — `skipped` included, which is a healthy
      // outcome and carries no colour, not a failure.
      isAbsent(row.outcome) ? null : (
        <span data-run-outcome={row.outcome ?? undefined}>
          <Badge tone={OUTCOME_TONE[row.outcome ?? ""] ?? "neutral"}>{row.outcome}</Badge>
        </span>
      ),
    error_summary: (row) => {
      // Inline and VERBATIM — not trimmed, not summarised, not replaced with a
      // friendlier sentence. Red, because a run that reported one is broken.
      //
      // The LEAD copy is the one cell a role changes, and it changes only its
      // LENGTH (campaign admin-window/DEBT-0005). The lead sits ABOVE the
      // cycles window, so its height is the only height on this page that can
      // push the newest cycle under the fold, and an `error_summary` past
      // roughly 700 characters does exactly that — re-breaking half of
      // LOOK_AND_FEEL bar 1, which the lead exists to satisfy. `CLAMP_LIMIT`
      // bounds it; the window's own copy below is unbounded, because one row
      // among two hundred pushes nothing.
      //
      // Nothing is hidden by that. The clamp is VISIBLE (it ends in the
      // ellipsis), the whole string rides the lead's own `title`, and the
      // window row below still carries it verbatim in its own cell — the two
      // ways LOOK_AND_FEEL requires the full text to stay reachable. Below the
      // bound `clamped` returns the value byte-identical with an empty title,
      // so for every error this database has ever held the lead is still the
      // window's row cell for cell, `title` attribute included.
      if (isAbsent(row.error_summary)) return null;
      const error = clamped(
        row.error_summary,
        lead ? CLAMP_LIMIT : Number.POSITIVE_INFINITY,
      );
      return (
        <span
          data-run-error=""
          title={error.title === "" ? undefined : error.title}
          className="type-data text-broken"
        >
          {error.text}
        </span>
      );
    },
    // The three counts of the ruling, thousand-separated. A zero is a real
    // count and renders as one, never as the absence dash: the number is the
    // database's, and nothing on this path substitutes one it did not give
    // (ARCHITECTURE.md §4.3).
    //
    // Written out rather than spread from `RUN_COUNTS`, so the
    // `Record<RunColumn, …>` above is CHECKED: a column the ruling names and
    // this map forgets is a compile error, which a spread of computed keys
    // would hide.
    records_parsed: (row) => (
      <span data-run-count="records_parsed">{count(row.records_parsed)}</span>
    ),
    claims_emitted: (row) => (
      <span data-run-count="claims_emitted">{count(row.claims_emitted)}</span>
    ),
    records_unlinked: (row) => (
      <span data-run-count="records_unlinked">{count(row.records_unlinked)}</span>
    ),
    failure_class: (row) =>
      // A machine identifier, rendered verbatim in mono and never prettified
      // (ARCHITECTURE.md §11). It is the column that says whose problem a
      // failure is, so a run that named none shows the dash and not a word of
      // ours.
      isAbsent(row.failure_class) ? null : (
        <span data-run-failure-class={row.failure_class ?? undefined} className="type-data text-ink">
          {row.failure_class}
        </span>
      ),
  };
}

/** Which of the nine are figures, and so right-aligned. */
const RIGHT_ALIGNED: ReadonlySet<string> = new Set(RUN_COUNTS);

/**
 * What this table calls each of the nine ruled columns — the app's own words
 * (campaign admin-window/BUG-0064).
 *
 * A table header is a LABEL, and a label is the app speaking: `micro` is a
 * SANS eyebrow (LOOK_AND_FEEL, Type), while §11's "verbatim in mono" governs
 * machine identifiers rendered as VALUES. `started_at` uppercased into a sans
 * eyebrow is neither, and it made this page speak two vocabularies: the cycles
 * table a few thousand pixels above headed the very same `error_summary`
 * column ERROR while this one headed it ERROR_SUMMARY.
 *
 * Ben's ruling of 2026-09-02 settled WHICH nine columns this half shows — its
 * one use of "verbatim" qualifies the error VALUE, never a header — so nothing
 * ruled is overturned by naming them. `RUN_COLUMNS` is untouched: it is still
 * the select list, the ruled set and the ruled order, and it is still what
 * this map is keyed by.
 *
 * The words come from the app, not from this file's imagination. The four
 * columns the Dashboard's runs table already shows are headed with the words
 * it already uses for them (`src/app/page.tsx` — source, started, outcome,
 * error), so `runs.started_at` cannot read STARTED on `/` and STARTED_AT here;
 * `ended_at` takes the tense of its neighbour, and the four the Dashboard does
 * not show are the plain sentence-case reading of the same nouns the page's
 * own prose uses for them.
 *
 * The machine names have not gone anywhere — every cell still carries its own
 * column name on a `data-run-*` hook, which is what the offline and live tests
 * select by. The row's identity is the operator's; the hooks are the
 * machine's.
 *
 * A `Record` over `RunColumn` rather than a lookup with a fallback: a column
 * renamed in the scraper's migration stops COMPILING here, instead of quietly
 * falling back to its raw name in the header — the exact regression this
 * ticket exists to prevent (the same device as `CYCLE_COUNTER_LABELS` above,
 * admin-window/BUG-0044).
 */
const RUN_COLUMN_LABELS: Record<RunColumn, string> = {
  source: "source",
  started_at: "started",
  ended_at: "ended",
  outcome: "outcome",
  error_summary: "error",
  records_parsed: "records parsed",
  claims_emitted: "claims emitted",
  records_unlinked: "records unlinked",
  failure_class: "failure class",
};

/**
 * The nine columns, in the order the ruling names them.
 *
 * The KEY stays each column's own machine name — it is the react key and what
 * the cells' hooks spell — and the header is what the operator reads
 * (`RUN_COLUMN_LABELS` above).
 */
function runColumns(now: string, role: RunRole): Column<RunRow>[] {
  const cells = runCells(now, role);
  return RUN_COLUMNS.map((column) => ({
    key: column,
    label: RUN_COLUMN_LABELS[column],
    align: RIGHT_ALIGNED.has(column) ? ("right" as const) : undefined,
    cell: cells[column],
  }));
}

/**
 * The adapter framework's runs — the page's other half.
 *
 * Four states, none of which shares a rendering with another (LOOK_AND_FEEL,
 * Emptiness), and the kind is on the wrapper as `data-state` so a live test
 * reads WHICH state the page is in before it compares a number: an `error` is
 * always a failure, an `empty` is a pass with a real zero, and neither is
 * inferred from "no rows rendered" (ARCHITECTURE.md §10, common violation 6).
 */
function AdapterRuns({
  runs,
  now,
  source,
}: {
  runs: DbResult<RunWindow>;
  now: string;
  /** The `?source=` facet as the URL carried it, or undefined for no facet. */
  source: string | undefined;
}): ReactNode {
  const rows = runs.kind === "ok" ? runs.data.rows : [];
  const kind = runs.kind === "ok" && rows.length === 0 ? "empty" : runs.kind;
  const truncated = runs.kind === "ok" && runs.data.truncated;
  const words = source === undefined ? NO_RUNS_RECORDED : noRunsFrom(source);

  return (
    <Section title={RUNS_LABEL}>
      {/* The window line describes a window this page actually read. A refused
          or absent read returned none, so it would be describing a table that
          is not there (LOOK_AND_FEEL states 3 and 4); an EMPTY window is still
          a window — the page looked, and nothing was there. */}
      {runs.kind === "ok" ? (
        <p
          data-window="runs"
          data-window-limit={String(RUN_WINDOW)}
          data-window-truncated={truncated ? "true" : "false"}
          className="type-body text-ink-secondary"
        >
          The adapters&rsquo; newest runs, newest first — a window of at most{" "}
          {count(RUN_WINDOW)}, not a count of the runs that exist.
          {truncated
            ? " The window filled its cap, so older runs ran than the ones below."
            : ""}
        </p>
      ) : null}
      {/* The facet sentence answers the URL, so it renders whatever the read
          did: an operator who followed a link deserves to know which half it
          addressed even when that half could not be read. */}
      {source === undefined ? null : <AskedSource source={source} />}
      <div data-surface="runs" data-state={kind} className="flex flex-col gap-2">
        {runs.kind === "not_provisioned" ? (
          // A card replaces the surface; nothing above it describes a table
          // that is not there (LOOK_AND_FEEL state 3).
          <StateOf result={runs} />
        ) : kind === "empty" ? (
          <>
            <StatCard
              label={RUNS_IN_WINDOW}
              value={NO_RUNS}
              sub={
                source === undefined
                  ? "nothing has run yet"
                  : "no run in this window carries that source name"
              }
            />
            <div data-empty="runs">
              <Empty holds={words.holds} filledBy={words.filledBy} />
            </div>
          </>
        ) : (
          <DataTable<RunRow>
            label={RUNS_LABEL}
            columns={runColumns(now, "window")}
            rows={rows}
            // The primary key is the row key and the order's tiebreak. It is
            // not a tenth column and is never rendered as one.
            rowKey={(row) => row.run_id}
            placeholder={runs.kind === "error" ? <StateOf result={runs} /> : undefined}
          />
        )}
      </div>
      {/* What the columns mean — for a table that is on screen. With no window
          read there is nothing for it to explain. */}
      {runs.kind === "ok" ? (
        <p className="type-body text-ink-secondary">
          A run with no end is still going: the row is written when the adapter
          wakes and nothing rewrites it, so no completion is guessed.{" "}
          <span className="type-data text-ink">failure_class</span>{" "}
          says whose problem a failure is, and{" "}
          <span className="type-data text-ink">source</span>{" "}
          is the run&rsquo;s own text — a run filed under a name the registry
          does not carry still appears here.
        </p>
      ) : null}
    </Section>
  );
}

/* ── the newest run, above the fold (admin-window/BUG-0040) ──────────────── */

/**
 * The newest adapter run, rendered ABOVE the cycles window.
 *
 * LOOK_AND_FEEL bar 1 names this page by name: at 1440×900, without
 * scrolling, "Cycles & runs shows the newest run with its counts and error".
 * The two halves are stacked and the cycles half is a window of at most 200
 * rows, so against a populated database the runs heading sat 4,419px below the
 * fold — 4.9 viewport-heights down — and the operator had to scroll the whole
 * cycles window to reach the first run (measured on the M1 endgame designer
 * walk, 2026-09-03, admin-window/BUG-0040). Dropping the 200-row cycles window
 * would trade one honesty for another; the newest run is repeated here
 * instead, and both windows below stay exactly what they were.
 *
 * Three rules keep the repetition honest:
 *
 *  - **It is the same READ.** The row is `runs.data.rows[0]` — the first row
 *    of the window rendered below, in the order that read returned (newest
 *    first, `readRuns` in `lib/db/runs.ts`). Not a second query, which could
 *    answer from a different instant, and not a re-sort of the window here.
 *  - **It is the same CELLS.** `runColumns(now, "lead")` is the same nine
 *    columns from the same `RUN_COLUMNS`, so the lead renders a run exactly as
 *    the table does, down to the dash. Only the identity hook differs, so
 *    nothing that reads `[data-run]` counts this row as a second run — and the
 *    length bound on the error cell, which is a bound and not a second
 *    rendering: under `CLAMP_LIMIT` the lead is the window's row cell for cell,
 *    and over it the lead ends in an ellipsis while the whole string stays on
 *    its `title` and in the window's own cell below
 *    (campaign admin-window/DEBT-0005).
 *  - **It states no FIGURE.** A lead is a row, never a count: the window line
 *    below is the only place this half describes its window, and no number
 *    here comes from `rows.length` (ARCHITECTURE.md §4.3).
 *
 * With no row to lead with — an empty window, a refused read, an absent table
 * — it says which of those it is, in one sentence naming the object the read
 * itself named, and links to the section that says it in full. It draws no
 * second state card: each of the four states is rendered once, by the surface
 * that made the read (LOOK_AND_FEEL, Emptiness).
 */
function LatestRun({
  runs,
  now,
  source,
}: {
  runs: DbResult<RunWindow>;
  now: string;
  /** The `?source=` facet as the URL carried it, or undefined for no facet. */
  source: string | undefined;
}): ReactNode {
  const newest: RunRow | undefined =
    runs.kind === "ok" ? runs.data.rows[0] : undefined;
  // What the lead is showing, for a test to read before it reads a row: the
  // window's first row, or which of the three row-less states this is.
  const kind =
    runs.kind === "ok" ? (newest === undefined ? "empty" : "ok") : runs.kind;

  if (newest === undefined) {
    return (
      <Section title={LATEST_RUN_LABEL} surface={LATEST_RUN_SURFACE}>
        <p data-latest-run-state={kind} className="type-body text-ink-secondary">
          {runs.kind === "not_provisioned" ? (
            <>
              No newest run to show: the read named{" "}
              <span className="type-data text-ink">{runs.missing}</span>, and
              this database holds no such object —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                what creates it is below
              </a>
              .
            </>
          ) : runs.kind === "error" ? (
            <>
              No newest run to show: the read of{" "}
              <span className="type-data text-ink">{runs.reading}</span>{" "}
              failed —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                what the database said is below
              </a>
              .
            </>
          ) : source === undefined ? (
            <>
              No adapter has filed a run in this window, so there is no newest
              run to lead with —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                the runs window is below
              </a>
              .
            </>
          ) : (
            <>
              No run in this window carries the source name{" "}
              <span className="type-data text-ink">{source}</span>, so there is
              no newest run to lead with under it —{" "}
              <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
                the runs window is below
              </a>
              .
            </>
          )}
        </p>
      </Section>
    );
  }

  return (
    <Section title={LATEST_RUN_LABEL} surface={LATEST_RUN_SURFACE}>
      <div data-latest-run-state={kind}>
        <DataTable<RunRow>
          label={LATEST_RUN_LABEL}
          columns={runColumns(now, "lead")}
          rows={[newest]}
          rowKey={(row) => row.run_id}
        />
      </div>
      <p className="type-body text-ink-secondary">
        The first row of the{" "}
        <a href={`#${RUNS_ANCHOR}`} className={IN_PAGE_LINK}>
          adapter-runs window below
        </a>
        , repeated here so the last thing that ran is on screen without
        scrolling the cycles. It is that one row and nothing else: what the
        window holds, and what it does not, is stated with the table itself.
      </p>
    </Section>
  );
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
      <LatestRun runs={runs} now={now} source={askedSource} />

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
          <p
            data-window="cycles"
            data-window-limit={String(CYCLE_WINDOW)}
            data-window-truncated={cyclesTruncated ? "true" : "false"}
            className="type-body text-ink-secondary"
          >
            The resolver&rsquo;s newest cycles, newest first — a window of at most{" "}
            {count(CYCLE_WINDOW)}, not a count of the cycles that exist.
            {cyclesTruncated
              ? " The window filled its cap, so older cycles ran than the ones below."
              : ""}
          </p>
        ) : null}
        {askedFor === undefined ? null : (
          <AskedCycle askedFor={askedFor} state={asked} />
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
            columns={cycleColumns(now, askedFor)}
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
        <AdapterRuns runs={runs} now={now} source={askedSource} />
      </div>

      <Section title={HEALTH_LABEL} surface={HEALTH_SURFACE}>
        {health.kind === "ok" ? (
          <CycleHealthSection health={health.data} />
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
