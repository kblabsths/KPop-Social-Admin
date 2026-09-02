import { Empty, ErrorLine, Loading, NotProvisioned } from "@/components/ui";

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
 */
export type EmptyWords = { holds: string; filledBy: string };

export type GaugeState =
  | { kind: "loading"; what: string }
  | ({ kind: "empty" } & EmptyWords)
  | { kind: "not_provisioned"; missing: string; arrivesWith: string }
  | { kind: "error"; reading: string; failed: string; retry: string };

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
   * (ARCHITECTURE §7, admin-window/TASK-0030).
   */
  label: string;
}) {
  return state.kind === "empty" ? (
    <Empty holds={state.holds} filledBy={state.filledBy} eyebrow={label} />
  ) : (
    <NotProvisioned
      missing={state.missing}
      arrivesWith={state.arrivesWith}
      eyebrow={label}
    />
  );
}

/** The state that renders as one line inside the surface. */
export function GaugeStateLine({ state }: { state: GaugeLineState }) {
  return state.kind === "loading" ? (
    <Loading what={state.what} />
  ) : (
    <ErrorLine reading={state.reading} failed={state.failed} retry={state.retry} />
  );
}
