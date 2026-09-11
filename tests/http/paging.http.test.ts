import { describe, expect, it } from "vitest";
import { CLAIM_WINDOW } from "@/components/claims";
import { RECENT_EVENTS } from "@/lib/browse/views";
import {
  OFFSET_PARAM,
  PAGE_ANSWER_CACHE_CONTROL,
  PAGE_ROUTES,
  isPageAnswer,
} from "@/lib/paging/bounds";
import { mintSessionCookie } from "../walk/session-cookie.mjs";
import { AUTH_SECRET, base, startServer, stopServer } from "./server-harness";

/**
 * The paging route handler over HTTP, against the app as BUILT — campaign
 * admin-window/TASK-0066, M3 EC6.
 *
 * **What this tier proves, exactly.** That the GATE stands in front of the
 * handler on the real server: an unauthenticated GET is answered by the
 * middleware with a redirect to `/login` and the handler body never runs, so
 * no bound is graded, no read is issued and no row is served to a stranger.
 * That is a claim about `src/middleware.ts` + `next start` + the route file
 * together, and no offline tier can make it (LESSONS 10).
 *
 * **What this tier cannot prove, and where it is proved instead.** The harness
 * hands the server DB sentinels (a loopback address on a reserved port), so
 * the app under test can reach no database at all (admin-window/TASK-0027) and
 * `requireAdmin()` — which looks the caller up in `admin_allowed_emails` —
 * fails closed even for a validly signed-in caller. So every answer here is a
 * refusal, and WHICH refusal fired past the middleware is not readable from
 * this tier. The handler's own answers — the refusal table, full-or-exhausted,
 * the four arms — are driven against a recording stub in
 * `tests/offline/paging/claims-route.test.ts`, where the database's side is
 * observable. The two tiers together are the criterion; neither is it alone.
 *
 * **The client-bundle scan lives in `tests/http/auth.http.test.ts`** and was
 * WIDENED by this ticket rather than copied: one owner per structural guard
 * (ARCHITECTURE.md §10). It walks `.next/static` and the prerendered payloads
 * whole — this route's bundle included, since the walk is derived and not
 * listed — and now refuses the service-role role name, a `STAGING_SUPABASE`
 * name and any Supabase project host by shape, beside the key shapes it
 * already refused.
 */

/** The identity this suite signs in as. Not a real address, and not a walker's. */
const SUITE_CLAIMS = { sub: "http-suite", email: "http-suite@example.invalid" };

async function signedInCookie(): Promise<string> {
  const { name, value } = await mintSessionCookie({
    secret: AUTH_SECRET,
    claims: SUITE_CLAIMS,
    maxAgeSeconds: 60 * 60,
  });
  return `${name}=${value}`;
}

const route = `${base}${PAGE_ROUTES.claims}`;
const browseRoute = `${base}${PAGE_ROUTES.browse}`;

/**
 * Requests a stranger would make of the claims page's continuation — one the
 * handler would SERVE, one it would REFUSE 400, and one carrying the facets a
 * real press carries.
 *
 * The refused bound is the load-bearing one: if the gate ran anywhere but
 * first, this request would come back 400 with a `refused` answer, which is
 * the handler telling an unauthenticated caller what its bound grader thinks.
 */
const STRANGER_ASKS: ReadonlyArray<readonly [string, string]> = [
  ["a bound the handler would serve", `?${OFFSET_PARAM}=${CLAIM_WINDOW}`],
  ["a bound the handler would refuse", `?${OFFSET_PARAM}=abc`],
  ["no bound at all", ""],
  ["the facets a press carries", `?tab=standing&domain=events&${OFFSET_PARAM}=${CLAIM_WINDOW}`],
];

