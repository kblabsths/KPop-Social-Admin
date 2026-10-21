import type { MouseEventHandler } from "react";
import { cx } from "./cx";

/**
 * Whose word a chip carries, and therefore which face it is drawn in.
 *
 * LOOK_AND_FEEL, Typography: *"Mono carries every value the database produced
 * … Sans carries every word the app wrote. That split IS the typographic
 * idea."* The doc's own step table then handed `data` mono to "chips" as a
 * CATEGORY, so every chip was mono whoever wrote its words — and the Queues
 * tab strip rendered the app's own word `Queues` in Geist Mono (Ben's pass,
 * 2026-10-21). The table was wrong; the principle above it was right.
 *
 * So the chip asks instead of assuming, and the caller that KNOWS answers:
 *
 *  - `words` (the default) — the app wrote this label: a tab name, `all`, a
 *    column name, a page size. Sans, the `body` step.
 *  - `value` — the database produced it: a facet value like `data_conflict`,
 *    a registry source name. Mono, the `data` step, verbatim.
 *
 * Defaulting to `words` is deliberate: a chip carrying a machine value is the
 * case a caller can see in its own type (`FilterChoice.face`), while a chip
 * carrying prose is the one a caller writes inline and would never think to
 * annotate. The default that needs no thought is the one that is right when
 * nobody thought.
 */
export type ChipFace = "words" | "value";

const FACE: Record<ChipFace, string> = {
  // `font-medium` on top of the step, not a sixth step: Geist Mono at 400 and
  // Geist Sans at 400 are not equally dark — a monospace glyph carries thicker,
  // more uniform stems to fill a fixed advance width — so the chips read THINNER
  // after the mono/sans fix even at the larger size, which is what Ben saw
  // ("it feels too thin", 2026-10-21). The weight is the fix; the face and the
  // size were both already right.
  words: "type-body font-medium",
  // `data` does not uppercase, so the identifier's own case survives with no
  // `normal-case` of its own — but it is spelled out here because the rule is
  // the identifier's, not this step's: Voice bar 5 holds whatever the step
  // ever grows into.
  value: "type-data normal-case tracking-normal",
};

/**
 * A filter chip: interactive, and a real link, because every filter is
 * bookmarkable and survives the back button (quality bar 11).
 *
 * Active = accent fill + on-accent text; inactive = chrome fill + secondary
 * text. The focus ring is the app-wide one from globals.css.
 */
export function Chip({
  label,
  href,
  active = false,
  face = "words",
  onClick,
  hooks,
}: {
  label: string;
  href: string;
  active?: boolean;
  /** Whose word `label` is — the app's prose or the database's value. */
  face?: ChipFace;
  /**
   * A client caller's interception of the click — the paging size selector,
   * which pushes the address and asks the route instead of loading the page.
   * The `href` stays the real address either way. A server caller passes none.
   */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  /** `data-*` hooks a caller publishes on the chip, for a reader to address it by. */
  hooks?: Record<`data-${string}`, string>;
}) {
  return (
    <a
      {...hooks}
      href={href}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cx(
        FACE[face],
        "inline-block rounded-control px-2 py-0.5 transition-colors",
        active
          ? "bg-accent text-on-accent"
          : "bg-chrome text-ink-secondary hover:text-ink",
      )}
    >
      {label}
    </a>
  );
}
