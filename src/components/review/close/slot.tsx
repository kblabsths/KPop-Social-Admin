import type { ReactNode } from "react";
import { IN_PAGE_LINK } from "@/components/cycles/links";
import { Empty, Eyebrow, Identifier, StateOf, type UnavailableRead } from "@/components/ui";
import { EM_DASH, clamped, isAbsent, orDash, relativeAge } from "@/lib/format";
import type { ReviewItemRow, Shape } from "@/lib/review/shapes";
import type { ActionSpec, ShapeActions, ShapeActionsInput } from "./actions";
import { conflictActions, conflictNotice } from "./conflict-actions";
import { CloseForm } from "./form";
import { linkActions, linkNotice } from "./link-actions";
import { dispositionActions } from "./signal-actions";

/**
 * **The close** — the last part of a review item's anatomy (spec §6 step 3,
 * §7; campaign admin-window/TASK-0049). M1 rendered its SPACE and settled
 * nothing; this is the frame every §7 action lands in.
 *
 * A pure synchronous component over plain props (ARCHITECTURE.md §5): the page
 * is the route's only async boundary, so it reads and shapes, and this
 * renders. What it renders is decided by ONE question — may this surface offer
 * a settlement at all? — answered by `readSettlementReadiness`
 * (`src/lib/db/verdict.ts`), which reads the presence of the table the verdict
 * log lives in and never calls the function to find out (ARCHITECTURE.md §9.2,
 * DECISIONS 2026-09-08).
 *
 * **The absent answer is the NORMAL one and is graded first.** Neither that
 * table nor `settle_review_item` exists on staging or in production, and
 * neither will until Ben installs M2's handoff migrations — that is the
 * database `main` deploys against for the whole milestone. So the first branch
 * below is the one that runs today: the not-provisioned card, naming the
 * object the read named, with **no control of any kind** — no disabled button,
 * no form, no note field standing in for one. A control that would call a
 * missing function is exactly what this branch exists to not offer.
 *
 * **There is no Admin-side workaround for the absent function** (spec §10's
 * one forbidden move): no queued write, no pending-overrides table, no retry
 * buffer, no flag-guarded direct write. The surface degrades to what M1 ships,
 * with the reason named, and that is the whole of the answer.
 *
 * **A SETTLED item's own verdict renders here** (spec F13's second half,
 * campaign admin-window/TASK-0059), in the place a control would stand: the
 * investigation ends where the decision was made rather than sending the
 * operator to the log tab to find out what they themselves decided. It is a
 * sub-surface of its own (`ITEM_VERDICT_SURFACE`) because its state comes from
 * a different read, and an UNSETTLED item renders no verdict block at all.
 *
 * **The recommendation slot renders nothing** and is not here at all: its
 * producer is parked (spec §6), so the words `recommend` and `recommendation`
 * appear nowhere in this detail's markup.
 */

/**
 * Which shape's actions a review item gets — the map, and the only place a
 * shape is turned into an action list (spec §7's three shapes,
 * ARCHITECTURE.md §13.9).
 *
 * A `Record<Shape, …>`, like `EVIDENCE_VIEW_BY_SHAPE` beside it, so a fourth
 * shape fails to COMPILE rather than falling through to another shape's
 * actions (§6 trap 11). Nothing here re-derives a shape: `shapeOf` in
 * `src/lib/review/shapes.ts` is the app's one spelling of that, and the page
 * hands the result in.
 *
 * It lives in this module and not in `actions.ts` because the three shape
 * modules import that one: a map there would import them back and write a
 * cycle into the contract. It is called on the SERVER — the page builds the
 * list — which is also why neither this module nor a shape module may become
 * a client module (`form.tsx` is the one that is, and it takes plain data).
 */
export const ACTIONS_BY_SHAPE: Record<Shape, ShapeActions> = {
  data_conflict_fact: conflictActions,
  entity_link_fact: linkActions,
  entity_link_source_pattern: dispositionActions,
};

/**
 * A shape's answer to "what is NOT offered here, and why" — a line, or null
 * when everything spec §7 lists for this shape is on screen.
 *
 * The second half of the map above, and it exists for one case: a
 * `data_conflict` on a `kind: reference` field, whose free-text control is
 * withheld because a reference links rows rather than carrying text
 * (campaign admin-window/BUG-0087, spec §8). A withheld control that says
 * nothing is a shorter list with no reason — the same silent absence the rest
 * of this window renders rather than blanks.
 *
 * A `Record<Shape, …>` for the reason `ACTIONS_BY_SHAPE` is one: a fourth
 * shape fails to COMPILE rather than falling through to another shape's line.
 * The `entity_link` FACT item answers one too (`linkNotice`, campaign
 * admin-window/TASK-0056): its picker is withheld wherever the item names no
 * whole reference or the rows behind it could not be read, which is the
 * ordinary state of an item opened before the canonical row exists. The signal
 * item names no fact at all and withholds nothing, so its null is the one that
 * is not a placeholder.
 */
