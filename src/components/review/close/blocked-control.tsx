"use client";

import { Button, Toast, useToast } from "@/components/ui";

/**
 * A control this close WOULD offer and cannot yet — drawn, pressable, and
 * answering in a toast.
 *
 * Ben, 2026-10-23: *"Please put Create a new artist between select and not
 * kpop. And make it so that when clicked it opens a toast."*
 *
 * **Pressable rather than disabled**, which is a reversal worth keeping
 * stated: a disabled control is skipped by keyboard navigation, so an operator
 * tabbing through the close would never meet it and never learn the option
 * exists at all. Pressable and honest beats absent and tidy.
 *
 * **The reason does not render.** It did, inline under the button, and that
 * was more standing prose on a page Ben keeps clearing — and he then asked for
 * the toast to say "Not yet implemented" and nothing else. So `because` is
 * documentation for whoever reads this code, not copy: the operator is told
 * the honest short answer, and the long answer lives in the handoff where the
 * person who can fix it will read it.
 *
 * It settles nothing and sends nothing — no request, no verdict, no route — so
 * it cannot be mistaken for a control that half-works.
 */
export function BlockedControl({
  label,
  because,
}: {
  label: string;
  /**
   * What it is waiting on. NOT rendered — see above. It stays in the signature
   * because a blocked control with no recorded reason is one nobody can
   * unblock, and the page that declares it is where that belongs.
   */
  because: string;
}) {
  const { toast, show, clear } = useToast();
  void because;
  return (
    <>
      <Button variant="secondary" data-close-blocked={label} onClick={() => show("Not yet implemented")}>
        {label}
      </Button>
      {toast === null ? null : <Toast message={toast} onDone={clear} />}
    </>
  );
}
