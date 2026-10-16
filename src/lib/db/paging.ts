import type { DbResult } from "./result";
import type { PageAnswer } from "../paging/bounds";

/**
 * Where the three-arm read contract meets the wire — campaign
 * admin-window/TASK-0063.
 *
 * It lives on the DB side because it may NAME a `DbResult`; the paging leaf
 * may not, not even as a type (ARCHITECTURE.md §4 rule 7). It is the ONLY
 * place this mapping is written: two route handlers writing it themselves is
 * two chances for a refusal to reach the client as something else (LESSONS 5).
 *
 * Both imports are types, so nothing here survives to runtime and no caller
 * pulls a database client in by asking for the mapping.
 */

/**
 * One window read's result, as the wire answers it.
 *
 * `size` is the window the server asked for: `exhausted` is
 * `rows.length < size` — a short page is the end of the set, and that is the
 * ONLY thing that decides it. No count is read to answer this, and no answer
 * ever claims a total (ARCHITECTURE.md §4.3 read kind 3: a concatenation is
 * still not a total).
 *
 * `not_provisioned` and `error` cross UNCHANGED, carrying `missing` /
 * `reading` + `message` + the account's authorship, so the client's refusal
 * names the same object the
 * page's own not-provisioned card would name (§4.1) — in the same spelling
 * `tables.ts` gave the query. Nothing is summarised, replaced or softened on
 * the way out: the app shows what the database said.
 *
 * A read that comes back `ok` with MORE rows than the window asked for is
 * still `ok` with those rows and is not exhausted; deciding otherwise would be
 * this function inventing a page boundary the read did not have.
 */
export function pageAnswerOf<Row>(
  result: DbResult<Row[]>,
  offset: number,
  size: number,
): PageAnswer<Row> {
  switch (result.kind) {
    case "ok":
      return {
        kind: "ok",
        rows: result.data,
        offset,
        exhausted: result.data.length < size,
      };
    case "not_provisioned":
      return { kind: "not_provisioned", missing: result.missing };
    case "error":
      // The account crosses with its AUTHORSHIP, in the runs `lib/db/result.ts`
      // decided where the clauses are written — never re-derived at the far end
      // (admin-window/BUG-0196 criterion 5c). `message` is still the join of
      // those runs, so a client that reads only the string reads exactly what
      // it read before.
      return {
        kind: "error",
        reading: result.reading,
        message: result.message,
        authored: result.authored,
      };
  }
}
