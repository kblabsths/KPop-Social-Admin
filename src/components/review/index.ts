/**
 * The review-item detail's components — campaign admin-window/TASK-0011.
 *
 * Three typed views over one anatomy (spec §6): the header every shape shares,
 * the evidence cells they share, and the per-shape evidence views the
 * `EVIDENCE_VIEW_BY_SHAPE` map selects between. Every one is a pure
 * synchronous component over plain props (ARCHITECTURE.md §5); none of them
 * imports `lib/db`, and none of them settles anything.
 */
export { claimValueText } from "./claim-value";
export { ItemHeader, type ItemLink } from "./item-header";
export type { EvidenceRow } from "./evidence-cells";
export {
  DIAL_BY_SHAPE,
  EVIDENCE_VIEW_BY_SHAPE,
  type DialProps,
  type DialSeries,
  type DialWindow,
  type ShapeEvidenceProps,
} from "./shape-views";