export type ShapeNotice = (input: ShapeActionsInput) => ReactNode;

export const NOTICE_BY_SHAPE: Record<Shape, ShapeNotice> = {
  data_conflict_fact: conflictNotice,
  entity_link_fact: linkNotice,
  entity_link_source_pattern: () => null,
};

/**
 * What an item that is already closed says, instead of a control that cannot
 * work.
 *
 * A settled item stays browsable (spec §4), so its detail renders like any
 * other — but offering it a settle control would offer an action the function
 * would refuse. The status is the machine's own word and renders verbatim in
 * mono (§11). WHICH verdict settled it stands directly below, rendered by
 * `SettledVerdict` (campaign admin-window/TASK-0059) — this line claims
 * nothing about it, so an item whose verdict this app could not read still
 * reads truthfully.
 */
function SettledItem({ status }: { status: string }) {
  return (
    <p className="type-body text-ink-secondary" data-close-item-status={status}>
      This item is already{" "}
      <Identifier>{status}</Identifier>. There is nothing
      left to close.
    </p>
  );
}

/* ── the verdict a settled item was settled with ─────────────────────────── */

/**
 * The graded name of the inline verdict — its own `data-surface`, INSIDE the
 * close (campaign admin-window/TASK-0059).
 *
 * It is a sub-surface for the reason `/queues`' `verdict_provenance` and the
 * evidence view's dial are: its state belongs to a DIFFERENT read from the
 * close's own. The close's question is "may a settlement be offered at all"
 * (`readSettlementReadiness`); this one's is "which verdict settled this
 * item" (`readItemVerdict`), and an item settled with no row on record is not
 * a close that failed. An oracle grading the close excludes this selector and
 * grades it on its own, exactly as `tests/live/review-item.live.test.ts`
 * already excludes `[data-dial]` from the evidence.
 */
const ITEM_VERDICT_SURFACE = "item_verdict";

/**
 * One settled item's verdict, as the detail renders it — the page shapes, this
 * renders (ARCHITECTURE.md §5).
 *
 * Declared structurally rather than imported from `lib/db`, exactly as
 * `readiness` is: a component never imports the data layer (§4 rule 1).
 */
export interface InlineVerdict {
  /**
   * `verdicts.action`, verbatim — a machine identifier, in mono, never
   * prettified and never uppercased (§11, LESSONS 5).
   */
  readonly action: string;
  /** Who decided. */
  readonly actor: string;
  /** The admin's why, at their discretion — absent is the ordinary case. */
  readonly note: string | null;
  /** When it was decided. */
  readonly createdAt: string;
  /** The observation this verdict wrote. Null on a settle-only verdict. */
  readonly observationId: string | null;
  /**
   * The record surface of the fact that observation is about, when this app
   * could resolve it — the one place a rendered observation already leads
   * (`components/queues/verdict-log.tsx`, `components/claims/claim-list.tsx`).
   */
  readonly observationHref: string | null;
}

/**
 * What the detail knows about the verdict, as plain data.
 *
 * `ok` with `verdict: null` is the honest gap the log's table is there and
 * holds no row for this item; the unavailable arms are the read refusing or
 * the object being absent. They are DIFFERENT states and render differently —
 * "renders X but not the absence of X" is LESSONS 1, and an empty block on a
 * settled item would be exactly it.
 */
export type CloseVerdict =
  | {
      kind: "ok";
      verdict: InlineVerdict | null;
      /** The observation leg's own refusal, reported beside the verdict. */
      factUnavailable: UnavailableRead | null;
    }
  | UnavailableRead;

/**
 * What an em dash means in this block, said once (LESSONS 1: "a column of
 * dashes carries one line saying what a dash means").
 *
 * Rendered exactly when a dash is actually on screen, whichever line drew it
 * (campaign admin-window/BUG-0092) — a sentence explaining a character the
 * operator cannot see is noise, and the block is one verdict rather than the
 * log's column of them, so the line is conditional where the log tab's is
 * unconditional. The condition is EVERY dashable line, not the two structural
 * ones: a dash on the actor or on an instant that will not parse is still a
 * dash the operator has to read.
 *
 * Which is also why it does not repeat the log tab's "not missing data": two
 * of these dashes are the record doing its job (a note is at the admin's
 * discretion, a settle-only verdict observed nothing) and two are a value this
 * row could not give, so the one sentence says what is true of all four.
 */
