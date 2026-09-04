import type { ReactNode } from "react";
import {
  Badge,
  DataTable,
  Empty,
  ErrorLine,
  NotProvisioned,
  Page,
  Section,
  StatCard,
  type Column,
} from "@/components/ui";
import { STATE_WORD, cycleState, type CycleState } from "@/lib/cycles/state";
import {
  DASHBOARD_WINDOW,
  readDashboard,
  type DashboardCycleRow,
  type DashboardRunRow,
} from "@/lib/db/dashboard";
import type { DbResult } from "@/lib/db/result";
import { count, duration, isAbsent, relativeAge } from "@/lib/format";
import { RESOLVER_CADENCE_SECONDS } from "@/lib/gauges/gauge";
import { KINDS, type Kind, type KindSummary } from "@/lib/review/shapes";

/**
 * Dashboard — the breakfast view (campaign admin-window/TASK-0009).
 *
 * Authority: admin-observability.md §4 ("attention summary with decision and
 * signal counts separate — open counts, max severity, oldest age; last night's
 * cycles and runs; error lines … everything on it links into the pages
 * below"), §6 (the kind is derived in code — no column carries it),
 * LOOK_AND_FEEL (Key screens — Dashboard; quality bars 1, 2, 4, 6).
 *
 * Three things it answers, in this order and in one screen at 1440×900:
 *
 *  1. **what needs me** — two counts of EQUAL STANDING, decisions and signals,
 *     each with its open count, its max severity and its oldest age, each
 *     linking to its own queue. Neither is nested in, beside or beneath the
 *     other, and neither is styled as the primary inbox (quality bar 2).
 *  2. **did anything happen last night** — the newest resolver cycles and the
 *     newest adapter runs, newest first, with `error_summary` inline.
 *  3. **where do I go next** — every row and every count is a link. The
 *     Dashboard is the entry to the investigation path and never a dead end.
 *
 * Severity is the registry's `low` / `high`, rendered verbatim: there is no
 * score, no rank and no formula anywhere on this page — the ranking formula is
 * parked (VISION non-goal). The kind comes from `lib/review/shapes.ts`, which
 * is the one module that derives it.
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, and every component below it is
 * pure and synchronous with plain props — which is what lets the offline suite
 * render `renderToStaticMarkup(await DashboardPage())` with no jsdom and no
 * database, and the live suite assert its numbers against its own counts.
 *
 * The three reads are reported SEPARATELY: with `resolution_runs` absent the
 * attention counts still render, and each surface names the object it could
 * not read — an error arm always passes `reading` to `ErrorLine`, so a red
 * line saying only "TypeError: fetch failed" can never leave an operator
 * guessing which read refused (admin-window/BUG-0016).
 */

/**
 * Every read here happens per request, against the live database, so the route
 * is rendered per request rather than prerendered at build time
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
 * "Route segment config": `'force-dynamic'` renders "for each user at request
 * time"). Without it this page takes no request-time API at all — it reads no
 * `searchParams` and no cookies — so Next would prerender it during
 * `next build`, where the app has no credential, and the deployed Dashboard
 * would be a FROZEN error state that never re-reads. Cache Components is not
 * enabled in `next.config.ts`, so this option is live on Next 16.2.2.
 */
export const dynamic = "force-dynamic";

/** The two queue pages an attention count opens, and the sub-page for a line. */
const QUEUES_PATH = "/queues";
const CYCLES_PATH = "/cycles";

/**
 * The URL parameter the Queues page reads to show one kind
 * (LOOK_AND_FEEL bar 11: state lives in the URL, so a filtered queue is a
 * bookmark). `kind` is the contract's own word for the decision/signal split
 * (spec §6), so the link reads as what it does.
 *
 * SEAM: the Queues page (its own ticket) is what consumes this name. A link
 * whose parameter it does not read still opens the right page rather than
 * dead-ending — noted on admin-window/TASK-0009's handoff so the two agree.
 */
const KIND_PARAM = "kind";

/** The parameters a cycle line and a run line carry into `/cycles`. */
const CYCLE_PARAM = "cycle";
const RUN_PARAM = "run";

/** What creates the ecosystem tables this page reads. */
const ARRIVES_WITH = "the scraper repo's migrations";

