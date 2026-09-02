import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A badge is never interactive: chrome fill, `data` mono, 4px radius, 2/8
 * padding. **Only severity and health carry colour**, so a page of sources is
 * not a rainbow — tier, kind, bucket and shape all use `neutral`.
 *
 * Severity is a colour, not a scale: `high` amber, `low` gray. There is no
 * third severity and no computed score.
 */
export type BadgeTone = "neutral" | "high" | "low" | "healthy" | "broken";

const TONE: Record<BadgeTone, string> = {
  neutral: "text-ink",
  low: "text-ink-secondary",
  high: "text-attention",
  healthy: "text-healthy",
  broken: "text-broken",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "type-data inline-block rounded-control bg-chrome px-2 py-0.5",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}
