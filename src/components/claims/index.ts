/**
 * The Claims page's presentational half (campaign admin-window/TASK-0012).
 * Every one is a synchronous component taking plain props; none reads a
 * database (ARCHITECTURE.md §4 rule 1, §5).
 *
 * One of them is a CLIENT component — `PagedClaimList`, the wrapper that
 * continues the list past its first window (admin-window/TASK-0067). It reads
 * no database either: its press goes to this app's own route handler through
 * `usePageRows`, the one framed exception to rule 1 (§4 rule 1 as amended
 * 2026-09-10), and every decision the press makes is `src/lib/paging/**`.
 */
export { BucketTable, type BucketStat } from "./bucket-table";
export { ClaimList, CLAIM_WINDOW, type ClaimLine } from "./claim-list";
// A COMPONENT out of a "use client" module, which is the only thing a server
// barrel may re-export from one: a re-export hands the binding to every server
// module importing the barrel, so a helper or a constant from a client module
// would answer 500 in a production build (admin-window/BUG-0094,
// tests/offline/shell/client-boundary.test.ts). `PagedClaimList` is rendered
// by `src/app/claims/page.tsx` and never called.
export { PagedClaimList } from "./paged-claim-list";
export { ClaimTabs } from "./tabs";
export { FilterBar } from "./filter-bar";