const DASH_MEANS =
  `A ${EM_DASH} is a value this verdict does not carry: an admin may settle ` +
  "without a note, and a settle-only verdict writes no claim.";

/** What a settled item with no verdict row on record says, in its own words. */
const NO_VERDICT_ROW = {
  holds: "verdict on record for this item",
  filledBy:
    "The item is settled, so something settled it — but the log holds no " +
    "row saying what. The record of this decision is missing, not the log.",
};

/** One labelled line of the verdict: what it is called, and what it says. */
function VerdictLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-2">
      {/* The space between the label and the value is a REAL text node, never
          the flex gap: everything that reads text — an accessible name, a
          parity reader, a user-sim — is blind to a gap, which is how
          `stuck_patterndial` reached a screen (admin-window/BUG-0045). It is
          an expression container so no JSX transform may drop it, and a
          whitespace-only anonymous flex item is not laid out, so the rendering
          is exactly the gap's. */}
      <Eyebrow label={label} />{" "}
      <span className="type-body text-ink">{children}</span>
    </p>
  );
}

/**
 * The verdict itself — the action verbatim in mono, who decided, their note,
 * when, and where the observation it wrote landed (spec F13).
 *
 * Every absence goes through the app's one dash, and every one of them is
 * asked BEFORE the element is built: a cell body that is an ELEMENT is never
 * absent to `orDash`, which is the shape that left a blank note in the log
 * (admin-window/BUG-0085). `isAbsent` — not `=== null` — because it trims: a
 * note that is present but whitespace is an absence everywhere else here.
 *
 * The observation id is rendered VERBATIM and unlinked when this app could not
 * resolve where it leads: the verdict really does carry it, so a dash there
 * would claim it observed nothing, which is a different verdict.
 */
