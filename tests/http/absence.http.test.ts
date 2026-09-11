import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mintSessionCookie } from "../walk/session-cookie.mjs";
import { AUTH_SECRET, base, startServer, stopServer } from "./server-harness";
import {
  deniedMessage,
  startPostgrestStub,
  type PostgrestStub,
} from "./postgrest-stub";
import type { ChildProcess } from "node:child_process";

/**
 * What the app renders against a database that ANSWERS but holds none of the
 * ecosystem tables — the un-migrated project (admin-window/BUG-0210).
 *
 * **Why this tier and not the offline one.** The offline absence proof
 * (`tests/offline/absence/pages.test.ts`) hands `lib/db` a structured response
 * and never speaks HTTP, so it cannot see anything that depends on the shape
 * of the REQUEST. The defect this file exists for depended on exactly that: a
 * count leg was a `head: true` request, a HEAD response carries no body, and
 * supabase-js parses its error out of the body — so the 404 carrying
 * `PGRST205` arrived as `error: null, count: null` and `/claims` rendered,
 * beside three correct not-provisioned cards, this app's note TO ITS OWN
 * DEVELOPER: "…a count read requires { head: true, count: "exact" }". Every
 * layer below HTTP was structurally unable to notice.
 *
 * So the database here is a real PostgREST-shaped server on loopback
 * (`postgrest-stub.ts`), and it withholds a HEAD's body exactly as the real
 * one does. Point the app at it, ask for the pages, read what an operator
 * would read.
 */

/** The identity this suite signs in as. Not a real address. */
const SUITE_CLAIMS = { sub: "http-suite", email: "http-suite@example.invalid" };

/** Next's client-render error shell: a 200 whose page actually threw. */
const ERROR_SHELL = 'id="__next_error__"';

/**
 * The fragments of this app's own note to its developer, verbatim from the
 * ticket. None of them may reach an operator's screen in ANY state — they
 * describe a call site in this repo, not anything the operator can act on.
 */
const DEVELOPER_PROSE = ['count read requires', 'head: true', 'count: "exact"'];

/**
 * The surfaces whose reads include a COUNT leg, and the object each count
 * names. Both were derived from the `readCount` call sites in `src/lib/db/**`,
 * and `countingModules()` below re-derives that set on every run so a THIRD
 * counting module cannot be added without this list being made to grow.
 */
const COUNTING_SURFACES = [
  { route: "/claims", counted: "pending_claims" },
  { route: "/queues", counted: "review_items" },
] as const;

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** Which `lib/db` modules issue a count read, read off the source. */
function countingModules(): string[] {
  const dir = path.join(repoRoot, "src", "lib", "db");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && name !== "result.ts")
    .filter((name) => fs.readFileSync(path.join(dir, name), "utf8").includes("countRead("))
    .sort();
}

/** Every state card on a page, as `data-state` -> the text it rendered. */
function statesOf(markup: string): { state: string; text: string }[] {
  const $ = cheerio.load(markup);
  return $("[data-state]")
    .toArray()
    .map((element) => ({
      state: $(element).attr("data-state") ?? "",
      text: $(element).text(),
    }));
}

async function pageOf(route: string, cookie: string): Promise<string> {
  const res = await fetch(`${base}${route}`, { headers: { cookie }, redirect: "manual" });
  expect(res.status, `${route} status`).toBe(200);
  const body = await res.text();
  expect(body, `${route} served the client-render error shell`).not.toContain(ERROR_SHELL);
  return body;
}

describe("a database that answers but holds none of the ecosystem tables", () => {
  let stub: PostgrestStub;
  let server: { child: ChildProcess; log: string[] };
  let cookie = "";

  beforeAll(async () => {
    stub = await startPostgrestStub("absent");
    server = await startServer({ dbUrl: stub.url });
    const { name, value } = await mintSessionCookie({
      secret: AUTH_SECRET,
      claims: SUITE_CLAIMS,
      maxAgeSeconds: 60 * 60,
    });
    cookie = `${name}=${value}`;
  });

  afterAll(async () => {
    if (server !== undefined) await stopServer(server.child);
    if (stub !== undefined) await stub.close();
  });

  it("covers every surface that issues a count read", () => {
    // The route list above is a hand-written mapping; this is what keeps it
    // honest. A third `lib/db` module issuing a count reddens here, and the
    // fix is to add its surface to COUNTING_SURFACES — not to edit this set.
    expect(countingModules()).toEqual(["claims.ts", "review-items.ts"]);
    expect(COUNTING_SURFACES).toHaveLength(2);
  });

  it("renders absence as absence on every counting surface, and says nothing to a developer", async () => {
    stub.setMode("absent");
    for (const { route, counted } of COUNTING_SURFACES) {
      const markup = await pageOf(`${route}?probe=absent`, cookie);
      const text = cheerio.load(markup).text();

      // 1. Not one word of this app's note to itself reaches the page.
      for (const fragment of DEVELOPER_PROSE) {
        expect(text, `${route} leaked "${fragment}"`).not.toContain(fragment);
      }

      // 2. Every panel that said anything said the SAME thing: the object is
      //    not in this database. Not one error — an error here is the count
      //    leg failing to recognise an absence the row leg recognised.
      const states = statesOf(markup);
      expect(
        states.filter((card) => card.state === "error").map((card) => card.text),
        `${route} rendered an error state against an absent database`,
      ).toEqual([]);
      const absent = states.filter((card) => card.state === "not_provisioned");
      expect(absent.length, `${route} rendered no not-provisioned card`).toBeGreaterThan(0);

      // 3. And the object the COUNT asked for is one of the objects named —
      //    the count leg's absence arrives naming the same table its row leg
      //    would name, rather than as a sentence about this app.
      expect(
        absent.some((card) => card.text.includes(counted)),
        `${route} named no not-provisioned "${counted}"`,
      ).toBe(true);
    }
  });

  it("still reports a count leg that failed for a reason that is NOT absence", async () => {
    // The fix narrows what absence MEANS; it does not swallow failures. A
    // `42501` is not an absence code, so it must reach the page as an error
    // carrying the database's own sentence.
    stub.setMode("denied");
    for (const { route, counted } of COUNTING_SURFACES) {
      const markup = await pageOf(`${route}?probe=denied`, cookie);
      const text = cheerio.load(markup).text();

      for (const fragment of DEVELOPER_PROSE) {
        expect(text, `${route} leaked "${fragment}"`).not.toContain(fragment);
      }

      const states = statesOf(markup);
      expect(
        states.filter((card) => card.state === "not_provisioned"),
        `${route} called a permission failure an absence`,
      ).toEqual([]);
      const errors = states.filter((card) => card.state === "error");
      expect(errors.length, `${route} reported no error`).toBeGreaterThan(0);
      // The read that failed, and the database's own words about it.
      expect(
        errors.some((card) => card.text.includes(counted)),
        `${route} named no read`,
      ).toBe(true);
      expect(
        errors.some((card) => card.text.includes(deniedMessage(counted))),
        `${route} did not carry the database's own sentence`,
      ).toBe(true);
    }
  });

  it("asked its counts over GET, never over HEAD", async () => {
    // The mechanism, pinned at the wire rather than inferred from the page: a
    // HEAD is the one request whose failure this app cannot read, so it makes
    // none. Read over every request the app issued in this file's lifetime.
    expect(stub.requests.length).toBeGreaterThan(0);
    expect(
      stub.requests.filter((line) => line.startsWith("HEAD ")),
      "a HEAD request carries no body, so its 404 cannot be classified",
    ).toEqual([]);
  });
});
