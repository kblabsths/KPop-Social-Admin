import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mintSessionCookie } from "../walk/session-cookie.mjs";
import { AUTH_SECRET, base, startServer, stopServer } from "./server-harness";
import {
  DEFAULT_ALIEN_BODY,
  DEFAULT_COUNT_TOTAL,
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
const EVERY_MODE: readonly StubMode[] = [
  "absent",
  "denied",
  "blank",
  "empty",
  "foreign",
  "alien",
  "miscounted",
];

/**
 * The element shapes QA measured a 500 on in `alien` mode
 * (admin-window/BUG-0228 criterion 2), each a JSON ARRAY that is not this
 * table's rows.
 *
 * They are not six modes and not six predicates: they are six bodies held to
 * the ONE bar — whatever a host answers, the surface ANSWERS — so the read
 * seam's single question (does every element carry the columns this read
 * named?) is asked of all of them by the same test.
 */
const ALIEN_BODIES: readonly string[] = [
  JSON.stringify([{ message: "no upstream" }]),
  JSON.stringify([[{ claim_id: "c1" }]]),
  JSON.stringify(["a", "b"]),
  JSON.stringify([null, null]),
  JSON.stringify([{}]),
  JSON.stringify([{ foo: 1 }]),
];

/**
 * The surfaces whose reads include a COUNT leg, and the object each count
 * names. Both were derived from the `readCount` call sites in `src/lib/db/**`,
 * and `countingModules()` below re-derives that set on every run so a THIRD
 * counting module cannot be added without this list being made to grow.
 */
/**
 * The surface whose figures are fed BY a count, and the one QA read the
 * negative one off (admin-window/BUG-0229): /claims' "Total counts" table,
 * published as `data-figures="total"`. /queues renders no such region, which
 * is why its presence is asserted here and not on every counted surface.
 */
const TOTAL_FIGURES_ROUTE = "/claims";

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

  it("refuses every panel against a host answering 200 with an ARRAY that is not this table's rows", async () => {
    // THE SAME BAR ONE SHAPE FURTHER (QA attack on admin-window/BUG-0227):
    // "Whatever a host answers ... the operator reads the app's refusal naming
    // pending_claims (or review_items, or sources)". BUG-0227 made a row-set
    // read ask whether an ARRAY arrived; this mode answers WITH an array — of
    // things that are not rows of this table — so `isRowSet` passes it through
    // as `Row[]` and the first column the render reads throws.
    //
    // Measured over real HTTP against a production build 2026-09-15, with
    // `[{"message":"no upstream"}]` and with `[[{"claim_id":"c1"}]]`,
    // `["a","b"]`, `[null,null]`, `[{}]` and `[{"foo":1}]` alike: HTTP 500 and
    // Next's error shell on `/`, `/claims`, `/browse` and `/cycles`, the
    // server logging `TypeError: Cannot read properties of undefined (reading
    // 'trim')`; `[null,null]` took all six routes down.
    //
    // PIN (QA, admin-window ticket BUG-0228): it was marked an EXPECTED
    // FAILURE because it was RED on the landed tree, and the fix flipped the
    // marker back to `it`. `"alien"` is in EVERY_MODE above too, so the
    // call-site sweep covers it like every other mode.
    //
    // WATCHED, 2026-09-14, over real HTTP against a production build of the
    // fix: with the marker still `it.fails` the suite reported "Expect test to
    // fail" (1 failed | 34 passed) — the pin had gone green.
    //
    // The fix is the read seam asking its question against the READ'S OWN
    // DECLARED COLUMNS (`isRowSet`/`selectList`, `src/lib/db/result.ts`):
    // a row set is an array whose every element carries every column the query
    // named, so none of the bodies below is one, and the same one rule
    // (`unreadableAnswer`) refuses naming the object.
    stub.setMode("alien");

    for (const body of ALIEN_BODIES) {
      stub.setAlienBody(body);

      // The home page reads row sets too, and it is the first thing an
      // operator lands on: it must answer, not throw. (`pageOf` grades the
      // status and the error shell, which is the whole assertion for these.)
      // /browse and /cycles are here on the same measurement — QA read 500s
      // off /, /browse, /cycles and the three graded surfaces alike.
      for (const route of ["/", "/browse", "/cycles"]) {
        await pageOf(`${route}?probe=alien&body=${encodeURIComponent(body)}`, cookie);
      }

      for (const { route, names } of GRADED_SURFACES) {
        const markup = await pageOf(
          `${route}?probe=alien&body=${encodeURIComponent(body)}`,
          cookie,
        );
        const $ = cheerio.load(markup);
        const states = statesOf(markup);

        expect(states.length, `${route} rendered no state at all on ${body}`)
          .toBeGreaterThan(0);
        expect(
          [...new Set(states.map((card) => card.state))].sort(),
          `${route} rendered a state other than a refusal on ${body}`,
        ).toEqual(["error"]);
        expect(
          states.some((card) => card.text.includes(names)),
          `${route} named no "${names}" on ${body}`,
        ).toBe(true);
        for (const block of $("[data-figures]").toArray()) {
          expect(
            $(block).text(),
            `${route} published a figure over a read that failed on ${body}`,
          ).not.toMatch(/\d/);
        }
      }
    }

    stub.setAlienBody(DEFAULT_ALIEN_BODY);
  });

  it("refuses every counted panel against a host whose total is not a number of ROWS", async () => {
    // THE SAME BAR, on the other leg of the answer (QA attack on
    // admin-window/BUG-0228, filed as admin-window/BUG-0229): a count is a
    // number of ROWS — a non-negative integer the machine can represent
    // exactly — or it did not arrive, and an answer that did not arrive
    // refuses through the one rule naming the object.
    //
    // Measured over real HTTP against a production build 2026-09-15, before
    // the fix: `content-range: */-5` put "-5" in EVERY bucket row of /claims'
    // Total counts table beside state cards reading "empty", and
    // `*/99999999999999999999` published "100,000,000,000,000,000,000".
    // `Number.isInteger` is true for both, which is why the guard had to say
    // what a count IS rather than which headers it has met.
    //
    // The two totals below are one host answer, not two: a negative one and
    // one past exact representation. Neither is a spelling to enumerate — they
    // are the two ways a whole number fails to be a count of rows, and the
    // predicate closes both by construction.
    const TOTALS = ["-5", "99999999999999999999"];
    for (const [pass, total] of TOTALS.entries()) {
      stub.setCountTotal(total);
      stub.setMode("miscounted");

      for (const { route, counted } of COUNTING_SURFACES) {
        // The probe carries a PASS NUMBER and never the total itself: the page
        // echoes the query it did not apply ("The URL carries probe and total
        // …"), so a total in the URL would put the very digits check 3 looks
        // for on the page by this test's own hand.
        const markup = await pageOf(`${route}?probe=miscounted&pass=${pass}`, cookie);
        const $ = cheerio.load(markup);
        const text = $.text();
        const states = statesOf(markup);

        // 1. The count that did not arrive refuses, naming the object its
        //    query asked about — the same words every other ungradeable
        //    answer refuses with.
        const errors = states.filter((card) => card.state === "error");
        expect(errors.length, `${route} reported no refusal on total ${total}`)
          .toBeGreaterThan(0);
        expect(
          errors.some((card) => card.text.includes(counted)),
          `${route} named no "${counted}" on total ${total}`,
        ).toBe(true);

        // 2. No FIGURE is published over the count. The TOTAL figures are the
        //    ones the count feeds, and a count nobody could read is not a
        //    number, so that region carries the refusal and no digit.
        //
        //    The WINDOW figures are deliberately not asked to be digit-free:
        //    the row set really did arrive (`[]`, a matching set of zero), so
        //    a window of zero is a fact this read established and the page is
        //    right to publish it. Emptiness answered per element (LESSONS 3) —
        //    what the count failed to say does not blank what the rows said.
        const totals = $('[data-figures="total"]').toArray();
        if (route === TOTAL_FIGURES_ROUTE) {
          // The region QA read "-5" out of, on the surface it read it on: if
          // it stops being rendered there this test stops proving anything,
          // so its presence is asserted rather than assumed.
          expect(totals.length, `${route} rendered no total-figures region`)
            .toBeGreaterThan(0);
        }
        for (const block of totals) {
          expect(
            $(block).text(),
            `${route} published a figure over a count that did not arrive (total ${total})`,
          ).not.toMatch(/\d/);
        }

        // ... and no figures region anywhere on the page carries a NEGATIVE
        // number, which is the shape of the finding itself.
        for (const block of $("[data-figures]").toArray()) {
          expect(
            $(block).text(),
            `${route} published a negative figure (total ${total})`,
          ).not.toMatch(/-\s*\d/);
        }

        // 3. And the host's own figure reaches no part of the page, however
        //    it is grouped — "-5" and "100,000,000,000,000,000,000" are the
        //    strings QA read on the landed tree, so the comparison is against
        //    the total with its grouping commas taken back out.
        expect(
          text.replace(/,/g, ""),
          `${route} published the host's total (${total}) somewhere on the page`,
        ).not.toContain(total);
      }
    }

    stub.setCountTotal(DEFAULT_COUNT_TOTAL);
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