/**
 * The name each of this page's surfaces answers to — `data-surface`, rendered
 * by `Section` and read by the live parity oracle
 * (`tests/live/dashboard.live.test.ts`), pinned offline by
 * `tests/offline/dashboard/page.test.ts`.
 *
 * A NAME, never a position. The oracle addressed these three as
 * `section:nth-of-type(n)` until admin-window/DEBT-0002, which made it hostage
 * to this file's element order and to any wrapper a later ticket adds: on
 * `/cycles` exactly that cost four live tests (admin-window/BUG-0040 added a
 * section and a `<div>`, so `:nth-of-type(1)` matched two surfaces and
 * `stateOf` rightly refused to read a state of two — admin-window/BUG-0056).
 * A name does not move when the page is rearranged.
 *
 * The name is the surface's identity, not its heading, and must be unique
 * within this page — including against any hand-written `data-surface`
 * wrapper, of which this page has none.
 */
const ATTENTION_SURFACE = "attention";
const CYCLES_SURFACE = "cycles";
const RUNS_SURFACE = "runs";

/**
 * The `micro` label above each count — and the label a parity test reads the
 * number under. Keyed by `Kind` so a third kind could not be added without the
 * compiler asking for its label.
 */
const OPEN_LABEL: Record<Kind, string> = {
  decision: "Open decisions",
  signal: "Open signals",
};

/** How each kind's empty count reads, and what fills it. */
const NOTHING_OPEN: Record<Kind, string> = {
  decision: "nothing open — no question is waiting on a verdict",
  signal: "nothing open — nothing is reporting a breakage",
};

/** `/queues` showing one kind alone. */
function queueHref(kind: Kind): string {
  return `${QUEUES_PATH}?${KIND_PARAM}=${encodeURIComponent(kind)}`;
}

/** `/cycles`, reaching the row that produced the line. */
function lineHref(parameter: string, id: string): string {
  return `${CYCLES_PATH}?${parameter}=${encodeURIComponent(id)}`;
}

/**
 * The one `data` sub-line under a count: the max severity, verbatim, and the
 * oldest open item's age.
 *
 * Relative age with the absolute in the title attribute (Voice bar 6). With
 * nothing open there is no severity and no age to show, and the line says so
 * rather than showing a dash pair that reads like missing data.
 */
function AttentionDetail({ summary, now }: { summary: KindSummary; now: string }) {
  if (summary.open === 0 || summary.maxSeverity === null) {
    return <span>{NOTHING_OPEN[summary.kind]}</span>;
  }
  const age = relativeAge(summary.oldestOpenedAt, now);
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <Badge tone={summary.maxSeverity}>{summary.maxSeverity}</Badge>
      <span title={age.title}>oldest {age.text}</span>
    </span>
  );
}

/**
 * A cycle's or a run's outcome, verbatim in mono — `succeeded`, `failed`,
 * `skipped`, and whatever else the producer writes later.
 *
 * A row with no outcome that has ended is left to the table's own dash: the
 * producer recorded no outcome and this page will not invent one.
 * `data-outcome` is the state a test reads, so the words stay the designer's
 * to change.
 *
 * A plain function and not a component, deliberately (campaign
 * admin-window/BUG-0026): a component ELEMENT is never absent to `DataTable`'s
 * `orDash`, whatever it renders, so a component that returns null leaves the
 * cell BLANK — the one rendering LOOK_AND_FEEL forbids. Returning the `null`
 * ITSELF is what puts the shared em dash in the cell. Absence is `isAbsent`,
 * the app's single definition (admin-window/BUG-0004).
 */
const OUTCOME_TONE: Record<string, "healthy" | "broken" | "neutral"> = {
  succeeded: "healthy",
  failed: "broken",
};

/** The producer's own word, verbatim, coloured only where health says so. */
function outcomeBadge(outcome: string): ReactNode {
  return (
    <span data-outcome={outcome}>
      <Badge tone={OUTCOME_TONE[outcome] ?? "neutral"}>{outcome}</Badge>
    </span>
  );
}

/**
 * A CYCLE's state, decided by the one function that decides it everywhere:
 * `cycleState` in the leaf `lib/cycles/state.ts`, against this render's clock
 * and the resolver's cadence — the same call the Cycles & runs page and the
 * cycle-health gauge make about the same row.
 *
 * admin-window/BUG-0074: this cell used to read `ended_at` ALONE, so it had no
 * `died` state at all and a cycle that crashed in March rendered here as
 * "still running" while /cycles rendered the identical row as `died`. The
 * Dashboard's window is the newest six, so the contradiction arrives the
 * moment a cycle dies — on the page whose whole job is "did anything happen
 * last night".
 *
 * The word is `STATE_WORD`'s, never a literal typed here: the two pages must
 * write the same label (Voice glossary), and a word in two files is a word
 * that drifts. `unrecorded` has no word and returns the `null` itself, which
 * is what puts the table's shared dash in the cell.
 */
