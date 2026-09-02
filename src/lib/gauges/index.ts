/**
 * The six gauges — campaign admin-window/TASK-0007.
 *
 * Spec §5's table, one module per row, each a bounded server-side query plus a
 * pure aggregate. Pages import from here; nothing here renders anything
 * (TASK-0008 owns the cards).
 *
 * | gauge | page | module |
 * | --- | --- | --- |
 * | cycle health | `/cycles` | `cycle-health.ts` |
 * | resolution latency | `/cycles` | `resolution-latency.ts` |
 * | pending claims | `/claims` (+ trend on `/sources`) | `pending-claims.ts` |
 * | queue health | `/queues` | `queue-health.ts` |
 * | standing disagreements | `/claims`, standing tab | `standing-disagreements.ts` |
 * | settled values | `/sources` | `settled-values.ts` |
 *
 * The PostgREST chains and the row types they return live in
 * `src/lib/db/gauges.ts` — ARCHITECTURE.md §4 rule 2 keeps
 * `@supabase/supabase-js` inside `lib/db/**`, and that split is what makes
 * every `aggregate…` below structurally unable to reach a database.
 */
export * from "./gauge";
export * from "./cycle-health";
export * from "./resolution-latency";
export * from "./pending-claims";
export * from "./queue-health";
export * from "./standing-disagreements";
export * from "./settled-values";
