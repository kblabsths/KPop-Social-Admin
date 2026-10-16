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
 * and every rewrite after it — `beforeFiles` at step 4, `afterFiles` at step 6
 * (`rewrites.md`, "The order Next.js routes are checked is"; `proxy.md`,
 * Execution order) — so the gate still sees the original path and an anonymous
 * visitor is still sent to `/login`, never a 404 that would disclose which
 * record surfaces exist. The http suite asserts that too, on the spellings
 * this rule claims.
 *
 * WHY `afterFiles` AND NOT `beforeFiles` (campaign admin-window/BUG-0083). The
 * rule needs a CASE-SENSITIVE matcher, and `experimental.caseSensitiveRoutes`
 * — the only thing in Next that supplies one — does not reach a `beforeFiles`
 * rewrite: `setupFsCheck` passes the flag to headers, redirects, `afterFiles`
 * and `fallback`, and calls `buildCustomRoute('before_files_rewrite', item)`
 * with neither `basePath` nor the flag
 * (`node_modules/next/dist/server/lib/router-utils/filesystem.js:293-300`,
 * read on 16.2.2 — and measured: with the flag set and the rule in
 * `beforeFiles`, `/records/EVENTS/<id>` still reached the page and still
 * served the error shell). `afterFiles` runs after static files and
 * non-dynamic pages but BEFORE dynamic routes, and `/records/[table]/[id]` is
 * a dynamic route — so the rule still decides the miss before the page is
 * reached, which is the only property `beforeFiles` was chosen for. Nothing
 * under `/records/` is a static file or a non-dynamic page, so the steps
 * between the two positions are empty for this source.
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
 * The hex digits are written as explicit two-case classes (`%6[eE]`) because
 * a percent-encoding's hex digits ARE case-insensitive (RFC 3986 §6.2.2.1)
 * while the name they spell is not — and since admin-window/BUG-0083 the
 * matcher no longer folds case for us, so these classes carry that one
 * equivalence alone, and carry it whichever way the source is compiled.
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
 * CASE IS THE OTHER HALF, AND IT IS THE MATCHER'S FLAG, NOT THE PATTERN'S
 * (campaign admin-window/BUG-0083). Next compiles a rewrite `source` with
 * path-to-regexp's `sensitive` option, which defaults to FALSE — an `i`-flagged
 * regex (`node_modules/next/dist/shared/lib/router/utils/path-match.js`). Under
 * that flag `events` also matches `EVENTS`, so the exclusion above read a case
 * variant as a configured table, did not claim it, and let it reach the page —
 * where `editConfigFor("EVENTS")` is null (the map's keys are the database's
 * own spelling, exact) and `notFound()` threw the client-rendered error shell
 * this whole file exists to remove. A URI path is case-SENSITIVE (RFC 3986
 * §6.2.2.1), so `EVENTS` correctly has no record surface; only the document it
 * was refused with was wrong.
 *
 * No pattern can fix that, which is why the fix is the matcher's flag
 * (`experimental.caseSensitiveRoutes` below) and the move to `afterFiles` that
 * lets the flag reach this rule: under an `i`-flagged regex, case folding
 * applies to every literal and every character class, so `[e]`, `[^E]` and a
 * lookahead alike fold — exactness is simply not expressible in the source
 * string. (ES2025's `(?-i:…)` modifier group would express it, and Next's
 * path-to-regexp passes it through — verified — but it is a SyntaxError on any
 * engine below V8 12.5, and this package's `engines.node` is `>=20.0.0` with
 * Railway resolving the runtime from it, so the pattern would take the deploy
 * down on a Node the app is declared to support. Rejected for that, not for
 * taste.)
 *
 * So both halves of "the same table name" are now decided in ONE place and by
 * the same list: encoding by the spellings above, case by
 * `experimental.caseSensitiveRoutes`. Every segment that is not EXACTLY a
 * mapped name — any case variant, `EVENTS`, `Events`, `WALK_SANDBOX`,
 * `EV%65NTS` — is claimed and gets the framed 404, and every spelling that IS
 * one still renders its record surface.
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
  /**
   * The rewrite above is matched CASE-SENSITIVELY, so its notion of "a
   * configured table" is the same one `editConfigFor` has: exact
   * (admin-window/BUG-0083, and the block on `UNMAPPED_TABLE` for why this is
   * a flag rather than a pattern).
   *
   * What it reaches, read in `next/dist` rather than assumed: it is the
   * `sensitive` argument path-to-regexp is given for CUSTOM routes — headers,
   * redirects, `afterFiles` and `fallback` rewrites
   * (`server/lib/router-utils/filesystem.js` `buildCustomRoute`, lines 293-300;
   * `setup-dev-bundler.js` for dev; `base-server.js` for the re-match of a
   * rewritten dynamic route) — and NOT `beforeFiles`, which is built without
   * it, which is why the rule above moved. It is not the app's own routes
   * either: `getRouteRegex` (`shared/lib/router/utils/route-regex.js`) builds
   * `new RegExp` with no flags, so a filesystem route was always
   * case-sensitive and `/Login` already 404s; middleware matchers do not read
   * it. This repo has exactly ONE custom route — the rewrite above — so the
   * blast radius is that rule, and a future case-INsensitive rule would now be
   * a deliberate choice rather than a default nobody picked.
   *
   * It is an `experimental` key on Next 16.2.2 (`server/config-schema.js`,
   * `config-shared.js` default `false`). The behaviour it buys is pinned from
   * the outside by `tests/http/auth.http.test.ts` — the case-variant block
   * there goes red the day an upgrade drops or renames it, which is the whole
   * reason that test is a plain `it` now.
   */
  experimental: {
    caseSensitiveRoutes: true,
  },

  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: `/records/:table${UNMAPPED_TABLE}/:id`,
          destination: NO_RECORD_SURFACE,
        },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
