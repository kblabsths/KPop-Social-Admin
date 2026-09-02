import { EM_DASH } from "@/lib/format";

/**
 * Data-surface state 4 of 4. One red line: which read failed and what failed
 * in the database's own words (mono — the machine said it), then the retry in
 * the app's voice. No apology, no generic message, nothing swallowed.
 *
 * `reading` exists because a page can make several reads — Browse makes four,
 * each reported separately on purpose — and a line saying only "TypeError:
 * fetch failed" names none of them, so an operator cannot tell which one
 * refused (LOOK_AND_FEEL state 4 and Voice bar 3, admin-window/BUG-0016).
 */
export function ErrorLine({
  reading,
  failed,
  retry,
}: {
  /**
   * The object the failed read was reading, spelled as the query spelled it.
   * Omitted where the surface makes exactly one read and names it already.
   */
  reading?: string;
  /** The failure verbatim — the function's own refusal. */
  failed: string;
  /** What to do about it, in the app's voice. */
  retry: string;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-broken" role="alert">
      <span className="type-data">
        {reading ? `${reading} ${EM_DASH} ${failed}` : failed}
      </span>
      <span className="type-body">{retry}</span>
    </p>
  );
}
