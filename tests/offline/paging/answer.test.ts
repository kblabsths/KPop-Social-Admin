import { describe, expect, it } from "vitest";
import { isPageAnswer, type PageAnswer, type PageWindow } from "@/lib/paging/bounds";
import { pageAnswerOf } from "@/lib/db/paging";
import type { DbResult } from "@/lib/db/result";
import type { AccountSegment } from "@/lib/account/authored";

/**
 * Where the three-arm read contract meets the wire — `lib/db/paging.ts` — and
 * the client's own gate over what comes back. Page windows since 2026-10-16:
 * an answer echoes the WINDOW it was served for.
 */

type Row = { id: string };

const WINDOW: PageWindow = { page: 2, size: 20 };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("pageAnswerOf", () => {
  it("calls a SHORT window the end of the set, a full one not, and echoes the window", () => {
    const full: DbResult<Row[]> = { kind: "ok", data: rows(...Array.from({ length: 20 }, (_, i) => `r${i}`)) };
    const short: DbResult<Row[]> = { kind: "ok", data: rows("a", "b") };
    const empty: DbResult<Row[]> = { kind: "ok", data: [] };
    expect(pageAnswerOf(full, WINDOW)).toMatchObject({ kind: "ok", page: 2, size: 20, exhausted: false });
    expect(pageAnswerOf(short, WINDOW)).toEqual({
      kind: "ok",
      rows: rows("a", "b"),
      page: 2,
      size: 20,
      exhausted: true,
    });
    // An empty window is an answer: the read happened and found nothing.
    expect(pageAnswerOf(empty, WINDOW)).toEqual({ kind: "ok", rows: [], page: 2, size: 20, exhausted: true });
    // The rows in the read's own order, never re-sorted.
    const ordered = pageAnswerOf({ kind: "ok", data: rows("c", "a", "b") }, WINDOW);
    expect(ordered.kind === "ok" && ordered.rows.map((row) => row.id)).toEqual(["c", "a", "b"]);
  });

  it("crosses a refusal UNCHANGED, naming the same object the page would name", () => {
    expect(pageAnswerOf<Row>({ kind: "not_provisioned", missing: "pending_claims" }, WINDOW)).toEqual({
      kind: "not_provisioned",
      missing: "pending_claims",
    });
    expect(
      pageAnswerOf<Row>(
        // @ts-expect-error admin-window/DEBT-0021 made `authored` REQUIRED on the
        // union's error arm; the mapping's behaviour for one is still graded:
        // what crosses is copied, never invented.
        { kind: "error", reading: "event_listings", message: "connection refused" },
        WINDOW,
      ),
    ).toEqual({
      kind: "error",
      reading: "event_listings",
      message: "connection refused",
      authored: undefined,
    });
  });

  it("crosses the error arm's authorship through JSON unchanged, and refuses an unreadable one", () => {
    const ACCOUNT: AccountSegment[] = [
      { words: "canceling statement due to statement timeout", author: "the machine" },
      { words: "and this app's own clause about what it would not quote", author: "this app" },
    ];
    const answer = pageAnswerOf<Row>(
      {
        kind: "error",
        reading: "pending_claims",
        message: ACCOUNT.map((segment) => segment.words).join(" "),
        authored: ACCOUNT,
      },
      WINDOW,
    );
    const arrived: unknown = JSON.parse(JSON.stringify(answer));
    expect(isPageAnswer(arrived)).toBe(true);
    expect(arrived).toEqual({
      kind: "error",
      reading: "pending_claims",
      message: ACCOUNT.map((segment) => segment.words).join(" "),
      authored: ACCOUNT,
    });

    const unreadable: unknown[] = [
      { kind: "error", reading: "x", message: "boom", authored: "the machine" },
      { kind: "error", reading: "x", message: "boom", authored: [null] },
      { kind: "error", reading: "x", message: "boom", authored: [{ words: "boom" }] },
      { kind: "error", reading: "x", message: "boom", authored: [{ words: "boom", author: "somebody else" }] },
    ];
    for (const body of unreadable) {
      expect(isPageAnswer(body), JSON.stringify(body)).toBe(false);
    }
    expect(isPageAnswer({ kind: "error", reading: "x", message: "boom", authored: [] })).toBe(true);
  });
});

describe("isPageAnswer", () => {
  it("accepts each of the four arms", () => {
    const answers: PageAnswer<Row>[] = [
      { kind: "ok", rows: rows("a"), page: 2, size: 20, exhausted: false },
      { kind: "ok", rows: [], page: 2, size: 20, exhausted: true },
      { kind: "not_provisioned", missing: "pending_claims" },
      { kind: "error", reading: "pending_claims", message: "boom" },
      { kind: "refused", reason: "the page must be at least 1", param: "page", bound: "0" },
    ];
    for (const answer of answers) {
      expect(isPageAnswer(answer), JSON.stringify(answer)).toBe(true);
    }
  });

  it("rejects a foreign body, including one wearing the right kind", () => {
    const foreign: unknown[] = [
      null,
      undefined,
      42,
      "ok",
      [],
      {},
      { kind: "okay" },
      { kind: "ok" },
      { kind: "ok", rows: "two", page: 2, size: 20, exhausted: false },
      { kind: "ok", rows: [], page: "2", size: 20, exhausted: false },
      { kind: "ok", rows: [], page: 2, exhausted: false },
      { kind: "ok", rows: [], page: 2, size: 20, exhausted: "no" },
      // The OLD wire shape, so a route left on the offset vocabulary is refused
      // by the client rather than drawn.
      { kind: "ok", rows: [], offset: 50, exhausted: false },
      { kind: "not_provisioned" },
      { kind: "not_provisioned", missing: 7 },
      { kind: "error", reading: "pending_claims" },
      { kind: "error", message: "boom" },
      { kind: "refused", reason: "no" },
      { kind: "refused", reason: "no", bound: "75" },
      { kind: "refused", reason: "no", param: "page", bound: 75 },
      { error: "Unauthorized" },
      { message: "Internal Server Error" },
    ];
    for (const body of foreign) {
      expect(isPageAnswer(body), JSON.stringify(body ?? String(body))).toBe(false);
    }
  });
});
