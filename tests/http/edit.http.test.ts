import { describe, expect, it } from "vitest";
import { mintSessionCookie } from "../walk/session-cookie.mjs";
import {
  AUTH_SECRET,
  base,
  DB_KEY_SENTINEL,
  DB_URL_SENTINEL,
  startServer,
  stopServer,
} from "./server-harness";

/**
 * The edit surface's write path, over http, against the app as BUILT
 * (campaign admin-window/TASK-0017 — acceptance test 7's "a column absent
 * refuses even a forged request").
 *
 * **What this tier proves, exactly.** The refusal being *server-side* is the
 * claim: these requests never touch a browser, a widget or a client bundle —
 * they are raw PATCHes at the route — and none of them is answered 2xx. The
 * route's method surface is asserted here too: only PATCH exists, so there is
 * no read, insert or delete path at this URL. Both write paths are driven —
 * the direct one at `walk_sandbox`, the override one at `events`/`venues`
 * (campaign admin-window/TASK-0054) — and neither answers 2xx from a server
 * that can reach no database.
 *
 * **What this tier cannot prove, and where it is proved instead.** The harness
 * hands the server DB sentinels (a loopback address on a reserved port), so
 * the app under test can reach no database at all (admin-window/TASK-0027) and
 * `requireAdmin()` — which looks the caller up in `admin_allowed_emails` —
 * fails closed for every request. Every PATCH below is therefore refused, but
 * WHICH refusal fired cannot be read off the status here. The map's semantics
 * — a mapped column accepted, an unmapped column refused with no query issued
 * and the row unchanged — are proved against the stub client in
 * `tests/offline/edit/records.test.ts`, where the database's side is
 * observable. The two tiers together are the criterion; neither is it alone.
 */

const RECORD_ID = "2f0bc11e-0000-4000-8000-000000000001";
const url = (table: string, id = RECORD_ID) =>
  `${base}/api/admin/records/${table}/${id}`;

/** The identity this suite signs in as. Not a real address. */
const SUITE_CLAIMS = { sub: "http-suite", email: "http-suite@example.invalid" };

/**
 * A session cookie the running app accepts — the pattern `auth.http.test` uses.
 *
 * Both mint through `tests/walk/session-cookie.mts`, the one copy of that call
 * in `tests/` and the same function a walker runs (admin-window/TASK-0033).
 */
async function signedInCookie(): Promise<string> {
  const { name, value } = await mintSessionCookie({
    secret: AUTH_SECRET,
    claims: SUITE_CLAIMS,
    maxAgeSeconds: 60 * 60,
  });
  return `${name}=${value}`;
}

/** The forgeries a real attacker would send at this route. */
const FORGED_EDITS: ReadonlyArray<readonly [string, string, string, unknown]> = [
  ["a column the map does not carry", "walk_sandbox", "created_at", "forged"],
  ["another unmapped column", "walk_sandbox", "spotify_id", "forged"],
  ["a primary key", "walk_sandbox", "sandbox_id", "00000000-0000-4000-8000-000000000000"],
  // The two Ben struck on 2026-09-08 (admin-window/TASK-0040), each on a
  // column its retired allowlist carried: until then these two requests wrote
  // a catalog row, and they are the forgery this route most has to refuse.
  ["a struck catalog table", "groups", "bio", "forged"],
  ["its number column", "groups", "member_count", 9],
  ["the other struck table", "idols", "stage_name", "forged"],
  ["a provenance column of a struck table", "idols", "last_synced_at", "2026-01-01T00:00:00Z"],
  // The resolver-owned pair, on both sides of their map entry. A column the
  // map does not carry is refused by the map (403 naming the field); a column
  // it DOES carry is refused because the override path cannot be reached on a
  // server that can reach no database at all — never written directly, and
  // never answered 2xx (campaign admin-window/TASK-0054).
  ["a link column of a resolver-owned table", "events", "venue_id", RECORD_ID],
  ["a CHECK-constrained column left out of the map", "events", "event_type", "forged"],
  ["an unruled column of the other one", "venues", "timezone", "forged"],
  ["a mapped column of a resolver-owned table", "events", "title", "forged"],
  ["a mapped column of the other resolver-owned table", "venues", "name", "forged"],
  ["a mapped column whose value the gate would refuse", "venues", "country", "USA"],
  ["a table the map does not carry", "event_performers", "role", "forged"],
  ["the raw-payload archive", "scraped_events", "payload", "forged"],
  ["a legacy table", "events_legacy", "title", "forged"],
  ["an app-owned table", "admin_allowed_emails", "email", "forged"],
  // On a MAPPED column, so what is refused is the VALUE and not the table.
  ["a json value for a mapped column", "walk_sandbox", "label", { nested: true }],
  ["an array value for a mapped column", "walk_sandbox", "label", ["a", "b"]],
  // The invisible class — campaign admin-window/BUG-0095. What THIS tier can
  // say about them is the wire claim and only that: a value with nothing
  // visible in it, sent at a mapped column of a `not null` one, is never
  // answered 2xx by the app as built. WHY it is refused is not readable here
  // (the gate fails closed under the DB sentinels, as the preamble states);
  // that the route turns each into a CLEAR rather than storing it as content
  // is pinned where the writer is observable, in
  // `tests/offline/edit/route.test.ts`. They are here because a body carrying
  // a raw Cf character has to survive the trip through JSON, Node's decoder
  // and the handler at all — which is a property only a real request has.
  ["a zero-width space for a mapped not-null column", "walk_sandbox", "label", "\u200b"],
  ["a padded word joiner for the same column", "walk_sandbox", "label", "  \u2060  "],
  ["a BOM for a mapped column of a resolver-owned table", "events", "title", "\ufeff"],
];

