import { IN_PAGE_LINK } from "@/components/cycles/links";

/**
 * The scope this page is under when a SOURCE narrows it, and the way back out
 * (campaign admin-window/BUG-0141).
 *
 * `/sources` links every source to "its review items"
 * (`/queues?source_id=<id>`, spec F5), and this page has no chip row for that
 * facet — its vocabulary is unbounded data and this page reads no registry. So
 * the narrowing would otherwise be visible only in the address bar, and a page
 * rendering four rows of a table that holds forty, with nothing on screen
 * saying why, is claiming a population its read did not cover (LOOK_AND_FEEL
 * bar 13: no screen claims a mark it did not draw). This is what says it.
 *
 * **The id is spelled VERBATIM, in mono.** It is a machine identifier, so it
 * renders as itself rather than being prettified or resolved to a name this
 * page cannot look up (LOOK_AND_FEEL Voice bar 5; admin-window/BUG-0043 and
 * friends). It is safe inline because of WHAT REACHES IT, not because of
 * anything done to it here: the page passes the value `canonicalRecordId`
 * RETURNED — `[0-9a-f-]{36}`, the database's own spelling — and never the raw
 * parameter, so no text this app did not author can reach this sentence
 * (ARCHITECTURE.md §7, Common violations row 15). This component scrubs
 * nothing and must not start.
 *
 * The link back drops the source and keeps every other facet and the tab
 * (`queuesHref`), so the narrowing is reversible in one click and the rest of
 * the state survives it (bar 11).
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1). It
 * lives here rather than inline in the page because presentation belongs in
 * `src/components/queues/**` (Common violations row 10).
 */
export function SourceScope({
  facet,
  sourceId,
  clearHref,
}: {
  /** The parameter this scope is of — the page's own `SOURCE_FACET`. */
  facet: string;
  /** The id, canonical, as the URL carries it and the rows hold it. */
  sourceId: string;
  /** This page, this tab, every other facet kept, the source dropped. */
  clearHref: string;
}) {
  return (
    <p data-scope={facet} className="type-body text-ink-secondary">
      Showing only the review items of source{" "}
      <span data-scope-value={sourceId} className="type-data text-ink">
        {sourceId}
      </span>
      .{" "}
      <a href={clearHref} className={IN_PAGE_LINK}>
        Show every source
      </a>
      .
    </p>
  );
}
