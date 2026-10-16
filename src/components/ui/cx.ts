/**
 * Join class names, dropping anything falsy. Local and three lines because a
 * dependency for this would be a supply-chain ticket for a `filter().join()`.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
