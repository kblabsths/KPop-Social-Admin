/**
 * **May this app SPELL a value the URL carried, inside a sentence it wrote
 * itself?** — one predicate, for every facet of every route
 * (ARCHITECTURE.md §7, common violations row 15).
 *
 * §7's rule: "text this app did not author never sits inside a sentence this
 * app wrote" — foreign text reaches prose THROUGH AN ALLOWLIST or IN ITS OWN
 * BOX, never by scrubbing. The box (`Identifier` renders `<span dir="ltr">`,
 * admin-window/DEBT-0011) contains a reversal ON SCREEN and travels nowhere
 * with the text an operator COPIES OUT, which is why admin-window/BUG-0137
 * chose the allowlist for `/claims`' dropped-parameter line, BUG-0147 for
 * `/cycles`' `?cycle=` sentence, and admin-window/BUG-0153 for its `?source=`
 * facet — the five bugs of one family.
 *
 * **It lives here because it was `canSpellAskedCycle` in
 * `src/components/cycles/asked-cycle.tsx` and a second facet needed the same
 * answer** (admin-window/BUG-0153). A rule in prose is retyped and the copies
 * drift (LESSONS 5; ARCHITECTURE.md common violations row 9): this is the ONE
 * declaration, imported by the `?cycle=` sentence's seam gate and by
 * `canonicalUrlText` (`./text.ts`), the free-text class's ONE derivation,
 * where a `?source=` becomes both a query value and four clauses of the runs
 * window line.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it imports nothing, reaches
 * no database and no `process.env`, so every layer may ask it.
 *
 * **Why it is WIDER than `RENDERABLE_KEY`** (`^[A-Za-z0-9_.-]{1,64}$`,
 * `./dropped-params.ts`) — the two answer the same question about two
 * different things, and each sentence owns its own (that module's own rule,
 * BUG-0137). That one spells a facet NAME, drawn from a vocabulary this app
 * ships; this one spells a VALUE an operator pasted, and both BUG-0147's and
 * BUG-0153's criteria require that an ordinary unmatched paste —
 * `?cycle=not-a-uuid`, `?cycle=../../etc/passwd`, `?cycle=a b c`,
 * `?source=a-source-the-registry-never-heard-of` — is still spelled IN FULL,
 * so the page answers a half-typed URL instead of going quiet.
 *
 * Printable ASCII is still an exact ASCII compare, which is what §7 asks for
 * and what a blocklist can never be: every character in the range is
 * strong-LTR or neutral and none is invisible, so no value that passes can
 * reorder or hollow out the words around it — in the rendered page, in a
 * `data-` attribute, or in the text copied out of either.
 *
 * Two parts, both exact, because the range holds one character that draws
 * nothing:
 *
 *  - **`PRINTABLE`** — every character is in U+0020..U+007E, bounded at 128.
 *    Bounded because a value spelled verbatim is a line an operator reads: a
 *    record id is 36 characters, the longest source name the registry carries
 *    is shorter, and an unbounded paste is the next patch on these sentences.
 *  - **`INK`** — at least one character is U+0021..U+007E. Inside an allowlist
 *    whose only blank is the space, "does a reader see anything" is decidable
 *    by an exact compare, so `?cycle=%20%20` says nothing rather than printing
 *    "Cycle ⟨nothing⟩ is not among the 200 newest cycles" (BUG-0136's family,
 *    answered here without reaching for `hasVisibleContent`, which §7 says is
 *    the edit surface's question and is never widened for a rendering one —
 *    LESSONS 4, "a predicate answering two different questions gets widened by
 *    whichever one broke last").
 *
 * Neither regex carries `g`: `test` on a global regex keeps `lastIndex`
 * between calls and would answer the same value differently depending on what
 * came before it.
 */
const PRINTABLE = /^[\x20-\x7E]{1,128}$/;
const INK = /[\x21-\x7E]/;

/**
 * May a sentence this app wrote spell this URL value verbatim?
 *
 * Asked where the value is DERIVED from the request — inside one of the app's
 * two canonicalisers (`canonicalRecordId`, `canonicalUrlText`) or at a seam
 * that re-asks one of them — so ONE derived value decides the sentence, the
 * narrowing and the dropped-parameter line together: a page can then never
 * both answer a parameter and report it as dropped, nor silently drop one it
 * never named. A value this refuses is spelled NOWHERE and is reported on the
 * shared dropped-parameter line, which is the "counted, not spelled" arm §7
 * rules.
 *
 * **It answers "may I spell it" and NOT "is this what I used"** (§7, common
 * violations row 20; admin-window/BUG-0155). It admits `" ticketmaster"`,
 * which a browser then re-spells as `ticketmaster` in every sentence naming it
 * while the query still carried the space — a predicate over one string cannot
 * see that, and widening this one to try would be a predicate answering two
 * questions (LESSONS 4). The second question belongs to the DERIVATION that
 * calls this, one per value class.
 */
export function canSpellUrlValue(value: string): boolean {
  return PRINTABLE.test(value) && INK.test(value);
}
