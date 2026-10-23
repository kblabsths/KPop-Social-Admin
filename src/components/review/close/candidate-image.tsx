"use client";

import { useRef, useState } from "react";
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
  /**
   * How much the enlarged picture is magnified (Ben, 2026-10-23: "+ and -
   * buttons to the bottom left which zoom in/out").
   *
   * A multiple of the dialog's own fitted size rather than an absolute pixel
   * width, so `1` is always "as large as this screen will show it" whatever
   * the source published — a 400px portrait and a 3000px one both start whole
   * and zoom the same way.
   */
  const [zoom, setZoom] = useState(1);
  const step = (by: number) =>
    // Clamped, and the bounds are the useful ones: below 1 there is no reason
    // to shrink a picture that already fits, and past 4 a catalog portrait is
    // mostly compression artefacts.
    setZoom((was) => Math.min(4, Math.max(1, Math.round((was + by) * 100) / 100)));

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setZoom(1);
          dialog.current?.showModal();
        }}
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
        /*
         * CENTRED, and closed by a click outside it (Ben, 2026-10-23).
         *
         * `inset-0` + `m-auto` + `h-fit w-fit` centres a modal dialog in both
         * axes explicitly. The UA centres `dialog:modal` on its own, but this
         * app's reset and the classes below are free to disturb that, so the
         * centring is stated rather than inherited.
         *
         * NO PADDING HERE, on purpose: the padding lives on the inner box, so
         * every pixel of the dialog element itself is "outside the content"
         * and the click handler below can treat a hit on it as a backdrop
         * click. With padding on the dialog, the frame around the image would
         * swallow those clicks and the outside-to-close would feel broken.
         *
         * `backdrop:` styles the platform's own backdrop.
         */
        className="fixed inset-0 m-auto h-fit border border-hairline bg-surface p-0 backdrop:bg-ink/50"
        /*
         * THE DIALOG IS WHAT ZOOMS (Ben, 2026-10-23: "the dialog height gets
         * taller correctly, but the width does not change. Can we also
         * increase the dialog width?").
         *
         * It was `w-fit` around an image whose width was a percentage of its
         * own container — which is circular, so the width never moved and only
         * the height grew. Now the dialog has an explicit width that scales
         * and the image simply fills it.
         *
         * `min()` with `90vw` is the clamp, in CSS rather than in the handler:
         * the ceiling is a property of the VIEWPORT, so it belongs where the
         * viewport is known. The zoom's own 1-4 bound still lives in `step`.
         */
        style={{ width: `min(90vw, ${zoom * 32}rem)` }}
        /*
         * A click that lands on the DIALOG rather than on its content is a
         * click outside the content — including one on the backdrop, which the
         * platform reports as a hit on the dialog element. Compared by
         * identity, so a click on the image or the button never closes it.
         */
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex flex-col gap-2 p-3">
          {/*
            The picture scrolls once it outgrows its box. Without this a zoom
            past the viewport would either be clipped with no way to reach the
            rest, or push the controls below off the screen.
          */}
          {/* Vertical scroll only: the width is the dialog's now, so there is
              never horizontal overflow to chase. Capped so a tall portrait
              cannot push the zoom controls off the screen. */}
          <div className="max-h-[70vh] overflow-y-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={called}
              width={480}
              height={480}
              /* Fills whatever width the dialog currently has — the
                 magnification lives on the dialog, not here. */
              className="h-auto w-full rounded-control object-contain"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            {/* BOTTOM LEFT, as asked. `−` and `+` are the characters, not `-`
                and `+`: these are mathematical operators being read aloud, and
                a hyphen is announced as punctuation. Each is disabled at its
                bound, so the control says when there is nothing left to do. */}
            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={zoom <= 1}
                onClick={() => step(-0.25)}
                aria-label="Zoom out"
              >
                −
              </Button>
              <Button
                variant="secondary"
                disabled={zoom >= 4}
                onClick={() => step(0.25)}
                aria-label="Zoom in"
              >
                +
              </Button>
              {/* The current magnification, so the buttons are not a mystery.
                  A machine-produced number, in the data face. */}
              <span className="type-data text-ink-secondary">{zoom}×</span>
            </span>
            {/* Escape closes it too, and so does a click outside — this is for
                the operator who reaches for a button. */}
            <Button variant="secondary" onClick={() => dialog.current?.close()}>
              Close
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
