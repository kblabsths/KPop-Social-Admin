"use client";

import { useEffect, useState } from "react";

/**
 * A TOAST: a short-lived message in a fixed corner, over the page.
 *
 * The app's first. Ben asked for one by name (2026-10-23) after I answered
 * "Create a new artist" with an inline line under the button — which is not a
 * toast, it is more standing prose in a page he keeps clearing.
 *
 * **It says exactly what it is handed and adds nothing** — no icon, no title,
 * no dismiss affordance in the message itself. "Make sure the toast only says
 * 'Not yet implemented' and nothing else", so the component takes one string
 * and renders one string.
 *
 * `role="status"` with `aria-live="polite"`: it appears because the operator
 * pressed something and is still reading the table, so it is announced without
 * stealing focus. An `alert` would interrupt, and nothing a toast says is
 * urgent enough to interrupt — if it were, it would belong in the page.
 *
 * It takes itself away. A toast that needs dismissing is a dialog wearing a
 * toast's clothes, and an operator who pressed a button to learn one fact
 * should not then have to clean up after it.
 */
export function Toast({
  message,
  onDone,
  ms = 4000,
}: {
  /** The whole message. Rendered verbatim, with nothing added. */
  message: string;
  /** Called when it has taken itself away, so the caller can forget it. */
  onDone: () => void;
  /** How long it stays. Long enough to read twice, short enough not to linger. */
  ms?: number;
}) {
  useEffect(() => {
    const timer = globalThis.setTimeout(onDone, ms);
    // Cleared on unmount, so a second press cannot leave a timer pointing at a
    // callback for a toast that is already gone.
    return () => globalThis.clearTimeout(timer);
  }, [onDone, ms]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-toast=""
      /* Fixed to the viewport's bottom-right, above everything. Radius 0,
         because LOOK_AND_FEEL gives containers no radius and a toast is a
         container; 1px hairline and the surface fill, because this app has no
         elevation and a shadow here would be the only one in it. */
      className="type-body fixed right-4 bottom-4 z-50 border border-hairline bg-surface px-3 py-1.5 text-ink"
    >
      {message}
    </div>
  );
}

/**
 * One toast at a time, and the handle that shows it.
 *
 * A hook rather than a provider: there is exactly one caller today and a
 * context would be machinery for a second one that does not exist. If a third
 * surface wants toasts, this is where the provider goes.
 */
export function useToast(): {
  toast: string | null;
  show: (message: string) => void;
  clear: () => void;
} {
  const [toast, setToast] = useState<string | null>(null);
  return { toast, show: setToast, clear: () => setToast(null) };
}
