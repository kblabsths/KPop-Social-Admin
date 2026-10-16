import type { ReactNode } from "react";

/** A section of a page: the h2 in `title` type, then its surface. */
export function Section({
  title,
  surface,
  actions,
  children,
}: {
  title: string;
  /**
   * A stable name for this section as a SURFACE, emitted as `data-surface`.
   *
   * A live parity oracle has to address one surface and exactly one
   * (`tests/live/parity.ts`, `stateOf`). Addressing it by position —
   * `section:nth-of-type(n)` — makes every oracle on the page hostage to the
   * page's element ORDER and to any wrapper a later ticket adds: on
   * admin-window/BUG-0040 a new lead section plus one `<div>` wrapper made
   * `section:nth-of-type(1)` match two surfaces and killed four live tests
   * (admin-window/BUG-0056). A name does not move when the page is
   * rearranged, so surfaces a test grades carry one.
   *
   * The name is the surface's identity, not its heading: it stays put when
   * the title's wording changes. It must be unique within a page — including
   * against the hand-written `data-surface` wrappers some sections put around
   * their own table (`data-surface="runs"`).
   *
   * Omitted, the section renders exactly as before, with no attribute.
   */
  surface?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section data-surface={surface} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h2 className="type-title text-ink">{title}</h2>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
