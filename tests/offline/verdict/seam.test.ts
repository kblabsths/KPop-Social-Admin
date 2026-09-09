import { describe, expect, it } from "vitest";
import {
  NO_RECEIPT,
  REFUSED_BEFORE_SEND,
  SETTLE_ARGUMENT,
  readSettlementReadiness,
  settleReviewItem,
  type VerdictReceipt,
} from "@/lib/db/verdict";
import { FN, T } from "@/lib/db/tables";
import { ID, verdictDecision, verdictLogEntry, verdictValue } from "../../fixtures/rows";
import {
  functionNotInSchemaCache,
  missingOperator,
  permissionDenied,
  statementTimeout,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  undefinedFunction,
  undefinedTable,
  type StubClient,
} from "../../fixtures/stub-client";

/**
 * The settlement seam — campaign admin-window/TASK-0048, `src/lib/db/verdict.ts`.
 *
 * **The ABSENT case is graded first, because it is the normal one.** Neither
 * `verdicts` nor `settle_review_item` exists on staging or in production, and
 * neither will until Ben installs M2's handoff migrations — that is the
 * database `main` deploys against for the whole milestone. So the file opens
 * with what the surfaces will actually meet, and the happy path follows it.
 *
 * Nothing here asserts a rendered string: the seam returns `DbResult`s and the
 * words an operator reads belong to the surfaces.
 */

/** A settle that carries no payload — the shape every case that is not about the payload uses. */
const KEEP_CURRENT = verdictDecision({ action: "keep_current" });

/** The one call, against a client that answers `script` for the function. */
function callWith(script: Parameters<typeof stubClient>[0]) {
  const stub = stubClient(script);
  return { stub, run: () => settleReviewItem(stub.asSupabaseClient(), KEEP_CURRENT) };
}

/** A readiness read against a client that answers `script` for `verdicts`. */
function readinessWith(script: Parameters<typeof stubClient>[0]) {
  const stub = stubClient(script);
  return { stub, run: () => readSettlementReadiness(stub.asSupabaseClient()) };
}

/** Every object the stub was asked about, function calls included. */
function objectsTouched(stub: StubClient): string[] {
  return stub.calls.map((call) => call.table);
}

/* ── absence: the normal case for all of M2 ──────────────────────────────── */

describe("the function is not installed", () => {
  it("answers not_provisioned naming settle_review_item on PGRST202", async () => {
    // Measured against staging 2026-09-08 (admin-window/TASK-0047): calling
    // the function before it exists answers this code and writes nothing.
    const { stub, run } = callWith({
      [FN.settleReviewItem]: { error: functionNotInSchemaCache(FN.settleReviewItem) },
    });

    await expect(run()).resolves.toEqual({
      kind: "not_provisioned",
      missing: FN.settleReviewItem,
    });
    // The card names the string the CALL used, which is the string `tables.ts`
    // spells — §4 rule 4, and the reason the name lives there.
    expect(stub.functionsCalled()).toEqual([FN.settleReviewItem]);
  });

  it("answers not_provisioned on Postgres's own 42883", async () => {
    const { run } = callWith({
      [FN.settleReviewItem]: { error: undefinedFunction(FN.settleReviewItem) },
    });
    await expect(run()).resolves.toEqual({
      kind: "not_provisioned",
      missing: FN.settleReviewItem,
    });
  });

  it("calls the function by name with the one argument name it takes", async () => {
    // The PGRST202 trap (admin-window/TASK-0047): PostgREST answers the same
    // code for an INSTALLED function called with the wrong argument names, and
    // the app cannot tell the two apart. So the argument name is pinned, and
    // the decision reaches the database unaltered — the seam adds nothing to
    // the envelope the leaf built (ARCHITECTURE.md §9.2: no schema_version, no
    // tier, no source name).
    const { stub, run } = callWith({
      [FN.settleReviewItem]: { error: functionNotInSchemaCache(FN.settleReviewItem) },
    });
    await run();

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].kind).toBe("function");
    expect(stub.calls[0].steps[0]).toEqual({
      method: "rpc",
      args: [{ [SETTLE_ARGUMENT]: KEEP_CURRENT }],
    });
  });
});

