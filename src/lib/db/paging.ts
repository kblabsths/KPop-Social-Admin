import type { DbResult } from "./result";
import { endsWithin, type PageAnswer, type PageWindow } from "../paging/bounds";

/**
 * Where the three-arm read contract meets the wire — campaign
 * admin-window/TASK-0063, carried to page windows 2026-10-16.
 *
 * It lives on the DB side because it may NAME a `DbResult`; the paging leaf
 * may not, not even as a type (ARCHITECTURE.md §4 rule 7). It is the ONLY
 * place this mapping is written: two route handlers writing it themselves is
 * two chances for a refusal to reach the client as something else (LESSONS 5).
 *
 * One import is a value — `endsWithin`, the ONE derivation of exhaustion —
 * and it comes from a leaf, so no caller pulls a database client in by asking
 * for the mapping.
 */

/**
 * One window read's result, as the wire answers it.
 *
 * `window` is the window the request named: `exhausted` is `endsWithin(rows,
 * size)` — a short window is the end of the set, and that is the ONLY thing
 * that decides it. No count is read to answer this, and no answer ever claims
 * a total (ARCHITECTURE.md §4.3 read kind 3). `page` and `size` ECHO the
 * request, never a number recomputed from `rows.length`.
 *
 * `not_provisioned` and `error` cross UNCHANGED, carrying `missing` /
 * `reading` + `message` + the account's authorship, so the client's refusal
 * names the same object the page's own not-provisioned card would name (§4.1).
 */
export function pageAnswerOf<Row>(
  result: DbResult<Row[]>,
  window: PageWindow,
): PageAnswer<Row> {
  switch (result.kind) {
    case "ok":
      return {
        kind: "ok",
        rows: result.data,
        page: window.page,
        size: window.size,
        exhausted: endsWithin(result.data.length, window.size),
      };
    case "not_provisioned":
      return { kind: "not_provisioned", missing: result.missing };
    case "error":
      return {
        kind: "error",
        reading: result.reading,
        message: result.message,
        authored: result.authored,
      };
  }
}
