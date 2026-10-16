/**
 * What a URL asked for that the page DID NOT DO — the one owner of that rule,
 * for every route (campaign admin-window/BUG-0141).
 *
 * It was `/claims`' alone (admin-window/BUG-0123) and moved here whole, with
 * nothing changed but the two hard-coded page assumptions it had picked up:
 * the vocabulary it compared against, and the `tab` it skipped by name. FOUR
 * bugs have landed on this one sentence — BUG-0123 (say it at all), BUG-0127
 * (`?=x` names nothing), BUG-0136 (blank is INK, not whitespace), BUG-0137
 * (spell a key only off an allowlist) — so a second route copying it would be
 * born with none of them, which is exactly the class ARCHITECTURE.md's Common
 * violations row 9 promoted to a rule (§13.7). `/queues` renders the same
 * sentence by CALLING this, and `src/lib/claims/filters.ts` re-exports it so
 * `/claims`' callers and tests never learned it moved.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it reaches no database and
 * no `process.env`. **Its one import** is `lib/verdict/decision.ts`, for the
 * app's single definition of blank (BUG-0136) — asked only whether a key names
 * anything at all, never whether a name may be SPELLED (BUG-0137), which is
 * this module's own allowlist's question. That module imports nothing, so the
 * arrow ends there and no cycle can be written through it.
 *
 * It renders nothing: `src/components/ui/dropped-params.tsx` is the one
 * rendering of this answer, as `DroppedParamsLine`.
 */
import { hasVisibleContent } from "@/lib/verdict/decision";

/** A `searchParams` value, in every shape Next can hand one over. */
export type ParamValue = string | string[] | undefined;

/** The `searchParams` object a page awaits. */
export type UrlParams = Record<string, ParamValue>;

/**
 * The narrowing a page APPLIED, as this rule reads it: a key is applied iff
 * its entry is present and not `undefined`.
 *
 * Deliberately a plain string record and not any page's filter type — the rule
 * is about the URL, and this leaf may not know what a claim or a review item
 * is. Every page's filter object satisfies it: the fields are optional strings.
 */
export type AppliedNarrowing = Readonly<Record<string, string | undefined>>;

export interface DroppedParams {
  /** The names, in the order the URL carried them, safe to render verbatim. */
  named: string[];
  /** How many more were dropped whose NAME this app may not put on screen. */
  withheld: number;
}

/**
 * The keys this line may SPELL: the class every name a page could offer
 * satisfies (`bucket`, `source_id`, `domain`, `record_id`, `tab`), and the
 * class in which a key renders as itself, carries no bidi semantics and cannot
 * read as a word it is not. Declared ONCE, here — it is this sentence's rule
 * and no other surface's (admin-window/BUG-0137; ARCHITECTURE.md §7).
 *
 * Bounded at 64 because a name spelled verbatim is a line an operator reads:
 * no facet any page will ever offer is longer than 12 characters, and an
 * unbounded name is the next patch on this sentence. No `g` flag — `test` on
 * a global regex carries `lastIndex` between calls and would answer a key
 * differently depending on which key came before it.
 */
const RENDERABLE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * The parameter a page consumes OUTSIDE its filter, by default.
 *
 * Both routes that carry a tab spell it `tab` (`TAB_PARAM` in
 * `lib/claims/filters.ts` and in `lib/review/queue-filters.ts`), every value
 * of it lands on a real tab, and the tab strip shows which — so the page
 * consumed it and no sentence may claim otherwise. It is the DEFAULT rather
 * than a hard-coded skip so a route with no tab, or with a second consumed
 * parameter, states its own list.
 */
const CONSUMED_BY_DEFAULT: readonly string[] = ["tab"];

