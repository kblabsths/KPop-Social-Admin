import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * A machine identifier, rendered verbatim in the mono face — the app's ONE
 * identifier-in-prose spelling (campaign admin-window/DEBT-0011).
 *
 * LOOK_AND_FEEL Voice bar 5: machine identifiers (`data_conflict`,
 * `admin_locked`, `event_performers`, `wont_fix`) "render verbatim in mono and
 * are never prettified into Title Case prose". Until this primitive existed,
 * that rule was two Tailwind classes hand-typed at 48 call sites in 26 files,
 * and the campaign fixed the same breach three times one surface at a time —
 * admin-window/BUG-0112 (the record page's regime note), BUG-0120 ("the face
 * BUG-0112 fixed one paragraph above") and BUG-0121 ("the face BUG-0120 fixed
 * one route over"). Two pages had grown byte-identical private copies,
 * `TableName` and `ReviewItems`, that could not see each other. Both are gone;
 * this is where the rule lives, and a new hand-spelling is a defect
 * (ARCHITECTURE.md §11, common violation 16).
 *
 * ## What it renders
 *
 * `type-data` (the mono step) plus the ink — full ink for an identifier
 * standing in the app's prose or as a value, `muted` for the same identifier
 * where the surface has already said it louder (the id a page echoes back, the
 * reference id beside a name it resolved). Both are design tokens; no raw
 * colour and no raw font value appears here or at any call site, and no call
 * site can add one: `className`, `dir` and `style` are typed OUT of the props
 * below, so the face cannot be re-spelled or overridden from outside this file.
 *
 * ## Why `dir="ltr"` — the isolation, applied once
 *
 * ARCHITECTURE.md §7 (promoted from common violation 15, admin-window/BUG-0137):
 * "text this app did not author never sits inside a sentence this app wrote" —
 * it reaches prose through an allowlist or **inside its own bidi-isolated
 * box**, never by scrubbing. An identifier span is precisely where foreign text
 * lands: a status the database produced, a source's own name, a column name a
 * URL asked for. HTML's own UA rule isolates a `dir`-bearing inline box
 * (`unicode-bidi: isolate`), so an unterminated U+202E inside an identifier can
 * reorder that identifier and nothing else — the sentence around it, and the
 * text copied out of the page, keep the order this app wrote them in. The
 * identifier itself still renders VERBATIM: isolation reorders nothing and
 * removes nothing, which is exactly why it is the answer here and a blocklist
 * is not.
 *
 * The app's own words are not isolated, because they are not foreign: the
 * prose around a call site is untouched, and that is graded on both fixtures
 * (`tests/offline/ui/primitives.test.ts`).
 *
 * `src/components/ui/dropped-params.tsx` carried this reasoning first, for one
 * sentence; it now gets it from here.
 *
 * ## What this is NOT for
 *
 * - **An identifier inside a LABEL.** `Eyebrow` (`./micro-label.tsx`) and the
 *   page `h1` (`./page.tsx`) render an identifier too, in the same mono step
 *   with `normal-case tracking-normal`, taking the label's own ink rather than
 *   this one — the structural fix of admin-window/BUG-0049 and BUG-0073, which
 *   is about keeping an identifier out of an uppercasing element. Those two
 *   have one owner each already, and inking them from here would change what
 *   they draw.
 * - **The app's own transient words that happen to share the face** — `saving…`,
 *   `settling…`, `loading claims…`, a stat card's sub-line. They are not
 *   identifiers and they are not isolated; they take `DATA_MUTED` below, which
 *   is why this file is the only one in `src/` that spells the class pair.
 */

/** The mono step at full ink: what an identifier wears. Never exported — the component is. */
const DATA_INK = "type-data text-ink";

/**
 * The mono step at secondary ink, as a class, for the four places that wear the
 * identifier's FACE without being an identifier: `Loading`'s line, a stat
 * card's sub-line, and the two in-flight statuses the app writes in mono
 * (`saving…`, `settling…`). They compose it with layout classes or sit on an
 * element this component does not render, and none of them is foreign text, so
 * none of them is isolated.
 *
 * A machine identifier takes `<Identifier muted>` instead — never this.
 */
export const DATA_MUTED = "type-data text-ink-secondary";

/**
 * The hooks a call site may put on an identifier: `data-*` attributes a test or
 * a live oracle addresses it by, an `id` for an anchor, `aria-current`, a
 * `title`. Everything that would re-spell the face — `className`, `dir`,
 * `style` — is typed out, so the face has exactly one owner at runtime too.
 */
type IdentifierHooks = Omit<
  ComponentPropsWithoutRef<"span">,
  "className" | "dir" | "style" | "children"
>;

export function Identifier({
  children,
  muted = false,
  ...hooks
}: IdentifierHooks & {
  /** The identifier itself, rendered verbatim: no case change, no prettifying. */
  children: ReactNode;
  /** Secondary ink, for an identifier the surface has already said louder. */
  muted?: boolean;
}) {
  return (
    <span dir="ltr" {...hooks} className={muted ? DATA_MUTED : DATA_INK}>
      {children}
    </span>
  );
}
