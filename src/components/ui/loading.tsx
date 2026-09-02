/**
 * Data-surface state 1 of 4. One `data` line naming what is loading.
 * Spinners appear only inside a button; this line never animates.
 *
 * Carries `data-state="loading"`, the hook every one of the four states now
 * carries: a reader — an operator's devtools or a live oracle — reads WHICH
 * state a surface is in structurally, never from the words inside it
 * (ARCHITECTURE §10, admin-window/TASK-0032). It changes no class, no token
 * and no word.
 */
export function Loading({ what }: { what: string }) {
  return (
    <p data-state="loading" className="type-data text-ink-secondary" role="status">
      loading {what}…
    </p>
  );
}
