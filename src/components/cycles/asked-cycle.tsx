import { Identifier } from "@/components/ui";
import { count } from "@/lib/format";
import { IN_PAGE_LINK, anchorFor } from "./links";

/**
 * The line a `?cycle=<run_id>` link earns — campaign admin-window/DEBT-0004,
 * moved here whole from `src/app/cycles/page.tsx`.
 *
 * The page decides WHICH of the three states this is (it is the half holding
 * the read); this file renders whichever it is handed.
 */

/**
 * The class of `?cycle=` value this sentence may SPELL: every character is a
 * printable ASCII one, U+0020 through U+007E (campaign admin-window/BUG-0147;
 * ARCHITECTURE.md §7, common violation 15).
 *
 * ARCHITECTURE.md §7: "text this app did not author never sits inside a
 * sentence this app wrote" — it reaches prose THROUGH AN ALLOWLIST or IN ITS
 * OWN BOX, never by scrubbing. The box is here already (`Identifier` renders
 * `dir="ltr"`, admin-window/DEBT-0011), and it contains the reversal ON SCREEN;
 * it does not travel with the text an operator COPIES OUT, which is why
 * admin-window/BUG-0137 chose the allowlist for `/claims`' dropped-parameter
 * line and why this sentence needs one too. Until it had one,
 * `?cycle=<U+202E>not-a-uuid` put an unterminated RIGHT-TO-LEFT OVERRIDE into
 * the app's own 118 characters of prose and into `data-cycle-asked`, so the
 * paragraph copied out of the page read backwards (measured in Chromium, both
 * colour schemes, admin-window/BUG-0146 -> BUG-0147).
 *
 * **Why this allowlist is WIDER than `RENDERABLE_KEY`** (`^[A-Za-z0-9_.-]{1,64}$`,
 * `src/lib/url/dropped-params.ts`) — the two answer the same question about two
 * different things, and each sentence owns its own (that module's own rule,
 * BUG-0137). That one spells a facet NAME, drawn from a vocabulary this app
 * ships; this one spells a VALUE an operator pasted, and BUG-0147's criteria
 * require that an ordinary unmatched paste — `?cycle=not-a-uuid`,
 * `?cycle=../../etc/passwd`, `?cycle=a b c` — is still spelled IN FULL, so the
 * page answers a half-typed URL instead of going quiet. Printable ASCII is
 * still an exact ASCII compare, which is what §7 asks for and what a blocklist
 * can never be: every character in the range is strong-LTR or neutral and none
 * is invisible, so no value that passes can reorder or hollow out the words
 * around it — in the rendered page or in the text copied out of it.
 *
 * Two parts, both exact, because the range holds one character that draws
 * nothing:
 *
 *  - **`PRINTABLE`** — every character is in U+0020..U+007E, bounded at 128.
 *    Bounded because a value spelled verbatim is a line an operator reads: a
 *    record id is 36 characters and an unbounded paste is the next patch on
 *    this sentence.
 *  - **`INK`** — at least one character is U+0021..U+007E. Inside an allowlist
 *    whose only blank is the space, "does a reader see anything" is decidable
 *    by an exact compare, so `?cycle=%20%20` says nothing rather than printing
 *    "Cycle ⟨nothing⟩ is not among the 200 newest cycles" (BUG-0136's family,
 *    answered here without reaching for `hasVisibleContent`, which §7 says is
 *    the edit surface's question and is never widened for a rendering one).
 *
 * Neither regex carries `g`: `test` on a global regex keeps `lastIndex` between
 * calls and would answer the same value differently depending on what came
 * before it.
 */
const PRINTABLE = /^[\x20-\x7E]{1,128}$/;
const INK = /[\x21-\x7E]/;

/**
 * May the page spell THIS `?cycle=` value in the sentence below?
 *
 * The page (`src/app/cycles/page.tsx`) asks this where the value is DERIVED
 * from the request, beside `canonicalRecordId`, and the two answers decide the
 * one derived `askedFor`: a value with a canonical form is spelled canonically,
 * a value this allows is spelled raw, and anything else is spelled NOWHERE —
 * the page renders no sentence about it and the shared dropped-parameter line
 * reports `cycle` as a parameter it did not apply, which is the "counted, not
 * spelled" arm §7 rules and the same answer `?run=` already gives.
 */
