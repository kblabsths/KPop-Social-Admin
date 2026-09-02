/**
 * Data-surface state 1 of 4. One `data` line naming what is loading.
 * Spinners appear only inside a button; this line never animates.
 */
export function Loading({ what }: { what: string }) {
  return (
    <p className="type-data text-ink-secondary" role="status">
      loading {what}…
    </p>
  );
}
