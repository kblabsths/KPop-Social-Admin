import type { ReactNode } from "react";
import {
  Badge,
  DataTable,
  Empty,
  Page,
  Section,
  StatCard,
  StateOf,
  TONE_INK,
  WindowLine,
  drawnWindow,
  oldestIn,
  type Column,
} from "@/components/ui";
import { OUTCOME_BADGE_TONE, outcomeTone } from "@/components/cycles";
import { IN_PAGE_LINK, LINK_DECORATION } from "@/components/cycles/links";
import { STATE_WORD, cycleState, type CycleState } from "@/lib/cycles/state";
import {
  DASHBOARD_WINDOW,
  readDashboard,
  type DashboardCycleRow,
  type DashboardRunRow,
  type LastAppliedCycle,
} from "@/lib/db/dashboard";
import { CYCLES_OBJECT } from "@/lib/db/cycles";
import { RUNS_OBJECT } from "@/lib/db/runs";
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
 * The name each of this page's two WINDOWS answers to — `data-window`, the
 * hook `tests/offline/absence/pages.test.ts` grades the window rule by and the
 * live oracles read a window back by.
 *
 * These two panels were the last windowed lists in the app carrying
 * hand-written prose and publishing no `data-window-*` hook at all, so the
 * rule was unenforceable on exactly them: the runs panel said "a window of 6,
 * not a count. Open Cycles & runs for the rest." over FIVE runs that are every
 * run the framework has recorded, and `/cycles` then showed the operator the
 * same five (admin-window/BUG-0109, the gap DEBT-0006 left). They render the
 * shared `WindowLine` now, like the other nine surfaces.
 */
const CYCLES_WINDOW = "cycles";
const RUNS_WINDOW = "runs";

/**
 * Where the rest of a list is, for the panel that has one.
 *
 * It rides on `more`, so `WindowLine` renders it only where the window's own
 * `truncated` is true — a page may not promise a remainder its own read says
 * is not there (admin-window/BUG-0109). Neither panel spells that comparison:
 * `drawnWindow` makes it from the cap the read carried, in the one place this
 * app decides whether a drawn window filled.
 */
export const THE_REST = "Open Cycles & runs for the rest.";

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
 *
 * **The severity is the word alone, with no chip around it** (ARCHITECTURE.md
 * §7, admin-window/BUG-0115). This card's whole body is an anchor
 * (`ui/stat-card.tsx` — `href` makes it one), and a chip is an inline-block box
 * with a fill of its own: inside that anchor it took priority over the
 * inherited ink, and because the chip's fill and the card's HOVER fill are the
 * same token it dissolved into the card exactly when the reader pointed at it
 * — measured at zero card-fill pixels in the chip's own crop, both themes. The
 * severity keeps its colour and loses its box, which is the designer's
 * admin-window/BUG-0113 precedent applied.
 *
 * The colour is not decided here: `TONE_INK` is `ui/badge.tsx`'s map, the app's
 * one answer to what ink a severity carries, imported rather than copied so
 * this page cannot grow a second opinion about it (the cost of a duplicated
 * tone map is admin-window/BUG-0106). `data-severity` is the hook this page's
 * severity is read by, spelled as `/queues` and the review header spell it.
 */
