import type { ReactNode } from "react";

/** A section of a page: the h2 in `title` type, then its surface. */
export function Section({
  title,
  surface,
  actions,
  children,
}: {
  /**
   * The h2 above the section — or ABSENT, where the section's content names
   * itself and a heading would only repeat it.
   *
   * Optional since 2026-10-23 (Ben: "please delete the 'WHAT HAPPENED' text at
   * the top"). A heading that restates what the reader is plainly looking at is
   * the same defect as a paragraph that does — "What happened" sat above the
   * item's own summary sentence, which is the account of what happened.
   *
   * A titleless section keeps its `data-surface` identity and its layout, and
   * drops the heading ROW entirely rather than rendering an empty `h2`: an
   * empty heading is worse than none, because everything that navigates by
   * heading would offer it.
   */
  title?: string;
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
      {title === undefined && actions === undefined ? null : (
        <div className="flex items-center justify-between gap-4">
          {title === undefined ? null : (
            <h2 className="type-title text-ink">{title}</h2>
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
