/**
 * WHAT A SERVER COMPONENT MAY HAND A CLIENT ONE — the values, not the imports
 * (campaign admin-window, QA off admin-window/BUG-0222).
 *
 * `tests/offline/shell/client-boundary.test.ts` owns the IMPORT half of this
 * boundary: a server module may not import a value out of a `"use client"`
 * module. This is the PROP half, and it is the same 500 from the other side —
 * Next serializes every prop a server component writes on a client element
 * into the flight payload, and a value it cannot serialize is not a warning:
 *
 *     Error: Functions cannot be passed directly to Client Components unless
 *     you explicitly expose it by marking it with "use server".
 *
 * The page answers **HTTP 500** and renders nothing at all. Measured on a
 * production build of this tree on 2026-09-14: `/claims` and `/browse` both
 * 500, with `{route: ..., params: "", size: 50, id: function Z}` in the server
 * log.
 *
 * **Why no offline tier saw it.** This suite renders a page with
 * `renderToStaticMarkup`, which is ordinary React SSR: there is no client
 * boundary in it, so a function prop is simply called or ignored and every
 * assertion about the markup still passes. `tsc` sees a well-typed function,
 * `npm run lint` sees an ordinary property, and `npm run build` compiles it —
 * the error exists only when a REQUEST serializes the tree. That is exactly
 * LESSONS 10's class, and this helper is how the offline tier can see it
 * anyway: it asks the value the page actually handed across, rather than the
 * markup that came back.
 *
 * The property, positively: **every prop a page hands a client component is
 * DATA** — a value React can put in the flight payload and the browser can
 * read back. Functions are the one shape that is never data.
 */

/**
 * Every path inside `value` that holds a FUNCTION, as dotted paths for a
 * failure message to name (`deps.id`, `initial.rows.0.onPick`).
 *
 * Walks plain objects, arrays, `Set`s and `Map`s — the shapes React 19's
 * flight serializer accepts — and stops at everything else. It reports paths
 * rather than a boolean so the assertion says WHICH prop is the defect, which
 * is the whole difference between a test that sends a reader to a line and one
 * that sends them to a file.
 *
 * `children` is NOT special-cased here: a caller passes the props it means to
 * grade, and React elements handed as children are the caller's to exclude.
 */
export function functionPaths(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [path === "" ? "<root>" : path];
  if (value === null || typeof value !== "object") return [];
  const at = (key: string | number): string => (path === "" ? String(key) : `${path}.${key}`);

  if (Array.isArray(value)) return value.flatMap((item, i) => functionPaths(item, at(i)));
  if (value instanceof Set) return [...value].flatMap((item, i) => functionPaths(item, at(i)));
  if (value instanceof Map) {
    return [...value.entries()].flatMap(([key, item]) => functionPaths(item, at(String(key))));
  }
  // A React element is data to the flight serializer, but the function inside
  // it (`element.type`) is the component itself and is never a prop — so the
  // walk reads an element's PROPS and never its type.
  const record = value as Record<string, unknown>;
  if (typeof record.$$typeof === "symbol") return functionPaths(record.props, at("props"));
  return Object.entries(record).flatMap(([key, item]) => functionPaths(item, at(key)));
}
