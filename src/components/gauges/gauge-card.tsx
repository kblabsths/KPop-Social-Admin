import type { ReactNode } from "react";
import { StatCard, type StatTone } from "@/components/ui";
import { isAbsent } from "@/lib/format";
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
 * 1. **An unmeasurable figure is the em dash with its REASON**, never a zero,
 *    never a qualifier and never a palette colour — "no cycle has finished
 *    yet" and "zero cycles" tune a knob in opposite directions (spec §5;
 *    every `lib/gauges` aggregate returns `null` rather than `0` for exactly
 *    this reason). What counts as unmeasurable is decided by `isAbsent` in
 *    `lib/format`, the app's ONE definition of absence
 *    (admin-window/BUG-0004), so this card, `StatCard` and `DataTable` cannot
 *    disagree about whether there is a figure.
 * 2. **A count from a truncated window is a floor**, and says so — `floor`
 *    is `window.truncated` from the aggregate's `WindowInfo`.
 * 3. **The four states**, through the `ui` primitives.
 *
 * Pure and synchronous, plain props, no data access — a page reads and hands
 * the aggregate's fields down (ARCHITECTURE §5).
 */

/**
 * The sub-line an absence falls back on when the caller stated no reason.
 *
 * Reached two ways: where the props union cannot demand a reason (see
 * `GaugeCardProps`) — a `string` value the formatters produced, or a `number`
 * that turned out non-finite — and where a reason WAS demanded but is itself
 * an absence, a blank or whitespace-only string the union's third arm accepts
 * because `""` is a `string` (admin-window/BUG-0019). Saying "not measured" is
 * thin, but a bare dash with no words at all is the reading LOOK_AND_FEEL
 * forbids — a card that cannot measure says so (admin-window/BUG-0018).
 */
const UNSTATED_REASON = "not measured";

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

/**
 * Three arms: a state, a figure, or a figure that may not exist.
 *
 * **What the type can force, it forces; the rest is forced at render.** A
 * `value` whose TYPE admits `null` cannot be passed without `absent`, so the
 * common case — an aggregate percentile handed straight down — is structural.
 * TypeScript cannot go further: `duration(null)` and `count(null)` are typed
 * `string` while returning the em dash, and `NaN` is typed `number`, so no
 * arm of this union can tell a formatted absence from a formatted figure
 * (admin-window/BUG-0018 was exactly that gap, and
 * `tests/offline/gauges-ui/cards.test.ts` pins both shapes as callable).
 * Those two paths are caught at render instead: `isAbsent` decides, the floor
 * and the tone are dropped, and `UNSTATED_REASON` stands in for the reason
 * the caller did not give. Passing `absent` alongside a formatted value is
 * always better than relying on that fallback, which is why every arm takes
 * it.
 */
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
        /**
         * Why the figure could not be measured. Optional only because the
         * type cannot see an absence inside a `string` or a non-finite
         * `number` — supply it whenever the value came from a formatter.
         */
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
    // The card that replaces this one keeps this one's eyebrow: the label is
    // the only thing saying WHICH gauge is empty or unprovisioned
    // (admin-window/TASK-0030).
    if (stateReplacesSurface(state))
      return <GaugeStateCard state={state} label={label} />;
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
  // The app's single definition of absence, not a fourth hand-written guard:
  // `null`, `undefined`, a non-finite number, and the em-dash STRING every
  // formatter returns for a null all mean "nothing was measured here"
  // (`isAbsent`, lib/format.ts — admin-window/BUG-0004 and BUG-0018).
  const unmeasured = isAbsent(value);
  // The REASON is asked the same definition as the value: a blank or
  // whitespace-only `absent` states nothing, so it falls back to the words
  // rather than rendering the dash bare. `??` caught only null/undefined and
  // let `""` through as a stated reason (admin-window/BUG-0019).
  const reason = isAbsent(props.absent) ? UNSTATED_REASON : props.absent;

  return (
    <StatCard
      label={label}
      // Normalised to the one null the card renders one way: whatever spelling
      // the absence arrived in, the dash is `orDash`'s dash.
      value={unmeasured ? null : value}
      // No colour on an absent figure: the dash carries the disabled gray, and
      // a state colour on a card with no value states a health it never read.
      tone={unmeasured ? "default" : tone}
      // A floor qualifies a figure; there is nothing to qualify about a dash.
      floor={floor && !unmeasured}
      sub={unmeasured ? reason : sub}
      href={href}
    />
  );
}
