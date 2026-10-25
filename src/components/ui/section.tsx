import type { ReactNode } from "react";

/** A section of a page: the h2 in `title` type, then its surface. */
/**
 * Whether a section's heading is a LABEL or a SENTENCE — campaign
 * admin-window, 2026-10-24.
 *
 *  - `label` — the ordinary case: "Evidence", "Close", "Claims". A few words
 *    naming the surface under them, in the `title` step, which uppercases.
 *  - `sentence` — the heading is a question or an ask composed for this item:
 *    "Please identify ticketmaster's performer K8vZ9173hY0". Same step, same
 *    size and weight, with the transform and the caps tracking off.
 *
 * Ben, 2026-10-24, reading that heading on the deployed app: *"Let's make the
 * request … not displayed in all caps."* The transform is right for a label
 * and wrong for a sentence, and it is worse than a matter of taste here: that
 * heading carries a source's own reference, and `K8vZ9173hY0` uppercased is
 * `K8VZ9173HY0` — a string the source does not have. `tests/offline/ui/
 * markup.ts` already encodes the rule for identifiers that carry an
 * underscore; this one carries none, so it reached the screen rewritten.
 *
 * A FACE rather than a boolean, and named for what the words ARE rather than
 * for the CSS they get, exactly as `ChipFace` is — the caller knows which kind
 * of heading it wrote; it does not know what the type scale does about caps.
 * `label` is the default because it is right for every heading nobody thought
 * about.
 */
export type SectionTitleFace = "label" | "sentence";

const TITLE_FACE: Record<SectionTitleFace, string> = {
  label: "type-title",
  // The step, with the two things that exist FOR uppercase turned off: the
  // transform, and the 0.05em tracking that makes caps legible and makes
  // lowercase prose look spaced out.
  sentence: "type-title normal-case tracking-normal",
};

export function Section({
  title,
  titleFace = "label",
  boxed = false,
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
  /** Whether `title` is a label or a composed sentence. */
  titleFace?: SectionTitleFace;
  /**
   * Draw the section's content as ONE BOX — the app's existing panel: a
   * hairline border on the surface fill, with the standard padding.
   *
   * Ben, 2026-10-24, about the close: *"Can we put all of this between 'please
   * identify…' and 'evidence' into a bubble/box? I think that would make it
   * more clear that everything is a part of the same decision."* Which is
   * exactly what a box is for here — the close is a heading, a notice, a
   * table, a field and three buttons, and nothing but proximity said they were
   * one act.
   *
   * The heading stays OUTSIDE the box, because it names the box.
   */
  boxed?: boolean;
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
            <h2 className={`${TITLE_FACE[titleFace]} text-ink`}>{title}</h2>
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {boxed ? (
        /* CHROME, not surface — and that is the palette's own nesting rather
           than a new look. The three fills stack `page → chrome → surface`,
           and this box CONTAINS surface things: a candidates table, an
           evidence field. Drawing it on `surface` too made it one flat white
           panel continuous with the `surface` table in the Evidence section
           below it, which is what Ben saw ("is it possible to change the box
           style so it looks different from the evidence table below"). On
           chrome, the box reads as the ground its own tables sit on, and the
           section below is plainly a different thing.

           `rounded-panel` (6px, `globals.css`) because he asked for a bubble,
           and because the tables inside it are square — the radius is the
           second thing telling them apart. It is the one container in the app
           with a radius at all, which is why it has a token of its own.

           `px-3 py-2`: 12 horizontal, 8 vertical. The vertical is a third off
           the 12 it started at (Ben, 2026-10-24) — a panel whose content is
           mostly its own bordered children does not need a card's full
           breathing room top and bottom, while the horizontal inset still has
           to clear the border. Both are on the 4px scale.

           `gap-3` rather than the section's own `gap-2`: the box's padding
           sets the rhythm inside it. */
        <div className="flex min-w-0 flex-col gap-3 rounded-panel border border-hairline bg-chrome px-3 py-2">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
