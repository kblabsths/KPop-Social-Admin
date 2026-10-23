/**
 * Where a SIGHTING can be seen on the source's own site.
 *
 * Ben, 2026-10-23: *"I don't have enough information about the original item…
 * I need to see the source page, ticketmaster here, where this observation
 * came from."* He is right that it is the missing piece — the candidates tell
 * you which catalog rows are close, and nothing tells you what was actually
 * sighted.
 *
 * **It is CONSTRUCTED, not stored, and that is a compromise worth naming.**
 * The reference `K8vZ917-Rw0` appears in no table in production — not
 * `observations`, not `confirmed_matches`, not `scraped_events`, not
 * `event_sources` (all four checked). The pipeline keeps the source's own
 * reference on the review item and keeps no URL for it, so there is nothing to
 * read. What this module does instead is build the address from the id, per
 * source, from a template this app declares.
 *
 * The honest fix is for the resolver to record the sighting's URL when it
 * opens the item, because only the scraper holds it at ingest time; that is
 * filed in `tracker/for-human/`. Until then this is the difference between an
 * operator who can look and one who cannot.
 *
 * **One template per source, and an unknown source gets NO LINK.** A pattern
 * guessed for a source nobody verified is a link that 404s on an operator
 * mid-decision, which is worse than its absence. `ticketmaster`'s form was
 * verified against the live site on 2026-10-23: the Yeonjun item's reference
 * resolves to that performer's real page, showing the iHeartRadio Jingle Ball
 * dates it was sighted on. Adding a source here means verifying its form the
 * same way.
 */

/**
 * How each source addresses the entry behind a reference.
 *
 * Keyed by the registry's own source NAME, which is what `sources.source`
 * holds and what the item's source resolves to.
 */
const SIGHTING_URL: Readonly<Record<string, (ref: string) => string>> = {
  // Ticketmaster attraction ids begin `K8vZ` and address a performer page.
  // Verified live 2026-10-23 against `K8vZ917-Rw0` -> "Yeonjun".
  ticketmaster: (ref) => `https://www.ticketmaster.com/artist/${encodeURIComponent(ref)}`,
};

/**
 * The source's own page for this reference, or `null` where this app cannot
 * address it.
 *
 * `null` for an unknown source, a blank reference, or a reference carrying
 * anything that is not a plain token — a value that would need escaping to sit
 * in a path is a value this app does not understand, and it draws no link
 * rather than a mangled one.
 */
export function sightingUrl(source: string | null, ref: string | null): string | null {
  if (source === null || ref === null) return null;
  const template = SIGHTING_URL[source.trim().toLowerCase()];
  if (template === undefined) return null;
  const token = ref.trim();
  if (token === "" || !/^[A-Za-z0-9_~.-]+$/.test(token)) return null;
  return template(token);
}

/** Does this app know how to address sightings from that source at all? */
export function addressesSightings(source: string | null): boolean {
  return source !== null && SIGHTING_URL[source.trim().toLowerCase()] !== undefined;
}

/**
 * The NAME a reference item was sighted under, read out of its summary.
 *
 * The resolver writes the sentence from a fixed template —
 * `'{source} "{name}": {candidates} - {question}'` and its uncounted twin
 * (`resolver/summary.py`'s `THE_REFERENCE_READS`) — so the sighted name is the
 * first double-quoted segment and always is.
 *
 * **Reading a name out of prose is a compromise, and a deliberate one.** The
 * name is in the summary ONLY: Ben ruled ids out of the summary on 2026-10-13,
 * and `evidence` holds candidate ids rather than the sighting, so the item
 * carries the name nowhere else. The alternative is showing the operator the
 * source's opaque reference (`K8vZ917-Rw0`) and no name at all.
 *
 * It is bounded to exactly that: the first quoted run, no interpretation of
 * the rest of the sentence, and `null` the moment the template does not hold —
 * never a guess assembled from fragments. A `null` costs one row of the
 * sighting table and nothing else.
 */
export function sightedNameOf(summary: string): string | null {
  const quoted = /"([^"]+)"/.exec(summary);
  if (quoted === null) return null;
  const name = quoted[1].trim();
  return name === "" ? null : name;
}
