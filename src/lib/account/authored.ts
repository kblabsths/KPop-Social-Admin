/**
 * WHO WROTE THESE WORDS — the app's ONE spelling of that fact, and the pure
 * functions over it (campaign admin-window/BUG-0196).
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it imports NOTHING, so both
 * sides of the question can reach it. `src/lib/db/result.ts` DECIDES the fact
 * where each clause is authored; `src/lib/paging/**` carries it across the
 * wire; the two renderers read it to choose a face. Rule 7 forbids the paging
 * leaf from naming a `DbResult`, so a type both of them need lives BELOW both
 * — which is this file.
 *
 * **Why the fact travels instead of being recovered.** An account reaching a
 * renderer as one string cannot say which of its sentences the DATABASE
 * produced and which THIS APP wrote about it, and the typographic split —
 * "mono carries every value the database produced; sans carries every word the
 * app wrote" (LOOK_AND_FEEL → Typography) — needs exactly that. The only
 * alternative is a renderer matching a sentence against a list of the app's
 * own phrases, which is one rule written twice: reword the sentence and a face
 * moves with nothing failing (admin-window/BUG-0175 settled this for the
 * paging refusal; BUG-0196 settles it for the account itself).
 *
 * **One vocabulary.** `ReasonAuthor` was declared in
 * `src/lib/paging/machine.ts` and is re-exported from there, so its two
 * spellings — `"this app"` and `"the machine"` — are still typed in exactly
 * one file. A second two-valued type for the same fact is the defect this
 * module exists to prevent, not a style choice.
 */

/** The two answers to "who wrote these words". */
export type ReasonAuthor = "this app" | "the machine";

/**
 * ONE run of an account: some words, and who wrote them.
 *
 * `words` are carried VERBATIM — never trimmed, reworded, truncated or
 * re-ordered by anything downstream of the author (§4.1). The segment is the
 * smallest unit the split has an answer for, and a renderer draws one span per
 * RUN of same-authored segments (`accountRuns`).
 */
export interface AccountSegment {
  readonly words: string;
  readonly author: ReasonAuthor;
}

/**
 * The ONE character that joins two segments of an account.
 *
 * It is a single space because that is what every caller already joined its
 * parts with, and it is named here because `accountText` and the callers that
 * compare a flat account to a segment list must use the same one. A join that
 * differs by a byte is a `message` that is no longer the join of its segments,
 * and criterion 3's byte-identity stops being structural.
 */
const SEGMENT_GAP = " ";

/**
 * The account as ONE string — the JOIN of its segments, and the only way this
 * app spells a flat account.
 *
 * Every flat `message` the data layer publishes is this function's output
 * (§4.1, admin-window/BUG-0196 criterion 5b), so there is no second code path
 * composing the same sentence: a database message that answers none of the
 * account's questions is one segment, and joining a list of one returns it
 * byte-identical.
 */
export function accountText(segments: readonly AccountSegment[]): string {
  return segments.map((segment) => segment.words).join(SEGMENT_GAP);
}

/**
 * The account's RUNS: consecutive segments by the SAME author merged into one,
 * in order, each carrying the words the flat account carries between them.
 *
 * THE ONE run-splitting derivation in this app (BUG-0196 criterion 5d). Both
 * renderers — `ErrorLine` (data-surface state 4, every page) and the paging
 * refusal's broken arm — draw one span per run out of THIS list. A second
 * hand-written walk in the second renderer is two copies of one rule, and this
 * rule has already been fixed once in this family.
 *
 * The merge matters for more than tidiness: the renderers lay their runs out
 * as flex items, so the gap BETWEEN two spans is drawn by the layout and is
 * not a character. Two same-authored parts therefore have to arrive in ONE
 * span, joined by the same `SEGMENT_GAP` the flat account uses, or an account
 * the database wrote in two fields would read with its space missing. A
 * single-authored account — a real PostgREST refusal, every arm of the paging
 * driver but one — merges to exactly one run whose words are `accountText`'s
 * own output, which is what keeps those lines byte-identical.
 *
 * Blank segments are dropped: they put no ink on the page and an empty span is
 * a flex item that draws a gap around nothing.
 */
export function accountRuns(segments: readonly AccountSegment[]): AccountSegment[] {
  const runs: AccountSegment[] = [];
  for (const segment of segments) {
    if (segment.words.length === 0) continue;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.author === segment.author) {
      runs[runs.length - 1] = {
        words: `${last.words}${SEGMENT_GAP}${segment.words}`,
        author: last.author,
      };
      continue;
    }
    runs.push(segment);
  }
  return runs;
}

/**
 * Is this parsed value a segment list at all?
 *
 * The wire question, asked in the leaf that owns the shape so that the
 * validator and the type cannot drift (`isPageAnswer`, `src/lib/paging/
 * bounds.ts`). Every element must be an object carrying a string `words` and
 * an `author` that is one of the two spellings — an unknown third value is
 * foreign data, and foreign data is a refusal rather than something a surface
 * renders.
 *
 * An EMPTY list is a segment list: a caller may legitimately carry no runs,
 * and there is nothing unreadable about none.
 */
export function isAccountSegments(value: unknown): value is AccountSegment[] {
  if (!Array.isArray(value)) return false;
  return value.every((segment) => {
    if (typeof segment !== "object" || segment === null) return false;
    const { words, author } = segment as { words?: unknown; author?: unknown };
    return typeof words === "string" && (author === "this app" || author === "the machine");
  });
}
