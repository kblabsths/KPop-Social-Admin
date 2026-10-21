/**
 * The Frame's navigation, as data (campaign admin-window/TASK-0005).
 *
 * Kept out of the `"use client"` component so the shell's routing behaviour —
 * which paths the sidebar offers and which one it marks active — is a pure
 * function the offline suite can assert without a DOM.
 *
 * LOOK_AND_FEEL, the Frame: text labels, no icons. There is no
 * `icon` field here and none is added; the deprecated app's unicode glyphs
 * (one of them a combining-mark hack) are gone with it.
 */

export interface NavItem {
  /** The route this item links to. */
  readonly href: string;
  /** The word in the sidebar. Sentence case; capitals only for names. */
  readonly label: string;
}

/**
 * The pages of the window, in the order the sidebar lists them.
 *
 * SEVEN since 2026-10-21. It was six, and the count was load-bearing in the
 * design: the verdict log rendered as a TAB of /queues rather than a page of
 * its own precisely to keep the sidebar at six (DECISIONS 2026-09-04). Ben took
 * the tab off that page — "it is the queues page not the verdicts page" — and
 * a view that answers "what has already been decided" is not a facet of the
 * one that answers "what is still open".
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/queues", label: "Queues" },
  { href: "/claims", label: "Claims" },
  { href: "/sources", label: "Sources" },
  { href: "/cycles", label: "Cycles & runs" },
  { href: "/browse", label: "Browse" },
  { href: "/verdicts", label: "Verdicts" },
] as const;

/**
 * Is `href` the nav item the visitor is currently inside?
 *
 * `/` matches only itself — every other route is nested under it as a string,
 * so a prefix test would light the Dashboard on every page. Every other item
 * matches itself and its children, so `/queues/<id>` keeps Queues lit.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Does this path render inside the Frame?
 *
 * Sign-in is outside it: `/login` is the one route reachable without a session
 * (see `src/middleware.ts`'s matcher), and offering a signed-out visitor a
 * sidebar of pages they cannot open is not a window, it is a tease. Its own
 * page owns the full viewport, exactly as it did before the rebuild.
 */
export function isFramed(pathname: string): boolean {
  return pathname !== "/login" && !pathname.startsWith("/login/");
}
