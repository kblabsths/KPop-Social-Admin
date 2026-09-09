import { Identifier } from "@/components/ui";
import { count } from "@/lib/format";
import { canSpellUrlValue } from "@/lib/url/spellable";
import { IN_PAGE_LINK, anchorFor } from "./links";

/**
 * The line a `?cycle=<run_id>` link earns — campaign admin-window/DEBT-0004,
 * moved here whole from `src/app/cycles/page.tsx`.
 *
 * The page decides WHICH of the three states this is (it is the half holding
 * the read); this file renders whichever it is handed.
 */

/**
 * The class of `?cycle=` value this sentence may SPELL is not this file's rule
 * and never was: it is `canSpellUrlValue` (`src/lib/url/spellable.ts`), the
 * app's ONE allowlist for a URL value inside app-authored prose
 * (ARCHITECTURE.md §7, common violations row 15).
 *
 * It was declared here as `canSpellAskedCycle` when admin-window/BUG-0147
 * closed this sentence. admin-window/BUG-0153 found the same hole one facet
 * over — `?source=` interpolated as bare text into four clauses of the runs
 * window line — so the predicate moved to a leaf both callers can import
 * rather than being retyped beside the second sentence (LESSONS 5). Every
 * word of WHY it is printable-ASCII-with-ink, and why it is wider than
 * `RENDERABLE_KEY`, lives with it there.
 */

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
 * canonical record id, or a value `canSpellUrlValue` allows — and
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
   * the raw value only when `canSpellUrlValue` allows it.
   */
  askedFor: string;
  state: AskedCycleState;
  /** The window's row cap — what "not among the N newest cycles" counts. */
  limit: number;
}) {
  if (!canSpellUrlValue(askedFor)) return null;
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