function AttentionDetail({ summary, now }: { summary: KindSummary; now: string }) {
  if (summary.open === 0 || summary.maxSeverity === null) {
    return <span>{NOTHING_OPEN[summary.kind]}</span>;
  }
  const age = relativeAge(summary.oldestOpenedAt, now);
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span data-severity={summary.maxSeverity} className={TONE_INK[summary.maxSeverity]}>
        {summary.maxSeverity}
      </span>
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
 *
 * **The tone is not decided here.** It is `outcomeTone`'s, imported from the
 * module that owns the decision (`components/cycles/outcome.tsx`), so this
 * table and the two on `/cycles` read one rule: coloured only where health
 * says so, and healthy only where the row has nothing left to answer for.
 * This page used to declare its own copy of the tone map, and
 * admin-window/BUG-0106 is what that cost — the palette rule that an errored
 * outcome is not green was built into that module while this table, drawn from
 * the same producer's rows, went on painting the same word green. `errors` is
 * the row's own count, or `null` for a producer that keeps none.
 */
function outcomeBadge(outcome: string, errors: number | null): ReactNode {
  const tone = outcomeTone(outcome, errors);
  return (
    <span data-outcome={outcome} data-outcome-tone={tone}>
      <Badge tone={OUTCOME_BADGE_TONE[tone]}>{outcome}</Badge>
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
  if (state.kind === "outcome") return outcomeBadge(state.outcome, row.errors);
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
  // `null`, not `0`: a run has no error count of its own, so its word alone
  // decides its tone (admin-window/BUG-0106). A counted zero and an uncounted
  // absence are not the same fact.
  if (outcome !== null && !isAbsent(outcome)) return outcomeBadge(outcome, null);
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
    <a href={href} title={age.title} className={IN_PAGE_LINK}>
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
  // Red is the palette's job here and stays; the link's DECORATION is what
  // tells a red string that navigates from a red string that does not
  // (admin-window/BUG-0108).
  return (
    <a
      href={href}
      data-error-line=""
      className={`type-data whitespace-nowrap text-broken ${LINK_DECORATION}`}
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
 * The one ink both arms of the last-applied line render in, and the one
 * sentence both of them state the read with.
 *
 * Spelled once and shared, so the page CANNOT colour this figure by how old it
 * is — there is no second class to move to — and cannot describe the read it
 * made two ways. The ink is the ordinary secondary-ink body the card's own
 * lede already uses.
 */
const LAST_APPLIED_INK = "type-body text-ink-secondary";
const LAST_APPLIED_SCOPE = "read over every cycle on record, not only the newest.";

/**
 * When the resolver last actually APPLIED something — one line on the cycles
 * card (campaign admin-window/TASK-0039).
 *
 * The question it answers is not the one the table below answers. A user-sim
 * watched 69 cycles run and write nothing while this page read calm, because
 * "the resolver ran at 04:15" and "the resolver changed something at 04:15"
 * are different facts and only the first was on screen. So this states the
 * second, as an age in the page's own age rendering, with the absolute instant
 * in the title like every other age here (Voice bar 6).
 *
 * **A timestamp, not a gauge, and that is a ruling** (Ben, on this ticket):
 * there is no threshold, no elapsed-time colour and no "amber after N hours"
 * — both arms render in the same ink through the same class, and neither
 * compares the age to anything. A dial-able value would also have to live in
 * a source file, which is exactly where a dial may not live; when the
 * ecosystem gives that dial a row, a gauge can read the row.
 *
 * **An unmeasured figure is a refusal, not a zero** (LESSONS class 2): the
 * `null` arm says the resolver applied nothing and names what was read for it
 * — every cycle on record, not the newest few below — so an operator can never
 * read it as "nothing in the last six". The instant is never rendered as a
 * dash and never as a `0`.
 *
 * **The line follows the read** (ARCHITECTURE §4.3, DECISIONS 2026-09-04): it
 * renders on `ok` with a row and on `ok` with none, and drops WHOLE when the
 * read refused or the table is absent. It draws no state card of its own on
 * purpose — the list beside it reads the same table and already names it, and
 * a second card inside this surface would change the kind the surface declares
 * to an oracle grading the list (`tests/live/parity.ts`, `stateOf`).
 *
 * A plain function, like the cells above: nothing here is a component element
 * handed to a primitive that would hide an absence from `orDash`
 * (admin-window/BUG-0026).
 */
function lastAppliedLine(
  result: DbResult<LastAppliedCycle | null>,
  now: string,
): ReactNode {
  if (result.kind !== "ok") return null;
  if (result.data === null) {
    return (
      <p data-last-applied="none" className={LAST_APPLIED_INK}>
        The resolver has applied nothing —{" "}
        {LAST_APPLIED_SCOPE}
      </p>
    );
  }
  const age = relativeAge(result.data.started_at, now);
  // An instant that will not parse is not an age: `relativeAge` hands back the
  // app's absence for it, and this line renders no dash and no stale value —
  // it drops, exactly as it does for a read that refused. `started_at` is
  // `not null` in the table, so this is the unparseable case alone.
  if (isAbsent(age.text)) return null;
  return (
    <p
      data-last-applied="cycle"
      data-last-applied-at={result.data.started_at}
      className={LAST_APPLIED_INK}
    >
      The resolver last applied something{" "}
      <span title={age.title}>{age.text}</span> —{" "}
      {LAST_APPLIED_SCOPE}
    </p>
  );
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
    return <StateOf result={result} />;
  }
  if (result.kind === "error") {
    return (
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={rowKey}
        label={label}
        placeholder={<StateOf result={result} />}
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
  const { attention, cycles, runs, lastApplied } = await readDashboard();

  return (
    <Page title="Dashboard">
      <Section title="Attention" surface={ATTENTION_SURFACE}>
        {attention.kind !== "ok" ? (
          <StateOf result={attention} />
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
        {/* The window line follows the READ, not the rows (ARCHITECTURE.md
            §4.3): it stands on an `ok` result — with rows or with none — and
            on no other state, so its absence means "this read did not happen"
            here exactly as it does on the nine surfaces that already carried
            it. The prose it replaces stood in every state and published no
            hook at all (admin-window/BUG-0109). */}
        {cycles.kind === "ok" ? (
          <WindowLine
            gauge={CYCLES_WINDOW}
            window={drawnWindow({
              limit: DASHBOARD_WINDOW,
              held: cycles.data.length,
              over: CYCLES_OBJECT,
              // Newest first, so the last row is the oldest cycle the read
              // came back with.
              oldest: oldestIn(cycles.data, (row) => row.started_at),
              // Both panels read their whole table — this page carries no
              // facet, no filter and no search — so the floor either line
              // names is the object's own (admin-window/BUG-0114).
              scope: null,
            })}
            shows={{
              of: "newest",
              lede: "The resolver’s newest cycles, newest first",
              rows: "cycles",
              more: THE_REST,
            }}
          />
        ) : null}
        {lastAppliedLine(lastApplied, now)}
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
        {/* Same rule, same shape, same reason as the cycles panel above. */}
        {runs.kind === "ok" ? (
          <WindowLine
            gauge={RUNS_WINDOW}
            window={drawnWindow({
              limit: DASHBOARD_WINDOW,
              held: runs.data.length,
              over: RUNS_OBJECT,
              oldest: oldestIn(runs.data, (row) => row.started_at),
              scope: null,
            })}
            shows={{
              of: "newest",
              lede: "The adapters’ newest runs, newest first",
              rows: "runs",
              more: THE_REST,
            }}
          />
        ) : null}
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
