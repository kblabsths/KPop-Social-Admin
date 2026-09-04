import { Distribution, GaugeCard, TrendTable, spreadRows, type EmptyWords } from "@/components/gauges";
import { WindowLine } from "@/components/ui";
import { counted, duration } from "@/lib/format";
import type { DomainLatency, ResolutionLatency } from "@/lib/gauges/resolution-latency";

/**
 * The resolution-latency gauge's panel — campaign admin-window/DEBT-0004,
 * moved here whole from `src/app/cycles/page.tsx` (spec §5, gauge 2 of 6).
 */

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
export function LatencySection({ latency }: { latency: ResolutionLatency }) {
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
