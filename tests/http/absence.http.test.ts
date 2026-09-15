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
  type StubMode,
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
 * tickets. None of them may reach an operator's screen in ANY state — they
 * describe a call site in this repo, not anything the operator can act on.
 *
 * `complete read requires` is `readComplete`'s twin of the count leg's
 * sentence, and it was the UNTOUCHED half after admin-window/BUG-0210: it
 * reached /queues and /sources the moment a host answered 404 with zero bytes
 * (admin-window/BUG-0224), which is why the sweep below runs over every mode
 * of the stub rather than over the absence one alone.
 */
const DEVELOPER_PROSE = [
  'count read requires',
  'complete read requires',
  'head: true',
  'count: "exact"',
];

/**
 * Every surface BUG-0224 grades, and the object each one's own reads name.
 *
 * A superset of `COUNTING_SURFACES` below: /sources makes no count read at
 * all, and it still rendered `readComplete`'s developer sentence beside two
 * empty gauge cards, because the defect is a property of the ANSWER and not of
 * the request shape.
 */
const GRADED_SURFACES = [
  { route: "/claims", names: "pending_claims" },
  { route: "/queues", names: "review_items" },
  { route: "/sources", names: "sources" },
] as const;

/** Every mode the stub can answer in — the sweep's domain, read off the type. */
const EVERY_MODE: readonly StubMode[] = ["absent", "denied", "blank", "empty", "foreign"];

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

  it("refuses every panel against a host that 404s with zero bytes, and empties none", async () => {
    // THE BAR, stated positively (admin-window/BUG-0224): a read this app
    // cannot classify is a REFUSAL NAMING THE OBJECT IT ASKED ABOUT. Never a
    // zero, never an empty card, and never a sentence about this app's own
    // call arguments.
    //
    // What this mode is: a deploy pointed at a host that is not this database
    // — a wrong SUPABASE_URL, or a proxy answering in front of the service.
    // supabase-js rewrites a bodyless 404 into `204, error: null, data: null,
    // count: null`, so NOTHING reaches `classify`. Measured on the landed
    // BUG-0210 fix (QA, 2026-09-11) and reproduced here: /claims printed the
    // developer sentence AND "No claims waiting" over a read that failed.
    stub.setMode("blank");
    for (const { route, names } of GRADED_SURFACES) {
      const markup = await pageOf(`${route}?probe=blank`, cookie);
      const $ = cheerio.load(markup);
      const states = statesOf(markup);

      // 1. Every panel that renders a state at all REFUSED. Not an empty card
      //    — an empty card is a positive claim about the population, made on
      //    the strength of a read that never happened — and not a
      //    not-provisioned card either: nothing here said the object is
      //    absent, so this app may not say it was.
      expect(states.length, `${route} rendered no state at all`).toBeGreaterThan(0);
      expect(
        [...new Set(states.map((card) => card.state))].sort(),
        `${route} rendered a state other than a refusal`,
      ).toEqual(["error"]);

      // 2. The refusal NAMES the object, in the spelling the query used.
      expect(
        states.some((card) => card.text.includes(names)),
        `${route} named no "${names}"`,
      ).toBe(true);

      // 3. No FIGURE is published either: a count nobody could read is not a
      //    zero, so the figures block carries the refusal and no number.
      for (const block of $("[data-figures]").toArray()) {
        expect(
          $(block).text(),
          `${route} published a figure over a read that failed`,
        ).not.toMatch(/\d/);
      }
    }
  });

  it("refuses every panel against a host answering 200 with something that is not a row set", async () => {
    // THE SAME BAR, the third host answer it names (QA attack on
    // admin-window/BUG-0224): "Whatever a host answers — a bodyless 404, a
    // 204, an HTML error page from a proxy, A 200 WITH A BODY THAT IS NOT A
    // POSTGREST ANSWER — the operator reads the app's refusal naming
    // pending_claims (or review_items, or sources)".
    //
    // Measured with the real client against a loopback host answering
    // `200 {"message":"no upstream"}`: every read shape comes back
    // `error: null, data: {"message":"no upstream"}, count: null`. The count
    // legs refuse through the one rule because the count is missing; a row-set
    // read does not, because the rule asks only whether `data` is null and a
    // foreign object is not null.
    //
    // PIN (QA, admin-window/BUG-0227), watched RED before the fix: every one
    // of these surfaces answered HTTP 500 with Next's error shell, the render
    // having called `.map` on that object. The fix is `readRows`/`readComplete`
    // asking whether a ROW SET arrived (`isRowSet`, `src/lib/db/result.ts`)
    // rather than whether `data` was null, so the same one rule refuses; and
    // `"foreign"` is now in EVERY_MODE above, so the call-site-prose sweep
    // covers this mode like every other.
    stub.setMode("foreign");

    // The home page reads row sets too, and it is the first thing an operator
    // lands on: it must answer, not throw. (`pageOf` grades the status and the
    // error shell, which is the whole assertion for this one.) /browse and
    // /cycles are here for the same reason and on the same measurement: QA
    // read 500s off /, /browse and the three graded surfaces alike, so every
    // route that renders a row set is asked to ANSWER in this mode.
    for (const route of ["/", "/browse", "/cycles"]) {
      await pageOf(`${route}?probe=foreign`, cookie);
    }

    for (const { route, names } of GRADED_SURFACES) {
      const markup = await pageOf(`${route}?probe=foreign`, cookie);
      const $ = cheerio.load(markup);
      const states = statesOf(markup);

      expect(states.length, `${route} rendered no state at all`).toBeGreaterThan(0);
      expect(
        [...new Set(states.map((card) => card.state))].sort(),
        `${route} rendered a state other than a refusal`,
      ).toEqual(["error"]);
      expect(
        states.some((card) => card.text.includes(names)),
        `${route} named no "${names}"`,
      ).toBe(true);
      for (const block of $("[data-figures]").toArray()) {
        expect(
          $(block).text(),
          `${route} published a figure over a read that failed`,
        ).not.toMatch(/\d/);
      }

      // Criterion 2 in this mode. EVERY_MODE's sweep covers it too now; this
      // stays because a refusal read by an operator is this test's subject.
      for (const fragment of DEVELOPER_PROSE) {
        expect(
          cheerio.load(markup).text(),
          `${route} leaked "${fragment}" in foreign mode`,
        ).not.toContain(fragment);
      }
    }
  });

  it("still draws the empty card for a table that is really there and really empty", async () => {
    // The control arm (criterion 3), and the one that proves the fix did not
    // turn "no rows" into "refused": the same wire, a real 200 carrying `[]`
    // and a counted total of zero. An operator whose queue is clear must still
    // read that it is clear.
    stub.setMode("empty");
    for (const { route } of GRADED_SURFACES) {
      const markup = await pageOf(`${route}?probe=empty`, cookie);
      const states = statesOf(markup);

      expect(
        states.filter((card) => card.state === "empty").length,
        `${route} drew no empty card over an empty database`,
      ).toBeGreaterThan(0);
      expect(
        states.filter((card) => card.state === "error").map((card) => card.text),
        `${route} called an empty table a failure`,
      ).toEqual([]);
      expect(
        states.filter((card) => card.state === "not_provisioned").map((card) => card.text),
        `${route} called an empty table absent`,
      ).toEqual([]);
    }
  });

  it("says nothing about its own call site in ANY mode, on any graded surface", async () => {
    // Criterion 2, swept rather than spot-checked: the fragments below name
    // the arguments of a call site in THIS repo. Whatever a host answers, the
    // operator reads about the object — never about our query. The absence
    // mode is included on purpose, because that is the mode this assertion
    // already passed in and it must keep passing there.
    for (const mode of EVERY_MODE) {
      stub.setMode(mode);
      for (const { route } of GRADED_SURFACES) {
        const text = cheerio.load(await pageOf(`${route}?probe=${mode}`, cookie)).text();
        for (const fragment of DEVELOPER_PROSE) {
          expect(text, `${route} leaked "${fragment}" in ${mode} mode`).not.toContain(
            fragment,
          );
        }
      }
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
