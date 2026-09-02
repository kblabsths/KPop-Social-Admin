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
import {
  DASHBOARD_WINDOW,
  readDashboard,
  type DashboardCycleRow,
  type DashboardRunRow,
} from "@/lib/db/dashboard";
import type { DbResult } from "@/lib/db/result";
import { count, relativeAge } from "@/lib/format";
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
function AttentionDetail({ summary }: { summary: KindSummary }) {
  if (summary.open === 0 || summary.maxSeverity === null) {
    return <span>{NOTHING_OPEN[summary.kind]}</span>;
  }
  const age = relativeAge(summary.oldestOpenedAt);
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
 * A row with no outcome and no `ended_at` is STILL RUNNING and reads as such,
 * never as a blank and never as a failure. A row with no outcome that has
 * ended is left to the table's own dash: the producer recorded no outcome and
 * this page will not invent one. `data-outcome` is the state a test reads, so
 * the words stay the designer's to change.
 */
const OUTCOME_TONE: Record<string, "healthy" | "broken" | "neutral"> = {
  succeeded: "healthy",
  failed: "broken",
};

function Outcome({
  outcome,
  endedAt,
}: {
  outcome: string | null;
  endedAt: string | null;
}) {
  if (outcome !== null && outcome !== "") {
    return (
      <span data-outcome={outcome}>
        <Badge tone={OUTCOME_TONE[outcome] ?? "neutral"}>{outcome}</Badge>
      </span>
    );
  }
  if (endedAt === null) {
    return (
      <span data-outcome="running" className="type-body text-ink-secondary">
        still running
      </span>
    );
  }
  return null;
}

/** When a line happened: relative, with the absolute in the title, linked. */
function Started({ at, href }: { at: string; href: string }) {
  const age = relativeAge(at);
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
 */
function ErrorSummary({ summary, href }: { summary: string | null; href: string }) {
  if (summary === null || summary.trim() === "") return null;
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

const CYCLE_COLUMNS: Column<DashboardCycleRow>[] = [
  {
    key: "started",
    label: "started",
    cell: (row) => (
      <Started at={row.started_at} href={lineHref(CYCLE_PARAM, row.run_id)} />
    ),
  },
  {
    key: "outcome",
    label: "outcome",
    cell: (row) => <Outcome outcome={row.outcome} endedAt={row.ended_at} />,
  },
  { key: "applied", label: "applied", align: "right", cell: (row) => count(row.applied) },
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
    cell: (row) => (
      <ErrorSummary
        summary={row.error_summary}
        href={lineHref(CYCLE_PARAM, row.run_id)}
      />
    ),
  },
];

/**
 * The adapter half shows **only what the Dashboard needs** — source, when,
 * outcome, error line (this ticket). Which of the runs table's 22 columns the
 * Cycles & runs page shows is a separate, blocked question
 * (ARCHITECTURE.md §12 `OPEN-RUNS`) and is not answered here.
 */
const RUN_COLUMNS: Column<DashboardRunRow>[] = [
  { key: "source", label: "source", cell: (row) => row.source },
  {
    key: "started",
    label: "started",
    cell: (row) => (
      <Started at={row.started_at} href={lineHref(RUN_PARAM, row.run_id)} />
    ),
  },
  {
    key: "outcome",
    label: "outcome",
    cell: (row) => <Outcome outcome={row.outcome} endedAt={row.ended_at} />,
  },
  {
    key: "error_summary",
    label: "error",
    cell: (row) => (
      <ErrorSummary summary={row.error_summary} href={lineHref(RUN_PARAM, row.run_id)} />
    ),
  },
];

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
  const { attention, cycles, runs } = await readDashboard();

  return (
    <Page title="Dashboard">
      <Section title="Attention">
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
                  sub={<AttentionDetail summary={attention.data[kind]} />}
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

      <Section title="Cycles">
        <p className="type-body text-ink-secondary">
          The resolver&rsquo;s newest cycles, newest first — a window of{" "}
          {DASHBOARD_WINDOW}, not a count. Open Cycles &amp; runs for the rest.
        </p>
        <LineTable
          result={cycles}
          columns={CYCLE_COLUMNS}
          rowKey={(row) => row.run_id}
          label="cycles"
          holds="cycles recorded yet"
          filledBy="The resolver files a cycle every time it runs."
        />
      </Section>

      <Section title="Runs">
        <p className="type-body text-ink-secondary">
          The adapters&rsquo; newest runs, newest first — a window of{" "}
          {DASHBOARD_WINDOW}, not a count. Open Cycles &amp; runs for the rest.
        </p>
        <LineTable
          result={runs}
          columns={RUN_COLUMNS}
          rowKey={(row) => row.run_id}
          label="runs"
          holds="adapter runs recorded yet"
          filledBy="Each adapter files a run every time it fetches from its source."
        />
      </Section>
    </Page>
  );
}
