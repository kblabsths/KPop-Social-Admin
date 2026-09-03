import { describe, expect, it } from "vitest";
import { mintSessionCookie } from "../walk/session-cookie.mjs";
import { AUTH_SECRET, base, startServer, stopServer } from "./server-harness";

/**
 * The edit surface's write path, over http, against the app as BUILT
 * (campaign admin-window/TASK-0017 — acceptance test 7's "a column absent
 * refuses even a forged request").
 *
 * **What this tier proves, exactly.** The refusal being *server-side* is the
 * claim: these requests never touch a browser, a widget or a client bundle —
 * they are raw PATCHes at the route — and none of them is answered 2xx. The
 * route's method surface is asserted here too: only PATCH exists, so there is
 * no read, insert or delete path at this URL.
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
  ["a column the map does not carry", "groups", "spotify_id", "forged"],
  ["another unmapped column", "groups", "fanclub_name", "BLINK"],
  ["a primary key", "groups", "id", "00000000-0000-4000-8000-000000000000"],
  ["a timestamp", "groups", "updated_at", "2026-01-01T00:00:00Z"],
  ["a provenance column", "idols", "last_synced_at", "2026-01-01T00:00:00Z"],
  ["a link column of a resolver-owned table", "events", "venue_id", RECORD_ID],
  ["a real column of a resolver-owned table", "events", "title", "forged"],
  ["a column of the other resolver-owned table", "venues", "name", "forged"],
  ["a table the map does not carry", "event_performers", "role", "forged"],
  ["the raw-payload archive", "scraped_events", "payload", "forged"],
  ["a legacy table", "events_legacy", "title", "forged"],
  ["an app-owned table", "admin_allowed_emails", "email", "forged"],
  ["a json value for a mapped column", "groups", "bio", { nested: true }],
  ["an array value for a mapped column", "groups", "bio", ["a", "b"]],
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
      for (const table of ["groups", "idols", "events", "venues"]) {
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
        url("groups"),
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
        const res = await fetch(url("groups"), {
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
      const legal = await patch(url("groups"), { field: "bio", value: "hello" }, { cookie });
      expect(legal.status).toBeGreaterThanOrEqual(400);

      // 6. PATCH is the only method. A 405 for the rest is the route's own
      //    proof that no read, insert or delete path exists at this URL.
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const res = await fetch(url("groups"), {
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
