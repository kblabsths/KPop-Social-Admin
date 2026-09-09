/**
 * How this app spells an anchor and a link — campaign admin-window/DEBT-0004,
 * widened to the whole app by admin-window/BUG-0099.
 *
 * Three constants: the row anchor a `?cycle=` link lands on, the ONE way this
 * app draws a link at rest, and the id the runs window carries. The first and
 * the last are `/cycles`' own; `IN_PAGE_LINK` is not, and never really was —
 * it is the app's single spelling of a link, imported by the record surface's
 * reference line, the queue row and the evidence table as well as by every
 * section of `/cycles`. Spelled once, here, because a second spelling is a
 * second answer to "does this text go somewhere", and BUG-0099 is what the
 * second answer cost: three M2 surfaces shipping links that announced
 * themselves only under the pointer, months after BUG-0054 settled the
 * question.
 */

/** The anchor a linked cycle's row carries, so `#` reaches the row itself. */
export function anchorFor(runId: string): string {
  return `cycle-${runId}`;
}

/**
 * The mark EVERY link in this app wears, whatever ink its own job gives it.
 *
 * Only one kind of link has an ink of its own: the Dashboard's `error_summary`
 * lines, which stay `text-broken` because a failed run is broken by palette
 * job. They carry this half alone, so a red string that navigates is told
 * apart from a red string that does not (admin-window/BUG-0108) — and it is
 * the same half `IN_PAGE_LINK` is built from, so the app has one answer to
 * "what marks a link" and not two.
 */
export const LINK_DECORATION = "underline";

/**
 * How every anchor in this app renders **at rest** (campaign
 * admin-window/BUG-0054, applied app-wide by admin-window/BUG-0099).
 *
 * These links were `text-ink hover:text-accent`, which made a linked cycle id
 * identical to the dozens of mono ids this page prints as plain text: the one
 * thing on screen that would have carried the reader to the row they asked for
 * announced itself only under the pointer, and the M1 user-sim walk scanned
 * 36-character uuids by eye instead of finding it. Accent is the palette's
 * selection-and-interaction job (5.54:1 on surface, 6.36:1 in dark) and the
 * underline is what `/` and the review header already spell a prose link with,
 * so this is the app's existing link, not a new one — and the page now spells
 * link one way, for the cycle id, the newest-error id and the prose links into
 * the runs window alike.
 */
export const IN_PAGE_LINK = `text-accent ${LINK_DECORATION}`;

/**
 * The id the runs window carries, so the lead at the top of the page links to
 * the window itself instead of leaving the operator to hunt for it four
 * screenfuls down (campaign admin-window/BUG-0040).
 */
export const RUNS_ANCHOR = "adapter-runs";
