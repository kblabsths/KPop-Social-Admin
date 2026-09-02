import { EM_DASH, isAbsent } from "@/lib/format";

/**
 * Data-surface state 4 of 4. One red line: which read failed and what failed
 * in the database's own words (mono — the machine said it), then the retry in
 * the app's voice. No apology, no generic message, nothing swallowed.
 *
 * `reading` is REQUIRED because a page can make several reads — Browse makes
 * four, each reported separately on purpose — and a line saying only
 * "TypeError: fetch failed" names none of them, so an operator cannot tell
 * which one refused (LOOK_AND_FEEL state 4 and Voice bar 3,
 * admin-window/BUG-0016). It was optional until admin-window/TASK-0030, which
 * is how BUG-0016 shipped: a rule review has to catch is a rule the compiler
 * should be catching. `DbResult`'s error arm carries the string, so every
 * caller already holds it (`lib/db/result.ts`).
 */
export function ErrorLine({
  reading,
  failed,
  retry,
}: {
  /** The object the failed read was reading, spelled as the query spelled it. */
  reading: string;
  /** The failure verbatim — the function's own refusal. */
  failed: string;
  /** What to do about it, in the app's voice. */
  retry: string;
}) {
  // The type demands the read be named; it cannot demand the name say
  // anything, since `""` is a `string`. A reading that states nothing gets the
  // failure alone rather than a dangling em dash — asked of the app's one
  // definition of absence, not a guard of its own (`isAbsent`, lib/format —
  // admin-window/BUG-0004 and BUG-0019).
  const named = !isAbsent(reading);
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-broken" role="alert">
      <span className="type-data">
        {named ? `${reading} ${EM_DASH} ${failed}` : failed}
      </span>
      <span className="type-body">{retry}</span>
    </p>
  );
}
