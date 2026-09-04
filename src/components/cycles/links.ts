/**
 * How `/cycles` spells an anchor and a link — campaign admin-window/DEBT-0004.
 *
 * Three constants the page's sections share: the row anchor a `?cycle=` link
 * lands on, the one way this page draws a link at rest, and the id the runs
 * window carries. Spelled once, here, because the cycle table, the asked-for
 * line, the cycle-health error line and the newest-run lead all write them and
 * four spellings is four chances for one of them to stop matching.
 */

/** The anchor a linked cycle's row carries, so `#` reaches the row itself. */
export function anchorFor(runId: string): string {
  return `cycle-${runId}`;
}

/**
 * How every anchor on this page renders **at rest** (campaign
 * admin-window/BUG-0054).
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
export const IN_PAGE_LINK = "text-accent underline";

/**
 * The id the runs window carries, so the lead at the top of the page links to
 * the window itself instead of leaving the operator to hunt for it four
 * screenfuls down (campaign admin-window/BUG-0040).
 */
export const RUNS_ANCHOR = "adapter-runs";