/**
 * The parameters carried into this render that narrowed nothing.
 *
 * A parameter outside a page's facets, and a facet value outside the offered
 * vocabulary, both narrow nothing by design (a URL can only select from what
 * the page offers, so a typo lands on a real state rather than an empty one
 * that reads as an empty database). Dropping it is right; dropping it
 * SILENTLY is not — a hand-typed `?record_id=<uuid>` returned 200 under a
 * sentence asserting the rows were filtered, and the operator who did not know
 * the count by heart had nothing to check (`M2-usersim-priya.md` §6). The same
 * silence let `/queues?source_id=<a source>` present another source's item as
 * that source's (admin-window/BUG-0141).
 *
 * Four rules, and they are the whole definition:
 *
 *  - **The question is the APPLIED filter, not the vocabulary.** A facet that
 *    reached `applied` is applied, whatever the URL spelled; one that did not
 *    is dropped, whether its value was unusable or the TAB took the facet away
 *    (Claims' standing tab is one bucket's subset and carries no bucket facet,
 *    so a `?tab=standing&bucket=…` really is a narrowing that page did not do).
 *    `applied` is read by OWN keys only: a URL spelling `?constructor=1` must
 *    not be answered by a prototype's member.
 *  - **A key the page consumed elsewhere is not dropped** — `tab` by default,
 *    the caller's own list otherwise.
 *  - **A key carrying no value asked for nothing** and is not a dropped
 *    narrowing; `?bucket=` is the URL saying nothing, not the page ignoring
 *    something. **A value carrying no key asks for nothing either**
 *    (admin-window/BUG-0127): `?=x` reaches a page as `{"": "x"}` and
 *    `?%20%20=1` as `{"  ": "1"}`, and a query pair is a request only with
 *    both halves — a nameless value names no facet, so there is no narrowing
 *    to have dropped. Counting such a key as `withheld` instead would put "a
 *    parameter this page may not name" on screen, which states a reason that
 *    is not the reason: nothing is withheld, there is no name.
 *
 *    **"Names nothing" is decided by INK, not by whitespace**
 *    (admin-window/BUG-0136). `String.prototype.trim` strips the Unicode
 *    `White_Space` set and nothing else, so `?%E2%80%8B=1` (ZERO WIDTH SPACE),
 *    `?%00=1`, `?%C2%AD=1`, `?%E2%81%A0=1`, `?%E2%80%8E=1` and `?%7F=1` all
 *    survived it and were spelled into the mono span, where a browser laid
 *    every one of them out at 0px and the sentence read with the same hole
 *    (measured in Chromium, both colour schemes, 2026-09-09). The test is the
 *    app's ONE definition of blank — `hasVisibleContent` — so a key a reader
 *    would see nothing of names nothing, whichever family its codepoints come
 *    from. Where that definition draws the line is its ruling, not this
 *    module's; this gate decides only whether a parameter was DROPPED, never
 *    whether its name may be spelled, which is the next rule's question.
 *
 *  - **A surviving key is SPELLED only if it is on the renderable allowlist**
 *    `RENDERABLE_KEY` above, and every other one is COUNTED
 *    (admin-window/BUG-0137; ARCHITECTURE.md §7, "text this app did not author
 *    never sits inside a sentence this app wrote"). No character outside
 *    `[A-Za-z0-9_.-]` reaches this sentence by any path: not a nonspacing mark
 *    that lays out at 0px, not U+2800, not U+202E — whose scope is the
 *    paragraph and not the span, so a key carrying one reversed the rest of
 *    the app's own sentence, in the rendered page and in the text copied out
 *    of it. And no key can READ as a parked word without BEING it. Both
 *    questions ("does this render ink", "does this read as that word") are
 *    undecidable by codepoint class — three blocklist widenings on this one
 *    line proved it — and an exact ASCII compare answers them together.
 *
 *    The test is on the key's RAW characters, never on `visibleContent(key)`:
 *    what the line spells is then byte-identical to what the URL carried
 *    (spec §11), because the two are the same string.
 *
 * `neverNamed` is the small set of words the app may not put on screen at all
 * — `/claims`' parked bucket (`UNRENDERABLE_BUCKET`, `lib/db/claims.ts`;
 * LOOK_AND_FEEL bar 3) — which a URL may perfectly well use as a KEY. It is
 * handed in rather than imported because this module is a pure domain leaf and
 * may not reach `lib/db/**`. Such a parameter is still COUNTED: the page says
 * it dropped one without spelling it, which is bar 3 and bar 13 both kept.
 * `/queues` has no unrenderable word and passes an empty list.
 */
export function droppedParams(
  params: UrlParams = {},
  applied: AppliedNarrowing = {},
  neverNamed: readonly string[] = [],
  consumed: readonly string[] = CONSUMED_BY_DEFAULT,
): DroppedParams {
  const named: string[] = [];
  let withheld = 0;
  for (const key of Object.keys(params)) {
    if (consumed.includes(key)) continue;
    // A key with nothing a reader could see in it names nothing, so it asked
    // for nothing — the empty-value rule from the other side, and the whole
    // of it: blank is ink, not whitespace (admin-window/BUG-0136). The one
    // thing this line may never do is spell a name that is not there.
    if (!hasVisibleContent(key)) continue;
    const asked = firstValue(params[key]);
    if (asked === undefined || asked === "") continue;
    if (Object.hasOwn(applied, key) && applied[key] !== undefined) continue;
    // A parameter WAS dropped; the only question left is whether the page
    // may spell its name. It may, for a key on the renderable allowlist that
    // is not a word the app may never render — and for nothing else. Both
    // arms report the same fact; one names it and one counts it.
    if (!RENDERABLE_KEY.test(key) || neverNamed.includes(key)) withheld += 1;
    else named.push(key);
  }
  return { named, withheld };
}

/**
 * The FIRST value the URL carries for a key — the same rule every page's own
 * reader applies, so "was this dropped?" is asked of the value the page would
 * have used. `URLSearchParams.get()` answers a repeated key the same way.
 */
function firstValue(value: ParamValue): string | undefined {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value;
}
