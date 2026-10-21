import type { ReactNode } from "react";

import { Identifier } from "@/components/ui";
import type { ActionSpec, ShapeActionsInput } from "./actions";

/**
 * The source-pattern SIGNAL item's two dispositions — campaign
 * admin-window/TASK-0051, spec §7, SPEC F10.
 *
 * A signal takes no verdict: it closes with a disposition. `fixed` — the
 * breakage was addressed elsewhere, on the surface that owns it (a tier move,
 * a source pause, a dial change); this app does not perform that fix and
 * offers no control for it, it records that it happened. Or `wont_fix` — the
 * condition stands — **on which the note is required**: why it stands. Either
 * way the item settles and the `verdicts` row carries the disposition.
 *
 * **Two, and no third.** There is no "reopen", no "snooze" and no "escalate"
 * here: the eight action names are the whole vocabulary (ARCHITECTURE.md
 * §9.2) and a signal owns exactly these two of them.
 *
 * **Neither carries a value.** Both are settle-only, so `value` is null and
 * `decisionRefusals` invariant 4 refuses a payload on either — which is also
 * why neither is drawn `destructive`: that variant is for a settlement that
 * writes canonical, and a disposition writes nothing but the item's own
 * status and its verdict row.
 *
 * **The note guard is the frame's, not this module's.** `closeRefusal`
 * (`actions.ts`) refuses a blank note for any action `noteRequired` names, so
 * the form sends nothing; the route's `decisionRefusals` refuses the same case
 * again; and `settle_review_item` raises on it. Three guards, deliberately, so
 * this module states the actions and nothing about validation — a fourth,
 * local copy of the rule is how the three would drift.
 *
 * **This list is not a claim that a settlement can be made.** Whether any
 * control renders at all is `readSettlementReadiness`' answer, taken in
 * `slot.tsx`: against a database without `verdicts` (which databases those
 * are is ARCHITECTURE.md §9.2's to say) the slot draws the not-provisioned
 * card and this list is never rendered. No control here would ever call a function this
 * database does not have, and nothing here queues, buffers or works around one
 * (spec §10's one forbidden move).
 *
 * A module of its own so the three shapes can be built in parallel from
 * isolated worktrees without landing in one file (ARCHITECTURE.md §13.9).
 */

/**
 * The operator's word for each disposition — a verb plus its object, naming
 * what gets written (LOOK_AND_FEEL copy bar 1, whose own examples these are).
 *
 * The machine's names (`fixed`, `wont_fix`) are NOT prettified into these:
 * they travel as the spec's `action` and the control renders them verbatim in
 * mono beside the label (copy bar 5, §11), so the word on the button, the word
 * in the settled state and the word in the verdict log are one word
 * (copy bar 2).
 */
const FIXED_LABEL = "Mark fixed";
const WONT_FIX_LABEL = "Close as won’t fix";

export function dispositionActions(input: ShapeActionsInput): readonly ActionSpec[] {
  // Neither disposition is a function of the evidence or of the item: a signal
  // closes the same two ways whatever it folded. The input is the shared
  // contract's, and this shape reads none of it.
  void input;

  return [
    { label: FIXED_LABEL, action: "fixed", value: null },
    { label: WONT_FIX_LABEL, action: "wont_fix", value: null },
  ];
}

/**
 * WHAT THIS CLOSE CANNOT DO, said plainly — campaign admin-window, Ben
 * 2026-10-21.
 *
 * The shape's notice was `() => null`, documented as "the signal item names no
 * fact at all and withholds nothing, so its null is the one that is not a
 * placeholder." That was wrong about the one thing that matters. These items
 * ask a question — *"ticketmaster \"TEN\": 3 catalog names match closely, none
 * exactly (Ten, Ten, Ten-X) — which one is this, or none of them"* — and the
 * close offers two dispositions that cannot answer it.
 *
 * It is not a missing control. `settle_review_item` can record a reference
 * link for exactly one field in the whole registry, `events.venue`, and the
 * catalog domains these items are about (`groups`, `idols`) are not registered
 * domains at all. A picker here would have its answer refused with KS029, and
 * a control that cannot be honoured is the one thing SPEC F10 forbids.
 *
 * So the notice says so. The operator is told what the buttons record and what
 * they do NOT, rather than being left to discover that "Mark fixed" quietly
 * discarded the judgment they came here to give. The fix is filed at
 * `agenticflow/tracker/for-human/2026-10-21-the-answer-has-nowhere-to-go.md`
 * and is a migration in the scraper repo, which is Ben's.
 *
 * **Delete this notice the day the link lands.** It describes a gap, not a
 * rule, and a notice that outlives its gap is a lie with a long tail.
 */
export function patternNotice(input: ShapeActionsInput): ReactNode {
  void input;
  return (
    <>
      This app cannot record which catalog row this name is: the verdict
      function links one reference field (<Identifier>events.venue</Identifier>
      ) and the catalog domains are not registered. Neither button below
      answers the question — they record only that the condition was handled
      elsewhere, or that it stands.
    </>
  );
}