describe("the verdicts table is not installed", () => {
  it("answers not_provisioned naming verdicts on PGRST205", async () => {
    // Measured read-only on the declared staging target 2026-09-08: a
    // GET-shaped read of the absent table answers exactly this.
    const { run } = readinessWith({
      [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
    });
    await expect(run()).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.verdicts,
    });
  });

  it("answers not_provisioned on Postgres's own 42P01", async () => {
    const { run } = readinessWith({
      [T.verdicts]: { error: undefinedTable(T.verdicts) },
    });
    await expect(run()).resolves.toEqual({
      kind: "not_provisioned",
      missing: T.verdicts,
    });
  });

  it("never asks whether the table is there by calling the function", async () => {
    // The ruling of 2026-09-08 (DECISIONS; ARCHITECTURE.md §9.2). PostgREST
    // cannot introspect a function without calling it, so a readiness probe
    // that called `settle_review_item` would be a write attempt dressed as a
    // question. The recording stub is what proves it: one read, of `verdicts`,
    // and not one function call on any path.
    for (const script of [
      { [T.verdicts]: { data: [] } },
      { [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) } },
      { [T.verdicts]: { error: statementTimeout() } },
    ]) {
      const { stub, run } = readinessWith(script);
      await run();
      expect(stub.functionsCalled()).toEqual([]);
      expect(stub.tablesRead()).toEqual([T.verdicts]);
      expect(objectsTouched(stub)).toEqual([T.verdicts]);
    }
  });

  it("asks for zero rows, GET-shaped, and asks for no count", async () => {
    // Why this shape and not a `head: true` count — measured read-only on
    // `ubfjjqlvnpnoborczbdb.supabase.co` 2026-09-08 against the genuinely
    // absent `verdicts`:
    //   `.select("*", { head: true, count: "exact" })` -> error === null,
    //   count === null, status 204 (the raw HEAD is a 404 with a zero-length
    //   body, and supabase-js parses its error out of the body), which
    //   `readCount` turns into an ERROR — the wrong card for the case this
    //   milestone renders most;
    //   `.select("*").limit(0)`          -> PGRST205 with the full body, and
    //   200 with zero rows against a table that IS there.
    // No offline stub can see that difference, so the query shape is pinned
    // here instead (LESSONS 4).
    const { stub, run } = readinessWith({ [T.verdicts]: { data: [] } });
    await run();

    const steps = stub.calls[0].steps;
    expect(steps.map((step) => step.method)).toEqual(["select", "limit"]);
    // One argument to `select`: no options object, so no `head` and no
    // `count` — the request is a GET and its failure carries a body.
    expect(steps[0].args).toEqual(["*"]);
    expect(steps[1].args).toEqual([0]);
  });
});

/* ── failures that are NOT absences ──────────────────────────────────────── */

describe("a failure that is not an absence", () => {
  it("carries the database's own words on both paths, on 57014", async () => {
    // LOOK_AND_FEEL: "the app shows what the database said." A timeout is not
    // a missing object and must never be reported as one.
    const call = callWith({ [FN.settleReviewItem]: { error: statementTimeout() } });
    const settled = await call.run();
    expect(settled.kind).toBe("error");
    if (settled.kind !== "error") return;
    expect(settled.reading).toBe(FN.settleReviewItem);
    expect(settled.message).toContain("canceling statement due to statement timeout");
    expect(settled.message).toContain("57014");

    const readiness = readinessWith({ [T.verdicts]: { error: statementTimeout() } });
    const ready = await readiness.run();
    expect(ready.kind).toBe("error");
    if (ready.kind !== "error") return;
    expect(ready.reading).toBe(T.verdicts);
    expect(ready.message).toContain("canceling statement due to statement timeout");
  });

  it("keeps a missing OPERATOR an error, not an absent function", async () => {
    // 42883 is also what Postgres raises for a missing operator
    // (admin-window/BUG-0058, measured on staging). The function is right
    // there; the call was wrong. Claiming absence would be a confident false
    // claim about an installed procedure.
    const { run } = callWith({ [FN.settleReviewItem]: { error: missingOperator() } });
    const result = await run();
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("operator does not exist");
  });

  it("reports a permission refusal as an error naming the function", async () => {
    const { run } = callWith({
      [FN.settleReviewItem]: { error: permissionDenied(FN.settleReviewItem) },
    });
    const result = await run();
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(FN.settleReviewItem);
    expect(result.message).toContain("permission denied");
  });

  it("never throws, whatever the client does", async () => {
    // §4.1: every export of `lib/db/**` returns a DbResult. A client that
    // THROWS — an unset credential, a transport that never answered — is the
    // path a page cannot survive if it escapes.
    const thrower = {
      from() {
        throw new Error("boom: no client");
      },
      rpc() {
        throw new Error("boom: no client");
      },
    } as unknown as Parameters<typeof settleReviewItem>[0];

    const settled = await settleReviewItem(thrower, KEEP_CURRENT);
    expect(settled.kind).toBe("error");
    const ready = await readSettlementReadiness(thrower);
    expect(ready.kind).toBe("error");

    // …and the shape supabase-js hands back when the transport fails, which
    // names nothing in `message` and carries the cause in `details`.
    const { run } = callWith({ [FN.settleReviewItem]: { error: transportFailure() } });
    const transport = await run();
    expect(transport.kind).toBe("error");
    if (transport.kind !== "error") return;
    expect(transport.message).toContain("bad port");
  });
});

/* ── the pre-database guard ──────────────────────────────────────────────── */

