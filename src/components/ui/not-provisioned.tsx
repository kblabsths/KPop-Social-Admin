import type { ReactNode } from "react";

import { Identifier } from "./identifier";
import { Eyebrow, type MicroLabel } from "./micro-label";

/**
 * THE APP'S ONE SPELLING of data-surface state 3's sentence — the words, and
 * the object inside its own isolated identifier box (admin-window/BUG-0176).
 *
 * It stood only inside the CARD until a second surface needed it: the paged
 * refusal line of `/claims` and `/browse`, where a card cannot stand. A
 * refusal saying a table is missing is state 3 said in another place, so it
 * says it in the app's words or it is a hand-rolled fifth spelling
 * (ARCHITECTURE §7; LESSONS 5 — a shared spelling gets imported, never
 * retyped; `ARRIVES_WITH` ×8, admin-window/DEBT-0003).
 *
 * **It returns NODES, not a string, and that is the contract.** `missing` is
 * text this app did not author — for a column-absent code it is mined out of
 * the database's own message, so it has been measured carrying a whole HTML
 * document and an unterminated RTL override — and text this app did not write
 * never sits inside a sentence it did write (ARCHITECTURE §7, common
 * violations row 15). `<Identifier>` is the one box that isolates it
 * (`dir="ltr"`, verbatim, mono), so a helper returning a formatted `string`
 * could not carry it and is the shape to refuse.
 *
 * The caller owns the paragraph and the ink: the card renders it in
 * `type-body text-ink-secondary`, and so does the paging line — gray, never
 * red, because a missing backing table is unavailable and not broken.
 */
export function NotProvisionedClause({
  missing,
  arrivesWith,
}: {
  /** The table/view name the query used, spelled exactly as the query spelled it. */
  missing: string;
  /** What creates it: `ARRIVES_WITH` (`./state-of`), never retyped. */
  arrivesWith: string;
}): ReactNode {
  return (
    <>
      <Identifier>{missing}</Identifier>{" "}
      isn&rsquo;t in this database yet — it arrives with {arrivesWith}.
    </>
  );
}

/**
 * Data-surface state 3 of 4: the backing table is not in this database yet.
 * Gray, never red — red means broken, never unavailable — and never a zero
 * that reads like data. Names the missing table verbatim in mono and what
 * creates it (LOOK_AND_FEEL, state 3 and Voice bar 4).
 *
 * Carries `data-state="not_provisioned"` — the hook that separates it from
 * `Empty`, which draws the identical container (ARCHITECTURE §10,
 * admin-window/TASK-0032).
 */
export function NotProvisioned({
  missing,
  arrivesWith,
  eyebrow,
}: {
  /** The table/view name the query used, spelled exactly as the query spelled it. */
  missing: string;
  /** What creates it: "the scraper repo's migration". */
  arrivesWith: string;
  /**
   * The `micro` label of the surface this card stands in for. Optional here
   * and always passed by the gauge components — see `Empty` for the ruling
   * (ARCHITECTURE §7, admin-window/TASK-0030).
   */
  eyebrow?: MicroLabel;
}) {
  return (
    <div
      data-state="not_provisioned"
      className="border border-hairline bg-surface p-3"
    >
      {eyebrow === undefined ? null : (
        <Eyebrow label={eyebrow} className="block" />
      )}
      <p className="type-body text-ink-secondary">
        <NotProvisionedClause missing={missing} arrivesWith={arrivesWith} />
      </p>
    </div>
  );
}
