/**
 * The names `/sources`' surfaces and gauges answer to, and the words its two
 * emptinesses are told apart by — campaign admin-window/DEBT-0004, moved here
 * whole from the page file.
 */
import type { EmptyWords } from "@/components/gauges";

/** The chip that clears the narrowing. The app's own word, not a value. */
export const ANY_LABEL = "all";

/** What an empty registry holds and what fills it — never a bare "No data". */
export const NOTHING_REGISTERED: EmptyWords = {
  holds: "sources registered",
  filledBy:
    "A source appears once the scraper repo registers it and it reports a lifecycle and a tier.",
};

/** The emptiness that has a REASON: the narrowing, not the database. */
export const NOTHING_MATCHED: EmptyWords = {
  holds: "sources matching this narrowing",
  filledBy: "Choose 'all' above to see every source the registry holds.",
};

/** The eyebrow each gauge's state card carries, so an absent gauge names its knob. */
export const AWAITING_LABEL = "Awaiting-row claims";
export const REJECTION_LABEL = "Re-rejected values";

/**
 * The name each of /sources' surfaces answers to — `data-surface`, rendered
 * by `Section` and read by the live parity oracle
 * (`tests/live/sources.live.test.ts`), pinned offline by
 * `tests/offline/sources/page.test.ts`.
 *
 * A NAME, never a position. These three were `section:nth-of-type(n)` until
 * admin-window/DEBT-0002, which made the oracle hostage to the page file's element
 * order and to any wrapper a later ticket adds — the failure that cost
 * `/cycles` four live tests when admin-window/BUG-0040 added a section and a
 * `<div>` and `:nth-of-type(1)` began matching two surfaces
 * (admin-window/BUG-0056). `stateOf` demands exactly one match, so a name that
 * does not move is the only addressing that survives a rearrangement.
 *
 * Each trend surface takes the name its window line already answers to
 * (`data-window="awaiting_row"`, `data-window="rejections"`), so the surface
 * and the figure inside it are called the same thing. The name is the
 * surface's identity, not its heading, and is unique within this page — this
 * page writes no `data-surface` of its own anywhere else.
 */
export const REGISTRY_SURFACE = "registry";
export const AWAITING_SURFACE = "awaiting_row";
export const REJECTION_SURFACE = "rejections";
