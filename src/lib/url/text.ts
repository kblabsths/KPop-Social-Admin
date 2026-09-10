/**
 * **The ONE derivation of a free-text URL facet value** — what is SHOWN is what
 * was USED (ARCHITECTURE.md §7, "What is SHOWN is what was USED: one derivation
 * per URL value class"; common violations row 20, promoted at seven bugs;
 * campaign admin-window/BUG-0155).
 *
 * A facet value is used TWICE — it is SENT to PostgREST and it is SPELLED in
 * the sentences this app wrote — and until this module the free-text class had
 * no single place that made those two the same string. `/cycles?source=%20tick`
 * `etmaster` narrowed by `" ticketmaster"` and said, in the app's own words,
 * "found no runs from ticketmaster at all", over a source the same page draws
 * five runs for one invisible character away, with nothing on the
 * dropped-parameter line (measured in Chromium on a production build,
 * admin-window/BUG-0155). The uuid class has had its one derivation since
 * BUG-0143 (`canonicalRecordId`, `src/lib/records/id.ts`); this is the
 * free-text class's, and the four-line wrapper in `src/lib/db/runs.ts` that
 * returned the value verbatim is retired into it.
 *
 * **`canonicalUrlText` answers a DIFFERENT question from `canSpellUrlValue`**
 * (`./spellable.ts`), and each owns its own (LESSONS 4). That one is a
 * PREDICATE: *may this app spell the value the URL carried?* This one is a
 * DERIVATION: *which single string does this parameter name?* — and its answer
 * is the only string that reaches the query, the facet's own box and every
 * sentence naming it, or there is no facet at all and the shared
 * dropped-parameter line reports it. A predicate cannot answer the second
 * question, which is why six bugs on this family each closed one property of
 * the value and none of them closed this one.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): its only imports are two
 * other leaves, it reaches no client, no `process.env`, no table name and
 * nothing under `lib/db/**`, so every layer may ask it — including
 * `readRuns` — the edge that made this question's old home in `lib/db/**` a
 * pure function no leaf could reach (common violations row 17).
 * `tests/offline/db/layering.test.ts` names it in the leaf set and pins that.
 */

import { hasVisibleContent } from "@/lib/verdict/decision";
import { canSpellUrlValue } from "./spellable";

/**
 * `text` with its leading and trailing INK-LESS code points removed — the
 * padding a paste carries, by the app's one definition of blank rather than by
 * `trim()`'s narrower one (admin-window/BUG-0146).
 *
 * Read by CODE POINT (`Array.from`), not by UTF-16 unit, so an astral
 * character at either end is weighed whole rather than as two halves — none of
 * the ink-less class is astral today, and a guard that splits a surrogate pair
 * would be wrong the moment one is.
 *
 * It asks `hasVisibleContent` of each end character instead of holding a
 * character class of its own: the class lives in ONE file
 * (`lib/verdict/decision.ts`), and this is a caller of it, not a second copy.
 * Bounded to the ends on purpose — see `canonicalUrlText` below and
 * `canonicalRecordId`'s own note.
 *
 * **This is the app's ONE ends-only ink strip, and both derivations call it**
 * (admin-window/BUG-0155, criterion 3). It arrived here from `trimPad`, a
 * private function of `src/lib/records/id.ts`, unchanged: the uuid class and
 * the free-text class need the same strip, and a rule in prose is retyped
 * while a rule with one declaration is not (LESSONS 5; ARCHITECTURE.md common
 * violations row 9). A hand-copied second strip is the defect this export
 * exists to prevent — `tests/offline/url/narrowing.test.ts` owns the name and
 * pins that exactly one module in `src/` declares it.
 */
export function trimInkPadding(text: string): string {
  const points = Array.from(text);
  let start = 0;
  let end = points.length;
  while (start < end && !hasVisibleContent(points[start])) start += 1;
  while (end > start && !hasVisibleContent(points[end - 1])) end -= 1;
  return points.slice(start, end).join("");
}

/**
 * A run of two or more SPACES — the only thing a browser RE-SPELLS inside the
 * allowlist's range (admin-window/BUG-0155).
 *
 * `canSpellUrlValue` admits U+0020..U+007E and nothing else, and a browser
 * lays every one of those out as written except the space: CSS `white-space`
 * defaults to `normal`, so a sequence of spaces in an HTML paragraph is
 * rendered as ONE. Inside that range, therefore, "a value whose rendered
 * spelling is not itself" is exactly this pattern, and the test is total
 * rather than a list of the cases anyone thought of (LESSONS 4). The ENDS are
 * not this regex's business: `trimInkPadding` has already removed them, and
 * padding at an end is the case that CANONICALISES rather than the case that
 * is refused.
 *
 * No `g` flag: `test` on a global regex keeps `lastIndex` between calls and
 * would answer the same value differently depending on what came before it
 * (the same reason `./spellable.ts` says so about its two).
 */
