import type { NextConfig } from "next";

import { EDITABLE_TABLES } from "./src/lib/edit/config";

/**
 * A record URL whose table the edit map does not carry must answer with the
 * app's OWN framed 404, server-rendered, with status 404 (campaign
 * admin-window/BUG-0017). That is routing configuration rather than a
 * `not-found.tsx`, and the reason is measured, not assumed.
 *
 * WHY NOT A not-found FILE. `src/app/records/[table]/[id]/page.tsx` calls
 * `notFound()` for a table the map does not carry. On Next 16.2.2 that throw
 * reaches React's HTML renderer inside the render SHELL, where an error
 * boundary cannot supply a fallback — Next's not-found boundary is a client
 * error boundary — so the HTML render aborts and Next serves
 * `<html id="__next_error__">`: an empty, classless, unstyled document that
 * only becomes the 404 page after hydration. Measured on this repo, cookie-
 * authed, `next start`: adding `src/app/records/[table]/[id]/not-found.tsx`
 * changes nothing (still the error shell, len 8820). Rendering the not-found
 * component inline instead of throwing DOES server-render the whole framed
 * document (len 10933) — but with status 200, because `notFound()`'s 404 is
 * set in exactly one place, the `catch` in
 * `node_modules/next/dist/esm/server/app-render/app-render.js` (lines
 * 1894-1918) that also emits that error shell. In-render, the 404 status and
 * the server-rendered document are inseparable.
 *
 * WHY ROUTING WORKS. A 404 the ROUTER decides is different in kind: the
 * status is already on the response before rendering starts (`is404:
 * res.statusCode === 404`, same file), so the not-found tree renders normally,
 * through the root layout. That is why an unmatched URL such as `/analytics`
 * already serves the whole framed surface. Next's own guidance says the same
 * thing — "ensure the resource exists before the response body is streamed"
 * and "rewrite missing slugs to a not-found route"
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`,
 * Status Codes). So this rewrite makes the URL simply not name a page, and
 * Next's ordinary 404 does the rest. The destination is deliberately a path no
 * route matches; the http suite asserts it stays that way.
 *
 * THE SIGN-IN GATE IS UNTOUCHED. Proxy runs at step 3 of Next's routing order
 * and `beforeFiles` rewrites at step 4 (`proxy.md`, Execution order), so the
 * gate still sees the original path and an anonymous visitor is still sent to
 * `/login` — never a 404 that would disclose which record surfaces exist. The
 * http suite asserts that too.
 *
 * The table list is derived from the ONE map in `src/lib/edit/config.ts`, so
 * adding a table to `EDIT_CONFIG` is still the only edit that surface needs.
 */

/** A literal string, safe to embed in the rewrite's path pattern. */
function forPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every spelling ONE character of a table name can have in a request path:
 * the literal (`e`), or its percent-encoded form (`%65`) — RFC 3986 §2.1, and
 * §6.2.2.2 says the two are the same URI.
 *
 * The hex digits are written as explicit two-case classes (`%6[eE]`) rather
 * than leaning on the matcher's own case-folding, so this pattern means the
 * same thing whether or not Next compiles a rewrite source case-insensitively.
 * Multi-byte characters are encoded byte by byte, as a URI path must be;
 * today every table name is ASCII, and this does not have to be re-thought
 * the day one is not.
 */
function anySpellingOfChar(char: string): string {
  const encoded = Array.from(new TextEncoder().encode(char))
    .map((byte) => {
      const hex = byte.toString(16).padStart(2, "0");
      const digits = Array.from(hex)
        .map((digit) => (/[a-f]/.test(digit) ? `[${digit}${digit.toUpperCase()}]` : digit))
        .join("");
      return `%${digits}`;
    })
    .join("");
  return `(?:${forPattern(char)}|${encoded})`;
}

/**
 * A table name as EVERY path segment that names it: `events`, `ev%65nts`,
 * `%65%76%65%6E%74%73` and every mixture — the complete set, because
 * percent-decoding is per character, so each character is either itself or its
 * one `%XX` spelling and there is no third option.
 *
 * Still ONE list: this is a function of `EDITABLE_TABLES`, not a second copy
 * of it.
 */
function anySpellingOf(table: string): string {
  return Array.from(table).map(anySpellingOfChar).join("");
}

const knownTables = EDITABLE_TABLES.map(anySpellingOf).join("|");

/**
 * The table segment this rewrite claims: one that names no configured table —
 * under ANY spelling of that table, percent-encoding included.
 *
 * PERCENT-ENCODING, AND WHY THE EXCLUSION IS ENCODING-AWARE RATHER THAN THE
 * SEGMENT CLASS BEING NARROW (campaign admin-window/BUG-0081). A rewrite
 * `source` is matched against the RAW path, before Next decodes the dynamic
 * segment the page reads — measured on Next 16.2.2: `/records/gro%75ps/<id>`
 * reaches the page with `table` already decoded to `groups`. So the two facts
 * that decide this pattern pull against each other: `gro%75ps` and `groups`
 * must get the SAME answer (RFC 3986 §6.2.2.2), yet the matcher only ever
 * sees the spelling the client sent.
 *
 * Excluding `%` from the segment (`[^/%]+`, as this pattern read until
 * BUG-0081) satisfies the second fact by giving up on the first: it left every
 * encoded spelling to the page's `notFound()` throw and the client-rendered
 * error shell admin-window/BUG-0017 exists to remove. Claiming `%` segments
 * with a plain-text exclusion list would break the other side — `ev%65nts` is
 * a working record surface and must stay one. The pattern therefore claims
 * every segment (`[^/]+`) and excludes every SPELLING of a configured table,
 * which is the exclusion the raw path can be tested against: an encoded name
 * the map carries still renders, an encoded name it does not carry is
 * rewritten to the backstop and answers exactly as its plain spelling does.
 *
 * THE CASE-VARIANT GAP IS UNCHANGED AND STILL OPEN. A rewrite source is
 * matched case-insensitively while `editConfigFor` is exact (the map's keys
 * are the database's own spelling), so `/records/EVENTS/<id>` is read as a
 * configured table here, is not claimed, reaches the page and is refused there
 * with the same client-rendered document (measured cookie-authed on
 * `next start`: 404, len 7917). This change neither widens nor narrows that:
 * the exclusion above matches a superset of the spellings the old one did, so
 * the direction of the remaining gap is still the safe one — a table the map
 * DOES carry can never be rewritten away, only an unclaimed URL can fall
 * through to the backstop. The http suite asserts the case variant is a 404
 * and is not a record surface, without pinning the shape of the document it
 * gets.
 */
const UNMAPPED_TABLE = `((?!(?:${knownTables})/)[^/]+)`;

/**
 * A path no route matches, so Next answers it exactly as it answers
 * `/analytics`: status 404, rendered through the root layout. Kept at the top
 * level, away from `/records`, so a future `records/[table]/page.tsx` cannot
 * quietly turn it into a real page.
 */
const NO_RECORD_SURFACE = "/__no-record-surface__";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: `/records/:table${UNMAPPED_TABLE}/:id`,
          destination: NO_RECORD_SURFACE,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
