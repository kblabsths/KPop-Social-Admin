"use client";

import { useState, useRef, useTransition } from "react";

interface Props {
  userId: string;
  initialBio: string | null;
  initialFavoriteArtists: string[];
}

async function patchProfile(
  userId: string,
  data: { bio?: string; favoriteArtists?: string[] }
) {
  const res = await fetch(`/api/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save");
}

function EditableField({
  label,
  value,
  multiline,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (val: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  async function save() {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!multiline && e.key === "Enter") {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") {
      setDraft(value);
      setEditing(false);
    }
  }

  if (editing) {
    const sharedClass =
      "w-full rounded-lg border border-purple-400 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-purple-500 dark:bg-gray-800 dark:text-white";
    return (
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </p>
        {multiline ? (
          <textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={handleKeyDown}
            className={sharedClass}
            maxLength={300}
          />
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={handleKeyDown}
            className={sharedClass}
          />
        )}
        {saving && (
          <p className="mt-1 text-xs text-purple-500 dark:text-purple-400">
            Saving…
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <button
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="group w-full rounded-lg border border-dashed border-gray-200 px-3 py-2 text-left text-sm transition hover:border-purple-400 hover:bg-purple-50 dark:border-gray-700 dark:hover:border-purple-500 dark:hover:bg-purple-900/20"
        title="Click to edit"
      >
        {value ? (
          <span className="text-gray-700 dark:text-gray-300">{value}</span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500 group-hover:text-purple-500">
            Click to add {label.toLowerCase()}…
          </span>
        )}
      </button>
    </div>
  );
}

export default function InlineEditProfile({
  userId,
  initialBio,
  initialFavoriteArtists,
}: Props) {
  const [bio, setBio] = useState(initialBio ?? "");
  const [favoriteArtists, setFavoriteArtists] = useState(
    initialFavoriteArtists.join(", ")
  );
  const [, startTransition] = useTransition();

  async function saveBio(val: string) {
    await patchProfile(userId, { bio: val });
    startTransition(() => setBio(val));
  }

  async function saveArtists(val: string) {
    const arr = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await patchProfile(userId, { favoriteArtists: arr });
    startTransition(() => setFavoriteArtists(val));
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <EditableField
        label="Bio"
        value={bio}
        multiline
        onSave={saveBio}
      />
      <EditableField
        label="Favorite Artists"
        value={favoriteArtists}
        onSave={saveArtists}
      />
      {favoriteArtists && (
        <div className="flex flex-wrap gap-2">
          {favoriteArtists
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
            .map((artist) => (
              <span
                key={artist}
                className="rounded-full bg-gradient-to-r from-purple-100 to-pink-100 px-3 py-1 text-sm font-medium text-purple-700 dark:from-purple-900/30 dark:to-pink-900/30 dark:text-purple-300"
              >
                {artist}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