function ItemVerdictBlock({ verdict }: { verdict: InlineVerdict }) {
  const age = relativeAge(verdict.createdAt);
  // An instant this app cannot read answers `{ text: EM_DASH, title: "" }`
  // (`relativeAge`, `lib/format.ts`), and rendering that text puts a BARE em
  // dash on screen — outside the one dash element this app draws absences
  // with. It is handed over as null instead, so `orDash` draws it, which is
  // exactly what the sibling rendering of the SAME column does
  // (`components/queues/verdict-log.tsx`, `created`): one column, one
  // rendering, on both screens (campaign admin-window/BUG-0092).
  const when = age.title === "" ? null : age;
  const actor = isAbsent(verdict.actor) ? null : verdict.actor;
  const wrote = isAbsent(verdict.note) ? null : (verdict.note as string);
  const note = wrote === null ? null : clamped(wrote);
  const observation = isAbsent(verdict.observationId)
    ? null
    : (verdict.observationId as string);
  // Whether a dash reaches the screen at all, asked once over EVERY line that
  // can draw one — the block explains the dashes it draws, and it draws four
  // kinds, not two (campaign admin-window/BUG-0092). An unresolvable
  // observation id is not among them: it renders verbatim, never dashed.
  const dashOnScreen = [actor, note, when, observation].some(
    (value) => value === null,
  );

  return (
    <div data-item-verdict={verdict.action} className="flex flex-col gap-2">
      <VerdictLine label="settled with">
        <Identifier data-verdict-action={verdict.action}>
          {verdict.action}
        </Identifier>
      </VerdictLine>

      <VerdictLine label="by">
        <span data-verdict-actor={actor ?? undefined}>{orDash(actor)}</span>
      </VerdictLine>

      <VerdictLine label="note">
        <span title={note?.title} data-verdict-note={wrote ?? undefined}>
          {orDash(note?.text ?? null)}
        </span>
      </VerdictLine>

      <VerdictLine label="when">
        {when === null ? (
          orDash(null)
        ) : (
          <span title={when.title} data-verdict-when={verdict.createdAt}>
            {when.text}
          </span>
        )}
      </VerdictLine>

      <VerdictLine label="observation id">
        {observation === null ? (
          orDash(null)
        ) : verdict.observationHref === null ? (
          <Identifier data-verdict-observation={observation}>
            {observation}
          </Identifier>
        ) : (
          <a
            href={verdict.observationHref}
            data-verdict-observation={observation}
            className={`type-data ${IN_PAGE_LINK}`}
          >
            {observation}
          </a>
        )}
      </VerdictLine>

      {dashOnScreen ? (
        <p data-absence-note="dash" className="type-body text-ink-secondary">
          {DASH_MEANS}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The inline verdict, in whichever of its states this database put it
 * (campaign admin-window/TASK-0059, spec F13's second half).
 *
 * The wrapper carries the sub-surface name in EVERY state, so an oracle that
 * excludes this block from the close's own grading reaches whichever card
 * rendered rather than only the happy one.
 *
 * A read that refused, and a table that is not here, come out as the app's one
 * pair of cards through `StateOf` — never as a blank slot. `ok` with no row is
 * the third, different state, and it draws `Empty`: the log answered and holds
 * nothing for this item, which is a gap in the DATA and not an absent object.
 * The two are told apart structurally by `data-state`, never by their words
 * (ARCHITECTURE.md §10, admin-window/TASK-0032).
 */
function SettledVerdict({ verdict }: { verdict: CloseVerdict }) {
  return (
    <div data-surface={ITEM_VERDICT_SURFACE}>
      {verdict.kind !== "ok" ? (
        <StateOf result={verdict} />
      ) : verdict.verdict === null ? (
        <Empty holds={NO_VERDICT_ROW.holds} filledBy={NO_VERDICT_ROW.filledBy} />
      ) : (
        <>
          <ItemVerdictBlock verdict={verdict.verdict} />
          {verdict.factUnavailable === null ? null : (
            // The observation leg alone refused: the verdict is here and only
            // the link to where its observation landed is missing, so the
            // refusal names its own object beside it rather than replacing a
            // verdict this app read perfectly well (admin-window/BUG-0021).
            <StateOf result={verdict.factUnavailable} />
          )}
        </>
      )}
    </div>
  );
}

export function CloseSlot({
  item,
  readiness,
  actions,
  notice = null,
  verdict,
}: {
  /** The item being closed — its id addresses the route, its status decides. */
  item: ReviewItemRow;
  /**
   * May a settlement be offered? The result of `readSettlementReadiness`,
   * handed down as plain data: `ok` and the surface may offer one, and the two
   * unavailable arms render as the state they are.
   *
   * Declared structurally rather than imported from `lib/db`, exactly as
   * `StateOf` declares `UnavailableRead` — a component never imports the data
   * layer (ARCHITECTURE.md §4 rule 1).
   */
  readiness: { kind: "ok" } | UnavailableRead;
  /** This shape's controls, from `ACTIONS_BY_SHAPE`. Empty is a real answer. */
  actions: readonly ActionSpec[];
  /**
   * What this shape withholds and why, from `NOTICE_BY_SHAPE` — null on every
   * item that is offered the whole of its shape's §7 actions, which is all of
   * them but a conflict on a reference field.
   */
  notice?: ReactNode;
  /**
   * The verdict this item was settled with — `readItemVerdict`'s result,
   * narrowed by the page into plain data (campaign admin-window/TASK-0059).
   *
   * `null` (or omitted) means **no such read happened**, and the block renders
   * nothing at all: an OPEN item was settled by nothing, and a database
   * without the log has no row to hold one — the close already says so, in one
   * card, above. An empty verdict block on an open item is the "renders X but
   * not the absence of X" defect LESSONS 1 is about, from the other side.
   */
  verdict?: CloseVerdict | null;
}) {
  if (readiness.kind !== "ok") {
    // The graded-first state, and the whole of what this slot renders today:
    // the card names the object the read named, and offers nothing.
    return <StateOf result={readiness} />;
  }

  if (item.status === "settled") {
    return (
      <>
        <SettledItem status={item.status} />
        {verdict === undefined || verdict === null ? null : (
          <SettledVerdict verdict={verdict} />
        )}
      </>
    );
  }

  return (
    <>
      {actions.length === 0 ? (
        // Truthful, and deliberately not an `Empty` card: nothing about the
        // READ was empty — it answered, and this app simply offers this shape
        // no action yet. A state card here would say the database was empty,
        // which is a different claim (LOOK_AND_FEEL: the three emptinesses
        // never share a rendering).
        <p className="type-body text-ink-secondary">
          No verdict action is offered for this item yet.
        </p>
      ) : null}
      {/* Above the controls, because it is the reason the list below is the
          length it is. It is not a state card: nothing was unread and nothing
          was empty (LOOK_AND_FEEL: the emptinesses never share a rendering). */}
      {notice}
      <CloseForm reviewItemId={item.review_item_id} actions={actions} />
    </>
  );
}
