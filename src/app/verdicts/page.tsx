import type { ReactNode } from "react";

import { VerdictLog, type VerdictLine } from "@/components/queues";
import type { EmptyWords } from "@/components/gauges";
import {
  Empty,
  Page,
  Section,
  StateOf,
  WindowLine,
  oldestIn,
} from "@/components/ui";
import type { DbResult } from "@/lib/db/result";
import {
  VERDICTS_OBJECT,
  readVerdictLog,
  type VerdictLogWindow,
} from "@/lib/db/verdict";
import { recordHref } from "@/lib/records/routes";

/**
 * Verdicts — every admin data action, newest first.
 *
 * **Its own page since 2026-10-21, at Ben's word**: *"Do we need verdict log as
 * a tab here? It's the queues page not the verdicts page."* It was a TAB of
 * `/queues` (DECISIONS 2026-09-04), argued for on the grounds that VISION names
 * six pages and the sidebar holds exactly six links, so the log should render
 * as a facet of the surface whose items it settles.
 *
 * That argument was about the sidebar's length and not about the log, and it
 * cost the Queues page a tab that answers a different question: the queues hold
 * what is STILL OPEN, the log holds what has already been decided. An operator
 * reaching for one is never reaching for the other. The sidebar is seven links
 * now and LOOK_AND_FEEL's Frame section records the change.
 *
 * Nothing about the log itself moved: the window, the states, the observation
 * leg's own refusal and the rendering are the ones that shipped as the tab.
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5), and it renders per request for the reason every
 * ecosystem page does — a build-time prerender would freeze an error state
 * taken where the app has no credential.
 */
export const dynamic = "force-dynamic";

/** Where a review item opens — the one spelling of that URL on this page. */
function itemPath(reviewItemId: string): string {
  return `/queues/${encodeURIComponent(reviewItemId)}`;
}

/** The name the log's window answers to, for an oracle to read it back by. */
const VERDICT_LOG_WINDOW = "verdict_log";

/**
 * The names this page's graded surfaces answer to — `data-surface`, unique
 * within the page (ARCHITECTURE.md §10, common violation 8).
 *
 * `verdict_provenance` carries the observation leg's own refusal, which is not
 * the log's to answer for: a registry the app could not read costs the log a
 * LINK, never a verdict.
 */
const VERDICT_SURFACE = "verdict_log";
const VERDICT_PROVENANCE_SURFACE = "verdict_provenance";

/** The h2 above the log, and the accessible name of its table. */
const VERDICT_TITLE = "Verdict log";

/** What an empty log holds and what fills it — never a bare "No data". */
const NO_VERDICTS: EmptyWords = {
  holds: "verdict rows",
  filledBy: "An admin settles a review item or overrides a value.",
};

/**
 * The log's rows as lines the table draws.
 *
 * A verdict whose observation this app could not resolve keeps its id and
 * loses only its link: the id renders verbatim rather than linking somewhere
 * invented.
 */
function verdictLines(log: VerdictLogWindow): VerdictLine[] {
  return log.rows.map((row) => {
    const fact =
      row.observation_id === null ? undefined : log.facts.get(row.observation_id);
    return {
      verdictId: row.verdict_id,
      actor: row.actor,
      action: row.action,
      reviewItemId: row.review_item_id,
      itemHref: row.review_item_id === null ? null : itemPath(row.review_item_id),
      observationId: row.observation_id,
      observationHref:
        fact === undefined ? null : recordHref(fact.domain, fact.entity_id),
      note: row.note,
      createdAt: row.created_at,
    };
  });
}

/** The log, its window, and its states. */
function VerdictSection({ log }: { log: DbResult<VerdictLogWindow> }): ReactNode {
  return (
    <Section title={VERDICT_TITLE} surface={VERDICT_SURFACE}>
      {/* The window line follows the READ, not the rows (ARCHITECTURE.md
          §4.3): it stands on an `ok` result — with rows or with none — and on
          no other state, so the absence of the line means "this read did not
          happen" here exactly as it does on every other surface. */}
      {log.kind === "ok" ? (
        <WindowLine
          gauge={VERDICT_LOG_WINDOW}
          window={{
            limit: log.data.limit,
            held: log.data.rows.length,
            truncated: log.data.truncated,
            over: VERDICTS_OBJECT,
            // Newest first, so the last row is the oldest verdict the read came
            // back with — the log's own floor when the window did not fill.
            oldest: oldestIn(log.data.rows, (row) => row.created_at),
            // This read carries no filter at all, so the floor is the log's own.
            scope: null,
          }}
        />
      ) : null}

      <VerdictLog
        label={VERDICT_TITLE}
        lines={log.kind === "ok" ? verdictLines(log.data) : []}
        card={
          log.kind === "not_provisioned" ? (
            <StateOf result={log} />
          ) : log.kind === "ok" && log.data.rows.length === 0 ? (
            <Empty holds={NO_VERDICTS.holds} filledBy={NO_VERDICTS.filledBy} />
          ) : undefined
        }
        line={log.kind === "error" ? <StateOf result={log} /> : undefined}
      />

      {log.kind === "ok" && log.data.factsUnavailable !== null ? (
        // The observation leg alone refused: every verdict is here and only the
        // link to where its observation landed is missing, so the refusal is
        // reported as its OWN sub-surface, naming its own object.
        <div data-surface={VERDICT_PROVENANCE_SURFACE}>
          <StateOf result={log.data.factsUnavailable} />
        </div>
      ) : null}
    </Section>
  );
}

export default async function VerdictsPage() {
  return (
    <Page title="Verdicts">
      <VerdictSection log={await readVerdictLog()} />
    </Page>
  );
}
