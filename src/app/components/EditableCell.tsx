"use client";

import { useRef, useState } from "react";

type Props = {
  value: string | null;
  recordId: string;
  field: string;
  apiPath: string; // e.g. "/api/admin/groups"
  className?: string;
  placeholder?: string;
};

export function EditableCell({ value, recordId, field, apiPath, className = "", placeholder = "—" }: Props) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(value ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function save() {
    setEditing(false);
    const newValue = current.trim();
    if (newValue === (value ?? "")) return; // no change

    try {
      const res = await fetch(`${apiPath}/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: newValue || null }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError(true);
      setCurrent(value ?? "");
      setTimeout(() => setError(false), 2000);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") {
      setCurrent(value ?? "");
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        className={`w-full bg-white dark:bg-gray-900 border border-purple-400 rounded px-1 py-0.5 text-xs font-mono outline-none ${className}`}
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      title="Click to edit"
      className={`cursor-text rounded px-0.5 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors ${
        saved ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300" : ""
      } ${
        error ? "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300" : ""
      } ${className}`}
    >
      {current || <span className="text-gray-400">{placeholder}</span>}
    </span>
  );
}
