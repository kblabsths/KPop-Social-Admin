/**
 * The live harness's own test (campaign admin-window, admin-window/TASK-0003).
 *
 * It exists for two reasons:
 *
 *  1. A project with no test files never runs its setup file. This file is
 *     what makes `npm run test:live` fail *because the guard refused*, with
 *     the missing name in the message, rather than because vitest found
 *     nothing to run.
 *  2. Before any page's parity test blames the page, this proves the plumbing:
 *     the app's data layer is pointed at the DECLARED staging project, the
 *     credentials actually reach it, and the app's read path and a test's own
 *     independent query agree on one number — parity in miniature.
 *
 * It writes nothing, so it needs no sweep.
 */
import { describe, expect, it } from "vitest";
import { readCount, readOne } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import { codeOf, countRows, exactCount, independentClient } from "./parity";
import { APP_URL_ENV_NAME, declaredTarget, stagingHost } from "./setup";

describe("the live harness", () => {
  it("points the app's data layer at the declared staging project", () => {
    const appTarget = process.env.SUPABASE_URL;
    expect(appTarget, `${APP_URL_ENV_NAME} is unset after setup`).toBeTruthy();
    expect(new URL(appTarget as string).host).toBe(stagingHost);
    expect(declaredTarget.length).toBeGreaterThan(0);
  });

  it("reaches that project with the staging credentials", async () => {
    // A count of a canonical catalog table: it round-trips PostgREST with the
    // service role, so a bad key or a wrong host fails here and not inside
    // some page's parity test.
    const rows = await countRows(() => exactCount(T.events));
    expect(rows).toBeGreaterThanOrEqual(0);
  });

  it("agrees with the app's own read path on that number", async () => {
    const mine = await countRows(() => exactCount(T.events));
    // The APP's own read path, in the app's own shape — `lib/db` counts with
    // `head: true` and this case exists to exercise what the pages do, not to
    // re-issue the test's query. The test's side above is GET-shaped, which is
    // this suite's rule for the counts IT writes (admin-window/TASK-0032).
    const theirs = await readCount(T.events, (db) =>
      db.from(T.events).select("*", { head: true, count: "exact" }),
    );

    expect(theirs.kind).toBe("ok");
    if (theirs.kind !== "ok") return;
    expect(theirs.data).toBe(mine);
  });
});

/* ── the absent FUNCTION, on the real database (admin-window/TASK-0047) ───── */

/**
 * The function M2 settles a review item through. It does not exist on staging
 * and will not until Ben installs FEAT-0009's handoff artifact — which is what
 * makes this probe free and permanent, the same trick ARCHITECTURE.md §4.1
 * already records for the absent `verdicts` table.
 */
const SETTLE_FUNCTION = "settle_review_item";

/**
 * A function that IS installed on staging — the second fixture this probe
 * owes (LESSONS 3). It is named to prove the reader below can SEE a function,
 * so "not there" means absent rather than "the reader found nothing at all".
 * It is never CALLED: `apply_resolution` writes the catalog.
 */
const INSTALLED_FUNCTION = "apply_resolution";

/**
 * Every function staging exposes over PostgREST, from the database's own
 * schema description (`GET /rest/v1/`, the OpenAPI document PostgREST
 * generates from the live catalog — the same source
 * `residue.live.test.ts` reads column types from).
 *
 * This is a READ, not a call, and it is what makes the probe below safe: the
 * absence is established before anything is invoked, so the day the artifact
 * is installed this file fails saying so instead of calling a function that
 * settles review items.
 *
 * Reads the APP's names, which `setup.ts` has already pointed at staging;
 * nothing here prints the target or the key.
 */
async function functionsOnStaging(): Promise<Set<string>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "the harness has no target: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY " +
        "are unset, which means tests/live/setup.ts did not run.",
    );
  }
  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/openapi+json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `could not read the schema description of ${stagingHost}: HTTP ` +
        `${response.status}. Without it this probe cannot tell an absent ` +
        `function from an unreadable database.`,
    );
  }
  const body = (await response.json()) as { paths?: Record<string, unknown> };
  return new Set(
    Object.keys(body.paths ?? {})
      .filter((route) => route.startsWith("/rpc/"))
      .map((route) => route.slice("/rpc/".length)),
  );
}

describe("a function this database does not have", () => {
  it("is absent by the database's own account, while another one is there", async () => {
    // Both fixtures, one read: the reader can see a function, and it does not
    // see this one. Measured 2026-09-08 on the declared staging target: 54
    // functions exposed, `apply_resolution` among them, `settle_review_item`
    // not.
    const functions = await functionsOnStaging();
    expect(
      functions.has(INSTALLED_FUNCTION),
      `${stagingHost} exposes no ${INSTALLED_FUNCTION}, so this probe cannot ` +
        `tell absence from a reader that sees nothing`,
    ).toBe(true);
    expect(
      functions.has(SETTLE_FUNCTION),
      `${SETTLE_FUNCTION} is now installed on ${stagingHost}. This probe ` +
        `graded the ABSENT case (admin-window/TASK-0047) and must be ` +
        `retargeted rather than left to call an installed settlement ` +
        `function`,
    ).toBe(false);
  });

  it("classifies as not_provisioned naming it, never as an error", async () => {
    // The call is safe because of the case above: there is no function, so
    // PostgREST refuses at the schema cache and nothing is written. Skipped
    // implicitly if that case failed — this one re-establishes absence itself
    // before it calls anything.
    const functions = await functionsOnStaging();
    expect(functions.has(SETTLE_FUNCTION)).toBe(false);

    // The test's OWN read of the same object gets the absence code
    // (ARCHITECTURE.md §10, rule 3: never inferred from "nothing rendered").
    const { error } = await independentClient().rpc(SETTLE_FUNCTION, {
      p_decision: { action: "keep_current" },
    });
    expect(
      ["PGRST202", "42883"],
      `${stagingHost} answered a call to the absent ${SETTLE_FUNCTION} with ` +
        `code ${codeOf(error)}`,
    ).toContain(codeOf(error));

    // …and the APP's own path — the helper every `lib/db` read returns
    // through — turns that into the state the close slot renders.
    const result = await readOne(SETTLE_FUNCTION, (db) =>
      db.rpc(SETTLE_FUNCTION, { p_decision: { action: "keep_current" } }),
    );
    expect(result).toEqual({
      kind: "not_provisioned",
      missing: SETTLE_FUNCTION,
    });
  });
});