describe("the record PATCH route over http", () => {
  it("gates it, refuses every forged edit, and offers no other method", async () => {
    const { child } = await startServer();
    try {
      const patch = (target: string, body: unknown, headers: HeadersInit = {}) =>
        fetch(target, {
          method: "PATCH",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
          redirect: "manual",
        });

      // 1. The gate. A stranger's PATCH never reaches the handler: the proxy
      //    sends it to the sign-in page, exactly as it does every other route.
      for (const table of ["walk_sandbox", "groups", "events", "venues"]) {
        const res = await patch(url(table), { field: "name", value: "forged" });
        expect(res.status, table).toBeGreaterThanOrEqual(300);
        expect(res.status, table).toBeLessThan(400);
        const location = res.headers.get("location");
        expect(location, table).not.toBeNull();
        expect(new URL(location as string, base).pathname, table).toBe("/login");
      }

      // 2. A forged session is turned away the same way — the cookie is only
      //    accepted because this server was started with the throwaway secret.
      const bad = await mintSessionCookie({
        secret: `${AUTH_SECRET}-but-not-really`,
        claims: SUITE_CLAIMS,
        maxAgeSeconds: 60 * 60,
      });
      const forgedSession = await patch(
        url("walk_sandbox"),
        { field: "name", value: "forged" },
        { cookie: `${bad.name}=${bad.value}` },
      );
      expect(forgedSession.status).toBeGreaterThanOrEqual(300);
      expect(forgedSession.status).toBeLessThan(400);

      const cookie = await signedInCookie();

      // 3. Past the proxy, every forged edit is refused server-side. Nothing
      //    here is a redirect either — these reached the app and were answered.
      for (const [what, table, field, value] of FORGED_EDITS) {
        const res = await patch(url(table), { field, value }, { cookie });
        const where = `${table}.${field} (${what})`;
        expect(res.status, where).toBeGreaterThanOrEqual(400);
        expect(res.status, where).toBeLessThan(600);
      }

      // 4. A malformed body is refused rather than crashing the route.
      for (const body of ["not json at all", '{"field":123}', '{"value":"x"}', "[]", "{}"]) {
        const res = await fetch(url("walk_sandbox"), {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie },
          body,
          redirect: "manual",
        });
        expect(res.status, body).toBeGreaterThanOrEqual(400);
        expect(res.status, body).toBeLessThan(600);
      }

      // 5. No request shape gets a 2xx out of this route without a database —
      //    including a perfectly legal edit of a mapped column. The write is
      //    the database's to accept, never the route's to fake.
      const legal = await patch(
        url("walk_sandbox"),
        { field: "label", value: "hello" },
        { cookie },
      );
      expect(legal.status).toBeGreaterThanOrEqual(400);

      // 6. PATCH is the only method. A 405 for the rest is the route's own
      //    proof that no read, insert or delete path exists at this URL.
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const res = await fetch(url("walk_sandbox"), {
          method,
          headers: { cookie },
          redirect: "manual",
        });
        expect(res.status, method).toBe(405);
      }
    } finally {
      await stopServer(child);
    }
  });
});

