import type { MouseEventHandler } from "react";
import { cx } from "./cx";

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
  onClick,
  hooks,
}: {
  label: string;
  href: string;
  active?: boolean;
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
        "type-data inline-block rounded-control px-2 py-0.5 transition-colors",
        active
          ? "bg-accent text-on-accent"
          : "bg-chrome text-ink-secondary hover:text-ink",
      )}
    >
      {label}
    </a>
  );
}
