import type { ReactNode } from "react";
import { StatCard, type StatTone } from "@/components/ui";
import {
  GaugeStateCard,
  GaugeStateLine,
  stateReplacesSurface,
  type GaugeState,
} from "./state";

/**
 * The figure card — one gauge figure, at a glance (campaign
 * admin-window/TASK-0008).
 *
 * Anatomy is `ui/StatCard`'s and is not re-implemented here: square, 1px
 * border, surface fill, 12px padding, `micro` label, the `figure` number
 * thousand-separated, at most one `data` line of sub-detail, colour on the
 * figure only when it carries a palette state (LOOK_AND_FEEL, Stat / gauge
 * card). What this component adds is the three things a GAUGE figure must
 * carry that a plain stat does not:
 *
 * 1. **An unmeasurable figure is the em dash with its REASON**, never a zero.
 *    The type makes it structural: a `value` that can be `null` cannot be
 *    passed without `absent`, because "no cycle has finished yet" and "zero
 *    cycles" tune a knob in opposite directions (spec §5; every `lib/gauges`
 *    aggregate returns `null` rather than `0` for exactly this reason).
 * 2. **A count from a truncated window is a floor**, and says so — `floor`
 *    is `window.truncated` from the aggregate's `WindowInfo`.
 * 3. **The four states**, through the `ui` primitives.
 *
 * Pure and synchronous, plain props, no data access — a page reads and hands
 * the aggregate's fields down (ARCHITECTURE §5).
 */
type GaugeCardBase = {
  /** The `micro` eyebrow: what the figure counts. */
  label: string;
  /** At most one `data` line of sub-detail. */
  sub?: ReactNode;
  /** Colour, only when the figure carries a palette state. */
  tone?: StatTone;
  /** Makes the card a link to the page that explains the number. */
  href?: string;
  /**
   * The figure is a floor because the read was truncated
   * (`WindowInfo.truncated`). Ignored when there is no figure to qualify.
   */
  floor?: boolean;
};

export type GaugeCardProps = GaugeCardBase &
  (
    | {
        /** The surface is loading, empty, unprovisioned or broken. */
        state: GaugeState;
        value?: never;
        absent?: never;
      }
    | {
        state?: undefined;
        /** A number is thousand-separated; a string is shown verbatim. */
        value: number | string;
        absent?: string;
      }
    | {
        state?: undefined;
        value: number | string | null;
        /**
         * Why the figure could not be measured. Required on a value that may
         * be `null`, and rendered as the card's one sub-line beside the dash.
         */
        absent: string;
      }
  );

export function GaugeCard(props: GaugeCardProps) {
  const { label, tone = "default", href, floor = false, sub } = props;

  if (props.state !== undefined) {
    const state = props.state;
    if (stateReplacesSurface(state)) return <GaugeStateCard state={state} />;
    // A line state keeps the card in its grid: the dash says there is no
    // figure yet, the sub-line says why. Never a zero standing in for a
    // number nobody has read.
    return (
      <StatCard
        label={label}
        value={null}
        sub={<GaugeStateLine state={state} />}
        href={href}
      />
    );
  }

  const value = props.value ?? null;
  const unmeasured = value === null;

  return (
    <StatCard
      label={label}
      value={value}
      // No colour on an absent figure: the dash carries the disabled gray, and
      // a state colour on a card with no value states a health it never read.
      tone={unmeasured ? "default" : tone}
      // A floor qualifies a figure; there is nothing to qualify about a dash.
      floor={floor && !unmeasured}
      sub={unmeasured ? props.absent : sub}
      href={href}
    />
  );
}
