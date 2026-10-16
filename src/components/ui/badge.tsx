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

/**
 * What colour a tone is — the app's ONE answer to "what ink does a severity,
 * a health or a plain classification carry", exported so a surface that shows
 * one of these words WITHOUT a chip reads the same map instead of growing a
 * second copy of it (`src/app/page.tsx`, admin-window/BUG-0115).
 *
 * A consumer takes the ink and nothing else: the box — the fill, the radius,
 * the inline-block padding — is `Badge`'s alone, and an anchor may not contain
 * it (ARCHITECTURE.md §7).
 */
export const TONE_INK: Record<BadgeTone, string> = {
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
        TONE_INK[tone],
      )}
    >
      {children}
    </span>
  );
}
