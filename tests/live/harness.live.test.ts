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
import { readCount } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import { countRows, exactCount } from "./parity";
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
