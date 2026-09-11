import type { ReactNode } from "react";

import type { AccountSegment } from "@/lib/account/authored";
import {
  Empty,
  ErrorLine,
  Loading,
  NotProvisioned,
  type MicroLabel,
} from "@/components/ui";

/**
 * The four mandatory data-surface states, as one prop every gauge component
 * takes (campaign admin-window/TASK-0008).
 *
 * Authority: LOOK_AND_FEEL ("the four states, mandatory on every data
 * surface") and ARCHITECTURE §7 ("the four data-surface states are four named
 * primitives … a page that hand-rolls an empty state is a defect"). Nothing
 * here draws anything itself: each arm is one `ui` primitive.
 *
 * The kinds are spelled as `lib/db/result.ts` spells them, so a page maps a
 * `DbResult` onto a gauge without a translation table — `not_provisioned`
 * carries the object name the query used, `error` carries the read it was
 * making and the database's own words.
 *
 * **A gauge component never imports `lib/db`.** This union is the seam: the
 * page does the reading, narrows the result, and hands a plain object down
 * (ARCHITECTURE §5 — the page function is the only async component).
 */
/**
 * The words an empty surface is named with: what it would hold, and the one
 * thing that fills it (LOOK_AND_FEEL, Voice bar 4 — never a bare "No data").
 *
 * Defined once and shared by the `empty` state and by the REQUIRED `empty`
 * prop of `TrendTable`/`Distribution`, so the two spellings of the same
 * sentence cannot drift apart (admin-window/TASK-0030).
 *
 * Both halves are NODES, the widening `ui/Empty` already made for its own two
 * props: a caller whose sentence names a machine identifier — a facet, a
 * value the URL narrowed by — sets that one word in the app's identifier face
 * rather than as bare prose (LOOK_AND_FEEL Voice bar 5, LESSONS 6;
 * admin-window/BUG-0120, admin-window/BUG-0163). A plain string is still a
 * node, so every caller that passes one renders exactly what it rendered
 * before: nothing here wraps either half in an element of its own.
 */
export type EmptyWords = { holds: ReactNode; filledBy: ReactNode };

export type GaugeState =
  | { kind: "loading"; what: string }
  | ({ kind: "empty" } & EmptyWords)
  | { kind: "not_provisioned"; missing: string; arrivesWith: string }
  | {
      kind: "error";
      reading: string;
      failed: string;
      /**
       * The account's runs and who wrote them (admin-window/BUG-0196), carried
       * from the `DbResult` arm the page narrowed. Optional, and its absence
       * means the whole account is the machine's — which is what a gauge state
       * this app composed itself carries.
       */
      authored?: readonly AccountSegment[];
      retry: string;
    };

/** The two states that are CARDS, and so replace the surface. */
export type GaugeSurfaceState = Extract<
  GaugeState,
  { kind: "empty" } | { kind: "not_provisioned" }
>;

/** The two states that are LINES, and so render inside the surface. */
export type GaugeLineState = Exclude<GaugeState, GaugeSurfaceState>;

/**
 * Does this state replace the surface, or sit inside it?
 *
 * `Empty` and `NotProvisioned` are surface cards with their own border, so
 * they render **in place of** the table or card — a card inside a table's own
 * border would draw two borders (`ui/data-table.tsx`). `Loading` and
 * `ErrorLine` are single lines, so they render inside, and the header stays
 * put while a read is in flight. One rule, stated once, obeyed by all three
 * gauge components.
 */
export function stateReplacesSurface(state: GaugeState): state is GaugeSurfaceState {
  return state.kind === "empty" || state.kind === "not_provisioned";
}

/**
 * The state that stands in for the whole surface. Gray for not-provisioned,
 * never red and never a zero that reads like data: a missing table is
 * unavailable, not broken.
 *
 * **The card carries `data-gauge-block`, and this is its ONE emitter**
 * (admin-window/BUG-0169; DECISIONS 2026-09-10, ARCHITECTURE §10 — a surface's
 * state is the state of the read behind its FIGURES, and a state card rendered
 * by a block INSIDE it belongs to that block).
 *
 * `Distribution` and `TrendTable` replace themselves with this card whenever
 * they hold no row (ARCHITECTURE §7: `rows: []` with no stated reason is
 * unwritable and a headers-only table is unreachable), so a gauge whose
 * figures count a real 0 still draws empty cards beside them. A live oracle
 * reads every `[data-state]` card inside the surface it grades, which made one
 * block's honest emptiness the whole surface's state and stopped the parity
 * assertions running in exactly that case. The marker is what lets such an
 * oracle say "this card is the block's, not the surface's"
 * (`stateOf`'s `excluding`, the device `/queues` already uses for
 * `[data-gauge-queue]`).
 *
 * It cannot silence a REFUSAL, which is the whole reason it lives in exactly
 * one place: a surface-level not-provisioned or error state is rendered by
 * `ui/StateOf`, which does not call this component and so carries no marker
 * (admin-window/BUG-0036's failure mode — an exclusion that swallowed a
 * surface's own error line and graded a broken page `ok`).
 */
export function GaugeStateCard({
  state,
  label,
}: {
  state: GaugeSurfaceState;
  /**
   * The gauge's own `micro` label, carried onto the card as its eyebrow.
   * Required, and never optional: this card stands in for the WHOLE gauge, so
   * without it a screen of empty or unprovisioned gauges tells the operator
   * which tables are missing but not which knob each one tunes. Every gauge
   * component already requires a `label`, so no caller is asked for a new word
   * (ARCHITECTURE §7, admin-window/TASK-0030). A machine identifier travels as
   * `{ identifier, words }` and keeps its case and mono face here too
   * (admin-window/BUG-0049).
   */
  label: MicroLabel;
}) {
  return (
    // `display: contents` — the marker names the card, it does not box it. The
    // card element itself stays the flex or grid item it was, so a block that
    // replaces itself with this card sits exactly where it sat before, and
    // this element renders nothing of its own.
    <div data-gauge-block="" className="contents">
      {state.kind === "empty" ? (
        <Empty holds={state.holds} filledBy={state.filledBy} eyebrow={label} />
      ) : (
        <NotProvisioned
          missing={state.missing}
          arrivesWith={state.arrivesWith}
          eyebrow={label}
        />
      )}
    </div>
  );
}

/** The state that renders as one line inside the surface. */
export function GaugeStateLine({ state }: { state: GaugeLineState }) {
  return state.kind === "loading" ? (
    <Loading what={state.what} />
  ) : (
    <ErrorLine
      reading={state.reading}
      failed={state.failed}
      authored={state.authored}
      retry={state.retry}
    />
  );
}
