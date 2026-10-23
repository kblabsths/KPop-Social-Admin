"use client";

import { useRef } from "react";
import { Button } from "@/components/ui";

/**
 * A candidate's face, and a DIALOG with a bigger one.
 *
 * Ben, 2026-10-23: *"clicking the image specifically opens a DIALOG (not
 * inline) which shows a larger version of the image, and that is closable."*
 *
 * **Why this is its own control and not part of the row's.** The row is one
 * `<button>` so that the whole row selects — and a button may not contain a
 * button, so the face cannot be clickable inside it. The table therefore gives
 * the image its own cell with its own control, and the rest of the columns
 * share the selecting one. Both are keyboard-reachable, which a `stopPropagation`
 * on a nested `div` would not have been: that is the version that looks right
 * with a mouse and does not exist for anyone else.
 *
 * **A real `<dialog>`, opened with `showModal()`**, so the browser gives us
 * the things a hand-built overlay has to reinvent and usually gets wrong:
 * focus trapped inside it, Escape closing it, the rest of the page inert, and
 * a backdrop that is the platform's rather than a `z-index` guess.
 *
 * A 404 renders nothing at all — no control, no empty frame. The caller only
 * passes a url the catalog holds, and a url that fails to paint leaves a
 * control that opens a dialog showing nothing.
 */
export function CandidateImage({
  url,
  name,
}: {
  /** The face's address, from the catalog. */
  url: string;
  /**
   * Whose face it is — the dialog's accessible name and the enlarged image's
   * alt text.
   *
   * Nullable because a `PickerOption`'s name is: a catalog row holding no
   * readable name still has a picture, and the control must still be
   * announceable. `(unnamed)` is the app's own stand-in and never a blank
   * label, which would leave the button unnamed.
   */
  name: string | null;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const called = name ?? "(unnamed)";

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        data-candidate-image={called}
        /* The thumbnail IS the control, so the button is the image's box and
           carries no padding of its own. */
        className="size-12 shrink-0 rounded-control"
        aria-label={`Show a larger picture of ${called}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          loading="lazy"
          width={48}
          height={48}
          className="size-12 rounded-control object-cover"
        />
      </button>

      <dialog
        ref={dialog}
        data-candidate-dialog={called}
        aria-label={called}
        /* `backdrop:` styles the platform's own backdrop. The dialog takes the
           surface fill and a hairline, like every other container here, and no
           shadow — this app has no elevation. */
        className="max-w-[90vw] border border-hairline bg-surface p-3 backdrop:bg-ink/50"
      >
        <div className="flex flex-col items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={called}
            width={480}
            height={480}
            /* Bounded by the VIEWPORT, not by a fixed size: the catalog's
               images are whatever the source published, and one that is 2000px
               tall must not push its own close button off the screen. */
            className="max-h-[70vh] w-auto max-w-full rounded-control object-contain"
          />
          <span className="type-body text-ink">{called}</span>
          {/* Escape closes it too — this is for the operator who reaches for a
              button, and the only way to close it with a pointer. */}
          <Button variant="secondary" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        </div>
      </dialog>
    </>
  );
}
