/**
 * Remove a secret's value from text that is about to be printed.
 *
 * Extracted from `session-cookie.mts` (admin-window/TASK-0033) when
 * `reset-sandbox.mts` (admin-window/TASK-0036) needed the same guarantee for a
 * different secret: both walk tools write diagnostics to stderr, and both are
 * built on the rule that the value of the one credential they read never
 * appears on either stream, on any path — including a thrown error's message,
 * which is the one place nobody controls the wording of.
 *
 * It lives in its own module rather than being copied because a scrub that
 * exists twice drifts, and the half that drifts is the half nobody was reading
 * when the secret leaked. `session-cookie.mts` re-exports it, so its own
 * importers and its offline test are unchanged.
 *
 * `.mts` and not `.ts`, and imported with that real extension
 * (`allowImportingTsExtensions`). Both halves were measured on the Node 26.7.0
 * this repo runs, 2026-09-04: Node resolves no extensionless TypeScript
 * specifier and does not rewrite a `.mjs` specifier onto a `.mts` file
 * (`ERR_MODULE_NOT_FOUND`), and a `.ts` module in a package with no
 * `"type": "module"` is reparsed with a `MODULE_TYPELESS_PACKAGE_JSON` warning
 * on stderr — which `session-cookie.mts` promises never to emit, and whose own
 * offline test caught this file when it was first written as `.ts`.
 */

/**
 * Every occurrence of `secret` in `text`, replaced with `[redacted]`.
 *
 * An empty secret is returned unchanged: splitting on `""` would redact
 * between every character and produce nothing readable, and there is nothing
 * to hide in that case anyway.
 */
export function scrub(text: string, secret: string): string {
  if (secret.length === 0) return text;
  return text.split(secret).join("[redacted]");
}
