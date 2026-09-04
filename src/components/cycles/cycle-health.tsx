import type { ReactNode } from "react";
import {
  Distribution,
  GaugeCard,
  spreadRows,
  type EmptyWords,
} from "@/components/gauges";
import { WindowLine } from "@/components/ui";
import { STATE_WORD } from "@/lib/cycles/state";
import { absoluteUtc, count, counted, duration, orDash, relativeAge } from "@/lib/format";
import type { CycleHealth } from "@/lib/gauges/cycle-health";
import { IN_PAGE_LINK, anchorFor } from "./links";

/**
 * The cycle-health gauge's panel — campaign admin-window/DEBT-0004, moved here
 * whole from `src/app/cycles/page.tsx` (spec §5, gauge 1 of 6).
 *
 * The aggregate arrives as a plain prop; the gauge that produced it does its
 * own reading in `lib/gauges/cycle-health.ts`, which a component never imports
 * for a value (ARCHITECTURE.md §4 rule 1). `CYCLE_OUTCOME_KEYS` — the buckets
 * the gauge always reports, in its order — comes down from the page for the
 * same reason.
 */

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
 * The known set is `CYCLE_OUTCOME_KEYS`, handed down by the page, and not a
 * second literal list — this file listing its own four words was half of how
 * the panel came to disagree with the rows (admin-window/BUG-0055).
 */
function outcomeRows(
  outcomes: CycleHealth["outcomes"],
  outcomeKeys: readonly string[],
) {
  const known: string[] = [...outcomeKeys];
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
export function CycleHealthSection({
  health,
  outcomeKeys,
}: {
  health: CycleHealth;
  /** The buckets the gauge always reports, in its order (`CYCLE_OUTCOME_KEYS`). */
  outcomeKeys: readonly string[];
}) {
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
        rows={outcomeRows(health.outcomes, outcomeKeys)}
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
