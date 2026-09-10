/**
 * The primitive set — campaign admin-window, TASK-0004. Builders consume these
 * and the tokens in `src/app/globals.css`, never raw values (ARCHITECTURE §7).
 */
export { Badge, TONE_INK, type BadgeTone } from "./badge";
export { Button, type ButtonVariant } from "./button";
export { Chip } from "./chip";
export { DroppedParamsLine } from "./dropped-params";
export { type Column, DataTable, type SortDirection } from "./data-table";
export { Empty } from "./empty";
export { ErrorLine } from "./error-line";
export { DATA_MUTED, Identifier } from "./identifier";
export { Loading } from "./loading";
export { Eyebrow, type MicroLabel, microLabelText } from "./micro-label";
export { NotProvisioned } from "./not-provisioned";
export { Page } from "./page";
// `PageMore` is a COMPONENT out of a "use client" module, and that is the only
// thing this server barrel may re-export from one: a re-export hands the binding
// to every server module importing the barrel, so `usePageRows` and `fetchJson`
// — values, and 500s on the server — are imported straight from
// `@/components/ui/paging` by the client modules that need them
// (admin-window/BUG-0094, tests/offline/shell/client-boundary.test.ts).
export { PageMore } from "./paging";
export { Section } from "./section";
export {
  ARRIVES_WITH,
  RETRY,
  StateOf,
  type UnavailableRead,
} from "./state-of";
export { StatCard, type StatTone } from "./stat-card";
export {
  type DrawnWindow,
  NARROWED_BY_FILTERS,
  type ReadWindow,
  WindowLine,
  drawnWindow,
  narrowedTo,
  oldestIn,
} from "./window-line";
export { cx } from "./cx";
