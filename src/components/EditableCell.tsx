"use client";

import { useEffect, useRef, useState } from "react";
import { orDash } from "@/lib/format";
import { cx } from "@/components/ui/cx";

/**
 * The click-to-edit cell, brought onto the tokens (campaign admin-window,
 * TASK-0004; it survives from the deprecated app and re-earns its place).
 *
 * Click a value, it becomes an input with a 1px accent border; Enter or blur
 * saves, Escape reverts. Confirmation is a green `data` word beside the field
 * for 1.5s; failure is a red `data` line that names the failure, and the field
 * reverts to its old value.
 *
 * It knows nothing about routes or tables: `onSave` is the caller's, and
 * returns what happened rather than throwing. The display is a real button, so
 * editing is reachable by Tab and never only on hover (quality bar 9).
 */
export type SaveOutcome =
  /** Saved. `value` is what the caller actually stored, if it normalised it. */
  | { ok: true; value?: string | null }
  /** Refused. `message` names the failure, in the words the caller was given. */
  | { ok: false; message: string };

const CONFIRMATION_MS = 1500;

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

export function EditableCell({
  value,
  onSave,
  label,
  multiline = false,
}: {
  value: string | null;
  /** Persist the new value. Returns the outcome; an empty field saves null. */
  onSave: (next: string | null) => Promise<SaveOutcome>;
  /** Which field this is, for the accessible name: "spotify_id of BLACKPINK". */
  label: string;
  multiline?: boolean;
}) {
  const [shown, setShown] = useState<string | null>(value);
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const reverting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function commit() {
    if (reverting.current) return;
    setEditing(false);

    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === shown) return; // nothing changed; no call, no confirmation

    const previous = shown;
    setShown(next);
    setStatus({ kind: "saving" });

    let outcome: SaveOutcome;
    try {
      outcome = await onSave(next);
    } catch (error) {
      outcome = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.ok) {
      // The caller may have normalised what it stored; show that, not the draft.
      if (outcome.value !== undefined) {
        setShown(outcome.value);
        setDraft(outcome.value ?? "");
      }
      setStatus({ kind: "saved" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus({ kind: "idle" }), CONFIRMATION_MS);
    } else {
      setShown(previous);
      setDraft(previous ?? "");
      setStatus({ kind: "failed", message: outcome.message });
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // In multiline mode Enter inserts a newline; that edit saves on blur.
    if (event.key === "Enter" && !multiline) {
      event.preventDefault();
      void commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      reverting.current = true;
      setDraft(shown ?? "");
      setEditing(false);
    }
  }

  const fieldClass =
    "type-data w-full rounded-control border border-accent bg-surface px-1 py-0.5 text-ink";

  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      {editing ? (
        multiline ? (
          <textarea
            autoFocus
            rows={4}
            aria-label={label}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={onKeyDown}
            className={fieldClass}
          />
        ) : (
          <input
            autoFocus
            aria-label={label}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={onKeyDown}
            className={fieldClass}
          />
        )
      ) : (
        <button
          type="button"
          aria-label={label}
          disabled={status.kind === "saving"}
          onClick={() => {
            reverting.current = false;
            setStatus({ kind: "idle" });
            setEditing(true);
          }}
          className={cx(
            "type-data cursor-text rounded-control px-1 py-0.5 text-left text-ink transition-colors hover:bg-chrome",
            status.kind === "saving" && "cursor-not-allowed opacity-50",
          )}
        >
          {orDash(shown)}
        </button>
      )}
      {status.kind === "saved" ? (
        <span className="type-data text-healthy" role="status">
          saved
        </span>
      ) : null}
      {status.kind === "failed" ? (
        <span className="type-data text-broken" role="alert">
          {status.message}
        </span>
      ) : null}
    </span>
  );
}