const RESPELLED = / {2,}/;

/**
 * The ONE string a free-text URL facet names — both the value SENT to the
 * query and the value SPELLED in every sentence about it — or `null` for no
 * narrowing at all.
 *
 * Its steps, in the order ARCHITECTURE.md §7 states them:
 *
 *  1. **`undefined` narrows nothing.** No parameter is not a request for the
 *     runs of the empty name.
 *  2. **The padding a paste carries is stripped, BY INK and at the ENDS
 *     only** (`trimInkPadding`). A copy off a log line or a psql column brings
 *     a leading space or a trailing newline, and `?source=%20ticketmaster`
 *     reaches a page as a real space; the operator meant the source whose name
 *     they pasted, and that is what the page then queries AND spells. This is
 *     `canonicalRecordId`'s answer for `?cycle=` and `?run=`
 *     (admin-window/BUG-0145, BUG-0146), now this facet's too.
 *  3. **Nothing with ink left narrows nothing.** `?source=` carrying only
 *     blanks is half a typed URL, not a request for the runs of no name.
 *  4. **A value the app may not SPELL narrows nothing** — `canSpellUrlValue`,
 *     unchanged (admin-window/BUG-0153).
 *  5. **A value a browser would RE-SPELL narrows nothing** — inside printable
 *     ASCII, exactly `RESPELLED` above. Refused, and NOT preserved in a box
 *     carrying `white-space: pre`: that arm is REJECTED by the ruling
 *     (ARCHITECTURE.md §7, `agenticflow/docs/DECISIONS.md` 2026-09-09), because
 *     it would put a non-wrapping foreign run inside six authored sentences of
 *     one page to preserve a spelling no registered source uses, while the
 *     "counted, not spelled" arm the family already built renders nothing new.
 *  6. Otherwise the STRIPPED value is returned.
 *
 * **Step 4 is asked of the value AS THE URL CARRIED IT, and that placement is
 * load-bearing.** `hasVisibleContent`'s ink-less class holds the bidi controls
 * (`\p{Cf}`, `lib/verdict/decision.ts`), so a strip applied first would turn
 * `?source=%E2%80%AEbandsintown` into the spellable `bandsintown` and narrow by
 * it — undoing admin-window/BUG-0153, which rules that such a value is spelled
 * NOWHERE and reported on the dropped-parameter line (BUG-0155 criterion 7,
 * "nothing this family already closed reopens"). The strip is for the PADDING
 * an operator's paste brought, never a laundering step that makes an
 * unspellable value spellable. Asking the allowlist of the carried value is
 * also strictly the stronger question: what it returns is a contiguous
 * substring of that value, so a carried value inside the allowlist has a
 * stripped form inside it too, and a second ask would decide nothing.
 *
 * Two consequences of that placement, named rather than left to be
 * rediscovered. **Inside the allowlist's range the only ink-less character is
 * the space**, so for THIS class the shared strip removes spaces and nothing
 * else; it is still the shared strip, because what padding IS must not be two
 * different things in two value classes (criterion 3), and the uuid class —
 * whose values are not bounded to that range — really does need the wider one.
 * And **padding a browser would drop but this app may not spell is REFUSED,
 * not laundered**: `?source=ticketmaster%0A` narrows nothing and is reported
 * dropped, the same answer the same character gets inside a name. That is the
 * arm the family already renders, and the page never claims a narrowing it did
 * not make.
 *
 * Step 3 is therefore unreachable from step 4's own range today — every
 * `\x21-\x7E` character is ink — and it is stated anyway, so the derivation is
 * total on its own terms rather than on another module's: were the allowlist
 * ever widened, this would still refuse to return a string with no ink in it.
 *
 * **What a caller may rely on**: the return value is its own canonical form
 * (`canonicalUrlText(canonicalUrlText(v)) === canonicalUrlText(v)`), which is
 * what lets a SEAM re-ask the derivation rather than the allowlist —
 * `canonicalUrlText(v) === v` is how a component decides it may render the
 * facet it was handed, so a second caller cannot reintroduce the defect by
 * passing a raw parameter (ARCHITECTURE.md §7; BUG-0155 criterion 8).
 *
 * **Not for a value that reaches PROSE ONLY.** `?cycle=`'s unmatched-paste arm
 * spells a paste in full through the allowlist and queries nothing, so "not
 * among the 200 newest cycles" is true of every spelling of it: it asserts
 * nothing about a queried set, and §7 keeps it out of this rule deliberately
 * (admin-window/BUG-0147).
 */
export function canonicalUrlText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const stripped = trimInkPadding(value);
  if (stripped === "") return null;
  if (!canSpellUrlValue(value)) return null;
  if (RESPELLED.test(stripped)) return null;
  return stripped;
}
