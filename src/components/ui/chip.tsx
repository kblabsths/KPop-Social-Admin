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
}: {
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <a
      href={href}
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