/**
 * QA attack, at the wire — campaign admin-window/BUG-0068.
 *
 * What this tier can and cannot say about the id gate, stated before the
 * assertions so nobody reads more into them than they hold. Under the DB
 * sentinels `requireAdmin()` cannot reach `admin_allowed_emails`, so it fails
 * closed and the handler's own answers (404 for a segment that is not an id,
 * 403 for an unmapped column, 400 for a bad body) are NOT observable here —
 * those are pinned in `tests/offline/edit/route.test.ts`, where the gate is
 * stubbed open and the writer is spied.
 *
 * What IS observable here, and is the point: over real HTTP, against the app
 * as built, a hostile URL segment never produces a 5xx, never carries the
 * database's words, and never carries the material this server was started
 * with. That is the claim the caller on the internet can actually check, and
 * it is the claim the trust boundary in STACK.md cares about.
 */
const HOSTILE_IDS: ReadonlyArray<readonly [string, string]> = [
  ["a segment that is not an id", "walk-1"],
  ["a braced id, encoded as a URL must carry it", `%7B${RECORD_ID}%7D`],
  ["a quote", `${RECORD_ID}%27`],
  ["a statement terminator", `${RECORD_ID}%3B%20drop%20table%20groups`],
  ["a PostgREST filter operator", `eq.${RECORD_ID}`],
  ["a wildcard", "%2A"],
  ["Arabic-Indic digits", encodeURIComponent("٢f0bc11e-0000-4000-8000-00000000001")],
  ["a percent-encoded NUL", "%00"],
  ["a percent-encoded newline after a real id", `${RECORD_ID}%0A`],
  ["8000 characters", "a".repeat(8000)],
  ["8000 hex characters", "0123".repeat(2000)],
];

/** Anything that would mean the database, or this server's own material, leaked. */
const NEVER_ON_THE_WIRE = [
  /22P02/i,
  /invalid input syntax/i,
  /pgrst/i,
  /postgres/i,
  /ECONNREFUSED/i,
  /127\.0\.0\.1:1/,
];

describe("a hostile record id at the wire (QA, admin-window/BUG-0068)", () => {
  it("is answered by the gate, never by a 5xx and never in the database's words", async () => {
    const { child } = await startServer();
    try {
      const cookie = await signedInCookie();
      // A table the map DOES carry, and a column it DOES allow: otherwise the
      // map refuses first and the id gate under attack here is never reached
      // — the test would pass without exercising it (LESSONS 3). It was
      // `groups`/`bio` until Ben struck that table from the map on 2026-09-08.
      const send = (id: string, headers: HeadersInit) =>
        fetch(`${base}/api/admin/records/walk_sandbox/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ field: "label", value: "x" }),
          redirect: "manual",
        });

      for (const [what, id] of HOSTILE_IDS) {
        // 1. Uncookied: the gate outranks the id, exactly as for a good one —
        //    the sign-in page, never a 404 that would disclose anything.
        const anonymous = await send(id, {});
        expect(anonymous.status, `anonymous ${what}`).toBeGreaterThanOrEqual(300);
        expect(anonymous.status, `anonymous ${what}`).toBeLessThan(400);
        expect(
          new URL(anonymous.headers.get("location") as string, base).pathname,
          `anonymous ${what}`,
        ).toBe("/login");

        // 2. Signed in: refused, and the refusal is the app's own. No 5xx, no
        //    database text, and nothing of what this server holds.
        const authed = await send(id, { cookie });
        expect(authed.status, `signed in ${what}`).toBeGreaterThanOrEqual(400);
        expect(authed.status, `signed in ${what}`).toBeLessThan(500);
        const text = await authed.text();
        for (const pattern of NEVER_ON_THE_WIRE) {
          expect(text, `${what} leaked ${pattern}`).not.toMatch(pattern);
        }
        expect(text, `${what} leaked the key`).not.toContain(DB_KEY_SENTINEL);
        expect(text, `${what} leaked the url`).not.toContain(DB_URL_SENTINEL);
        expect(text, `${what} leaked the secret`).not.toContain(AUTH_SECRET);
      }

      // 3. A hostile id opens no other method either.
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const res = await fetch(`${base}/api/admin/records/walk_sandbox/walk-1`, {
          method,
          headers: { cookie },
          redirect: "manual",
        });
        expect(res.status, method).toBe(405);
      }
    } finally {
      await stopServer(child);
    }
  });
});
