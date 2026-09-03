/**
 * The Claims page's presentational half (campaign admin-window/TASK-0012).
 * Every one is a pure synchronous component taking plain props; none reads a
 * database (ARCHITECTURE.md §4 rule 1, §5).
 */
export { BucketTable, type BucketStat } from "./bucket-table";
export {
  ClaimList,
  claimWindow,
  CLAIM_WINDOW,
  type ClaimLine,
  type ClaimWindow,
} from "./claim-list";
export { ClaimTabs } from "./tabs";
export { FilterBar } from "./filter-bar";
