/**
 * Data-surface state 4 of 4. One red line: what failed in the database's own
 * words (mono — the machine said it), then the retry in the app's voice. No
 * apology, no generic message, nothing swallowed.
 */
export function ErrorLine({
  failed,
  retry,
}: {
  /** The failure verbatim — the function's own refusal. */
  failed: string;
  /** What to do about it, in the app's voice. */
  retry: string;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-broken" role="alert">
      <span className="type-data">{failed}</span>
      <span className="type-body">{retry}</span>
    </p>
  );
}