describe("a decision the leaf refuses", () => {
  /** Every refusal below is `decisionRefusals`' own identifier, not new vocabulary. */
  const REFUSED: ReadonlyArray<readonly [string, Parameters<typeof verdictDecision>[0]]> = [
    ["note_required", { action: "wont_fix", note: "   " }],
    ["actor_required", { actor: "" }],
    ["review_item_forbidden", { action: "override", value: verdictValue({ value: "x" }) }],
    ["value_forbidden", { action: "settle", value: verdictValue({ value: "x" }) }],
    ["unknown_action", { action: "delete_everything" as never }],
  ];

  it.each(REFUSED)("never reaches the database: %s", async (refusal, overrides) => {
    // The whole point of running the guard before the call: a malformed
    // payload is a NAMED refusal, not a Postgres exception, and the recording
    // stub proves nothing was sent. The stub is scripted with an answer it
    // must never need.
    const stub = stubClient({ [FN.settleReviewItem]: { data: verdictLogEntry() } });
    const result = await settleReviewItem(
      stub.asSupabaseClient(),
      verdictDecision(overrides),
    );

    expect(stub.calls).toEqual([]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(FN.settleReviewItem);
    expect(result.message).toContain(REFUSED_BEFORE_SEND);
    expect(result.message).toContain(refusal);
  });

  it("names every refusal that applies, not the first one", async () => {
    const stub = stubClient({ [FN.settleReviewItem]: { data: verdictLogEntry() } });
    const result = await settleReviewItem(
      stub.asSupabaseClient(),
      verdictDecision({ action: "wont_fix", note: null, actor: " " }),
    );

    expect(stub.calls).toEqual([]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("note_required");
    expect(result.message).toContain("actor_required");
  });

  it("sends a well-formed decision through", async () => {
    // The second fixture of the guard (LESSONS 3): the input it must NOT flag.
    // Without this the case above would pass on a seam that sent nothing ever.
    const stub = stubClient({ [FN.settleReviewItem]: { data: verdictLogEntry() } });
    const result = await settleReviewItem(stub.asSupabaseClient(), KEEP_CURRENT);

    expect(stub.functionsCalled()).toEqual([FN.settleReviewItem]);
    expect(result.kind).toBe("ok");
  });
});

/* ── the installed path ──────────────────────────────────────────────────── */

describe("the function is installed", () => {
  it("reads the receipt the function returned", async () => {
    const row = verdictLogEntry({ action: "choose_claimed_value" });
    const { run } = callWith({ [FN.settleReviewItem]: { data: row } });
    const result = await run();

    expect(result).toEqual({
      kind: "ok",
      data: {
        verdict_id: row.verdict_id,
        review_item_id: row.review_item_id,
        action: row.action,
        observation_id: row.observation_id,
        created_at: row.created_at,
      } satisfies VerdictReceipt,
    });
  });

  it("reads it out of a set as well as out of a row", async () => {
    // A function declared `returns setof` hands back an array; one declared
    // `returns verdicts` hands back an object. The artifact that installs it is
    // authored separately (SPEC F9), so the seam reads both rather than
    // assuming one and turning the other into a silent failure.
    const row = verdictLogEntry();
    const { run } = callWith({ [FN.settleReviewItem]: { data: [row] } });
    await expect(run()).resolves.toMatchObject({
      kind: "ok",
      data: { verdict_id: row.verdict_id },
    });
  });

  it("carries a null review_item_id and observation_id through as null", async () => {
    // The item-less `override` from the record surface (spec §7): both
    // nullable columns are genuinely null, and a seam that dropped them would
    // send a surface hunting for a review item that does not exist.
    const row = verdictLogEntry({
      action: "override",
      review_item_id: null,
      observation_id: null,
    });
    const { run } = callWith({ [FN.settleReviewItem]: { data: row } });
    const result = await run();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.review_item_id).toBeNull();
    expect(result.data.observation_id).toBeNull();
    expect(result.data.action).toBe("override");
  });

  it("reads exactly the five contracted fields and invents none", async () => {
    const { run } = callWith({
      [FN.settleReviewItem]: {
        data: { ...verdictLogEntry(), actor: "someone", note: "why", extra_column: 1 },
      },
    });
    const result = await run();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(Object.keys(result.data).sort()).toEqual(
      ["action", "created_at", "observation_id", "review_item_id", "verdict_id"].sort(),
    );
  });

  it("refuses an answer that is not a receipt, rather than half-reading one", async () => {
    // An empty set, nothing at all, and a row missing a not-null column. A
    // caller must never be told a verdict landed when what came back cannot
    // say that it did.
    for (const data of [null, [], { review_item_id: ID.reviewItemDataConflict }, "ok"]) {
      const { run } = callWith({ [FN.settleReviewItem]: { data } });
      const result = await run();
      expect(result.kind).toBe("error");
      if (result.kind !== "error") continue;
      expect(result.reading).toBe(FN.settleReviewItem);
      expect(result.message).toBe(NO_RECEIPT);
    }
  });
});

describe("the readiness read, against a database that has the table", () => {
  it("answers ready for an empty table and for a populated one", async () => {
    // The second fixture (LESSONS 3): the input the probe must NOT flag. An
    // empty `verdicts` means nobody has settled anything yet — the path is
    // open, and a surface that read "no rows" as "not provisioned" would hide
    // the controls on a fully installed database.
    for (const data of [[], [verdictLogEntry()]]) {
      const { run } = readinessWith({ [T.verdicts]: { data } });
      await expect(run()).resolves.toEqual({ kind: "ok", data: "ready" });
    }
  });
});