function cycleOutcomeCell(row: DashboardCycleRow, now: string): ReactNode {
  const state: CycleState = cycleState(row, {
    now,
    cadenceSeconds: RESOLVER_CADENCE_SECONDS,
  });
  if (state.kind === "outcome") return outcomeBadge(state.outcome);
  if (state.kind === "running") {
    return (
      <span data-outcome="running" className="type-body text-ink-secondary">
        {STATE_WORD.running}
      </span>
    );
  }
  if (state.kind === "died") {
    return (
      <span
        data-outcome="died"
        title={`no end recorded ${duration(state.ageSeconds)} after it started`}
      >
        <Badge tone="broken">{STATE_WORD.died}</Badge>
      </span>
    );
  }
  // It ended and recorded no outcome: the table's own dash stands for the
  // value the producer never wrote.
  return null;
}

/**
 * An adapter RUN's outcome. The adapter framework's `runs` are a different
 * producer with no cadence of its own, so age decides nothing here: a run with
 * no outcome and no `ended_at` is in flight and reads as such
 * (admin-window/BUG-0074 is the cycles table alone).
 *
 * The word for "in flight" is still `STATE_WORD`'s, so the two tables on this
 * page cannot come to spell one state two ways either.
 */
function runOutcomeCell(outcome: string | null, endedAt: string | null): ReactNode {
  if (outcome !== null && !isAbsent(outcome)) return outcomeBadge(outcome);
  if (endedAt === null) {
    return (
      <span data-outcome="running" className="type-body text-ink-secondary">
        {STATE_WORD.running}
      </span>
    );
  }
  // It ended and recorded no outcome: the table's own dash, as above.
  return null;
}

/**
 * When a line happened: relative, with the absolute in the title, linked.
 *
 * A plain function, like the two cells below it, so that NO column on this page
 * hands `DataTable` a component element — the shape that defeats `orDash`
 * (admin-window/BUG-0026). This one always renders, but the rule is the rule:
 * the next early return added here would be invisible again.
 */
function startedCell(at: string, href: string, now: string): ReactNode {
  const age = relativeAge(at, now);
  return (
    <a href={href} title={age.title} className="transition-colors hover:text-accent">
      {age.text}
    </a>
  );
}

/**
 * The producer's own `error_summary`, inline and VERBATIM — not trimmed, not
 * summarised, not replaced with a friendlier sentence (LOOK_AND_FEEL: the app
 * shows what the database said). Red because a failed run is broken; linked,
 * so the error line reaches the row that produced it (spec §4).
 *
 * A plain function and not a component, for the same reason the outcome cells
 * are (campaign admin-window/BUG-0026): a run that reported no error yields the
 * `null` itself, so `DataTable` draws the shared em dash instead of emitting
 * an empty cell.
 */
function errorCell(summary: string | null, href: string): ReactNode {
  if (isAbsent(summary)) return null;
  return (
    <a
      href={href}
      data-error-line=""
      className="type-data whitespace-nowrap text-broken"
    >
      {summary}
    </a>
  );
}

/**
 * The cycle table's columns, built against ONE render clock: every age in the
 * table and the running-or-died reading of every row are measured from the
 * same instant, the way the Cycles & runs page builds its own columns. Reading
 * the clock per cell would let two cells of one row disagree about how old it
 * is.
 */
function cycleColumns(now: string): Column<DashboardCycleRow>[] {
  return [
    {
      key: "started",
      label: "started",
      cell: (row) => startedCell(row.started_at, lineHref(CYCLE_PARAM, row.run_id), now),
    },
    {
      key: "outcome",
      label: "outcome",
      cell: (row) => cycleOutcomeCell(row, now),
    },
    {
      key: "applied",
      label: "applied",
      align: "right",
      cell: (row) => count(row.applied),
    },
    {
      key: "escalated",
      label: "escalated",
      align: "right",
      cell: (row) => count(row.escalated),
    },
    { key: "errors", label: "errors", align: "right", cell: (row) => count(row.errors) },
    {
      key: "error_summary",
      label: "error",
      cell: (row) => errorCell(row.error_summary, lineHref(CYCLE_PARAM, row.run_id)),
    },
  ];
}

