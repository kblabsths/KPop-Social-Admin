import { cx } from "./cx";

/**
 * The `micro` eyebrow, and the one place a machine identifier is allowed
 * inside one (campaign admin-window/BUG-0049).
 *
 * Two of LOOK_AND_FEEL's own rules collide here. The `micro` step is
 * "10 / 14, uppercase, +0.05em, sans", and Voice bar 5 says machine
 * identifiers "render verbatim in mono and are never prettified into Title
 * Case prose". So a page that builds an eyebrow by concatenating an
 * identifier with English — `` `${stats.queue} open` `` — gets
 * `DATA_CONFLICT OPEN` on screen, three pixels under a subsection heading
 * rendering the same value as `data_conflict`. Same identifier, two spellings,
 * one screen.
 *
 * The way out is the one the subsection heading already demonstrates: **keep
 * the identifier OUT of the sans label**. An eyebrow is therefore two things,
 * not one string —
 *
 *  - the `identifier`, verbatim, in the `data` mono step, its own case and no
 *    tracking (`normal-case tracking-normal` are belt and braces: they hold
 *    even if this span is ever nested inside an uppercasing ancestor), and
 *  - the `words`, which are the app's own and get the `micro` treatment.
 *
 * Nothing that carries an underscore ends up inside a `type-micro` element, so
 * the property is structural rather than a rule someone has to remember.
 *
 * **The space between them is a real text node**, not a flex gap. The two
 * spans are read together by anything that reads text — the accessible name a
 * caller builds with `microLabelText`, and the parity readers in
 * `tests/live/parity.ts` that find a figure by the label standing over it — and
 * a CSS gap is invisible to all of them (the `stuck_patterndial` collision of
 * admin-window/BUG-0045 is the same trap from the other side).
 */

/**
 * An eyebrow: either the app's own words, or a machine identifier optionally
 * qualified by them.
 *
 * A plain `string` is the app's words and is unchanged from what every
 * primitive took before, so no caller that was already right has to move.
 */
export type MicroLabel =
  | string
  | {
      /** The machine's own value — a queue, a source, a column. Rendered verbatim. */
      identifier: string;
      /** What the app calls this figure: "open", "folded", "open age". */
      words?: string;
    };

/**
 * The label as plain text, for an accessible name.
 *
 * `DataTable` names itself with `aria-label`, which takes a string and not
 * markup, so the two halves are joined by the same single space the rendering
 * puts between them.
 */
export function microLabelText(label: MicroLabel): string {
  if (typeof label === "string") return label;
  return label.words === undefined
    ? label.identifier
    : `${label.identifier} ${label.words}`;
}

/** The eyebrow, rendered. */
export function Eyebrow({
  label,
  className,
}: {
  label: MicroLabel;
  /** Extra layout classes from the surface this sits in. Never a type step. */
  className?: string;
}) {
  if (typeof label === "string") {
    return (
      <span className={cx("type-micro text-ink-secondary", className)}>{label}</span>
    );
  }
  return (
    <span className={cx("text-ink-secondary", className)}>
      <span className="type-data normal-case tracking-normal">{label.identifier}</span>
      {label.words === undefined ? null : (
        <>
          {" "}
          <span className="type-micro">{label.words}</span>
        </>
      )}
    </span>
  );
}