describe("the claims paging route, gated like a page", () => {
  it("sends an unauthenticated GET to /login before the handler body runs", async () => {
    const { child } = await startServer();
    try {
      for (const [what, query] of STRANGER_ASKS) {
        const response = await fetch(`${route}${query}`, { redirect: "manual" });

        // 1. The middleware's answer, not the handler's.
        expect(response.status, what).toBeGreaterThanOrEqual(300);
        expect(response.status, what).toBeLessThan(400);
        const location = response.headers.get("location");
        expect(location, what).not.toBeNull();
        expect(new URL(location as string, base).pathname, what).toBe("/login");

        // 2. And nothing of the handler's came with it: no page answer, on any
        //    arm. A 400 `refused` here would mean the bound was graded for a
        //    caller the app never let in.
        const body = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = undefined;
        }
        expect(isPageAnswer(parsed), `${what} answered a page answer`).toBe(false);
      }
    } finally {
      await stopServer(child);
    }
  });

  it("refuses a signed-in caller the allowlist cannot vouch for, and serves no rows", async () => {
    const { child } = await startServer();
    try {
      const response = await fetch(`${route}?${OFFSET_PARAM}=${CLAIM_WINDOW}`, {
        headers: { cookie: await signedInCookie() },
        redirect: "manual",
      });

      // Past the middleware, `requireAdmin()` fails CLOSED: this server can
      // reach no `admin_allowed_emails` at all (STACK §3, harness sentinels).
      expect(response.status).toBe(403);
      const body: unknown = await response.json();
      expect(isPageAnswer(body)).toBe(false);
      // No rows, and no material about the read that never happened.
      expect(JSON.stringify(body)).not.toMatch(/SUPABASE|service_role|supabase\.co|rows/i);
    } finally {
      await stopServer(child);
    }
  });

  it("offers no method but GET at that path", async () => {
    const { child } = await startServer();
    try {
      const cookie = await signedInCookie();
      for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
        const response = await fetch(route, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ rows: [] }),
          redirect: "manual",
        });
        // 405 from Next (no such export) — never a 2xx, and never a write.
        expect(response.status, method).toBe(405);
      }
    } finally {
      await stopServer(child);
    }
  });
});

/**
 * The BROWSE paging route, over the same built app — campaign
 * admin-window/TASK-0068.
 *
 * Same claim, same tier, one surface over: the gate stands in front of this
 * handler on the real server, so a stranger's press is answered by the
 * middleware and the handler body never runs — no bound is graded, no read is
 * issued and no event row is served.
 */
const BROWSE_STRANGER_ASKS: ReadonlyArray<readonly [string, string]> = [
  ["a bound the handler would serve", `?${OFFSET_PARAM}=${RECENT_EVENTS.window}`],
  ["a bound the handler would refuse", `?${OFFSET_PARAM}=abc`],
  ["no bound at all", ""],
  ["the params the view carries", `?cols=title%2Cvenue&${OFFSET_PARAM}=${RECENT_EVENTS.window}`],
];

describe("the browse paging route, gated like a page", () => {
  it("sends an unauthenticated GET to /login before the handler body runs", async () => {
    const { child } = await startServer();
    try {
      for (const [what, query] of BROWSE_STRANGER_ASKS) {
        const response = await fetch(`${browseRoute}${query}`, { redirect: "manual" });

        expect(response.status, what).toBeGreaterThanOrEqual(300);
        expect(response.status, what).toBeLessThan(400);
        const location = response.headers.get("location");
        expect(location, what).not.toBeNull();
        expect(new URL(location as string, base).pathname, what).toBe("/login");

        // A 400 `refused` here would mean the bound was graded for a caller
        // the app never let in.
        const body = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = undefined;
        }
        expect(isPageAnswer(parsed), `${what} answered a page answer`).toBe(false);
      }
    } finally {
      await stopServer(child);
    }
  });

  it("refuses a signed-in caller the allowlist cannot vouch for, and serves no rows", async () => {
    const { child } = await startServer();
    try {
      const response = await fetch(`${browseRoute}?${OFFSET_PARAM}=${RECENT_EVENTS.window}`, {
        headers: { cookie: await signedInCookie() },
        redirect: "manual",
      });

      // Past the middleware, `requireAdmin()` fails CLOSED: this server can
      // reach no `admin_allowed_emails` at all (STACK §3, harness sentinels).
      expect(response.status).toBe(403);
      const body: unknown = await response.json();
      expect(isPageAnswer(body)).toBe(false);
      expect(JSON.stringify(body)).not.toMatch(/SUPABASE|service_role|supabase\.co|rows/i);
    } finally {
      await stopServer(child);
    }
  });

  it("offers no method but GET at that path", async () => {
    const { child } = await startServer();
    try {
      const cookie = await signedInCookie();
      for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
        const response = await fetch(browseRoute, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ rows: [] }),
          redirect: "manual",
        });
        // 405 from Next (no such export) — never a 2xx, and never a write.
        expect(response.status, method).toBe(405);
      }
    } finally {
      await stopServer(child);
    }
  });
});

