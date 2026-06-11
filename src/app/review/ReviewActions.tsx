"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface CatalogHit {
  kind: "group" | "idol";
  id: string;
  name: string;
  sub: string | null;
}

export function ReviewActions({ id }: { id: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/catalog-search?q=${encodeURIComponent(q)}`);
        if (res.ok) setHits(await res.json());
      } catch {
        // Search is best-effort; the input just shows no results
      }
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/review/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search catalog…"
          disabled={busy}
          className="w-64 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-mono dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        />
        {hits.length > 0 && (
          <div className="absolute z-10 mt-0.5 w-64 max-h-48 overflow-auto rounded border border-gray-300 bg-white shadow dark:border-gray-700 dark:bg-gray-900">
            {hits.map((h) => (
              <button
                key={`${h.kind}-${h.id}`}
                onClick={() => act({ action: "link", kind: h.kind, catalogId: h.id })}
                disabled={busy}
                className="block w-full px-2 py-1 text-left text-[11px] font-mono hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
              >
                <span className="font-semibold">{h.name}</span>
                <span className="ml-2 text-gray-400">
                  {h.kind}
                  {h.sub ? ` · ${h.sub}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => act({ action: "skip" })}
        disabled={busy}
        className="rounded border border-gray-300 px-2 py-1 text-[11px] font-mono text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        Skip (not catalog)
      </button>
      {busy && <span className="text-[11px] font-mono text-gray-400">saving…</span>}
      {error && <span className="text-[11px] font-mono text-red-600">{error}</span>}
    </div>
  );
}