/**
 * The adapter half shows **only what the Dashboard needs** — source, when,
 * outcome, error line (this ticket). Which of the runs table's 22 columns the
 * Cycles & runs page shows is a separate, blocked question
 * (ARCHITECTURE.md §12 `OPEN-RUNS`) and is not answered here.
 */
function runColumns(now: string): Column<DashboardRunRow>[] {
  return [
    { key: "source", label: "source", cell: (row) => row.source },
    {
      key: "started",
      label: "started",
      cell: (row) => startedCell(row.started_at, lineHref(RUN_PARAM, row.run_id), now),
    },
    {
      key: "outcome",
      label: "outcome",
      cell: (row) => runOutcomeCell(row.outcome, row.ended_at),
    },
    {
      key: "error_summary",
      label: "error",
      cell: (row) => errorCell(row.error_summary, lineHref(RUN_PARAM, row.run_id)),
    },
  ];
}

/**
 * One line surface's four states, from the `ui` primitives (ARCHITECTURE §7).
 *
 * `not_provisioned` replaces the table with the gray card naming the missing
 * object — never a zero, never red. An `error` keeps the header and reports
 * the failure INSIDE the table, naming the read (`reading`) and carrying the
 * database's account in full.
 */
function LineTable<Row>({
  result,
  columns,
  rowKey,
  label,
  holds,
  filledBy,
}: {
  result: DbResult<Row[]>;
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  label: string;
  holds: string;
  filledBy: string;
}): ReactNode {
  if (result.kind === "not_provisioned") {
    return <NotProvisioned missing={result.missing} arrivesWith={ARRIVES_WITH} />;
  }
  if (result.kind === "error") {
    return (
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={rowKey}
        label={label}
        placeholder={
          <ErrorLine
            reading={result.reading}
            failed={result.message}
            retry="Reload to try the read again."
          />
        }
      />
    );
  }
  if (result.data.length === 0) {
    return <Empty holds={holds} filledBy={filledBy} />;
  }
  return <DataTable columns={columns} rows={result.data} rowKey={rowKey} label={label} />;
}

export default async function DashboardPage() {
  // One clock for the whole render: every age on the page, and the
  // running-or-died reading of every cycle, is measured against the same
  // instant — the same rule the Cycles & runs page renders under.
  const now = new Date().toISOString();
  const { attention, cycles, runs } = await readDashboard();

  return (
    <Page title="Dashboard">
      <Section title="Attention" surface={ATTENTION_SURFACE}>
        {attention.kind === "not_provisioned" ? (
          <NotProvisioned missing={attention.missing} arrivesWith={ARRIVES_WITH} />
        ) : attention.kind === "error" ? (
          <ErrorLine
            reading={attention.reading}
            failed={attention.message}
            retry="Reload to try the read again."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              {KINDS.map((kind) => (
                <StatCard
                  key={kind}
                  label={OPEN_LABEL[kind]}
                  value={attention.data[kind].open}
                  sub={<AttentionDetail summary={attention.data[kind]} now={now} />}
                  tone={attention.data[kind].open > 0 ? "attention" : "default"}
                  href={queueHref(kind)}
                />
              ))}
            </div>
            <p className="type-body text-ink-secondary">
              Open items only, each kind counted on its own — open first,
              severity then age, as the queues order them.
            </p>
          </>
        )}
      </Section>

      <Section title="Cycles" surface={CYCLES_SURFACE}>
        <p className="type-body text-ink-secondary">
          The resolver&rsquo;s newest cycles, newest first — a window of{" "}
          {DASHBOARD_WINDOW}, not a count. Open Cycles &amp; runs for the rest.
        </p>
        <LineTable
          result={cycles}
          columns={cycleColumns(now)}
          rowKey={(row) => row.run_id}
          label="cycles"
          holds="cycles recorded yet"
          filledBy="The resolver files a cycle every time it runs."
        />
      </Section>

      <Section title="Runs" surface={RUNS_SURFACE}>
        <p className="type-body text-ink-secondary">
          The adapters&rsquo; newest runs, newest first — a window of{" "}
          {DASHBOARD_WINDOW}, not a count. Open Cycles &amp; runs for the rest.
        </p>
        <LineTable
          result={runs}
          columns={runColumns(now)}
          rowKey={(row) => row.run_id}
          label="runs"
          holds="adapter runs recorded yet"
          filledBy="Each adapter files a run every time it fetches from its source."
        />
      </Section>
    </Page>
  );
}
