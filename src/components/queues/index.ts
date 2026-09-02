/**
 * The Queues page's presentational half (campaign admin-window/TASK-0010).
 * Both are pure synchronous components taking plain props; neither reads a
 * database (ARCHITECTURE.md §4 rule 1, §5).
 */
export { FilterBar } from "./filter-bar";
export { QueueList } from "./queue-list";