export function canSpellAskedCycle(asked: string): boolean {
  return PRINTABLE.test(asked) && INK.test(asked);
}

/**
 * What this page actually knows about the cycle a `?cycle=<run_id>` link asked
 * for. Three states, because the page has three to be honest about — and the
 * third is not a shade of "absent" (admin-window/BUG-0023).
 */
export type AskedCycleState =
  | { kind: "found" }
  | { kind: "absent" }
  /** No window was read at all; `reading` is the object whose read said so. */
  | { kind: "unchecked"; reading: string };

/**
 * The line a visitor who arrived from a `?cycle=<run_id>` link reads.
 *
 * Three answers, one per state: the row is in this window and is marked; it is
 * not in this window — a real possibility, because the table holds the newest
 * cycles and the linked one may be older; or the window was never read, in
 * which case the line says only that, and names the read that returned none.
 *
 * The third answer is the whole of admin-window/BUG-0023. A refused or absent
 * read hands the page NO window, so "this cycle is not in the window" is a
 * verdict it has no evidence for — and on the not-provisioned path it sat
 * directly above the card naming `resolution_runs` as missing, contradicting
 * itself on one screen. The Dashboard's `lineHref` sends an operator here
 * exactly during an outage, so that sentence sent them after a phantom data
 * problem instead of the table the same screen already named. Saying nothing
 * would leave the link looking broken; saying which read failed does not.
 *
 * **What may reach `askedFor`, in all three arms** (admin-window/BUG-0147): a
 * canonical record id, or a value `canSpellAskedCycle` above allows — and
 * nothing else. `/cycles` derives that once (`src/app/cycles/page.tsx`) and
 * renders no sentence at all for a value neither test passes, reporting the
 * facet on the shared dropped-parameter line instead. The gate is repeated
 * here so the rule is structural at the seam where the harm would land rather
 * than a comment about it: a second caller cannot reintroduce §7's defect by
 * handing this component a value the page it lives on would have refused. From
 * `/cycles` the refusal below is unreachable, because the page has already
 * decided the same question with the same predicate.
 */
export function AskedCycle({
  askedFor,
  state,
  limit,
}: {
  /**
   * The cycle the URL asked for, as the page will SPELL it: canonical when the
   * URL carried a record id in any spelling Postgres would have matched, and
   * the raw value only when `canSpellAskedCycle` allows it.
   */
  askedFor: string;
  state: AskedCycleState;
  /** The window's row cap — what "not among the N newest cycles" counts. */
  limit: number;
}) {
  if (!canSpellAskedCycle(askedFor)) return null;
  if (state.kind === "unchecked") {
    return (
      <p
        data-cycle-asked={askedFor}
        data-cycle-unchecked={state.reading}
        className="type-body text-ink-secondary"
      >
        Whether cycle <Identifier>{askedFor}</Identifier>{" "}
        is in this window is not something this page can say: the read of{" "}
        <Identifier>{state.reading}</Identifier>{" "}
        returned no window to look in. What is below says why.
      </p>
    );
  }
  return state.kind === "found" ? (
    <p data-cycle-asked={askedFor} data-cycle-found="true" className="type-body text-ink-secondary">
      Cycle{" "}
      <a href={`#${anchorFor(askedFor)}`} className={`type-data ${IN_PAGE_LINK}`}>
        {askedFor}
      </a>{" "}
      is marked in the table below.
    </p>
  ) : (
    <p data-cycle-asked={askedFor} data-cycle-found="false" className="type-body text-ink-secondary">
      Cycle <Identifier>{askedFor}</Identifier>{" "}
      is not among the {count(limit)} newest cycles, so it is not in this
      window — it ran
      earlier, or no cycle carries that id.
    </p>
  );
}