/**
 * A GATED ANSWER IS NEVER STORABLE — campaign admin-window/TASK-0068.
 *
 * **What this tier proves, exactly.** That `PAGE_ANSWER_CACHE_CONTROL` really
 * is what the BUILT Next server answers a gated, dynamically rendered page
 * with — byte for byte, from the running server rather than from a docstring
 * quoting `node_modules/next/dist/server/base-server.js`. That is the whole
 * justification for the constant: the rows behind the gate and the screen they
 * continue must be ONE surface under ONE cache policy, and a Next upgrade that
 * changed its own directives would silently make them two. No offline tier can
 * see that string.
 *
 * And that nothing this route answers a stranger or an unvouched-for caller is
 * storable either: no `public`, no positive `max-age`, no `s-maxage`.
 *
 * **What this tier cannot prove, and where it is proved instead.** The harness
 * hands the server DB sentinels, so `requireAdmin()` — which looks the caller
 * up in `admin_allowed_emails` — fails closed even for a validly signed-in
 * caller (see the suite docstring above). The gate's own 403 is not one of the
 * handler's four arms, so the handler's four arms are UNREACHABLE from this
 * tier. The header is asserted on every one of them against a recording stub
 * in `tests/offline/paging/browse-route.test.ts` and
 * `tests/offline/paging/claims-route.test.ts`, where the database's side is
 * observable. The two tiers together are the criterion; neither is it alone.
 *
 * **Both paging surfaces are checked here, each against its OWN page**
 * (admin-window/BUG-0171). What the constant must equal is what a gated page
 * on the same surface really answers, read off the same running server in the
 * same run — never a string a ticket typed into a test.
 */
describe("a gated answer is never storable", () => {
  /** Anything that would let a store keep a copy. */
  function isStorable(value: string | null): boolean {
    if (value === null) return false;
    const directives = value.toLowerCase();
    if (directives.includes("public")) return true;
    if (/s-maxage=\s*[1-9]/.test(directives)) return true;
    return /(^|[^-])max-age=\s*[1-9]/.test(directives);
  }

  /**
   * BOTH pages, each the first screen of a route asserted below it: `/browse`
   * for `/api/admin/browse/rows`, `/claims` for `/api/admin/claims/rows`. The
   * two routes are graded against what their OWN surface answers, in one run
   * on one server, so neither is graded against a string this suite invented.
   */
  const PAGES: ReadonlyArray<readonly [string, string]> = [
    ["/browse", "/browse"],
    ["/claims", "/claims"],
  ];

  it("is spelled exactly as the built server spells it on a gated page", async () => {
    const { child } = await startServer();
    try {
      const cookie = await signedInCookie();
      for (const [what, page] of PAGES) {
        const response = await fetch(`${base}${page}`, {
          headers: { cookie },
          redirect: "manual",
        });

        // The page renders (its panels name their own refusals — no database
        // here) and Next answers it with the directives every gated screen
        // gets.
        expect(response.status, what).toBe(200);
        expect(response.headers.get("cache-control"), what).toBe(PAGE_ANSWER_CACHE_CONTROL);
        await response.text();
      }
    } finally {
      await stopServer(child);
    }
  });

  /**
   * The two routes, each asked for a bound it would SERVE and a bound it would
   * REFUSE, on the real server.
   *
   * The gate answers both 403 on this tier (no `admin_allowed_emails` to
   * vouch for anyone), so what is provable here is the negative one: nothing
   * either route puts on the wire — the gate's own refusal included — is
   * anything a store may keep. Which of the handler's four arms carries which
   * header is the offline tier's claim, against a recording stub.
   */
  const ROUTE_ASKS: ReadonlyArray<readonly [string, string]> = [
    ["the browse route, a signed-in GET", `${browseRoute}?${OFFSET_PARAM}=${RECENT_EVENTS.window}`],
    ["the browse route, a refused bound", `${browseRoute}?${OFFSET_PARAM}=abc`],
    ["the claims route, a signed-in GET", `${route}?${OFFSET_PARAM}=${CLAIM_WINDOW}`],
    ["the claims route, a refused bound", `${route}?${OFFSET_PARAM}=abc`],
  ];

  it("answers a signed-in GET and a refused bound with nothing a store may keep", async () => {
    const { child } = await startServer();
    try {
      const cookie = await signedInCookie();
      for (const [what, url] of ROUTE_ASKS) {
        const response = await fetch(url, {
          headers: { cookie },
          redirect: "manual",
        });
        expect(isStorable(response.headers.get("cache-control")), what).toBe(false);
        await response.text();
      }
    } finally {
      await stopServer(child);
    }
  });

  /**
   * The guard on `isStorable` itself: a predicate that never saw an input it
   * MUST flag passes vacuously (LESSONS 8). These are the spellings a cache
   * would act on, and none of them may read as unstorable.
   */
  it("would flag a storable answer, so the assertion above is not vacuous", () => {
    for (const storable of [
      "public, max-age=600",
      "max-age=60",
      "private, s-maxage=30",
      "PUBLIC, MAX-AGE=1",
    ]) {
      expect(isStorable(storable), storable).toBe(true);
    }
    expect(isStorable(PAGE_ANSWER_CACHE_CONTROL)).toBe(false);
  });
});
