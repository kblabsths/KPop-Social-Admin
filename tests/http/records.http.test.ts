import { describe, expect, it } from "vitest";
import { EDITABLE_TABLES } from "@/lib/edit/config";
import { mintSessionCookie } from "../walk/session-cookie.mjs";
import { AUTH_SECRET, base, startServer, stopServer } from "./server-harness";

/**
 * The record page, for every table the map carries, on the app AS BUILT —
 * campaign admin-window/BUG-0094.
 *
 * **Why this tier, and what it adds to the sweep next door.**
 * `auth.http.test.ts` already asks every `EDITABLE_TABLES` record surface for
 * a 200, but it asks with the id `2f0bc11e` — deliberately, because that file
 * is about ROUTING and a short id is the cheapest thing that reaches the
 * route. That id is not a uuid, so `isRecordId` answers before any read and
 * the page returns its empty state having executed almost none of itself. This
 * file asks with a WELL-FORMED uuid, which is the only way past that gate: the
 * four read legs run, the state components render, and the page's real
 * server-side body is what answers. On this tier that is the deepest the page
 * can be driven.
 *
 * **What it proves.** For every mapped table, over real HTTP, against a
 * production build: 200, our own frame, and never Next's client-render error
 * shell. A server-side render that throws — a client-boundary crossing at
 * module scope, a broken import, an exception in a state component — is
 * exactly what turns this red, and it is red as a page an operator would see
 * rather than as a `digest` in a log nobody reads.
 *
 * **What it cannot prove, stated because the ticket that made this file turns
 * on it.** The harness hands the server DB sentinels (a loopback address on a
 * reserved port), so `readRecord` is refused and the page renders its
 * failed-read card ABOVE the field table — `RecordFields` and everything under
 * it never execute. Three things were measured on production builds of this
 * tree on 2026-09-08, and they are why this file is the SECOND net and not the
 * first:
 *
 *  - QA's exact violation restored (`hintSideFromClientModule` exported from
 *    `EditableCell.tsx`, imported by `record-fields.tsx`): every assertion
 *    below still PASSED. The component it lives in is unreachable here;
 *  - the same crossing moved into `RecordFrame`, which every record page
 *    renders whatever the reads did: `/records/events/<uuid>` answered **500**
 *    and this file went red on it. So the class does 500 the page, and this
 *    tier does see it wherever the render can reach it — which is the one
 *    input proving these assertions are not vacuous;
 *  - the build's own `page_client-reference-manifest.js` cannot tell the two
 *    apart: Turbopack records `"name": "*"` per client module, not per export,
 *    and `EditableCell.tsx` is listed there in a CLEAN build too (it is in the
 *    client graph legitimately, through `field-editor.tsx`). There is no
 *    build-artifact signal to assert on; do not go looking for one again.
 *
 * The class itself is therefore caught by
 * `tests/offline/shell/client-boundary.test.ts`, which reads the boundary off
 * the source instead of waiting for a render to reach it. Neither file is the
 * criterion alone.
 */

/**
 * A well-formed uuid, so `isRecordId` passes and the page actually reads.
 *
 * No row anywhere has this key and no database is reachable from this suite in
 * any case — what matters is only its SHAPE.
 */
const RECORD_ID = "2f0bc11e-0000-4000-8000-000000000001";

/** The identity this suite signs in as. Not a real address. */
const SUITE_CLAIMS = { sub: "http-suite", email: "http-suite@example.invalid" };

/**
 * Next's client-render error shell — the document the framework serves when a
 * render threw. It answers 200 with an empty body, so status alone would call
 * a crashed page healthy.
 */
const ERROR_SHELL = 'id="__next_error__"';

describe("the record page over http", () => {
  it("renders for every mapped table, past the id gate and through the reads", async () => {
    const { child, log } = await startServer();
    try {
      const { name, value } = await mintSessionCookie({
        secret: AUTH_SECRET,
        claims: SUITE_CLAIMS,
        maxAgeSeconds: 60 * 60,
      });
      const cookie = `${name}=${value}`;

      // The map is not repeated here: the surfaces asserted are whatever
      // `EDIT_CONFIG` carries, so a table added to it is covered the day it is
      // added and one struck from it stops being asked for.
      expect(EDITABLE_TABLES.length).toBeGreaterThan(0);

      for (const table of EDITABLE_TABLES) {
        const route = `/records/${table}/${RECORD_ID}`;
        const res = await fetch(`${base}${route}`, { headers: { cookie }, redirect: "manual" });
        // A 500 is the whole point: the record page answering anything but its
        // own rendering is the defect this file exists for.
        expect(res.status, `${route} status`).toBe(200);
        const body = await res.text();
        expect(body, `${route} served the client-render error shell`).not.toContain(ERROR_SHELL);
        // Our frame, not an empty document: the page's own title element, the
        // id it was asked for, and the one named surface this route draws.
        expect(body, `${route} rendered no heading`).toMatch(/<h1[\s>]/);
        expect(body, `${route} did not echo the id asked for`).toContain(RECORD_ID);
        expect(body, `${route} drew no fields surface`).toContain('data-surface="fields"');
      }

      // And the walk sandbox's own seeded address — the URL STACK.md hands
      // every walker, so the one address a human is told to open is proved to
      // answer here too.
      const seeded = "/records/walk_sandbox/00000000-0000-4000-8000-000000000001";
      const sandbox = await fetch(`${base}${seeded}`, { headers: { cookie }, redirect: "manual" });
      expect(sandbox.status, seeded).toBe(200);
      expect(await sandbox.text(), seeded).not.toContain(ERROR_SHELL);

      // Nothing above may have been served off a server that was busy dying:
      // a render that threw leaves a digest line behind even when the shell
      // was swallowed, and a page whose server logged one is not a page that
      // rendered.
      const errors = log.join("").match(/^.*\bdigest:.*$/gm);
      expect(errors ?? [], "the server logged a render error while serving these pages").toEqual([]);
    } finally {
      await stopServer(child);
    }
  });
});
