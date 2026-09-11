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
import { callFunction, readCount, readRows } from "@/lib/db/result";
import { readSettlementReadiness } from "@/lib/db/verdict";
import { T } from "@/lib/db/tables";
import {
  codeOf,
  countRows,
  exactCount,
  functionsOnStaging,
  independentClient,
  objectIsAbsent,
} from "./parity";
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

/* ── an absent FUNCTION, on the real database (admin-window/TASK-0047) ───── */

/**
 * A name no migration installs — the absence fixture, and it is a NAME rather
 * than a state of somebody's handoff.
 *
 * Until admin-window/BUG-0215 this probe used `settle_review_item`, on the
 * premise that it "does not exist on staging and will not until Ben installs
 * FEAT-0009's handoff artifact". It was installed on 2026-09-11, mid-campaign,
 * and took the premise with it: this file's absence case went red, and the
 * case written the same way in `edit.live.test.ts` applied a real admin
 * override to a catalog row before anything could stop it. What these two
 * cases actually grade is the READER and the CLASSIFICATION — neither was ever
 * about that particular function — so the fixture is a name that cannot be
 * installed by anyone's migration, and the probe outlives every handoff.
 */
const ABSENT_FUNCTION = "admin_window_no_such_function";

/**
 * A function that IS installed on staging — the second fixture this probe owes
 * (LESSONS 3). It is named to prove the reader below can SEE a function, so
 * "not there" means absent rather than "the reader found nothing at all".
 * It is never CALLED: `apply_resolution` writes the catalog.
 */
const INSTALLED_FUNCTION = "apply_resolution";

/**
 * The settlement function, named here so this file can say which world it is
 * in — and never so that it is called. Installed on staging since 2026-09-11;
 * a call to it records a verdict the service role cannot delete, which no
 * suite that must sweep what it wrote may make (acceptance test 13).
 */
const SETTLE_FUNCTION = "settle_review_item";

describe("a function this database does not have", () => {
  it("is absent by the database's own account, while another one is there", async () => {
    // Both fixtures, one read: the reader can see a function, and it does not
    // see this one. Measured 2026-09-11 on the declared staging target: 56
    // functions exposed, `apply_resolution` and `settle_review_item` among
    // them, `admin_window_no_such_function` not.
    const functions = await functionsOnStaging();
    expect(
      functions.has(INSTALLED_FUNCTION),
      `${stagingHost} exposes no ${INSTALLED_FUNCTION}, so this probe cannot ` +
        `tell absence from a reader that sees nothing`,
    ).toBe(true);
    expect(
      functions.has(ABSENT_FUNCTION),
      `${stagingHost} exposes ${ABSENT_FUNCTION}. That name exists to be ` +
        `absent; something installed it, and this probe needs a new one`,
    ).toBe(false);
  });

  it("classifies as not_provisioned naming it, never as an error", async () => {
    // The call is safe because of the case above: there is no such function,
    // so PostgREST refuses at the schema cache and nothing is written. This
    // case re-establishes that absence itself before it calls anything, and
    // the settlement function — which IS installed and does write — is read
    // for, never called (admin-window/BUG-0215).
    const functions = await functionsOnStaging();
    expect(functions.has(ABSENT_FUNCTION)).toBe(false);

    // The test's OWN read of the same object gets the absence code
    // (ARCHITECTURE.md §10, rule 3: never inferred from "nothing rendered").
    const { error } = await independentClient().rpc(ABSENT_FUNCTION, {});
    expect(
      ["PGRST202", "42883"],
      `${stagingHost} answered a call to the absent ${ABSENT_FUNCTION} with ` +
        `code ${codeOf(error)}`,
    ).toContain(codeOf(error));

    // …and the APP's own path — the seam a function call goes through — turns
    // that into the state the close slot renders.
    const result = await callFunction(ABSENT_FUNCTION, (db) =>
      db.rpc(ABSENT_FUNCTION, {}),
    );
    expect(result).toEqual({
      kind: "not_provisioned",
      missing: ABSENT_FUNCTION,
    });
  });

  /**
   * WHICH WORLD IS THIS — the question every live case that touches the §9
   * settlement path now branches on (admin-window/BUG-0215).
   *
   * Two paths to one answer (ARCHITECTURE §10): this file's own read of
   * `verdicts`, and the app's readiness seam, which is what the record page
   * asks before it offers an override control. They must say the same thing,
   * or a page's branch and a test's branch are reading different databases.
   *
   * The settlement FUNCTION's presence is read beside it and stated in the
   * log, never called: an override it applied would write a `verdicts` row the
   * service role cannot delete, so no suite that must sweep what it wrote may
   * make that call (acceptance test 13).
   */
  it("agrees with the app's readiness seam about the settlement log", async () => {
    const logAbsent = await objectIsAbsent(T.verdicts);
    const readiness = await readSettlementReadiness();
    expect(readiness.kind, `this test read ${T.verdicts} as ` +
      `${logAbsent ? "absent" : "present"}`).toBe(
      logAbsent ? "not_provisioned" : "ok",
    );
    if (readiness.kind === "not_provisioned") {
      expect(readiness.missing).toBe(T.verdicts);
    }

    const functions = await functionsOnStaging();
    console.log(
      `${stagingHost}: ${T.verdicts} is ${logAbsent ? "absent" : "present"}, ` +
        `${SETTLE_FUNCTION} is ` +
        `${functions.has(SETTLE_FUNCTION) ? "INSTALLED" : "absent"} ` +
        `(of ${functions.size} function(s) exposed). The live suite branches ` +
        `on these two reads and calls ${SETTLE_FUNCTION} in neither branch.`,
    );
  });

  it("does not let a table read borrow that absence (admin-window/BUG-0080)", async () => {
    // The same database, the same absence code, asked a different question: a
    // TABLE read that raises 42883 must stay an error naming the table it
    // read. Measured read-only on staging — `fts` on a timestamptz column
    // makes Postgres look for a `to_tsvector` overload that does not exist,
    // and `groups` is provisioned and holds rows, so an absence claim here
    // would tell an operator to install a table that is right there.
    const readable = await readRows(T.groups, (db) =>
      db.from(T.groups).select("id").limit(1),
    );
    expect(readable.kind, `${stagingHost} could not read ${T.groups}`).toBe("ok");

    const { error } = await independentClient()
      .from(T.groups)
      .select("id")
      .filter("created_at", "fts", "x")
      .limit(1);
    expect(
      codeOf(error),
      `${stagingHost} answered an fts filter on a timestamptz with ` +
        `${codeOf(error)}, not the 42883 this case is about`,
    ).toBe("42883");

    const refused = await readRows(T.groups, (db) =>
      db.from(T.groups).select("id").filter("created_at", "fts", "x").limit(1),
    );
    expect(refused.kind).toBe("error");
    expect(refused).not.toHaveProperty("missing");
    if (refused.kind !== "error") return;
    expect(refused.reading).toBe(T.groups);
  });
});
