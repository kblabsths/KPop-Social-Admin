"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * A control this close WOULD offer and cannot yet — drawn, pressable, and
 * answering with what it is waiting on.
 *
 * Ben, 2026-10-23: *"Please put Create a new artist between select and not
 * kpop. And make it so that when clicked it opens a toast that just needs not
 * yet implemented."*
 *
 * **Pressable rather than disabled, which is a reversal worth stating.** It was
 * a disabled button with its reason printed permanently beside it. Disabled is
 * the wrong shape twice over: a disabled control is skipped by keyboard
 * navigation, so an operator tabbing through the close never meets it and
 * never learns the option exists at all; and a reason printed next to every
 * control forever is standing prose, which is the thing this page keeps
 * shedding. Pressable with an answer on demand tells the same truth and only
 * when asked.
 *
 * It settles nothing and sends nothing. The whole mechanism is one piece of
 * local state: there is no request, no verdict, no route — which is why it
 * cannot be confused for a control that half-works.
 */
export function BlockedControl({
  label,
  because,
}: {
  label: string;
  /** What it is waiting on, in one line, shown when pressed. */
  because: string;
}) {
  const [asked, setAsked] = useState(false);
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="secondary"
        data-close-blocked={label}
        onClick={() => setAsked(true)}
      >
        {label}
      </Button>
      {asked ? (
        /*
         * `role="status"`, so it is announced when it appears without stealing
         * focus — the operator pressed a button and is still reading the table.
         * `alert` would interrupt, and nothing here is urgent.
         */
        <span
          role="status"
          data-close-blocked-said={label}
          className="type-body text-ink-secondary"
        >
          Not yet implemented — {because}
        </span>
      ) : null}
    </span>
  );
}
