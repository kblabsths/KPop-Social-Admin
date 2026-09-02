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

/** A literal table name, safe to embed in the rewrite's path pattern. */
function forPattern(table: string): string {
  return table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const knownTables = EDITABLE_TABLES.map(forPattern).join("|");

/**
 * The table segment this rewrite claims: one Next's own matcher does not read
 * as a configured table, and that carries no percent-encoding.
 *
 * KNOWN AND DELIBERATE — the rewrite claims a little LESS than the page
 * refuses, and only ever in that direction. A rewrite `source` is matched
 * against the raw path and, like every Next route pattern, case-insensitively;
 * `editConfigFor` is exact, because the map's keys are the database's own
 * spelling. So two families of URL are left to the page's `notFound()` and
 * still get the pre-fix client-rendered document (measured, cookie-authed,
 * `next start`): a case variant of a real table, `/records/GROUPS/<id>` (404,
 * len 7917), and a percent-encoded segment, which is excluded here on purpose.
 * Next decodes a dynamic segment before the page reads it, so
 * `/records/gro%75ps/<id>` and `/records/groups/<id>` are the same URI under
 * RFC 3986 §6.2.2.2 and both serve a real groups record (200, len 13487):
 * claiming `%` segments would 404 a page that works. Never breaking a working
 * URL outranks covering an exotic spelling of a broken one, and the direction
 * of the gap is the safe one — a table the map DOES carry can never be
 * rewritten away, only an unclaimed URL can fall through to the backstop.
 */
const UNMAPPED_TABLE = `((?!(?:${knownTables})/)[^/%]+)`;

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
