import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COOKIE_DESCRIPTOR_KEYS, type CookieDescriptor } from "../walk/session-cookie.mjs";
import { AUTH_SECRET, base, startServer, stopServer } from "./server-harness";

/**
 * The walker's cookie, proved against the REAL app (campaign
 * admin-window/TASK-0033, acceptance criterion 5).
 *
 * The offline suite proves the mint round-trips through next-auth's own
 * decoder. That is not the same claim as this one: the question a walker
 * actually has is "does the running app's `auth()` let me in", and the only
 * thing that can answer it is the running app. So this file runs the **CLI
 * itself** as a child process — the exact command the recipe in
 * `agenticflow/docs/vision/STACK.md` §5 tells a walker to run — parses the one
 * line it prints, and drives the built server on the harness's port with it.
 *
 * **Pages, not the API route.** The middleware gate asks only `!!session?.user`
 * (`src/lib/auth.ts`), so a minted cookie opens every page. The PATCH route is
 * different: it calls `requireAdmin()`, which looks the session email up in
 * `admin_allowed_emails` on every request — and this harness hands the server a
 * database sentinel that reaches nothing, so that route answers 4xx by design.
 * `tests/http/edit.http.test.ts` owns that; asserting it here would be
 * asserting the absence of a database.
 *
 * The negative half is what makes the positive half mean anything: a descriptor
 * minted by the SAME CLI under a DIFFERENT secret must still be turned away. If
 * it were not, the 200s below would be proving that the gate is open, not that
 * the cookie is good.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(repoRoot, "tests", "walk", "session-cookie.mts");

/** The pages a walker's first screen depends on. Both are behind the gate. */
const GATED_PAGES = ["/", "/queues"] as const;

/**
 * Run the mint CLI the way the recipe does, and parse its one line.
 *
 * `process.execPath` rather than a bare `node`: the child has to be the same
 * Node that runs this suite, since a `.mts` file runs unflagged only on
 * Node >= 23.6.
 */
function mintViaCli(secret: string): CookieDescriptor {
  const env: NodeJS.ProcessEnv = { ...process.env, AUTH_SECRET: secret };
  const run = spawnSync(process.execPath, [CLI], { cwd: repoRoot, encoding: "utf8", env });
  expect(run.status, `mint CLI failed: ${run.stderr ?? ""}`).toBe(0);
  const stdout = run.stdout ?? "";
  // The contract a walker parses: one line, nothing else on stdout.
  expect(stdout.trimEnd().includes("\n"), "the CLI printed more than one line").toBe(false);
  const descriptor = JSON.parse(stdout) as CookieDescriptor;
  expect(Object.keys(descriptor).sort()).toEqual([...COOKIE_DESCRIPTOR_KEYS].sort());
  return descriptor;
}

/** The descriptor, as an http request would carry it. */
function asCookieHeader(descriptor: CookieDescriptor): string {
  return `${descriptor.name}=${descriptor.value}`;
}

describe("the walker's minted cookie against the running app", () => {
  it("opens the gated pages, and only under the server's own secret", async () => {
    // One server for both halves: `startServer` refuses to certify a server it
    // did not start, and starting two in one file would collide on the port.
    const { child } = await startServer();
    try {
      // The cookie the recipe's own command produces, against a server started
      // with that same AUTH_SECRET — which is the entire premise of the walk.
      const good = asCookieHeader(mintViaCli(AUTH_SECRET));

      for (const page of GATED_PAGES) {
        const res = await fetch(`${base}${page}`, {
          headers: { cookie: good },
          redirect: "manual",
        });
        expect(res.status, page).toBe(200);
        // 200, and actually a page — a redirect body or an error boundary with
        // a 200 would satisfy the status alone.
        const body = await res.text();
        expect(body, page).toMatch(/<h1[\s>]/);
        expect(body, page).not.toContain('id="__next_error__"');
      }

      // The negative half, same CLI, different secret. Without this the 200s
      // above would be equally consistent with no gate at all.
      const forged = asCookieHeader(mintViaCli(`${AUTH_SECRET}-but-not-really`));
      expect(forged).not.toBe(good);

      for (const page of GATED_PAGES) {
        const res = await fetch(`${base}${page}`, {
          headers: { cookie: forged },
          redirect: "manual",
        });
        expect(res.status, page).toBeGreaterThanOrEqual(300);
        expect(res.status, page).toBeLessThan(400);
        const location = res.headers.get("location");
        expect(location, page).not.toBeNull();
        expect(new URL(location as string, base).pathname, page).toBe("/login");
      }

      // And no cookie at all behaves like the forged one: the baseline that
      // says these pages were gated in the first place.
      for (const page of GATED_PAGES) {
        const res = await fetch(`${base}${page}`, { redirect: "manual" });
        expect(res.status, page).toBeGreaterThanOrEqual(300);
        expect(res.status, page).toBeLessThan(400);
      }
    } finally {
      await stopServer(child);
    }
  });
});
