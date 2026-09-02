import type { ReactNode } from "react";
import { count, orDash } from "@/lib/format";
import { cx } from "./cx";

/**
 * Square, 1px border, surface fill, 12px padding: `micro` label, then the
 * `figure` number (thousand-separated), then at most one `data` line of
 * sub-detail. Colour on the figure only when it carries a state.
 *
 * `href` makes the card a link, because on the Dashboard every number links
 * to the page that explains it (LOOK_AND_FEEL, Key screens).
 */
export type StatTone = "default" | "healthy" | "attention" | "broken" | "accent";

const TONE: Record<StatTone, string> = {
  default: "text-ink",
  healthy: "text-healthy",
  attention: "text-attention",
  broken: "text-broken",
  accent: "text-accent",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  href,
  floor = false,
}: {
  label: string;
  /** A number is thousand-separated here; a string is shown verbatim. */
  value: number | string | null;
  /** At most one line of sub-detail. */
  sub?: ReactNode;
  tone?: StatTone;
  href?: string;
  /**
   * The figure is a FLOOR, not a total — the read it came from was truncated,
   * so the true count is this or more. The card then qualifies the number in
   * the app's own voice, beside it, instead of presenting a cut-off count as
   * complete (campaign admin-window/TASK-0008; `WindowInfo.truncated` in
   * `lib/gauges/gauge.ts` is what sets it).
   *
   * The qualifier is sans and secondary because it is a word the app wrote;
   * the figure stays the one mono number the card is about, which is why the
   * honesty goes here rather than into the value string.
   */
  floor?: boolean;
}) {
  const figure = (
    <span className={cx("type-figure", TONE[tone])}>
      {orDash(typeof value === "number" ? count(value) : value)}
    </span>
  );

  const body = (
    <>
      <span className="type-micro text-ink-secondary">{label}</span>
      {floor ? (
        <span className="flex items-baseline gap-1">
          <span className="type-body text-ink-secondary">at least</span>
          {figure}
        </span>
      ) : (
        figure
      )}
      {sub ? <span className="type-data text-ink-secondary">{sub}</span> : null}
    </>
  );

  const shell = "flex flex-col gap-1 border border-hairline bg-surface p-3";

  return href ? (
    <a href={href} className={cx(shell, "transition-colors hover:bg-chrome")}>
      {body}
    </a>
  ) : (
    <div className={shell}>{body}</div>
  );
}
