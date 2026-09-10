import { describe, expect, it } from "vitest";
import { isPageAnswer, type PageAnswer } from "@/lib/paging/bounds";
import { pageAnswerOf } from "@/lib/db/paging";
import type { DbResult } from "@/lib/db/result";

/**
 * The page answer, on BOTH sides of the wire — campaign
 * admin-window/TASK-0063.
 *
 * `pageAnswerOf` (db side) is what a route handler puts on the wire;
 * `isPageAnswer` (leaf) is what the client asks of whatever comes back. They
 * are graded in one file because the property that matters spans them: every
 * answer the mapping produces is one the client accepts, and everything else
 * is a refusal rather than a crash.
 */

type Row = { id: string };

const SIZE = 3;
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("pageAnswerOf", () => {
  it("calls a SHORT page the end of the set, and a full one not", () => {
    // A short page is the end of the set and is the ONLY thing that decides
    // it: no count is read, and no answer claims a total (§4.3 kind 3).
    const full: DbResult<Row[]> = { kind: "ok", data: rows("a", "b", "c") };
    const short: DbResult<Row[]> = { kind: "ok", data: rows("a", "b") };
    expect(pageAnswerOf(full, 3, SIZE)).toEqual({
      kind: "ok",
      rows: rows("a", "b", "c"),
      offset: 3,
      exhausted: false,
    });
    expect(pageAnswerOf(short, 3, SIZE)).toEqual({
      kind: "ok",
      rows: rows("a", "b"),
      offset: 3,
      exhausted: true,
    });
  });

  it("answers a page past the end as exhaustion, never as a refusal", () => {
    const answer = pageAnswerOf({ kind: "ok", data: [] as Row[] }, 300, SIZE);
    expect(answer).toEqual({ kind: "ok", rows: [], offset: 300, exhausted: true });
  });

  it("carries the bound it was answered for, and the rows in the read's order", () => {
    const answer = pageAnswerOf({ kind: "ok", data: rows("c", "a", "b") }, 90, SIZE);
    expect(answer.kind === "ok" && answer.offset).toBe(90);
    expect(answer.kind === "ok" && answer.rows.map((row) => row.id)).toEqual(["c", "a", "b"]);
  });

  it("crosses a refusal UNCHANGED, naming the same object the page would name", () => {
    // §4.1: the client's refusal must name the same object the page's own
    // not-provisioned card names, in the spelling `tables.ts` gave the query.
    expect(pageAnswerOf<Row>({ kind: "not_provisioned", missing: "pending_claims" }, 50, SIZE)).toEqual(
      { kind: "not_provisioned", missing: "pending_claims" },
    );
    expect(
      pageAnswerOf<Row>(
        { kind: "error", reading: "event_listings", message: "connection refused" },
        50,
        SIZE,
      ),
    ).toEqual({ kind: "error", reading: "event_listings", message: "connection refused" });
  });

  it("produces only answers the client's own guard accepts", () => {
    // The cross-wire property: the two halves of this contract agree.
    const results: DbResult<Row[]>[] = [
      { kind: "ok", data: rows("a") },
      { kind: "ok", data: [] },
      { kind: "not_provisioned", missing: "pending_claims" },
      { kind: "error", reading: "pending_claims", message: "boom" },
    ];
    for (const result of results) {
      const answer = pageAnswerOf(result, 50, SIZE);
      // Through JSON, because that is the only way it ever travels.
      expect(isPageAnswer(JSON.parse(JSON.stringify(answer))), result.kind).toBe(true);
    }
  });
});

describe("isPageAnswer", () => {
  it("accepts each of the four arms", () => {
    const answers: PageAnswer<Row>[] = [
      { kind: "ok", rows: rows("a"), offset: 50, exhausted: false },
      { kind: "ok", rows: [], offset: 50, exhausted: true },
      { kind: "not_provisioned", missing: "pending_claims" },
      { kind: "error", reading: "pending_claims", message: "boom" },
      { kind: "refused", reason: "the offset must be a multiple of 50", bound: "75" },
    ];
    for (const answer of answers) {
      expect(isPageAnswer(answer), JSON.stringify(answer)).toBe(true);
    }
  });

  it("rejects a foreign body, including one wearing the right kind", () => {
    // A login redirect, an error page, a proxy's own JSON, a body that says
    // `ok` and carries no rows — the last is the one that would otherwise
    // reach a spread and throw.
    const foreign: unknown[] = [
      null,
      undefined,
      42,
      "ok",
      [],
      {},
      { kind: "okay" },
      { kind: "ok" },
      { kind: "ok", rows: "two", offset: 50, exhausted: false },
      { kind: "ok", rows: [], offset: "50", exhausted: false },
      { kind: "ok", rows: [], offset: 50, exhausted: "no" },
      { kind: "not_provisioned" },
      { kind: "not_provisioned", missing: 7 },
      { kind: "error", reading: "pending_claims" },
      { kind: "error", message: "boom" },
      { kind: "refused", reason: "no" },
      { kind: "refused", reason: "no", bound: 75 },
      { error: "Unauthorized" },
      { message: "Internal Server Error" },
    ];
    for (const body of foreign) {
      expect(isPageAnswer(body), JSON.stringify(body ?? String(body))).toBe(false);
    }
  });
});
